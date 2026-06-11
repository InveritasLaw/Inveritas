# Inveritas funnel conversion playbook

Evidence-based conversion guidance for the `/defense` (fear angle) and
`/defense-leverage` (leverage angle) funnels, the exit/hesitation popup, and the
lead magnet. Compiled from a five-stream deep-research pass; every claim is tagged
with a confidence level and a source. **Folklore is separated from evidence** — do
not bank on the low-confidence "X% lift" numbers; treat them as A/B hypotheses.

Audience reality: people recently charged with a crime — scared, skeptical,
researching late at night, worried about cost and about being scammed. This is a
**YMYL** (your-money-your-life) legal-services context, so the ethics/compliance
guardrails at the bottom are not optional.

---

## The one strategic insight

The audience is **already at maximum fear**. The fear-appeal literature is blunt
about what happens if you add more: **high threat + low efficacy → "fear control"**
(denial, paralysis, doom-scrolling, reactance) rather than action. The lever we're
under-using is **efficacy** — a clear, doable path. High threat + *high efficacy* is
the only quadrant that reliably produces action.

- Tannenbaum et al. 2015, fear-appeal meta-analysis (127 papers, ~27,000 people),
  composite effect d ≈ 0.27; fear works *better* with explicit efficacy + a single
  one-time action. https://www.apa.org/pubs/journals/releases/bul-a0039729.pdf
- Witte's Extended Parallel Process Model: perceived efficacy is the "switch"
  between danger-control (act) and fear-control (avoid).
  https://en.wikipedia.org/wiki/Extended_parallel_process_model

**Implication for the A/B test:** the two variants aren't equals. The leverage/
empowerment angle is what the evidence favours for an already-terrified buyer. The
fear angle should *name the fear once, then pivot hard to efficacy* — not dwell on
stakes. (Implemented: hero assurance on `/defense` is now "A charge is not a
conviction — but what you do next decides everything.")

---

## Tier 1 — high confidence, low risk (DONE / do first)

| # | Recommendation | Evidence | Status |
|---|---|---|---|
| 1 | Lead with efficacy; name fear once | Tannenbaum 2015; Witte EPPM — **high** | Done (hero assurance) |
| 2 | Plain ~8th-grade language; people scan, fluency = trust | NN/g legibility; processing-fluency lit — **high** | Partial (jargon glossed) |
| 3 | Cut up-front form fields; ~4–6% drop per field past the 8th | Baymard — **high** | Done (popup = 3 fields) |
| 4 | Money-back guarantee at the price point | Anderson; VWO +32% case — direction **high** | Done (guarantee badge) |
| 5 | Keep $29 (nine-ending); $34→$39 raised demand ~33% | Anderson & Simester 2003 — **high** | Done (kept) |
| 6 | Anchor against real attorney cost ($200–$500 consult, retainers in thousands) | price-anchoring — **high** | Done (price-anchor copy) |
| 7 | Security seal + "secure checkout" at the pay button | Baymard (~18% abandon over CC distrust) — **high** | Done (trust-row) |
| 8 | Gold = contrast win; keep gold exclusive to primary CTAs | CXL; HubSpot red-vs-green debunk — **high** | Guidance |

- Anderson & Simester, "Effects of $9 Price Endings," *Quantitative Marketing &
  Economics* 2003. https://link.springer.com/article/10.1023/A:1023581927405
- Baymard checkout/field research. https://baymard.com/blog/checkout-flow-average-form-fields
- NN/g legibility & comprehension. https://www.nngroup.com/articles/legibility-readability-comprehension/
- CXL, "Which color converts best?" (contrast, not hue; Von Restorff).
  https://cxl.com/blog/which-color-converts-the-best/

---

## Tier 2 — popup design (DONE)

The exit/hesitation popup follows these, several of which corrected the first build:

- **Two-step opt-in** (single "Get the checklist" button → then the form). Zeigarnik
  + foot-in-the-door (Freedman & Fraser 1966: 17% cold vs 76% after a small prior
  "yes"). https://web.mit.edu/curhan/www/docs/Articles/15341_Readings/Influence_Compliance/Freedman_Fraser_Foot-in-the-door.pdf
- **3 fields only — Name / Email / State** (state justified inline). **No phone in
  the form** — phone is the single biggest abandonment driver (~37% drop; triggers a
  "spam alarm"). Captured instead on the thank-you step from warm leads.
  https://cxl.com/blog/reduce-form-fields/ · https://baymard.com/learn/input-fields
- **Neutral decline ("No thanks")** — no confirm-shaming. Confirm-shaming is an
  FTC-scrutinised dark pattern and a reputational liability for a legal brand.
  https://www.nngroup.com/articles/shaming-users/ · https://arxiv.org/pdf/1907.07032
- **Value-first framing** — no "Wait! Before you go!" needy pattern.
  https://www.nngroup.com/articles/needy-design-patterns/
- **Behaviour-triggered, dismissible** — exempt from Google's mobile intrusive-
  interstitial penalty (which targets on-arrival overlays).
  https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials
- **Privacy reassurance under the submit button** ("Confidential. We never sell your
  information."). https://www.nngroup.com/articles/communicating-trustworthiness/

---

## Tier 3 — test these (direction sound, magnitude unreliable)

- **First-person, value-based CTAs** ("Find my defense angles", never "Submit").
  ContentVerve "my>your" ~90% — single test, *test it*.
  https://www.kissmetrics.io/blog/cta-button-best-practices
- **Two-step charge intake + open-loop** on the hero (DONE as `funnel-intake.js`):
  easy first question (charge chips) → teaser ("3–5 angles people miss") → CTA to
  `/analyze?charge=…`. Foot-in-the-door + Zeigarnik.
- **Real, named testimonials with faces**; link to a *third-party* review profile —
  on-site testimonials get discounted by skeptics.
  https://www.nngroup.com/articles/trustworthy-design/

### Wording bank

Headlines: "Charged with a crime? Find your defense angles in 90 seconds." ·
"See the weak points in the case against you — before you talk to anyone." ·
"A charge is not a conviction. See your options tonight — $29."

CTAs: "Find my defense angles" · "Show me my options" · "Start my 90-second
analysis" · "Reveal the weak points in my case".

Risk-reversal: "30-day money-back guarantee. Not useful? We refund the $29 — no
questions." · "$29, one time. Not a subscription. No account, no calls."

Honest urgency (real clock only): "Evidence and witness memories fade fast — the
sooner you understand your case, the more angles stay open."

### Colour / hex

- Base navy `#0E1A2B`–`#121A2E` (avoid pure black). Navy legitimately signals
  competence/trust (Labrecque & Milne).
- CTA gold `#C9A24B`–`#D4AF37` (current `#D4A843` is fine) — slightly desaturated,
  not neon (saturated colours "vibrate" on dark).
- **Accessibility:** gold buttons need **dark navy label text**, not white —
  white-on-gold usually fails WCAG AA 4.5:1. Verify button-vs-navy (3:1) and
  label-vs-gold (4.5:1). https://www.nngroup.com/articles/dark-mode-users-issues/

---

## 🚩 Ethics / legal red lines — AVOID

This is a regulated-adjacent legal product. These can create real liability:

- **No outcome guarantees / success-rate claims** — "beat your charge," "avoid
  jail," "98% success," "what prosecutors don't want you to know." Creates
  unjustified expectations (ABA Model Rule 7.1 logic), FTC-deceptive if unverifiable,
  and invites unauthorized-practice-of-law scrutiny.
  https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_7_1_communication_concerning_a_lawyer_s_services/
- **No fabricated / incentivised / AI-generated testimonials, no fake "verified
  buyer" badges, no review suppression.** FTC Fake Reviews Rule (16 CFR Part 465,
  effective Oct 2024): penalties up to **$51,744 per violation**.
  https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials
- **Disclose material connections** on any testimonial (paid/free/affiliate);
  disclose if a depicted result is atypical. 16 CFR Part 255.
  https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255
- **No fake urgency/scarcity** — resetting countdown timers, "only 3 spots left."
  Deceptive under FTC Act §5; especially predatory on frightened buyers. Use only the
  *real* clock (legal deadlines).
- **Keep "not a law firm / not legal advice / consult a licensed attorney"
  prominent** — already in the footer; keep it unavoidable.
- **Any anchor number must be truthful** — the "$200–$500 / thousands" framing is
  ranged and defensible; don't invent a specific "$5,000 retainer" figure.

### Open commitment created by this work

Adding the **30-day money-back guarantee** is a business policy, not just copy. To
honour it: make sure the Stripe refund path + Terms reflect a 30-day no-questions
refund. If you don't want to offer it, remove the `.guarantee` badge from both
landing pages and the popup's value framing.

---

## Evidence tiers (what to trust)

- **Bank on it (high):** efficacy-over-fear, plain language/fluency, field
  reduction, money-back guarantee, charm pricing ($29), anchoring, contrast-not-
  colour, payment trust signals, third-party reviews > on-site, the FTC/ABA red lines.
- **Test, don't trust the number (medium):** "my>your" ~90%, two-step ~84%,
  social-proof survey stats.
- **Folklore — cite the mechanism, never the figure (low):** 785%/845% opt-in lifts,
  "300% from multi-step forms," "blue boosts trust 42%," "red always wins."

---

## Primary sources

CXL · Nielsen Norman Group · Baymard Institute · Tannenbaum et al. 2015 (APA) ·
Witte EPPM · Anderson & Simester 2003 · Freedman & Fraser 1966 · Labrecque & Milne
(colour) · Su/Cui et al. 2019 (blue/trust) · ABA Model Rule 7.1 · FTC 16 CFR Parts
255 & 465 · Google Search Central (intrusive interstitials) · Google E-E-A-T / YMYL.
