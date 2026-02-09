/**
 * Default policy rules for Neo
 */

import { PolicyDecision, type PolicyRule } from './policy-engine';

/**
 * Default policies that balance safety with usability
 */
export const DEFAULT_POLICIES: PolicyRule[] = [
  // ==================
  // READ-ONLY TOOLS - Always allowed
  // ==================
  {
    toolName: 'read',
    decision: PolicyDecision.ALLOW,
    priority: 100,
    description: 'Reading files is always safe',
    source: 'default',
  },
  {
    toolName: 'ls',
    decision: PolicyDecision.ALLOW,
    priority: 100,
    description: 'Listing directories is always safe',
    source: 'default',
  },
  {
    toolName: 'glob',
    decision: PolicyDecision.ALLOW,
    priority: 100,
    description: 'Finding files is always safe',
    source: 'default',
  },
  {
    toolName: 'grep',
    decision: PolicyDecision.ALLOW,
    priority: 100,
    description: 'Searching files is always safe',
    source: 'default',
  },

  // ==================
  // MEMORY TOOLS - Always allowed
  // ==================
  {
    toolName: 'read_memory',
    decision: PolicyDecision.ALLOW,
    priority: 100,
    description: 'Reading memory is safe',
    source: 'default',
  },
  {
    toolName: 'search_memory',
    decision: PolicyDecision.ALLOW,
    priority: 100,
    description: 'Searching memory is safe',
    source: 'default',
  },
  {
    toolName: 'list_memory',
    decision: PolicyDecision.ALLOW,
    priority: 100,
    description: 'Listing memory is safe',
    source: 'default',
  },
  {
    toolName: 'get_memory_context',
    decision: PolicyDecision.ALLOW,
    priority: 100,
    description: 'Getting memory context is safe',
    source: 'default',
  },

  // ==================
  // SKILL TOOLS - Always allowed
  // ==================
  {
    toolName: 'list_skills',
    decision: PolicyDecision.ALLOW,
    priority: 100,
    description: 'Listing skills is safe',
    source: 'default',
  },
  {
    toolName: 'use_skill',
    decision: PolicyDecision.ALLOW,
    priority: 100,
    description: 'Using skills is safe',
    source: 'default',
  },

  // ==================
  // WRITE TOOLS - Ask user by default
  // ==================
  {
    toolName: 'write',
    decision: PolicyDecision.ASK_USER,
    priority: 50,
    description: 'Writing files requires confirmation',
    source: 'default',
  },
  {
    toolName: 'edit',
    decision: PolicyDecision.ASK_USER,
    priority: 50,
    description: 'Editing files requires confirmation',
    source: 'default',
  },
  {
    toolName: 'write_memory',
    decision: PolicyDecision.ALLOW,
    priority: 90,
    description: 'Writing to memory journal is safe',
    source: 'default',
  },
  {
    toolName: 'sync_memory',
    decision: PolicyDecision.ALLOW,
    priority: 90,
    description: 'Syncing memory is safe',
    source: 'default',
  },

  // ==================
  // SHELL TOOLS - Denied by default (for safety)
  // ==================
  {
    toolName: 'shell',
    decision: PolicyDecision.ASK_USER,
    priority: 10,
    description: 'Shell commands require confirmation',
    source: 'default',
  },

  // ==================
  // WEB TOOLS - Ask user
  // ==================
  {
    toolName: 'web_fetch',
    decision: PolicyDecision.ASK_USER,
    priority: 50,
    description: 'Web fetching requires confirmation',
    source: 'default',
  },
  {
    toolName: 'web_search',
    decision: PolicyDecision.ASK_USER,
    priority: 50,
    description: 'Web searching requires confirmation',
    source: 'default',
  },
];

/**
 * Create a policy set for read-only mode
 */
export const READ_ONLY_POLICIES: PolicyRule[] = [
  {
    toolName: 'write',
    decision: PolicyDecision.DENY,
    priority: 1000,
    description: 'Write disabled in read-only mode',
    source: 'read-only',
  },
  {
    toolName: 'edit',
    decision: PolicyDecision.DENY,
    priority: 1000,
    description: 'Edit disabled in read-only mode',
    source: 'read-only',
  },
  {
    toolName: 'shell',
    decision: PolicyDecision.DENY,
    priority: 1000,
    description: 'Shell disabled in read-only mode',
    source: 'read-only',
  },
  ...DEFAULT_POLICIES,
];

/**
 * Create a policy set for YOLO mode (auto-approve everything)
 */
export const YOLO_POLICIES: PolicyRule[] = DEFAULT_POLICIES.map((rule) => ({
  ...rule,
  decision: rule.decision === PolicyDecision.ASK_USER ? PolicyDecision.ALLOW : rule.decision,
}));
