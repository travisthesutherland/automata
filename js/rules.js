// Rule compiler. Every rule ends up as a 9-argument transition function
//   f(c, n, ne, e, se, s, sw, w, nw) -> new state
// plus some metadata. Range > 1 rules (Larger than Life) carry an `ltl` block
// instead and only run on the bounded torus engine.
(function (root) {
  'use strict';
  const CA = root.CA || (root.CA = {});

  // ---------------------------------------------------------------- Life-like
  function parseLifeLike(text) {
    const t = text.replace(/\s+/g, '');
    let m = /^B(\d*)\/?S(\d*)(?:\/[CG]?(\d+))?([VH]?)$/i.exec(t);
    let b, s, c, nb;
    if (m) { b = m[1]; s = m[2]; c = m[3]; nb = m[4]; }
    else if ((m = /^S(\d*)\/?B(\d*)(?:\/[CG]?(\d+))?([VH]?)$/i.exec(t))) { s = m[1]; b = m[2]; c = m[3]; nb = m[4]; }
    else if ((m = /^(\d*)\/(\d*)(?:\/(\d+))?([VH]?)$/.exec(t))) { s = m[1]; b = m[2]; c = m[3]; nb = m[4]; }
    else return null;
    const C = c ? parseInt(c, 10) : 2;
    if (C < 2 || C > 255) throw new Error('State count must be between 2 and 255');
    const B = new Uint8Array(9), S = new Uint8Array(9);
    for (const ch of b) B[+ch] = 1;
    for (const ch of s) S[+ch] = 1;
    nb = (nb || 'M').toUpperCase();
    const max = nb === 'V' ? 4 : nb === 'H' ? 6 : 8;
    for (let i = max + 1; i < 9; i++) if (B[i] || S[i]) throw new Error('Neighbour count ' + i + ' is impossible in this neighbourhood');
    const dying = C > 2 ? 2 : 0;
    let f;
    if (nb === 'M') {
      if (C === 2) f = (c, n, ne, e, se, s, sw, w, nw) => (c ? S : B)[n + ne + e + se + s + sw + w + nw];
      else f = (c, n, ne, e, se, s, sw, w, nw) => {
        if (c > 1) return c + 1 === C ? 0 : c + 1;
        const k = (n === 1) + (ne === 1) + (e === 1) + (se === 1) + (s === 1) + (sw === 1) + (w === 1) + (nw === 1);
        return c ? (S[k] ? 1 : dying) : B[k];
      };
    } else if (nb === 'V') {
      f = (c, n, ne, e, se, s, sw, w, nw) => {
        if (c > 1) return c + 1 === C ? 0 : c + 1;
        const k = (n === 1) + (e === 1) + (s === 1) + (w === 1);
        return c ? (S[k] ? 1 : dying) : B[k];
      };
    } else {
      f = (c, n, ne, e, se, s, sw, w, nw) => {
        if (c > 1) return c + 1 === C ? 0 : c + 1;
        const k = (n === 1) + (e === 1) + (se === 1) + (s === 1) + (w === 1) + (nw === 1);
        return c ? (S[k] ? 1 : dying) : B[k];
      };
    }
    const digits = a => { let o = ''; for (let i = 0; i < 9; i++) if (a[i]) o += i; return o; };
    return {
      kind: C > 2 ? 'generations' : 'life', states: C, f,
      canonical: 'B' + digits(B) + '/S' + digits(S) + (C > 2 ? '/C' + C : '') + (nb === 'M' ? '' : nb),
      needsFinite: !!B[0],
      life: nb === 'M' ? { B, S, C } : null,
    };
  }

  // -------------------------------------------------------- Larger than Life
  function parseLtL(text) {
    const m = /^R(\d+),C(\d+),M([01]),S(\d+)\.\.(\d+),B(\d+)\.\.(\d+)(?:,N([MN]))?$/i.exec(text.replace(/\s+/g, ''));
    if (!m) return null;
    const r = +m[1], C = Math.max(2, +m[2]);
    if (r < 1 || r > 50) throw new Error('LtL range must be 1..50');
    if (m[8] && m[8].toUpperCase() === 'N') throw new Error('Only the Moore (NM) neighbourhood is supported for LtL rules');
    const ltl = { r, C, M: +m[3], smin: +m[4], smax: +m[5], bmin: +m[6], bmax: +m[7] };
    return {
      kind: C > 2 ? 'generations' : 'life', states: C, f: null, ltl, needsFinite: true,
      canonical: `R${r},C${C > 2 ? C : 0},M${ltl.M},S${ltl.smin}..${ltl.smax},B${ltl.bmin}..${ltl.bmax},NM`,
    };
  }

  // ------------------------------------------------- von Neumann (after Golly)
  // Internal bit-coded states, the same encoding Golly's jvnalgo uses.
  const J_UNC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 32, 33, 34, 35, 160, 161, 162, 163, 64, 65, 66, 67,
    192, 193, 194, 195, 16, 144, 17, 145, 146, 148, 150];
  const J_COMP = new Uint8Array(256);
  J_UNC.forEach((v, i) => { J_COMP[v] = i; });
  const J_CRES = [0x22, 0x23, 0x40, 0x41, 0x42, 0x43, 0x10, 0x20, 0x21];
  const CONF = 0x10, OTRANS = 0x20, STRANS = 0x40, TEXC = 0x80, CDEXC = 0x80, CROSSEXC = 6, CEXC = 1;
  const B_ONEXC = 1, B_OEXC_EW = 2, B_OEXC_NS = 4, B_OEXC = 6, B_SEXC = 8, B_CEXC = 16;
  const B_NS_IN = 32, B_EW_IN = 64, B_NS_OUT = 128, B_EW_OUT = 256, B_CROSS = 480, B_ANY_OUT = 384;
  const B_OEXC_OTHER = 512, B_SEXC_OTHER = 1024;

  // What neighbour `code`, which would have to face `dir` to point at us, contributes to cell `mcode`.
  function jbits(mcode, code, dir) {
    if ((code & (TEXC | OTRANS | STRANS | CONF | CEXC)) === 0) return 0;
    if (code & CONF) {
      if ((mcode & (OTRANS | STRANS)) && ((mcode & 3) ^ 2) === dir) return 0;
      if ((code & 2) && !(dir & 1)) return B_CEXC;
      if ((code & 4) && (dir & 1)) return B_CEXC;
      if (code & 1) return B_CEXC;
      return 0;
    }
    if ((code & (OTRANS | STRANS)) === 0) return 0;
    let r = 0;
    if ((code & 3) === dir) {
      if (code & OTRANS) {
        if (dir & 1) { r |= B_NS_IN; r |= (code & TEXC) ? B_OEXC_NS : B_ONEXC; }
        else { r |= B_EW_IN; r |= (code & TEXC) ? B_OEXC_EW : B_ONEXC; }
      } else if ((code & (STRANS | TEXC)) === (STRANS | TEXC)) r |= B_SEXC;
      if ((mcode & (OTRANS | STRANS)) && (dir ^ (mcode & 3)) === 2) {
        // head to head: nothing propagates
      } else {
        if (r & B_OEXC) r |= B_OEXC_OTHER;
        if (r & B_SEXC) r |= B_SEXC_OTHER;
      }
    } else {
      r |= (dir & 1) ? B_NS_OUT : B_EW_OUT;
    }
    return r;
  }

  function makeJvN(nobili) {
    return (c0, n, ne, e, se, s, sw, w, nw) => {
      let c = J_UNC[c0];
      // directions: E=0 N=1 W=2 S=3
      const mb = jbits(c, J_UNC[n], 3) | jbits(c, J_UNC[w], 0) | jbits(c, J_UNC[e], 2) | jbits(c, J_UNC[s], 1);
      if (c < CONF) {
        c = (mb & (B_OEXC | B_SEXC)) ? 2 * c + 1 : 2 * c;
        if (c > 8) c = J_CRES[c - 9];
      } else if (c & CONF) {
        if (mb & B_SEXC) c = 0;
        else if (nobili && (mb & B_CROSS) === B_CROSS) {
          c = (mb & B_OEXC) ? (mb & B_OEXC) + CONF + 0x80 : CONF;
        } else {
          if (c & CROSSEXC) c &= ~(CROSSEXC | CDEXC);
          if ((mb & B_OEXC) && !(mb & B_ONEXC)) c = ((c & CDEXC) >> 7) + (CDEXC | CONF);
          else if ((mb & B_ANY_OUT) || !nobili) c = ((c & CDEXC) >> 7) + CONF;
        }
      } else {
        if (((c & OTRANS) && (mb & B_SEXC)) || ((c & STRANS) && (mb & B_OEXC))) c = 0;
        else if (mb & (B_SEXC_OTHER | B_OEXC_OTHER | B_CEXC)) c |= 128;
        else c &= 127;
      }
      return J_COMP[c];
    };
  }

  // Hutton32: same states as Nobili32, modified table (Tim Hutton, 2008). Port of Golly's code.
  function makeHutton() {
    const isOTS = c => c >= 9 && c <= 16, isSTS = c => c >= 17 && c <= 24, isTS = c => c >= 9 && c <= 24;
    const isSens = c => c >= 1 && c <= 8;
    const isE = c => c === 9 || c === 13 || c === 17 || c === 21;
    const isN = c => c === 10 || c === 14 || c === 18 || c === 22;
    const isW = c => c === 11 || c === 15 || c === 19 || c === 23;
    const isS = c => c === 12 || c === 16 || c === 20 || c === 24;
    const exc = c => (c >= 13 && c <= 16) || (c >= 21 && c <= 24);
    const dir = c => (((c - 9) % 4) + 4) % 4;
    const output = (c, n, s, e, w) => isE(c) ? e : isN(c) ? n : isW(c) ? w : isS(c) ? s : 0;
    const input = (n, s, e, w) => (isE(w) && exc(w)) ? w : (isN(s) && exc(s)) ? s : (isW(e) && exc(e)) ? e : (isS(n) && exc(n)) ? n : 0;
    const willOTS = (c, n, s, e, w) => { const o = output(c, n, s, e, w); return o === 8 || (o === 4 && exc(c)) || (o === 5 && !exc(c)); };
    const willConf = (c, n, s, e, w) => output(c, n, s, e, w) === 7 && exc(c);
    const willSens = (c, n, s, e, w) => { const o = output(c, n, s, e, w); return (o === 0 && exc(c)) || o === 1 || o === 2 || o === 3 || (o === 4 && !isOTS(c)); };
    const excOTSto = (c, n, s, e, w) =>
      ((n === 16 || n === 27 || n === 28 || n === 30 || n === 31) && !(c === 14 || c === 10)) ||
      ((s === 14 || s === 27 || s === 28 || s === 30 || s === 31) && !(c === 16 || c === 12)) ||
      ((e === 15 || e === 27 || e === 28 || e === 29 || e === 31) && !(c === 13 || c === 9)) ||
      ((w === 13 || w === 27 || w === 28 || w === 29 || w === 31) && !(c === 15 || c === 11));
    const excOTSarrow = (c, n, s, e, w) =>
      (n === 16 && !(c === 14 || c === 10)) || (s === 14 && !(c === 16 || c === 12)) ||
      (e === 15 && !(c === 13 || c === 9)) || (w === 13 && !(c === 15 || c === 11));
    const OTSarrow = (n, s, e, w) => (isOTS(n) && isS(n)) || (isOTS(s) && isN(s)) || (isOTS(e) && isW(e)) || (isOTS(w) && isE(w));
    const excSTSto = (c, n, s, e, w) =>
      ((n === 24 || n === 27 || n === 28 || n === 30 || n === 31) && !(c === 22 || c === 18)) ||
      ((s === 22 || s === 27 || s === 28 || s === 30 || s === 31) && !(c === 24 || c === 20)) ||
      ((e === 23 || e === 27 || e === 28 || e === 29 || e === 31) && !(c === 21 || c === 17)) ||
      ((w === 21 || w === 27 || w === 28 || w === 29 || w === 31) && !(c === 23 || c === 19));
    const excSTSarrow = (c, n, s, e, w) =>
      (n === 24 && !(c === 22 || c === 18)) || (s === 22 && !(c === 24 || c === 20)) ||
      (e === 23 && !(c === 21 || c === 17)) || (w === 21 && !(c === 23 || c === 19));
    const allOn = (n, s, e, w) => !(n === 12 || s === 10 || e === 11 || w === 9) && (n === 16 || s === 14 || e === 15 || w === 13);
    const crossing = (n, s, e, w) => {
      const ins = isS(n) + isE(w) + isW(e) + isN(s);
      const outs = (isTS(n) && !isS(n)) + (isTS(w) && !isE(w)) + (isTS(e) && !isW(e)) + (isTS(s) && !isN(s));
      return ins === 2 && outs === 2;
    };
    const q = c => exc(c) ? c - 4 : (c >= 26 && c <= 31) ? 25 : c;
    const calc = (c, n, s, e, w) => {
      if (isOTS(c)) {
        if (excSTSarrow(c, n, s, e, w)) return 0;
        if (excOTSto(c, n, s, e, w)) {
          const o = output(c, n, s, e, w);
          if (willOTS(c, n, s, e, w) || (isSTS(o) && !exc(o))) return 0;
          if (willConf(c, n, s, e, w)) return 1;
          return q(c) + 4;
        }
        if (willConf(c, n, s, e, w)) return 0;
        if (exc(c) && willSens(c, n, s, e, w)) return q(c) + 12;
        return q(c);
      }
      if (isSTS(c)) {
        const o = output(c, n, s, e, w);
        if (exc(c) && isSens(o) && OTSarrow(n, s, e, w)) {
          if (willSens(c, n, s, e, w)) return excOTSarrow(c, n, s, e, w) ? c - 8 : c;
          return excOTSarrow(c, n, s, e, w) ? 0 : q(c) - 8;
        }
        if (exc(c) && o === 0) return excSTSarrow(c, n, s, e, w) ? c : q(c);
        if (excOTSarrow(c, n, s, e, w)) return 0;
        if (excSTSto(c, n, s, e, w)) return q(c) + 4;
        return q(c);
      }
      const hit = excOTSarrow(c, n, s, e, w);
      const qi = q(input(n, s, e, w));
      switch (c) {
        case 0: return hit ? 1 : excSTSarrow(c, n, s, e, w) ? qi - 8 : 0;
        case 1: return hit ? 3 : 2;
        case 2: return hit ? 5 : 4;
        case 3: return hit ? 7 : 6;
        case 4: return hit ? ((qi - 9 + 2) % 4) + 9 : 8;
        case 5: return hit ? qi + 8 : ((qi - 9 + 3) % 4) + 9;
        case 6: return hit ? ((qi - 9 + 2) % 4) + 17 : ((qi - 9 + 1) % 4) + 17;
        case 7: return hit ? 25 : ((qi - 9 + 3) % 4) + 17;
        case 8: return hit ? 9 + dir(input(n, s, e, w) + 1) : 9 + dir(input(n, s, e, w));
      }
      if (excSTSarrow(c, n, s, e, w)) return 0;
      const v = n === 16 || s === 14, h = e === 15 || w === 13;
      if (c === 25) {
        if (crossing(n, s, e, w)) return v && h ? 31 : v ? 30 : h ? 29 : 25;
        return allOn(n, s, e, w) ? 26 : 25;
      }
      if (c === 26 || c === 28) return allOn(n, s, e, w) ? 28 : 27;
      if (c === 27) return allOn(n, s, e, w) ? 26 : 25;
      return v && h ? 31 : v ? 30 : h ? 29 : 25;
    };
    return (c, n, ne, e, se, s, sw, w, nw) => { const r = calc(c, n, s, e, w); return r >= 0 && r < 32 ? r : 0; };
  }

  const JVN_NAMES = ['ground', 'sensitised S', 'sensitised S0', 'sensitised S1', 'sensitised S00', 'sensitised S01',
    'sensitised S10', 'sensitised S11', 'sensitised S000',
    'ordinary → quiet', 'ordinary ↑ quiet', 'ordinary ← quiet', 'ordinary ↓ quiet',
    'ordinary → excited', 'ordinary ↑ excited', 'ordinary ← excited', 'ordinary ↓ excited',
    'special → quiet', 'special ↑ quiet', 'special ← quiet', 'special ↓ quiet',
    'special → excited', 'special ↑ excited', 'special ← excited', 'special ↓ excited',
    'confluent 00', 'confluent 01 (next)', 'confluent 10 (firing)', 'confluent 11',
    'crossing ↔', 'crossing ↕', 'crossing both'];
  // glyph codes for the renderer: 1-4 single arrow E N W S, 5-8 double arrow, 9 confluent, 10 sensitised, 11 crossing; +16 excited
  const JVN_GLYPH = [0, 10, 10, 10, 10, 10, 10, 10, 10, 1, 2, 3, 4, 17, 18, 19, 20, 5, 6, 7, 8, 21, 22, 23, 24, 9, 25, 25, 25, 27, 27, 27];

  // --------------------------------------------------------------- built-ins
  function wireworld() {
    return (c, n, ne, e, se, s, sw, w, nw) => {
      if (c === 0) return 0;
      if (c === 1) return 2;
      if (c === 2) return 3;
      const k = (n === 1) + (ne === 1) + (e === 1) + (se === 1) + (s === 1) + (sw === 1) + (w === 1) + (nw === 1);
      return k === 1 || k === 2 ? 1 : 3;
    };
  }

  // Langton's ant as a CA: state = colour + 2*a, a = 0 no ant, 1..4 ant facing E N W S.
  function langtonsAnt() {
    const nd = new Int8Array(10).fill(-1);
    for (let st = 2; st < 10; st++) { const col = st & 1, d = (st >> 1) - 1; nd[st] = col ? (d + 1) & 3 : (d + 3) & 3; }
    return (c, n, ne, e, se, s, sw, w, nw) => {
      const col = (c > 1) ? (c & 1) ^ 1 : c;
      if (nd[w] === 0) return col + 2;
      if (nd[s] === 1) return col + 4;
      if (nd[e] === 2) return col + 6;
      if (nd[n] === 3) return col + 8;
      return col;
    };
  }

  function cyclic(C, T, vn) {
    if (vn) return (c, n, ne, e, se, s, sw, w, nw) => {
      const x = c + 1 === C ? 0 : c + 1;
      return ((n === x) + (e === x) + (s === x) + (w === x)) >= T ? x : c;
    };
    return (c, n, ne, e, se, s, sw, w, nw) => {
      const x = c + 1 === C ? 0 : c + 1;
      return ((n === x) + (ne === x) + (e === x) + (se === x) + (s === x) + (sw === x) + (w === x) + (nw === x)) >= T ? x : c;
    };
  }

  // 1D elementary rule drawn as a space-time diagram: each row is computed from the row above.
  function elementary(num) {
    return (c, n, ne, e, se, s, sw, w, nw) => c ? c : (num >> ((nw ? 4 : 0) | (n ? 2 : 0) | (ne ? 1 : 0))) & 1;
  }

  // ------------------------------------------------------ Golly @TABLE format
  function parseTable(src) {
    let N = 0, nbhd = 'vonneumann', sym = 'none';
    const vars = new Map();
    const trans = [];
    const lines = src.split(/\r?\n/);
    let inTable = !/@TABLE/i.test(src);
    for (let raw of lines) {
      let line = raw.replace(/#.*/, '').trim();
      if (!line) continue;
      if (line[0] === '@') { inTable = /^@TABLE/i.test(line); continue; }
      if (!inTable) continue;
      let m;
      if ((m = /^n_states\s*:\s*(\d+)/i.exec(line))) { N = +m[1]; continue; }
      if ((m = /^neighbou?rhood\s*:\s*(\w+)/i.exec(line))) { nbhd = m[1].toLowerCase(); continue; }
      if ((m = /^symmetries\s*:\s*(\w+)/i.exec(line))) { sym = m[1].toLowerCase(); continue; }
      if ((m = /^var\s+(\w+)\s*=\s*\{([^}]*)\}/i.exec(line))) {
        const vals = [];
        for (const tok of m[2].split(',').map(s => s.trim()).filter(Boolean)) {
          if (vars.has(tok)) vals.push(...vars.get(tok)); else vals.push(+tok);
        }
        vars.set(m[1], [...new Set(vals)]);
        continue;
      }
      let toks = line.indexOf(',') >= 0 ? line.split(',').map(s => s.trim()) : line.replace(/\s+/g, '').split('');
      trans.push(toks);
    }
    if (!N) throw new Error('Table is missing n_states');
    if (N > 256) throw new Error('At most 256 states are supported');
    const K = nbhd === 'vonneumann' ? 5 : nbhd === 'moore' ? 9 : nbhd === 'hexagonal' ? 7 : 0;
    if (!K) throw new Error('Unsupported neighbourhood: ' + nbhd);

    // neighbour permutations (indices into the K-1 neighbour slots)
    const nn = K - 1;
    const rot = (a, k) => a.map((_, i) => a[(i + k) % nn]);
    const id = [...Array(nn).keys()];
    const refl = nn === 4 ? [0, 3, 2, 1] : nn === 8 ? [0, 7, 6, 5, 4, 3, 2, 1] : [0, 5, 4, 3, 2, 1];
    let perms;
    const rots = step => { const o = []; for (let k = 0; k < nn; k += step) o.push(rot(id, k)); return o; };
    const withRefl = ps => ps.concat(ps.map(p => refl.map(i => p[i])));
    switch (sym) {
      case 'none': perms = [id]; break;
      case 'rotate4': perms = rots(nn / 4); break;
      case 'rotate4reflect': perms = withRefl(rots(nn / 4)); break;
      case 'rotate8': if (nn !== 8) throw new Error('rotate8 needs the Moore neighbourhood'); perms = rots(1); break;
      case 'rotate8reflect': if (nn !== 8) throw new Error('rotate8 needs the Moore neighbourhood'); perms = withRefl(rots(1)); break;
      case 'rotate6': perms = rots(1); break;
      case 'rotate6reflect': perms = withRefl(rots(1)); break;
      case 'rotate2': perms = rots(nn / 2); break;
      case 'reflect': case 'reflect_horizontal': perms = withRefl([id]); break;
      case 'permute': perms = null; break;
      default: throw new Error('Unsupported symmetry: ' + sym);
    }
    const allPerms = n => { const out = []; const go = (a, k) => { if (k === n) { out.push(a.slice()); return; } for (let i = k; i < n; i++) { [a[k], a[i]] = [a[i], a[k]]; go(a, k + 1); [a[k], a[i]] = [a[i], a[k]]; } }; go([...Array(n).keys()], 0); return out; };
    if (!perms) { if (nn > 6) perms = 'sort'; else perms = allPerms(nn); }

    const full = [...Array(N).keys()];
    const rules = []; // {ins: [array of allowed states]*K, out}
    const seen = new Set();
    for (const toks of trans) {
      if (toks.length !== K + 1) throw new Error('Bad transition (expected ' + (K + 1) + ' entries): ' + toks.join(','));
      const count = new Map();
      for (const t of toks) if (vars.has(t)) count.set(t, (count.get(t) || 0) + 1);
      const bound = [...count.keys()].filter(v => count.get(v) > 1 || toks[K] === v);
      const expand = (bi, env) => {
        if (bi === bound.length) {
          const ins = [];
          for (let i = 0; i < K; i++) {
            const t = toks[i];
            if (env.has(t)) ins.push([env.get(t)]);
            else if (vars.has(t)) ins.push(vars.get(t));
            else { const v = +t; if (!(v >= 0 && v < N)) throw new Error('Bad state "' + t + '" in: ' + toks.join(',')); ins.push([v]); }
          }
          const ot = toks[K];
          const out = env.has(ot) ? env.get(ot) : +ot;
          if (!(out >= 0 && out < N)) throw new Error('Bad output state in: ' + toks.join(','));
          if (perms === 'sort') { rules.push({ ins, out, permute: true }); return; }
          for (const p of perms) {
            const pi = [ins[0]]; for (let i = 0; i < nn; i++) pi.push(ins[1 + p[i]]);
            const key = pi.map(a => a.join('.')).join('|') + '>' + out;
            if (seen.has(key)) continue; seen.add(key);
            rules.push({ ins: pi, out });
          }
          return;
        }
        for (const v of vars.get(bound[bi])) { env.set(bound[bi], v); expand(bi + 1, env); }
        env.delete(bound[bi]);
      };
      expand(0, new Map());
      if (rules.length > 400000) throw new Error('Table expands to too many transitions');
    }
    return { N, K, nbhd, rules, full };
  }

  function compileTable(src, metaOnly) {
    const { N, K, nbhd, rules } = parseTable(src);
    const meta = { kind: 'table', states: N, nbhd };
    if (metaOnly) return meta;
    if (rules.some(r => r.permute)) return Object.assign(meta, { f: compilePermute(N, K, rules) });
    const R = rules.length, W = Math.max(1, Math.ceil(R / 32));
    const masks = new Uint32Array(K * N * W);
    const outs = new Uint8Array(R);
    rules.forEach((r, ri) => {
      outs[ri] = r.out;
      for (let p = 0; p < K; p++) for (const st of r.ins[p]) masks[(p * N + st) * W + (ri >>> 5)] |= 1 << (ri & 31);
    });
    const match = K === 5
      ? (c, n, e, s, w) => {
        const a = c * W, b = (N + n) * W, d = (2 * N + e) * W, g = (3 * N + s) * W, h = (4 * N + w) * W;
        for (let i = 0; i < W; i++) {
          const m = masks[a + i] & masks[b + i] & masks[d + i] & masks[g + i] & masks[h + i];
          if (m) return outs[i * 32 + (31 - Math.clz32(m & -m))];
        }
        return c;
      }
      : null;
    let f;
    if (K === 5) {
      if (Math.pow(N, 5) <= 1 << 22) {
        const lut = new Uint8Array(Math.pow(N, 5));
        let i = 0;
        for (let c = 0; c < N; c++) for (let n = 0; n < N; n++) for (let e = 0; e < N; e++) for (let s = 0; s < N; s++) for (let w = 0; w < N; w++) lut[i++] = match(c, n, e, s, w);
        f = (c, n, ne, e, se, s, sw, w, nw) => lut[(((c * N + n) * N + e) * N + s) * N + w];
      } else f = (c, n, ne, e, se, s, sw, w, nw) => match(c, n, e, s, w);
    } else {
      // generic K: positions in Golly order C,N,NE,E,SE,S,SW,W,NW (Moore) or C,N,E,SE,S,W,NW (hex)
      const g = (v) => {
        const offs = v.map((st, p) => (p * N + st) * W);
        for (let i = 0; i < W; i++) {
          let m = masks[offs[0] + i];
          for (let p = 1; p < K && m; p++) m &= masks[offs[p] + i];
          if (m) return outs[i * 32 + (31 - Math.clz32(m & -m))];
        }
        return v[0];
      };
      if (K === 9) {
        const mm = (c, n, ne, e, se, s, sw, w, nw) => {
          const a0 = c * W, a1 = (N + n) * W, a2 = (2 * N + ne) * W, a3 = (3 * N + e) * W, a4 = (4 * N + se) * W,
            a5 = (5 * N + s) * W, a6 = (6 * N + sw) * W, a7 = (7 * N + w) * W, a8 = (8 * N + nw) * W;
          for (let i = 0; i < W; i++) {
            const m = masks[a0 + i] & masks[a1 + i] & masks[a2 + i] & masks[a3 + i] & masks[a4 + i] & masks[a5 + i] & masks[a6 + i] & masks[a7 + i] & masks[a8 + i];
            if (m) return outs[i * 32 + (31 - Math.clz32(m & -m))];
          }
          return c;
        };
        if (Math.pow(N, 9) <= 1 << 22) {
          const lut = new Uint8Array(Math.pow(N, 9));
          const v = new Array(9).fill(0);
          for (let i = 0; i < lut.length; i++) {
            let x = i; for (let p = 8; p >= 0; p--) { v[p] = x % N; x = (x / N) | 0; }
            lut[i] = mm(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]);
          }
          f = (c, n, ne, e, se, s, sw, w, nw) => lut[(((((((c * N + n) * N + ne) * N + e) * N + se) * N + s) * N + sw) * N + w) * N + nw];
        } else f = mm;
      } else f = (c, n, ne, e, se, s, sw, w, nw) => g([c, n, e, se, s, w, nw]);
    }
    return Object.assign(meta, { f });
  }

  // "permute" symmetry on big neighbourhoods: match on the multiset of neighbour states.
  // Only exact (non-variable) neighbour entries plus free variables are supported, by counting.
  function compilePermute(N, K, rules) {
    const nn = K - 1;
    const compiled = rules.map(r => {
      const need = new Int16Array(N); const sets = [];
      for (let i = 1; i <= nn; i++) { if (r.ins[i].length === 1) need[r.ins[i][0]]++; else sets.push(r.ins[i]); }
      return { c: new Set(r.ins[0]), need, sets, out: r.out };
    });
    const cnt = new Int16Array(N);
    const fit = (rule) => {
      // greedy check: remaining neighbours must be assignable to the variable sets
      const rem = Array.from(cnt);
      for (let s = 0; s < N; s++) { rem[s] -= rule.need[s]; if (rem[s] < 0) return false; }
      const sets = rule.sets.slice().sort((a, b) => a.length - b.length);
      for (const set of sets) { let ok = false; for (const s of set) if (rem[s] > 0) { rem[s]--; ok = true; break; } if (!ok) return false; }
      return true;
    };
    return (c, n, ne, e, se, s, sw, w, nw) => {
      cnt.fill(0);
      if (K === 9) { cnt[n]++; cnt[ne]++; cnt[e]++; cnt[se]++; cnt[s]++; cnt[sw]++; cnt[w]++; cnt[nw]++; }
      else { cnt[n]++; cnt[e]++; cnt[se]++; cnt[s]++; cnt[w]++; cnt[nw]++; }
      for (const r of compiled) if (r.c.has(c) && fit(r)) return r.out;
      return c;
    };
  }

  // ------------------------------------------------------------- entry point
  // spec: { type: 'string' | 'table' | 'js', text, states?, name? }
  CA.TABLES = CA.TABLES || {}; // named @TABLE sources, usable from rule strings
  CA.compileRule = function (spec, metaOnly) {
    if (typeof spec === 'string') spec = { type: 'string', text: spec };
    let r;
    if (spec.type === 'table') {
      r = compileTable(spec.text, metaOnly);
      r.canonical = spec.name || 'Custom table';
    } else if (spec.type === 'js') {
      const N = Math.max(2, Math.min(256, spec.states | 0 || 2));
      const g = new Function('c', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', 'N', spec.text);
      r = {
        kind: 'custom', states: N, canonical: spec.name || 'Custom function',
        f: (c, n, ne, e, se, s, sw, w, nw) => { const v = g(c, n, ne, e, se, s, sw, w, nw, N) | 0; return v >= 0 && v < N ? v : 0; },
      };
      if (r.f(0, 0, 0, 0, 0, 0, 0, 0, 0) !== 0) r.needsFinite = true;
    } else {
      const t = String(spec.text || '').trim();
      const low = t.toLowerCase().replace(/[\s_-]/g, '');
      let m;
      if (low === 'jvn29' || low === 'jvn') r = { kind: 'jvn', states: 29, f: makeJvN(false), canonical: 'JvN29', names: JVN_NAMES, glyphs: JVN_GLYPH };
      else if (low === 'nobili32' || low === 'jvn32') r = { kind: 'jvn', states: 32, f: makeJvN(true), canonical: 'Nobili32', names: JVN_NAMES, glyphs: JVN_GLYPH };
      else if (low === 'hutton32') r = { kind: 'jvn', states: 32, f: makeHutton(), canonical: 'Hutton32', names: JVN_NAMES, glyphs: JVN_GLYPH };
      else if (low === 'wireworld') r = { kind: 'wireworld', states: 4, f: wireworld(), canonical: 'WireWorld', names: ['empty', 'electron head', 'electron tail', 'conductor'] };
      else if (low === 'langtonsant' || low === 'ant') r = { kind: 'ant', states: 10, f: langtonsAnt(), canonical: 'LangtonsAnt' };
      else if ((m = /^w(\d+)$/.exec(low))) {
        const num = +m[1];
        if (num > 255) throw new Error('Elementary rules run from W0 to W255');
        if (num & 1) throw new Error('Odd elementary rules turn empty space on and are not supported');
        r = { kind: 'life', states: 2, f: elementary(num), canonical: 'W' + num };
      } else if ((m = /^cyclic:(\d+),(\d+)(?:,([mv]))?$/.exec(low))) {
        const C = +m[1], T = +m[2];
        if (C < 2 || C > 255) throw new Error('Cyclic rules need 2..255 states');
        r = { kind: 'cyclic', states: C, f: cyclic(C, T, m[3] === 'v'), canonical: `Cyclic:${C},${T},${(m[3] || 'm').toUpperCase()}`, needsFinite: false };
      } else if ((r = parseLtL(t))) { /* ok */ }
      else if ((r = parseLifeLike(t))) { /* ok */ }
      else {
        const key = Object.keys(CA.TABLES).find(k => k.toLowerCase().replace(/[\s_-]/g, '') === low);
        if (!key) throw new Error('Unrecognised rule "' + t + '"');
        const tb = CA.TABLES[key];
        r = compileTable(tb.table, metaOnly);
        r.canonical = key;
        if (tb.kind) r.kind = tb.kind;
        if (tb.colors) r.colors = tb.colors;
      }
    }
    // von Neumann-neighbourhood rules with a costly function get a lazily filled lookup table
    // (N^5 bytes of address space, only touched where the rule is actually exercised)
    if (!metaOnly && r.kind === 'jvn') {
      const N = r.states, g = r.f, memo = new Uint8Array(N * N * N * N * N).fill(255);
      r.f = (c, n, ne, e, se, s, sw, w, nw) => {
        const i = (((c * N + n) * N + e) * N + s) * N + w;
        const v = memo[i];
        return v !== 255 ? v : (memo[i] = g(c, n, 0, e, 0, s, 0, w, 0));
      };
    }
    if (!metaOnly && r.f && r.f(0, 0, 0, 0, 0, 0, 0, 0, 0) !== 0) r.needsFinite = true;
    return r;
  };
})(typeof self !== 'undefined' ? self : globalThis);
