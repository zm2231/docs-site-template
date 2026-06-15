---
name: share-__SLUG__
description: >
  Publish or share a document on __DOMAIN__ (a gated Cloudflare Worker docs site,
  AUTH_MODE __AUTH_MODE__). Use when the user wants to share, publish, or add a
  doc to __DOMAIN__ or "__SLUG__", or says things like "share this with the
  team", "put this on __DOMAIN__", "add this to __SLUG__", "publish this to
  __SLUG__". Repo at __REPO_PATH__.
compatibility: Requires wrangler auth for the Cloudflare account, python3, and the repo's git hooks installed (sh .githooks/install.sh).
---

# Publish to __DOMAIN__

A gated docs site on Cloudflare. Auth mode: `__AUTH_MODE__`. Repo:
`__REPO_PATH__`. Push to `main` auto-deploys via __DEPLOY_DESC__.

## Add a doc

```bash
cd __REPO_PATH__
mkdir -p public/<slug>
```

1. Put the content at `public/<slug>/index.html` (HTML site, a Markdown viewer,
   a PDF in an iframe, or a pre-built SPA's `dist/` contents).
2. Add `public/<slug>/_meta.json`:
   ```json
   { "title": "...", "desc": "...", "confidential": false, "tags": ["Doc"] }
   ```
   Tags must be in `scripts/tags.json`. Add a new tag there first if needed.
3. Rebuild the index, commit, and push:
   ```bash
   python3 scripts/build_index.py
   git add -A && git commit -m "Add <slug>" && git push
   ```

The index page is generated. Never hand-edit `public/index.html`.

## Give a client their own password (per-doc mode only)

```bash
sh scripts/setup.sh set-doc-password <slug> '<password>'
```

Hand the client `https://__DOMAIN__/<slug>/` plus that password. They unlock
only that path. A client deliverable must be a folder, not a root-level file.

## Verify after deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://__DOMAIN__/<slug>/
```
