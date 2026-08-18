// React port of the Angular DemoConversationFacade: owns the conversation
// state (messages, surfaces, reasoning, tool activity, completed turns,
// answer/session feedback, per-turn telemetry) and is the single entry point
// for the UI.
import {
  applyActivitySnapshot,
  createEmptySurfaceState,
  getRenderableSurfaces,
} from '../a2ui-parser';
import {
  CONVERSATION_SCHEMA_VERSION,
  type AnswerFeedback,
  type ConversationTurn,
  type PersistedConversation,
  type SessionFeedback,
  type SurfaceState,
  type ToolActivity,
  type TurnConnectionContext,
  type TurnOutcome,
  type TurnTelemetry,
  type TurnTelemetryError,
} from '../conversation.interfaces';
import { demoAgentConfig, type DemoAgentMode } from '../demo-agent.config';
import type { AgUiEvent, ChatMessage, RenderableCommerceSurface } from '../models';
import { Store } from '../store';
import {
  getLiveTransport,
  streamTurn as defaultStreamTurn,
  type Unsubscribe,
} from './agent-demo.service';
import { resolveConnectionContext } from './connection-context';

export type ConversationState = {
  draft: string;
  busy: boolean;
  status: string;
  agentMode: DemoAgentMode;
  latestSnapshot: Record<string, unknown> | null;
  conversationToken: string | null;
  reasoningText: string;
  toolActivity: ToolActivity[];
  threadId: string;
  conversationId: string | null;
  messages: ChatMessage[];
  surfaceState: SurfaceState;
  /** Derived from `surfaceState`; recomputed on every surface update. */
  surfaces: RenderableCommerceSurface[];
  completedTurns: ConversationTurn[];
  /** Answer feedback keyed by turn id (= the turn's user-message id). */
  answerFeedbackByTurnId: Record<string, AnswerFeedback>;
  /** Whole-conversation assessment, null until rated. */
  sessionFeedback: SessionFeedback | null;
  /** Operational telemetry keyed by turn id (= the turn's user-message id). */
  turnTelemetryByTurnId: Record<string, TurnTelemetry>;
};

/** Identifies one prompt attempt; used to reject late stream callbacks. */
type AttemptRef = {
  turnId: string;
  attemptId: string;
};

export type ConversationStoreDeps = {
  streamTurn: typeof defaultStreamTurn;
  now: () => Date;
  connectionContext: (agentMode: DemoAgentMode) => TurnConnectionContext;
};

export class ConversationStore extends Store<ConversationState> {
  private readonly deps: ConversationStoreDeps;
  private activeStream: Unsubscribe | null = null;
  /**
   * The attempt whose telemetry entry is still `running`. Cleared on
   * finalization, hydration, and reset so late callbacks can never write
   * telemetry into another conversation or a superseded attempt.
   */
  private inFlight: AttemptRef | null = null;
  /**
   * The attempt whose stream callbacks are currently accepted. Unlike
   * `inFlight`, this survives natural run completion (RUN_FINISHED clears
   * telemetry but the transport's `complete()` must still be processed);
   * it is replaced by the next submit and cleared by cancel/reset/hydrate.
   */
  private activeAttempt: AttemptRef | null = null;

  constructor(deps: Partial<ConversationStoreDeps> = {}) {
    super({
      draft: '',
      busy: false,
      status: 'Ready',
      agentMode: demoAgentConfig.mode,
      latestSnapshot: null,
      conversationToken: null,
      reasoningText: '',
      toolActivity: [],
      threadId: createId(),
      conversationId: null,
      messages: [],
      surfaceState: createEmptySurfaceState(),
      surfaces: [],
      completedTurns: [],
      answerFeedbackByTurnId: {},
      sessionFeedback: null,
      turnTelemetryByTurnId: {},
    });
    this.deps = {
      streamTurn: defaultStreamTurn,
      now: () => new Date(),
      connectionContext: resolveConnectionContext,
      ...deps,
    };
  }

  modeLabel(): string {
    return this.getState().agentMode === 'mock'
      ? 'Mock AG-UI stream'
      : `Live via ${getLiveTransport()}`;
  }

  historyCount(): number {
    return this.getState().messages.length;
  }

  persistenceSnapshot(): PersistedConversation {
    const state = this.getState();
    return {
      schemaVersion: CONVERSATION_SCHEMA_VERSION,
      agentMode: state.agentMode,
      threadId: state.threadId,
      conversationId: state.conversationId,
      conversationToken: state.conversationToken,
      messages: state.messages,
      surfaces: state.surfaces,
      latestSnapshot: state.latestSnapshot,
      reasoningText: state.reasoningText,
      toolActivity: state.toolActivity,
      completedTurns: state.completedTurns,
      answerFeedbackByTurnId: state.answerFeedbackByTurnId,
      sessionFeedback: state.sessionFeedback,
      turnTelemetryByTurnId: state.turnTelemetryByTurnId,
    };
  }

  // INVARIANT: hydrate() performs exactly one setState call and emits one
  // notification. The history store's single-shot skip-capture guard depends
  // on this — see conversation-store.test.ts.
  hydrate(conversation: PersistedConversation | null): void {
    if (!conversation) {
      return;
    }

    this.inFlight = null;
    this.activeAttempt = null;

    const surfaceState = createRestoredSurfaceState(conversation.surfaces);
    this.setState({
      agentMode: conversation.agentMode,
      threadId: conversation.threadId,
      conversationId: conversation.conversationId ?? null,
      conversationToken: conversation.conversationToken,
      messages: conversation.messages,
      surfaceState,
      surfaces: getRenderableSurfaces(surfaceState),
      latestSnapshot: conversation.latestSnapshot,
      reasoningText: conversation.reasoningText,
      toolActivity: conversation.toolActivity,
      completedTurns: conversation.completedTurns ?? [],
      answerFeedbackByTurnId: conversation.answerFeedbackByTurnId ?? {},
      sessionFeedback: conversation.sessionFeedback ?? null,
      turnTelemetryByTurnId: conversation.turnTelemetryByTurnId ?? {},
    });
  }

  setDraft(value: string): void {
    this.setState({ draft: value });
  }

  submitPrompt(prompt?: string): void {
    const message = (prompt ?? this.getState().draft).trim();
    let runFinished = false;
    let failed = false;

    if (!message || this.getState().busy) {
      return;
    }

    const attempt = this.startRun(message);
    const isCurrent = () =>
      this.activeAttempt !== null &&
      this.activeAttempt.turnId === attempt.turnId &&
      this.activeAttempt.attemptId === attempt.attemptId;

    this.activeStream = this.deps.streamTurn(
      {
        threadId: this.getState().threadId,
        conversationSessionId: this.getState().threadId,
        conversationToken: this.getState().conversationToken ?? undefined,
        prompt: message,
      },
      this.getState().agentMode,
      {
        next: (event) => {
          if (!isCurrent()) {
            return;
          }
          runFinished = this.handleEvent(event) || runFinished;
        },
        error: (error) => {
          if (!isCurrent()) {
            return;
          }
          failed = true;
          this.handleSubmitError(error);
          this.activeStream = null;
          this.finalizeSubmit(runFinished, failed);
        },
        complete: () => {
          if (!isCurrent()) {
            return;
          }
          this.activeStream = null;
          // A stream that ends without RUN_FINISHED / RUN_ERROR would leave
          // its telemetry `running` forever (an impossible exported state);
          // close it out as interrupted so the record matches reality.
          if (!runFinished && !failed) {
            this.finalizeTelemetry('interrupted', {
              code: 'stream_ended',
              message: 'The stream ended without a terminal event.',
            });
          }
          this.finalizeSubmit(runFinished, failed);
        },
      },
    );
  }

  useQuickAction(action: string): void {
    this.submitPrompt(action);
  }

  /**
   * Cancel the active stream (if any) and finalize its telemetry as
   * `cancelled`. Callers that switch conversations must invoke this BEFORE
   * setting the history store's skip-capture guard, so the cancelled state
   * is still captured under the outgoing conversation's id.
   */
  cancelActiveRun(): void {
    const hadStream = this.activeStream !== null;
    this.activeStream?.();
    this.activeStream = null;
    this.activeAttempt = null;
    if (this.inFlight) {
      this.finalizeTelemetry('cancelled');
    }
    if (hadStream || this.getState().busy) {
      this.setState({ busy: false, status: 'Ready' });
    }
  }

  // INVARIANT: resetConversation() performs exactly one setState call and
  // emits one notification (see hydrate() above).
  resetConversation(): void {
    this.activeStream?.();
    this.activeStream = null;
    this.inFlight = null;
    this.activeAttempt = null;
    this.setState({
      threadId: createId(),
      conversationId: null,
      conversationToken: null,
      messages: [],
      surfaceState: createEmptySurfaceState(),
      surfaces: [],
      latestSnapshot: null,
      reasoningText: '',
      toolActivity: [],
      completedTurns: [],
      answerFeedbackByTurnId: {},
      sessionFeedback: null,
      turnTelemetryByTurnId: {},
      status: 'Ready',
      busy: false,
    });
  }

  toggleAgentMode(enabled: boolean): void {
    if (this.getState().busy) {
      return;
    }

    this.setState({ agentMode: enabled ? 'live' : 'mock' });
  }

  /** Upsert the feedback record for a turn (new references → persisted). */
  setAnswerFeedback(turnId: string, feedback: AnswerFeedback): void {
    this.setState((state) => ({
      ...state,
      answerFeedbackByTurnId: { ...state.answerFeedbackByTurnId, [turnId]: feedback },
    }));
  }

  /** Upsert the whole-conversation assessment. */
  setSessionFeedback(feedback: SessionFeedback): void {
    this.setState({ sessionFeedback: feedback });
  }

  private startRun(message: string): AttemptRef {
    this.snapshotPreviousTurn();

    const turnId = createId();
    const attemptId = createId();
    const now = this.deps.now();
    const current = this.getState();
    const telemetry: TurnTelemetry = {
      attemptId,
      turnId,
      threadId: current.threadId,
      conversationSessionId: current.conversationId ?? undefined,
      startedAt: now.toISOString(),
      outcome: 'running',
      connection: this.deps.connectionContext(current.agentMode),
    };

    this.setState((state) => ({
      ...state,
      draft: '',
      busy: true,
      status: 'Starting run',
      messages: [{ id: turnId, role: 'user', text: message }],
      surfaceState: createEmptySurfaceState(),
      surfaces: [],
      latestSnapshot: null,
      reasoningText: '',
      toolActivity: [],
      turnTelemetryByTurnId: { ...state.turnTelemetryByTurnId, [turnId]: telemetry },
    }));

    const attempt: AttemptRef = { turnId, attemptId };
    this.inFlight = attempt;
    this.activeAttempt = attempt;
    return attempt;
  }

  private snapshotPreviousTurn(): void {
    const state = this.getState();
    const userMessage = state.messages.find((m) => m.role === 'user');
    if (!userMessage) {
      return;
    }
    const assistantMessage = [...state.messages].reverse().find((m) => m.role === 'assistant');
    this.setState({
      completedTurns: [
        ...state.completedTurns,
        {
          id: userMessage.id,
          userText: userMessage.text,
          assistantText: assistantMessage?.text ?? '',
          surfaces: state.surfaces,
          reasoningText: state.reasoningText,
          toolActivity: state.toolActivity,
        },
      ],
    });
  }

  /**
   * Transport-level failure (fetch error, non-2xx, stream abort that
   * surfaced as an error). No synthetic assistant message is appended —
   * partial answer text stays untouched and the structured error lives in
   * the turn's telemetry, rendered as a distinct alert.
   */
  private handleSubmitError(error: unknown): void {
    // Only surface the failure when this attempt's telemetry was still
    // undecided — a transport error arriving after a terminal event must
    // not repaint a finished turn as failed.
    if (this.finalizeTelemetry('failed', toTelemetryError(error))) {
      this.setState({ status: 'Failed' });
    }
  }

  private finalizeSubmit(runFinished: boolean, failed: boolean): void {
    if (!runFinished) {
      this.setState({ busy: false });
    }

    if (!runFinished && !failed) {
      this.setState({ status: 'Ready' });
    }
  }

  private handleEvent(event: AgUiEvent): boolean {
    switch (event.type) {
      case 'RUN_STARTED':
        this.syncConversationContext(event);
        this.setState({ status: 'Run started' });
        return false;
      case 'RUN_FINISHED':
        // First terminal event wins: a duplicate (e.g. a late RUN_ERROR
        // after RUN_FINISHED) must not flip the visible status or replace
        // correlation context after the outcome is already decided.
        if (!this.hasRunningAttempt()) {
          return true;
        }
        this.syncConversationContext(event);
        this.finalizeTelemetry('succeeded');
        this.setState({ status: 'Ready', busy: false });
        return true;
      case 'RUN_ERROR':
        if (!this.hasRunningAttempt()) {
          return true;
        }
        this.syncConversationContext(event);
        this.finalizeTelemetry('failed', {
          code: event.code ?? 'run_error',
          message: sanitizeErrorMessage(event.message || 'The agent request failed.'),
        });
        this.setState({ busy: false, status: 'Failed' });
        return true;
      case 'TEXT_MESSAGE_START':
        this.ensureAssistantMessage(event.messageId);
        return false;
      case 'TEXT_MESSAGE_CONTENT':
        this.appendAssistantText(event.messageId, event.delta);
        return false;
      case 'STATE_SNAPSHOT':
        this.setState({
          latestSnapshot: event.snapshot,
          status: extractStatusLabel(event.snapshot) ?? 'Updating storefront',
        });
        return false;
      case 'ACTIVITY_SNAPSHOT':
        this.setState((state) => {
          const surfaceState = applyActivitySnapshot(state.surfaceState, event.content);
          return {
            ...state,
            surfaceState,
            surfaces: getRenderableSurfaces(surfaceState),
          };
        });
        return false;
      case 'TOOL_CALL_START':
        this.startToolActivity(
          event.toolCallId ?? event.toolUseId ?? createId(),
          event.toolName ?? event.toolCallName ?? 'tool',
        );
        this.setState({
          status: describeTool(event.toolName ?? event.toolCallName ?? 'tool'),
        });
        return false;
      case 'TOOL_CALL_ARGS':
        this.updateToolActivityArgs(
          event.toolCallId ?? event.toolUseId,
          event.delta ?? event.argsDelta ?? '',
        );
        return false;
      case 'TOOL_CALL_RESULT':
        this.updateToolActivityResult(event.toolCallId ?? event.toolUseId, event.content ?? '');
        return false;
      case 'TOOL_CALL_END':
        this.completeToolActivity(event.toolCallId ?? event.toolUseId);
        return false;
      case 'REASONING_MESSAGE_START':
        this.setState({ reasoningText: '' });
        return false;
      case 'REASONING_MESSAGE_CONTENT':
        this.setState((state) => ({
          ...state,
          reasoningText: `${state.reasoningText}${event.delta}`,
        }));
        return false;
      default:
        return false;
    }
  }

  /** True while the in-flight attempt's telemetry entry is still `running`. */
  private hasRunningAttempt(): boolean {
    const ref = this.inFlight;
    if (!ref) {
      return false;
    }
    const entry = this.getState().turnTelemetryByTurnId[ref.turnId];
    return !!entry && entry.attemptId === ref.attemptId && entry.outcome === 'running';
  }

  /**
   * Finalize the in-flight telemetry entry. Idempotent: only an entry that
   * is still `running` AND matches the in-flight {turnId, attemptId} is
   * written; the first terminal outcome and its timestamps are never
   * overwritten. Clears the in-flight reference. Returns whether the
   * terminal outcome was accepted (callers gate UI status changes on it).
   */
  private finalizeTelemetry(
    outcome: Exclude<TurnOutcome, 'running'>,
    error?: TurnTelemetryError,
  ): boolean {
    const accepted = this.hasRunningAttempt();
    const ref = this.inFlight;
    this.inFlight = null;
    if (!ref) {
      return false;
    }

    const now = this.deps.now();
    this.setState((state) => {
      const entry = state.turnTelemetryByTurnId[ref.turnId];
      if (!entry || entry.attemptId !== ref.attemptId || entry.outcome !== 'running') {
        return state;
      }
      const startedMs = Date.parse(entry.startedAt);
      const next: TurnTelemetry = {
        ...entry,
        outcome,
        finishedAt: now.toISOString(),
        ...(Number.isNaN(startedMs)
          ? {}
          : { totalMs: Math.max(0, now.getTime() - startedMs) }),
        ...(error ? { error } : {}),
        toolNames: state.toolActivity.map((tool) => ({ name: tool.name, status: tool.status })),
        surfaces: state.surfaces.map((surface) => ({
          type: surface.componentType,
          surfaceId: surface.surfaceId,
        })),
      };
      return {
        ...state,
        turnTelemetryByTurnId: { ...state.turnTelemetryByTurnId, [ref.turnId]: next },
      };
    });
    return accepted;
  }

  /**
   * Apply `patch` to the in-flight telemetry entry inside a setState
   * updater. Returns the new map, or null when nothing changed (wrong
   * attempt, already finalized, or patch was a no-op).
   */
  private patchInFlightTelemetry(
    state: ConversationState,
    patch: (entry: TurnTelemetry) => TurnTelemetry,
  ): Record<string, TurnTelemetry> | null {
    const ref = this.inFlight;
    if (!ref) {
      return null;
    }
    const entry = state.turnTelemetryByTurnId[ref.turnId];
    if (!entry || entry.attemptId !== ref.attemptId || entry.outcome !== 'running') {
      return null;
    }
    const next = patch(entry);
    if (next === entry) {
      return null;
    }
    return { ...state.turnTelemetryByTurnId, [ref.turnId]: next };
  }

  private ensureAssistantMessage(id: string): void {
    this.setState((state) => {
      // Assistant message id is first-wins: START records it when present.
      const telemetry = this.patchInFlightTelemetry(state, (entry) =>
        entry.assistantMessageId ? entry : { ...entry, assistantMessageId: id },
      );

      if (state.messages.some((message) => message.id === id)) {
        return telemetry ? { ...state, turnTelemetryByTurnId: telemetry } : state;
      }

      return {
        ...state,
        messages: [...state.messages, { id, role: 'assistant', text: '' }],
        ...(telemetry ? { turnTelemetryByTurnId: telemetry } : {}),
      };
    });
  }

  private appendAssistantText(id: string, text: string): void {
    this.setState((state) => {
      // Only a non-empty delta establishes the first-response boundary;
      // the message id itself is captured first-wins from START or CONTENT.
      const telemetry = text
        ? this.patchInFlightTelemetry(state, (entry) => {
            if (entry.firstResponseAt) {
              return entry.assistantMessageId ? entry : { ...entry, assistantMessageId: id };
            }
            const now = this.deps.now();
            const startedMs = Date.parse(entry.startedAt);
            return {
              ...entry,
              assistantMessageId: entry.assistantMessageId ?? id,
              firstResponseAt: now.toISOString(),
              ...(Number.isNaN(startedMs)
                ? {}
                : { firstResponseMs: Math.max(0, now.getTime() - startedMs) }),
            };
          })
        : null;
      const telemetryPatch = telemetry ? { turnTelemetryByTurnId: telemetry } : {};

      const index = state.messages.findIndex((message) => message.id === id);

      if (index === -1) {
        return {
          ...state,
          messages: [...state.messages, { id, role: 'assistant', text }],
          ...telemetryPatch,
        };
      }

      const nextMessages = [...state.messages];
      nextMessages[index] = {
        ...nextMessages[index],
        text: `${nextMessages[index].text}${text}`,
      };
      return { ...state, messages: nextMessages, ...telemetryPatch };
    });
  }

  private startToolActivity(id: string, name: string): void {
    this.setState((state) => ({
      ...state,
      toolActivity: [
        ...state.toolActivity,
        {
          id,
          name,
          status: 'running',
          argsPreview: '',
          resultPreview: '',
        },
      ],
    }));
  }

  private updateToolActivityArgs(id: string | undefined, argsDelta: string): void {
    if (!id || !argsDelta) {
      return;
    }

    this.setState((state) => ({
      ...state,
      toolActivity: state.toolActivity.map((item) =>
        item.id === id
          ? {
              ...item,
              argsPreview: trimPreview(`${item.argsPreview}${argsDelta}`),
            }
          : item,
      ),
    }));
  }

  private updateToolActivityResult(id: string | undefined, result: string): void {
    if (!id || !result) {
      return;
    }

    this.setState((state) => ({
      ...state,
      toolActivity: state.toolActivity.map((item) =>
        item.id === id
          ? {
              ...item,
              resultPreview: trimPreview(result),
            }
          : item,
      ),
    }));
  }

  private completeToolActivity(id: string | undefined): void {
    if (!id) {
      return;
    }

    this.setState((state) => ({
      ...state,
      toolActivity: state.toolActivity.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'completed' as const,
            }
          : item,
      ),
    }));
  }

  private syncConversationContext(event: {
    threadId?: string;
    runId?: string;
    conversationSessionId?: string;
    conversationToken?: string;
  }): void {
    this.setState((state) => {
      const conversationSessionId = event.conversationSessionId ?? event.threadId;
      const patch: Partial<ConversationState> = {};
      if (conversationSessionId) {
        patch.threadId = conversationSessionId;
      }

      // The conversation id is whatever the server echoes back in the
      // response, independent of the locally-generated thread id we start
      // each run with.
      if (event.conversationSessionId) {
        patch.conversationId = event.conversationSessionId;
      }

      if (event.conversationToken) {
        patch.conversationToken = event.conversationToken;
      }

      const telemetry = this.patchInFlightTelemetry(state, (entry) => {
        const runId = event.runId && !entry.runId ? event.runId : undefined;
        const sessionId =
          conversationSessionId && entry.conversationSessionId !== conversationSessionId
            ? conversationSessionId
            : undefined;
        if (!runId && !sessionId) {
          return entry;
        }
        return {
          ...entry,
          ...(runId ? { runId } : {}),
          ...(sessionId ? { conversationSessionId: sessionId } : {}),
        };
      });

      if (Object.keys(patch).length === 0 && !telemetry) {
        return state;
      }

      return {
        ...state,
        ...patch,
        ...(telemetry ? { turnTelemetryByTurnId: telemetry } : {}),
      };
    });
  }
}

function createRestoredSurfaceState(surfaces: RenderableCommerceSurface[]): SurfaceState {
  const orderById = surfaces.reduce<Record<string, number>>((result, surface, index) => {
    result[surface.surfaceId] = index;
    return result;
  }, {});

  const surfacesById = surfaces.reduce<Record<string, RenderableCommerceSurface>>(
    (result, surface) => {
      result[surface.surfaceId] = surface;
      return result;
    },
    {},
  );

  return {
    orderById,
    surfacesById,
  };
}

function extractStatusLabel(snapshot: Record<string, unknown>): string | null {
  const directLabel = snapshot['label'];
  if (typeof directLabel === 'string' && directLabel) {
    return directLabel;
  }

  const execution = snapshot['policy_execution_state'];
  if (execution && typeof execution === 'object') {
    const currentState = (execution as Record<string, unknown>)['current_state'];
    if (typeof currentState === 'string' && currentState) {
      return currentState;
    }
  }

  return null;
}

function describeTool(toolName: string): string {
  const normalized = toolName.replace(/_/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function toTelemetryError(error: unknown): TurnTelemetryError {
  const message =
    error instanceof Error && error.message ? error.message : 'The agent request failed.';
  return { code: 'transport_error', message: sanitizeErrorMessage(message) };
}

/** Keep telemetry errors compact: collapse whitespace, drop anything huge. */
function sanitizeErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length > 500 ? `${normalized.slice(0, 499)}…` : normalized;
}

function createId(): string {
  return crypto.randomUUID();
}

function trimPreview(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

/** Singleton instance (equivalent of Angular's root-provided facade). */
export const conversationStore = new ConversationStore();
