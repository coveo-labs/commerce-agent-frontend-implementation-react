// Compact conversation control: a single button anchored to the right of the
// header. The full conversation telemetry (ids, status, message count) and
// the Live/Mock toggle live in a popover that opens on click, so the header
// stays clean and the large search box owns the center.
import { useEffect, useRef, useState } from 'react';
import type { DemoAgentMode } from '../demo-agent.config';

type ConversationHeaderProps = {
  threadId: string;
  conversationId: string | null;
  status: string;
  historyCount: number;
  agentMode: DemoAgentMode;
  busy?: boolean;
  onAgentModeChange: (liveEnabled: boolean) => void;
};

export function ConversationHeader({
  threadId,
  conversationId,
  status,
  historyCount,
  agentMode,
  busy = false,
  onAgentModeChange,
}: ConversationHeaderProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const host = wrapperRef.current;
      if (host && !host.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, []);

  return (
    <div className="conv-controls" ref={wrapperRef}>
      <button
        type="button"
        className={`conv-button${open ? ' active' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Conversation details and settings"
      >
        <span className={`conv-dot${agentMode === 'live' ? ' live' : ''}`} aria-hidden="true"></span>
        <span className="conv-button-mode">{agentMode === 'live' ? 'Live' : 'Mock'}</span>
        <span className="conv-button-status">{status}</span>
        <span className={`conv-chevron${open ? ' open' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="conv-popover" role="dialog" aria-label="Conversation details">
          <div
            className={`conv-row conv-row-id${conversationId ? '' : ' is-pending'}`}
            title={conversationId ?? 'No conversation id yet'}
          >
            <span className="conv-label">
              <span className="conv-icon" aria-hidden="true">
                💬
              </span>{' '}
              Conversation
            </span>
            <strong className="conv-value conv-value-id">{conversationId ?? 'Pending'}</strong>
          </div>

          <div className="conv-grid">
            <div className="conv-cell">
              <span className="conv-label">Thread</span>
              <strong className="conv-value">{threadId.slice(0, 8)}</strong>
            </div>
            <div className="conv-cell">
              <span className="conv-label">Status</span>
              <strong className="conv-value">{status}</strong>
            </div>
            <div className="conv-cell">
              <span className="conv-label">Messages</span>
              <strong className="conv-value">{historyCount}</strong>
            </div>
          </div>

          <label className="conv-mode">
            <span className="conv-label">Use live path</span>
            <span className="conv-mode-row">
              <strong className="conv-value">{agentMode === 'live' ? 'Live' : 'Mock'}</strong>
              <input
                className="conv-toggle-input"
                type="checkbox"
                checked={agentMode === 'live'}
                disabled={busy}
                onChange={(event) => onAgentModeChange(event.target.checked)}
              />
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
