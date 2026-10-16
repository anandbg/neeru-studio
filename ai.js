/* Neeru Studio: AI command box.
   Sends the request to OpenRouter, gets back JSON actions, and applies them
   to the canvas or the sheet. Uses the globals from index.html:
   shapes, render, art, raw, refresh, COLS, ROWS. */

const AI_DEFAULT_MODEL = 'google/gemma-4-31b-it:free';
const SHAPE_TYPES = ['rect', 'ellipse', 'line', 'star', 'poly', 'custom', 'pen'];

const store = {
  get: k => { try { return localStorage.getItem('neeru.' + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem('neeru.' + k, v); } catch { /* storage blocked */ } },
};

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
    else if (a?.do === 'cell' && /^[A-Z]\d{1,3}$/.test(a.id || '')) { raw[a.id] = String(a.value ?? ''); cells++; }
  }
  render(); refresh();
  if (cells && !drawn) document.querySelector('.tabs button[data-v="sheet"]').click();
  if (drawn && !cells) document.querySelector('.tabs button[data-v="draw"]').click();
  return { drawn, cells };
}

async function askAI(prompt) {
  const key = store.get('key');
  if (!key) { openSettings(); throw new Error('Add your OpenRouter key first.'); }
  const content = [{ type: 'text', text: prompt }];
  if (store.get('see') !== 'no' && shapes.length) {
    content.push({ type: 'image_url', image_url: { url: art.toDataURL('image/png') } });
    content[0].text += `\n(The image is the current canvas. It already has ${shapes.length} shapes.)`;
  }
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Neeru Studio' },
    body: JSON.stringify({
      model: store.get('model') || AI_DEFAULT_MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }],
      temperature: 0.4,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 429) throw new Error('Free limit reached for now (20 a minute, 50 a day). Try again later.');
    if (res.status === 401) throw new Error('The key was rejected. Check it in ⚙︎ settings.');
    throw new Error('AI error ' + res.status + ': ' + msg);
  }
  return parseReply(data?.choices?.[0]?.message?.content || '');
}

/* ---------- UI ---------- */
const status = document.getElementById('aiStatus'), dlg = document.getElementById('aiDlg');
function openSettings() {
  document.getElementById('aiKey').value = store.get('key') || '';
  document.getElementById('aiModel').value = store.get('model') || AI_DEFAULT_MODEL;
  document.getElementById('aiSee').checked = store.get('see') !== 'no';
  dlg.showModal();
}
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  store.set('key', document.getElementById('aiKey').value.trim());
  store.set('model', document.getElementById('aiModel').value.trim() || AI_DEFAULT_MODEL);
  store.set('see', document.getElementById('aiSee').checked ? 'yes' : 'no');
  status.textContent = 'Settings saved.';
});
document.getElementById('aiSet').onclick = openSettings;
document.getElementById('aiForm').onsubmit = async e => {
  e.preventDefault();
  const input = document.getElementById('aiText'), go = document.getElementById('aiGo');
  const prompt = input.value.trim();
  if (!prompt) return;
  go.disabled = true; status.textContent = 'Thinking…';
  try {
    const reply = await askAI(prompt);
    const { drawn, cells } = applyActions(reply.actions);
    status.textContent = (reply.say ? reply.say + ' ' : '') + `(${drawn} shapes, ${cells} cells)`;
    input.value = '';
  } catch (err) {
    status.textContent = '⚠️ ' + err.message;
  } finally {
    go.disabled = false;
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
      mic.classList.remove('listening'); rec = null;
      if (finalText.trim()) document.getElementById('aiForm').requestSubmit();
    };
    rec.start();
  };
}
