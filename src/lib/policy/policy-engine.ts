/**
 * Policy engine for Neo
 * Inspired by gemini-cli's policy system
 */

export enum PolicyDecision {
  /** Tool execution is allowed */
  ALLOW = 'ALLOW',
  /** Tool execution is denied */
  DENY = 'DENY',
  /** User must approve this tool execution */
  ASK_USER = 'ASK_USER',
}

export enum ApprovalMode {
  /** Standard mode - follows policy rules */
  DEFAULT = 'DEFAULT',
  /** Auto-approve file edits */
  AUTO_EDIT = 'AUTO_EDIT',
  /** Auto-approve everything (dangerous) */
  YOLO = 'YOLO',
  /** Planning mode - no executions allowed */
  PLAN = 'PLAN',
}

export interface PolicyRule {
  /** Tool name to match (supports wildcards like "shell*") */
  toolName?: string;
  /** Regex pattern to match against stringified args */
  argsPattern?: RegExp;
  /** The decision for this rule */
  decision: PolicyDecision;
  /** Higher priority rules are checked first (default: 0) */
  priority?: number;
  /** Description of why this rule exists */
  description?: string;
  /** Only apply in these approval modes */
  modes?: ApprovalMode[];
  /** Source of this rule for debugging */
  source?: string;
}

export interface CheckResult {
  decision: PolicyDecision;
  rule?: PolicyRule;
  reason?: string;
}

export interface PolicyEngineConfig {
  rules?: PolicyRule[];
  defaultDecision?: PolicyDecision;
  approvalMode?: ApprovalMode;
}

/**
 * Check if a tool name matches a pattern
 */
function matchToolName(pattern: string, toolName: string): boolean {
  if (pattern === toolName) return true;
  
  // Handle wildcard patterns like "shell*"
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return toolName.startsWith(prefix);
  }
  
  return false;
}

/**
 * Stable JSON stringify with sorted keys for consistent matching
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);
  
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`;
  }
  
  const entries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `"${k}":${stableStringify(v)}`).join(',')}}`;
}

export class PolicyEngine {
  private rules: PolicyRule[];
  private defaultDecision: PolicyDecision;
  private approvalMode: ApprovalMode;

  constructor(config: PolicyEngineConfig = {}) {
    this.rules = (config.rules ?? []).sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );
    this.defaultDecision = config.defaultDecision ?? PolicyDecision.ASK_USER;
    this.approvalMode = config.approvalMode ?? ApprovalMode.DEFAULT;
  }

  setApprovalMode(mode: ApprovalMode): void {
    this.approvalMode = mode;
  }

  getApprovalMode(): ApprovalMode {
    return this.approvalMode;
  }

  /**
   * Check if a tool call is allowed
   */
  check(toolName: string, args?: Record<string, unknown>): CheckResult {
    // In PLAN mode, everything is denied
    if (this.approvalMode === ApprovalMode.PLAN) {
      return {
        decision: PolicyDecision.DENY,
        reason: 'Planning mode - no executions allowed',
      };
    }

    const stringifiedArgs = args ? stableStringify(args) : undefined;

    // Find matching rule
    for (const rule of this.rules) {
      // Check approval mode constraints
      if (rule.modes && rule.modes.length > 0) {
        if (!rule.modes.includes(this.approvalMode)) {
          continue;
        }
      }

      // Check tool name
      if (rule.toolName && !matchToolName(rule.toolName, toolName)) {
        continue;
      }

      // Check args pattern
      if (rule.argsPattern) {
        if (!args || !stringifiedArgs) continue;
        if (!rule.argsPattern.test(stringifiedArgs)) continue;
      }

      // Rule matched - apply approval mode overrides
      let decision = rule.decision;
      
      // In YOLO mode, allow everything except explicit DENY
      if (this.approvalMode === ApprovalMode.YOLO && decision === PolicyDecision.ASK_USER) {
        decision = PolicyDecision.ALLOW;
      }
      
      // In AUTO_EDIT mode, allow file edits
      if (this.approvalMode === ApprovalMode.AUTO_EDIT) {
        if (this.isFileEditTool(toolName) && decision === PolicyDecision.ASK_USER) {
          decision = PolicyDecision.ALLOW;
        }
      }

      return { decision, rule };
    }

    // No rule matched - use default with mode overrides
    let decision = this.defaultDecision;
    
    if (this.approvalMode === ApprovalMode.YOLO && decision === PolicyDecision.ASK_USER) {
      decision = PolicyDecision.ALLOW;
    }
    
    if (this.approvalMode === ApprovalMode.AUTO_EDIT) {
      if (this.isFileEditTool(toolName) && decision === PolicyDecision.ASK_USER) {
        decision = PolicyDecision.ALLOW;
      }
    }

    return {
      decision,
      reason: 'No matching rule found',
    };
  }

  /**
   * Check if a tool is a file editing tool
   */
  private isFileEditTool(toolName: string): boolean {
    return ['write', 'edit'].includes(toolName);
  }

  /**
   * Add a rule to the engine
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Remove rules for a specific tool
   */
  removeRulesForTool(toolName: string, source?: string): void {
    this.rules = this.rules.filter(
      (rule) =>
        rule.toolName !== toolName ||
        (source !== undefined && rule.source !== source)
    );
  }

  /**
   * Get all rules
   */
  getRules(): readonly PolicyRule[] {
    return this.rules;
  }

  /**
   * Check if a rule exists for a tool
   */
  hasRuleForTool(toolName: string): boolean {
    return this.rules.some((rule) => rule.toolName === toolName);
  }
}
