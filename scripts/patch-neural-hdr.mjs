// Called after the base patches. Keep the pinned upstream source untouched.
export function patchNeuralHdr(code) {
  const replace = (before, after) => {
    if (!code.includes(before)) throw Error(`HDR patch mismatch: ${before.slice(0, 80)}`);
    code = code.replace(before, after);
  };
  replace('#include <memory>', `#include <memory>
#include "NeuralCaptureColor.h"
#include "NeuralHdrComposite.h"
static float g_cp_capture_white = 1;
static bool CpPreserveHdr() {
    static const bool enabled = [] { char value[8] = {}; GetEnvironmentVariableA("CAPTUREPLAYER_NEURAL_HDR",value,sizeof(value)); return value[0]=='1'; }();
    return enabled;
}`);
  const start = code.indexOf('static const char kDdaSwizzleHlsl[] =');
  const end = code.indexOf('static bool EnsureDdaSwizzle()', start);
  if (start < 0 || end < 0) throw Error('Missing capture shader');
  code = code.slice(0, start) + code.slice(end);
  replace('D3DCompile(kDdaSwizzleHlsl, sizeof(kDdaSwizzleHlsl) - 1', 'D3DCompile(kCpCaptureColorHlsl, sizeof(kCpCaptureColorHlsl) - 1');
  const pipelineStart = code.indexOf('static bool EnsureDdaSwizzle()');
  const pipelineEnd = code.indexOf('static void BindDdaDescriptors', pipelineStart);
  let pipeline = code.slice(pipelineStart, pipelineEnd);
  if (!pipeline.includes('prm[2]') || !pipeline.includes('rsd.NumParameters = 2;')) throw Error('Missing capture root signature');
  pipeline = pipeline.replace('prm[2]', 'prm[3]').replace('rsd.NumParameters = 2;', `prm[2].ParameterType = D3D12_ROOT_PARAMETER_TYPE_32BIT_CONSTANTS;
    prm[2].Constants.ShaderRegister = 0; prm[2].Constants.Num32BitValues = 3;
    prm[2].ShaderVisibility = D3D12_SHADER_VISIBILITY_ALL;
    rsd.NumParameters = 3;`);
  code = code.slice(0, pipelineStart) + pipeline + code.slice(pipelineEnd);
  replace('sd.Format = DXGI_FORMAT_B8G8R8A8_UNORM; sd.ViewDimension', 'sd.Format = src->GetDesc().Format; sd.ViewDimension');
  replace('ns_wgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size', 'ns_wgdx::DirectXPixelFormat::R16G16B16A16Float, 2, size');
  replace('static bool SwizzleCaptureIntoColor(VideoState &v)\n{', `static bool SwizzleCaptureIntoColor(VideoState &v)
{
    static ULONGLONG colorUpdated = 0;
    static float whiteScale = 1;
    const ULONGLONG now = GetTickCount64();
    if (g_wgc_active && (colorUpdated == 0 || now - colorUpdated >= 1000)) {
        whiteScale = CpWindowSdrWhiteScale(g_wgc_hwnd); colorUpdated = now;
    }
    g_cp_capture_white = whiteScale;
    const float captureColor[3] = { g_dda_d12->GetDesc().Format == DXGI_FORMAT_R16G16B16A16_FLOAT ? 1.0f : 0.0f, whiteScale, CpPreserveHdr()?1.0f:0.0f };`);
  // Both the direct destination and fallback copy path use the same conversion.
  const swizzleStart = code.indexOf('static bool SwizzleCaptureIntoColor(VideoState &v)');
  const swizzleEnd = code.indexOf('static bool DdaGrab', swizzleStart);
  let swizzle = code.slice(swizzleStart, swizzleEnd);
  const marker = 'h.list->SetComputeRootSignature(g_dda_rs);';
  if (swizzle.split(marker).length !== 3) throw Error('Expected two capture shader dispatches');
  swizzle = swizzle.replaceAll(marker, marker + '\n    h.list->SetComputeRoot32BitConstants(2, 3, captureColor, 0);');
  code = code.slice(0, swizzleStart) + swizzle + code.slice(swizzleEnd);
  replace('Log("[wgc] capturing window %p, %dx%d", (void *)hwnd, size.Width, size.Height);',
    'Log("[wgc] FP16 linear capture, SDR white scale %.6f; window %p, %dx%d", CpWindowSdrWhiteScale(hwnd), (void *)hwnd, size.Width, size.Height);');
  replace('sd.Format      = DXGI_FORMAT_R8G8B8A8_UNORM;   // must match VideoState::output for CopyResource',
    'sd.Format      = CpPreserveHdr() ? DXGI_FORMAT_R16G16B16A16_FLOAT : DXGI_FORMAT_R8G8B8A8_UNORM;');
  replace('    if (CpWaitablePresent()) {\n        if (FAILED(g_present_swap->SetMaximumFrameLatency(1)))', `    if (CpPreserveHdr()) {
        UINT support = 0;
        const auto colorSpace = DXGI_COLOR_SPACE_RGB_FULL_G10_NONE_P709;
        if (FAILED(g_present_swap->CheckColorSpaceSupport(colorSpace,&support)) ||
            !(support & DXGI_SWAP_CHAIN_COLOR_SPACE_SUPPORT_FLAG_PRESENT) ||
            FAILED(g_present_swap->SetColorSpace1(colorSpace))) {
            Log("[present] FP16 HDR output unavailable"); ClosePresent(); return false;
        }
        Log("[present] FP16 scRGB HDR output enabled (SDR neural differences over HDR base)");
    }
    if (CpWaitablePresent()) {
        if (FAILED(g_present_swap->SetMaximumFrameLatency(1)))`);
  replace('static bool PresentFrame(VideoState &v)\n{', `static bool CpPresentHdr(VideoState &v, bool bypass);
static bool PresentFrame(VideoState &v)
{
    if (CpPreserveHdr()) return CpPresentHdr(v,false);`);
  replace('static bool PresentBypass(VideoState &v)\n{', `static bool PresentBypass(VideoState &v)
{
    if (CpPreserveHdr()) return CpPresentHdr(v,true);`);
  replace('static bool DdaGrab(VideoState &v)', `static bool CpPresentHdr(VideoState &v, bool bypass) {
    static CpHdrComposite composite;
    if (!g_dda_d12 || g_dda_d12->GetDesc().Format != DXGI_FORMAT_R16G16B16A16_FLOAT ||
        !composite.Initialize(h.dev,g_present_w,g_present_h)) return false;
    ID3D12Resource* bb = nullptr;
    if (FAILED(g_present_swap->GetBuffer(g_present_swap->GetCurrentBackBufferIndex(),IID_PPV_ARGS(&bb)))) return false;
    bool ok = false;
    if (BeginCommands()) {
        D3D12_RESOURCE_BARRIER pre[] = {
            Transition(g_dda_d12,D3D12_RESOURCE_STATE_COMMON,D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE),
            Transition(v.output,D3D12_RESOURCE_STATE_UNORDERED_ACCESS,D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE),
            Transition(bb,D3D12_RESOURCE_STATE_PRESENT,D3D12_RESOURCE_STATE_COPY_DEST)
        };
        h.list->ResourceBarrier(3,pre);
        auto* hdr = composite.Render(h.dev,h.list,g_dda_d12,v.color.tex,v.output,g_cp_capture_white,bypass);
        auto toCopy = Transition(hdr,D3D12_RESOURCE_STATE_UNORDERED_ACCESS,D3D12_RESOURCE_STATE_COPY_SOURCE);
        h.list->ResourceBarrier(1,&toCopy);h.list->CopyResource(bb,hdr);
        D3D12_RESOURCE_BARRIER post[] = {
            Transition(g_dda_d12,D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE,D3D12_RESOURCE_STATE_COMMON),
            Transition(v.output,D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE,D3D12_RESOURCE_STATE_UNORDERED_ACCESS),
            Transition(bb,D3D12_RESOURCE_STATE_COPY_DEST,D3D12_RESOURCE_STATE_PRESENT),
            Transition(hdr,D3D12_RESOURCE_STATE_COPY_SOURCE,D3D12_RESOURCE_STATE_UNORDERED_ACCESS)
        };
        h.list->ResourceBarrier(4,post);
        if (WaitFenceValue(h.fence,EndCommands(),2000)) {
            ok = SUCCEEDED(g_present_swap->Present(0,0));
            if(ok) { CpRecordPresent(); RevealOnFirstPresent(); }
        }
    }
    bb->Release();return ok;
}
static bool DdaGrab(VideoState &v)`);
  return code;
}
