const { getModel } = require('./_utils/model');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const checks = {
    anthropic_key: !!process.env.ANTHROPIC_API_KEY,
    stripe_key: !!process.env.STRIPE_SECRET_KEY,
    stripe_webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET,
    supabase_url: !!process.env.SUPABASE_URL,
    supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    model_config: false
  };
  let model = null;
  try { model = getModel(); checks.model_config = true; }
  catch (err) { console.error('Health configuration error:', err.message); }
  const configured = Object.values(checks).every(Boolean);
  return res.status(configured ? 200 : 503).json({
    status: configured ? 'configured' : 'misconfigured',
    service: 'inveritas',
    timestamp: new Date().toISOString(),
    scope: 'configuration_only',
    dependencies_tested: false,
    model,
    checks
  });
};
