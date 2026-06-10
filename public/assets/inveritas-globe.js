/*
 * Inveritas globe loader — renderer for the pre-loader + ambient background globe.
 * Markup and CSS live in the page; this script finds any canvas[data-iv-globe],
 * draws a rotating wireframe globe (scales-of-justice whirl + great-circle arc
 * pings between courthouse cities), and auto-dismisses #inveritas-preloader.
 *
 * Fetches a ~100 KB world topology from unpkg.com on first paint. If that fails,
 * the globe gracefully falls back to a graticule-only sphere (no country outlines).
 * Idempotent: safe to include on multiple pages / more than once.
 */
(function () {
  if (window.__inveritasGlobeLoader) return;
  window.__inveritasGlobeLoader = true;

  const SIZE = 800;
  const CX = SIZE / 2, CY = SIZE / 2, R = SIZE / 2 - 24;

  let countries = { type: 'FeatureCollection', features: [] };
  (async () => {
    try {
      const res = await fetch('https://unpkg.com/world-atlas@2.0.2/countries-110m.json');
      const topo = await res.json();
      countries = topojsonToGeoJSON(topo, 'countries');
    } catch (e) { /* graceful: outlines just won't draw */ }
  })();

  function topojsonToGeoJSON(topo, name) {
    const obj = topo.objects[name];
    const t = topo.transform, arcs = topo.arcs;
    const sx = t.scale[0], sy = t.scale[1], tx = t.translate[0], ty = t.translate[1];
    function decodeArc(i) {
      const rev = i < 0; if (rev) i = ~i;
      const a = arcs[i]; let x = 0, y = 0; const out = [];
      for (let k = 0; k < a.length; k++) { x += a[k][0]; y += a[k][1]; out.push([x*sx+tx, y*sy+ty]); }
      return rev ? out.slice().reverse() : out;
    }
    function stitch(arr) {
      const ring = [];
      for (let i = 0; i < arr.length; i++) {
        const seg = decodeArc(arr[i]);
        if (i === 0) ring.push(...seg); else ring.push(...seg.slice(1));
      }
      return ring;
    }
    function geom(g) {
      if (g.type === 'Polygon') return g.arcs.map(stitch);
      if (g.type === 'MultiPolygon') return g.arcs.map(p => p.map(stitch));
      return null;
    }
    return {
      type: 'FeatureCollection',
      features: (obj.geometries || [])
        .map(g => ({ type: 'Feature', geometry: g.type ? { type: g.type, coordinates: geom(g) } : null }))
        .filter(f => f.geometry)
    };
  }

  function project(lon, lat, lambda) {
    const phi = lat * Math.PI / 180;
    const lam = (lon + lambda) * Math.PI / 180;
    const cp = Math.cos(phi);
    return { x: CX + R * cp * Math.sin(lam), y: CY - R * Math.sin(phi), z: cp * Math.cos(lam) };
  }

  // City ping anchors — federal districts + global anchors
  const CITIES = [
    [-77.0369, 38.9072], [-73.9857, 40.7484], [-87.6298, 41.8781],
    [-95.3698, 29.7604], [-122.4194, 37.7749], [-118.2437, 34.0522],
    [-71.0589, 42.3601], [-84.3880, 33.7490], [-104.9903, 39.7392],
    [-90.0715, 29.9511], [-122.3321, 47.6062], [-80.1918, 25.7617],
    [-0.1276, 51.5074], [2.3522, 48.8566], [139.6503, 35.6762],
    [151.2093, -33.8688], [28.0473, -26.2041], [-46.6333, -23.5505]
  ];
  function lonLatToVec(lon, lat) {
    const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
    return [Math.cos(phi)*Math.cos(lam), Math.cos(phi)*Math.sin(lam), Math.sin(phi)];
  }
  function vecToLonLat(v) {
    return [Math.atan2(v[1], v[0]) * 180 / Math.PI, Math.asin(v[2]) * 180 / Math.PI];
  }
  function slerp(a, b, t) {
    const dot = Math.max(-1, Math.min(1, a[0]*b[0]+a[1]*b[1]+a[2]*b[2]));
    const omega = Math.acos(dot);
    if (omega < 1e-6) return a;
    const so = Math.sin(omega);
    const k1 = Math.sin((1-t)*omega)/so, k2 = Math.sin(t*omega)/so;
    return [a[0]*k1+b[0]*k2, a[1]*k1+b[1]*k2, a[2]*k1+b[2]*k2];
  }
  function withAlpha(color, a) {
    if (color.startsWith('#')) {
      let c = color.slice(1);
      if (c.length === 3) c = c.split('').map(x => x+x).join('');
      const r = parseInt(c.slice(0,2),16), g=parseInt(c.slice(2,4),16), b=parseInt(c.slice(4,6),16);
      return `rgba(${r},${g},${b},${a})`;
    }
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(',').map(s => s.trim());
      return `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`;
    }
    return color;
  }
  function makeArcPool(n) {
    const pool = [];
    for (let i = 0; i < n; i++) {
      const a = CITIES[Math.floor(Math.random()*CITIES.length)];
      let b; do { b = CITIES[Math.floor(Math.random()*CITIES.length)]; } while (b === a);
      pool.push({ a, b, launch: (i / n) * 12000 + Math.random()*1500, period: 12000, duration: 2200 });
    }
    return pool;
  }

  function bindCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const host = canvas.closest('.iv-globe-loader');
    const cs = getComputedStyle(host);
    const INK  = cs.getPropertyValue('--iv-ink').trim()       || '#D4A843';
    const SOFT = cs.getPropertyValue('--iv-ink-soft').trim()  || 'rgba(212,168,67,0.55)';
    const GRAT = cs.getPropertyValue('--iv-ink-faint').trim() || 'rgba(212,168,67,0.22)';
    const FILL = cs.getPropertyValue('--iv-fill').trim()      || 'rgba(212,168,67,0.05)';
    const HI   = cs.getPropertyValue('--iv-highlight').trim() || '#FFD97A';
    const arcs = makeArcPool(7);

    function drawCurve(fn, steps) {
      const STEPS = steps || 120;
      let pen = false;
      ctx.beginPath();
      for (let i = 0; i <= STEPS; i++) {
        const p = fn(i/STEPS);
        if (p.z > 0) {
          if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y);
        } else if (pen) { ctx.stroke(); ctx.beginPath(); pen = false; }
      }
      if (pen) ctx.stroke();
    }
    function drawRing(ring, lambda, sw, color) {
      const segs = []; let cur = null;
      for (let i = 0; i < ring.length; i++) {
        const [lon, lat] = ring[i];
        const p = project(lon, lat, lambda);
        if (p.z > 0) { if (!cur) { cur = []; segs.push(cur); } cur.push(p); } else cur = null;
      }
      if (!segs.length) return;
      ctx.lineWidth = sw; ctx.strokeStyle = color; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const s of segs) {
        if (s.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(s[0].x, s[0].y);
        for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
        ctx.stroke();
      }
    }
    function drawArcPing(arc, now, lambda) {
      const elapsed = ((now - arc.launch) % arc.period + arc.period) % arc.period;
      if (elapsed > arc.duration) return;
      const t = elapsed / arc.duration;
      const headT = Math.min(1, t);
      const tailT = Math.max(0, t - 0.35);
      const va = lonLatToVec(arc.a[0], arc.a[1]);
      const vb = lonLatToVec(arc.b[0], arc.b[1]);
      const STEPS = 28;
      const pts = [];
      for (let i = 0; i <= STEPS; i++) {
        const s = tailT + (headT - tailT) * (i / STEPS);
        if (s < 0 || s > 1) { pts.push(null); continue; }
        const v = slerp(va, vb, s);
        const ll = vecToLonLat(v);
        const arch = Math.sin(s * Math.PI) * 0.18;
        const p = project(ll[0], ll[1], lambda);
        if (p.z <= 0) { pts.push(null); continue; }
        const dx = p.x - CX, dy = p.y - CY, len = Math.hypot(dx, dy) || 1;
        const lift = R * arch;
        pts.push({ x: p.x + (dx/len)*lift, y: p.y + (dy/len)*lift, alphaMul: Math.min(1, p.z*2) });
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i-1], b = pts[i]; if (!a || !b) continue;
        const u = i / pts.length;
        const alpha = (0.15 + u*0.85) * Math.min(a.alphaMul, b.alphaMul);
        ctx.strokeStyle = withAlpha(HI, alpha);
        ctx.lineWidth = 1.2 + u*1.8;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      const head = pts[pts.length - 1];
      if (head) {
        ctx.beginPath(); ctx.fillStyle = withAlpha(HI, 0.95*head.alphaMul);
        ctx.arc(head.x, head.y, 2.6, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.fillStyle = withAlpha(HI, 0.18*head.alphaMul);
        ctx.arc(head.x, head.y, 6.5, 0, Math.PI*2); ctx.fill();
      }
      if (t < 0.18) {
        const o = project(arc.a[0], arc.a[1], lambda);
        if (o.z > 0) {
          const k = t/0.18;
          ctx.beginPath(); ctx.strokeStyle = withAlpha(HI, 0.6*(1-k)); ctx.lineWidth = 1.5;
          ctx.arc(o.x, o.y, 3 + k*14, 0, Math.PI*2); ctx.stroke();
        }
      }
      if (t > 0.82) {
        const d = project(arc.b[0], arc.b[1], lambda);
        if (d.z > 0) {
          const k = (t-0.82)/0.18;
          ctx.beginPath(); ctx.strokeStyle = withAlpha(HI, 0.7*(1-k)); ctx.lineWidth = 1.5;
          ctx.arc(d.x, d.y, 3 + k*14, 0, Math.PI*2); ctx.stroke();
        }
      }
    }
    function drawCityDots(lambda) {
      for (const c of CITIES) {
        const p = project(c[0], c[1], lambda);
        if (p.z > 0) {
          ctx.beginPath();
          ctx.fillStyle = withAlpha(SOFT, 0.7 * Math.min(1, p.z*2));
          ctx.arc(p.x, p.y, 1.6, 0, Math.PI*2); ctx.fill();
        }
      }
    }

    function frame(now) {
      const t = (now % 32000) / 32000;
      const lambda = t * 360;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI*2);
      ctx.fillStyle = FILL; ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = INK; ctx.stroke();
      ctx.strokeStyle = GRAT; ctx.lineWidth = 1.5;
      for (let lon = -180; lon < 180; lon += 30) drawCurve(tt => project(lon, -90 + tt*180, lambda));
      for (let lat = -60; lat <= 60; lat += 30)  drawCurve(tt => project(-180 + tt*360, lat, lambda));
      for (const f of countries.features) {
        const g = f.geometry;
        if (g.type === 'Polygon') for (const r of g.coordinates) drawRing(r, lambda, 2.2, INK);
        else if (g.type === 'MultiPolygon') for (const p of g.coordinates) for (const r of p) drawRing(r, lambda, 2.2, INK);
      }
      drawCityDots(lambda);
      for (const a of arcs) drawArcPing(a, now, lambda);
      ctx.save();
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI*2); ctx.clip();
      const grd = ctx.createRadialGradient(CX-R*0.35, CY-R*0.35, R*0.1, CX, CY, R);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.restore();
      ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI*2);
      ctx.lineWidth = 3.5; ctx.strokeStyle = INK; ctx.stroke();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function init() {
    document.querySelectorAll('canvas[data-iv-globe]').forEach(bindCanvas);
    const pre = document.getElementById('inveritas-preloader');
    if (pre) {
      const dismiss = () => setTimeout(() => pre.classList.add('iv-dismissed'), 1500);
      if (document.readyState === 'complete') dismiss();
      else window.addEventListener('load', dismiss, { once: true });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
