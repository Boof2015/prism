#include "device_input_capture.h"

#if !defined(__APPLE__)

namespace Prism::Capture {

class UnavailableDeviceInputCapture final : public DeviceInputCapture {
public:
    Support getSupport() const override {
        return {false, "Native multichannel device-input capture is currently available on macOS only."};
    }
    std::vector<OutputDevice> listInputDevices() override { return {}; }
    bool start(const std::string&, StartResult*, std::string* errorMessage) override {
        if (errorMessage != nullptr) *errorMessage = getSupport().reason;
        return false;
    }
    ChannelRouting setChannelRouting(uint32_t left, uint32_t right) override {
        return {left, right};
    }
    void stop() override {}
    DrainResult drain(size_t) override { return {}; }
    double nowMilliseconds() const override { return 0.0; }
};

std::unique_ptr<DeviceInputCapture> createDeviceInputCapture() {
    return std::make_unique<UnavailableDeviceInputCapture>();
}

}  // namespace Prism::Capture

#endif
