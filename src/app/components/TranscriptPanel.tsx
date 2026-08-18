// Renders past + live conversation episodes. Auto-scrolls a new turn into
// view at submit time.
import { useEffect, useMemo, useRef } from 'react';
import { quickActionChips } from '../discovery-config';
import type {
  AnswerFeedback,
  ConversationTurn,
  SessionFeedback,
  ToolActivity,
  TurnTelemetry,
} from '../conversation.interfaces';
import { renderMarkdown } from '../markdown';
import type { ChatMessage, RenderableCommerceSurface } from '../models';
import type { FeedbackReceipt, FeedbackSubmissionV1 } from '../services/feedback-sink';
import { AnswerFeedbackControl } from './AnswerFeedbackControl';
import { SessionFeedbackControl } from './SessionFeedbackControl';
import { SurfaceOutlet } from './SurfaceOutlet';

type TurnView = {
  id: string;
  userText: string;
  assistantText: string;
  surfaces: RenderableCommerceSurface[];
  reasoningText: string;
  toolActivity: ToolActivity[];
  isLive: boolean;
};

type TranscriptPanelProps = {
  /**
   * Identity of the rendered conversation. Keys the session-feedback control
   * so an unsaved draft never survives a switch to another conversation —
   * two conversations without saved feedback are otherwise indistinguishable
   * to the control (both render with feedback = null).
   */
  threadId: string;
  messages: ChatMessage[];
  reasoningText: string;
  toolActivity: ToolActivity[];
  surfaces: RenderableCommerceSurface[];
  completedTurns: ConversationTurn[];
  busy: boolean;
  answerFeedbackByTurnId: Record<string, AnswerFeedback>;
  sessionFeedback: SessionFeedback | null;
  turnTelemetryByTurnId: Record<string, TurnTelemetry>;
  /**
   * When false (live mode), the demo's canned quick-start chips are hidden —
   * they describe the mock catalog, not the connected organization.
   */
  showQuickActions?: boolean;
  onResetConversation: () => void;
  onQuickAction: (action: string) => void;
  onSubmitFeedback: (submission: FeedbackSubmissionV1) => Promise<FeedbackReceipt>;
};

export function TranscriptPanel({
  threadId,
  messages,
  reasoningText,
  toolActivity,
  surfaces,
  completedTurns,
  busy,
  answerFeedbackByTurnId,
  sessionFeedback,
  turnTelemetryByTurnId,
  showQuickActions = true,
  onResetConversation,
  onQuickAction,
  onSubmitFeedback,
}: TranscriptPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastScrolledTurnId = useRef<string | null>(null);

  const turns = useMemo<TurnView[]>(() => {
    const past: TurnView[] = completedTurns.map((turn) => ({
      ...turn,
      isLive: false,
    }));

    if (messages.length === 0) {
      return past;
    }

    const userMessage = messages.find((m) => m.role === 'user');
    const assistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
    const liveTurn: TurnView = {
      id: userMessage?.id ?? 'live',
      userText: userMessage?.text ?? '',
      assistantText: assistantMessage?.text ?? '',
      surfaces,
      reasoningText,
      toolActivity,
      isLive: true,
    };

    return [...past, liveTurn];
  }, [messages, reasoningText, toolActivity, surfaces, completedTurns]);

  const hasAssistantAnswer = turns.some((turn) => turn.assistantText.length > 0);

  // When a new live turn starts, animate the window scroll so it lands near
  // the top of the viewport while the prior turn stays reachable above.
  useEffect(() => {
    const live = turns[turns.length - 1];
    if (!live || !live.isLive || live.id === lastScrolledTurnId.current) {
      return;
    }
    lastScrolledTurnId.current = live.id;
    requestAnimationFrame(() => scrollLiveTurnIntoView(scrollContainerRef.current, live.id));
  }, [turns]);

  return (
    <>
      <header className="panel-header">
        <div>
          <p className="panel-kicker">Conversation</p>
          <h2>Conversation with inline surfaces</h2>
        </div>
        <button className="ghost-button" type="button" onClick={onResetConversation}>
          Reset
        </button>
      </header>

      <div className="transcript" ref={scrollContainerRef}>
        {turns.length === 0 && (
          <div className="empty-state">
            {showQuickActions ? (
              <>
                <p>No messages yet. Try one of these to get started:</p>
                <div className="empty-state-chips">
                  {quickActionChips.map((chip) => (
                    <button
                      key={chip.text}
                      type="button"
                      className="empty-state-chip"
                      onClick={() => onQuickAction(chip.text)}
                    >
                      {chip.text}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p>No messages yet. Ask the assistant about your catalog to get started.</p>
            )}
          </div>
        )}

        {turns.map((turn) => {
          const telemetry = turnTelemetryByTurnId[turn.id];
          return (
            <section
              key={turn.id}
              className={`turn${turn.isLive ? ' turn-live' : ''}`}
              data-turn-id={turn.id}
            >
              {turn.userText && (
                <article className="bubble user-bubble">
                  <p className="bubble-role">You</p>
                  <p className="bubble-text">{turn.userText}</p>
                </article>
              )}

              {turn.isLive && hasProgress(turn) && (
                <details className="progress-block">
                  <summary>
                    <span>{progressLabel(turn)}</span>
                    <small>{turn.toolActivity.length} steps</small>
                  </summary>
                  <div className="progress-content">
                    {turn.reasoningText && (
                      <p className="progress-reasoning">{turn.reasoningText}</p>
                    )}
                    {turn.toolActivity.length > 0 && (
                      <ul className="progress-list">
                        {turn.toolActivity.map((tool) => (
                          <li key={tool.id}>
                            <span>{formatToolName(tool.name)}</span>
                            <small>{tool.status === 'running' ? 'Running' : 'Done'}</small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              )}

              {turn.assistantText && (
                <article className="bubble assistant-bubble">
                  <p className="bubble-role">Assistant</p>
                  <div
                    className="bubble-text bubble-markdown"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.assistantText) }}
                  />
                </article>
              )}

              {telemetry?.outcome === 'failed' && (
                <div className="turn-status turn-status-error" role="alert">
                  <strong>The request failed.</strong>{' '}
                  {telemetry.error?.message ?? 'The agent request failed.'}
                  {turn.assistantText && ' The answer above may be incomplete.'}
                </div>
              )}
              {telemetry?.outcome === 'cancelled' && (
                <div className="turn-status" role="status">
                  Response cancelled{turn.assistantText ? ' — the answer above may be incomplete.' : '.'}
                </div>
              )}
              {telemetry?.outcome === 'interrupted' && (
                <div className="turn-status" role="status">
                  Response interrupted{turn.assistantText ? ' — the answer above may be incomplete.' : '.'}
                </div>
              )}

              {turn.assistantText && (
                <AnswerFeedbackControl
                  turnId={turn.id}
                  feedback={answerFeedbackByTurnId[turn.id]}
                  disabled={turn.isLive && busy}
                  onSubmit={onSubmitFeedback}
                />
              )}

              {turn.surfaces.length > 0 && (
                <article className="inline-surfaces">
                  <div className="surface-stack">
                    {turn.surfaces.map((surface) => (
                      <SurfaceOutlet
                        key={surface.surfaceId}
                        surface={surface}
                        onQuickAction={onQuickAction}
                      />
                    ))}
                  </div>
                </article>
              )}
            </section>
          );
        })}

        {hasAssistantAnswer && (
          <SessionFeedbackControl
            key={threadId}
            feedback={sessionFeedback}
            onSubmit={onSubmitFeedback}
          />
        )}
      </div>
    </>
  );
}

function hasProgress(turn: TurnView): boolean {
  return turn.toolActivity.length > 0 || turn.reasoningText.length > 0;
}

function progressLabel(turn: TurnView): string {
  const last = turn.toolActivity[turn.toolActivity.length - 1];
  if (!last) {
    return 'Thinking';
  }
  // Surface the current / most recent step name instead of a generic
  // "Working" / "Completed" status word.
  const name = formatToolName(last.name);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatToolName(name: string): string {
  return name.replaceAll('_', ' ');
}

function scrollLiveTurnIntoView(host: HTMLElement | null, id: string): void {
  if (!host) return;
  const turnEl = host.querySelector<HTMLElement>(`section.turn[data-turn-id="${CSS.escape(id)}"]`);
  if (!turnEl) return;
  // The whole document scrolls (the transcript flows in normal page flow so
  // full-page screenshots capture everything), so animate the window scroll
  // position to bring the new turn near the top.
  const topMargin = 24;
  const offset = turnEl.getBoundingClientRect().top + window.scrollY - topMargin;
  const start = window.scrollY;
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const distance = Math.min(offset, maxScroll) - start;
  if (Math.abs(distance) < 4) return;
  const duration = 320;
  const startTime = performance.now();
  const ease = (t: number) => 1 - Math.pow(1 - t, 3);
  const step = (now: number): void => {
    const t = Math.min(1, (now - startTime) / duration);
    window.scrollTo(0, start + distance * ease(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
