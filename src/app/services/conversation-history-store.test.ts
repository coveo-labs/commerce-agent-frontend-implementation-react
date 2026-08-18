import { describe, expect, it } from 'vitest';
import { createStoreHarness } from '../../test/harness';
import type { StreamObserver } from './agent-demo.service';
import {
  ConversationHistoryStore,
  type StorageAdapter,
} from './conversation-history-store';

const STORAGE_KEY = 'discovery-demo-conversations';
const LEGACY_KEY = 'discovery-demo-conversation';

function createFakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  let failWith: unknown = null;
  const adapter: StorageAdapter = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (failWith) {
        throw failWith;
      }
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return {
    adapter,
    map,
    stored: () => JSON.parse(map.get(STORAGE_KEY) ?? '[]') as Array<Record<string, unknown>>,
    failWrites: (error: unknown) => {
      failWith = error;
    },
    heal: () => {
      failWith = null;
    },
  };
}

/** Drive one full mock turn through the injected manual stream. */
function runTurn(
  harness: ReturnType<typeof createStoreHarness>,
  prompt: string,
): { turnId: string; observer: StreamObserver } {
  harness.store.submitPrompt(prompt);
  const observer = harness.latest();
  const turnId = harness.store.getState().messages[0].id;
  observer.next({ type: 'RUN_STARTED', runId: `run-${prompt}` });
  observer.next({ type: 'TEXT_MESSAGE_START', messageId: `msg-${prompt}` });
  observer.next({
    type: 'TEXT_MESSAGE_CONTENT',
    messageId: `msg-${prompt}`,
    delta: `Answer to ${prompt}`,
  });
  observer.next({ type: 'RUN_FINISHED' });
  observer.complete();
  return { turnId, observer };
}

function legacyRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'rec-legacy',
    title: 'hi there',
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    agentMode: 'mock',
    threadId: 'thread-legacy',
    conversationId: null,
    conversationToken: null,
    messages: [{ id: 'u1', role: 'user', text: 'hi there' }],
    surfaces: [],
    latestSnapshot: null,
    reasoningText: '',
    toolActivity: [],
    completedTurns: [],
    ...overrides,
  };
}

describe('schema migration', () => {
  it('migrates unversioned records with schemaVersion 1 and empty feedback/telemetry defaults', () => {
    const storage = createFakeStorage({ [STORAGE_KEY]: JSON.stringify([legacyRecord()]) });
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    const [record] = history.getState().conversations;
    expect(record.schemaVersion).toBe(1);
    expect(record.answerFeedbackByTurnId).toEqual({});
    expect(record.sessionFeedback).toBeNull();
    expect(record.turnTelemetryByTurnId).toEqual({});
    history.dispose();
  });

  it('drops malformed (non-object) entries during normalization', () => {
    const storage = createFakeStorage({
      [STORAGE_KEY]: JSON.stringify([null, 42, 'junk', legacyRecord()]),
    });
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    expect(history.getState().conversations).toHaveLength(1);
    history.dispose();
  });

  it('normalizes restored running telemetry to interrupted', () => {
    const storage = createFakeStorage({
      [STORAGE_KEY]: JSON.stringify([
        legacyRecord({
          turnTelemetryByTurnId: {
            u1: {
              attemptId: 'a1',
              turnId: 'u1',
              threadId: 'thread-legacy',
              startedAt: '2026-08-01T10:00:00.000Z',
              outcome: 'running',
              connection: { agentMode: 'mock' },
            },
          },
        }),
      ]),
    });
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    const [record] = history.getState().conversations;
    expect(record.turnTelemetryByTurnId['u1'].outcome).toBe('interrupted');
    // The hydrated live store sees the same normalization.
    expect(harness.store.getState().turnTelemetryByTurnId['u1'].outcome).toBe('interrupted');
    history.dispose();
  });

  it('migrates the legacy single-conversation key into the list and removes it', () => {
    const storage = createFakeStorage({
      [LEGACY_KEY]: JSON.stringify(legacyRecord()),
    });
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    expect(history.getState().conversations).toHaveLength(1);
    expect(storage.map.has(LEGACY_KEY)).toBe(false);
    expect(storage.map.has(STORAGE_KEY)).toBe(true);
    history.dispose();
  });
});

describe('feedback and telemetry persistence', () => {
  it('captures the very first mutation after startup restoration (startup-guard regression)', () => {
    // Reproduces the P1: rating a restored conversation as the FIRST action
    // after reload must persist even if no other mutation ever follows.
    const storage = createFakeStorage({ [STORAGE_KEY]: JSON.stringify([legacyRecord()]) });
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    harness.store.setAnswerFeedback('u1', {
      feedbackId: 'fb-restored',
      rating: 'positive',
      reasons: ['correct'],
      createdAt: '2026-08-05T14:00:00.000Z',
      updatedAt: '2026-08-05T14:00:00.000Z',
    });

    const [stored] = storage.stored();
    const feedbackMap = stored.answerFeedbackByTurnId as Record<string, { feedbackId: string }>;
    expect(feedbackMap['u1']?.feedbackId).toBe('fb-restored');
    history.dispose();
  });

  it('persists answer feedback on the final turn before another prompt is submitted', () => {
    const storage = createFakeStorage();
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    const { turnId } = runTurn(harness, 'first');
    harness.store.setAnswerFeedback(turnId, {
      feedbackId: 'fb-1',
      rating: 'negative',
      reasons: ['incomplete', 'other'],
      comment: 'missing the camera specs',
      createdAt: '2026-08-05T14:01:00.000Z',
      updatedAt: '2026-08-05T14:01:00.000Z',
    });

    const [stored] = storage.stored();
    const feedbackMap = stored.answerFeedbackByTurnId as Record<string, { rating: string }>;
    expect(feedbackMap[turnId].rating).toBe('negative');
    const telemetryMap = stored.turnTelemetryByTurnId as Record<string, { outcome: string }>;
    expect(telemetryMap[turnId].outcome).toBe('succeeded');
    history.dispose();
  });

  it('round-trips feedback and telemetry through reload (new store over same storage)', () => {
    const storage = createFakeStorage();
    const first = createStoreHarness();
    const history = new ConversationHistoryStore(first.store, storage.adapter);
    const { turnId } = runTurn(first, 'first');
    first.store.setSessionFeedback({
      feedbackId: 'sf-1',
      outcome: 'partially_resolved',
      createdAt: '2026-08-05T14:01:00.000Z',
      updatedAt: '2026-08-05T14:01:00.000Z',
    });
    history.dispose();

    const second = createStoreHarness();
    const reloaded = new ConversationHistoryStore(second.store, storage.adapter);
    const state = second.store.getState();
    expect(state.sessionFeedback?.outcome).toBe('partially_resolved');
    expect(state.turnTelemetryByTurnId[turnId].outcome).toBe('succeeded');
    reloaded.dispose();
  });
});

describe('reset and switching correctness', () => {
  it('startNew preserves the prior saved conversation (Reset regression)', () => {
    const storage = createFakeStorage();
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    runTurn(harness, 'first conversation');
    const firstId = history.getState().activeId;
    expect(firstId).not.toBeNull();

    history.startNew();
    runTurn(harness, 'second conversation');

    const records = history.getState().conversations;
    expect(records).toHaveLength(2);
    const first = records.find((record) => record.id === firstId);
    expect(first?.title).toBe('first conversation');
    history.dispose();
  });

  it('cancels a mid-stream run on switch, captures it as cancelled, and blocks contamination', () => {
    const storage = createFakeStorage();
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    runTurn(harness, 'conversation A');
    const idA = history.getState().activeId!;
    const threadA = harness.store.getState().threadId;

    history.startNew();
    runTurn(harness, 'conversation B');
    const idB = history.getState().activeId!;
    expect(idB).not.toBe(idA);

    // Unfinished run in B, then switch to A mid-stream.
    harness.store.submitPrompt('unfinished question');
    const staleObserver = harness.latest();
    const unfinishedTurnId = harness.store.getState().messages[0].id;
    const cancelsBefore = harness.cancelCount();

    history.select(idA);

    expect(harness.cancelCount()).toBe(cancelsBefore + 1);
    expect(harness.store.getState().threadId).toBe(threadA);

    const recordB = history.getState().conversations.find((record) => record.id === idB)!;
    expect(recordB.turnTelemetryByTurnId[unfinishedTurnId].outcome).toBe('cancelled');

    // Late events from the cancelled stream must be ignored entirely.
    staleObserver.next({
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: 'ghost',
      delta: 'ghost text',
    });
    staleObserver.next({ type: 'RUN_FINISHED' });
    staleObserver.complete();

    expect(
      harness.store.getState().messages.some((message) => message.text.includes('ghost')),
    ).toBe(false);
    const recordBAfter = history.getState().conversations.find((record) => record.id === idB)!;
    expect(recordBAfter.turnTelemetryByTurnId[unfinishedTurnId].outcome).toBe('cancelled');
    history.dispose();
  });

  it('single-shot skip-capture: hydrating on select does not re-capture the target record', () => {
    const storage = createFakeStorage();
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    runTurn(harness, 'conversation A');
    const idA = history.getState().activeId!;
    history.startNew();
    runTurn(harness, 'conversation B');

    const recordABefore = history.getState().conversations.find((record) => record.id === idA)!;
    history.select(idA);
    const recordAAfter = history.getState().conversations.find((record) => record.id === idA)!;

    // Identity-equal record proves the hydrate notification was skipped
    // (a capture would have rebuilt the record object and bumped updatedAt).
    expect(recordAAfter).toBe(recordABefore);
    history.dispose();
  });

  it('deleting the active conversation cancels its stream and does not resurrect the record', () => {
    const storage = createFakeStorage();
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    runTurn(harness, 'to be deleted');
    const id = history.getState().activeId!;
    harness.store.submitPrompt('still streaming');
    const cancelsBefore = harness.cancelCount();

    history.delete(id);

    expect(harness.cancelCount()).toBe(cancelsBefore + 1);
    expect(history.getState().conversations.find((record) => record.id === id)).toBeUndefined();
    history.dispose();
  });
});

describe('storage health', () => {
  it('reports quota_exceeded distinctly and keeps the in-memory state exportable', () => {
    const storage = createFakeStorage();
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    storage.failWrites(new DOMException('quota', 'QuotaExceededError'));
    runTurn(harness, 'over quota');

    expect(history.getState().storageHealth).toBe('quota_exceeded');
    // The record still exists in memory for export even though the write failed.
    expect(history.getState().conversations).toHaveLength(1);
    expect(storage.stored()).toHaveLength(0);

    storage.heal();
    runTurn(harness, 'after healing');
    expect(history.getState().storageHealth).toBe('ready');
    history.dispose();
  });

  it('reports write_failed for generic storage errors', () => {
    const storage = createFakeStorage();
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    storage.failWrites(new Error('disk on fire'));
    runTurn(harness, 'broken');

    expect(history.getState().storageHealth).toBe('write_failed');
    history.dispose();
  });

  it('reports unavailable when no storage adapter exists', () => {
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, null);

    expect(history.getState().storageHealth).toBe('unavailable');
    runTurn(harness, 'memory only');
    expect(history.getState().conversations).toHaveLength(1);
    history.dispose();
  });
});

describe('disposal', () => {
  it('dispose unsubscribes the conversation-store listener', () => {
    const storage = createFakeStorage();
    const harness = createStoreHarness();
    const history = new ConversationHistoryStore(harness.store, storage.adapter);

    runTurn(harness, 'captured');
    expect(history.getState().conversations).toHaveLength(1);

    history.dispose();
    harness.store.setAnswerFeedback('turn-x', {
      feedbackId: 'fb-x',
      rating: 'positive',
      reasons: [],
      createdAt: '2026-08-05T14:00:00.000Z',
      updatedAt: '2026-08-05T14:00:00.000Z',
    });

    const [stored] = storage.stored();
    expect(
      (stored.answerFeedbackByTurnId as Record<string, unknown>)['turn-x'],
    ).toBeUndefined();
  });
});
