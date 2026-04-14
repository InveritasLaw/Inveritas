var { createClient } = require('@supabase/supabase-js');

// Same system prompt as analyze.js — keep in sync
var SYSTEM_PROMPT_HEADER = 'You are a precision legal defense analyst specializing in STATUTORY INVERSION across three tiers of American law: Federal, State, and County/Municipal.\n\n' +
'RULES:\n' +
'1. NEVER fabricate case citations. If uncertain, describe the principle and note "citation should be verified."\n' +
'2. NEVER invent statute numbers. If uncertain, state the principle and flag "verify exact code section."\n' +
'3. Confidence scores must be calibrated: 80-100 only for textbook arguments, 50-79 for strong but fact-dependent, 20-49 for viable but challenging, below 20 for longshots.\n' +
'4. All items in arrays must be PLAIN STRINGS, not objects.\n\n' +
'Return ONLY valid JSON (no markdown, no backticks, no preamble):\n' +
'{\n' +
'  "charge_analysis": {\n' +
'    "offense": "specific charge",\n' +
'    "jurisdiction": "State/Federal/Municipal",\n' +
'    "county_or_city": "county or city",\n' +
'    "governing_statute": "primary statute",\n' +
'    "severity_class": "Felony/Misdemeanor/Infraction",\n' +
'    "elements_required": ["each element as a plain string"],\n' +
'    "mens_rea": "mental state required",\n' +
'    "court_type": "court type",\n' +
'    "potential_penalties": "sentencing range"\n' +
'  },\n' +
'  "jurisdiction_analysis": {\n' +
'    "federal_provisions": {\n' +
'      "constitutional_issues": ["plain string items"],\n' +
'      "federal_statutes": ["plain string items"],\n' +
'      "supreme_court_precedent": ["plain string items"]\n' +
'    },\n' +
'    "state_provisions": {\n' +
'      "state_code_sections": ["plain string items"],\n' +
'      "state_case_law": ["plain string items"],\n' +
'      "state_procedure_rules": ["plain string items"]\n' +
'    },\n' +
'    "municipal_provisions": {\n' +
'      "local_ordinances": ["plain string items"],\n' +
'      "municipal_procedures": ["plain string items"],\n' +
'      "penalty_schedule_differences": ["plain string items"]\n' +
'    }\n' +
'  },\n' +
'  "tier_conflict_opportunities": ["each conflict as a plain string describing the conflict"],\n' +
'  "inversion_vectors": [\n' +
'    {\n' +
'      "category": "CONSTITUTIONAL|DEFINITIONAL|PROCEDURAL|EVIDENTIARY|TIER_CONFLICT|STATUTORY",\n' +
'      "legal_tier": "FEDERAL|STATE|MUNICIPAL|CROSS-TIER",\n' +
'      "title": "concise descriptive title",\n' +
'      "motion_type": "SUPPRESSION|WEIGHT|BOTH|DISMISSAL|PROCEDURAL",\n' +
'      "argument": "detailed legal argument as a string",\n' +
'      "applicable_law": "specific citation",\n' +
'      "prerequisites": ["plain string conditions"],\n' +
'      "confidence": 0-100\n' +
'    }\n' +
'  ],\n' +
'  "evidence_priorities": ["plain string items ranked by importance"],\n' +
'  "statutory_escape_hatches": ["each escape hatch as a plain string"],\n' +
'  "prosecution_weaknesses": ["each weakness as a plain string"],\n' +
'  "recommended_motions": ["each motion as a plain string"],\n' +
'  "critical_deadlines": ["each deadline as a plain string"],\n' +
'  "critical_warnings": ["each warning as a plain string"]\n' +
'}\n\n' +
'CRITICAL: Every item in tier_conflict_opportunities, statutory_escape_hatches, prosecution_weaknesses, recommended_motions, critical_deadlines, critical_warnings, and evidence_priorities MUST be a plain string, NOT an object. Only inversion_vectors should be objects.\n\n' +
'Accuracy over volume. Five real vectors at calibrated confidence are worth more than ten inflated ones.';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://inveritaslaw.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
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
    if (tier === 'practitioner' && monthCount >= 50) {
      return res.status(403).json({ error: 'Monthly analysis limit reached (50/month). Upgrade to Firm for unlimited.' });
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

    // Call Anthropic API
    // Use keepalive approach for Vercel timeout
    var keepaliveTimer;
    var headersSent = false;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');

    keepaliveTimer = setInterval(function() {
      if (!headersSent) { res.write(' '); }
    }, 3000);

    var response = null;
    var apiData = null;
    var maxRetries = 3;
    var retryDelays = [2000, 5000, 10000];

    for (var attempt = 0; attempt < maxRetries; attempt++) {
      try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 8192,
            system: SYSTEM_PROMPT_HEADER,
            messages: [{ role: 'user', content: userMessage }]
          })
        });

        apiData = await response.json();

        if (apiData.error && apiData.error.type === 'overloaded_error') {
          console.log('Anthropic overloaded, retry ' + (attempt + 1) + '/' + maxRetries);
          apiData = null;
          if (attempt < maxRetries - 1) {
            await new Promise(function(r) { setTimeout(r, retryDelays[attempt]); });
            continue;
          }
        } else {
          break;
        }
      } catch (fetchErr) {
        if (attempt < maxRetries - 1) {
          await new Promise(function(r) { setTimeout(r, retryDelays[attempt]); });
          continue;
        }
      }
    }

    clearInterval(keepaliveTimer);

    if (!apiData || (apiData.error && apiData.error.type === 'overloaded_error')) {
      return res.end(JSON.stringify({ error: 'Analysis service temporarily overloaded. Please wait a moment and try again.' }));
    }

    if (apiData.error) {
      return res.end(JSON.stringify({ error: 'Analysis service error: ' + (apiData.error.message || 'Unknown') }));
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
      return res.end(JSON.stringify({ error: 'Analysis returned malformed data. Please try again.' }));
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
      model_version: 'claude-sonnet-4-20250514',
      trigger_reason: reason
    }).select().single();

    if (saveErr) console.error('Failed to save analysis:', saveErr);

    // Increment usage
    await sb.rpc('increment_analysis_count', { p_user_id: userId });

    // Update case updated_at
    await sb.from('cases').update({ updated_at: new Date().toISOString() })
      .eq('id', caseId);

    headersSent = true;
    return res.end(JSON.stringify({
      analysis: result,
      version: savedAnalysis ? savedAnalysis.version : 1,
      analysis_id: savedAnalysis ? savedAnalysis.id : null,
      evidence_count: evidenceList ? evidenceList.length : 0,
      trigger_reason: reason
    }));

  } catch (err) {
    clearInterval(keepaliveTimer);
    console.error('Reanalyze error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};

module.exports.config = { maxDuration: 60 };
