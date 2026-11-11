// Generic multi-state HashLife (Gosper 1984), in the style of Golly's ghashbase:
// a hash-consed quadtree whose level-1 nodes hold four cell states, with a memoised
// "result" per node that jumps the centre of the node forward in time.
// The universe is unbounded; the root is always centred on world (0,0).
(function (root) {
  'use strict';
  const CA = root.CA || (root.CA = {});
  const POW2 = new Float64Array(1100);
  for (let i = 0; i < 1100; i++) POW2[i] = Math.pow(2, Math.min(i, 1023));
  const OOM = { oom: true };

  class HashLife {
    constructor(rule, maxNodes) {
      this.rule = rule;
      this.f = rule.f;
      this.kind = 'hash';
      // Nodes live directly in an open-addressed hash table (linear probing), so finding one
      // costs a single cache miss instead of one for a bucket array and another for the record.
      // One 32-byte record per slot; a node id is the offset of its record:
      //   [nw, ne, sw, se, result (0 = not computed), unused, level (0 = free slot),
      //    representative non-zero state (0 = empty node)]
      // The universe is rebuilt into a fresh table when this one is 70% full.
      let S = 1 << 16; while (S * 2 <= maxNodes) S *= 2;
      this.S = S; this.mask = S * 8 - 8; this.limit = Math.floor(S * 0.7);
      this._alloc();
      this.empties = [0];
      this.P = 0;     // each step advances 2^P generations
      this.gen = 0n;
      this.root = this.empty(3);
      this.gcCount = 0;
    }

    _alloc() {
      this.D = new Int32Array(this.S * 8);
      this.POP = new Float64Array(this.S); // population + 1 (0 = unknown), indexed by id >> 3
      this.D[6] = 255;                     // slot 0 is reserved: id 0 means "none"
      this.count = 1;
      this.empties = [0];
    }

    // ------------------------------------------------------------ node store
    node(nw, ne, sw, se, lv) {
      const D = this.D;
      let h = (Math.imul(nw, 0x9E3779B1) ^ Math.imul(ne, 0x85EBCA6B) ^ Math.imul(sw, 0xC2B2AE35) ^ Math.imul(se, 0x27D4EB2F)) + lv;
      h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 13;
      const mask = this.mask;
      let i = (h << 3) & mask;
      for (; ;) {
        const l = D[i + 6];
        if (l === 0) break;
        if (l === lv && D[i] === nw && D[i + 1] === ne && D[i + 2] === sw && D[i + 3] === se) return i;
        i = (i + 8) & mask;
      }
      if (this.count >= this.limit) throw OOM;
      this.count++;
      D[i] = nw; D[i + 1] = ne; D[i + 2] = sw; D[i + 3] = se; D[i + 6] = lv;
      if (lv === 1) D[i + 7] = nw || ne || sw || se;
      else { D[i + 7] = (lv & 1) ? (D[nw + 7] || D[se + 7] || D[ne + 7] || D[sw + 7]) : (D[se + 7] || D[sw + 7] || D[nw + 7] || D[ne + 7]); }
      return i;
    }

    empty(lv) {
      const e = this.empties;
      while (e.length <= lv) {
        const l = e.length;
        e.push(l === 1 ? this.node(0, 0, 0, 0, 1) : this.node(e[l - 1], e[l - 1], e[l - 1], e[l - 1], l));
      }
      return e[lv];
    }

    expand(n) {
      const D = this.D;
      const lv = D[n + 6], e = this.empty(lv - 1);
      return this.node(
        this.node(e, e, e, D[n], lv), this.node(e, e, D[n + 1], e, lv),
        this.node(e, D[n + 2], e, e, lv), this.node(D[n + 3], e, e, e, lv), lv + 1);
    }

    pop(n) {
      const D = this.D;
      const v = this.POP[n >> 3];
      if (v !== 0) return v - 1;
      let p;
      if (D[n + 7] === 0) p = 0;
      else if (D[n + 6] === 1) p = (D[n] !== 0) + (D[n + 1] !== 0) + (D[n + 2] !== 0) + (D[n + 3] !== 0);
      else p = this.pop(D[n]) + this.pop(D[n + 1]) + this.pop(D[n + 2]) + this.pop(D[n + 3]);
      this.POP[n >> 3] = p + 1;
      return p;
    }
    get population() { return this.pop(this.root); }

    // ----------------------------------------------------------------- step
    _base(n) {
      const D = this.D;
      const f = this.f;
      const a = D[n], b = D[n + 1], c = D[n + 2], d = D[n + 3];
      const c00 = D[a], c01 = D[a + 1], c10 = D[a + 2], c11 = D[a + 3];
      const c02 = D[b], c03 = D[b + 1], c12 = D[b + 2], c13 = D[b + 3];
      const c20 = D[c], c21 = D[c + 1], c30 = D[c + 2], c31 = D[c + 3];
      const c22 = D[d], c23 = D[d + 1], c32 = D[d + 2], c33 = D[d + 3];
      return this.node(
        f(c11, c01, c02, c12, c22, c21, c20, c10, c00),
        f(c12, c02, c03, c13, c23, c22, c21, c11, c01),
        f(c21, c11, c12, c22, c32, c31, c30, c20, c10),
        f(c22, c12, c13, c23, c33, c32, c31, c21, c11), 1);
    }

    _res(n) {
      const D = this.D;
      let r = D[n + 4];
      if (r !== 0) return r;
      const lv = D[n + 6];
      if (lv === 2) r = this._base(n);
      else {
        
        const a = D[n], b = D[n + 1], c = D[n + 2], d = D[n + 3], l1 = lv - 1;
        let n00, n01, n02, n10, n11, n12, n20, n21, n22;
        if (lv - 2 <= this.P) {
          n00 = this._res(a);
          n01 = this._res(this.node(D[a + 1], D[b], D[a + 3], D[b + 2], l1));
          n02 = this._res(b);
          n10 = this._res(this.node(D[a + 2], D[a + 3], D[c], D[c + 1], l1));
          n11 = this._res(this.node(D[a + 3], D[b + 2], D[c + 1], D[d], l1));
          n12 = this._res(this.node(D[b + 2], D[b + 3], D[d], D[d + 1], l1));
          n20 = this._res(c);
          n21 = this._res(this.node(D[c + 1], D[d], D[c + 3], D[d + 2], l1));
          n22 = this._res(d);
        } else {
          // too high up for the requested step size: take the nine centred squares without advancing
          const l2 = lv - 2;
          const q00 = D[a], q01 = D[a + 1], q02 = D[b], q03 = D[b + 1];
          const q10 = D[a + 2], q11 = D[a + 3], q12 = D[b + 2], q13 = D[b + 3];
          const q20 = D[c], q21 = D[c + 1], q22 = D[d], q23 = D[d + 1];
          const q30 = D[c + 2], q31 = D[c + 3], q32 = D[d + 2], q33 = D[d + 3];
          n00 = this.node(D[q00 + 3], D[q01 + 2], D[q10 + 1], D[q11], l2);
          n01 = this.node(D[q01 + 3], D[q02 + 2], D[q11 + 1], D[q12], l2);
          n02 = this.node(D[q02 + 3], D[q03 + 2], D[q12 + 1], D[q13], l2);
          n10 = this.node(D[q10 + 3], D[q11 + 2], D[q20 + 1], D[q21], l2);
          n11 = this.node(D[q11 + 3], D[q12 + 2], D[q21 + 1], D[q22], l2);
          n12 = this.node(D[q12 + 3], D[q13 + 2], D[q22 + 1], D[q23], l2);
          n20 = this.node(D[q20 + 3], D[q21 + 2], D[q30 + 1], D[q31], l2);
          n21 = this.node(D[q21 + 3], D[q22 + 2], D[q31 + 1], D[q32], l2);
          n22 = this.node(D[q22 + 3], D[q23 + 2], D[q32 + 1], D[q33], l2);
        }
        r = this.node(
          this._res(this.node(n00, n01, n10, n11, l1)),
          this._res(this.node(n01, n02, n11, n12, l1)),
          this._res(this.node(n10, n11, n20, n21, l1)),
          this._res(this.node(n11, n12, n21, n22, l1)), l1);
      }
      D[n + 4] = r;
      return r;
    }

    _ringEmpty(n) {
      const D = this.D;
      
      const a = D[n], b = D[n + 1], c = D[n + 2], d = D[n + 3];
      return !(D[D[a] + 7] | D[D[a + 1] + 7] | D[D[a + 2] + 7] | D[D[b] + 7] | D[D[b + 1] + 7] | D[D[b + 3] + 7] |
        D[D[c] + 7] | D[D[c + 2] + 7] | D[D[c + 3] + 7] | D[D[d + 1] + 7] | D[D[d + 2] + 7] | D[D[d + 3] + 7]);
    }

    setStep(P) {
      P = Math.max(0, Math.min(1000, P | 0));
      if (P === this.P) return;
      this.P = P;
      if (this.count > 1) this.gc(); // results cached for the old step size are no longer valid
    }

    _step1() {
      const D = this.D;
      let r = this.root;
      while (D[r + 6] < this.P + 2 || D[r + 6] < 3 || !this._ringEmpty(r)) r = this.expand(r);
      this.root = r;
      this.root = this._res(this.expand(r));
      this.gen += 1n << BigInt(this.P);
    }

    // One step of 2^P generations. Returns a note if memory pressure forced a change.
    step() {
      const D = this.D;
      if (D[this.root + 7] === 0) { this.gen += 1n << BigInt(this.P); return null; }
      let note = null;
      for (let attempt = 0; ; attempt++) {
        try { this._step1(); return note; }
        catch (e) {
          if (e !== OOM) throw e;
          this.gc();
          if (attempt >= 1) {
            if (this.P > 0) { this.setStep(this.P - 1); note = 'memory'; }
            else throw new Error('Out of memory: raise the HashLife memory budget or use a bounded grid');
          }
        }
      }
    }

    // Copy everything reachable from the root into a fresh table. Cached results are dropped.
    gc() {
      const oD = this.D, oP = this.POP;
      this._alloc();
      const copy = (n) => {
        const r = oD[n + 4];
        if (r < 0) return -r - 1; // already moved
        let a = oD[n], b = oD[n + 1], c = oD[n + 2], d = oD[n + 3];
        const lv = oD[n + 6];
        if (lv > 1) { a = copy(a); b = copy(b); c = copy(c); d = copy(d); }
        const id = this.node(a, b, c, d, lv);
        this.POP[id >> 3] = oP[n >> 3];
        oD[n + 4] = -id - 1;
        return id;
      };
      this.root = copy(this.root);
      this.gcCount++;
    }

    _guard(fn) {
      try { return fn(); }
      catch (e) {
        if (e !== OOM) throw e;
        this.gc();
        try { return fn(); } catch (e2) { if (e2 === OOM) throw new Error('Out of memory: raise the HashLife memory budget'); throw e2; }
      }
    }

    // ---------------------------------------------------------------- cells
    getCell(x, y) {
      const D = this.D;
      let n = this.root, lv = D[n + 6];
      let h = POW2[lv - 1];
      if (x < -h || x >= h || y < -h || y >= h) return 0;
      x += h; y += h;
      for (; ;) {
        const east = x >= h, south = y >= h;
        if (east) x -= h; if (south) y -= h;
        n = south ? (east ? D[n + 3] : D[n + 2]) : (east ? D[n + 1] : D[n]);
        if (lv === 1) return n;
        if (D[n + 7] === 0) return 0;
        lv--; h /= 2;
      }
    }

    _set(n, lv, x, y, s) {
      const D = this.D;
      const h = POW2[lv - 1];
      const east = x >= h, south = y >= h;
      let a = D[n], b = D[n + 1], c = D[n + 2], d = D[n + 3];
      if (lv === 1) {
        if (south) { if (east) d = s; else c = s; } else if (east) b = s; else a = s;
      } else {
        if (east) x -= h; if (south) y -= h;
        if (south) { if (east) d = this._set(d, lv - 1, x, y, s); else c = this._set(c, lv - 1, x, y, s); }
        else if (east) b = this._set(b, lv - 1, x, y, s); else a = this._set(a, lv - 1, x, y, s);
      }
      return this.node(a, b, c, d, lv);
    }

    setCell(x, y, s) {
      this._guard(() => {
        const D = this.D; // fetched here: a retry after gc() sees the new table
        let r = this.root;
        for (; ;) {
          const h = POW2[D[r + 6] - 1];
          if (x >= -h && x < h && y >= -h && y < h) break;
          if (s === 0) return;
          r = this.expand(r);
        }
        const h = POW2[D[r + 6] - 1];
        this.root = this._set(r, D[r + 6], x + h, y + h, s);
      });
    }

    clear() {
      this._alloc();
      this.root = this.empty(3); this.gen = 0n;
    }

    // Bounding box of live cells as {x0,y0,x1,y1} (inclusive) or null.
    bounds() {
      const D = this.D;
      const r = this.root;
      if (D[r + 7] === 0) return null;
      
      // dir: 0 minX, 1 maxX, 2 minY, 3 maxY. Returns offset within node.
      const ext = (dir) => {
        const memo = new Map();
        const go = (n) => {
          let v = memo.get(n);
          if (v !== undefined) return v;
          const lv = D[n + 6], h = POW2[lv - 1];
          const a = D[n], b = D[n + 1], c = D[n + 2], d = D[n + 3];
          let p, q, far; // p,q: the two children on the preferred side
          if (dir === 0) { p = a; q = c; } else if (dir === 1) { p = b; q = d; } else if (dir === 2) { p = a; q = b; } else { p = c; q = d; }
          const lo = dir === 0 || dir === 2;
          if (lv === 1) {
            v = (p || q) ? (lo ? 0 : 1) : (lo ? 1 : 0);
          } else {
            const pe = D[p + 7] !== 0, qe = D[q + 7] !== 0;
            if (pe || qe) {
              const pv = pe ? go(p) : (lo ? Infinity : -Infinity), qv = qe ? go(q) : (lo ? Infinity : -Infinity);
              v = (lo ? Math.min(pv, qv) : Math.max(pv, qv)) + (lo ? 0 : h);
            } else {
              let p2, q2;
              if (dir === 0) { p2 = b; q2 = d; } else if (dir === 1) { p2 = a; q2 = c; } else if (dir === 2) { p2 = c; q2 = d; } else { p2 = a; q2 = b; }
              const pv = D[p2 + 7] ? go(p2) : (lo ? Infinity : -Infinity), qv = D[q2 + 7] ? go(q2) : (lo ? Infinity : -Infinity);
              v = (lo ? Math.min(pv, qv) : Math.max(pv, qv)) + (lo ? h : 0);
            }
          }
          memo.set(n, v);
          return v;
        };
        return go(r);
      };
      const h = POW2[D[r + 6] - 1];
      return { x0: ext(0) - h, x1: ext(1) - h, y0: ext(2) - h, y1: ext(3) - h };
    }

    // Visit every live cell (row order not guaranteed). cb(x, y, state); return false to stop.
    forEachCell(cb) {
      const D = this.D;
      
      let stop = false;
      const go = (n, lv, x, y) => {
        if (stop || D[n + 7] === 0) return;
        const a = D[n], b = D[n + 1], c = D[n + 2], d = D[n + 3];
        if (lv === 1) {
          if (a && cb(x, y, a) === false) stop = true;
          if (b && cb(x + 1, y, b) === false) stop = true;
          if (c && cb(x, y + 1, c) === false) stop = true;
          if (d && cb(x + 1, y + 1, d) === false) stop = true;
          return;
        }
        const h = POW2[lv - 1];
        go(a, lv - 1, x, y); go(b, lv - 1, x + h, y); go(c, lv - 1, x, y + h); go(d, lv - 1, x + h, y + h);
      };
      const h = POW2[D[this.root + 6] - 1];
      go(this.root, D[this.root + 6], -h, -h);
    }

    // --------------------------------------------------------------- render
    // Fill buf (2 bytes per texel: state, brightness). Texel (i,j) covers the 2^k square of
    // cells whose top-left is (x0 + i*2^k, y0 + j*2^k); x0,y0 must be multiples of 2^k.
    render(x0, y0, k, tw, th, buf) {
      return this._guard(() => {
        const D = this.D;
        let r = this.root;
        while (D[r + 6] <= k) r = this.expand(r);
        
        const x1 = x0 + tw * POW2[k], y1 = y0 + th * POW2[k];
        const scale = POW2[k], area = scale * scale;
        const self = this;
        const go = (n, lv, x, y) => {
          if (D[n + 7] === 0) return;
          const size = POW2[lv];
          if (x >= x1 || y >= y1 || x + size <= x0 || y + size <= y0) return;
          if (lv === k) {
            const o = 2 * (((y - y0) / scale) * tw + (x - x0) / scale);
            buf[o] = D[n + 7];
            const dens = self.pop(n) / area;
            buf[o + 1] = 190 + 65 * Math.sqrt(dens);
            return;
          }
          const a = D[n], b = D[n + 1], c = D[n + 2], d = D[n + 3];
          if (lv === 1) {
            const i = x - x0, j = y - y0;
            if (j >= 0 && j < th) {
              if (a && i >= 0 && i < tw) { const o = 2 * (j * tw + i); buf[o] = a; buf[o + 1] = 255; }
              if (b && i + 1 >= 0 && i + 1 < tw) { const o = 2 * (j * tw + i + 1); buf[o] = b; buf[o + 1] = 255; }
            }
            if (j + 1 >= 0 && j + 1 < th) {
              if (c && i >= 0 && i < tw) { const o = 2 * ((j + 1) * tw + i); buf[o] = c; buf[o + 1] = 255; }
              if (d && i + 1 >= 0 && i + 1 < tw) { const o = 2 * ((j + 1) * tw + i + 1); buf[o] = d; buf[o + 1] = 255; }
            }
            return;
          }
          const h = size / 2;
          go(a, lv - 1, x, y); go(b, lv - 1, x + h, y); go(c, lv - 1, x, y + h); go(d, lv - 1, x + h, y + h);
        };
        const h = POW2[D[r + 6] - 1];
        buf.fill(0);
        go(r, D[r + 6], -h, -h);
      });
    }

    // ------------------------------------------------------------ macrocell
    // Golly .mc text. Two-state files use 8x8 leaf lines of . * $; multi-state files use
    // "1 a b c d" leaves. Returns { rule, gen }.
    loadMacrocell(text) {
      const lines = text.split(/\r?\n/);
      let rule = null, gen = 0n;
      const ids = [0], lvs = [0];
      this.clear();
      const emp = (lv) => this.empty(lv);
      for (const line of lines) {
        if (!line) continue;
        const ch = line[0];
        if (ch === '[') continue;
        if (ch === '#') {
          if (line[1] === 'R') rule = line.slice(2).trim();
          else if (line[1] === 'G') { try { gen = BigInt(line.slice(2).trim().replace(/,/g, '')); } catch (e) { /* ignore */ } }
          continue;
        }
        if (ch === '.' || ch === '*' || ch === '$') {
          const g = new Uint8Array(64);
          let x = 0, y = 0;
          for (const c of line) { if (c === '$') { y++; x = 0; } else { if (c === '*' && x < 8 && y < 8) g[y * 8 + x] = 1; x++; } }
          const l1 = (cx, cy) => this.node(g[cy * 8 + cx], g[cy * 8 + cx + 1], g[(cy + 1) * 8 + cx], g[(cy + 1) * 8 + cx + 1], 1);
          const l2 = (cx, cy) => this.node(l1(cx, cy), l1(cx + 2, cy), l1(cx, cy + 2), l1(cx + 2, cy + 2), 2);
          ids.push(this.node(l2(0, 0), l2(4, 0), l2(0, 4), l2(4, 4), 3)); lvs.push(3);
          continue;
        }
        const p = line.trim().split(/\s+/).map(Number);
        if (p.length < 5 || !(p[0] >= 1)) continue;
        const lv = p[0];
        if (lv === 1) { ids.push(this.node(p[1], p[2], p[3], p[4], 1)); lvs.push(1); }
        else {
          const kid = v => v === 0 ? emp(lv - 1) : ids[v];
          ids.push(this.node(kid(p[1]), kid(p[2]), kid(p[3]), kid(p[4]), lv)); lvs.push(lv);
        }
      }
      if (ids.length < 2) throw new Error('No nodes found in macrocell file');
      let r = ids[ids.length - 1];
      const D = this.D;
      while (D[r + 6] < 3) r = this.expand(r);
      this.root = r;
      this.gen = gen;
      return { rule, gen };
    }

    stats() { return { nodes: this.count, limit: this.limit, bytes: this.S * 40, level: this.D[this.root + 6], gcs: this.gcCount }; }
  }

  CA.HashLife = HashLife;
  CA.POW2 = POW2;
})(typeof self !== 'undefined' ? self : globalThis);
