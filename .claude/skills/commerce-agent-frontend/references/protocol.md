# Protocol: AG-UI events and A2UI operations

Read this before touching `models.ts`, `a2ui-parser.ts`, the SSE
normalization in `agent-demo.service.ts`, or any mock snapshot.

These types mirror what the Coveo Commerce agentic endpoint actually sends.
They are a **contract**, not an internal model. Adding a speculative field
makes the reference implementation lie to the adopters copying it — if the
data you need isn't in the stream, propose it as a server change and say so.
The upstream Angular README, preserved at `docs/README-upstream.md`, is the
protocol's own documentation; consult it when something here is ambiguous.

## Contents

- [The request](#the-request)
- [SSE framing and normalization](#sse-framing-and-normalization)
- [AG-UI events](#ag-ui-events)
- [A2UI operations](#a2ui-operations)
- [valueMap encoding](#valuemap-encoding)
- [Writing a mock snapshot](#writing-a-mock-snapshot)

## The request

`POST {resolvedEndpoint}` with `Authorization: Bearer <token>` and:

```jsonc
{
  "trackingId": "commerce_demo",
  "language": "en",
  "country": "US",
  "currency": "USD",
  "clientId": "<per-visitor uuid>",
  "message": "<the user prompt>",
  "conversationSessionId": "<threadId, or the id the server returned>",
  "conversationToken": "<continuation token, omitted on the first turn>",
  "context": { "view": { "url": "<window.location.href>" } }
}
```

Built by `buildLiveRequestBody`. The endpoint comes from
`authTokenStore.resolveEndpoint(demoAgentConfig.liveEndpoint)` — it swaps the
host for the selected region and rewrites the `/organizations/<id>/` path
segment; the rest of the path is left as configured. Default path:
`/rest/organizations/{orgId}/commerce/unstable/agentic/converse`.

That body belongs to the `custom-fetch` transport —
`demoAgentConfig.liveTransport`'s default, and the only live path the rest of
this file describes. The `'ag-ui-client'` alternative
(`services/ag-ui-client-transport.ts`) never calls
`buildLiveRequestBody`: it posts the SDK's `RunAgentInput` (`threadId`,
`runId`, `state`, `tools`, `context`, `forwardedProps`, `messages[]`) — none
of the commerce fields above, an AG-UI `context` array instead of
`{ view: { url } }`, and no `conversationSessionId` / `conversationToken`. Its
`RUN_STARTED` / `RUN_FINISHED` normalizers keep only `threadId` and `runId`,
so the continuation values below are never read back either; continuity rests
entirely on the backend honouring the AG-UI `threadId`. It has no `RUN_ERROR`
case, so a run error hits `default: return null` and vanishes instead of
failing the turn, and the SDK parses its own stream, so the next section does
not apply. Upstream (`docs/README-upstream.md`, "Alternative AG-UI Client
Option") calls `custom-fetch` the safer default for `/converse` for exactly
this reason.

`conversationSessionId` and `conversationToken` are echoed back on
`RUN_STARTED` / `RUN_FINISHED` and fed into the next turn — that is what
makes the conversation multi-turn. Losing them silently starts a new
conversation on every prompt.

## SSE framing and normalization

The `custom-fetch` path only. `readSse` yields `{ event?, data }` frames;
`normalizeSsePayload` turns each into an `AgUiEvent`:

- Named frames map directly, renaming as they go: `turn_started` →
  `RUN_STARTED` and `turn_complete` → `RUN_FINISHED` take
  `data.conversationSessionId` as `threadId` and pass `conversationToken`
  through; `error` → `RUN_ERROR` takes `data.error` as `message`, never `code`.
- Everything else goes through `unwrapPayload`, which accepts the event
  inline (`{ type, … }`), nested under `event`, nested under `payload`, or
  bare with the SSE event name as the type.
- A frame with no `data:` line, one that doesn't parse, or one with no string
  `type`, is dropped.

New wire shapes belong in `unwrapPayload` / `normalizeSsePayload`. The
conversation store must keep seeing clean `AgUiEvent`s and nothing else.

## AG-UI events

"No store case" means the event is typed and forwarded but hits
`handleEvent`'s `default: return false` — there is no handler to go find.

| Event | Fields | Effect in the store |
|---|---|---|
| `RUN_STARTED` | `threadId?`, `runId?`, `conversationSessionId?`, `conversationToken?` | Syncs conversation context; records `runId` in telemetry. |
| `RUN_FINISHED` | same | Finalizes the turn; telemetry outcome `succeeded`. First terminal event wins — a late `RUN_ERROR` after it is ignored. |
| `RUN_ERROR` | `message`, `code?` | Telemetry outcome `failed`, code `event.code ?? 'run_error'`, status `Failed`; partial answer text kept. `TranscriptPanel` renders the message as the turn's error alert — the same alert a transport failure produces, only the code differs. |
| `TEXT_MESSAGE_START` | `messageId`, `role?` | Creates the assistant message. |
| `TEXT_MESSAGE_CONTENT` | `messageId`, `delta` | Appends; first one stamps `firstResponseAt`. |
| `TEXT_MESSAGE_END` | `messageId` | No store case. There is nothing to finalize — `TEXT_MESSAGE_CONTENT` appends in place. |
| `REASONING_START` / `REASONING_END` | `messageId` | No store case. They bracket nothing; the reasoning block is opened by `REASONING_MESSAGE_START` below. |
| `REASONING_MESSAGE_START` | `messageId`, `role?` | **Clears** `reasoningText`. A turn that opens a second reasoning block therefore drops the first block's text. |
| `REASONING_MESSAGE_CONTENT` | `messageId`, `delta` | Appends `delta` to `reasoningText`. |
| `REASONING_MESSAGE_END` | `messageId` | No store case. |
| `TOOL_CALL_START` | `toolCallId?` \| `toolUseId?`, `toolName?` \| `toolCallName?` | Adds a `running` entry to `toolActivity`; sets the status line to the tool name. |
| `TOOL_CALL_ARGS` | id, `delta?` \| `argsDelta?` | Appends to that entry's `argsPreview` (capped by `trimPreview`). |
| `TOOL_CALL_RESULT` | id, `content?` | Sets `resultPreview`. |
| `TOOL_CALL_END` | id | Marks the entry `completed`. |
| `STATE_SNAPSHOT` | `snapshot` | Stored as `latestSnapshot`; the status line takes a non-empty string `label`, else `policy_execution_state.current_state` (a nested object, not a bare string), else falls back to `Updating storefront`. |
| `ACTIVITY_SNAPSHOT` | `messageId?`, `activityType?`, `content.operations[]`, `replace?` | The surface pipeline — see below. Only `content` is read; `messageId`, `activityType` and `replace` are parsed onto the event and never consumed. |

`replace` earns its own warning: it replaces nothing.
`applyActivitySnapshot` re-seeds a draft for every surface already in state
before applying the new operations, so a snapshot always merges per surface —
`replace: true` (what the mock emits, and the `ag-ui-client` normalizer's
default) and `replace: false` behave identically; on `custom-fetch` whatever
the server sends is passed through unread. Surfaces, like `reasoningText`, `toolActivity` and
`latestSnapshot`, are cleared only by the store: on reset and at turn start.

The duplicated id and name fields (`toolCallId`/`toolUseId`,
`toolName`/`toolCallName`, `delta`/`argsDelta`) are deliberate: different
server versions use different spellings. Keep accepting both. The id is not
optional in practice — `TOOL_CALL_ARGS` / `_RESULT` / `_END` return early
without one, and `TOOL_CALL_START` invents one via `createId()`, leaving that
entry stuck at `running`.

## A2UI operations

Carried in `ACTIVITY_SNAPSHOT.content.operations`. Three shapes are on the
wire; the parser reads two:

```jsonc
// 1. declare a surface (wire-level only — the parser ignores this operation)
{ "beginRendering": { "surfaceId": "products-surface-cameras",
                      "root": "root-products-surface-cameras",
                      "catalogId": "coveo-commerce-v1" } }

// 2. structure — which component, and its literal/bound properties
{ "surfaceUpdate": {
    "surfaceId": "products-surface-cameras",
    "components": [{
      "id": "root-products-surface-cameras",
      "component": { "ProductCarousel": {
        "heading": { "literalString": "Cameras for a small business install" },
        "products": { "componentId": "product-card-…", "dataBinding": "/items" }
      }}
    }] } }

// 3. data — products or actions for that surface
{ "dataModelUpdate": {
    "surfaceId": "products-surface-cameras",
    "contents": [{ "key": "items", "valueMap": [ /* product entries */ ] }] } }
```

Notes the parser depends on:

- `beginRendering` — `root` and `catalogId` included — is typed and accepted
  but never read, and neither is the `root-…` value in `components[].id`.
  Surfaces are created lazily by `ensureDraft`, keyed by `surfaceId` alone:
  the first `surfaceUpdate` component for a surface creates it, as does a
  `dataModelUpdate` whose key is `actions`. So a `beginRendering`-only
  snapshot renders nothing — not a placeholder — and render order follows
  first draft creation. Mocks still emit it to mirror the wire format.
- Each `components[].component` object must have **exactly one** key — the
  component type. Anything else is skipped.
- `ProductCard` is skipped on purpose: it describes per-product bindings
  inside a higher-level surface, not a standalone surface. The full set of
  component types the parser handles is tabled in `references/surfaces.md`.
- Scalar property values are `{ literalString }` or `{ path }`;
  `readLiteralOrPath` prefers `literalString`, falls back to the raw `path`
  string, and returns `''` for a non-object.
- Array-valued properties do **not** follow that rule uniformly — check the
  parser branch for the component you are encoding. `ProductResearchCard.bullets`
  is an array of literal/path *objects*, so `bullets: ["a","b"]` yields an empty
  list; `ComparisonTable.attributes` is the opposite, a plain `string[]`, so
  `[{ "literalString": "a" }]` yields an empty list; `BundleDisplay.bundles` is
  a plain object array read with `String(...)` per field. All three drop bad
  elements silently, with no type error.
- `isLoading: true` marks the loading state; its absence means loaded (the
  parser reads `payload?.['isLoading'] === true`). `ComparisonSummary` has none.
- `dataModelUpdate` keys the parser understands: `items`, which fills
  `productsBySurface[surfaceId]` and creates no surface (`ProductCarousel`,
  `ComparisonTable`, `ProductResearchCard` and bundle slots consume it), and
  `actions`, which creates or retypes that surface's `NextActionsBar` draft.
  A new key needs a new branch.
- `BundleDisplay.bundles[].slots[].surfaceRef` points at another surface id;
  the slot's product is resolved from `productsBySurface[surfaceRef]`, which
  is rebuilt per snapshot and never seeded from prior state. The referenced
  `items` must therefore arrive in the **same** snapshot as the bundle, or the
  slot falls back to an inline `slot.product`, else `null`.

## valueMap encoding

Data arrives as key/value entries rather than plain JSON objects:

```jsonc
{ "valueMap": [
    { "key": "ec_product_id", "valueString": "cam-dome-4mp" },
    { "key": "ec_name",       "valueString": "4MP Indoor Dome IP Camera" },
    { "key": "ec_price",      "valueNumber": 249 }
] }
```

`valueMapToRecord` flattens these, skipping any entry with neither
`valueString` nor `valueNumber`; `toProductRecord` then requires a non-empty
`ec_product_id` **and** `ec_name` and drops the item otherwise. Every other
key is copied through unchanged, which is how arbitrary catalog attributes
(`resolution`, `form_factor`, …) reach the comparison table with no type
change.

`ec_promo_price` **must** be `valueNumber`: `toProductRecord` guards it with
`typeof === 'number'`, so a `valueString` becomes `undefined` — the promo
price and the carousel's "Sale price" tag silently disappear and every
consumer falls back to `ec_price`. That is data loss, not a formatting bug;
`formatPrice` is the wrong place to look. `ec_price` goes through `Number()`,
so a numeric string happens to render identically; send `valueNumber` anyway,
because `"$249"` or `"1,299"` yields `NaN` and renders as `$NaN`.

`toNextAction` requires a non-empty `text`; `type` is optional and defaults to
`followup` when absent. A `type` that is present but is neither `search` nor
`followup` — an empty string included — drops the entry.

## Writing a mock snapshot

Mirror the wire format exactly — mock snapshots are also documentation of
what the server sends. The builders in `mock-catalog.ts` are the pattern:
`buildProductItems(products)` and `buildActionsItems(actions)` do the
`valueMap` encoding for you.

Order inside a scenario's `activitySnapshots` matters:
`emitIntermediateSnapshots` emits every entry **except the last** with a
150 ms gap; the last one is emitted after the assistant text, just before
`RUN_FINISHED`. So put the loading/skeleton snapshots first and the completed
surface last.

Prompt matching in `getMockScenario` is keyword-based on the lowercased
prompt (`bundle`/`kit`, `compare`/`vs`, else the carousel default). These are
unanchored substring tests, so an unrelated prompt containing `TVs` still
lands on the comparison branch. Adding a scenario means adding a keyword
branch — pick words a demoer would naturally type, and keep the fallback
reachable.
