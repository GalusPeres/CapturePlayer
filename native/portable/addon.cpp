#include <node_api.h>
#include "capture.h"
#include <atomic>
#include <mutex>
#include <stdexcept>
#include <unordered_map>

namespace {
struct State {
    std::atomic<uint32_t> references{1};
    std::shared_ptr<cp::Capture> capture;
    napi_threadsafe_function callback = nullptr;
    // Only accessed on the JS thread. A frame remains alive until Chromium's
    // allReferencesReleased callback, including frames from a stopped session.
    std::unordered_map<uint32_t, std::shared_ptr<cp::Frame>> frames;
    uint32_t next = 1;
    std::atomic<uint32_t> outstanding{0}, dropped{0};
    std::mutex errorLock;
    std::string pendingError;
    uint32_t generation = 0;
};
struct Delivery { std::shared_ptr<cp::Frame> frame; State* state; uint32_t generation; };
napi_value object(napi_env env) { napi_value v; napi_create_object(env, &v); return v; }
void text(napi_env env, napi_value obj, const char* name, const std::string& value) {
    napi_value v; napi_create_string_utf8(env,value.c_str(),value.size(),&v); napi_set_named_property(env,obj,name,v);
}
void number(napi_env env, napi_value obj, const char* name, double value) {
    napi_value v; napi_create_double(env,value,&v); napi_set_named_property(env,obj,name,v);
}
State* stateOf(napi_env env) { State* s; napi_get_instance_data(env,reinterpret_cast<void**>(&s)); return s; }
void stop(State* s) {
    ++s->generation;
    if (s->capture) { s->capture->stop(); s->capture.reset(); }
    { std::lock_guard<std::mutex> guard(s->errorLock);s->pendingError.clear(); }
    if (s->callback) { napi_release_threadsafe_function(s->callback,napi_tsfn_release); s->callback=nullptr; }
}
void callJs(napi_env env, napi_value cb, void*, void* raw) {
    std::unique_ptr<Delivery> packet(static_cast<Delivery*>(raw));
    auto* s=packet->state;
    if (!env || !cb || packet->generation != s->generation) { --s->outstanding; return; }
    {
        std::lock_guard<std::mutex> guard(s->errorLock);
        if(!s->pendingError.empty()) {
            auto error=std::make_shared<cp::Frame>();error->error=std::move(s->pendingError);s->pendingError.clear();
            packet->frame=std::move(error);
        }
    }
    const auto& frame=*packet->frame;
    napi_value value=object(env);
    if (!frame.error.empty()) { text(env,value,"error",frame.error); --s->outstanding; }
    else {
        const uint32_t token=s->next++;
        s->frames.emplace(token,packet->frame);
        number(env,value,"token",token); number(env,value,"width",frame.width); number(env,value,"height",frame.height);
        number(env,value,"timestamp",frame.timestamp); number(env,value,"dropped",s->dropped.load());
        text(env,value,"pixelFormat",frame.format);
        auto color=object(env);
        text(env,color,"primaries",frame.primaries);text(env,color,"transfer",frame.transfer);
        text(env,color,"matrix",frame.matrix);text(env,color,"range",frame.range);
        napi_set_named_property(env,value,"colorSpace",color);
        auto handle=object(env);
        if(frame.surface) {
            napi_value pointer;
            napi_create_buffer_copy(env,sizeof(frame.surface),&frame.surface,nullptr,&pointer);
            napi_set_named_property(env,handle,"ioSurface",pointer);
        } else {
            auto pixmap=object(env);napi_value planes;
            napi_create_array_with_length(env,frame.planes.size(),&planes);
            for(size_t i=0;i<frame.planes.size();++i) {
                auto plane=object(env);const auto& p=frame.planes[i];
                number(env,plane,"fd",p.fd);number(env,plane,"stride",p.stride);
                number(env,plane,"offset",p.offset);number(env,plane,"size",static_cast<double>(p.size));
                napi_set_element(env,planes,i,plane);
            }
            napi_set_named_property(env,pixmap,"planes",planes);
            text(env,pixmap,"modifier","0"); // Linear V4L2 NV12/P010, never tiled memory.
            napi_value zeroCopy;napi_get_boolean(env,false,&zeroCopy);
            // Import support depends on the graphics driver; do not assert it.
            napi_set_named_property(env,pixmap,"supportsZeroCopyWebGpuImport",zeroCopy);
            napi_set_named_property(env,handle,"nativePixmap",pixmap);
        }
        napi_set_named_property(env,value,"handle",handle);
    }
    napi_value receiver,result;napi_get_undefined(env,&receiver);
    napi_call_function(env,receiver,cb,1,&value,&result);
}
std::string stringOption(napi_env env,napi_value obj,const char* key) {
    napi_value v;size_t length=0;
    if(napi_get_named_property(env,obj,key,&v)!=napi_ok || napi_get_value_string_utf8(env,v,nullptr,0,&length)!=napi_ok || length>1024)
        throw std::runtime_error("Invalid capture device");
    std::string out(length+1,'\0');napi_get_value_string_utf8(env,v,out.data(),out.size(),&length);out.resize(length);return out;
}
uint32_t intOption(napi_env env,napi_value obj,const char* key,uint32_t low,uint32_t high) {
    napi_value v;double n=0;
    if(napi_get_named_property(env,obj,key,&v)!=napi_ok || napi_get_value_double(env,v,&n)!=napi_ok || !(n>=low&&n<=high) || n!=static_cast<uint32_t>(n))
        throw std::runtime_error("Invalid capture dimensions or frame rate");
    return static_cast<uint32_t>(n);
}
napi_value start(napi_env env,napi_callback_info info) {
    auto* s=stateOf(env);size_t count=2;napi_value args[2];napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
    try {
        if(count!=2)throw std::runtime_error("Expected capture options and callback");
        napi_valuetype type;napi_typeof(env,args[1],&type);if(type!=napi_function)throw std::runtime_error("Expected frame callback");
        cp::Options opts{stringOption(env,args[0],"device"),intOption(env,args[0],"width",64,4096),intOption(env,args[0],"height",64,2160),intOption(env,args[0],"fps",1,120),false};
        napi_value hdr;napi_get_named_property(env,args[0],"hdr",&hdr);
        if(napi_get_value_bool(env,hdr,&opts.hdr)!=napi_ok)throw std::runtime_error("Expected HDR boolean");
        stop(s);napi_value name;napi_create_string_utf8(env,"Native capture",NAPI_AUTO_LENGTH,&name);
        ++s->references;
        if(napi_create_threadsafe_function(env,args[1],nullptr,name,1,1,s,
            [](napi_env,void* data,void*) { auto* state=static_cast<State*>(data);if(--state->references==0)delete state; },
            nullptr,callJs,&s->callback)!=napi_ok) {
            --s->references;throw std::runtime_error("Cannot create native frame callback");
        }
        const auto callback=s->callback;const auto generation=s->generation;
        s->capture=cp::openCapture(opts,[s,callback,generation](std::shared_ptr<cp::Frame> frame){
            // One queued notification, at most three retained frames across all
            // generations. Never block capture behind a slow renderer.
            const bool error=!frame->error.empty();
            if(error) { std::lock_guard<std::mutex> guard(s->errorLock);s->pendingError=frame->error; }
            if(s->outstanding.fetch_add(1)>=3&&!error) { --s->outstanding;++s->dropped;return; }
            auto* packet=new Delivery{std::move(frame),s,generation};
            if(napi_call_threadsafe_function(callback,packet,napi_tsfn_nonblocking)!=napi_ok) {
                delete packet;--s->outstanding;++s->dropped;
            }
        });
    } catch(const std::exception& e) { stop(s);napi_throw_error(env,nullptr,e.what()); }
    napi_value v;napi_get_undefined(env,&v);return v;
}
napi_value release(napi_env env,napi_callback_info info) {
    auto* s=stateOf(env);size_t count=1;napi_value arg;uint32_t token=0;napi_get_cb_info(env,info,&count,&arg,nullptr,nullptr);
    if(count==1&&napi_get_value_uint32(env,arg,&token)==napi_ok&&s->frames.erase(token))--s->outstanding;
    napi_value v;napi_get_undefined(env,&v);return v;
}
napi_value stopJs(napi_env env,napi_callback_info) { stop(stateOf(env));napi_value v;napi_get_undefined(env,&v);return v; }
napi_value inspect(napi_env env,napi_callback_info info) {
    size_t count=1;napi_value arg;napi_get_cb_info(env,info,&count,&arg,nullptr,nullptr);
    try {
        if(count!=1)throw std::runtime_error("Expected capture options");
        cp::Options opts{stringOption(env,arg,"device"),intOption(env,arg,"width",64,4096),intOption(env,arg,"height",64,2160),intOption(env,arg,"fps",1,120),false};
        const auto caps=cp::inspectCapture(opts);auto value=object(env);napi_value hdr;
        napi_get_boolean(env,caps.hdrInputPossible,&hdr);napi_set_named_property(env,value,"hdrInputPossible",hdr);
        text(env,value,"reason",caps.reason);return value;
    }catch(const std::exception& e) { napi_throw_error(env,nullptr,e.what());return nullptr; }
}
napi_value init(napi_env env,napi_value exports) {
    auto* s=new State;
    napi_add_env_cleanup_hook(env,[](void* data){stop(static_cast<State*>(data));},s);
    napi_set_instance_data(env,s,[](napi_env,void* data,void*) {
        // Cleanup stops producers first; TSFN finalizers retain state until any
        // queued teardown deliveries have released their native frame leases.
        auto* state=static_cast<State*>(data);state->frames.clear();
        if(--state->references==0)delete state;
    },nullptr);
    napi_property_descriptor methods[]={{"start",nullptr,start,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"stop",nullptr,stopJs,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"release",nullptr,release,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"inspect",nullptr,inspect,nullptr,nullptr,nullptr,napi_default,nullptr}};
    napi_define_properties(env,exports,4,methods);return exports;
}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
