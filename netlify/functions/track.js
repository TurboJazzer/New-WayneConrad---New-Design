// netlify/functions/track.js
//
// Receives one lightweight GET per funnel event from diagnostic.html
// (page_view, quiz_started, question_answered, quiz_completed,
// teaser_cta_clicked, email_gate_viewed, form_validation_error,
// form_submitted, report_success, report_error, abandon).
//
// Two things happen with each event:
//  1. It shows up in the normal Netlify request log as
//     GET /.netlify/functions/track?e=quiz_started&sid=...&step=...
//     which is the same log view already in use, so no new dashboard
//     is required to see individual events.
//  2. It's also written as a single structured JSON line via console.log,
//     which lands in the Netlify Functions log and is easy to grep or
//     pipe into a proper log-aggregation tool later if this grows.
//
// No PII is collected. sid is a random per-browser-session token
// generated client-side (sessionStorage), not tied to an email address
// or IP. Returns a 1x1 transparent GIF so it behaves as a normal tracking
// pixel with correct content-type either way.

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64'
);

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const logLine = {
      ts: new Date().toISOString(),
      event: q.e || 'unknown',
      sid: q.sid || null,
      step: q.step || null,
      // spread any additional params (qid, val, level, pct, missing, reason, ref)
      // without hardcoding every possible key, so new client-side events
      // don't need a matching server-side change
      ...Object.keys(q).reduce((acc, k) => {
        if (!['e', 'sid', 'step'].includes(k)) acc[k] = q[k];
        return acc;
      }, {})
    };
    console.log('DIAGNOSTIC_FUNNEL ' + JSON.stringify(logLine));
  } catch (err) {
    // Never let a tracking failure surface to the visitor.
    console.log('DIAGNOSTIC_FUNNEL_ERROR ' + (err && err.message));
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private'
    },
    isBase64Encoded: true,
    body: PIXEL.toString('base64')
  };
};
