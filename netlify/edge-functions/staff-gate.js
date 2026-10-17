// Password gate for /staff/*.
// Secrets come only from the Netlify environment variables STAFF_PASSWORD and STAFF_COOKIE_SECRET.
// Nothing here stores or logs either value. If either is missing the gate stays closed.
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
// Best-effort only: edge instances do not share memory, so this slows guessing but is not a hard global limit.
const attempts = new Map();

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

function safeEqual(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

// Compare passwords by comparing HMACs of both, so length and content do not leak through timing.
async function passwordOk(given, real, secret) {
  return safeEqual(await hmac(secret, 'pw:' + given), await hmac(secret, 'pw:' + real));
}

async function makeCookie(secret) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return exp + '.' + (await hmac(secret, 'session:' + exp));
}

async function cookieOk(header, secret) {
  const m = /(?:^|;\s*)staff_session=([0-9]+)\.([0-9a-f]{64})/.exec(header || '');
  if (!m) return false;
  if (Number(m[1]) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(m[2], await hmac(secret, 'session:' + m[1]));
}

const COOKIE_FLAGS = 'Path=/staff; HttpOnly; Secure; SameSite=Strict';
const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function loginPage(message, status) {
  const note = message ? '<p class="msg" role="alert">' + message + '</p>' : '';
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex, nofollow, noarchive"><title>Staff sign in | Wayne Conrad Advisory</title>' +
    '<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;font:18px/1.65 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;background:#000}' +
    '.card{width:100%;max-width:440px;background:#0b0f19;border:1px solid #64748b;border-radius:10px;padding:28px}.eyebrow{margin:0 0 8px;color:#93c5fd;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{margin:0 0 8px;font-size:32px;line-height:1.15;color:#fff}p{margin:0 0 18px}' +
    'label{display:block;font-weight:700;margin-bottom:6px}input{width:100%;min-height:48px;padding:10px 12px;font:inherit;color:#fff;background:#1e293b;border:1px solid #64748b;border-radius:6px}' +
    'button{margin-top:16px;width:100%;min-height:48px;font:inherit;font-weight:700;color:#fff;background:#1d4ed8;border:2px solid #1d4ed8;border-radius:6px;cursor:pointer}button:hover{background:#2563eb;border-color:#2563eb}' +
    'input:focus,button:focus{outline:3px solid #93c5fd;outline-offset:3px}.msg{color:#fca5a5;font-weight:700}</style></head><body><main class="card">' +
    '<p class="eyebrow">Staff area</p><h1>Sign in</h1><p>Wayne Conrad Advisory. Authorised people only.</p>' + note +
    '<form method="post" action="/staff/"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>' +
    '<button type="submit">Sign in</button></form></main></body></html>';
  return new Response(html, { status, headers: HEADERS });
}

export default async (request, context) => {
  const password = Netlify.env.get('STAFF_PASSWORD');
  const secret = Netlify.env.get('STAFF_COOKIE_SECRET');
  if (!password || !secret) {
    return new Response('Staff area is not configured.', { status: 503, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const url = new URL(request.url);

  if (url.pathname === '/staff/logout.html' || url.pathname === '/staff/logout') {
    return new Response(null, { status: 303, headers: { ...HEADERS, Location: '/', 'Set-Cookie': 'staff_session=; Max-Age=0; ' + COOKIE_FLAGS } });
  }

  if (await cookieOk(request.headers.get('cookie'), secret)) {
    const res = await context.next();
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'no-store');
    out.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    out.headers.set('Referrer-Policy', 'no-referrer');
    return out;
  }

  if (request.method === 'POST' && (url.pathname === '/staff/' || url.pathname === '/staff/index.html' || url.pathname === '/staff')) {
    const ip = (context && context.ip) || request.headers.get('x-nf-client-connection-ip') || 'unknown';
    const now = Date.now();
    const rec = attempts.get(ip) || { n: 0, until: 0 };
    if (rec.until > now) {
      return loginPage('Too many attempts. Try again in 15 minutes.', 429);
    }
    let given = '';
    try { given = String((await request.formData()).get('password') || ''); } catch (e) { given = ''; }
    if (await passwordOk(given, password, secret)) {
      attempts.delete(ip);
      return new Response(null, { status: 303, headers: { ...HEADERS, Location: '/staff/', 'Set-Cookie': 'staff_session=' + (await makeCookie(secret)) + '; Max-Age=' + SESSION_SECONDS + '; ' + COOKIE_FLAGS } });
    }
    rec.n += 1;
    if (rec.n >= MAX_ATTEMPTS) { rec.until = now + LOCK_MS; rec.n = 0; }
    attempts.set(ip, rec);
    return loginPage('That password is not correct.', 401);
  }

  return loginPage('', 401);
};

export const config = { path: '/staff/*' };
