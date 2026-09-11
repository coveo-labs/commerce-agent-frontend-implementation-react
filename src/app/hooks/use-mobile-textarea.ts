import { useLayoutEffect, type RefObject } from 'react';
import { MOBILE_LAYOUT_QUERY } from './media-queries';

const MAX_MOBILE_INPUT_HEIGHT = 144;

/** Grow only the phone composer; preserve the desktop's native resizable field.
 * Re-measure on draft edits and rotation, and restore desktop defaults when
 * crossing the layout breakpoint without requiring another keystroke.
 */
export function useMobileTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    const mobile = window.matchMedia(MOBILE_LAYOUT_QUERY);
    let resizedForMobile = false;
    const reset = () => {
      if (!resizedForMobile) return;
      resizedForMobile = false;
      field.rows = 3;
      field.style.removeProperty('height');
      field.style.removeProperty('overflow-y');
    };
    const resize = () => {
      if (!mobile.matches) {
        reset();
        return;
      }
      resizedForMobile = true;
      field.rows = 1;
      field.style.height = 'auto';
      const styles = getComputedStyle(field);
      const borders = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
      field.style.height = `${Math.min(field.scrollHeight + (borders || 0), MAX_MOBILE_INPUT_HEIGHT)}px`;
      field.style.overflowY = field.scrollHeight > field.clientHeight ? 'auto' : 'hidden';
    };
    resize();
    mobile.addEventListener('change', resize);
    window.addEventListener('resize', resize);
    return () => {
      mobile.removeEventListener('change', resize);
      window.removeEventListener('resize', resize);
      reset();
    };
  }, [ref, value]);
}
