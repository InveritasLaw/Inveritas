const { getModel, hasAIConfig } = require('./_utils/model');
const { callModel } = require('./_utils/ai-client');
const { reserveAnalysis, completeAnalysis, releaseAnalysis, quotaResponse } = require('./_utils/usage');
var { createClient } = require('@supabase/supabase-js');

// Same system prompt as analyze.js — keep in sync
var SYSTEM_PROMPT_HEADER = `You are a precise legal defense analyst. Analyze only the supplied facts and jurisdiction. Return ONLY valid JSON, without markdown.

Rules:
- Never invent facts, cases, statutes, deadlines, or outcomes. Mark uncertain authority "VERIFY CITATION" or "VERIFY EXACT SECTION".
- Separate admissibility or suppression issues from weight or credibility arguments.
- State unknown prerequisites explicitly and cap confidence at 50.
- Lack of injury is not automatically a defense; identify the charged subsection and its actual elements.
- Use at most 3 concise defense vectors. Prefer evidence preservation, element disputes, and realistic motions.
- This is legal research, not legal advice.

Return this JSON shape:
{
  "charge_analysis": {"offense":"string","governing_statute":"string","severity_class":"string","elements_required":["string"]},
  "inversion_vectors":[{"category":"string","legal_tier":"string","title":"string","motion_type":"string","argument":"string","applicable_law":"string","prerequisites":["string"],"confidence":0}],
  "evidence_priorities":["string"],
  "prosecution_weaknesses":["string"],
  "recommended_motions":["string"],
  "critical_warnings":["string"]
}
Keep the complete JSON under 1,200 output tokens.`;
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://inveritaslaw.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY || !hasAIConfig()) {
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
  var usage = null;
  var usageCompleted = false;

  try {
    var body = req.body || {};
    var caseId = body.case_id;
    var reason = body.reason || 'manual_rerun';
    var additionalContext = body.additional_context || '';

    if (!caseId) return res.status(400).json({ error: 'case_id required' });

    // Verify case ownership and get case data
    var { data: caseData, error: caseErr } = await sb.from('cases')
      .select('*').eq('id', caseId).eq('user_id', userId).single();
    if (caseErr || !caseData) return res.status(404).json({ error: 'Case not found' });

    // Check subscription/usage limits
    var { data: profile } = await sb.from('user_profiles')
      .select('subscription_tier, analyses_this_month, month_reset_date')
      .eq('user_id', userId).single();

    var tier = profile ? profile.subscription_tier : 'none';
    var monthCount = profile ? profile.analyses_this_month : 0;
    var resetDate = profile ? profile.month_reset_date : null;

    // Reset monthly count if needed
    if (resetDate && new Date(resetDate) <= new Date()) {
      monthCount = 0;
    }

    // Check limits
    if (tier === 'none' || tier === 'single') {
      // Single users get no reanalysis — they need practitioner
      return res.status(403).json({ error: 'Reanalysis requires a Practitioner or higher subscription.' });
    }

    // Get all evidence for this case
    var { data: evidenceList } = await sb.from('evidence')
      .select('id, title, description, evidence_type, file_name, source, collected_by, collected_at, sha256_hash, metadata')
      .eq('case_id', caseId).order('created_at', { ascending: true });

    // Get previous analyses for context
    var { data: prevAnalyses } = await sb.from('case_analyses')
      .select('version, situation, trigger_reason, created_at')
      .eq('case_id', caseId).order('version', { ascending: false }).limit(3);

    // Build the analysis prompt with case + evidence context
    var evidenceContext = '';
    if (evidenceList && evidenceList.length > 0) {
      evidenceContext = '\n\nEVIDENCE ON FILE (' + evidenceList.length + ' items):\n';
      for (var i = 0; i < evidenceList.length; i++) {
        var ev = evidenceList[i];
        evidenceContext += '  ' + (i + 1) + '. [' + (ev.evidence_type || 'document').toUpperCase() + '] ' + ev.title;
        if (ev.description) evidenceContext += '\n     Description: ' + ev.description;
        if (ev.source) evidenceContext += '\n     Source: ' + ev.source;
        if (ev.collected_at) evidenceContext += '\n     Collected: ' + ev.collected_at;
        evidenceContext += '\n';
      }
      evidenceContext += '\nAnalyze all evidence for procedural, evidentiary, constitutional, and chain-of-custody issues. Each piece of evidence may open or close defense vectors.';
    }

    var prevContext = '';
    if (prevAnalyses && prevAnalyses.length > 0) {
      prevContext = '\n\nPREVIOUS ANALYSIS HISTORY (' + prevAnalyses.length + ' versions):';
      prevContext += '\nThis is a REANALYSIS. New evidence or context has been added. Update your findings accordingly. Identify what changed.';
    }

    var situation = caseData.description || '';
    if (additionalContext) {
      situation += '\n\nADDITIONAL CONTEXT (added for reanalysis):\n' + String(additionalContext).slice(0, 3000);
    }

    var userMessage = 'JURISDICTION: ' + (caseData.state || 'Not specified') +
      '\nCOUNTY/CITY: ' + (caseData.county || 'Not specified') +
      '\nCHARGE: ' + (caseData.charge || 'Not specified') +
      '\nCIRCUMSTANCES:\n' + String(situation).slice(0, 5000) +
      evidenceContext + prevContext +
      '\n\nAnalyze through every statutory inversion lens at all three tiers. Identify tier conflicts. Account for ALL evidence listed above.';

    // Build evidence snapshot for versioning
    var evidenceSnapshot = (evidenceList || []).map(function(ev) {
      return { id: ev.id, title: ev.title, type: ev.evidence_type, hash: ev.sha256_hash };
    });

    try {
      usage = await reserveAnalysis(sb, userId);
    } catch (quotaError) {
      var denied = quotaResponse(quotaError);
      return res.status(denied.status).json(denied.body);
    }

    // Keep the provider call inside Vercel's 60-second function ceiling. Do
    // not stream whitespace as a keepalive: that commits a partial response
    // and leaves the browser with an empty/truncated JSON body if the gateway
    // terminates the invocation.
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    var apiData = null;
    var modelError = null;
    try {
      apiData = await callModel({
        system: SYSTEM_PROMPT_HEADER,
        prompt: userMessage,
        maxTokens: 1200,
        reasoningEffort: 'low',
        modelOverride: process.env.OPENAI_REANALYSIS_MODEL || 'gpt-5.6-terra'
      });
    } catch (fetchErr) {
      modelError = fetchErr;
      console.error('Reanalysis model call failed:', fetchErr.model || 'unknown-model', fetchErr.message);
    }

    if (!apiData || (apiData.error && apiData.error.type === 'overloaded_error')) {
      await releaseAnalysis(sb, userId, usage.reservation_id);
      usage = null;
      return res.status(503).json({
        error: 'The analysis service is unavailable' +
          (modelError && modelError.model ? ' (' + modelError.model + ')' : '') + ': ' +
          (modelError && modelError.message ? modelError.message : 'Please try again.')
      });
    }

    if (apiData.error) {
      await releaseAnalysis(sb, userId, usage.reservation_id);
      usage = null;
      return res.status(502).json({ error: 'Analysis service error: ' + (apiData.error.message || 'Unknown') });
    }

    // Parse the result
    var text = '';
    if (apiData.content && Array.isArray(apiData.content)) {
      for (var j = 0; j < apiData.content.length; j++) {
        if (apiData.content[j].type === 'text') text += apiData.content[j].text;
      }
    }

    var clean = text.replace(/```json|```/g, '').trim();
    var result;
    try {
      result = JSON.parse(clean);
    } catch (parseErr) {
      await releaseAnalysis(sb, userId, usage.reservation_id);
      usage = null;
      console.error('Reanalysis JSON parse failed:', clean.slice(0, 300));
      return res.status(422).json({ error: 'The model returned incomplete analysis data. Please retry.' });
    }

    // Save analysis to case_analyses
    var { data: savedAnalysis, error: saveErr } = await sb.from('case_analyses').insert({
      case_id: caseId,
      user_id: userId,
      state: caseData.state,
      county: caseData.county,
      charge: caseData.charge,
      situation: situation.slice(0, 5000),
      evidence_snapshot: evidenceSnapshot,
      result: result,
      model_version: apiData.model || getModel(),
      trigger_reason: reason
    }).select().single();

    if (saveErr) throw new Error('Failed to save analysis: ' + saveErr.message);
    await completeAnalysis(sb, userId, usage.reservation_id);
    usageCompleted = true;

    // Update case updated_at
    await sb.from('cases').update({ updated_at: new Date().toISOString() })
      .eq('id', caseId);

    return res.status(200).json({
      analysis: result,
      version: savedAnalysis ? savedAnalysis.version : 1,
      analysis_id: savedAnalysis ? savedAnalysis.id : null,
      evidence_count: evidenceList ? evidenceList.length : 0,
      trigger_reason: reason
    });

  } catch (err) {
    if (usage && !usageCompleted) {
      try { await releaseAnalysis(sb, userId, usage.reservation_id); }
      catch (releaseErr) { console.error('Reservation release failed:', releaseErr.message); }
    }
    console.error('Reanalyze error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};

module.exports.config = { maxDuration: 60 };
