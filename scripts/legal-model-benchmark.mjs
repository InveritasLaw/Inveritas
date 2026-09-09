import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function loadEnv(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing environment file: ${file}`);
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

loadEnv(path.resolve('.env.local'));
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is unavailable');

const cases = [
  {
    id: 'tx-assault-contact',
    facts: 'At a private backyard gathering, Alex tapped Jordan once on the shoulder during an argument. Jordan says the touch was offensive. No injury occurred. Alex denies intending offense and says the touch was to get Jordan’s attention.',
    authority: 'Texas Penal Code 22.01(a)(3): assault occurs when a person intentionally or knowingly causes physical contact with another when the person knows or should reasonably believe the other will regard the contact as offensive or provocative. Section 22.01(c) ordinarily grades (a)(3) as a Class C misdemeanor.',
    required: ['22.01(a)(3)', 'intentional or knowing contact', 'offensive or provocative perception'],
    forbidden: ['bodily injury is a required element', 'Class A misdemeanor']
  },
  {
    id: 'tx-dwi-private-driveway',
    facts: 'Morgan sat in the driver seat of a running truck and moved it ten feet entirely within a gated private residential driveway. Police arrived afterward. No evidence places the truck on a street or other area open to the public.',
    authority: 'Texas Penal Code 49.04(a): a person commits DWI if the person is intoxicated while operating a motor vehicle in a public place. The supplied facts do not establish a public place.',
    required: ['49.04(a)', 'operating a motor vehicle', 'public place'],
    forbidden: ['private driveway always is a public place', '0.08 is the only statutory definition of intoxicated']
  },
  {
    id: 'tx-possession-control',
    facts: 'Police found a small bag of cocaine under the rear passenger seat of a borrowed car. Casey was driving. Three passengers had used the car that day. No fingerprints, admissions, or personal items connect Casey to the bag.',
    authority: 'Texas Health and Safety Code 481.115(a): an offense requires knowingly possessing a controlled substance listed in Penalty Group 1. Section 481.002(38) defines possession as actual care, custody, control, or management.',
    required: ['481.115(a)', 'knowingly', 'care, custody, control, or management'],
    forbidden: ['driver status conclusively proves possession', 'strict liability']
  }
];

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    statute: { type: 'string' }, jurisdiction: { type: 'string' },
    elements: { type: 'array', items: { type: 'string' } },
    missing_or_disputed_elements: { type: 'array', items: { type: 'string' } },
    defense_issues: { type: 'array', items: { type: 'string' } },
    citations: { type: 'array', items: { type: 'string' } },
    conclusion: { type: 'string' }, confidence: { type: 'integer', minimum: 0, maximum: 100 }
  },
  required: ['statute','jurisdiction','elements','missing_or_disputed_elements','defense_issues','citations','conclusion','confidence']
};

async function run(model, item) {
  const started = performance.now();
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      reasoning: { effort: model.includes('sol') ? 'medium' : 'low' },
      input: [
        { role: 'system', content: 'You are evaluating a synthetic Texas criminal-law fact pattern. Use only the supplied statutory authority. Do not invent cases, statutes, facts, or outcomes. Identify disputed elements and defense issues; do not give legal advice.' },
        { role: 'user', content: `FACTS:\n${item.facts}\n\nSUPPLIED OFFICIAL AUTHORITY:\n${item.authority}` }
      ],
      text: { format: { type: 'json_schema', name: 'legal_analysis', strict: true, schema } },
      max_output_tokens: 2500
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${model}/${item.id}: ${response.status} ${body?.error?.message || 'request failed'}`);
  const raw = body.output_text || body.output?.flatMap(x => x.content || []).find(x => x.type === 'output_text')?.text;
  if (!raw) throw new Error(`${model}/${item.id}: response contained no output text`);
  const parsed = JSON.parse(raw);
  const normalized = JSON.stringify(parsed).toLowerCase();
  const requiredHits = item.required.filter(term => normalized.includes(term.toLowerCase()));
  const forbiddenHits = item.forbidden.filter(term => normalized.includes(term.toLowerCase()));
  const citationScope = parsed.citations.every(c => item.authority.toLowerCase().includes(c.toLowerCase()) || normalized.includes(c.toLowerCase()));
  return {
    case_id: item.id, model, latency_ms: Math.round(performance.now() - started),
    input_tokens: body.usage?.input_tokens ?? null, output_tokens: body.usage?.output_tokens ?? null,
    required_hits: requiredHits, required_total: item.required.length,
    forbidden_hits: forbiddenHits, schema_valid: true, citation_scope_check: citationScope,
    score: requiredHits.length * 2 - forbiddenHits.length * 3 + (citationScope ? 1 : 0), output: parsed
  };
}

const models = (process.env.BENCHMARK_MODELS || 'gpt-5.6-terra,gpt-5.6-sol').split(',').map(x => x.trim()).filter(Boolean);
const results = [];
for (const model of models) {
  for (const item of cases) {
    try { results.push(await run(model, item)); }
    catch (error) { results.push({ case_id: item.id, model, error: error.message, score: 0, schema_valid: false }); }
  }
}
const summary = models.map(model => {
  const rows = results.filter(r => r.model === model);
  return {
    model, successful_cases: rows.filter(r => !r.error).length, total_cases: rows.length,
    score: rows.reduce((sum, row) => sum + row.score, 0),
    avg_latency_ms: Math.round(rows.filter(r => r.latency_ms).reduce((sum, row) => sum + row.latency_ms, 0) / Math.max(1, rows.filter(r => r.latency_ms).length)),
    input_tokens: rows.reduce((sum, row) => sum + (row.input_tokens || 0), 0),
    output_tokens: rows.reduce((sum, row) => sum + (row.output_tokens || 0), 0)
  };
});
const report = { generated_at: new Date().toISOString(), methodology: 'Three synthetic Texas matters scored against supplied official statutory ground truth. This is a screening benchmark, not attorney validation.', summary, results };
fs.mkdirSync(path.resolve('../../outputs'), { recursive: true });
fs.writeFileSync(path.resolve('../../outputs/legal-model-benchmark.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.some(row => row.successful_cases !== cases.length)) process.exitCode = 1;
