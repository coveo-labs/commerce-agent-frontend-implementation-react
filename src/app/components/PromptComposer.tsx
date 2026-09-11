import { useRef } from 'react';
import { useMobileTextarea } from '../hooks/use-mobile-textarea';
import { TOUCH_INPUT_QUERY } from '../hooks/media-queries';

type PromptComposerProps = {
  draft: string;
  busy: boolean;
  status: string;
  onDraftChange: (value: string) => void;
  onSubmitPrompt: () => void;
};

export function PromptComposer({
  draft,
  busy,
  status,
  onDraftChange,
  onSubmitPrompt,
}: PromptComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useMobileTextarea(textareaRef, draft);

  const submit = () => {
    if (window.matchMedia(TOUCH_INPUT_QUERY).matches) textareaRef.current?.blur();
    onSubmitPrompt();
  };
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (busy || !draft.trim()) {
      return;
    }

    submit();
  };

  const handleKeydown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      window.matchMedia(TOUCH_INPUT_QUERY).matches
    ) {
      return;
    }
    event.preventDefault();
    if (busy || !draft.trim()) {
      return;
    }
    submit();
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <label className="composer-label" htmlFor="prompt">
        Ask the product assistant
      </label>
      <textarea
        id="prompt"
        ref={textareaRef}
        rows={3}
        value={draft}
        disabled={busy}
        placeholder="Show me security cameras"
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeydown}
      ></textarea>

      <div className="composer-actions">
        <span role="status" className={`status-pill${busy ? ' active' : ''}`}>{status}</span>
        <button className="primary-button" type="submit" disabled={busy || !draft.trim()}>
          {busy ? 'Streaming…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
