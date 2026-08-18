// =============================================================================
// Feedback sink — the transport boundary for answer / session feedback
// =============================================================================
//
// UI components submit feedback through the asynchronous `FeedbackSink`
// interface and never touch persistence directly. Today the only sink is
// `LocalFeedbackSink`, which validates the submission at runtime and writes
// it into the active conversation store (the existing history persistence
// layer then saves it to localStorage).
//
// When an official Coveo feedback endpoint exists, implement a remote sink
// that maps from the same `FeedbackSubmissionV1` DTO — the UI must not
// change. Delivery/retry state is intentionally absent until the real
// endpoint defines authentication, identifiers, request/receipt schemas,
// idempotency, and retry behavior. Do not substitute RGA feedback or
// generic usage-analytics events for the future agentic feedback contract.
// =============================================================================

import {
  FEEDBACK_COMMENT_MAX_LENGTH,
  NEGATIVE_ANSWER_REASONS,
  POSITIVE_ANSWER_REASONS,
  SESSION_OUTCOMES,
  type AnswerFeedback,
  type NegativeAnswerReason,
  type PositiveAnswerReason,
  type SessionFeedback,
  type SessionOutcome,
} from '../conversation.interfaces';
import { conversationStore, type ConversationStore } from './conversation-store';

export type AnswerFeedbackSubmissionV1 = {
  kind: 'answer';
  /** The rated turn's id (= its user-message id). */
  turnId: string;
  rating: 'positive' | 'negative';
  /** Optional reasons; must belong to the selected rating's allowed set. */
  reasons?: string[];
  comment?: string;
};

export type SessionFeedbackSubmissionV1 = {
  kind: 'session';
  outcome: SessionOutcome;
  comment?: string;
};

/** Versioned, UI-stable submission DTO (future remote sinks map from this). */
export type FeedbackSubmissionV1 = AnswerFeedbackSubmissionV1 | SessionFeedbackSubmissionV1;

export type FeedbackReceipt =
  | { accepted: true; feedbackId: string }
  | { accepted: false; reason: string };

export interface FeedbackSink {
  submit(submission: FeedbackSubmissionV1): Promise<FeedbackReceipt>;
}

export class LocalFeedbackSink implements FeedbackSink {
  constructor(
    private readonly store: ConversationStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async submit(submission: FeedbackSubmissionV1): Promise<FeedbackReceipt> {
    if (submission.kind === 'answer') {
      return this.submitAnswerFeedback(submission);
    }
    if (submission.kind === 'session') {
      return this.submitSessionFeedback(submission);
    }
    return { accepted: false, reason: 'unknown_submission_kind' };
  }

  private async submitAnswerFeedback(
    submission: AnswerFeedbackSubmissionV1,
  ): Promise<FeedbackReceipt> {
    if (submission.rating !== 'positive' && submission.rating !== 'negative') {
      return { accepted: false, reason: 'invalid_rating' };
    }

    const state = this.store.getState();
    if (!turnExists(state.completedTurns, state.messages, submission.turnId)) {
      return { accepted: false, reason: 'unknown_turn' };
    }

    const reasons = normalizeReasons(submission.rating, submission.reasons ?? []);
    if (reasons === null) {
      return { accepted: false, reason: 'invalid_reason' };
    }

    const comment = normalizeComment(submission.comment);
    if (comment === null) {
      return { accepted: false, reason: 'comment_too_long' };
    }

    // Edits preserve the record's identity and creation time.
    const existing = state.answerFeedbackByTurnId[submission.turnId];
    const nowIso = this.now().toISOString();
    const feedback = {
      feedbackId: existing?.feedbackId ?? createId(),
      rating: submission.rating,
      reasons,
      ...(comment ? { comment } : {}),
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    } as AnswerFeedback;

    this.store.setAnswerFeedback(submission.turnId, feedback);
    return { accepted: true, feedbackId: feedback.feedbackId };
  }

  private async submitSessionFeedback(
    submission: SessionFeedbackSubmissionV1,
  ): Promise<FeedbackReceipt> {
    if (!SESSION_OUTCOMES.includes(submission.outcome)) {
      return { accepted: false, reason: 'invalid_outcome' };
    }

    const comment = normalizeComment(submission.comment);
    if (comment === null) {
      return { accepted: false, reason: 'comment_too_long' };
    }

    const existing = this.store.getState().sessionFeedback;
    const nowIso = this.now().toISOString();
    const feedback: SessionFeedback = {
      feedbackId: existing?.feedbackId ?? createId(),
      outcome: submission.outcome,
      ...(comment ? { comment } : {}),
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    this.store.setSessionFeedback(feedback);
    return { accepted: true, feedbackId: feedback.feedbackId };
  }
}

/**
 * Deduplicate and validate reasons against the rating's allowed set.
 * Returns null when any reason falls outside the set (rejected), so
 * untyped (migrated) submissions cannot smuggle invalid combinations in.
 */
function normalizeReasons(
  rating: 'positive' | 'negative',
  reasons: string[],
): PositiveAnswerReason[] | NegativeAnswerReason[] | null {
  const allowed: readonly string[] =
    rating === 'positive' ? POSITIVE_ANSWER_REASONS : NEGATIVE_ANSWER_REASONS;
  const deduped = [...new Set(reasons)];
  if (deduped.some((reason) => !allowed.includes(reason))) {
    return null;
  }
  return deduped as PositiveAnswerReason[] | NegativeAnswerReason[];
}

/** Trim; empty → undefined; over the max length → null (rejected). */
function normalizeComment(comment: string | undefined): string | undefined | null {
  const trimmed = comment?.trim() ?? '';
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > FEEDBACK_COMMENT_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

function turnExists(
  completedTurns: { id: string }[],
  messages: { id: string; role: string }[],
  turnId: string,
): boolean {
  return (
    completedTurns.some((turn) => turn.id === turnId) ||
    messages.some((message) => message.role === 'user' && message.id === turnId)
  );
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'fb-' + Math.random().toString(36).slice(2, 14);
}

/** Singleton sink used by the UI. Swap for a remote sink when it exists. */
export const feedbackSink: FeedbackSink = new LocalFeedbackSink(conversationStore);
