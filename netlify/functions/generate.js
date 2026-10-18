const https = require('https');
const guard = require('../lib/guard');
const esc = guard.esc;
const { buildPrompt, validAnswers, TEAM_SIZES } = require('../lib/diagnostic-prompt');

const MAX_PROMPT_CHARS = 3500; // hard input cap: about 1,000 tokens

// Helper to make HTTPS requests
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

exports.handler = async (event) => {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const h = guard.corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: guard.originAllowed(event) ? 200 : 403, headers: h, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: h, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!guard.originAllowed(event)) {
    return { statusCode: 403, headers: h, body: JSON.stringify({ error: 'Origin not allowed' }) };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const resendKey = process.env.RESEND_API_KEY;

  if (!anthropicKey) {
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: 'Service not configured' }) };
  }
  if (event.body && event.body.length > 4000) {
    return { statusCode: 413, headers: h, body: JSON.stringify({ error: 'Request too large' }) };
  }

  try {
    const payload = JSON.parse(event.body || '{}');

    // ── Validate every field; the browser never supplies the prompt ──────────
    const firstName = guard.line(payload.firstName, 60);
    const lastName  = guard.line(payload.lastName, 60);
    const company   = guard.line(payload.company, 100);
    const email     = guard.line(payload.email, 254);
    const answers   = validAnswers(payload.answers);
    const teamKey   = Object.prototype.hasOwnProperty.call(TEAM_SIZES, payload.teamSize) ? payload.teamSize : '';
    if (!firstName || !company || !guard.validEmail(email) || !answers) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Invalid request' }) };
    }

    // ── Rate limits (per address and per email) ──────────────────────────────
    if (guard.limited('ip:' + guard.clientIp(event), 5, 3600000) || guard.limited('em:' + email.toLowerCase(), 3, 3600000)) {
      return { statusCode: 429, headers: { ...h, 'Retry-After': '3600' }, body: JSON.stringify({ error: 'Too many requests. Please try again later.' }) };
    }

    const prompt = buildPrompt(firstName, lastName, company, teamKey, answers);
    if (prompt.length > MAX_PROMPT_CHARS) {
      return { statusCode: 400, headers: h, body: JSON.stringify({ error: 'Invalid request' }) };
    }

    // ── Step 1: Generate report via Claude ──────────────────────────────────
    const claudeBody = JSON.stringify({
      model: 'claude-sonnet-5-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const claudeResult = await makeRequest({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(claudeBody)
      }
    }, claudeBody);
    console.log('Claude API status:', claudeResult.status);

    if (claudeResult.status !== 200) {
      return { statusCode: 502, headers: h, body: JSON.stringify({ error: 'Report service unavailable' }) };
    }

    const claudeData = JSON.parse(claudeResult.body);
    const reportText = claudeData.content?.[0]?.text || '';

    // ── Step 2: Send emails via Resend (if key is available) ────────────────
    if (resendKey) {
      const name       = (firstName + ' ' + lastName).trim();

      // Format report for email (convert newlines to <br> for HTML)
      const reportHtml = reportText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');

      // ── Email to founder ──────────────────────────────────────────────────
      const founderEmailBody = JSON.stringify({
        from: 'Wayne Conrad <wayne@wayneconrad.com>',
        to: [email],
        reply_to: 'wayne@wayneconrad.com',
        subject: 'Your AI Automation Readiness Report — Wayne Conrad Advisory',
        html: `
          <div style="font-family: Inter, -apple-system, sans-serif; max-width: 620px; margin: 0 auto; color: #0f172a; line-height: 1.7;">
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); padding: 32px 40px; border-bottom: 3px solid #2563eb;">
              <p style="color: #93c5fd; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 8px;">Wayne Conrad Advisory</p>
              <h1 style="color: #ffffff; font-size: 22px; font-weight: 400; margin: 0; font-family: Georgia, serif;">Your AI Automation Readiness Report</h1>
            </div>
            <div style="padding: 40px; background: #ffffff; border: 1px solid #e2e8f0;">
              <p style="font-size: 16px; margin: 0 0 24px;">Hi ${esc(firstName)},</p>
              <p style="font-size: 15px; color: #374151; margin: 0 0 32px;">Here is your personalised report based on your five answers. It covers how ready your busiest manual workflow is for AI automation, what to fix before building, and which sprint fits.</p>
              <div style="background: #f8fafc; border-left: 3px solid #2563eb; padding: 28px 32px; margin: 0 0 32px; font-size: 15px; color: #0f172a;">
                <p>${reportHtml}</p>
              </div>
              <div style="border-top: 1px solid #e2e8f0; padding-top: 28px; margin-top: 8px;">
                <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">If something in this report resonates or raises a question, reply directly to this email. I read every reply personally.</p>
                <p style="font-size: 15px; color: #374151; margin: 0 0 16px;">While you are thinking through what came up, the <a href="https://wayneconrad.com/ai-handoff-checklist.html" style="color: #2563eb; text-decoration: none; font-weight: 500;">AI hand-off checklist</a> on my site is a practical next step. It is five questions to answer for any process before AI takes it over, with a worksheet you can fill in for each one.</p>
                <p style="font-size: 15px; color: #374151; margin: 0 0 24px;">If you want to talk through what this means for ${esc(company)} specifically, reply with a time that works, or book the free 15-minute workflow call at https://meetings-na2.hubspot.com/wayne-conrad.</p>
                <p style="font-size: 15px; color: #374151; margin: 0;">Wayne Conrad<br><span style="color: #6b7280; font-size: 13px;">AI Automation Advisor for SME Owners<br>wayne@wayneconrad.com</span></p>
              </div>
            </div>
            <div style="padding: 20px 40px; background: #f8fafc; border-top: 1px solid #e2e8f0;">
              <p style="font-size: 12px; color: #9ca3af; margin: 0;">Wayne Conrad Advisory &nbsp;·&nbsp; <a href="https://wayneconrad.com" style="color: #2563eb; text-decoration: none;">wayneconrad.com</a></p>
            </div>
          </div>
        `
      });

      // ── Notification to Wayne ─────────────────────────────────────────────
      const wayneEmailBody = JSON.stringify({
        from: 'Diagnostic <wayne@wayneconrad.com>',
        to: ['wayne@wayneconrad.com'],
        subject: `New diagnostic: ${name} — ${company}`,
        html: `
          <div style="font-family: Inter, -apple-system, sans-serif; max-width: 660px; margin: 0 auto; color: #0f172a; line-height: 1.7;">

            <!-- HEADER -->
            <div style="background: #0f172a; padding: 24px 32px; border-radius: 8px 8px 0 0;">
              <p style="color: #93c5fd; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 4px;">Wayne Conrad Advisory</p>
              <p style="color: #ffffff; font-size: 18px; font-weight: 700; margin: 0;">New Diagnostic Completion</p>
            </div>

            <!-- LEAD DETAILS -->
            <div style="background: #ffffff; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none;">
              <p style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #6b7280; margin: 0 0 14px;">Lead Details</p>
              <table style="width: 100%; font-size: 14px; border-collapse: collapse; margin-bottom: 0;">
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="color: #6b7280; padding: 10px 0; width: 100px; vertical-align: top;">Name</td>
                  <td style="color: #0f172a; font-weight: 600; padding: 10px 0;">${esc(name)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="color: #6b7280; padding: 10px 0; vertical-align: top;">Company</td>
                  <td style="color: #0f172a; padding: 10px 0;">${esc(company)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #f1f5f9;">
                  <td style="color: #6b7280; padding: 10px 0; vertical-align: top;">Email</td>
                  <td style="padding: 10px 0;"><a href="mailto:${esc(email)}" style="color: #2563eb; font-weight: 500; text-decoration: none;">${esc(email)}</a></td>
                </tr>
              </table>
            </div>

            <!-- REPLY BUTTON -->
            <div style="background: #f8fafc; padding: 20px 32px; border: 1px solid #e2e8f0; border-top: none; text-align: left;">
              <a href="mailto:${esc(email)}?subject=Re: Your AI Automation Readiness Report" style="display: inline-block; background: #2563eb; color: #ffffff; font-size: 13px; font-weight: 600; padding: 10px 22px; border-radius: 6px; text-decoration: none;">Reply to ${esc(firstName)}</a>
            </div>

            <!-- REPORT -->
            <div style="background: #ffffff; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none;">
              <p style="font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #6b7280; margin: 0 0 20px;">Generated Report</p>
              ${reportHtml}
            </div>

            <!-- FOOTER -->
            <div style="background: #f8fafc; padding: 16px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="font-size: 12px; color: #9ca3af; margin: 0;">Wayne Conrad Advisory &nbsp;·&nbsp; wayneconrad.com</p>
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
          'Authorization': `Bearer ${resendKey}`
        }
      };

      // Send both emails (non-blocking — don't fail the response if email fails)
      try {
        resendOptions.headers['Content-Length'] = Buffer.byteLength(founderEmailBody);
        const founderResult = await makeRequest(resendOptions, founderEmailBody);
        console.log('Founder email status:', founderResult.status);

        resendOptions.headers['Content-Length'] = Buffer.byteLength(wayneEmailBody);
        const wayneResult = await makeRequest(resendOptions, wayneEmailBody);
        console.log('Notification email status:', wayneResult.status);
      } catch (emailErr) {
        console.error('Email sending failed:', emailErr.message);
        // Continue — report still returned to browser even if email fails
      }
    }

    // ── Step 3: Return Claude response to browser ────────────────────────────
    return {
      statusCode: 200,
      headers: h,
      body: claudeResult.body
    };

  } catch (err) {
    console.error('Function error:', err.message);
    return {
      statusCode: 500,
      headers: h,
      body: JSON.stringify({ error: 'Something went wrong' })
    };
  }
};
