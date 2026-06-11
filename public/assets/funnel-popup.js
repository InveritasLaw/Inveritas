/*
 * Inveritas funnel popup — exit-intent / hesitation lead capture.
 *
 * Fires once per session when the visitor signals they're leaving or stalling:
 *   - desktop exit intent (mouse leaves the top of the viewport)
 *   - mobile fast scroll-up (a "leaving" gesture)
 *   - hesitation: engaged but idle for a stretch ("thinking too much")
 *   - a max-time fallback
 *
 * Design follows the conversion research in docs/funnel-conversion-playbook.md:
 *   - Two-step (Zeigarnik / foot-in-the-door): a single "Get the checklist"
 *     button first, then reveal a short form.
 *   - Form asks only Name / Email / State (state is justified inline). Phone is
 *     NOT asked here — it's the single biggest abandonment driver. We capture it
 *     on the thank-you step from already-committed (warm) leads instead.
 *   - Value-first framing (no "Wait! Before you go!" needy pattern) and a
 *     NEUTRAL decline link (no confirm-shaming — an FTC-scrutinized dark pattern,
 *     off the table for a legal brand).
 *
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
  var leadId = null;

  // Suppress for visitors already captured or actively converting.
  try { if (localStorage.getItem(DONE_KEY)) return; } catch (e) {}
  try { if (sessionStorage.getItem(SHOWN_KEY)) shown = true; } catch (e) {}

  function ev(name, params) {
    try { if (window.gtag) { params = params || {}; params.variant = VARIANT; gtag('event', name, params); } } catch (e) {}
  }

  // Value-first copy (no needy "before you go" pattern). Efficacy-forward.
  var COPY = {
    fear: {
      eyebrow: 'Free 1-page checklist',
      h: 'The first 48 hours decide a lot.',
      sub: 'A charge is not a conviction — but what you do in the next two days can shape the whole case. Grab the free checklist before you close this.'
    },
    leverage: {
      eyebrow: 'Free 1-page checklist',
      h: 'Know your first moves.',
      sub: 'The smartest defense starts in the first 48 hours. Get the free checklist of exactly what to do — and what never to do — right now.'
    }
  };
  var c = COPY[VARIANT] || COPY.fear;

  var STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];

  function build() {
    var stateOpts = '<option value="">Your state…</option>' + STATES.map(function (s) { return '<option>' + s + '</option>'; }).join('');
    var overlay = document.createElement('div');
    overlay.className = 'iv-pop-overlay';
    overlay.innerHTML =
      '<div class="iv-pop" role="dialog" aria-modal="true" aria-label="Free checklist">' +
        '<button class="iv-pop-x" type="button" aria-label="Close">&times;</button>' +
        '<div class="iv-form-state">' +
          '<span class="eyebrow">' + c.eyebrow + '</span>' +
          '<h3>' + c.h + '</h3>' +
          '<p class="iv-pop-sub">' + c.sub + '</p>' +
          '<div class="iv-bonus"><span>★</span><span><b>“The First 48 Hours After a Charge”</b> — a free, 1-page checklist of what to do and what never to do. Yours instantly.</span></div>' +
          // Step 1: single low-commitment button (no fields yet)
          '<div class="iv-step1">' +
            '<button class="btn btn-gold btn-lg iv-step1-btn" type="button">Get the Free Checklist →</button>' +
            '<button class="iv-decline" type="button">No thanks</button>' +
          '</div>' +
          // Step 2: revealed after the click
          '<form class="iv-form" novalidate>' +
            '<input class="iv-hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">' +
            '<input name="name" type="text" placeholder="First name" autocomplete="given-name" required>' +
            '<input name="email" type="email" placeholder="Email — we’ll send your checklist" autocomplete="email" required>' +
            '<select name="state" aria-label="State">' + stateOpts + '</select>' +
            '<div class="iv-statenote">Your state, so we can point you to the right jurisdiction’s rules.</div>' +
            '<div class="iv-err" aria-live="polite"></div>' +
            '<button class="btn btn-gold btn-lg" type="submit">Send Me the Checklist →</button>' +
            '<div class="iv-fine">Confidential. We never sell your information. No spam. Not legal advice.</div>' +
          '</form>' +
        '</div>' +
        // Success
        '<div class="iv-success">' +
          '<div class="iv-check">✓</div>' +
          '<h3>It’s yours.</h3>' +
          '<p class="iv-pop-sub">Your checklist is ready — open it now, and see the defense angles in your own case.</p>' +
          '<a class="btn btn-gold btn-lg iv-guide-btn" href="/guide-first-48-hours">Open My Free Checklist →</a>' +
          // Warm-lead phone ask (post-commitment — optional)
          '<form class="iv-phone-ask" novalidate>' +
            '<div class="iv-phone-h">Want a free, confidential case review?</div>' +
            '<div class="iv-phone-sub">Add your number and an advocate can walk you through your options. Optional.</div>' +
            '<input name="phone" type="tel" placeholder="Phone (optional)" autocomplete="tel">' +
            '<div class="iv-err iv-perr" aria-live="polite"></div>' +
            '<button class="btn btn-ghost" type="submit">Request my free call</button>' +
          '</form>' +
          '<div class="iv-phone-done">Got it — we’ll reach out. In the meantime:</div>' +
          '<a class="iv-decline iv-analyze" href="/analyze">See my defense analysis →</a>' +
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

  function post(payload) {
    return fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); });
  }

  function wire(el) {
    var pop = el.querySelector('.iv-pop');
    el.querySelector('.iv-pop-x').addEventListener('click', function () { close('dismiss'); });
    el.querySelector('.iv-decline:not(.iv-analyze)').addEventListener('click', function (e) {
      if (e.currentTarget.tagName === 'BUTTON') { e.preventDefault(); close('dismiss'); }
    });
    el.addEventListener('click', function (e) { if (e.target === el) close('dismiss'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close('dismiss'); });

    // Step 1 -> reveal the form (two-step Zeigarnik / foot-in-the-door)
    el.querySelector('.iv-step1-btn').addEventListener('click', function () {
      pop.classList.add('show-form');
      ev('popup_step1');
      var n = el.querySelector('input[name=name]');
      if (n) n.focus();
    });

    // Step 2 -> capture the lead
    var form = el.querySelector('.iv-form');
    var errEl = el.querySelector('.iv-form .iv-err');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errEl.textContent = '';
      var data = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        state: form.state.value,
        company: form.company.value, // honeypot
        variant: VARIANT,
        source: location.pathname,
        trigger: 'popup'
      };
      if (!data.name) { errEl.textContent = 'Please enter your first name.'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { errEl.textContent = 'Please enter a valid email.'; return; }

      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Sending…';
      post(data).then(function (res) {
        if (!res.ok) throw new Error((res.j && res.j.error) || 'Something went wrong.');
        leadId = res.j && res.j.id;
        try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
        ev('popup_submit');
        pop.classList.add('is-success');
      }).catch(function (err) {
        errEl.textContent = err.message || 'Could not send. Please try again.';
        btn.disabled = false; btn.textContent = 'Send Me the Checklist →';
      });
    });

    // Thank-you step -> optional phone append for warm leads
    var phoneForm = el.querySelector('.iv-phone-ask');
    var pErr = el.querySelector('.iv-perr');
    phoneForm.addEventListener('submit', function (e) {
      e.preventDefault();
      pErr.textContent = '';
      var phone = phoneForm.phone.value.trim();
      if (phone.replace(/\D/g, '').length < 7) { pErr.textContent = 'Please enter a valid number.'; return; }
      var btn = phoneForm.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Sending…';
      post({ id: leadId, phone: phone }).then(function (res) {
        if (!res.ok) throw new Error((res.j && res.j.error) || 'Something went wrong.');
        ev('popup_phone');
        pop.classList.add('phone-done');
      }).catch(function (err) {
        pErr.textContent = err.message || 'Could not send. Please try again.';
        btn.disabled = false; btn.textContent = 'Request my free call';
      });
    });

    el.querySelector('.iv-analyze').addEventListener('click', function () { ev('popup_to_analyze'); });
  }

  // ---- Triggers ----
  // Suppress when the visitor is converting (clicked a primary CTA).
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="/analyze"]');
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
