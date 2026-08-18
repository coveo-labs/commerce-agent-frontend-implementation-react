# Commerce Agent Frontend Implementation — React

A React reference application that demonstrates how to embed Coveo's
conversational commerce experience into a storefront-style frontend. It is
the React counterpart of
[`coveo-labs/commerce-agent-frontend-implementation-angular`](https://github.com/coveo-labs/commerce-agent-frontend-implementation-angular),
built with a generic, professional **Conversational Discovery** theme so any
solution adopter can use the same codebase as the starting point for their
own integration.

The app showcases:

- A **storefront-style search bar** that automatically routes queries
  between classic search and a conversational AI assistant based on
  configurable rules.
- Live **Coveo Query Suggestions** for the search dropdown.
- A **conversational transcript** that streams AG-UI events from
  `/commerce/unstable/agentic/converse`, parses A2UI operations, and
  renders rich product surfaces inline (carousel, comparison table,
  bundles, product research card, next-actions bar).
- **Episode-style chat history** — every prompt + answer + surfaces is
  preserved as the user keeps typing.
- **Conversation history** persisted to localStorage with a header
  dropdown (select / delete / new chat).
- **Client-side feedback & observability** — thumbs-up/down with reasons
  and comments on every answer, a whole-conversation rating, per-turn
  operational telemetry, and a redacted/diagnostic **JSON export** of any
  selected conversations. A browser-local stopgap for a future Coveo
  feedback endpoint — see
  [Feedback, telemetry & export](#feedback-telemetry--export-client-side-stopgap).
- A **single configuration file** ([`src/app/discovery-config.ts`](src/app/discovery-config.ts))
  that owns every demo-tunable behavior.

The mock catalog ships with generic placeholder products (security cameras,
recorders, cabling) — swap [`src/app/mock-catalog.ts`](src/app/mock-catalog.ts)
for your own domain, or go straight to live mode against your organization.

The upstream Angular README (which documents the AG-UI / A2UI protocols this
app implements) is preserved under
[`docs/README-upstream.md`](docs/README-upstream.md).

---

## Quick start

```bash
npm install
npm run dev        # → http://localhost:5173/
```

The app starts in **mock mode**: a local generator streams the same AG-UI
event sequence a live agent would, so every surface renders without any
credentials.

To exercise live mode against a Coveo organization:

1. Open `http://localhost:5173/` and flip the **Use live path** toggle in
   the top-right conversation popover.
2. Click the **Connection** button that appears and paste a fresh
   **Bearer token** plus the **organization ID** and region.
3. Type a query in the search bar (or pick a chip from the empty state).

Token retrieval: open a storefront running Coveo in a browser, DevTools →
Network → filter `coveo`, trigger any search, copy the `Authorization`
header value from one of the requests, paste it into the panel. (See
[Live connection](#live-connection) below for details.)

---

## What the app does, end to end

```
┌────────────────────────────────────────────────────────────────────┐
│  Storefront header                                                 │
│  ┌──────────┬──────────────────────────────┬─────────────────────┐ │
│  │ Brand    │  ⌕  search box  ✦ toggle  Search│  conversation ▾  │ │
│  └──────────┴──────────────────────────────┴─────────────────────┘ │
│                  ↓ classic                ↓ conversational         │
│           handleClassicSearch()   conversationStore.submitPrompt() │
└────────────────────────────────────────────────────────────────────┘
                                                ↓
                        POST /commerce/unstable/agentic/converse
                                                ↓
                           SSE: AG-UI events (text + activity)
                                                ↓
                          a2ui-parser → renderable surfaces
                                                ↓
                ┌───────────────────────────────────────────────┐
                │  Transcript                                   │
                │   ┌─────────────────────────┐                 │
                │   │ Episode (past)          │                 │
                │   │  user → assistant       │                 │
                │   │  surfaces inline        │                 │
                │   └─────────────────────────┘                 │
                │   ┌─────────────────────────┐                 │
                │   │ Episode (live)          │                 │
                │   │  user → assistant       │                 │
                │   │  reasoning / surfaces   │                 │
                │   └─────────────────────────┘                 │
                │                                               │
                │   "Ask the product assistant" composer        │
                └───────────────────────────────────────────────┘
```

---

## Configuration — `discovery-config.ts`

[`src/app/discovery-config.ts`](src/app/discovery-config.ts) is the single
source of truth for everything that should be tweaked per environment or
per integration. Everything below lives in that file.

### `quickActionChips`

Suggestion chips rendered inside the empty state, before the user has
typed or sent anything. Each chip submits its `text` as a prompt.

**Mock mode only.** The chips describe the mock catalog, so the app hides
them automatically in live mode (the empty state shows a plain prompt
instead). Re-theme the list when you wire your own catalog.

```ts
quickActionChips: NextAction[] = [
  { text: 'Show me security cameras', type: 'search' },
  { text: 'Compare IP cameras', type: 'followup' },
  { text: 'Build a surveillance bundle', type: 'followup' },
];
```

Add/remove freely (and re-theme for your catalog). The `type` field is
forwarded but currently unused — it exists because the agent-driven
`NextActionsBar` surface shares the same `NextAction` shape.

### `conversationalDefaults`

Drives the **popular-queries** dropdown (the one that appears when the user
toggles the sparkle / the search box detects conversational intent).

**Mock mode only.** Like the quick-action chips, the curated queries
describe the mock catalog and are hidden automatically in live mode.

| Field | Purpose |
|---|---|
| `popularQueries` | Static, editorial-owned list of example conversational queries (edited inline in `discovery-config.ts`). |
| `maxDisplayed` | How many queries to surface at once (default `6`). |
| `shuffle` | Pick a fresh random subset every time intent is detected (`true`) vs. always list order (`false`). |
| `eyebrow` | Small uppercase header above the query grid. |
| `title` | Larger header above the query grid. |

### `searchRouting`

The complete routing brain. The component never decides anything itself —
it always calls `searchRouting.decideRoute({ query, querySuggestionsMatches })`
and uses the returned `'conversational' | 'classic'` value to pick the mode.

#### Rule precedence

`decideRoute` evaluates rules top-down — first match wins:

| # | Rule | Config field(s) | Outcome |
|---|---|---|---|
| 1 | Query contains a **classic operator** | `classicOperators` | `'classic'` |
| 2 | Query contains a **conversational operator** | `conversationalOperators` | `'conversational'` |
| 3 | Word count ≥ threshold | `conversationalWordThreshold` | `'conversational'` |
| 4 | Coveo Query Suggestions returned **N matches** for a **short** query | `querySuggestionsMinMatches`, `querySuggestionsMaxWords` | `'classic'` |
| 5 | Default | – | `'classic'` |

#### `conversationalWordThreshold` (rule 3)

Number of whitespace-delimited tokens at or above which the query is
treated as a conversational request. Default `6`. Tune lower if your
shoppers tend to type shorter requests.

#### `querySuggestionsMin*` / `querySuggestionsMax*` (rule 4)

Tells the router "this short query is a known classic-search intent".
Defaults: `MinMatches=1`, `MaxWords=5`. The router only fires this rule
once the QS service has actually returned results.

#### Conversational operators (rule 2 — always → conversational)

Words and phrases that signal a conversational request, regardless of
length. Single tokens match whole-word (regex `\b…\b`); multi-word phrases
match as case-insensitive substrings. See the list in `discovery-config.ts` —
question words, comparison terms, recommendation phrases, self-reference
("i'm looking", "help me"), cross-sell ("pair", "match"), and education
("explain", "describe").

Editorial note: words like `is`, `are`, `do`, `cost`, `price`, `style`
are deliberately **excluded** — they appear too often in legitimate
keyword searches to be useful intent signals.

#### Classic operators (rule 1 — always → classic)

```ts
classicOperators: [];   // empty by default
```

Use this list to force certain queries to bypass the AI assistant.
Typical entries: brand names, SKUs, model numbers, anything where you
want fast keyword search and zero risk of conversational interpretation.
Wins precedence ties against `conversationalOperators`.

#### Query Suggestions fetch behaviour

```ts
querySuggestionsDebounceMs: 200,
querySuggestionsMinQueryLength: 2,
querySuggestionsCommerceSuffix: 'v2/search/querySuggest',
```

These tune the [`query-suggestions.service.ts`](src/app/services/query-suggestions.service.ts)
client which is invoked on every keystroke (debounced) while the user types.

The suffix is appended after `/commerce/` of the resolved Commerce
endpoint, so by default the service hits:

```
POST {host}/rest/organizations/{orgId}/commerce/v2/search/querySuggest
```

…using the same auth token, region, locale and clientId as `/converse`.

#### `handleClassicSearch(query)`

The hook called when the user submits a classic-mode search. In the demo
it pops a `window.alert(...)` showing what the route would look like (so
you can prove routing decisions visually). For a real integration:

```ts
handleClassicSearch(query: string): void {
  // e.g. React Router
  navigate(`/search?query=${encodeURIComponent(query)}`);
}
```

---

## Conversation history (localStorage)

A header **History** dropdown keeps a list of past conversations in
`localStorage`, and a dedicated **"New conversation"** button (top-right)
starts a fresh chat (the current one is auto-saved).

- **Storage key:** `discovery-demo-conversations` — a JSON array of saved
  conversations (full persisted state + a stable local `id`, a `title`
  derived from the first user message, and `createdAt` / `updatedAt`).
  Newest first, capped at `historyCopy.maxConversations` (default `50`).
- **Migration:** a legacy single-conversation key `discovery-demo-conversation`
  is migrated into the list on first load.
- **Logic + porting guide:** see the header comment in
  [`services/conversation-history-store.ts`](src/app/services/conversation-history-store.ts);
  the UI is
  [`components/ConversationHistory.tsx`](src/app/components/ConversationHistory.tsx).

---

## Feedback, telemetry & export (client-side stopgap)

A browser-local implementation of answer/session feedback and operational
telemetry, designed to be replaced by an official Coveo feedback endpoint
later (the plan of record lives in
[`docs/feedback-observability-plan.md`](docs/feedback-observability-plan.md)).

- **Answer feedback** — thumbs-up/down under each assistant answer
  (disabled while it streams), with optional typed reasons and a comment
  (max 2,000 chars). Editable; edits keep the record's id and creation
  time.
- **Session feedback** — a "Rate this conversation" block
  (resolved / partially resolved / not resolved + comment) once the
  conversation has at least one answer.
- **Turn telemetry** — per-prompt records: start / first-response /
  finish timestamps, latency and duration, outcome
  (`running | succeeded | failed | cancelled | interrupted`), sanitized
  structured errors, tool and surface summaries, and the effective
  connection context captured at submission time. Server ids (`runId`,
  assistant `messageId`, `conversationSessionId`) are stored as optional
  correlation data only.
- **Errors are not chat messages** — a failed run keeps any partial
  answer and renders a distinct error alert; cancellations and
  interruptions render as neutral notices.
- **Export** — the header **Export** button opens a dialog listing all
  saved conversations (select one, many, or all) and downloads a
  versioned JSON envelope in one of two profiles:
  - **redacted** — transcript, feedback, telemetry, ids, structured
    errors; excludes client id, reasoning, tool args/results, state
    snapshots, and full surface payloads (product IDs are kept).
  - **diagnostic** — adds those diagnostic fields; requires an explicit
    confirmation on every download.
  Both profiles always exclude bearer tokens, conversation continuation
  tokens, and auth-store contents.
- **Storage health** — persistence failures are surfaced as a
  non-blocking warning (quota errors detected separately); the in-memory
  state stays exportable even when writes fail.

Everything is persisted inside the existing conversation records
(localStorage key `discovery-demo-conversations`, `schemaVersion: 1` —
older records are migrated on load). The UI submits through the
`FeedbackSink` interface ([`services/feedback-sink.ts`](src/app/services/feedback-sink.ts));
swapping in a remote sink later requires no UI changes.

**Accepted tradeoffs** (by design, this is a demo-grade stopgap):

- Feedback lifetime is bounded by conversation retention — deleting a
  conversation or aging out of the 50-conversation cap removes its
  feedback and telemetry.
- Multi-tab persistence remains last-writer-wins.

---

## Product CTA (PDP links)

Each product tile in the carousel shows a **"View details"** CTA. All PDP
routing lives in one placeholder — `productCta.buildPdpUrl(product)` in
`discovery-config.ts` — which the integrating team replaces with the real
PDP URL pattern. The carousel component just delegates to it; no component
edits are needed to wire production links.

---

## Live connection

Live mode (the **Use live path** toggle) hits Coveo's Commerce conversational
endpoint. The connection details live in two layered places:

### 1. `demo-agent.config.ts` (defaults)

[`src/app/demo-agent.config.ts`](src/app/demo-agent.config.ts) holds the
shipped defaults:

```ts
liveEndpoint:  'https://platformdev.cloud.coveo.com/rest/organizations/' +
                '<your-org-id>/commerce/unstable/' +
                'agentic/converse',
liveRequestDefaults: {
  trackingId: 'commerce_demo',
  language:   'en',
  country:    'US',
  currency:   'USD',
  clientId:   '',           // auto-generated UUID per visitor
},
```

For your integration, change the orgId in the URL path and the locale
fields here, or override per-visitor via the live-connection panel below.

### 2. `auth-token-store.ts` (per-visitor overrides)

The **Connection** popover writes to localStorage via
[`auth-token-store.ts`](src/app/services/auth-token-store.ts). All
overrides are optional; whatever's set wins over the static config above:

| Override | Persisted as |
|---|---|
| Bearer token | `discovery-demo-auth-token` |
| Organization ID | `discovery-demo-org-id` |
| Region (`au`/`na`/`eu`/`dev`) | `discovery-demo-region` |
| Tracking ID | `discovery-demo-tracking-id` |
| Language / Country / Currency | `discovery-demo-language`, etc. |
| Client ID (visitor UUID) | `discovery-demo-client-id` |

The store also exposes `resolveEndpoint(defaultUrl)` which combines the
selected region's host (e.g. `platform.cloud.coveo.com`) with the selected
org id and the original endpoint path — this is the URL both `/converse`
and `/querySuggest` ultimately hit.

### Token tips

- Coveo Search-API tokens are JWTs (`eyJ…`) issued via Coveo's token
  endpoint. They expire (typically 24h). Refresh by re-pasting.
- `Bearer ` prefix is optional — the input strips/normalizes it.
- The token is masked in the header button (`••••<last-4>`).

---

## Architecture cheat sheet

| File | Role |
|---|---|
| [`App.tsx`](src/App.tsx) | Top-level layout: storefront header (brand · search · controls) → workspace (transcript) → fixed composer bar. Tracks `searchExpanded` for the focus de-emphasis animation. |
| [`discovery-config.ts`](src/app/discovery-config.ts) | All per-environment knobs. **Start here** when tuning behavior. |
| [`models.ts`](src/app/models.ts) | TypeScript shapes for AG-UI events, A2UI ops, product records, surface types. |
| [`a2ui-parser.ts`](src/app/a2ui-parser.ts) | Reduces a stream of A2UI operations into renderable surface state. Skeleton surfaces are auto-dismissed once their real counterpart arrives. |
| [`markdown.ts`](src/app/markdown.ts) | Renders assistant text as markdown using `marked`. |
| [`store.ts`](src/app/store.ts) | Tiny observable-store primitive + `useStoreState` hook (`useSyncExternalStore`). Trivially swappable for Zustand/Redux/Jotai. |
| [`mock-catalog.ts`](src/app/mock-catalog.ts) | Generic placeholder products + the three mock scenarios (discovery, comparison, bundle). Re-theme for your catalog. |
| **Components** | |
| [`StorefrontSearchBox.tsx`](src/app/components/StorefrontSearchBox.tsx) | Header search bar with toggle, dropdown (QS suggestions / **popular queries** on conversational intent). Purely presentational — defers all routing to `discovery-config`. |
| [`ConversationHistory.tsx`](src/app/components/ConversationHistory.tsx) | Top-right cluster: a **"New conversation"** button + the **"History"** dropdown (lists past conversations with select / delete). |
| [`PromptComposer.tsx`](src/app/components/PromptComposer.tsx) | Bottom "Ask the product assistant" textarea. Plain Enter submits, Shift+Enter newlines. |
| [`TranscriptPanel.tsx`](src/app/components/TranscriptPanel.tsx) | Renders past + live conversation episodes. Auto-scrolls a new turn into view at submit time. |
| [`AuthTokenInput.tsx`](src/app/components/AuthTokenInput.tsx) | The Connection popover (live mode only). |
| [`ConversationHeader.tsx`](src/app/components/ConversationHeader.tsx) | The right-hand conversation popover (mode / thread / status / messages / live toggle). |
| [`ProductCarousel.tsx`](src/app/components/ProductCarousel.tsx) | 4-up product grid (1 row up to 7 results, 2 rows for 8+), with arrow navigation. Renders the **"View details" CTA** per tile via `productCta`. |
| [`ComparisonTable.tsx`](src/app/components/ComparisonTable.tsx) | Products as columns, attributes as rows. |
| [`BundleDisplay.tsx`](src/app/components/BundleDisplay.tsx) | Per-tier bundle slots with image, name, brand, price, and a **bundle total** footer. |
| [`ProductResearchCard.tsx`](src/app/components/ProductResearchCard.tsx) | "AI-Generated Summary" card with image, summary copy, and a Key Features bullet list. |
| [`ComparisonSummary.tsx`](src/app/components/ComparisonSummary.tsx) | Plain-text summary surface used after a comparison. |
| [`NextActionsBar.tsx`](src/app/components/NextActionsBar.tsx) | Suggested-next-step chips. Click a chip → submit the prompt. |
| [`SurfaceOutlet.tsx`](src/app/components/SurfaceOutlet.tsx) | Dispatches each `RenderableCommerceSurface` to its renderer. |
| **Services (singleton stores)** | |
| [`conversation-store.ts`](src/app/services/conversation-store.ts) | Owns the conversation state (messages, surfaces, reasoning, tool activity, completed turns). The single entry point for the UI. |
| [`agent-demo.service.ts`](src/app/services/agent-demo.service.ts) | Wraps the live `/converse` SSE stream and the mock-mode generator under a common `streamTurn(...)` API. |
| [`ag-ui-client-transport.ts`](src/app/services/ag-ui-client-transport.ts) | Alternative live transport that uses the official `@ag-ui/client` SDK. |
| [`auth-token-store.ts`](src/app/services/auth-token-store.ts) | Stores and exposes the live-connection overrides. |
| [`query-suggestions.service.ts`](src/app/services/query-suggestions.service.ts) | Debounced Coveo `/querySuggest` client (`useQuerySuggestions` hook). |
| [`conversation-history-store.ts`](src/app/services/conversation-history-store.ts) | Owns the localStorage list of saved conversations + the active one. Hydrates the conversation store on switch; snapshots it on every turn. Schema migration + storage health. |
| [`feedback-sink.ts`](src/app/services/feedback-sink.ts) | `FeedbackSubmissionV1` DTO + async `FeedbackSink` boundary; `LocalFeedbackSink` validates and writes into the conversation store. |
| [`conversation-export.ts`](src/app/services/conversation-export.ts) | Builds the versioned export envelope (turn unification, redacted/diagnostic profiles, recursive product-id collection). |
| [`connection-context.ts`](src/app/services/connection-context.ts) | Resolves the effective connection context (org, region, locale, transport) captured into each turn's telemetry. |
| [`AnswerFeedbackControl.tsx`](src/app/components/AnswerFeedbackControl.tsx) | Thumbs + reasons/comment form under each assistant answer. |
| [`SessionFeedbackControl.tsx`](src/app/components/SessionFeedbackControl.tsx) | "Rate this conversation" block after the transcript. |
| [`ExportConversationsDialog.tsx`](src/app/components/ExportConversationsDialog.tsx) | Multi-select export dialog with redacted/diagnostic downloads. |

---

## Routing examples

With the default config, here's what each query does:

| Query | Decision | Why |
|---|---|---|
| `camera` | classic | rule 5 default (or rule 4 if QS hits) |
| `cat6 cable box` | classic | rule 5 default |
| `4mp dome camera` | classic | rule 4 (QS hit + ≤ 5 words) |
| `which camera suits a small store` | conversational | rule 2 (`which`) |
| `compare the dome and bullet cameras` | conversational | rule 2 (`compare`) |
| `vs the 8MP bullet` | conversational | rule 2 (`vs`) |
| `help me find an NVR` | conversational | rule 2 (`help me`) |
| `i'm looking for a video doorbell` | conversational | rule 2 (`i'm looking`) |
| `pair the dome camera with` | conversational | rule 2 (`pair`) |
| `surveillance coverage for a two-floor retail space` | conversational | rule 3 (≥ 6 words) |
| `show me a camera for a small warehouse` | conversational | rule 3 (also matches `show me`) |
| `whatever camera` | classic | `\bwhat\b` doesn't match mid-word |

To force `compare dome and bullet cameras` to classic search instead — for
example, because you'd rather Coveo search handle in-stock product
comparisons — add the product names (or IDs) to `classicOperators`:

```ts
classicOperators: ['dome', 'bullet', '24640107']
```

…and rule 1 will pre-empt rule 2.

---

## Episode-style transcript

Each prompt creates a new "episode" — a section that contains:

- The user's bubble
- An optional progress block (reasoning + tool activity, while live)
- The assistant's bubble (markdown-rendered)
- Inline surfaces (carousels, comparison, bundles, research card,
  next-actions chips)

Submitting a new prompt:

1. **Snapshots the prior episode** into `completedTurns` (state owned by
   [`conversation-store.ts`](src/app/services/conversation-store.ts)).
2. **Resets** the live state (messages, surfaces, reasoning, tool
   activity).
3. **Auto-scrolls** the new (live) episode block to the top of the
   transcript area, so the user sees the new turn fill the viewport
   while the prior turn is still reachable by scrolling up.

`completedTurns` is persisted to localStorage along with the rest of the
conversation state, so refreshing the tab keeps the full episode chain.

---

## Keyboard / UX details

- **Plain Enter** in either the search bar or the bottom composer submits.
- **Shift+Enter** in the composer inserts a newline.
- **Esc** in the search bar closes the dropdown.
- Clicking the **sparkle toggle** flips the mode and stays in the user's
  chosen mode until the field is cleared (then auto-routing resumes).
- Clicking outside the search bar closes the dropdown and restores the
  header emphasis.

---

## Project layout

```
.
├── public/
│   └── favicon.svg
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css                      ← Conversational Discovery theme
│   └── app/
│       ├── discovery-config.ts         ← every demo-tunable knob
│       ├── demo-agent.config.ts        ← shipped defaults for live mode
│       ├── conversation.interfaces.ts
│       ├── models.ts
│       ├── a2ui-parser.ts
│       ├── markdown.ts
│       ├── formatting.ts
│       ├── mock-catalog.ts             ← generic placeholder products
│       ├── store.ts
│       ├── components/
│       │   ├── StorefrontSearchBox.tsx
│       │   ├── ConversationHistory.tsx
│       │   ├── PromptComposer.tsx
│       │   ├── TranscriptPanel.tsx
│       │   ├── ConversationHeader.tsx
│       │   ├── AuthTokenInput.tsx
│       │   ├── SurfaceOutlet.tsx
│       │   ├── ProductCarousel.tsx
│       │   ├── ComparisonTable.tsx
│       │   ├── ComparisonSummary.tsx
│       │   ├── BundleDisplay.tsx
│       │   ├── NextActionsBar.tsx
│       │   └── ProductResearchCard.tsx
│       └── services/
│           ├── conversation-store.ts
│           ├── agent-demo.service.ts
│           ├── ag-ui-client-transport.ts
│           ├── auth-token-store.ts
│           ├── query-suggestions.service.ts
│           └── conversation-history-store.ts
├── docs/
│   └── README-upstream.md              ← preserved upstream (Angular) README
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig*.json
```

---

## Development

### Scripts

```bash
npm run dev        # vite dev server → http://localhost:5173/
npm run build      # type-check + production build → dist/
npm run preview    # serve the production build locally
npm test           # vitest run (stores, sink, export, feedback UI)
npm run test:watch # vitest in watch mode
```

### Building for static hosting

The app is a pure single-page React bundle — no Node runtime needed.

```bash
npm run build
# → dist/
```

Drop the contents of `dist/` onto Netlify, Vercel, GitHub Pages, or
S3/CloudFront. For SPA-style hosting, ensure 404s rewrite to `index.html`
so deep links work.

---

## License & attribution

React port of
[`coveo-labs/commerce-agent-frontend-implementation-angular`](https://github.com/coveo-labs/commerce-agent-frontend-implementation-angular).
The original upstream README is at
[`docs/README-upstream.md`](docs/README-upstream.md) for reference on
the AG-UI / A2UI protocols this app implements.
