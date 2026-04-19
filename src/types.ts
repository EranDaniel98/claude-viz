// Matches Claude Code hook payload shapes we care about in MVP.
// We normalize all events into a single internal form.

export type HookEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop";

export interface RawHookEvent {
  hook_event_name: HookEventName;
  session_id: string;
  cwd: string;
  parent_session_id?: string;
  transcript_path?: string;
  // Tool events
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  tool_response?: { is_error?: boolean; content?: unknown };
  // Prompt
  prompt?: string;
  // Subagent
  agent_id?: string;
  agent_type?: string;
  last_assistant_message?: string;
  // Session
  model?: string;
  source?: string;
}

export interface NormalizedEvent {
  seq: number;               // monotonic sequence from hook script
  ts: number;                // ms epoch when hook fired
  sessionId: string;
  cwd: string;
  parentSessionId?: string;
  kind: HookEventName;
  // common optional fields, redacted where applicable
  toolName?: string;
  toolUseId?: string;
  toolInput?: unknown;
  toolResponse?: { isError?: boolean; content?: unknown };
  prompt?: string;
  agentId?: string;
  agentType?: string;
  agentModel?: string;
  lastAssistantMessage?: string;
  redactions: number;        // count of redactions in this event
}

export interface SessionScope {
  edited: Record<string, { added: number; removed: number; reviewed: boolean }>;
  created: string[];
  deleted: string[];
  read: string[];
}

export interface SubagentNode {
  agentId: string;
  agentType: string;
  parentSessionId?: string;
  startedAt: number;
  endedAt?: number;
  lastMessage?: string;
  model?: string;
  currentTool?: string;
  toolCallCount: number;
}

export interface SessionSnapshot {
  sessionId: string;
  cwd: string;
  model?: string;
  startedAt: number;
  lastEventAt: number;
  toolCalls: number;
  redactions: number;
  scope: SessionScope;
  subagents: SubagentNode[];
  recentEvents: NormalizedEvent[]; // last N for feed
  context?: {
    tokens: number;
    limit: number;
    updatedAt: number;
    burn?: { currentNew: number; median: number; ratio: number };
  };
}
