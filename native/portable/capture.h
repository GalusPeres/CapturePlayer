#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace cp {
struct Options { std::string device; uint32_t width, height, fps; bool hdr; };
struct Capabilities { bool hdrInputPossible=false;std::string reason; };
struct Plane { int fd; uint32_t stride, offset; uint64_t size; };
struct Frame {
    uint32_t width = 0, height = 0;
    double timestamp = 0;
    std::string format = "nv12", primaries = "bt709", transfer = "bt709", matrix = "bt709", range = "limited";
    uintptr_t surface = 0;
    std::vector<Plane> planes;
    std::string error;
    std::function<void()> release;
    ~Frame() { if (release) release(); }
};
using Deliver = std::function<void(std::shared_ptr<Frame>)>;
class Capture {
public:
    virtual ~Capture() = default;
    virtual void stop() = 0;
};
std::shared_ptr<Capture> openCapture(const Options&, Deliver);
Capabilities inspectCapture(const Options&);
}
