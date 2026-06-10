var { createClient } = require('@supabase/supabase-js');
var crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://inveritaslaw.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  var sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  var authResult = await sb.auth.getUser(token);
  if (authResult.error || !authResult.data.user) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  var userId = authResult.data.user.id;
  var ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';

  try {
    // GET /api/evidence?id=xxx&action=url — fresh signed URL to view/download one file
    if (req.method === 'GET' && req.query.id && req.query.action === 'url') {
      var viewId = req.query.id;
      var { data: viewEv } = await sb.from('evidence')
        .select('id, file_path, file_name')
        .eq('id', viewId).eq('user_id', userId).single();
      if (!viewEv) return res.status(404).json({ error: 'Evidence not found' });
      if (!viewEv.file_path) return res.status(404).json({ error: 'No file attached to this evidence' });

      var { data: signed, error: signErr } = await sb.storage
        .from('evidence')
        .createSignedUrl(viewEv.file_path, 3600); // 1 hour
      if (signErr || !signed) return res.status(500).json({ error: 'Could not generate file link' });

      // Custody log — non-blocking so a logging/constraint error never blocks viewing
      try {
        await sb.from('evidence_custody_log').insert({
          evidence_id: viewId, action: 'viewed', actor_id: userId,
          ip_address: ip, notes: 'Evidence file viewed'
        });
      } catch (logErr) { /* ignore */ }

      return res.status(200).json({ url: signed.signedUrl, file_name: viewEv.file_name });
    }

    // GET /api/evidence?case_id=xxx — list evidence for a case
    if (req.method === 'GET') {
      var caseId = req.query.case_id;
      if (!caseId) return res.status(400).json({ error: 'case_id required' });

      // Verify case ownership
      var { data: caseCheck } = await sb.from('cases')
        .select('id').eq('id', caseId).eq('user_id', userId).single();
      if (!caseCheck) return res.status(404).json({ error: 'Case not found' });

      var { data: evidenceList, error } = await sb.from('evidence')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Generate signed URLs for files
      for (var i = 0; i < (evidenceList || []).length; i++) {
        var ev = evidenceList[i];
        if (ev.file_path) {
          var { data: signedData } = await sb.storage
            .from('evidence')
            .createSignedUrl(ev.file_path, 3600); // 1 hour
          ev.signed_url = signedData ? signedData.signedUrl : null;
        }
      }

      return res.status(200).json({ evidence: evidenceList || [] });
    }

    // POST /api/evidence — add evidence metadata (file upload handled client-side to Supabase Storage)
    if (req.method === 'POST') {
      var body = req.body || {};
      var caseId = body.case_id;
      if (!caseId) return res.status(400).json({ error: 'case_id required' });

      // Verify case ownership
      var { data: caseCheck } = await sb.from('cases')
        .select('id').eq('id', caseId).eq('user_id', userId).single();
      if (!caseCheck) return res.status(404).json({ error: 'Case not found' });

      var title = String(body.title || 'Untitled Evidence').slice(0, 200);
      var description = body.description ? String(body.description).slice(0, 2000) : null;

      var newEvidence = {
        case_id: caseId,
        user_id: userId,
        title: title,
        description: description,
        evidence_type: body.evidence_type || 'document',
        file_name: body.file_name ? String(body.file_name).slice(0, 255) : null,
        file_type: body.file_type ? String(body.file_type).slice(0, 100) : null,
        file_size: body.file_size ? parseInt(body.file_size) : null,
        file_path: body.file_path ? String(body.file_path).slice(0, 500) : null,
        sha256_hash: body.sha256_hash ? String(body.sha256_hash).slice(0, 64) : null,
        source: body.source ? String(body.source).slice(0, 200) : null,
        collected_by: body.collected_by ? String(body.collected_by).slice(0, 200) : null,
        collected_at: body.collected_at || null,
        metadata: body.metadata || {}
      };

      var { data: evidence, error } = await sb.from('evidence')
        .insert(newEvidence).select().single();
      if (error) throw error;

      // Create custody log entry
      await sb.from('evidence_custody_log').insert({
        evidence_id: evidence.id,
        action: 'uploaded',
        actor_id: userId,
        ip_address: ip,
        notes: 'Evidence uploaded: ' + title
      });

      return res.status(201).json({ evidence: evidence });
    }

    // DELETE /api/evidence?id=xxx — remove evidence
    if (req.method === 'DELETE') {
      var evidenceId = req.query.id;
      if (!evidenceId) return res.status(400).json({ error: 'Evidence ID required' });

      // Verify ownership
      var { data: ev } = await sb.from('evidence')
        .select('id, file_path')
        .eq('id', evidenceId)
        .eq('user_id', userId)
        .single();
      if (!ev) return res.status(404).json({ error: 'Evidence not found' });

      // Log before delete
      await sb.from('evidence_custody_log').insert({
        evidence_id: evidenceId,
        action: 'deleted',
        actor_id: userId,
        ip_address: ip,
        notes: 'Evidence deleted by user'
      });

      // Delete file from storage
      if (ev.file_path) {
        await sb.storage.from('evidence').remove([ev.file_path]);
      }

      // Delete metadata record
      var { error } = await sb.from('evidence').delete()
        .eq('id', evidenceId).eq('user_id', userId);
      if (error) throw error;

      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Evidence API error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
