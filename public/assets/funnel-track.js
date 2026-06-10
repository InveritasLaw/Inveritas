/*
 * Inveritas funnel A/B tracking. Each variant page sets window.IV_VARIANT
 * ('fear' | 'leverage') before loading this file. We fire one GA funnel_view
 * on load and tag every CTA click with the variant + location, so conversion
 * rate (clicks / views) can be compared per variant in GA.
 */
(function () {
  var v = window.IV_VARIANT || 'unknown';
  function ev(name, params) {
    try {
      if (window.gtag) {
        params = params || {};
        params.variant = v;
        gtag('event', name, params);
      }
    } catch (e) {}
  }
  ev('funnel_view');
  window.track = function (loc) { ev('funnel_cta_click', { cta_location: loc }); };
})();
