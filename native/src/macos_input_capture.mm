#include "device_input_capture.h"

#if defined(__APPLE__)

#import <AudioToolbox/AudioToolbox.h>
#import <CoreAudio/CoreAudio.h>
#import <Foundation/Foundation.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

namespace {

constexpr size_t kMaxQueuedChunks = 256;
constexpr size_t kDefaultDrainChunkLimit = 64;
constexpr UInt32 kFallbackMaximumFramesPerSlice = 4096;
constexpr AudioObjectID kUnknownObject = kAudioObjectUnknown;

double monotonicMilliseconds() {
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return std::chrono::duration<double, std::milli>(now).count();
}

std::string cfStringToStdString(CFStringRef value) {
    if (value == nullptr) return {};
    const CFIndex length = CFStringGetLength(value);
    const CFIndex maxBytes =
        CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    std::vector<char> buffer(static_cast<size_t>(std::max<CFIndex>(1, maxBytes)), '\0');
    if (!CFStringGetCString(value, buffer.data(), maxBytes, kCFStringEncodingUTF8)) return {};
    return std::string(buffer.data());
}

template <typename T>
bool getPropertyData(AudioObjectID objectId,
                     AudioObjectPropertySelector selector,
                     AudioObjectPropertyScope scope,
                     AudioObjectPropertyElement element,
                     T* outValue) {
    if (outValue == nullptr) return false;
    AudioObjectPropertyAddress address{selector, scope, element};
    UInt32 size = sizeof(T);
    return AudioObjectGetPropertyData(objectId, &address, 0, nullptr, &size, outValue) == noErr;
}

bool getDeviceStringProperty(AudioDeviceID deviceId,
                             AudioObjectPropertySelector selector,
                             std::string* outValue) {
    if (outValue == nullptr) return false;
    AudioObjectPropertyAddress address{
        selector,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
    CFStringRef value = nullptr;
    UInt32 size = sizeof(value);
    if (AudioObjectGetPropertyData(deviceId, &address, 0, nullptr, &size, &value) != noErr
        || value == nullptr) {
        return false;
    }
    *outValue = cfStringToStdString(value);
    CFRelease(value);
    return !outValue->empty();
}

AudioDeviceID getDefaultInputDeviceId() {
    AudioDeviceID deviceId = kUnknownObject;
    getPropertyData(
        kAudioObjectSystemObject,
        kAudioHardwarePropertyDefaultInputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
        &deviceId);
    return deviceId;
}

UInt32 getInputChannelCount(AudioDeviceID deviceId) {
    AudioObjectPropertyAddress address{
        kAudioDevicePropertyStreamConfiguration,
        kAudioDevicePropertyScopeInput,
        kAudioObjectPropertyElementMain,
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(deviceId, &address, 0, nullptr, &size) != noErr
        || size == 0) {
        return 0;
    }
    std::vector<uint8_t> storage(size);
    auto* bufferList = reinterpret_cast<AudioBufferList*>(storage.data());
    if (AudioObjectGetPropertyData(deviceId, &address, 0, nullptr, &size, bufferList) != noErr) {
        return 0;
    }
    UInt32 count = 0;
    for (UInt32 index = 0; index < bufferList->mNumberBuffers; ++index) {
        count += bufferList->mBuffers[index].mNumberChannels;
    }
    return count;
}

double getDeviceSampleRate(AudioDeviceID deviceId) {
    Float64 sampleRate = 48000.0;
    if (!getPropertyData(
            deviceId,
            kAudioDevicePropertyNominalSampleRate,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain,
            &sampleRate)
        || sampleRate <= 0.0) {
        return 48000.0;
    }
    return static_cast<double>(sampleRate);
}

std::vector<Prism::Capture::ChannelDescriptor> getInputChannelDescriptors(
    AudioDeviceID deviceId,
    UInt32 channelCount) {
    std::vector<Prism::Capture::ChannelDescriptor> channels;
    channels.reserve(channelCount);
    for (UInt32 index = 0; index < channelCount; ++index) {
        std::string label = "Channel " + std::to_string(index + 1);
        AudioObjectPropertyAddress address{
            kAudioObjectPropertyElementName,
            kAudioDevicePropertyScopeInput,
            index + 1,
        };
        CFStringRef value = nullptr;
        UInt32 size = sizeof(value);
        if (AudioObjectGetPropertyData(deviceId, &address, 0, nullptr, &size, &value) == noErr
            && value != nullptr) {
            const std::string resolved = cfStringToStdString(value);
            CFRelease(value);
            if (!resolved.empty()) label = resolved;
        }
        channels.push_back({static_cast<uint32_t>(index), label});
    }
    return channels;
}

struct InputDeviceInfo {
    AudioDeviceID objectId = kUnknownObject;
    Prism::Capture::OutputDevice descriptor;
};

std::vector<InputDeviceInfo> enumerateInputDevices() {
    AudioObjectPropertyAddress address{
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &size) != noErr
        || size == 0) {
        return {};
    }
    std::vector<AudioDeviceID> ids(size / sizeof(AudioDeviceID), kUnknownObject);
    if (AudioObjectGetPropertyData(
            kAudioObjectSystemObject, &address, 0, nullptr, &size, ids.data()) != noErr) {
        return {};
    }

    const AudioDeviceID defaultId = getDefaultInputDeviceId();
    std::vector<InputDeviceInfo> devices;
    for (const AudioDeviceID id : ids) {
        const UInt32 channelCount = getInputChannelCount(id);
        if (channelCount == 0) continue;

        std::string uid;
        if (!getDeviceStringProperty(id, kAudioDevicePropertyDeviceUID, &uid)) continue;
        std::string label;
        if (!getDeviceStringProperty(id, kAudioObjectPropertyName, &label)) label = uid;

        devices.push_back({
            id,
            {
                uid,
                label,
                getDeviceSampleRate(id),
                static_cast<uint32_t>(channelCount),
                id == defaultId,
                getInputChannelDescriptors(id, channelCount),
            },
        });
    }
    return devices;
}

std::string formatStatusMessage(const char* operation, OSStatus status) {
    return std::string(operation) + " failed (" + std::to_string(static_cast<int>(status)) + ")";
}

class MacOSDeviceInputCapture final : public Prism::Capture::DeviceInputCapture {
public:
    ~MacOSDeviceInputCapture() override { stop(); }

    Prism::Capture::Support getSupport() const override { return {true, {}}; }

    std::vector<Prism::Capture::OutputDevice> listInputDevices() override {
        const auto devices = enumerateInputDevices();
        std::vector<Prism::Capture::OutputDevice> result;
        result.reserve(devices.size());
        for (const auto& device : devices) result.push_back(device.descriptor);
        return result;
    }

    bool start(const std::string& requestedDeviceId,
               Prism::Capture::StartResult* result,
               std::string* errorMessage) override {
        std::lock_guard<std::mutex> lock(stateMutex_);
        stopLocked();

        const auto devices = enumerateInputDevices();
        const InputDeviceInfo* selected = nullptr;
        if (!requestedDeviceId.empty()) {
            for (const auto& device : devices) {
                if (device.descriptor.id == requestedDeviceId) {
                    selected = &device;
                    break;
                }
            }
            if (selected == nullptr) {
                if (errorMessage != nullptr) {
                    *errorMessage = "The selected macOS input device is no longer available.";
                }
                return false;
            }
        } else {
            for (const auto& device : devices) {
                if (device.descriptor.isDefault) {
                    selected = &device;
                    break;
                }
            }
            if (selected == nullptr && !devices.empty()) selected = &devices.front();
        }
        if (selected == nullptr) {
            if (errorMessage != nullptr) *errorMessage = "No macOS input devices are available.";
            return false;
        }

        AudioComponentDescription description{};
        description.componentType = kAudioUnitType_Output;
        description.componentSubType = kAudioUnitSubType_HALOutput;
        description.componentManufacturer = kAudioUnitManufacturer_Apple;
        const AudioComponent component = AudioComponentFindNext(nullptr, &description);
        if (component == nullptr
            || AudioComponentInstanceNew(component, &audioUnit_) != noErr
            || audioUnit_ == nullptr) {
            if (errorMessage != nullptr) *errorMessage = "Could not create the Core Audio input unit.";
            stopLocked();
            return false;
        }

        UInt32 enabled = 1;
        OSStatus status = AudioUnitSetProperty(
            audioUnit_,
            kAudioOutputUnitProperty_EnableIO,
            kAudioUnitScope_Input,
            1,
            &enabled,
            sizeof(enabled));
        if (status == noErr) {
            enabled = 0;
            status = AudioUnitSetProperty(
                audioUnit_,
                kAudioOutputUnitProperty_EnableIO,
                kAudioUnitScope_Output,
                0,
                &enabled,
                sizeof(enabled));
        }
        if (status == noErr) {
            AudioDeviceID deviceId = selected->objectId;
            status = AudioUnitSetProperty(
                audioUnit_,
                kAudioOutputUnitProperty_CurrentDevice,
                kAudioUnitScope_Global,
                0,
                &deviceId,
                sizeof(deviceId));
        }

        sourceChannelCount_ = std::max<uint32_t>(1, selected->descriptor.channelCount);
        sampleRate_ = selected->descriptor.sampleRate;
        clientFormat_ = AudioStreamBasicDescription{};
        clientFormat_.mSampleRate = sampleRate_;
        clientFormat_.mFormatID = kAudioFormatLinearPCM;
        clientFormat_.mFormatFlags = kAudioFormatFlagIsFloat
            | kAudioFormatFlagIsPacked
            | kAudioFormatFlagIsNonInterleaved
            | kAudioFormatFlagsNativeEndian;
        clientFormat_.mBytesPerPacket = sizeof(Float32);
        clientFormat_.mFramesPerPacket = 1;
        clientFormat_.mBytesPerFrame = sizeof(Float32);
        clientFormat_.mChannelsPerFrame = sourceChannelCount_;
        clientFormat_.mBitsPerChannel = 8 * sizeof(Float32);

        if (status == noErr) {
            status = AudioUnitSetProperty(
                audioUnit_,
                kAudioUnitProperty_StreamFormat,
                kAudioUnitScope_Output,
                1,
                &clientFormat_,
                sizeof(clientFormat_));
        }

        AURenderCallbackStruct callback{};
        callback.inputProc = StaticInputCallback;
        callback.inputProcRefCon = this;
        if (status == noErr) {
            status = AudioUnitSetProperty(
                audioUnit_,
                kAudioOutputUnitProperty_SetInputCallback,
                kAudioUnitScope_Global,
                0,
                &callback,
                sizeof(callback));
        }
        if (status == noErr) status = AudioUnitInitialize(audioUnit_);
        if (status != noErr) {
            if (errorMessage != nullptr) {
                *errorMessage = formatStatusMessage("Configuring Core Audio input", status);
            }
            stopLocked();
            return false;
        }

        maximumFramesPerSlice_ = kFallbackMaximumFramesPerSlice;
        UInt32 propertySize = sizeof(maximumFramesPerSlice_);
        AudioUnitGetProperty(
            audioUnit_,
            kAudioUnitProperty_MaximumFramesPerSlice,
            kAudioUnitScope_Global,
            0,
            &maximumFramesPerSlice_,
            &propertySize);
        maximumFramesPerSlice_ = std::max<UInt32>(1, maximumFramesPerSlice_);
        prepareRenderBuffers();

        activeDeviceId_ = selected->descriptor.id;
        activeDeviceLabel_ = selected->descriptor.label;
        routeLeft_.store(
            std::min<uint32_t>(routeLeft_.load(std::memory_order_relaxed), sourceChannelCount_ - 1),
            std::memory_order_relaxed);
        routeRight_.store(
            std::min<uint32_t>(routeRight_.load(std::memory_order_relaxed), sourceChannelCount_ - 1),
            std::memory_order_relaxed);
        sequence_.store(0, std::memory_order_relaxed);
        {
            std::lock_guard<std::mutex> queueLock(queueMutex_);
            queue_.clear();
            overwriteCount_ = 0;
        }

        active_.store(true, std::memory_order_release);
        status = AudioOutputUnitStart(audioUnit_);
        if (status != noErr) {
            active_.store(false, std::memory_order_release);
            if (errorMessage != nullptr) {
                *errorMessage = formatStatusMessage("AudioOutputUnitStart", status);
            }
            stopLocked();
            return false;
        }

        if (result != nullptr) {
            result->sampleRate = sampleRate_;
            result->channelCount = sourceChannelCount_ > 1 ? 2u : 1u;
            result->sourceChannelCount = sourceChannelCount_;
            result->deviceId = activeDeviceId_;
            result->deviceLabel = activeDeviceLabel_;
        }
        return true;
    }

    Prism::Capture::ChannelRouting setChannelRouting(
        uint32_t left,
        uint32_t right) override {
        if (active_.load(std::memory_order_acquire) && sourceChannelCount_ > 0) {
            left = std::min<uint32_t>(left, sourceChannelCount_ - 1);
            right = std::min<uint32_t>(right, sourceChannelCount_ - 1);
        }
        routeLeft_.store(left, std::memory_order_release);
        routeRight_.store(right, std::memory_order_release);
        return {left, right};
    }

    void stop() override {
        std::lock_guard<std::mutex> lock(stateMutex_);
        stopLocked();
    }

    Prism::Capture::DrainResult drain(size_t maxChunks) override {
        const size_t limit = maxChunks == 0
            ? kDefaultDrainChunkLimit
            : std::min(maxChunks, kMaxQueuedChunks);
        Prism::Capture::DrainResult result;
        std::lock_guard<std::mutex> lock(queueMutex_);
        result.overwriteCount = overwriteCount_;
        const size_t count = std::min(limit, queue_.size());
        result.chunks.reserve(count);
        for (size_t index = 0; index < count; ++index) {
            result.chunks.push_back(std::move(queue_.front()));
            queue_.pop_front();
        }
        result.queueDepth = queue_.size();
        return result;
    }

    double nowMilliseconds() const override { return monotonicMilliseconds(); }

private:
    static OSStatus StaticInputCallback(void* refCon,
                                        AudioUnitRenderActionFlags* actionFlags,
                                        const AudioTimeStamp* timestamp,
                                        UInt32,
                                        UInt32 frameCount,
                                        AudioBufferList*) {
        auto* self = static_cast<MacOSDeviceInputCapture*>(refCon);
        return self == nullptr
            ? noErr
            : self->captureInput(actionFlags, timestamp, frameCount);
    }

    OSStatus captureInput(AudioUnitRenderActionFlags* actionFlags,
                          const AudioTimeStamp* timestamp,
                          UInt32 frameCount) {
        if (!active_.load(std::memory_order_acquire) || audioUnit_ == nullptr) return noErr;
        if (frameCount == 0 || frameCount > maximumFramesPerSlice_ || renderBufferList_ == nullptr) {
            return noErr;
        }

        for (UInt32 index = 0; index < sourceChannelCount_; ++index) {
            renderBufferList_->mBuffers[index].mDataByteSize = frameCount * sizeof(Float32);
        }
        const OSStatus status = AudioUnitRender(
            audioUnit_, actionFlags, timestamp, 1, frameCount, renderBufferList_);
        if (status != noErr) return status;

        const uint32_t leftChannel = std::min<uint32_t>(
            routeLeft_.load(std::memory_order_acquire), sourceChannelCount_ - 1);
        const uint32_t rightChannel = std::min<uint32_t>(
            routeRight_.load(std::memory_order_acquire), sourceChannelCount_ - 1);
        const auto* left = static_cast<const Float32*>(renderBufferList_->mBuffers[leftChannel].mData);
        const auto* right = static_cast<const Float32*>(renderBufferList_->mBuffers[rightChannel].mData);

        Prism::Capture::AudioChunk chunk;
        chunk.left.assign(left, left + frameCount);
        chunk.right.assign(right, right + frameCount);
        chunk.channelCount = sourceChannelCount_ > 1 ? 2u : 1u;
        chunk.capturedAtMilliseconds = monotonicMilliseconds();
        chunk.sequence = sequence_.fetch_add(1, std::memory_order_relaxed) + 1;

        std::lock_guard<std::mutex> lock(queueMutex_);
        if (queue_.size() >= kMaxQueuedChunks) {
            queue_.pop_front();
            ++overwriteCount_;
        }
        queue_.push_back(std::move(chunk));
        return noErr;
    }

    void prepareRenderBuffers() {
        const size_t listBytes = offsetof(AudioBufferList, mBuffers)
            + sizeof(AudioBuffer) * sourceChannelCount_;
        renderBufferListStorage_.assign(listBytes, 0);
        renderBufferList_ = reinterpret_cast<AudioBufferList*>(renderBufferListStorage_.data());
        renderBufferList_->mNumberBuffers = sourceChannelCount_;
        renderSampleStorage_.assign(
            static_cast<size_t>(sourceChannelCount_) * maximumFramesPerSlice_,
            0.0f);
        for (UInt32 index = 0; index < sourceChannelCount_; ++index) {
            auto& buffer = renderBufferList_->mBuffers[index];
            buffer.mNumberChannels = 1;
            buffer.mDataByteSize = maximumFramesPerSlice_ * sizeof(Float32);
            buffer.mData = renderSampleStorage_.data()
                + static_cast<size_t>(index) * maximumFramesPerSlice_;
        }
    }

    void stopLocked() {
        active_.store(false, std::memory_order_release);
        if (audioUnit_ != nullptr) {
            AudioOutputUnitStop(audioUnit_);
            AudioUnitUninitialize(audioUnit_);
            AudioComponentInstanceDispose(audioUnit_);
            audioUnit_ = nullptr;
        }
        renderBufferList_ = nullptr;
        renderBufferListStorage_.clear();
        renderSampleStorage_.clear();
        activeDeviceId_.clear();
        activeDeviceLabel_.clear();
        sampleRate_ = 48000.0;
        sourceChannelCount_ = 2;
        maximumFramesPerSlice_ = kFallbackMaximumFramesPerSlice;
        sequence_.store(0, std::memory_order_relaxed);
        std::lock_guard<std::mutex> queueLock(queueMutex_);
        queue_.clear();
        overwriteCount_ = 0;
    }

    mutable std::mutex stateMutex_;
    std::mutex queueMutex_;
    std::deque<Prism::Capture::AudioChunk> queue_;
    uint64_t overwriteCount_ = 0;
    std::atomic<uint64_t> sequence_{0};
    std::atomic<bool> active_{false};
    std::atomic<uint32_t> routeLeft_{0};
    std::atomic<uint32_t> routeRight_{1};

    AudioUnit audioUnit_ = nullptr;
    AudioStreamBasicDescription clientFormat_{};
    std::vector<uint8_t> renderBufferListStorage_;
    std::vector<Float32> renderSampleStorage_;
    AudioBufferList* renderBufferList_ = nullptr;
    UInt32 maximumFramesPerSlice_ = kFallbackMaximumFramesPerSlice;
    uint32_t sourceChannelCount_ = 2;
    double sampleRate_ = 48000.0;
    std::string activeDeviceId_;
    std::string activeDeviceLabel_;
};

}  // namespace

namespace Prism::Capture {

std::unique_ptr<DeviceInputCapture> createDeviceInputCapture() {
    return std::make_unique<MacOSDeviceInputCapture>();
}

}  // namespace Prism::Capture

#endif
