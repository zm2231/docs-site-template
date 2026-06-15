#!/bin/sh
set -e
SLUG="$1"
DOMAIN="$2"
REPO="$3"
MODE="$4"
DEPLOY_DESC="$5"

if [ -z "$SLUG" ] || [ -z "$DOMAIN" ] || [ -z "$REPO" ] || [ -z "$MODE" ]; then
  echo "usage: make_site_skill.sh <slug> <domain> <repo-abs-path> <auth-mode> [deploy-desc]" >&2
  echo "example: make_site_skill.sh acme docs.acme.com /Users/me/acme-docs per-doc 'GitHub Actions'" >&2
  exit 1
fi
[ -n "$DEPLOY_DESC" ] || DEPLOY_DESC="push to main"

TPL="$(cd "$(dirname "$0")/.." && pwd)/.claude/skills/new-docs-site/per-site-skill-template.md"
if [ ! -f "$TPL" ]; then
  echo "template not found at $TPL" >&2
  exit 1
fi

DEST="$HOME/.claude/skills/share-${SLUG}"
mkdir -p "$DEST"
sed \
  -e "s|__SLUG__|${SLUG}|g" \
  -e "s|__DOMAIN__|${DOMAIN}|g" \
  -e "s|__REPO_PATH__|${REPO}|g" \
  -e "s|__AUTH_MODE__|${MODE}|g" \
  -e "s|__DEPLOY_DESC__|${DEPLOY_DESC}|g" \
  "$TPL" > "$DEST/SKILL.md"
echo "Wrote per-site skill: $DEST/SKILL.md"
echo "From now on, 'share this with the team' / 'publish to ${DOMAIN}' routes here."
