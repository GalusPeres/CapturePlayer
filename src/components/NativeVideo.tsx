import React, { useEffect, useRef, useState } from 'react';
import { subscribeNativeFrames, getCompatibilityTrack } from '../hooks/nativeVideoStream';
import { createGlVideoPipeline, getVideoColorMatrix, type GlFilterState } from './glVideoPipeline';
import { createHdrFsr, hdrRcasSample } from './hdrFsr';
import { createHdrFsrResolve } from './fsrResolve';
import { getFsrSize } from './fsrSizing';

export default function NativeVideo({ hdr, stream = null, zoom, filters, onResolution }: {
  stream?: MediaStream | null;
  hdr: boolean; zoom: number; filters: GlFilterState;
  onResolution?: (res: { w: number; h: number; fps?: number } | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const current = useRef({ zoom, filters, onResolution }); current.current = { zoom, filters, onResolution };
  const [error, setError] = useState('');
  const compatibilityTrack = getCompatibilityTrack(stream);
  useEffect(() => {
    const canvas = ref.current!; let stopped = false, unsubscribe = () => {}, dispose = () => {};
    // Layout changes are events, not per-frame work. Reading clientWidth after
    // diagnostic DOM writes can otherwise force a style/layout update at 60 Hz.
    let cssWidth = canvas.clientWidth, cssHeight = canvas.clientHeight;
    const resize = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      if (entry) { cssWidth = entry.contentRect.width; cssHeight = entry.contentRect.height; }
    });
    resize.observe(canvas);
    const setData = (key: string, value: string) => { if (canvas.dataset[key] !== value) canvas.dataset[key] = value; };
    canvas.dataset.neuralInput = 'original';
    setError('');
    const initialize = async () => {
      let draw: (frame: VideoFrame) => void;
      if (hdr) {
        const gpu = (navigator as any).gpu;
        const adapter = await gpu?.requestAdapter();
        if (!adapter) throw new Error('WebGPU HDR is unavailable on this system.');
        const device = await adapter.requestDevice();
        if (stopped) { device.destroy(); return; }
        const context = (canvas as any).getContext('webgpu');
        if (!context) { device.destroy(); throw new Error('Could not create HDR canvas.'); }
        context.configure({ device, format: 'rgba16float', usage: 17, colorSpace: 'srgb', toneMapping: { mode: 'extended' }, alphaMode: 'opaque' });
        dispose = () => { context.unconfigure(); device.destroy(); };
        const code = `
          @group(0) @binding(0) var source: texture_external;
          @group(0) @binding(1) var bilinear: sampler;
          struct Parameters { scale:vec4f, adjust:vec4f, pixel:vec4f, color0:vec4f, color1:vec4f, color2:vec4f };
          @group(0) @binding(2) var<uniform> params: Parameters;
          struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
          @vertex fn vs(@builtin(vertex_index) i:u32)->V {
            // A real rectangle is required when zooming out. Scaling an oversized
            // fullscreen triangle exposes UVs outside the video and smears edges.
            let p=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
            var o:V;o.pos=vec4f(p[i]*params.scale.xy,0,1);o.uv=vec2f((p[i].x+1)*0.5,(1-p[i].y)*0.5);return o;
          }
          fn sample(uv:vec2f)->vec3f { return textureSampleBaseClampToEdge(source,bilinear,uv).rgb; }
          @fragment fn fs(v:V)->@location(0) vec4f {
            var rgb=sample(v.uv);
            let px=params.pixel.xy;
            if(params.adjust.z>0) {
              let neighbors=sample(v.uv+vec2f(px.x,0))+sample(v.uv-vec2f(px.x,0))
                +sample(v.uv+vec2f(0,px.y))+sample(v.uv-vec2f(0,px.y));
              rgb=rgb*(1+4*params.adjust.z)-neighbors*params.adjust.z;
            } else if(params.adjust.w>0) {
              let r=px*params.adjust.w;
              rgb=rgb*0.2+0.1*(sample(v.uv+vec2f(r.x,0))+sample(v.uv-vec2f(r.x,0))
                +sample(v.uv+vec2f(0,r.y))+sample(v.uv-vec2f(0,r.y))
                +sample(v.uv+r)+sample(v.uv-r)+sample(v.uv+vec2f(r.x,-r.y))+sample(v.uv+vec2f(-r.x,r.y)));
            }
            rgb=(rgb*params.adjust.x-0.5)*params.adjust.y+0.5;
            rgb=vec3f(dot(params.color0.xyz,rgb),dot(params.color1.xyz,rgb),dot(params.color2.xyz,rgb));
            // rgba16float specifies storage precision, not a linear color space.
            // Both external import and this canvas use extended sRGB encoding.
            // Decoding again crushes shadows and exaggerates HDR highlights.
            return vec4f(rgb,1);
          }`;
        const module = device.createShaderModule({ code });
        const compilation = await module.getCompilationInfo();
        if (compilation.messages.some((m: any) => m.type === 'error')) throw new Error('HDR shader compilation failed.');
        const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] }, primitive: { topology: 'triangle-list' } });
        const fsr = await createHdrFsr(device);
        const supersampleResolve = await createHdrFsrResolve(device);
        const fsrModule = device.createShaderModule({ code: code.replace('var source: texture_external;', 'var source: texture_2d<f32>;')
          .replace('fn sample(uv:vec2f)->vec3f { return textureSampleBaseClampToEdge(source,bilinear,uv).rgb; }', hdrRcasSample) });
        const fsrInfo = await fsrModule.getCompilationInfo();
        if(fsrInfo.messages.some((m:any)=>m.type==='error'))throw new Error('FSR presentation shader compilation failed.');
        const fsrPipeline=device.createRenderPipeline({layout:'auto',vertex:{module:fsrModule,entryPoint:'vs'},fragment:{module:fsrModule,entryPoint:'fs',targets:[{format:'rgba16float'}]}});
        dispose = () => { supersampleResolve.dispose();fsr.dispose();context.unconfigure();device.destroy(); };
        const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        const uniform = device.createBuffer({ size: 96, usage: 0x40 | 0x08 });
        const parameters = new Float32Array(24);
        let colorSignature = '';
        device.lost.then(() => { if (!stopped) setError('HDR GPU device lost. Stop and restart capture.'); });
        draw = frame => {
          const videoRatio = frame.displayWidth / frame.displayHeight, outputRatio = canvas.width / canvas.height;
          const z = current.current.zoom / 100;
          parameters[0]=z*Math.min(1,videoRatio/outputRatio);parameters[1]=z*Math.min(1,outputRatio/videoRatio);
          const f=current.current.filters;
          const target=getFsrSize(frame.displayWidth,frame.displayHeight,canvas.width*Math.min(1,parameters[0]),canvas.height*Math.min(1,parameters[1]));
          const upscaleWidth=target.resolveWidth, upscaleHeight=target.resolveHeight;
          const upscale=!!f.upscaler&&target.width>frame.displayWidth&&target.height>frame.displayHeight;
          setData('upscaler',upscale?(target.supersampling?'supersampling':'fsr1'):'bypass');
          setData('fsrInternalSize',upscale?`${target.width}x${target.height}`:`${frame.displayWidth}x${frame.displayHeight}`);
          parameters[4]=f.brightness??1;parameters[5]=f.contrast??1;parameters[6]=f.sharpen??0;parameters[7]=f.blurPx??0;
          parameters[8]=1/frame.displayWidth;parameters[9]=1/frame.displayHeight;
          parameters[10]=(f.upscaleSharpness??0)>0?Math.pow(2,-2*(1-(f.upscaleSharpness??0))):0;
          if(upscale){parameters[8]=1/upscaleWidth;parameters[9]=1/upscaleHeight;}
          const signature=`${f.saturation??1}:${f.hueDeg??0}`;
          if(signature!==colorSignature) {
            const matrix=getVideoColorMatrix(f.saturation??1,f.hueDeg??0);
            for(let row=0;row<3;row++)parameters.set(matrix.slice(row*3,row*3+3),12+row*4);
            colorSignature=signature;
          }
          device.queue.writeBuffer(uniform, 0, parameters);
          const encoder = device.createCommandEncoder();
          const external=device.importExternalTexture({source:frame,colorSpace:'srgb'});
          const activePipeline=upscale?fsrPipeline:pipeline;
          let source=external;
          if(upscale) {
            let scaled=fsr.render(encoder,external,frame.displayWidth,frame.displayHeight,target.width,target.height);
            if(target.supersampling) scaled=supersampleResolve.render(encoder,scaled,upscaleWidth,upscaleHeight);
            source=scaled.createView();
          }
          const bind=device.createBindGroup({layout:activePipeline.getBindGroupLayout(0),entries:[
            {binding:0,resource:source},...(!upscale?[{binding:1,resource:sampler}]:[]),{binding:2,resource:{buffer:uniform}}
          ]});
          const output = context.getCurrentTexture();
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
          pass.setPipeline(activePipeline); pass.setBindGroup(0, bind); pass.draw(6); pass.end();
          // Explicit one-shot diagnostic, never part of the normal frame loop.
          let probe: any;
          if (canvas.dataset.hdrProbe === 'pending') {
            canvas.dataset.hdrProbe = 'reading'; probe = device.createBuffer({ size: 2048, usage: 9 });
            for (let i = 0; i < 8; i++) encoder.copyTextureToBuffer({ texture: output, origin: [Math.floor(canvas.width * (i + 0.5) / 8), Math.floor(canvas.height / 2)] }, { buffer: probe, offset: i * 256, bytesPerRow: 256 }, [1, 1]);
          }
          device.queue.submit([encoder.finish()]);
          if (probe) void probe.mapAsync(1).then(() => {
            const half = (v: number) => { const e = (v >> 10) & 31, f = v & 1023; return (v & 32768 ? -1 : 1) * (e ? Math.pow(2, e - 15) * (1 + f / 1024) : Math.pow(2, -14) * f / 1024); };
            const values = new Uint16Array(probe.getMappedRange());
            canvas.dataset.hdrProbe = JSON.stringify([0, 128, 256, 384, 512, 640, 768, 896].map(i => Array.from(values.slice(i, i + 4)).map(half)));
            probe.unmap(); probe.destroy();
          }).catch(() => { canvas.dataset.hdrProbe = 'failed'; probe.destroy(); });
        };
      } else {
        const gl = createGlVideoPipeline(canvas);
        draw = frame => gl.render(frame, current.current.filters, current.current.zoom / 100);
        dispose = () => gl.dispose();
      }
      if (stopped) { dispose(); return; }
      let count = 0, totalFrames = 0, start = performance.now(), signature = '';
      const present = (frame: VideoFrame) => {
        if (stopped) return;
        try {
          const dpr = window.devicePixelRatio || 1;
          const width = Math.max(1, Math.min(4096, Math.round(cssWidth * dpr)));
          const height = Math.max(1, Math.min(2160, Math.round(cssHeight * dpr)));
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          draw(frame); ++count;
          canvas.dataset.nativeFrames = String(++totalFrames);
          window.dispatchEvent(new CustomEvent('captureplayer:frame-delivered', { detail: { timestamp: frame.timestamp } }));
          setData('sourceWidth',String(frame.displayWidth)); setData('sourceHeight',String(frame.displayHeight));
          setData('frameFormat',frame.format || 'unknown'); setData('transfer',frame.colorSpace.transfer || 'unknown');
          const next = `${frame.displayWidth}:${frame.displayHeight}`; const now = performance.now();
          if (signature !== next || now - start >= 1000) {
            current.current.onResolution?.({ w: frame.displayWidth, h: frame.displayHeight, fps: now - start >= 1000 ? Math.round(count * 10000 / (now - start)) / 10 : undefined });
            signature = next; count = 0; start = now;
          }
        } catch (e) { setError(String(e)); unsubscribe(); }
      };
      if (compatibilityTrack) {
        setData('captureTransport', 'compatibility');
        const processor = new MediaStreamTrackProcessor({ track: compatibilityTrack, maxBufferSize: 1 });
        const reader = processor.readable.getReader();
        let cancelled = false;
        unsubscribe = () => { cancelled = true; void reader.cancel().catch(() => {}); };
        void (async () => {
          try {
            while (!stopped && !cancelled) {
              const { value, done } = await reader.read();
              if (done) break;
              try { if (!stopped && !cancelled) present(value); } finally { value.close(); }
            }
          } catch (e) { if (!stopped && !cancelled) setError(String(e)); }
          finally { reader.releaseLock(); }
        })();
      } else {
        setData('captureTransport', 'shared-texture');
        unsubscribe = subscribeNativeFrames(present);
      }
    };
    void initialize().catch(e => { if (!stopped) { setError(String(e)); dispose(); } });
    return () => { stopped = true; resize.disconnect(); unsubscribe(); dispose(); };
  }, [hdr, compatibilityTrack]);
  return <><canvas key={String(hdr)} ref={ref} data-native-renderer={hdr ? 'hdr' : 'sdr'} className="w-full h-full" />
    {error && <div role="alert" className="absolute inset-0 flex items-center justify-center bg-black text-red-300 p-8">{error}</div>}</>;
}
