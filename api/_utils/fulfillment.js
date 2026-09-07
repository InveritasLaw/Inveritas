'use strict';

const TIERS = new Set(['single', 'practitioner', 'firm']);
function required(result, label) {
  if (result?.error) throw new Error(label + ': ' + result.error.message);
  return result?.data;
}

async function checkoutUser(sb, session) {
  const id = session.metadata?.user_id || session.client_reference_id;
  if (id) {
    const data = required(await sb.auth.admin.getUserById(id), 'Account lookup failed');
    if (!data?.user) throw new Error('Checkout account not found');
    return data.user;
  }
  // Legacy sessions created before user-bound checkout. Bounded pagination
  // fails with a retryable error instead of acknowledging an unfulfilled sale.
  const email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
  if (!email) throw new Error('Checkout has no account or email');
  for (let page = 1; page <= 20; page++) {
    const data = required(await sb.auth.admin.listUsers({ page, perPage: 100 }), 'Legacy account lookup failed');
    const users = data?.users || [];
    const user = users.find(u => u.email?.toLowerCase() === email);
    if (user) return user;
    if (users.length < 100) break;
  }
  throw new Error('Legacy purchase requires account reconciliation');
}

async function fulfillEvent(sb, event) {
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    if (!['paid', 'no_payment_required'].includes(session.payment_status)) return;
    const tier = session.metadata?.tier;
    if (!TIERS.has(tier)) throw new Error('Checkout tier is invalid');
    const user = await checkoutUser(sb, session);
    required(await sb.rpc('fulfill_checkout_payment', {
      p_stripe_event_id: event.id,
      p_event_type: event.type,
      p_stripe_session_id: session.id,
      p_user_id: user.id,
      p_tier: tier,
      p_stripe_customer_id: session.customer || null,
      p_stripe_subscription_id: session.subscription || null,
      p_amount_total: session.amount_total ?? null,
      p_currency: session.currency || null
    }), 'Transactional fulfillment failed');
    // This remains a diagnostic event stream; billing_events is authoritative.
    required(await sb.from('event_logs').insert({
      event_type: 'payment_completed', user_id: user.id,
      metadata: JSON.stringify({ tier, amount: session.amount_total, session_id: session.id, stripe_event_id: event.id }),
      created_at: new Date().toISOString()
    }), 'Payment log failed');
    return;
  }
  if (!['customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) return;
  const sub = event.data.object;
  const profile = required(await sb.from('user_profiles').select('user_id, subscription_tier').eq('stripe_subscription_id', sub.id).maybeSingle(), 'Subscription lookup failed');
  // Never mutate another subscription using only its customer ID. An update
  // preceding checkout fulfillment must be retried after the linkage exists.
  if (!profile) throw new Error('Subscription is not linked; reconciliation required');
  const active = ['active', 'trialing'].includes(sub.status) && event.type !== 'customer.subscription.deleted';
  let tier = 'none';
  if (active) {
    tier = sub.metadata?.tier || profile.subscription_tier;
    if (!['practitioner', 'firm', 'enterprise'].includes(tier)) throw new Error('Active subscription tier requires reconciliation');
  }
  required(await sb.from('user_profiles').update({
    subscription_tier: tier,
    ...(event.type === 'customer.subscription.deleted' ? { stripe_subscription_id: null } : {}),
    updated_at: new Date().toISOString()
  }).eq('user_id', profile.user_id).eq('stripe_subscription_id', sub.id), 'Subscription update failed');
}
module.exports = { fulfillEvent };
