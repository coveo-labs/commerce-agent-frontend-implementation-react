import { describe, expect, it } from 'vitest';
import type { StoredConversation } from '../conversation.interfaces';
import type { ProductRecord } from '../models';
import {
  buildConversationExport,
  buildExportFilename,
  collectProductIds,
  unifyTurns,
} from './conversation-export';

function product(id: string): ProductRecord {
  return {
    ec_product_id: id,
    ec_name: `Product ${id}`,
    ec_brand: 'Acme',
    ec_price: 100,
    ec_image: 'https://example.com/image.png',
    clickUri: 'https://example.com/product',
  };
}

function makeRecord(overrides: Partial<StoredConversation> = {}): StoredConversation {
  return {
    schemaVersion: 1,
    id: 'rec-1',
    title: 'compare cameras',
    createdAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:05:00.000Z',
    agentMode: 'live',
    threadId: 'thread-1',
    conversationId: 'sess-1',
    conversationToken: 'SECRET-CONTINUATION-TOKEN',
    messages: [
      { id: 'turn-2', role: 'user', text: 'and for outdoors?' },
      { id: 'msg-live', role: 'assistant', text: 'For outdoors, pick the bullet camera.' },
    ],
    surfaces: [
      {
        surfaceId: 'sf-live',
        componentType: 'ProductCarousel',
        heading: 'Outdoor cameras',
        products: [product('P-300')],
        isLoading: false,
      },
    ],
    latestSnapshot: { snapshotMarker: 'SNAPSHOT-ONLY-VALUE' },
    reasoningText: 'REASONING-ONLY-VALUE',
    toolActivity: [
      {
        id: 'tc-live',
        name: 'product_search',
        status: 'completed',
        argsPreview: 'ARGS-ONLY-VALUE',
        resultPreview: 'RESULT-ONLY-VALUE',
      },
    ],
    completedTurns: [
      {
        id: 'turn-1',
        userText: 'compare cameras',
        assistantText: 'Here is a comparison.',
        surfaces: [
          {
            surfaceId: 'sf-1',
            componentType: 'ComparisonTable',
            heading: 'Comparison',
            attributes: ['ec_price'],
            products: [product('P-100'), product('P-200')],
            isLoading: false,
          },
        ],
        reasoningText: 'archived reasoning',
        toolActivity: [],
      },
    ],
    answerFeedbackByTurnId: {
      'turn-1': {
        feedbackId: 'fb-1',
        rating: 'positive',
        reasons: ['good_product_match'],
        createdAt: '2026-08-05T10:04:00.000Z',
        updatedAt: '2026-08-05T10:04:00.000Z',
      },
    },
    sessionFeedback: {
      feedbackId: 'sf-record',
      outcome: 'resolved',
      createdAt: '2026-08-05T10:05:00.000Z',
      updatedAt: '2026-08-05T10:05:00.000Z',
    },
    turnTelemetryByTurnId: {
      'turn-1': {
        attemptId: 'a-1',
        turnId: 'turn-1',
        runId: 'run-1',
        assistantMessageId: 'msg-1',
        threadId: 'thread-1',
        conversationSessionId: 'sess-1',
        startedAt: '2026-08-05T10:00:00.000Z',
        firstResponseAt: '2026-08-05T10:00:01.000Z',
        finishedAt: '2026-08-05T10:00:05.000Z',
        firstResponseMs: 1000,
        totalMs: 5000,
        outcome: 'succeeded',
        connection: {
          agentMode: 'live',
          transport: 'custom-fetch',
          orgId: 'org-1',
          region: 'na',
          trackingId: 'commerce_demo',
          language: 'en',
          country: 'US',
          currency: 'USD',
          clientId: 'CLIENT-ID-VALUE',
        },
      },
    },
    ...overrides,
  };
}

describe('unifyTurns', () => {
  it('appends the live remainder as a final turn joined by user-message id', () => {
    const turns = unifyTurns(makeRecord());
    expect(turns).toHaveLength(2);
    expect(turns[1].id).toBe('turn-2');
    expect(turns[1].live).toBe(true);
    expect(turns[1].assistantText).toContain('bullet camera');
  });

  it('skips a malformed remainder that has no user message', () => {
    const record = makeRecord({
      messages: [{ id: 'msg-only', role: 'assistant', text: 'orphaned' }],
    });
    const turns = unifyTurns(record);
    expect(turns).toHaveLength(1);
    expect(turns[0].id).toBe('turn-1');
  });

  it('drops the remainder when its id already exists in completedTurns (transient snapshot window)', () => {
    const record = makeRecord({
      messages: [{ id: 'turn-1', role: 'user', text: 'compare cameras' }],
    });
    const turns = unifyTurns(record);
    expect(turns).toHaveLength(1);
    expect(turns[0].live).toBeUndefined();
  });
});

describe('collectProductIds', () => {
  it('recursively collects and deduplicates ec_product_id values', () => {
    const bundle = {
      surfaceId: 'sf-2',
      componentType: 'BundleDisplay',
      title: 'Bundle',
      isLoading: false,
      bundles: [
        {
          bundleId: 'b1',
          label: 'Starter',
          description: '',
          slots: [
            { categoryLabel: 'Camera', surfaceRef: 'r1', product: product('P-1') },
            { categoryLabel: 'Recorder', surfaceRef: 'r2', product: product('P-2') },
            { categoryLabel: 'Duplicate', surfaceRef: 'r3', product: product('P-1') },
          ],
        },
      ],
    };
    expect(collectProductIds(bundle).sort()).toEqual(['P-1', 'P-2']);
  });
});

describe('export profiles', () => {
  it('redacted: keeps transcript, feedback, telemetry, and ids; strips diagnostic-only data and all secrets', () => {
    const envelope = buildConversationExport([makeRecord()], 'redacted');
    const serialized = JSON.stringify(envelope);

    // Included.
    const conversation = envelope.conversations[0];
    expect(conversation.turns[0].userText).toBe('compare cameras');
    expect(conversation.turns[0].assistantText).toBe('Here is a comparison.');
    expect(conversation.turns[0].feedback?.rating).toBe('positive');
    expect(conversation.turns[0].telemetry?.runId).toBe('run-1');
    expect(conversation.turns[0].telemetry?.firstResponseMs).toBe(1000);
    expect(conversation.turns[0].telemetry?.connection.orgId).toBe('org-1');
    expect(conversation.turns[0].surfaces[0].productIds.sort()).toEqual(['P-100', 'P-200']);
    expect(conversation.sessionFeedback?.outcome).toBe('resolved');
    expect(conversation.conversationId).toBe('sess-1');

    // Excluded: secrets — never present in any profile.
    expect(serialized).not.toContain('SECRET-CONTINUATION-TOKEN');
    // Excluded from redacted: client id, reasoning, tool previews,
    // snapshots, complete surface payloads.
    expect(serialized).not.toContain('CLIENT-ID-VALUE');
    expect(serialized).not.toContain('REASONING-ONLY-VALUE');
    expect(serialized).not.toContain('archived reasoning');
    expect(serialized).not.toContain('ARGS-ONLY-VALUE');
    expect(serialized).not.toContain('RESULT-ONLY-VALUE');
    expect(serialized).not.toContain('SNAPSHOT-ONLY-VALUE');
    expect(serialized).not.toContain('Product P-100'); // full payload (ec_name) stripped
  });

  it('diagnostic: adds client id, reasoning, previews, snapshot, and payloads; still no continuation token', () => {
    const envelope = buildConversationExport([makeRecord()], 'diagnostic');
    const serialized = JSON.stringify(envelope);

    expect(serialized).toContain('CLIENT-ID-VALUE');
    expect(serialized).toContain('REASONING-ONLY-VALUE');
    expect(serialized).toContain('ARGS-ONLY-VALUE');
    expect(serialized).toContain('RESULT-ONLY-VALUE');
    expect(serialized).toContain('SNAPSHOT-ONLY-VALUE');
    expect(serialized).toContain('Product P-100');

    expect(serialized).not.toContain('SECRET-CONTINUATION-TOKEN');
  });

  it('exports one, several, or all conversations with a versioned envelope', () => {
    const records = [makeRecord(), makeRecord({ id: 'rec-2' }), makeRecord({ id: 'rec-3' })];

    const one = buildConversationExport(records.slice(0, 1), 'redacted');
    const many = buildConversationExport(records.slice(0, 2), 'redacted');
    const all = buildConversationExport(records, 'redacted');

    expect(one.conversations).toHaveLength(1);
    expect(many.conversations).toHaveLength(2);
    expect(all.conversations).toHaveLength(3);
    expect(all.schema).toBe('commerce-agent-conversation-export');
    expect(all.schemaVersion).toBe(1);
    expect(all.profile).toBe('redacted');
    expect(all.notice.length).toBeGreaterThan(0);
  });
});

describe('nested secret redaction', () => {
  it('scrubs the continuation token wherever it is embedded, in both profiles', () => {
    const record = makeRecord({
      latestSnapshot: {
        snapshotMarker: 'resume with SECRET-CONTINUATION-TOKEN later',
      },
      reasoningText: 'thinking about SECRET-CONTINUATION-TOKEN here',
      toolActivity: [
        {
          id: 'tc-1',
          name: 'continue',
          status: 'completed',
          argsPreview: 'args SECRET-CONTINUATION-TOKEN args',
          resultPreview: 'result SECRET-CONTINUATION-TOKEN result',
        },
      ],
    });

    for (const profile of ['redacted', 'diagnostic'] as const) {
      const serialized = JSON.stringify(buildConversationExport([record], profile));
      expect(serialized).not.toContain('SECRET-CONTINUATION-TOKEN');
    }
    // Diagnostic still carries the surrounding (non-secret) content.
    const diagnostic = JSON.stringify(buildConversationExport([record], 'diagnostic'));
    expect(diagnostic).toContain('resume with [redacted] later');
  });

  it('scrubs caller-provided known secrets (bearer token) from transcript content', () => {
    const record = makeRecord({
      messages: [
        { id: 'turn-2', role: 'user', text: 'my token is xyzBEARERxyzSECRETxyz can you help' },
      ],
    });

    const serialized = JSON.stringify(
      buildConversationExport([record], 'redacted', {
        knownSecrets: ['xyzBEARERxyzSECRETxyz'],
      }),
    );
    expect(serialized).not.toContain('xyzBEARERxyzSECRETxyz');
    expect(serialized).toContain('my token is [redacted] can you help');
  });

  it('redacts values under token-like keys nested in diagnostic payloads', () => {
    const record = makeRecord({
      latestSnapshot: {
        conversationToken: 'NESTED-TOKEN-VALUE',
        nested: { authorization: 'NESTED-AUTH-VALUE', label: 'harmless' },
      },
    });

    const serialized = JSON.stringify(buildConversationExport([record], 'diagnostic'));
    expect(serialized).not.toContain('NESTED-TOKEN-VALUE');
    expect(serialized).not.toContain('NESTED-AUTH-VALUE');
    expect(serialized).toContain('harmless');
  });

  it('redacts Bearer-prefixed and JWT-shaped strings embedded in content', () => {
    const record = makeRecord({
      latestSnapshot: {
        note:
          'sent Bearer abcdef1234567890 and a jwt ' +
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.sig-value-here in the payload',
      },
    });

    const serialized = JSON.stringify(buildConversationExport([record], 'diagnostic'));
    expect(serialized).not.toContain('Bearer abcdef1234567890');
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(serialized).toContain('sent [redacted] and a jwt [redacted] in the payload');
  });
});

describe('buildExportFilename', () => {
  it('stamps the profile and local timestamp', () => {
    const filename = buildExportFilename('redacted', new Date(2026, 7, 5, 14, 30, 0));
    expect(filename).toBe('commerce-agent-sessions-20260805-143000-redacted.json');
  });
});
