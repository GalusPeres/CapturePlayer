import arithmeticSource from '../vendor/fsr1/ffx_a.h?raw';
import fsrSource from '../vendor/fsr1/ffx_fsr1.h?raw';

// GLSL ES 3.00 needs explicit unsigned literals and lacks bitfield builtins.
// Keep vendor files intact and adapt only these language-level operations.
const arithmetic = arithmeticSource
  .replace('bitfieldExtract(src,ASU1(off),ASU1(bits))', '(src>>off)&(bits==32u?0xffffffffu:((1u<<bits)-1u))')
  .replace('bitfieldInsert(src,ins,0,ASU1(bits))', 'ABfi(src,ins,bits==32u?0xffffffffu:((1u<<bits)-1u))');
const fsr = fsrSource.replace('con3[2]=con3[3]=0;', 'con3[2]=con3[3]=AU1(0);')
  .replace('con[2]=0;', 'con[2]=AU1(0);').replace('con[3]=0;', 'con[3]=AU1(0);');

// Unmodified MIT-licensed AMD FSR 1 headers; WebGL2 gather uses clamped loads.
export const fsrRcasShader = `
#define A_GPU 1
#define A_GLSL 1
${arithmetic}
#define FSR_RCAS_F 1
${fsr}
AF4 FsrRcasLoadF(ASU2 p) { return texelFetch(u_tex, clamp(p, ivec2(0), textureSize(u_tex,0)-1), 0); }
void FsrRcasInputF(inout AF1 r, inout AF1 g, inout AF1 b) {}
`;

const vertex = `#version 300 es
void main() {
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;
const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_input;
uniform vec2 u_inputSize;
uniform vec2 u_outputSize;
out vec4 outColor;
#define A_GPU 1
#define A_GLSL 1
${arithmetic}
#define FSR_EASU_F 1
${fsr}
vec4 gatherChannel(vec2 p,int channel) {
  ivec2 q=ivec2(floor(p*u_inputSize-0.5));
  ivec2 hi=ivec2(u_inputSize)-1;
  return vec4(texelFetch(u_input,clamp(q+ivec2(0,1),ivec2(0),hi),0)[channel],
              texelFetch(u_input,clamp(q+ivec2(1,1),ivec2(0),hi),0)[channel],
              texelFetch(u_input,clamp(q+ivec2(1,0),ivec2(0),hi),0)[channel],
              texelFetch(u_input,clamp(q,ivec2(0),hi),0)[channel]);
}
AF4 FsrEasuRF(AF2 p){return gatherChannel(p,0);}
AF4 FsrEasuGF(AF2 p){return gatherChannel(p,1);}
AF4 FsrEasuBF(AF2 p){return gatherChannel(p,2);}
void main(){
  AU4 c0,c1,c2,c3;
  FsrEasuCon(c0,c1,c2,c3,u_inputSize.x,u_inputSize.y,u_inputSize.x,u_inputSize.y,u_outputSize.x,u_outputSize.y);
  vec3 color;
  FsrEasuF(color,uvec2(gl_FragCoord.xy),c0,c1,c2,c3);
  outColor=vec4(color,1.0);
}`;

export function createFsrUpscaler(gl: WebGL2RenderingContext) {
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram();
  const output = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  const dispose = () => {
    shaders.forEach(s => gl.deleteShader(s));
    gl.deleteProgram(program); gl.deleteTexture(output); gl.deleteFramebuffer(framebuffer);
  };
  try {
    if (!program || !output || !framebuffer) throw new Error('FSR allocation failed');
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('FSR shader allocation failed');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'FSR compile failed');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'FSR link failed');
    gl.bindTexture(gl.TEXTURE_2D, output);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const inputSize = gl.getUniformLocation(program, 'u_inputSize');
    const outputSize = gl.getUniformLocation(program, 'u_outputSize');
    let allocatedWidth = 0, allocatedHeight = 0;
    return {
      dispose,
      render(input: WebGLTexture, sw: number, sh: number, width: number, height: number) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        if (width !== allocatedWidth || height !== allocatedHeight) {
          gl.bindTexture(gl.TEXTURE_2D, output);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FSR target unavailable');
          allocatedWidth = width; allocatedHeight = height;
        }
        gl.viewport(0, 0, width, height); gl.useProgram(program);
        gl.bindTexture(gl.TEXTURE_2D, input);
        gl.uniform2f(inputSize, sw, sh); gl.uniform2f(outputSize, width, height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return output;
      }
    };
  } catch (error) { dispose(); throw error; }
}
