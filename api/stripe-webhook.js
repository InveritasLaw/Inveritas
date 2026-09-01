const { fulfillEvent } = require('./_utils/fulfillment');
const { createClient } = require('@supabase/supabase-js');

// ----------------------------------------------------------------------------
// Stripe webhook handler — Inveritas
//
// Signature verification requires the EXACT raw request bytes. The previous
// handler passed JSON.stringify(req.body) — that re-serializes Vercel's parsed
// object and does NOT byte-match what Stripe signed, so constructEvent threw
// "No signatures found matching the expected signature for payload" on every
// delivery (HTTP 400).
//
// Confirmed against a real Stripe-signed delivery on 2026-05-14
// (event evt_1TWLgfBILqHx17SrPnrSlcwh): on this Vercel runtime the req stream
// is still fully readable inside the handler even though req.body is also
// populated. Reading the stream yields the byte-exact raw body, and
// stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET) with the
// existing signing secret verifies successfully. That is the proven call
// structure used below — unchanged.
// ----------------------------------------------------------------------------

// Declares intent to skip Vercel's body parsing. On the current runtime this
// did not take effect (req.body stays populated) — the handler does not depend
// on it either way, since it reads the raw stream directly. Left in place so
// the handler stays correct if Vercel's body-parsing behavior changes.
function readRawBody(req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const done = (err, buf) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(buf);
    };
    const timer = setTimeout(() => done(new Error('raw body read timed out')), timeoutMs);
    req.on('data', (c) => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end', () => { clearTimeout(timer); done(null, Buffer.concat(chunks)); });
    req.on('error', (e) => { clearTimeout(timer); done(e); });
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Signature verification is mandatory. The previous handler had a fallback
  // branch that accepted unverified events when no secret was set — that let
  // anyone POST a fake checkout.session.completed and upgrade their own tier.
  // Removed: if the secret is not configured, refuse the request.
  if (!STRIPE_SECRET || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('stripe-webhook: missing required env var(s)');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const stripe = require('stripe')(STRIPE_SECRET);

  // 1. Capture the byte-exact raw body from the request stream.
  let rawBody;
  try {
    rawBody = await readRawBody(req, 8000);
  } catch (err) {
    console.error('stripe-webhook: failed to read raw body:', err.message);
    return res.status(400).json({ error: 'Could not read request body' });
  }

  // 2. Verify the Stripe signature against the raw bytes (proven call structure).
  let event;
  const sig = req.headers['stripe-signature'];
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(
      'stripe-webhook: signature verification failed:', err.message,
      '| raw body bytes:', rawBody ? rawBody.length : 0,
      '| signature header present:', !!sig
    );
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // 3. Process the verified event.
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    await fulfillEvent(supabase, event);

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Fulfillment failed; retry required' });
  }
}

module.exports = handler;
module.exports.config = {
  api: { bodyParser: false },
};
