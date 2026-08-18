// Main transport entry point for the React app.
// The UI-facing contract is a callback-based stream of AG-UI events:
// `streamTurn(input, mode, observer)` returns a cancel function.
import { demoAgentConfig, type DemoAgentMode, type DemoLiveTransport } from '../demo-agent.config';
import { getMockScenario, type MockScenario, type MockToolCall } from '../mock-catalog';
import type { AgUiEvent, StreamTurnInput } from '../models';
import { streamAgUiClientTurn } from './ag-ui-client-transport';
import { authTokenStore } from './auth-token-store';

type RawSseEvent = {
  event?: string;
  data: string;
};

export type StreamObserver = {
  next(value: AgUiEvent): void;
  complete(): void;
  error(error: unknown): void;
};

/** Cancel function returned by `streamTurn`. */
export type Unsubscribe = () => void;

type EventSink = {
  emit(event: AgUiEvent, delayMs?: number): Promise<boolean>;
  complete(): void;
  error(error: unknown): void;
  isClosed(): boolean;
};

type MockRunContext = {
  input: StreamTurnInput;
  scenario: MockScenario;
  runId: string;
  messageId: string;
  reasoningMessageId: string;
};

const liveTransport: DemoLiveTransport = demoAgentConfig.liveTransport;

export function getLiveTransport(): DemoLiveTransport {
  return liveTransport;
}

export function streamTurn(
  input: StreamTurnInput,
  mode: DemoAgentMode,
  observer: StreamObserver,
): Unsubscribe {
  if (mode === 'live') {
    return streamLiveTurn(input, observer);
  }

  return streamMockTurn(input, observer);
}

function streamLiveTurn(input: StreamTurnInput, observer: StreamObserver): Unsubscribe {
  if (liveTransport === 'ag-ui-client') {
    return streamAgUiClientTurn(input, observer);
  }

  return streamDeferredLiveTurn(input, observer);
}

// -----------------------------------------------------------------------------
// Mock transport
// -----------------------------------------------------------------------------

function streamMockTurn(input: StreamTurnInput, observer: StreamObserver): Unsubscribe {
  let cancelled = false;
  let closed = false;
  const sink = createEventSink(observer, () => cancelled || closed, () => {
    closed = true;
  });
  const context = createMockRunContext(input);

  void runMockTurn(context, sink);

  return () => {
    cancelled = true;
  };
}

async function runMockTurn(context: MockRunContext, sink: EventSink): Promise<void> {
  try {
    if (!(await emitMockPrelude(context, sink))) {
      return;
    }

    if (!(await emitReasoningSequence(context, sink))) {
      return;
    }

    if (!(await emitToolCallSequence(context.scenario.toolCalls, sink))) {
      return;
    }

    if (!(await emitIntermediateSnapshots(context.scenario.activitySnapshots, sink))) {
      return;
    }

    if (!(await emitAssistantResponse(context, sink))) {
      return;
    }

    if (!(await emitFinalSnapshot(context.scenario.activitySnapshots.at(-1), sink))) {
      return;
    }

    if (!(await emitRunFinished(context, sink))) {
      return;
    }

    if (!sink.isClosed()) {
      sink.complete();
    }
  } catch (error) {
    sink.error(error);
  }
}

function createMockRunContext(input: StreamTurnInput): MockRunContext {
  const messageId = crypto.randomUUID();

  return {
    input,
    scenario: getMockScenario(input.prompt),
    runId: crypto.randomUUID(),
    messageId,
    reasoningMessageId: `reasoning-${messageId}`,
  };
}

function createEventSink(
  observer: StreamObserver,
  isCancelled: () => boolean,
  markClosed: () => void,
): EventSink {
  return {
    emit: async (event: AgUiEvent, delayMs = 0) => {
      if (isCancelled()) {
        return false;
      }

      observer.next(event);

      if (delayMs > 0) {
        await delay(delayMs);
      }

      return !isCancelled();
    },
    complete: () => {
      if (!isCancelled()) {
        markClosed();
        observer.complete();
      }
    },
    error: (error: unknown) => {
      if (!isCancelled()) {
        markClosed();
        observer.error(error);
      }
    },
    isClosed: () => isCancelled(),
  };
}

async function emitMockPrelude(context: MockRunContext, sink: EventSink): Promise<boolean> {
  if (
    !(await sink.emit({
      type: 'RUN_STARTED',
      threadId: context.input.threadId,
      conversationSessionId: context.input.conversationSessionId ?? context.input.threadId,
      conversationToken: context.input.conversationToken,
      runId: context.runId,
    }))
  ) {
    return false;
  }

  return sink.emit(
    {
      type: 'STATE_SNAPSHOT',
      snapshot: {
        label: 'Understanding request',
      },
    },
    180,
  );
}

async function emitReasoningSequence(context: MockRunContext, sink: EventSink): Promise<boolean> {
  if (
    !(await sink.emit({
      type: 'REASONING_START',
      messageId: context.reasoningMessageId,
    }))
  ) {
    return false;
  }

  if (
    !(await sink.emit({
      type: 'REASONING_MESSAGE_START',
      messageId: context.reasoningMessageId,
      role: 'assistant',
    }))
  ) {
    return false;
  }

  for (const chunk of splitReasoningText(context.scenario.reasoningText)) {
    if (
      !(await sink.emit(
        {
          type: 'REASONING_MESSAGE_CONTENT',
          messageId: context.reasoningMessageId,
          delta: chunk,
        },
        35,
      ))
    ) {
      return false;
    }
  }

  if (
    !(await sink.emit({
      type: 'REASONING_MESSAGE_END',
      messageId: context.reasoningMessageId,
    }))
  ) {
    return false;
  }

  return sink.emit({
    type: 'REASONING_END',
    messageId: context.reasoningMessageId,
  });
}

async function emitToolCallSequence(toolCalls: MockToolCall[], sink: EventSink): Promise<boolean> {
  for (const toolCall of toolCalls) {
    if (!(await emitToolCall(toolCall, sink))) {
      return false;
    }
  }

  return true;
}

async function emitToolCall(toolCall: MockToolCall, sink: EventSink): Promise<boolean> {
  const toolCallId = crypto.randomUUID();

  if (
    !(await sink.emit(
      {
        type: 'TOOL_CALL_START',
        toolCallId,
        toolName: toolCall.name,
        toolCallName: toolCall.name,
      },
      90,
    ))
  ) {
    return false;
  }

  if (
    toolCall.args &&
    !(await sink.emit(
      {
        type: 'TOOL_CALL_ARGS',
        toolCallId,
        delta: toolCall.args,
        argsDelta: toolCall.args,
      },
      70,
    ))
  ) {
    return false;
  }

  if (
    toolCall.result &&
    !(await sink.emit(
      {
        type: 'TOOL_CALL_RESULT',
        toolCallId,
        content: toolCall.result,
      },
      70,
    ))
  ) {
    return false;
  }

  return sink.emit(
    {
      type: 'TOOL_CALL_END',
      toolCallId,
    },
    70,
  );
}

async function emitIntermediateSnapshots(
  snapshots: MockScenario['activitySnapshots'],
  sink: EventSink,
): Promise<boolean> {
  for (const snapshot of snapshots.slice(0, -1)) {
    if (!(await sink.emit(toActivitySnapshotEvent(snapshot), 150))) {
      return false;
    }
  }

  return true;
}

async function emitAssistantResponse(context: MockRunContext, sink: EventSink): Promise<boolean> {
  if (
    !(await sink.emit({
      type: 'TEXT_MESSAGE_START',
      messageId: context.messageId,
      role: 'assistant',
    }))
  ) {
    return false;
  }

  for (const chunk of context.scenario.textChunks) {
    if (
      !(await sink.emit(
        {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: context.messageId,
          delta: chunk,
        },
        55,
      ))
    ) {
      return false;
    }
  }

  if (
    !(await sink.emit({
      type: 'TEXT_MESSAGE_END',
      messageId: context.messageId,
    }))
  ) {
    return false;
  }

  return sink.emit({
    type: 'STATE_SNAPSHOT',
    snapshot: context.scenario.stateSnapshot,
  });
}

function emitFinalSnapshot(
  snapshot: MockScenario['activitySnapshots'][number] | undefined,
  sink: EventSink,
): Promise<boolean> {
  if (!snapshot) {
    return Promise.resolve(true);
  }

  return sink.emit(toActivitySnapshotEvent(snapshot));
}

function emitRunFinished(context: MockRunContext, sink: EventSink): Promise<boolean> {
  return sink.emit({
    type: 'RUN_FINISHED',
    threadId: context.input.threadId,
    conversationSessionId: context.input.conversationSessionId ?? context.input.threadId,
    conversationToken: context.input.conversationToken,
    runId: context.runId,
  });
}

function toActivitySnapshotEvent(snapshot: MockScenario['activitySnapshots'][number]): AgUiEvent {
  return {
    type: 'ACTIVITY_SNAPSHOT',
    messageId: snapshot.messageId,
    activityType: snapshot.activityType,
    content: {
      operations: snapshot.operations,
    },
    replace: true,
  };
}

// -----------------------------------------------------------------------------
// Live transport (hand-rolled fetch + SSE parsing)
// -----------------------------------------------------------------------------

function streamDeferredLiveTurn(input: StreamTurnInput, observer: StreamObserver): Unsubscribe {
  const controller = new AbortController();
  let closed = false;

  const guarded: StreamObserver = {
    next: (event) => {
      if (!closed) {
        observer.next(event);
      }
    },
    complete: () => {
      if (!closed) {
        closed = true;
        observer.complete();
      }
    },
    error: (error) => {
      if (!closed) {
        closed = true;
        observer.error(error);
      }
    },
  };

  void runDeferredLiveTurn(input, guarded, controller, () => closed);

  return () => {
    closed = true;
    controller.abort();
  };
}

async function runDeferredLiveTurn(
  input: StreamTurnInput,
  observer: StreamObserver,
  controller: AbortController,
  isClosed: () => boolean,
): Promise<void> {
  try {
    const stream = await requestLiveTurn(input, controller.signal);
    await forwardLiveEvents(stream, observer, isClosed);
    observer.complete();
  } catch (error) {
    if (controller.signal.aborted || isClosed()) {
      return;
    }

    observer.error(error);
  }
}

async function requestLiveTurn(
  input: StreamTurnInput,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const userAuth = authTokenStore.authorizationHeader();
  const endpoint = authTokenStore.resolveEndpoint(demoAgentConfig.liveEndpoint);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...demoAgentConfig.liveHeaders,
      ...(userAuth ? { Authorization: userAuth } : {}),
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify(buildLiveRequestBody(input)),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Agent request failed with status ${response.status}.`);
  }

  return response.body;
}

function buildLiveRequestBody(input: StreamTurnInput): Record<string, unknown> {
  const defaults = authTokenStore.resolveRequestDefaults(demoAgentConfig.liveRequestDefaults);

  return {
    trackingId: defaults.trackingId,
    language: defaults.language,
    country: defaults.country,
    currency: defaults.currency,
    clientId: defaults.clientId,
    message: input.prompt,
    conversationSessionId: input.conversationSessionId ?? input.threadId,
    ...(input.conversationToken ? { conversationToken: input.conversationToken } : {}),
    context: {
      view: {
        url: resolveViewUrl(),
      },
    },
  };
}

async function forwardLiveEvents(
  stream: ReadableStream<Uint8Array>,
  observer: StreamObserver,
  isClosed: () => boolean,
): Promise<void> {
  for await (const rawEvent of readSse(stream)) {
    if (isClosed()) {
      return;
    }

    const normalized = normalizeSsePayload(rawEvent);
    if (normalized) {
      observer.next(normalized);
    }
  }
}

async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<RawSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const event = parseSseChunk(chunk);
      if (event) {
        yield event;
      }
    }
  }

  buffer += decoder.decode();
  const trailing = parseSseChunk(buffer);
  if (trailing) {
    yield trailing;
  }
}

function parseSseChunk(chunk: string): RawSseEvent | null {
  const normalizedChunk = chunk.replace(/\r\n/g, '\n').trim();
  if (!normalizedChunk) {
    return null;
  }

  const lines = normalizedChunk.split('\n');
  let eventName: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: dataLines.join('\n'),
  };
}

function normalizeSsePayload(rawEvent: RawSseEvent): AgUiEvent | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawEvent.data);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const payload = parsed as Record<string, unknown>;
  const conversationSessionId = optionalString(payload['conversationSessionId']);
  const conversationToken = optionalString(payload['conversationToken']);

  switch (rawEvent.event) {
    case 'turn_started':
      return {
        type: 'RUN_STARTED',
        threadId: conversationSessionId,
        runId: optionalString(payload['runId']),
        conversationSessionId,
        conversationToken,
      };
    case 'turn_complete':
      return {
        type: 'RUN_FINISHED',
        threadId: conversationSessionId,
        runId: optionalString(payload['runId']),
        conversationSessionId,
        conversationToken,
      };
    case 'error':
      return {
        type: 'RUN_ERROR',
        message: optionalString(payload['error']) ?? 'The agent request failed.',
        conversationSessionId,
        conversationToken,
      };
    default:
      break;
  }

  const event = unwrapPayload(payload, rawEvent.event);

  if (!event || typeof event['type'] !== 'string') {
    return null;
  }

  return event as AgUiEvent;
}

function unwrapPayload(
  payload: Record<string, unknown>,
  fallbackType?: string,
): Record<string, unknown> | null {
  if (payload['type'] && typeof payload['type'] === 'string') {
    return payload;
  }

  if (payload['event'] && typeof payload['event'] === 'object') {
    return payload['event'] as Record<string, unknown>;
  }

  if (payload['payload'] && typeof payload['payload'] === 'object') {
    return payload['payload'] as Record<string, unknown>;
  }

  return fallbackType ? { ...payload, type: fallbackType } : payload;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function resolveViewUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:5173/';
  }

  return window.location.href;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function splitReasoningText(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}
