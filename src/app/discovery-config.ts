// Single source of truth for the Conversational Discovery experience.
//
// This file owns:
//   - Empty-state quick-action chips
//   - All search-box routing rules (word-count threshold, query-suggestions
//     short-query rule, conversational-operator detection)
//   - The classic-search handoff hook
//
// Component code never decides routing on its own; it always calls
// `searchRouting.decideRoute(...)`.

import type { NextAction, ProductRecord } from './models';

/**
 * Empty-state quick-action chips rendered before the first user message.
 * Each chip submits its `text` as a prompt when clicked.
 */
export const quickActionChips: NextAction[] = [
  { text: 'Show me security cameras', type: 'search' },
  { text: 'Compare IP cameras', type: 'followup' },
  { text: 'Build a surveillance bundle', type: 'followup' },
];

/**
 * "Popular queries" surfaced in the search-box dropdown the moment the
 * box detects conversational intent (i.e. flips into AI/generative mode).
 *
 * This is a static, editorial-owned list — edit it directly here. Each
 * entry is submitted as a conversational prompt when the shopper clicks
 * it. Keep them phrased as natural-language shopping questions so they
 * read as example "things you can ask the assistant".
 */
export const conversationalDefaults = {
  /** Curated popular conversational queries. Edit freely. */
  popularQueries: [
    'Which camera is best for a small retail store?',
    'Compare your two best-selling IP cameras',
    'Help me plan surveillance for a warehouse',
    'What NVR supports sixteen cameras?',
    'Find me a weatherproof camera for outdoor use',
    'Recommend an access control setup for one door',
    "I'm looking for a video doorbell for multi-tenant buildings",
    'Show me PoE switches that fit an 8-camera install',
  ] as string[],

  /** How many queries to surface in the dropdown at once. */
  maxDisplayed: 6 as number,

  /** Pick a fresh random subset each time intent is detected. */
  shuffle: true as boolean,

  /** Headline + supporting text shown above the query grid. */
  eyebrow: 'Popular queries',
  title: 'Popular shopping questions',
};

export type SearchRoute = 'conversational' | 'classic';

/**
 * Inputs the routing function needs. The component is responsible for
 * supplying these (typically: the trimmed query and the count of Coveo
 * Query Suggestions returned for that query).
 */
export type RouteDecisionInput = {
  query: string;
  /** Count of Coveo Query Suggestions returned for the current query. 0 if QS has not been fetched / returned no matches yet. */
  querySuggestionsMatches: number;
};

/**
 * Search-box routing configuration.
 *
 * Rule precedence inside `decideRoute` (top-down — first match wins):
 *   1. **Classic operators** — query contains any token from
 *      `classicOperators` → always route to classic search. Use for
 *      brand names, SKUs, or other explicit "send to search" signals.
 *   2. **Conversational operators** — query contains any token from
 *      `conversationalOperators` → always route to conversational.
 *   3. **Word-count threshold** — `wordCount >= conversationalWordThreshold`
 *      → route to conversational.
 *   4. **Query Suggestions short-query rule** — QS returned at least
 *      `querySuggestionsMinMatches` for a query of `<= querySuggestionsMaxWords`
 *      words → route to classic.
 *   5. **Default** — classic.
 *
 * Each rule is independently configurable. Operator destinations are fixed
 * (conversational operators always go conversational, classic operators
 * always go classic) — adjust the *operator lists* to change behaviour.
 */
export const searchRouting = {
  /* ---------- Rule 3: word-count threshold ---------- */

  /** A query at or above this word count routes to conversational. */
  conversationalWordThreshold: 6 as number,

  /* ---------- Rule 4: Query Suggestions short-query ---------- */

  /** Minimum QS matches for the short-query → classic rule to fire. */
  querySuggestionsMinMatches: 1 as number,

  /** Max word count for the short-query → classic rule to fire. */
  querySuggestionsMaxWords: 5 as number,

  /** Debounce window for QS fetches as the user types. */
  querySuggestionsDebounceMs: 200 as number,

  /**
   * Path suffix used to construct the QS URL from the resolved Commerce
   * endpoint (the suffix after `/commerce/`). Coveo Commerce QS lives at:
   *   /rest/organizations/{org}/commerce/v2/search/querySuggest
   */
  querySuggestionsCommerceSuffix: 'v2/search/querySuggest' as string,

  /**
   * Minimum query length (in characters, after trim) before issuing a QS
   * request. Below this, the service emits an empty list.
   */
  querySuggestionsMinQueryLength: 2 as number,

  /* ---------- Rule 2: conversational operators (always → conversational) ---------- */

  /**
   * Words / phrases that signal conversational or question intent. Any
   * match routes the query to conversational mode unconditionally.
   *
   * Matching rules (case-insensitive against the trimmed query):
   *   - Single tokens (no whitespace) match as whole words (regex \b).
   *   - Multi-word phrases match as case-insensitive substrings.
   */
  conversationalOperators: [
    // Question words
    'what',
    'why',
    'how',
    'which',
    'should',
    // Comparison
    'compare',
    'difference',
    'differences',
    'vs',
    'versus',
    'between',
    'pros',
    'cons',
    // Recommendation
    'best',
    'recommend',
    'suggest',
    'show me',
    'find me',
    'give me',
    // Self-reference / intent
    "i'm looking",
    'looking for',
    'help me',
    'tell me',
    'i need',
    'i want',
    // Cross-sell / styling
    'pair',
    'pairs',
    'match',
    'matches',
    // Education
    'explain',
    'describe',
    'understand',
  ] as string[],

  /* ---------- Rule 1: classic operators (always → classic) ---------- */

  /**
   * Words / phrases that should *always* bypass the conversational agent
   * and go straight to classic search. Use this for brand names, SKUs,
   * model numbers, or other unambiguous "I want search results" signals.
   *
   * Empty by default — populate per integration.
   *
   * Matching rules are identical to `conversationalOperators` (whole-word
   * for single tokens, substring for multi-word phrases, case-insensitive).
   *
   * Takes precedence over conversational operators when both match.
   */
  classicOperators: [] as string[],

  /* ---------- Decision function ---------- */

  decideRoute(input: RouteDecisionInput): SearchRoute {
    const trimmed = input.query.trim();
    if (!trimmed) {
      return 'classic';
    }

    const lower = trimmed.toLowerCase();
    const words = trimmed.split(/\s+/).filter(Boolean).length;

    // 1. Classic operators always bypass the agent
    if (this.matchesAny(lower, this.classicOperators)) {
      return 'classic';
    }

    // 2. Conversational operators always go to the agent
    if (this.matchesAny(lower, this.conversationalOperators)) {
      return 'conversational';
    }

    // 3. Long-form queries → conversational
    if (words >= this.conversationalWordThreshold) {
      return 'conversational';
    }

    // 4. QS-backed short queries → classic
    if (
      words <= this.querySuggestionsMaxWords &&
      input.querySuggestionsMatches >= this.querySuggestionsMinMatches
    ) {
      return 'classic';
    }

    // 5. Default
    return 'classic';
  },

  /**
   * True iff `lowerQuery` contains any token from `operators` using the
   * shared matching rules: whole-word for single tokens, substring for
   * multi-word phrases, all case-insensitive.
   */
  matchesAny(lowerQuery: string, operators: string[]): boolean {
    return operators.some((rawOp) => {
      const op = rawOp.toLowerCase().trim();
      if (!op) {
        return false;
      }
      if (/\s/.test(op)) {
        return lowerQuery.includes(op);
      }
      const escaped = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`).test(lowerQuery);
    });
  },

  /* ---------- Classic-search handoff ---------- */

  /**
   * Called when the user submits in classic-search mode. The demo just
   * surfaces the routing decision; a production integration wires this to
   * the host storefront's search route (e.g. `/search?q=...`).
   */
  handleClassicSearch(query: string): void {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    // eslint-disable-next-line no-console
    console.info('[discovery-config] classic search route', { query: trimmed });
    if (typeof window !== 'undefined') {
      window.alert(
        `Demo placeholder: classic search would route to /search?q=${encodeURIComponent(trimmed)}`,
      );
    }
  },
} as const;

// -----------------------------------------------------------------------------
// Conversation-history dropdown copy
// -----------------------------------------------------------------------------

export const historyCopy = {
  /** Label on the header history button. */
  buttonLabel: 'History',
  /** Heading shown at the top of the open dropdown. */
  heading: 'Conversations',
  /** "Start a new conversation" action label (inside the dropdown). */
  newChatLabel: 'New chat',
  /** Label for the dedicated top-right "New conversation" button. */
  newConversationLabel: 'New conversation',
  /** Shown when there are no saved conversations yet. */
  emptyLabel: 'Your recent conversations will appear here.',
  /** Fallback title for a conversation with no user message yet. */
  untitledLabel: 'New conversation',
  /** Maximum number of conversations retained in localStorage. */
  maxConversations: 50 as number,
};

// -----------------------------------------------------------------------------
// PRODUCT CTA — PDP links
// -----------------------------------------------------------------------------
//
// Every product tile rendered inside the conversational surfaces (the
// product carousel today; reuse for comparison / bundle tiles as needed)
// shows a call-to-action that links to the product's PDP.
//
// >>> IN THIS DEMO THE LINK IS A PLACEHOLDER. <<<
// Replace `productCta.buildPdpUrl` below with the real storefront PDP URL
// pattern before going live. That single function is the ONLY place
// product → PDP routing is decided; the components just call it (see
// `ProductCarousel.tsx` → `pdpUrl()` / `onCtaClick()`).

export type ProductCtaConfig = {
  /** Button / link label shown on each product tile. */
  label: string;
  /** When true, the CTA opens the PDP in a new browser tab. */
  openInNewTab: boolean;
  /**
   * Returns the PDP URL for a product. **REPLACE FOR PRODUCTION.**
   * See `buildPdpUrl` notes below for the common options.
   */
  buildPdpUrl: (product: ProductRecord) => string;
  /**
   * Optional click hook (analytics / Coveo commerce `interactiveProduct`
   * select event). Fires before navigation; does not block it.
   */
  onSelect?: (product: ProductRecord) => void;
};

export const productCta: ProductCtaConfig = {
  label: 'View details',
  openInNewTab: false,

  buildPdpUrl(product: ProductRecord): string {
    // =========================================================================
    // === REPLACE WITH YOUR PDP LINK LOGIC ====================================
    // =========================================================================
    // The agentic API returns a `clickUri` for each product. If that already
    // resolves to your live PDP, the line below is all you need. Otherwise
    // build the URL from your own slug / id pattern, for example:
    //
    //   return `/p/${product.ec_product_id}`;
    //   return `https://www.example.com/products/${product.ec_product_id}`;
    //   return `https://www.example.com/${slugify(product.ec_name)}-${product.ec_product_id}`;
    //
    // Keep all PDP routing in THIS function so the components stay generic.
    const placeholder = product.clickUri?.trim();
    return placeholder && placeholder.length > 0
      ? placeholder
      : `#pdp-placeholder-${product.ec_product_id}`;
  },

  onSelect(product: ProductRecord): void {
    // === OPTIONAL: wire product-click analytics here ===
    // e.g. Coveo Commerce: interactiveProduct({ options: { product } }).select()
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.info('[discovery-config] product CTA click', {
        id: product.ec_product_id,
        name: product.ec_name,
      });
    }
  },
};
