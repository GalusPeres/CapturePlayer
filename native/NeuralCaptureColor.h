#pragma once
#include <windows.h>
#include <vector>

// WGC FP16 contains linear scRGB (1.0 = 80 nits). SDR content in that
// surface is scaled by the monitor's Windows SDR white level. Undo that
// scale before encoding the already tone-mapped input for the SDR model.
static const char kCpCaptureColorHlsl[] = R"(
Texture2D<float4> gSrc : register(t0);
RWTexture2D<float4> gDst : register(u0);
cbuffer CaptureColor : register(b0) { float inputLinear; float whiteScale; float preserveHdr; };
[numthreads(8, 8, 1)]
void CSMain(uint3 id : SV_DispatchThreadID) {
    uint2 size; gDst.GetDimensions(size.x, size.y);
    if (any(id.xy >= size)) return;
    float4 color = gSrc.Load(int3(id.xy, 0));
    if (inputLinear > 0) {
        float3 rgbLinear = max(color.rgb * whiteScale, 0);
        if (preserveHdr > 0) rgbLinear /= 1 + max(rgbLinear.r, max(rgbLinear.g, rgbLinear.b));
        rgbLinear = saturate(rgbLinear);
        color.rgb = float3(
            rgbLinear.r <= 0.0031308 ? 12.92 * rgbLinear.r : 1.055 * pow(rgbLinear.r, 1.0 / 2.4) - 0.055,
            rgbLinear.g <= 0.0031308 ? 12.92 * rgbLinear.g : 1.055 * pow(rgbLinear.g, 1.0 / 2.4) - 0.055,
            rgbLinear.b <= 0.0031308 ? 12.92 * rgbLinear.b : 1.055 * pow(rgbLinear.b, 1.0 / 2.4) - 0.055);
    }
    gDst[id.xy] = float4(color.rgb, 1);
}
)";

static float CpWindowSdrWhiteScale(HWND window) {
    MONITORINFOEXW monitor = {};
    monitor.cbSize = sizeof(monitor);
    if (!GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST), &monitor)) return 1.0f;
    // Retry if a display is attached while QueryDisplayConfig fills its arrays.
    for (int attempt = 0; attempt < 3; ++attempt) {
        UINT32 pathCount = 0, modeCount = 0;
        if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &pathCount, &modeCount) != ERROR_SUCCESS) break;
        std::vector<DISPLAYCONFIG_PATH_INFO> paths(pathCount);
        std::vector<DISPLAYCONFIG_MODE_INFO> modes(modeCount);
        const LONG result = QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &pathCount, paths.data(), &modeCount, modes.data(), nullptr);
        if (result == ERROR_INSUFFICIENT_BUFFER) continue;
        if (result != ERROR_SUCCESS) break;
        for (UINT32 i = 0; i < pathCount; ++i) {
            const auto& path = paths[i];
            DISPLAYCONFIG_SOURCE_DEVICE_NAME source = {};
            source.header = { DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, sizeof(source), path.sourceInfo.adapterId, path.sourceInfo.id };
            if (DisplayConfigGetDeviceInfo(&source.header) != ERROR_SUCCESS ||
                wcscmp(source.viewGdiDeviceName, monitor.szDevice) != 0) continue;
            DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO advanced = {};
            advanced.header = { DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO, sizeof(advanced), path.targetInfo.adapterId, path.targetInfo.id };
            if (DisplayConfigGetDeviceInfo(&advanced.header) != ERROR_SUCCESS || !advanced.advancedColorEnabled) return 1.0f;
            DISPLAYCONFIG_SDR_WHITE_LEVEL white = {};
            white.header = { DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL, sizeof(white), path.targetInfo.adapterId, path.targetInfo.id };
            if (DisplayConfigGetDeviceInfo(&white.header) == ERROR_SUCCESS && white.SDRWhiteLevel >= 1000)
                return 1000.0f / float(white.SDRWhiteLevel);
        }
        break;
    }
    return 1.0f;
}
