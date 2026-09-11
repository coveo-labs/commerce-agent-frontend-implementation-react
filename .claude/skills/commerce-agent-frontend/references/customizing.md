# Customizing the reference app

The most common request on this repo is some form of "make this look and
behave like customer X". This file is the recipe set. Everything here is
configuration, catalog, or theme — none of it should require touching a
service or the parser.

## Contents

- [Re-branding](#re-branding)
- [Swapping the catalog](#swapping-the-catalog)
- [Wiring live mode to an organization](#wiring-live-mode-to-an-organization)
- [PDP links and click analytics](#pdp-links-and-click-analytics)
- [Tuning search routing](#tuning-search-routing)
- [Query suggestions](#query-suggestions)
- [Conversation history and copy](#conversation-history-and-copy)
- [Preparing a customer demo](#preparing-a-customer-demo)

## Re-branding

Colors are CSS custom properties on `#root` in `src/styles.css` (line 40).
Start with the tokens:

| Token | Role |
|---|---|
| `--ink` / `--muted` | Body text / secondary text |
| `--line` | Borders and dividers |
| `--bg` / `--bg-soft` | Page and inset backgrounds |
| `--primary` / `--primary-strong` / `--primary-soft` | Accent, hover accent, accent tint |
| `--card` / `--popover` | Panel and popover fills (translucent) |
| `--shimmer-a` / `--shimmer-b` | Skeleton shimmer stops |
| `--image-bg` / `--head-bg` | Product image backdrop, table headers |

Editing them reaches ~145 `var()` call sites — `--muted` alone accounts for
45, `--primary` 29, `--ink` 27 — which is why the tokens are the right place
to start.

But they are not enough on their own. Accent and ink are *also* inlined as raw
channel triples: `--primary` (`#4338ca`) as `rgba(67, 56, 202, …)` on 30 lines,
`--primary-soft` (`#e8ecff`) as `rgba(232, 236, 255, …)` on 14, and `--ink`
(`#101828`) as `rgba(16, 24, 40, …)` on 37 — one of which is the `--line`
token's own definition, the other 36 uncovered by any token. Focus rings, chip
and card borders, the primary button's drop shadow, the AI-toggle track and the
history badge come from those literals. After editing the tokens, run

```bash
grep -nE 'rgba\(67, 56, 202|rgba\(232, 236, 255' src/styles.css
```

and replace each hit with `color-mix(in srgb, var(--primary) <n>%, transparent)`
(or the `--primary-soft` equivalent), keeping the alpha as the mix percentage.
`rgba(var(--primary), …)` will not work — the tokens hold hex, not RGB
triplets.

Add `|rgba\(16, 24, 40` to that grep only if you also changed `--ink`; it is
neutral text-and-border ink that most re-themes leave alone. The rule is
symmetric with the gate: `scripts/check.sh` sweeps all three triples but only
complains about a token you actually moved, so a changed token with stale
literals is a hard FAIL there. Miss this pass and the app renders half in the
old brand — run `bash scripts/check.sh` rather than eyeballing the grep.

Leave the semantic literals alone unless the customer's palette clashes with
them: `#b42318` on `.sale-tag`, the `#f79009` and `#98a2b3` status dots, and
`#ffffff` on-accent button text.

Keep the accent pair coherent: `--primary-strong` should read as a darker
version of `--primary`, and `--primary-soft` as a very light tint of it —
buttons, focus rings, and the AI toggle all rely on that relationship.
There is no dark theme; don't half-add one.

Everything else brand-facing:

- Brand name and tagline — `src/App.tsx`, the `storefront-brand-name` and
  `storefront-brand-sub` spans.
- Page title — `index.html`.
- Favicon — `public/favicon.svg`.
- No-image product swatch — `ProductCarousel.tsx:118` hardcodes
  `linear-gradient(135deg, #e2e5f0, #b8bfd6)` for products whose `ec_image`
  is empty. It lives in TSX, outside both the token block and `styles.css`,
  so neither a token edit nor a stylesheet grep finds it and a warm re-theme
  leaves blue-grey swatches behind. Re-tint it by hand, or give products an
  `accent` (see [Swapping the catalog](#swapping-the-catalog)), which
  overrides it — the mock products do, with indigo hexes that need the same
  pass.
- Typography — the `body` font stack in `styles.css` (Inter-first, system
  fallbacks) and the `html { font-size: 17px }` base that scales the whole
  rem-based layout. Nothing actually loads Inter — there is no `@font-face`,
  no `@import`, no font `<link>` in `index.html` — so the app renders in
  `"SF Pro Text"` / `"Segoe UI"` / `system-ui` unless Inter happens to be
  installed on the machine, which is why the presenter's Mac and a customer
  laptop can differ. Swapping in a brand font means adding the `@font-face`
  or a `<link>` too, not just editing the stack.

Check contrast after a re-theme. Prospects look at this on a projector.

## Swapping the catalog

`src/app/mock-catalog.ts` holds the placeholder products and the three
scenarios. A convincing swap changes all of:

1. **Products.** `ProductRecord` needs `ec_product_id`, `ec_name`,
   `ec_brand`, `ec_price`, `ec_image`, `clickUri`; `ec_promo_price`,
   `description`, `accent`, and any extra attributes are optional. Extra
   attributes (`resolution`, `form_factor`, …) flow straight through to the
   comparison table with no type change.
2. **Images.** The default uses `placehold.co`. Real product imagery is much
   more convincing — but it must load from wherever the demo runs, and the
   two surfaces fail differently. In the carousel, `onImageError` stamps
   `data-broken` on the `<img>` (`ProductCarousel.tsx:149`) and
   `.product-image[data-broken='true'] { display: none }` (`styles.css:1577`)
   hides it, so a bad URL yields a silently image-less tile rather than a
   visibly broken one — the gradient `swatch` fallback renders only when
   `ec_image` is empty, never when it fails to load. `ComparisonTable.tsx`
   has no `onError` at all, so the same product shows the browser's
   broken-image glyph there. Neither failure announces itself; check both
   surfaces by eye.
3. **Comparison attributes.** The `attributes` array on the comparison
   snapshot must name keys that actually exist on the products and that
   actually **differ** between them. A comparison table where every row reads
   the same is worse than no comparison.
4. **Scenario prose.** `intro`, `reasoningText`, `textChunks`, and the tool
   call names/args in each scenario. `textChunks` is the streamed answer —
   `splitText()` chunks a string for you, so write one paragraph and pass it
   through.
5. **Trigger words.** `getMockScenario` keyword-matches the lowercased
   prompt: `bundle`/`kit`, then `compare`/`vs`, then the fallback scenario.
   Update the branches to words a demoer would type for the new catalog, and
   keep a sensible fallback.
6. **Starter prompts.** `quickActionChips` and
   `conversationalDefaults.popularQueries` in `discovery-config.ts` must
   match the new catalog — these are mock-mode only and are hidden
   automatically in live mode (`App.tsx:22`), because they describe the mock
   data rather than the connected org.

If chips and scenarios drift apart, the demo dead-ends on its own suggestion
chip. Check every chip end to end after a catalog swap.

## Wiring live mode to an organization

Two layers, later wins — with one documented exception, currency, below.

**Shipped defaults** — `src/app/demo-agent.config.ts`:

```ts
mode: 'mock',                    // the default the app boots in
liveTransport: 'custom-fetch',   // or 'ag-ui-client'
liveEndpoint: 'https://platformdev.cloud.coveo.com/rest/organizations/<org>/commerce/unstable/agentic/converse',
              // ships pointing at a Coveo playground org; the popover's
              // Organization ID overrides it
liveHeaders: { Authorization: 'Bearer your-token-here' },  // placeholder — sent verbatim
liveRequestDefaults: { trackingId, language, country, currency, clientId },
```

**Per-visitor overrides** — the Connection popover, which renders only in
live mode (`App.tsx:38`), persisted by `auth-token-store.ts` under
`discovery-demo-*` keys. Region keys are `au`, `na`, `eu`, `dev`;
`resolveEndpoint` swaps in that region's host and the chosen org id.

**Presets.** `livePresets` in `demo-agent.config.ts` is a one-click filler for
org / region / tracking id / locale. It ships empty; add one entry per
organization you demo against:

```ts
{ label: 'Acme', orgId: 'acmeproduction1a2b3c4d', region: 'na',
  trackingId: 'acme_en_us', language: 'en', country: 'US', currency: 'USD' }
```

A preset **never** carries a token. Tokens are short-lived Search-API JWTs
(`eyJ…`, typically 24h), taken live from a storefront: DevTools → Network →
filter `coveo` → copy the `Authorization` header. They are pasted at runtime
and kept in localStorage. Never commit one — not to a preset, a default, a
test fixture, or a comment.

`liveHeaders` is the default people commit to. It ships holding the literal
string `Bearer your-token-here`, and both transports spread it into the
request before overlaying the popover token (`agent-demo.service.ts:459`,
`ag-ui-client-transport.ts:17`). So a live turn with an empty popover sends
the placeholder and comes back 401 — going out looking configured rather than
failing as "no token". Two reasons never to park a real token there: pushes
to `main` build and deploy to Amplify, so the value ships inside the public
bundle; and query suggestions never read `liveHeaders` —
`fetchQuerySuggestions` returns `[]` when the runtime token is missing — so
you would get a working conversation next to a permanently empty suggestions
dropdown. Grep `demo-agent.config.ts` for a real-looking Bearer value before
you push — or just run `bash scripts/check.sh`, which fails on a JWT-shaped
string, on a real-looking `Bearer` value, and on any `token:` field in
`demo-agent.config.ts`. The repo's own CI does not: the only workflow is
`deploy-amplify.yml`.

`formatPrice` builds one `Intl.NumberFormat` at module load from
`demoAgentConfig.liveRequestDefaults.currency` and never reads
`authTokenStore` (`formatting.ts:3`). Currency is therefore the one override
that does *not* win: setting it in the popover — or via a preset, which fills
the same field — changes the request body but not the rendered prices on
tiles, comparison rows, bundles, or the research card. To demo a non-USD org,
change the config default and reload; a popover change alone leaves dollar
signs on every price, on the projector. (`language` and `country` never affect
formatting at all — the formatter takes its locale from the browser.)

## PDP links and click analytics

All product→PDP routing is `productCta` in `discovery-config.ts`. The
carousel makes the whole tile an anchor whose `href` is
`productCta.buildPdpUrl(product)` — the component needs no edit:

```ts
export const productCta: ProductCtaConfig = {
  label: 'View details',
  openInNewTab: false,
  buildPdpUrl: (p) => `https://www.example.com/products/${p.ec_product_id}`,
  onSelect: (p) => { /* interactiveProduct({ options: { product: p } }).select() */ },
};
```

The default falls back to the agent-supplied `clickUri`, then to a
`#pdp-placeholder-…` fragment. `onSelect` fires before navigation and does
not block it — it is the hook for Coveo commerce click analytics.

Working PDP links are usually a hard requirement for a customer demo: a
carousel that navigates nowhere reads as a mockup. Check this early.

## Tuning search routing

`searchRouting.decideRoute({ query, querySuggestionsMatches })` is the whole
brain **while the box is auto-routing**. Rules evaluate top-down, first match
wins:

| # | Rule | Config | Result |
|---|---|---|---|
| 1 | Query contains a classic operator | `classicOperators` (empty by default) | classic |
| 2 | Query contains a conversational operator | `conversationalOperators` | conversational |
| 3 | Word count ≥ threshold | `conversationalWordThreshold` (6) | conversational |
| 4 | QS returned ≥ N matches for a short query | `querySuggestionsMinMatches` (1), `querySuggestionsMaxWords` (5) | classic |
| 5 | Default | — | classic |

Everything below tunes the auto-routing path only. `StorefrontSearchBox`
holds its own `generativeMode` / `manualOverride` state: it re-runs
`decideRoute` on every keystroke *until* the shopper clicks the ✦ toggle, and
from then until the field is cleared `submit()` branches on `generativeMode`
alone and never consults the config again. So a shopper who toggles manually
is unaffected by any change you make here, and a demoer who toggled once
cannot reproduce a routing bug. (The component's own header comment calls it
"purely presentational" — that is true of the auto path and wrong about the
override. `check.sh` cannot catch this either: it greps components for the
operator lists, which the override does not touch.)

Rules 4 and 5 both `return 'classic'` (`discovery-config.ts:213-222`), so
**rule 4 is inert today** — no value of `querySuggestionsMinMatches` or
`querySuggestionsMaxWords` can change a routing decision. It is doubly inert:
with `conversationalWordThreshold` at 6, rule 3 has already claimed every
query of 6+ words, so rule 4's `<= 5` word test is always true as well. Treat
it as scaffolding for a future default of `conversational`, not as a knob to
tune. The other `querySuggestions*` settings — `DebounceMs`,
`MinQueryLength`, `CommerceSuffix` — are live; they drive the suggestions
dropdown.

Matching (`matchesAny`, case-insensitive): single tokens match whole-word via
`\b…\b`; multi-word phrases match as substrings. So `what` does not fire on
`whatever`, but `show me` fires anywhere in the query.

Tuning guidance:

- **Too much goes to the AI** → raise `conversationalWordThreshold`, or trim
  `conversationalOperators`, or list the offending brand/SKU terms in
  `classicOperators` (rule 1 pre-empts rule 2).
- **Too little** → lower the threshold to 4–5 and add domain phrasings.
- Words like `is`, `are`, `do`, `cost`, `price`, `style` are excluded on
  purpose: they appear constantly in legitimate keyword searches and make the
  router fire on plain product lookups. Resist adding them back.

`handleClassicSearch(query)` is the handoff. In the demo it `console.info`s
and `window.alert`s the route, so routing decisions are visible on stage. For
a real integration:

```ts
handleClassicSearch(query) { navigate(`/search?query=${encodeURIComponent(query)}`); }
```

## Query suggestions

`query-suggestions.service.ts` (`useQuerySuggestions`) posts to the resolved
Commerce endpoint with everything after `/commerce/` replaced by
`searchRouting.querySuggestionsCommerceSuffix` (default
`v2/search/querySuggest`), using the same token, region, locale, and client
id as `/converse`. It is debounced by `querySuggestionsDebounceMs` (200) and
skipped below `querySuggestionsMinQueryLength` (2).

QS is gated on a pasted Bearer token, not on the mode toggle.
`fetchQuerySuggestions` returns `[]` when `authTokenStore.authorizationHeader()`
is null; otherwise it fires regardless of `agentMode`, and
`StorefrontSearchBox` calls `useQuerySuggestions` unconditionally
(`StorefrontSearchBox.tsx:59` — the file never mentions `agentMode`). The
token is persisted in localStorage and `toggleAgentMode` does not clear it,
so a machine that has run a live demo keeps posting every keystroke to that
customer's org while the header reads *Mock*: a live network dependency, and
a customer-org call, during what the presenter believes is an offline demo.
Before a mock-only demo, clear the token with **Clear** in the Connection
popover — and clear it *before* toggling back to mock, because the popover
only renders in live mode. On a profile that has never held a token, QS
returns nothing.

Routing is unaffected either way: rule 4 is the only rule that consumes QS
results, and since it returns the same `classic` as the default, mock and
live route identically. QS changes what the suggestions dropdown shows, never
which route a query takes.

## Conversation history and copy

`historyCopy` in `discovery-config.ts` owns the History and New-conversation
button labels, the dropdown's heading / new-chat / empty-state text, the
untitled-conversation fallback, and `maxConversations` (default 50). It is
not full coverage: the Export button's label, the `aria-label`s in
`ConversationHistory.tsx` (only the History button's composes
`historyCopy.buttonLabel`), the `relativeTime()` timestamps ("just now",
"3h ago"), and every string in `ExportConversationsDialog.tsx` are hardcoded
in the components. A copy re-brand or localization pass driven by
`historyCopy` alone ships a half-translated UI — an English "Export" sitting
next to the renamed buttons — so edit those files in place too.

Conversations live in localStorage under `discovery-demo-conversations`.
Deleting a conversation — or aging past the cap — also removes its feedback
and telemetry; that is an accepted tradeoff of the client-side stopgap, not a
bug to fix locally.

## Preparing a customer demo

A short pre-flight that catches what usually goes wrong on stage:

- [ ] `bash scripts/check.sh` is green. It gates the build, the tests, the
      committed-token scan, the re-theme sweep and surface registration in
      one shot — do this first, then work the items below that it cannot see.
- [ ] Every `quickActionChip` and popular query produces a good answer.
- [ ] All three mock scenarios reach their completed surface, not just the
      skeleton.
- [ ] Product images load — no image-less carousel tiles, no broken-image
      glyphs in the comparison table.
- [ ] The comparison table's attribute rows actually differ.
- [ ] `productCta.buildPdpUrl` goes somewhere real.
- [ ] After a re-theme: the inlined `rgba(67, 56, 202` / `rgba(232, 236, 255`
      literals were swept, not just the tokens.
- [ ] For live mode: token is fresh, org/region/tracking id are right, and
      one query has been run end to end within the hour.
- [ ] For a mock-only demo: the live token has been cleared (Connection →
      Clear, while still in live mode), so no query suggestions leak to a
      customer org.
- [ ] Non-USD demo: `liveRequestDefaults.currency` changed in the config, not
      just in the popover.
- [ ] `npm run build` passes — you do not want to discover a type error at
      the venue.
- [ ] Nothing customer-confidential has been committed — `liveHeaders`
      included.
