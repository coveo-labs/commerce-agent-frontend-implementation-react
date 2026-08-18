# Plan of record: client-side feedback, observability, and conversation export

## Summary

Implement a browser-local stopgap that lets users:

- Rate individual assistant answers.
- Assess complete conversation sessions.
- Capture compact quality and operational telemetry.
- Export any selected conversations as redacted or diagnostic JSON.

The persisted conversation is the single source of truth. Deleting or evicting a conversation deletes its feedback. Do not add a separate outbox, raw AG-UI event journal, remote telemetry service, persistence debouncing, or speculative Coveo API integration.

## Data contracts and persistence

### Persisted conversation

Add to `PersistedConversation`:

- `schemaVersion: 1`
- `answerFeedbackByTurnId`
- `sessionFeedback`
- `turnTelemetryByTurnId`

Use the user-message ID as the stable turn ID for live and archived turns. This lets the maps cover the final turn before it enters `completedTurns`.

Handle every new top-level field together in:

- `persistenceSnapshot()`
- `hydrate()`
- `normalizePersisted()`
- `shallowEqualSnapshot()`

All mutations must create new map/object references so the history store detects them.

Migrate unversioned records through `normalizeStored()` by adding empty maps, `sessionFeedback: null`, and `schemaVersion: 1`. Convert restored `running` telemetry to `interrupted`.

### Feedback types

Use discriminated unions with snake_case reason enums.

Positive reasons:

- `correct`
- `relevant`
- `complete`
- `clear`
- `good_product_match`

Negative reasons:

- `incorrect`
- `irrelevant`
- `incomplete`
- `unclear`
- `poor_product_match`
- `technical_issue`
- `other`

An `AnswerFeedback` contains:

- Stable UUID `feedbackId`
- Positive or negative rating with its corresponding typed reason array
- Optional trimmed comment, maximum 2,000 characters
- ISO `createdAt` and `updatedAt`

A `SessionFeedback` contains:

- Stable UUID `feedbackId`
- `resolved | partially_resolved | not_resolved`
- Optional trimmed comment, maximum 2,000 characters
- ISO `createdAt` and `updatedAt`

Edits preserve the feedback ID and creation time.

`LocalFeedbackSink` must also enforce the contract at runtime:

- Deduplicate reasons.
- Reject reasons outside the selected rating’s allowed set.
- Trim and validate comments.
- Validate migrated or otherwise untyped submissions instead of relying only on TypeScript.

### Turn telemetry

Create a telemetry entry when a prompt is accepted:

- Local UUID `attemptId`
- Stable `turnId`
- Optional server `runId`
- Optional assistant `messageId`
- Thread and conversation session IDs
- Start, first-response, and finish timestamps
- First-response latency and total duration
- `running | succeeded | failed | cancelled | interrupted`
- Sanitized structured error
- Typed tool names/statuses
- Typed surface types/IDs
- Effective connection context captured at submission time

Resolve connection context from the same effective values used for the request:

- Resolved endpoint organization and region
- Resolved tracking ID, language, country, currency, and client ID
- Agent mode and live transport

Treat server identifiers only as optional correlation data, not presumed future Coveo feedback keys.

## Run lifecycle and correctness

### Telemetry lifecycle

- `startRun`: create the `running` entry, capture effective connection context, and store an in-flight `{turnId, attemptId}` reference.
- `RUN_STARTED`: record server run and conversation session IDs.
- `TEXT_MESSAGE_START`: capture `assistantMessageId` only when it has not already been set.
- First non-empty `TEXT_MESSAGE_CONTENT`:
  - Capture `assistantMessageId` if `START` was absent.
  - Record `firstResponseAt` and latency.
- Any terminal outcome: stamp finish time and duration and summarize current tools and surfaces.
- `RUN_FINISHED`: finalize as `succeeded`.
- `RUN_ERROR` or observer error: finalize as `failed`.
- Reset, new conversation, or session switch: finalize as `cancelled`.
- Reload with persisted running telemetry: normalize as `interrupted`.

Assistant message ID capture is first-wins from `START` or non-empty `CONTENT`. Only non-empty content establishes the latency boundary.

Finalization must:

- Be idempotent.
- Match both `turnId` and `attemptId` against the active in-flight reference.
- Ignore late callbacks from cancelled or superseded streams.
- Never overwrite the first valid terminal outcome or timestamps.

Clear the in-flight reference during successful finalization, hydration, and reset.

### Errors and partial responses

Stop appending transport errors as synthetic assistant messages.

Instead:

- Preserve partial assistant text.
- Store error details in turn telemetry.
- Render `failed` as an error alert.
- Render `cancelled` and `interrupted` as neutral status notices.
- Join telemetry to live and archived turns by turn ID.
- Export partial answers and errors independently.

### Reset and switching sequence

Route transcript Reset through `conversationHistoryStore.startNew()`.

For new-conversation and selection operations:

1. Cancel the active stream.
2. Finalize the matching attempt as `cancelled`.
3. Allow the synchronous history subscription to capture partial state under the current `activeId`.
4. Enable the single-shot skip-capture guard.
5. Reset or hydrate the target conversation.
6. Clear the in-flight reference.

The implementation must preserve the invariant that `resetConversation()` and `hydrate()` each perform exactly one `setState` call and emit one notification. A dedicated test must fail if either begins emitting multiple notifications, because the single-shot guard depends on this behavior.

### Storage behavior

Keep the existing 50-conversation cap.

Replace silent persistence failures with:

- `ready`
- `unavailable`
- `quota_exceeded`
- `write_failed`

Detect quota errors separately and show a non-blocking warning. Keep the latest in-memory state exportable when persistence fails.

Inject the conversation store and a storage adapter into `ConversationHistoryStore`. Preserve application singletons, but provide `dispose()` to unsubscribe injected listeners during tests.

Multi-tab last-writer-wins remains an accepted limitation.

## Feedback and UI

Use the current custom CSS system without introducing Plasma or another framework.

### Answer feedback

- Show thumbs below every assistant answer.
- Disable them while that answer is streaming.
- Save the rating immediately, then open optional reasons/comment.
- Use `aria-pressed`, labelled checkboxes, keyboard operation, visible focus, and an announced save result.
- Allow reopening and editing saved feedback.

### Session feedback

- Show “Rate this conversation” after at least one assistant answer.
- Offer resolved, partially resolved, and not resolved.
- Persist and restore the outcome and comment.

### Sink boundary

Expose operations such as:

- `setAnswerFeedback(turnId, submission)`
- `setSessionFeedback(submission)`

Route submissions through an asynchronous `FeedbackSink`. `LocalFeedbackSink` performs runtime validation and updates the active conversation store; UI components never access localStorage.

Feedback edits may update conversation recency.

## Export

### Selection UI

Add “Export conversations” beside New Conversation and History.

The dialog must:

- List title, date, turn count, and feedback status.
- Default to the active or most recent conversation.
- Support individual selection, select all, and clear.
- Disable download when nothing is selected.
- Permit exporting an active `running` conversation.
- Manage initial focus, focus trapping, Escape/cancel behavior, and trigger-focus restoration.

### Turn unification

Read from the history store’s in-memory state.

Build one normalized `turns` array from `completedTurns` plus the live remainder:

- Skip a malformed remainder that has no user message.
- Use the user-message ID as the identity.
- Drop the remainder if its ID already exists in `completedTurns`.
- Never deduplicate by array position.
- Join answer feedback and telemetry by turn ID.

This handles the transient state where `snapshotPreviousTurn()` has added a turn to `completedTurns` but the subsequent `startRun()` state update has not yet replaced `messages`.

### Export envelope

Create a versioned envelope containing:

- Schema name and version
- `redacted | diagnostic`
- Application name/version
- Export timestamp
- Privacy notice
- Selected conversations

### Redacted profile

Include:

- Visible prompts and assistant answers unchanged
- Structured errors and statuses
- Answer and session feedback
- Timestamps, latency, duration, and outcomes
- Local, thread, conversation, run, and message IDs
- Mode, transport, organization, region, tracking ID, and locale
- Tool names/statuses
- Surface type, surface ID, and recursively collected product IDs

Exclude:

- Bearer tokens
- Conversation continuation tokens
- Auth-store contents
- Client ID
- Reasoning
- Tool arguments/results
- State snapshots
- Complete surface payloads

### Diagnostic profile

Add:

- Client ID
- Reasoning text
- Tool argument/result previews
- Latest persisted state snapshot
- Complete persisted surface payloads

Still exclude bearer tokens, conversation continuation tokens, and auth-store contents. Require explicit confirmation for every diagnostic download.

Generate pretty-printed files such as:

- `commerce-agent-sessions-20260805-143000-redacted.json`
- `commerce-agent-sessions-20260805-143000-diagnostic.json`

## Future Coveo integration

Define:

- `FeedbackSubmissionV1`
- Asynchronous `FeedbackSink`
- Local receipt/result type
- `LocalFeedbackSink`

Do not add remote delivery or retry state before an official endpoint defines authentication, identifiers, request and receipt schemas, idempotency, and retry behavior.

A future remote sink must map from the stable submission DTO without changing the UI. Do not substitute RGA feedback or generic usage-analytics events.

## Implementation sequence

1. Add Vitest, jsdom, and React Testing Library; inject store/storage dependencies and implement disposal.
2. Add migration, telemetry, structured errors, reset/switch correctness, and storage health.
3. Add typed feedback, runtime sink validation, and accessible answer/session UI.
4. Add turn unification, export profiles, selection UI, and downloads.
5. Complete acceptance testing and production build validation.

## Test plan

Test:

- Unversioned and malformed-record migration.
- New-field persistence, hydration, and immutable references.
- Running-to-interrupted restoration.
- Exactly one notification from reset and hydrate.
- Single-shot skip-capture ordering.
- Typed and runtime feedback validation, reason deduplication, editing, and comment limits.
- Final-turn feedback before another prompt.
- Session feedback persistence.
- Assistant message ID first-wins behavior from `START` and `CONTENT`.
- Latency beginning only on first non-empty content.
- Success, failure, partial response, cancellation, interruption, and duplicate terminal callbacks.
- Late callbacks rejected by matching both turn and attempt IDs.
- Tool/surface summaries on every terminal outcome.
- Effective connection snapshots with defaults and overrides.
- Reset preserving the prior conversation.
- Mid-stream switching without contamination.
- Storage unavailable, quota, and generic failures.
- Listener disposal.
- One, arbitrary-many, and all-session exports.
- Malformed live remainder skipping.
- Live/completed deduplication by user-message ID.
- Redacted and diagnostic inclusion rules.
- Recursive product-ID extraction.
- Complete exclusion of bearer and continuation tokens.
- Accessible feedback controls, status rendering, dialog behavior, and focus management.
- `npm test` and `npm run build`.

Acceptance scenario:

1. Create two multi-turn conversations.
2. Rate answers and both sessions.
3. Trigger a partial failure and verify answer/error separation.
4. Switch during an active mock run and verify cancellation without contamination.
5. Simulate a stale completion callback and verify it is ignored.
6. Reload and verify feedback, telemetry, and interruption handling.
7. Export a selected subset in both profiles.
8. Confirm transcript readability, diagnostic-only fields, and complete secret exclusion.

## Accepted tradeoffs

Document in the README:

- Feedback lifetime is bounded by conversation retention; deletion and cap eviction remove it.
- Multi-tab persistence remains last-writer-wins.
