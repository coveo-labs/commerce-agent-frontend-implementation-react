// =============================================================================
// Conversation history — local (localStorage) chat-history logic
// =============================================================================
//
// Owns the localStorage-backed list of past conversations and which one is
// active. The single active conversation's live state lives in
// `conversationStore`; this store snapshots it into the saved list and
// hydrates the conversation store when the shopper switches conversations.
//
// The logic is intentionally framework-light — the pieces that matter when
// re-creating it elsewhere:
//
//   1. STORAGE SHAPE — persist an ARRAY of conversations, not just one.
//      Each record = the full conversation state you already persist
//      (messages / turns / tokens / feedback / telemetry) PLUS three
//      history fields:
//        • id        — stable local id, independent of any server session id
//        • title     — derived from the first user message (see deriveTitle)
//        • createdAt / updatedAt — ISO timestamps, used for sort + display
//      See the `StoredConversation` type in conversation.interfaces.ts.
//
//   2. STORAGE KEY — a single key holding the JSON array:
//        • New:    `discovery-demo-conversations`
//        • Legacy: `discovery-demo-conversation` (the pre-history,
//          single-conversation key) is migrated on first load and then
//          removed — see `migrateLegacy()`.
//      Newest first, capped at `historyCopy.maxConversations` (default 50).
//
//   3. LOAD + MIGRATE on startup (`load()` / `migrateLegacy()`), then
//      hydrate the live conversation state from the most recent record.
//      Unversioned records get `schemaVersion: 1` plus empty feedback /
//      telemetry defaults, and any telemetry entry persisted as `running`
//      is normalized to `interrupted` (the run cannot still be alive).
//
//   4. CAPTURE on every change — whenever the active conversation's state
//      changes, upsert it into the array (creating a record lazily on the
//      first user message) and re-save. Here that's the subscription on
//      `conversationStore` → `captureActive()`.
//
//   5. PUBLIC ACTIONS for the history UI: `startNew()`, `select(id)`,
//      `delete(id)`. Every path that leaves the active conversation first
//      cancels the active stream (`cancelActiveRun()`), lets the resulting
//      cancelled state be captured under the OUTGOING conversation's id,
//      and only then arms the single-shot skip-capture guard and resets /
//      hydrates — so an in-flight stream can never contaminate the target
//      conversation. This sequence relies on `resetConversation()` and
//      `hydrate()` each emitting exactly ONE store notification.
//
//   6. STORAGE HEALTH — persistence failures are never swallowed silently:
//      `storageHealth` distinguishes quota errors from generic write
//      failures, and the latest in-memory state stays exportable even when
//      writes fail. Multi-tab remains last-writer-wins (accepted tradeoff).
// =============================================================================

import { historyCopy } from '../discovery-config';
import {
  CONVERSATION_SCHEMA_VERSION,
  SESSION_OUTCOMES,
  type AnswerFeedback,
  type ConversationSummary,
  type PersistedConversation,
  type SessionFeedback,
  type StorageHealth,
  type StoredConversation,
  type ToolActivity,
  type TurnTelemetry,
} from '../conversation.interfaces';
import type { RenderableCommerceSurface } from '../models';
import { Store } from '../store';
import { conversationStore, type ConversationStore } from './conversation-store';

const STORAGE_KEY = 'discovery-demo-conversations';
const LEGACY_KEY = 'discovery-demo-conversation';

/** Minimal storage boundary so tests can inject an in-memory fake. */
export type StorageAdapter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Returns null when localStorage is unusable (privacy mode, SSR, …). */
export function createLocalStorageAdapter(): StorageAdapter | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    const storage = window.localStorage;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key),
    };
  } catch {
    return null;
  }
}

export type ConversationHistoryState = {
  conversations: StoredConversation[];
  /** Local id of the conversation currently loaded into the live store. */
  activeId: string | null;
  /** Sorted, lightweight rows for the history dropdown (newest first). */
  summaries: ConversationSummary[];
  /** Health of the persistence pipeline; drives the non-blocking warning. */
  storageHealth: StorageHealth;
};

export class ConversationHistoryStore extends Store<ConversationHistoryState> {
  private readonly conversationStore: ConversationStore;
  private readonly storage: StorageAdapter | null;
  private readonly unsubscribeFromConversation: () => void;
  /** Set true to make the next capture run a no-op (after a programmatic hydrate). */
  private skipNextCapture = false;
  private lastCaptured: PersistedConversation | null = null;

  constructor(
    conversation: ConversationStore,
    storage: StorageAdapter | null = createLocalStorageAdapter(),
  ) {
    super({
      conversations: [],
      activeId: null,
      summaries: [],
      storageHealth: storage ? 'ready' : 'unavailable',
    });
    this.conversationStore = conversation;
    this.storage = storage;

    const loaded = this.load();
    this.setConversations(loaded, null);

    if (loaded.length > 0) {
      const mostRecent = sortByRecency(loaded)[0];
      this.setState((state) => ({ ...state, activeId: mostRecent.id }));
      // The capture subscription is not registered yet, so hydration emits
      // no capture — do NOT arm the skip guard here (nothing would consume
      // it, and it would eat the first real mutation, e.g. a feedback
      // click on the restored conversation). Priming lastCaptured from the
      // POST-hydrate snapshot lets the equality gate absorb the hydration
      // instead.
      this.conversationStore.hydrate(mostRecent);
      this.lastCaptured = this.conversationStore.persistenceSnapshot();
    }

    // Snapshot the active conversation into the saved list whenever the
    // conversation store's persisted state changes (the React equivalent of
    // the Angular effect). Draft edits and other non-persisted fields are
    // skipped via a shallow compare of the snapshot's fields.
    this.unsubscribeFromConversation = this.conversationStore.subscribe(() => {
      const snapshot = this.conversationStore.persistenceSnapshot();
      if (this.lastCaptured && shallowEqualSnapshot(snapshot, this.lastCaptured)) {
        return;
      }
      this.lastCaptured = snapshot;
      this.captureActive(snapshot);
    });
  }

  /** Unsubscribe the injected conversation-store listener (tests). */
  dispose(): void {
    this.unsubscribeFromConversation();
  }

  count(): number {
    return this.getState().conversations.length;
  }

  /**
   * Snapshot the current conversation (already saved) and start a blank one.
   * Cancels any active stream FIRST so its cancelled telemetry is captured
   * under the outgoing conversation's id — see the header comment.
   */
  startNew(): void {
    this.conversationStore.cancelActiveRun();
    this.skipNextCapture = true;
    this.conversationStore.resetConversation();
    this.setState((state) => ({ ...state, activeId: null }));
  }

  /** Load a saved conversation into the live conversation store. */
  select(id: string): void {
    if (id === this.getState().activeId) {
      return;
    }
    const record = this.getState().conversations.find((conversation) => conversation.id === id);
    if (!record) {
      return;
    }
    // Cancel before switching: the cancelled partial state is captured under
    // the OUTGOING activeId, then the guard suppresses the hydrate capture.
    this.conversationStore.cancelActiveRun();
    this.setState((state) => ({ ...state, activeId: id }));
    this.skipNextCapture = true;
    this.conversationStore.hydrate(record);
  }

  /** Remove a saved conversation; if it was active, fall back to the next one. */
  delete(id: string): void {
    const wasActive = id === this.getState().activeId;
    if (wasActive) {
      // The cancel capture may upsert the record one last time; reading the
      // list AFTER cancelling ensures the filter below still removes it.
      this.conversationStore.cancelActiveRun();
    }

    const remaining = this.getState().conversations.filter(
      (conversation) => conversation.id !== id,
    );
    this.setConversations(remaining, this.getState().activeId);
    this.persist();

    if (!wasActive) {
      return;
    }

    const next = sortByRecency(remaining)[0];
    if (next) {
      this.setState((state) => ({ ...state, activeId: next.id }));
      this.skipNextCapture = true;
      this.conversationStore.hydrate(next);
    } else {
      this.startNew();
    }
  }

  private captureActive(snapshot: PersistedConversation): void {
    if (this.skipNextCapture) {
      this.skipNextCapture = false;
      return;
    }

    if (!hasContent(snapshot)) {
      return;
    }

    const id = this.getState().activeId ?? createId();

    const now = new Date().toISOString();
    const list = this.getState().conversations;
    const existing = list.find((conversation) => conversation.id === id);
    const record: StoredConversation = {
      ...snapshot,
      id,
      title: deriveTitle(snapshot),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const others = list.filter((conversation) => conversation.id !== id);
    const next = sortByRecency([record, ...others]).slice(0, historyCopy.maxConversations);
    this.setConversations(next, id);

    this.persist();
  }

  private setConversations(conversations: StoredConversation[], activeId: string | null): void {
    this.setState((state) => ({
      ...state,
      conversations,
      activeId,
      summaries: sortByRecency(conversations).map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        messageCount:
          conversation.completedTurns.length + (conversation.messages.length ? 1 : 0),
      })),
    }));
  }

  private persist(): void {
    if (!this.storage) {
      this.setStorageHealth('unavailable');
      return;
    }
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.getState().conversations));
      this.setStorageHealth('ready');
    } catch (error) {
      this.setStorageHealth(classifyStorageError(error));
    }
  }

  private setStorageHealth(health: StorageHealth): void {
    if (this.getState().storageHealth !== health) {
      this.setState((state) => ({ ...state, storageHealth: health }));
    }
  }

  private load(): StoredConversation[] {
    if (!this.storage) {
      return [];
    }

    let raw: string | null = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      this.setStorageHealth('unavailable');
      return [];
    }

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
          ? parsed
              .map(normalizeStored)
              .filter((conversation): conversation is StoredConversation => conversation !== null)
          : [];
      } catch {
        return [];
      }
    }

    return this.migrateLegacy();
  }

  private migrateLegacy(): StoredConversation[] {
    if (!this.storage) {
      return [];
    }
    try {
      const raw = this.storage.getItem(LEGACY_KEY);
      if (!raw) {
        return [];
      }
      const persisted = normalizePersisted(JSON.parse(raw) as Partial<PersistedConversation>);
      if (!hasContent(persisted)) {
        this.storage.removeItem(LEGACY_KEY);
        return [];
      }
      const now = new Date().toISOString();
      const migrated: StoredConversation = {
        ...persisted,
        id: createId(),
        title: deriveTitle(persisted),
        createdAt: now,
        updatedAt: now,
      };
      this.storage.setItem(STORAGE_KEY, JSON.stringify([migrated]));
      this.storage.removeItem(LEGACY_KEY);
      return [migrated];
    } catch {
      return [];
    }
  }
}

function classifyStorageError(error: unknown): StorageHealth {
  if (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22)
  ) {
    return 'quota_exceeded';
  }
  return 'write_failed';
}

function shallowEqualSnapshot(a: PersistedConversation, b: PersistedConversation): boolean {
  return (
    a.agentMode === b.agentMode &&
    a.threadId === b.threadId &&
    a.conversationId === b.conversationId &&
    a.conversationToken === b.conversationToken &&
    a.messages === b.messages &&
    a.surfaces === b.surfaces &&
    a.latestSnapshot === b.latestSnapshot &&
    a.reasoningText === b.reasoningText &&
    a.toolActivity === b.toolActivity &&
    a.completedTurns === b.completedTurns &&
    a.answerFeedbackByTurnId === b.answerFeedbackByTurnId &&
    a.sessionFeedback === b.sessionFeedback &&
    a.turnTelemetryByTurnId === b.turnTelemetryByTurnId
  );
}

function sortByRecency(list: StoredConversation[]): StoredConversation[] {
  return [...list].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function hasContent(snapshot: PersistedConversation): boolean {
  return snapshot.messages.length > 0 || snapshot.completedTurns.length > 0;
}

function deriveTitle(snapshot: PersistedConversation): string {
  const firstTurn = snapshot.completedTurns[0]?.userText;
  const firstUserMessage = snapshot.messages.find((message) => message.role === 'user')?.text;
  const text = (firstTurn ?? firstUserMessage ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return historyCopy.untitledLabel;
  }
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function normalizePersisted(parsed: Partial<PersistedConversation>): PersistedConversation {
  return {
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    // The demo persists the agent mode (mock / live) per conversation.
    agentMode: parsed.agentMode === 'live' ? 'live' : 'mock',
    threadId:
      typeof parsed.threadId === 'string' && parsed.threadId ? parsed.threadId : createId(),
    conversationId:
      typeof parsed.conversationId === 'string' && parsed.conversationId
        ? parsed.conversationId
        : null,
    conversationToken:
      typeof parsed.conversationToken === 'string' && parsed.conversationToken
        ? parsed.conversationToken
        : null,
    messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    surfaces: Array.isArray(parsed.surfaces)
      ? (parsed.surfaces as RenderableCommerceSurface[])
      : [],
    latestSnapshot:
      parsed.latestSnapshot && typeof parsed.latestSnapshot === 'object'
        ? (parsed.latestSnapshot as Record<string, unknown>)
        : null,
    reasoningText: typeof parsed.reasoningText === 'string' ? parsed.reasoningText : '',
    toolActivity: Array.isArray(parsed.toolActivity)
      ? (parsed.toolActivity as ToolActivity[])
      : [],
    completedTurns: Array.isArray(parsed.completedTurns) ? parsed.completedTurns : [],
    answerFeedbackByTurnId: normalizeAnswerFeedbackMap(parsed.answerFeedbackByTurnId),
    sessionFeedback: normalizeSessionFeedback(parsed.sessionFeedback),
    turnTelemetryByTurnId: normalizeTelemetryMap(parsed.turnTelemetryByTurnId),
  };
}

function normalizeAnswerFeedbackMap(value: unknown): Record<string, AnswerFeedback> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, AnswerFeedback> = {};
  for (const [turnId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const feedback = entry as Partial<AnswerFeedback>;
    if (feedback.rating !== 'positive' && feedback.rating !== 'negative') {
      continue;
    }
    result[turnId] = {
      ...(feedback as AnswerFeedback),
      reasons: Array.isArray(feedback.reasons) ? feedback.reasons : [],
    } as AnswerFeedback;
  }
  return result;
}

function normalizeSessionFeedback(value: unknown): SessionFeedback | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const feedback = value as Partial<SessionFeedback>;
  if (!feedback.outcome || !SESSION_OUTCOMES.includes(feedback.outcome)) {
    return null;
  }
  return feedback as SessionFeedback;
}

function normalizeTelemetryMap(value: unknown): Record<string, TurnTelemetry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, TurnTelemetry> = {};
  for (const [turnId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const telemetry = entry as TurnTelemetry;
    // A persisted `running` entry means the tab closed (or crashed) mid-run:
    // the run cannot still be alive, so restore it as `interrupted`.
    result[turnId] =
      telemetry.outcome === 'running' ? { ...telemetry, outcome: 'interrupted' } : telemetry;
  }
  return result;
}

function normalizeStored(value: unknown): StoredConversation | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Partial<StoredConversation>;
  const persisted = normalizePersisted(raw);
  const now = new Date().toISOString();
  return {
    ...persisted,
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    title: typeof raw.title === 'string' && raw.title ? raw.title : deriveTitle(persisted),
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now,
  };
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'conv-' + Math.random().toString(36).slice(2, 14);
}

/** Singleton instance — instantiating it hydrates the conversation store
 * from localStorage and wires per-turn persistence of the saved list. */
export const conversationHistoryStore = new ConversationHistoryStore(conversationStore);
