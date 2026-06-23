# docs-site-template

A gated docs site that runs on a single Cloudflare Worker. Drop HTML into
`public/`, push, and the Worker serves it behind whatever lock you picked: a
shared login, a per-client password, or nothing at all. The index page builds
itself from git history and a small metadata file per doc, so you never
hand-maintain a list of links.

I built this after wiring the same gate by hand one too many times. The auth
worker, the self-generating index, the deploy, and the hooks that stop you
shipping a stale index are all here, and all of it is one `wrangler deploy`
from live.

## What you get

| Piece | What it does |
|---|---|
| `src/auth-worker.ts` | the gate: `site` / `per-doc` / `none`, with sessions, Turnstile, and rate limiting |
| `public/` | your docs, plus a generated `index.html` you never edit |
| `scripts/build_index.py` | builds the index from git (date, author) and each doc's `_meta.json` |
| `.githooks/` | regenerate the index on commit, block a stale or off-vocab one on push |
| `examples/` | an opt-in GitHub Actions workflow (default deploy is Cloudflare's own) |

## Pick a lock: `AUTH_MODE`

Four modes. You set one in `wrangler.toml`.

- **`site`**: one username and password gate every URL. This is the right call
  for a team with a single trust boundary.
- **`per-doc`**: the index is locked, and each client folder carries its own
  password. Hand a client `/acme-deck/` plus a password and they unlock that
  folder and nothing else. They never see the index or the other clients' work.
  A folder with no password set falls back to the index password, so nothing is
  ever public.
- **`mixed`**: like `per-doc` (locked index, per-client folder passwords) except
  a folder with no password set is **public**. Use it for a hub that mixes open
  docs with a few gated client folders. The index stays locked because it lists
  every folder by name; public folders are reached by direct link.
- **`none`**: the Worker waves everything through. Use it when the site is
  public, or when Cloudflare Access sits in front and handles identity for you.

All four run the same machinery underneath: an HMAC-signed session cookie,
optional Cloudflare Turnstile on the login, and KV-backed rate limiting that
locks an IP out after enough bad guesses. Passwords live in Wrangler secrets or
in KV. They never land in the repo and never reach the browser.

Per-doc passwords are folder-scoped. A client deliverable is a folder
(`public/acme-deck/`), and its password gates everything under that path. A
root-level file like `public/note.html`, and any shared asset like `/logo.png`,
maps to the index gate, so the index page can still load its own assets once you
are past the index password. Put anything a client unlocks on its own in a
folder.

If a required secret is missing the Worker returns 503, not the content. A
misconfiguration fails shut.

## Two ways to deploy. Pick one.

Both run on Cloudflare. The repo ships **no active workflow** on purpose, so a
fresh clone never has a red CI run failing for a token it doesn't have yet.

**Cloudflare native Git (the default).** Connect the repo once in the Cloudflare
dashboard (Workers and Pages → your Worker → Settings → Build → Connect), with:

| Workers Builds setting | Value |
|---|---|
| Root directory | `/` |
| Build command | `npm ci` |
| Deploy command | `npx wrangler deploy` |
| Build watch paths | `*` (rebuild on any push; see note) |

No workflow file, no repo secret, no token to rotate. Cloudflare auto-creates the
build token. The build only installs deps and runs `wrangler deploy`; it does
**not** regenerate the index. The index is already fresh in the commit, because
the local `pre-push` hook rebuilds and blocks a stale one before the push leaves
your machine, so Cloudflare just deploys what you pushed. (Build watch paths are
evaluated relative to the repo root, not the root-directory setting; `*` is right
for this single-worker repo so every content push deploys.)

**GitHub Actions (opt-in).** If you'd rather GitHub run the deploy and the
freshness check in CI, move the example workflow into place and add the token:

```bash
mkdir -p .github/workflows
mv examples/github-actions-deploy.yml .github/workflows/deploy.yml
gh secret set CLOUDFLARE_API_TOKEN     # prompts; create it in the CF dashboard
```

It checks the index is fresh, then runs `wrangler deploy` on every push to
`main`. Only do this if you want it; otherwise leave the example where it is.

## Setup

1. Copy this folder into a new repo and fill the `replace-*` placeholders in
   `wrangler.toml` (`name`, `account_id`, the route `pattern`).

2. Install and generate a session secret:
   ```bash
   npm install
   sh scripts/setup.sh secrets
   ```
   That sets `SESSION_SECRET` and prints the other secrets to set.

3. For `site` mode, set the login:
   ```bash
   npx wrangler secret put SITE_USER
   npx wrangler secret put SITE_PASS
   ```

4. For `per-doc` mode, create the KV namespace and **add** this block to
   `wrangler.toml` (the default config ships without it):
   ```toml
   [[kv_namespaces]]
   binding = "AUTH_KV"
   id = "<the-id-from-setup.sh-kv>"
   ```
   then set the index password and any per-client passwords:
   ```bash
   sh scripts/setup.sh kv          # prints the namespace id; add the block first
   npx wrangler secret put INDEX_PASSWORD
   sh scripts/setup.sh set-doc-password acme-deck 'their-password'
   ```
   The namespace must be in `wrangler.toml` before `set-doc-password` works. KV
   also backs rate limiting in every mode, so add it even for `site` mode if you
   want the IP lockout.

5. To turn on Turnstile, create a widget, set `TURNSTILE_SITE_KEY` under
   `[vars]` in `wrangler.toml`, and set the secret:
   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```
   With no Turnstile keys the login still works. It just skips the captcha.

6. Activate the hooks, then wire a deploy path (next section):
   ```bash
   sh .githooks/install.sh
   ```
   A first manual `npx wrangler deploy` creates the Worker. After that, connect
   Cloudflare native Git (the default) or opt into GitHub Actions so pushes
   deploy on their own.

## Adding a doc (any stack)

`public/index.html` is generated. Never hand-edit it.

The scaffolder takes whatever you have and sets up the folder:

```bash
sh scripts/add_doc.sh <slug> <source> ["Title"]
```

| Your stack | `<source>` | Result |
|---|---|---|
| HTML page or site | an `.html` file | served directly |
| Markdown | a `.md` file | rendered in the browser by a bundled viewer (marked + DOMPurify) |
| PDF | a `.pdf` file | wrapped in a full-page iframe |
| Pre-built SPA / static export | a directory | the `dist`/`out` contents, served as-is |

For a client-routed SPA (deep links resolve in JS), flip
`not_found_handling = "single-page-application"` in `wrangler.toml`. The default
`none` is right for plain docs and a per-doc gate, where an SPA fallback would
leak the index.

Then edit the generated `public/<slug>/_meta.json` (`title`, `desc`, `tags` from
`scripts/tags.json`), rebuild, and push:

```bash
python3 scripts/build_index.py
git add -A && git commit -m "Add <slug>" && git push
```

`pre-commit` regenerates and stages the index when a commit touches `public/`.
`pre-push`, and the CI check on the Actions path, block a stale or off-vocab
index.

## Spin one up with Claude

This repo ships two skills (in `.claude/skills/`), so Claude Code picks them up
the moment you open the repo:

- **From scratch, no repo yet:** tell Claude "spin up a new docs site". The
  `new-docs-site` skill clones the template, walks the auth choice, the secrets,
  the KV and Turnstile wiring, the repo, and the deploy.
- **Already cloned and open in Claude:** the `docs-site` skill drives setup and
  every add-a-doc from inside this checkout.

Either way, the last step installs a third skill into your global Claude skills,
bound to the site you just made. From then on "share this with the team" or
"publish this to your domain" routes to that site and runs the whole add-a-doc
flow for you.

## Branding the index

Edit `scripts/site.json` for the stamp, heading, sub-line, and footer. Edit
`scripts/index_template.html` for the full look. Rebuild to apply.

## What the lock does not stop

- A shared password handed around outside the trusted group. Rotate it.
- Cloudflare reading content at the edge. That holds for any Cloudflare site.
- Turnstile is bot friction, a speed bump, not identity. For per-identity audit,
  put Cloudflare Access in front and run `none` mode.

## Files

```
src/auth-worker.ts        the gate (site / per-doc / none)
public/                   your docs + the generated index.html
scripts/build_index.py    index generator (git + _meta.json)
scripts/add_doc.sh        scaffold a doc from HTML / Markdown / PDF / a dist dir
scripts/md-viewer.html    client-side markdown viewer (used by add_doc.sh)
scripts/setup.sh          secrets / KV / per-doc password helper
scripts/make_site_skill.sh  writes the per-site "share-<slug>" Claude skill
scripts/site.json         index branding
scripts/tags.json         allowed tag vocabulary
.claude/skills/           new-docs-site (builder) + docs-site (in-repo) skills
.githooks/                index enforcement (install.sh once per clone)
examples/                 opt-in GitHub Actions workflow (default is CF native)
wrangler.toml             worker + assets + AUTH_MODE
```

MIT licensed. Built by Zain Merchant.
