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

/* Free models are shared and often busy upstream, so try these in order.
   vision: whether the model can look at the canvas image. */
const FALLBACKS = [
  { id: 'google/gemma-4-31b-it:free', vision: true },
  { id: 'google/gemma-4-26b-a4b-it:free', vision: true },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', vision: false },
];
const RETRYABLE = [408, 429, 500, 502, 503, 504];

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
    const { drawn, cells } = applyActions(reply.actions);
    status.textContent = (reply.say ? reply.say + ' ' : '') + `(${drawn} shapes, ${cells} cells · ${reply.model.split('/')[1].replace(':free', '')})`;
    aiInput.value = '';
  } catch (err) {
    status.textContent = '⚠️ ' + err.message;
  } finally {
    setBusy(false);
  }
};

/* ---------- voice input ----------
   Uses the browser's built-in speech recognition (Chrome, Edge, Safari).
   Free, no key. Words appear as you speak; when you stop, it asks the AI. */
const mic = document.getElementById('aiMic');
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Speech) {
  mic.title = 'Voice needs Chrome, Edge or Safari';
  mic.onclick = () => { status.textContent = '⚠️ Voice input needs Chrome, Edge or Safari.'; };
} else {
  let rec = null;
  mic.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new Speech();
    rec.lang = navigator.language || 'en-GB';
    rec.interimResults = true;
    const input = document.getElementById('aiText');
    let finalText = '';
    rec.onstart = () => { mic.classList.add('listening'); status.textContent = 'Listening… speak now.'; };
    rec.onresult = e => {
      let interim = '';
      for (const r of e.results) (r.isFinal ? (finalText = r[0].transcript) : (interim += r[0].transcript));
      input.value = finalText || interim;
    };
    rec.onerror = e => {
      status.textContent = e.error === 'not-allowed'
        ? '⚠️ Microphone blocked. Allow it in the browser address bar.'
        : e.error === 'no-speech' ? 'Didn’t hear anything. Tap 🎤 and try again.' : '⚠️ Voice error: ' + e.error;
    };
    rec.onend = () => {
      mic.classList.remove('listening'); rec = null;   // the submit below then locks the mic until the AI replies
      if (finalText.trim()) document.getElementById('aiForm').requestSubmit();
    };
    rec.start();
  };
}
