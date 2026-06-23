---
name: docs-site
description: >
  Set up, publish to, and manage THIS Cloudflare Worker docs site (you are inside
  a docs-site-template checkout). Use when the user wants to do first-time setup
  of this cloned site, add/publish a doc (HTML, Markdown, PDF, or a pre-built
  SPA), set a per-document password for a client, or install the per-site "share"
  skill. Deploy target is Cloudflare, never a VPS. The index page is generated
  from git + _meta.json. To stand up a NEW site from scratch, use "new-docs-site".
compatibility: Requires node/npm, python3, wrangler (npx), the gh CLI for repo creation, and a Cloudflare account.
---

# Work with this docs site

You are inside a clone of `docs-site-template`: a gated docs site on a single
Cloudflare Worker. If it isn't set up yet, do First-time setup. Otherwise jump to
Add a doc.

## Access models

One `AUTH_MODE` (set in `wrangler.toml`):

- **`site`** — one shared login gates everything. Secrets: `SITE_USER`,
  `SITE_PASS`, `SESSION_SECRET`.
- **`per-doc`** — gated index (`INDEX_PASSWORD`) plus a per-document password in
  KV. Each client unlocks only their folder; nothing is public.
- **`mixed`** — same as `per-doc`, but a folder with no password is public.
  A hub of open docs plus a few gated client folders, behind a locked index.
- **`none`** — Worker passthrough. Public, or gate upstream with Cloudflare
  Access for SSO/email identity.

All modes support Turnstile on the login and KV-backed IP rate limiting.

## First-time setup (only if this clone isn't deployed yet)

1. Fill `wrangler.toml`: `replace-worker-name` (a slug), `replace-cloudflare-account-id`
   (`npx wrangler whoami`), the route `pattern` (the domain). Set `AUTH_MODE` and
   `SITE_TITLE` under `[vars]`.
2. `npm install` then `npx wrangler login`.
3. `sh scripts/setup.sh secrets` (sets `SESSION_SECRET`), then the secrets for
   your mode:
   - `site`: `npx wrangler secret put SITE_USER` and `SITE_PASS`.
   - `per-doc`: `sh scripts/setup.sh kv`, then **add** a kv block to
     `wrangler.toml` (it isn't there by default):
     ```toml
     [[kv_namespaces]]
     binding = "AUTH_KV"
     id = "<the-printed-id>"
     ```
     then `npx wrangler secret put INDEX_PASSWORD` and one
     `sh scripts/setup.sh set-doc-password <slug> '<pw>'` per client.
   - `none`: nothing; for SSO add a Cloudflare Access app (Zero Trust dashboard).
4. `sh .githooks/install.sh`.
5. Deploy. Default is Cloudflare native Git: run `npx wrangler deploy` once to
   create the Worker. Connecting the repo for auto-deploy is **dashboard-only**
   (no CLI exists); hand the user this path: dashboard → Workers and Pages → the
   Worker → Settings → Build → Connect, with Root directory `/`, Build command
   `npm ci`, Deploy command `npx wrangler deploy`, Build watch paths `*`. Pushes
   then deploy themselves. The CF build does not regenerate the index (the
   pre-push hook keeps the committed one fresh). To use GitHub Actions instead,
   `mkdir -p .github/workflows && mv examples/github-actions-deploy.yml .github/workflows/deploy.yml`,
   then `gh secret set CLOUDFLARE_API_TOKEN` (prompts, stays out of history). See README.
6. **Install the per-site skill** so "share this" works going forward:
   ```bash
   sh scripts/make_site_skill.sh <slug> <domain> "$(git rev-parse --show-toplevel)" <auth-mode> "<deploy-desc>"
   ```
   That writes `~/.claude/skills/share-<slug>/SKILL.md`.

## Add a doc (any stack)

Use the scaffolder; it handles whatever the user has:

```bash
sh scripts/add_doc.sh <slug> <source> ["Title"]
```
- `.html` file → served directly
- `.md` file → rendered client-side by a bundled markdown viewer
- `.pdf` → iframe wrapper
- a directory → pre-built SPA / `dist`, served as-is (for client-routed SPAs set
  `not_found_handling = "single-page-application"` in `wrangler.toml`)

Then edit the generated `public/<slug>/_meta.json` (`title`, `desc`, `tags` from
`scripts/tags.json`), rebuild, and push:

```bash
python3 scripts/build_index.py
git add -A && git commit -m "Add <slug>" && git push
```

The index page is generated. Never hand-edit `public/index.html`.

## Give a client their own password (per-doc mode)

```bash
sh scripts/setup.sh set-doc-password acme-deck 'client-password'
```

Hand the client `https://<domain>/acme-deck/` plus that password. They unlock
only that path. Per-doc passwords are folder-scoped: a client deliverable must
be a folder. A root-level file is gated by the index password. Remove a password
with `rm-doc-password acme-deck`.

## Verify after deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/         # 200 or login
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/<slug>/  # gated path
```
