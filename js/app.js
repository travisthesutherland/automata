// Main thread: interface, input, and the render loop. The simulation lives in worker.js.
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('view');
  const TPS = [1, 2, 4, 8, 15, 30, 60, 120, 0];
  const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.2l9.5 5.8L4 13.8z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3.2v11H3.5zm5.8 0h3.2v11H9.3z"/></svg>';

  const toast = (msg, err) => {
    const d = document.createElement('div');
    d.className = 'toast' + (err ? ' err' : ''); d.textContent = msg;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), err ? 6000 : 3200);
  };

  let R;
  try { R = new CA.Renderer(canvas); }
  catch (e) { toast(e.message, true); return; }
  const worker = new Worker('js/worker.js');

  const S = {
    preset: 0, pattern: 0, spec: null, rule: { states: 2, kind: 'life', canonical: '' }, engine: 'hash', grid: null,
    playing: false, tpsIdx: 6, P: 0, view: { cx: 0, cy: 0, zoom: 16 },
    theme: 'Native', glow: 0.7, trails: 45, showGrid: true, glyphs: true, shape: 1,
    tool: 'pan', drawState: 1, follow: false, lastPattern: null, frame: null, bounds: null,
    memMB: 512, size: 512, fitZoom: 0, palette: null, focus: null, loadToken: 0,
  };
  let viewDirty = true, activeUntil = 0, pendingExport = null;
  const wake = () => { activeUntil = performance.now() + 4000; };
  const nodesFor = mb => Math.floor(mb * 1e6 / 42);

  // ------------------------------------------------------------- formatting
  const fmtBig = s => s.length <= 15 ? Number(s).toLocaleString('en-US') : s[0] + '.' + s.slice(1, 4) + 'e' + (s.length - 1);
  const fmtNum = n => n < 1e15 ? Math.round(n).toLocaleString('en-US') : n.toExponential(3).replace('+', '');
  const fmtRate = g => {
    if (g < 1e3) return g.toFixed(g < 10 ? 1 : 0);
    if (g < 1e15) { const u = ['k', 'M', 'G', 'T']; let i = -1; while (g >= 1000 && i < 3) { g /= 1000; i++; } return g.toFixed(g < 10 ? 2 : g < 100 ? 1 : 0) + u[i]; }
    return g.toExponential(2).replace('+', '');
  };
  const stepLabel = P => P <= 16 ? (1 << P).toLocaleString('en-US') : '2^' + P;

  // --------------------------------------------------------------- view
  const dpr = () => R.dpr || 1;
  const clampZoom = z => Math.max(Math.pow(2, -44), Math.min(96 * dpr(), z));
  function sendView() {
    worker.postMessage({ type: 'view', cx: S.view.cx, cy: S.view.cy, zoom: S.view.zoom, pw: R.w, ph: R.h, wantBounds: S.follow });
  }
  function gridBounds() {
    if (S.engine !== 'dense' || !S.grid) return null;
    const w = S.grid.w, h = S.grid.h;
    return { x0: -(w >> 1), y0: -(h >> 1), x1: w - (w >> 1) - 1, y1: h - (h >> 1) - 1 };
  }
  function fitTarget(b, maxZoom) {
    b = gridBounds() || b;
    const cap = (maxZoom || 32) * dpr();
    if (!b) return { cx: 0, cy: 0, zoom: cap };
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
    return { cx: (b.x0 + b.x1 + 1) / 2, cy: (b.y0 + b.y1 + 1) / 2, zoom: clampZoom(Math.min(R.w * 0.62 / w, R.h * 0.62 / h, cap)) };
  }
  function fitView(b, maxZoom) { S.view = fitTarget(b, maxZoom); viewDirty = true; R.clearTrails(); wake(); }
  function setFollow(on) { S.follow = on; $('follow').checked = on; viewDirty = true; }

  // -------------------------------------------------------------- transport
  function play(on) {
    S.playing = on;
    $('btnPlay').innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    $('btnPlay').classList.toggle('on', on);
    worker.postMessage({ type: 'play', playing: on });
    wake();
  }
  function setSpeed(tpsIdx, P, quiet) {
    S.tpsIdx = Math.max(0, Math.min(TPS.length - 1, tpsIdx)); S.P = Math.max(0, Math.min(40, P));
    $('tps').value = S.tpsIdx; $('step').value = S.P;
    $('tpsV').textContent = TPS[S.tpsIdx] ? TPS[S.tpsIdx] + ' / s' : 'flat out';
    $('stepV').textContent = stepLabel(S.P) + (S.P ? ' gens' : ' gen');
    if (!quiet) worker.postMessage({ type: 'speed', tps: TPS[S.tpsIdx], P: S.P });
  }

  // ---------------------------------------------------------------- presets
  function patternMsg(q, ruleText) {
    const m = { type: 'pattern', clear: true };
    if (q.file) m.clear = true;
    else if (q.rle) m.rle = q.rle;
    else if (q.cells) m.cells = q.cells();
    if (q.random) {
      const r = Object.assign({}, q.random);
      if (r.states === 'all') { const n = CA.compileRule({ type: 'string', text: ruleText }, true).states; r.states = [...Array(n).keys()]; }
      m.random = r;
    }
    return m;
  }
  function selectPreset(i, j) {
    const p = CA.PRESETS[i], q = p.patterns[j];
    S.preset = i; S.pattern = j; S.spec = { type: 'string', text: p.rule };
    $('preset').value = i;
    const ps = $('pattern'); ps.innerHTML = '';
    p.patterns.forEach((pt, k) => ps.add(new Option(pt.name, k)));
    ps.value = j;
    S.size = q.size || p.size || S.size;
    S.fitZoom = q.zoom || 0; S.focus = q.focus || null;
    const token = ++S.loadToken;
    S.lastPattern = patternMsg(q, p.rule);
    worker.postMessage({
      type: 'setup', spec: S.spec, keep: false, pattern: S.lastPattern,
      engine: { kind: q.engine || p.engine, w: S.size, h: S.size, maxNodes: nodesFor(S.memMB) },
    });
    const sp = q.speed || [60, 0];
    setSpeed(sp[0] === 0 ? TPS.length - 1 : TPS.reduce((b, v, i) => v && Math.abs(v - sp[0]) < Math.abs(TPS[b] - sp[0]) ? i : b, 0), sp[1]);
    setFollow(!!q.follow);
    $('infoTitle').textContent = p.name; $('infoDesc').textContent = p.desc || ''; $('infoPat').textContent = q.desc || '';
    if (q.file) {
      play(false);
      fetchPattern(q.file).then(text => {
        if (token !== S.loadToken) return;
        S.lastPattern = Object.assign({ type: 'pattern', clear: true }, patternKind(text, q.file));
        worker.postMessage(S.lastPattern);
        if (q.autoplay !== false) play(true);
      }).catch(e => toast('Could not load ' + q.file + ': ' + e.message, true));
    } else play(true);
  }
  async function fetchPattern(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    let buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    return new TextDecoder().decode(buf);
  }
  function patternKind(text, name) {
    if (/^\[M2\]/.test(text) || /\.mc(\.gz)?$/i.test(name || '')) return { mc: text };
    if (/^#MCell/.test(text) || /\.mcl$/i.test(name || '')) return { mcl: text };
    return { rle: text };
  }
  function reload() {
    if (!S.lastPattern) return;
    const m = Object.assign({}, S.lastPattern, { adoptRule: false, fit: true });
    if (m.mc != null) m.fit = true;
    worker.postMessage(m);
    R.clearTrails();
  }
  function applyRule(spec, name) {
    try { CA.compileRule(spec, true); } catch (e) { toast(e.message, true); return false; }
    S.spec = spec;
    customPattern();
    $('infoTitle').textContent = name || 'Custom rule'; $('infoDesc').textContent = ''; $('infoPat').textContent = '';
    worker.postMessage({ type: 'setup', spec, keep: true, engine: engineCfg() });
    return true;
  }
  function customPattern(name) {
    $('preset').value = -1;
    const ps = $('pattern'); ps.innerHTML = ''; ps.add(new Option(name || 'Current cells', 0));
  }
  function engineCfg() {
    const v = $('engine').value;
    if (v !== 'hash') S.size = +v;
    return { kind: v === 'hash' ? 'hash' : 'dense', w: S.size, h: S.size, maxNodes: nodesFor(S.memMB) };
  }

  // ------------------------------------------------------------ palette etc
  function applyPalette() {
    S.palette = CA.makePalette(S.rule, S.theme);
    R.setPalette(S.palette);
    const box = $('swatches'); box.innerHTML = '';
    const n = Math.min(S.rule.states, 256);
    if (S.drawState >= n) S.drawState = 1;
    for (let s = 0; s < n; s++) {
      const b = document.createElement('button');
      const p = S.palette;
      b.style.background = s ? `rgb(${p[s * 4]},${p[s * 4 + 1]},${p[s * 4 + 2]})` : '#0b0f1a';
      b.title = s + (S.rule.names && S.rule.names[s] ? ': ' + S.rule.names[s] : s === 0 ? ': empty' : '');
      if (s === S.drawState) b.classList.add('sel');
      b.onclick = () => { S.drawState = s; setTool('draw'); applyPalette(); };
      box.appendChild(b);
    }
    const nm = S.rule.names && S.rule.names[S.drawState];
    $('stateName').textContent = 'Drawing with state ' + S.drawState + (nm ? ' (' + nm + ')' : '');
    wake();
  }
  function setTool(t) {
    S.tool = t;
    $('toolPan').classList.toggle('on', t === 'pan'); $('toolDraw').classList.toggle('on', t === 'draw');
    $('btnDraw').classList.toggle('on', t === 'draw');
    canvas.classList.toggle('draw', t === 'draw');
  }

  // --------------------------------------------------------- worker messages
  worker.onmessage = (ev) => {
    const m = ev.data;
    switch (m.type) {
      case 'frame': {
        R.setFrame(m);
        S.frame = m; wake();
        worker.postMessage({ type: 'ack' });
        $('hGen').textContent = fmtBig(m.gen);
        $('hPop').textContent = fmtNum(m.pop);
        $('hGps').textContent = m.playing ? (m.gps ? fmtRate(m.gps) + ' gen/s' : 'running') + (m.stepMs > 80 ? ' · ' + Math.round(m.stepMs) + ' ms/step' : '') : 'paused';
        if (m.stats.nodes != null) {
          $('hEng').textContent = 'HashLife · depth ' + m.stats.level;
          $('hMem').textContent = (m.stats.nodes * 42 / 1e6).toFixed(1) + ' / ' + S.memMB + ' MB' + (m.stats.gcs ? ' · ' + m.stats.gcs + ' gc' : '');
        } else {
          $('hEng').textContent = 'Torus ' + m.stats.w + ' × ' + m.stats.h;
          $('hMem').textContent = (m.stats.w * m.stats.h * 2 / 1e6).toFixed(1) + ' MB';
        }
        if (m.P !== S.P) setSpeed(S.tpsIdx, m.P, true);
        if (m.bounds && S.follow) {
          const t = fitTarget(m.bounds, S.fitZoom || 32), v = S.view, a = 0.12;
          const nz = Math.exp(Math.log(v.zoom) + (Math.log(t.zoom) - Math.log(v.zoom)) * a);
          const d = Math.abs(nz / v.zoom - 1) + (Math.abs(t.cx - v.cx) + Math.abs(t.cy - v.cy)) * v.zoom / R.w;
          if (d > 0.002) { v.zoom = nz; v.cx += (t.cx - v.cx) * a; v.cy += (t.cy - v.cy) * a; viewDirty = true; }
        }
        break;
      }
      case 'ready': {
        S.rule = m.rule; S.engine = m.engine; S.spec = m.spec;
        S.grid = m.engine === 'dense' ? { w: m.w, h: m.h } : null;
        if (m.engine === 'dense') S.size = m.w;
        $('engine').value = m.engine === 'hash' ? 'hash' : String(m.w);
        $('ruleText').value = m.spec.type === 'string' ? m.rule.canonical : '';
        $('infoRule').textContent = m.rule.canonical + ' · ' + m.rule.states + ' states';
        $('engineNote').textContent = m.engine === 'hash'
          ? 'Unbounded plane. Regular patterns can be run at enormous step sizes.'
          : (m.rule.ltl ? 'Range > 1 rules run on a wrap-around grid.' : 'Wrap-around grid. Best for chaotic rules and random soups.');
        $('mem').disabled = m.engine !== 'hash';
        applyPalette(); R.clearTrails();
        break;
      }
      case 'loaded':
        S.bounds = m.bounds;
        if (m.fit) fitView(m.bounds, S.fitZoom);
        if (m.fit && S.focus === 'left' && m.bounds) {
          // long tape machines: start on the machine at the left-hand end rather than the whole tape
          const z = (S.fitZoom || 4) * dpr();
          S.view = { zoom: z, cx: m.bounds.x0 + R.w * 0.42 / z, cy: (m.bounds.y0 + m.bounds.y1 + 1) / 2 };
          viewDirty = true;
        }
        if (m.unknownRule) toast('Rule "' + m.unknownRule + '" is not known here; kept the current rule', true);
        if (m.comments && m.comments.length && S.fromFile) { $('infoPat').textContent = m.comments.slice(0, 12).join(' '); }
        S.fromFile = false;
        break;
      case 'error': toast(m.message, true); break;
      case 'note': toast(m.message); break;
      case 'stopped': play(false); break;
      case 'exported':
        if (m.purpose === 'copy') navigator.clipboard.writeText(m.text).then(() => toast('Pattern copied as RLE'), () => toast('Clipboard is not available', true));
        else download(new Blob([m.text], { type: 'text/plain' }), 'pattern.rle');
        break;
    }
  };
  worker.onerror = e => toast('Worker error: ' + e.message, true);

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // -------------------------------------------------------------- rendering
  function loop() {
    if (R.resize()) { viewDirty = true; wake(); }
    if (viewDirty) { sendView(); viewDirty = false; wake(); }
    if (performance.now() < activeUntil) {
      const th = CA.THEMES[S.theme];
      const gb = gridBounds();
      R.draw(S.view, {
        grid: S.showGrid, glyphs: S.glyphs, shape: S.shape, glow: S.glow,
        trails: S.trails ? 0.78 + 0.215 * (S.trails / 100) : 0,
        bounds: gb ? { x0: gb.x0, y0: gb.y0, x1: gb.x1 + 1, y1: gb.y1 + 1 } : null, bg1: th.bg1, bg2: th.bg2,
      });
      const z = S.view.zoom / dpr();
      $('hZoom').textContent = z >= 1 ? z.toFixed(z < 10 ? 1 : 0) + ' px / cell' : fmtRate(1 / z) + ' cells / px';
    }
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ input
  const cellAt = e => {
    const d = dpr();
    return [Math.floor(S.view.cx + (e.clientX * d - R.w / 2) / S.view.zoom), Math.floor(S.view.cy + (e.clientY * d - R.h / 2) / S.view.zoom)];
  };
  const stateAt = (x, y) => {
    const f = S.frame;
    if (!f || f.k !== 0) return -1;
    const i = x - f.x0, j = y - f.y0;
    return (i < 0 || j < 0 || i >= f.tw || j >= f.th) ? -1 : f.buf[2 * (j * f.tw + i)];
  };
  const pointers = new Map();
  let drag = null, stroke = null, spaceHeld = false, pinch = 0;

  function paintLine(x0, y0, x1, y1, s) {
    const list = [];
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, n = 0;
    for (; n < 20000; n++) {
      list.push(x0, y0, s);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
    worker.postMessage({ type: 'cells', list });
  }

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, e);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); stroke = null; return; }
    const drawing = S.tool === 'draw' && e.button === 0 && !spaceHeld && !e.altKey;
    if (drawing) {
      if (S.view.zoom < 1.5 * dpr()) { toast('Zoom in to draw individual cells'); return; }
      const [x, y] = cellAt(e);
      const cur = stateAt(x, y);
      const s = e.shiftKey ? 0 : (cur === S.drawState && S.drawState !== 0 ? 0 : S.drawState);
      stroke = { x, y, s };
      paintLine(x, y, x, y, s);
    } else {
      drag = { x: e.clientX, y: e.clientY };
      canvas.classList.add('panning');
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch > 0) zoomAt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, d / pinch);
      pinch = d; return;
    }
    const [x, y] = cellAt(e);
    if (drag) {
      const d = dpr();
      S.view.cx -= (e.clientX - drag.x) * d / S.view.zoom; S.view.cy -= (e.clientY - drag.y) * d / S.view.zoom;
      drag.x = e.clientX; drag.y = e.clientY;
      viewDirty = true; if (S.follow) setFollow(false);
    } else if (stroke && (x !== stroke.x || y !== stroke.y)) {
      paintLine(stroke.x, stroke.y, x, y, stroke.s);
      stroke.x = x; stroke.y = y;
    }
    const st = stateAt(x, y);
    const nm = st > 0 && S.rule.names && S.rule.names[st];
    $('hCur').textContent = (Math.abs(x) < 1e9 && Math.abs(y) < 1e9 ? x + ', ' + y : x.toExponential(2) + ', ' + y.toExponential(2)) + (st >= 0 ? '  [' + st + (nm ? ' ' + nm : '') + ']' : '');
  });
  const endPointer = e => { pointers.delete(e.pointerId); drag = null; stroke = null; pinch = 0; canvas.classList.remove('panning'); };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  function zoomAt(clientX, clientY, factor) {
    const d = dpr(), v = S.view;
    const px = clientX * d - R.w / 2, py = clientY * d - R.h / 2;
    const wx = v.cx + px / v.zoom, wy = v.cy + py / v.zoom;
    v.zoom = clampZoom(v.zoom * factor);
    v.cx = wx - px / v.zoom; v.cy = wy - py / v.zoom;
    viewDirty = true; if (S.follow) setFollow(false);
  }
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    zoomAt(e.clientX, e.clientY, Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0022)));
  }, { passive: false });

  window.addEventListener('keydown', e => {
    const t = e.target.tagName;
    if (t === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox' || t === 'TEXTAREA' || t === 'SELECT') {
      if (e.key === 'Enter' && e.target.id === 'ruleText') $('ruleApply').click();
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    if (document.querySelector('dialog[open]')) return;
    switch (e.key) {
      case ' ': e.preventDefault(); spaceHeld = true; if (!e.repeat) play(!S.playing); break;
      case 's': case 'S': case 'ArrowRight': if (S.playing) play(false); worker.postMessage({ type: 'step' }); break;
      case 'r': case 'R': reload(); break;
      case 'f': case 'F': requestFit(); break;
      case 'a': case 'A': setFollow(!S.follow); toast(S.follow ? 'Following growth' : 'Follow off'); break;
      case 'd': case 'D': setTool(S.tool === 'draw' ? 'pan' : 'draw'); break;
      case 'g': case 'G': $('grid').click(); break;
      case 'h': case 'H': document.body.classList.toggle('hide-ui'); break;
      case 'i': case 'I': document.body.classList.toggle('no-info'); break;
      case 'p': case 'P': document.body.classList.toggle('no-panel'); break;
      case '+': case '=': setSpeed(S.tpsIdx, S.P + 1); break;
      case '-': case '_': setSpeed(S.tpsIdx, S.P - 1); break;
      case ']': setSpeed(S.tpsIdx + 1, S.P); break;
      case '[': setSpeed(S.tpsIdx - 1, S.P); break;
    }
  });
  window.addEventListener('keyup', e => { if (e.key === ' ') spaceHeld = false; });

  // Fit needs fresh bounds from the worker: ask for one frame with bounds, then fit to it.
  let fitPending = false;
  function requestFit() {
    fitPending = true;
    worker.postMessage({ type: 'view', cx: S.view.cx, cy: S.view.cy, zoom: S.view.zoom, pw: R.w, ph: R.h, wantBounds: true });
  }
  const origOnMessage = worker.onmessage;
  worker.onmessage = ev => {
    if (fitPending && ev.data.type === 'frame' && 'bounds' in ev.data) { fitPending = false; S.bounds = ev.data.bounds; fitView(ev.data.bounds, 32); }
    origOnMessage(ev);
  };

  // --------------------------------------------------------------- controls
  const ps = $('preset');
  { let g = null, og = null;
    CA.PRESETS.forEach((p, i) => { if (p.group !== g) { g = p.group; og = document.createElement('optgroup'); og.label = g; ps.appendChild(og); } og.appendChild(new Option(p.name, i)); });
    const c = new Option('Custom rule', -1); c.hidden = true; ps.appendChild(c); }
  ps.onchange = () => { if (+ps.value >= 0) selectPreset(+ps.value, 0); ps.blur(); };
  $('pattern').onchange = () => { if (+ps.value >= 0) selectPreset(S.preset, +$('pattern').value); $('pattern').blur(); };
  $('btnPlay').onclick = () => play(!S.playing);
  $('btnStep').onclick = () => { if (S.playing) play(false); worker.postMessage({ type: 'step' }); };
  $('btnReset').onclick = reload;
  $('btnFit').onclick = requestFit;
  $('btnDraw').onclick = () => { setTool(S.tool === 'draw' ? 'pan' : 'draw'); if (S.tool === 'draw') document.body.classList.remove('no-panel'); };
  $('toolPan').onclick = () => setTool('pan'); $('toolDraw').onclick = () => setTool('draw');
  $('tps').oninput = () => setSpeed(+$('tps').value, S.P);
  $('step').oninput = () => setSpeed(S.tpsIdx, +$('step').value);
  $('btnInfo').onclick = () => document.body.classList.toggle('no-info');
  $('infoClose').onclick = () => document.body.classList.add('no-info');
  $('btnPanel').onclick = () => document.body.classList.toggle('no-panel');
  $('ruleApply').onclick = () => { const t = $('ruleText').value.trim(); if (t && applyRule({ type: 'string', text: t }, t)) toast('Rule set to ' + t); };
  $('engine').onchange = () => worker.postMessage({ type: 'setup', spec: S.spec, keep: true, engine: engineCfg() });
  $('mem').onchange = () => { S.memMB = +$('mem').value; worker.postMessage({ type: 'setup', spec: S.spec, keep: true, engine: engineCfg() }); };
  $('density').oninput = () => { $('densityV').textContent = $('density').value + '%'; };
  $('btnRandom').onclick = () => {
    const k = S.rule.kind, n = S.rule.states;
    const multi = !(k === 'life' || k === 'generations' || k === 'ant');
    const states = k === 'cyclic' ? [...Array(n).keys()] : multi ? [...Array(n - 1).keys()].map(i => i + 1) : [1];
    worker.postMessage({ type: 'pattern', clear: true, fit: 'dense', random: { w: S.engine === 'dense' ? 0 : 256, h: S.engine === 'dense' ? 0 : 256, density: k === 'cyclic' ? 1 : +$('density').value / 100, states } });
    R.clearTrails();
  };
  $('btnClear').onclick = () => { worker.postMessage({ type: 'clear' }); R.clearTrails(); };

  const th = $('theme');
  Object.keys(CA.THEMES).forEach(n => th.add(new Option(n === 'Native' ? 'Native colours' : n, n)));
  th.onchange = () => { S.theme = th.value; applyPalette(); };
  $('shape').onchange = () => { S.shape = +$('shape').value; wake(); };
  const syncLook = () => {
    S.glow = +$('glow').value / 100; S.trails = +$('trails').value;
    $('glowV').textContent = Math.round(S.glow * 100) + '%'; $('trailsV').textContent = S.trails ? S.trails + '%' : 'off';
    S.showGrid = $('grid').checked; S.glyphs = $('glyphs').checked; wake();
  };
  ['glow', 'trails', 'grid', 'glyphs'].forEach(id => { $(id).oninput = syncLook; });
  $('follow').onchange = () => setFollow($('follow').checked);
  syncLook();

  // custom rule dialog
  let ruleMode = 'js';
  const srcs = { js: CA.CUSTOM_JS_EXAMPLE, table: CA.CUSTOM_TABLE_EXAMPLE };
  const showMode = m => {
    srcs[ruleMode] = $('ruleSrc').value || srcs[ruleMode];
    ruleMode = m; $('ruleSrc').value = srcs[m];
    $('tabJs').classList.toggle('on', m === 'js'); $('tabTable').classList.toggle('on', m === 'table');
    $('rowStates').style.display = m === 'js' ? '' : 'none';
    $('ruleHelp').textContent = m === 'js'
      ? 'The body of a function of (c, n, ne, e, se, s, sw, w, nw, N). It runs for every cell, so keep it free of side effects. Works in both engines.'
      : 'The @TABLE section of a Golly .rule file: n_states, neighborhood (vonNeumann or Moore), symmetries, var lines, then transitions.';
  };
  $('ruleAdvanced').onclick = () => { $('ruleSrc').value = srcs[ruleMode]; showMode(ruleMode); $('dlgRule').showModal(); };
  $('tabJs').onclick = () => showMode('js'); $('tabTable').onclick = () => showMode('table');
  $('ruleSrcApply').onclick = () => {
    const text = $('ruleSrc').value; srcs[ruleMode] = text;
    const spec = ruleMode === 'js' ? { type: 'js', text, states: +$('ruleStates').value, name: 'Custom function' } : { type: 'table', text, name: 'Custom table' };
    if (applyRule(spec, spec.name)) { $('dlgRule').close(); toast('Custom rule in use. Random fill or draw to seed it.'); }
  };

  // files
  async function loadFile(file) {
    try {
      let buf = new Uint8Array(await file.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
        buf = new Uint8Array(await new Response(ds).arrayBuffer());
      }
      loadText(new TextDecoder().decode(buf), file.name.replace(/\.gz$/i, ''), true);
    } catch (e) { toast('Could not read ' + file.name + ': ' + e.message, true); }
  }
  function loadText(text, name, adopt) {
    const m = Object.assign({ type: 'pattern', clear: true, adoptRule: adopt }, patternKind(text, name));
    S.lastPattern = m; S.fromFile = true; S.fitZoom = 0; S.focus = null; S.loadToken++;
    play(false);
    customPattern(name);
    $('infoTitle').textContent = name || 'Pasted pattern'; $('infoDesc').textContent = ''; $('infoPat').textContent = '';
    worker.postMessage(m);
    R.clearTrails();
  }
  $('btnOpen').onclick = () => $('file').click();
  $('file').onchange = () => { if ($('file').files[0]) loadFile($('file').files[0]); $('file').value = ''; };
  $('btnPaste').onclick = () => $('dlgPaste').showModal();
  $('pasteApply').onclick = () => { const t = $('pasteSrc').value.trim(); if (t) { loadText(t, 'Pasted pattern', $('pasteRule').checked); $('dlgPaste').close(); } };
  $('btnSave').onclick = () => worker.postMessage({ type: 'export', purpose: 'save' });
  $('btnCopy').onclick = () => worker.postMessage({ type: 'export', purpose: 'copy' });
  $('btnShot').onclick = () => { activeUntil = Infinity; requestAnimationFrame(() => { canvas.toBlob(b => { if (b) download(b, 'automata.png'); }, 'image/png'); wake(); }); };
  window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('dragging'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

  // expose a little for debugging and scripted checks
  window.automata = { S, worker, R, selectPreset, loadText, setSpeed, play };

  setTool('pan');
  R.resize();
  selectPreset(0, 0);
  requestAnimationFrame(loop);
})();
