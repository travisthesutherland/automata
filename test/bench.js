// Speed on the compact von Neumann replicator: node test/bench.js <P> <maxNodes> [seconds]
const fs = require('fs'), vm = require('vm'), path = require('path');
for (const f of ['rules', 'tables', 'hashlife', 'dense', 'formats']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../js/' + f + '.js'), 'utf8'), { filename: f + '.js' });
const text = fs.readFileSync(path.join(__dirname, '../patterns/golly/small-JvN-self-replicator.rle'), 'utf8'); const cells = [];
const head = CA.parseRLE(text, (x, y, s) => cells.push(x, y, s));
const P = +process.argv[2], cap = +process.argv[3], secs = +process.argv[4] || 8;
const h = new CA.HashLife(CA.compileRule(head.rule), cap);
for (let i = 0; i < cells.length; i += 3) h.setCell(cells[i], cells[i + 1], cells[i + 2]);
h.setStep(P); const t = Date.now();
while (Date.now() - t < secs * 1000) h.step();
console.log('P', P, 'cap', (cap / 1e6).toFixed(2) + 'M', '|', (Number(h.gen) / ((Date.now() - t) / 1000)).toFixed(0).padStart(6), 'gen/s | gc', h.gcCount, 'P now', h.P, 'pop', h.population);
