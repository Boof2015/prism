#include "system_audio_capture.h"
#include "capture_channel_selection.h"

#if defined(__APPLE__)

#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <deque>
#include <limits>
#include <mutex>
#include <string>
#include <vector>

namespace {

constexpr size_t kMaxQueuedChunks = 256;
constexpr size_t kDefaultDrainChunkLimit = 64;
constexpr AudioObjectID kUnknownObject = kAudioObjectUnknown;

struct OutputDeviceInfo {
    std::string uid;
    std::string label;
    double sampleRate;
    UInt32 channelCount;
    bool isDefault;
    std::vector<Prism::Capture::ChannelDescriptor> channels;
};

std::string cfStringToStdString(CFStringRef value);

std::vector<Prism::Capture::ChannelDescriptor> getChannelDescriptors(
    AudioDeviceID deviceId,
    AudioObjectPropertyScope scope,
    UInt32 channelCount) {
    std::vector<Prism::Capture::ChannelDescriptor> channels;
    channels.reserve(channelCount);
    for (UInt32 index = 0; index < channelCount; ++index) {
        std::string label = "Channel " + std::to_string(index + 1);
        AudioObjectPropertyAddress address{
            kAudioObjectPropertyElementName,
            scope,
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

struct CapturedChunk {
    std::vector<float> left;
    std::vector<float> right;
    UInt32 channelCount = 2;
    double capturedAtMilliseconds = 0.0;
    uint64_t sequence = 0;
};

double monotonicMilliseconds() {
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return std::chrono::duration<double, std::milli>(now).count();
}

std::string cfStringToStdString(CFStringRef value) {
    if (value == nullptr) {
        return {};
    }

    const CFIndex length = CFStringGetLength(value);
    const CFIndex maxBytes =
        CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    std::vector<char> buffer(static_cast<size_t>(std::max<CFIndex>(1, maxBytes)), '\0');

    if (!CFStringGetCString(value, buffer.data(), maxBytes, kCFStringEncodingUTF8)) {
        return {};
    }

    return std::string(buffer.data());
}

NSString* toNSString(const std::string& value) {
    return [[NSString alloc] initWithUTF8String:value.c_str()];
}

template <typename T>
bool getPropertyData(AudioObjectID objectId,
                     AudioObjectPropertySelector selector,
                     AudioObjectPropertyScope scope,
                     AudioObjectPropertyElement element,
                     T* outValue) {
    if (outValue == nullptr) {
        return false;
    }

    AudioObjectPropertyAddress address{
        selector,
        scope,
        element,
    };

    UInt32 size = sizeof(T);
    return AudioObjectGetPropertyData(objectId, &address, 0, nullptr, &size, outValue) == noErr;
}

bool getDeviceStringProperty(AudioDeviceID deviceId,
                             AudioObjectPropertySelector selector,
                             std::string* outValue) {
    if (outValue == nullptr) {
        return false;
    }

    AudioObjectPropertyAddress address{
        selector,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };

    CFStringRef stringValue = nullptr;
    UInt32 size = sizeof(stringValue);
    const OSStatus status =
        AudioObjectGetPropertyData(deviceId, &address, 0, nullptr, &size, &stringValue);
    if (status != noErr || stringValue == nullptr) {
        return false;
    }

    *outValue = cfStringToStdString(stringValue);
    CFRelease(stringValue);
    return !outValue->empty();
}

AudioDeviceID getDefaultOutputDeviceId() {
    AudioDeviceID deviceId = kUnknownObject;
    if (!getPropertyData(kAudioObjectSystemObject,
                         kAudioHardwarePropertyDefaultOutputDevice,
                         kAudioObjectPropertyScopeGlobal,
                         kAudioObjectPropertyElementMain,
                         &deviceId)) {
        return kUnknownObject;
    }
    return deviceId;
}

bool getDeviceNominalSampleRate(AudioDeviceID deviceId, double* outSampleRate) {
    if (outSampleRate == nullptr) {
        return false;
    }

    Float64 sampleRate = 0.0;
    if (!getPropertyData(deviceId,
                         kAudioDevicePropertyNominalSampleRate,
                         kAudioObjectPropertyScopeGlobal,
                         kAudioObjectPropertyElementMain,
                         &sampleRate)) {
        return false;
    }

    if (sampleRate <= 0.0) {
        return false;
    }

    *outSampleRate = static_cast<double>(sampleRate);
    return true;
}

UInt32 getOutputChannelCount(AudioDeviceID deviceId) {
    AudioObjectPropertyAddress address{
        kAudioDevicePropertyStreamConfiguration,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain,
    };

    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(deviceId, &address, 0, nullptr, &size) != noErr ||
        size == 0) {
        return 0;
    }

    std::vector<uint8_t> storage(size);
    auto* bufferList = reinterpret_cast<AudioBufferList*>(storage.data());
    if (AudioObjectGetPropertyData(deviceId, &address, 0, nullptr, &size, bufferList) !=
        noErr) {
        return 0;
    }

    UInt32 channelCount = 0;
    for (UInt32 index = 0; index < bufferList->mNumberBuffers; ++index) {
        channelCount += bufferList->mBuffers[index].mNumberChannels;
    }

    return channelCount;
}

std::vector<OutputDeviceInfo> enumerateOutputDevices() {
    AudioObjectPropertyAddress address{
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };

    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, nullptr, &size) !=
            noErr ||
        size == 0) {
        return {};
    }

    const UInt32 deviceCount = size / sizeof(AudioDeviceID);
    std::vector<AudioDeviceID> deviceIds(deviceCount, kUnknownObject);
    if (AudioObjectGetPropertyData(
            kAudioObjectSystemObject, &address, 0, nullptr, &size, deviceIds.data()) != noErr) {
        return {};
    }

    const AudioDeviceID defaultDeviceId = getDefaultOutputDeviceId();
    std::vector<OutputDeviceInfo> devices;
    devices.reserve(deviceCount);

    for (AudioDeviceID deviceId : deviceIds) {
        const UInt32 channelCount = getOutputChannelCount(deviceId);
        if (channelCount == 0) {
            continue;
        }

        std::string uid;
        if (!getDeviceStringProperty(deviceId, kAudioDevicePropertyDeviceUID, &uid)) {
            continue;
        }

        std::string label;
        if (!getDeviceStringProperty(deviceId, kAudioObjectPropertyName, &label)) {
            label = uid;
        }

        double sampleRate = 0.0;
        if (!getDeviceNominalSampleRate(deviceId, &sampleRate)) {
            sampleRate = 48000.0;
        }

        devices.push_back(OutputDeviceInfo{
            uid,
            label,
            sampleRate,
            channelCount,
            deviceId == defaultDeviceId,
            getChannelDescriptors(
                deviceId,
                kAudioDevicePropertyScopeOutput,
                channelCount),
        });
    }

    return devices;
}

bool getTapFormat(AudioObjectID tapId, AudioStreamBasicDescription* outFormat) {
    if (outFormat == nullptr) {
        return false;
    }

    AudioObjectPropertyAddress address{
        kAudioTapPropertyFormat,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain,
    };

    UInt32 size = sizeof(AudioStreamBasicDescription);
    return AudioObjectGetPropertyData(tapId, &address, 0, nullptr, &size, outFormat) == noErr;
}

std::string formatStatusMessage(const char* operation, OSStatus status) {
    return std::string(operation) + " failed (" + std::to_string(static_cast<int>(status)) + ")";
}

class MacOSNativeCaptureEngine final : public Prism::Capture::SystemAudioCapture {
public:
    ~MacOSNativeCaptureEngine() override {
        stop();
    }

    Prism::Capture::Support getSupport() const override {
        if (@available(macOS 14.2, *)) {
            return {true, {}};
        }
        return {false, "Native output-device capture requires macOS 14.2 or newer."};
    }

    std::vector<Prism::Capture::OutputDevice> listOutputDevices() override {
        std::vector<Prism::Capture::OutputDevice> result;
        if (!isSupported()) {
            return result;
        }
        const auto devices = enumerateOutputDevices();
        result.reserve(devices.size());
        for (const auto& device : devices) {
            result.push_back({
                device.uid,
                device.label,
                device.sampleRate,
                static_cast<uint32_t>(device.channelCount),
                device.isDefault,
                device.channels,
            });
        }
        return result;
    }

    bool start(const std::string& requestedDeviceId,
               Prism::Capture::StartResult* result,
               std::string* errorMessage) override {
        const auto support = getSupport();
        if (!support.available) {
            if (errorMessage != nullptr) {
                *errorMessage = support.reason;
            }
            return false;
        }
        if (!startInternal(requestedDeviceId, errorMessage)) {
            return false;
        }
        if (result != nullptr) {
            std::lock_guard<std::mutex> lock(stateMutex_);
            result->sampleRate = sampleRate_;
            const UInt32 sourceChannelCount = channelCount_.load(std::memory_order_relaxed);
            result->channelCount = sourceChannelCount > 1 ? 2u : 1u;
            result->sourceChannelCount = static_cast<uint32_t>(sourceChannelCount);
            result->deviceId = activeDeviceUid_;
            result->deviceLabel = activeDeviceLabel_;
        }
        return true;
    }

    Prism::Capture::ChannelRouting setChannelRouting(
        uint32_t left,
        uint32_t right) override {
        const UInt32 count = channelCount_.load(std::memory_order_relaxed);
        if (active_.load(std::memory_order_acquire) && count > 0) {
            left = std::min<uint32_t>(left, count - 1);
            right = std::min<uint32_t>(right, count - 1);
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
        const size_t drainLimit =
            maxChunks == 0 ? kDefaultDrainChunkLimit : std::min(maxChunks, kMaxQueuedChunks);
        std::deque<CapturedChunk> drained;
        Prism::Capture::DrainResult result;
        {
            std::lock_guard<std::mutex> queueLock(chunkMutex_);
            result.overwriteCount = overwriteCount_;
            const size_t count = std::min(drainLimit, chunkQueue_.size());
            for (size_t index = 0; index < count; ++index) {
                drained.push_back(std::move(chunkQueue_.front()));
                chunkQueue_.pop_front();
            }
            result.queueDepth = chunkQueue_.size();
        }
        result.chunks.reserve(drained.size());
        while (!drained.empty()) {
            auto chunk = std::move(drained.front());
            drained.pop_front();
            result.chunks.push_back({
                std::move(chunk.left),
                std::move(chunk.right),
                static_cast<uint32_t>(chunk.channelCount),
                chunk.capturedAtMilliseconds,
                chunk.sequence,
            });
        }
        return result;
    }

    double nowMilliseconds() const override {
        return monotonicMilliseconds();
    }

    const char* backendName() const override {
        return "CoreAudio";
    }

private:
    static OSStatus StaticIOProc(AudioObjectID inDevice,
                                 const AudioTimeStamp* inNow,
                                 const AudioBufferList* inInputData,
                                 const AudioTimeStamp* inInputTime,
                                 AudioBufferList* outOutputData,
                                 const AudioTimeStamp* inOutputTime,
                                 void* inClientData) {
        auto* self = static_cast<MacOSNativeCaptureEngine*>(inClientData);
        if (self == nullptr) {
            return noErr;
        }
        return self->handleIO(
            inDevice, inNow, inInputData, inInputTime, outOutputData, inOutputTime);
    }

    OSStatus handleIO(AudioObjectID,
                      const AudioTimeStamp*,
                      const AudioBufferList* inputData,
                      const AudioTimeStamp*,
                      AudioBufferList*,
                      const AudioTimeStamp*) {
        if (!active_.load(std::memory_order_acquire) || inputData == nullptr) return noErr;
        // tapFormat_ is configured before active_ is published and is not changed until
        // AudioDeviceStop has joined the callback, so the realtime path needs no state lock.
        const AudioStreamBasicDescription format = tapFormat_;
        const UInt32 channelCount = channelCount_.load(std::memory_order_relaxed);

        if (inputData->mNumberBuffers == 0 || format.mBytesPerFrame == 0) {
            return noErr;
        }

        const AudioBuffer& firstBuffer = inputData->mBuffers[0];
        const UInt32 bytesPerChannel = std::max<UInt32>(1, format.mBitsPerChannel / 8);
        const UInt32 firstBufferChannels = std::max<UInt32>(1, firstBuffer.mNumberChannels);
        const UInt32 frames = firstBuffer.mDataByteSize /
            std::max<UInt32>(1, bytesPerChannel * firstBufferChannels);
        if (frames == 0) {
            return noErr;
        }

        CapturedChunk chunk;
        chunk.channelCount = channelCount > 1 ? 2 : 1;
        chunk.capturedAtMilliseconds = monotonicMilliseconds();

        chunk.sequence = sequence_.fetch_add(1, std::memory_order_relaxed) + 1;

        chunk.left.resize(frames);
        chunk.right.resize(frames);

        const UInt32 leftChannel = std::min<UInt32>(
            routeLeft_.load(std::memory_order_acquire), channelCount - 1);
        const UInt32 rightChannel = std::min<UInt32>(
            routeRight_.load(std::memory_order_acquire), channelCount - 1);
        constexpr size_t kMaximumAudioBuffers = 128;
        if (inputData->mNumberBuffers > kMaximumAudioBuffers) return noErr;
        std::array<Prism::Capture::PCMBufferView, kMaximumAudioBuffers> buffers{};
        for (UInt32 bufferIndex = 0; bufferIndex < inputData->mNumberBuffers; ++bufferIndex) {
            const AudioBuffer& buffer = inputData->mBuffers[bufferIndex];
            buffers[bufferIndex] = {
                static_cast<const uint8_t*>(buffer.mData),
                buffer.mDataByteSize,
                buffer.mNumberChannels,
            };
        }
        const Prism::Capture::SampleEncoding encoding =
            (format.mFormatFlags & kAudioFormatFlagIsFloat) != 0
            ? Prism::Capture::SampleEncoding::Float
            : (format.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0
                ? Prism::Capture::SampleEncoding::SignedInteger
                : Prism::Capture::SampleEncoding::Unsupported;
        Prism::Capture::selectStereoChannels(
            buffers.data(),
            inputData->mNumberBuffers,
            {
                encoding,
                format.mBitsPerChannel,
                (format.mFormatFlags & kAudioFormatFlagIsBigEndian) != 0,
            },
            frames,
            channelCount,
            leftChannel,
            rightChannel,
            chunk.left.data(),
            chunk.right.data());

        {
            std::lock_guard<std::mutex> queueLock(chunkMutex_);
            if (chunkQueue_.size() >= kMaxQueuedChunks) {
                chunkQueue_.pop_front();
                ++overwriteCount_;
            }
            chunkQueue_.push_back(std::move(chunk));
        }

        return noErr;
    }

    bool startInternal(const std::string& requestedDeviceUid, std::string* outErrorMessage) {
        std::lock_guard<std::mutex> lock(stateMutex_);
        stopLocked();

        if (!isSupported()) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage =
                    "Native output-device capture requires macOS 14.2 or newer.";
            }
            return false;
        }

        const auto devices = enumerateOutputDevices();
        if (devices.empty()) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = "No macOS output devices are available.";
            }
            return false;
        }

        const OutputDeviceInfo* selected = nullptr;
        if (!requestedDeviceUid.empty()) {
            for (const auto& device : devices) {
                if (device.uid == requestedDeviceUid) {
                    selected = &device;
                    break;
                }
            }
            if (selected == nullptr) {
                if (outErrorMessage != nullptr) {
                    *outErrorMessage =
                        "The selected macOS output device is no longer available.";
                }
                return false;
            }
        } else {
            for (const auto& device : devices) {
                if (device.isDefault) {
                    selected = &device;
                    break;
                }
            }
            if (selected == nullptr) {
                selected = &devices.front();
            }
        }

        if (@available(macOS 14.2, *)) {
            @autoreleasepool {
                NSString* deviceUID = toNSString(selected->uid);
                NSString* deviceLabel = toNSString(selected->label);
                NSArray<NSNumber*>* excludedProcesses = @[];
                CATapDescription* tapDescription =
                    [[CATapDescription alloc] initExcludingProcesses:excludedProcesses
                                                         andDeviceUID:deviceUID
                                                           withStream:0];
                tapDescription.name = [NSString stringWithFormat:@"Prism Tap %@", deviceLabel];
                tapDescription.UUID = [NSUUID UUID];
                tapDescription.privateTap = YES;
                tapDescription.muteBehavior = CATapUnmuted;

                const OSStatus tapStatus =
                    AudioHardwareCreateProcessTap(tapDescription, &tapId_);
                if (tapStatus != noErr) {
                    if (outErrorMessage != nullptr) {
                        *outErrorMessage =
                            formatStatusMessage("AudioHardwareCreateProcessTap", tapStatus);
                    }
                    tapId_ = kUnknownObject;
                    return false;
                }

                NSString* aggregateUID = [NSString
                    stringWithFormat:@"com.astra.prism.capture.%@", [NSUUID UUID].UUIDString];
                NSDictionary* aggregateDescription = @{
                    [NSString stringWithUTF8String:kAudioAggregateDeviceNameKey]:
                        [NSString stringWithFormat:@"Prism Capture %@", deviceLabel],
                    [NSString stringWithUTF8String:kAudioAggregateDeviceUIDKey]: aggregateUID,
                    [NSString stringWithUTF8String:kAudioAggregateDeviceIsPrivateKey]: @YES,
                    [NSString stringWithUTF8String:kAudioAggregateDeviceMainSubDeviceKey]:
                        deviceUID,
                    [NSString stringWithUTF8String:kAudioAggregateDeviceTapAutoStartKey]: @YES,
                    [NSString stringWithUTF8String:kAudioAggregateDeviceSubDeviceListKey]: @[
                        @{
                            [NSString stringWithUTF8String:kAudioSubDeviceUIDKey]: deviceUID,
                            [NSString stringWithUTF8String:kAudioSubDeviceNameKey]: deviceLabel,
                            [NSString stringWithUTF8String:kAudioSubDeviceDriftCompensationKey]:
                                @YES,
                            [NSString
                                stringWithUTF8String:kAudioSubDeviceDriftCompensationQualityKey]:
                                @(kAudioAggregateDriftCompensationMediumQuality),
                        }
                    ],
                    [NSString stringWithUTF8String:kAudioAggregateDeviceTapListKey]: @[
                        @{
                            [NSString stringWithUTF8String:kAudioSubTapUIDKey]:
                                tapDescription.UUID.UUIDString,
                            [NSString stringWithUTF8String:kAudioSubTapDriftCompensationKey]:
                                @YES,
                            [NSString
                                stringWithUTF8String:kAudioSubTapDriftCompensationQualityKey]:
                                @(kAudioAggregateDriftCompensationMediumQuality),
                        }
                    ],
                };

                const OSStatus aggregateStatus = AudioHardwareCreateAggregateDevice(
                    (__bridge CFDictionaryRef)aggregateDescription, &aggregateDeviceId_);
                if (aggregateStatus != noErr) {
                    if (outErrorMessage != nullptr) {
                        *outErrorMessage = formatStatusMessage(
                            "AudioHardwareCreateAggregateDevice", aggregateStatus);
                    }
                    AudioHardwareDestroyProcessTap(tapId_);
                    tapId_ = kUnknownObject;
                    aggregateDeviceId_ = kUnknownObject;
                    return false;
                }
            }
        }

        if (!getTapFormat(tapId_, &tapFormat_)) {
            tapFormat_ = AudioStreamBasicDescription{};
            tapFormat_.mSampleRate = selected->sampleRate;
            tapFormat_.mChannelsPerFrame = std::max<UInt32>(2, selected->channelCount);
            tapFormat_.mBitsPerChannel = 32;
            tapFormat_.mBytesPerFrame =
                tapFormat_.mChannelsPerFrame * sizeof(Float32);
            tapFormat_.mFramesPerPacket = 1;
            tapFormat_.mBytesPerPacket =
                tapFormat_.mBytesPerFrame * tapFormat_.mFramesPerPacket;
            tapFormat_.mFormatID = kAudioFormatLinearPCM;
            tapFormat_.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
        }

        const OSStatus ioProcStatus =
            AudioDeviceCreateIOProcID(aggregateDeviceId_, StaticIOProc, this, &ioProcId_);
        if (ioProcStatus != noErr) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage =
                    formatStatusMessage("AudioDeviceCreateIOProcID", ioProcStatus);
            }
            stopLocked();
            return false;
        }

        const OSStatus startStatus = AudioDeviceStart(aggregateDeviceId_, ioProcId_);
        if (startStatus != noErr) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = formatStatusMessage("AudioDeviceStart", startStatus);
            }
            stopLocked();
            return false;
        }

        {
            std::lock_guard<std::mutex> queueLock(chunkMutex_);
            chunkQueue_.clear();
            overwriteCount_ = 0;
        }

        channelCount_.store(
            std::max<UInt32>(1, tapFormat_.mChannelsPerFrame > 0
                ? tapFormat_.mChannelsPerFrame
                : selected->channelCount),
            std::memory_order_relaxed);
        const UInt32 resolvedChannelCount = channelCount_.load(std::memory_order_relaxed);
        routeLeft_.store(
            std::min<UInt32>(routeLeft_.load(std::memory_order_relaxed), resolvedChannelCount - 1),
            std::memory_order_relaxed);
        routeRight_.store(
            std::min<UInt32>(routeRight_.load(std::memory_order_relaxed), resolvedChannelCount - 1),
            std::memory_order_relaxed);
        active_.store(true, std::memory_order_release);
        activeDeviceUid_ = selected->uid;
        activeDeviceLabel_ = selected->label;
        sampleRate_ = tapFormat_.mSampleRate > 0 ? tapFormat_.mSampleRate : selected->sampleRate;
        sequence_.store(0, std::memory_order_relaxed);
        return true;
    }

    void stopLocked() {
        active_.store(false, std::memory_order_release);

        if (aggregateDeviceId_ != kUnknownObject && ioProcId_ != nullptr) {
            AudioDeviceStop(aggregateDeviceId_, ioProcId_);
            AudioDeviceDestroyIOProcID(aggregateDeviceId_, ioProcId_);
            ioProcId_ = nullptr;
        }

        if (aggregateDeviceId_ != kUnknownObject) {
            AudioHardwareDestroyAggregateDevice(aggregateDeviceId_);
            aggregateDeviceId_ = kUnknownObject;
        }

        if (tapId_ != kUnknownObject) {
            if (@available(macOS 14.2, *)) {
                AudioHardwareDestroyProcessTap(tapId_);
            }
            tapId_ = kUnknownObject;
        }

        tapFormat_ = AudioStreamBasicDescription{};
        activeDeviceUid_.clear();
        activeDeviceLabel_.clear();
        sampleRate_ = 48000.0;
        channelCount_.store(2, std::memory_order_relaxed);
        sequence_.store(0, std::memory_order_relaxed);

        std::lock_guard<std::mutex> queueLock(chunkMutex_);
        chunkQueue_.clear();
        overwriteCount_ = 0;
    }

    bool isSupported() const {
        if (@available(macOS 14.2, *)) {
            return true;
        }
        return false;
    }

    mutable std::mutex stateMutex_;
    std::mutex chunkMutex_;
    std::deque<CapturedChunk> chunkQueue_;
    uint64_t overwriteCount_ = 0;
    std::atomic<uint64_t> sequence_{0};

    AudioObjectID tapId_ = kUnknownObject;
    AudioObjectID aggregateDeviceId_ = kUnknownObject;
    AudioDeviceIOProcID ioProcId_ = nullptr;
    AudioStreamBasicDescription tapFormat_{};

    std::atomic<bool> active_{false};
    std::string activeDeviceUid_;
    std::string activeDeviceLabel_;
    double sampleRate_ = 48000.0;
    std::atomic<UInt32> channelCount_{2};
    std::atomic<UInt32> routeLeft_{0};
    std::atomic<UInt32> routeRight_{1};
};

}  // namespace

namespace Prism::Capture {

std::unique_ptr<SystemAudioCapture> createSystemAudioCapture() {
    return std::make_unique<MacOSNativeCaptureEngine>();
}

}  // namespace Prism::Capture

#endif  // defined(__APPLE__)
