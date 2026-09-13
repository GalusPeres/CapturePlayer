// Test backend only: exercises callback threading and frame ownership without
// loading AVFoundation, opening a capture card, or submitting a GPU texture.
#include "capture.h"
#include <atomic>
#include <chrono>
#include <stdexcept>
#include <thread>
namespace cp {
class MockCapture final:public Capture {
    std::atomic<bool> running{true};std::thread worker;
public:
    MockCapture(Options options,Deliver deliver) {
        worker=std::thread([this,options,deliver]{
            for(unsigned n=0;running;++n) {
                auto frame=std::make_shared<Frame>();frame->width=options.width;frame->height=options.height;
                frame->timestamp=n;frame->surface=1; // Never pass this fixture to Electron's importer.
                if(options.device=="error"&&n==10)frame->error="test capture disconnected";
                deliver(std::move(frame));
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        });
    }
    ~MockCapture() override { stop(); }
    void stop() override { running=false;if(worker.joinable())worker.join(); }
};
std::shared_ptr<Capture> openCapture(const Options& options,Deliver deliver) {
    if(options.device=="fail")throw std::runtime_error("test open failed");
    return std::make_shared<MockCapture>(options,std::move(deliver));
}
Capabilities inspectCapture(const Options&) { return {true,"Test fixture only"}; }
}
