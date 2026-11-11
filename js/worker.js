// Simulation worker: owns the universe, steps it, and rasterises the visible part
// into a small byte texture that the main thread draws with WebGL.
'use strict';
importScripts('rules.js', 'tables.js', 'hashlife.js', 'dense.js', 'formats.js');

let engine = null, rule = null, spec = null;
let cfg = { kind: 'hash', w: 512, h: 512, maxNodes: 4 << 20 };
let playing = false, tps = 60, P = 0, nextT = 0;
let view = null, dirty = true, awaiting = false, awaitT = 0, wantBounds = false;
let rateT = 0, rateG = 0n, gps = 0, stepMs = 0, sched = false;

const ch = new MessageChannel();
ch.port1.onmessage = loop;
function kick() { if (!sched) { sched = true; ch.port2.postMessage(0); } }
const post = (m, t) => self.postMessage(m, t || []);
const fail = (e) => post({ type: 'error', message: (e && e.message) || (e && e.oom ? 'Out of memory: raise the HashLife memory budget' : String(e)) });

function makeEngine(keep) {
  let cells = null;
  if (keep && engine) {
    cells = [];
    engine.forEachCell((x, y, s) => { if (s < rule.states) cells.push(x, y, s); return cells.length < 9e6; });
  }
  let kind = cfg.kind;
  if (rule.needsFinite || !rule.f) kind = 'dense';
  engine = null; // let the old arrays go before allocating new ones
  engine = kind === 'hash' ? new CA.HashLife(rule, cfg.maxNodes) : new CA.DenseGrid(rule, cfg.w, cfg.h);
  engine.setStep(P);
  if (cells) for (let i = 0; i < cells.length; i += 3) engine.setCell(cells[i], cells[i + 1], cells[i + 2]);
  rateT = 0; gps = 0;
  post({
    type: 'ready', spec, engine: engine.kind, w: cfg.w, h: cfg.h,
    rule: { canonical: rule.canonical, states: rule.states, kind: rule.kind, names: rule.names || null, glyphs: rule.glyphs || null, colors: rule.colors || null, ltl: !!rule.ltl },
  });
  dirty = true;
}

function setup(m, keep) {
  const r = CA.compileRule(m.spec);
  rule = r; spec = m.spec;
  if (m.engine) cfg = Object.assign({}, cfg, m.engine);
  makeEngine(keep);
}

function ruleFromFile(name) {
  if (!name) return null;
  let t = name.trim().replace(/:[TPKSC]\d[\d,+*]*$/i, '');
  try { CA.compileRule({ type: 'string', text: t }, true); return { type: 'string', text: t }; }
  catch (e) { return null; }
}

function loadPattern(m) {
  let info = {};
  if (m.mc != null) {
    const rm = /^#R\s*(.+)$/m.exec(m.mc);
    const sp = ruleFromFile(rm && rm[1]);
    if (rm && !sp) info.unknownRule = rm[1].trim();
    if (sp) { spec = sp; rule = CA.compileRule(sp); }
    if (rule.needsFinite || !rule.f) throw new Error('Macrocell files need a rule that can run in HashLife');
    cfg.kind = 'hash';
    makeEngine(false);
    engine.loadMacrocell(m.mc);
  } else if (m.rle != null || m.mcl != null) {
    const cells = [];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const head = (m.mcl != null ? CA.parseMCL : CA.parseRLE)(m.mcl != null ? m.mcl : m.rle, (x, y, s) => {
      cells.push(x, y, s);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    });
    info.comments = head.comments;
    if (m.adoptRule && head.rule) {
      const sp = ruleFromFile(head.rule);
      if (sp) { spec = sp; rule = CA.compileRule(sp); if (!rule.needsFinite && cfg.kind === 'dense') cfg.kind = 'hash'; makeEngine(false); }
      else info.unknownRule = head.rule;
    }
    if (m.clear) engine.clear();
    if (cells.length) {
      const dx = (m.at ? m.at[0] : 0) - Math.floor((x0 + x1 + 1) / 2), dy = (m.at ? m.at[1] : 0) - Math.floor((y0 + y1 + 1) / 2);
      const N = rule.states;
      for (let i = 0; i < cells.length; i += 3) if (cells[i + 2] < N) engine.setCell(cells[i] + dx, cells[i + 1] + dy, cells[i + 2]);
    }
  } else if (m.cells) {
    if (m.clear) engine.clear();
    const c = m.cells;
    for (let i = 0; i < c.length; i += 3) engine.setCell(c[i], c[i + 1], c[i + 2]);
  } else if (m.clear) engine.clear();
  if (m.random) randomFill(m.random);
  if (m.mc == null) engine.gen = 0n;
  rateT = 0; gps = 0;
  dirty = true;
  info.type = 'loaded'; info.bounds = engine.bounds(); info.fit = m.fit === 'dense' ? engine.kind === 'dense' : m.fit !== false;
  if (engine.kind === 'dense') info.grid = { w: engine.w, h: engine.h };
  post(info);
}

function randomFill(r) {
  let w = r.w, h = r.h;
  if (engine.kind === 'dense') { w = Math.min(w || engine.w, engine.w); h = Math.min(h || engine.h, engine.h); }
  w = w || 256; h = h || 256;
  const x0 = -(w >> 1), y0 = -(h >> 1);
  const states = r.states && r.states.length ? r.states : [1];
  const d = r.density == null ? 0.3 : r.density;
  // xorshift so a seed reproduces the same soup
  let s = (r.seed | 0) || (Math.random() * 0x7fffffff) | 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rnd() < d) engine.setCell(x0 + x, y0 + y, states[(rnd() * states.length) | 0]);
    else if (r.overwrite) engine.setCell(x0 + x, y0 + y, 0);
  }
}

function doStep() {
  const t0 = performance.now();
  const before = engine.gen;
  const note = engine.step();
  const t1 = performance.now();
  stepMs = t1 - t0;
  if (note === 'memory') { P = engine.P; post({ type: 'note', message: 'Memory budget reached: step size reduced to 2^' + P, P }); }
  if (!rateT) { rateT = t0; rateG = before; }
  if (t1 - rateT > 400) { gps = Number(engine.gen - rateG) / ((t1 - rateT) / 1000); rateT = t1; rateG = engine.gen; }
  dirty = true;
}

function sendFrame() {
  if (!view || !engine) return;
  const zoom = view.zoom;
  const k = zoom >= 1 ? 0 : Math.max(0, Math.ceil(Math.log2(1 / zoom) - 1e-9));
  const sc = Math.pow(2, k);
  const hw = view.pw / 2 / zoom * 1.2 + sc, hh = view.ph / 2 / zoom * 1.2 + sc;
  const x0 = Math.floor((view.cx - hw) / sc) * sc, y0 = Math.floor((view.cy - hh) / sc) * sc;
  const tw = Math.min(4096, Math.ceil((view.cx + hw - x0) / sc) + 1), th = Math.min(4096, Math.ceil((view.cy + hh - y0) / sc) + 1);
  const buf = new Uint8Array(tw * th * 2);
  engine.render(x0, y0, k, tw, th, buf);
  const m = {
    type: 'frame', buf, tw, th, x0, y0, k,
    gen: engine.gen.toString(), pop: engine.population, P: engine.P, gps, stepMs,
    stats: engine.stats(), playing,
  };
  if (wantBounds) m.bounds = engine.bounds();
  dirty = false; awaiting = true; awaitT = performance.now();
  post(m, [buf.buffer]);
}

function loop() {
  sched = false;
  if (!engine) return;
  try {
    let now = performance.now();
    if (playing && (tps === 0 || now >= nextT)) {
      doStep();
      now = performance.now();
      nextT = tps ? Math.max(now - 50, nextT + 1000 / tps) : now;
    }
    if (awaiting && now - awaitT > 1500) awaiting = false;
    if (dirty && !awaiting) sendFrame();
  } catch (e) { playing = false; fail(e); post({ type: 'stopped' }); }
  if (playing) {
    const wait = tps === 0 ? 0 : nextT - performance.now();
    if (wait <= 0.5) kick(); else setTimeout(kick, wait);
  }
}

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'setup': setup(m, m.keep); if (m.pattern) loadPattern(m.pattern); break;
      case 'pattern': loadPattern(m); break;
      case 'cells': { const c = m.list; for (let i = 0; i < c.length; i += 3) engine.setCell(c[i], c[i + 1], c[i + 2]); dirty = true; break; }
      case 'play': playing = m.playing; nextT = performance.now(); rateT = 0; if (!playing) gps = 0; dirty = true; break;
      case 'speed': tps = m.tps; if (m.P !== P) { P = m.P; engine.setStep(P); P = engine.P; } nextT = performance.now(); rateT = 0; break;
      case 'step': doStep(); break;
      case 'view': view = m; wantBounds = !!m.wantBounds; dirty = true; break;
      case 'ack': awaiting = false; break;
      case 'clear': engine.clear(); dirty = true; break;
      case 'export': {
        const cells = [];
        let full = true;
        engine.forEachCell((x, y, s) => { cells.push(x, y, s); if (cells.length >= 6e6) { full = false; return false; } });
        if (!full) throw new Error('Pattern is too large to export as RLE (over 2 million cells)');
        post({ type: 'exported', text: CA.writeRLE(cells, rule.canonical), purpose: m.purpose });
        break;
      }
    }
  } catch (e) { fail(e); if (m.type === 'setup' || m.type === 'pattern') post({ type: 'failed', what: m.type }); }
  kick();
};
