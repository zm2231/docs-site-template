---
name: docs-site
description: >
  Publish a document to this Cloudflare Worker docs site and manage its access.
  Use when the user wants to add, publish, or share a doc from this repo, set a
  per-document password for a client, or change the access mode. The site serves
  static assets from public/ behind a Worker that gates access (site login /
  per-doc password / public). The index page is generated from git + _meta.json.
compatibility: Requires wrangler auth, a CLOUDFLARE_API_TOKEN with Workers deploy scope, python3, and the repo's git hooks installed.
---

# docs-site publishing

Static docs on Cloudflare. Push to `main` → GitHub Actions runs
`build_index.py --check` then `wrangler deploy`.

## Access models

The site runs one `AUTH_MODE` (set in `wrangler.toml`):

- **`site`**, one shared login gates everything. Secrets: `SITE_USER`,
  `SITE_PASS`, `SESSION_SECRET`.
- **`per-doc`**, gated index (`INDEX_PASSWORD`) plus a per-document password in
  KV. Each client unlocks only their path. Set a doc password with
  `sh scripts/setup.sh set-doc-password <slug> '<password>'`.
- **`none`**, Worker passthrough. Public, or gate upstream with Cloudflare
  Access for SSO/email identity.

All modes support Turnstile on the login and KV-backed IP rate limiting.

## Add a doc

1. Create `public/<slug>/index.html` (HTML site, Markdown viewer, PDF in an
   iframe, or a pre-built SPA's `dist/` contents).
2. Add `public/<slug>/_meta.json`:
   ```json
   { "title": "...", "desc": "...", "confidential": false, "tags": ["Doc"] }
   ```
   Tags must exist in `scripts/tags.json`. Add a new tag there first if needed
   (the pre-push gate rejects off-vocab tags).
3. Rebuild and push:
   ```bash
   python3 scripts/build_index.py
   git add -A && git commit -m "Add <slug>" && git push
   ```

The index page is generated. Never hand-edit `public/index.html`.

## Share a client doc with its own password (per-doc mode)

```bash
sh scripts/setup.sh set-doc-password acme-deck 'client-password'
```

Give the client `https://<domain>/acme-deck/` plus that password. They unlock
only that path. Remove later with `rm-doc-password acme-deck`.

## First-time setup

See `README.md`. In short: replace the `replace-*` placeholders in
`wrangler.toml`, `npm install`, `sh scripts/setup.sh secrets`, set the secrets
for your mode, `sh .githooks/install.sh`, then push.

## Verify after deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/         # expect 200 or login
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/<slug>/  # gated path
```
