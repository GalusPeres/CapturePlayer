import { hdrFsrMapping } from './hdrFsr';

// Four bilinear taps cover the output pixel footprint. Resolve before RCAS so
// sharpening works at the final resolution. No history or CPU pixel transfers.
export const resolveVertex = `#version 300 es
out vec2 uv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.0-1.0,0,1);}`;
export const resolveFragment = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 outputSize;
in vec2 uv;
out vec4 color;
void main(){vec2 d=0.25/outputSize;
 color=0.25*(texture(source,uv+d)+texture(source,uv-d)+texture(source,uv+vec2(d.x,-d.y))+texture(source,uv+vec2(-d.x,d.y)));}`;

export function createFsrResolve(gl: WebGL2RenderingContext) {
  const program = gl.createProgram(), output = gl.createTexture(), framebuffer = gl.createFramebuffer();
  const dispose = () => { gl.deleteProgram(program); gl.deleteTexture(output); gl.deleteFramebuffer(framebuffer); };
  try {
    if (!program || !output || !framebuffer) throw Error('FSR resolve allocation failed');
    for (const [type, code] of [[gl.VERTEX_SHADER, resolveVertex], [gl.FRAGMENT_SHADER, resolveFragment]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw Error('FSR resolve shader allocation failed');
      gl.shaderSource(shader, code); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw Error(log || 'FSR resolve compile failed'); }
      gl.attachShader(program, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) || 'FSR resolve link failed');
    const size = gl.getUniformLocation(program, 'outputSize');
    gl.bindTexture(gl.TEXTURE_2D, output);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let width = 0, height = 0;
    return { dispose, render(input: WebGLTexture, w: number, h: number) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      if (width !== w || height !== h) {
        width = w; height = h; gl.bindTexture(gl.TEXTURE_2D, output);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('FSR resolve framebuffer incomplete');
      }
      gl.viewport(0, 0, w, h); gl.useProgram(program); gl.uniform2f(size, w, h);
      gl.bindTexture(gl.TEXTURE_2D, input); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); return output;
    } };
  } catch (error) { dispose(); throw error; }
}

export const hdrResolveShader = `
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var bilinear:sampler;
@group(0) @binding(2) var<uniform> size:vec4f;
${hdrFsrMapping}
struct V { @builtin(position) pos:vec4f, @location(0) uv:vec2f };
@vertex fn vs(@builtin(vertex_index) i:u32)->V {
 let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
 var v:V;v.pos=vec4f(p[i],0,1);v.uv=vec2f((p[i].x+1)*0.5,(1-p[i].y)*0.5);return v;
}
fn sample(uv:vec2f)->vec3f {return fsrUnpack(textureSampleLevel(source,bilinear,uv,0).rgb);}
@fragment fn fs(v:V)->@location(0) vec4f {
 let d=0.25/size.xy;
 // Unpack before averaging; HDR and negative gamut values remain unclamped.
 let rgb=0.25*(sample(v.uv+d)+sample(v.uv-d)+sample(v.uv+vec2f(d.x,-d.y))+sample(v.uv+vec2f(-d.x,d.y)));
 return vec4f(fsrPack(rgb),1);
}`;

export async function createHdrFsrResolve(device: any) {
  const module = device.createShaderModule({ code: hdrResolveShader });
  const info = await module.getCompilationInfo();
  if (info.messages.some((m: any) => m.type === 'error')) throw Error('HDR resolve shader compilation failed');
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] } });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const uniform = device.createBuffer({ size: 16, usage: 0x40 | 0x08 });
  const sizes = new Float32Array(4);
  let output: any, width = 0, height = 0;
  return { dispose() { output?.destroy(); uniform.destroy(); },
    render(encoder: any, source: any, w: number, h: number) {
      if (width !== w || height !== h) {
        output?.destroy(); width = w; height = h;
        output = device.createTexture({ size: [w, h], format: 'rgba16float', usage: 0x10 | 0x04 });
      }
      sizes.set([w, h, 0, 0]); device.queue.writeBuffer(uniform, 0, sizes);
      const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: source.createView() }, { binding: 1, resource: sampler }, { binding: 2, resource: { buffer: uniform } }
      ] });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind); pass.draw(3); pass.end(); return output;
    }
  };
}
