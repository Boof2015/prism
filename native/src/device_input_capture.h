#pragma once

#include "system_audio_capture.h"

#include <memory>

namespace Prism::Capture {

class DeviceInputCapture {
public:
    virtual ~DeviceInputCapture() = default;

    virtual Support getSupport() const = 0;
    virtual std::vector<OutputDevice> listInputDevices() = 0;
    virtual bool start(const std::string& requestedDeviceId,
                       StartResult* result,
                       std::string* errorMessage) = 0;
    virtual ChannelRouting setChannelRouting(uint32_t left, uint32_t right) = 0;
    virtual void stop() = 0;
    virtual DrainResult drain(size_t maxChunks = 64) = 0;
    virtual double nowMilliseconds() const = 0;
};

std::unique_ptr<DeviceInputCapture> createDeviceInputCapture();

}  // namespace Prism::Capture
