import type { createEmptySurfaceState } from './a2ui-parser';
import type { DemoAgentMode } from './demo-agent.config';
import type { ChatMessage, RenderableCommerceSurface } from './models';

export type SurfaceState = ReturnType<typeof createEmptySurfaceState>;

export type ToolActivity = {
  id: string;
  name: string;
  status: 'running' | 'completed';
  argsPreview: string;
  resultPreview: string;
};

export type ConversationTurn = {
  id: string;
  userText: string;
  assistantText: string;
  surfaces: RenderableCommerceSurface[];
  reasoningText: string;
  toolActivity: ToolActivity[];
};

// =============================================================================
// Answer / session feedback (client-side stopgap for a future Coveo feedback
// endpoint — see docs/feedback-observability-plan.md)
// =============================================================================

export const POSITIVE_ANSWER_REASONS = [
  'correct',
  'relevant',
  'complete',
  'clear',
  'good_product_match',
] as const;

export const NEGATIVE_ANSWER_REASONS = [
  'incorrect',
  'irrelevant',
  'incomplete',
  'unclear',
  'poor_product_match',
  'technical_issue',
  'other',
] as const;

export type PositiveAnswerReason = (typeof POSITIVE_ANSWER_REASONS)[number];
export type NegativeAnswerReason = (typeof NEGATIVE_ANSWER_REASONS)[number];

export const FEEDBACK_COMMENT_MAX_LENGTH = 2000;

/**
 * One editable feedback record per answered turn, keyed by the turn's
 * user-message id. The discriminated union makes an invalid rating/reason
 * combination unrepresentable; `LocalFeedbackSink` re-enforces the same
 * contract at runtime for untyped (migrated) data.
 */
export type AnswerFeedback = {
  feedbackId: string;
  comment?: string;
  createdAt: string;
  updatedAt: string;
} & (
  | { rating: 'positive'; reasons: PositiveAnswerReason[] }
  | { rating: 'negative'; reasons: NegativeAnswerReason[] }
);

export type AnswerFeedbackRating = AnswerFeedback['rating'];

export type SessionOutcome = 'resolved' | 'partially_resolved' | 'not_resolved';

export const SESSION_OUTCOMES: readonly SessionOutcome[] = [
  'resolved',
  'partially_resolved',
  'not_resolved',
];

/** One editable whole-conversation assessment. */
export type SessionFeedback = {
  feedbackId: string;
  outcome: SessionOutcome;
  comment?: string;
  createdAt: string;
  updatedAt: string;
};

// =============================================================================
// Turn telemetry
// =============================================================================

export type TurnOutcome = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export type TurnTelemetryError = {
  code?: string;
  message: string;
};

export type TurnToolSummary = {
  name: string;
  status: 'running' | 'completed';
};

export type TurnSurfaceSummary = {
  type: string;
  surfaceId: string;
};

/**
 * Connection context captured at submission time from the same effective
 * values the request uses. `clientId` is retained locally and surfaces only
 * in diagnostic exports.
 */
export type TurnConnectionContext = {
  agentMode: DemoAgentMode;
  transport?: string;
  orgId?: string;
  region?: string;
  trackingId?: string;
  language?: string;
  country?: string;
  currency?: string;
  clientId?: string;
};

/**
 * Compact operational record for one prompt attempt, keyed by the turn's
 * user-message id. Server identifiers (`runId`, `assistantMessageId`,
 * `conversationSessionId`) are optional correlation data only — they are
 * NOT presumed keys of any future Coveo feedback contract.
 */
export type TurnTelemetry = {
  attemptId: string;
  turnId: string;
  runId?: string;
  assistantMessageId?: string;
  threadId: string;
  conversationSessionId?: string;
  startedAt: string;
  firstResponseAt?: string;
  finishedAt?: string;
  firstResponseMs?: number;
  totalMs?: number;
  outcome: TurnOutcome;
  error?: TurnTelemetryError;
  toolNames?: TurnToolSummary[];
  surfaces?: TurnSurfaceSummary[];
  connection: TurnConnectionContext;
};

// =============================================================================
// Persisted conversation
// =============================================================================

export const CONVERSATION_SCHEMA_VERSION = 1;

export type PersistedConversation = {
  schemaVersion: typeof CONVERSATION_SCHEMA_VERSION;
  agentMode: DemoAgentMode;
  threadId: string;
  /** Conversation id echoed back by the agent response (null until it replies). */
  conversationId: string | null;
  conversationToken: string | null;
  messages: ChatMessage[];
  surfaces: RenderableCommerceSurface[];
  latestSnapshot: Record<string, unknown> | null;
  reasoningText: string;
  toolActivity: ToolActivity[];
  completedTurns: ConversationTurn[];
  /** Answer feedback keyed by turn id (= the turn's user-message id). */
  answerFeedbackByTurnId: Record<string, AnswerFeedback>;
  /** Whole-conversation assessment, null until the shopper rates it. */
  sessionFeedback: SessionFeedback | null;
  /** Operational telemetry keyed by turn id (= the turn's user-message id). */
  turnTelemetryByTurnId: Record<string, TurnTelemetry>;
};

/**
 * One saved conversation in the localStorage history. Carries the full
 * persisted conversation state plus a stable local id, a derived title,
 * and timestamps used for sorting / display in the history dropdown.
 */
export type StoredConversation = PersistedConversation & {
  /** Stable local id, independent of the server-issued threadId. */
  id: string;
  /** Title derived from the first user message (or a fallback). */
  title: string;
  /** ISO timestamp when the conversation was first created. */
  createdAt: string;
  /** ISO timestamp of the most recent activity. */
  updatedAt: string;
};

/** Lightweight projection used to render the history dropdown rows. */
export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

/** Health of the localStorage persistence pipeline (never silently degraded). */
export type StorageHealth = 'ready' | 'unavailable' | 'quota_exceeded' | 'write_failed';

export type ConversationViewModel = {
  draft: string;
  busy: boolean;
  status: string;
  agentMode: DemoAgentMode;
  modeLabel: string;
  threadId: string;
  conversationId: string | null;
  historyCount: number;
  messages: ChatMessage[];
  reasoningText: string;
  toolActivity: ToolActivity[];
  surfaces: RenderableCommerceSurface[];
  latestSnapshot: Record<string, unknown> | null;
  completedTurns: ConversationTurn[];
};
