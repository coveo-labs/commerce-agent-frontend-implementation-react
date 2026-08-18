import { describe, expect, it } from 'vitest';
import { createStoreHarness, emptyPersisted, T0 } from '../../test/harness';
import type { ConversationStore } from './conversation-store';

function activeTurnId(store: ConversationStore): string {
  const user = store.getState().messages.find((message) => message.role === 'user');
  if (!user) {
    throw new Error('no active turn');
  }
  return user.id;
}

describe('turn telemetry lifecycle', () => {
  it('creates a running entry with connection context when a prompt is accepted', () => {
    const { store } = createStoreHarness({ agentMode: 'live', transport: 'custom-fetch', orgId: 'org1' });
    store.submitPrompt('hello');

    const turnId = activeTurnId(store);
    const entry = store.getState().turnTelemetryByTurnId[turnId];
    expect(entry).toBeDefined();
    expect(entry.outcome).toBe('running');
    expect(entry.turnId).toBe(turnId);
    expect(entry.startedAt).toBe('2026-08-05T14:00:00.000Z');
    expect(entry.connection).toEqual({ agentMode: 'live', transport: 'custom-fetch', orgId: 'org1' });
  });

  it('records server run and conversation-session ids from RUN_STARTED', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('hello');
    const turnId = activeTurnId(harness.store);

    harness.latest().next({
      type: 'RUN_STARTED',
      runId: 'run-1',
      conversationSessionId: 'sess-1',
      threadId: 'sess-1',
    });

    const entry = harness.store.getState().turnTelemetryByTurnId[turnId];
    expect(entry.runId).toBe('run-1');
    expect(entry.conversationSessionId).toBe('sess-1');
    expect(harness.store.getState().conversationId).toBe('sess-1');
  });

  it('captures assistant message id first-wins from START, latency only from first non-empty content', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('hello');
    const turnId = activeTurnId(harness.store);
    const observer = harness.latest();

    observer.next({ type: 'TEXT_MESSAGE_START', messageId: 'msg-1' });
    let entry = harness.store.getState().turnTelemetryByTurnId[turnId];
    expect(entry.assistantMessageId).toBe('msg-1');
    expect(entry.firstResponseAt).toBeUndefined();

    harness.advance(120);
    observer.next({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: '' });
    entry = harness.store.getState().turnTelemetryByTurnId[turnId];
    expect(entry.firstResponseAt).toBeUndefined();

    harness.advance(80);
    observer.next({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Hi' });
    entry = harness.store.getState().turnTelemetryByTurnId[turnId];
    expect(entry.firstResponseMs).toBe(200);
    expect(entry.firstResponseAt).toBe(new Date(T0 + 200).toISOString());
  });

  it('captures assistant message id from CONTENT when START never arrived', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('hello');
    const turnId = activeTurnId(harness.store);

    harness.latest().next({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-2', delta: 'Hello' });
    expect(harness.store.getState().turnTelemetryByTurnId[turnId].assistantMessageId).toBe('msg-2');
  });

  it('finalizes as succeeded with duration and tool/surface summaries on RUN_FINISHED', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('hello');
    const turnId = activeTurnId(harness.store);
    const observer = harness.latest();

    observer.next({ type: 'TOOL_CALL_START', toolCallId: 'tc-1', toolName: 'product_search' });
    observer.next({ type: 'TOOL_CALL_END', toolCallId: 'tc-1' });
    harness.advance(700);
    observer.next({ type: 'RUN_FINISHED' });

    const entry = harness.store.getState().turnTelemetryByTurnId[turnId];
    expect(entry.outcome).toBe('succeeded');
    expect(entry.totalMs).toBe(700);
    expect(entry.finishedAt).toBe(new Date(T0 + 700).toISOString());
    expect(entry.toolNames).toEqual([{ name: 'product_search', status: 'completed' }]);
    expect(harness.store.getState().busy).toBe(false);
  });

  it('is idempotent: a duplicate terminal event cannot overwrite the first outcome, timestamps, status, or context', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('hello');
    const turnId = activeTurnId(harness.store);
    const observer = harness.latest();

    harness.advance(300);
    observer.next({ type: 'RUN_FINISHED', conversationToken: 'token-from-finish' });
    const first = harness.store.getState().turnTelemetryByTurnId[turnId];

    harness.advance(500);
    observer.next({
      type: 'RUN_ERROR',
      message: 'late duplicate',
      conversationToken: 'token-from-late-error',
    });
    const state = harness.store.getState();
    const after = state.turnTelemetryByTurnId[turnId];

    expect(after.outcome).toBe('succeeded');
    expect(after.finishedAt).toBe(first.finishedAt);
    expect(after.totalMs).toBe(first.totalMs);
    expect(after.error).toBeUndefined();
    // The late terminal event must not repaint the UI or replace context.
    expect(state.status).toBe('Ready');
    expect(state.conversationToken).toBe('token-from-finish');
  });

  it('a transport error arriving after RUN_FINISHED does not repaint the turn as failed', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('hello');
    const observer = harness.latest();

    observer.next({ type: 'RUN_FINISHED' });
    observer.error(new Error('socket closed after completion'));

    expect(harness.store.getState().status).toBe('Ready');
  });

  it('finalizes as interrupted when the stream completes without a terminal event', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('hello');
    const turnId = activeTurnId(harness.store);
    const observer = harness.latest();

    observer.next({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Partial' });
    harness.advance(400);
    observer.complete();

    const state = harness.store.getState();
    const entry = state.turnTelemetryByTurnId[turnId];
    expect(entry.outcome).toBe('interrupted');
    expect(entry.error).toEqual({
      code: 'stream_ended',
      message: 'The stream ended without a terminal event.',
    });
    expect(entry.finishedAt).toBe(new Date(T0 + 400).toISOString());
    expect(entry.totalMs).toBe(400);
    expect(state.busy).toBe(false);
    expect(state.status).toBe('Ready');
  });

  it('finalizes as failed on transport error without appending a synthetic assistant message', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('hello');
    const turnId = activeTurnId(harness.store);
    const observer = harness.latest();

    observer.next({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Partial answer' });
    harness.advance(150);
    observer.error(new Error('boom'));

    const state = harness.store.getState();
    const entry = state.turnTelemetryByTurnId[turnId];
    expect(entry.outcome).toBe('failed');
    expect(entry.error).toEqual({ code: 'transport_error', message: 'boom' });
    expect(state.status).toBe('Failed');
    expect(state.busy).toBe(false);
    // Partial answer preserved; no synthetic apology message.
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({ role: 'assistant', text: 'Partial answer' });
  });

  it('finalizes as failed with the structured server error on RUN_ERROR', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('hello');
    const turnId = activeTurnId(harness.store);

    harness.latest().next({ type: 'RUN_ERROR', message: 'policy rejected', code: 'policy' });

    const entry = harness.store.getState().turnTelemetryByTurnId[turnId];
    expect(entry.outcome).toBe('failed');
    expect(entry.error).toEqual({ code: 'policy', message: 'policy rejected' });
  });

  it('cancelActiveRun unsubscribes the stream and finalizes as cancelled', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('hello');
    const turnId = activeTurnId(harness.store);

    harness.advance(90);
    harness.store.cancelActiveRun();

    expect(harness.cancelCount()).toBe(1);
    const entry = harness.store.getState().turnTelemetryByTurnId[turnId];
    expect(entry.outcome).toBe('cancelled');
    expect(entry.totalMs).toBe(90);
    expect(harness.store.getState().busy).toBe(false);
  });

  it('rejects late callbacks from a cancelled stream (turn AND attempt matched)', () => {
    const harness = createStoreHarness();
    harness.store.submitPrompt('first');
    const firstTurnId = activeTurnId(harness.store);
    const staleObserver = harness.latest();

    harness.store.cancelActiveRun();
    harness.store.submitPrompt('second');
    const secondTurnId = activeTurnId(harness.store);
    expect(secondTurnId).not.toBe(firstTurnId);

    // Stale stream fires after being superseded: all of it must be ignored.
    staleObserver.next({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'stale', delta: 'ghost' });
    staleObserver.next({ type: 'RUN_FINISHED' });
    staleObserver.complete();

    const state = harness.store.getState();
    expect(state.turnTelemetryByTurnId[firstTurnId].outcome).toBe('cancelled');
    expect(state.turnTelemetryByTurnId[secondTurnId].outcome).toBe('running');
    expect(state.busy).toBe(true);
    expect(state.messages.some((message) => message.text.includes('ghost'))).toBe(false);
  });
});

describe('single-notification invariants', () => {
  it('resetConversation emits exactly one notification', () => {
    const { store } = createStoreHarness();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    store.resetConversation();
    unsubscribe();
    expect(notifications).toBe(1);
  });

  it('hydrate emits exactly one notification', () => {
    const { store } = createStoreHarness();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    store.hydrate(emptyPersisted({ threadId: 'other-thread' }));
    unsubscribe();
    expect(notifications).toBe(1);
  });
});

describe('feedback state', () => {
  it('setAnswerFeedback produces a new map reference and keeps the record', () => {
    const { store } = createStoreHarness();
    const before = store.getState().answerFeedbackByTurnId;
    store.setAnswerFeedback('turn-1', {
      feedbackId: 'fb-1',
      rating: 'positive',
      reasons: ['correct'],
      createdAt: '2026-08-05T14:00:00.000Z',
      updatedAt: '2026-08-05T14:00:00.000Z',
    });
    const after = store.getState().answerFeedbackByTurnId;
    expect(after).not.toBe(before);
    expect(after['turn-1'].rating).toBe('positive');
  });

  it('persistenceSnapshot carries schema version, feedback, and telemetry', () => {
    const { store } = createStoreHarness();
    store.setSessionFeedback({
      feedbackId: 'sf-1',
      outcome: 'resolved',
      createdAt: '2026-08-05T14:00:00.000Z',
      updatedAt: '2026-08-05T14:00:00.000Z',
    });
    const snapshot = store.persistenceSnapshot();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.sessionFeedback?.outcome).toBe('resolved');
    expect(snapshot.answerFeedbackByTurnId).toEqual({});
    expect(snapshot.turnTelemetryByTurnId).toEqual({});
  });
});
