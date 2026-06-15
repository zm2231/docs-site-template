#!/bin/sh
set -e
SLUG="$1"
SRC="$2"
TITLE="$3"

if [ -z "$SLUG" ] || [ -z "$SRC" ]; then
  echo "usage: add_doc.sh <slug> <source-file-or-dir> [title]" >&2
  echo "  source can be: an .html file, a .md file, a .pdf, or a directory (pre-built SPA/dist)" >&2
  exit 1
fi
if [ ! -e "$SRC" ]; then
  echo "add_doc: source not found: $SRC" >&2
  exit 1
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$ROOT/public/$SLUG"
mkdir -p "$DEST"
[ -n "$TITLE" ] || TITLE="$(echo "$SLUG" | tr '-' ' ')"

if [ -d "$SRC" ]; then
  cp -R "$SRC"/. "$DEST"/
  if [ ! -f "$DEST/index.html" ]; then
    echo "add_doc: warning — $SRC has no index.html; the folder must contain one to be served." >&2
  fi
  echo "Added directory doc at public/$SLUG/ (served as-is)."
else
  base="$(basename "$SRC")"
  ext="$(echo "$base" | tr '[:upper:]' '[:lower:]' | sed 's/.*\.//')"
  case "$ext" in
    html|htm)
      cp "$SRC" "$DEST/index.html"
      echo "Added HTML doc at public/$SLUG/."
      ;;
    md|markdown)
      cp "$SRC" "$DEST/$base"
      sed -e "s|__MD_FILE__|$base|g" -e "s|__TITLE__|$TITLE|g" "$HERE/md-viewer.html" > "$DEST/index.html"
      echo "Added Markdown doc at public/$SLUG/ (rendered client-side by md-viewer)."
      ;;
    pdf)
      cp "$SRC" "$DEST/$base"
      printf '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>%s</title>\n<style>html,body,iframe{margin:0;padding:0;border:0;width:100%%;height:100vh}</style>\n</head><body><iframe src="%s"></iframe></body></html>\n' "$TITLE" "$base" > "$DEST/index.html"
      echo "Added PDF doc at public/$SLUG/ (iframe wrapper)."
      ;;
    *)
      cp "$SRC" "$DEST/$base"
      echo "add_doc: copied $base into public/$SLUG/ but did not create an index.html — add one so the folder serves." >&2
      ;;
  esac
fi

META="$DEST/_meta.json"
if [ ! -f "$META" ]; then
  printf '{\n  "title": "%s",\n  "desc": "",\n  "confidential": false,\n  "tags": ["Doc"]\n}\n' "$TITLE" > "$META"
  echo "Wrote $META (edit desc/tags, tags must be in scripts/tags.json)."
fi

echo "Next: python3 scripts/build_index.py && git add -A && git commit -m 'Add $SLUG' && git push"
