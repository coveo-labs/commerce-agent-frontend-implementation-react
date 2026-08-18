// Coveo Query Suggestions client.
//
// The storefront search box calls this as the user types (debounced via the
// `useQuerySuggestions` hook). QS reuses the same auth token, organization,
// region, locale and clientId as the conversational endpoint (all sourced
// from the auth token store + demoAgentConfig). The QS path itself is
// derived from the resolved /converse endpoint by swapping the
// `commerce/...` segment with the configured suffix in `discovery-config.ts`.

import { useEffect, useState } from 'react';
import { searchRouting } from '../discovery-config';
import { demoAgentConfig } from '../demo-agent.config';
import { authTokenStore } from './auth-token-store';

export type QuerySuggestion = {
  expression: string;
  highlighted?: string;
  score?: number;
};

export type QuerySuggestionsResult = {
  query: string;
  suggestions: QuerySuggestion[];
};

/**
 * Direct fetch — returns an empty list when the auth token is missing or the
 * response is malformed; callers should treat the empty result as "no
 * matches" rather than as an error.
 */
export async function fetchQuerySuggestions(query: string): Promise<QuerySuggestion[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const authHeader = authTokenStore.authorizationHeader();
  if (!authHeader) {
    return [];
  }

  const url = buildUrl();
  if (!url) {
    return [];
  }

  const defaults = authTokenStore.resolveRequestDefaults(demoAgentConfig.liveRequestDefaults);
  const body = {
    trackingId: defaults.trackingId,
    language: defaults.language,
    country: defaults.country,
    currency: defaults.currency,
    clientId: defaults.clientId,
    query: trimmed,
    context: {
      view: { url: resolveViewUrl() },
    },
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return [];
  }

  if (!response.ok) {
    return [];
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return [];
  }

  return extractCompletions(payload);
}

/**
 * React hook that wraps a typed query with debouncing + Coveo QS fetching.
 * Emits one result per (debounced, distinct) query; failures and empty /
 * short queries produce an empty suggestions list rather than throwing.
 * The React equivalent of the Angular `bindStream` RxJS pipeline.
 */
export function useQuerySuggestions(query: string): QuerySuggestionsResult {
  const [result, setResult] = useState<QuerySuggestionsResult>({ query: '', suggestions: [] });

  useEffect(() => {
    const trimmed = query.trim();
    let cancelled = false;

    const timer = window.setTimeout(() => {
      if (trimmed.length < searchRouting.querySuggestionsMinQueryLength) {
        setResult({ query: trimmed, suggestions: [] });
        return;
      }
      void fetchQuerySuggestions(trimmed).then((suggestions) => {
        if (!cancelled) {
          setResult({ query: trimmed, suggestions });
        }
      });
    }, searchRouting.querySuggestionsDebounceMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  return result;
}

function buildUrl(): string | null {
  const resolved = authTokenStore.resolveEndpoint(demoAgentConfig.liveEndpoint);
  // Replace everything from /commerce/ onward with the QS suffix.
  const match = resolved.match(/^(https?:\/\/[^/]+\/rest\/organizations\/[^/]+\/commerce\/).+$/);
  if (!match) {
    return null;
  }
  return `${match[1]}${searchRouting.querySuggestionsCommerceSuffix}`;
}

function resolveViewUrl(): string {
  if (typeof window !== 'undefined' && window.location?.href) {
    return window.location.href;
  }
  return 'http://localhost:5173/';
}

function extractCompletions(payload: unknown): QuerySuggestion[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const completions = (payload as { completions?: unknown }).completions;
  if (!Array.isArray(completions)) {
    return [];
  }
  return completions
    .map((entry): QuerySuggestion | null => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const expression = (entry as { expression?: unknown }).expression;
      if (typeof expression !== 'string' || !expression) {
        return null;
      }
      const highlighted = (entry as { highlighted?: unknown }).highlighted;
      const score = (entry as { score?: unknown }).score;
      return {
        expression,
        highlighted: typeof highlighted === 'string' ? highlighted : undefined,
        score: typeof score === 'number' ? score : undefined,
      };
    })
    .filter((s): s is QuerySuggestion => s !== null);
}
