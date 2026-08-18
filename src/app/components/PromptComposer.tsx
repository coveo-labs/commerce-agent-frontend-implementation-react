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
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (busy || !draft.trim()) {
      return;
    }

    onSubmitPrompt();
  };

  const handleKeydown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    if (busy || !draft.trim()) {
      return;
    }
    onSubmitPrompt();
  };

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <label className="composer-label" htmlFor="prompt">
        Ask the product assistant
      </label>
      <textarea
        id="prompt"
        rows={3}
        value={draft}
        disabled={busy}
        placeholder="Show me security cameras"
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeydown}
      ></textarea>

      <div className="composer-actions">
        <span className={`status-pill${busy ? ' active' : ''}`}>{status}</span>
        <button className="primary-button" type="submit" disabled={busy || !draft.trim()}>
          {busy ? 'Streaming…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
