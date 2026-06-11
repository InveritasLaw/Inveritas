/*
 * Inveritas hero intake — two-step, foot-in-the-door + open-loop.
 *
 * Progressive enhancement: the hero ships with a normal CTA button inside
 * #iv-intake as a no-JS fallback. This script replaces it with:
 *   Step 1 — an easy, low-commitment question (charge-type chips). Clicking a
 *            chip is a micro-commitment (foot-in-the-door, Freedman & Fraser).
 *   Step 2 — an open-loop teaser ("charges like this usually have 3–5 angles…")
 *            that creates Zeigarnik tension, plus the real CTA to /analyze with
 *            the chosen charge passed along as context.
 *
 * Tone is set by window.IV_VARIANT ('fear' | 'leverage'). GA events:
 * intake_charge, intake_cta.
 */
(function () {
  var host = document.getElementById('iv-intake');
  if (!host) return;
  var VARIANT = window.IV_VARIANT || 'unknown';

  function ev(name, params) {
    try { if (window.gtag) { params = params || {}; params.variant = VARIANT; gtag('event', name, params); } } catch (e) {}
  }

  var CTA = VARIANT === 'leverage' ? 'Find My Leverage →' : 'Expose My Defense Vectors →';
  var SUB = 'Full analysis in <strong>~90 seconds</strong> · From <strong>$29</strong> · 30-day money-back guarantee';

  var CHARGES = [
    { label: 'DUI / DWI', slug: 'dui' },
    { label: 'Drug charge', slug: 'drug' },
    { label: 'Assault / violence', slug: 'assault' },
    { label: 'Theft / property', slug: 'theft' },
    { label: 'Domestic / family', slug: 'domestic' },
    { label: 'Weapons', slug: 'weapons' },
    { label: 'Something else', slug: 'other' }
  ];

  function teaserCopy(label) {
    if (VARIANT === 'leverage') {
      return 'A <b>' + label + '</b> charge usually has <b>3–5 pressure points</b> written into the statutes. Let’s map yours.';
    }
    return 'Charges like <b>' + label + '</b> often have <b>3–5 defense angles</b> people miss. Let’s find yours before the clock runs.';
  }

  function renderStep1() {
    host.innerHTML =
      '<div class="iv-intake">' +
        '<div class="iv-intake-q">What were you charged with?</div>' +
        '<div class="iv-chips"></div>' +
      '</div>';
    var chips = host.querySelector('.iv-chips');
    CHARGES.forEach(function (ch) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'iv-chip';
      b.textContent = ch.label;
      b.addEventListener('click', function () { ev('intake_charge', { charge: ch.slug }); renderStep2(ch); });
      chips.appendChild(b);
    });
  }

  function renderStep2(ch) {
    host.innerHTML =
      '<div class="iv-intake">' +
        '<p class="iv-teaser">' + teaserCopy(ch.label) + '</p>' +
        '<div class="cta-stack">' +
          '<a class="btn btn-gold btn-lg" href="/analyze?charge=' + ch.slug + '">' + CTA + '</a>' +
          '<div class="cta-sub">' + SUB + '</div>' +
        '</div>' +
        '<button class="iv-intake-back" type="button">← different charge</button>' +
      '</div>';
    host.querySelector('.btn').addEventListener('click', function () {
      if (window.track) window.track('hero_intake');
      ev('intake_cta', { charge: ch.slug });
    });
    host.querySelector('.iv-intake-back').addEventListener('click', renderStep1);
  }

  renderStep1();
})();
