const { createClient } = require('@supabase/supabase-js');

const PRODUCTS = {
  single: {
    name: 'Inveritas — Single Analysis',
    description: 'One full three-tier statutory inversion analysis.',
    price: 2900,
    mode: 'payment'
  },
  practitioner: {
    name: 'Inveritas — Practitioner',
    description: '50 analyses per month. Priority processing, saved case history.',
    price: 29700,
    mode: 'subscription'
  },
  firm: {
    name: 'Inveritas — Firm (Per Seat)',
    description: 'Unlimited analyses. Team dashboard, integrations, custom branding.',
    price: 49700,
    mode: 'subscription'
  }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe not configured.' });
  }

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(503).json({ error: 'Authentication service not configured.' });
    }
    const token = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ error: 'Sign in before purchasing.' });
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const auth = await sb.auth.getUser(token);
    if (auth.error || !auth.data?.user) return res.status(401).json({ error: 'Sign in again before purchasing.' });
    const user = auth.data.user;
    if (!user.email) return res.status(400).json({ error: 'An account email is required.' });
    const { tier } = req.body || {};

    if (!Object.prototype.hasOwnProperty.call(PRODUCTS, tier)) {
      return res.status(400).json({ error: 'Invalid tier.' });
    }

    const product = PRODUCTS[tier];
    const origin = process.env.APP_ORIGIN || 'https://inveritaslaw.com';
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== 'https:' && parsedOrigin.hostname !== 'localhost')) {
      throw new Error('Invalid APP_ORIGIN');
    }
    const profileResult = await sb.from('user_profiles').select('stripe_customer_id, stripe_subscription_id').eq('user_id', user.id).maybeSingle();
    if (profileResult.error) throw profileResult.error;
    const profile = profileResult.data;
    // Do not create another subscription and pretend it is a prorated upgrade.
    if (profile?.stripe_subscription_id) {
      return res.status(409).json({ error: 'You already have a subscription. Contact support to change your plan.' });
    }

    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: product.name, description: product.description },
          unit_amount: product.price,
          ...(product.mode === 'subscription' ? { recurring: { interval: 'month' } } : {})
        },
        quantity: 1,
      }],
      mode: product.mode,
      success_url: `${origin}/analyze.html?payment=success&tier=${tier}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#pricing`,
      client_reference_id: user.id,
      metadata: { tier, user_id: user.id }
    };

    if (profile?.stripe_customer_id) sessionConfig.customer = profile.stripe_customer_id;
    else sessionConfig.customer_email = user.email;

    if (product.mode === 'subscription') {
      sessionConfig.allow_promotion_codes = true;
      sessionConfig.subscription_data = { metadata: { tier, user_id: user.id } };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);
    return res.status(200).json({ url: session.url, sessionId: session.id });

  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: 'Payment setup failed. Please try again.' });
  }
};
