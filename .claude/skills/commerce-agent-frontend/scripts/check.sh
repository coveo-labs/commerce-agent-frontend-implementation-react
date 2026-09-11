#!/usr/bin/env bash
# Verification gate for commerce-agent-frontend-implementation-react.
#
# Runs the real build/test gate, then scans for the mistakes this codebase
# invites: leaked tokens, decisions inlined into components that belong in
# discovery-config.ts, half-finished re-themes, and half-registered surfaces.
#
# Usage:  bash scripts/check.sh [repo-root]      (defaults to $PWD)
# Exit:   0 = clean
#         1 = FAIL — something you should fix before calling the change done
#         2 = WARN only — decide whether each warning is a real gap or intended
#
# NOTE: a clean, unmodified checkout exits 0. It carries two known baseline
# gaps (ProductResearchCard has no mock scenario; liveHeaders ships a
# 'Bearer your-token-here' placeholder). Those print as "pre-existing", not
# "WARN", and deliberately do not affect the exit code — so any WARN or FAIL
# you see came from your change.

set -uo pipefail

ROOT="${1:-$PWD}"
cd "$ROOT" || { echo "cannot cd to $ROOT" >&2; exit 1; }

if [ ! -f package.json ] || ! grep -q "commerce-agent-frontend" package.json; then
  echo "!! $ROOT does not look like the commerce-agent-frontend repo." >&2
  echo "   Pass the repo root as the first argument." >&2
  exit 1
fi

FAIL=0
WARN=0
say()  { printf '\n== %s\n' "$1"; }
bad()  { printf '   FAIL  %s\n' "$1"; FAIL=1; }
warn() { printf '   WARN  %s\n' "$1"; WARN=1; }
ok()   { printf '   ok    %s\n' "$1"; }
pre()  { printf '   pre-existing  %s\n' "$1"; }

# Stock values at the baseline commit, used to tell "you changed it" from
# "it always looked like this".
STOCK_PRIMARY="#4338ca"; STOCK_PRIMARY_RGB="67, *56, *202"
STOCK_SOFT="#e8ecff";    STOCK_SOFT_RGB="232, *236, *255"
STOCK_INK="#101828";     STOCK_INK_RGB="16, *24, *40"

token_value() { # token_value --primary  -> #4338ca
  sed -n "s/^[[:space:]]*$1:[[:space:]]*\(#[0-9a-fA-F]\{3,8\}\).*/\1/p" src/styles.css | head -1
}

# ---------------------------------------------------------------- build gate

say "Type check + build (tsc -b && vite build)"
if npm run build >/tmp/caf-build.log 2>&1; then
  ok "build passed"
else
  bad "build failed — see /tmp/caf-build.log"; tail -25 /tmp/caf-build.log
fi

say "Tests (vitest run)"
if npm test >/tmp/caf-test.log 2>&1; then
  ok "$(grep -Eo 'Tests +[0-9]+ passed.*' /tmp/caf-test.log | head -1)"
else
  bad "tests failed — see /tmp/caf-test.log"; tail -25 /tmp/caf-test.log
fi

# ------------------------------------------------------------------ secrets

say "Secrets"
# Test files legitimately carry a fake JWT to assert export redaction strips
# it. Everywhere else a JWT is a leak.
if grep -rInE 'eyJ[A-Za-z0-9_-]{15,}' src public index.html 2>/dev/null \
     | grep -vE '\.test\.(ts|tsx):'; then
  bad "what looks like a JWT is committed in the source above"
else
  ok "no JWT-shaped strings outside test fixtures"
fi
if grep -rInE 'Authorization[^\n]*Bearer +[A-Za-z0-9._-]{12,}' src 2>/dev/null \
     | grep -v 'your-token-here'; then
  bad "a real-looking Bearer token is committed above"
else
  ok "no committed bearer tokens"
fi
if grep -nE '^\s*(token|authToken|bearer)\s*:' src/app/demo-agent.config.ts 2>/dev/null; then
  bad "livePresets/config must never carry a token — tokens are runtime-only"
else
  ok "no token field in demo-agent.config.ts"
fi
# demoAgentConfig.liveHeaders is spread into every live request and only
# overridden when the token store is non-empty, so the shipped placeholder is
# sent verbatim on a blank panel and the 401 reads like an expired token.
if grep -q "your-token-here" src/app/demo-agent.config.ts 2>/dev/null; then
  pre "liveHeaders still ships 'Bearer your-token-here' — it is sent verbatim when the Connection panel is empty, and the resulting 401 looks like an expired token"
fi

# ------------------------------------------------ config-over-component drift

say "Configuration boundaries"
COMPONENTS=$(find src/app/components -name '*.tsx' ! -name '*.test.tsx' 2>/dev/null)
if [ -n "$COMPONENTS" ] && grep -In 'buildPdpUrl' $COMPONENTS 2>/dev/null | grep -v 'productCta.buildPdpUrl'; then
  bad "PDP URL logic in a component — it belongs in discovery-config.ts productCta"
else
  ok "PDP routing stays in discovery-config.ts"
fi
if [ -n "$COMPONENTS" ] && grep -InE 'https?://(www\.)?[a-z0-9-]+\.[a-z]{2,}' $COMPONENTS 2>/dev/null \
     | grep -vE 'placehold\.co|motion\.dev|w3\.org|^\s*//'; then
  warn "hardcoded external URL in a component — should it be config or catalog data?"
else
  ok "no hardcoded storefront URLs in components"
fi
if [ -n "$COMPONENTS" ] && grep -InE 'conversationalOperators|conversationalWordThreshold|classicOperators' $COMPONENTS 2>/dev/null; then
  bad "routing rules referenced in a component — always call searchRouting.decideRoute()"
else
  ok "routing decisions go through decideRoute()"
fi

# ------------------------------------------------------------ theme coherence

say "Theme coherence"
# The accent is NOT fully tokenised: it is also spelled out as rgba() channel
# triples. Changing the token alone leaves the old brand behind on focus
# rings, borders, shadows and the AI-toggle sparkle.
THEMED=0
for pair in "--primary:$STOCK_PRIMARY:$STOCK_PRIMARY_RGB" \
            "--primary-soft:$STOCK_SOFT:$STOCK_SOFT_RGB" \
            "--ink:$STOCK_INK:$STOCK_INK_RGB"; do
  tok="${pair%%:*}"; rest="${pair#*:}"; stock="${rest%%:*}"; rgb="${rest#*:}"
  cur="$(token_value "$tok")"
  [ -z "$cur" ] && continue
  left=$(grep -cE "rgba\($rgb" src/styles.css 2>/dev/null || echo 0)
  if [ "$(echo "$cur" | tr 'A-Z' 'a-z')" != "$stock" ]; then
    THEMED=1
    if [ "$left" -gt 0 ]; then
      bad "$tok was re-themed to $cur but $left rgba($rgb …) literals still carry the old colour — the app will render half in the old brand"
    else
      ok "$tok re-themed to $cur with no stale literals"
    fi
  fi
done
if [ "$THEMED" -eq 0 ]; then
  ok "palette unchanged from stock (nothing to check)"
fi

# ------------------------------------------------------- surface registration

say "Surface registration"
TYPES=$(sed -n '/^export type CommerceSurfaceComponentType/,/;/p' src/app/models.ts \
        | grep -oE "'[A-Za-z]+'" | tr -d "'" | grep -v '^ProductCard$')
for t in $TYPES; do
  MISSING=""
  # SurfaceOutlet's switch has a `default: return null`, so a missing case
  # renders nothing with no error and no type failure.
  grep -q "case '$t':" src/app/components/SurfaceOutlet.tsx || MISSING="$MISSING SurfaceOutlet(renders-nothing)"
  grep -q "case '$t':" src/app/a2ui-parser.ts               || MISSING="$MISSING draftToSurface(surface-dropped)"
  grep -q "componentType === '$t'" src/app/a2ui-parser.ts    || MISSING="$MISSING seed-loop(resets-next-snapshot)"
  grep -q "$t" src/app/mock-catalog.ts                       || MISSING="$MISSING mock-catalog(invisible-in-mock-mode)"
  if [ -n "$MISSING" ]; then
    if [ "$t" = "ProductResearchCard" ] && [ "$MISSING" = " mock-catalog(invisible-in-mock-mode)" ]; then
      pre "ProductResearchCard has no mock scenario — known gap at the baseline commit, not caused by your change"
    else
      warn "$t not wired in:$MISSING"
    fi
  else
    ok "$t fully wired"
  fi
done

# ------------------------------------------------------------ loading states

say "Loading states"
for f in src/app/components/*.tsx; do
  case "$(basename "$f")" in
    Skeleton.tsx|SurfaceOutlet.tsx|ComparisonSummary.tsx|*.test.tsx) continue ;;
  esac
  if grep -q 'isLoading' "$f" && ! grep -q 'Skeleton' "$f"; then
    warn "$(basename "$f") branches on isLoading but renders no skeleton"
  fi
done
if grep -q 'prefers-reduced-motion' src/styles.css; then
  ok "reduced-motion guard present in styles.css"
else
  bad "the prefers-reduced-motion guard disappeared from styles.css"
fi

# ------------------------------------------------------------------- summary

say "Summary"
if [ "$FAIL" -ne 0 ]; then
  echo "   FAILED — fix the items above before reporting the change as done."
  exit 1
elif [ "$WARN" -ne 0 ]; then
  echo "   Passed with warnings. Each is either a real gap or a deliberate"
  echo "   choice — decide which. 'pre-existing' lines are not yours."
  exit 2
else
  echo "   All checks passed."
  exit 0
fi
