module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    status: 'ok',
    service: 'inveritas',
    timestamp: new Date().toISOString(),
    checks: {
      anthropic_key: !!process.env.ANTHROPIC_API_KEY,
      stripe_key: !!process.env.STRIPE_SECRET_KEY,
      supabase_url: !!process.env.SUPABASE_URL,
      supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
};
