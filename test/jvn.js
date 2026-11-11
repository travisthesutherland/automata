const fs = require('fs'), vm = require('vm'), path = require('path');
for (const f of ['rules', 'tables', 'hashlife', 'dense', 'formats', 'presets']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js/' + f + '.js'), 'utf8'));
const jvn = CA.PRESETS[0];
for (const pat of jvn.patterns) {
  const h = new CA.HashLife(CA.compileRule('JvN29'), 1 << 21);
  const c = pat.cells(); for (let i = 0; i < c.length; i += 3) h.setCell(c[i], c[i + 1], c[i + 2]);
  const p0 = h.population; const counts = [];
  for (let t = 0; t < 2048; t++) { h.step(); if ((t + 1) % 256 === 0) counts.push(h.population); }
  let sens = 0, kinds = {}; h.forEachCell((x, y, s) => { if (s >= 1 && s <= 8) sens++; const k = s < 9 ? 'sens' : s < 17 ? 'ots' + ((s - 9) % 4) : s < 25 ? 'sts' : 'conf'; kinds[k] = (kinds[k] || 0) + 1; });
  const b = h.bounds();
  console.log(pat.name, '| start', p0, '| pop every 256:', counts.join(' '), '| bounds', b.x1 - b.x0 + 1, 'x', b.y1 - b.y0 + 1, JSON.stringify(kinds));
}
// picture of the first one after 300 ticks
const h = new CA.HashLife(CA.compileRule('JvN29'), 1 << 21);
const c = jvn.patterns[0].cells(); for (let i = 0; i < c.length; i += 3) h.setCell(c[i], c[i + 1], c[i + 2]);
for (let t = 0; t < 400; t++) h.step();
const b = h.bounds(); const ch = '.SSSSSSSS>^<v>^<v}^{v}^{vCCCC';
for (let y = b.y0; y <= b.y1; y++) { let r = ''; for (let x = b.x0; x <= b.x1; x++) r += ch[h.getCell(x, y)]; console.log(r); }
