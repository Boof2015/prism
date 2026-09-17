#pragma once

#include "device_input_capture.h"

#include <utility>

namespace Prism::Capture {

// A platform engine configured for input endpoints shares its buffering,
// routing, and lifecycle with the system-audio engine, but has its own instance.
class DeviceInputCaptureAdapter final : public DeviceInputCapture {
public:
    explicit DeviceInputCaptureAdapter(std::unique_ptr<SystemAudioCapture> engine)
        : engine_(std::move(engine)) {}

    Support getSupport() const override { return engine_->getSupport(); }
    std::vector<OutputDevice> listInputDevices() override { return engine_->listOutputDevices(); }
    bool start(const std::string& id, StartResult* result, std::string* error) override {
        return engine_->start(id, result, error);
    }
    ChannelRouting setChannelRouting(uint32_t left, uint32_t right) override {
        return engine_->setChannelRouting(left, right);
    }
    void stop() override { engine_->stop(); }
    DrainResult drain(size_t maxChunks) override { return engine_->drain(maxChunks); }
    double nowMilliseconds() const override { return engine_->nowMilliseconds(); }

private:
    std::unique_ptr<SystemAudioCapture> engine_;
};

inline ChannelRouting normalizeChannelRouting(ChannelRouting routing, uint32_t count) {
    if (count == 0 || routing.left >= count || routing.right >= count) {
        return {0, count > 1 ? 1u : 0u};
    }
    return routing;
}

}  // namespace Prism::Capture
