// Header "History" control: a button that opens a dropdown listing past
// conversations (newest first) with select / delete, plus a "New chat"
// action. All state is owned by `conversationHistoryStore`; this component
// is purely presentational.
import { useEffect, useRef, useState } from 'react';
import { historyCopy } from '../discovery-config';
import { conversationHistoryStore } from '../services/conversation-history-store';
import { useStoreState } from '../store';
import { ExportConversationsDialog } from './ExportConversationsDialog';

export function ConversationHistory() {
  const history = useStoreState(conversationHistoryStore);
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);

  const closeExport = () => {
    setExportOpen(false);
    // Restore focus to the trigger so keyboard users are not stranded.
    exportButtonRef.current?.focus();
  };

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

  const onNew = () => {
    conversationHistoryStore.startNew();
    setOpen(false);
  };

  const onSelect = (id: string) => {
    conversationHistoryStore.select(id);
    setOpen(false);
  };

  const onDelete = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    conversationHistoryStore.delete(id);
  };

  const count = history.conversations.length;

  return (
    <div className="history-controls storefront-header-history">
      {/*
        Top-right "New conversation" button. Saving the current chat is
        automatic: the history store snapshots it into the saved list on
        every turn, so startNew() only has to reset the live state.
      */}
      <button
        type="button"
        className="newchat-button"
        onClick={onNew}
        aria-label="Start a new conversation"
      >
        <span className="newchat-icon" aria-hidden="true">
          ＋
        </span>
        <span className="newchat-label">{historyCopy.newConversationLabel}</span>
      </button>

      <button
        type="button"
        ref={exportButtonRef}
        className="export-button"
        onClick={() => setExportOpen(true)}
        aria-haspopup="dialog"
        aria-label="Export conversations"
      >
        <span className="export-icon" aria-hidden="true">
          ⇩
        </span>
        <span className="export-label">Export</span>
      </button>

      {exportOpen && (
        <ExportConversationsDialog
          records={history.conversations}
          initialSelectedId={history.activeId}
          onClose={closeExport}
        />
      )}

      <div className="history" ref={wrapperRef}>
        <button
          type="button"
          className={`history-button${open ? ' active' : ''}`}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`${historyCopy.buttonLabel} (${count} saved)`}
        >
          <span className="history-icon" aria-hidden="true">
            🕑
          </span>
          <span className="history-label">{historyCopy.buttonLabel}</span>
          {count > 0 && <span className="history-count">{count}</span>}
        </button>

        {open && (
          <div className="history-dropdown" role="listbox">
            <div className="history-dropdown-head">
              <p className="history-heading">{historyCopy.heading}</p>
              <button type="button" className="history-new" onClick={onNew}>
                <span aria-hidden="true">＋</span> {historyCopy.newChatLabel}
              </button>
            </div>

            {history.summaries.length > 0 ? (
              <ul className="history-list">
                {history.summaries.map((item) => (
                  <li
                    key={item.id}
                    className={`history-item${item.id === history.activeId ? ' active' : ''}`}
                  >
                    <button
                      type="button"
                      className="history-select"
                      onClick={() => onSelect(item.id)}
                    >
                      <span className="history-title">{item.title}</span>
                      <span className="history-meta">{relativeTime(item.updatedAt)}</span>
                    </button>
                    <button
                      type="button"
                      className="history-delete"
                      aria-label="Delete conversation"
                      onClick={(event) => onDelete(event, item.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="history-empty">{historyCopy.emptyLabel}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact relative-time label, e.g. "just now", "5m ago", "3d ago". */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 45) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(then).toLocaleDateString();
}
