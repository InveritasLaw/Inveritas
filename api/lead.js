var { createClient } = require('@supabase/supabase-js');

// Public lead-capture endpoint for the funnel exit/hesitation popup.
// No auth: it's an unauthenticated marketing form. Inserts into the `leads`
// table with the service-role key. Includes a honeypot + basic validation
// to cut spam.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://inveritaslaw.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  var body = req.body || {};

  // Honeypot: real users never fill this hidden field. If filled, accept
  // silently (so the bot thinks it worked) but store nothing.
  if (body.company) return res.status(200).json({ ok: true });

  var clean = function (v, max) { return v ? String(v).trim().slice(0, max) : null; };
  var name = clean(body.name, 120);
  var email = clean(body.email, 200);
  var phone = clean(body.phone, 40);
  var state = clean(body.state, 100);

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  var ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';

  try {
    var sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    var { error } = await sb.from('leads').insert({
      name: name,
      email: email.toLowerCase(),
      phone: phone,
      state: state,
      variant: clean(body.variant, 20),
      source: clean(body.source, 300),
      trigger: clean(body.trigger, 30),
      ip_address: String(ip).split(',')[0].trim(),
      created_at: new Date().toISOString()
    });
    if (error) throw error;

    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Lead capture error:', err);
    return res.status(500).json({ error: 'Could not save. Please try again.' });
  }
};
