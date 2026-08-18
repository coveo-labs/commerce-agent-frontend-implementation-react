import { describe, expect, it } from 'vitest';
import { createStoreHarness } from '../../test/harness';
import { LocalFeedbackSink } from './feedback-sink';

const NOW = () => new Date('2026-08-05T15:00:00.000Z');
const LATER = () => new Date('2026-08-05T16:30:00.000Z');

function createSinkHarness() {
  const harness = createStoreHarness();
  harness.store.submitPrompt('which camera fits a small store?');
  const turnId = harness.store.getState().messages[0].id;
  const sink = new LocalFeedbackSink(harness.store, NOW);
  return { ...harness, turnId, sink };
}

describe('LocalFeedbackSink — answer feedback', () => {
  it('accepts a valid submission and stores it on the conversation', async () => {
    const { sink, store, turnId } = createSinkHarness();

    const receipt = await sink.submit({
      kind: 'answer',
      turnId,
      rating: 'positive',
      reasons: ['correct', 'relevant'],
      comment: '  great match  ',
    });

    expect(receipt.accepted).toBe(true);
    const saved = store.getState().answerFeedbackByTurnId[turnId];
    expect(saved.rating).toBe('positive');
    expect(saved.reasons).toEqual(['correct', 'relevant']);
    expect(saved.comment).toBe('great match');
    expect(saved.createdAt).toBe('2026-08-05T15:00:00.000Z');
  });

  it('rejects reasons outside the selected rating’s allowed set', async () => {
    const { sink, store, turnId } = createSinkHarness();

    const receipt = await sink.submit({
      kind: 'answer',
      turnId,
      rating: 'positive',
      reasons: ['incorrect'], // negative-only reason with a positive rating
    });

    expect(receipt).toEqual({ accepted: false, reason: 'invalid_reason' });
    expect(store.getState().answerFeedbackByTurnId[turnId]).toBeUndefined();
  });

  it('deduplicates repeated reasons', async () => {
    const { sink, store, turnId } = createSinkHarness();

    await sink.submit({
      kind: 'answer',
      turnId,
      rating: 'negative',
      reasons: ['incomplete', 'incomplete', 'other'],
    });

    expect(store.getState().answerFeedbackByTurnId[turnId].reasons).toEqual([
      'incomplete',
      'other',
    ]);
  });

  it('rejects comments over the 2,000-character limit', async () => {
    const { sink, turnId } = createSinkHarness();

    const receipt = await sink.submit({
      kind: 'answer',
      turnId,
      rating: 'positive',
      comment: 'x'.repeat(2001),
    });

    expect(receipt).toEqual({ accepted: false, reason: 'comment_too_long' });
  });

  it('rejects a turn id that does not exist in the conversation', async () => {
    const { sink } = createSinkHarness();

    const receipt = await sink.submit({
      kind: 'answer',
      turnId: 'no-such-turn',
      rating: 'positive',
    });

    expect(receipt).toEqual({ accepted: false, reason: 'unknown_turn' });
  });

  it('edits preserve the feedback id and creation time, and update updatedAt', async () => {
    const { store, turnId } = createSinkHarness();
    const sink = new LocalFeedbackSink(store, NOW);

    const first = await sink.submit({ kind: 'answer', turnId, rating: 'positive' });
    expect(first.accepted).toBe(true);

    const editSink = new LocalFeedbackSink(store, LATER);
    const second = await editSink.submit({
      kind: 'answer',
      turnId,
      rating: 'negative',
      reasons: ['poor_product_match'],
    });
    expect(second.accepted).toBe(true);

    const saved = store.getState().answerFeedbackByTurnId[turnId];
    expect(second).toEqual({ accepted: true, feedbackId: saved.feedbackId });
    expect(first.accepted && first.feedbackId).toBe(saved.feedbackId);
    expect(saved.rating).toBe('negative');
    expect(saved.createdAt).toBe('2026-08-05T15:00:00.000Z');
    expect(saved.updatedAt).toBe('2026-08-05T16:30:00.000Z');
  });
});

describe('LocalFeedbackSink — session feedback', () => {
  it('accepts a valid outcome and persists it', async () => {
    const { sink, store } = createSinkHarness();

    const receipt = await sink.submit({
      kind: 'session',
      outcome: 'not_resolved',
      comment: 'never found the right camera',
    });

    expect(receipt.accepted).toBe(true);
    expect(store.getState().sessionFeedback?.outcome).toBe('not_resolved');
  });

  it('rejects an unknown outcome (runtime validation of untyped input)', async () => {
    const { sink } = createSinkHarness();

    const receipt = await sink.submit({
      kind: 'session',
      // Simulates a migrated / untyped caller bypassing TypeScript.
      outcome: 'kind_of_ok' as never,
    });

    expect(receipt).toEqual({ accepted: false, reason: 'invalid_outcome' });
  });

  it('session edits preserve identity and creation time', async () => {
    const { store } = createSinkHarness();
    const sink = new LocalFeedbackSink(store, NOW);
    await sink.submit({ kind: 'session', outcome: 'resolved' });

    const editSink = new LocalFeedbackSink(store, LATER);
    await editSink.submit({ kind: 'session', outcome: 'partially_resolved' });

    const saved = store.getState().sessionFeedback!;
    expect(saved.outcome).toBe('partially_resolved');
    expect(saved.createdAt).toBe('2026-08-05T15:00:00.000Z');
    expect(saved.updatedAt).toBe('2026-08-05T16:30:00.000Z');
  });
});
