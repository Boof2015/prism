#include "macos_capture.h"

#if defined(__APPLE__)

#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
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
};

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

float decodeSignedIntegerSample(const uint8_t* data, UInt32 bytesPerSample, bool isBigEndian) {
    if (data == nullptr || bytesPerSample == 0 || bytesPerSample > 4) {
        return 0.0f;
    }

    int32_t rawValue = 0;
    if (isBigEndian) {
        for (UInt32 byteIndex = 0; byteIndex < bytesPerSample; ++byteIndex) {
            rawValue = (rawValue << 8) | data[byteIndex];
        }
    } else {
        for (UInt32 byteIndex = 0; byteIndex < bytesPerSample; ++byteIndex) {
            rawValue |= static_cast<int32_t>(data[byteIndex]) << (byteIndex * 8);
        }
    }

    const UInt32 totalBits = bytesPerSample * 8;
    const int32_t signMask = 1 << (totalBits - 1);
    if ((rawValue & signMask) != 0) {
        rawValue |= ~((1 << totalBits) - 1);
    }

    const double maxMagnitude = static_cast<double>((1u << (totalBits - 1)) - 1u);
    if (maxMagnitude <= 0.0) {
        return 0.0f;
    }

    return static_cast<float>(static_cast<double>(rawValue) / maxMagnitude);
}

float readSampleFromFormat(const uint8_t* data,
                           const AudioStreamBasicDescription& format,
                           UInt32 sampleIndex) {
    if (data == nullptr) {
        return 0.0f;
    }

    const UInt32 bytesPerChannel = format.mBitsPerChannel / 8;
    if (bytesPerChannel == 0) {
        return 0.0f;
    }

    const uint8_t* samplePtr = data + static_cast<size_t>(sampleIndex) * bytesPerChannel;
    const bool isFloat = (format.mFormatFlags & kAudioFormatFlagIsFloat) != 0;
    const bool isBigEndian = (format.mFormatFlags & kAudioFormatFlagIsBigEndian) != 0;

    if (isFloat && format.mBitsPerChannel == 32) {
        Float32 value = 0.0f;
        std::memcpy(&value, samplePtr, sizeof(Float32));
        return value;
    }

    if (isFloat && format.mBitsPerChannel == 64) {
        Float64 value = 0.0;
        std::memcpy(&value, samplePtr, sizeof(Float64));
        return static_cast<float>(value);
    }

    if ((format.mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0) {
        return decodeSignedIntegerSample(samplePtr, bytesPerChannel, isBigEndian);
    }

    return 0.0f;
}

bool isFormatInterleaved(const AudioStreamBasicDescription& format) {
    return (format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) == 0;
}

std::string formatStatusMessage(const char* operation, OSStatus status) {
    return std::string(operation) + " failed (" + std::to_string(static_cast<int>(status)) + ")";
}

class MacOSNativeCaptureEngine {
public:
    Napi::Object GetSupport(Napi::Env env) {
        Napi::Object support = Napi::Object::New(env);

        if (@available(macOS 14.2, *)) {
            support.Set("available", Napi::Boolean::New(env, true));
            support.Set("reason", env.Null());
            return support;
        }

        support.Set("available", Napi::Boolean::New(env, false));
        support.Set(
            "reason",
            Napi::String::New(env, "Native output-device capture requires macOS 14.2 or newer."));
        return support;
    }

    Napi::Array ListOutputDevices(Napi::Env env) {
        Napi::Array result = Napi::Array::New(env);
        if (!isSupported()) {
            return result;
        }

        const auto devices = enumerateOutputDevices();
        for (size_t index = 0; index < devices.size(); ++index) {
            const auto& device = devices[index];
            Napi::Object entry = Napi::Object::New(env);
            entry.Set("id", Napi::String::New(env, device.uid));
            entry.Set("label", Napi::String::New(env, device.label));
            entry.Set("kind", Napi::String::New(env, "system"));
            entry.Set("isDefault", Napi::Boolean::New(env, device.isDefault));
            entry.Set("sampleRate", Napi::Number::New(env, device.sampleRate));
            entry.Set(
                "channelCount",
                Napi::Number::New(env, static_cast<double>(device.channelCount)));
            result.Set(static_cast<uint32_t>(index), entry);
        }

        return result;
    }

    Napi::Object Start(Napi::Env env, const std::string& requestedDeviceUid) {
        Napi::Object result = Napi::Object::New(env);

        const Napi::Object support = GetSupport(env);
        if (!support.Get("available").As<Napi::Boolean>().Value()) {
            Napi::Error::New(
                env, support.Get("reason").As<Napi::String>().Utf8Value())
                .ThrowAsJavaScriptException();
            return result;
        }

        std::string errorMessage;
        if (!startInternal(requestedDeviceUid, &errorMessage)) {
            Napi::Error::New(env, errorMessage).ThrowAsJavaScriptException();
            return result;
        }

        std::lock_guard<std::mutex> lock(stateMutex_);
        result.Set("sampleRate", Napi::Number::New(env, sampleRate_));
        result.Set("channelCount", Napi::Number::New(env, static_cast<double>(channelCount_)));
        result.Set("deviceId", Napi::String::New(env, activeDeviceUid_));
        result.Set("deviceLabel", Napi::String::New(env, activeDeviceLabel_));
        return result;
    }

    void Stop() {
        std::lock_guard<std::mutex> lock(stateMutex_);
        stopLocked();
    }

    Napi::Object Drain(Napi::Env env, size_t maxChunks) {
        const size_t drainLimit =
            maxChunks == 0 ? kDefaultDrainChunkLimit : std::min(maxChunks, kMaxQueuedChunks);

        std::deque<CapturedChunk> drained;
        uint64_t overwriteCount = 0;

        {
            std::lock_guard<std::mutex> queueLock(chunkMutex_);
            overwriteCount = overwriteCount_;
            const size_t count = std::min(drainLimit, chunkQueue_.size());
            for (size_t index = 0; index < count; ++index) {
                drained.push_back(std::move(chunkQueue_.front()));
                chunkQueue_.pop_front();
            }
        }

        Napi::Array chunks = Napi::Array::New(env, drained.size());
        for (size_t index = 0; index < drained.size(); ++index) {
            CapturedChunk& chunk = drained[index];
            Napi::Object entry = Napi::Object::New(env);
            Napi::Float32Array left =
                Napi::Float32Array::New(env, chunk.left.size());
            Napi::Float32Array right =
                Napi::Float32Array::New(env, chunk.right.size());
            if (!chunk.left.empty()) {
                std::memcpy(
                    left.Data(), chunk.left.data(), chunk.left.size() * sizeof(float));
            }
            if (!chunk.right.empty()) {
                std::memcpy(
                    right.Data(), chunk.right.data(), chunk.right.size() * sizeof(float));
            }
            entry.Set("left", left);
            entry.Set("right", right);
            entry.Set(
                "channelCount",
                Napi::Number::New(env, static_cast<double>(chunk.channelCount)));
            entry.Set(
                "capturedAtMilliseconds",
                Napi::Number::New(env, chunk.capturedAtMilliseconds));
            entry.Set(
                "sequence",
                Napi::Number::New(env, static_cast<double>(chunk.sequence)));
            chunks.Set(static_cast<uint32_t>(index), entry);
        }

        Napi::Object result = Napi::Object::New(env);
        result.Set("chunks", chunks);
        result.Set(
            "overwriteCount",
            Napi::Number::New(env, static_cast<double>(overwriteCount)));
        result.Set(
            "queueDepth",
            Napi::Number::New(env, static_cast<double>(chunkQueue_.size())));
        return result;
    }

    double NowMilliseconds() const {
        return monotonicMilliseconds();
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
        AudioStreamBasicDescription format{};
        UInt32 channelCount = 0;

        {
            std::lock_guard<std::mutex> stateLock(stateMutex_);
            if (!active_ || inputData == nullptr) {
                return noErr;
            }
            format = tapFormat_;
            channelCount = channelCount_;
        }

        if (inputData->mNumberBuffers == 0 || format.mBytesPerFrame == 0) {
            return noErr;
        }

        const bool interleaved = isFormatInterleaved(format);
        const AudioBuffer& firstBuffer = inputData->mBuffers[0];
        const UInt32 frames =
            format.mBytesPerFrame == 0 ? 0 : firstBuffer.mDataByteSize / format.mBytesPerFrame;
        if (frames == 0) {
            return noErr;
        }

        CapturedChunk chunk;
        chunk.channelCount = channelCount;
        chunk.capturedAtMilliseconds = monotonicMilliseconds();

        {
            std::lock_guard<std::mutex> stateLock(stateMutex_);
            chunk.sequence = ++sequence_;
        }

        chunk.left.resize(frames);
        chunk.right.resize(frames);

        if (interleaved) {
            const uint8_t* rawData = static_cast<const uint8_t*>(firstBuffer.mData);
            for (UInt32 frameIndex = 0; frameIndex < frames; ++frameIndex) {
                const UInt32 sampleBaseIndex = frameIndex * std::max<UInt32>(1, channelCount);
                const float leftSample =
                    readSampleFromFormat(rawData, format, sampleBaseIndex);
                const float rightSample = channelCount > 1
                    ? readSampleFromFormat(rawData, format, sampleBaseIndex + 1)
                    : leftSample;
                chunk.left[frameIndex] = leftSample;
                chunk.right[frameIndex] = rightSample;
            }
        } else {
            const uint8_t* leftData = static_cast<const uint8_t*>(inputData->mBuffers[0].mData);
            const uint8_t* rightData = static_cast<const uint8_t*>(
                inputData->mNumberBuffers > 1 ? inputData->mBuffers[1].mData
                                              : inputData->mBuffers[0].mData);

            for (UInt32 frameIndex = 0; frameIndex < frames; ++frameIndex) {
                chunk.left[frameIndex] =
                    readSampleFromFormat(leftData, format, frameIndex);
                chunk.right[frameIndex] = inputData->mNumberBuffers > 1
                    ? readSampleFromFormat(rightData, format, frameIndex)
                    : chunk.left[frameIndex];
            }
        }

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

        active_ = true;
        activeDeviceUid_ = selected->uid;
        activeDeviceLabel_ = selected->label;
        sampleRate_ = tapFormat_.mSampleRate > 0 ? tapFormat_.mSampleRate : selected->sampleRate;
        channelCount_ =
            std::max<UInt32>(1, tapFormat_.mChannelsPerFrame > 0 ? tapFormat_.mChannelsPerFrame
                                                                 : selected->channelCount);
        sequence_ = 0;
        return true;
    }

    void stopLocked() {
        active_ = false;

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
        channelCount_ = 2;
        sequence_ = 0;

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
    uint64_t sequence_ = 0;

    AudioObjectID tapId_ = kUnknownObject;
    AudioObjectID aggregateDeviceId_ = kUnknownObject;
    AudioDeviceIOProcID ioProcId_ = nullptr;
    AudioStreamBasicDescription tapFormat_{};

    bool active_ = false;
    std::string activeDeviceUid_;
    std::string activeDeviceLabel_;
    double sampleRate_ = 48000.0;
    UInt32 channelCount_ = 2;
};

MacOSNativeCaptureEngine& engine() {
    static MacOSNativeCaptureEngine instance;
    return instance;
}

Napi::Value MacOSGetSupport(const Napi::CallbackInfo& info) {
    return engine().GetSupport(info.Env());
}

Napi::Value MacOSListOutputDevices(const Napi::CallbackInfo& info) {
    return engine().ListOutputDevices(info.Env());
}

Napi::Value MacOSStart(const Napi::CallbackInfo& info) {
    std::string requestedDeviceUid;
    if (info.Length() >= 1 && info[0].IsString()) {
        requestedDeviceUid = info[0].As<Napi::String>().Utf8Value();
    }
    return engine().Start(info.Env(), requestedDeviceUid);
}

Napi::Value MacOSStop(const Napi::CallbackInfo& info) {
    engine().Stop();
    return info.Env().Undefined();
}

Napi::Value MacOSDrain(const Napi::CallbackInfo& info) {
    size_t maxChunks = kDefaultDrainChunkLimit;
    if (info.Length() >= 1 && info[0].IsNumber()) {
        const int64_t requested = info[0].As<Napi::Number>().Int64Value();
        if (requested > 0) {
            maxChunks = static_cast<size_t>(requested);
        }
    }
    return engine().Drain(info.Env(), maxChunks);
}

Napi::Value MacOSNowMilliseconds(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine().NowMilliseconds());
}

}  // namespace

void RegisterMacOSCapture(Napi::Env env, Napi::Object exports) {
    Napi::Object captureExports = Napi::Object::New(env);
    captureExports.Set("getSupport", Napi::Function::New(env, MacOSGetSupport));
    captureExports.Set(
        "listOutputDevices", Napi::Function::New(env, MacOSListOutputDevices));
    captureExports.Set("start", Napi::Function::New(env, MacOSStart));
    captureExports.Set("stop", Napi::Function::New(env, MacOSStop));
    captureExports.Set("drain", Napi::Function::New(env, MacOSDrain));
    captureExports.Set(
        "nowMilliseconds", Napi::Function::New(env, MacOSNowMilliseconds));
    exports.Set("macosCapture", captureExports);
}

#endif  // defined(__APPLE__)
