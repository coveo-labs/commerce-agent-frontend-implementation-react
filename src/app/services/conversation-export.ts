// =============================================================================
// Conversation export — versioned JSON envelope, redacted / diagnostic
// =============================================================================
//
// Builds `ConversationExportV1` from the history store's IN-MEMORY records
// (never re-parsed from localStorage, which can be stale after quota
// failures). Each conversation's turns are unified from `completedTurns`
// plus the live remainder still in `messages`, deduplicated by user-message
// id — never by array position.
//
// Profiles:
//   • redacted   — transcript, feedback, telemetry, ids, structured errors;
//                  excludes client id, reasoning, tool args/results, state
//                  snapshots, and complete surface payloads.
//   • diagnostic — adds client id, reasoning text, tool argument/result
//                  previews, the latest persisted state snapshot, and the
//                  complete persisted surface payloads.
//
// Both profiles unconditionally exclude bearer tokens, conversation
// continuation tokens, and auth-store contents.
// =============================================================================

import type {
  AnswerFeedback,
  ConversationTurn,
  SessionFeedback,
  StoredConversation,
  TurnTelemetry,
} from '../conversation.interfaces';
import type { RenderableCommerceSurface } from '../models';

export const EXPORT_SCHEMA = 'commerce-agent-conversation-export';
export const EXPORT_SCHEMA_VERSION = 1;

const APP_NAME = 'commerce-agent-frontend-implementation-react';
const APP_VERSION = '0.0.0';

const PRIVACY_NOTICE =
  'This file contains conversation transcripts, user feedback, and client-side ' +
  'telemetry captured locally in the browser for quality review and bug reports. ' +
  'Prompts and answers may contain personal information — handle accordingly. ' +
  'It never contains bearer tokens or conversation continuation tokens: known ' +
  'token values, token-shaped strings, and values under token-like keys are ' +
  'redacted from all exported content.';

export type ExportProfile = 'redacted' | 'diagnostic';

export type ExportedSurface = {
  type: string;
  surfaceId: string;
  /** Recursively collected `ec_product_id` values, deduplicated. */
  productIds: string[];
  /** Complete persisted surface payload — diagnostic profile only. */
  payload?: RenderableCommerceSurface;
};

export type ExportedToolActivity = {
  id: string;
  name: string;
  status: 'running' | 'completed';
  /** Diagnostic profile only. */
  argsPreview?: string;
  /** Diagnostic profile only. */
  resultPreview?: string;
};

export type ExportedTelemetry = Omit<TurnTelemetry, 'connection'> & {
  connection: Omit<TurnTelemetry['connection'], 'clientId'> & { clientId?: string };
};

export type ExportedTurn = {
  turnId: string;
  userText: string;
  assistantText: string;
  /** True when the turn came from the live remainder (not yet archived). */
  live?: boolean;
  feedback?: AnswerFeedback;
  telemetry?: ExportedTelemetry;
  toolActivity: ExportedToolActivity[];
  surfaces: ExportedSurface[];
  /** Diagnostic profile only. */
  reasoningText?: string;
};

export type ExportedConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  agentMode: StoredConversation['agentMode'];
  threadId: string;
  conversationId: string | null;
  sessionFeedback: SessionFeedback | null;
  turns: ExportedTurn[];
  /** Diagnostic profile only. */
  latestSnapshot?: Record<string, unknown> | null;
};

export type ConversationExportV1 = {
  schema: typeof EXPORT_SCHEMA;
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  profile: ExportProfile;
  app: { name: string; version: string };
  exportedAt: string;
  notice: string;
  conversations: ExportedConversation[];
};

export type ExportOptions = {
  now?: Date;
  /**
   * Secret values known to the caller (e.g. the auth-store bearer token)
   * whose exact occurrences must be scrubbed from every exported string.
   * Each record's own conversationToken is always included automatically.
   */
  knownSecrets?: string[];
};

export function buildConversationExport(
  records: StoredConversation[],
  profile: ExportProfile,
  options: ExportOptions = {},
): ConversationExportV1 {
  const now = options.now ?? new Date();
  const secrets = collectKnownSecrets(records, options.knownSecrets ?? []);

  const envelope: ConversationExportV1 = {
    schema: EXPORT_SCHEMA,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    profile,
    app: { name: APP_NAME, version: APP_VERSION },
    exportedAt: now.toISOString(),
    notice: PRIVACY_NOTICE,
    conversations: records.map((record) => exportConversation(record, profile)),
  };

  // Nested payloads (state snapshots, tool previews, reasoning, surface
  // payloads, error messages — and even prompts/answers) can embed token
  // values the field-level whitelists never see. Sanitize the WHOLE
  // envelope, in both profiles, so the privacy notice holds
  // unconditionally.
  return sanitizeValue(envelope, secrets) as ConversationExportV1;
}

export function buildExportFilename(profile: ExportProfile, now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `commerce-agent-sessions-${stamp}-${profile}.json`;
}

/**
 * Unified turn list: archived turns plus the live remainder still in
 * `messages`. A remainder with no user message (malformed record) is
 * skipped; a remainder whose user-message id already exists in
 * `completedTurns` is a duplicate of the transient snapshot-then-start
 * window and is dropped.
 */
export function unifyTurns(
  record: StoredConversation,
): Array<ConversationTurn & { live?: boolean }> {
  const turns: Array<ConversationTurn & { live?: boolean }> = [...record.completedTurns];

  const userMessage = record.messages.find((message) => message.role === 'user');
  if (!userMessage) {
    return turns;
  }
  if (turns.some((turn) => turn.id === userMessage.id)) {
    return turns;
  }

  const assistantMessage = [...record.messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  turns.push({
    id: userMessage.id,
    userText: userMessage.text,
    assistantText: assistantMessage?.text ?? '',
    surfaces: record.surfaces,
    reasoningText: record.reasoningText,
    toolActivity: record.toolActivity,
    live: true,
  });
  return turns;
}

/** Turn count shown in the export dialog (dedupe-aware, like the export). */
export function countTurns(record: StoredConversation): number {
  return unifyTurns(record).length;
}

function exportConversation(
  record: StoredConversation,
  profile: ExportProfile,
): ExportedConversation {
  const diagnostic = profile === 'diagnostic';

  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    agentMode: record.agentMode,
    threadId: record.threadId,
    conversationId: record.conversationId,
    sessionFeedback: record.sessionFeedback,
    turns: unifyTurns(record).map((turn) => exportTurn(record, turn, diagnostic)),
    ...(diagnostic ? { latestSnapshot: record.latestSnapshot } : {}),
  };
}

function exportTurn(
  record: StoredConversation,
  turn: ConversationTurn & { live?: boolean },
  diagnostic: boolean,
): ExportedTurn {
  const feedback = record.answerFeedbackByTurnId[turn.id];
  const telemetry = record.turnTelemetryByTurnId[turn.id];

  return {
    turnId: turn.id,
    userText: turn.userText,
    assistantText: turn.assistantText,
    ...(turn.live ? { live: true } : {}),
    ...(feedback ? { feedback } : {}),
    ...(telemetry ? { telemetry: exportTelemetry(telemetry, diagnostic) } : {}),
    toolActivity: turn.toolActivity.map((tool) => ({
      id: tool.id,
      name: tool.name,
      status: tool.status,
      ...(diagnostic ? { argsPreview: tool.argsPreview, resultPreview: tool.resultPreview } : {}),
    })),
    surfaces: turn.surfaces.map((surface) => ({
      type: surface.componentType,
      surfaceId: surface.surfaceId,
      productIds: collectProductIds(surface),
      ...(diagnostic ? { payload: surface } : {}),
    })),
    ...(diagnostic ? { reasoningText: turn.reasoningText } : {}),
  };
}

function exportTelemetry(telemetry: TurnTelemetry, diagnostic: boolean): ExportedTelemetry {
  const { clientId, ...connection } = telemetry.connection;
  return {
    ...telemetry,
    connection: {
      ...connection,
      // Client id is retained locally and exposed only in diagnostic exports.
      ...(diagnostic && clientId ? { clientId } : {}),
    },
  };
}

// -----------------------------------------------------------------------------
// Secret redaction
// -----------------------------------------------------------------------------

const REDACTED = '[redacted]';

/** Keys whose values are redacted wholesale wherever they appear. */
const SENSITIVE_KEY_PATTERN = /token|authorization|bearer|api[-_]?key|secret|credential|password/i;

/** `Bearer <value>` fragments embedded inside any exported string. */
const BEARER_VALUE_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/=]{8,}/gi;

/** JWT-shaped strings (`eyJ…` header.payload.signature). */
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;

function collectKnownSecrets(records: StoredConversation[], extra: string[]): string[] {
  const secrets = new Set<string>();
  for (const record of records) {
    if (record.conversationToken) {
      secrets.add(record.conversationToken);
    }
  }
  for (const value of extra) {
    if (value) {
      secrets.add(value);
    }
  }
  // Ignore very short "secrets": exact-replacing tiny strings would mangle
  // legitimate content, and real tokens are never this short.
  return [...secrets].filter((secret) => secret.length >= 8);
}

function sanitizeValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, secrets));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && (typeof entry === 'string' || typeof entry === 'number')) {
        result[key] = REDACTED;
      } else {
        result[key] = sanitizeValue(entry, secrets);
      }
    }
    return result;
  }
  return value;
}

function sanitizeString(value: string, secrets: string[]): string {
  let result = value;
  for (const secret of secrets) {
    result = result.split(secret).join(REDACTED);
  }
  return result.replace(BEARER_VALUE_PATTERN, REDACTED).replace(JWT_PATTERN, REDACTED);
}

/** Recursively collect every `ec_product_id` string in a surface payload. */
export function collectProductIds(value: unknown): string[] {
  const ids = new Set<string>();
  visitProductIds(value, ids);
  return [...ids];
}

function visitProductIds(value: unknown, ids: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitProductIds(item, ids);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'ec_product_id' && typeof entry === 'string' && entry) {
      ids.add(entry);
      continue;
    }
    visitProductIds(entry, ids);
  }
}
