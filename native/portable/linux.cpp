#include "capture.h"
#include <linux/videodev2.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <poll.h>
#include <fcntl.h>
#include <unistd.h>
#include <atomic>
#include <cerrno>
#include <cstring>
#include <cmath>
#include <filesystem>
#include <mutex>
#include <stdexcept>
#include <thread>

#ifndef V4L2_PIX_FMT_P010
#define V4L2_PIX_FMT_P010 v4l2_fourcc('P','0','1','0')
#endif
namespace cp {
namespace {
int call(int fd,unsigned long request,void* arg) {
    int result;do { result=ioctl(fd,request,arg); }while(result<0&&errno==EINTR);return result;
}
void require(bool ok,const char* message) { if(!ok)throw std::runtime_error(std::string(message)+": "+strerror(errno)); }
struct Slot { int dma=-1;uint32_t size=0;void* mapped=MAP_FAILED; };
class LinuxCapture final:public Capture,public std::enable_shared_from_this<LinuxCapture> {
    int fd=-1;uint32_t width=0,height=0,stride=0,format=0;
    std::vector<Slot> slots;
    std::atomic<bool> running{false};std::thread worker;std::mutex deviceLock;
    Deliver deliver;Options options;
    std::string primaries="bt709",transfer="bt709",matrix="bt709",range="limited";
    void requeue(uint32_t index) {
        std::lock_guard<std::mutex> guard(deviceLock);
        if(!running)return;
        v4l2_buffer buffer={};buffer.type=V4L2_BUF_TYPE_VIDEO_CAPTURE;buffer.memory=V4L2_MEMORY_MMAP;buffer.index=index;
        if(call(fd,VIDIOC_QBUF,&buffer)<0)running=false;
    }
    void run() {
        try {
            while(running) {
                pollfd wait{fd,POLLIN,0};int ready=poll(&wait,1,100);
                if(ready<0&&errno==EINTR)continue;
                require(ready>=0,"V4L2 poll failed");if(!ready)continue;
                require(!(wait.revents&(POLLERR|POLLHUP|POLLNVAL)),"Capture device disconnected");
                v4l2_buffer latest={};bool have=false;
                // Drain already completed samples before delivery. Keep the
                // newest buffer, never build a queue of old console frames.
                for(size_t n=0;n<slots.size()&&running;++n) {
                    v4l2_buffer b={};b.type=V4L2_BUF_TYPE_VIDEO_CAPTURE;b.memory=V4L2_MEMORY_MMAP;
                    if(call(fd,VIDIOC_DQBUF,&b)<0) { if(errno==EAGAIN)break;require(false,"V4L2 dequeue failed"); }
                    require(b.index<slots.size(),"Invalid capture buffer index");
                    if(have)requeue(latest.index);
                    latest=b;have=true;
                }
                if(!have)continue;
                if(latest.flags&V4L2_BUF_FLAG_ERROR) { requeue(latest.index);continue; }
                auto frame=std::make_shared<Frame>();frame->width=width;frame->height=height;
                frame->timestamp=latest.timestamp.tv_sec*1000000.0+latest.timestamp.tv_usec;
                frame->format=format==V4L2_PIX_FMT_P010?"p010le":"nv12";
                frame->primaries=primaries;frame->transfer=transfer;frame->matrix=matrix;frame->range=range;
                const auto& slot=slots[latest.index];
                frame->planes={{slot.dma,stride,0,slot.size},{slot.dma,stride,stride*height,slot.size}};
                frame->release=[self=shared_from_this(),index=latest.index]{self->requeue(index);};
                deliver(std::move(frame));
            }
        }catch(const std::exception& e) {
            if(running) { auto error=std::make_shared<Frame>();error->error=e.what();deliver(std::move(error)); }
            running=false;
        }
    }
public:
    LinuxCapture(Options o,Deliver d):deliver(std::move(d)),options(std::move(o)){}
    ~LinuxCapture() override {
        stop();
        for(auto& s:slots) { if(s.mapped!=MAP_FAILED)munmap(s.mapped,s.size);if(s.dma>=0)close(s.dma); }
        if(fd>=0)close(fd);
    }
    void start() {
        // The browser's hashed deviceId is not a kernel path. Match the selected
        // device label to VIDIOC_QUERYCAP.card, rejecting ambiguous names.
        for(const auto& entry:std::filesystem::directory_iterator("/dev")) {
            const auto name=entry.path().filename().string();
            if(name.rfind("video",0)!=0)continue;
            int candidate=open(entry.path().c_str(),O_RDWR|O_NONBLOCK|O_CLOEXEC);if(candidate<0)continue;
            v4l2_capability cap={};
            const bool queried=call(candidate,VIDIOC_QUERYCAP,&cap)==0;
            const uint32_t caps=(cap.capabilities&V4L2_CAP_DEVICE_CAPS)?cap.device_caps:cap.capabilities;
            bool match=queried&&(caps&V4L2_CAP_VIDEO_CAPTURE)&&(caps&V4L2_CAP_STREAMING)&&
                (options.device==reinterpret_cast<char*>(cap.card)||options.device==entry.path().string());
            // Several UVC nodes can share a label; only accept one exposing
            // the requested uncompressed format, not its metadata node.
            bool supported=false;v4l2_fmtdesc f={};f.type=V4L2_BUF_TYPE_VIDEO_CAPTURE;
            while(match&&call(candidate,VIDIOC_ENUM_FMT,&f)==0) {
                supported|=f.pixelformat==(options.hdr?V4L2_PIX_FMT_P010:V4L2_PIX_FMT_NV12);++f.index;
            }
            if(match&&supported) {
                if(fd>=0) { close(candidate);throw std::runtime_error("Multiple capture nodes match this name; select a unique device."); }
                fd=candidate;
            }else close(candidate);
        }
        if(fd<0)throw std::runtime_error(options.hdr?"The selected Linux device does not expose P010 HDR capture.":"The selected Linux device does not expose native NV12 capture.");
        v4l2_format f={};f.type=V4L2_BUF_TYPE_VIDEO_CAPTURE;
        f.fmt.pix.width=options.width;f.fmt.pix.height=options.height;
        f.fmt.pix.pixelformat=options.hdr?V4L2_PIX_FMT_P010:V4L2_PIX_FMT_NV12;f.fmt.pix.field=V4L2_FIELD_NONE;
        require(call(fd,VIDIOC_S_FMT,&f)==0,"Cannot select native capture format");
        if(f.fmt.pix.width!=options.width||f.fmt.pix.height!=options.height||
           f.fmt.pix.pixelformat!=(options.hdr?V4L2_PIX_FMT_P010:V4L2_PIX_FMT_NV12))
            throw std::runtime_error("The driver cannot deliver the selected native resolution and format.");
        width=f.fmt.pix.width;height=f.fmt.pix.height;stride=f.fmt.pix.bytesperline;format=f.fmt.pix.pixelformat;
        if((width&1)||(height&1)||stride<width*(options.hdr?2:1)||uint64_t(stride)*height*3/2>f.fmt.pix.sizeimage)
            throw std::runtime_error("Unsupported NV12/P010 buffer layout.");
        if(options.hdr) { primaries="bt2020";transfer="pq";matrix="bt2020-ncl"; }
        else {
            const auto encoding=f.fmt.pix.ycbcr_enc==V4L2_YCBCR_ENC_DEFAULT?
                V4L2_MAP_YCBCR_ENC_DEFAULT(f.fmt.pix.colorspace):f.fmt.pix.ycbcr_enc;
            if(encoding==V4L2_YCBCR_ENC_601) { primaries="smpte170m";matrix="smpte170m"; }
            else if(encoding!=V4L2_YCBCR_ENC_709)throw std::runtime_error("Unsupported native SDR color matrix.");
            if(f.fmt.pix.quantization==V4L2_QUANTIZATION_FULL_RANGE)range="full";
        }
        v4l2_streamparm rate={};rate.type=f.type;rate.parm.capture.timeperframe={1,options.fps};
        require(call(fd,VIDIOC_S_PARM,&rate)==0,"Cannot select capture frame rate");
        const auto actual=rate.parm.capture.timeperframe;
        if(!actual.numerator||!actual.denominator||std::abs(double(actual.denominator)/actual.numerator-options.fps)>.5)
            throw std::runtime_error("The driver cannot deliver the selected frame rate.");
        v4l2_requestbuffers request={};request.type=f.type;request.memory=V4L2_MEMORY_MMAP;request.count=4;
        require(call(fd,VIDIOC_REQBUFS,&request)==0&&request.count>=3,"Cannot allocate capture buffers");
        slots.resize(request.count);
        for(uint32_t i=0;i<request.count;++i) {
            v4l2_buffer b={};b.type=f.type;b.memory=request.memory;b.index=i;
            require(call(fd,VIDIOC_QUERYBUF,&b)==0,"Cannot query capture buffer");
            auto& slot=slots[i];slot.size=b.length;
            if(slot.size<f.fmt.pix.sizeimage)throw std::runtime_error("Capture buffer is too small.");
            slot.mapped=mmap(nullptr,b.length,PROT_READ|PROT_WRITE,MAP_SHARED,fd,b.m.offset);
            require(slot.mapped!=MAP_FAILED,"Cannot map capture buffer");
            v4l2_exportbuffer exp={};exp.type=f.type;exp.index=i;exp.flags=O_CLOEXEC|O_RDWR;
            if(call(fd,VIDIOC_EXPBUF,&exp)<0)throw std::runtime_error("This Linux capture driver cannot export DMA-BUF textures. Native capture is unavailable for this device.");
            slot.dma=exp.fd;require(call(fd,VIDIOC_QBUF,&b)==0,"Cannot queue capture buffer");
        }
        auto type=V4L2_BUF_TYPE_VIDEO_CAPTURE;require(call(fd,VIDIOC_STREAMON,&type)==0,"Cannot start native capture");
        running=true;worker=std::thread([this]{run();});
    }
    void stop() override {
        running=false;if(worker.joinable())worker.join();
        std::lock_guard<std::mutex> guard(deviceLock);
        if(fd>=0) { auto type=V4L2_BUF_TYPE_VIDEO_CAPTURE;call(fd,VIDIOC_STREAMOFF,&type); }
    }
};
}
std::shared_ptr<Capture> openCapture(const Options& o,Deliver deliver) {
    auto capture=std::make_shared<LinuxCapture>(o,std::move(deliver));capture->start();return capture;
}
Capabilities inspectCapture(const Options& options) {
    bool found=false;
    for(const auto& entry:std::filesystem::directory_iterator("/dev")) {
        if(entry.path().filename().string().rfind("video",0)!=0)continue;
        int fd=open(entry.path().c_str(),O_RDONLY|O_NONBLOCK|O_CLOEXEC);if(fd<0)continue;
        v4l2_capability cap={};
        const bool match=call(fd,VIDIOC_QUERYCAP,&cap)==0&&
            (options.device==reinterpret_cast<char*>(cap.card)||options.device==entry.path().string());
        if(match) {
            found=true;v4l2_fmtdesc format={};format.type=V4L2_BUF_TYPE_VIDEO_CAPTURE;
            while(call(fd,VIDIOC_ENUM_FMT,&format)==0) {
                if(format.pixelformat==V4L2_PIX_FMT_P010) { close(fd);return {true,"P010 is advertised. Exact mode, DMA-BUF export and GPU import are checked at capture start."}; }
                ++format.index;
            }
        }
        close(fd);
    }
    if(!found)throw std::runtime_error("Select an accessible capture device first.");
    return {false,"This Linux capture driver does not advertise P010 HDR input."};
}
}
