/* Neeru Studio: AI command box.
   Sends the request to OpenRouter, gets back JSON actions, and applies them
   to the canvas or the sheet. Uses the globals from index.html:
   shapes, render, art, raw, refresh, COLS, ROWS. */

// The key lives in a private server function (see ../proxy), never in this page.
const AI_PROXY_URL = 'https://neeru-studio-api.vercel.app/api/ai';
const SHAPE_TYPES = ['rect', 'ellipse', 'line', 'star', 'poly', 'custom', 'pen'];
const str = (v, max = 120) => String(v ?? '').slice(0, max);

const SYSTEM_PROMPT = `You control a drawing and spreadsheet app. Reply with ONLY a JSON object, no prose:
{"say": "<one short friendly sentence>", "actions": [ ... ]}

Canvas is ${art.width} wide and ${art.height} high. (0,0) is top-left. Draw back-to-front: background shapes first.
Shape actions:
 {"do":"shape","type":"rect","x":10,"y":10,"w":100,"h":50,"fill":"#hex","stroke":"#hex","width":3}
 {"do":"shape","type":"ellipse","x":..,"y":..,"w":..,"h":..,"fill":..,"stroke":..,"width":..}   (x,y = top-left of its box)
 {"do":"shape","type":"line","x1":..,"y1":..,"x2":..,"y2":..,"stroke":..,"width":..}
 {"do":"shape","type":"star","cx":..,"cy":..,"r":..,"points":5,"fill":..,"stroke":..,"width":..}
 {"do":"shape","type":"poly","cx":..,"cy":..,"r":..,"sides":6,"fill":..,"stroke":..,"width":..}
 {"do":"shape","type":"custom","points":[[x,y],[x,y],...],"fill":..,"stroke":..,"width":..}   (closed shape, use for mountains, waves, leaves, any outline)
 {"do":"shape","type":"pen","points":[[x,y],...],"stroke":..,"width":..}   (open line)
 "fill": null means no fill.
 {"do":"clear_canvas"}   only if the user asks to start again.

Geography (real map data, accurate borders; NEVER draw countries or coastlines with custom shapes):
 {"do":"map","focus":"world" | a country name | a region,"highlight":[{"name":"Iceland","colour":"#e63946"}],"land":"#f1ead7","sea":"#cfe8f7"}
   regions: europe, asia, africa, north america, south america, oceania, middle east, south asia, southeast asia, caribbean, scandinavia, arctic, antarctica.
   A map fills the whole canvas and replaces the previous one. Put it FIRST, before pins.
   To show where a country is, use focus "world" (or its region) and highlight it. For "a map of India", use focus "India".
 {"do":"editable_map","country":"India","iso3":"IND"}   draws the country's states/regions as separate editable shapes (the user can move, recolour and delete each one).
   Use this when the user asks for "the shape of" a country, its states, provinces, sections, parts, or says they want to edit it. iso3 = the 3-letter ISO code (IND, USA, FRA, BRA ...).
   Use plain "map" only for a picture they do not need to edit.
 {"do":"pin","lat":48.8584,"lon":2.2945,"label":"Eiffel Tower","colour":"#e63946"}   real coordinates, 4 decimals. Must come after a map.
   Use pins for cities, capitals, landmarks, mountains, rivers' sources and so on. Add several when it helps learning.
 {"do":"text","x":30,"y":20,"text":"Title","size":28,"colour":"#1d2129","bold":true}   for titles and fun facts.
 For geography requests, add a title and one short fun fact as text.

Sheet actions (columns A to ${String.fromCharCode(64 + COLS)}, rows 1 to ${ROWS}):
 {"do":"cell","id":"A1","value":"text, number or formula like =SUM(B2:B6)"}
 Formulas support + - * / and SUM, AVERAGE, MIN, MAX, COUNT over ranges.
 {"do":"clear_sheet"}   only if the user asks.

Use the sheet when the user asks for a table, list, budget or numbers. Otherwise draw.
Make drawings rich: use many shapes and good colours.`;

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : d);
const pts = v => (Array.isArray(v) ? v.filter(p => Array.isArray(p) && p.length >= 2).map(p => [num(p[0]), num(p[1])]) : []);

/* Convert one model action into the app's own shape format. Returns null if invalid. */
function toShape(a) {
  if (!SHAPE_TYPES.includes(a.type)) return null;
  const base = {
    type: a.type,
    fill: a.fill === null ? null : hex(a.fill, null),
    stroke: hex(a.stroke, '#1d2129'),
    w: Math.min(40, Math.max(1, num(a.width, 3))),
  };
  switch (a.type) {
    case 'rect': case 'ellipse': {
      const x = num(a.x), y = num(a.y);
      return { ...base, a: [x, y], b: [x + num(a.w, 50), y + num(a.h, 50)] };
    }
    case 'line':
      return { ...base, fill: null, a: [num(a.x1), num(a.y1)], b: [num(a.x2), num(a.y2)] };
    case 'star': case 'poly': {
      const cx = num(a.cx), cy = num(a.cy), n = Math.min(20, Math.max(3, num(a.points ?? a.sides, 5)));
      return { ...base, a: [cx, cy], b: [cx, cy - num(a.r, 40)], n };
    }
    default: {
      const p = pts(a.points);
      if (p.length < 2) return null;
      return a.type === 'pen' ? { ...base, fill: null, pts: p } : { ...base, pts: p, open: false };
    }
  }
}

/* Pull the JSON object out of the reply, even if the model wrapped it in a code fence. */
function parseReply(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('The AI did not send any instructions.');
  const obj = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(obj.actions)) throw new Error('The AI reply had no actions list.');
  return obj;
}

const pendingMaps = [];
function applyActions(actions) {
  let drawn = 0, cells = 0;
  for (const a of actions) {
    if (a?.do === 'clear_canvas') shapes.length = 0;
    else if (a?.do === 'clear_sheet') Object.keys(raw).forEach(k => delete raw[k]);
    else if (a?.do === 'shape') { const s = toShape(a); if (s) { shapes.push(s); drawn++; } }
    else if (a?.do === 'map') {
      for (let i = shapes.length - 1; i >= 0; i--) if (shapes[i].type === 'map' || shapes[i].type === 'pin') shapes.splice(i, 1);
      const hl = Array.isArray(a.highlight) ? a.highlight.slice(0, 40).map(h => ({ name: str(h?.name ?? h, 60), colour: hex(h?.colour, '#e63946') })) : [];
      shapes.unshift({ type: 'map', focus: str(a.focus || 'world', 60), highlight: hl, land: hex(a.land, undefined), sea: hex(a.sea, undefined) });
      drawn++;
    }
    else if (a?.do === 'editable_map' && /^[A-Za-z]{3}$/.test(a.iso3 || '')) {
      pendingMaps.push(buildEditableMap(str(a.country, 60), String(a.iso3).toUpperCase())); drawn++;
    }
    else if (a?.do === 'pin' && Number.isFinite(+a.lat) && Number.isFinite(+a.lon)) {
      shapes.push({ type: 'pin', lat: +a.lat, lon: +a.lon, label: str(a.label, 60), colour: hex(a.colour, '#e63946') }); drawn++;
    }
    else if (a?.do === 'text' && a.text) {
      shapes.push({ type: 'text', x: num(a.x, 30), y: num(a.y, 20), text: str(a.text, 200), size: Math.min(96, Math.max(10, num(a.size, 24))), colour: hex(a.colour, '#1d2129'), bold: !!a.bold }); drawn++;
    }
    else if (a?.do === 'cell' && /^[A-Z]\d{1,3}$/.test(a.id || '')) { raw[a.id] = String(a.value ?? ''); cells++; }
  }
  render(); refresh();
  if (typeof loadGeo === 'function' && shapes.some(s => s.type === 'map')) loadGeo().then(render).catch(() => {});
  if (cells && !drawn) document.querySelector('.tabs button[data-v="sheet"]').click();
  if (drawn && !cells) document.querySelector('.tabs button[data-v="draw"]').click();
  return { drawn, cells };
}


/* ---------- editable country map ----------
   Each state or region becomes its own ordinary shape, so the select tool can move it,
   the colour controls can recolour it and Delete can remove it.
   Borders: geoBoundaries (CC BY 4.0), level ADM1, fetched when asked. */
const PASTELS = ['#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#ffadad', '#b5e48c', '#f1c0e8'];

function thin(ring, minGap) {
  const out = [ring[0]];
  for (const p of ring) { const q = out[out.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= minGap) out.push(p); }
  return out;
}
const areaOf = r => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

async function buildEditableMap(country, iso3) {
  const info = await (await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM1/`)).json();
  const url = info.simplifiedGeometryGeoJSON || info.gjDownloadURL;
  if (!url) throw new Error('No region borders found for ' + iso3);
  // github.com/raw redirects without CORS headers; the media host it redirects to allows browsers
  const direct = url.replace('https://github.com/wmgeolab/geoBoundaries/raw/', 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/');
  const gj = await (await fetch(direct)).json();
  // fit to the corner points (the file's ring direction would confuse d3's polygon fitting)
  let w = 180, s = 90, e = -180, n = -90;
  const scan = c => Array.isArray(c[0]) ? c.forEach(scan) : (w = Math.min(w, c[0]), e = Math.max(e, c[0]), s = Math.min(s, c[1]), n = Math.max(n, c[1]));
  gj.features.forEach(f => scan(f.geometry.coordinates));
  const proj = d3.geoMercator().fitExtent([[50, 70], [art.width - 50, art.height - 50]], { type: 'MultiPoint', coordinates: [[w, s], [e, n], [w, n], [e, s]] });
  const toPx = ring => ring.map(c => proj(c));
  let made = 0;
  gj.features.forEach((f, i) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.map(p => { const px = toPx(p[0]), t = thin(px, 1.2); return t.length >= 3 ? t : px; }).filter(r => r.length >= 3).sort((x, y) => areaOf(y) - areaOf(x));
    const name = f.properties.shapeName || '';
    rings.forEach((ring, k) => {
      if (k > 0 && areaOf(ring) < 8) return;                         // drop specks, always keep the main part
      shapes.push({ type: 'custom', pts: ring, open: false, fill: PASTELS[i % PASTELS.length], stroke: '#1d2129', w: 1.5, name });
      made++;
    });
    if (rings[0] && areaOf(rings[0]) > 900) {                        // label the big ones
      const [cx, cy] = d3.polygonCentroid(rings[0]);
      shapes.push({ type: 'text', x: cx - name.length * 3, y: cy + 4, text: name, size: 12, colour: '#1d2129', bold: false });
    }
  });
  shapes.push({ type: 'text', x: 30, y: 36, text: country || 'Map', size: 28, colour: '#1d2129', bold: true });
  render();
  return made;
}

/* Free models are shared and often busy upstream, so try these in order.
   vision: whether the model can look at the canvas image. */
const FALLBACKS = [
  { id: 'google/gemma-4-31b-it:free', vision: true },
  { id: 'google/gemma-4-26b-a4b-it:free', vision: true },
  { id: 'nvidia/nemotron-3.5-super-vl:free', vision: true },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', vision: false },
];
const RETRYABLE = [404, 408, 429, 500, 502, 503, 504];

async function callModel(model, prompt, image) {
  const content = [{ type: 'text', text: prompt }];
  if (image) content.push({ type: 'image_url', image_url: { url: image } });
  const res = await fetch(AI_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }],
      temperature: 0.4,
    }),
  });
  const data = await res.json().catch(() => ({}));
  const text = data?.choices?.[0]?.message?.content;
  if (res.ok && text) return { ok: true, text };
  const raw = data?.error?.metadata?.raw || data?.error?.message || res.statusText;
  return { ok: false, status: res.status || 502, msg: String(raw) };
}

async function askAI(prompt) {
  const models = FALLBACKS;
  await (typeof loadGeo === 'function' ? loadGeo().catch(() => {}) : null);
  const see = shapes.length > 0;
  const image = see ? art.toDataURL('image/png') : null;
  let last = null;
  for (const m of models) {
    status.textContent = 'AI is working on it… asking ' + m.id.split('/')[1].replace(':free', '');
    const useImage = image && m.vision;
    const text = prompt + (useImage ? `\n(The image is the current canvas. It already has ${shapes.length} shapes.)`
      : see ? `\n(The canvas already has ${shapes.length} shapes; add to it.)` : '');
    const r = await callModel(m.id, text, useImage ? image : null);
    if (r.ok) {
      try { return { ...parseReply(r.text), model: m.id }; }
      catch (e) { last = { status: 0, msg: e.message }; continue; }   // bad JSON: try the next model
    }
    last = r;
    if (!RETRYABLE.includes(r.status)) break;
  }
  if (last?.status === 429) throw new Error('All the free models are busy right now. Try again in a minute.');
  throw new Error('AI error: ' + (last?.msg || 'no reply'));
}

/* ---------- UI ---------- */
const status = document.getElementById('aiStatus');
const go = document.getElementById('aiGo'), aiInput = document.getElementById('aiText');
let busyTimer = null;

/* While the AI works, lock Ask AI, the mic and the text box, and show it is working:
   a spinner with a seconds counter in the button and a moving bar under the header. */
function setBusy(on) {
  go.disabled = on; mic.disabled = on; aiInput.readOnly = on;
  go.classList.toggle('busy', on); status.classList.toggle('busy', on);
  document.getElementById('aiBar').classList.toggle('on', on);
  clearInterval(busyTimer);
  if (on) {
    const t0 = Date.now();
    const tick = () => { go.innerHTML = `<span class="spin"></span>Working… ${Math.round((Date.now() - t0) / 1000)}s`; };
    tick(); busyTimer = setInterval(tick, 1000);
  } else go.textContent = '✨ Ask AI';
}

document.getElementById('aiForm').onsubmit = async e => {
  e.preventDefault();
  const prompt = aiInput.value.trim();
  if (!prompt || go.disabled) return;
  setBusy(true); status.textContent = 'Thinking…';
  try {
    const reply = await askAI(prompt);
    pendingMaps.length = 0;
    const { drawn, cells } = applyActions(reply.actions);
    if (pendingMaps.length) { status.textContent = 'Fetching the real borders…'; await Promise.all(pendingMaps); }
    status.textContent = (reply.say ? reply.say + ' ' : '') + `(${drawn} shapes, ${cells} cells · ${reply.model.split('/')[1].replace(':free', '')})`;
    aiInput.value = '';
  } catch (err) {
    status.textContent = '⚠️ ' + err.message;
  } finally {
    setBusy(false);
  }
};

/* ---------- voice input ----------
   Uses the browser's built-in speech recognition (Chrome, Edge, Safari). Free, no key.
   It keeps listening through silence. Nothing is sent until YOU press the mic again (or Ask AI). */
const mic = document.getElementById('aiMic');
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Speech) {
  mic.title = 'Voice needs Chrome, Edge or Safari';
  mic.onclick = () => { status.textContent = '⚠️ Voice input needs Chrome, Edge or Safari.'; };
} else {
  let rec = null, stopping = false, sendOnStop = false, said = '';
  const input = document.getElementById('aiText');
  const form = document.getElementById('aiForm');

  function listen() {
    const r = new Speech();
    rec = r;
    r.lang = navigator.language || 'en-GB';
    r.interimResults = true;
    r.continuous = true;
    let heard = '';                                                    // this run only
    r.onstart = () => { mic.classList.add('listening'); status.textContent = 'Listening… press 🎤 again when you are done.'; };
    r.onresult = e => {
      heard = [...e.results].map(x => x[0].transcript).join(' ');
      input.value = (said + ' ' + heard).trim();
    };
    r.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;   // silence is fine; onend restarts
      stopping = true;
      status.textContent = e.error === 'not-allowed' ? '⚠️ Microphone blocked. Allow it in the browser address bar.' : '⚠️ Voice error: ' + e.error;
    };
    r.onend = () => {
      said = (said + ' ' + heard).trim();
      if (!stopping) { try { listen(); return; } catch (_) { /* fall through and stop */ } }   // the browser ended it on its own: carry on
      rec = null; mic.classList.remove('listening');
      input.value = said;
      if (sendOnStop && said) form.requestSubmit();
      else if (!sendOnStop && !go.disabled) status.textContent = said ? 'Stopped. Press Ask AI to send.' : status.textContent;
    };
    r.start();
  }

  mic.onclick = () => {
    if (rec) { stopping = true; sendOnStop = true; status.textContent = 'Stopping…'; rec.stop(); return; }   // second press: stop, then send
    stopping = false; sendOnStop = false; said = input.value.trim();
    listen();
  };
  // pressing Ask AI while still listening: stop the mic without sending twice
  form.addEventListener('submit', () => { if (rec) { stopping = true; sendOnStop = false; rec.abort(); } }, true);
}
