// Shared test harnesses. Lives outside the *.test.ts files so importing it
// never re-registers another file's tests.
import type {
  PersistedConversation,
  StoredConversation,
  TurnConnectionContext,
} from '../app/conversation.interfaces';
import type { StreamObserver, Unsubscribe } from '../app/services/agent-demo.service';
import { ConversationStore } from '../app/services/conversation-store';

export const T0 = Date.parse('2026-08-05T14:00:00.000Z');

/**
 * ConversationStore wired to a manual stream: tests drive AG-UI events by
 * hand and control the clock, so latency and lifecycle assertions are
 * deterministic.
 */
export function createStoreHarness(connection: TurnConnectionContext = { agentMode: 'mock' }) {
  const observers: StreamObserver[] = [];
  let cancelCount = 0;
  let time = T0;

  const store = new ConversationStore({
    streamTurn: (_input, _mode, observer): Unsubscribe => {
      observers.push(observer);
      return () => {
        cancelCount += 1;
      };
    },
    now: () => new Date(time),
    connectionContext: () => connection,
  });

  return {
    store,
    observers,
    latest: () => observers[observers.length - 1],
    advance: (ms: number) => {
      time += ms;
    },
    cancelCount: () => cancelCount,
  };
}

export function emptyPersisted(
  overrides: Partial<PersistedConversation> = {},
): PersistedConversation {
  return {
    schemaVersion: 1,
    agentMode: 'mock',
    threadId: 'thread-fixture',
    conversationId: null,
    conversationToken: null,
    messages: [],
    surfaces: [],
    latestSnapshot: null,
    reasoningText: '',
    toolActivity: [],
    completedTurns: [],
    answerFeedbackByTurnId: {},
    sessionFeedback: null,
    turnTelemetryByTurnId: {},
    ...overrides,
  };
}

export function makeStoredConversation(
  overrides: Partial<StoredConversation> = {},
): StoredConversation {
  return {
    ...emptyPersisted(),
    id: 'rec-fixture',
    title: 'fixture conversation',
    createdAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:05:00.000Z',
    completedTurns: [
      {
        id: 'turn-1',
        userText: 'fixture question',
        assistantText: 'fixture answer',
        surfaces: [],
        reasoningText: '',
        toolActivity: [],
      },
    ],
    ...overrides,
  };
}
