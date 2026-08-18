// "Rate this conversation" block rendered after the transcript once at
// least one assistant answer exists. Submissions go through the
// FeedbackSink; the saved outcome/comment is restored when the session is
// reopened.
import { useEffect, useState } from 'react';
import {
  FEEDBACK_COMMENT_MAX_LENGTH,
  type SessionFeedback,
  type SessionOutcome,
} from '../conversation.interfaces';
import type { FeedbackReceipt, SessionFeedbackSubmissionV1 } from '../services/feedback-sink';

const OUTCOME_LABELS: Record<SessionOutcome, string> = {
  resolved: 'Resolved my question',
  partially_resolved: 'Partially resolved',
  not_resolved: 'Not resolved',
};

type SessionFeedbackControlProps = {
  feedback: SessionFeedback | null;
  onSubmit: (submission: SessionFeedbackSubmissionV1) => Promise<FeedbackReceipt>;
};

export function SessionFeedbackControl({ feedback, onSubmit }: SessionFeedbackControlProps) {
  const [outcome, setOutcome] = useState<SessionOutcome | null>(feedback?.outcome ?? null);
  const [comment, setComment] = useState(feedback?.comment ?? '');
  const [announcement, setAnnouncement] = useState('');

  // Re-seed the draft when a different saved record arrives (conversation
  // switch / hydrate), without clobbering in-progress edits on every render.
  useEffect(() => {
    setOutcome(feedback?.outcome ?? null);
    setComment(feedback?.comment ?? '');
  }, [feedback?.feedbackId]);

  const save = async () => {
    if (!outcome) {
      return;
    }
    const receipt = await onSubmit({ kind: 'session', outcome, comment });
    setAnnouncement(receipt.accepted ? 'Conversation rating saved' : 'Could not save rating');
  };

  return (
    <section className="session-feedback" aria-labelledby="session-feedback-heading">
      <h3 id="session-feedback-heading">Rate this conversation</h3>
      <fieldset className="session-feedback-outcomes">
        <legend className="visually-hidden">How did this conversation go?</legend>
        {(Object.keys(OUTCOME_LABELS) as SessionOutcome[]).map((value) => (
          <label
            key={value}
            className={`session-outcome${outcome === value ? ' selected' : ''}`}
          >
            <input
              type="radio"
              name="session-outcome"
              value={value}
              checked={outcome === value}
              onChange={() => setOutcome(value)}
            />
            <span>{OUTCOME_LABELS[value]}</span>
          </label>
        ))}
      </fieldset>
      <label className="feedback-comment-label" htmlFor="session-feedback-comment">
        Anything else? (optional)
      </label>
      <textarea
        id="session-feedback-comment"
        className="feedback-comment"
        rows={2}
        maxLength={FEEDBACK_COMMENT_MAX_LENGTH}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <div className="feedback-form-actions">
        <button
          type="button"
          className="primary-button feedback-save"
          disabled={!outcome}
          onClick={() => void save()}
        >
          {feedback ? 'Update rating' : 'Save rating'}
        </button>
        <span role="status" aria-live="polite" className="feedback-announcement">
          {announcement}
        </span>
      </div>
    </section>
  );
}
