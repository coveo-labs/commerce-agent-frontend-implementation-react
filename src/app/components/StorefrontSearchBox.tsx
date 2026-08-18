// Storefront-style search box for the Conversational Discovery header.
//
// Behaviour:
//   - Plain text input + a sparkle/toggle that picks the routing mode
//   - As the user types, the mode auto-flips between classic search and
//     generative via `searchRouting.decideRoute(...)`
//   - Once the user clicks the toggle, that choice sticks until the field
//     is cleared (then auto-toggle resumes)
//   - Enter / Submit:
//       * generative mode → calls `onSubmitGenerative` (parent calls the agent)
//       * classic mode    → calls `searchRouting.handleClassicSearch`
//   - Dropdown panel below the input:
//       * generative mode + focused → curated popular queries
//       * classic    mode + focused + QS results → live Coveo suggestions
//
// All routing + prompt-source decisions live in `discovery-config.ts`; this
// component is purely presentational.

import { useEffect, useMemo, useRef, useState } from 'react';
import { conversationalDefaults, searchRouting, type SearchRoute } from '../discovery-config';
import {
  useQuerySuggestions,
  type QuerySuggestion,
} from '../services/query-suggestions.service';

type StorefrontSearchBoxProps = {
  disabled?: boolean;
  classicPlaceholder?: string;
  generativePlaceholder?: string;
  /**
   * When false (live mode), the curated popular-queries grid is hidden —
   * the entries describe the mock catalog, not the connected organization.
   */
  showPopularQueries?: boolean;
  onSubmitGenerative: (prompt: string) => void;
  /** Called with true while the search box is expanded (dropdown open). */
  onExpandedChange?: (expanded: boolean) => void;
};

export function StorefrontSearchBox({
  disabled = false,
  classicPlaceholder = 'Search products, brands, and categories',
  generativePlaceholder = 'Ask the AI product assistant…',
  showPopularQueries = true,
  onSubmitGenerative,
  onExpandedChange,
}: StorefrontSearchBoxProps) {
  const [value, setValue] = useState('');
  const [generativeMode, setGenerativeMode] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<QuerySuggestion[]>([]);

  const fieldRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLFormElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const qsResult = useQuerySuggestions(value);

  // Apply debounced QS results, dropping late responses for stale queries,
  // and re-run auto-routing now that the match count is known.
  useEffect(() => {
    if (qsResult.query !== valueRef.current.trim()) {
      return;
    }
    setSuggestions(qsResult.suggestions);
    if (!manualOverride) {
      setGenerativeMode(
        computeRoute(qsResult.query, qsResult.suggestions.length) === 'conversational',
      );
    }
  }, [qsResult, manualOverride]);

  // Surface a fresh set of popular queries whenever conversational intent
  // is detected (generative mode flips on).
  const prompts = useMemo(
    () => (generativeMode && showPopularQueries ? pickPopularQueries() : []),
    [generativeMode, showPopularQueries],
  );

  // Mirror the dropdown/expanded state to the parent so it can de-emphasize
  // the rest of the header.
  useEffect(() => {
    onExpandedChange?.(dropdownOpen);
  }, [dropdownOpen, onExpandedChange]);

  // Close the dropdown on any click outside the component.
  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      const host = wrapperRef.current;
      if (host && !host.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, []);

  const onInput = (next: string) => {
    setValue(next);
    if (!manualOverride) {
      setGenerativeMode(computeRoute(next, suggestions.length) === 'conversational');
    }
    if (next.length === 0) {
      setManualOverride(false);
      setSuggestions([]);
    }
    setDropdownOpen(true);
  };

  const onClear = () => {
    setValue('');
    setGenerativeMode(false);
    setManualOverride(false);
    setSuggestions([]);
    setDropdownOpen(true);
  };

  const onToggle = () => {
    setManualOverride(true);
    setGenerativeMode((current) => !current);
    setDropdownOpen(true);
    setTimeout(() => fieldRef.current?.focus(), 0);
  };

  const resetAfterSubmit = () => {
    setValue('');
    setGenerativeMode(false);
    setManualOverride(false);
    setSuggestions([]);
    setDropdownOpen(false);
  };

  const submit = (query: string) => {
    if (!query || disabled) {
      return;
    }
    if (generativeMode) {
      onSubmitGenerative(query);
    } else {
      searchRouting.handleClassicSearch(query);
    }
    resetAfterSubmit();
  };

  const onKeydown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setDropdownOpen(false);
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    submit(value.trim());
  };

  const onSuggestionPick = (suggestion: string) => {
    setValue(suggestion);
    setDropdownOpen(false);
    searchRouting.handleClassicSearch(suggestion);
    resetAfterSubmit();
  };

  const onPromptPick = (prompt: string) => {
    setValue(prompt);
    setDropdownOpen(false);
    onSubmitGenerative(prompt);
    resetAfterSubmit();
  };

  return (
    <form
      ref={wrapperRef}
      className="storefront-search storefront-header-search"
      onSubmit={(event) => {
        event.preventDefault();
        submit(value.trim());
      }}
    >
      <div className={`search-shell${generativeMode ? ' generative' : ''}`}>
        <span className="search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          ref={fieldRef}
          className="search-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={generativeMode ? generativePlaceholder : classicPlaceholder}
          value={value}
          disabled={disabled}
          onChange={(event) => onInput(event.target.value)}
          onFocus={() => setDropdownOpen(true)}
          onKeyDown={onKeydown}
          aria-label="Search the storefront"
          aria-expanded={dropdownOpen}
          aria-controls="storefront-search-dropdown"
        />

        {value && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => {
              onClear();
              fieldRef.current?.focus();
            }}
          >
            ×
          </button>
        )}

        <button
          type="button"
          className={`generative-toggle${generativeMode ? ' checked' : ''}`}
          role="switch"
          aria-checked={generativeMode}
          onClick={onToggle}
          aria-label={
            generativeMode ? 'Disable AI product assistant' : 'Enable AI product assistant'
          }
        >
          <span className="sparkle" aria-hidden="true">
            ✦
          </span>
          <span className="toggle-track">
            <span className="toggle-thumb"></span>
          </span>
        </button>

        <button
          type="submit"
          className="search-submit"
          disabled={disabled || !value.trim()}
          aria-label="Submit search"
        >
          {generativeMode ? 'Ask' : 'Search'}
        </button>
      </div>

      <p className={`search-hint${generativeMode ? ' generative' : ''}`}>
        {generativeMode ? (
          <span>
            <strong>AI product assistant</strong> · ask in full sentences
          </span>
        ) : (
          <span>
            <strong>Classic search</strong> · short keyword queries
          </span>
        )}
      </p>

      {dropdownOpen && (
        <div id="storefront-search-dropdown" className="search-dropdown" role="listbox">
          {generativeMode ? (
            prompts.length > 0 ? (
              <>
                <p className="dropdown-eyebrow">{conversationalDefaults.eyebrow}</p>
                <p className="dropdown-title">{conversationalDefaults.title}</p>
                <ul className="dropdown-prompt-grid">
                  {prompts.map((prompt) => (
                    <li key={prompt}>
                      <button
                        type="button"
                        className="dropdown-prompt"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onPromptPick(prompt)}
                      >
                        {prompt}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="dropdown-eyebrow">{conversationalDefaults.eyebrow}</p>
                <p className="dropdown-empty">
                  Ask the assistant anything about products, specs, or use cases.
                </p>
              </>
            )
          ) : suggestions.length > 0 ? (
            <>
              <p className="dropdown-eyebrow">Suggested searches</p>
              <ul className="dropdown-suggestions">
                {suggestions.map((s) => (
                  <li key={s.expression}>
                    <button
                      type="button"
                      className="dropdown-suggestion"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onSuggestionPick(s.expression)}
                    >
                      <span className="dropdown-suggestion-icon" aria-hidden="true">
                        ⌕
                      </span>
                      <span dangerouslySetInnerHTML={{ __html: renderHighlight(s) }} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : value.trim().length >= 2 ? (
            <p className="dropdown-empty">No suggestions yet — keep typing.</p>
          ) : (
            <p className="dropdown-empty">Start typing to see suggestions.</p>
          )}
        </div>
      )}
    </form>
  );
}

function computeRoute(query: string, querySuggestionsMatches: number): SearchRoute {
  return searchRouting.decideRoute({ query, querySuggestionsMatches });
}

/**
 * Render Coveo's `highlighted` field (which uses `[…]` to mark matched
 * substrings) as `<mark>` elements. Falls back to plain expression text.
 */
function renderHighlight(suggestion: QuerySuggestion): string {
  const escape = (s: string): string =>
    s.replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
  const raw = suggestion.highlighted ?? suggestion.expression;
  const segments: string[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const open = raw.indexOf('[', cursor);
    if (open === -1) {
      segments.push(escape(raw.slice(cursor)));
      break;
    }
    segments.push(escape(raw.slice(cursor, open)));
    const close = raw.indexOf(']', open + 1);
    if (close === -1) {
      segments.push(escape(raw.slice(open)));
      break;
    }
    segments.push(`<mark>${escape(raw.slice(open + 1, close))}</mark>`);
    cursor = close + 1;
  }
  return segments.join('');
}

/**
 * Returns a (optionally shuffled) capped subset of the static popular
 * queries from `discovery-config`. Recomputed each time conversational intent is
 * detected so the dropdown feels fresh.
 */
function pickPopularQueries(): string[] {
  const all = conversationalDefaults.popularQueries.filter((q) => q.trim().length > 0);
  const max = conversationalDefaults.maxDisplayed;
  if (all.length === 0 || max <= 0) {
    return [];
  }
  const list = conversationalDefaults.shuffle ? shuffle(all) : all.slice();
  return list.slice(0, Math.min(max, list.length));
}

function shuffle(input: string[]): string[] {
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
