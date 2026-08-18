// Thumbs-up/down control rendered below each assistant answer, with an
// optional reason/comment form. Submissions go through the FeedbackSink —
// this component never touches persistence directly.
import { useState } from 'react';
import {
  FEEDBACK_COMMENT_MAX_LENGTH,
  NEGATIVE_ANSWER_REASONS,
  POSITIVE_ANSWER_REASONS,
  type AnswerFeedback,
  type AnswerFeedbackRating,
} from '../conversation.interfaces';
import type { AnswerFeedbackSubmissionV1, FeedbackReceipt } from '../services/feedback-sink';

const REASON_LABELS: Record<string, string> = {
  correct: 'Correct',
  relevant: 'Relevant',
  complete: 'Complete',
  clear: 'Clear',
  good_product_match: 'Good product match',
  incorrect: 'Incorrect',
  irrelevant: 'Irrelevant',
  incomplete: 'Incomplete',
  unclear: 'Unclear',
  poor_product_match: 'Poor product match',
  technical_issue: 'Technical issue',
  other: 'Other',
};

type AnswerFeedbackControlProps = {
  turnId: string;
  feedback?: AnswerFeedback;
  /** True while this answer is still streaming — controls are disabled. */
  disabled?: boolean;
  onSubmit: (submission: AnswerFeedbackSubmissionV1) => Promise<FeedbackReceipt>;
};

export function AnswerFeedbackControl({
  turnId,
  feedback,
  disabled = false,
  onSubmit,
}: AnswerFeedbackControlProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [draftReasons, setDraftReasons] = useState<string[]>([]);
  const [draftComment, setDraftComment] = useState('');
  const [announcement, setAnnouncement] = useState('');

  const rating = feedback?.rating;

  const openForm = (forRating: AnswerFeedbackRating) => {
    setDraftReasons(feedback && feedback.rating === forRating ? [...feedback.reasons] : []);
    setDraftComment(feedback?.comment ?? '');
    setFormOpen(true);
  };

  const rate = async (nextRating: AnswerFeedbackRating) => {
    if (disabled) {
      return;
    }

    if (rating === nextRating) {
      // Same rating already saved — reopen the form for editing.
      openForm(nextRating);
      return;
    }

    // Save the rating immediately; reasons are rating-specific so a flip
    // clears them, while the free-text comment carries over.
    const receipt = await onSubmit({
      kind: 'answer',
      turnId,
      rating: nextRating,
      reasons: [],
      comment: feedback?.comment,
    });

    if (receipt.accepted) {
      setAnnouncement(nextRating === 'positive' ? 'Rated as helpful' : 'Rated as not helpful');
      setDraftReasons([]);
      setDraftComment(feedback?.comment ?? '');
      setFormOpen(true);
    } else {
      setAnnouncement('Could not save feedback');
    }
  };

  const toggleReason = (reason: string) => {
    setDraftReasons((current) =>
      current.includes(reason)
        ? current.filter((entry) => entry !== reason)
        : [...current, reason],
    );
  };

  const saveDetails = async () => {
    if (!rating) {
      return;
    }
    const receipt = await onSubmit({
      kind: 'answer',
      turnId,
      rating,
      reasons: draftReasons,
      comment: draftComment,
    });
    if (receipt.accepted) {
      setAnnouncement('Feedback saved');
      setFormOpen(false);
    } else {
      setAnnouncement('Could not save feedback');
    }
  };

  const reasonOptions = rating === 'positive' ? POSITIVE_ANSWER_REASONS : NEGATIVE_ANSWER_REASONS;
  const commentFieldId = `feedback-comment-${turnId}`;

  return (
    <div className="answer-feedback">
      <div className="answer-feedback-actions">
        <button
          type="button"
          className={`feedback-thumb${rating === 'positive' ? ' selected' : ''}`}
          aria-pressed={rating === 'positive'}
          aria-label="This answer was helpful"
          disabled={disabled}
          onClick={() => void rate('positive')}
        >
          <span aria-hidden="true">👍</span>
        </button>
        <button
          type="button"
          className={`feedback-thumb${rating === 'negative' ? ' selected' : ''}`}
          aria-pressed={rating === 'negative'}
          aria-label="This answer was not helpful"
          disabled={disabled}
          onClick={() => void rate('negative')}
        >
          <span aria-hidden="true">👎</span>
        </button>
        {feedback && !formOpen && (
          <button
            type="button"
            className="feedback-edit"
            onClick={() => openForm(feedback.rating)}
          >
            Edit feedback
          </button>
        )}
        <span role="status" aria-live="polite" className="feedback-announcement">
          {announcement}
        </span>
      </div>

      {formOpen && rating && (
        <div className="feedback-form">
          <fieldset className="feedback-reasons">
            <legend>
              {rating === 'positive' ? 'What was good about it?' : 'What was wrong with it?'}
            </legend>
            {reasonOptions.map((reason) => (
              <label key={reason} className="feedback-reason">
                <input
                  type="checkbox"
                  checked={draftReasons.includes(reason)}
                  onChange={() => toggleReason(reason)}
                />
                <span>{REASON_LABELS[reason] ?? reason}</span>
              </label>
            ))}
          </fieldset>
          <label className="feedback-comment-label" htmlFor={commentFieldId}>
            Additional comments (optional)
          </label>
          <textarea
            id={commentFieldId}
            className="feedback-comment"
            rows={3}
            maxLength={FEEDBACK_COMMENT_MAX_LENGTH}
            value={draftComment}
            onChange={(event) => setDraftComment(event.target.value)}
          />
          <div className="feedback-form-actions">
            <button type="button" className="primary-button feedback-save" onClick={() => void saveDetails()}>
              Save feedback
            </button>
            <button type="button" className="ghost-button" onClick={() => setFormOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
