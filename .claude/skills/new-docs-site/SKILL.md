---
name: new-docs-site
description: >
  Spin up a brand-new gated docs site on Cloudflare from the docs-site-template.
  Use when the user wants to stand up a new shared/gated/private documents site,
  a client deliverable portal, or says things like "spin up a new docs site",
  "create a gated docs site", "new shared docs site", "stand up a docs portal on
  Cloudflare", "make a password-protected docs site". This BUILDS a new site
  (clone the template, configure, deploy). Deploy target is Cloudflare, never a
  VPS. To add a doc to an ALREADY-built site, use that site's generated
  "share-<slug>" skill, or the in-repo "docs-site" skill.
compatibility: Requires git, the gh CLI, node/npm, python3, and a Cloudflare account. No private dependencies; everything is generic Cloudflare.
---

# Spin up a new gated docs site

Clones `docs-site-template`, configures it, deploys it to Cloudflare, then writes
a per-site skill into the user's global skills so future "share this" requests
route to it.

## Step 1 — Gather the choices

Ask the user (don't guess what isn't given):

1. **Site name / slug** (kebab-case, e.g. `acme-docs`). Becomes the repo name,
   the Worker name, and the generated skill's name.
2. **Custom domain** (e.g. `docs.acme.com`) on a zone in the user's Cloudflare
   account.
3. **Auth mode**:
   - `site` — one shared login for a single trust boundary.
   - `per-doc` — gated index plus a separate password per client folder.
   - `none` — public, or gated upstream by Cloudflare Access (SSO/identity).
4. **Deploy path** (both are Cloudflare; pick one, never a VPS). Default to the
   first unless the user asks for CI:
   - **Cloudflare native Git (Workers Builds)** — the default. Connect the repo
     in the Cloudflare dashboard; no workflow file, no repo secret, nothing to
     fail. Freshness is enforced by the local pre-push hook.
   - **GitHub Actions** — opt-in. Push-to-deploy with a CI freshness check; needs
     a `CLOUDFLARE_API_TOKEN` repo secret. The repo ships the workflow inert
     under `examples/`; enable it only if chosen.

## Step 2 — Clone the template

If you are NOT already inside a docs-site-template checkout, clone a fresh one:

```bash
DEST=<absolute path for the new repo>
git clone https://github.com/zm2231/docs-site-template "$DEST"
cd "$DEST"
rm -rf .git node_modules .wrangler && git init -q
```

If you are ALREADY inside a clone of the template, skip the clone and use the
current directory as `$DEST`.

## Step 3 — Configure

Fill `wrangler.toml`: replace `replace-worker-name` (the slug),
`replace-cloudflare-account-id`, and the route `pattern` (the domain). Set
`AUTH_MODE` and `SITE_TITLE` under `[vars]`.

- Account id: `npx wrangler whoami` (or the Cloudflare dashboard, right sidebar).
- The repo ships no active workflow, so nothing runs (or fails) until you wire a
  deploy path in Step 6.

## Step 4 — Auth, secrets, KV, Turnstile

```bash
npm install
npx wrangler login        # browser OAuth; no token to handle for manual deploys
```

- Always: `sh scripts/setup.sh secrets` (generates + sets `SESSION_SECRET`).
- `site` mode: `npx wrangler secret put SITE_USER` and `SITE_PASS`.
- `per-doc` mode: `sh scripts/setup.sh kv`, paste the printed id into
  `wrangler.toml` under a `[[kv_namespaces]]` block with `binding = "AUTH_KV"`,
  then `npx wrangler secret put INDEX_PASSWORD`, then one
  `sh scripts/setup.sh set-doc-password <slug> '<pw>'` per client folder.
  (The namespace must be in `wrangler.toml` before set-doc-password works.)
- Optional Turnstile: create a widget in the Cloudflare dashboard (Turnstile →
  Add site), put the site key in `wrangler.toml [vars]` as `TURNSTILE_SITE_KEY`,
  and run `npx wrangler secret put TURNSTILE_SECRET_KEY`.

## Step 5 — Add the user's first docs (any stack)

`scripts/add_doc.sh` scaffolds a doc folder from whatever the user has:

```bash
sh scripts/add_doc.sh <slug> <source> ["Title"]
```
`<source>` can be an `.html` file, a `.md` file (rendered client-side by a
bundled viewer), a `.pdf` (iframe wrapper), or a directory (a pre-built
SPA/`dist`, served as-is). For a client-routed SPA, set
`not_found_handling = "single-page-application"` in `wrangler.toml`.

## Step 6 — Build, repo, deploy

```bash
python3 scripts/build_index.py
sh .githooks/install.sh
git add -A && git commit -m "Initial site"
```

- **Cloudflare native Git (default):** `npx wrangler deploy` once to create the
  Worker, then `gh repo create <account>/<slug> --private --source . --push`, then
  in the dashboard connect the repo to the Worker (Settings → Build → Connect)
  with: Root directory `/`, Build command `npm ci`, Deploy command
  `npx wrangler deploy`, Build watch paths `*`. Cloudflare auto-creates the build
  token. Subsequent pushes deploy themselves; no repo secret, nothing to fail.
  The build does NOT run `build_index.py` — the index is committed fresh by the
  pre-push hook, so Cloudflare only deploys (no python needed in the CF build).
- **GitHub Actions (opt-in):** enable the inert example first, then create the
  repo and token:
  ```bash
  mkdir -p .github/workflows && mv examples/github-actions-deploy.yml .github/workflows/deploy.yml
  gh repo create <account>/<slug> --private --source . --push
  gh secret set CLOUDFLARE_API_TOKEN   # prompts; create it in the CF dashboard (Edit Cloudflare Workers)
  ```
  The token stays out of shell history (gh prompts). The push triggers the deploy.

Verify: `curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/`.

## Step 7 — Write the per-site skill (the point of this whole flow)

```bash
sh scripts/make_site_skill.sh <slug> <domain> "$DEST" <auth-mode> "<deploy-desc>"
# e.g. sh scripts/make_site_skill.sh acme-docs docs.acme.com "$DEST" per-doc "GitHub Actions"
```

That writes `~/.claude/skills/share-<slug>/SKILL.md`. From then on "share this
with the team", "publish this to <domain>", or "add a doc to <slug>" routes to
that site. Tell the user it's installed and give one example trigger phrase.
