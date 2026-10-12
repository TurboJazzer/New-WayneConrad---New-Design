// netlify/edge-functions/staff-gate.js
// Password gate for /staff/*. Registered FIRST in netlify.toml so no staff
// content (including Accept: text/markdown requests) is reachable without a
// valid session cookie.
//
// Env vars (Netlify: Site configuration > Environment variables):
//   STAFF_PASSWORD       the shared staff password
//   STAFF_COOKIE_SECRET  a long random string used to sign the session cookie
// Neither value is written to any file or page.

const COOKIE = "wca_staff";
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_FAILS = 5;
const LOCK_SECONDS = 15 * 60;
const enc = new TextEncoder();

const baseHeaders = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const env = (k) => {
  try { return Netlify.env.get(k); } catch (_) { return Deno.env.get(k); }
};

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function sign(secret, data) {
  return b64url(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data)));
}
// Constant-time equality for two strings of any length (both are hashed first).
async function safeEqual(secret, a, b) {
  const [x, y] = await Promise.all([sign(secret, "cmp:" + a), sign(secret, "cmp:" + b)]);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}

async function validSession(request, secret) {
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(secret, sig, await sign(secret, "session:" + exp));
}

// ---- rate limiting: Netlify Blobs when available, else per-instance memory ----
const mem = new Map();
let store = null;
async function getStore() {
  if (store !== null) return store || null;
  try {
    const { getStore } = await import("https://esm.sh/@netlify/blobs@8.1.0");
    store = getStore("staff-gate");
  } catch (_) { store = false; }
  return store || null;
}
async function readRec(key) {
  const s = await getStore();
  if (s) { try { return (await s.get(key, { type: "json" })) || null; } catch (_) {} }
  return mem.get(key) || null;
}
async function writeRec(key, rec) {
  mem.set(key, rec);
  const s = await getStore();
  if (s) { try { await s.setJSON(key, rec); } catch (_) {} }
}
async function ipKey(ip, secret) { return "ip-" + (await sign(secret, "ip:" + ip)).slice(0, 32); }

const css = `
:root{--navy:#0f172a;--btn:#1d4ed8}
*{box-sizing:border-box}
body{margin:0;background:#f1f5f9;color:#374151;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:17px;line-height:1.6}
.wrap{max-width:440px;margin:0 auto;padding:40px 16px 64px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:28px 24px}
h1{margin:0 0 8px;color:#0f172a;font-size:26px;line-height:1.2}
p{margin:0 0 16px}
label{display:block;font-weight:700;color:#0f172a;margin-bottom:6px}
input{width:100%;min-height:48px;padding:0 14px;font:inherit;border:2px solid #64748b;border-radius:6px;background:#fff;color:#0f172a}
button{width:100%;min-height:48px;margin-top:16px;border:0;border-radius:6px;background:#1d4ed8;color:#fff;font:inherit;font-weight:700;cursor:pointer}
button:hover{background:#2563eb}
:focus-visible{outline:3px solid #1d4ed8;outline-offset:3px}
.err{background:#fef2f2;border:1px solid #b91c1c;color:#7f1d1d;border-radius:6px;padding:10px 14px;margin-bottom:16px}
.logo{background:#0f172a;padding:14px 16px}
.logo a{display:inline-flex;min-height:44px;align-items:center}
.logo img{width:88px;height:32px;display:block}
`;

function loginPage(message, status = 401, extra = {}) {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Staff sign in | Wayne Conrad Advisory</title>
<meta name="robots" content="noindex,nofollow">
<link rel="icon" type="image/png" href="/favicon.png">
<style>${css}</style></head><body>
<div class="logo"><a href="/staff/index.html" aria-label="Wayne Conrad Advisory staff area"><img src="/assets/wayne_logo_full.png" alt="Wayne Conrad Advisory" width="88" height="32"></a></div>
<main class="wrap" id="main"><div class="card">
<h1>Staff area</h1>
<p>Enter the staff password to continue.</p>
${message ? `<div class="err" role="alert">${message}</div>` : ""}
<form method="post" action="/staff/index.html" autocomplete="off">
<label for="pw">Password</label>
<input id="pw" name="password" type="password" required autocomplete="current-password" autofocus>
<button type="submit">Sign in</button>
</form></div></main></body></html>`;
  return new Response(html, {
    status,
    headers: { ...baseHeaders, "Content-Type": "text/html; charset=utf-8", ...extra },
  });
}

const cookieAttrs = "; Path=/staff; HttpOnly; Secure; SameSite=Strict";

export default async (request, context) => {
  const url = new URL(request.url);
  const password = env("STAFF_PASSWORD");
  const secret = env("STAFF_COOKIE_SECRET");

  if (!password || !secret) {
    return new Response("Staff area is not configured.", { status: 503, headers: baseHeaders });
  }

  if (url.pathname === "/staff" || url.pathname === "/staff/") {
    return new Response(null, { status: 301, headers: { ...baseHeaders, Location: "/staff/index.html" } });
  }

  // Logout: clear cookie, return to the password screen.
  if (url.pathname === "/staff/logout.html") {
    return new Response(null, {
      status: 303,
      headers: { ...baseHeaders, Location: "/staff/index.html", "Set-Cookie": `${COOKIE}=; Max-Age=0${cookieAttrs}` },
    });
  }

  // Login attempt.
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return new Response("Forbidden", { status: 403, headers: baseHeaders });

    const ip = context.ip || request.headers.get("x-nf-client-connection-ip") || "unknown";
    const key = await ipKey(ip, secret);
    const now = Math.floor(Date.now() / 1000);
    let rec = (await readRec(key)) || { fails: 0, first: now, lockUntil: 0 };

    if (rec.lockUntil > now) {
      const mins = Math.ceil((rec.lockUntil - now) / 60);
      return loginPage(`Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, 429,
        { "Retry-After": String(rec.lockUntil - now) });
    }
    if (rec.lockUntil && rec.lockUntil <= now) rec = { fails: 0, first: now, lockUntil: 0 };

    let supplied = "";
    try { supplied = String((await request.formData()).get("password") || ""); } catch (_) {}

    if (supplied && (await safeEqual(secret, supplied, password))) {
      await writeRec(key, { fails: 0, first: now, lockUntil: 0 });
      const exp = now + SESSION_SECONDS;
      const sig = await sign(secret, "session:" + exp);
      return new Response(null, {
        status: 303,
        headers: { ...baseHeaders, Location: "/staff/index.html", "Set-Cookie": `${COOKIE}=${exp}.${sig}; Max-Age=${SESSION_SECONDS}${cookieAttrs}` },
      });
    }

    rec.fails += 1;
    if (rec.fails >= MAX_FAILS) rec.lockUntil = now + LOCK_SECONDS;
    await writeRec(key, rec);
    if (rec.lockUntil) return loginPage("Too many wrong attempts. Try again in 15 minutes.", 429, { "Retry-After": String(LOCK_SECONDS) });
    return loginPage("That password is not correct.");
  }

  // Everything else needs a valid session.
  if (!(await validSession(request, secret))) return loginPage("");

  const res = await context.next();
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(baseHeaders)) out.headers.set(k, v);
  return out;
};
