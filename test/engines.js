// Engine checks: node test/engines.js
const fs = require('fs'), vm = require('vm'), path = require('path');
for (const f of ['rules', 'tables', 'hashlife', 'dense', 'formats']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js/' + f + '.js'), 'utf8'), { filename: f + '.js' });
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const load = (eng, rle) => { const c = []; CA.parseRLE(rle, (x, y, s) => c.push(x, y, s)); for (let i = 0; i < c.length; i += 3) eng.setCell(c[i], c[i + 1], c[i + 2]); };
const cellsOf = eng => { const a = []; eng.forEachCell((x, y, s) => { a.push(x + ',' + y + ',' + s); }); return a.sort().join(';'); };
const GUN = '24bo11b$22bobo11b$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o14b$2o8bo3bob2o4bobo11b$10bo5bo7bo11b$11bo3bo20b$12b2o!';

// 1. Life: HashLife vs torus on the R-pentomino for 200 generations (well inside a 512 torus)
{
  const life = CA.compileRule('B3/S23');
  const h = new CA.HashLife(life, 1 << 20), d = new CA.DenseGrid(life, 512, 512);
  load(h, 'b2o$2o$bo!'); load(d, 'b2o$2o$bo!');
  for (let i = 0; i < 200; i++) { h.step(); d.step(); }
  ok(cellsOf(h) === cellsOf(d), 'R-pentomino: HashLife == torus after 200 gens (pop ' + h.population + ')');
  // known: R-pentomino stabilises at gen 1103 with 116 cells
  const h2 = new CA.HashLife(life, 1 << 20); load(h2, 'b2o$2o$bo!');
  h2.setStep(0); for (let i = 0; i < 1103; i++) h2.step();
  ok(h2.population === 116, 'R-pentomino population at gen 1103 is 116 (got ' + h2.population + ')');
}
// 2. Hyperspeed: Gosper gun, population after 2^k gens via big steps equals small steps
{
  const life = CA.compileRule('B3/S23');
  const a = new CA.HashLife(life, 1 << 21), b = new CA.HashLife(life, 1 << 21);
  load(a, GUN); load(b, GUN);
  a.setStep(10); a.step();                 // 1024 gens in one jump
  b.setStep(3); for (let i = 0; i < 128; i++) b.step();
  ok(a.gen === 1024n && b.gen === 1024n && cellsOf(a) === cellsOf(b), 'Gosper gun: one 2^10 jump == 128 x 2^3 steps (pop ' + a.population + ')');
  a.setStep(30); const t = Date.now(); a.step(); a.step();
  // gun emits one glider (5 cells) every 30 gens: population grows linearly
  ok(a.population > 3.5e8 && a.population < 3.7e8, 'Gosper gun after ~2^31 gens: pop ' + a.population + ' in ' + (Date.now() - t) + ' ms, nodes ' + (a.count >> 3));
  const bb = a.bounds(); ok(bb && bb.x1 - bb.x0 > 5e8, 'bounds span ' + (bb.x1 - bb.x0));
}
// 3. GC under a tiny memory budget still gives the right answer
{
  const life = CA.compileRule('B3/S23');
  const a = new CA.HashLife(life, 1 << 16), b = new CA.HashLife(life, 1 << 21);
  load(a, 'bo5b$3bo3b$2o2b3o!'); load(b, 'bo5b$3bo3b$2o2b3o!');
  a.setStep(2); b.setStep(2);
  for (let i = 0; i < 1500; i++) { a.step(); } while (b.gen < a.gen) b.step();
  ok(a.gcCount > 0 && a.gen === b.gen && cellsOf(a) === cellsOf(b), 'Acorn with 65k-node budget: ' + a.gcCount + ' GCs, gen ' + a.gen + ', matches (pop ' + a.population + ')');
}
// 4. Generations + table + von Neumann neighbourhood agree between engines
for (const r of ['B2/S/C3', 'B2/S345/C4', 'B1/S01234V', 'WireWorld', 'Cyclic:5,1,V', 'LangtonsAnt']) {
  const rule = CA.compileRule(r);
  const h = new CA.HashLife(rule, 1 << 21), d = new CA.DenseGrid(rule, 256, 256);
  let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = -8; y < 8; y++) for (let x = -8; x < 8; x++) if (rnd() < 0.4) { const st = 1 + ((rnd() * (rule.states - 1)) | 0); h.setCell(x, y, st); d.setCell(x, y, st); }
  for (let i = 0; i < 40; i++) { h.step(); d.step(); }
  ok(cellsOf(h) === cellsOf(d), r + ': HashLife == torus after 40 gens (pop ' + h.population + ')');
}
// 5. Langton's ant: highway begins around step 10000; population at 11000 is known to be 1042 black cells? check ant count == 1
{
  const rule = CA.compileRule('LangtonsAnt');
  const h = new CA.HashLife(rule, 1 << 21); h.setCell(0, 0, 4);
  h.setStep(3); for (let i = 0; i < 1375; i++) h.step(); // 11000
  let ants = 0, black = 0; h.forEachCell((x, y, s) => { if (s > 1) ants++; if (s & 1) black++; });
  ok(ants === 1, "Langton's ant: exactly one ant after 11000 steps, " + black + ' black cells');
}
// 6. von Neumann: a period-6 pulser feeding "100000" down a wire makes the wire grow one cell per 7 ticks
{
  const rule = CA.compileRule('JvN29');
  const h = new CA.HashLife(rule, 1 << 21);
  // period-6 loop (two confluent cells, two arrows). The wire end recedes from the pulses,
  // so each new cell costs period + 1 = 7 ticks
  h.setCell(0, 0, 25); h.setCell(1, 0, 16); h.setCell(1, 1, 25); h.setCell(0, 1, 10);
  for (let x = 2; x < 6; x++) h.setCell(x, 1, 9);
  const len = () => { let m = 0; h.forEachCell((x, y, s) => { if (y === 1 && s >= 9 && s <= 16 && x > m) m = x; }); return m; };
  for (let i = 0; i < 100; i++) h.step();
  const l1 = len(); for (let i = 0; i < 700; i++) h.step(); const l2 = len();
  ok(l2 - l1 === 100, 'JvN29 self-extending wire grows 100 cells in 700 ticks (grew ' + (l2 - l1) + ')');
  h.setStep(20); const t = Date.now(); h.step();
  ok(Math.abs(len() - (1 << 20) / 7) < 200, 'JvN29 hyperspeed: wire length ' + len() + ' after 2^20 more ticks, ' + (Date.now() - t) + ' ms');
}
// 7. Golly table parser: a rotate4 table equivalent to B1/S01234V should match the built-in rule
{
  const table = '@TABLE\nn_states:2\nneighborhood:vonNeumann\nsymmetries:rotate4\nvar a={0,1}\nvar b={0,1}\nvar c={0,1}\n0,1,0,0,0,1\n';
  const t = CA.compileRule({ type: 'table', text: table }), u = CA.compileRule('B1/S01234V');
  let same = true;
  for (let i = 0; i < 32; i++) { const v = [i & 1, (i >> 1) & 1, (i >> 2) & 1, (i >> 3) & 1, (i >> 4) & 1]; if (t.f(v[0], v[1], 0, v[2], 0, v[3], 0, v[4], 0) !== u.f(v[0], v[1], 0, v[2], 0, v[3], 0, v[4], 0)) same = false; }
  ok(same, 'table rule == B1/S01234V on all 32 neighbourhoods');
}
// 8. RLE round trip (multi-state)
{
  const cells = [0, 0, 1, 1, 0, 25, 5, 0, 31, 0, 2, 9, 3, 2, 9, 4, 2, 9];
  const txt = CA.writeRLE(cells, 'Nobili32'); const back = [];
  CA.parseRLE(txt, (x, y, s) => back.push(x, y, s));
  ok(JSON.stringify(back) === JSON.stringify(cells), 'RLE round trip: ' + txt.split('\n')[1]);
}
// 9. Larger than Life runs and LtL R1 matches Life
{
  const a = new CA.DenseGrid(CA.compileRule('R1,C0,M0,S2..3,B3..3,NM'), 128, 128), b = new CA.DenseGrid(CA.compileRule('B3/S23'), 128, 128);
  load(a, 'b2o$2o$bo!'); load(b, 'b2o$2o$bo!');
  for (let i = 0; i < 300; i++) { a.step(); b.step(); }
  ok(cellsOf(a) === cellsOf(b) && a.population === b.population, 'LtL R1 == Life on a torus after 300 gens (pop ' + a.population + ')');
}
// 10. torus speed
{
  const d = new CA.DenseGrid(CA.compileRule('B3/S23'), 1024, 1024);
  for (let i = 0; i < 300000; i++) d.setCell((Math.random() * 1024) | 0, (Math.random() * 1024) | 0, 1);
  const t = Date.now(); for (let i = 0; i < 50; i++) d.step();
  console.log('     torus 1024^2 Life: ' + ((Date.now() - t) / 50).toFixed(1) + ' ms/gen');
  const g = new CA.DenseGrid(CA.compileRule('B2/S345/C4'), 1024, 1024);
  for (let i = 0; i < 300000; i++) g.setCell((Math.random() * 1024) | 0, (Math.random() * 1024) | 0, 1);
  const t2 = Date.now(); for (let i = 0; i < 50; i++) g.step();
  console.log('     torus 1024^2 Star Wars: ' + ((Date.now() - t2) / 50).toFixed(1) + ' ms/gen');
}
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
