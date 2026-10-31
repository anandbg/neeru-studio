/* Neeru Studio: easy-to-see mode and more colour choices.
   Loaded after the main script, so it can use shapes, selected, tool, target, fill, stroke, setColour and render. */

const store = {
  get(k, d) { try { const v = localStorage.getItem('neeru-' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('neeru-' + k, JSON.stringify(v)); } catch (_) { /* private window: carry on */ } },
};

/* ---------- big cursor ---------- */
const CURSOR_PX = { 1: 0, 2: 64, 3: 96 };                    // 0 = the normal system cursor
function cursorUrl(svg, px, hx, hy) {
  const uri = 'data:image/svg+xml,' + encodeURIComponent(svg.replace('{px}', px));
  return `url("${uri}") ${Math.round(hx * px / 32)} ${Math.round(hy * px / 32)}`;
}
const ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 32 32"><path d="M3 2 L3 26 L9 20.5 L13.5 30 L18 28 L13.5 18.5 L22 18.5 Z" fill="#ffe600" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/></svg>`;
const CROSS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 32 32"><g stroke="#000" stroke-width="5" stroke-linecap="round"><path d="M16 2 V12 M16 20 V30 M2 16 H12 M20 16 H30"/></g><g stroke="#ffe600" stroke-width="2.4" stroke-linecap="round"><path d="M16 2 V12 M16 20 V30 M2 16 H12 M20 16 H30"/></g><circle cx="16" cy="16" r="2.2" fill="#e63946" stroke="#000" stroke-width="1"/></svg>`;
let cursorLevel = store.get('cursor', 2);
const cursorStyle = document.createElement('style'); document.head.appendChild(cursorStyle);

function applyCursor() {
  const px = CURSOR_PX[cursorLevel];
  document.querySelectorAll('[data-cur]').forEach(b => b.classList.toggle('on', +b.dataset.cur === cursorLevel));
  if (!px) { cursorStyle.textContent = ''; return; }
  const arrow = cursorUrl(ARROW_SVG, px, 3, 2), cross = cursorUrl(CROSS_SVG, px, 16, 16);
  const drawing = ['pen', 'line', 'rect', 'ellipse', 'star', 'poly', 'custom'].includes(tool) || picking;
  cursorStyle.textContent =
    `body, body * { cursor: ${arrow}, auto !important; } canvas#art { cursor: ${drawing ? cross : arrow}, crosshair !important; }`;
}
document.querySelectorAll('[data-cur]').forEach(b => b.onclick = () => { cursorLevel = +b.dataset.cur; store.set('cursor', cursorLevel); applyCursor(); });
document.querySelectorAll('#tools button').forEach(b => b.addEventListener('click', applyCursor));
document.getElementById('eyedrop').addEventListener('click', applyCursor);
applyCursor();

/* ---------- click ripple: every click shows a big ring, so it is clear the click landed ---------- */
document.addEventListener('pointerdown', e => {
  if (cursorLevel === 1) return;
  const r = document.createElement('div'); r.className = 'ripple';
  r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
  document.body.appendChild(r); setTimeout(() => r.remove(), 700);
}, true);

/* ---------- say what is selected, in large type ---------- */
const NAMES = { rect: 'rectangle', ellipse: 'circle or oval', line: 'line', star: 'star', poly: 'polygon', custom: 'custom shape', pen: 'pen line', text: 'text', pin: 'pin', map: 'map' };
const selBar = document.getElementById('selBar');
function describe() {
  if (tool !== 'select') return `Tool: ${NAMES[tool] || tool}. Pick the arrow tool at the top left to select shapes.`;
  const s = shapes[selected];
  if (!s) return 'Click a shape to select it. A blue dashed line will go round it.';
  return `Selected: ${s.name || s.text || NAMES[s.type] || s.type}. Drag to move. Pick a colour to recolour. Press Delete to remove.`;
}
let hover = null;
const prevRender = render;
render = function () {                                    // keep the one render function, add the extras after it
  prevRender();
  if (tool === 'select' && hover !== null && hover !== selected && shapes[hover]) {
    const s = shapes[hover]; ctx.save(); ctx.translate(s.dx || 0, s.dy || 0);
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,200,0,.85)'; ctx.stroke(pathOf(s)); ctx.restore();
  }
  selBar.textContent = describe();
  selBar.classList.toggle('has', tool === 'select' && !!shapes[selected]);
};
art.addEventListener('pointermove', e => {
  if (tool !== 'select' || dragging) return;
  const [x, y] = pos(e); let h = null;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]; if (s.type === 'text') continue;
    ctx.save(); ctx.translate(s.dx || 0, s.dy || 0);
    const hit = ctx.isPointInPath(pathOf(s), x, y); ctx.restore();
    if (hit) { h = i; break; }
  }
  if (h !== hover) { hover = h; render(); }
});
art.addEventListener('pointerleave', () => { if (hover !== null) { hover = null; render(); } });
document.querySelectorAll('#tools button').forEach(b => b.addEventListener('click', () => { hover = null; render(); }));

/* ---------- colour palettes ---------- */
const PALETTES = {
  'Basic': ['#000000','#ffffff','#e63946','#f4a261','#ffd60a','#2a9d8f','#06d6a0','#118ab2','#3a86ff','#6c4cf5','#c77dff','#ff70a6','#8d99ae','#5c4033','#2b2d42','#ffb4a2','#b5e48c','#a2d2ff'],
  'Bright': ['#ff0000','#ff7f00','#ffd400','#7fff00','#00c853','#00e5ff','#0091ff','#2962ff','#651fff','#d500f9','#ff1744','#f50057','#ffea00','#76ff03','#1de9b6','#00b0ff','#aa00ff','#ff6d00'],
  'Soft': ['#ffd6a5','#fdffb6','#caffbf','#9bf6ff','#a0c4ff','#bdb2ff','#ffc6ff','#ffadad','#b5e48c','#f1c0e8','#cfbaf0','#a3c4f3','#90dbf4','#8eecf5','#98f5e1','#b9fbc0','#fbf8cc','#fde4cf'],
  'Earth': ['#3e2723','#5d4037','#8d6e63','#bcaaa4','#d7ccc8','#a1887f','#6b4f2a','#c19a6b','#e6c9a8','#556b2f','#6b8e23','#8f9779','#bfa87c','#7b3f00','#a0522d','#cd853f','#deb887','#f5deb3'],
  'Skin tones': ['#fff0e1','#ffe0bd','#f1c27d','#e0ac69','#c68642','#a47148','#8d5524','#6f4518','#4a2c12','#3b2219','#fbd5c0','#eab78b','#d19a6a','#b87a4b','#94603a','#754a2b','#5a3a22','#2f1b10'],
  'Greys': ['#ffffff','#f5f5f5','#e0e0e0','#bdbdbd','#9e9e9e','#757575','#616161','#424242','#212121','#000000','#eceff1','#cfd8dc','#b0bec5','#90a4ae','#78909c','#607d8b','#455a64','#263238'],
  'Sea and sky': ['#e0f7fa','#b2ebf2','#80deea','#4dd0e1','#26c6da','#00acc1','#0097a7','#00838f','#006064','#e3f2fd','#90caf9','#42a5f5','#1e88e5','#1565c0','#0d47a1','#c8e6c9','#66bb6a','#2e7d32'],
  'Map colours': ['#8dd3c7','#ffffb3','#bebada','#fb8072','#80b1d3','#fdb462','#b3de69','#fccde5','#d9d9d9','#bc80bd','#ccebc5','#ffed6f','#a6cee3','#1f78b4','#b2df8a','#33a02c','#fb9a99','#e31a1c'],
  'Easy for colour-blind': ['#000000','#e69f00','#56b4e9','#009e73','#f0e442','#0072b2','#d55e00','#cc79a7','#ffffff','#999999','#332288','#88ccee','#44aa99','#117733','#ddcc77','#cc6677','#aa4499','#882255'],
};
const hexToHsl = hx => {
  const n = parseInt(hx.slice(1), 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, s * 100, l * 100];
};
const hslHex = (h, s, l) => toHex(hsl2rgb(((h % 360) + 360) % 360, Math.max(0, Math.min(100, s)), Math.max(0, Math.min(100, l))));
const activeColour = () => (target === 'fill' ? fill : stroke);
const MAKERS = {
  'Shades of this colour': () => { const [h, s] = hexToHsl(activeColour()); return [...Array(18)].map((_, i) => hslHex(h, s, 6 + i * 5.3)); },
  'Partners for this colour': () => {
    const [h, s, l] = hexToHsl(activeColour());
    return [180, 150, 210, 120, 240, 30, 330, 60, 300].flatMap(d => [hslHex(h + d, s, l), hslHex(h + d, s, Math.min(92, l + 22))]);
  },
};
const paletteNames = [...Object.keys(PALETTES), ...Object.keys(MAKERS)];
let palette = store.get('palette', 'Basic'); if (!paletteNames.includes(palette)) palette = 'Basic';
let recent = store.get('recent', []), saved = store.get('saved', []);

const sw = document.getElementById('swatches'), palSel = document.getElementById('palSel');
paletteNames.forEach(n => palSel.add(new Option(n, n)));
palSel.value = palette;

function chip(hx, onclick) {
  const d = document.createElement('div'); d.style.background = hx; d.title = hx; d.tabIndex = 0; d.onclick = onclick;
  d.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onclick(); } };
  if (hx.toLowerCase() === activeColour().toLowerCase()) d.classList.add('cur');
  return d;
}
function rememberColour(hx) { recent = [hx, ...recent.filter(c => c !== hx)].slice(0, 12); store.set('recent', recent); drawChips(); }
function drawChips() {
  const list = PALETTES[palette] || MAKERS[palette]();
  sw.replaceChildren(...list.map(c => chip(c, () => { setColour(c); rememberColour(c); })));
  document.getElementById('recent').replaceChildren(...recent.map(c => chip(c, () => setColour(c))));
  document.getElementById('saved').replaceChildren(...saved.map(c => { const d = chip(c, () => setColour(c)); d.title = c + ' (double-click to remove)'; d.ondblclick = () => { saved = saved.filter(x => x !== c); store.set('saved', saved); drawChips(); }; return d; }));
  document.getElementById('nativeCol').value = activeColour().length === 7 ? activeColour() : '#000000';
}
palSel.onchange = () => { palette = palSel.value; store.set('palette', palette); drawChips(); };
document.getElementById('saveCol').onclick = () => { const c = activeColour(); if (!saved.includes(c)) { saved = [c, ...saved].slice(0, 18); store.set('saved', saved); } drawChips(); };
const nat = document.getElementById('nativeCol');
nat.oninput = () => setColour(nat.value);
nat.onchange = () => rememberColour(nat.value);

/* keep the chips in step with the colour, and remember what you settled on */
const baseSetColour = setColour; let settle = null;
setColour = function (hx) {
  baseSetColour(hx); drawChips();
  clearTimeout(settle); settle = setTimeout(() => { if (!recent.includes(hx)) rememberColour(hx); }, 900);
};
document.getElementById('setFill').addEventListener('click', drawChips);
document.getElementById('setStroke').addEventListener('click', drawChips);
drawChips(); render();
