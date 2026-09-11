import { useLayoutEffect, useRef } from 'react';

import { MOBILE_LAYOUT_QUERY } from './media-queries';

/** Keeps document content clear of the composer and the focused composer above
 * a phone keyboard. Owns only these two CSS variables and its event listeners.
 * Search fields and dialogs retain the browser's native keyboard positioning.
 */
export function useComposerViewport() {
  const shellRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const composer = composerRef.current;
    if (!shell || !composer) return;

    const mobile = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const viewport = window.visualViewport;
    let focusFrame = 0;

    const updateHeight = () => {
      shell.style.setProperty('--composer-height', `${composer.offsetHeight}px`);
    };
    const updateInset = () => {
      const field = document.activeElement;
      const editing = field instanceof HTMLElement && composer.contains(field) &&
        field.matches('input, textarea, [contenteditable="true"]');
      const inset = viewport && mobile.matches && editing && viewport.scale === 1
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      shell.style.setProperty('--keyboard-inset', `${inset}px`);
    };
    const updateLayout = () => {
      updateHeight();
      updateInset();
    };
    const onFocusChange = () => {
      // focusout can fire before activeElement changes. Read it next frame.
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(updateInset);
    };

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight);
    observer?.observe(composer);
    viewport?.addEventListener('resize', updateInset);
    viewport?.addEventListener('scroll', updateInset);
    mobile.addEventListener('change', updateLayout);
    window.addEventListener('resize', updateLayout);
    document.addEventListener('focusin', onFocusChange);
    document.addEventListener('focusout', onFocusChange);
    updateLayout();

    return () => {
      observer?.disconnect();
      cancelAnimationFrame(focusFrame);
      viewport?.removeEventListener('resize', updateInset);
      viewport?.removeEventListener('scroll', updateInset);
      mobile.removeEventListener('change', updateLayout);
      window.removeEventListener('resize', updateLayout);
      document.removeEventListener('focusin', onFocusChange);
      document.removeEventListener('focusout', onFocusChange);
      shell.style.removeProperty('--composer-height');
      shell.style.removeProperty('--keyboard-inset');
    };
  }, []);

  return { shellRef, composerRef };
}
