#include <d3d11.h>
#include <d3dcompiler.h>
#include <wrl/client.h>
#include <DirectXPackedVector.h>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include "NeuralCaptureColor.h"
#include "NeuralHdrComposite.h"
using Microsoft::WRL::ComPtr;
static void check(HRESULT hr) { if (FAILED(hr)) throw std::runtime_error("GPU color test failed"); }
int main(int argc, char** argv) {
    try {
        ComPtr<ID3D11Device> device; ComPtr<ID3D11DeviceContext> context;
        const bool warp = argc > 1 && strcmp(argv[1], "--warp") == 0;
        check(D3D11CreateDevice(nullptr, warp ? D3D_DRIVER_TYPE_WARP : D3D_DRIVER_TYPE_HARDWARE, nullptr, 0, nullptr, 0, D3D11_SDK_VERSION, &device, nullptr, &context));
        printf("Shader test device: %s\n", warp ? "WARP (software; not a performance measurement)" : "hardware");
        ComPtr<ID3DBlob> code, errors;
        const HRESULT compiled = D3DCompile(kCpCaptureColorHlsl, sizeof(kCpCaptureColorHlsl)-1, "capture-color", nullptr, nullptr, "CSMain", "cs_5_0", 0, 0, &code, &errors);
        if (errors) fprintf(stderr, "%s", (char*)errors->GetBufferPointer());
        check(compiled);
        ComPtr<ID3D11ComputeShader> shader;
        check(device->CreateComputeShader(code->GetBufferPointer(), code->GetBufferSize(), nullptr, &shader));
        const std::array<float,8> values = {0,0.01f,0.05f,0.18f,0.4f,0.7f,0.9f,1};
        for (float white : {1.0f, 2.5375f, 5.0f}) for (bool encoded : {false,true}) for(bool hdr : {false,true}) {
            std::array<DirectX::PackedVector::HALF,32> pixels;
            for (int i=0;i<8;++i) for(int c=0;c<4;++c)
                pixels[i*4+c]=DirectX::PackedVector::XMConvertFloatToHalf(c==3?1:values[i]*(encoded?1:white));
            D3D11_TEXTURE2D_DESC desc = {}; desc.Width=8;desc.Height=1;desc.MipLevels=desc.ArraySize=1;
            desc.Format=DXGI_FORMAT_R16G16B16A16_FLOAT;desc.SampleDesc.Count=1;desc.BindFlags=D3D11_BIND_SHADER_RESOURCE;
            D3D11_SUBRESOURCE_DATA initial={pixels.data(),64,0}; ComPtr<ID3D11Texture2D> input,output,readback;
            check(device->CreateTexture2D(&desc,&initial,&input));
            ComPtr<ID3D11ShaderResourceView> srv;check(device->CreateShaderResourceView(input.Get(),nullptr,&srv));
            desc.Format=DXGI_FORMAT_R8G8B8A8_UNORM;desc.BindFlags=D3D11_BIND_UNORDERED_ACCESS;
            check(device->CreateTexture2D(&desc,nullptr,&output));
            ComPtr<ID3D11UnorderedAccessView> uav;check(device->CreateUnorderedAccessView(output.Get(),nullptr,&uav));
            desc.BindFlags=0;desc.Usage=D3D11_USAGE_STAGING;desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
            check(device->CreateTexture2D(&desc,nullptr,&readback));
            float constants[4]={encoded?0.0f:1.0f,1/white,hdr?1.0f:0.0f,0};
            D3D11_BUFFER_DESC bd={};bd.ByteWidth=16;bd.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
            D3D11_SUBRESOURCE_DATA data={constants,0,0};ComPtr<ID3D11Buffer> buffer;
            check(device->CreateBuffer(&bd,&data,&buffer));
            context->CSSetShader(shader.Get(),nullptr,0);context->CSSetConstantBuffers(0,1,buffer.GetAddressOf());
            context->CSSetShaderResources(0,1,srv.GetAddressOf());context->CSSetUnorderedAccessViews(0,1,uav.GetAddressOf(),nullptr);
            context->Dispatch(1,1,1);context->CopyResource(readback.Get(),output.Get());
            D3D11_MAPPED_SUBRESOURCE mapped;check(context->Map(readback.Get(),0,D3D11_MAP_READ,0,&mapped));
            for(int i=0;i<8;++i) {
                const float mappedValue=hdr?values[i]/(1+values[i]):values[i];
                const float expected=encoded?values[i]:(mappedValue<=0.0031308f?12.92f*mappedValue:1.055f*powf(mappedValue,1/2.4f)-0.055f);
                for(int c=0;c<3;++c) if(fabsf(((unsigned char*)mapped.pData)[4*i+c]/255.0f-expected)>0.005f)
                    throw std::runtime_error("Capture transfer or Windows white normalization mismatch");
            }
            context->Unmap(readback.Get(),0);
        }
        printf("PASS: GPU FP16 scRGB -> SDR sRGB at 80, 203 and 400 nit Windows white; encoded SDR preserved\n");
        check(D3DCompile(kCpHdrCompositeHlsl,sizeof(kCpHdrCompositeHlsl)-1,"composite",nullptr,nullptr,"CSMain","cs_5_0",0,0,&code,&errors));
        check(device->CreateComputeShader(code->GetBufferPointer(),code->GetBufferSize(),nullptr,&shader));
        for (int scenario=0;scenario<3;++scenario) {
            std::array<DirectX::PackedVector::HALF,32> base, before, after;
            for (int i=0;i<8;++i) for(int c=0;c<4;++c) {
                // Includes negative gamut components and highlights to 4000 nits.
                const float hdr=c==0?-0.02f:values[i]*50;
                base[i*4+c]=DirectX::PackedVector::XMConvertFloatToHalf(c==3?1:hdr);
                before[i*4+c]=DirectX::PackedVector::XMConvertFloatToHalf(.5f);
                after[i*4+c]=DirectX::PackedVector::XMConvertFloatToHalf(scenario?.6f:.5f);
            }
            D3D11_TEXTURE2D_DESC desc={};desc.Width=8;desc.Height=1;desc.MipLevels=desc.ArraySize=1;
            desc.Format=DXGI_FORMAT_R16G16B16A16_FLOAT;desc.SampleDesc.Count=1;desc.BindFlags=D3D11_BIND_SHADER_RESOURCE;
            ComPtr<ID3D11Texture2D> textures[3],output,readback;ComPtr<ID3D11ShaderResourceView> views[3];
            const void* inputs[]={base.data(),before.data(),after.data()};
            for(int i=0;i<3;++i) {
                D3D11_SUBRESOURCE_DATA data={inputs[i],64,0};
                check(device->CreateTexture2D(&desc,&data,&textures[i]));check(device->CreateShaderResourceView(textures[i].Get(),nullptr,&views[i]));
            }
            desc.BindFlags=D3D11_BIND_UNORDERED_ACCESS;check(device->CreateTexture2D(&desc,nullptr,&output));
            ComPtr<ID3D11UnorderedAccessView> uav;check(device->CreateUnorderedAccessView(output.Get(),nullptr,&uav));
            desc.BindFlags=0;desc.Usage=D3D11_USAGE_STAGING;desc.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
            check(device->CreateTexture2D(&desc,nullptr,&readback));
            const float constants[4]={1.0f/3,scenario==2?1.0f:0.0f,0,0};
            D3D11_BUFFER_DESC bd={};bd.ByteWidth=16;bd.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
            D3D11_SUBRESOURCE_DATA data={constants,0,0};ComPtr<ID3D11Buffer> buffer;check(device->CreateBuffer(&bd,&data,&buffer));
            context->CSSetShader(shader.Get(),nullptr,0);context->CSSetConstantBuffers(0,1,buffer.GetAddressOf());
            ID3D11ShaderResourceView* resources[]={views[0].Get(),views[1].Get(),views[2].Get()};
            context->CSSetShaderResources(0,3,resources);context->CSSetUnorderedAccessViews(0,1,uav.GetAddressOf(),nullptr);
            context->Dispatch(1,1,1);context->CopyResource(readback.Get(),output.Get());
            D3D11_MAPPED_SUBRESOURCE mapped;check(context->Map(readback.Get(),0,D3D11_MAP_READ,0,&mapped));
            for(int i=0;i<8;++i) for(int c=0;c<3;++c) {
                const float original=DirectX::PackedVector::XMConvertHalfToFloat(base[4*i+c]);
                float expected=original;
                if(scenario==1) {
                    const float a=DirectX::PackedVector::XMConvertHalfToFloat(after[4*i+c]);
                    const float delta=powf((a+.055f)/1.055f,2.4f)-powf((.5f+.055f)/1.055f,2.4f);
                    const float peak=DirectX::PackedVector::XMConvertHalfToFloat(base[4*i+1]);
                    expected+=delta*(3+peak);
                }
                const float actual=DirectX::PackedVector::XMConvertHalfToFloat(((DirectX::PackedVector::HALF*)mapped.pData)[4*i+c]);
                if(fabsf(actual-expected)>.001f+fabsf(expected)*.001f) throw std::runtime_error("HDR composite did not preserve its base or scale the neural difference correctly");
            }
            context->Unmap(readback.Get(),0);
        }
        printf("PASS: FP16 HDR composite identity, bypass, negative gamut and neural differences through 4000-nit highlights\n");
        printf("Primary display SDR white scale: %.6f\n",CpWindowSdrWhiteScale(GetDesktopWindow()));
        return 0;
    } catch(const std::exception& e) { fprintf(stderr,"%s\n",e.what());return 1; }
}
