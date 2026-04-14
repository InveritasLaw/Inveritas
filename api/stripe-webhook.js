const { createClient } = require('@supabase/supabase-js');

// Raw body is needed for Stripe webhook signature verification
// Vercel provides req.body as parsed JSON by default, but we can still verify

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!STRIPE_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  const stripe = require('stripe')(STRIPE_SECRET);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let event;

  // If webhook secret is set, verify signature
  if (STRIPE_WEBHOOK_SECRET) {
    const sig = req.headers['stripe-signature'];
    try {
      // Vercel raw body access
      const rawBody = JSON.stringify(req.body);
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } else {
    // No webhook secret — accept the event (dev/testing)
    event = { type: req.body.type, data: req.body.data };
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_details?.email || session.customer_email;
        const tier = session.metadata?.tier || 'single';
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (customerEmail) {
          // Find user by email
          const { data: users } = await supabase.auth.admin.listUsers();
          const user = users?.users?.find(u => u.email === customerEmail);

          if (user) {
            await supabase.from('user_profiles').upsert({
              user_id: user.id,
              email: customerEmail,
              subscription_tier: tier,
              stripe_customer_id: customerId || null,
              stripe_subscription_id: subscriptionId || null,
              updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

            // Log the payment event
            await supabase.from('event_logs').insert({
              event_type: 'payment_completed',
              user_id: user.id,
              metadata: JSON.stringify({ 
                tier, 
                amount: session.amount_total,
                session_id: session.id 
              }),
              created_at: new Date().toISOString()
            });
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const status = subscription.status;

        // Find profile by stripe customer ID
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (profile) {
          if (status === 'active') {
            // Subscription is active — keep current tier
          } else if (status === 'canceled' || status === 'unpaid' || status === 'past_due') {
            // Downgrade to none
            await supabase.from('user_profiles').update({
              subscription_tier: 'none',
              updated_at: new Date().toISOString()
            }).eq('stripe_customer_id', customerId);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        await supabase.from('user_profiles').update({
          subscription_tier: 'none',
          stripe_subscription_id: null,
          updated_at: new Date().toISOString()
        }).eq('stripe_customer_id', customerId);
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: err.message });
  }
};
