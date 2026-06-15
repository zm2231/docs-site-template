#!/bin/sh
set -e
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cmd="$1"
shift 2>/dev/null || true

usage() {
  cat <<'USAGE'
docs-site-template setup helper

Usage:
  sh scripts/setup.sh gen-secret
      Print a fresh random SESSION_SECRET (does not store it).

  sh scripts/setup.sh secrets
      Interactively set the Wrangler secrets for the chosen AUTH_MODE:
        site    -> SESSION_SECRET, SITE_USER, SITE_PASS
        per-doc -> SESSION_SECRET, INDEX_PASSWORD
      Turnstile (optional): TURNSTILE_SECRET_KEY

  sh scripts/setup.sh kv
      Create the AUTH_KV namespace and print the id to paste into wrangler.toml.

  sh scripts/setup.sh set-doc-password <slug> <password>
      Store a per-document password in AUTH_KV (per-doc mode).

  sh scripts/setup.sh rm-doc-password <slug>
      Remove a per-document password from AUTH_KV.
USAGE
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    echo ""
  fi
}

case "$cmd" in
  gen-secret)
    gen_secret
    ;;
  secrets)
    echo "Generating SESSION_SECRET and setting it as a Wrangler secret..."
    gen_secret | npx wrangler secret put SESSION_SECRET
    echo ""
    echo "AUTH_MODE 'site' uses SITE_USER + SITE_PASS. 'per-doc' uses INDEX_PASSWORD."
    echo "Set whichever your wrangler.toml AUTH_MODE needs:"
    echo "  npx wrangler secret put SITE_USER"
    echo "  npx wrangler secret put SITE_PASS"
    echo "  npx wrangler secret put INDEX_PASSWORD"
    echo "  npx wrangler secret put TURNSTILE_SECRET_KEY   (optional)"
    ;;
  kv)
    echo "Creating AUTH_KV namespace..."
    npx wrangler kv namespace create AUTH_KV
    echo ""
    echo "Paste the printed id into wrangler.toml under [[kv_namespaces]] binding=AUTH_KV."
    ;;
  set-doc-password)
    slug="$1"; pw="$2"
    if [ -z "$slug" ] || [ -z "$pw" ]; then
      echo "usage: set-doc-password <slug> <password>" >&2; exit 1
    fi
    printf '%s' "$pw" | npx wrangler kv key put --binding AUTH_KV "pw:$slug" --path /dev/stdin
    echo "Set password for doc '$slug'."
    ;;
  rm-doc-password)
    slug="$1"
    if [ -z "$slug" ]; then echo "usage: rm-doc-password <slug>" >&2; exit 1; fi
    npx wrangler kv key delete --binding AUTH_KV "pw:$slug"
    echo "Removed password for doc '$slug'."
    ;;
  *)
    usage
    ;;
esac
