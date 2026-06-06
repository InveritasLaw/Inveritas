var { createClient } = require('@supabase/supabase-js');

// Read side for the quick-analysis log written by api/analyze.js into the
// `analysis_history` table. Lets a signed-in user re-read past standalone
// analyses (the ones not attached to a saved case) from the dashboard.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://inveritaslaw.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  // Auth check
  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  var sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  var authResult = await sb.auth.getUser(token);
  if (authResult.error || !authResult.data.user) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  var userId = authResult.data.user.id;

  try {
    // GET /api/history?id=xxx — full single analysis (includes result JSONB)
    if (req.method === 'GET' && req.query.id) {
      var id = req.query.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ error: 'Invalid analysis ID' });
      }

      var { data: item, error: itemErr } = await sb.from('analysis_history')
        .select('id, state, county, charge, situation, situation_length, result, vectors_found, created_at')
        .eq('id', id)
        .eq('user_id', userId)
        .single();
      if (itemErr) throw itemErr;
      if (!item) return res.status(404).json({ error: 'Analysis not found' });

      return res.status(200).json({ analysis: item });
    }

    // GET /api/history — list user's quick analyses (lightweight, paginated)
    if (req.method === 'GET') {
      var limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
      var offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      // Note: ip_address is intentionally excluded — it's audit-only, never
      // surfaced to the client.
      var { data, error, count } = await sb.from('analysis_history')
        .select('id, state, county, charge, situation, vectors_found, created_at', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;

      // Truncate the situation to a preview so the list payload stays small.
      var history = (data || []).map(function(a) {
        return {
          id: a.id,
          state: a.state,
          county: a.county,
          charge: a.charge,
          vectors_found: a.vectors_found,
          created_at: a.created_at,
          situation_preview: a.situation
            ? (a.situation.length > 160 ? a.situation.slice(0, 160) + '…' : a.situation)
            : ''
        };
      });

      return res.status(200).json({
        history: history,
        total: typeof count === 'number' ? count : history.length,
        limit: limit,
        offset: offset
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('History API error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
