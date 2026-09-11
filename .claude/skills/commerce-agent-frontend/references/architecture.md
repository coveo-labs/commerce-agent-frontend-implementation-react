# Architecture

Read this before changing anything under `src/app/services/`, the shape of
persisted state, or the turn lifecycle.

## Contents

- [File map](#file-map)
- [The store primitive](#the-store-primitive)
- [conversationStore — the turn lifecycle](#conversationstore--the-turn-lifecycle)
- [Episodes and completedTurns](#episodes-and-completedturns)
- [agent-demo.service — the transport boundary](#agent-demoservice--the-transport-boundary)
- [Live connection resolution](#live-connection-resolution)
- [Persistence and history](#persistence-and-history)
- [Feedback, telemetry, export](#feedback-telemetry-export)
- [Testing the services](#testing-the-services)

## File map

| File | Role |
|---|---|
| `src/App.tsx` | Layout only: header (brand · search · connection · conversation popover) → workspace (history + transcript) → fixed composer bar. Holds one piece of local state, `searchExpanded`. |
| `src/app/store.ts` | ~40-line observable store + `useStoreState` (`useSyncExternalStore`). |
| `src/app/models.ts` | AG-UI events, A2UI operation payloads, `ProductRecord`, renderable surface types. |
| `src/app/conversation.interfaces.ts` | Persisted shapes: `PersistedConversation`, `StoredConversation`, feedback and telemetry types, `CONVERSATION_SCHEMA_VERSION`. |
| `src/app/a2ui-parser.ts` | A2UI operations → ordered renderable surfaces. |
| `src/app/discovery-config.ts` | Every per-integration knob. |
| `src/app/demo-agent.config.ts` | Mode, live transport choice, endpoint, `liveHeaders`, request defaults, `livePresets`. |
| `src/app/mock-catalog.ts` | Placeholder products + the three mock scenarios and their A2UI snapshots. |
| `src/app/formatting.ts` | `formatPrice`. Builds one `Intl.NumberFormat` **at module load** from `demoAgentConfig.liveRequestDefaults.currency` — see the currency note below. |
| `src/app/markdown.ts` | `renderMarkdown` — assistant text through `marked` (gfm, breaks). |
| `services/conversation-store.ts` | Conversation state and turn lifecycle. The UI's single entry point. |
| `services/agent-demo.service.ts` | `streamTurn(input, mode, observer)` over mock generator or live SSE. |
| `services/ag-ui-client-transport.ts` | Alternative live transport using the official `@ag-ui/client` SDK. |
| `services/auth-token-store.ts` | Per-visitor live overrides in localStorage; `resolveEndpoint`, `resolveRequestDefaults`. |
| `services/connection-context.ts` | Effective connection context captured into each turn's telemetry. |
| `services/query-suggestions.service.ts` | Debounced Coveo `/querySuggest` client + `useQuerySuggestions`. |
| `services/conversation-history-store.ts` | localStorage list of saved conversations, migration, storage health. |
| `services/feedback-sink.ts` | `FeedbackSubmissionV1` DTO + `FeedbackSink` boundary; `LocalFeedbackSink`. |
| `services/conversation-export.ts` | Versioned export envelope, redacted/diagnostic profiles. |

Components are not listed here. The six surface renderers plus `ProductCard`
are tabulated in `references/surfaces.md`; the rest of `src/app/components/`
is shell UI (`TranscriptPanel`, `PromptComposer`, `StorefrontSearchBox`,
`ConversationHistory`, `ConversationHeader`, `AuthTokenInput`,
`ExportConversationsDialog`, `AnswerFeedbackControl`,
`SessionFeedbackControl`, `Skeleton`) and is named in `App.tsx` in render
order.

## The store primitive

`Store<T>` in `store.ts` holds one state object, notifies a `Set` of
listeners, and exposes `getState` / `setState` / `subscribe` as bound
properties. `setState` accepts a partial (shallow-merged) or an updater
function, and bails when the updater returns the identical reference.

Every service that owns state extends or instantiates it as a module-level
singleton, which is the direct translation of the Angular original's
`@Injectable({ providedIn: 'root' })`. Components never construct stores;
they import the singleton and call `useStoreState(store)`.

Two consequences worth remembering:

- `useStoreState` subscribes to the **whole** state object, so any change
  re-renders every subscriber. That is fine at this scale; don't add
  selector machinery unless a real perf problem shows up.
- Singletons persist across tests. `src/test/setup.ts` clears `localStorage`
  in `beforeEach` for exactly this reason. Construct a fresh
  `new ConversationStore({...})` in tests rather than reaching for the
  singleton.

## conversationStore — the turn lifecycle

`ConversationStore extends Store<ConversationState>`. It takes an optional
`ConversationStoreDeps` — `streamTurn`, `now`, `connectionContext` — which is
the seam every test uses.

`submitPrompt(prompt?)` falls back to `state.draft` when called with no
argument and trims the result; if the message is empty or `busy` is true it
returns silently — no error, no state change, no signal to the caller. A
retry button, suggestion chip, or programmatic replay that fires mid-run
therefore does nothing at all. Otherwise it drives one turn:

1. Snapshot the previous episode into `completedTurns`.
2. Reset live state (messages, surfaces, reasoning, tool activity).
3. Open a telemetry record and call `deps.streamTurn(...)`, keeping the
   returned unsubscribe as `activeStream`.
4. Feed each AG-UI event through `handleEvent`.

Three private refs matter if you touch this code — two guard against late
callbacks, and one is a handle that is *not* a guard:

- `inFlight` — the attempt whose telemetry entry is still `running`. Cleared
  on finalization, hydration, and reset, so a late callback can never write
  telemetry into a different conversation.
- `activeAttempt` — the attempt whose stream callbacks are still accepted.
  Unlike `inFlight` it survives `RUN_FINISHED` (the transport's `complete()`
  still has to be processed); it is replaced by the next submit and cleared
  by `cancelActiveRun` / `resetConversation` / `hydrate`. That clearing is
  load-bearing: `isCurrent()` is the only gate on `next` / `error` /
  `complete`, and the store never relies on a transport suppressing its own
  post-cancel callbacks (the three shipped ones do; a fake or third-party one
  may not — `conversation-store.test.ts` models the latter), so
  nulling this ref is what makes a cancelled stream's late callbacks no-ops
  when no new prompt follows.
- `activeStream` — the current cancel function. `submitPrompt` only
  **overwrites** it; the previous unsubscribe is never called. A terminal
  event (`RUN_FINISHED` / `RUN_ERROR`) clears `busy` while the transport's
  `complete()` may still be pending, so a prompt submitted in that window
  orphans the prior stream. State stays correct — the `activeAttempt` guard
  drops its remaining callbacks, including its `complete()`, which is what
  stops a stale stream from nulling the new handle — but its cancel function
  is gone, so the live SSE fetch/reader is left to drain un-aborted.
  `cancelActiveRun` and `resetConversation` are the only callers that
  actually invoke the unsubscribe; `hydrate` clears the refs without it.

Turn ids are the turn's **user-message id**. `answerFeedbackByTurnId` and
`turnTelemetryByTurnId` are both keyed by it. Keep that identity — it is what
lets feedback survive a reload and correlate with telemetry.

`handleEvent` maps AG-UI events onto state: text deltas append to the
assistant message, reasoning deltas to `reasoningText`, tool events to the
`toolActivity` list, and `ACTIVITY_SNAPSHOT` through
`applyActivitySnapshot` → `getRenderableSurfaces`. Errors are **not** chat
messages: a failed run keeps whatever partial answer arrived and renders a
distinct alert; cancellation and interruption render as neutral notices.

Other entry points: `setDraft`, `useQuickAction`, `cancelActiveRun`,
`resetConversation`, `toggleAgentMode`, `setAnswerFeedback`,
`setSessionFeedback`, `hydrate`, `persistenceSnapshot`.

`hydrate` and `resetConversation` each carry a hard invariant: exactly one
`setState`, therefore exactly one notification. `conversationHistoryStore`
arms a single-shot `skipNextCapture` flag immediately before calling them, so
a second `setState` in either method silently breaks conversation switching —
the extra notification escapes the already-consumed guard and the hydrated
state is captured under the newly selected id. Fold any new field into the
existing `setState`; never add a second one. The one deliberate exception is
the history store's constructor hydrate, which runs before the capture
subscription exists and primes `lastCaptured` instead of arming the guard —
don't "fix" it. `conversation-store.test.ts` ("single-notification
invariants") and `conversation-history-store.test.ts` ("single-shot
skip-capture") pin this; keep them green.

## Episodes and completedTurns

The transcript renders a list of **episodes**. Past episodes come from
`completedTurns` (`ConversationTurn`: id, userText, assistantText, surfaces,
reasoningText, toolActivity). The live episode is assembled in
`TranscriptPanel` from `messages` + the current `surfaces`.

`TranscriptPanel` auto-scrolls a new live turn near the top of the viewport
at submit time so the new turn fills the view while the prior one stays
reachable above. `completedTurns` is persisted, so a reload keeps the chain.

## agent-demo.service — the transport boundary

```ts
streamTurn(input: StreamTurnInput, mode: DemoAgentMode, observer: StreamObserver): Unsubscribe
```

`StreamObserver` is `{ next, complete, error }`; the return value cancels.
This callback shape — not a Promise, not an async iterator — is the contract
the store and every test depend on. Preserve it.

- **Mock** (`streamMockTurn`): `getMockScenario(prompt)` keyword-matches the
  prompt, then an `EventSink` emits the prelude, reasoning, tool calls,
  loading snapshots, streamed text, and the final snapshot with realistic
  delays. Cancellation is a flag the sink checks before each emit.
- **Live** (`streamDeferredLiveTurn`): POSTs to the resolved `/converse`
  endpoint, reads the SSE body, and normalizes each payload into an
  `AgUiEvent`. `normalizeSsePayload` / `unwrapPayload` exist because the
  server may wrap events; extend those rather than teaching the store about
  wire formats.
- **`ag-ui-client` transport**: selected by `demoAgentConfig.liveTransport`,
  same observer contract via the official SDK.

## Live connection resolution

Layered, later wins — with one exception. `formatPrice` (`formatting.ts`)
builds its `Intl.NumberFormat` once at module load from
`demoAgentConfig.liveRequestDefaults.currency` and never reads
`authTokenStore`, so the Connection popover's Currency field changes the
request body and not a single rendered price. See
`references/customizing.md` → *Wiring live mode to an organization*.

1. `demoAgentConfig.liveEndpoint` / `liveHeaders` / `liveRequestDefaults` —
   shipped defaults.
2. `authTokenStore` overrides from localStorage (`discovery-demo-auth-token`,
   `-org-id`, `-region`, `-tracking-id`, `-language`, `-country`,
   `-currency`, `-client-id`), written by the Connection panel.

Both live transports build headers the same way: `liveHeaders` spread first,
then `authTokenStore.authorizationHeader()` overriding `Authorization` only
when a token is stored (it prepends `Bearer ` if missing). `liveHeaders`
ships with the placeholder `Authorization: 'Bearer your-token-here'`, so with
no stored token the request goes out with a bogus credential rather than
none — that, not a missing header, is the usual cause of an auth failure on a
first
live run. `resolveRequestDefaults` applies the same non-empty-wins rule field
by field. Query suggestions are the exception: `fetchQuerySuggestions`
returns an empty list when no token is stored instead of falling back to
`liveHeaders`.

`authTokenStore.resolveEndpoint(defaultUrl)` recombines the selected region's
host (`REGION_HOSTS`) with the selected org id and the original path — that
is the URL live turns POST to. Query suggestions derive theirs from the same
resolved URL, replacing everything from `/commerce/` onward with
`searchRouting.querySuggestionsCommerceSuffix`.

`resolveConnectionContext(agentMode)` snapshots org, region, tracking id, and
locale into each turn's telemetry **at submission time**, so an exported
conversation reflects the connection it actually ran against rather than
whatever the panel says at export time. Preserve that timing.

## Persistence and history

`conversationHistoryStore` owns the localStorage list under
`discovery-demo-conversations`: an array of `StoredConversation`
(= `PersistedConversation` + local `id`, derived `title`, `createdAt`,
`updatedAt`), newest first, capped at `historyCopy.maxConversations`.

- Importing the module in `App.tsx` is what hydrates the conversation store
  and wires per-turn snapshotting. That import is load-bearing.
- A legacy single-conversation key `discovery-demo-conversation` is migrated
  on first load. `CONVERSATION_SCHEMA_VERSION` is `1`; if you change
  `PersistedConversation`, bump it and add the migration in the same change.
- On load, `normalizeTelemetryMap` rewrites any persisted `running` outcome
  to `interrupted` — a run cannot still be alive after a reload. It is the
  load-side half of the rule `conversationStore` enforces when a stream
  completes without a terminal event, so keep it if you rewrite
  `normalizePersisted`. `running` stays a legitimate *live* value: a snapshot
  or export taken mid-run still carries it.
- `startNew()` clears the active id so a later prompt cannot overwrite the
  previously saved conversation. `App.tsx` routes Reset through it for that
  reason.
- `StorageHealth` is `ready | unavailable | quota_exceeded | write_failed`
  and surfaces as a non-blocking banner. Failures never silently degrade, and
  in-memory state stays exportable when writes fail — keep both properties.

## Feedback, telemetry, export

This layer is an explicit **client-side stopgap** for a future Coveo feedback
endpoint (plan of record: `docs/feedback-observability-plan.md`).

- The UI submits through `FeedbackSink.submit(FeedbackSubmissionV1)` and never
  touches persistence. `LocalFeedbackSink` re-validates at runtime — rating /
  reason combinations, the 2,000-char comment cap — because migrated records
  arrive untyped. A remote sink later must map from the same DTO with **no UI
  changes**; that is the whole point of the boundary. Do not collapse it.
- Do not substitute RGA feedback or generic usage analytics for the future
  agentic feedback contract, and do not add delivery/retry state before the
  real endpoint defines auth, identifiers, schemas, idempotency, and retry.
- `TurnTelemetry` records start / first-response / finish timestamps,
  latency, outcome (`running | succeeded | failed | cancelled | interrupted`),
  sanitized errors, tool and surface summaries, and the connection context.
  Server ids (`runId`, `assistantMessageId`, `conversationSessionId`) are
  optional correlation data only — not presumed keys of any future contract.
- Export has two profiles. **redacted**: transcript, feedback, telemetry, ids,
  structured errors; product ids kept, but no client id, reasoning, tool
  args/results, state snapshots, or full surface payloads. **diagnostic**:
  adds those, behind an explicit confirmation on every download. Both always
  exclude bearer tokens, conversation continuation tokens, and auth-store
  contents. If you add a field anywhere in persisted state, decide which
  profile it belongs to and extend `conversation-export.test.ts`. For a
  top-level `PersistedConversation` field the compiler catches a miss in
  `persistenceSnapshot()` and `normalizePersisted()` — both return the full
  type — but **not** in the two places that lose data silently.
  `shallowEqualSnapshot()` gates every capture by comparing thirteen named
  fields by reference, so a field left out of it makes a change to *only*
  that field read as "nothing changed" and never reach localStorage.
  `hydrate()` and `resetConversation()` both pass a `Partial<ConversationState>`
  to `setState`. A field left out of `hydrate()` is not restored on reload and
  keeps the outgoing conversation's value when you switch conversations; a
  field left out of `resetConversation()` is never cleared, so it leaks into
  the blank conversation Reset starts.

## Testing the services

`src/test/harness.ts` holds the shared fixtures — it lives outside the
`*.test.ts` files so importing it never re-registers another file's tests.

```ts
const h = createStoreHarness();          // ConversationStore + manual stream + clock
h.store.submitPrompt('show me cameras');
h.latest().next({ type: 'RUN_STARTED', threadId: 't' });
h.advance(250);                          // deterministic latency
h.latest().next({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'hi' });
h.latest().next({ type: 'RUN_FINISHED' });
h.latest().complete();
expect(h.store.getState().completedTurns).toHaveLength(0);
```

Emit `RUN_FINISHED` before `complete()`. A stream that completes without a
terminal event is finalized as `interrupted` with a synthetic `stream_ended`
error (the `complete` handler in `conversation-store.ts`) and renders a
"Response interrupted" notice — a case worth testing deliberately, but not
the happy path. `completedTurns` is empty here either way: the live episode
only moves into `completedTurns` on the next `submitPrompt`.

`emptyPersisted(overrides)` and `makeStoredConversation(overrides)` build
persistence fixtures. `T0` is the fixed clock origin.

`src/test/setup.ts` registers jest-dom matchers, clears `localStorage` before
each test, and swaps in an in-memory Storage shim when Node's own Web Storage
global shadows jsdom's and throws — that shim is why the suite passes on
stock Node with no flags. Leave it alone.
