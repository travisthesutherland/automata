// Rule and pattern library, colour themes, and a few pattern generators.
(function (root) {
  'use strict';
  const CA = root.CA || (root.CA = {});

  // ------------------------------------------------------------------ themes
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const ramp = (stops, t) => {
    const n = stops.length - 1, x = Math.max(0, Math.min(1, t)) * n, i = Math.min(n - 1, Math.floor(x)), f = x - i;
    return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  };
  CA.THEMES = {
    Native: { stops: ['#8af7ff', '#4a9dff', '#8b5cf6', '#e14eca', '#5b1a5e'], bg1: [0.030, 0.045, 0.085], bg2: [0.004, 0.006, 0.014] },
    Aurora: { stops: ['#8af7ff', '#4a9dff', '#8b5cf6', '#e14eca', '#5b1a5e'], bg1: [0.030, 0.045, 0.085], bg2: [0.004, 0.006, 0.014] },
    Ember: { stops: ['#fff1b8', '#ffb347', '#ff5e3a', '#c2185b', '#4a0d43'], bg1: [0.075, 0.032, 0.022], bg2: [0.012, 0.004, 0.006] },
    Verdant: { stops: ['#e9ff9c', '#57e389', '#12b5a6', '#1670a8', '#132a52'], bg1: [0.020, 0.060, 0.050], bg2: [0.003, 0.010, 0.012] },
    Ultraviolet: { stops: ['#f5d0ff', '#c77dff', '#7b2ff7', '#3a0ca3', '#1b0b4b'], bg1: [0.050, 0.025, 0.090], bg2: [0.008, 0.003, 0.018] },
    Mono: { stops: ['#ffffff', '#c9d1d9', '#8b949e', '#484f58', '#21262d'], bg1: [0.040, 0.043, 0.050], bg2: [0.006, 0.006, 0.008] },
    Spectrum: { spectrum: true, bg1: [0.030, 0.035, 0.060], bg2: [0.004, 0.004, 0.010] },
  };

  const JVN_COLORS = [[0, 0, 0],
    [255, 120, 30], [255, 140, 40], [255, 160, 50], [255, 180, 60], [255, 195, 75], [255, 210, 90], [255, 225, 105], [255, 240, 120],
    [52, 92, 205], [60, 104, 215], [68, 116, 225], [76, 128, 235],
    [70, 255, 190], [90, 255, 200], [110, 255, 210], [130, 255, 220],
    [170, 44, 96], [182, 52, 106], [194, 60, 116], [206, 68, 126],
    [255, 90, 205], [255, 105, 212], [255, 120, 219], [255, 135, 226],
    [176, 138, 40], [255, 196, 60], [255, 230, 120], [255, 255, 205],
    [40, 190, 200], [60, 215, 225], [130, 255, 255]];
  const WW_COLORS = [[0, 0, 0], [190, 240, 255], [255, 96, 48], [150, 96, 44]];

  // Returns a 256-entry RGBA palette; alpha carries the glyph code for the renderer.
  CA.makePalette = function (rule, themeName) {
    const th = CA.THEMES[themeName] || CA.THEMES.Aurora;
    const pal = new Uint8Array(1024);
    const N = rule.states;
    const set = (i, c) => { pal[i * 4] = c[0]; pal[i * 4 + 1] = c[1]; pal[i * 4 + 2] = c[2]; };
    const stops = th.spectrum ? null : th.stops.map(hex);
    const grad = t => {
      if (stops) return ramp(stops, t);
      const h = t * 5, c = [0, 0, 0], x = 1 - Math.abs(h % 2 - 1), i = Math.floor(h) % 6;
      const m = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][i];
      return m.map(v => Math.round(60 + 195 * v));
    };
    let native = null;
    if (themeName === 'Native') {
      if (rule.kind === 'jvn') native = JVN_COLORS;
      else if (rule.kind === 'wireworld') native = WW_COLORS;
      else if (rule.kind === 'ant') native = [[0, 0, 0], [70, 96, 210], [255, 240, 150], [255, 90, 70], [255, 240, 150], [255, 90, 70], [255, 240, 150], [255, 90, 70], [255, 240, 150], [255, 90, 70]];
      else if (rule.colors) native = rule.colors;
    }
    for (let s = 1; s < 256; s++) {
      if (native && native[s]) { set(s, native[s]); continue; }
      if (s >= N) { set(s, [255, 0, 255]); continue; }
      if (N === 2) set(s, grad(0));
      else if (rule.kind === 'generations') set(s, grad((s - 1) / Math.max(1, N - 2)));
      else if (rule.kind === 'cyclic') set(s, grad(s / (N - 1) * 0.8));
      else set(s, grad((s - 1) / Math.max(1, N - 1) * 0.85));
    }
    if (rule.kind === 'cyclic' && themeName !== 'Spectrum') {
      // a closed loop of colours reads better for cyclic rules
      for (let s = 1; s < N; s++) { const t = s / N; set(s, grad(0.1 + 0.8 * (t < 0.5 ? t * 2 : 2 - t * 2))); }
    }
    if (rule.glyphs) for (let s = 0; s < rule.glyphs.length; s++) pal[s * 4 + 3] = rule.glyphs[s];
    return pal;
  };

  // -------------------------------------------------------------- generators
  const art = (rows, map) => {
    const c = [];
    rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const s = map[row[x]]; if (s) c.push(x, y, s); } });
    return c;
  };
  const centre = c => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < c.length; i += 3) { x0 = Math.min(x0, c[i]); x1 = Math.max(x1, c[i]); y0 = Math.min(y0, c[i + 1]); y1 = Math.max(y1, c[i + 1]); }
    const dx = Math.floor((x0 + x1 + 1) / 2), dy = Math.floor((y0 + y1 + 1) / 2);
    for (let i = 0; i < c.length; i += 3) { c[i] -= dx; c[i + 1] -= dy; }
    return c;
  };
  const row = (n, fn) => { const c = []; for (let x = 0; x < n; x++) { const s = fn(x); if (s) c.push(x - (n >> 1), 0, s); } return c; };
  const lcg = seed => { let s = seed; return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };

  // von Neumann: a period-6 pulser driving a wire that builds its own next cell, forever.
  function jvnWire() {
    const c = [0, 0, 25, 1, 0, 16, 1, 1, 25, 0, 1, 10];
    for (let x = 2; x < 8; x++) c.push(x, 1, 9);
    return c;
  }

  // von Neumann: a ring of wire holds a looping program of construction commands. A confluent
  // cell taps the ring and feeds a construction arm, which builds whatever the program says.
  // Commands (sent after the sensitising pulse): E=0000 N=0001 W=001 S=010.
  function jvnProgram(prog) {
    const CODE = { E: '10000', N: '10001', W: '1001', S: '1010' };
    const SLOT = 8;
    let bits = '';
    for (const ch of prog) bits += CODE[ch].padEnd(SLOT, '0');
    const period = bits.length;         // ring period: OTS cells + 2 ticks per confluent
    const M = period - 2;               // ring cells (period - 4 arrows + 2 confluents)
    const h = 5, w = (M + 4) / 2 - h;
    // clockwise path starting at the tap, which sits in the middle of the east side
    const path = [];
    const tapY = 2;
    for (let y = tapY; y < h; y++) path.push([w - 1, y, 12]);
    for (let x = w - 2; x >= 0; x--) path.push([x, h - 1, 11]);
    for (let y = h - 2; y >= 0; y--) path.push([0, y, 10]);
    for (let x = 1; x < w; x++) path.push([x, 0, 9]);
    for (let y = 1; y < tapY; y++) path.push([w - 1, y, 12]);
    // corners: the cell must point at its successor
    for (let i = 0; i < path.length; i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      a[2] = b[0] > a[0] ? 9 : b[0] < a[0] ? 11 : b[1] < a[1] ? 10 : 12;
    }
    const c2 = path.length >> 1;
    // walk upstream from the tap assigning time slots; a confluent holds two (firing, next)
    const state = path.map(p => p[2]);
    const on = t => bits[t % period] === '1';
    let slot = 0;
    const conf = () => { const now = on(slot), next = on(slot + 1); slot += 2; return 25 + (next ? 1 : 0) + (now ? 2 : 0); };
    state[0] = conf();
    for (let j = path.length - 1; j >= 1; j--) {
      if (j === c2) state[j] = conf();
      else { if (on(slot)) state[j] += 4; slot++; }
    }
    const cells = [];
    path.forEach((p, i) => cells.push(p[0], p[1], state[i]));
    for (let x = 0; x < 4; x++) cells.push(w + x, tapY, 9);
    return centre(cells);
  }

  // WireWorld: clock loops of different periods, each behind a diode, feeding a shared bus.
  function wireworld() {
    const g = new Map();
    const put = (x, y, s) => g.set(x + ',' + y, [x, y, s]);
    const loop = (x0, y0, w, h, every) => {
      const p = [];
      for (let x = 0; x < w; x++) p.push([x0 + x, y0]);
      for (let y = 1; y < h; y++) p.push([x0 + w - 1, y0 + y]);
      for (let x = w - 2; x >= 0; x--) p.push([x0 + x, y0 + h - 1]);
      for (let y = h - 2; y >= 1; y--) p.push([x0, y0 + y]);
      p.forEach(([x, y]) => put(x, y, 3));
      for (let i = 0; i + 1 < p.length; i += every) { put(p[i + 1][0], p[i + 1][1], 1); put(p[i][0], p[i][1], 2); }
    };
    const wire = (x0, y0, x1, y1) => {
      const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
      for (let x = x0, y = y0; ; x += dx, y += dy) { put(x, y, 3); if (x === x1 && y === y1) break; }
    };
    const diode = (x, y) => { // passes west to east; occupies x..x+3
      put(x, y, 3); put(x, y - 1, 3); put(x, y + 1, 3); put(x + 1, y - 1, 3); put(x + 1, y + 1, 3);
      g.delete((x + 1) + ',' + y); put(x + 2, y, 3);
    };
    const rows = [[-36, 8, 6, 14], [-12, 10, 8, 18], [16, 14, 10, 22]];
    rows.forEach(([y, w, h, every], i) => {
      loop(0, y, w, h, every);
      const yy = y + (h >> 1);
      wire(w, yy, 22, yy);
      diode(23, yy);
      wire(25, yy, 40 + i * 6, yy);
    });
    // bus down the right-hand side, then a long serpentine
    wire(40, -33, 40, -4); wire(46, -8, 46, 21); wire(52, 21, 52, 40);
    wire(40, -4, 46, -4);
    wire(46, 21, 52, 21);
    let x = 52, y = 40;
    for (let k = 0; k < 9; k++) {
      const nx = k % 2 ? 52 : -30;
      wire(x, y, nx, y); x = nx;
      if (k < 8) { wire(x, y, x, y + 4); y += 4; }
    }
    return centre([...g.values()].flat());
  }

  const P = {
    glider: 'bob$2bo$3o!',
    gun: '24bo11b$22bobo11b$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o14b$2o8bo3bob2o4bobo11b$10bo5bo7bo11b$11bo3bo20b$12b2o!',
    rpent: 'b2o$2o$bo!',
    acorn: 'bo5b$3bo3b$2o2b3o!',
    diehard: '6bob$2o6b$bo3b3o!',
    growth: '6bob$4bob2o$4bobob$4bo3b$2bo5b$obo!',
    pulsar: '2b3o3b3o2b2$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2b2$2b3o3b3o2b$o4bobo4bo$o4bobo4bo$o4bobo4bo2$2b3o3b3o!',
    lwss: 'bo2bo$o4b$o3bo$4o!',
    hlrep: '2b3o$bo2bo$o3bo$o2bob$3o!',
    block: '2o$2o!',
    dot: 'o!',
    plus: 'bo$3o$bo!',
  };
  const G = 'patterns/golly/';
  const soup = (w, h, density, states) => ({ random: { w, h, density, states } });

  // engine: 'hash' (unbounded HashLife) or 'dense' (bounded torus, size in cells)
  // speed: [ticks per second (0 = flat out), step exponent]
  CA.PRESETS = [
    { group: 'Self-replication and construction', name: 'Von Neumann 29-state', rule: 'JvN29', engine: 'hash',
      desc: 'John von Neumann\'s 1940s universal constructor automaton. Arrows are transmission cells carrying pulses; double arrows are "special" cells that erase; rings are confluent cells that fan signals out. A pulse sent into empty space starts a cell under construction, and the next few pulses decide what it becomes.',
      patterns: [
        { name: 'Self-replicator (compact, 2018)', file: G + 'small-JvN-self-replicator.rle', speed: [0, 9], zoom: 5, focus: 'left',
          desc: 'A complete self-reproducing machine in von Neumann\'s original 29 states. The long strip is its tape; the machine reads it, builds a copy of itself to the right, copies the tape, and starts the child. One copy takes 221,693 steps, roughly half a minute here: its tape is a loop of about 25,000 cells that all carry moving signals, so nothing can be skipped. Press F to see the whole line of descendants. For a quicker copy, try the Hutton replicator under Hutton 32-state. From Golly\'s pattern collection.' },
        { name: 'Buckley\'s universal constructor (sphinx)', file: G + 'sphinx.mc.gz', speed: [0, 20], zoom: 3, focus: 'left',
          desc: 'William Buckley\'s 2007 universal constructor with a tape describing itself: the first demonstrated self-replicator in the unmodified 29-state rule. The machine is at the left end of a very long tape. Replication takes about 2.6e11 steps, so raise the step size and give HashLife plenty of memory.' },
        { name: 'Sphinx, tape copied, about to build', file: G + 'sphinx-midpoint.mc.gz', speed: [0, 16], zoom: 3, focus: 'left',
          desc: 'The sphinx at generation 174,603,710,464, just after duplicating its tape and just before constructing the child machine.' },
        { name: 'Sphinx, child built, about to start it', file: G + 'sphinx-spark.mc.gz', speed: [0, 16], zoom: 3, focus: 'left',
          desc: 'The sphinx at generation 261,467,406,336 with the child complete and about to be sparked into life.' },
        { name: 'Active-tape loop replicator', file: G + 'JvN-loop-replicator.rle.gz', speed: [0, 14], zoom: 4, focus: 'left',
          desc: 'Stores its instructions on a long thin loop of wire, over a million cells wide. Replicates in roughly 270 million steps.' },
        { name: 'Programmed construction arm', cells: () => jvnProgram('EEEESSSS'), speed: [30, 0], zoom: 14,
          desc: 'The ring is a looping tape of construction commands. A confluent cell taps it and drives an arm that builds new wire, turning corners on command. Zoom in to watch cells pass through their sensitised states.' },
        { name: 'Self-extending wire', cells: jvnWire, speed: [20, 0], zoom: 22,
          desc: 'A period-6 pulser. Each pulse reaching the end of the wire sensitises the empty cell beyond it, which matures into another arrow. Raise the step size and it will happily build millions of cells.' },
        { name: 'Zig-zag builder', cells: () => jvnProgram('EENNEESS'), speed: [30, 0], zoom: 14,
          desc: 'Same tape machine, different program: east, north, east, south.' },
        { name: 'Demo: cell coders', file: G + 'cell-coders-demo.rle', speed: [2, 0], zoom: 14, autoplay: false,
          desc: 'Renato Nobili\'s demo of the nine signal trains that construct each kind of cell, and the coder organs that produce them. Step forward five generations.' },
        { name: 'Demo: pulse counter', file: G + 'counter-demo.rle', speed: [30, 0], zoom: 16,
          desc: 'After ten input pulses the counter emits one output pulse and resets itself by erasing and rebuilding part of its own wiring.' },
        { name: 'Demo: tape read arm', file: G + 'read-arm-demo.rle', speed: [30, 0], zoom: 10,
          desc: 'The tape-reading organ from von Neumann\'s design: each input pulse reads one tape cell and moves the head on.' },
      ] },
    { group: 'Self-replication and construction', name: 'Nobili 32-state', rule: 'Nobili32', engine: 'hash',
      desc: 'Renato Nobili\'s 1994 extension of von Neumann\'s rule. Three extra states let two signals cross at a confluent cell, which shrinks self-replicating machines considerably.',
      patterns: [
        { name: 'Nobili-Pesavento replicator (1995)', file: G + 'NP-replicator.rle.gz', speed: [0, 18], zoom: 4, focus: 'left',
          desc: 'The first implementation of von Neumann\'s self-reproducing universal constructor, by Umberto Pesavento and Renato Nobili. The machine sits at the left end of its tape. Replication takes about 6.3e10 steps.' },
        { name: 'Compressed-tape replicator', file: G + 'N-compressed-replicator.rle', speed: [0, 18], zoom: 4, focus: 'left',
          desc: 'Nobili\'s later machine with a run-length compressed tape. Replication takes about 9.6e9 steps.' },
        { name: 'Demo: construction arm', file: G + 'construction-arm-demo.rle', speed: [20, 0], zoom: 10, autoplay: false,
          desc: 'Draw an excited ordinary arrow (state 13) at the start of one of the input lines on the left, then run slowly to steer the construction arm.' },
        { name: 'Self-extending wire', cells: jvnWire, speed: [20, 0], zoom: 22 }] },
    { group: 'Self-replication and construction', name: 'Hutton 32-state', rule: 'Hutton32', engine: 'hash',
      desc: 'Tim Hutton\'s 2008 variant, with a modified table that makes construction arms simpler to drive.',
      patterns: [
        { name: 'Hutton replicator', file: G + 'Hutton-replicator.rle', speed: [0, 8], zoom: 6, focus: 'left',
          desc: 'The fastest von Neumann-style replicator here: a copy every 44,000 steps or so, a few seconds each, with exponential growth at first. The instructions circulate in a long loop of wire. Press F to watch the colony spread.' },
        { name: 'Boustrophedon replicator', file: G + 'Boustrophedon-replicator.rle', speed: [0, 8], zoom: 6,
          desc: 'A replicator with a two-dimensional folded tape, which lets the colony grow quadratically.' },

        { name: 'Tape that builds the Golly logo', file: G + 'golly-constructor.rle', speed: [60, 2], zoom: 9,
          desc: 'Under this rule a plain tape of pulses can construct any pattern of quiescent cells.' }] },
    { group: 'Self-replication and construction', name: 'HighLife replicator', rule: 'B36/S23', engine: 'hash',
      desc: 'Life plus birth on 6. The small seed copies itself every 12 generations along a diagonal, a pattern HashLife can leap through at enormous step sizes.',
      patterns: [{ name: 'Replicator', rle: P.hlrep, speed: [30, 0], zoom: 8 }, { name: 'Random soup', ...soup(192, 192, 0.3), zoom: 3 }] },
    { group: 'Self-replication and construction', name: 'Fredkin replicator', rule: 'B1357/S1357', engine: 'hash',
      desc: 'Ed Fredkin\'s parity rule: every pattern, whatever its shape, is copied eight-fold every 2^n generations.',
      patterns: [{ name: 'Glider seed', rle: P.glider, speed: [12, 0], zoom: 6 }, { name: 'Pulsar seed', rle: P.pulsar, speed: [12, 0], zoom: 4 }] },

    { group: 'Self-replicating loops', name: 'Langton\'s Loops', rule: 'Langtons-Loops', engine: 'hash',
      desc: 'Chris Langton\'s 1984 loop: a sheathed ring carrying its own genome, which extends an arm, closes a daughter loop and pinches it off every 151 steps. A colony grows outward and leaves dead loops in its core.',
      patterns: [{ name: 'One loop', file: G + 'Langtons-Loops.rle', speed: [60, 0], zoom: 10 }] },
    { group: 'Self-replicating loops', name: 'Evoloop', rule: 'Evoloop', engine: 'hash',
      desc: 'Hiroki Sayama\'s 1999 loop. Loops die on collision and vary in size, so smaller, faster replicators evolve and take over.',
      patterns: [{ name: 'One loop', file: G + 'Evoloop.rle', speed: [0, 1], zoom: 6 }] },
    { group: 'Self-replicating loops', name: 'SDSR Loop', rule: 'SDSR-Loop', engine: 'hash',
      desc: 'Sayama\'s structurally dissolving loop: loops that cannot reproduce dissolve, clearing room for others.',
      patterns: [{ name: 'One loop', file: G + 'SDSR-Loop.rle', speed: [0, 1], zoom: 6 }] },
    { group: 'Self-replicating loops', name: 'Byl\'s Loop', rule: 'Byl-Loop', engine: 'hash',
      desc: 'John Byl\'s 1989 simplification: a 12-cell loop in six states that copies itself every 25 steps.',
      patterns: [{ name: 'One loop', file: G + 'Byl-Loop.rle', speed: [30, 0], zoom: 12 }] },
    { group: 'Self-replicating loops', name: 'Chou-Reggia Loops', rule: 'Chou-Reggia-1', engine: 'hash',
      desc: 'Reggia and colleagues (1993) removed the sheath and got replicators of just five or six cells.',
      patterns: [{ name: 'Loop 1', file: G + 'Chou-Reggia-Loop-1.rle', speed: [30, 0], zoom: 12 }] },
    { group: 'Self-replicating loops', name: 'Chou-Reggia Loop 2', rule: 'Chou-Reggia-2', engine: 'hash',
      desc: 'The five-cell version.',
      patterns: [{ name: 'Loop 2', file: G + 'Chou-Reggia-Loop-2.rle', speed: [30, 0], zoom: 12 }] },
    { group: 'Self-replicating loops', name: 'Tempesti\'s Loop', rule: 'Tempesti', engine: 'hash',
      desc: 'Gianluca Tempesti\'s 1995 loop builds an empty skeleton first, then lets the instructions flow in. Finished loops stay alive and can carry a program.',
      patterns: [{ name: 'One loop', file: G + 'Tempesti-Loop.rle', speed: [0, 0], zoom: 5 }] },
    { group: 'Self-replicating loops', name: 'Perrier\'s Loop', rule: 'Perrier', engine: 'hash',
      desc: 'A 64-state loop that, after replicating itself and its program and data stacks, goes on to execute the program: a self-reproducing universal computer.',
      patterns: [{ name: 'Loop with program', file: G + 'Perrier-Loop.rle', speed: [0, 0], zoom: 8 }] },
    { group: 'Self-replicating loops', name: 'Codd\'s automaton', rule: 'Codd', engine: 'hash',
      desc: 'Edgar Codd\'s 1968 eight-state simplification of von Neumann\'s design: signals travel along sheathed wires.',
      patterns: [
        { name: 'Signal trains', file: G + 'signals-demo.rle', speed: [8, 0], zoom: 20 },
        { name: 'Goucher\'s self-replicating machine', file: G + 'Goucher-replicator.mc.gz', speed: [0, 20], zoom: 2,
          desc: 'Adam Goucher\'s 2009 complete self-replicating machine in Codd\'s rule. It is enormous and needs very large step sizes.' }] },
    { group: 'Self-replicating loops', name: 'Devore\'s machine', rule: 'Devore', engine: 'hash',
      desc: 'The Devore variation of Codd\'s self-replicating computer. The machine is at the left end of its tape; replication takes about 1e11 steps.',
      patterns: [{ name: 'Self-replicating computer', file: G + 'Devore-rep.rle', speed: [0, 18], zoom: 3, focus: 'left' }] },

    { group: 'Life and relatives', name: 'Conway\'s Game of Life', rule: 'B3/S23', engine: 'hash',
      desc: 'The classic. A dead cell with exactly three live neighbours is born; a live cell with two or three survives.',
      patterns: [
        { name: 'Gosper glider gun', rle: P.gun, speed: [60, 0], zoom: 10 },
        { name: 'R-pentomino', rle: P.rpent, speed: [60, 0], zoom: 5 },
        { name: 'Acorn', rle: P.acorn, speed: [60, 0], zoom: 4 },
        { name: 'Diehard', rle: P.diehard, speed: [30, 0], zoom: 10 },
        { name: 'Ten-cell infinite growth', rle: P.growth, speed: [60, 1], zoom: 4 },
        { name: 'Pulsar', rle: P.pulsar, speed: [8, 0], zoom: 24 },
        { name: 'Lightweight spaceship', rle: P.lwss, speed: [20, 0], zoom: 16 },
        { name: 'Random soup (unbounded)', ...soup(256, 256, 0.35), speed: [60, 0], zoom: 3 },
        { name: 'Random soup on a 1024 torus', ...soup(0, 0, 0.3), engine: 'dense', size: 1024, speed: [60, 0], zoom: 1 },
      ] },
    { group: 'Life and relatives', name: 'Day & Night', rule: 'B3678/S34678', engine: 'dense', size: 512,
      desc: 'Symmetric under swapping live and dead: every pattern has a negative twin that behaves identically.',
      patterns: [{ name: 'Random soup', ...soup(0, 0, 0.5), zoom: 2 }] },
    { group: 'Life and relatives', name: 'Seeds', rule: 'B2/S', engine: 'hash',
      desc: 'Nothing survives a generation, yet almost any seed explodes.',
      patterns: [{ name: 'Two cells', rle: 'o$o!', speed: [30, 0], zoom: 5 }, { name: 'Small soup', ...soup(6, 6, 0.4), speed: [30, 0], zoom: 4 }] },
    { group: 'Life and relatives', name: 'Life without Death', rule: 'B3/S012345678', engine: 'hash',
      desc: 'Cells are born as in Life and never die. Growth is punctuated by fast "ladders".',
      patterns: [{ name: 'Small soup', ...soup(12, 12, 0.4), speed: [60, 0], zoom: 4 }] },
    { group: 'Life and relatives', name: 'Maze', rule: 'B3/S12345', engine: 'hash',
      desc: 'Grows corridors that look like a hand-drawn maze.',
      patterns: [{ name: 'Small soup', ...soup(10, 10, 0.45), speed: [60, 0], zoom: 5 }] },
    { group: 'Life and relatives', name: 'Diamoeba', rule: 'B35678/S5678', engine: 'dense', size: 512,
      desc: 'Large diamond-shaped amoebas with restless borders.',
      patterns: [{ name: 'Dense blob', ...soup(256, 256, 0.52), zoom: 2 }] },
    { group: 'Life and relatives', name: 'Anneal', rule: 'B4678/S35678', engine: 'dense', size: 512,
      desc: 'A majority vote with a twist. Noise condenses into smooth domains, like a cooling alloy.',
      patterns: [{ name: 'Random soup', ...soup(0, 0, 0.5), zoom: 2 }] },
    { group: 'Life and relatives', name: 'Morley', rule: 'B368/S245', engine: 'dense', size: 512,
      desc: 'Also called Move. Rich in natural spaceships and slow, wandering debris.',
      patterns: [{ name: 'Random soup', ...soup(0, 0, 0.2), zoom: 2 }] },
    { group: 'Life and relatives', name: 'Persian rug', rule: 'B234/S', engine: 'hash',
      desc: 'A 2x2 block unfolds into an ever larger symmetric carpet.',
      patterns: [{ name: 'Block', rle: P.block, speed: [20, 0], zoom: 5 }] },
    { group: 'Life and relatives', name: 'Ulam-Warburton', rule: 'B1/S01234V', engine: 'hash',
      desc: 'A cell is born next to exactly one live orthogonal neighbour. The result is a fractal that HashLife compresses extremely well: try step sizes of 2^10 and beyond.',
      patterns: [{ name: 'Single cell', rle: P.dot, speed: [20, 0], zoom: 6 }] },
    { group: 'Life and relatives', name: 'H-trees', rule: 'B1/S012345678', engine: 'hash',
      desc: 'Birth on one neighbour, no death, Moore neighbourhood. Square fractal snowflakes.',
      patterns: [{ name: 'Single cell', rle: P.dot, speed: [20, 0], zoom: 6 }] },
    { group: 'Life and relatives', name: 'Gnarl', rule: 'B1/S1', engine: 'hash',
      desc: 'A single cell grows into a chaotic, four-fold symmetric tangle.',
      patterns: [{ name: 'Single cell', rle: P.dot, speed: [30, 0], zoom: 4 }] },

    { group: 'Generations (cells that fade)', name: 'Brian\'s Brain', rule: 'B2/S/C3', engine: 'dense', size: 512,
      desc: 'Three states: firing, refractory, ready. The whole field boils with small gliders.',
      patterns: [{ name: 'Random soup', ...soup(0, 0, 0.08), zoom: 2 }] },
    { group: 'Generations (cells that fade)', name: 'Star Wars', rule: 'B2/S345/C4', engine: 'dense', size: 512,
      desc: 'Stable walls, ships that shuttle along them, and guns that form on their own.',
      patterns: [{ name: 'Random soup', ...soup(0, 0, 0.12), zoom: 2 }] },
    { group: 'Generations (cells that fade)', name: 'Bombers', rule: 'B24/S345/C25', engine: 'dense', size: 512,
      desc: 'Long 25-state decay trails behind slow-moving fronts.',
      patterns: [{ name: 'Random soup', ...soup(0, 0, 0.1), zoom: 2 }] },
    { group: 'Generations (cells that fade)', name: 'Faders', rule: 'B2/S2/C25', engine: 'dense', size: 512,
      desc: 'Fast sparks leaving long comet tails.',
      patterns: [{ name: 'Sparse soup', ...soup(96, 96, 0.3), zoom: 2 }] },
    { group: 'Generations (cells that fade)', name: 'Fireworks', rule: 'B13/S2/C21', engine: 'dense', size: 512,
      desc: 'Expanding bursts with long fading trails.',
      patterns: [{ name: 'A few sparks', ...soup(40, 40, 0.02), zoom: 2 }] },
    { group: 'Generations (cells that fade)', name: 'Bloomerang', rule: 'B34678/S234/C24', engine: 'dense', size: 512,
      desc: 'Blooming, slowly pulsing coral.',
      patterns: [{ name: 'Random soup', ...soup(128, 128, 0.35), zoom: 2 }] },
    { group: 'Generations (cells that fade)', name: 'Burst', rule: 'B3468/S0235678/C9', engine: 'dense', size: 512,
      desc: 'Solid islands that erupt at their edges.',
      patterns: [{ name: 'Random soup', ...soup(0, 0, 0.3), zoom: 2 }] },

    { group: 'Computation', name: 'WireWorld', rule: 'WireWorld', engine: 'hash',
      desc: 'Brian Silverman\'s circuit automaton: electron heads and tails run along copper. Three clocks of different periods sit behind diodes and feed a shared bus.',
      patterns: [
        { name: 'Computer that prints the primes', file: G + 'wireworld/primes.mc', speed: [0, 6], zoom: 2,
          desc: 'A full stored-program computer built from WireWorld wire by David Moore, Mark Owen and others. Its program computes prime numbers and shows them on the seven-segment display at the top right. Each new prime takes tens of thousands of steps.' },
        { name: 'Clocks, diodes and a bus', cells: wireworld, speed: [20, 0], zoom: 8 },
        { name: 'Logic gates: AND', file: G + 'wireworld/gate-AND.mcl', speed: [15, 0], zoom: 14 },
        { name: 'Logic gates: OR', file: G + 'wireworld/gate-OR.mcl', speed: [15, 0], zoom: 14 },
        { name: 'Logic gates: XOR', file: G + 'wireworld/gate-XOR.mcl', speed: [15, 0], zoom: 14 },
        { name: 'Logic gates: NOT', file: G + 'wireworld/gate-NOT.mcl', speed: [15, 0], zoom: 14 },
        { name: 'Clocks', file: G + 'wireworld/clocks.mcl', speed: [15, 0], zoom: 12 },
        { name: 'Flip-flop', file: G + 'wireworld/flip-flop.mcl', speed: [15, 0], zoom: 12 },
        { name: 'Memory cell', file: G + 'wireworld/memory-cell.mcl', speed: [15, 0], zoom: 12 },
        { name: 'Sample circuit', file: G + 'wireworld/circuit.mcl', speed: [15, 0], zoom: 10 },
        { name: '8-bit multiplier (Nick Gardner)', file: G + 'wireworld/NickGardner.mcl', speed: [60, 1], zoom: 4 },
        { name: 'Multiplier (Nyles Heise)', file: G + 'wireworld/NylesHeise.mcl', speed: [60, 1], zoom: 4 },
        { name: 'Unary multiplier in a Turing machine', file: G + 'wireworld/unary-multiplier.mcl', speed: [60, 1], zoom: 5 }] },
    { group: 'Computation', name: 'Langton\'s Ant', rule: 'LangtonsAnt', engine: 'hash',
      desc: 'A two-dimensional Turing machine written as a 10-state CA. After about 10,000 steps of chaos the ant settles into building an endless diagonal highway.',
      patterns: [
        { name: 'One ant', cells: () => [0, 0, 4], speed: [0, 4], zoom: 8 },
        { name: 'Four ants', cells: () => [0, 0, 4, 40, 0, 8, 0, 40, 2, 40, 40, 6], speed: [0, 4], zoom: 6 },
      ] },
    { group: 'Computation', name: 'Rule 110', rule: 'W110', engine: 'hash',
      desc: 'A one-dimensional rule proved Turing-complete by Matthew Cook. Time runs downward.',
      patterns: [
        { name: 'Random row', cells: () => { const r = lcg(7); return row(1200, () => r() < 0.5 ? 1 : 0); }, speed: [60, 0], zoom: 2 },
        { name: 'Single cell', rle: P.dot, speed: [60, 0], zoom: 3 },
      ] },
    { group: 'Computation', name: 'Rule 30', rule: 'W30', engine: 'hash',
      desc: 'Wolfram\'s chaotic rule. The centre column passes statistical tests for randomness.',
      patterns: [{ name: 'Single cell', rle: P.dot, speed: [60, 0], zoom: 3 }] },
    { group: 'Computation', name: 'Rule 90', rule: 'W90', engine: 'hash',
      desc: 'XOR of the two neighbours. A single cell draws the Sierpinski triangle.',
      patterns: [{ name: 'Single cell', rle: P.dot, speed: [60, 0], zoom: 3 }] },
    { group: 'Computation', name: 'Rule 184', rule: 'W184', engine: 'hash',
      desc: 'A minimal traffic model: cars move right when the cell ahead is free.',
      patterns: [{ name: 'Random row', cells: () => { const r = lcg(3); return row(800, () => r() < 0.5 ? 1 : 0); }, speed: [60, 0], zoom: 2 }] },

    { group: 'Larger than Life and cyclic', name: 'Bosco\'s Rule', rule: 'R5,C0,M1,S34..58,B34..45,NM', engine: 'dense', size: 512,
      desc: 'Kellie Evans\' range-5 rule. Each cell looks at 120 neighbours, and the gliders are smooth, bug-like blobs.',
      patterns: [{ name: 'Random soup', ...soup(0, 0, 0.42), zoom: 2 }] },
    { group: 'Larger than Life and cyclic', name: 'Majority (range 4)', rule: 'R4,C0,M1,S41..81,B41..81,NM', engine: 'dense', size: 512,
      desc: 'Each cell adopts the majority of its 9x9 block. Noise smooths into curved domains.',
      patterns: [{ name: 'Random soup', ...soup(0, 0, 0.5), zoom: 2 }] },
    { group: 'Larger than Life and cyclic', name: 'Waffle', rule: 'R7,C0,M1,S100..200,B75..170,NM', engine: 'dense', size: 512,
      desc: 'A range-7 rule that settles into a waffle of stripes and cells.',
      patterns: [{ name: 'Random soup', ...soup(0, 0, 0.5), zoom: 2 }] },
    { group: 'Larger than Life and cyclic', name: 'Cyclic spirals', rule: 'Cyclic:14,1,V', engine: 'dense', size: 512,
      desc: 'David Griffeath\'s cyclic automaton: a cell advances when a neighbour is one step ahead. Random noise organises itself into rotating spirals.',
      patterns: [{ name: 'Random soup', random: { w: 0, h: 0, density: 1, states: 'all' }, zoom: 2 }] },
    { group: 'Larger than Life and cyclic', name: 'Cyclic 313', rule: 'Cyclic:3,3,M', engine: 'dense', size: 512,
      desc: 'Three states, threshold three. Tight, fast spirals.',
      patterns: [{ name: 'Random soup', random: { w: 0, h: 0, density: 1, states: 'all' }, zoom: 2 }] },
    { group: 'Larger than Life and cyclic', name: 'Cyclic turbulence', rule: 'Cyclic:8,2,M', engine: 'dense', size: 512,
      desc: 'Eight states, threshold two. Large slow wavefronts.',
      patterns: [{ name: 'Random soup', random: { w: 0, h: 0, density: 1, states: 'all' }, zoom: 2 }] },
  ];

  CA.CUSTOM_JS_EXAMPLE = `// Return the next state of the centre cell.
// c is the cell; n, ne, e, se, s, sw, w, nw are its neighbours; N is the state count.
// Example: a rock-paper-scissors rule. A cell is beaten when 3 or more
// neighbours hold the state that defeats it.
const beats = c % 3 + 1;
let k = 0;
if (n === beats) k++; if (ne === beats) k++; if (e === beats) k++; if (se === beats) k++;
if (s === beats) k++; if (sw === beats) k++; if (w === beats) k++; if (nw === beats) k++;
if (c === 0) return n || e || s || w;   // empty cells get colonised
return k >= 3 ? beats : c;`;

  CA.CUSTOM_TABLE_EXAMPLE = `# Golly rule table format. Inputs are C,N,E,S,W then the new state
# (or C,N,NE,E,SE,S,SW,W,NW for neighborhood:Moore).
n_states:3
neighborhood:vonNeumann
symmetries:rotate4
var a={0,1,2}
var b={0,1,2}
var c={0,1,2}
var d={0,1,2}
# an empty cell next to a live one catches fire
0,1,a,b,c,1
# burning cells cool, cooled cells clear
1,a,b,c,d,2
2,a,b,c,d,0`;
})(typeof self !== 'undefined' ? self : globalThis);
