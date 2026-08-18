// Modal dialog for exporting selected conversations as redacted or
// diagnostic JSON. Reads the records passed in from the history store's
// in-memory state; the diagnostic profile requires explicit confirmation
// on every download.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredConversation } from '../conversation.interfaces';
import { authTokenStore } from '../services/auth-token-store';
import {
  buildConversationExport,
  buildExportFilename,
  countTurns,
  type ExportProfile,
} from '../services/conversation-export';

type ExportConversationsDialogProps = {
  records: StoredConversation[];
  /** Pre-selected conversation: the active one, else the most recent. */
  initialSelectedId: string | null;
  onClose: () => void;
};

export function ExportConversationsDialog({
  records,
  initialSelectedId,
  onClose,
}: ExportConversationsDialogProps) {
  const sorted = useMemo(
    () => [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [records],
  );

  const [selected, setSelected] = useState<Set<string>>(() => {
    const defaultId = initialSelectedId ?? sorted[0]?.id;
    return new Set(defaultId ? [defaultId] : []);
  });
  const [confirmingDiagnostic, setConfirmingDiagnostic] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Initial focus + focus trap + Escape-to-close.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    focusables(dialog)[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const items = focusables(dialog);
      if (items.length === 0) {
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const download = (profile: ExportProfile) => {
    const selectedRecords = sorted.filter((record) => selected.has(record.id));
    if (selectedRecords.length === 0) {
      return;
    }
    const envelope = buildConversationExport(selectedRecords, profile, {
      // The bearer token is the one secret the exporter cannot discover on
      // its own — pass it so embedded occurrences are scrubbed too.
      knownSecrets: [authTokenStore.getState().token],
    });
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildExportFilename(profile);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setConfirmingDiagnostic(false);
  };

  const nothingSelected = selected.size === 0;

  return (
    <div className="export-overlay">
      <div
        ref={dialogRef}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-heading"
      >
        <div className="export-dialog-head">
          <h3 id="export-dialog-heading">Export conversations</h3>
          <button
            type="button"
            className="ghost-button export-close"
            aria-label="Close export dialog"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="export-selection-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setSelected(new Set(sorted.map((record) => record.id)))}
          >
            Select all
          </button>
          <button type="button" className="ghost-button" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>

        {sorted.length > 0 ? (
          <ul className="export-list">
            {sorted.map((record) => (
              <li key={record.id} className="export-item">
                <label className="export-item-label">
                  <input
                    type="checkbox"
                    checked={selected.has(record.id)}
                    onChange={() => toggle(record.id)}
                  />
                  <span className="export-item-main">
                    <span className="export-item-title">{record.title}</span>
                    <span className="export-item-meta">
                      {formatDate(record.updatedAt)} · {countTurns(record)}{' '}
                      {countTurns(record) === 1 ? 'turn' : 'turns'} ·{' '}
                      {feedbackStatus(record)}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="export-empty">No saved conversations to export yet.</p>
        )}

        <div className="export-download-actions">
          <button
            type="button"
            className="primary-button"
            disabled={nothingSelected}
            onClick={() => download('redacted')}
          >
            Download redacted JSON
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={nothingSelected}
            onClick={() => setConfirmingDiagnostic(true)}
          >
            Download diagnostic JSON…
          </button>
        </div>

        {confirmingDiagnostic && (
          <div className="export-diagnostic-confirm" role="alertdialog" aria-label="Confirm diagnostic export">
            <p>
              The diagnostic profile additionally includes reasoning text, tool
              argument/result previews, state snapshots, complete surface payloads,
              and your client id. It still excludes bearer and conversation tokens.
            </p>
            <div className="export-download-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => download('diagnostic')}
              >
                Confirm diagnostic download
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setConfirmingDiagnostic(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function focusables(host: HTMLElement): HTMLElement[] {
  return [
    ...host.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ];
}

function feedbackStatus(record: StoredConversation): string {
  const answerCount = Object.keys(record.answerFeedbackByTurnId).length;
  const parts: string[] = [];
  if (answerCount > 0) {
    parts.push(`${answerCount} rated ${answerCount === 1 ? 'answer' : 'answers'}`);
  }
  if (record.sessionFeedback) {
    parts.push(`session ${record.sessionFeedback.outcome.replace(/_/g, ' ')}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'no feedback';
}

function formatDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return '';
  }
  return new Date(parsed).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
