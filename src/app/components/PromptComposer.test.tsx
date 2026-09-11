import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptComposer } from './PromptComposer';

let touch: boolean;
beforeEach(() => {
  touch = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)' && touch,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());
function setup(draft = 'Compare cameras', busy = false) {
  const submit = vi.fn();
  render(<PromptComposer draft={draft} busy={busy} status="Ready" onDraftChange={vi.fn()} onSubmitPrompt={submit} />);
  return { submit, input: screen.getByRole('textbox') };
}

describe('composer submission', () => {
  it('keeps desktop Enter submission and Shift+Enter multiline input', () => {
    const { input, submit } = setup();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(submit).toHaveBeenCalledOnce();
  });
  it('does not submit an IME composition', () => {
    const { input, submit } = setup();
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(submit).not.toHaveBeenCalled();
  });
  it('keeps touch Enter as a newline and submits using Send', () => {
    touch = true;
    const { input, submit } = setup();
    input.focus();
    const allowNewline = fireEvent.keyDown(input, { key: 'Enter' });
    expect(allowNewline).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(submit).toHaveBeenCalledOnce();
    expect(input).not.toHaveFocus();
  });
  it.each([['   ', false], ['Compare cameras', true]])('blocks empty or busy requests (%s, %s)', (draft, busy) => {
    const { input, submit } = setup(draft, busy);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.submit(input.closest('form')!);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
