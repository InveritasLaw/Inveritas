var { createClient } = require('@supabase/supabase-js');

// =====================================================================
// INVERITAS — PLATFORM API (CONSOLIDATED)
// Single endpoint routing all V3/V4 features via ?action= parameter
//
// Actions:
//   verify-citations   — CourtListener citation verification
//   tool               — 6 analysis tools (expungement, plea, opposing, strength, checklist, handoff)
//   deadlines          — CRUD + auto-extraction
//   audit-export       — TDPSA data portability export
//   case-patterns      — Multi-case analytics (Firm+)
//   attorney-review    — Attorney review marketplace
// =====================================================================

// ===== SANITIZER (inline to avoid _utils import issues) =====
function sanitize(text, max) {
  if (!text || typeof text !== 'string') return '';
  max = max || 5000;
  var c = text;
  c = c.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E]/g, '');
  c = c.replace(/[\uFF01-\uFF5E]/g, function(ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
  var patterns = [
    /<\/?[a-z][a-z0-9]*[^>]*>/gi,
    /\[INST\]|\[\/INST\]|\[SYS\]|\[\/SYS\]/gi,
    /<<\s*SYS\s*>>|<<\s*\/SYS\s*>>/gi,
    /\bHuman\s*:\s*|\bAssistant\s*:\s*|\bSystem\s*:\s*/gi,
    /ignore\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?)/gi,
    /disregard\s+(all\s+)?(previous|prior|system)\s+(instructions?|prompts?)/gi,
    /forget\s+(everything|all|your|previous)/gi,
    /override\s+(system|instructions?|rules?|safety)/gi,
    /bypass\s+(system|safety|content|restrictions?)/gi,
    /you\s+are\s+now\s+(a|an|my)\s+/gi,
    /act\s+as\s+(if\s+)?(you\s+are|an?)\s+/gi,
    /pretend\s+(you|to\s+be)/gi,
    /role\s*[:=]\s*(system|assistant|admin)/gi,
    /\bjailbreak\b/gi, /\bDAN\s+mode\b/gi, /\bdev\s*mode\b/gi,
    /show\s+(me\s+)?(your|the)\s+(system|initial)\s+(prompt|instructions?)/gi,
    /\beval\s*\(/gi, /\bexec\s*\(/gi, /\b__proto__\b/gi,
    /\bprocess\s*\.\s*env\b/gi,
    /[^\s]{50,}/g
  ];
  for (var i = 0; i < patterns.length; i++) c = c.replace(patterns[i], '[removed]');
  c = c.replace(/\n{4,}/g, '\n\n\n');
  return c.slice(0, max);
}

// ===== TOOL SYSTEM PROMPTS =====
var TOOL_PROMPTS = {
  expungement_check: {
    label: 'Expungement Eligibility Check',
    requiresAnalysis: false,
    system: 'You are a legal research assistant specializing in criminal record expungement and nondisclosure orders.\n\nFor TEXAS, analyze under Chapter 55 CCP (Expunction) and Texas Gov. Code §§411.071-411.0736 (Nondisclosure). For other states, use that state\'s expungement statutes.\n\nReturn ONLY valid JSON:\n{"eligible_for_expunction":true/false/null,"expunction_basis":"statutory basis","expunction_waiting_period":"time or null","eligible_for_nondisclosure":true/false/null,"nondisclosure_type":"automatic/petition/null","nondisclosure_waiting_period":"time or null","disqualifying_factors":["factors"],"requirements":["steps"],"estimated_filing_fee":"amount","analysis":"detailed explanation","warnings":["caveats"],"confidence":0-100}'
  },
  plea_analysis: {
    label: 'Plea Deal Analyzer',
    requiresAnalysis: false,
    system: 'You are a legal research assistant analyzing plea offers.\n\nAnalyze: rights waived, whether terms are typical for this jurisdiction, sentence comparison (offered vs max vs typical), collateral consequences (immigration, employment, housing, gun rights, voting, professional licenses), appeal rights preservation, red flags.\n\nReturn ONLY valid JSON:\n{"offered_charge":"charge","offered_sentence":"terms","statutory_maximum":"max","typical_outcome_range":"typical","rights_waived":["rights"],"collateral_consequences":["consequences"],"preserves_appeal":true/false/null,"red_flags":["flags"],"favorable_terms":["terms"],"analysis":"assessment","warnings":["warnings"],"confidence":0-100}\n\nNEVER recommend accepting or rejecting. Information only.'
  },
  opposing_doc_analysis: {
    label: 'Opposing Document Analyzer',
    requiresAnalysis: true,
    system: 'You are a legal research assistant analyzing prosecution documents.\n\nIdentify: key factual claims and evidence support, legal argument strengths/weaknesses, inconsistencies, favorable admissions, burden gaps, counter-arguments.\n\nReturn ONLY valid JSON:\n{"document_type":"type","key_claims":[{"claim":"...","evidence_support":"strong/weak/unsupported","counter":"..."}],"inconsistencies":["contradictions"],"favorable_admissions":["concessions"],"burden_gaps":["gaps"],"counter_arguments":["arguments"],"recommended_responses":["responses"],"analysis":"overall","confidence":0-100}'
  },
  case_strength: {
    label: 'Case Strength Assessment',
    requiresAnalysis: true,
    system: 'You are a legal research assistant providing defense posture assessment.\n\nReturn ONLY valid JSON:\n{"overall_score":0-100,"posture":"strong/moderate/weak/insufficient_data","strongest_vectors":["top 3"],"weakest_areas":["vulnerabilities"],"prosecution_burden_assessment":"difficulty","evidence_gaps":["needed evidence"],"key_factors":[{"factor":"...","impact":"positive/negative/neutral","weight":"high/medium/low"}],"likely_outcomes":[{"outcome":"...","probability":"high/medium/low"}],"analysis":"narrative","disclaimer":"This is an analytical indicator, not a prediction. Consult a licensed attorney."}\n\nNEVER say "will win" or "will lose."'
  },
  filing_checklist: {
    label: 'Filing Checklist Generator',
    requiresAnalysis: false,
    system: 'You are a legal research assistant generating jurisdiction-specific filing checklists.\n\nReturn ONLY valid JSON:\n{"jurisdiction":"state and county","court":"court type","formatting_requirements":["requirements"],"caption_format":"format","filing_method":["methods"],"copies_required":"number","filing_fee":"amount","service_requirements":["requirements"],"certificate_of_service":true/false,"proposed_order_required":true/false,"hearing_request_process":"process","checklist":[{"item":"...","required":true/false,"notes":"..."}],"common_mistakes":["mistakes"],"jurisdiction_note":"Verify with clerk of court.","confidence":0-100}'
  },
  attorney_handoff_assessment: {
    label: 'Attorney Handoff Assessment',
    requiresAnalysis: true,
    system: 'You are a legal research assistant assessing case complexity for self-representation.\n\nReturn ONLY valid JSON:\n{"handoff_recommended":true/false,"urgency":"immediate/recommended/optional","complexity_score":0-100,"risk_level":"critical/high/moderate/low","factors":[{"factor":"...","severity":"critical/high/moderate/low","explanation":"..."}],"risks_of_self_representation":["risks"],"attorney_type_needed":"type","estimated_cost_range":"$X-$Y","free_alternatives":["public defender","legal aid","law school clinics"],"analysis":"explanation","disclaimer":"This is informational only. The decision to hire an attorney is yours alone."}\n\nRecommend handoff for: felonies, DWI with priors, federal charges, constitutional violations, mandatory minimums, sex offenses, immigration consequences, multi-defendant cases.'
  }
};

module.exports = async function handler(req, res) {
  var allowedOrigins = ['https://inveritaslaw.com', 'https://www.inveritaslaw.com'];
  var origin = req.headers.origin;
  if (allowedOrigins.indexOf(origin) >= 0) res.setHeader('Access-Control-Allow-Origin', origin);
  else if (process.env.VERCEL_ENV !== 'production') res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var SUPABASE_URL = process.env.SUPABASE_URL;
  var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  var CL_TOKEN = process.env.COURTLISTENER_API_TOKEN;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Not configured' });

  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  var sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  var authResult = await sb.auth.getUser(token);
  if (authResult.error || !authResult.data.user) return res.status(401).json({ error: 'Invalid session' });
  var userId = authResult.data.user.id;
  var userEmail = authResult.data.user.email;

  var action = req.query.action || (req.body && req.body.action) || '';

  try {
    // ===================================================================
    // ACTION: verify-citations
    // ===================================================================
    if (action === 'verify-citations') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
      var text = (req.body.text || '').slice(0, 50000);
      if (!text || text.length < 20) return res.status(400).json({ error: 'Text required' });

      var results = { formal_citations: [], case_names: [], statute_references: [], summary: { total_citations: 0, verified: 0, not_found: 0, ambiguous: 0, statutes: 0, unverifiable: 0 } };

      if (CL_TOKEN) {
        // Step 1: CourtListener citation lookup
        try {
          var clResp = await fetch('https://www.courtlistener.com/api/rest/v4/citation-lookup/', {
            method: 'POST',
            headers: { 'Authorization': 'Token ' + CL_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'text=' + encodeURIComponent(text)
          });
          if (clResp.ok) {
            var clData = await clResp.json();
            if (Array.isArray(clData)) {
              clData.forEach(function(c) {
                var entry = { citation: c.citation || '', normalized: (c.normalized_citations || []).join(', '), status: 'unknown', source: 'courtlistener', details: null, url: null };
                if (c.status === 200 && c.clusters && c.clusters.length > 0) {
                  entry.status = 'verified'; entry.details = c.clusters[0].case_name || null;
                  entry.url = c.clusters[0].absolute_url ? 'https://www.courtlistener.com' + c.clusters[0].absolute_url : null;
                  results.summary.verified++;
                } else if (c.status === 300) { entry.status = 'ambiguous'; results.summary.ambiguous++;
                } else if (c.status === 404) { entry.status = 'not_found'; entry.details = c.error_message || 'Not found'; results.summary.not_found++;
                } else { results.summary.unverifiable++; }
                results.formal_citations.push(entry); results.summary.total_citations++;
              });
            }
          }
        } catch (e) { /* non-fatal */ }

        // Step 2: Case name search
        var caseNameRe = /([A-Z][A-Za-z'.]+(?:\s+(?:of|ex\s+rel\.|&)\s+[A-Z][A-Za-z'.]+)*)\s+v(?:s)?\.?\s+([A-Z][A-Za-z'.]+(?:\s+(?:of|ex\s+rel\.|&)\s+[A-Z][A-Za-z'.]+)*)/g;
        var nameMatches = []; var match; var seen = {};
        while ((match = caseNameRe.exec(text)) !== null) {
          var fn = match[0].trim();
          if (!seen[fn]) { seen[fn] = true; nameMatches.push(fn); }
        }
        for (var n = 0; n < Math.min(nameMatches.length, 15); n++) {
          try {
            var sResp = await fetch('https://www.courtlistener.com/api/rest/v4/search/?q=' + encodeURIComponent('"' + nameMatches[n] + '"') + '&type=o&page_size=1', { headers: { 'Authorization': 'Token ' + CL_TOKEN } });
            if (sResp.ok) {
              var sData = await sResp.json();
              var entry = { citation: nameMatches[n], status: 'unknown', source: 'courtlistener_search', details: null, url: null };
              if (sData.count > 0 && sData.results && sData.results.length > 0) {
                entry.status = 'verified'; entry.details = sData.results[0].caseName || 'Found';
                entry.url = sData.results[0].absolute_url ? 'https://www.courtlistener.com' + sData.results[0].absolute_url : null;
                results.summary.verified++;
              } else { entry.status = 'not_found'; results.summary.not_found++; }
              results.case_names.push(entry); results.summary.total_citations++;
            }
            await new Promise(function(r) { setTimeout(r, 200); });
          } catch (e) { /* non-fatal */ }
        }
      } else {
        results.summary.service_status = 'unconfigured';
        results.summary.warning = 'Add COURTLISTENER_API_TOKEN to Vercel env vars. Register free at courtlistener.com.';
      }

      // Step 3: Statute references
      var statPatterns = [
        /\d+\s+U\.?S\.?C\.?\s*[§]?\s*\d+[a-z]?(?:\([a-z0-9]+\))?/gi,
        /Tex(?:as)?\.?\s+(?:Penal|Crim\.?\s*Proc|Transp(?:ortation)?|Fam(?:ily)?|Gov(?:ernment)?|Bus\.?\s*&\s*Com|Prop|Health\s*&\s*Safety|Civ\.?\s*Prac(?:tice)?)\s*(?:Code)?\s*[§]?\s*[\d.]+[a-z]?/gi,
        /[A-Z][a-z]+\.?\s+(?:Rev\.?\s*Stat|Code|Gen\.?\s*Stat|Ann)\s*(?:Ann\.?)?\s*[§]?\s*[\d.\-]+/gi,
        /\d+\s+C\.?F\.?R\.?\s*[§]?\s*[\d.]+/gi,
        /(?:Fourth|Fifth|Sixth|Fourteenth|4th|5th|6th|14th)\s+Amendment/gi
      ];
      var statSeen = {};
      statPatterns.forEach(function(pat) {
        var m;
        while ((m = pat.exec(text)) !== null) {
          var s = m[0].trim();
          if (!statSeen[s]) { statSeen[s] = true; results.statute_references.push({ citation: s, status: 'statute_unverified', details: 'Verify against current code' }); results.summary.statutes++; results.summary.total_citations++; }
        }
      });

      var total = results.summary.total_citations;
      results.summary.verification_rate = total > 0 ? Math.round((results.summary.verified / total) * 100) : 0;
      if (results.summary.not_found > 0) results.summary.warning = results.summary.not_found + ' citation(s) could not be verified and may be hallucinated.';
      return res.status(200).json(results);
    }

    // ===================================================================
    // ACTION: tool (6 legal analysis tools)
    // ===================================================================
    if (action === 'tool') {
      if (req.method === 'GET') {
        var caseId = req.query.case_id;
        if (!caseId) return res.status(400).json({ error: 'case_id required' });
        var q = sb.from('tool_results').select('*').eq('case_id', caseId).eq('user_id', userId);
        if (req.query.tool_type) q = q.eq('tool_type', req.query.tool_type);
        var { data } = await q.order('created_at', { ascending: false });
        return res.status(200).json({ results: data || [] });
      }
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
      if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key not configured' });

      var body = req.body;
      var toolType = body.tool_type;
      if (!body.case_id || !toolType || !TOOL_PROMPTS[toolType]) {
        return res.status(400).json({ error: 'case_id and valid tool_type required. Available: ' + Object.keys(TOOL_PROMPTS).join(', ') });
      }
      var tool = TOOL_PROMPTS[toolType];

      var caseR = await sb.from('cases').select('*').eq('id', body.case_id).eq('user_id', userId).single();
      if (!caseR.data) return res.status(404).json({ error: 'Case not found' });
      var cd = caseR.data;

      var evR = await sb.from('evidence').select('id,title,description,evidence_type,source').eq('case_id', body.case_id).order('created_at');

      var latestAnalysis = null;
      if (tool.requiresAnalysis) {
        var aR = await sb.from('case_analyses').select('*').eq('case_id', body.case_id).eq('user_id', userId).order('version', { ascending: false }).limit(1);
        if (!aR.data || aR.data.length === 0) return res.status(400).json({ error: 'This tool requires a completed analysis first.' });
        latestAnalysis = aR.data[0];
      }

      var prompt = 'CASE: ' + (cd.state || '') + ', ' + (cd.county || '') + ' | Charge: ' + (cd.charge || '') + ' | Type: ' + (cd.case_type || 'criminal') + '\nDescription: ' + sanitize(cd.description || '', 3000) + '\n';
      if ((evR.data || []).length > 0) {
        prompt += '\nEvidence (' + evR.data.length + '):\n';
        evR.data.forEach(function(ev, i) { prompt += (i + 1) + '. [' + (ev.evidence_type || '').toUpperCase() + '] ' + ev.title + (ev.description ? ' — ' + ev.description : '') + '\n'; });
      }
      if (latestAnalysis && latestAnalysis.result) {
        var r = latestAnalysis.result;
        prompt += '\nAnalysis (v' + latestAnalysis.version + '): Offense: ' + (r.charge_analysis ? r.charge_analysis.offense : '') + ' | Statute: ' + (r.charge_analysis ? r.charge_analysis.governing_statute : '') + '\n';
        if (r.inversion_vectors) { prompt += 'Vectors: ' + r.inversion_vectors.map(function(v, i) { return (i + 1) + '. [' + (v.category || '') + '] ' + v.title + ' (' + v.confidence + '%)'; }).join('\n') + '\n'; }
        if (r.tier_conflict_opportunities) prompt += 'Tier Conflicts: ' + r.tier_conflict_opportunities.join('; ') + '\n';
      }
      if (body.additional_input) prompt += '\nAdditional: ' + sanitize(body.additional_input, 5000) + '\n';

      var apiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, system: tool.system, messages: [{ role: 'user', content: prompt }] })
      });
      var apiData = await apiResp.json();
      if (apiData.error) return res.status(502).json({ error: 'Service error: ' + (apiData.error.message || 'Unknown') });

      var txt = ''; if (apiData.content) apiData.content.forEach(function(c) { if (c.type === 'text') txt += c.text; });
      var result; try { result = JSON.parse(txt.replace(/```json|```/g, '').trim()); } catch (e) { result = { raw_response: txt, parse_error: true }; }

      await sb.from('tool_results').insert({ case_id: body.case_id, user_id: userId, tool_type: toolType, input_summary: (cd.charge || '') + ' | ' + tool.label, result: result });

      if (toolType === 'case_strength' && result.overall_score !== undefined) {
        await sb.from('cases').update({ strength_score: result.overall_score, strength_details: result }).eq('id', body.case_id);
      }
      if (toolType === 'attorney_handoff_assessment' && result.handoff_recommended !== undefined) {
        await sb.from('cases').update({ attorney_handoff_recommended: result.handoff_recommended, handoff_reason: result.analysis || '' }).eq('id', body.case_id);
      }

      return res.status(200).json({ tool_type: toolType, label: tool.label, result: result });
    }

    // ===================================================================
    // ACTION: deadlines
    // ===================================================================
    if (action === 'deadlines') {
      if (req.method === 'GET') {
        var caseId = req.query.case_id;
        var q = sb.from('case_deadlines').select('*').eq('user_id', userId);
        if (caseId) q = q.eq('case_id', caseId);
        if (req.query.upcoming === 'true') q = q.gte('deadline_date', new Date().toISOString().split('T')[0]).eq('status', 'active');
        var { data } = await q.order('deadline_date', { ascending: true });
        var now = new Date();
        (data || []).forEach(function(d) {
          var days = Math.ceil((new Date(d.deadline_date) - now) / 86400000);
          d.days_until = days;
          d.urgency = days <= 0 ? 'overdue' : days <= 3 ? 'critical' : days <= 7 ? 'urgent' : days <= 14 ? 'approaching' : 'normal';
        });
        return res.status(200).json({ deadlines: data || [] });
      }

      if (req.method === 'POST') {
        var body = req.body;

        // Auto-extract from analysis
        if (body.extract) {
          if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key not configured' });
          var aR = await sb.from('case_analyses').select('id, result').eq('case_id', body.case_id).eq('user_id', userId).order('version', { ascending: false }).limit(1).single();
          if (!aR.data) return res.status(404).json({ error: 'No analysis found' });
          var cR = await sb.from('cases').select('state,county,charge').eq('id', body.case_id).eq('user_id', userId).single();
          if (!cR.data) return res.status(404).json({ error: 'Case not found' });

          var p = 'Identify ALL critical legal deadlines for this case.\nState: ' + (cR.data.state || '') + '\nCounty: ' + (cR.data.county || '') + '\nCharge: ' + (cR.data.charge || '') + '\n';
          if (aR.data.result && aR.data.result.charge_analysis) p += 'Severity: ' + (aR.data.result.charge_analysis.severity_class || '') + '\nCourt: ' + (aR.data.result.charge_analysis.court_type || '') + '\n';
          if (aR.data.result && aR.data.result.critical_warnings) p += 'Warnings: ' + aR.data.result.critical_warnings.join('; ') + '\n';
          p += '\nReturn ONLY valid JSON array: [{"deadline_type":"speedy_trial|statute_of_limitations|motion_filing|discovery|appeal|arraignment|pretrial|trial|response_due","title":"title","description":"explanation","days_from_charge":number,"jurisdiction_note":"source"}]';

          var dResp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2048, messages: [{ role: 'user', content: p }] }) });
          var dData = await dResp.json();
          var dTxt = ''; if (dData.content) dData.content.forEach(function(c) { if (c.type === 'text') dTxt += c.text; });
          var deadlines = []; try { deadlines = JSON.parse(dTxt.replace(/```json|```/g, '').trim()); } catch (e) { deadlines = []; }

          var inserted = [];
          for (var i = 0; i < deadlines.length; i++) {
            var d = deadlines[i];
            var dd = new Date(); dd.setDate(dd.getDate() + (parseInt(d.days_from_charge) || 30));
            var { data: ins } = await sb.from('case_deadlines').insert({
              case_id: body.case_id, user_id: userId, deadline_type: d.deadline_type || 'custom',
              title: sanitize(d.title || 'Deadline', 200), description: sanitize(d.description || '', 1000),
              deadline_date: dd.toISOString().split('T')[0], source: 'analysis_extracted',
              source_analysis_id: aR.data.id, jurisdiction_note: sanitize(d.jurisdiction_note || '', 500)
            }).select().single();
            if (ins) inserted.push(ins);
          }
          return res.status(200).json({ extracted: inserted.length, deadlines: inserted });
        }

        // Manual creation
        if (!body.case_id || !body.title || !body.deadline_date) return res.status(400).json({ error: 'case_id, title, deadline_date required' });
        var { data, error } = await sb.from('case_deadlines').insert({
          case_id: body.case_id, user_id: userId, deadline_type: body.deadline_type || 'custom',
          title: sanitize(body.title, 200), description: sanitize(body.description || '', 1000),
          deadline_date: body.deadline_date, source: 'user_entered',
          jurisdiction_note: sanitize(body.jurisdiction_note || '', 500)
        }).select().single();
        if (error) throw error;
        return res.status(201).json({ deadline: data });
      }

      if (req.method === 'PATCH') {
        var body = req.body;
        if (!body.id) return res.status(400).json({ error: 'id required' });
        var updates = { updated_at: new Date().toISOString() };
        if (body.status) updates.status = body.status;
        if (body.title) updates.title = sanitize(body.title, 200);
        if (body.deadline_date) updates.deadline_date = body.deadline_date;
        var { data } = await sb.from('case_deadlines').update(updates).eq('id', body.id).eq('user_id', userId).select().single();
        return res.status(200).json({ deadline: data });
      }

      if (req.method === 'DELETE') {
        if (!req.query.id) return res.status(400).json({ error: 'id required' });
        await sb.from('case_deadlines').delete().eq('id', req.query.id).eq('user_id', userId);
        return res.status(200).json({ deleted: true });
      }
    }

    // ===================================================================
    // ACTION: audit-export
    // ===================================================================
    if (action === 'audit-export') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });

      var results = await Promise.all([
        sb.from('user_profiles').select('*').eq('user_id', userId).single(),
        sb.from('cases').select('id,case_number,title,state,county,charge,case_type,status,strength_score,created_at').eq('user_id', userId).order('created_at'),
        sb.from('case_analyses').select('id,case_id,version,input_state,input_county,input_charge,created_at').eq('user_id', userId).order('created_at'),
        sb.from('evidence').select('id,case_id,title,evidence_type,file_name,sha256_hash,created_at').eq('uploaded_by', userId).order('created_at'),
        sb.from('generated_documents').select('id,case_id,document_type,title,completeness_score,verified_citation_count,unverified_citation_count,created_at').eq('user_id', userId).order('created_at'),
        sb.from('case_deadlines').select('id,case_id,deadline_type,title,deadline_date,status,created_at').eq('user_id', userId).order('deadline_date'),
        sb.from('tool_results').select('id,case_id,tool_type,input_summary,created_at').eq('user_id', userId).order('created_at'),
        sb.from('event_logs').select('event_type,metadata,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(500)
      ]);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="inveritas-export-' + new Date().toISOString().split('T')[0] + '.json"');
      return res.status(200).json({
        export_metadata: { exported_at: new Date().toISOString(), user_email: userEmail, platform: 'Inveritas', format_version: '1.0' },
        profile: results[0].data, cases: results[1].data || [], analyses: results[2].data || [],
        evidence: results[3].data || [], generated_documents: results[4].data || [],
        deadlines: results[5].data || [], tool_results: results[6].data || [], activity_log: results[7].data || []
      });
    }

    // ===================================================================
    // ACTION: case-patterns (Firm/Enterprise only)
    // ===================================================================
    if (action === 'case-patterns') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });

      var profR = await sb.from('user_profiles').select('subscription_tier').eq('user_id', userId).single();
      var tier = profR.data ? profR.data.subscription_tier : 'none';
      if (tier !== 'firm' && tier !== 'enterprise') {
        return res.status(403).json({ error: 'Requires Firm or Enterprise subscription.', upgrade_required: true });
      }

      var casesR = await sb.from('cases').select('id,state,county,charge,status,strength_score,attorney_handoff_recommended').eq('user_id', userId);
      var analysesR = await sb.from('case_analyses').select('case_id,version,result').eq('user_id', userId).order('version', { ascending: false });
      var docsR = await sb.from('generated_documents').select('document_type,verified_citation_count,unverified_citation_count').eq('user_id', userId);

      var cases = casesR.data || []; var analyses = analysesR.data || []; var docs = docsR.data || [];
      var latest = {}; analyses.forEach(function(a) { if (!latest[a.case_id]) latest[a.case_id] = a; });

      var p = { total_cases: cases.length, charges: {}, jurisdictions: {}, vector_categories: {}, tier_conflicts: 0, strength: { strong: 0, moderate: 0, weak: 0, unscored: 0 }, handoff_recommended: 0, top_vectors: {}, motion_types: {}, total_verified: 0, total_unverified: 0 };

      cases.forEach(function(c) {
        var ch = (c.charge || 'Unknown').toLowerCase(); p.charges[ch] = (p.charges[ch] || 0) + 1;
        var j = (c.state || 'Unknown') + (c.county ? ', ' + c.county : ''); p.jurisdictions[j] = (p.jurisdictions[j] || 0) + 1;
        if (c.strength_score >= 70) p.strength.strong++; else if (c.strength_score >= 40) p.strength.moderate++; else if (c.strength_score > 0) p.strength.weak++; else p.strength.unscored++;
        if (c.attorney_handoff_recommended) p.handoff_recommended++;
      });

      Object.values(latest).forEach(function(a) {
        if (!a.result) return;
        if (a.result.inversion_vectors) a.result.inversion_vectors.forEach(function(v) {
          var cat = (v.category || 'GENERAL').toUpperCase(); p.vector_categories[cat] = (p.vector_categories[cat] || 0) + 1;
          p.top_vectors[v.title || 'Unknown'] = (p.top_vectors[v.title || 'Unknown'] || 0) + 1;
        });
        if (a.result.tier_conflict_opportunities) p.tier_conflicts += a.result.tier_conflict_opportunities.length;
      });

      docs.forEach(function(d) {
        p.motion_types[d.document_type || 'unknown'] = (p.motion_types[d.document_type || 'unknown'] || 0) + 1;
        p.total_verified += d.verified_citation_count || 0; p.total_unverified += d.unverified_citation_count || 0;
      });

      p.top_vectors = Object.entries(p.top_vectors).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 15).map(function(e) { return { vector: e[0], count: e[1] }; });
      p.charges = Object.entries(p.charges).sort(function(a, b) { return b[1] - a[1]; }).map(function(e) { return { charge: e[0], count: e[1] }; });
      var tc = p.total_verified + p.total_unverified;
      p.avg_verified_rate = tc > 0 ? Math.round((p.total_verified / tc) * 100) : 0;

      return res.status(200).json({ patterns: p });
    }

    // ===================================================================
    // ACTION: attorney-review
    // ===================================================================
    if (action === 'attorney-review') {
      if (req.method === 'GET') {
        var q = sb.from('attorney_review_requests').select('*').eq('user_id', userId);
        if (req.query.case_id) q = q.eq('case_id', req.query.case_id);
        var { data } = await q.order('created_at', { ascending: false });
        return res.status(200).json({ requests: data || [] });
      }

      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
      var body = req.body;
      if (!body.case_id) return res.status(400).json({ error: 'case_id required' });

      var cR = await sb.from('cases').select('state,county,charge').eq('id', body.case_id).eq('user_id', userId).single();
      if (!cR.data) return res.status(404).json({ error: 'Case not found' });

      var { data } = await sb.from('attorney_review_requests').insert({
        case_id: body.case_id, user_id: userId, document_id: body.document_id || null,
        request_type: body.request_type || 'document_review',
        jurisdiction_state: cR.data.state, jurisdiction_county: cR.data.county, charge_type: cR.data.charge,
        urgency: body.urgency || 'standard', budget_range: sanitize(body.budget_range || '', 100),
        notes: sanitize(body.notes || '', 2000), status: 'pending'
      }).select().single();

      await sb.from('admin_audit_log').insert({
        admin_user_id: userId, action: 'attorney_review_requested', entity_type: 'attorney_review_request',
        entity_id: data.id, details: { case_id: body.case_id, type: body.request_type || 'document_review', state: cR.data.state }
      });

      return res.status(201).json({
        request: data,
        message: 'Review request submitted. We will match you with a licensed attorney in your jurisdiction.',
        pricing: { document_review: '$75-$150', full_case_review: '$200-$400', strategy_consultation: '$150-$300' }
      });
    }

    // ===================================================================
    // ACTION: citation-feedback (Attorney Feedback Loop)
    // ===================================================================
    if (action === 'citation-feedback') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
      var body = req.body;
      if (!body.citation_text) return res.status(400).json({ error: 'citation_text required' });

      // Save feedback
      var { data: fb, error: fbErr } = await sb.from('citation_feedback').insert({
        user_id: userId,
        analysis_id: body.analysis_id || null,
        case_id: body.case_id || null,
        citation_text: sanitize(body.citation_text, 500),
        vector_title: sanitize(body.vector_title || '', 500),
        feedback_type: body.feedback_type || 'hallucinated',
        notes: sanitize(body.notes || '', 2000)
      }).select().single();
      if (fbErr) throw fbErr;

      // Also add to blocklist with attorney flag
      await sb.from('citation_blocklist').upsert({
        citation_text: body.citation_text,
        citation_normalized: body.citation_text.toLowerCase().trim(),
        times_flagged: 3,
        last_seen_at: new Date().toISOString(),
        flagged_by_attorney: true,
        attorney_note: body.notes || 'Flagged by user via analysis interface',
        source: 'attorney'
      }, { onConflict: 'citation_text' });

      return res.status(201).json({ feedback: fb, message: 'Citation flagged for review. Thank you.' });
    }

    // No valid action matched
    return res.status(400).json({
      error: 'Invalid action. Use ?action= with one of: verify-citations, tool, deadlines, audit-export, case-patterns, attorney-review, citation-feedback'
    });

  } catch (err) {
    console.error('Platform API error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports.config = { maxDuration: 45 };
