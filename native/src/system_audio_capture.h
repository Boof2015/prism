#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace Prism::Capture {

struct Support {
    bool available = false;
    std::string reason;
};

struct ChannelDescriptor {
    uint32_t index = 0;
    std::string label;
};

struct ChannelRouting {
    uint32_t left = 0;
    uint32_t right = 1;
};

struct OutputDevice {
    std::string id;
    std::string label;
    double sampleRate = 48000.0;
    uint32_t channelCount = 2;
    bool isDefault = false;
    std::vector<ChannelDescriptor> channels;
};

struct StartResult {
    double sampleRate = 48000.0;
    uint32_t channelCount = 2;
    uint32_t sourceChannelCount = 2;
    std::string deviceId;
    std::string deviceLabel;
};

struct AudioChunk {
    std::vector<float> left;
    std::vector<float> right;
    uint32_t channelCount = 2;
    double capturedAtMilliseconds = 0.0;
    uint64_t sequence = 0;
};

struct DrainResult {
    std::vector<AudioChunk> chunks;
    uint64_t overwriteCount = 0;
    size_t queueDepth = 0;
};

class SystemAudioCapture {
public:
    virtual ~SystemAudioCapture() = default;

    virtual Support getSupport() const = 0;
    virtual std::vector<OutputDevice> listOutputDevices() = 0;
    virtual bool start(const std::string& requestedDeviceId,
                       StartResult* result,
                       std::string* errorMessage) = 0;
    virtual ChannelRouting setChannelRouting(uint32_t left, uint32_t right) {
        return {left, right};
    }
    virtual void stop() = 0;
    virtual DrainResult drain(size_t maxChunks = 64) = 0;
    virtual double nowMilliseconds() const = 0;
    virtual const char* backendName() const = 0;
};

std::unique_ptr<SystemAudioCapture> createSystemAudioCapture();

}  // namespace Prism::Capture
