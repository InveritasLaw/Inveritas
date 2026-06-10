/*
 * Inveritas funnel popup — exit-intent / hesitation lead capture.
 *
 * Fires once per session when the visitor signals they're leaving or stalling:
 *   - desktop exit intent (mouse leaves the top of the viewport)
 *   - mobile fast scroll-up (a "leaving" gesture)
 *   - hesitation: engaged but idle for a stretch ("thinking too much")
 *   - a max-time fallback
 *
 * Offer is reframe + bonus (no discount): a free instant guide + reassurance,
 * in exchange for name / email / phone / state -> POST /api/lead.
 * Reads window.IV_VARIANT ('fear' | 'leverage') for tone.
 */
(function () {
  if (window.__ivPopup) return;
  window.__ivPopup = true;

  var VARIANT = window.IV_VARIANT || 'unknown';
  var SHOWN_KEY = 'iv_popup_shown';       // sessionStorage — once per session
  var DONE_KEY = 'iv_lead_captured';      // localStorage — never nag a captured lead
  var MIN_DWELL = 8000;                   // don't fire in the first 8s
  var IDLE_MS = 12000;                    // hesitation: idle this long after engaging
  var MAX_MS = 60000;                     // hard fallback
  var startedAt = Date.now();
  var shown = false, converted = false, engaged = false;

  // Suppress for visitors already captured or actively converting.
  try { if (localStorage.getItem(DONE_KEY)) return; } catch (e) {}
  try { if (sessionStorage.getItem(SHOWN_KEY)) shown = true; } catch (e) {}

  function ev(name, params) {
    try { if (window.gtag) { params = params || {}; params.variant = VARIANT; gtag('event', name, params); } } catch (e) {}
  }

  var COPY = {
    fear: {
      eyebrow: 'Wait — before you go',
      h: "Don't walk into this blind.",
      sub: "The clock on your case is already running. Take 60 seconds: get the free checklist, and see the defense angles in your situation."
    },
    leverage: {
      eyebrow: 'Before you go',
      h: "Don't leave your leverage on the table.",
      sub: "The angles are written into the law. Grab the free checklist and see what Inveritas surfaces in your situation."
    }
  };
  var c = COPY[VARIANT] || COPY.fear;

  var STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];

  function build() {
    var stateOpts = '<option value="">State…</option>' + STATES.map(function (s) { return '<option>' + s + '</option>'; }).join('');
    var overlay = document.createElement('div');
    overlay.className = 'iv-pop-overlay';
    overlay.innerHTML =
      '<div class="iv-pop" role="dialog" aria-modal="true" aria-label="Special offer">' +
        '<button class="iv-pop-x" type="button" aria-label="Close">&times;</button>' +
        '<div class="iv-form-state">' +
          '<span class="eyebrow">' + c.eyebrow + '</span>' +
          '<h3>' + c.h + '</h3>' +
          '<p class="iv-pop-sub">' + c.sub + '</p>' +
          '<div class="iv-bonus"><span>★</span><span><b>Free instantly:</b> “The First 48 Hours After a Charge” checklist — plus your analysis is always yours to keep. No subscription.</span></div>' +
          '<form novalidate>' +
            '<input class="iv-hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">' +
            '<input name="name" type="text" placeholder="Full name" autocomplete="name" required>' +
            '<input name="email" type="email" placeholder="Email" autocomplete="email" required>' +
            '<div class="iv-row">' +
              '<input name="phone" type="tel" placeholder="Phone" autocomplete="tel">' +
              '<select name="state">' + stateOpts + '</select>' +
            '</div>' +
            '<div class="iv-err" aria-live="polite"></div>' +
            '<button class="btn btn-gold btn-lg" type="submit">Send My Free Checklist →</button>' +
          '</form>' +
          '<div class="iv-fine">We’ll send your free guide and may follow up about your case. No spam. Not legal advice.</div>' +
          '<button class="iv-decline" type="button">No thanks — I’ll risk it</button>' +
        '</div>' +
        '<div class="iv-success">' +
          '<div class="iv-check">✓</div>' +
          '<h3>It’s yours.</h3>' +
          '<p class="iv-pop-sub">Your checklist is ready — and the smartest next move is seeing the angles in your own case.</p>' +
          '<a class="btn btn-gold btn-lg" href="/guide-first-48-hours">Open My Free Checklist →</a>' +
          '<a class="iv-decline" href="/analyze" style="margin-top:1rem">Run my defense analysis →</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  var overlayEl = null;

  function show(trigger) {
    if (shown || converted) return;
    if (Date.now() - startedAt < MIN_DWELL) return;
    shown = true;
    try { sessionStorage.setItem(SHOWN_KEY, '1'); } catch (e) {}
    if (!overlayEl) {
      overlayEl = build();
      wire(overlayEl);
    }
    requestAnimationFrame(function () { overlayEl.classList.add('open'); });
    ev('popup_shown', { trigger: trigger });
  }

  function close(reason) {
    if (overlayEl) overlayEl.classList.remove('open');
    if (reason === 'dismiss') ev('popup_dismiss');
  }

  function wire(el) {
    var pop = el.querySelector('.iv-pop');
    el.querySelector('.iv-pop-x').addEventListener('click', function () { close('dismiss'); });
    el.querySelector('.iv-decline').addEventListener('click', function () { close('dismiss'); });
    el.addEventListener('click', function (e) { if (e.target === el) close('dismiss'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close('dismiss'); });

    var form = el.querySelector('form');
    var errEl = el.querySelector('.iv-err');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errEl.textContent = '';
      var data = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        phone: form.phone.value.trim(),
        state: form.state.value,
        company: form.company.value, // honeypot
        variant: VARIANT,
        source: location.pathname,
        trigger: 'popup'
      };
      if (!data.name) { errEl.textContent = 'Please enter your name.'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { errEl.textContent = 'Please enter a valid email.'; return; }

      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Sending…';

      fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error((res.j && res.j.error) || 'Something went wrong.');
          try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
          ev('popup_submit');
          pop.classList.add('is-success');
        })
        .catch(function (err) {
          errEl.textContent = err.message || 'Could not send. Please try again.';
          btn.disabled = false; btn.textContent = 'Send My Free Checklist →';
        });
    });
  }

  // ---- Triggers ----
  // Suppress when the visitor is converting (clicked a primary CTA).
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="/analyze"]');
    if (a) converted = true;
  }, true);

  // Desktop exit intent
  if (window.matchMedia && window.matchMedia('(pointer:fine)').matches) {
    document.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget && e.clientY <= 0) show('exit');
    });
  }

  // Engagement + hesitation (idle after engaging) + mobile fast scroll-up
  var idleTimer = null, lastY = window.scrollY || 0, peakY = lastY;
  function resetIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    if (engaged) idleTimer = setTimeout(function () { show('dwell'); }, IDLE_MS);
  }
  window.addEventListener('scroll', function () {
    var y = window.scrollY || 0;
    var docH = document.documentElement.scrollHeight - window.innerHeight;
    if (docH > 0 && (y / docH > 0.25)) engaged = true;
    if (y > peakY) peakY = y;
    // mobile "leaving" gesture: scrolled down meaningfully, then a sharp scroll up
    if (peakY > 600 && (lastY - y) > 80 && y < peakY - 300) show('scroll_up');
    lastY = y;
    resetIdle();
  }, { passive: true });
  window.addEventListener('mousemove', resetIdle);
  setTimeout(function () { engaged = true; resetIdle(); }, 15000); // dwell counts as engagement

  // Hard fallback
  setTimeout(function () { show('timeout'); }, MAX_MS);
})();
