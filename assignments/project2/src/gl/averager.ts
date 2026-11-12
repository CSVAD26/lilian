/**
 * GPU image averager, two tiers:
 *
 *  - Live preview: every photo is already on the GPU (packed into atlas
 *    textures at preview resolution). Any selection change re-draws the whole
 *    average in a few ms, so it can follow the timeline brush frame by frame.
 *  - High-res refinement: once the selection has been stable for a moment, each
 *    selected photo's high-res file is streamed in, added to a full-resolution
 *    sum, and thrown away. Only the running sum stays in memory. When it
 *    finishes, the display swaps to the sharp version.
 *
 * Averaging uses a weighted, "transparent outside" canvas: each photo writes
 * (color * w, w) with additive blending into a float buffer, where w is 1 inside
 * the photo (feathered to ~0 at its edges) and nothing outside it. The final
 * color is sum(color * w) / sum(w), so each pixel averages only the photos that
 * cover it. Pixels no photo covers stay transparent.
 */

import type { Manifest, Photo } from '../types';

export type Phase = 'loading' | 'empty' | 'preview' | 'refining' | 'hires' | 'error';

export interface AveragerStatus {
  phase: Phase;
  /** Number of photos in the current selection. */
  count: number;
  /** Progress while loading atlases or refining. */
  done?: number;
  total?: number;
  /** Resolution of what's currently on screen. */
  width?: number;
  height?: number;
  message?: string;
  warning?: string;
}

export interface AveragerOptions {
  /** Edge feather as a fraction of the canvas's shorter side. Default 0.03. */
  feather?: number;
  /** Delay after the last selection change before high-res refinement starts. Default 350 ms. */
  refineDelay?: number;
  /** How many high-res images to download/decode ahead. Default 4. */
  prefetch?: number;
  /** Average in linear light instead of raw sRGB pixel values. Default false. */
  linear?: boolean;
}

// ---------------------------------------------------------------- shaders --

const ACCUM_VS = `#version 300 es
layout(location = 0) in vec2 aQ;   // unit quad, (0,0) = top-left of the photo
uniform vec4 uRect;                // photo rect on the canvas (normalized, y down)
uniform vec4 uUv;                  // photo rect in its texture (normalized, y down)
out vec2 vQ;
out vec2 vUv;
void main() {
  vec2 c = uRect.xy + aQ * uRect.zw;
  gl_Position = vec4(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0);
  vQ = aQ;
  vUv = uUv.xy + aQ * uUv.zw;
}`;

const ACCUM_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uClamp;     // min uv, max uv (half-texel inset, keeps atlas neighbours out)
uniform vec2 uFeather;   // feather width in quad units, per axis
uniform bool uLinear;
in vec2 vQ;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(uTex, clamp(vUv, uClamp.xy, uClamp.zw)).rgb;
  if (uLinear) c = pow(c, vec3(2.2));
  vec2 edge = min(vQ, 1.0 - vQ);
  vec2 f = smoothstep(vec2(0.0), uFeather, edge);
  // small floor so pixels at the canvas border (where every photo fades) never divide by ~0
  float w = mix(0.02, 1.0, f.x * f.y);
  outColor = vec4(c * w, w);
}`;

const FULLSCREEN_VS = `#version 300 es
layout(location = 0) in vec2 aQ;
out vec2 vUv;
void main() {
  vUv = aQ;
  gl_Position = vec4(aQ * 2.0 - 1.0, 0.0, 1.0);
}`;

/** sum / weight -> 8-bit color. Same size as the accumulator, so texelFetch is exact. */
const RESOLVE_FS = `#version 300 es
precision highp float;
uniform sampler2D uAccum;
uniform bool uLinear;
out vec4 outColor;
void main() {
  vec4 s = texelFetch(uAccum, ivec2(gl_FragCoord.xy), 0);
  if (s.a < 1e-5) { outColor = vec4(0.0); return; }
  vec3 c = s.rgb / s.a;
  if (uLinear) c = pow(c, vec3(1.0 / 2.2));
  outColor = vec4(c, 1.0);
}`;

const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`;

// ---------------------------------------------------------------- helpers --

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
  };
  const p = gl.createProgram()!;
  const v = make(gl.VERTEX_SHADER, vs);
  const f = make(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string, uniforms: string[]): Program {
  const prog = compile(gl, vs, fs);
  const u: Program['u'] = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
  return { prog, u };
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

async function loadBitmap(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} loading ${url}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

// ---------------------------------------------------------------- averager --

export class Averager {
  onStatus: (s: AveragerStatus) => void = () => {};

  private gl: WebGL2RenderingContext;
  private manifest: Manifest;
  private baseUrl: string;
  private opts: Required<AveragerOptions>;

  private accumProg!: Program;
  private resolveProg!: Program;
  private blitProg!: Program;
  private quad!: WebGLVertexArrayObject;
  private quadBuf!: WebGLBuffer;

  private floatFormat: number;
  private floatType: number;
  private warning?: string;

  private atlases: WebGLTexture[] = [];
  private previewAccum!: Target;
  private previewResult!: Target;
  private hiresAccum: Target | null = null;
  private hiresResult: Target | null = null;
  private hiresTex: WebGLTexture | null = null;

  private selection: Photo[] = [];
  private showing: 'none' | 'preview' | 'hires' = 'none';
  private generation = 0;
  private refineTimer: ReturnType<typeof setTimeout> | null = null;
  private refineAbort: AbortController | null = null;
  private ready = false;
  private destroyed = false;
  private status: AveragerStatus = { phase: 'loading', count: 0 };

  constructor(private canvas: HTMLCanvasElement, manifest: Manifest, baseUrl: string, options: AveragerOptions = {}) {
    this.manifest = manifest;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.opts = { feather: 0.03, refineDelay: 350, prefetch: 4, linear: false, ...options };

    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('This GPU/browser cannot render to float textures (EXT_color_buffer_float).');
    }
    if (gl.getExtension('EXT_float_blend')) {
      this.floatFormat = gl.RGBA32F;
      this.floatType = gl.FLOAT;
    } else {
      // Half floats lose precision once hundreds of photos are summed; fine for small selections.
      this.floatFormat = gl.RGBA16F;
      this.floatType = gl.HALF_FLOAT;
      this.warning = 'No 32-bit float blending on this device; large averages may show banding.';
    }
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /** Compile shaders, allocate buffers, and load the preview atlases. */
  async init(): Promise<void> {
    const gl = this.gl;
    this.accumProg = program(gl, ACCUM_VS, ACCUM_FS, ['uRect', 'uUv', 'uTex', 'uClamp', 'uFeather', 'uLinear']);
    this.resolveProg = program(gl, FULLSCREEN_VS, RESOLVE_FS, ['uAccum', 'uLinear']);
    this.blitProg = program(gl, FULLSCREEN_VS, BLIT_FS, ['uTex']);

    this.quad = gl.createVertexArray()!;
    this.quadBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.quad);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const { width: pw, height: ph } = this.manifest.preview;
    this.previewAccum = this.makeTarget(pw, ph, true);
    this.previewResult = this.makeTarget(pw, ph, false);

    const atlases = this.manifest.preview.atlases;
    this.emit({ phase: 'loading', count: 0, done: 0, total: atlases.length });
    let loaded = 0;
    this.atlases = await Promise.all(
      atlases.map(async (a) => {
        const bmp = await loadBitmap(this.baseUrl + a.file);
        if (this.destroyed) {
          bmp.close();
          return null as unknown as WebGLTexture;
        }
        const tex = this.makeImageTexture(bmp);
        bmp.close();
        this.emit({ phase: 'loading', count: 0, done: ++loaded, total: atlases.length });
        return tex;
      }),
    );
    if (this.destroyed) return;
    this.ready = true;
    this.setSelection(this.selection, true);
  }

  get currentStatus(): AveragerStatus {
    return this.status;
  }

  /** Replace the set of photos being averaged. Cheap; call as often as you like. */
  setSelection(photos: Photo[], force = false): void {
    if (!force && sameIds(photos, this.selection)) return;
    this.selection = photos;
    if (!this.ready || this.destroyed) return;
    this.restart();
  }

  setLinear(linear: boolean): void {
    if (linear === this.opts.linear) return;
    this.opts.linear = linear;
    if (this.ready) this.restart();
  }

  /** Call when the canvas's CSS size changes. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.ready) this.display();
  }

  /** PNG of whatever is currently shown (high-res if refinement finished). */
  async exportPNG(): Promise<Blob | null> {
    const t = this.showing === 'hires' ? this.hiresResult : this.showing === 'preview' ? this.previewResult : null;
    if (!t) return null;
    const gl = this.gl;
    const px = new Uint8Array(t.width * t.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // GL rows run bottom-to-top; images run top-to-bottom.
    const out = new Uint8ClampedArray(px.length);
    const row = t.width * 4;
    for (let y = 0; y < t.height; y++) out.set(px.subarray((t.height - 1 - y) * row, (t.height - y) * row), y * row);
    const c = document.createElement('canvas');
    c.width = t.width;
    c.height = t.height;
    c.getContext('2d')!.putImageData(new ImageData(out, t.width, t.height), 0, 0);
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelRefine();
    const gl = this.gl;
    for (const t of this.atlases) if (t) gl.deleteTexture(t);
    for (const t of [this.previewAccum, this.previewResult, this.hiresAccum, this.hiresResult]) {
      if (t) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
    }
    if (this.hiresTex) gl.deleteTexture(this.hiresTex);
    if (this.quadBuf) gl.deleteBuffer(this.quadBuf);
    if (this.quad) gl.deleteVertexArray(this.quad);
    for (const p of [this.accumProg, this.resolveProg, this.blitProg]) if (p) gl.deleteProgram(p.prog);
  }

  // ------------------------------------------------------------- internals --

  private emit(s: AveragerStatus) {
    this.status = this.warning ? { ...s, warning: this.warning } : s;
    this.onStatus(this.status);
  }

  private restart() {
    this.cancelRefine();
    const gen = ++this.generation;
    if (this.selection.length === 0) {
      this.showing = 'none';
      this.display();
      this.emit({ phase: 'empty', count: 0 });
      return;
    }
    this.renderPreview();
    this.showing = 'preview';
    this.display();
    const { width, height } = this.previewResult;
    this.emit({ phase: 'preview', count: this.selection.length, width, height });
    this.refineTimer = setTimeout(() => void this.refine(gen), this.opts.refineDelay);
  }

  private cancelRefine() {
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refineTimer = null;
    this.refineAbort?.abort();
    this.refineAbort = null;
  }

  private makeTarget(width: number, height: number, float: boolean): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (float) {
      gl.texImage2D(gl.TEXTURE_2D, 0, this.floatFormat, width, height, 0, gl.RGBA, this.floatType, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    } else {
      // 8-bit result, mipmapped so the display looks clean at any zoom
      const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (ok !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete (0x${ok.toString(16)})`);
    return { tex, fbo, width, height };
  }

  private makeImageTexture(src: TexImageSource, reuse?: WebGLTexture | null): WebGLTexture {
    const gl = this.gl;
    const tex = reuse ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** Bind target, clear it, set additive blending and the accumulate program. */
  private beginAccum(t: Target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.width, t.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.accumProg.prog);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.accumProg.u.uTex, 0);
    gl.uniform1i(this.accumProg.u.uLinear, this.opts.linear ? 1 : 0);
  }

  /** Draw one photo into the currently bound accumulator. uv rect is in texture pixels. */
  private drawPhoto(p: Photo, texW: number, texH: number, ux: number, uy: number, uw: number, uh: number) {
    const gl = this.gl;
    const u = this.accumProg.u;
    const { rect } = p;
    gl.uniform4f(u.uRect, rect.x, rect.y, rect.w, rect.h);
    gl.uniform4f(u.uUv, ux / texW, uy / texH, uw / texW, uh / texH);
    gl.uniform4f(u.uClamp, (ux + 0.5) / texW, (uy + 0.5) / texH, (ux + uw - 0.5) / texW, (uy + uh - 0.5) / texH);
    // feather width: fraction of the canvas's short side, expressed in this photo's quad units
    const { width: cw, height: ch } = this.manifest.canvas;
    const f = this.opts.feather * Math.min(cw, ch);
    gl.uniform2f(u.uFeather, Math.max(1e-4, f / (rect.w * cw)), Math.max(1e-4, f / (rect.h * ch)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private resolve(accum: Target, result: Target) {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, result.fbo);
    gl.viewport(0, 0, result.width, result.height);
    gl.useProgram(this.resolveProg.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accum.tex);
    gl.uniform1i(this.resolveProg.u.uAccum, 0);
    gl.uniform1i(this.resolveProg.u.uLinear, this.opts.linear ? 1 : 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, result.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private renderPreview() {
    const gl = this.gl;
    this.beginAccum(this.previewAccum);
    const sheets = this.manifest.preview.atlases;
    // group by atlas to minimize texture switches
    const byAtlas = [...this.selection].sort((a, b) => a.preview.atlas - b.preview.atlas);
    let bound = -1;
    for (const p of byAtlas) {
      const a = p.preview.atlas;
      if (a !== bound) {
        gl.bindTexture(gl.TEXTURE_2D, this.atlases[a]);
        bound = a;
      }
      const s = sheets[a];
      this.drawPhoto(p, s.width, s.height, p.preview.x, p.preview.y, p.preview.w, p.preview.h);
    }
    this.resolve(this.previewAccum, this.previewResult);
  }

  private ensureHiresTargets() {
    if (this.hiresAccum) return;
    const gl = this.gl;
    const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    let { width, height } = this.manifest.hires;
    const s = Math.min(1, max / Math.max(width, height));
    width = Math.round(width * s);
    height = Math.round(height * s);
    this.hiresAccum = this.makeTarget(width, height, true);
    this.hiresResult = this.makeTarget(width, height, false);
  }

  private async refine(gen: number) {
    if (gen !== this.generation || this.destroyed) return;
    const photos = this.selection;
    const total = photos.length;
    const abort = new AbortController();
    this.refineAbort = abort;
    const stale = () => gen !== this.generation || this.destroyed || abort.signal.aborted;

    this.ensureHiresTargets();
    const accum = this.hiresAccum!;
    const emitProgress = (done: number) =>
      this.emit({ phase: 'refining', count: total, done, total, width: this.previewResult.width, height: this.previewResult.height });
    emitProgress(0);

    const pending: (Promise<ImageBitmap> | undefined)[] = new Array(total);
    const request = (i: number) => {
      if (i < total && !pending[i]) {
        pending[i] = loadBitmap(this.baseUrl + photos[i].hires.file, abort.signal);
        pending[i]!.catch(() => {}); // handled when awaited
      }
    };
    const cleanup = () => {
      for (const p of pending) p?.then((b) => b.close(), () => {});
    };

    // Accumulator is cleared once; other draws (display/preview) never touch it.
    this.beginAccum(accum);
    let done = 0;
    for (let i = 0; i < total; i++) {
      for (let k = i; k <= i + this.opts.prefetch; k++) request(k);
      let bmp: ImageBitmap;
      try {
        bmp = await pending[i]!;
      } catch (e) {
        if (stale()) return cleanup();
        console.warn('Skipping photo in high-res pass:', photos[i].source, e);
        pending[i] = undefined;
        continue;
      }
      pending[i] = undefined;
      if (stale()) {
        bmp.close();
        return cleanup();
      }
      const gl = this.gl;
      // Other work (preview renders, display) may have run while we awaited, so re-bind state.
      this.hiresTex = this.makeImageTexture(bmp, this.hiresTex);
      gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fbo);
      gl.viewport(0, 0, accum.width, accum.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.accumProg.prog);
      gl.bindVertexArray(this.quad);
      gl.uniform1i(this.accumProg.u.uLinear, this.opts.linear ? 1 : 0);
      this.drawPhoto(photos[i], bmp.width, bmp.height, 0, 0, bmp.width, bmp.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      bmp.close();
      done++;
      emitProgress(done);
    }
    if (stale()) return;
    this.resolve(accum, this.hiresResult!);
    this.showing = 'hires';
    this.display();
    this.refineAbort = null;
    this.emit({ phase: 'hires', count: total, width: accum.width, height: accum.height });
  }

  /** Draw the current result into the visible canvas, fit to its size (letterboxed). */
  private display() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const t = this.showing === 'hires' ? this.hiresResult : this.showing === 'preview' ? this.previewResult : null;
    if (!t) return;
    const { width: cw, height: ch } = this.manifest.canvas;
    const scale = Math.min(this.canvas.width / cw, this.canvas.height / ch);
    const w = Math.round(cw * scale);
    const h = Math.round(ch * scale);
    gl.viewport(Math.floor((this.canvas.width - w) / 2), Math.floor((this.canvas.height - h) / 2), w, h);
    gl.useProgram(this.blitProg.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1i(this.blitProg.u.uTex, 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

function sameIds(a: Photo[], b: Photo[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
  return true;
}
