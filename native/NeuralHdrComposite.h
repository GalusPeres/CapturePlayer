#pragma once
#include <d3d12.h>
#include <d3dcompiler.h>
#include <wrl/client.h>

// Neural inference remains SDR. Apply its linear-light difference to the
// unmodified FP16 capture using the inverse scale of the input tone mapping.
// Equal original/processed SDR pixels reproduce the HDR base exactly,
// including values above SDR white and negative wide-gamut components.
static const char kCpHdrCompositeHlsl[] = R"(
Texture2D<float4> hdrBase : register(t0);
Texture2D<float4> sdrBase : register(t1);
Texture2D<float4> sdrNeural : register(t2);
RWTexture2D<float4> destination : register(u0);
cbuffer Composite : register(b0) { float whiteScale; float bypass; };
float3 decode(float3 c) {
    return float3(c.r <= .04045 ? c.r/12.92 : pow((c.r+.055)/1.055,2.4),
                  c.g <= .04045 ? c.g/12.92 : pow((c.g+.055)/1.055,2.4),
                  c.b <= .04045 ? c.b/12.92 : pow((c.b+.055)/1.055,2.4));
}
[numthreads(8,8,1)]
void CSMain(uint3 id : SV_DispatchThreadID) {
    uint2 size; destination.GetDimensions(size.x,size.y);
    if (any(id.xy >= size)) return;
    float3 base = hdrBase.Load(int3(id.xy,0)).rgb;
    if (bypass > 0) { destination[id.xy] = float4(base,1); return; }
    float3 before = decode(sdrBase.Load(int3(id.xy,0)).rgb);
    float3 after = decode(sdrNeural.Load(int3(id.xy,0)).rgb);
    float peak = max(0,max(base.r,max(base.g,base.b))) * whiteScale;
    float3 adjusted = base + (after-before) * ((1+peak)/whiteScale);
    // Preserve negative original gamut values without adding negative light.
    destination[id.xy] = float4(max(adjusted,min(base,0)),1);
}
)";

class CpHdrComposite {
    template<class T> using Ptr = Microsoft::WRL::ComPtr<T>;
    Ptr<ID3D12RootSignature> root;
    Ptr<ID3D12PipelineState> pipeline;
    Ptr<ID3D12DescriptorHeap> descriptors;
    Ptr<ID3D12Resource> output;
public:
    void Reset() { output.Reset(); descriptors.Reset(); pipeline.Reset(); root.Reset(); }
    bool Initialize(ID3D12Device* device, UINT width, UINT height) {
        if (output && output->GetDesc().Width == width && output->GetDesc().Height == height) return true;
        Reset();
        Ptr<ID3DBlob> shader, errors, signature;
        if (FAILED(D3DCompile(kCpHdrCompositeHlsl,sizeof(kCpHdrCompositeHlsl)-1,"hdr-composite",nullptr,nullptr,"CSMain","cs_5_0",0,0,&shader,&errors))) return false;
        D3D12_DESCRIPTOR_RANGE ranges[2] = {{D3D12_DESCRIPTOR_RANGE_TYPE_SRV,3,0,0,0},{D3D12_DESCRIPTOR_RANGE_TYPE_UAV,1,0,0,0}};
        D3D12_ROOT_PARAMETER parameters[3] = {};
        for (int i=0;i<2;++i) { parameters[i].ParameterType=D3D12_ROOT_PARAMETER_TYPE_DESCRIPTOR_TABLE;parameters[i].DescriptorTable={1,&ranges[i]}; }
        parameters[2].ParameterType=D3D12_ROOT_PARAMETER_TYPE_32BIT_CONSTANTS;parameters[2].Constants={0,0,2};
        D3D12_ROOT_SIGNATURE_DESC rs = {};rs.NumParameters=3;rs.pParameters=parameters;
        if (FAILED(D3D12SerializeRootSignature(&rs,D3D_ROOT_SIGNATURE_VERSION_1,&signature,&errors)) ||
            FAILED(device->CreateRootSignature(0,signature->GetBufferPointer(),signature->GetBufferSize(),IID_PPV_ARGS(&root)))) return false;
        D3D12_COMPUTE_PIPELINE_STATE_DESC ps={};ps.pRootSignature=root.Get();ps.CS={shader->GetBufferPointer(),shader->GetBufferSize()};
        if (FAILED(device->CreateComputePipelineState(&ps,IID_PPV_ARGS(&pipeline)))) return false;
        D3D12_DESCRIPTOR_HEAP_DESC hd={};hd.Type=D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV;hd.NumDescriptors=4;hd.Flags=D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE;
        if (FAILED(device->CreateDescriptorHeap(&hd,IID_PPV_ARGS(&descriptors)))) return false;
        D3D12_HEAP_PROPERTIES heap={};heap.Type=D3D12_HEAP_TYPE_DEFAULT;
        D3D12_RESOURCE_DESC desc={};desc.Dimension=D3D12_RESOURCE_DIMENSION_TEXTURE2D;desc.Width=width;desc.Height=height;
        desc.DepthOrArraySize=desc.MipLevels=1;desc.SampleDesc.Count=1;desc.Format=DXGI_FORMAT_R16G16B16A16_FLOAT;
        desc.Flags=D3D12_RESOURCE_FLAG_ALLOW_UNORDERED_ACCESS;
        return SUCCEEDED(device->CreateCommittedResource(&heap,D3D12_HEAP_FLAG_NONE,&desc,D3D12_RESOURCE_STATE_UNORDERED_ACCESS,nullptr,IID_PPV_ARGS(&output)));
    }
    ID3D12Resource* Render(ID3D12Device* device, ID3D12GraphicsCommandList* commands,
        ID3D12Resource* hdr, ID3D12Resource* original, ID3D12Resource* neural, float scale, bool bypass) {
        const UINT stride=device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);
        auto cpu=descriptors->GetCPUDescriptorHandleForHeapStart();
        ID3D12Resource* inputs[3]={hdr,original,neural};
        for (auto* input:inputs) {
            D3D12_SHADER_RESOURCE_VIEW_DESC srv={};srv.Format=input->GetDesc().Format;srv.ViewDimension=D3D12_SRV_DIMENSION_TEXTURE2D;
            srv.Shader4ComponentMapping=D3D12_DEFAULT_SHADER_4_COMPONENT_MAPPING;srv.Texture2D.MipLevels=1;
            device->CreateShaderResourceView(input,&srv,cpu);cpu.ptr+=stride;
        }
        D3D12_UNORDERED_ACCESS_VIEW_DESC uav={};uav.Format=DXGI_FORMAT_R16G16B16A16_FLOAT;uav.ViewDimension=D3D12_UAV_DIMENSION_TEXTURE2D;
        device->CreateUnorderedAccessView(output.Get(),nullptr,&uav,cpu);
        ID3D12DescriptorHeap* heaps[]={descriptors.Get()};commands->SetDescriptorHeaps(1,heaps);
        commands->SetComputeRootSignature(root.Get());commands->SetPipelineState(pipeline.Get());
        auto gpu=descriptors->GetGPUDescriptorHandleForHeapStart();commands->SetComputeRootDescriptorTable(0,gpu);gpu.ptr+=stride*3;
        commands->SetComputeRootDescriptorTable(1,gpu);const float constants[2]={scale,bypass?1.0f:0.0f};
        commands->SetComputeRoot32BitConstants(2,2,constants,0);
        commands->Dispatch((UINT(output->GetDesc().Width)+7)/8,(output->GetDesc().Height+7)/8,1);
        return output.Get();
    }
};
