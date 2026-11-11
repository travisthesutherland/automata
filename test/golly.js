// Runs the downloaded Golly patterns: node test/golly.js
const fs = require('fs'), vm = require('vm'), path = require('path'), zlib = require('zlib');
for (const f of ['rules', 'tables', 'hashlife', 'dense', 'formats']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js/' + f + '.js'), 'utf8'), { filename: f + '.js' });
const dir = path.join(__dirname, '../patterns/golly/');
const read = f => { const b = fs.readFileSync(dir + f); return (f.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString(); };
const loadRLE = (f, nodes) => {
  const text = read(f); const cells = [];
  const head = CA.parseRLE(text, (x, y, s) => cells.push(x, y, s));
  const t0 = Date.now(); const rule = CA.compileRule(head.rule); const tc = Date.now() - t0;
  const h = new CA.HashLife(rule, nodes || 1 << 22);
  for (let i = 0; i < cells.length; i += 3) h.setCell(cells[i], cells[i + 1], cells[i + 2]);
  return { h, head, tc };
};
const run = (h, P, steps) => { h.setStep(P); const t = Date.now(); for (let i = 0; i < steps; i++) h.step(); return Date.now() - t; };
for (const [f, P, steps] of [['Langtons-Loops.rle', 0, 151 * 4], ['Byl-Loop.rle', 0, 200], ['Chou-Reggia-Loop-1.rle', 0, 200], ['Chou-Reggia-Loop-2.rle', 0, 200], ['Evoloop.rle', 2, 500], ['SDSR-Loop.rle', 2, 500], ['Tempesti-Loop.rle', 2, 500], ['Perrier-Loop.rle', 2, 500], ['signals-demo.rle', 0, 50]]) {
  try { const { h, head, tc } = loadRLE(f); const p0 = h.population; const ms = run(h, P, steps); console.log(f.padEnd(28), head.rule.padEnd(16), 'compile', tc, 'ms | pop', p0, '->', h.population, 'at gen', h.gen, '|', ms, 'ms'); }
  catch (e) { console.log(f, 'ERROR', e.message || e); }
}
for (const [f, P, steps] of [['counter-demo.rle', 0, 300], ['cell-coders-demo.rle', 0, 5], ['golly-constructor.rle', 6, 300], ['small-JvN-self-replicator.rle', 12, 220]]) {
  try { const { h, head } = loadRLE(f); const p0 = h.population, b0 = h.bounds(); const ms = run(h, P, steps); const b = h.bounds(); console.log(f.padEnd(30), head.rule.padEnd(9), 'pop', p0, '->', h.population, 'gen', h.gen, '| size', (b0.x1 - b0.x0 + 1) + 'x' + (b0.y1 - b0.y0 + 1), '->', (b.x1 - b.x0 + 1) + 'x' + (b.y1 - b.y0 + 1), '|', ms, 'ms, nodes', (h.count >> 3), 'gc', h.gcCount, 'P', h.P); }
  catch (e) { console.log(f, 'ERROR', e.message || JSON.stringify(e)); }
}
// WireWorld (MCell files and the primes computer) and the big macrocell machines
for (const f of ['wireworld/clocks.mcl', 'wireworld/NickGardner.mcl']) {
  const cells = []; const head = CA.parseMCL(read(f), (x, y, s) => cells.push(x, y, s));
  const h = new CA.HashLife(CA.compileRule(head.rule), 1 << 21);
  for (let i = 0; i < cells.length; i += 3) h.setCell(cells[i], cells[i + 1], cells[i + 2]);
  const count = () => { const c = [0, 0, 0, 0]; h.forEachCell((x, y, s) => { c[s]++; }); return c.slice(1).join('/'); };
  const c0 = count(); run(h, 0, 200); console.log(f.padEnd(28), head.rule, 'head/tail/wire', c0, '->', count());
}
for (const [f, rule, P, steps, nodes] of [['wireworld/primes.mc', 'WireWorld', 8, 40, 4 << 20], ['sphinx.mc.gz', 'JvN29', 16, 8, 6 << 20], ['Goucher-replicator.mc.gz', 'Codd', 16, 4, 6 << 20]]) {
  const h = new CA.HashLife(CA.compileRule(rule), nodes);
  const t0 = Date.now(); const info = h.loadMacrocell(read(f)); const b0 = h.bounds();
  console.log(f.padEnd(28), 'rule', info.rule, 'pop', h.population, 'size', (b0.x1 - b0.x0 + 1) + 'x' + (b0.y1 - b0.y0 + 1), 'nodes', h.count >> 3, 'load', Date.now() - t0, 'ms');
  const ms = run(h, P, steps); console.log('   after', String(h.gen), 'gens: pop', h.population, ms, 'ms, nodes', h.count >> 3, 'gc', h.gcCount, 'P', h.P);
}
