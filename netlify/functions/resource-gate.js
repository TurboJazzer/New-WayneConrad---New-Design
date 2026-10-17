const https = require('https');
const crypto = require('crypto');

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Token generation ──────────────────────────────────────────────────────
// Token format: base64url(email|resource|expiryTimestamp).signature
// Signature is HMAC-SHA256 over the payload, using a server-only secret.
// The secret never reaches the browser, so a token cannot be forged by
// reading the front-end JS — it can only be produced by this function.
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateToken(email, resource, secret) {
  const expiry = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${email}|${resource}|${expiry}`;
  const payloadEncoded = base64url(payload);
  const signature = crypto.createHmac('sha256', secret).update(payloadEncoded).digest('hex');
  return `${payloadEncoded}.${signature}`;
}

// Per-resource email copy, keyed by the slug resources.html sends.
// Unknown resources fall back to the generic wording, so a new gated
// resource never gets another resource's instructions.
const COPY = {
  'ai-workflow-candidate-map': {
    intro: 'Fill it in on screen, then use your browser\'s Print to PDF function to save a copy.',
    button: 'Open the Map',
    how: 'Work through the five common workflows. Use real hours, not hopeful ones. Set the sign-off limits where a person should approve the work, then check the summary for the workflow to automate first. Print to PDF and bring it to your free workflow call.',
    close: 'which workflow comes out on top'
  },
  'manual-work-cost-calculator': {
    intro: 'Enter your own numbers on screen, then use your browser\'s Print to PDF function to save a copy.',
    button: 'Open the Calculator',
    how: 'Use your real figures for hours, people and pay, not estimates you would like to be true. Run it once for the whole team, then once for the work that goes through you. Print to PDF and keep the result to compare against in three months.',
    close: 'what the numbers show for your business'
  },
  'decision-rights-mapping-template': {
    intro: 'Fill it in on screen, then use your browser\'s Print to PDF function to save a copy for your team.',
    button: 'Open the Template',
    how: 'Fill in each of the five decision categories. Be specific about boundaries and escalation triggers. Complete the summary section at the bottom. Print to PDF and share with your leadership team before your next all-hands.',
    close: 'what comes up when you map this for your business'
  },
  'what-manual-coordination-is-costing-you': {
    intro: 'Enter your own numbers on screen, then use your browser\'s Print to PDF function to save a copy.',
    button: 'Open the Calculator',
    how: 'Use your real figures for hours, people and pay, not estimates you would like to be true. Run it once for the whole team, then once for the work that goes through you. Print to PDF and keep the result to compare against in three months.',
    close: 'what the numbers show for your business'
  },
  'client-health-scorecard': {
    intro: 'Score your clients on screen, then use your browser\'s Print to PDF function to save a copy.',
    button: 'Open the Scorecard',
    how: 'Score each client from what you can point to, such as payment history and recent contact, not from how the relationship feels. Start with your five largest clients. Print to PDF and review it with whoever manages those accounts.',
    close: 'what comes up when you score your clients'
  }
};
const DEFAULT_COPY = {
  intro: 'Use it on screen, then use your browser\'s Print to PDF function to save a copy.',
  button: 'Open the Resource',
  how: 'Work through it using your real numbers and examples, then print to PDF and share it with your team.',
  close: 'what comes up when you use this in your business'
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const resendKey = process.env.RESEND_API_KEY;
  const tokenSecret = process.env.RESOURCE_TOKEN_SECRET;

  if (!resendKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Email not configured' }) };
  }
  if (!tokenSecret) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Token secret not configured' }) };
  }

  try {
    const payload = JSON.parse(event.body);
    const { firstName, lastName, email, resource, resourceName, resourceUrl } = payload;

    if (!firstName || !email || !resource || !resourceUrl) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // ── Build the token-protected link ─────────────────────────────────────
    const token = generateToken(email, resource, tokenSecret);
    const separator = resourceUrl.includes('?') ? '&' : '?';
    const protectedUrl = `${resourceUrl}${separator}token=${token}`;

    const copy = COPY[resource] || DEFAULT_COPY;

    // Email to founder with template link
    const founderEmail = JSON.stringify({
      from: 'Wayne Conrad <wayne@wayneconrad.com>',
      to: [email],
      reply_to: 'wayne@wayneconrad.com',
      subject: resourceName + ' — Wayne Conrad Advisory',
      html: `
        <div style="font-family: Inter, -apple-system, sans-serif; max-width: 620px; margin: 0 auto; color: #0f172a; line-height: 1.7;">
          <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); padding: 32px 40px; border-bottom: 3px solid #2563eb;">
            <p style="color: #93c5fd; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 8px;">Wayne Conrad Advisory</p>
            <h1 style="color: #ffffff; font-size: 22px; font-weight: 400; margin: 0; font-family: Georgia, serif;">${resourceName}</h1>
          </div>
          <div style="padding: 40px; background: #ffffff; border: 1px solid #e2e8f0;">
            <p style="font-size: 16px; margin: 0 0 20px;">Hi ${firstName},</p>
            <p style="font-size: 15px; color: #374151; margin: 0 0 28px; line-height: 1.7;">Here is your link to the ${resourceName}. ${copy.intro}</p>
            <div style="text-align: center; margin: 0 0 32px;">
              <a href="${protectedUrl}" style="display: inline-block; background: #1d4ed8; color: #ffffff; font-size: 15px; font-weight: 600; padding: 14px 32px; border-radius: 4px; text-decoration: none;">${copy.button}</a>
            </div>
            <p style="font-size: 12px; color: #9ca3af; text-align: center; margin: 0 0 28px;">This link is personal to you and expires in 7 days.</p>
            <div style="background: #f8fafc; border-left: 3px solid #2563eb; padding: 20px 24px; font-size: 14px; color: #374151; margin: 0 0 28px; line-height: 1.7;">
              <p style="font-weight: 600; color: #0f172a; margin: 0 0 8px;">How to use it:</p>
              <p style="margin: 0;">${copy.how}</p>
            </div>
            <div style="border-top: 1px solid #e2e8f0; padding-top: 24px;">
              <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">If you want to talk through ${copy.close}, reply to this email. I read every reply personally.</p>
              <p style="font-size: 15px; color: #374151; margin: 0;">Wayne Conrad<br><span style="color: #6b7280; font-size: 13px;">AI Automation Advisor for SME Owners<br>wayne@wayneconrad.com</span></p>
            </div>
          </div>
          <div style="padding: 18px 40px; background: #f8fafc; border-top: 1px solid #e2e8f0;">
            <p style="font-size: 12px; color: #9ca3af; margin: 0;">Wayne Conrad Advisory &nbsp;·&nbsp; <a href="https://wayneconrad.com" style="color: #2563eb; text-decoration: none;">wayneconrad.com</a></p>
          </div>
        </div>
      `
    });

    // Notification to Wayne (unchanged, plain resourceUrl is fine here — internal use only)
    const wayneEmail = JSON.stringify({
      from: 'Resources <wayne@wayneconrad.com>',
      to: ['wayne@wayneconrad.com'],
      subject: 'Resource download: ' + firstName + ' ' + lastName + ' — ' + resourceName,
      html: `
        <div style="font-family: Inter, -apple-system, sans-serif; max-width: 620px; margin: 0 auto; color: #0f172a;">
          <div style="background: #0f172a; padding: 20px 28px; border-radius: 6px 6px 0 0;">
            <p style="color: #93c5fd; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 4px;">Resource Download</p>
            <p style="color: #ffffff; font-size: 16px; font-weight: 600; margin: 0;">${resourceName}</p>
          </div>
          <div style="background: #ffffff; padding: 24px 28px; border: 1px solid #e2e8f0;">
            <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="color: #6b7280; padding: 8px 0; width: 100px;">Name</td><td style="color: #0f172a; font-weight: 600; padding: 8px 0;">${firstName} ${lastName}</td></tr>
              <tr style="border-bottom: 1px solid #f1f5f9;"><td style="color: #6b7280; padding: 8px 0;">Email</td><td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #2563eb;">${email}</a></td></tr>
              <tr><td style="color: #6b7280; padding: 8px 0;">Resource</td><td style="color: #0f172a; padding: 8px 0;">${resourceName}</td></tr>
            </table>
            <div style="margin-top: 20px;">
              <a href="mailto:${email}?subject=Re: ${resourceName}" style="display: inline-block; background: #2563eb; color: #ffffff; font-size: 13px; font-weight: 600; padding: 10px 20px; border-radius: 4px; text-decoration: none;">Reply to ${firstName}</a>
            </div>
          </div>
        </div>
      `
    });

    const resendOptions = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + resendKey
      }
    };

    resendOptions.headers['Content-Length'] = Buffer.byteLength(founderEmail);
    await makeRequest(resendOptions, founderEmail);

    resendOptions.headers['Content-Length'] = Buffer.byteLength(wayneEmail);
    await makeRequest(resendOptions, wayneEmail);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('Resource gate error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
