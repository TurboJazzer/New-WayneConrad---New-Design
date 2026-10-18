'use strict';
// Shared request guards for the form functions: origin allow-list, best-effort rate limit, escaping, validation.
// The rate limiter keeps counts in memory, so it is per running function instance. It stops casual abuse.
// For a hard limit across all instances, add a Netlify rate-limiting rule for /.netlify/functions/* as well.

const ALLOWED = ['https://wayneconrad.com', 'https://www.wayneconrad.com']
  .concat((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    'Vary': 'Origin'
  };
  if (ALLOWED.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function getOrigin(event) {
  const h = event.headers || {};
  return h.origin || h.Origin || '';
}

function originAllowed(event) { return ALLOWED.includes(getOrigin(event)); }

function clientIp(event) {
  const h = event.headers || {};
  return h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

const buckets = new Map();
// Returns true if this key has used up its allowance in the window.
function limited(key, max, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return true; }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) { for (const [k, v] of buckets) { if (!v.some(t => now - t < windowMs)) buckets.delete(k); } }
  return false;
}

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Single-line plain text, capped. Removes control characters and line breaks.
function line(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validEmail(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]{2,}$/.test(e);
}

module.exports = { corsHeaders, originAllowed, clientIp, limited, esc, line, validEmail };
