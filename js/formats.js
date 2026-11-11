// Pattern file formats: extended RLE (Golly flavour, up to 255 states) in and out.
(function (root) {
  'use strict';
  const CA = root.CA || (root.CA = {});

  // Calls cb(x, y, state) for every live cell. Returns { rule, w, h, comments }.
  CA.parseRLE = function (text, cb) {
    let rule = null, w = 0, h = 0, pos = 0;
    const comments = [];
    const len = text.length;
    // header and comment lines
    while (pos < len) {
      let end = text.indexOf('\n', pos); if (end < 0) end = len;
      const line = text.slice(pos, end).trim();
      if (line === '' ) { pos = end + 1; continue; }
      if (line[0] === '#') { if (!/^#(CXRLE|[rPR])/.test(line)) comments.push(line.replace(/^#[CcDNO]?\s?/, '')); pos = end + 1; continue; }
      const m = /^x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)(?:\s*,\s*rule\s*=\s*(.+))?/i.exec(line);
      if (m) { w = +m[1]; h = +m[2]; if (m[3]) rule = m[3].trim(); pos = end + 1; }
      break;
    }
    let x = 0, y = 0, run = 0, hi = 0;
    for (; pos < len; pos++) {
      const c = text.charCodeAt(pos);
      if (c >= 48 && c <= 57) { run = run * 10 + (c - 48); continue; }
      if (c === 33) break;                                     // !
      if (c <= 32) continue;
      if (c === 35) { while (pos < len && text.charCodeAt(pos) !== 10) pos++; continue; } // stray comment
      const n = run || 1; run = 0;
      if (c === 36) { y += n; x = 0; continue; }               // $
      if (c === 98 || c === 46) { x += n; hi = 0; continue; }  // b .
      let s;
      if (c === 111) s = 1;                                    // o
      else if (c >= 112 && c <= 121) { hi = (c - 111) * 24; run = n === 1 ? 0 : n; continue; } // p..y prefix
      else if (c >= 65 && c <= 88) { s = hi + (c - 64); hi = 0; }
      else continue;
      for (let i = 0; i < n; i++) cb(x + i, y, s);
      x += n;
    }
    return { rule, w, h, comments };
  };

  // MCell .mcl files (Golly ships its WireWorld circuits in this format).
  CA.parseMCL = function (text, cb) {
    let rule = null, data = '';
    const comments = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('#L')) data += line.slice(2).trim();
      else if (line.startsWith('#GOLLY')) rule = line.slice(6).trim();
      else if (line.startsWith('#D')) comments.push(line.slice(2).trim());
    }
    CA.parseRLE('x = 0, y = 0\n' + data + '!', cb);
    return { rule, comments, w: 0, h: 0 };
  };

  // cells: flat array [x, y, state, ...]
  CA.writeRLE = function (cells, ruleName) {
    const n = cells.length / 3;
    if (!n) return `x = 0, y = 0, rule = ${ruleName}\n!\n`;
    const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    const order = Array.from(idx).sort((p, q) => (cells[p * 3 + 1] - cells[q * 3 + 1]) || (cells[p * 3] - cells[q * 3]));
    let x0 = Infinity, x1 = -Infinity, multi = false;
    for (let i = 0; i < n; i++) { const x = cells[i * 3]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (cells[i * 3 + 2] > 1) multi = true; }
    const y0 = cells[order[0] * 3 + 1], y1 = cells[order[n - 1] * 3 + 1];
    const sym = s => {
      if (s === 0) return multi ? '.' : 'b';
      if (!multi) return 'o';
      if (s <= 24) return String.fromCharCode(64 + s);
      return String.fromCharCode(111 + Math.floor((s - 1) / 24)) + String.fromCharCode(65 + (s - 1) % 24);
    };
    const out = [];
    let line = '';
    const emit = (cnt, tok) => {
      const t = (cnt > 1 ? cnt : '') + tok;
      if (line.length + t.length > 70) { out.push(line); line = ''; }
      line += t;
    };
    let cy = y0, cx = x0, rs = -1, rc = 0;
    const flush = () => { if (rc) emit(rc, sym(rs)); rc = 0; };
    for (let i = 0; i < n; i++) {
      const p = order[i] * 3, x = cells[p], y = cells[p + 1], s = cells[p + 2];
      if (y !== cy) { flush(); emit(y - cy, '$'); cy = y; cx = x0; }
      if (x > cx) { if (rs !== 0) flush(); rs = 0; rc += x - cx; cx = x; }
      if (rs !== s) flush();
      rs = s; rc++; cx = x + 1;
    }
    flush(); line += '!'; out.push(line);
    return `x = ${x1 - x0 + 1}, y = ${y1 - y0 + 1}, rule = ${ruleName}\n` + out.join('\n') + '\n';
  };
})(typeof self !== 'undefined' ? self : globalThis);
