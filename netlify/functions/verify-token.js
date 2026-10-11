const crypto = require('crypto');

// ── Token verification ──────────────────────────────────────────────────
// Recomputes the HMAC signature server-side using the secret (never sent
// to the browser) and checks the embedded expiry timestamp. This is the
// only place a token can actually be validated — the tool pages themselves
// hold no secret and cannot verify anything on their own.

function base64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString('utf8');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const tokenSecret = process.env.RESOURCE_TOKEN_SECRET;
  if (!tokenSecret) {
    return { statusCode: 500, headers, body: JSON.stringify({ valid: false, error: 'Token secret not configured' }) };
  }

  try {
    const token = event.httpMethod === 'GET'
      ? (event.queryStringParameters || {}).token
      : JSON.parse(event.body || '{}').token;

    if (!token || !token.includes('.')) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'missing_token' }) };
    }

    const [payloadEncoded, signature] = token.split('.');

    const expectedSignature = crypto.createHmac('sha256', tokenSecret)
      .update(payloadEncoded)
      .digest('hex');

    // Constant-time comparison to avoid timing attacks
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'bad_signature' }) };
    }

    const payload = base64urlDecode(payloadEncoded);
    const [email, resource, expiryStr] = payload.split('|');
    const expiry = parseInt(expiryStr, 10);

    if (!expiry || Math.floor(Date.now() / 1000) > expiry) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'expired' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ valid: true, resource, email }) };

  } catch (err) {
    console.error('Token verification error:', err.message);
    return { statusCode: 200, headers, body: JSON.stringify({ valid: false, reason: 'error' }) };
  }
};
