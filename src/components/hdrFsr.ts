// WGSL adaptation of AMD FidelityFX FSR 1 EASU/RCAS.
// Copyright (c) 2021 Advanced Micro Devices, Inc. SPDX-License-Identifier: MIT
// See src/vendor/fsr1/LICENSE.txt and ffx_fsr1.h for the original algorithms.
// Signed reversible normalization keeps extended-sRGB HDR/gamut values intact
// while the FSR kernels operate in their required perceptual [0,1] range.
export const hdrFsrMapping = `
fn fsrPack(c:vec3f)->vec3f {
  let a=abs(c);return vec3f(0.5)+0.5*c/(1+max(a.x,max(a.y,a.z)));
}
fn fsrUnpack(c:vec3f)->vec3f {
  let v=2*c-1;let a=abs(v);return v/max(1-max(a.x,max(a.y,a.z)),0.00001);
}`;

const easuShader = `
@group(0) @binding(0) var source:texture_external;
@group(0) @binding(1) var point:sampler;
@group(0) @binding(2) var<uniform> sizes:vec4f;
${hdrFsrMapping}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);
}
fn load(p:vec2f)->vec3f {return fsrPack(textureSampleBaseClampToEdge(source,point,(p+0.5)/sizes.xy).rgb);}
fn luma(c:vec3f)->f32 {return c.g+0.5*(c.r+c.b);}
fn direction(w:f32,a:f32,b:f32,c:f32,d:f32,e:f32)->vec3f {
  let grad=vec2f(d-b,e-a);
  let len=clamp(abs(grad)/max(vec2f(max(abs(d-c),abs(c-b)),max(abs(e-c),abs(c-a))),vec2f(1e-8)),vec2f(0),vec2f(1));
  return vec3f(grad*w,dot(len,len)*w);
}
fn tap(off:vec2f,dir:vec2f,len:vec2f,lobe:f32,clip:f32,c:vec3f)->vec4f {
  let v=vec2f(dot(off,dir),dot(off,vec2f(-dir.y,dir.x)))*len;
  let d=min(dot(v,v),clip);let b=0.4*d-1;let a=lobe*d-1;
  let weight=(1.5625*b*b-0.5625)*a*a;return vec4f(c*weight,weight);
}
@fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f {
  let p=pos.xy*sizes.xy/sizes.zw-0.5;let base=floor(p);let f=p-base;
  let b=load(base+vec2f(0,-1));let c=load(base+vec2f(1,-1));
  let e=load(base+vec2f(-1,0));let ff=load(base);let g=load(base+vec2f(1,0));let h=load(base+vec2f(2,0));
  let i=load(base+vec2f(-1,1));let j=load(base+vec2f(0,1));let k=load(base+vec2f(1,1));let l=load(base+vec2f(2,1));
  let n=load(base+vec2f(0,2));let o=load(base+vec2f(1,2));
  let d=direction((1-f.x)*(1-f.y),luma(b),luma(e),luma(ff),luma(g),luma(j))
    +direction(f.x*(1-f.y),luma(c),luma(ff),luma(g),luma(h),luma(k))
    +direction((1-f.x)*f.y,luma(ff),luma(i),luma(j),luma(k),luma(n))
    +direction(f.x*f.y,luma(g),luma(j),luma(k),luma(l),luma(o));
  var dir=d.xy;let mag=dot(dir,dir);
  if(mag<1.0/32768.0){dir=vec2f(1,0);}else{dir*=inverseSqrt(mag);}
  let length=0.25*d.z*d.z;let stretch=dot(dir,dir)/max(abs(dir.x),abs(dir.y));
  let anisotropy=vec2f(1+(stretch-1)*length,1-0.5*length);
  let lobe=0.5-0.29*length;let clip=1/lobe;
  let sum=tap(vec2f(0,-1)-f,dir,anisotropy,lobe,clip,b)+tap(vec2f(1,-1)-f,dir,anisotropy,lobe,clip,c)
    +tap(vec2f(-1,0)-f,dir,anisotropy,lobe,clip,e)+tap(-f,dir,anisotropy,lobe,clip,ff)
    +tap(vec2f(1,0)-f,dir,anisotropy,lobe,clip,g)+tap(vec2f(2,0)-f,dir,anisotropy,lobe,clip,h)
    +tap(vec2f(-1,1)-f,dir,anisotropy,lobe,clip,i)+tap(vec2f(0,1)-f,dir,anisotropy,lobe,clip,j)
    +tap(vec2f(1,1)-f,dir,anisotropy,lobe,clip,k)+tap(vec2f(2,1)-f,dir,anisotropy,lobe,clip,l)
    +tap(vec2f(0,2)-f,dir,anisotropy,lobe,clip,n)+tap(vec2f(1,2)-f,dir,anisotropy,lobe,clip,o);
  let minimum=min(min(ff,g),min(j,k));let maximum=max(max(ff,g),max(j,k));
  return vec4f(clamp(sum.rgb/sum.a,minimum,maximum),1);
}`;

// Included only in the final FSR pipeline. `params.pixel.z` is RCAS strength.
export const hdrRcasSample = `
${hdrFsrMapping}
fn fsrLoad(p:vec2i)->vec3f {
  return textureLoad(source,clamp(p,vec2i(0),vec2i(textureDimensions(source))-1),0).rgb;
}
fn sample(uv:vec2f)->vec3f {
  let p=vec2i(uv*vec2f(textureDimensions(source)));let e=fsrLoad(p);
  if(params.pixel.z<=0){return fsrUnpack(e);}
  let b=fsrLoad(p+vec2i(0,-1));let d=fsrLoad(p+vec2i(-1,0));
  let f=fsrLoad(p+vec2i(1,0));let h=fsrLoad(p+vec2i(0,1));
  let mn=min(min(b,d),min(f,h));let mx=max(max(b,d),max(f,h));
  let hitMin=min(mn,e)/max(4*mx,vec3f(1e-8));
  let hitMax=(1-max(mx,e))/min(4*mn-4,vec3f(-1e-8));
  let lobes=max(-hitMin,hitMax);
  let lobe=max(-0.1875,min(max(lobes.x,max(lobes.y,lobes.z)),0))*params.pixel.z;
  return fsrUnpack((lobe*(b+d+f+h)+e)/(4*lobe+1));
}`;

export async function createHdrFsr(device: any) {
  const module = device.createShaderModule({ code: easuShader });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m: any) => m.type === 'error');
  if (errors.length) throw new Error(errors.map((m: any) => m.message).join('\n'));
  const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] } });
  const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
  const uniform = device.createBuffer({ size: 16, usage: 0x40 | 0x08 });
  const sizes = new Float32Array(4);
  let output: any, width = 0, height = 0;
  return {
    render(encoder: any, source: any, inputWidth: number, inputHeight: number, outputWidth: number, outputHeight: number) {
      if (width !== outputWidth || height !== outputHeight) {
        output?.destroy(); width = outputWidth; height = outputHeight;
        output = device.createTexture({ size: [width, height], format: 'rgba16float', usage: 0x10 | 0x04 });
      }
      sizes.set([inputWidth, inputHeight, width, height]);device.queue.writeBuffer(uniform, 0, sizes);
      const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: source }, { binding: 1, resource: sampler }, { binding: 2, resource: { buffer: uniform } }
      ] });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipeline);pass.setBindGroup(0, bind);pass.draw(3);pass.end();
      return output;
    },
    dispose() { output?.destroy();uniform.destroy(); }
  };
}
