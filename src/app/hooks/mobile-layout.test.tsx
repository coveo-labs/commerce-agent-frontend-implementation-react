import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { useComposerViewport } from './use-composer-viewport';
import { useMobileTextarea } from './use-mobile-textarea';

class MediaQuery extends EventTarget {
  matches = true;
  change(matches: boolean) {
    this.matches = matches;
    this.dispatchEvent(new Event('change'));
  }
}
class Viewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;
}
let mobile: MediaQuery;
let viewport: Viewport;
let measuredHeight: number;
let observerCallback: ResizeObserverCallback;
let disconnect: ReturnType<typeof vi.fn>;

function Layout() {
  const { shellRef, composerRef } = useComposerViewport();
  return (
    <main ref={shellRef} data-testid="shell">
      <input aria-label="Search" />
      <div ref={composerRef} data-testid="composer">
        <textarea aria-label="Prompt" />
        <button>Send</button>
      </div>
    </main>
  );
}
function Input({ value }: { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useMobileTextarea(ref, value);
  return <textarea aria-label="Draft" ref={ref} rows={3} value={value} readOnly />;
}
const inset = () => screen.getByTestId('shell').style.getPropertyValue('--keyboard-inset');
const flushFocus = () => act(() => vi.runOnlyPendingTimers());

beforeEach(() => {
  vi.useFakeTimers();
  mobile = new MediaQuery();
  viewport = new Viewport();
  measuredHeight = 116;
  disconnect = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => mobile));
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 844);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { observerCallback = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => measuredHeight);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('composer viewport integration', () => {
  it('measures immediately and reserves updated composer height', () => {
    render(<Layout />);
    expect(screen.getByTestId('shell').style.getPropertyValue('--composer-height')).toBe('116px');
    measuredHeight = 180;
    act(() => observerCallback([], {} as ResizeObserver));
    expect(screen.getByTestId('shell').style.getPropertyValue('--composer-height')).toBe('180px');
  });

  it('accounts for keyboard height and viewport offset, then clears after blur', () => {
    render(<Layout />);
    screen.getByLabelText('Prompt').focus();
    flushFocus();
    viewport.height = 500;
    viewport.offsetTop = 44;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(inset()).toBe('300px');
    screen.getByRole('button').focus();
    flushFocus();
    expect(inset()).toBe('0px');
  });

  it('does not move the composer for search, pinch zoom, or desktop layout', () => {
    render(<Layout />);
    viewport.height = 500;
    screen.getByLabelText('Search').focus();
    flushFocus();
    expect(inset()).toBe('0px');
    screen.getByLabelText('Prompt').focus();
    flushFocus();
    expect(inset()).toBe('344px');
    viewport.scale = 2;
    act(() => viewport.dispatchEvent(new Event('resize')));
    expect(inset()).toBe('0px');
    viewport.scale = 1;
    act(() => mobile.change(false));
    expect(inset()).toBe('0px');
  });

  it('recalculates when scrolling the visual viewport and clamps negative insets', () => {
    render(<Layout />);
    screen.getByLabelText('Prompt').focus();
    flushFocus();
    viewport.height = 500;
    viewport.offsetTop = 100;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(inset()).toBe('244px');
    viewport.height = 900;
    act(() => viewport.dispatchEvent(new Event('scroll')));
    expect(inset()).toBe('0px');
  });

  it('supports browsers without VisualViewport or ResizeObserver', () => {
    vi.stubGlobal('visualViewport', undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Layout />);
    screen.getByLabelText('Prompt').focus();
    flushFocus();
    expect(inset()).toBe('0px');
    measuredHeight = 140;
    fireEvent(window, new Event('resize'));
    expect(screen.getByTestId('shell').style.getPropertyValue('--composer-height')).toBe('140px');
  });

  it('removes listeners, styles and pending focus work on unmount', () => {
    const removeViewport = vi.spyOn(viewport, 'removeEventListener');
    const removeMobile = vi.spyOn(mobile, 'removeEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const result = render(<Layout />);
    const shell = screen.getByTestId('shell');
    screen.getByLabelText('Prompt').focus();
    result.unmount();
    flushFocus();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeViewport.mock.calls.map(c => c[0])).toEqual(['resize', 'scroll']);
    expect(removeMobile).toHaveBeenCalledWith('change', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('focusin', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('focusout', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(shell.style.getPropertyValue('--keyboard-inset')).toBe('');
    expect(shell.style.getPropertyValue('--composer-height')).toBe('');
  });
});

describe('phone textarea sizing', () => {
  it('leaves a manually resized desktop field alone during edits and window resize', () => {
    mobile.matches = false;
    const result = render(<Input value="Desktop draft" />);
    const input = screen.getByLabelText<HTMLTextAreaElement>('Draft');
    input.style.height = '220px';
    result.rerender(<Input value="Edited desktop draft" />);
    fireEvent(window, new Event('resize'));
    expect(input.rows).toBe(3);
    expect(input.style.height).toBe('220px');
  });

  it('caps long drafts, remeasures on resize, and restores desktop defaults', () => {
    let contentHeight = 200;
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => contentHeight);
    vi.spyOn(HTMLTextAreaElement.prototype, 'clientHeight', 'get').mockReturnValue(142);
    const result = render(<Input value="A long draft" />);
    const input = screen.getByLabelText<HTMLTextAreaElement>('Draft');
    expect(input.rows).toBe(1);
    expect(input.style.height).toBe('144px');
    expect(input.style.overflowY).toBe('auto');
    contentHeight = 46;
    fireEvent(window, new Event('resize'));
    expect(parseFloat(input.style.height)).toBeLessThan(60);
    expect(input.style.overflowY).toBe('hidden');
    act(() => mobile.change(false));
    expect(input.rows).toBe(3);
    expect(input.style.height).toBe('');
    expect(input.style.overflowY).toBe('');
    result.rerender(<Input value="Another desktop draft" />);
    expect(input.style.height).toBe('');
  });
});
