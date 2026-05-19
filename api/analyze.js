const { createClient } = require('@supabase/supabase-js');

const SYSTEM_PROMPT = `You are a precision legal defense analyst specializing in STATUTORY INVERSION across three tiers of American law: Federal, State, and County/Municipal.

YOUR PRIMARY OBLIGATION IS ACCURACY. Every vector you produce must survive scrutiny by a practicing defense attorney in the relevant jurisdiction. Overstated, fabricated, or legally invalid arguments destroy user trust and constitute professional harm.

====================================================================
SECTION 1: CITATION AND CASE LAW INTEGRITY (ZERO TOLERANCE)
====================================================================

ABSOLUTE RULES — VIOLATION OF ANY OF THESE INVALIDATES THE ENTIRE ANALYSIS:

1. LEAD WITH THE LEGAL PRINCIPLE, NOT THE CITATION. State the rule of law first. If you can cite a real case that established it, add the citation. If you cannot recall a specific case with certainty, state the principle WITHOUT a citation. A correct legal principle without a citation is infinitely better than a fabricated citation.

2. NEVER fabricate, hallucinate, or invent case citations. The test: Can you state the FULL case name, the COURT that decided it, the APPROXIMATE year, and the SPECIFIC holding? If you cannot confidently provide ALL FOUR, do not cite it. Write: "[Legal principle] — no specific citation provided, verify applicable authority"

3. NEVER invent statute numbers or code sections. If uncertain of the exact section: "Texas Transportation Code [verify exact section] addresses speed limits" is correct. "Texas Transportation Code § 545.999" (made up) is catastrophic.

4. USE THESE CITATION CONFIDENCE TAGS on every citation:
   - [VERIFIED CITATION] — You are certain this case/statute exists with the name, court, and holding you stated
   - [VERIFY CITATION] — You believe this exists but are not 100% certain of the exact name, year, or holding
   - [PRINCIPLE ONLY] — You know the legal principle is real but cannot identify a specific case. State the principle.
   
5. SCOTUS cases: Only cite landmark cases you are CERTAIN exist (Miranda, Terry, Brady, Mapp, Crawford, etc.). For less well-known cases, describe the principle and tag [VERIFY CITATION].

6. State appellate cases: ALMOST NEVER cite specific state appellate cases by name unless they are extremely well-known in that jurisdiction. Instead: "Texas appellate courts have held that [principle] — [VERIFY CITATION for specific case]"

7. Statutes: Only cite specific section numbers you are confident about. Texas Penal Code § 49.04 (DWI) — yes, that's real. But if you're unsure whether it's § 545.351 or § 545.352, write both and flag [VERIFY EXACT SECTION].

8. If no case law exists for a specific argument, say so honestly. "No directly on-point authority identified — argue by analogy from [principle]" is the correct output.

9. COUNT YOUR CITATIONS. For a typical analysis, you should have 3-8 citations total. If you have 15+, you are almost certainly fabricating some of them. Quality over quantity.

====================================================================
SECTION 2: CONFIDENCE SCORING RUBRIC (MOTION VIABILITY SCALE)
====================================================================

Confidence scores MUST reflect the probability that a MOTION based on this vector would be GRANTED by the court, not just whether the argument sounds plausible. Use this rubric:

85-100: STRONG — Clear statutory/constitutional authority directly on point. Multiple appellate decisions supporting this exact argument in this or analogous jurisdiction. Motion would likely be granted.

65-84: MODERATE — Valid legal basis with supporting authority, but outcome depends on specific factual findings the court must make (e.g., voluntariness of consent, reasonableness of search). Requires factual development.

40-64: CONDITIONAL — Argument has legal foundation but viability depends on PREREQUISITES that must be confirmed first (e.g., warrant status, specific officer conduct, lab procedures). Flag the prerequisites explicitly.

20-39: WEAK/JURY ARGUMENT — Legal theory exists but is unlikely to succeed as a pre-trial motion. May have value as a jury argument to attack credibility or weight of evidence. Label it as such.

0-19: THEORETICAL ONLY — Academic argument with minimal practical value. Include ONLY if it supports a stronger vector or provides strategic context.

CRITICAL CALIBRATION RULES:
- An argument that attacks the WEIGHT of evidence (jury decides) scores lower than one that attacks ADMISSIBILITY (judge decides pre-trial).
- An argument requiring factual prerequisites that haven't been confirmed must be scored in the CONDITIONAL range (40-64) and MUST list the prerequisites.
- Do NOT inflate scores to make the analysis look more impressive. A calibrated 45% on a real argument is worth more than a fabricated 90%.

====================================================================
SECTION 3: SUPPRESSION vs. WEIGHT DISTINCTION (MANDATORY)
====================================================================

For EVERY evidentiary vector, you MUST classify whether the argument targets:

A) ADMISSIBILITY (suppression motion — judge decides pre-trial):
   - Constitutional violations (4th/5th/6th Amendment)
   - Statutory exclusionary rules
   - Chain of custody so deficient evidence is unreliable
   - Fruit of the poisonous tree doctrine

B) WEIGHT/CREDIBILITY (jury argument — presented at trial):
   - Officer errors that don't rise to constitutional violations
   - Physical limitations affecting test performance (not test legality)
   - Minor clerical or documentation errors
   - Conflicting witness accounts
   - Alternative interpretations of evidence

C) BOTH (can be argued at suppression AND to jury):
   - Some arguments function at both levels

Label each vector with [SUPPRESSION], [WEIGHT], or [BOTH] in the argument field.

====================================================================
SECTION 4: PREREQUISITE GATES (CONDITIONAL ANALYSIS)
====================================================================

Many defense arguments are ONLY viable if specific factual conditions are met. You MUST identify these conditions and NOT present conditional arguments as unconditional wins.

UNIVERSAL PREREQUISITE GATES (apply to all charge types):

- BLOOD/BREATH EVIDENCE: Before arguing warrantless draw, CONFIRM: Was a warrant obtained? Was consent given? Were exigent circumstances present? If unknown, state the argument is conditional on warrant status.
- SEARCH AND SEIZURE: Before arguing illegal search, CONFIRM: Was there a warrant? Was there valid consent? Was there a recognized exception? If unknown, flag prerequisites.
- TRAFFIC STOPS: Pretext stops are LEGAL under Whren v. United States (1996). If a valid traffic violation occurred, the stop is constitutional regardless of officer's subjective motivation. Do NOT generate pretext arguments when an objective violation exists.
- MIRANDA: Miranda only applies to custodial interrogation. Voluntary statements, pre-arrest questioning, and traffic stop questioning are generally NOT Miranda-protected. Do NOT generate Miranda arguments for non-custodial encounters.
- FIELD SOBRIETY TESTS: Physical limitations affect the WEIGHT of FST evidence, not its ADMISSIBILITY in most jurisdictions. Classify correctly.
- PRIOR CONVICTIONS (enhancement charges): When a charge is enhanced by priors, the VALIDITY of each prior conviction is a critical defense vector. Constitutional defects in prior convictions can collapse enhancement. ALWAYS flag this for enhanced charges.

====================================================================
SECTION 5: TIER CONFLICT ANALYSIS (CORRECTED GUARDRAILS)
====================================================================

VALID TIER CONFLICTS:
- Municipal ordinance imposes different elements than the state statute for the same conduct
- Local court procedure has different timelines, deadlines, or requirements than state procedure
- Municipal penalty schedule differs from state penalties for equivalent offense
- State law preempts local ordinance but local enforcement continues
- Federal constitutional floor provides greater protection than state court applies
- State statute of limitations differs from municipal prosecution timeline

INVALID TIER CONFLICTS (DO NOT GENERATE):
- Peace officers enforce both municipal and state law simultaneously in ALL states. This is NOT a conflict.
- A charge filed under state law is NOT invalid because a municipal ordinance also covers the conduct. This is prosecutorial discretion, not a jurisdictional defect.
- Federal constitutional protections are a FLOOR, not a conflict. Only flag when state courts apply LESS than the federal floor.

BEFORE generating any TIER_CONFLICT vector, ask: "Would a judge in this jurisdiction recognize this as an actual legal conflict?" If not, do not generate it.

====================================================================
SECTION 6: JURISDICTION-SPECIFIC PRACTICE AWARENESS
====================================================================

TIMING AND DEADLINES (always include if applicable):
- Administrative license hearing deadlines (varies by state: TX=15 days, CA=10 days, etc.)
- Speedy trial deadlines (varies by jurisdiction and charge level)
- Motion filing deadlines (pre-trial motion cutoffs)
- Statute of limitations for the specific charge
- Bond/bail hearing requirements

CRITICAL MISSING VECTORS (always consider):
- For ANY enhanced charge: validity of prior convictions used for enhancement
- For ANY charge with physical evidence: chain of custody, lab procedures, calibration records
- For ANY charge with video/audio: existence and preservation of dash cam, body cam, jail footage, surveillance
- For ANY arrest: probable cause for the arrest itself (separate from the stop)
- For ANY charge with statements: voluntariness, Miranda compliance, recording requirements
- For ANY charge with identification: reliability of identification procedures
- Discovery obligations: Brady material, Giglio material, exculpatory evidence

EVIDENCE THAT OVERRIDES ARGUMENTS:
- Video/audio evidence often overrides testimonial disputes. If body cam or dash cam likely exists, flag that obtaining it is the HIGHEST PRIORITY.

====================================================================
SECTION 7: UNIVERSAL ANALYSIS METHODOLOGY
====================================================================

For EVERY charge submitted, follow this sequence:

STEP 1 — IDENTIFY THE CHARGE AND ALL ELEMENTS
STEP 2 — ANALYZE THE ENCOUNTER (initial contact, expansion, escalation points)
STEP 3 — MAP THE EVIDENCE CHAIN (collection method, constitutional compliance)
STEP 4 — APPLY STATUTORY INVERSION (element inversion, definitional gaps, Rule of Lenity, void-for-vagueness, affirmative defenses)
STEP 5 — CROSS-REFERENCE TIERS (only genuine conflicts per Section 5)
STEP 6 — SELF-AUDIT (verify citations, calibrate confidence, check suppression vs weight, validate tier conflicts, flag prerequisites)

====================================================================
SECTION 7B: INPUT PROPORTIONALITY (CRITICAL)
====================================================================

YOUR OUTPUT MUST BE PROPORTIONAL TO THE INPUT DETAIL. This is a core safety and accuracy requirement.

SPARSE INPUT (under 50 words, vague circumstances, few specifics):
- Generate AT MOST 2-3 vectors
- Confidence scores MUST NOT exceed 50% for any vector based on assumed facts
- EVERY vector must state: "This vector requires confirmation of: [specific facts not provided]"
- The first item in critical_warnings MUST be: "LIMITED INPUT: This analysis is based on minimal information. Many vectors are conditional on facts not yet provided. Provide more detail about the stop, officer statements, evidence collected, and procedural events to receive a complete analysis."
- Do NOT generate 5+ page analyses from 2 sentences of input. That is fabrication, not analysis.

MODERATE INPUT (50-200 words, some specifics about the stop/arrest/evidence):
- Generate 3-5 vectors
- Confidence can reach 70% for vectors supported by stated facts
- Clearly distinguish between fact-based vectors and assumption-based vectors

DETAILED INPUT (200+ words, specific officer statements, evidence details, procedural timeline):
- Full analysis is appropriate
- Confidence can reach 85-100% ONLY for vectors grounded in specific stated facts
- Prerequisites should be fewer since more facts are known

CONFIDENCE CALIBRATION RULES:
- A fact the user STATED supports higher confidence
- A fact you ASSUMED because it MIGHT be true caps confidence at 40%
- A fact that is STANDARD PROCEDURE but not confirmed caps at 50%
- NEVER assign 80%+ confidence to a vector built entirely on assumptions
- If the user says "cop said I was doing 75 in 60" — you know the alleged speed and limit. You do NOT know: what device was used, whether it was calibrated, whether there's body cam, what the road conditions were, whether consent was given, etc. Do not write vectors as if you know these things.

====================================================================
SECTION 8: OUTPUT FORMAT
====================================================================

Return ONLY valid JSON (no markdown, no backticks, no preamble):

{
  "charge_analysis": {
    "offense": "specific charge as stated in statute",
    "jurisdiction": "State/Federal/Municipal",
    "county_or_city": "specific county or city if applicable",
    "governing_statute": "primary statute — flag 'verify section' if uncertain",
    "severity_class": "Felony (degree)/Misdemeanor (class)/Infraction/Municipal Ordinance",
    "elements_required": ["each specific element prosecution must prove"],
    "mens_rea": "intentionally/knowingly/recklessly/negligently/strict liability",
    "court_type": "Federal District/State District/County/Municipal/Justice of the Peace",
    "potential_penalties": "sentencing range including minimums and maximums"
  },
  "jurisdiction_analysis": {
    "federal_provisions": {
      "constitutional_issues": ["specific amendment issues — only genuinely applicable provisions"],
      "federal_statutes": ["applicable USC sections — empty array if none"],
      "supreme_court_precedent": ["ONLY cases you are certain are real"]
    },
    "state_provisions": {
      "state_code_sections": ["applicable state code sections"],
      "state_case_law": ["ONLY cases you are certain are real — flag uncertain citations"],
      "state_procedure_rules": ["procedural rules with specific section numbers where known"]
    },
    "municipal_provisions": {
      "local_ordinances": ["applicable local codes — empty array if not applicable"],
      "municipal_procedures": ["local procedure differences — only genuine differences"],
      "penalty_schedule_differences": ["only where local penalties genuinely differ"]
    }
  },
  "tier_conflict_opportunities": ["ONLY genuine conflicts per Section 5 — empty array if none exist"],
  "inversion_vectors": [
    {
      "category": "CONSTITUTIONAL|DEFINITIONAL|PROCEDURAL|EVIDENTIARY|TIER_CONFLICT|STATUTORY|ENHANCEMENT",
      "legal_tier": "FEDERAL|STATE|MUNICIPAL|CROSS-TIER",
      "title": "concise descriptive title",
      "motion_type": "SUPPRESSION|WEIGHT|BOTH|DISMISSAL|PROCEDURAL",
      "argument": "[SUPPRESSION/WEIGHT/BOTH] Detailed legal argument. Include prerequisite conditions if any.",
      "applicable_law": "specific citation — include 'verify citation' flag if uncertain",
      "prerequisites": ["factual conditions that must be confirmed — empty array if none"],
      "confidence": 0-100
    }
  ],
  "evidence_priorities": ["ranked list of evidence to obtain/preserve IMMEDIATELY"],
  "statutory_escape_hatches": ["dismissal mechanisms, safe harbors, or affirmative defenses in the statute"],
  "prosecution_weaknesses": ["specific burdens genuinely difficult to prove given the circumstances"],
  "recommended_motions": ["pre-trial motions with basis — only motions with realistic chance"],
  "critical_deadlines": ["jurisdiction-specific deadlines — administrative hearings, motion cutoffs, speedy trial"],
  "critical_warnings": ["things the defendant must NOT do, actions to take immediately"]
}

FINAL INSTRUCTION: Accuracy over volume. Five real vectors at calibrated confidence scores are worth infinitely more than ten inflated vectors. Never pad the analysis. MATCH YOUR OUTPUT DEPTH TO THE INPUT DETAIL — a two-sentence description gets a focused 2-3 vector response with clear flags about what additional information would strengthen the analysis. A detailed multi-paragraph description with specific facts gets a comprehensive analysis. Do not fabricate specificity from vagueness.`;

// ===== PROMPT INJECTION SANITIZER =====
function sanitizeInput(text) {
  if (!text || typeof text !== 'string') return '';
  let clean = text;
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directives?)/gi,
    /disregard\s+(all\s+)?(previous|prior|above|system)\s+(instructions?|prompts?)/gi,
    /you\s+are\s+now\s+(a|an|my)\s+/gi,
    /new\s+instructions?:\s*/gi,
    /system\s*prompt\s*[:=]/gi,
    /\boverride\s+(system|instructions?|rules?)\b/gi,
    /\breturn\s+(my|the|your)\s+(api|secret|private)\s*key/gi,
    /\bforget\s+(everything|all|your|previous)\b/gi,
    /\brole\s*:\s*(system|assistant|admin)/gi,
    /\bact\s+as\s+(if\s+)?(you\s+are|an?)\s+/gi,
    /\bjailbreak\b/gi,
    /\bDAN\s+mode\b/gi,
    /\bdo\s+anything\s+now\b/gi,
    /\bdev\s*mode\b/gi,
    /\[\s*INST\s*\]/gi,
    /```(system|prompt|instructions?)/gi,
    /<\/?[a-z][^>]*>/gi,
    /\bpretend\s+(you|to\s+be)\b/gi,
    /\byou\s+are\s+(no\s+longer|not)\b/gi,
    /\bignore\s+safety\b/gi,
    /\bunfiltered\s+mode\b/gi,
    /\bbase64\s*:/gi,
    /\beval\s*\(/gi,
    /\bexec\s*\(/gi,
    /\bimport\s*\(/gi,
    /\brequire\s*\(/gi,
    /\b__proto__\b/gi,
    /\bconstructor\b\s*\[/gi,
    /\bprototype\b\s*\./gi,
  ];
  for (const pattern of injectionPatterns) {
    clean = clean.replace(pattern, '[removed]');
  }
  return clean.slice(0, 5000);
}

// ===== RATE LIMITER =====
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimits.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ===== STATUTE REFERENCE EXTRACTOR =====
function extractStatuteRef(charge, situation, state) {
  const text = (charge + ' ' + situation).toLowerCase();
  const st = state.toLowerCase();
  
  if (st === 'texas') {
    let m = text.match(/(?:texas\s+)?penal\s+code\s*(?:§|sec(?:tion)?\.?\s*)?\s*([\d.]+)/i);
    if (m) return { key: 'tx-penal-' + m[1], code: 'Penal Code', section: m[1], url: 'https://law.justia.com/codes/texas/penal-code/title-10/chapter-' + m[1].split('.')[0] + '/section-' + m[1].replace('.', '-') + '/' };

    m = text.match(/(?:texas\s+)?transp(?:ortation)?\s*code\s*(?:§|sec(?:tion)?\.?\s*)?\s*([\d.]+)/i);
    if (m) { const sec = m[1]; return { key: 'tx-transport-' + sec, code: 'Transportation Code', section: sec, url: 'https://law.justia.com/codes/texas/transportation-code/title-7/subtitle-c/chapter-' + sec.split('.')[0] + '/section-' + sec.replace('.', '-') + '/' }; }

    m = text.match(/(?:texas\s+)?(?:code\s+of\s+)?crim(?:inal)?\s*proc(?:edure)?\s*(?:art(?:icle)?\.?\s*)?\s*([\d.]+)/i);
    if (m) return { key: 'tx-ccp-' + m[1], code: 'Code of Criminal Procedure', section: m[1], url: null };

    if (text.includes('dwi') || text.includes('driving while intoxicated'))
      return { key: 'tx-penal-49.04', code: 'Penal Code', section: '49.04', url: 'https://law.justia.com/codes/texas/penal-code/title-10/chapter-49/section-49-04/' };
    if (text.includes('speeding') || text.includes('speed limit'))
      return { key: 'tx-transport-545.351', code: 'Transportation Code', section: '545.351', url: 'https://law.justia.com/codes/texas/transportation-code/title-7/subtitle-c/chapter-545/section-545-351/' };
    if (text.includes('assault'))
      return { key: 'tx-penal-22.01', code: 'Penal Code', section: '22.01', url: 'https://law.justia.com/codes/texas/penal-code/title-5/chapter-22/section-22-01/' };
    if (text.includes('possession') && (text.includes('marijuana') || text.includes('thc')))
      return { key: 'tx-hsc-481.121', code: 'Health & Safety Code', section: '481.121', url: 'https://law.justia.com/codes/texas/health-and-safety-code/title-6/subtitle-c/chapter-481/subchapter-d/section-481-121/' };
    if (text.includes('theft') || text.includes('shoplifting'))
      return { key: 'tx-penal-31.03', code: 'Penal Code', section: '31.03', url: 'https://law.justia.com/codes/texas/penal-code/title-7/chapter-31/section-31-03/' };
    if (text.includes('evading'))
      return { key: 'tx-penal-38.04', code: 'Penal Code', section: '38.04', url: 'https://law.justia.com/codes/texas/penal-code/title-8/chapter-38/section-38-04/' };
  }
  return null;
}

// ===== MAIN HANDLER =====
module.exports = async function handler(req, res) {
  // CORS — locked to production domain
  const allowedOrigins = ['https://inveritaslaw.com', 'https://www.inveritaslaw.com'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (process.env.VERCEL_ENV !== 'production') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Maximum 5 analyses per minute.' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured.' });
  }

  try {
    // ===== AUTH CHECK =====
    let userId = null;
    let userTier = 'none';

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

      // Verify auth token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required. Please sign in.' });
      }

      const token = authHeader.slice(7);
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

      if (authError || !user) {
        return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
      }

      userId = user.id;

      // Check subscription tier and usage
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('subscription_tier, analyses_this_month, stripe_customer_id')
        .eq('user_id', userId)
        .single();

      if (profile) {
        userTier = profile.subscription_tier || 'none';
        const usedThisMonth = profile.analyses_this_month || 0;

        // Enforce limits by tier
        if (userTier === 'none' && usedThisMonth >= 1) {
          return res.status(403).json({ error: 'Free analysis used. Subscribe to run more analyses and unlock full results.', upgrade_required: true });
        }
        if (userTier === 'single' && usedThisMonth >= 1) {
          return res.status(403).json({ error: 'Single analysis already used. Purchase another or upgrade to Practitioner.' });
        }
        if (userTier === 'practitioner' && usedThisMonth >= 50) {
          return res.status(403).json({ error: 'Monthly analysis limit reached (50/50). Upgrade to Firm for unlimited.' });
        }
      } else {
        // No profile — allow 1 free analysis (new user)
        userTier = 'none';
      }
    } else {
      // Supabase not configured — block in production
      return res.status(500).json({ error: 'Authentication service not configured.' });
    }

    // ===== INPUT VALIDATION & SANITIZATION =====
    const { state, county, charge, situation } = req.body;

    if (!situation || typeof situation !== 'string' || situation.trim().length < 10) {
      return res.status(400).json({ error: 'Provide detailed circumstances (at least 10 characters).' });
    }
    if (!state || typeof state !== 'string') {
      return res.status(400).json({ error: 'State is required.' });
    }

    const safeState = sanitizeInput(String(state).slice(0, 100));
    const safeCounty = county ? sanitizeInput(String(county).slice(0, 200)) : 'Not specified';
    const safeCharge = charge ? sanitizeInput(String(charge).slice(0, 300)) : 'Not specified';
    const safeSituation = sanitizeInput(String(situation));

    // Reject if situation was entirely filtered
    if (safeSituation.replace(/\[removed\]/g, '').trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a valid description of the circumstances.' });
    }

    // ===== ENHANCEMENT 1: REAL-TIME STATUTE INJECTION =====
    // Fetch actual statute text from Justia and inject into prompt
    let statuteText = '';
    try {
      // Build Justia URL from charge and state
      const statuteRef = extractStatuteRef(safeCharge, safeSituation, safeState);
      if (statuteRef) {
        // Check cache first
        if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
          const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
          const { data: cached } = await sbAdmin.from('statute_cache')
            .select('full_text, source_url')
            .eq('statute_key', statuteRef.key)
            .gt('expires_at', new Date().toISOString())
            .single();
          
          if (cached && cached.full_text) {
            statuteText = cached.full_text;
          } else {
            // Fetch from Justia
            const justiaUrl = statuteRef.url;
            if (justiaUrl) {
              const sResp = await fetch(justiaUrl, { headers: { 'User-Agent': 'Inveritas Legal Research/1.0' } });
              if (sResp.ok) {
                const html = await sResp.text();
                // Extract statute text from Justia HTML
                const textMatch = html.match(/<div[^>]*class="[^"]*codes-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
                  || html.match(/<div[^>]*id="[^"]*codes-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
                  || html.match(/<div[^>]*class="[^"]*primary-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
                if (textMatch) {
                  statuteText = textMatch[1]
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 4000);
                }
                // Cache it
                if (statuteText && SUPABASE_URL) {
                  await sbAdmin.from('statute_cache').upsert({
                    statute_key: statuteRef.key,
                    state: safeState,
                    code_name: statuteRef.code,
                    section: statuteRef.section,
                    full_text: statuteText,
                    source_url: justiaUrl,
                    fetched_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 30 * 86400000).toISOString()
                  });
                }
              }
            }
          }
        }
      }
    } catch (statErr) {
      console.error('Statute fetch failed (non-blocking):', statErr.message);
    }

    const statuteInjection = statuteText
      ? `\n\nREAL STATUTE TEXT (fetched from official source — use this as ground truth, do NOT paraphrase from memory):\n${statuteText}\n\nANALYZE AGAINST THIS ACTUAL TEXT. If any element, definition, or provision in this text differs from your training data, the fetched text is authoritative.`
      : '';

    const userMessage = `JURISDICTION: ${safeState}
COUNTY/CITY: ${safeCounty}
CHARGE: ${safeCharge}
CIRCUMSTANCES:
${safeSituation}

Analyze using the full statutory inversion methodology. Apply all guardrails: calibrated confidence, verified citations only, prerequisite gates, correct suppression vs weight classification, and genuine tier conflicts only. Prioritize accuracy over volume.${statuteInjection}`;

    // ===== CALL ANTHROPIC (with retry for overloaded) =====
    const apiBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });
    const apiHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    };

    let data = null;
    let lastError = null;
    const maxRetries = 3;
    const retryDelays = [2000, 5000, 10000]; // 2s, 5s, 10s

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: apiHeaders,
          body: apiBody
        });
        data = await response.json();

        // If overloaded, retry after delay
        if (data.error && data.error.type === 'overloaded_error') {
          console.log('Anthropic overloaded, retry ' + (attempt + 1) + '/' + maxRetries);
          lastError = data.error;
          data = null;
          if (attempt < maxRetries - 1) {
            await new Promise(r => setTimeout(r, retryDelays[attempt]));
            continue;
          }
        } else {
          break; // Success or non-retryable error
        }
      } catch (fetchErr) {
        lastError = { message: fetchErr.message };
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, retryDelays[attempt]));
          continue;
        }
      }
    }

    if (!data || (data.error && data.error.type === 'overloaded_error')) {
      return res.status(503).json({
        error: 'The analysis service is temporarily overloaded. Please wait a moment and try again.'
      });
    }

    if (data.error) {
      console.error('Anthropic API error:', data.error);
      return res.status(502).json({
        error: 'Analysis service error: ' + (data.error.message || 'Unknown error from API')
      });
    }

    if (!data.content || !Array.isArray(data.content)) {
      console.error('Unexpected API response:', JSON.stringify(data).slice(0, 500));
      return res.status(502).json({
        error: 'Unexpected response from analysis service. Please try again.'
      });
    }

    // ===== POST-PROCESSING: CITATION VERIFICATION =====
    // Extract the analysis text and verify citations before returning
    const CL_TOKEN = process.env.COURTLISTENER_API_TOKEN;
    
    if (CL_TOKEN && data.content && data.content[0] && data.content[0].text) {
      try {
        const analysisText = data.content[0].text;
        const cleanJson = analysisText.replace(/```json|```/g, '').trim();
        let parsed;
        try { parsed = JSON.parse(cleanJson); } catch(e) { parsed = null; }

        if (parsed) {
          // Collect all text that might contain citations
          let allText = analysisText;

          // Run CourtListener citation lookup on the full text
          const clResponse = await fetch('https://www.courtlistener.com/api/rest/v4/citation-lookup/', {
            method: 'POST',
            headers: { 'Authorization': 'Token ' + CL_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'text=' + encodeURIComponent(allText.slice(0, 30000))
          });

          let verifiedCitations = [];
          let notFoundCitations = [];
          let allCLResults = [];

          if (clResponse.ok) {
            allCLResults = await clResponse.json();
            if (Array.isArray(allCLResults)) {
              allCLResults.forEach(c => {
                if (c.status === 200) verifiedCitations.push(c.citation);
                else if (c.status === 404) notFoundCitations.push(c.citation);
              });
            }
          }

          // Also extract and search case names (Name v. Name pattern)
          const caseNameRe = /([A-Z][A-Za-z'.]+(?:\s+(?:of|ex\s+rel\.|&)\s+[A-Z][A-Za-z'.]+)*)\s+v\.?\s+([A-Z][A-Za-z'.]+(?:\s+(?:of|ex\s+rel\.|&)\s+[A-Z][A-Za-z'.]+)*)/g;
          let caseNameMatch;
          const caseNames = new Set();
          while ((caseNameMatch = caseNameRe.exec(allText)) !== null) {
            caseNames.add(caseNameMatch[0].trim());
          }

          // Verify case names not already caught by formal citation lookup
          const verifiedNames = [];
          const notFoundNames = [];
          for (const name of caseNames) {
            // Skip if already verified via formal citation
            if (verifiedCitations.some(vc => vc.toLowerCase().includes(name.split(' v')[0].trim().toLowerCase()))) continue;
            
            try {
              const sResp = await fetch('https://www.courtlistener.com/api/rest/v4/search/?q=' + encodeURIComponent('"' + name + '"') + '&type=o&page_size=1', {
                headers: { 'Authorization': 'Token ' + CL_TOKEN }
              });
              if (sResp.ok) {
                const sData = await sResp.json();
                if (sData.count > 0) verifiedNames.push(name);
                else notFoundNames.push(name);
              }
              await new Promise(r => setTimeout(r, 150));
            } catch(e) { /* non-fatal */ }
            
            // Max 10 lookups to avoid timeout
            if (verifiedNames.length + notFoundNames.length >= 10) break;
          }

          // Build verification summary and inject into response
          const totalVerified = verifiedCitations.length + verifiedNames.length;
          const totalNotFound = notFoundCitations.length + notFoundNames.length;

          const verification = {
            verified_citations: [...verifiedCitations, ...verifiedNames],
            not_found_citations: [...notFoundCitations, ...notFoundNames],
            total_verified: totalVerified,
            total_not_found: totalNotFound,
            verification_rate: (totalVerified + totalNotFound) > 0
              ? Math.round((totalVerified / (totalVerified + totalNotFound)) * 100) : null,
            warning: totalNotFound > 0
              ? totalNotFound + ' citation(s) could not be verified against CourtListener\'s database. These may be hallucinated, misspelled, or from sources not in the database. DO NOT rely on unverified citations.'
              : null,
            service: 'courtlistener'
          };

          // Stamp vectors with citation verification status
          if (parsed.inversion_vectors) {
            parsed.inversion_vectors.forEach(v => {
              const law = (v.applicable_law || '').toLowerCase();
              const arg = (v.argument || '').toLowerCase();
              const combined = law + ' ' + arg;
              
              const hasVerified = [...verifiedCitations, ...verifiedNames].some(c => combined.includes(c.toLowerCase().split('(')[0].trim()));
              const hasNotFound = [...notFoundCitations, ...notFoundNames].some(c => combined.includes(c.toLowerCase().split('(')[0].trim()));
              
              v.citation_status = hasNotFound ? 'UNVERIFIED — citation not found in database'
                : hasVerified ? 'VERIFIED — citation confirmed in CourtListener'
                : 'UNVERIFIABLE — no formal citation to verify';

              // ENHANCEMENT 2: Auto-downgrade confidence for unverified citations
              if (hasNotFound && v.confidence) {
                v.original_confidence = v.confidence;
                v.confidence = Math.max(0, parseInt(v.confidence) - 30);
                v.confidence_note = 'Confidence reduced by 30 points — citation could not be verified';
              }
            });
          }

          // ENHANCEMENT 4: Add clickable CourtListener links
          if (Array.isArray(allCLResults)) {
            verification.citation_links = {};
            allCLResults.forEach(c => {
              if (c.status === 200 && c.clusters && c.clusters[0]) {
                verification.citation_links[c.citation] = {
                  url: 'https://www.courtlistener.com' + (c.clusters[0].absolute_url || ''),
                  case_name: c.clusters[0].case_name || c.citation,
                  court: c.clusters[0].court || ''
                };
              }
            });
            // Add links for verified name searches
            verifiedNames.forEach(name => {
              if (!verification.citation_links[name]) {
                verification.citation_links[name] = { url: 'https://www.courtlistener.com/?q=' + encodeURIComponent(name) + '&type=o', case_name: name };
              }
            });
          }

          // ENHANCEMENT 3: Blocklist — check and update
          if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
            try {
              const sbBlock = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
              
              // Add not-found citations to blocklist
              for (const nfc of [...notFoundCitations, ...notFoundNames]) {
                await sbBlock.from('citation_blocklist').upsert({
                  citation_text: nfc,
                  citation_normalized: nfc.toLowerCase().trim(),
                  times_flagged: 1,
                  last_seen_at: new Date().toISOString(),
                  source: 'auto'
                }, { onConflict: 'citation_text' });
                // Increment counter for existing entries
                await sbBlock.rpc('increment_blocklist_count', { p_citation: nfc }).catch(() => {});
              }

              // Check all citations in response against blocklist (3+ flags = known hallucination)
              const { data: blocked } = await sbBlock.from('citation_blocklist')
                .select('citation_text')
                .gte('times_flagged', 3);
              const blockedSet = new Set((blocked || []).map(b => b.citation_text.toLowerCase()));

              if (blockedSet.size > 0 && parsed.inversion_vectors) {
                parsed.inversion_vectors.forEach(v => {
                  const law = (v.applicable_law || '').toLowerCase();
                  for (const bc of blockedSet) {
                    if (law.includes(bc)) {
                      v.citation_status = 'BLOCKED — previously identified as hallucinated citation';
                      v.applicable_law = (v.applicable_law || '') + ' [CITATION FLAGGED — verify independently]';
                      v.original_confidence = v.original_confidence || v.confidence;
                      v.confidence = Math.max(0, parseInt(v.confidence) - 40);
                      v.confidence_note = 'Citation has been flagged multiple times as unverifiable';
                      break;
                    }
                  }
                });
              }

              verification.blocked_citations = blocked ? blocked.map(b => b.citation_text) : [];
            } catch (blockErr) {
              console.error('Blocklist check failed (non-blocking):', blockErr.message);
            }
          }

          // ENHANCEMENT 5: Dual-model verification (quick second opinion)
          const ANTHROPIC_KEY_CHECK = process.env.ANTHROPIC_API_KEY;
          if (ANTHROPIC_KEY_CHECK && parsed.inversion_vectors) {
            try {
              const citationsToCheck = parsed.inversion_vectors
                .filter(v => v.applicable_law && v.citation_status !== 'VERIFIED — citation confirmed in CourtListener')
                .map(v => v.applicable_law)
                .slice(0, 10);

              if (citationsToCheck.length > 0) {
                const checkResp = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY_CHECK, 'anthropic-version': '2023-06-01' },
                  body: JSON.stringify({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 1024,
                    messages: [{ role: 'user', content: 'For each citation below, respond ONLY with a JSON array. Each item: {"citation":"the citation","real":true/false,"confidence":"high/medium/low"}. If you are not confident a case exists with that exact name and holding, mark real:false.\n\n' + citationsToCheck.join('\n') }]
                  })
                });

                if (checkResp.ok) {
                  const checkData = await checkResp.json();
                  const checkText = (checkData.content || []).map(c => c.text || '').join('');
                  try {
                    const checkResults = JSON.parse(checkText.replace(/```json|```/g, '').trim());
                    if (Array.isArray(checkResults)) {
                      verification.dual_model_check = checkResults;
                      // Cross-reference: if second model says "not real", flag it
                      checkResults.forEach(cr => {
                        if (!cr.real) {
                          parsed.inversion_vectors.forEach(v => {
                            if (v.applicable_law && v.applicable_law.toLowerCase().includes(cr.citation.toLowerCase().slice(0, 20))) {
                              if (v.citation_status !== 'VERIFIED — citation confirmed in CourtListener') {
                                v.citation_status = 'SUSPECT — second verification failed';
                                v.original_confidence = v.original_confidence || v.confidence;
                                v.confidence = Math.max(0, parseInt(v.confidence) - 20);
                                v.confidence_note = (v.confidence_note || '') + ' Dual-model check flagged this citation.';
                              }
                            }
                          });
                        }
                      });
                    }
                  } catch (e) { /* parse fail — non-fatal */ }
                }
              }
            } catch (dualErr) {
              console.error('Dual-model check failed (non-blocking):', dualErr.message);
            }
          }

          // Add statute source info if we fetched it
          if (statuteText) {
            verification.statute_source = 'Real statute text injected from Justia — analysis grounded in actual statutory language';
          }

          // Add verification to parsed result
          parsed.citation_verification = verification;

          // Re-serialize into the response format
          data.content[0].text = JSON.stringify(parsed);
        }
      } catch (verifyErr) {
        console.error('Citation verification failed (non-blocking):', verifyErr.message);
        // Non-fatal — return response without verification
      }
    }

    // ===== LOG ANALYSIS TO SUPABASE =====
    // Persists the FULL analysis (situation + result JSONB) so users can re-read past
    // analyses from /api/history and so we have a complete audit trail for legal/liability purposes.
    if (userId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // Increment usage counter
        await supabaseAdmin.rpc('increment_analysis_count', { p_user_id: userId });

        // Parse the (possibly verification-enriched) result ONCE so we can both
        // save it AND extract the vector count metric.
        let parsedResult = null;
        let vectorCount = 0;
        if (data.content && data.content[0] && data.content[0].text) {
          try {
            parsedResult = JSON.parse(
              data.content[0].text.replace(/```json|```/g, '').trim()
            );
            vectorCount = (parsedResult.inversion_vectors || []).length;
          } catch (parseErr) {
            console.error('Result parse for persistence failed (non-blocking):', parseErr.message);
          }
        }

        // Log the analysis — full content + metadata for user history and legal audit trail
        await supabaseAdmin.from('analysis_history').insert({
          user_id: userId,
          state: safeState,
          county: safeCounty,
          charge: safeCharge,
          situation: safeSituation,
          situation_length: safeSituation.length,
          result: parsedResult,
          vectors_found: vectorCount,
          ip_address: ip,
          created_at: new Date().toISOString()
        });
      } catch (logErr) {
        console.error('Analysis logging failed (non-blocking):', logErr.message);
      }
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
