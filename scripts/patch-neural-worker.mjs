// Small, checked modifications to pinned MIT NeuralScreen source. Upstream
// source and its complete license remain in .local/neural-build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchNeuralHdr } from './patch-neural-hdr.mjs';
const root = process.argv[2];
if (!root) throw new Error('Expected a native build directory');
const native = path.join(root, 'native');
let code = fs.readFileSync(path.join(native, 'dlss5-feed-host64.cpp'), 'utf8');
function replace(before, after) {
  if (!code.includes(before)) throw new Error(`Pinned source no longer matches: ${before.slice(0, 80)}`);
  code = code.replace(before, after);
}
replace('#include "../src/feed_ipc.h"', '#include "src/feed_ipc.h"');
replace('#include <vector>', '#include <vector>\n#include <memory>\n#include <cmath>');
replace('static VideoHeader g_video_options = {};', 'static double g_cp_frame_start = 0.0;\nstatic VideoHeader g_video_options = {};');
replace('struct WgcSession\n{', 'struct WgcSession\n{\n    std::shared_ptr<void> frame_event;');
// Documented WinRT ABI, usable with the installed 22621 SDK as well as newer
// SDKs. QueryInterface keeps older Windows versions functional.
// https://learn.microsoft.com/uwp/api/windows.graphics.capture.graphicscapturesession.minupdateinterval
replace('static bool OpenWgc(HWND hwnd)', `struct CpTimeSpan { INT64 Duration; };
struct __declspec(uuid("67C0EA62-1F85-5061-925A-239BE0AC09CB")) ICpCaptureSession5 : ::IInspectable {
    virtual HRESULT __stdcall get_MinUpdateInterval(CpTimeSpan *value) = 0;
    virtual HRESULT __stdcall put_MinUpdateInterval(CpTimeSpan value) = 0;
};
static bool OpenWgc(HWND hwnd)`);
replace('s->session = s->pool.CreateCaptureSession(s->item);', `s->frame_event = std::shared_ptr<void>(CreateEventW(nullptr, FALSE, FALSE, nullptr), [](void *p) { if (p) CloseHandle(p); });
        const auto frame_event = s->frame_event;
        s->pool.FrameArrived([frame_event](auto const &, auto const &) { SetEvent(frame_event.get()); });
        s->session = s->pool.CreateCaptureSession(s->item);
        if (const auto fast = s->session.try_as<ICpCaptureSession5>()) {
            const HRESULT interval = fast->put_MinUpdateInterval(CpTimeSpan{0});
            Log("[wgc] minimum update interval disabled: 0x%08X", interval);
        } else Log("[wgc] fast capture interval unavailable on this Windows version");`);
// A parent crash/exit must not leave an opaque preview over the desktop.
replace('int main(int argc, char **argv)\n{', `static DWORD WINAPI CpWatchParent(LPVOID handle) {
    WaitForSingleObject(handle, INFINITE);
    CloseHandle(handle);
    ExitProcess(0);
    return 0;
}
int main(int argc, char **argv)
{
    char parent[24] = {};
    if (GetEnvironmentVariableA("CAPTUREPLAYER_PARENT_PID", parent, sizeof(parent))) {
        HANDLE handle = OpenProcess(SYNCHRONIZE, FALSE, static_cast<DWORD>(strtoul(parent, nullptr, 10)));
        if (handle) {
            HANDLE thread = CreateThread(nullptr, 0, CpWatchParent, handle, 0, nullptr);
            if (thread) CloseHandle(thread); else CloseHandle(handle);
        }
    }`);
replace('auto frame = g_wgc->pool.TryGetNextFrame();', `auto frame = g_wgc->pool.TryGetNextFrame();
        if (frame == nullptr) {
            WaitForSingleObject(g_wgc->frame_event.get(), 16);
            frame = g_wgc->pool.TryGetNextFrame();
        }`);
// The preview only needs capture + NR + presentation, no recording or Spout.
fs.writeFileSync(path.join(native, 'spout_bridge.h'), `#pragma once
inline bool SpoutBridgeInit(ID3D12Device*) { return false; }
inline void SpoutBridgeCopy(ID3D12GraphicsCommandList*, ID3D12Resource*, UINT, UINT) {}
inline void SpoutBridgeSend() {}
inline void SpoutBridgeShutdown() {}
`);
replace('L"NeuralScreenPresent"', 'L"CapturePlayerNeuralPresent"');
replace('wc.lpszClassName, L"NeuralScreen", WS_POPUP,', 'wc.lpszClassName, L"CapturePlayer Neural Preview", WS_POPUP,');
// A refusal must never look like an active neural filter in CapturePlayer.
replace('h.feature = nullptr;\n        Log("[video] NR feature unavailable', 'return 3;\n        Log("[video] NR feature unavailable');
// OUT1 ok=2 means no fresh frame, distinct from a successful neural present.
replace('VideoResultHeader empty = { OUT_MAGIC, fh.index, 1u,', 'VideoResultHeader empty = { OUT_MAGIC, fh.index, 2u,');
replace('VideoResultHeader idle = { OUT_MAGIC, fh.index, 1u,', 'VideoResultHeader idle = { OUT_MAGIC, fh.index, 2u,');
// Drain the bounded two-frame WGC pool before running the expensive filter.
replace('if (frame == nullptr) return false;\n        auto access = frame.Surface()', `if (frame == nullptr) return false;
        auto newer = g_wgc->pool.TryGetNextFrame();
        if (newer != nullptr) { frame.Close(); frame = newer; }
        g_cp_frame_start = PhaseNow();
        auto access = frame.Surface()`);
// Our protocol uses OUT1.pts for microseconds from WGC dequeue through
// Present, excluding the wait for a new frame. It is NOT input-to-photon.
replace('VideoResultHeader out = { OUT_MAGIC, fh.index, 1u, 0u, g_last_eval_result, fh.pts };',
  'VideoResultHeader out = { OUT_MAGIC, fh.index, 1u, 0u, g_last_eval_result, static_cast<int64_t>((PhaseNow() - g_cp_frame_start) * 1000.0) };');
// An owned popup follows the player's z-order, including focus on another
// monitor, without covering unrelated apps or activating on mouse movement.
replace('WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT,',
  '(g_wgc_active ? 0 : WS_EX_TOPMOST) | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT,');
replace('nullptr, nullptr, wc.hInstance, nullptr);', 'g_wgc_active ? g_wgc_hwnd : nullptr, nullptr, wc.hInstance, nullptr);');
code = code.replaceAll('SetWindowPos(g_present_hwnd, HWND_TOPMOST,', 'SetWindowPos(g_present_hwnd, g_wgc_active ? HWND_TOP : HWND_TOPMOST,');
replace('SWP_NOSIZE | SWP_NOACTIVATE);\n    }\n}\n\n// Come back',
  'SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER);\n    }\n}\n\n// Come back');
replace('static void ReassertPresentTopmost()\n{', 'static void ReassertPresentTopmost()\n{\n    if (g_wgc_active) return;');

// Bound DXGI's presentation queue to one image. Wait before dequeuing the
// newest WGC image, so the wait cannot age an already captured game frame.
replace('static IDXGISwapChain3           *g_present_swap;', `static IDXGISwapChain3           *g_present_swap;
static HANDLE g_cp_present_ready = nullptr;
static bool g_cp_wait_present = true;
static double g_cp_previous_present = 0;
static std::vector<double> g_cp_present_gaps;
static double PhaseNow();
static bool CpWaitablePresent() {
    char value[8] = {}; GetEnvironmentVariableA("CAPTUREPLAYER_WAITABLE_PRESENT", value, sizeof(value));
    return value[0] != '0';
}
static UINT CpPresentInterval() {
    static const UINT interval = [] { char value[8] = {}; GetEnvironmentVariableA("CAPTUREPLAYER_NEURAL_VSYNC",value,sizeof(value)); return value[0]=='0'?0u:1u; }();
    return interval;
}
static void CpRecordPresent() {
    g_cp_wait_present = true;
    const double now = PhaseNow();
    if (g_cp_previous_present > 0) g_cp_present_gaps.push_back(now - g_cp_previous_present);
    g_cp_previous_present = now;
    if (g_cp_present_gaps.size() >= 120) {
        auto sorted = g_cp_present_gaps;
        std::sort(sorted.begin(), sorted.end());
        unsigned slow = 0;
        for (double gap : sorted) if (gap > 25.0) ++slow;
        Log("[cadence] present gaps p95=%.3f max=%.3f over25=%u count=%u", sorted[sorted.size()*95/100], sorted.back(), slow, (unsigned)sorted.size());
        g_cp_present_gaps.clear();
    }
}`);
replace('static void ClosePresent()\n{', `static void ClosePresent()
{
    if (g_cp_present_ready) { CloseHandle(g_cp_present_ready); g_cp_present_ready = nullptr; }
    g_cp_wait_present = true; g_cp_previous_present = 0; g_cp_present_gaps.clear();`);
replace('sd.AlphaMode   = DXGI_ALPHA_MODE_IGNORE;', 'sd.AlphaMode   = DXGI_ALPHA_MODE_IGNORE;\n    if (CpWaitablePresent()) sd.Flags = DXGI_SWAP_CHAIN_FLAG_FRAME_LATENCY_WAITABLE_OBJECT;');
replace('    // Click-through. The order follows', `    if (CpWaitablePresent()) {
        if (FAILED(g_present_swap->SetMaximumFrameLatency(1))) { ClosePresent(); return false; }
        g_cp_present_ready = g_present_swap->GetFrameLatencyWaitableObject();
        if (!g_cp_present_ready) { ClosePresent(); return false; }
        Log("[present] DXGI queue limited to one frame");
    }
    // Click-through. The order follows`);
replace('        const double t_frame = PhaseNow();', `        if (g_cp_present_ready && g_cp_wait_present) {
            const DWORD ready = WaitForSingleObject(g_cp_present_ready, 16);
            if (ready == WAIT_TIMEOUT) {
                FollowCapturedWindow();
                VideoResultHeader idle = { OUT_MAGIC, fh.index, 2u, 0u, g_last_eval_result, 0 };
                if (!WriteExact(stdout, &idle, sizeof(idle))) return 10;
                continue;
            }
            if (ready != WAIT_OBJECT_0) return 9;
            g_cp_wait_present = false;
        }
        const double t_frame = PhaseNow();`);
code = code.replaceAll('ok = SUCCEEDED(g_present_swap->Present(0, 0));', 'ok = SUCCEEDED(g_present_swap->Present(0, 0));\n            if (ok) CpRecordPresent();');

// Keep the old copy path available for pixel-for-pixel regression and timing.
replace('static bool SwizzleCaptureIntoColor(VideoState &v)\n{', `static bool CpFastPath() {
    static const bool enabled = [] { char value[8] = {}; GetEnvironmentVariableA("CAPTUREPLAYER_FAST_PATH", value, sizeof(value)); return value[0] != '0'; }();
    return enabled;
}
static bool SwizzleCaptureIntoColor(VideoState &v)
{
    const auto desc = v.color.tex->GetDesc();
    if (CpFastPath() && !g_gray_mapped && desc.Width == g_dda_w && desc.Height == g_dda_h) {
        if (!BeginCommands()) return false;
        D3D12_RESOURCE_BARRIER pre[] = {
            Transition(g_dda_d12, D3D12_RESOURCE_STATE_COMMON, D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE),
            Transition(v.color.tex, D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE, D3D12_RESOURCE_STATE_UNORDERED_ACCESS)
        };
        h.list->ResourceBarrier(2, pre);
        BindDdaDescriptors(g_dda_d12, v.color.tex);
        ID3D12DescriptorHeap *heaps[] = { g_dda_heap };
        h.list->SetDescriptorHeaps(1, heaps);
        h.list->SetComputeRootSignature(g_dda_rs);
        h.list->SetPipelineState(g_dda_pso);
        auto first = g_dda_heap->GetGPUDescriptorHandleForHeapStart();
        auto second = first;
        second.ptr += h.dev->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);
        h.list->SetComputeRootDescriptorTable(0, first);
        h.list->SetComputeRootDescriptorTable(1, second);
        h.list->Dispatch((g_dda_w + 7) / 8, (g_dda_h + 7) / 8, 1);
        D3D12_RESOURCE_BARRIER post[] = {
            Transition(v.color.tex, D3D12_RESOURCE_STATE_UNORDERED_ACCESS, D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE),
            Transition(g_dda_d12, D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE, D3D12_RESOURCE_STATE_COMMON)
        };
        h.list->ResourceBarrier(2, post);
        if (!WaitFenceValue(h.fence, EndCommands(), 10000)) return false;
        UpdateAdaptiveExposure();
        g_dda_ready = true;
        return true;
    }`);
replace('CreateVideoTex(v.color, cw, ch, DXGI_FORMAT_R8G8B8A8_UNORM, cw * 4)',
  'CreateVideoTex(v.color, cw, ch, DXGI_FORMAT_R8G8B8A8_UNORM, cw * 4, D3D12_RESOURCE_FLAG_ALLOW_UNORDERED_ACCESS)');
replace('static void BindDdaDescriptors(ID3D12Resource *src)', 'static void BindDdaDescriptors(ID3D12Resource *src, ID3D12Resource *dst = nullptr)');
replace('CreateUnorderedAccessView(g_dda_dst, nullptr, &ud, cpu)', 'CreateUnorderedAccessView(dst ? dst : g_dda_dst, nullptr, &ud, cpu)');
replace('bool inputs_ready = false;', 'bool inputs_ready = false;\n    bool cp_zero_motion_ready = false;\n    ID3D12Resource *cp_blend = nullptr;');
replace('static bool UploadMotionOnly(VideoState &v, const BYTE *mv, bool motion_small)\n{', `static bool UploadMotionOnly(VideoState &v, const BYTE *mv, bool motion_small)
{
    bool zero = CpFastPath() && motion_small && g_motion_w == 8 && g_motion_h == 8;
    if (zero) for (UINT i = 0; i < 256; ++i) if (mv[i]) { zero = false; break; }
    if (zero && v.cp_zero_motion_ready && v.inputs_ready) return true;
    v.cp_zero_motion_ready = zero;`);
replace('v.inputs_ready = false;', 'v.inputs_ready = false;\n    v.cp_zero_motion_ready = false;\n    if (v.cp_blend) { v.cp_blend->Release(); v.cp_blend = nullptr; }');

// Strength is a final linear blend, independent of undocumented model knobs.
// Bit 7 enables this extension; bits 8..15 are 0..100. Split uses 16..31.
replace('const double t_frame = PhaseNow();', `const UINT strength_byte = (fh.reserved >> 8) & 255u;
        const float strength = (fh.reserved & 0x80) ? (strength_byte > 100u ? 100u : strength_byte) / 100.0f : 1.0f;
        if (strength != v.residual_strength) { v.residual_strength = strength; g_force_next_frame = true; }
        g_cp_frame_start = PhaseNow();
        const double t_frame = PhaseNow();`);
replace('static bool EvaluateVideo(VideoState &v, int reset)\n{', `static bool EvaluateVideo(VideoState &v, int reset)
{
    if (!v.nr_small && v.residual_strength != 1.0f && !v.cp_blend) {
        D3D12_HEAP_PROPERTIES heap = {}; heap.Type = D3D12_HEAP_TYPE_DEFAULT;
        auto desc = v.output->GetDesc();
        if (FAILED(h.dev->CreateCommittedResource(&heap, D3D12_HEAP_FLAG_NONE, &desc,
            D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE, nullptr, __uuidof(ID3D12Resource),
            reinterpret_cast<void **>(&v.cp_blend)))) return false;
    }`);
replace('    if (ts)\n        h.list->ResolveQueryData', `    if (!v.nr_small && v.residual_strength != 1.0f) {
        D3D12_RESOURCE_BARRIER pre[] = {
            Transition(v.output, D3D12_RESOURCE_STATE_UNORDERED_ACCESS, D3D12_RESOURCE_STATE_COPY_SOURCE),
            Transition(v.cp_blend, D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE, D3D12_RESOURCE_STATE_COPY_DEST)
        };
        h.list->ResourceBarrier(2, pre);
        h.list->CopyResource(v.cp_blend, v.output);
        D3D12_RESOURCE_BARRIER post[] = {
            Transition(v.output, D3D12_RESOURCE_STATE_COPY_SOURCE, D3D12_RESOURCE_STATE_UNORDERED_ACCESS),
            Transition(v.cp_blend, D3D12_RESOURCE_STATE_COPY_DEST, D3D12_RESOURCE_STATE_NON_PIXEL_SHADER_RESOURCE)
        };
        h.list->ResourceBarrier(2, post);
        ResidualCompose(v.color.tex, v.color.tex, v.cp_blend, cw, ch, v.output, v.residual_strength);
    }
    if (ts)
        h.list->ResolveQueryData`);
// A compact update command changes evaluation parameters between frames.
// It does not recreate the feature, capture pool, textures or swapchain.
replace('    if (fh.magic == SHM_MAGIC)', `    if (fh.magic == 0x454e5554u) return 10; // TUNE, four floats in the 24-byte header
    if (fh.magic == SHM_MAGIC)`);
replace('        if (msg == 3)', `        if (msg == 10) {
            float values[4];
            memcpy(values, reinterpret_cast<const BYTE *>(&fh) + 4, sizeof(values));
            bool valid = true;
            for (int i = 0; i < 4; ++i)
                valid = valid && std::isfinite(values[i]) &&
                    ((values[i] >= 0.0f && values[i] <= 1.0f) || (i == 3 && values[i] == -1.0f));
            if (valid) {
                g_video_options.intensity = values[0];
                g_video_options.local_tone = values[1];
                g_video_options.local_structure = values[2];
                g_video_options.skin_structure = values[3];
                g_video_options.auto_mask = values[3] < 0.0f ? 0u : 1u;
                g_force_next_frame = true;
            }
            uint32_t ack[6] = { 0x4b414e54u, valid ? 1u : 0u, 0u, 0u, 0u, 0u };
            if (valid) memcpy(ack + 2, values, sizeof(values));
            if (!WriteExact(stdout, ack, sizeof(ack))) return 10;
            continue;
        }
        if (msg == 3)`);
code = patchNeuralHdr(code);
code = code.replaceAll('g_present_swap->Present(0, 0)', 'g_present_swap->Present(CpPresentInterval(), 0)')
  .replaceAll('g_present_swap->Present(0,0)', 'g_present_swap->Present(CpPresentInterval(),0)');
replace('Log("[present] DXGI queue limited to one frame");', 'Log("[present] DXGI queue limited to one frame; vsync=%u", CpPresentInterval());');
fs.copyFileSync(fileURLToPath(new URL('../native/NeuralCaptureColor.h', import.meta.url)), path.join(native, 'NeuralCaptureColor.h'));
fs.copyFileSync(fileURLToPath(new URL('../native/NeuralHdrComposite.h', import.meta.url)), path.join(native, 'NeuralHdrComposite.h'));
fs.writeFileSync(path.join(native, 'CapturePlayerNeural.cpp'), code);
