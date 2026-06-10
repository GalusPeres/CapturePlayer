// src/components/glVideoPipeline.ts - Minimal WebGL2 presenter for VideoFrames.
// Each frame is drawn immediately into a desynchronized canvas so it can skip the
// regular compositor queue (lower capture-to-photon latency). Color and sharpness
// adjustments run in the shader, which keeps the canvas free of CSS filters - a
// CSS filter would force the frame back through an extra compositing pass.

export type GlFilterState = {
  brightness: number; // 1 = neutral
  contrast: number; // 1 = neutral
  saturation: number; // 1 = neutral
  hueDeg: number; // 0 = neutral
  blurPx: number; // 0 = neutral (softness for sharpness < 100)
  sharpen: number; // 0 = neutral (0..1 for sharpness 100..200)
  crisp: boolean; // nearest-neighbor sampling ("enhanced" mode)
};

export type GlVideoPipeline = {
  render(frame: VideoFrame, filters: GlFilterState, zoom: number): void;
  setDiagnostics(lines: string[] | null): void;
  dispose(): void;
  // Whether the browser actually granted the desynchronized (direct-present)
  // context - if false, frames still go through the regular compositor.
  desynchronized: boolean;
};

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_pos;
uniform vec2 u_scale;
uniform vec2 u_offset;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos * u_scale + u_offset, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_brightness;
uniform float u_contrast;
uniform mat3 u_colorMatrix;
uniform float u_sharpen;
uniform float u_blur;
uniform bool u_passthrough;
in vec2 v_uv;
out vec4 outColor;

vec3 sampleSource() {
  vec3 center = texture(u_tex, v_uv).rgb;
  if (u_sharpen > 0.0) {
    vec3 acc = center * (1.0 + 4.0 * u_sharpen);
    acc -= u_sharpen * texture(u_tex, v_uv + vec2(u_texel.x, 0.0)).rgb;
    acc -= u_sharpen * texture(u_tex, v_uv - vec2(u_texel.x, 0.0)).rgb;
    acc -= u_sharpen * texture(u_tex, v_uv + vec2(0.0, u_texel.y)).rgb;
    acc -= u_sharpen * texture(u_tex, v_uv - vec2(0.0, u_texel.y)).rgb;
    return acc;
  }
  if (u_blur > 0.0) {
    vec2 r = u_texel * u_blur;
    vec3 acc = center * 0.2;
    acc += 0.1 * texture(u_tex, v_uv + vec2(r.x, 0.0)).rgb;
    acc += 0.1 * texture(u_tex, v_uv - vec2(r.x, 0.0)).rgb;
    acc += 0.1 * texture(u_tex, v_uv + vec2(0.0, r.y)).rgb;
    acc += 0.1 * texture(u_tex, v_uv - vec2(0.0, r.y)).rgb;
    acc += 0.1 * texture(u_tex, v_uv + r).rgb;
    acc += 0.1 * texture(u_tex, v_uv - r).rgb;
    acc += 0.1 * texture(u_tex, v_uv + vec2(r.x, -r.y)).rgb;
    acc += 0.1 * texture(u_tex, v_uv - vec2(r.x, -r.y)).rgb;
    return acc;
  }
  return center;
}

void main() {
  vec4 source = texture(u_tex, v_uv);
  if (u_passthrough) {
    outColor = source;
    return;
  }
  vec3 c = sampleSource();
  c *= u_brightness;
  c = (c - 0.5) * u_contrast + 0.5;
  c = u_colorMatrix * c;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

// Matrices follow the CSS filter effects spec so the shader output matches
// what the <video> + CSS filter fallback path produces.
function saturationMatrix(s: number): number[] {
  return [
    0.213 + 0.787 * s,
    0.715 - 0.715 * s,
    0.072 - 0.072 * s,
    0.213 - 0.213 * s,
    0.715 + 0.285 * s,
    0.072 - 0.072 * s,
    0.213 - 0.213 * s,
    0.715 - 0.715 * s,
    0.072 + 0.928 * s
  ];
}

function hueRotateMatrix(deg: number): number[] {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    0.213 + 0.787 * c - 0.213 * s,
    0.715 - 0.715 * c - 0.715 * s,
    0.072 - 0.072 * c + 0.928 * s,
    0.213 - 0.213 * c + 0.143 * s,
    0.715 + 0.285 * c + 0.14 * s,
    0.072 - 0.072 * c - 0.283 * s,
    0.213 - 0.213 * c - 0.787 * s,
    0.715 - 0.715 * c + 0.715 * s,
    0.072 + 0.928 * c + 0.072 * s
  ];
}

function multiply3x3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

function toColumnMajor(m: number[]): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export function createGlVideoPipeline(canvas: HTMLCanvasElement): GlVideoPipeline {
  const gl = canvas.getContext('webgl2', {
    // The whole point: present without queueing behind the page compositor.
    desynchronized: true,
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  } as WebGLContextAttributes) as WebGL2RenderingContext | null;

  if (!gl) throw new Error('WebGL2 context unavailable');

  const contextAttributes = gl.getContextAttributes() as (WebGLContextAttributes & { desynchronized?: boolean }) | null;
  const desynchronized = !!contextAttributes?.desynchronized;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.useProgram(program);

  const vao = gl.createVertexArray();
  const quadBuffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  const diagnosticsTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindTexture(gl.TEXTURE_2D, diagnosticsTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const uniforms = {
    scale: gl.getUniformLocation(program, 'u_scale'),
    offset: gl.getUniformLocation(program, 'u_offset'),
    texel: gl.getUniformLocation(program, 'u_texel'),
    brightness: gl.getUniformLocation(program, 'u_brightness'),
    contrast: gl.getUniformLocation(program, 'u_contrast'),
    colorMatrix: gl.getUniformLocation(program, 'u_colorMatrix'),
    sharpen: gl.getUniformLocation(program, 'u_sharpen'),
    blur: gl.getUniformLocation(program, 'u_blur'),
    passthrough: gl.getUniformLocation(program, 'u_passthrough')
  };

  const diagnosticsCanvas = document.createElement('canvas');
  diagnosticsCanvas.width = 1;
  diagnosticsCanvas.height = 1;
  const diagnosticsContext = diagnosticsCanvas.getContext('2d');
  let diagnosticsCssWidth = 0;
  let diagnosticsCssHeight = 0;
  let diagnosticsVisible = false;
  let cachedSaturation: number | null = null;
  let cachedHue: number | null = null;
  let cachedCrisp = false;
  let lastLayoutKey = '';
  let disposed = false;

  const setDiagnostics = (lines: string[] | null) => {
    if (!diagnosticsContext || disposed) return;
    diagnosticsVisible = !!lines;
    if (!lines) return;

    const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : window.devicePixelRatio || 1;
    const lineHeight = 19.5;
    const paddingX = 12;
    const paddingY = 8;
    const radius = 6;
    const font =
      '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

    diagnosticsContext.font = font;
    const contentWidth = Math.max(...lines.map((line) => diagnosticsContext.measureText(line).width));
    diagnosticsCssWidth = Math.ceil(contentWidth + paddingX * 2);
    diagnosticsCssHeight = paddingY * 2 + lines.length * lineHeight;
    diagnosticsCanvas.width = Math.ceil(diagnosticsCssWidth * dpr);
    diagnosticsCanvas.height = Math.ceil(diagnosticsCssHeight * dpr);

    diagnosticsContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    diagnosticsContext.clearRect(0, 0, diagnosticsCssWidth, diagnosticsCssHeight);
    diagnosticsContext.beginPath();
    diagnosticsContext.roundRect(0.5, 0.5, diagnosticsCssWidth - 1, diagnosticsCssHeight - 1, radius);
    diagnosticsContext.fillStyle = 'rgba(0, 0, 0, 0.72)';
    diagnosticsContext.fill();
    diagnosticsContext.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    diagnosticsContext.lineWidth = 1;
    diagnosticsContext.stroke();
    diagnosticsContext.fillStyle = 'rgba(255, 255, 255, 0.9)';
    diagnosticsContext.font = font;
    diagnosticsContext.textBaseline = 'middle';
    lines.forEach((line, index) =>
      diagnosticsContext.fillText(line, paddingX, paddingY + lineHeight / 2 + index * lineHeight)
    );

    gl.bindTexture(gl.TEXTURE_2D, diagnosticsTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, diagnosticsCanvas);
  };

  const render = (frame: VideoFrame, filters: GlFilterState, zoom: number) => {
    const width = canvas.width;
    const height = canvas.height;
    const videoWidth = frame.displayWidth;
    const videoHeight = frame.displayHeight;
    if (disposed || gl.isContextLost() || !width || !height || !videoWidth || !videoHeight) return;

    gl.viewport(0, 0, width, height);

    // object-contain letterboxing plus user zoom, all in clip space.
    const canvasAspect = width / height;
    const videoAspect = videoWidth / videoHeight;
    let scaleX = zoom;
    let scaleY = zoom;
    if (canvasAspect > videoAspect) {
      scaleX *= videoAspect / canvasAspect;
    } else {
      scaleY *= canvasAspect / videoAspect;
    }

    // Clear only when the layout changes: on a desynchronized (front-buffer)
    // canvas an unconditional per-frame clear can momentarily hit the screen
    // as a black flash before the frame is drawn over it.
    const layoutKey = `${width}x${height}|${scaleX.toFixed(5)}|${scaleY.toFixed(5)}`;
    if (layoutKey !== lastLayoutKey) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      lastLayoutKey = layoutKey;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (filters.crisp !== cachedCrisp) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filters.crisp ? gl.NEAREST : gl.LINEAR);
      cachedCrisp = filters.crisp;
    }

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame as unknown as TexImageSource);

    gl.uniform2f(uniforms.scale, scaleX, scaleY);
    gl.uniform2f(uniforms.offset, 0, 0);
    gl.uniform2f(uniforms.texel, 1 / videoWidth, 1 / videoHeight);
    gl.uniform1f(uniforms.brightness, filters.brightness);
    gl.uniform1f(uniforms.contrast, filters.contrast);
    gl.uniform1f(uniforms.sharpen, filters.sharpen);
    gl.uniform1f(uniforms.blur, filters.blurPx);
    gl.uniform1i(uniforms.passthrough, 0);

    if (filters.saturation !== cachedSaturation || filters.hueDeg !== cachedHue) {
      const matrix = multiply3x3(hueRotateMatrix(filters.hueDeg), saturationMatrix(filters.saturation));
      gl.uniformMatrix3fv(uniforms.colorMatrix, false, toColumnMajor(matrix));
      cachedSaturation = filters.saturation;
      cachedHue = filters.hueDeg;
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (diagnosticsVisible) {
      const pixelRatio = canvas.clientWidth > 0 ? width / canvas.clientWidth : 1;
      const margin = Math.round(16 * pixelRatio);
      const overlayWidth = Math.min(Math.round(diagnosticsCssWidth * pixelRatio), width - margin * 2);
      const overlayHeight = Math.round(diagnosticsCssHeight * (overlayWidth / diagnosticsCssWidth));

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.viewport(margin, height - margin - overlayHeight, overlayWidth, overlayHeight);
      gl.bindTexture(gl.TEXTURE_2D, diagnosticsTexture);
      gl.uniform2f(uniforms.scale, 1, 1);
      gl.uniform2f(uniforms.offset, 0, 0);
      gl.uniform1i(uniforms.passthrough, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    }

    gl.flush();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      gl.deleteTexture(texture);
      gl.deleteTexture(diagnosticsTexture);
      gl.deleteBuffer(quadBuffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Releasing GPU resources is best-effort; the context goes away with the canvas.
    }
  };

  return { render, setDiagnostics, dispose, desynchronized };
}
