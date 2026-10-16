/* Neeru Studio: real maps.
   Country borders come from Natural Earth (public domain) via the world-atlas package.
   The AI never draws coastlines itself. It names a place and the app draws it accurately.
   Adds three shape types to the canvas: map, pin and text. */

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json';
let geo = null;          // { countries: FeatureCollection }
let geoReady = null;     // promise
let projection = null;   // projection of the most recent map, used to place pins

const ALIASES = {
  'usa': 'United States of America', 'us': 'United States of America', 'united states': 'United States of America',
  'america': 'United States of America', 'uk': 'United Kingdom', 'britain': 'United Kingdom', 'great britain': 'United Kingdom',
  'england': 'United Kingdom', 'scotland': 'United Kingdom', 'wales': 'United Kingdom', 'russia': 'Russia',
  'uae': 'United Arab Emirates', 'czech republic': 'Czechia', 'ivory coast': "Côte d'Ivoire", 'drc': 'Dem. Rep. Congo',
  'congo': 'Congo', 'south korea': 'South Korea', 'north korea': 'North Korea', 'holland': 'Netherlands',
  'bosnia': 'Bosnia and Herz.', 'dominican republic': 'Dominican Rep.', 'central african republic': 'Central African Rep.',
};
// [west, south, east, north] in degrees
const REGIONS = {
  'world': null,
  'europe': [-25, 34, 45, 71], 'asia': [25, -10, 150, 60], 'africa': [-20, -36, 53, 38],
  'north america': [-170, 7, -50, 75], 'south america': [-85, -56, -33, 13], 'oceania': [110, -48, 180, 0],
  'australia and oceania': [110, -48, 180, 0], 'middle east': [25, 12, 63, 42], 'south asia': [60, 5, 98, 38],
  'south east asia': [92, -11, 142, 28], 'southeast asia': [92, -11, 142, 28], 'caribbean': [-86, 10, -59, 27],
  'scandinavia': [4, 54, 32, 71], 'arctic': [-180, 60, 180, 90], 'antarctica': [-180, -90, 180, -60],
};

function loadGeo() {
  if (!geoReady) {
    geoReady = fetch(GEO_URL)
      .then(r => { if (!r.ok) throw new Error('map data ' + r.status); return r.json(); })
      .then(topo => { geo = { countries: topojson.feature(topo, topo.objects.countries) }; render(); })
      .catch(err => { console.error('Could not load map data', err); geoReady = null; throw err; });
  }
  return geoReady;
}

function findCountry(name) {
  if (!geo || !name) return null;
  const q = String(name).trim().toLowerCase();
  const target = (ALIASES[q] || q).toLowerCase();
  const all = geo.countries.features;
  return all.find(f => f.properties.name.toLowerCase() === target)
      || all.find(f => f.properties.name.toLowerCase().startsWith(target))
      || all.find(f => target.length > 3 && f.properties.name.toLowerCase().includes(target))
      || null;
}

function bboxFeature([w, s, e, n]) {
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } };
}

function makeProjection(focus) {
  const pad = 30, extent = [[pad, pad], [art.width - pad, art.height - pad]];
  const key = String(focus || 'world').trim().toLowerCase();
  if (key === 'world' || !geo) return d3.geoNaturalEarth1().fitExtent(extent, { type: 'Sphere' });
  if (REGIONS[key]) return d3.geoMercator().fitExtent(extent, bboxFeature(REGIONS[key]));
  const country = findCountry(key);
  if (country) return d3.geoMercator().fitExtent(extent, country);
  return d3.geoNaturalEarth1().fitExtent(extent, { type: 'Sphere' });
}

function drawMap(s) {
  if (!geo) { loadGeo(); ctx.fillStyle = '#667085'; ctx.font = '20px system-ui'; ctx.fillText('Loading map…', 40, 50); return; }
  projection = makeProjection(s.focus);
  const path = d3.geoPath(projection, ctx);
  const hi = new Map((s.highlight || []).map(h => [findCountry(h.name)?.properties.name, h.colour || '#e63946']));
  ctx.save();
  ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = s.sea || '#cfe8f7'; ctx.fill();
  ctx.beginPath(); path(d3.geoGraticule10()); ctx.strokeStyle = 'rgba(17,138,178,.15)'; ctx.lineWidth = 0.6; ctx.stroke();
  for (const f of geo.countries.features) {
    ctx.beginPath(); path(f);
    ctx.fillStyle = hi.get(f.properties.name) || s.land || '#f1ead7'; ctx.fill();
    ctx.strokeStyle = '#8d99ae'; ctx.lineWidth = 0.6; ctx.stroke();
  }
  // name each highlighted country at its centre
  ctx.font = '600 15px system-ui'; ctx.textAlign = 'center';
  for (const name of hi.keys()) {
    const f = findCountry(name); if (!f) continue;
    const [x, y] = d3.geoPath(projection).centroid(f);
    if (!Number.isFinite(x)) continue;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(f.properties.name, x, y);
    ctx.fillStyle = '#1d2129'; ctx.fillText(f.properties.name, x, y);
  }
  ctx.restore();
}

function pinXY(s) {
  const p = projection ? projection([s.lon, s.lat]) : null;
  return p && Number.isFinite(p[0]) ? p : null;
}

function drawPin(s) {
  const p = pinXY(s); if (!p) return;
  const [x, y] = p, c = s.colour || '#e63946';
  ctx.save();
  ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y - 16, 9, Math.PI * 0.8, Math.PI * 0.2); ctx.closePath();
  ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y - 16, 3.5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
  if (s.label) {
    ctx.font = '600 14px system-ui'; ctx.textAlign = 'left';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(s.label, x + 12, y - 12);
    ctx.fillStyle = '#1d2129'; ctx.fillText(s.label, x + 12, y - 12);
  }
  ctx.restore();
}

function drawText(s) {
  ctx.save();
  ctx.font = `${s.bold ? '700 ' : ''}${s.size || 24}px system-ui`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = s.colour || '#1d2129'; ctx.fillText(s.text || '', s.x || 0, s.y || 0);
  ctx.restore();
}

/* Hooks used by index.html's drawShape and pathOf */
const SPECIAL = { map: drawMap, pin: drawPin, text: drawText };
function drawSpecial(s) { const f = SPECIAL[s.type]; if (f) f(s); return !!f; }
function specialPath(s) {
  const p = new Path2D();
  if (s.type === 'pin') { const q = pinXY(s); if (q) p.arc(q[0], q[1] - 16, 12, 0, 7); }
  if (s.type === 'text') { p.rect(s.x || 0, s.y || 0, (s.text || '').length * (s.size || 24) * 0.55, (s.size || 24) * 1.2); }
  return p;   // a map has no hit area, so the move tool never grabs the whole map
}

loadGeo().catch(() => {});
