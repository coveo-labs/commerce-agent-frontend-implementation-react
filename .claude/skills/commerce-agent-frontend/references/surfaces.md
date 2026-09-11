# Surfaces

A "surface" is one agent-rendered block inside an answer — a carousel, a
comparison table, a bundle, a research card, a next-actions bar. Read this
before adding or changing one.

## Contents

- [How a surface reaches the screen](#how-a-surface-reaches-the-screen)
- [The parser's three rules](#the-parsers-three-rules)
- [Loading states — two mechanisms](#loading-states--two-mechanisms)
- [Adding a new surface: the six-file checklist](#adding-a-new-surface-the-six-file-checklist)
- [Changing an existing surface](#changing-an-existing-surface)
- [Existing surfaces](#existing-surfaces)
- [Known gap: ProductResearchCard](#known-gap-productresearchcard)

## How a surface reaches the screen

```
ACTIVITY_SNAPSHOT event
  └─ content.operations[]                     ← A2UI ops
       ├─ beginRendering   { surfaceId, root, catalogId }   ← ignored by the parser
       ├─ surfaceUpdate    { surfaceId, components: [{ id, component: { <Type>: {...} } }] }
       └─ dataModelUpdate  { surfaceId, contents: [{ key: 'items' | 'actions', valueMap }] }
                 ↓
   applyActivitySnapshot(previousState, content)
                 ↓
   SurfaceState { orderById, surfacesById }
                 ↓
   getRenderableSurfaces(state) → RenderableCommerceSurface[]
                 ↓
   TranscriptPanel → SurfaceOutlet → <YourRenderer surface={...} />
```

`surfaceUpdate` carries **structure** (which component, headings, attribute
lists, `isLoading`). `dataModelUpdate` carries **data** (products under the
`items` key, next actions under `actions`). They arrive in separate operations
and are joined by `surfaceId`.

`beginRendering` is protocol-only. `collectDrafts` branches on
`'surfaceUpdate' in operation` and `'dataModelUpdate' in operation` and
nothing else, and `BeginRenderingOperation` (`models.ts:60-66`) exists only as
a member of the `A2UIOperation` union (`models.ts:160`) — no runtime code
reads it. A surface comes into existence, and takes its sort
position, only when a `surfaceUpdate` names it with a component other than
`ProductCard`, or a `dataModelUpdate` carries the `actions` key for it
(`a2ui-parser.ts:335`). A `dataModelUpdate` with the `items` key creates
nothing on its own: it fills `productsBySurface`, joined later onto whichever
surface a `surfaceUpdate` created. The mock builders emit `beginRendering`
ahead of each `surfaceUpdate` for protocol fidelity — copy that pattern if you
like, but don't rely on it to register a surface or reserve its order.

## The parser's three rules

`a2ui-parser.ts` is small but subtle. Three behaviors carry the design:

**1. Snapshots are cumulative, not incremental.** `applyActivitySnapshot`
rebuilds every surface from scratch on each snapshot — it seeds drafts from
the previous `surfacesById`, applies the new operations on top, then converts
drafts back to surfaces. That is why a later snapshot can replace a loading
surface with its completed self without any diffing. If you add a field to a
surface, you must add it in **both** the seed loop (restoring from the
previous surface) and `draftToSurface`, or the field will vanish on the next
snapshot.

**2. Order is sticky.** `orderById` records the order a surface was first
seen and is preserved across snapshots, so surfaces don't jump around while
the answer streams. `getRenderableSurfaces` sorts by it.

The corollary is what bites when you add a surface. Order is assigned on first
sight and appended (`order: orderById[surfaceId] ?? Object.keys(orderById).length`,
`a2ui-parser.ts:129`), and the seed loop registers every previously-seen
surface before a single operation is read — so a surface first seen in a later
snapshot sorts **below every surface seen in an earlier one**. Operation order
inside a snapshot only ranks the surfaces that are new in that snapshot, and
`beginRendering` reserves nothing. Because `buildNextActionsSkeleton()` runs in
an early skeleton snapshot in all three scenarios, a surface whose first
`surfaceUpdate` arrives only in the final snapshot lands underneath the Next
Actions bar. That is why `comparison-summary-surface` renders below the bar
today, even though its operations sit ahead of the next-actions operations in
that same snapshot. To place a surface above the bar, emit its first
`surfaceUpdate` no later than
the snapshot carrying the next-actions skeleton — and, if in that same
snapshot, ahead of the next-actions operations.

**3. Skeletons dismiss themselves by component type.**
`getRenderableSurfaces` drops any surface whose `surfaceId` starts with
`skeleton-` once a non-skeleton surface of the **same `componentType`**
exists. Renderers therefore only ever need to respect `surface.isLoading`.

Leaf values are narrowed rather than trusted — `typeof` checks and
`filter((x): x is T => ...)`; see `toProductRecord`, `toNextAction`,
`readLiteralOrPath` and `buildBundleTiers`. Follow that when you add a field:
the operations come off the wire, and an unchecked value renders as garbage in
front of a customer.

The casts that *are* in the file are structural, not value-level.
`operation as SurfaceUpdateOperation` (L273),
`componentKeys[0] as CommerceSurfaceComponentType` (L282) and
`component.component as Record<string, Record<string, unknown>>` (L283) only
pick the dispatch key — the payload is read back as `unknown`, and
`draftToSurface` returns `null` for any type it has no `case` for.
`payload['bundles'] as BundleDisplayTier[]` (L307) is repaired downstream:
`buildBundleTiers` re-filters the tiers and `String()`-coerces every tier and
slot field.

The one value nothing checks is `slot['product']` (L166) — an off-protocol
fallback used when `productsBySurface[surfaceRef]` is empty, since
`BundleSlotConfig` declares only `categoryLabel` and `surfaceRef`. It acquires
its `ProductRecord | null` type by cast alone, and `BundleDisplay` survives a
malformed one only because it optional-chains every read
(`slot.product?.ec_image`, `.ec_name`, `.ec_brand`, `.description`). If you
extend `BundleDisplaySlot` or `BundleDisplayTier`, validate there instead of
copying the cast.

## Loading states — two mechanisms

Both are live; know which one you are looking at.

| Mechanism | How it works | Used by |
|---|---|---|
| `isLoading` flag | Same `surfaceId`, first snapshot sets `isLoading: true`, a later snapshot omits it. The surface stays in place and swaps its inner content. | The mock scenarios (`buildCarouselSkeleton`, `buildComparisonSkeleton`, `buildBundleSkeleton`, `buildNextActionsSkeleton`) |
| `skeleton-` prefix | A separate surface with a `skeleton-`-prefixed id, dropped once a real surface of the same component type arrives. | Agents that emit a standalone placeholder surface |

A renderer handles both by branching on `surface.isLoading` only.

Skeleton markup uses the shared primitives:

```tsx
const PLACEHOLDERS = Array.from({ length: 4 }, (_, i) => i);

{surface.isLoading ? (
  <div className="loading-grid">
    {PLACEHOLDERS.map((i) => (
      <SkeletonReveal key={i} delay={i * 0.16}>
        <article className="loading-card">
          <Skeleton className="skeleton-image" />
          <Skeleton className="skeleton-line skeleton-brand" />
          {/* one bar per real element, in the real layout */}
        </article>
      </SkeletonReveal>
    ))}
  </div>
) : ( /* real content */ )}
```

`SkeletonReveal` slides children in from the right (`{ opacity: 0, x: 20 }` →
`{ opacity: 1, x: 0 }`) and passes `initial={false}` under
`useReducedMotion()`. Stagger with `delay={index * ~0.15}` so the block fills
progressively instead of appearing all at once. The shimmer itself is CSS
(`.skeleton` in `styles.css`) and is disabled under `prefers-reduced-motion`.

## Adding a new surface: the six-file checklist

Say the agent will start sending a `SizeGuide` surface. Work in this order
because each step needs the types from the one before — not because the
compiler will tell you what you skipped. It won't: all of step 1 compiles
clean on its own. The seed loop in `collectDrafts` is an if/else-if chain with
no final `else` (`a2ui-parser.ts:239-268`), and `draftToSurface`
(`a2ui-parser.ts:226-228`) and `SurfaceOutlet` (`SurfaceOutlet.tsx:30-31`)
both end in `default: return null`, so `tsc -b` stays green with no parser
branch, no `draftToSurface` case and no `SurfaceOutlet` case. Check each step
by eye, then in the dev server.

**1. `src/app/models.ts`** — three edits:

```ts
// a) the wire-side component payload
type SizeGuideComponent = {
  SizeGuide: {
    heading?: LiteralOrPath;
    rows?: { componentId: string; dataBinding: string };
    isLoading?: boolean;
  };
};
// …add SizeGuideComponent to the SurfaceComponentPayload union

// b) the component-type name
export type CommerceSurfaceComponentType = /* … */ | 'SizeGuide';

// c) the renderable shape
export type SizeGuideSurface = {
  surfaceId: string;
  componentType: 'SizeGuide';
  heading: string;
  rows: SizeGuideRow[];
  isLoading: boolean;
};
// …add SizeGuideSurface to the RenderableCommerceSurface union
```

Only (b) and (c) affect the build, and only in the other direction: write the
`draftToSurface` case without adding `'SizeGuide'` to
`CommerceSurfaceComponentType` and `tsc` fails with TS2678. Edit (a) is
documentation — see the ProductResearchCard gap below.

**2. `src/app/a2ui-parser.ts`** — four edits, and missing the seed loop is the
classic bug:

- Add any new fields to `SurfaceDraft`.
- In `collectDrafts`, extend the **seed loop** over
  `previous.surfacesById` with a branch that copies your fields off the
  existing surface (`else if (existing.componentType === 'SizeGuide') { … }`).
  Skip this and the surface resets to empty on the next snapshot.
- In `collectDrafts`, add the `surfaceUpdate` branch that reads the payload
  (`readLiteralOrPath` for `LiteralOrPath` fields,
  `payload?.['isLoading'] === true` for the flag).
- In `draftToSurface`, add the `case 'SizeGuide':` that returns the
  renderable surface.

If your data arrives via `dataModelUpdate` under a key other than `items` or
`actions`, add that key's handling in the `dataModelUpdate` block too.

**3. `src/app/components/SizeGuide.tsx`** — the renderer, with its skeleton in
the same file and the same component. Props are `{ surface: SizeGuideSurface }`
(plus a callback if it is interactive, like `NextActionsBar`). Wrap in
`<section className="surface">` with a `surface-header` / `surface-kicker`
so it sits consistently with the others.

**4. `src/app/components/SurfaceOutlet.tsx`** — add the dispatch case. The
switch has no exhaustiveness guard, so a missing case renders nothing with no
error. Verify visually.

**5. `src/styles.css`** — classes for the surface and its skeleton, using the
`#root` tokens. Keep them near the related surface styles.

**6. `src/app/mock-catalog.ts`** — a `buildSizeGuideSkeleton()` and a
`buildSizeGuideSnapshot(...)`, wired into a scenario's `activitySnapshots` in
loading-then-complete order. `emitIntermediateSnapshots` emits everything
except the last entry early, so the final entry should be the completed
surface. **Without this the surface is unreachable in mock mode** — which is
the mode most people will run. Emit the skeleton no later than
`buildNextActionsSkeleton()` if you want the surface above the actions bar
(rule 2).

**Then:** update the README's architecture table and the loading-placeholder
table, run `npm run build` (the type gate) and `npm test`, and check the
scenario in the dev server.

## Changing an existing surface

Presentation-only (layout, copy, styling): edit the component and
`styles.css`. Nothing else.

New data on the surface: you need the parser and `models.ts` too — and the
data has to actually exist in the stream. If the server does not send it,
say so rather than synthesizing it. For extra **product** attributes there is
no type change needed: `ProductRecord` has an index signature
(`[key: string]: string | number | undefined`) and `valueMapToRecord` copies
every `valueString` / `valueNumber` entry through, so a new catalog attribute
is available immediately (that is how `resolution` and `form_factor` reach
`ComparisonTable`).

## Existing surfaces

| Component type | Renderer | Notes |
|---|---|---|
| `ProductCarousel` | `ProductCarousel.tsx` | 4-up grid, 1 row up to 7 products, 2 rows at 8+; arrow scroll. The whole tile is the PDP link via `productCta`. |
| `ComparisonTable` | `ComparisonTable.tsx` | Products as columns, `attributes` as rows. |
| `ComparisonSummary` | `ComparisonSummary.tsx` | Plain text, no loading state. Renders below the Next Actions bar in the compare scenario — see rule 2. |
| `BundleDisplay` | `BundleDisplay.tsx` | Tiers → slots; each slot's product resolved from `productsBySurface[surfaceRef]`, falling back to an unvalidated `slot.product`. Renders a bundle total. |
| `NextActionsBar` | `NextActionsBar.tsx` | Chips; clicking one submits its text as the next prompt. |
| `ProductResearchCard` | `ProductResearchCard.tsx` | Summary + bullets + one product. See the gap below. |
| `ProductCard` | — | Protocol-only. The parser skips it deliberately: it describes per-product bindings inside a higher-level surface, and rendering it standalone is not a thing. |

## Known gap: ProductResearchCard

`ProductResearchCard` is wired through `CommerceSurfaceComponentType`, the
parser, `SurfaceOutlet`, and its component — but it is **not** in the
`SurfaceComponentPayload` union in `models.ts`, and **no mock scenario emits
it**. So it renders only against a live agent that sends it.

Two things follow, and they are not the same thing. First, if someone reports
"the research card never shows up", the cause is step 6 alone. Adding a mock
scenario is enough: the card renders and type-checks today with no `models.ts`
change, because `MockScenario` types operations as `Record<string, unknown>[]`
(`mock-catalog.ts:107-111`), `A2UIOperation` admits that same shape
(`models.ts:159-163`), and the parser reads the component key off
`Object.keys(component.component)` at runtime (`a2ui-parser.ts:277-283`).
Sending someone to edit `models.ts` for this changes nothing on screen.

Second, the missing `SurfaceComponentPayload` entry is a separate, real
defect — but a documentary one. That union is never a gate: the parser casts
the payload to `Record<string, Record<string, unknown>>` and index-reads each
field, so adding the entry records the wire contract for the next reader
without making anything appear or catching a field drift. Fix both; expect
only step 6 to change what you see.

The checklist's genuinely silent failure modes are step 6 and step 4 (the
`SurfaceOutlet` switch has no exhaustiveness guard). Step 1 is not one of
them: a real omission from `CommerceSurfaceComponentType` or
`RenderableCommerceSurface` stops the build instead.
