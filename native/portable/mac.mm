#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>
#include "capture.h"
#include <atomic>
#include <cmath>
#include <algorithm>
#include <stdexcept>

@interface CPCaptureDelegate : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate>
@property(nonatomic, copy) void (^receive)(CMSampleBufferRef);
@end
@implementation CPCaptureDelegate
- (void)captureOutput:(AVCaptureOutput*)output didOutputSampleBuffer:(CMSampleBufferRef)sample fromConnection:(AVCaptureConnection*)connection {
    if(self.receive)self.receive(sample);
}
@end

namespace cp {
namespace {
bool attachment(CVPixelBufferRef image,CFStringRef key,CFStringRef expected) {
    CFTypeRef value=CVBufferGetAttachment(image,key,nullptr);return value&&CFEqual(value,expected);
}
class MacCapture final:public Capture {
    AVCaptureSession* session=nil;
    AVCaptureVideoDataOutput* output=nil;
    CPCaptureDelegate* delegate=nil;
    dispatch_queue_t queue=nullptr;
    std::atomic<bool> running{false}, reported{false};
    bool configuring=false;
    Options options;Deliver deliver;
    void error(const char* message) {
        if(reported.exchange(true))return;
        auto frame=std::make_shared<Frame>();frame->error=message;deliver(std::move(frame));
    }
    void receive(CMSampleBufferRef sample) {
        if(!running)return;
        @autoreleasepool {
            CVPixelBufferRef pixels=CMSampleBufferGetImageBuffer(sample);if(!pixels)return;
            const auto format=CVPixelBufferGetPixelFormatType(pixels);
            const bool p010=format==kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange;
            const bool nv12=format==kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange||format==kCVPixelFormatType_420YpCbCr8BiPlanarFullRange;
            if(!p010&&!nv12) { error("AVFoundation returned an unsupported capture pixel format.");return; }
            const bool pq=attachment(pixels,kCVImageBufferTransferFunctionKey,kCVImageBufferTransferFunction_SMPTE_ST_2084_PQ);
            const bool hlg=attachment(pixels,kCVImageBufferTransferFunctionKey,kCVImageBufferTransferFunction_ITU_R_2100_HLG);
            const bool bt2020=attachment(pixels,kCVImageBufferColorPrimariesKey,kCVImageBufferColorPrimaries_ITU_R_2020);
            if(options.hdr&&(!p010||!bt2020||(!pq&&!hlg))) {
                error("The macOS capture driver is not delivering tagged 10-bit HDR. HDR passthrough on the card does not imply HDR USB capture.");return;
            }
            if(!options.hdr&&(pq||hlg)) { error("The capture source is HDR. Enable HDR to interpret its color correctly.");return; }
            IOSurfaceRef surface=CVPixelBufferGetIOSurface(pixels);
            if(!surface) { error("AVFoundation returned a buffer without an IOSurface.");return; }
            auto frame=std::make_shared<Frame>();
            frame->width=static_cast<uint32_t>(CVPixelBufferGetWidth(pixels));frame->height=static_cast<uint32_t>(CVPixelBufferGetHeight(pixels));
            if(frame->width!=options.width||frame->height!=options.height) { error("The capture device changed resolution; select its new format and restart capture.");return; }
            frame->timestamp=CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))*1000000.0;
            frame->format=p010?"p010le":"nv12";frame->surface=reinterpret_cast<uintptr_t>(surface);
            if(options.hdr) { frame->primaries="bt2020";frame->transfer=pq?"pq":"hlg";frame->matrix="bt2020-ncl"; }
            else if(attachment(pixels,kCVImageBufferYCbCrMatrixKey,kCVImageBufferYCbCrMatrix_ITU_R_601_4)) {
                frame->primaries="smpte170m";frame->matrix="smpte170m";
            }
            if(format==kCVPixelFormatType_420YpCbCr8BiPlanarFullRange)frame->range="full";
            // Keep the actual CVPixelBuffer, not just the IOSurface, alive until
            // Chromium's GPU has finished. This prevents pool reuse mid-frame.
            CVPixelBufferRetain(pixels);frame->release=[pixels]{CVPixelBufferRelease(pixels);};
            deliver(std::move(frame));
        }
    }
public:
    MacCapture(Options o,Deliver d):options(std::move(o)),deliver(std::move(d)){}
    ~MacCapture() override { stop(); }
    void start() {
        @autoreleasepool {
            if([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo]!=AVAuthorizationStatusAuthorized)
                throw std::runtime_error("Camera access is required for native capture in macOS Privacy & Security.");
            AVCaptureDevice* selected=nil;
            // External cards and built-in cameras are both AVFoundation devices.
            for(AVCaptureDevice* candidate in [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo]) {
                if(options.device==candidate.uniqueID.UTF8String||options.device==candidate.localizedName.UTF8String) {
                    if(selected)throw std::runtime_error("Multiple macOS capture devices share this name.");selected=candidate;
                }
            }
            if(!selected)throw std::runtime_error("Selected AVFoundation capture device not found.");
            AVCaptureDeviceFormat* chosen=nil;double chosenFps=0;
            const OSType wanted=options.hdr?kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange:kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
            for(AVCaptureDeviceFormat* format in selected.formats) {
                const auto size=CMVideoFormatDescriptionGetDimensions(format.formatDescription);
                if(size.width!=options.width||size.height!=options.height)continue;
                // Do not convert an SDR capture into P010 and label it HDR.
                // HDR requires a native ten-bit format from the device itself.
                if(options.hdr&&CMFormatDescriptionGetMediaSubType(format.formatDescription)!=wanted)continue;
                for(AVFrameRateRange* range in format.videoSupportedFrameRateRanges) {
                    const double fps=std::min<double>(options.fps,range.maxFrameRate);
                    if(fps>=range.minFrameRate&&std::abs(fps-options.fps)<.5) {
                        if(!chosen||CMFormatDescriptionGetMediaSubType(format.formatDescription)==wanted) { chosen=format;chosenFps=fps; }
                    }
                }
            }
            if(!chosen)throw std::runtime_error(options.hdr?"This macOS capture device does not expose the requested P010 HDR mode.":"Requested capture resolution/frame rate is unavailable on macOS.");
            NSError* failure=nil;
            session=[[AVCaptureSession alloc] init];
            AVCaptureDeviceInput* input=[AVCaptureDeviceInput deviceInputWithDevice:selected error:&failure];
            if(!input)throw std::runtime_error(failure.localizedDescription.UTF8String?:"Cannot open capture input.");
            // InputPriority is iOS-only. On macOS configure the device format
            // directly, without assigning a preset that would replace it.
            [session beginConfiguration];configuring=true;
            if(![session canAddInput:input])throw std::runtime_error("Cannot add AVFoundation capture input.");
            [session addInput:input];
            if(![selected lockForConfiguration:&failure])throw std::runtime_error("Cannot configure AVFoundation capture device.");
            @try {
                selected.activeFormat=chosen;
                const CMTime duration=CMTimeMakeWithSeconds(1.0/chosenFps,1000000000);
                selected.activeVideoMinFrameDuration=duration;selected.activeVideoMaxFrameDuration=duration;
            } @finally { [selected unlockForConfiguration]; }
            output=[[AVCaptureVideoDataOutput alloc] init];
            output.alwaysDiscardsLateVideoFrames=YES;
            if(![session canAddOutput:output])throw std::runtime_error("Cannot add AVFoundation video output.");
            [session addOutput:output];
            if(![output.availableVideoCVPixelFormatTypes containsObject:@(wanted)])
                throw std::runtime_error("AVFoundation cannot export the selected NV12/P010 format.");
            output.videoSettings=@{(id)kCVPixelBufferPixelFormatTypeKey:@(wanted),
                (id)kCVPixelBufferIOSurfacePropertiesKey:@{}};
            queue=dispatch_queue_create("captureplayer.native.capture",DISPATCH_QUEUE_SERIAL);
            delegate=[[CPCaptureDelegate alloc] init];
            MacCapture* capture=this;delegate.receive=^(CMSampleBufferRef sample){capture->receive(sample);};
            [output setSampleBufferDelegate:delegate queue:queue];
            [session commitConfiguration];configuring=false;running=true;[session startRunning];
            if(!session.running)throw std::runtime_error("AVFoundation could not start capture.");
        }
    }
    void stop() override {
        running=false;
        [output setSampleBufferDelegate:nil queue:nullptr];
        if(queue)dispatch_sync(queue,^{});
        delegate.receive=nil;
        if(configuring) { [session commitConfiguration];configuring=false; }
        if(session.running)[session stopRunning];
        output=nil;delegate=nil;session=nil;queue=nullptr;
    }
};
}
std::shared_ptr<Capture> openCapture(const Options& o,Deliver deliver) {
    auto capture=std::make_shared<MacCapture>(o,std::move(deliver));
    @try { capture->start(); }
    @catch(NSException* exception) { throw std::runtime_error(exception.reason.UTF8String?:"AVFoundation configuration failed."); }
    return capture;
}
Capabilities inspectCapture(const Options& options) {
    @autoreleasepool {
        if([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo]!=AVAuthorizationStatusAuthorized)
            throw std::runtime_error("Camera access is required to inspect HDR formats.");
        for(AVCaptureDevice* device in [AVCaptureDevice devicesWithMediaType:AVMediaTypeVideo]) {
            if(options.device!=device.uniqueID.UTF8String&&options.device!=device.localizedName.UTF8String)continue;
            for(AVCaptureDeviceFormat* format in device.formats) {
                const auto size=CMVideoFormatDescriptionGetDimensions(format.formatDescription);
                if(size.width!=options.width||size.height!=options.height||
                    CMFormatDescriptionGetMediaSubType(format.formatDescription)!=kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange)continue;
                for(AVFrameRateRange* rate in format.videoSupportedFrameRateRanges)
                    if(rate.minFrameRate<=options.fps&&rate.maxFrameRate>=options.fps-.5)
                        return {true,"10-bit capture format available; incoming PQ/HLG tags are checked when capture starts."};
            }
            return {false,"This capture device does not expose 10-bit HDR at the selected resolution and frame rate on macOS."};
        }
        throw std::runtime_error("Select an available capture device first.");
    }
}
}
