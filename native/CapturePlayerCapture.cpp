// Native P010 capture bridge. Pixels stay outside JavaScript; only shared GPU
// handles and telemetry cross the pipe. This executable has no UI or neural code.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>
#include <d3d11_1.h>
#include <d3d11_4.h>
#include <avrt.h>
#include <d3dcompiler.h>
#include <dxgi1_6.h>
#include <wrl/client.h>
#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <array>
#include <chrono>
#include <sstream>
#include <iomanip>
#include <vector>
#include <cmath>
#include <algorithm>
#include <memory>
#include <mutex>
#include <condition_variable>
using Microsoft::WRL::ComPtr;
static void check(HRESULT h, const char* step) {
  if (FAILED(h)) { std::ostringstream s; s << step << " (0x" << std::hex << unsigned(h) << ")"; throw std::runtime_error(s.str()); }
}
static std::string utf8(const wchar_t* s) {
  int n=WideCharToMultiByte(CP_UTF8,0,s,-1,nullptr,0,nullptr,nullptr);
  std::string r(n,0); WideCharToMultiByte(CP_UTF8,0,s,-1,r.data(),n,nullptr,nullptr); r.pop_back(); return r;
}
static std::string json(const std::string& s) {
  std::string r="\""; for(unsigned char c:s) { if(c=='"'||c=='\\')r+='\\'; if(c>=32)r+=c; } return r+'"';
}
static UINT32 attr(IMFAttributes* a, REFGUID id) { UINT32 v=0; a->GetUINT32(id,&v); return v; }
struct Slot { ComPtr<ID3D11Texture2D> texture; ComPtr<ID3D11RenderTargetView> target; HANDLE local=nullptr, remote=nullptr; std::atomic<bool> free{true}; };
struct Timing {
  std::vector<double> values;
  void add(double value) { if(values.size()<512)values.push_back(value); }
  std::string report() {
    if(values.empty())return "{}";
    std::sort(values.begin(),values.end());double sum=0;for(auto value:values)sum+=value;
    std::ostringstream out;out<<"{\"mean\":"<<sum/values.size()<<",\"p95\":"<<values[size_t(values.size()*.95)]<<",\"max\":"<<values.back()<<"}";
    values.clear();return out.str();
  }
};
// Continuously drain capture independently of GPU/presentation. Only the newest
// unread sample survives a slow render; older pictures must never form a FIFO.
struct LatestCapture {
  std::mutex mutex;std::condition_variable changed;ComPtr<IMFSample> sample;
  LONGLONG timestamp=0;HRESULT error=S_OK;DWORD flags=0;unsigned replaced=0;
  std::atomic<bool> quit{false};
};
static void readLatest(ComPtr<IMFSourceReader> reader,std::shared_ptr<LatestCapture> latest) {
  HRESULT initialized=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
  DWORD task=0;HANDLE mmcss=AvSetMmThreadCharacteristicsW(L"Capture",&task);
  while(!latest->quit) {
    ComPtr<IMFSample> sample;LONGLONG timestamp=0;DWORD flags=0;
    HRESULT result=reader->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM,0,nullptr,&flags,&timestamp,&sample);
    {
      std::lock_guard<std::mutex> lock(latest->mutex);
      latest->error=result;latest->flags=flags;
      if(sample){if(latest->sample)++latest->replaced;latest->sample=sample;latest->timestamp=timestamp;}
    }
    latest->changed.notify_one();
    if(FAILED(result)||(flags&(MF_SOURCE_READERF_ERROR|MF_SOURCE_READERF_ENDOFSTREAM|MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED)))break;
  }
  if(mmcss)AvRevertMmThreadCharacteristics(mmcss);
  if(SUCCEEDED(initialized))CoUninitialize();
}
int main(int argc,char** argv) {
  try {
    // Electron owns the duplicated NT handles. Its cleanup call happens only
    // after this producer exits and Chromium releases every imported frame.
    if(argc==4 && std::string(argv[1])=="--close-handles") {
      const DWORD owner=std::stoul(argv[2]);
      HANDLE process=OpenProcess(PROCESS_DUP_HANDLE,FALSE,owner);
      if(!process)return GetLastError()==ERROR_INVALID_PARAMETER?0:1;
      std::istringstream list(argv[3]);std::string value;bool ok=true;
      while(std::getline(list,value,',')) {
        HANDLE local=nullptr;
        if(!DuplicateHandle(process,reinterpret_cast<HANDLE>(std::stoull(value)),GetCurrentProcess(),&local,0,FALSE,DUPLICATE_SAME_ACCESS|DUPLICATE_CLOSE_SOURCE))ok=false;
        if(local)CloseHandle(local);
      }
      CloseHandle(process);return ok?0:1;
    }
    if(argc>1 && std::string(argv[1])=="--displays") {
      ComPtr<IDXGIFactory1> factory;check(CreateDXGIFactory1(IID_PPV_ARGS(&factory)),"DXGI factory");
      for(UINT i=0;;i++){ComPtr<IDXGIAdapter1> adapter;if(factory->EnumAdapters1(i,&adapter)==DXGI_ERROR_NOT_FOUND)break;
        for(UINT j=0;;j++){ComPtr<IDXGIOutput> output;if(adapter->EnumOutputs(j,&output)==DXGI_ERROR_NOT_FOUND)break;
          ComPtr<IDXGIOutput6> output6;if(FAILED(output.As(&output6)))continue;DXGI_OUTPUT_DESC1 d={};check(output6->GetDesc1(&d),"output description");
          std::cout<<"{\"display\":"<<json(utf8(d.DeviceName))<<",\"colorSpace\":"<<d.ColorSpace<<",\"bits\":"<<d.BitsPerColor<<",\"maxNits\":"<<d.MaxLuminance<<"}"<<std::endl;
        }
      }return 0;
    }
    check(CoInitializeEx(nullptr,COINIT_MULTITHREADED),"COM"); check(MFStartup(MF_VERSION),"MFStartup");
    bool probe=false,hdr=false,synthetic=false; DWORD pid=0; UINT wantedW=2560,wantedH=1440,wantedFps=60; std::string wanted="Elgato 4K X";
    for(int i=1;i<argc;i++) {
      std::string arg=argv[i]; if(arg=="--probe")probe=true; else if(arg=="--color-test")synthetic=true;
      else if(i+1<argc) { std::string v=argv[++i]; if(arg=="--pid")pid=std::stoul(v); else if(arg=="--device")wanted=v;else if(arg=="--hdr")hdr=v=="1";
        else if(arg=="--width")wantedW=std::stoul(v); else if(arg=="--height")wantedH=std::stoul(v); else if(arg=="--fps")wantedFps=std::stoul(v); }
    }
    ComPtr<IMFMediaSource> source; ComPtr<IMFSourceReader> reader;
    UINT32 w=256,h=64,n=60,d=1; LONG stride=w*2;
    UINT transfer=0,primaries=0,range=0; std::string selectedName="Synthetic HDR test";
    if(!synthetic) {
    ComPtr<IMFAttributes> attributes; check(MFCreateAttributes(&attributes,2),"attributes");
    check(attributes->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID),"device type");
    IMFActivate** devices=nullptr; UINT32 count=0; check(MFEnumDeviceSources(attributes.Get(),&devices,&count),"devices");
    ComPtr<IMFActivate> selected;
    for(UINT32 i=0;i<count;i++) {
      wchar_t* name=nullptr; UINT32 length=0; devices[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,&name,&length);
      std::string label=name?utf8(name):""; CoTaskMemFree(name);
      if(probe)std::cout << "{\"device\":" << json(label) << "}" << std::endl;
      if(!selected && (label==wanted || label.find(wanted)!=std::string::npos)){ selected=devices[i];selectedName=label; }
      devices[i]->Release();
    } CoTaskMemFree(devices);
    if(!selected)throw std::runtime_error("Selected native capture device not found");
    check(selected->ActivateObject(IID_PPV_ARGS(&source)),"open camera");
    ComPtr<IMFAttributes> options; check(MFCreateAttributes(&options,3),"reader options");
    options->SetUINT32(MF_LOW_LATENCY,TRUE); options->SetUINT32(MF_READWRITE_DISABLE_CONVERTERS,TRUE);
    check(MFCreateSourceReaderFromMediaSource(source.Get(),options.Get(),&reader),"source reader");
    ComPtr<IMFMediaType> chosen;
    for(DWORD i=0;;i++) {
      ComPtr<IMFMediaType> type; HRESULT h=reader->GetNativeMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,i,&type);
      if(h==MF_E_NO_MORE_TYPES)break; check(h,"native type");
      GUID subtype={};type->GetGUID(MF_MT_SUBTYPE,&subtype); UINT32 w=0,ht=0,n=0,d=1;
      MFGetAttributeSize(type.Get(),MF_MT_FRAME_SIZE,&w,&ht); MFGetAttributeRatio(type.Get(),MF_MT_FRAME_RATE,&n,&d);
      if(subtype==MFVideoFormat_P010) {
        if(probe)std::cout << "{\"format\":\"P010\",\"width\":"<<w<<",\"height\":"<<ht<<",\"fps\":"<<double(n)/d<<",\"transfer\":"<<attr(type.Get(),MF_MT_TRANSFER_FUNCTION)<<",\"primaries\":"<<attr(type.Get(),MF_MT_VIDEO_PRIMARIES)<<"}"<<std::endl;
        if(w==wantedW && ht==wantedH && std::abs(double(n)/d-wantedFps)<1 && !chosen)chosen=type;
      }
    }
    if(probe){source->Shutdown();return 0;}
    if(!chosen)throw std::runtime_error("Requested P010 mode unavailable. Try 2560x1440 at 60 FPS with USB 10 Gbps.");
    check(reader->SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS,FALSE),"deselect streams");
    check(reader->SetStreamSelection(MF_SOURCE_READER_FIRST_VIDEO_STREAM,TRUE),"select video stream");
    ComPtr<IMFSourceReaderEx> extended;
    if(SUCCEEDED(reader.As(&extended))) { DWORD flags=0;check(extended->SetNativeMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,chosen.Get(),&flags),"native P010 type"); }
    check(reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,nullptr,chosen.Get()),"select P010");
    ComPtr<IMFMediaType> actual; check(reader->GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,&actual),"actual type");
    GUID subtype={};actual->GetGUID(MF_MT_SUBTYPE,&subtype);if(subtype!=MFVideoFormat_P010)throw std::runtime_error("Capture did not retain P010");
    MFGetAttributeSize(actual.Get(),MF_MT_FRAME_SIZE,&w,&h);MFGetAttributeRatio(actual.Get(),MF_MT_FRAME_RATE,&n,&d);
    stride=static_cast<LONG>(attr(actual.Get(),MF_MT_DEFAULT_STRIDE));if(!stride)stride=w*2;
    if(stride<LONG(w*2))throw std::runtime_error("Unsupported P010 stride");
    transfer=attr(actual.Get(),MF_MT_TRANSFER_FUNCTION), primaries=attr(actual.Get(),MF_MT_VIDEO_PRIMARIES),range=attr(actual.Get(),MF_MT_VIDEO_NOMINAL_RANGE);
    }
    std::cout << "{\"ready\":true,\"device\":"<<json(selectedName)<<",\"width\":"<<w<<",\"height\":"<<h<<",\"fps\":"<<double(n)/d<<",\"transfer\":"<<transfer<<",\"primaries\":"<<primaries<<",\"range\":"<<range<<"}"<<std::endl;
    HANDLE parent=OpenProcess(PROCESS_DUP_HANDLE|SYNCHRONIZE,FALSE,pid);if(!parent)throw std::runtime_error("Cannot open Electron process");
    ComPtr<ID3D11Device> gpu;ComPtr<ID3D11DeviceContext> context; D3D_FEATURE_LEVEL level;
    check(D3D11CreateDevice(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,&gpu,&level,&context),"D3D11");
    // Convert P010 to half-float RGB on the GPU. Decode PQ explicitly: the
    // imported FP16 texture path must not be relied on to decode PQ metadata.
    const char* shader=R"(
      Texture2D<float> Y:register(t0);Texture2D<float2> UV:register(t1);
      struct V { float4 pos:SV_POSITION; };
      V vs(uint id:SV_VertexID){V o;o.pos=float4(id==2?3:-1,id==1?3:-1,0,1);return o;}
      float4 ps(V i):SV_TARGET {
        int2 p=int2(i.pos.xy);float y=(Y.Load(int3(p,0))*65535.0/64.0-64.0)/876.0;
        float2 uv=(UV.Load(int3(p/2,0))*65535.0/64.0-512.0)/896.0;
        #ifdef HDR
        float3 rgb=float3(y+1.4746*uv.y,y-0.164553*uv.x-0.571353*uv.y,y+1.8814*uv.x);
        #else
        float3 rgb=float3(y+1.5748*uv.y,y-0.187324*uv.x-0.468124*uv.y,y+1.8556*uv.x);
        #endif
        #ifdef HDR
        float3 pqp=pow(max(rgb,0),1.0/78.84375);
        float3 linearRgb=pow(max(pqp-0.8359375,0)/max(18.8515625-18.6875*pqp,0.000001),1.0/0.1593017578125)*(10000.0/203.0);
        rgb=mul(float3x3(1.660491,-0.587641,-0.072850,-0.124550,1.132900,-0.008349,-0.018151,-0.100579,1.118730),linearRgb);
        #endif
        return float4(rgb,1);
      })";
    ComPtr<ID3DBlob> vsCode,psCode,error; D3D_SHADER_MACRO macros[]={{hdr?"HDR":"SDR","1"},{nullptr,nullptr}};
    check(D3DCompile(shader,strlen(shader),nullptr,macros,nullptr,"vs","vs_5_0",D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&vsCode,&error),"vertex shader");
    check(D3DCompile(shader,strlen(shader),nullptr,macros,nullptr,"ps","ps_5_0",D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&psCode,&error),"color shader");
    ComPtr<ID3D11VertexShader> vs;ComPtr<ID3D11PixelShader> ps;
    check(gpu->CreateVertexShader(vsCode->GetBufferPointer(),vsCode->GetBufferSize(),nullptr,&vs),"vertex program");
    check(gpu->CreatePixelShader(psCode->GetBufferPointer(),psCode->GetBufferSize(),nullptr,&ps),"color program");
    D3D11_TEXTURE2D_DESC inputDesc={};inputDesc.Width=w;inputDesc.Height=h;inputDesc.MipLevels=1;inputDesc.ArraySize=1;inputDesc.Format=DXGI_FORMAT_P010;
    inputDesc.SampleDesc.Count=1;inputDesc.BindFlags=D3D11_BIND_SHADER_RESOURCE;
    inputDesc.Usage=D3D11_USAGE_DYNAMIC;inputDesc.CPUAccessFlags=D3D11_CPU_ACCESS_WRITE;
    ComPtr<ID3D11Texture2D> inputTexture;bool dynamicUpload=true;
    if(FAILED(gpu->CreateTexture2D(&inputDesc,nullptr,&inputTexture))) {
      dynamicUpload=false;inputDesc.Usage=D3D11_USAGE_DEFAULT;inputDesc.CPUAccessFlags=0;
      check(gpu->CreateTexture2D(&inputDesc,nullptr,&inputTexture),"P010 upload texture");
    }
    const auto upload=[&](const void* data,UINT sourcePitch) {
      if(!dynamicUpload){context->UpdateSubresource(inputTexture.Get(),0,nullptr,data,sourcePitch,0);return;}
      D3D11_MAPPED_SUBRESOURCE mapped={};check(context->Map(inputTexture.Get(),0,D3D11_MAP_WRITE_DISCARD,0,&mapped),"map P010 upload");
      if(mapped.RowPitch==sourcePitch)memcpy(mapped.pData,data,size_t(sourcePitch)*h*3/2);
      else for(UINT row=0;row<h*3/2;row++)memcpy(static_cast<BYTE*>(mapped.pData)+size_t(row)*mapped.RowPitch,static_cast<const BYTE*>(data)+size_t(row)*sourcePitch,w*2);
      context->Unmap(inputTexture.Get(),0);
    };
    D3D11_SHADER_RESOURCE_VIEW_DESC view={};view.ViewDimension=D3D11_SRV_DIMENSION_TEXTURE2D;view.Texture2D.MipLevels=1;
    ComPtr<ID3D11ShaderResourceView> yView,uvView;view.Format=DXGI_FORMAT_R16_UNORM;check(gpu->CreateShaderResourceView(inputTexture.Get(),&view,&yView),"Y plane");
    view.Format=DXGI_FORMAT_R16G16_UNORM;check(gpu->CreateShaderResourceView(inputTexture.Get(),&view,&uvView),"UV plane");
    ID3D11ShaderResourceView* views[]={yView.Get(),uvView.Get()};context->PSSetShaderResources(0,2,views);
    context->VSSetShader(vs.Get(),nullptr,0);context->PSSetShader(ps.Get(),nullptr,0);context->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    D3D11_VIEWPORT viewport={0,0,float(w),float(h),0,1};context->RSSetViewports(1,&viewport);
    D3D11_QUERY_DESC queryDesc={D3D11_QUERY_EVENT,0};ComPtr<ID3D11Query> finished;check(gpu->CreateQuery(&queryDesc,&finished),"GPU completion query");
    // Sleep until the GPU finishes instead of repeatedly polling/flushing its
    // command queue. Older D3D11 drivers retain the query fallback.
    ComPtr<ID3D11Device5> gpu5;ComPtr<ID3D11DeviceContext4> context4;ComPtr<ID3D11Fence> fence;
    HANDLE completion=nullptr;UINT64 fenceValue=0;
    if(SUCCEEDED(gpu.As(&gpu5))&&SUCCEEDED(context.As(&context4))&&
      SUCCEEDED(gpu5->CreateFence(0,D3D11_FENCE_FLAG_NONE,IID_PPV_ARGS(&fence)))) {
      completion=CreateEventW(nullptr,FALSE,FALSE,nullptr);if(!completion)fence.Reset();
    }
    auto sharedSlots=std::make_shared<std::array<Slot,3>>();auto& slots=*sharedSlots;
    for(auto& slot:slots) {
      D3D11_TEXTURE2D_DESC desc={};desc.Width=w;desc.Height=h;desc.MipLevels=1;desc.ArraySize=1;desc.Format=DXGI_FORMAT_R16G16B16A16_FLOAT;
      desc.SampleDesc.Count=1;desc.Usage=D3D11_USAGE_DEFAULT;desc.BindFlags=D3D11_BIND_SHADER_RESOURCE|D3D11_BIND_RENDER_TARGET;desc.MiscFlags=D3D11_RESOURCE_MISC_SHARED_NTHANDLE|D3D11_RESOURCE_MISC_SHARED;
      check(gpu->CreateTexture2D(&desc,nullptr,&slot.texture),"FP16 texture");check(gpu->CreateRenderTargetView(slot.texture.Get(),nullptr,&slot.target),"RGB output");
      ComPtr<IDXGIResource1> resource;check(slot.texture.As(&resource),"shared resource");
      check(resource->CreateSharedHandle(nullptr,DXGI_SHARED_RESOURCE_READ|DXGI_SHARED_RESOURCE_WRITE,nullptr,&slot.local),"shared handle");
      if(!DuplicateHandle(GetCurrentProcess(),slot.local,parent,&slot.remote,0,FALSE,DUPLICATE_SAME_ACCESS))throw std::runtime_error("Duplicate GPU handle failed");
      std::cout<<"{\"handleAllocated\":\""<<reinterpret_cast<uintptr_t>(slot.remote)<<"\"}"<<std::endl;
    }
    auto latest=std::make_shared<LatestCapture>();
    std::thread input([latest,sharedSlots]{std::string line;while(std::getline(std::cin,line)){if(line=="quit")break;int id=-1;std::istringstream in(line);std::string op;in>>op>>id;if(op=="release"&&id>=0&&id<3)(*sharedSlots)[id].free=true;}latest->quit=true;latest->changed.notify_one();});
    input.detach(); // process owns stdin; parent exit/pipe closure also bounds lifetime
    // Explicit test mode never opens the capture device or shows a window.
    // Known PQ / BT.2020 patches go through the same P010 upload and shader.
    std::vector<unsigned short> testPixels;
    if(synthetic) {
      testPixels.resize(w*h*3/2);
      const double patches[8][3]={{10,10,10},{80,80,80},{203,203,203},{1000,1000,1000},{4000,4000,4000},{203,0,0},{0,203,0},{0,0,203}};
      const auto pq=[](double nits){double v=std::pow(nits/10000.0,0.1593017578125);return std::pow((0.8359375+18.8515625*v)/(1+18.6875*v),78.84375);};
      for(UINT y=0;y<h;y++) for(UINT x=0;x<w;x++) {
        const auto& c=patches[x*8/w];double r=pq(c[0]),g=pq(c[1]),b=pq(c[2]);
        double l=0.2627*r+0.6780*g+0.0593*b;
        testPixels[y*w+x]=static_cast<unsigned short>(std::round(64+876*l))*64;
        if(!(y%2)&&!(x%2)) {
          testPixels[w*h+(y/2)*w+x]=static_cast<unsigned short>(std::round(512+896*(b-l)/1.8814))*64;
          testPixels[w*h+(y/2)*w+x+1]=static_cast<unsigned short>(std::round(512+896*(r-l)/1.4746))*64;
        }
      }
    }
    auto start=std::chrono::steady_clock::now();unsigned frames=0,dropped=0;
    Timing reads,gpuTimes,intervals,uploads,waits,sampleAges;auto previous=start;
    std::string bufferAccess="synthetic";
    if(!synthetic)std::thread(readLatest,reader,latest).detach();
    while(!latest->quit && WaitForSingleObject(parent,0)==WAIT_TIMEOUT) {
      const auto readStart=std::chrono::steady_clock::now();
      DWORD flags=0;LONGLONG timestamp=0;ComPtr<IMFSample> sample;
      if(!synthetic) {
        std::unique_lock<std::mutex> lock(latest->mutex);
        latest->changed.wait_for(lock,std::chrono::milliseconds(50),[&]{return latest->sample||FAILED(latest->error)||latest->flags||latest->quit;});
        check(latest->error,"read frame");flags=latest->flags;timestamp=latest->timestamp;
        sample=std::move(latest->sample);dropped+=latest->replaced;latest->replaced=0;
      }
      if(flags&(MF_SOURCE_READERF_ERROR|MF_SOURCE_READERF_ENDOFSTREAM|MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED))throw std::runtime_error("Capture signal changed; restart native preview");
      if(!sample&&!synthetic)continue;
      const auto captured=std::chrono::steady_clock::now();
      reads.add(std::chrono::duration<double,std::milli>(captured-readStart).count());
      intervals.add(std::chrono::duration<double,std::milli>(captured-previous).count());previous=captured;
      int id=-1;for(int i=0;i<3;i++){bool expected=true;if(slots[i].free.compare_exchange_strong(expected,false)){id=i;break;}}
      if(id<0){++dropped;continue;}auto& slot=slots[id];
      if(synthetic) { upload(testPixels.data(),stride); Sleep(16); } else {
      ComPtr<IMFMediaBuffer> buffer;DWORD bufferCount=0;check(sample->GetBufferCount(&bufferCount),"P010 buffer count");
      if(bufferCount==1)check(sample->GetBufferByIndex(0,&buffer),"P010 buffer");
      else check(sample->ConvertToContiguousBuffer(&buffer),"P010 contiguous buffer");
      ComPtr<IMF2DBuffer2> planar;BYTE* bytes=nullptr;BYTE* allocation=nullptr;DWORD length=0;LONG pitch=0;
      // A generic read/write Lock may flatten a 2D surface into a temporary
      // buffer and copy it back. Read-only 2D access keeps the driver's pitch
      // and avoids that round trip; validate the complete P010 plane extent.
      if(SUCCEEDED(buffer.As(&planar))&&SUCCEEDED(planar->Lock2DSize(MF2DBuffer_LockFlags_Read,&bytes,&pitch,&allocation,&length))) {
        bufferAccess="read-only-2d";
        const auto offset=reinterpret_cast<uintptr_t>(bytes)-reinterpret_cast<uintptr_t>(allocation);
        if(pitch<LONG(w*2)||offset>length||size_t(pitch)*h*3/2>length-offset) {
          planar->Unlock2D();throw std::runtime_error("Invalid P010 plane bounds");
        }
        try{upload(bytes,pitch);}catch(...){planar->Unlock2D();throw;}planar->Unlock2D();
      } else {
        bufferAccess="contiguous";
        check(buffer->Lock(&bytes,nullptr,&length),"lock P010");
        if(length<size_t(stride)*h*3/2){buffer->Unlock();throw std::runtime_error("Truncated P010 sample");}
        try{upload(bytes,stride);}catch(...){buffer->Unlock();throw;}buffer->Unlock();
      }
      }
      const auto uploaded=std::chrono::steady_clock::now();
      uploads.add(std::chrono::duration<double,std::milli>(uploaded-captured).count());
      ID3D11RenderTargetView* target=slot.target.Get();context->OMSetRenderTargets(1,&target,nullptr);context->Draw(3,0);
      if(fence) {
        check(context4->Signal(fence.Get(),++fenceValue),"signal GPU completion");
        check(fence->SetEventOnCompletion(fenceValue,completion),"GPU completion event");context->Flush();
        if(WaitForSingleObject(completion,1000)!=WAIT_OBJECT_0)throw std::runtime_error("GPU completion timed out");
      } else {
        context->End(finished.Get());context->Flush();auto waitStart=std::chrono::steady_clock::now();
        HRESULT ready=S_FALSE;
        while((ready=context->GetData(finished.Get(),nullptr,0,D3D11_ASYNC_GETDATA_DONOTFLUSH))==S_FALSE){
          if(std::chrono::steady_clock::now()-waitStart>std::chrono::seconds(1))throw std::runtime_error("GPU completion timed out");
          SwitchToThread();
        }
        check(ready,"GPU completion");
      }
      waits.add(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-uploaded).count());
      gpuTimes.add(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-captured).count());
      if(!synthetic)sampleAges.add(double(MFGetSystemTime()-timestamp)/10000.0);
      std::cout<<"{\"frame\":"<<id<<",\"handle\":\""<<reinterpret_cast<uintptr_t>(slot.remote)<<"\",\"timestamp\":"<<timestamp/10<<"}"<<std::endl;
      ++frames;auto now=std::chrono::steady_clock::now();double seconds=std::chrono::duration<double>(now-start).count();
      if(seconds>=2){std::cout<<"{\"stats\":true,\"fps\":"<<frames/seconds<<",\"dropped\":"<<dropped<<",\"timing\":{\"read\":"<<reads.report()<<",\"gpu\":"<<gpuTimes.report()<<",\"arrival\":"<<intervals.report()<<",\"upload\":"<<uploads.report()<<",\"wait\":"<<waits.report()<<",\"sampleAge\":"<<sampleAges.report()<<",\"fence\":"<<(fence?"true":"false")<<",\"dynamicUpload\":"<<(dynamicUpload?"true":"false")<<",\"bufferAccess\":"<<json(bufferAccess)<<"}}"<<std::endl;start=now;frames=0;dropped=0;}
    }
    latest->quit=true;
    if(source)source->Shutdown();
    if(completion)CloseHandle(completion);
    // Exit immediately: the stdin thread must not access destroyed stack state.
    ExitProcess(0);
  }catch(const std::exception& e){std::cout<<"{\"error\":"<<json(e.what())<<"}"<<std::endl;ExitProcess(1);}
}
