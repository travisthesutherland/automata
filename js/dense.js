// Bounded torus engine: a flat byte grid with wrap-around edges. Used for chaotic rules
// (where HashLife's memoisation does not pay off) and for range > 1 rules.
// The grid covers world cells [-w/2, w/2) x [-h/2, h/2).
(function (root) {
  'use strict';
  const CA = root.CA || (root.CA = {});

  class DenseGrid {
    constructor(rule, w, h) {
      this.rule = rule; this.f = rule.f; this.kind = 'dense';
      this.w = w; this.h = h; this.W2 = w + 2;
      this.a = new Uint8Array((w + 2) * (h + 2));
      this.b = new Uint8Array((w + 2) * (h + 2));
      this.ox = w >> 1; this.oy = h >> 1;
      this.gen = 0n; this.P = 0;
      this._pop = 0; this._popDirty = false;
      if (rule.ltl) { this.t1 = new Int32Array(w * h); }
    }
    setStep(P) { this.P = Math.max(0, Math.min(16, P | 0)); }

    _wrap(g) {
      const w = this.w, h = this.h, W2 = this.W2;
      for (let y = 1; y <= h; y++) { const r = y * W2; g[r] = g[r + w]; g[r + w + 1] = g[r + 1]; }
      g.copyWithin(0, h * W2, h * W2 + W2);
      g.copyWithin((h + 1) * W2, W2, 2 * W2);
    }

    _gen() {
      const w = this.w, h = this.h, W2 = this.W2, A = this.a, B = this.b, f = this.f;
      let pop = 0;
      const life = this.rule.life;
      if (this.rule.ltl) { this._genLtL(); return; }
      this._wrap(A);
      if (life && life.C === 2) {
        const BB = life.B, SS = life.S;
        for (let y = 1; y <= h; y++) {
          let i = y * W2 + 1;
          const end = i + w;
          let l = A[i - W2 - 1] + A[i - 1] + A[i + W2 - 1], m = A[i - W2] + A[i] + A[i + W2];
          for (; i < end; i++) {
            const r = A[i - W2 + 1] + A[i + 1] + A[i + W2 + 1];
            const c = A[i];
            const v = c ? SS[l + m + r - 1] : BB[l + m + r];
            B[i] = v; pop += v;
            l = m; m = r;
          }
        }
      } else {
        for (let y = 1; y <= h; y++) {
          let i = y * W2 + 1;
          const end = i + w;
          for (; i < end; i++) {
            const v = f(A[i], A[i - W2], A[i - W2 + 1], A[i + 1], A[i + W2 + 1], A[i + W2], A[i + W2 - 1], A[i - 1], A[i - W2 - 1]);
            B[i] = v; if (v) pop++;
          }
        }
      }
      this.a = B; this.b = A; this._pop = pop; this._popDirty = false;
    }

    // Larger than Life: box counts through two sliding-window passes.
    _genLtL() {
      const { r, C, M, smin, smax, bmin, bmax } = this.rule.ltl;
      const w = this.w, h = this.h, W2 = this.W2, A = this.a, B = this.b, T = this.t1;
      const col = this._col || (this._col = new Int32Array(Math.max(w, h)));
      for (let y = 0; y < h; y++) {
        const row = (y + 1) * W2 + 1;
        let s = 0;
        for (let d = -r; d <= r; d++) s += A[row + (((d % w) + w) % w)] === 1 ? 1 : 0;
        let add = (r + 1) % w, sub = (((-r) % w) + w) % w;
        const o = y * w;
        for (let x = 0; x < w; x++) {
          T[o + x] = s;
          s += (A[row + add] === 1 ? 1 : 0) - (A[row + sub] === 1 ? 1 : 0);
          if (++add === w) add = 0; if (++sub === w) sub = 0;
        }
      }
      let pop = 0;
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += T[(((d % h) + h) % h) * w + x];
        let add = (r + 1) % h, sub = (((-r) % h) + h) % h;
        for (let y = 0; y < h; y++) {
          const i = (y + 1) * W2 + 1 + x, c = A[i];
          let v;
          if (c === 0) v = (s >= bmin && s <= bmax) ? 1 : 0;
          else if (c === 1) { const k = M ? s : s - 1; v = (k >= smin && k <= smax) ? 1 : (C > 2 ? 2 : 0); }
          else v = c + 1 >= C ? 0 : c + 1;
          B[i] = v; if (v) pop++;
          s += T[add * w + x] - T[sub * w + x];
          if (++add === h) add = 0; if (++sub === h) sub = 0;
        }
      }
      this.a = B; this.b = A; this._pop = pop; this._popDirty = false;
    }

    step() {
      const n = 1 << this.P;
      const t0 = Date.now();
      let done = 0;
      for (; done < n; done++) { this._gen(); if ((done & 3) === 3 && Date.now() - t0 > 250) { done++; break; } }
      this.gen += BigInt(done);
      return null;
    }

    get population() {
      if (this._popDirty) {
        let p = 0; const A = this.a, w = this.w, W2 = this.W2;
        for (let y = 1; y <= this.h; y++) { const r = y * W2 + 1; for (let x = 0; x < w; x++) if (A[r + x]) p++; }
        this._pop = p; this._popDirty = false;
      }
      return this._pop;
    }

    _idx(x, y) {
      const w = this.w, h = this.h;
      const gx = (((x + this.ox) % w) + w) % w, gy = (((y + this.oy) % h) + h) % h;
      return (gy + 1) * this.W2 + gx + 1;
    }
    getCell(x, y) {
      if (x < -this.ox || x >= this.w - this.ox || y < -this.oy || y >= this.h - this.oy) return 0;
      return this.a[this._idx(x, y)];
    }
    setCell(x, y, s) { this.a[this._idx(x, y)] = s; this._popDirty = true; }
    clear() { this.a.fill(0); this.gen = 0n; this._pop = 0; this._popDirty = false; }

    bounds() {
      const w = this.w, h = this.h, W2 = this.W2, A = this.a;
      let x0 = w, x1 = -1, y0 = h, y1 = -1;
      for (let y = 0; y < h; y++) {
        const r = (y + 1) * W2 + 1;
        let any = false;
        for (let x = 0; x < w; x++) if (A[r + x]) { any = true; if (x < x0) x0 = x; if (x > x1) x1 = x; }
        if (any) { if (y < y0) y0 = y; y1 = y; }
      }
      if (x1 < 0) return null;
      return { x0: x0 - this.ox, x1: x1 - this.ox, y0: y0 - this.oy, y1: y1 - this.oy };
    }

    forEachCell(cb) {
      const w = this.w, h = this.h, W2 = this.W2, A = this.a;
      for (let y = 0; y < h; y++) {
        const r = (y + 1) * W2 + 1;
        for (let x = 0; x < w; x++) { const s = A[r + x]; if (s && cb(x - this.ox, y - this.oy, s) === false) return; }
      }
    }

    render(x0, y0, k, tw, th, buf) {
      buf.fill(0);
      const w = this.w, h = this.h, W2 = this.W2, A = this.a;
      if (k === 0) {
        const gx0 = Math.max(0, x0 + this.ox), gx1 = Math.min(w, x0 + this.ox + tw);
        const gy0 = Math.max(0, y0 + this.oy), gy1 = Math.min(h, y0 + this.oy + th);
        for (let gy = gy0; gy < gy1; gy++) {
          let o = 2 * ((gy - this.oy - y0) * tw + (gx0 - this.ox - x0));
          const r = (gy + 1) * W2 + 1;
          for (let gx = gx0; gx < gx1; gx++, o += 2) { const s = A[r + gx]; if (s) { buf[o] = s; buf[o + 1] = 255; } }
        }
        return;
      }
      const sc = Math.pow(2, k);
      if (sc > 1e9) return;
      const area = sc * sc;
      for (let j = 0; j < th; j++) {
        const cy0 = y0 + j * sc + this.oy, cy1 = cy0 + sc;
        if (cy1 <= 0 || cy0 >= h) continue;
        const ya = Math.max(0, cy0), yb = Math.min(h, cy1);
        for (let i = 0; i < tw; i++) {
          const cx0 = x0 + i * sc + this.ox, cx1 = cx0 + sc;
          if (cx1 <= 0 || cx0 >= w) continue;
          const xa = Math.max(0, cx0), xb = Math.min(w, cx1);
          let cnt = 0, rep = 0;
          for (let y = ya; y < yb; y++) {
            const r = (y + 1) * W2 + 1;
            for (let x = xa; x < xb; x++) { const s = A[r + x]; if (s) { cnt++; if (!rep || ((x ^ y) & 1)) rep = s; } }
          }
          if (cnt) { const o = 2 * (j * tw + i); buf[o] = rep; buf[o + 1] = 190 + 65 * Math.sqrt(cnt / area); }
        }
      }
    }

    stats() { return { w: this.w, h: this.h }; }
  }

  CA.DenseGrid = DenseGrid;
})(typeof self !== 'undefined' ? self : globalThis);
