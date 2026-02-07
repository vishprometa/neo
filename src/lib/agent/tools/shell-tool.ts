/**
 * Shell tool for Neo coding assistant
 * Executes shell commands with safety checks
 * Enhanced with description and workdir params (ported from erpai-cli)
 */
import { z } from 'zod';
import { defineTool } from '../tool';
import { Command } from '@tauri-apps/plugin-shell';

const MAX_OUTPUT_LENGTH = 50_000;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes like erpai-cli

/** Commands that are always blocked for safety */
const BLOCKED_COMMANDS = new Set([
  'rm -rf /',
  'rm -rf /*',
  'rm -rf ~',
  'rm -rf ~/*',
  'mkfs',
  'dd',
  ':(){:|:&};:',
  'chmod -R 777 /',
  'chown -R',
]);

/** Command prefixes that should require extra caution */
const DANGEROUS_PREFIXES = [
  'rm -rf',
  'sudo rm',
  'chmod -R',
  'chown -R',
  'mv /',
  'cp /',
];

/**
 * Check if a command is potentially dangerous
 */
function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  const trimmed = command.trim().toLowerCase();

  for (const blocked of BLOCKED_COMMANDS) {
    if (trimmed.includes(blocked.toLowerCase())) {
      return { dangerous: true, reason: `Command contains blocked pattern: ${blocked}` };
    }
  }

  for (const prefix of DANGEROUS_PREFIXES) {
    if (trimmed.startsWith(prefix.toLowerCase())) {
      return { dangerous: true, reason: `Command starts with dangerous prefix: ${prefix}` };
    }
  }

  return { dangerous: false };
}

export const ShellTool = defineTool('bash', {
  description: `Execute a shell command in the workspace directory.

Usage notes:
- Commands are executed in the workspace directory by default
- Use 'workdir' parameter to change the working directory instead of 'cd' commands
- Commands have a 2 minute timeout by default
- Output is truncated to 50KB
- Some dangerous commands are blocked for safety (rm -rf /, etc.)
- Always provide a clear 'description' of what the command does

SAFETY: This tool can modify your system. Use with caution.
- Avoid destructive commands (rm -rf, etc.)
- Consider the impact before running`,
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    description: z.string().describe(
      'Clear, concise description of what this command does in 5-10 words. Examples: "Lists files in current directory", "Installs package dependencies", "Shows working tree status"'
    ),
    workdir: z.string().optional().describe('Working directory for the command (defaults to workspace root). Use this instead of cd commands.'),
    timeout: z.coerce.number().optional().describe('Timeout in milliseconds (default: 120000)'),
  }),
  async execute(params, ctx) {
    const command = params.command.trim();
    const cwd = params.workdir || ctx.workspaceDir;
    const timeout = params.timeout || DEFAULT_TIMEOUT_MS;

    if (timeout < 0) {
      throw new Error(`Invalid timeout value: ${timeout}. Timeout must be a positive number.`);
    }

    // Safety check
    const safety = isDangerousCommand(command);
    if (safety.dangerous) {
      throw new Error(`Command blocked for safety: ${safety.reason}`);
    }

    try {
      const shellCommand = Command.create('sh', ['-c', command], { cwd });

      let stdout = '';
      let stderr = '';

      shellCommand.stdout.on('data', (data) => {
        stdout += data;
        if (stdout.length > MAX_OUTPUT_LENGTH) {
          stdout = stdout.slice(0, MAX_OUTPUT_LENGTH);
        }
      });

      shellCommand.stderr.on('data', (data) => {
        stderr += data;
        if (stderr.length > MAX_OUTPUT_LENGTH) {
          stderr = stderr.slice(0, MAX_OUTPUT_LENGTH);
        }
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          shellCommand.kill();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      });

      const execPromise = shellCommand.execute();
      const result = await Promise.race([execPromise, timeoutPromise]);

      // Build output
      let output = '';

      if (stdout) {
        output += stdout;
        if (stdout.length >= MAX_OUTPUT_LENGTH) {
          output += '\n(stdout truncated)';
        }
      }

      if (stderr) {
        if (output) output += '\n\n';
        output += `STDERR:\n${stderr}`;
        if (stderr.length >= MAX_OUTPUT_LENGTH) {
          output += '\n(stderr truncated)';
        }
      }

      if (!output) {
        output = '(no output)';
      }

      const exitCode = result.code;
      const signal = result.signal;

      let status = '';
      if (exitCode !== 0) {
        status = `\n\n[Exit code: ${exitCode}]`;
      }
      if (signal) {
        status += `\n[Signal: ${signal}]`;
      }

      return {
        title: params.description,
        output: output + status,
        metadata: {
          exitCode,
          signal,
          cwd,
          description: params.description,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      throw new Error(`Shell command failed: ${error}`);
    }
  },
});
