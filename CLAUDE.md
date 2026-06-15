# docs-site-template

A gated docs site on Cloudflare. Static assets in `public/`, served by a Worker
(`src/auth-worker.ts`) that gates access. Push to `main` → GitHub Actions runs
`build_index.py --check` then `wrangler deploy`.

## Access models (`AUTH_MODE` in wrangler.toml)

- `site`, one shared login (`SITE_USER`/`SITE_PASS`) gates every URL.
- `per-doc`, gated index (`INDEX_PASSWORD`) plus a per-document password in KV
  (`pw:<slug>`); each client unlocks only their own path. Fails closed if
  `INDEX_PASSWORD` is unset.
- `none`, Worker passthrough; gate upstream with Cloudflare Access, or leave
  public.

All modes share an HMAC session cookie, optional Turnstile, and KV rate limiting.
Secrets live in Wrangler or KV, never in the repo. See `README.md` for setup.

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
