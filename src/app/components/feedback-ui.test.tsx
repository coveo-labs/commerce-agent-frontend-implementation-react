import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStoreHarness, makeStoredConversation } from '../../test/harness';
import type { ConversationStore } from '../services/conversation-store';
import { LocalFeedbackSink, type FeedbackSink } from '../services/feedback-sink';
import { useStoreState } from '../../app/store';
import { AnswerFeedbackControl } from './AnswerFeedbackControl';
import { ExportConversationsDialog } from './ExportConversationsDialog';
import { SessionFeedbackControl } from './SessionFeedbackControl';
import { TranscriptPanel } from './TranscriptPanel';

function AnswerHarness({
  store,
  sink,
  disabled = false,
}: {
  store: ConversationStore;
  sink: FeedbackSink;
  disabled?: boolean;
}) {
  const state = useStoreState(store);
  const turnId = state.messages.find((message) => message.role === 'user')!.id;
  return (
    <AnswerFeedbackControl
      turnId={turnId}
      feedback={state.answerFeedbackByTurnId[turnId]}
      disabled={disabled}
      onSubmit={(submission) => sink.submit(submission)}
    />
  );
}

function SessionHarness({ store, sink }: { store: ConversationStore; sink: FeedbackSink }) {
  const state = useStoreState(store);
  return (
    <SessionFeedbackControl
      feedback={state.sessionFeedback}
      onSubmit={(submission) => sink.submit(submission)}
    />
  );
}

function setupAnswer(disabled = false) {
  const harness = createStoreHarness();
  harness.store.submitPrompt('which camera fits a small store?');
  const sink = new LocalFeedbackSink(harness.store);
  render(<AnswerHarness store={harness.store} sink={sink} disabled={disabled} />);
  return harness;
}

describe('AnswerFeedbackControl', () => {
  it('saves the rating immediately on thumb click and reflects aria-pressed', async () => {
    const user = userEvent.setup();
    const harness = setupAnswer();

    const up = screen.getByRole('button', { name: 'This answer was helpful' });
    const down = screen.getByRole('button', { name: 'This answer was not helpful' });
    expect(up).toHaveAttribute('aria-pressed', 'false');
    expect(down).toHaveAttribute('aria-pressed', 'false');

    await user.click(up);

    expect(up).toHaveAttribute('aria-pressed', 'true');
    expect(down).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('Rated as helpful');

    const turnId = harness.store.getState().messages[0].id;
    expect(harness.store.getState().answerFeedbackByTurnId[turnId].rating).toBe('positive');
  });

  it('lets the user add reasons and a comment via keyboard-operable controls', async () => {
    const user = userEvent.setup();
    const harness = setupAnswer();

    await user.click(screen.getByRole('button', { name: 'This answer was not helpful' }));

    await user.click(screen.getByRole('checkbox', { name: 'Incomplete' }));
    await user.click(screen.getByRole('checkbox', { name: 'Other' }));
    await user.type(
      screen.getByLabelText('Additional comments (optional)'),
      'missing camera specs',
    );
    await user.click(screen.getByRole('button', { name: 'Save feedback' }));

    expect(screen.getByRole('status')).toHaveTextContent('Feedback saved');
    const turnId = harness.store.getState().messages[0].id;
    const saved = harness.store.getState().answerFeedbackByTurnId[turnId];
    expect(saved.rating).toBe('negative');
    expect(saved.reasons).toEqual(['incomplete', 'other']);
    expect(saved.comment).toBe('missing camera specs');
  });

  it('disables the thumbs while the answer is streaming', () => {
    setupAnswer(true);
    expect(screen.getByRole('button', { name: 'This answer was helpful' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'This answer was not helpful' })).toBeDisabled();
  });

  it('supports reopening and editing saved feedback', async () => {
    const user = userEvent.setup();
    const harness = setupAnswer();

    await user.click(screen.getByRole('button', { name: 'This answer was helpful' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Edit feedback' }));
    await user.click(screen.getByRole('checkbox', { name: 'Good product match' }));
    await user.click(screen.getByRole('button', { name: 'Save feedback' }));

    const turnId = harness.store.getState().messages[0].id;
    expect(harness.store.getState().answerFeedbackByTurnId[turnId].reasons).toEqual([
      'good_product_match',
    ]);
  });
});

describe('SessionFeedbackControl', () => {
  it('saves the selected outcome and comment, and announces the result', async () => {
    const user = userEvent.setup();
    const harness = createStoreHarness();
    harness.store.submitPrompt('question');
    const sink = new LocalFeedbackSink(harness.store);
    render(<SessionHarness store={harness.store} sink={sink} />);

    const saveButton = screen.getByRole('button', { name: 'Save rating' });
    expect(saveButton).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Partially resolved' }));
    await user.type(screen.getByLabelText('Anything else? (optional)'), 'good but slow');
    await user.click(saveButton);

    expect(screen.getByRole('status')).toHaveTextContent('Conversation rating saved');
    expect(harness.store.getState().sessionFeedback).toMatchObject({
      outcome: 'partially_resolved',
      comment: 'good but slow',
    });
    // The saved state is reflected back into the control.
    expect(screen.getByRole('button', { name: 'Update rating' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Partially resolved' })).toBeChecked();
  });

  it('drops an unsaved draft when the transcript switches conversations', async () => {
    // Regression: two conversations without saved session feedback both
    // render the control with feedback = null, so only the threadId key
    // distinguishes them — without it, conversation A's draft could be
    // saved as conversation B's rating.
    const user = userEvent.setup();
    const transcriptProps = {
      messages: [],
      reasoningText: '',
      toolActivity: [],
      surfaces: [],
      completedTurns: [
        {
          id: 'turn-1',
          userText: 'question',
          assistantText: 'answer',
          surfaces: [],
          reasoningText: '',
          toolActivity: [],
        },
      ],
      busy: false,
      answerFeedbackByTurnId: {},
      sessionFeedback: null,
      turnTelemetryByTurnId: {},
      onResetConversation: () => {},
      onQuickAction: () => {},
      onSubmitFeedback: vi.fn(async () => ({ accepted: true as const, feedbackId: 'fb-1' })),
    };

    const { rerender } = render(<TranscriptPanel threadId="thread-a" {...transcriptProps} />);
    await user.click(screen.getByRole('radio', { name: 'Not resolved' }));
    await user.type(screen.getByLabelText('Anything else? (optional)'), 'draft for A');

    rerender(<TranscriptPanel threadId="thread-b" {...transcriptProps} />);

    expect(screen.getByRole('radio', { name: 'Not resolved' })).not.toBeChecked();
    expect(screen.getByLabelText('Anything else? (optional)')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save rating' })).toBeDisabled();
  });
});

describe('ExportConversationsDialog', () => {
  const records = [
    makeStoredConversation({
      id: 'rec-a',
      title: 'first conversation',
      updatedAt: '2026-08-05T10:00:00.000Z',
    }),
    makeStoredConversation({
      id: 'rec-b',
      title: 'second conversation',
      updatedAt: '2026-08-05T11:00:00.000Z',
    }),
  ];

  afterEach(() => {
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  it('moves focus into the dialog, pre-selects the active record, and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ExportConversationsDialog records={records} initialSelectedId="rec-a" onClose={onClose} />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Export conversations' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    const rowA = screen.getByText('first conversation').closest('label')!;
    const rowB = screen.getByText('second conversation').closest('label')!;
    expect(within(rowA).getByRole('checkbox')).toBeChecked();
    expect(within(rowB).getByRole('checkbox')).not.toBeChecked();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables downloads when the selection is empty and re-enables via select all', async () => {
    const user = userEvent.setup();
    render(
      <ExportConversationsDialog records={records} initialSelectedId="rec-a" onClose={() => {}} />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('button', { name: 'Download redacted JSON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download diagnostic JSON…' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Download redacted JSON' })).toBeEnabled();
  });

  it('requires explicit confirmation for every diagnostic download', async () => {
    const user = userEvent.setup();
    const downloads: string[] = [];
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });

    render(
      <ExportConversationsDialog records={records} initialSelectedId="rec-a" onClose={() => {}} />,
    );

    await user.click(screen.getByRole('button', { name: 'Download diagnostic JSON…' }));
    expect(downloads).toHaveLength(0); // nothing downloaded yet
    expect(
      screen.getByRole('alertdialog', { name: 'Confirm diagnostic export' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm diagnostic download' }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^commerce-agent-sessions-\d{8}-\d{6}-diagnostic\.json$/);

    // The confirmation does not persist for the next diagnostic download.
    expect(
      screen.queryByRole('alertdialog', { name: 'Confirm diagnostic export' }),
    ).not.toBeInTheDocument();
  });

  it('downloads the redacted profile directly', async () => {
    const user = userEvent.setup();
    const downloads: string[] = [];
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });

    render(
      <ExportConversationsDialog records={records} initialSelectedId="rec-b" onClose={() => {}} />,
    );

    await user.click(screen.getByRole('button', { name: 'Download redacted JSON' }));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]).toMatch(/^commerce-agent-sessions-\d{8}-\d{6}-redacted\.json$/);
  });
});
