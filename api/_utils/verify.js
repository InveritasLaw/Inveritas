'use strict';

// =====================================================================
// INVERITAS — SHARED CITATION & STATUTE VERIFICATION
// Single source of truth used by BOTH the analysis path (api/analyze.js)
// and the motion-generation path (api/generate-motion.js), so the two
// can never drift. Operator strategy: do not try to eliminate
// hallucination — make it irrelevant by grounding against real data and
// stamping every citation VERIFIED / UNVERIFIED.
//
// SAFETY PRINCIPLE: a fetch/lookup FAILURE never produces a "hallucinated"
// verdict. Failure to confirm => UNVERIFIED ("could not confirm"), never a
// false positive that would wrongly discredit a real citation.
// =====================================================================

// ---------- helpers ----------
function titleCase(s) {
  return String(s).replace(/\w\S*/g, function (t) { return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); });
}
function digitsOnly(s) { return String(s || '').replace(/[^\d.]/g, ''); }

// =====================================================================
// STATUTE REFERENCE EXTRACTION (for real-text injection / grounding)
// Returns an array of { key, code, section, url, state }. The first entry
// is the best/primary guess. URLs are best-effort; a null URL simply means
// "recognized but not auto-groundable" (still safe).
// =====================================================================
function extractStatuteRefs(charge, situation, state) {
  var text = ((charge || '') + ' ' + (situation || '')).toLowerCase();
  var st = (state || '').toLowerCase();
  var refs = [];

  // ---- Texas: explicit section patterns + charge keywords (URLs verified) ----
  if (st === 'texas') {
    var m;
    m = text.match(/(?:texas\s+)?penal\s+code\s*(?:§|sec(?:tion)?\.?\s*)?\s*([\d.]+)/i);
    if (m) refs.push({ key: 'tx-penal-' + m[1], code: 'Penal Code', section: m[1], state: 'Texas', url: 'https://law.justia.com/codes/texas/penal-code/title-10/chapter-' + m[1].split('.')[0] + '/section-' + m[1].replace('.', '-') + '/' });
    m = text.match(/(?:texas\s+)?transp(?:ortation)?\s*code\s*(?:§|sec(?:tion)?\.?\s*)?\s*([\d.]+)/i);
    if (m) refs.push({ key: 'tx-transport-' + m[1], code: 'Transportation Code', section: m[1], state: 'Texas', url: 'https://law.justia.com/codes/texas/transportation-code/title-7/subtitle-c/chapter-' + m[1].split('.')[0] + '/section-' + m[1].replace('.', '-') + '/' });
    m = text.match(/(?:texas\s+)?(?:code\s+of\s+)?crim(?:inal)?\s*proc(?:edure)?\s*(?:art(?:icle)?\.?\s*)?\s*([\d.]+)/i);
    if (m) refs.push({ key: 'tx-ccp-' + m[1], code: 'Code of Criminal Procedure', section: m[1], state: 'Texas', url: null });
    if (text.indexOf('dwi') >= 0 || text.indexOf('driving while intoxicated') >= 0)
      refs.push({ key: 'tx-penal-49.04', code: 'Penal Code', section: '49.04', state: 'Texas', url: 'https://law.justia.com/codes/texas/penal-code/title-10/chapter-49/section-49-04/' });
    if (text.indexOf('speeding') >= 0 || text.indexOf('speed limit') >= 0)
      refs.push({ key: 'tx-transport-545.351', code: 'Transportation Code', section: '545.351', state: 'Texas', url: 'https://law.justia.com/codes/texas/transportation-code/title-7/subtitle-c/chapter-545/section-545-351/' });
    if (text.indexOf('assault') >= 0)
      refs.push({ key: 'tx-penal-22.01', code: 'Penal Code', section: '22.01', state: 'Texas', url: 'https://law.justia.com/codes/texas/penal-code/title-5/chapter-22/section-22-01/' });
    if (text.indexOf('possession') >= 0 && (text.indexOf('marijuana') >= 0 || text.indexOf('thc') >= 0))
      refs.push({ key: 'tx-hsc-481.121', code: 'Health & Safety Code', section: '481.121', state: 'Texas', url: 'https://law.justia.com/codes/texas/health-and-safety-code/title-6/subtitle-c/chapter-481/subchapter-d/section-481-121/' });
    if (text.indexOf('theft') >= 0 || text.indexOf('shoplifting') >= 0)
      refs.push({ key: 'tx-penal-31.03', code: 'Penal Code', section: '31.03', state: 'Texas', url: 'https://law.justia.com/codes/texas/penal-code/title-7/chapter-31/section-31-03/' });
    if (text.indexOf('evading') >= 0)
      refs.push({ key: 'tx-penal-38.04', code: 'Penal Code', section: '38.04', state: 'Texas', url: 'https://law.justia.com/codes/texas/penal-code/title-8/chapter-38/section-38-04/' });
  }

  // ---- Federal: explicit U.S.C. citations (any case) ----
  var f = text.match(/(\d+)\s*u\.?\s*s\.?\s*c\.?\s*(?:§|sec(?:tion)?\.?\s*)?\s*(\d+[a-z\-]*)/i);
  if (f) refs.push({ key: 'usc-' + f[1] + '-' + f[2], code: f[1] + ' U.S.C.', section: f[2], state: 'Federal', url: 'https://www.law.cornell.edu/uscode/text/' + f[1] + '/' + f[2] });

  // ---- Generic: any "<...> Code § <num>" the user typed (recognition only) ----
  var g = text.match(/([a-z][a-z &]{2,40}?code)\s*(?:§|sec(?:tion)?\.?\s*|art(?:icle)?\.?\s*)?\s*(\d+[\dA-Za-z.\-]*)/i);
  if (g) {
    var gkey = st + '-' + g[1].replace(/\s+/g, '') + '-' + g[2];
    if (!refs.some(function (r) { return r.key === gkey; })) {
      refs.push({ key: gkey, code: titleCase(g[1]), section: g[2], state: state || 'Unknown', url: null });
    }
  }

  // de-dupe by key
  var seen = {};
  return refs.filter(function (r) { if (seen[r.key]) return false; seen[r.key] = 1; return true; });
}

// =====================================================================
// FETCH + CACHE official statute text (best effort). Returns '' on any
// failure — callers must treat '' as "ungrounded", never as a flag.
// =====================================================================
async function fetchStatuteText(ref, sbAdmin) {
  if (!ref || !ref.url) return '';
  try {
    if (sbAdmin) {
      var cached = await sbAdmin.from('statute_cache')
        .select('full_text').eq('statute_key', ref.key)
        .gt('expires_at', new Date().toISOString()).single();
      if (cached && cached.data && cached.data.full_text) return cached.data.full_text;
    }
    var resp = await fetch(ref.url, { headers: { 'User-Agent': 'Inveritas Legal Research/1.0' } });
    if (!resp.ok) return '';
    var html = await resp.text();
    var match = html.match(/<div[^>]*class="[^"]*codes-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || html.match(/<div[^>]*id="[^"]*codes-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || html.match(/<div[^>]*class="[^"]*primary-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (!match) return '';
    var clean = match[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (clean && sbAdmin) {
      await sbAdmin.from('statute_cache').upsert({
        statute_key: ref.key, state: ref.state, code_name: ref.code, section: ref.section,
        full_text: clean, source_url: ref.url, fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString()
      });
    }
    return clean;
  } catch (e) { return ''; }
}

// =====================================================================
// CASE-LAW CITATION VERIFICATION via CourtListener (real database).
// Returns { verified:[], notFound:[], links:{}, raw:[] }.
// =====================================================================
async function verifyCaseCitations(text, clToken) {
  var out = { verified: [], notFound: [], links: {}, raw: [] };
  if (!clToken || !text) return out;
  try {
    var resp = await fetch('https://www.courtlistener.com/api/rest/v4/citation-lookup/', {
      method: 'POST',
      headers: { 'Authorization': 'Token ' + clToken, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'text=' + encodeURIComponent(String(text).slice(0, 30000))
    });
    if (resp.ok) {
      var results = await resp.json();
      if (Array.isArray(results)) {
        out.raw = results;
        results.forEach(function (c) {
          if (c.status === 200) {
            out.verified.push(c.citation);
            if (c.clusters && c.clusters[0]) {
              out.links[c.citation] = {
                url: 'https://www.courtlistener.com' + (c.clusters[0].absolute_url || ''),
                case_name: c.clusters[0].case_name || c.citation,
                court: c.clusters[0].court || ''
              };
            }
          } else if (c.status === 404) {
            out.notFound.push(c.citation);
          }
        });
      }
    }
  } catch (e) { /* network — leave as-is (no false flags) */ }

  // Also verify "X v. Y" case names not caught by formal citation lookup
  try {
    var re = /([A-Z][A-Za-z'.]+(?:\s+(?:of|ex\s+rel\.|&)\s+[A-Z][A-Za-z'.]+)*)\s+v\.?\s+([A-Z][A-Za-z'.]+(?:\s+(?:of|ex\s+rel\.|&)\s+[A-Z][A-Za-z'.]+)*)/g;
    var names = new Set(), mm;
    while ((mm = re.exec(text)) !== null) names.add(mm[0].trim());
    var done = 0;
    for (var name of names) {
      if (out.verified.some(function (vc) { return vc.toLowerCase().indexOf(name.split(' v')[0].trim().toLowerCase()) >= 0; })) continue;
      if (done >= 10) break;
      try {
        var sResp = await fetch('https://www.courtlistener.com/api/rest/v4/search/?q=' + encodeURIComponent('"' + name + '"') + '&type=o&page_size=1',
          { headers: { 'Authorization': 'Token ' + clToken } });
        if (sResp.ok) {
          var sData = await sResp.json();
          if (sData.count > 0) {
            out.verified.push(name);
            if (!out.links[name]) out.links[name] = { url: 'https://www.courtlistener.com/?q=' + encodeURIComponent(name) + '&type=o', case_name: name };
          } else { out.notFound.push(name); }
        }
        done++;
        await new Promise(function (r) { setTimeout(r, 150); });
      } catch (e) { /* skip */ }
    }
  } catch (e) { /* non-fatal */ }

  return out;
}

// =====================================================================
// STATUTE CITATION EXTRACTION + GROUNDING STAMP
// Finds statutory section references in generated text and stamps each
// GROUNDED (appears in fetched official text) or UNVERIFIED (could not
// confirm). Never emits a false "hallucinated" verdict.
// =====================================================================
function extractStatuteCitations(text) {
  if (!text) return [];
  var found = new Set();
  var patterns = [
    /\b\d+\s*U\.?\s*S\.?\s*C\.?\s*(?:§|Section)?\s*\d+[A-Za-z\-]*/g,            // 18 U.S.C. § 922
    /\b(?:[A-Z][A-Za-z.]*\s+){0,4}Code\s*(?:Ann\.?\s*)?(?:§|Section|art\.?|Article)?\s*\d+[\dA-Za-z.\-]*/g, // Tex. Penal Code § 49.04
    /§+\s*\d+[\dA-Za-z.\-]*/g                                                   // bare § 49.04
  ];
  patterns.forEach(function (p) {
    var m; while ((m = p.exec(text)) !== null) { var s = m[0].replace(/\s+/g, ' ').trim(); if (s.length <= 60) found.add(s); }
  });
  return Array.from(found);
}

function stampStatuteCitations(citations, groundedText) {
  var gt = (groundedText || '').toLowerCase();
  return (citations || []).map(function (c) {
    var sec = digitsOnly(c);
    var grounded = gt && sec && gt.indexOf(sec) >= 0;
    return {
      citation: c,
      status: grounded ? 'GROUNDED' : 'UNVERIFIED',
      note: grounded
        ? 'Section confirmed present in official statute text fetched for this charge.'
        : 'Could not confirm against official source — verify this section number independently before relying on it.'
    };
  });
}

// =====================================================================
// HALLUCINATION BLOCKLIST — shared across both paths. Adds not-found
// citations and returns the set of citations flagged 3+ times.
// =====================================================================
async function checkAndUpdateBlocklist(sbAdmin, notFoundList) {
  if (!sbAdmin) return [];
  try {
    for (var i = 0; i < (notFoundList || []).length; i++) {
      var nfc = notFoundList[i];
      await sbAdmin.from('citation_blocklist').upsert({
        citation_text: nfc, citation_normalized: nfc.toLowerCase().trim(),
        times_flagged: 1, last_seen_at: new Date().toISOString(), source: 'auto'
      }, { onConflict: 'citation_text' });
      await sbAdmin.rpc('increment_blocklist_count', { p_citation: nfc }).catch(function () {});
    }
    var blocked = await sbAdmin.from('citation_blocklist').select('citation_text').gte('times_flagged', 3);
    return (blocked && blocked.data) ? blocked.data.map(function (b) { return b.citation_text; }) : [];
  } catch (e) { return []; }
}

module.exports = {
  extractStatuteRefs: extractStatuteRefs,
  fetchStatuteText: fetchStatuteText,
  verifyCaseCitations: verifyCaseCitations,
  extractStatuteCitations: extractStatuteCitations,
  stampStatuteCitations: stampStatuteCitations,
  checkAndUpdateBlocklist: checkAndUpdateBlocklist
};
