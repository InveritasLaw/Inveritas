const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

// A dedicated, read-only connection to one case. Never accepts case IDs from callers.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.COURT_PORTAL_READ_TOKEN;
  const caseId = process.env.COURT_PORTAL_CASE_ID;
  const ownerId = process.env.COURT_PORTAL_OWNER_ID;
  if (!secret || secret.length < 40 || !caseId || !ownerId) {
    return res.status(503).json({ error: 'Case connection is not configured' });
  }
  const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const hash = value => crypto.createHash('sha256').update(value).digest();
  if (!crypto.timingSafeEqual(hash(secret), hash(supplied))) return res.status(401).json({ error: 'Unauthorized' });
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Storage unavailable');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const c = await sb.from('cases').select('id,title,charge,state,county,updated_at').eq('id', caseId).eq('user_id', ownerId).single();
    if (c.error || !c.data) return res.status(404).json({ error: 'Configured case is unavailable' });
    const a = await sb.from('case_analyses').select('id,version,created_at,result,model_version,trigger_reason,evidence_snapshot').eq('case_id', caseId).eq('user_id', ownerId).order('version', { ascending: false }).limit(1);
    if (a.error) throw Error('Analysis read failed');
    return res.status(200).json({ case: c.data, analysis: a.data?.[0] || null, retrievedAt: new Date().toISOString() });
  } catch (e) {
    console.error('Court portal analysis read failed');
    return res.status(502).json({ error: 'Unable to retrieve the case analysis' });
  }
};
