# docs-site-template

A gated docs site on Cloudflare. Static assets in `public/`, served by a Worker
(`src/auth-worker.ts`) that gates access. Default deploy is Cloudflare native Git
(Workers Builds, connected in the dashboard); a GitHub Actions workflow ships
inert under `examples/` as an opt-in. The repo ships no active workflow, so a
fresh clone has nothing to fail.

## Access models (`AUTH_MODE` in wrangler.toml)

- `site`, one shared login (`SITE_USER`/`SITE_PASS`) gates every URL.
- `per-doc`, gated index (`INDEX_PASSWORD`) plus a per-document password in KV
  (`pw:<slug>`); each client unlocks only their own path. A folder with no
  `pw:<slug>` falls back to `INDEX_PASSWORD`, so nothing is public. Fails closed
  if `INDEX_PASSWORD` is unset.
- `mixed`, same as `per-doc` but a folder with no `pw:<slug>` is served public.
  A hub of open docs plus a few gated client folders, with a locked index. Also
  requires `INDEX_PASSWORD`.
- `none`, Worker passthrough; gate upstream with Cloudflare Access, or leave
  public.

All modes share an HMAC session cookie, optional Turnstile, and KV rate limiting.
Secrets live in Wrangler or KV, never in the repo. See `README.md` for setup.

Custom login per gate: put HTML in KV `login:<gate>` (or `login:_index`) and the worker
serves it instead of the default login for that gate. Use placeholders `{{REDIRECT}}`,
`{{GATE}}`, `{{ERROR}}`, `{{TURNSTILE}}`; the form must POST `pass`/`redirect`/`gate` to
`/__auth/login`. Falls back to the default login when no record exists.

## Fresh clone, or after an update

```
sh .githooks/install.sh
```

Activates the git hooks. Requires `python3`. Without it your pushes are not gated
and you can ship a stale index.

## The index page is generated, never hand-edit it

`public/index.html` is built by `scripts/build_index.py` from git history
(date-added, author) and a `_meta.json` in each doc folder (`title`, `desc`,
`confidential`, `tags`). Branding is in `scripts/site.json`; the allowed tag
vocabulary is in `scripts/tags.json`. `pre-commit` regenerates and stages the
index; `pre-push` and the CI `--check` step block a stale or off-vocab index.

## Add a doc

1. `public/<slug>/index.html`
2. `public/<slug>/_meta.json` with a tag from `scripts/tags.json`
3. `python3 scripts/build_index.py`, then commit and push.
