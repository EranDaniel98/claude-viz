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

export interface SessionScope {
  edited: Record<string, { added: number; removed: number; reviewed: boolean }>;
  created: string[];
  deleted: string[];
  read: string[];
}

export interface NormalizedEvent {
  seq: number;
  ts: number;
  sessionId: string;
  cwd: string;
  kind: string;
  toolName?: string;
  toolResponse?: { isError?: boolean };
  agentId?: string;
  agentType?: string;
  redactions: number;
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
  recentEvents: NormalizedEvent[];
}
