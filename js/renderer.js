// WebGL2 renderer. The worker hands over a small texture of cell states for the visible
// region; everything else (cell shapes, glyphs, grid, phosphor trails, bloom) is done here.
(function (root) {
  'use strict';
  const CA = root.CA || (root.CA = {});

  const VS = `#version 300 es
  void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

  const FS_SCENE = `#version 300 es
  precision highp float; precision highp int; precision highp usampler2D;
  uniform usampler2D uState; uniform sampler2D uPal;
  uniform vec2 uRes, uCenterTex, uGridPhase; uniform ivec2 uTexSize;
  uniform float uTexPerPx, uCell, uK0, uGrid, uGlyph, uHasBounds, uShape;
  uniform vec4 uBounds;
  out vec4 o;
  float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
  float glyph(int g, vec2 f){
    vec2 p = f - 0.5; int kind = g & 15; float d = 1.0;
    if (kind <= 8) {
      int dir = (kind - 1) & 3; bool dbl = kind > 4; vec2 q;
      if (dir == 0) q = p; else if (dir == 1) q = vec2(-p.y, p.x); else if (dir == 2) q = vec2(-p.x, p.y); else q = vec2(p.y, p.x);
      q.y = abs(q.y);
      d = dbl ? seg(q, vec2(-0.28, 0.085), vec2(0.12, 0.085)) : seg(q, vec2(-0.28, 0.0), vec2(0.2, 0.0));
      d = min(d, seg(q, vec2(0.3, 0.0), vec2(0.1, 0.19)));
      return d - 0.035;
    }
    if (kind == 9) { d = abs(length(p) - 0.23) - 0.04; if ((g & 16) != 0) d = min(d, length(p) - 0.1); return d; }
    if (kind == 10) return abs(p.x) + abs(p.y) - 0.16;
    return min(seg(p, vec2(-0.26, 0.0), vec2(0.26, 0.0)), seg(p, vec2(0.0, -0.26), vec2(0.0, 0.26))) - 0.04;
  }
  void main(){
    vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - 0.5 * uRes;
    vec2 t = uCenterTex + px * uTexPerPx;
    ivec2 it = ivec2(floor(t)); vec2 f = fract(t);
    bool inTex = all(greaterThanEqual(it, ivec2(0))) && all(lessThan(it, uTexSize));
    uvec2 sv = inTex ? texelFetch(uState, it, 0).rg : uvec2(0u);
    vec3 col = vec3(0.0); float inside = 1.0;
    float aa = uTexPerPx;
    if (uHasBounds > 0.5) {
      vec2 dd = max(uBounds.xy - t, t - uBounds.zw);
      float dOut = max(dd.x, dd.y);
      inside = dOut > 0.0 ? 0.0 : 1.0;
      col += vec3(0.35, 0.55, 0.9) * 0.5 * (1.0 - smoothstep(0.0, 1.5 * aa, abs(dOut)));
    }
    if (uGrid > 0.5 && inside > 0.5) {
      vec2 e = min(f, 1.0 - f);
      float line = 1.0 - smoothstep(0.0, 1.0 * aa, min(e.x, e.y));
      float fine = uK0 * clamp((uCell - 7.0) / 10.0, 0.0, 1.0);
      col += vec3(0.5, 0.65, 1.0) * 0.055 * fine * line;
      if (uK0 > 0.5 && uCell > 1.6) {
        vec2 m = mod(vec2(it) + uGridPhase, 10.0);
        vec2 e2 = vec2(m.x < 0.5 ? f.x : 1.0, m.y < 0.5 ? f.y : 1.0);
        float l2 = 1.0 - smoothstep(0.0, 1.2 * aa, min(e2.x, e2.y));
        col += vec3(0.5, 0.65, 1.0) * 0.07 * clamp((uCell - 1.6) / 4.0, 0.0, 1.0) * l2;
      }
    }
    if (sv.r != 0u) {
      vec4 pc = texelFetch(uPal, ivec2(int(sv.r), 0), 0);
      float mask = 1.0;
      if (uK0 > 0.5 && uCell >= 4.0 && uShape > 0.5) {
        float k = clamp((uCell - 4.0) / 10.0, 0.0, 1.0);
        float gap = 0.065 * k, rad = (uShape > 1.5 ? 0.5 - gap : 0.2) * k;
        vec2 q = abs(f - 0.5) - (0.5 - gap - rad);
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
        mask = 1.0 - smoothstep(-aa, aa, d);
      }
      vec3 c = pc.rgb * (float(sv.g) / 255.0);
      int g = int(pc.a * 255.0 + 0.5);
      if (g > 0 && uGlyph > 0.5 && uK0 > 0.5 && uCell >= 9.0) {
        float a = (1.0 - smoothstep(-aa, aa, glyph(g, f))) * clamp((uCell - 9.0) / 6.0, 0.0, 1.0);
        vec3 ink = (g & 16) != 0 ? vec3(1.0) : c * 0.22;
        c = mix(c, ink, a * 0.92);
      }
      col = mix(col, c, mask);
    }
    o = vec4(col, inside);
  }`;

  const FS_TRAIL = `#version 300 es
  precision highp float;
  uniform sampler2D uScene, uPrev; uniform vec2 uRes, uShift; uniform float uScale, uDecay;
  out vec4 o;
  void main(){
    vec3 cur = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
    vec2 uv = ((gl_FragCoord.xy - 0.5 * uRes) * uScale + uShift + 0.5 * uRes) / uRes;
    vec3 prev = (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) ? texture(uPrev, uv).rgb : vec3(0.0);
    o = vec4(max(cur, prev * uDecay - 0.003), 1.0);
  }`;

  const FS_BLUR = `#version 300 es
  precision highp float;
  uniform sampler2D uTex; uniform vec2 uDir, uRes;
  out vec4 o;
  void main(){
    vec2 uv = gl_FragCoord.xy / uRes;
    vec3 c = texture(uTex, uv).rgb * 0.227027;
    c += (texture(uTex, uv + uDir * 1.384615).rgb + texture(uTex, uv - uDir * 1.384615).rgb) * 0.316216;
    c += (texture(uTex, uv + uDir * 3.230769).rgb + texture(uTex, uv - uDir * 3.230769).rgb) * 0.070270;
    o = vec4(c, 1.0);
  }`;

  const FS_FINAL = `#version 300 es
  precision highp float;
  uniform sampler2D uScene, uTrail, uB1, uB2, uB3; uniform vec2 uRes;
  uniform float uGlow, uTrailAmt; uniform vec3 uBg1, uBg2;
  out vec4 o;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    vec2 uv = gl_FragCoord.xy / uRes;
    vec4 s = texture(uScene, uv);
    // trails only show through where the cell is now empty, so standing structure keeps its true colour
    float lit = smoothstep(0.10, 0.22, max(s.r, max(s.g, s.b)));
    vec3 base = mix(max(s.rgb, texture(uTrail, uv).rgb * uTrailAmt), s.rgb, lit);
    vec3 bloom = texture(uB1, uv).rgb * 0.8 + texture(uB2, uv).rgb * 0.7 + texture(uB3, uv).rgb * 0.7;
    // the halo is strongest over dark space and backs off over lit cells
    vec3 col = base + bloom * uGlow * (1.0 - 0.82 * lit);
    float r = length((uv - 0.5) * vec2(uRes.x / uRes.y, 1.0));
    vec3 bg = mix(uBg1, uBg2, smoothstep(0.0, 0.95, r)) * mix(0.35, 1.0, s.a);
    col += bg;
    col = mix(col, 0.8 + 0.2 * (1.0 - exp(-(col - 0.8) / 0.2)), step(0.8, col));
    col *= 1.0 - 0.28 * r * r;
    col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    o = vec4(col, 1.0);
  }`;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 is not available in this browser');
      this.gl = gl;
      this.float = !!gl.getExtension('EXT_color_buffer_float');
      gl.getExtension('OES_texture_float_linear');
      this.pScene = this._prog(FS_SCENE); this.pTrail = this._prog(FS_TRAIL);
      this.pBlur = this._prog(FS_BLUR); this.pFinal = this._prog(FS_FINAL);
      this.vao = gl.createVertexArray();
      this.stateTex = this._tex(gl.NEAREST);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8UI, 1, 1, 0, gl.RG_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(2));
      this.palTex = this._tex(gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(1024));
      this.frame = { tw: 1, th: 1, x0: 0, y0: 0, k: 0 };
      this.prevView = null; this.w = 0; this.h = 0; this.flip = 0;
    }

    _prog(fs) {
      const gl = this.gl;
      const mk = (type, src) => {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
      return { p, u };
    }
    _tex(filter) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    _target(w, h) {
      const gl = this.gl, tex = this._tex(gl.LINEAR);
      if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fb, w, h };
    }

    resize() {
      const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(2, Math.round(c.clientWidth * dpr)), h = Math.max(2, Math.round(c.clientHeight * dpr));
      if (w === this.w && h === this.h) return false;
      const gl = this.gl;
      for (const t of this.targets || []) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      c.width = w; c.height = h; this.w = w; this.h = h; this.dpr = dpr;
      const d = s => [Math.max(1, Math.round(w / s)), Math.max(1, Math.round(h / s))];
      this.scene = this._target(w, h);
      this.trail = [this._target(w, h), this._target(w, h)];
      this.blur = [2, 4, 8].map(s => [this._target(...d(s)), this._target(...d(s))]);
      this.targets = [this.scene, ...this.trail, ...this.blur.flat()];
      this.prevView = null;
      return true;
    }

    setPalette(rgba) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.palTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    }

    setFrame(fr) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.stateTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8UI, fr.tw, fr.th, 0, gl.RG_INTEGER, gl.UNSIGNED_BYTE, fr.buf);
      this.frame = { tw: fr.tw, th: fr.th, x0: fr.x0, y0: fr.y0, k: fr.k };
    }

    clearTrails() { this.prevView = null; }

    _pass(prog, target, textures) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
      gl.viewport(0, 0, target ? target.w : this.w, target ? target.h : this.h);
      gl.useProgram(prog.p);
      let i = 0;
      for (const name in textures) {
        gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, textures[name]); gl.uniform1i(prog.u[name], i); i++;
      }
      return prog.u;
    }

    // view: { cx, cy, zoom } with zoom in device pixels per cell
    draw(view, o) {
      const gl = this.gl, fr = this.frame, w = this.w, h = this.h;
      gl.bindVertexArray(this.vao);
      gl.disable(gl.BLEND);
      const sc = Math.pow(2, fr.k);
      let u = this._pass(this.pScene, this.scene, { uState: this.stateTex, uPal: this.palTex });
      gl.uniform2f(u.uRes, w, h);
      gl.uniform2f(u.uCenterTex, (view.cx - fr.x0) / sc, (view.cy - fr.y0) / sc);
      gl.uniform1f(u.uTexPerPx, 1 / (view.zoom * sc));
      gl.uniform1f(u.uCell, view.zoom * sc);
      gl.uniform2i(u.uTexSize, fr.tw, fr.th);
      gl.uniform1f(u.uK0, fr.k === 0 ? 1 : 0);
      gl.uniform1f(u.uGrid, o.grid ? 1 : 0);
      gl.uniform1f(u.uGlyph, o.glyphs ? 1 : 0);
      gl.uniform1f(u.uShape, o.shape);
      const m10 = v => ((v % 10) + 10) % 10;
      gl.uniform2f(u.uGridPhase, m10(fr.x0), m10(fr.y0));
      if (o.bounds) {
        gl.uniform1f(u.uHasBounds, 1);
        gl.uniform4f(u.uBounds, (o.bounds.x0 - fr.x0) / sc, (o.bounds.y0 - fr.y0) / sc, (o.bounds.x1 - fr.x0) / sc, (o.bounds.y1 - fr.y0) / sc);
      } else gl.uniform1f(u.uHasBounds, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // phosphor trails, re-projected from the previous view so panning does not smear
      const src = this.trail[this.flip], dst = this.trail[1 - this.flip];
      u = this._pass(this.pTrail, dst, { uScene: this.scene.tex, uPrev: src.tex });
      gl.uniform2f(u.uRes, w, h);
      const pv = this.prevView;
      if (pv && o.trails > 0) {
        gl.uniform1f(u.uScale, pv.zoom / view.zoom);
        gl.uniform2f(u.uShift, (view.cx - pv.cx) * pv.zoom, -(view.cy - pv.cy) * pv.zoom);
        gl.uniform1f(u.uDecay, o.trails);
      } else { gl.uniform1f(u.uScale, 1); gl.uniform2f(u.uShift, 0, 0); gl.uniform1f(u.uDecay, 0); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.flip = 1 - this.flip;
      this.prevView = { cx: view.cx, cy: view.cy, zoom: view.zoom };

      // bloom chain
      let input = dst.tex;
      if (o.glow > 0) {
        for (const [a, b] of this.blur) {
          u = this._pass(this.pBlur, a, { uTex: input });
          gl.uniform2f(u.uRes, a.w, a.h); gl.uniform2f(u.uDir, 1 / a.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
          u = this._pass(this.pBlur, b, { uTex: a.tex });
          gl.uniform2f(u.uRes, b.w, b.h); gl.uniform2f(u.uDir, 0, 1 / b.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
          input = b.tex;
        }
      }
      u = this._pass(this.pFinal, null, { uScene: this.scene.tex, uTrail: dst.tex, uB1: this.blur[0][1].tex, uB2: this.blur[1][1].tex, uB3: this.blur[2][1].tex });
      gl.uniform2f(u.uRes, w, h);
      gl.uniform1f(u.uGlow, o.glow); gl.uniform1f(u.uTrailAmt, o.trails > 0 ? 0.75 : 0);
      gl.uniform3fv(u.uBg1, o.bg1); gl.uniform3fv(u.uBg2, o.bg2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  CA.Renderer = Renderer;
})(typeof self !== 'undefined' ? self : globalThis);
