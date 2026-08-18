// Alternative live transport based on the official AG-UI client SDK.
// Exposes the SDK's subscribe-based stream through the same callback
// observer contract as the custom-fetch transport.
import { HttpAgent, type BaseEvent } from '@ag-ui/client';
import { demoAgentConfig } from '../demo-agent.config';
import type { AgUiEvent, StreamTurnInput } from '../models';
import type { StreamObserver, Unsubscribe } from './agent-demo.service';
import { authTokenStore } from './auth-token-store';

export function streamAgUiClientTurn(
  input: StreamTurnInput,
  observer: StreamObserver,
): Unsubscribe {
  const userAuth = authTokenStore.authorizationHeader();
  const endpoint = authTokenStore.resolveEndpoint(demoAgentConfig.liveEndpoint);
  const agent = new HttpAgent({
    url: endpoint,
    headers: {
      ...demoAgentConfig.liveHeaders,
      ...(userAuth ? { Authorization: userAuth } : {}),
    },
  });

  const events = agent.run({
    threadId: input.threadId,
    runId: crypto.randomUUID(),
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: input.prompt,
      },
    ],
  });

  const subscription = events.subscribe({
    next: (event: BaseEvent) => {
      const normalized = normalizeEvent(event);
      if (normalized) {
        observer.next(normalized);
      }
    },
    error: (error: unknown) => {
      observer.error(error instanceof Error ? error : new Error('AG-UI client request failed.'));
    },
    complete: () => {
      observer.complete();
    },
  });

  return () => {
    subscription.unsubscribe();
  };
}

function normalizeEvent(event: BaseEvent): AgUiEvent | null {
  const payload = event as unknown as Record<string, unknown>;

  switch (event.type as string) {
    case 'RUN_STARTED':
      return {
        type: 'RUN_STARTED',
        threadId: optionalString(payload['threadId']),
        runId: optionalString(payload['runId']),
      };
    case 'RUN_FINISHED':
      return {
        type: 'RUN_FINISHED',
        threadId: optionalString(payload['threadId']),
        runId: optionalString(payload['runId']),
      };
    case 'TEXT_MESSAGE_START':
      return {
        type: 'TEXT_MESSAGE_START',
        messageId: requiredString(payload['messageId']),
        role: optionalAssistantRole(payload['role']),
      };
    case 'TEXT_MESSAGE_CONTENT':
      return {
        type: 'TEXT_MESSAGE_CONTENT',
        messageId: requiredString(payload['messageId']),
        delta: requiredString(payload['delta']),
      };
    case 'TEXT_MESSAGE_END':
      return {
        type: 'TEXT_MESSAGE_END',
        messageId: requiredString(payload['messageId']),
      };
    case 'TOOL_CALL_START':
      return {
        type: 'TOOL_CALL_START',
        toolCallId: optionalString(payload['toolCallId']),
        toolName: optionalString(payload['toolCallName']),
        toolCallName: optionalString(payload['toolCallName']),
      };
    case 'TOOL_CALL_ARGS':
      return {
        type: 'TOOL_CALL_ARGS',
        toolCallId: optionalString(payload['toolCallId']),
        delta: optionalString(payload['delta']),
      };
    case 'TOOL_CALL_RESULT':
      return {
        type: 'TOOL_CALL_RESULT',
        toolCallId: optionalString(payload['toolCallId']),
        content: optionalString(payload['content']),
      };
    case 'TOOL_CALL_END':
      return {
        type: 'TOOL_CALL_END',
        toolCallId: optionalString(payload['toolCallId']),
      };
    case 'STATE_SNAPSHOT':
      return {
        type: 'STATE_SNAPSHOT',
        snapshot: recordValue(payload['snapshot']),
      };
    case 'ACTIVITY_SNAPSHOT':
      return {
        type: 'ACTIVITY_SNAPSHOT',
        messageId: optionalString(payload['messageId']),
        activityType: optionalString(payload['activityType']),
        content: normalizeActivityContent(payload['content']),
        replace: typeof payload['replace'] === 'boolean' ? payload['replace'] : true,
      };
    case 'REASONING_START':
    case 'THINKING_START':
      return {
        type: 'REASONING_START',
        messageId: requiredString(payload['messageId']),
      };
    case 'REASONING_MESSAGE_START':
    case 'THINKING_TEXT_MESSAGE_START':
      return {
        type: 'REASONING_MESSAGE_START',
        messageId: requiredString(payload['messageId']),
        role: optionalAssistantRole(payload['role']),
      };
    case 'REASONING_MESSAGE_CONTENT':
    case 'THINKING_TEXT_MESSAGE_CONTENT':
      return {
        type: 'REASONING_MESSAGE_CONTENT',
        messageId: requiredString(payload['messageId']),
        delta: requiredString(payload['delta']),
      };
    case 'REASONING_MESSAGE_END':
    case 'THINKING_TEXT_MESSAGE_END':
      return {
        type: 'REASONING_MESSAGE_END',
        messageId: requiredString(payload['messageId']),
      };
    case 'REASONING_END':
    case 'THINKING_END':
      return {
        type: 'REASONING_END',
        messageId: requiredString(payload['messageId']),
      };
    default:
      return null;
  }
}

function normalizeActivityContent(value: unknown): { operations: Record<string, unknown>[] } {
  if (!value || typeof value !== 'object') {
    return { operations: [] };
  }

  const content = value as Record<string, unknown>;
  const operations = Array.isArray(content['operations'])
    ? (content['operations'] as Record<string, unknown>[])
    : [];

  return { operations };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function requiredString(value: unknown): string {
  if (typeof value === 'string' && value) {
    return value;
  }

  throw new Error('AG-UI client emitted an invalid event payload.');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function optionalAssistantRole(value: unknown): 'assistant' | undefined {
  return value === 'assistant' ? 'assistant' : undefined;
}
