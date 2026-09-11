---
name: commerce-agent-frontend
description: Implement changes to the Coveo commerce-agent-frontend reference app — the React storefront demo that streams AG-UI events from Coveo's `/commerce/unstable/agentic/converse` API and renders A2UI commerce surfaces. Use it whenever work touches that repo or a clone of it — re-theming or rebranding the demo for a customer, swapping the mock catalog, wiring live mode to a Coveo org, changing PDP / product CTA links, tuning classic-vs-conversational search routing, adding or editing a surface renderer (ProductCarousel, ComparisonTable, BundleDisplay, NextActionsBar…), loading skeletons, or the conversation store, streaming transport, conversation history, feedback and export layers. Also when someone says "the converse demo", "the commerce agent frontend", or "the agentic storefront demo" without naming the repo. Not for the IntentState Vite+React+Mantine prototype, even when that is called a CPD or conversational product discovery demo — route that to `intentstate-orchestrator`.
---

# Commerce Agent Frontend

## What this repo is

`coveo-labs/commerce-agent-frontend-implementation-react` is a **reference
implementation**, not a product. It shows adopters how to embed Coveo's
Conversational Product Discovery into a storefront. Its audience is Coveo
solution architects demoing to prospects, and customer engineers copying it
as the starting point for a real integration.

That audience shapes every decision here: the code is read as much as it is
run, so clarity beats cleverness, and a change that quietly breaks the demo
in front of a customer is worse than a change that ships a day later.

The pipeline, end to end:

```
search box / composer
  → conversationStore.submitPrompt()
  → agent-demo.service streamTurn()        ← mock generator OR live SSE
  → AG-UI events (text · reasoning · tools · ACTIVITY_SNAPSHOT)
  → a2ui-parser.applyActivitySnapshot()    ← A2UI ops → surface state
  → getRenderableSurfaces()                ← ordering + skeleton dismissal
  → SurfaceOutlet → one renderer per componentType
```

The two ends are contracts you do not control: the **agent** decides which
A2UI surfaces to send, and the **integrator** decides what a product link or
a brand looks like. Almost everything worth changing lives at one of those
two ends — not in the middle.

## Before you edit

Spend the first two minutes on this, every time. It is what separates a
change that lands from a change that gets rewritten:

1. Read `README.md` — it is unusually complete and documents intent, not just
   structure.
2. Read `src/app/discovery-config.ts` end to end. Most requests are already a
   knob in there.
3. Decide: **configuration, catalog, renderer, or plumbing?** Use the routing
   table below. If the answer is "configuration" and you are about to open a
   component file, stop and re-read the config.

## Where changes go

| The request | Edit this | Do NOT edit |
|---|---|---|
| PDP links, CTA label, click analytics | `discovery-config.ts` → `productCta` | `ProductCarousel.tsx` |
| Which queries go to the AI vs. classic search | `discovery-config.ts` → `searchRouting` operators/thresholds | `StorefrontSearchBox.tsx` |
| What classic search does on submit | `discovery-config.ts` → `handleClassicSearch` | anything else |
| Starter chips, popular queries, history copy | `discovery-config.ts` → `quickActionChips`, `conversationalDefaults`, `historyCopy` | components |
| Demo products, mock answers, mock scenarios | `mock-catalog.ts` | the parser or the store |
| Org, region, locale, endpoint defaults | `demo-agent.config.ts` (+ `livePresets`) | hardcoding into services |
| Brand name / colors / spacing | `src/styles.css` tokens on `#root` **and the inlined accent literals** (see Conventions), brand text in `App.tsx` | per-component inline styles |
| How a surface *looks* | `src/app/components/<Surface>.tsx` + `styles.css` | `a2ui-parser.ts` |
| A new surface type the agent can send | 6 files — see `references/surfaces.md` | — |
| Streaming, turn lifecycle, telemetry, persistence | `services/` — see `references/architecture.md` | components |

Read the matching reference file **before** writing code:

- `references/architecture.md` — state model, store contracts, streaming
  lifecycle, persistence, feedback/export, and the full file map. Read this
  for anything under `src/app/services/`.
- `references/surfaces.md` — the A2UI surface pipeline and the exact
  checklist for adding or changing a surface renderer.
- `references/protocol.md` — the AG-UI event and A2UI operation reference.
  Read before touching `a2ui-parser.ts`, `models.ts`, or mock snapshots.
- `references/customizing.md` — re-theming, re-catalogging, live-mode
  wiring, and routing tuning. Read for any "make this look/behave like
  customer X" request.

## Invariants

These hold across the whole repo. Each exists for a reason worth keeping.

**Configuration over component edits.** `discovery-config.ts` is advertised
in the README as the one file an adopter must touch. Every value you inline
into a component is a value the next integrator has to hunt for. If a request
needs a new tunable, add it to the config with a doc comment and have the
component read it.

**Loading-first, content-shaped.** The agent sends a loading surface before
the completed one so the shopper gets contextual feedback while retrieval
runs. A new renderer ships its skeleton in the same change, and the skeleton
mirrors the real layout — image blocks where images go, a price bar where the
price goes. Reserve the space; never render invented product names, prices,
or imagery in a loading state. A demo that shows a fake price for 400ms is a
demo that shows a customer a fake price.

**Respect `prefers-reduced-motion`.** The CSS shimmer is disabled under that
preference and `SkeletonReveal` uses `useReducedMotion()`. Any animation you
add follows suit.

**Never invent protocol fields.** `models.ts` mirrors what the server
actually sends. Adding a speculative field to an AG-UI event or A2UI
component makes the reference lie about the contract. If the data you need
isn't in the stream, say so and propose it as a server-side change rather
than faking it client-side. Product records are the one open shape:
`ProductRecord` has an index signature, so extra catalog attributes flow
through `dataModelUpdate` without a type change.

**Mock and live must both keep working.** Mock mode is how the demo runs with
zero credentials — it is the default and the path most people will ever see.
Live mode is how it proves itself against a real org. A change that only
works in one of them is half a change. Mock scenarios live in
`mock-catalog.ts`; live goes through `agent-demo.service.ts`.

**State lives in stores, not components.** `conversationStore`,
`conversationHistoryStore`, and `authTokenStore` are module-level singletons
built on the tiny `Store` class in `store.ts`; components subscribe with
`useStoreState` and call store methods. Adding component-local state that
duplicates store state is how the transcript and the saved history drift
apart. See `references/architecture.md` before changing store shape —
`PersistedConversation` is versioned and migrated.

**No secrets in the repo.** Bearer tokens are pasted at runtime into the
Connection panel and kept in localStorage. `livePresets` deliberately carries
org/region/locale but never a token. Never commit a token, and never add one
to a preset, a test fixture, or a default. (`demoAgentConfig.liveHeaders`
does ship a literal `Bearer your-token-here` placeholder, which is spread
into every live request and only overridden once the Connection panel is
filled in — so a blank panel produces a 401 that reads like an expired token.
That is pre-existing; don't mistake it for a leak, and don't replace it with
a real one.)

**Demo credibility.** This app is shown to prospects. Placeholder products are
generic on purpose (`SecureLine` cameras, `placehold.co` images). If you swap
in a customer's catalog, keep it plausible and internally consistent — prices
that match the products, images that load, comparison attributes that
actually differ between items.

## Verifying your change

Never report a change as done on this repo without running these. The build
is fast (~1s) and the suite is ~2s; there is no excuse for skipping them.

```bash
npm install          # first time only
npm test             # vitest run — stores, sink, export, feedback UI
npm run build        # tsc -b && vite build — the type check matters
npm run dev          # http://localhost:5173/
```

`npm run build` runs `tsc -b` first, so it is the real type gate — `npm test`
alone will not catch a broken type. Run both.

For anything visible, actually look at it in the dev server rather than
asserting it works. Drive the mock scenarios by their trigger words — type
them into the bottom **"Ask the product assistant" composer**
(`PromptComposer`), which calls `submitPrompt()` directly and so always
reaches the agent:

| Type this | You should see |
|---|---|
| `Show me security cameras` | carousel skeleton → 3-product carousel + next actions |
| `Compare IP cameras` | comparison skeleton → comparison table + summary |
| `Build a surveillance bundle` | bundle skeleton → tiered bundle with total |

Drive these from the **bottom composer**, which always goes to the agent. The
header search box is *routed*, and `Build a surveillance bundle` routes to
classic search — you get the `handleClassicSearch` alert, not the bundle
(why, and how to tune it: `references/customizing.md` → *Tuning search
routing*). The empty-state chips carry the same three phrases but render only
before the first turn and only in mock mode.

`scripts/check.sh` runs the full gate plus a scan for the mistakes this
codebase invites — committed tokens, PDP URLs hardcoded into components,
routing logic that bypasses `decideRoute`, half-finished re-themes,
half-registered surfaces, `isLoading` branches that render no skeleton, a
missing `prefers-reduced-motion` guard, and hardcoded external URLs in
components. Run it from the repo root, or pass the root as its one argument:

```bash
bash <skill-path>/scripts/check.sh [repo-root]
```

It exits `0` clean, `1` on a hard failure, `2` when only warnings fired. An
unmodified checkout exits `0`, but it still prints two `pre-existing` lines —
`ProductResearchCard has no mock scenario` (the known gap documented in
`references/surfaces.md`) and the `Bearer your-token-here` placeholder in
`liveHeaders`. Those are baseline facts, they do not affect the exit code, and
they are not something you broke. Any `FAIL` or `WARN` line, by contrast, came
from your change.

## Conventions

- **TypeScript, strict.** No `any`. The A2UI payloads arrive untyped, so the
  parser narrows with `typeof` guards and `filter((x): x is T => ...)` —
  follow that pattern rather than casting.
- **Named exports**, one component per file, props typed as a local
  `type <Name>Props`.
- **All CSS in `src/styles.css`**, class-based, no CSS-in-JS and no CSS
  modules. Colors come from the tokens on `#root` (`--ink`, `--muted`,
  `--line`, `--bg`, `--primary`, `--card`, …) — but **the tokens are not the
  whole palette.** The accent and the ink are also spelled out as raw `rgba()`
  channel triples on ~80 lines, which no token feeds, so changing `--primary`
  alone ships a half-indigo demo to the projector. Re-theming is the most
  common request on this repo and this is the trap it turns on: read
  `references/customizing.md` → *Re-branding* before touching colors, and let
  `check.sh`'s theme-coherence section confirm it (it fails on a moved token
  with stale literals).
- **Comments explain why.** The existing header comments in
  `discovery-config.ts`, `feedback-sink.ts`, and `conversation-history-store.ts`
  are porting guides for adopters. Preserve them; extend them when you change
  the thing they describe.
- **Tests** live beside their subject as `*.test.ts(x)` and use the shared
  fixtures in `src/test/harness.ts` — `createStoreHarness()` gives a
  `ConversationStore` with a hand-driven stream and a controllable clock, so
  lifecycle and latency assertions stay deterministic. Add tests there for
  store, parser, sink, or export changes; pure-presentation tweaks don't need
  them.

## Definition of done

- [ ] The change lives at the right layer (config / catalog / renderer /
      service), and nothing was inlined that belonged in `discovery-config.ts`.
- [ ] `npm test` and `npm run build` both pass.
- [ ] Mock mode still renders all three scenarios; live mode still compiles
      and its request shape is unchanged (or intentionally updated).
- [ ] New surfaces have a content-shaped skeleton and respect reduced motion.
- [ ] A re-theme changed the tokens *and* the matching `rgba()` literals —
      `check.sh` theme coherence is clean, not just the token diff.
- [ ] No token, org secret, or customer-confidential data added to the repo.
- [ ] README updated if you changed a documented knob, added a surface, or
      changed the routing rules — the README is the product here, and a
      config table that has drifted is worse than no table.
