# Angular Generative UI Implementation Guide

This repo is a small Angular reference app for a conversational furniture storefront feature. It demonstrates how a storefront can consume AG-UI events and render A2UI commerce surfaces.

## Running The Project

Install dependencies and start the Angular dev server:

```bash
npm install
npm start
```

Then open `http://localhost:4200/`.

Suggested demo prompts:

- `show me sofas`
- `compare sofas`
- `build a living room bundle`

## Current Status

This reference app runs in `mock` mode by default.

In this repo, `mock` means the Angular storefront does not call a live commerce conversation endpoint. Instead, the frontend emits a local, hard-coded stream that imitates a real agent run:

- AG-UI-style lifecycle and text events
- `ACTIVITY_SNAPSHOT` payloads containing A2UI operations
- structured commerce surfaces for discovery, comparison, bundle curation, and next actions
- loading-first behavior where skeleton surfaces appear before final structured content

The purpose of `mock` is to let a developer validate the storefront-side implementation before the live backend is available. It is a frontend integration reference, not a production data source.

This sample does cover:

- conversation state and `threadId` handling
- reconstruction of streamed assistant text
- parsing of A2UI operations into Angular render state
- rendering structured surfaces inline in the conversation flow
- switching between a local mock transport and a future live transport path

The prompts and products are intentionally small and illustrative. They exist to exercise the rendering contract, not to represent the full catalog or final conversational behavior.

## Storefront Integration Assumption

This guide assumes the conversation experience is one feature within a larger storefront, not the entire website.

In practice, that means this Angular sample should be read as the implementation for a dedicated conversation route or feature area, for example:

- `/assistant`
- `/shop-with-an-expert`

The responsibility of this sample is narrower. It focuses on the conversation experience itself:

- sending a conversation request
- receiving AG-UI events
- parsing A2UI operations
- rendering structured commerce surfaces inline within the conversation route

## Protocol Concepts

### What is AG-UI?

AG-UI is the Agent User Interaction protocol. It defines how a frontend application and an agent backend communicate through a stream of typed events.

In storefront terms, AG-UI is the conversation transport contract. It carries things like:

- run lifecycle events
- streamed assistant text
- tool call events
- state snapshots
- activity snapshots

Official AG-UI documentation:

- Overview: https://docs.ag-ui.com/introduction
- Core architecture: https://docs.ag-ui.com/concepts/architecture
- Protocol landscape: https://docs.ag-ui.com/agentic-protocols

### What is A2UI?

A2UI is a generative UI specification. It defines how an agent can describe interface structure and data as declarative messages instead of sending executable frontend code.

In storefront terms, A2UI is the structured UI contract. It defines things like:

- surfaces
- components
- data binding
- progressive updates such as `surfaceUpdate` and `dataModelUpdate`

Official A2UI documentation:

- A2UI home: https://a2ui.org/
- Overview and core concepts: https://a2ui.org/concepts/overview/
- What is A2UI?: https://a2ui.org/introduction/what-is-a2ui/
- Data flow: https://a2ui.org/concepts/data-flow/

### How They Work Together

AG-UI and A2UI solve different problems:

- AG-UI carries the overall agent-to-frontend event stream
- A2UI provides the structured UI format inside that stream

For this Angular storefront feature, the practical model is:

1. The storefront sends a conversation request.
2. The agent responds with AG-UI events.
3. Some AG-UI events contain A2UI operations.
4. The Angular app parses those A2UI operations and renders native Angular components.

## What This App Demonstrates

- stable conversation identity with a reusable `threadId`
- backend conversation continuity with `conversationSessionId` and `conversationToken` on the live `/converse` path
- streamed transcript assembly from AG-UI text lifecycle events
- structured A2UI rendering separate from assistant prose
- mock commerce flows for sofas, comparison, and bundle curation
- separation between transport, A2UI parsing, and presentational components

### Continuing Conversations With `/converse`

The live Commerce `/converse` endpoint uses two continuity fields:

- `conversationSessionId`
- `conversationToken`

`conversationSessionId` identifies the conversation. `conversationToken` is an opaque backend-issued token that must be sent back when the user continues that same conversation.

In practice, that means:

1. Start or continue a turn with a `conversationSessionId`.
2. Read the latest `conversationToken` from the SSE bookend events such as `turn_started`, `turn_complete`, or `error`.
3. Persist that token with the rest of the conversation state.
4. Send that same token back on the next request when reusing the same `conversationSessionId`.

Why this matters: the backend uses the token to validate and continue the same conversation safely. Reusing `conversationSessionId` without the latest `conversationToken` can fail the request or break conversation continuity.

## Supported A2UI Components

The sample conversation route supports the commerce A2UI component set an implementer should know about:

- `ProductCarousel`
- `ComparisonTable`
- `ComparisonSummary`
- `BundleDisplay`
- `NextActionsBar`

The protocol can also contain nested `ProductCard` components inside comparison and bundle flows.

### What Each Component Is For

`ProductCarousel`

- Used to present a small set of relevant products in response to a shopping request.
- For the end user, this is the surface that helps them quickly browse a shortlist of options without leaving the conversation.

`ComparisonTable`

- Used to compare multiple products across a consistent set of attributes.
- For the end user, this helps answer questions like which option is larger, cheaper, modular, leather, or better suited to a given room or use case.

`ComparisonSummary`

- Used to provide a short assistant-led interpretation of the comparison.
- For the end user, this explains the tradeoffs in plain language and helps them decide without having to infer everything from the table alone.

`BundleDisplay`

- Used to present a curated set of products that work together as one recommendation.
- For the end user, this turns a broad request like furnishing a room into a coordinated set of suggested items rather than isolated products.

`NextActionsBar`

- Used to offer follow-up actions or suggested next questions.
- For the end user, this reduces typing and helps them continue the shopping flow with guided next steps.

`ProductCard`

- Used as a nested supporting component inside other surfaces, especially comparison and bundle flows.
- For the end user, this usually is not experienced as a separate top-level surface. It provides the product identity and product fields that other structured surfaces depend on.

## AG-UI Event Contract

The frontend event model in this sample includes:

- `RUN_STARTED`
- `RUN_FINISHED`
- `TEXT_MESSAGE_START`
- `TEXT_MESSAGE_CONTENT`
- `TEXT_MESSAGE_END`
- `TOOL_CALL_START`
- `TOOL_CALL_ARGS`
- `TOOL_CALL_RESULT`
- `TOOL_CALL_END`
- `STATE_SNAPSHOT`
- `ACTIVITY_SNAPSHOT`
- reasoning lifecycle events supported by AG-UI

The app rebuilds assistant text from text lifecycle events and rebuilds structured UI from `ACTIVITY_SNAPSHOT.content.operations`.

## Using Tool Calls And Reasoning For UX

The current Angular sample uses tool-call and reasoning events to power a compact collapsible `Progress` section inside the conversation flow.

That pattern is intentionally lightweight. It behaves more like a ChatGPT or Gemini-style progress disclosure than a separate dashboard panel.

### Tool Call Events

Tool call events such as `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_RESULT`, and `TOOL_CALL_END` can be used to power lightweight progress UX.

Possible storefront uses:

- show a temporary status label such as “Searching products”, “Building comparison”, or “Preparing bundle”
- populate a compact progress disclosure inside the conversation route
- surface retry or fallback messaging if a tool result indicates a failed step
- show more specific loading states based on which backend capability is currently running

### Reasoning Events

Reasoning events such as `REASONING_START`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, and `REASONING_END` can also be used to power UX.

Possible storefront uses:

- show a subtle “Thinking” or “Considering options” state before visible results arrive
- contribute to the same compact progress disclosure used for run activity
- reveal an optional developer or internal debug panel in non-production contexts

### Practical Guidance

For most storefront implementations, a good default is:

- use text and A2UI events for the main shopper experience
- use tool-call and reasoning events for progress and step awareness

## Angular Architecture

Use five layers:

1. A thin shell component that hydrates persisted demo state and composes the conversation page.
2. A signal-based facade service that owns transcript state, structured surfaces, submit flow, and AG-UI event reduction.
3. A transport service that yields normalized AG-UI events as RxJS Observables.
4. An A2UI parser that merges `surfaceUpdate` and `dataModelUpdate` operations into renderable surface state.
5. Standalone Angular components for the shell sections and commerce surfaces.

## Code Map

### [src/app/app.ts](src/app/app.ts)

The thin root shell component.

It is responsible for:

- persisted conversation state in `localStorage`
- hydrating the facade from `localStorage` on startup
- persisting the facade snapshot back to `localStorage`
- restoring the persisted `conversationToken` used for live conversation continuation
- composing the conversation page sections

Modify this file when changing top-level page composition or persistence wiring.

### [src/app/app.html](src/app/app.html)

The root Angular template for the conversation feature.

It is responsible for:

- rendering the conversation shell
- wiring the facade view model into the shell components
- defining where transcript, composer, and inline surfaces appear in the page structure

Modify this file when changing top-level shell layout or conversation-route UX structure.

### [src/app/app.css](src/app/app.css)

Component-scoped root styles and responsive overrides.

It is responsible for:

- host display
- responsive layout adjustments for the shell
- mobile overrides for transcript and composer controls

Modify this file when adjusting root-level responsive behavior.

### [src/styles.css](src/styles.css)

The main styling for the conversation feature.

It is responsible for:

- page-level layout
- hero and status cards
- transcript layout
- inline surface container styling
- composer styling
- live/mock toggle styling

Modify this file when adapting the conversation route to a brand or storefront design system.

### [src/app/services/demo-conversation.facade.ts](src/app/services/demo-conversation.facade.ts)

The signal-based conversation facade used by the Angular shell.

It is responsible for:

- draft, transcript, status, and runtime mode state
- submit flow orchestration
- consuming normalized AG-UI events
- persisting the latest `conversationToken` for continued live conversations
- tracking tool-call and reasoning progress state
- applying A2UI activity snapshots into renderable surface state
- exposing the shell view model and persistence snapshot

Modify this file when changing conversation orchestration, state flow, or persisted demo behavior.

### [src/app/services/agent-demo.service.ts](src/app/services/agent-demo.service.ts)

The top-level transport service used by the facade.

It is responsible for:

- exposing a single `streamTurn()` API
- choosing between mock and live mode from the caller-provided mode
- producing the local mock Observable event stream
- supporting the fallback custom `fetch` + SSE live path
- sending the Commerce `/converse` request body shape expected by CAPI
- capturing `conversationSessionId` and `conversationToken` from SSE bookend events
- normalizing raw SSE payloads into the app’s AG-UI event model

Modify this file when changing transport selection, request payload shape, or fallback live transport behavior.

### [src/app/services/ag-ui-client-transport.service.ts](src/app/services/ag-ui-client-transport.service.ts)

The optional live transport implementation based on `@ag-ui/client`.

It is responsible for:

- creating an `HttpAgent`
- sending a run request using the AG-UI client SDK
- exposing the returned event stream as `Observable<AgUiEvent>`
- normalizing SDK events into the local `AgUiEvent` union

Modify this file when adopting AG-UI client features such as middleware, headers, or richer live event handling.

### [src/app/a2ui-parser.ts](src/app/a2ui-parser.ts)

The A2UI-to-render-state adapter.

It is responsible for:

- reading `surfaceUpdate` and `dataModelUpdate` operations
- extracting products and next actions from value maps
- merging repeated updates for the same surface
- preserving loading state
- resolving bundle slot references to product data
- returning a stable ordered surface list

Modify this file when supporting new A2UI components or changing how structured payloads are translated into local UI state.

### [src/app/models.ts](src/app/models.ts)

The shared frontend contract types.

It is responsible for:

- chat message types
- AG-UI event types
- A2UI operation types
- commerce surface types
- shared data structures used across the app

Modify this file when extending the supported protocol or adding new surface types.

### [src/app/conversation.interfaces.ts](src/app/conversation.interfaces.ts)

The shared facade and persistence state types.

It is responsible for:

- the shell view model shape
- persisted conversation payloads
- tool activity state
- the surface-state alias used by the facade

Modify this file when changing facade-owned state or the persisted demo contract.

### [src/app/mock-catalog.ts](src/app/mock-catalog.ts)

The local mock scenarios used by the demo.

It is responsible for:

- sample product data
- sample next actions
- mock comparison and bundle scenarios
- mock skeleton snapshots
- generation of AG-UI/A2UI-shaped activity payloads

Modify this file when changing the demo prompts, example products, or mock structured responses.

### [src/app/demo-agent.config.ts](src/app/demo-agent.config.ts)

The top-level transport configuration.

It is responsible for:

- default mode selection
- live transport selection
- the planned Freedom converse endpoint

Modify this file when switching defaults or pointing the app at a local or production endpoint.

### [src/app/components/](src/app/components/)

The standalone Angular components for the conversation shell and supported commerce surfaces:

- `conversation-header.component.ts`
- `transcript-panel.component.ts`
- `prompt-composer.component.ts`
- `surface-outlet.component.ts`

- `product-carousel.component.ts`
- `comparison-table.component.ts`
- `comparison-summary.component.ts`
- `bundle-display.component.ts`
- `next-actions-bar.component.ts`

Most of these components are intentionally thin. The shell components render facade state, the leaf surface components render already-normalized surface data, and `surface-outlet.component.ts` maps a surface `componentType` to the matching renderer.

## UX References

Screenshots added under `docs/screenshots/` can be used as optional UX inspiration. They help show the intent behind the A2UI components and how structured surfaces can appear inline within a conversational storefront route.

They are visual references, not strict implementation requirements. The Angular implementation in [src/app/app.html](src/app/app.html), [src/styles.css](src/styles.css), and [src/app/app.css](src/app/app.css) remains the actual code reference in this repo.

## Alternative AG-UI Client Option

This repo includes `@ag-ui/client` as an optional live transport alongside the hand-rolled `fetch` + SSE path.

That option is useful when the backend exposes a direct AG-UI-compatible request and response contract.

For the Commerce `/converse` endpoint specifically, the custom `fetch` + SSE path is the safer default because the stream includes CAPI bookend events that carry `conversationSessionId` and `conversationToken`. The frontend needs those values to continue the same conversation on the next user turn.

That live path:

1. Use `HttpAgent` from `@ag-ui/client` in an Angular service.
2. Subscribe to AG-UI events from the client library instead of parsing raw SSE frames manually.
3. Normalize SDK events into the same facade and A2UI parser flow used elsewhere in the app.
4. Continue rendering commerce surfaces with Angular components.

Example service shape:

```ts
import { Injectable } from '@angular/core';
import { HttpAgent } from '@ag-ui/client';

@Injectable({ providedIn: 'root' })
export class FreedomAgUiService {
  private readonly agent = new HttpAgent({
    url: 'https://freedomfurnitureproduction1s4nmz28u.org.coveo.com/rest/organizations/freedomfurnitureproduction1s4nmz28u/commerce/unstable/agentic/converse',
  });

  converse(input: { threadId: string; prompt: string }) {
    return this.agent.run({
      threadId: input.threadId,
      runId: crypto.randomUUID(),
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
      messages: [{ id: crypto.randomUUID(), role: 'user', content: input.prompt }],
    });
  }
}
```

That option is wired into the sample through:

- [src/app/services/ag-ui-client-transport.service.ts](src/app/services/ag-ui-client-transport.service.ts)
- [src/app/services/agent-demo.service.ts](src/app/services/agent-demo.service.ts)
- [src/app/demo-agent.config.ts](src/app/demo-agent.config.ts)

## Mock Demo Queries

The demo intentionally stays small. The main example prompts are:

- `show me sofas`
- `compare sofas`
- `build a living room bundle`

These are enough to exercise the primary storefront rendering patterns without trying to model a full catalog.

## Planned Live Endpoint

When the Freedom commerce conversation endpoint becomes available, the storefront should send live requests to:

`https://platform-au.cloud.coveo.com/rest/organizations/freedomfurnitureproduction1s4nmz28u/commerce/unstable/agentic/converse` alongside authentication token as usual requests.

The will open an SSE stream.
Example request body shape:

```json
{
  "trackingId": "freedom",
  "language": "en",
  "country": "US",
  "currency": "USD",
  "clientId": "localhost-4200",
  "message": "show me sofas",
  "context": {
    "view": {
      "url": "http://localhost:4200/"
    }
  }
}
```

On follow-up turns, the storefront should still target the same endpoint and additionally send the latest `conversationSessionId` and `conversationToken` returned by the backend SSE bookend events:

```json
{
  "trackingId": "freedom",
  "language": "en",
  "country": "US",
  "currency": "USD",
  "clientId": "localhost-4200",
  "message": "show me sofas",
  "conversationSessionId": "<token-received-with-first-response>",
  "conversationToken": "<latest-token-from-the-previous-turn>",
  "context": {
    "view": {
      "url": "http://localhost:4200/"
    }
  }
}
```

Those tokens are required to continue the same conversation. The frontend should treat them as opaque, persist the latest value.

Until then:

- keep `mode` set to `mock`
- use the mock AG-UI and A2UI flows in this repo as the frontend reference
- treat the live endpoint as the target contract, not an active dependency
