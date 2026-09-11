# Responsive mobile support

Mobile support uses the existing React components, stores, and AG-UI/A2UI rendering path. There is no mobile app fork, routing switch, or additional dependency. The reference app's original headings, welcome text, and desktop textarea remain intact.

## Ownership

| Concern | Location |
| --- | --- |
| Desktop theme and shared component rules | `src/styles.css` |
| All screen-width adaptations | `src/responsive.css`, imported after base styles in `src/main.tsx` |
| Phone and touch media queries used by JavaScript | `src/app/hooks/media-queries.ts` |
| Composer measurement and phone keyboard positioning | `src/app/hooks/use-composer-viewport.ts` |
| Phone-only input growth; restore native desktop resizing | `src/app/hooks/use-mobile-textarea.ts` |
| Enter/Shift+Enter/IME and Send behavior | `src/app/components/PromptComposer.tsx` |
| Locally scrollable comparison with stable column widths | `src/app/components/ComparisonTable.tsx` |
| Carousel row count supplied to CSS | `src/app/components/ProductCarousel.tsx` |

The stylesheet has one phone breakpoint (up to 720px), one tablet range (721–1200px), and one narrow-phone adjustment (up to 380px). Earlier overlapping width queries have been removed from the base stylesheet and consolidated here. Keep the 720px value synchronized with `MOBILE_LAYOUT_QUERY` when changing it. Use component-scoped selectors; do not add another override layer or inline responsive layout declarations.

The carousel supplies `--carousel-rows` as data; base CSS uses that count, while phone CSS selects one row. This avoids using `!important` to defeat the former inline grid layout.

## Composer lifecycle

`useComposerViewport` returns the shell and composer references. It reserves the measured composer height via `--composer-height`; `ResizeObserver` updates this when content or text size changes. A window resize listener supplies a fallback when ResizeObserver is unavailable.

On phones, `--keyboard-inset` follows VisualViewport changes only while an editable field inside the composer is focused. Other fields, including storefront search and dialog fields, retain normal browser positioning. Blur is evaluated on the next animation frame so the hook does not read stale focus. Pinch zoom and desktop layouts clear the inset. Cleanup removes listeners, disconnects the observer, cancels pending focus work, and removes the owned CSS variables.

The phone textarea grows to a maximum of 144px and then scrolls internally. It remeasures on draft edits and screen resizing. Desktop restores the original three-row, manually resizable field; the hook leaves manually chosen desktop heights alone. Desktop Enter submits and Shift+Enter adds a line; touch Enter adds a line and Send submits. IME composition does not submit.

## Shared changes to review

These are intentional and affect more than phones:

- Measured page-bottom spacing replaces the fixed 230px estimate so the final content clears the composer.
- Comparisons retain readable minimum product-column widths and scroll inside a focusable, labeled region; attribute labels stay visible while scrolling.
- Component overflow constraints prevent long responses and product surfaces from widening the document.
- Focus outlines and reduced-motion scrolling apply across screen sizes.

## Separate local-network compatibility change

The independent `random-id.ts` helper uses `crypto.getRandomValues` when `crypto.randomUUID` is unavailable on an HTTP Wi-Fi origin. Only identifier creation call sites change; transport behavior and conversation state contracts are preserved. Its regression test verifies valid distinct UUIDs without randomUUID. This is a separate commit and can be reviewed or omitted independently. Use HTTPS for live deployments and credentials.

## Validation

Run `npm test` and `npm run build`. The hook tests cover viewport offsets, blur, search focus, pinch zoom, desktop breakpoint changes, unavailable browser APIs, measurement updates, listener cleanup, rotation/window resizing, and restoring desktop input sizing. Composer tests cover desktop submission, touch submission, IME, and empty/busy guards.

Browser viewport checks complement these tests; they do not reproduce real iOS or Android software keyboards. Before merging, test actual iPhone Safari and Android Chrome with keyboard open/closed, rotation, touch scrolling, browser zoom/text enlargement, assistive technology, and interrupted/resumed streaming. Live credentials and production integrations are outside this cleanup.
