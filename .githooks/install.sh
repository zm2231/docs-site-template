#!/bin/sh
ROOT="$(git rev-parse --show-toplevel)"
prev="$(git -C "$ROOT" config --get core.hooksPath || true)"
case "$prev" in
  ""|.githooks|*/.githooks) ;;
  *) git -C "$ROOT" config docsite.parentHooks "$prev"
     echo "Captured your existing hooks ($prev) — they still run via delegation." ;;
esac
git -C "$ROOT" config core.hooksPath .githooks
chmod +x "$ROOT"/.githooks/* 2>/dev/null
echo "docs-site git hooks active for this clone (core.hooksPath = .githooks)."
echo "pre-commit regenerates the index; pre-push blocks a stale or invalid index."
