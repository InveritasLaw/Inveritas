// Logs user events server-side: consent, login, signup, analysis, page views
// Captures IP address, user agent, and forwards to Supabase for persistent storage.
// The Supabase service role key is used server-side for unrestricted inserts.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    // If Supabase isn't configured yet, silently succeed (non-blocking)
    return res.status(200).json({ logged: false, reason: 'Logging not configured' });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { event, metadata } = req.body;

    if (!event || typeof event !== 'string') {
      return res.status(400).json({ error: 'Missing event type' });
    }

    // Extract client information from request headers
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
      || req.headers['x-real-ip'] 
      || req.socket?.remoteAddress 
      || 'unknown';
    
    const userAgent = req.headers['user-agent'] || 'unknown';
    
    // Parse user agent for OS and browser
    const os = parseOS(userAgent);
    const browser = parseBrowser(userAgent);

    // Extract auth token if present
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) userId = user.id;
      } catch (e) { /* no valid session, that's ok */ }
    }

    // Build the log entry
    const logEntry = {
      event_type: String(event).slice(0, 100),
      user_id: userId,
      ip_address: String(ip).slice(0, 45),
      user_agent: String(userAgent).slice(0, 500),
      os: os,
      browser: browser,
      metadata: metadata ? JSON.stringify(metadata).slice(0, 5000) : null,
      created_at: new Date().toISOString()
    };

    const { error } = await supabase.from('event_logs').insert(logEntry);

    if (error) {
      console.error('Supabase log error:', error);
      return res.status(200).json({ logged: false, reason: error.message });
    }

    return res.status(200).json({ logged: true });

  } catch (err) {
    console.error('Log event error:', err);
    // Non-blocking — don't let logging failures affect the user
    return res.status(200).json({ logged: false, reason: err.message });
  }
};

function parseOS(ua) {
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Linux/.test(ua)) return 'Linux';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  return 'Unknown';
}

function parseBrowser(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua) && !/Edg/.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  if (/OPR\//.test(ua)) return 'Opera';
  return 'Unknown';
}
