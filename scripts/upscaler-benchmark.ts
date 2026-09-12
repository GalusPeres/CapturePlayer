import { createGlVideoPipeline, type GlFilterState } from '../src/components/glVideoPipeline';
import { createGlVideoPipeline as baseline } from '../.local/gl-baseline';

const neutral: GlFilterState = { brightness: 1, contrast: 1, saturation: 1, hueDeg: 0, blurPx: 0, sharpen: 0, crisp: false };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a,b)=>a-b);
  return { samples: values.length, mean: values.reduce((a,b)=>a+b,0)/values.length, p95: sorted[Math.floor(sorted.length*.95)], max: sorted.at(-1) };
};
async function run() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const card = devices.find(d=>d.kind==='videoinput'&&d.label==='Elgato 4K X (0fd9:009b)');
  if (!card) throw new Error('Exact Elgato 4K X device not found');
  const results = [];
  for (const spec of [
    { name:'original-4k-canvas', source:2160, width:3840, height:2160, fsr:false, old:true },
    { name:'sized-1440p-canvas', source:2160, width:2560, height:1440, fsr:false, old:false },
    { name:'1080-to-1440-bilinear', source:1080, width:2560, height:1440, fsr:false, old:false },
    { name:'1080-to-1440-fsr1', source:1080, width:2560, height:1440, fsr:true, old:false },
    { name:'1080-to-4k-fsr1', source:1080, width:3840, height:2160, fsr:true, old:false }
  ]) {
    const canvas=document.createElement('canvas');canvas.width=spec.width;canvas.height=spec.height;
    canvas.style.cssText='width:100vw;height:100vh;object-fit:contain';document.body.replaceChildren(canvas);
    const pipeline=(spec.old?baseline:createGlVideoPipeline)(canvas);
    const gl=canvas.getContext('webgl2')!;
    const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    const gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unavailable';
    const stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:card.deviceId},width:{exact:spec.source*16/9},height:{exact:spec.source},frameRate:{exact:60}},audio:false});
    const track=stream.getVideoTracks()[0];
    const reader=new MediaStreamTrackProcessor({track,maxBufferSize:1}).readable.getReader();
    const cpu:number[]=[],gpuTimes:number[]=[],gaps:number[]=[];
    const queries:WebGLQuery[]=[];
    let previous=0;
    try {
      for(let frameNumber=0;frameNumber<480;frameNumber++){
        const {value:frame,done}=await reader.read();if(done||!frame)throw new Error('Video ended');
        const now=performance.now();if(previous&&frameNumber>120)gaps.push(now-previous);previous=now;
        if(ext){
          const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);
          while(queries.length&&gl.getQueryParameter(queries[0],gl.QUERY_RESULT_AVAILABLE)){
            const query=queries.shift()!;const ns=gl.getQueryParameter(query,gl.QUERY_RESULT);
            if(!disjoint&&frameNumber>120)gpuTimes.push(ns/1e6);gl.deleteQuery(query);
          }
        }
        const query=ext&&queries.length<8?gl.createQuery():null;
        if(query)gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
        const begin=performance.now();
        try {pipeline.render(frame,{...neutral,upscaler:spec.fsr,upscaleSharpness:.2},1)}finally{frame.close()}
        if(frameNumber>120)cpu.push(performance.now()-begin);
        if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push(query)}
      }
      const error=gl.getError();if(error)throw new Error(`GL error ${error}`);
      results.push({spec,gpu,source:track.getSettings(),desynchronized:pipeline.desynchronized,cpu:summarize(cpu),gpuMs:summarize(gpuTimes),gaps:summarize(gaps)});
      console.log('Measured',spec.name,results.at(-1));
    } finally {await reader.cancel();stream.getTracks().forEach(t=>t.stop());queries.forEach(q=>gl.deleteQuery(q));pipeline.dispose();canvas.remove()}
    await wait(300);
  }
  return results;
}
(window as any).benchmark=run();
