interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  AUTH_KV?: KVNamespace;
  AUTH_MODE?: string;
  SITE_USER?: string;
  SITE_PASS?: string;
  INDEX_PASSWORD?: string;
  SESSION_SECRET?: string;
  SITE_TITLE?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

const SESSION_TTL = 60 * 60 * 24 * 30;
const ATTEMPT_WINDOW = 60 * 15;
const ATTEMPT_BAN_THRESHOLD = 8;
const BAN_TTL = 60 * 60 * 24;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function securityHeaders(resp: Response): Response {
  const headers = new Headers(resp.headers);
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

function gatedResponse(resp: Response): Response {
  const out = securityHeaders(resp);
  out.headers.set("Cache-Control", "private, max-age=0, no-store");
  return out;
}

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function makeToken(scope: string, secret: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = `${scope}:${expires}`;
  const sig = await hmacHex(secret, payload);
  return `${btoa(payload)}.${sig}`;
}

async function verifyToken(token: string, scope: string, secret: string): Promise<boolean> {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const encPayload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload = "";
  try {
    payload = atob(encPayload);
  } catch {
    return false;
  }
  const expected = await hmacHex(secret, payload);
  if (!safeEqual(sig, expected)) return false;
  const colon = payload.lastIndexOf(":");
  if (colon === -1) return false;
  const tokenScope = payload.slice(0, colon);
  if (tokenScope !== scope) return false;
  const expires = parseInt(payload.slice(colon + 1), 10);
  if (!Number.isFinite(expires)) return false;
  return expires > Math.floor(Date.now() / 1000);
}

function cookieName(gate: string): string {
  return `g_${gate.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return null;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function gateForPath(pathname: string): string {
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return "_index";
  if (segs.length === 1 && segs[0].includes(".")) return "_index";
  const first = segs[0];
  return SLUG_RE.test(first) ? first : "_index";
}

async function passwordForGate(gate: string, env: Env, mode: string): Promise<string | null> {
  if (gate === "_index") return env.INDEX_PASSWORD ?? null;
  if (env.AUTH_KV) {
    const kv = await env.AUTH_KV.get(`pw:${gate}`);
    if (kv) return kv;
  }
  if (mode === "mixed") return null;
  return env.INDEX_PASSWORD ?? null;
}

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!res.ok) return false;
  const json = (await res.json()) as { success?: boolean };
  return !!json.success;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function safeRedirect(target: string): string {
  if (!target || target[0] !== "/") return "/";
  if (target[1] === "/" || target[1] === "\\") return "/";
  if (/[\x00-\x1f\\]/.test(target)) return "/";
  return target;
}

function rawRequestPath(requestUrl: string): string {
  const schemeEnd = requestUrl.indexOf("://");
  const afterScheme = schemeEnd === -1 ? requestUrl : requestUrl.slice(schemeEnd + 3);
  const slash = afterScheme.indexOf("/");
  if (slash === -1) return "/";
  let p = afterScheme.slice(slash);
  const cut = p.search(/[?#]/);
  if (cut !== -1) p = p.slice(0, cut);
  return p;
}

function isCanonicalPath(rawPath: string): boolean {
  if (/%2f|%5c/i.test(rawPath)) return false;
  if (rawPath.includes("\\")) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return false;
  }
  if (decoded.includes("\\")) return false;
  return !decoded.split("/").some((seg) => seg === "..");
}

function loginPage(opts: {
  mode: string;
  title: string;
  gate: string;
  redirect: string;
  turnstileSiteKey?: string;
  error?: string;
}): Response {
  const turnstileTag = opts.turnstileSiteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(opts.turnstileSiteKey)}" data-theme="dark"></div>
       <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : "";
  const err = opts.error ? `<p class="err">${escapeHtml(opts.error)}</p>` : "";
  const userField =
    opts.mode === "site"
      ? `<label for="u">Username</label>
         <input id="u" name="user" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>`
      : "";
  const scopeNote =
    opts.mode !== "site" && opts.gate !== "_index"
      ? `<p class="foot">Document: <b>${escapeHtml(opts.gate)}</b></p>`
      : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(opts.title)}</title>
<style>
  :root { --bg:#0a0a0c; --panel:#131318; --line:#2a2a33; --text:#e4e4ea; --muted:#8a8a96; --accent:#b8a4ff; --err:#ff7a7a; }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; min-height:100%; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif; }
  body { display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { width:100%; max-width:380px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:28px; }
  h1 { font-size:18px; margin:0 0 18px; }
  label { display:block; font-size:13px; color:var(--muted); margin:12px 0 4px; }
  input { width:100%; padding:10px 12px; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:14px; }
  input:focus { outline:none; border-color:var(--accent); }
  button { width:100%; margin-top:18px; padding:11px 12px; background:var(--accent); color:#0a0a0c; border:0; border-radius:8px; font-weight:600; cursor:pointer; }
  .err { color:var(--err); font-size:13px; margin:12px 0 0; }
  .foot { color:var(--muted); font-size:12px; margin-top:14px; text-align:center; }
  .cf-turnstile { margin-top:16px; min-height:65px; }
</style>
</head>
<body>
<form class="card" method="POST" action="/__auth/login">
  <h1>${escapeHtml(opts.title)}</h1>
  <input type="hidden" name="gate" value="${escapeHtml(opts.gate)}">
  <input type="hidden" name="redirect" value="${escapeHtml(opts.redirect)}">
  ${userField}
  <label for="p">Password</label>
  <input id="p" name="pass" type="password" autocomplete="current-password" required>
  ${turnstileTag}
  <button type="submit">Sign in</button>
  ${err}
  ${scopeNote}
</form>
</body>
</html>`;

  return new Response(html, {
    status: opts.error ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function bannedPage(remaining: number): Response {
  const mins = Math.max(1, Math.ceil(remaining / 60));
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Locked out</title>
<style>body{margin:0;background:#0a0a0c;color:#e4e4ea;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}div{max-width:380px;background:#131318;border:1px solid #2a2a33;border-radius:12px;padding:28px;text-align:center}h1{font-size:18px;margin:0 0 12px}p{color:#8a8a96;font-size:14px;line-height:1.5;margin:0}</style>
</head><body><div><h1>Too many attempts</h1><p>This IP is temporarily blocked. Try again in roughly ${mins} minutes.</p></div></body></html>`;
  return new Response(html, {
    status: 429,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function renderLogin(
  env: Env,
  opts: { mode: string; title: string; gate: string; redirect: string; turnstileSiteKey?: string; error?: string }
): Promise<Response> {
  if (env.AUTH_KV) {
    const custom = await env.AUTH_KV.get(`login:${opts.gate}`);
    if (custom) {
      const turnstile = opts.turnstileSiteKey
        ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(opts.turnstileSiteKey)}"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
        : "";
      const err = opts.error ? `<p class="err">${escapeHtml(opts.error)}</p>` : "";
      const html = custom
        .split("{{REDIRECT}}").join(escapeHtml(opts.redirect))
        .split("{{GATE}}").join(escapeHtml(opts.gate))
        .split("{{ERROR}}").join(err)
        .split("{{TURNSTILE}}").join(turnstile);
      return new Response(html, {
        status: opts.error ? 401 : 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
  }
  return loginPage(opts);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const mode = env.AUTH_MODE ?? "site";
    const title = env.SITE_TITLE ?? "Protected documents";

    if (mode !== "none" && mode !== "site" && mode !== "per-doc" && mode !== "mixed") {
      return new Response(`Auth not configured: unknown AUTH_MODE "${mode}".`, { status: 503 });
    }

    if (!isCanonicalPath(rawRequestPath(request.url))) {
      return new Response("Bad request", { status: 400, headers: { "cache-control": "no-store" } });
    }

    if (mode === "none") {
      return securityHeaders(await env.ASSETS.fetch(request));
    }

    const sessionSecret = env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      return new Response("Auth not configured: SESSION_SECRET is unset.", { status: 503 });
    }
    if (mode === "site" && (!env.SITE_USER || !env.SITE_PASS)) {
      return new Response("Auth not configured: set SITE_USER and SITE_PASS.", { status: 503 });
    }
    if ((mode === "per-doc" || mode === "mixed") && !env.INDEX_PASSWORD) {
      return new Response("Auth not configured: set INDEX_PASSWORD.", { status: 503 });
    }

    const ip = clientIp(request);
    const banKey = `ban:${ip}`;
    const attemptKey = `attempts:${ip}`;
    const kv = env.AUTH_KV;

    if (url.pathname === "/__auth/logout") {
      const gate = mode === "site" ? "site" : gateForPath(safeRedirect(url.searchParams.get("r") ?? "/"));
      const name = cookieName(gate);
      const clear = `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
      return new Response(null, { status: 303, headers: { location: "/", "set-cookie": clear } });
    }

    if (url.pathname === "/__auth/login" && request.method === "POST") {
      if (kv) {
        const ban = await kv.get(banKey);
        if (ban) {
          const remaining = parseInt(ban, 10) - Math.floor(Date.now() / 1000);
          return bannedPage(remaining > 0 ? remaining : BAN_TTL);
        }
      }

      const form = await request.formData();
      const submittedUser = String(form.get("user") ?? "");
      const submittedPass = String(form.get("pass") ?? "");
      const turnstileToken = String(form.get("cf-turnstile-response") ?? "");
      const redirect = safeRedirect(String(form.get("redirect") ?? "/"));
      const rawGate = String(form.get("gate") ?? "_index");
      const gate = mode === "site" ? "site" : (rawGate === "_index" || SLUG_RE.test(rawGate) ? rawGate : "_index");

      const turnstileOk = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY ?? "", ip);

      let credsOk = false;
      if (mode === "site") {
        credsOk =
          safeEqual(submittedUser, env.SITE_USER ?? "") && safeEqual(submittedPass, env.SITE_PASS ?? "");
      } else {
        const expected = await passwordForGate(gate, env, mode);
        credsOk = expected != null && safeEqual(submittedPass, expected);
      }

      if (turnstileOk && credsOk) {
        if (kv) await kv.delete(attemptKey);
        const token = await makeToken(gate, sessionSecret);
        const cookie = `${cookieName(gate)}=${token}; Path=/; Max-Age=${SESSION_TTL}; HttpOnly; Secure; SameSite=Lax`;
        return new Response(null, { status: 303, headers: { location: redirect, "set-cookie": cookie } });
      }

      let attemptsLeft = ATTEMPT_BAN_THRESHOLD;
      if (kv) {
        const currentRaw = await kv.get(attemptKey);
        const next = (currentRaw ? parseInt(currentRaw, 10) : 0) + 1;
        await kv.put(attemptKey, String(next), { expirationTtl: ATTEMPT_WINDOW });
        if (next >= ATTEMPT_BAN_THRESHOLD) {
          const banUntil = Math.floor(Date.now() / 1000) + BAN_TTL;
          await kv.put(banKey, String(banUntil), { expirationTtl: BAN_TTL });
          await kv.delete(attemptKey);
          return bannedPage(BAN_TTL);
        }
        attemptsLeft = ATTEMPT_BAN_THRESHOLD - next;
      }

      const errMsg = !turnstileOk
        ? "Captcha failed. Try again."
        : kv
          ? `Wrong credentials. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left before this IP is blocked.`
          : "Wrong credentials.";
      return renderLogin(env, {
        mode,
        title,
        gate,
        redirect,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY,
        error: errMsg,
      });
    }

    if (kv) {
      const ban = await kv.get(banKey);
      if (ban) {
        const remaining = parseInt(ban, 10) - Math.floor(Date.now() / 1000);
        return bannedPage(remaining > 0 ? remaining : BAN_TTL);
      }
    }

    const gate = mode === "site" ? "site" : gateForPath(url.pathname);
    if (mode === "mixed" && gate !== "_index" && (await passwordForGate(gate, env, mode)) === null) {
      return securityHeaders(await env.ASSETS.fetch(request));
    }
    const token = getCookie(request, cookieName(gate));
    if (token && (await verifyToken(token, gate, sessionSecret))) {
      return gatedResponse(await env.ASSETS.fetch(request));
    }

    return renderLogin(env, {
      mode,
      title,
      gate,
      redirect: safeRedirect(url.pathname + url.search),
      turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    });
  },
};
