const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
    const { tier, email } = req.body;

    if (!tier || !PRODUCTS[tier]) {
      return res.status(400).json({ error: 'Invalid tier.' });
    }

    const product = PRODUCTS[tier];
    const origin = req.headers.origin || 'https://inveritaslaw.com';

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
      metadata: { tier }
    };

    // Pre-fill email if provided (links payment to user account)
    if (email) {
      sessionConfig.customer_email = email;
    }

    if (product.mode === 'subscription') {
      sessionConfig.allow_promotion_codes = true;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);
    return res.status(200).json({ url: session.url, sessionId: session.id });

  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: 'Payment setup failed: ' + err.message });
  }
};
