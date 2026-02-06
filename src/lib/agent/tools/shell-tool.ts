/**
 * Shell tool for Neo coding assistant
 * Executes shell commands with safety checks
 */
import { z } from 'zod';
import { defineTool } from '../tool';
import { Command } from '@tauri-apps/plugin-shell';

const MAX_OUTPUT_LENGTH = 50000;
const DEFAULT_TIMEOUT_MS = 30000;

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
  'sudo',
  'su ',
];

/**
 * Check if a command is potentially dangerous
 */
function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
  const trimmed = command.trim().toLowerCase();
  
  // Check blocked commands
  for (const blocked of BLOCKED_COMMANDS) {
    if (trimmed.includes(blocked.toLowerCase())) {
      return { dangerous: true, reason: `Command contains blocked pattern: ${blocked}` };
    }
  }
  
  // Check dangerous prefixes
  for (const prefix of DANGEROUS_PREFIXES) {
    if (trimmed.startsWith(prefix.toLowerCase())) {
      return { dangerous: true, reason: `Command starts with dangerous prefix: ${prefix}` };
    }
  }
  
  return { dangerous: false };
}

/**
 * Parse command into program and args
 */
function parseCommand(command: string): { program: string; args: string[] } {
  // Simple parsing - split on spaces but handle quotes
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';
  
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    
    if ((char === '"' || char === "'") && (i === 0 || command[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      } else {
        current += char;
      }
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  
  if (current) {
    parts.push(current);
  }
  
  return {
    program: parts[0] || 'sh',
    args: parts.slice(1),
  };
}

export const ShellTool = defineTool('shell', {
  description: `Execute a shell command in the workspace directory.

Usage notes:
- Commands are executed in the workspace directory by default
- Use 'cwd' parameter to change the working directory
- Commands have a 30 second timeout by default
- Output is truncated to 50KB
- Some dangerous commands are blocked for safety

SAFETY: This tool can modify your system. Use with caution.
- Avoid destructive commands (rm -rf, etc.)
- Be careful with sudo commands
- Consider the impact before running`,
  parameters: z.object({
    command: z.string().describe('The shell command to execute'),
    cwd: z.string().optional().describe('Working directory (defaults to workspace)'),
    timeout: z.coerce.number().optional().describe('Timeout in milliseconds (default: 30000)'),
  }),
  async execute(params, ctx) {
    const command = params.command.trim();
    const cwd = params.cwd || ctx.workspaceDir;
    const timeout = params.timeout || DEFAULT_TIMEOUT_MS;

    // Safety check
    const safety = isDangerousCommand(command);
    if (safety.dangerous) {
      throw new Error(`Command blocked for safety: ${safety.reason}`);
    }

    try {
      // Use shell to execute the command
      const shellCommand = Command.create('sh', ['-c', command], {
        cwd,
      });

      let stdout = '';
      let stderr = '';

      // Collect output
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

      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          shellCommand.kill();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      });

      // Execute command
      const execPromise = shellCommand.execute();

      // Race between execution and timeout
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

      // Add exit code info
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
        title: `$ ${command.slice(0, 50)}${command.length > 50 ? '...' : ''}`,
        output: output + status,
        metadata: {
          exitCode,
          signal,
          cwd,
        },
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      throw new Error(`Shell command failed: ${error}`);
    }
  },
});
