---
name: new-docs-site
description: >
  Spin up a brand-new gated docs site on Cloudflare from the docs-site-template.
  Use when the user wants to stand up a new shared/gated/private documents site,
  a client deliverable portal, or says things like "spin up a new docs site",
  "create a gated docs site", "new shared docs site", "stand up a docs portal on
  Cloudflare", "make a password-protected docs site". This BUILDS a new site
  (new repo + Worker + deploy). To add a doc to an ALREADY-built site, use that
  site's own generated "share-<slug>" skill instead.
compatibility: Requires the docs-site-template (local at /Volumes/4/templates/docs-site-template or github.com/zm2231/docs-site-template), wrangler auth, gh CLI, python3, and a Cloudflare account. Reads Cloudflare tokens/accounts via the cloudflare skill.
---

# Spin up a new gated docs site

Builds a new Cloudflare Worker docs site from `docs-site-template`, then writes a
per-site skill into the user's global skills so future "share this" requests
route to it automatically.

The template and its full design are documented in its README. Read it once at
`/Volumes/4/templates/docs-site-template/README.md` before starting.

## Step 1 — Gather the choices

Ask the user (don't guess what isn't given):

1. **Site name / slug** (kebab-case, e.g. `acme-docs`). Becomes the repo name,
   the Worker name, and the generated skill's name.
2. **Custom domain** (e.g. `docs.acme.com`). Must be a zone on a Cloudflare
   account you control. See the `cloudflare` skill for which account owns which
   zone.
3. **Auth mode**:
   - `site` — one shared login for a single trust boundary.
   - `per-doc` — gated index plus a separate password per client folder.
   - `none` — public, or gated upstream by Cloudflare Access (SSO/identity).
4. **Deploy path**:
   - **GitHub Actions** — push-to-deploy with a CI freshness check; needs a
     `CLOUDFLARE_API_TOKEN` repo secret.
   - **Cloudflare native Git (Workers Builds)** — connect the repo in the CF
     dashboard; no workflow file, no repo secret. (See the cloudflare skill's
     `references/auto-deploy-git.md`.)
5. **GitHub account/visibility** (default: the user's account, private).

## Step 2 — Scaffold the repo

```bash
SRC=/Volumes/4/templates/docs-site-template
DEST=<absolute path for the new repo>
cp -R "$SRC" "$DEST"
cd "$DEST"
rm -rf .git node_modules .wrangler
git init -q
```

Fill `wrangler.toml`: replace `replace-worker-name` (the slug), `replace-cloudflare-account-id`
(the account id from the cloudflare skill), and the route `pattern` (the domain).
Set `AUTH_MODE` and `SITE_TITLE` under `[vars]`.

If using **Cloudflare native Git**, delete the Actions workflow so it can't fail
for want of a token: `rm -rf .github`.

## Step 3 — Secrets, KV, Turnstile

```bash
npm install
export CLOUDFLARE_API_TOKEN=<deploy token from cloudflare skill>
export CLOUDFLARE_ACCOUNT_ID=<account id>
```

- Always: `sh scripts/setup.sh secrets` (generates + sets `SESSION_SECRET`).
- `site` mode: `npx wrangler secret put SITE_USER` and `SITE_PASS`.
- `per-doc` mode: `sh scripts/setup.sh kv` (create the namespace, paste the id
  into `wrangler.toml` under `[[kv_namespaces]]` binding `AUTH_KV`), then
  `npx wrangler secret put INDEX_PASSWORD`, then one
  `sh scripts/setup.sh set-doc-password <slug> '<pw>'` per client folder.
- Optional Turnstile: set `TURNSTILE_SITE_KEY` in `wrangler.toml [vars]` and
  `npx wrangler secret put TURNSTILE_SECRET_KEY` (widget via the cloudflare
  skill / READALL token).

## Step 4 — First build, repo, deploy

```bash
python3 scripts/build_index.py
sh .githooks/install.sh
git add -A && git commit -m "Initial site"
```

- **GitHub Actions path:** `gh repo create <account>/<slug> --private --source . --push`,
  then add the repo secret: `gh secret set CLOUDFLARE_API_TOKEN --body "<token>"`.
  The push triggers the deploy.
- **Cloudflare native Git path:** `gh repo create ... --source . --push`, then in
  the CF dashboard connect the repo to the Worker (Settings → Build → Connect),
  deploy command `npx wrangler deploy`. Or do a first manual `npx wrangler deploy`
  to create the Worker, then connect git for subsequent pushes.

Verify:
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/   # 200 or login page
```

## Step 5 — Write the per-site skill (the point of this whole flow)

This is what makes "share this site" work forever after. Generate a skill bound
to the new site and install it into the user's global skills:

```bash
sh scripts/make_site_skill.sh <slug> <domain> "$DEST" <auth-mode> "<deploy-desc>"
# e.g.
sh scripts/make_site_skill.sh acme-docs docs.acme.com "$DEST" per-doc "GitHub Actions"
```

That writes `~/.claude/skills/share-<slug>/SKILL.md`. From then on, "share this
with the team", "publish this to <domain>", or "add a doc to <slug>" routes to
that site and runs the add-doc + rebuild + commit + push flow, with the per-doc
password helper when relevant.

Tell the user the per-site skill is installed and give one example trigger
phrase.
