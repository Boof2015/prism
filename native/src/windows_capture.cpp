#include "windows_capture.h"

#if defined(_WIN32)

#include <Audioclient.h>
#include <propkeydef.h>
#include <Functiondiscoverykeys_devpkey.h>
#include <Mmdeviceapi.h>
#include <ksmedia.h>
#include <mmreg.h>
#include <propidl.h>
#include <avrt.h>
#include <roapi.h>
#include <wrl/client.h>
#include <windows.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Media.Control.h>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <deque>
#include <limits>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

using Microsoft::WRL::ComPtr;
using winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSession;
using winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
using winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;

constexpr size_t kMaxQueuedChunks = 256;
constexpr size_t kDefaultDrainChunkLimit = 64;

struct OutputDeviceInfo {
    std::string id;
    std::string label;
    double sampleRate;
    UINT32 channelCount;
    bool isDefault;
};

struct CapturedChunk {
    std::vector<float> left;
    std::vector<float> right;
    UINT32 channelCount = 2;
    double capturedAtMilliseconds = 0.0;
    uint64_t sequence = 0;
};

struct AudioFormatInfo {
    bool valid = false;
    bool isFloat = false;
    WORD channels = 0;
    DWORD sampleRate = 48000;
    WORD bitsPerSample = 0;
    WORD validBitsPerSample = 0;
    WORD bytesPerFrame = 0;
    WORD bytesPerSample = 0;
};

double monotonicMilliseconds() {
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return std::chrono::duration<double, std::milli>(now).count();
}

std::string wideToUtf8(const std::wstring& value) {
    if (value.empty()) {
        return {};
    }

    const int sizeNeeded = WideCharToMultiByte(
        CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (sizeNeeded <= 0) {
        return {};
    }

    std::string result(static_cast<size_t>(sizeNeeded), '\0');
    WideCharToMultiByte(
        CP_UTF8,
        0,
        value.c_str(),
        static_cast<int>(value.size()),
        result.data(),
        sizeNeeded,
        nullptr,
        nullptr);
    return result;
}

std::wstring utf8ToWide(const std::string& value) {
    if (value.empty()) {
        return {};
    }

    const int sizeNeeded =
        MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0);
    if (sizeNeeded <= 0) {
        return {};
    }

    std::wstring result(static_cast<size_t>(sizeNeeded), L'\0');
    MultiByteToWideChar(
        CP_UTF8,
        0,
        value.c_str(),
        static_cast<int>(value.size()),
        result.data(),
        sizeNeeded);
    return result;
}

std::string hresultMessage(const char* operation, HRESULT hr) {
    std::ostringstream stream;
    stream << operation << " failed (0x" << std::hex << std::uppercase
           << static_cast<unsigned long>(hr) << ")";
    return stream.str();
}

std::string winrtErrorMessage(const char* operation, const winrt::hresult_error& error) {
    std::string message = hresultMessage(operation, error.code().value);
    const std::wstring detailWide = error.message().c_str();
    const std::string detail = wideToUtf8(detailWide);
    if (!detail.empty()) {
        message += ": " + detail;
    }
    return message;
}

std::string toLowerAscii(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character) {
        return static_cast<char>(std::tolower(character));
    });
    return value;
}

std::string playbackStatusToString(GlobalSystemMediaTransportControlsSessionPlaybackStatus status) {
    switch (status) {
        case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing:
            return "Playing";
        case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused:
            return "Paused";
        case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped:
            return "Stopped";
        case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Opened:
            return "Opened";
        case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Changing:
            return "Changing";
        case GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed:
        default:
            return "Closed";
    }
}

class ScopedCoInit {
public:
    ScopedCoInit()
        : hr_(CoInitializeEx(nullptr, COINIT_MULTITHREADED)),
          usable_(SUCCEEDED(hr_) || hr_ == RPC_E_CHANGED_MODE) {}

    ~ScopedCoInit() {
        if (SUCCEEDED(hr_)) {
            CoUninitialize();
        }
    }

    bool usable() const {
        return usable_;
    }

    HRESULT result() const {
        return hr_;
    }

private:
    HRESULT hr_;
    bool usable_;
};

class ScopedRoInit {
public:
    ScopedRoInit()
        : hr_(RoInitialize(RO_INIT_MULTITHREADED)),
          usable_(SUCCEEDED(hr_) || hr_ == RPC_E_CHANGED_MODE) {}

    ~ScopedRoInit() {
        if (SUCCEEDED(hr_)) {
            RoUninitialize();
        }
    }

    bool usable() const {
        return usable_;
    }

    HRESULT result() const {
        return hr_;
    }

private:
    HRESULT hr_;
    bool usable_;
};

bool isSpotifySession(const GlobalSystemMediaTransportControlsSession& session) {
    if (!session) {
        return false;
    }

    const std::string sourceId = toLowerAscii(winrt::to_string(session.SourceAppUserModelId()));
    return sourceId.find("spotify") != std::string::npos;
}

std::optional<GlobalSystemMediaTransportControlsSession> findSpotifySession(
    const GlobalSystemMediaTransportControlsSessionManager& manager) {
    const auto currentSession = manager.GetCurrentSession();
    if (isSpotifySession(currentSession)) {
        return currentSession;
    }

    for (const auto& session : manager.GetSessions()) {
        if (isSpotifySession(session)) {
            return session;
        }
    }

    return std::nullopt;
}

Napi::Object createWindowsMediaSupport(
    Napi::Env env, bool available, const std::string& reason = std::string()) {
    Napi::Object support = Napi::Object::New(env);
    support.Set("available", Napi::Boolean::New(env, available));
    if (available || reason.empty()) {
        support.Set("reason", env.Null());
    } else {
        support.Set("reason", Napi::String::New(env, reason));
    }
    return support;
}

std::string getDeviceId(IMMDevice* device) {
    if (device == nullptr) {
        return {};
    }

    LPWSTR id = nullptr;
    const HRESULT hr = device->GetId(&id);
    if (FAILED(hr) || id == nullptr) {
        return {};
    }

    std::wstring wideId(id);
    CoTaskMemFree(id);
    return wideToUtf8(wideId);
}

std::string getDeviceFriendlyName(IMMDevice* device) {
    if (device == nullptr) {
        return {};
    }

    ComPtr<IPropertyStore> properties;
    HRESULT hr = device->OpenPropertyStore(STGM_READ, &properties);
    if (FAILED(hr) || !properties) {
        return {};
    }

    PROPVARIANT value;
    PropVariantInit(&value);
    hr = properties->GetValue(PKEY_Device_FriendlyName, &value);
    if (FAILED(hr)) {
        PropVariantClear(&value);
        return {};
    }

    std::string label;
    if (value.vt == VT_LPWSTR && value.pwszVal != nullptr) {
        label = wideToUtf8(value.pwszVal);
    }
    PropVariantClear(&value);
    return label;
}

AudioFormatInfo getFormatInfo(const WAVEFORMATEX* format) {
    AudioFormatInfo info;
    if (format == nullptr || format->nChannels == 0 || format->nBlockAlign == 0) {
        return info;
    }

    info.valid = true;
    info.channels = format->nChannels;
    info.sampleRate = format->nSamplesPerSec;
    info.bitsPerSample = format->wBitsPerSample;
    info.validBitsPerSample = format->wBitsPerSample;
    info.bytesPerFrame = format->nBlockAlign;
    info.bytesPerSample = static_cast<WORD>(format->nBlockAlign / format->nChannels);
    info.isFloat = format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT;

    if (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
        format->cbSize >= sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) {
        const auto* extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
        info.isFloat = IsEqualGUID(extensible->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
        if (extensible->Samples.wValidBitsPerSample != 0) {
            info.validBitsPerSample = extensible->Samples.wValidBitsPerSample;
        }
    }

    return info;
}

float decodeSignedIntegerSample(const BYTE* data, WORD bytesPerSample, WORD validBitsPerSample) {
    if (data == nullptr || bytesPerSample == 0) {
        return 0.0f;
    }

    const WORD totalBits = static_cast<WORD>(bytesPerSample * 8);
    const WORD validBits = static_cast<WORD>(
        std::max<WORD>(1, std::min<WORD>(validBitsPerSample == 0 ? totalBits : validBitsPerSample, 32)));

    uint32_t rawBits = 0;
    for (WORD byteIndex = 0; byteIndex < bytesPerSample && byteIndex < 4; ++byteIndex) {
        rawBits |= static_cast<uint32_t>(data[byteIndex]) << (byteIndex * 8);
    }

    const uint32_t validMask =
        validBits >= 32 ? std::numeric_limits<uint32_t>::max() : ((1u << validBits) - 1u);
    rawBits &= validMask;

    int32_t signedValue = 0;
    if (validBits == 32) {
        signedValue = static_cast<int32_t>(rawBits);
    } else {
        const uint32_t signBit = 1u << (validBits - 1);
        if ((rawBits & signBit) != 0) {
            rawBits |= ~validMask;
        }
        signedValue = static_cast<int32_t>(rawBits);
    }

    const double maxMagnitude = validBits == 32
        ? static_cast<double>(std::numeric_limits<int32_t>::max())
        : static_cast<double>((1ULL << (validBits - 1)) - 1ULL);
    if (maxMagnitude <= 0.0) {
        return 0.0f;
    }

    return static_cast<float>(static_cast<double>(signedValue) / maxMagnitude);
}

float readFrameSample(const BYTE* frameData, UINT32 channelIndex, const AudioFormatInfo& format) {
    if (frameData == nullptr || !format.valid || format.bytesPerSample == 0 ||
        channelIndex >= format.channels) {
        return 0.0f;
    }

    const BYTE* samplePtr = frameData + static_cast<size_t>(channelIndex) * format.bytesPerSample;
    if (format.isFloat) {
        if (format.bitsPerSample == 32 && format.bytesPerSample >= sizeof(float)) {
            float value = 0.0f;
            std::memcpy(&value, samplePtr, sizeof(float));
            return value;
        }

        if (format.bitsPerSample == 64 && format.bytesPerSample >= sizeof(double)) {
            double value = 0.0;
            std::memcpy(&value, samplePtr, sizeof(double));
            return static_cast<float>(value);
        }
    }

    return decodeSignedIntegerSample(
        samplePtr, format.bytesPerSample, format.validBitsPerSample);
}

bool getDeviceMixFormat(IMMDevice* device, double* outSampleRate, UINT32* outChannelCount) {
    if (device == nullptr) {
        return false;
    }

    ComPtr<IAudioClient> audioClient;
    HRESULT hr = device->Activate(
        __uuidof(IAudioClient),
        CLSCTX_ALL,
        nullptr,
        reinterpret_cast<void**>(audioClient.ReleaseAndGetAddressOf()));
    if (FAILED(hr) || !audioClient) {
        return false;
    }

    WAVEFORMATEX* mixFormat = nullptr;
    hr = audioClient->GetMixFormat(&mixFormat);
    if (FAILED(hr) || mixFormat == nullptr) {
        return false;
    }

    const AudioFormatInfo info = getFormatInfo(mixFormat);
    CoTaskMemFree(mixFormat);
    if (!info.valid) {
        return false;
    }

    if (outSampleRate != nullptr) {
        *outSampleRate = static_cast<double>(info.sampleRate);
    }
    if (outChannelCount != nullptr) {
        *outChannelCount = info.channels;
    }

    return true;
}

std::vector<OutputDeviceInfo> enumerateOutputDevices() {
    ScopedCoInit coInit;
    if (!coInit.usable()) {
        return {};
    }

    ComPtr<IMMDeviceEnumerator> enumerator;
    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
    if (FAILED(hr) || !enumerator) {
        return {};
    }

    std::string defaultDeviceId;
    ComPtr<IMMDevice> defaultDevice;
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice);
    if (SUCCEEDED(hr) && defaultDevice) {
        defaultDeviceId = getDeviceId(defaultDevice.Get());
    }

    ComPtr<IMMDeviceCollection> collection;
    hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection);
    if (FAILED(hr) || !collection) {
        return {};
    }

    UINT deviceCount = 0;
    hr = collection->GetCount(&deviceCount);
    if (FAILED(hr) || deviceCount == 0) {
        return {};
    }

    std::vector<OutputDeviceInfo> devices;
    devices.reserve(deviceCount);

    for (UINT index = 0; index < deviceCount; ++index) {
        ComPtr<IMMDevice> device;
        hr = collection->Item(index, &device);
        if (FAILED(hr) || !device) {
            continue;
        }

        const std::string deviceId = getDeviceId(device.Get());
        if (deviceId.empty()) {
            continue;
        }

        std::string label = getDeviceFriendlyName(device.Get());
        if (label.empty()) {
            label = deviceId;
        }

        double sampleRate = 48000.0;
        UINT32 channelCount = 2;
        getDeviceMixFormat(device.Get(), &sampleRate, &channelCount);

        devices.push_back(OutputDeviceInfo{
            deviceId,
            label,
            sampleRate,
            channelCount,
            deviceId == defaultDeviceId,
        });
    }

    return devices;
}

class WindowsNativeCaptureEngine {
public:
    Napi::Object GetSupport(Napi::Env env) {
        Napi::Object support = Napi::Object::New(env);
        support.Set("available", Napi::Boolean::New(env, true));
        support.Set("reason", env.Null());
        return support;
    }

    Napi::Array ListOutputDevices(Napi::Env env) {
        const auto devices = enumerateOutputDevices();
        Napi::Array result = Napi::Array::New(env, devices.size());

        for (size_t index = 0; index < devices.size(); ++index) {
            const auto& device = devices[index];
            Napi::Object entry = Napi::Object::New(env);
            entry.Set("id", Napi::String::New(env, device.id));
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

    Napi::Object Start(Napi::Env env, const std::string& requestedDeviceId) {
        std::string errorMessage;
        if (!startInternal(requestedDeviceId, &errorMessage)) {
            Napi::Error::New(env, errorMessage).ThrowAsJavaScriptException();
            return Napi::Object::New(env);
        }

        std::lock_guard<std::mutex> lock(stateMutex_);
        Napi::Object result = Napi::Object::New(env);
        result.Set("sampleRate", Napi::Number::New(env, sampleRate_));
        result.Set(
            "channelCount", Napi::Number::New(env, static_cast<double>(channelCount_)));
        result.Set("deviceId", Napi::String::New(env, activeDeviceId_));
        result.Set("deviceLabel", Napi::String::New(env, activeDeviceLabel_));
        return result;
    }

    void Stop() {
        stopInternal();
    }

    Napi::Object Drain(Napi::Env env, size_t maxChunks) {
        const size_t drainLimit =
            maxChunks == 0 ? kDefaultDrainChunkLimit : std::min(maxChunks, kMaxQueuedChunks);

        std::deque<CapturedChunk> drained;
        uint64_t overwriteCount = 0;
        size_t queueDepth = 0;

        {
            std::lock_guard<std::mutex> lock(chunkMutex_);
            overwriteCount = overwriteCount_;
            const size_t count = std::min(drainLimit, chunkQueue_.size());
            for (size_t index = 0; index < count; ++index) {
                drained.push_back(std::move(chunkQueue_.front()));
                chunkQueue_.pop_front();
            }
            queueDepth = chunkQueue_.size();
        }

        Napi::Array chunks = Napi::Array::New(env, drained.size());
        for (size_t index = 0; index < drained.size(); ++index) {
            auto& chunk = drained[index];
            Napi::Object entry = Napi::Object::New(env);
            Napi::Float32Array left = Napi::Float32Array::New(env, chunk.left.size());
            Napi::Float32Array right = Napi::Float32Array::New(env, chunk.right.size());
            if (!chunk.left.empty()) {
                std::memcpy(left.Data(), chunk.left.data(), chunk.left.size() * sizeof(float));
            }
            if (!chunk.right.empty()) {
                std::memcpy(right.Data(), chunk.right.data(), chunk.right.size() * sizeof(float));
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
            "overwriteCount", Napi::Number::New(env, static_cast<double>(overwriteCount)));
        result.Set("queueDepth", Napi::Number::New(env, static_cast<double>(queueDepth)));
        return result;
    }

    double NowMilliseconds() const {
        return monotonicMilliseconds();
    }

private:
    bool startInternal(const std::string& requestedDeviceId, std::string* outErrorMessage) {
        stopInternal();

        {
            std::lock_guard<std::mutex> lock(stateMutex_);
            startPending_ = true;
            startSucceeded_ = false;
            startError_.clear();
            stopRequested_.store(false);
            if (stopEvent_ != nullptr) {
                CloseHandle(stopEvent_);
                stopEvent_ = nullptr;
            }
            stopEvent_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
            if (stopEvent_ == nullptr) {
                startPending_ = false;
                startError_ = "CreateEventW failed for Windows loopback capture.";
                if (outErrorMessage != nullptr) {
                    *outErrorMessage = startError_;
                }
                return false;
            }
        }

        captureThread_ = std::thread(
            [this, requestedDeviceId]() { this->captureThreadMain(requestedDeviceId); });

        std::unique_lock<std::mutex> lock(stateMutex_);
        startCondition_.wait(lock, [this]() { return !startPending_; });

        if (!startSucceeded_) {
            const std::string errorMessage = startError_.empty()
                ? "Native Windows loopback capture failed to start."
                : startError_;
            lock.unlock();
            stopInternal();
            if (outErrorMessage != nullptr) {
                *outErrorMessage = errorMessage;
            }
            return false;
        }

        return true;
    }

    void stopInternal() {
        std::thread captureThread;

        {
            std::lock_guard<std::mutex> lock(stateMutex_);
            stopRequested_.store(true);
            if (stopEvent_ != nullptr) {
                SetEvent(stopEvent_);
            }
            if (captureThread_.joinable()) {
                captureThread = std::move(captureThread_);
            }
        }

        if (captureThread.joinable()) {
            captureThread.join();
        }

        {
            std::lock_guard<std::mutex> lock(stateMutex_);
            if (stopEvent_ != nullptr) {
                CloseHandle(stopEvent_);
                stopEvent_ = nullptr;
            }
            active_ = false;
            startPending_ = false;
            startSucceeded_ = false;
            activeDeviceId_.clear();
            activeDeviceLabel_.clear();
            sampleRate_ = 48000.0;
            channelCount_ = 2;
            sequence_ = 0;
        }

        {
            std::lock_guard<std::mutex> lock(chunkMutex_);
            chunkQueue_.clear();
            overwriteCount_ = 0;
        }
    }

    void captureThreadMain(const std::string& requestedDeviceId) {
        ScopedCoInit coInit;
        if (!coInit.usable()) {
            notifyStartFailure(hresultMessage("CoInitializeEx", coInit.result()));
            return;
        }

        ComPtr<IMMDeviceEnumerator> enumerator;
        HRESULT hr = CoCreateInstance(
            __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
        if (FAILED(hr) || !enumerator) {
            notifyStartFailure(hresultMessage("CoCreateInstance(MMDeviceEnumerator)", hr));
            return;
        }

        ComPtr<IMMDevice> device;
        if (!requestedDeviceId.empty()) {
            const std::wstring requestedWide = utf8ToWide(requestedDeviceId);
            hr = enumerator->GetDevice(requestedWide.c_str(), &device);
        } else {
            hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
        }

        if (FAILED(hr) || !device) {
            notifyStartFailure(hresultMessage("Get audio endpoint", hr));
            return;
        }

        const std::string deviceId = getDeviceId(device.Get());
        std::string deviceLabel = getDeviceFriendlyName(device.Get());
        if (deviceLabel.empty()) {
            deviceLabel = deviceId.empty() ? "Windows Output Device" : deviceId;
        }

        ComPtr<IAudioClient> audioClient;
        hr = device->Activate(
            __uuidof(IAudioClient),
            CLSCTX_ALL,
            nullptr,
            reinterpret_cast<void**>(audioClient.ReleaseAndGetAddressOf()));
        if (FAILED(hr) || !audioClient) {
            notifyStartFailure(hresultMessage("IMMDevice::Activate(IAudioClient)", hr));
            return;
        }

        WAVEFORMATEX* mixFormat = nullptr;
        hr = audioClient->GetMixFormat(&mixFormat);
        if (FAILED(hr) || mixFormat == nullptr) {
            notifyStartFailure(hresultMessage("IAudioClient::GetMixFormat", hr));
            return;
        }

        const AudioFormatInfo format = getFormatInfo(mixFormat);
        if (!format.valid) {
            CoTaskMemFree(mixFormat);
            notifyStartFailure("Unsupported WASAPI mix format for Windows loopback capture.");
            return;
        }

        REFERENCE_TIME defaultPeriod = 0;
        REFERENCE_TIME minimumPeriod = 0;
        audioClient->GetDevicePeriod(&defaultPeriod, &minimumPeriod);
        const DWORD sleepMilliseconds = static_cast<DWORD>(
            std::max<LONG64>(2, std::min<LONG64>(10, defaultPeriod / 10000 / 2)));

        hr = audioClient->Initialize(
            AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 0, 0, mixFormat, nullptr);
        if (FAILED(hr)) {
            CoTaskMemFree(mixFormat);
            notifyStartFailure(hresultMessage("IAudioClient::Initialize", hr));
            return;
        }

        ComPtr<IAudioCaptureClient> captureClient;
        hr = audioClient->GetService(IID_PPV_ARGS(&captureClient));
        if (FAILED(hr) || !captureClient) {
            CoTaskMemFree(mixFormat);
            notifyStartFailure(hresultMessage("IAudioClient::GetService(IAudioCaptureClient)", hr));
            return;
        }

        hr = audioClient->Start();
        if (FAILED(hr)) {
            CoTaskMemFree(mixFormat);
            notifyStartFailure(hresultMessage("IAudioClient::Start", hr));
            return;
        }

        notifyStartSuccess(
            deviceId,
            deviceLabel,
            static_cast<double>(format.sampleRate),
            std::max<UINT32>(1, format.channels));

        DWORD taskIndex = 0;
        HANDLE mmcssHandle = AvSetMmThreadCharacteristicsW(L"Audio", &taskIndex);

        while (!stopRequested_.load()) {
            UINT32 packetFrames = 0;
            hr = captureClient->GetNextPacketSize(&packetFrames);
            if (FAILED(hr)) {
                break;
            }

            while (packetFrames > 0 && !stopRequested_.load()) {
                BYTE* data = nullptr;
                UINT32 framesToRead = 0;
                DWORD flags = 0;
                hr = captureClient->GetBuffer(&data, &framesToRead, &flags, nullptr, nullptr);
                if (FAILED(hr)) {
                    break;
                }

                if (framesToRead > 0) {
                    CapturedChunk chunk;
                    chunk.channelCount = std::max<UINT32>(1, format.channels);
                    chunk.capturedAtMilliseconds = monotonicMilliseconds();
                    chunk.left.resize(framesToRead);
                    chunk.right.resize(framesToRead);

                    if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) == 0 && data != nullptr) {
                        for (UINT32 frameIndex = 0; frameIndex < framesToRead; ++frameIndex) {
                            const BYTE* frameData =
                                data + static_cast<size_t>(frameIndex) * format.bytesPerFrame;
                            const float left = readFrameSample(frameData, 0, format);
                            const float right = format.channels > 1
                                ? readFrameSample(frameData, 1, format)
                                : left;
                            chunk.left[frameIndex] = left;
                            chunk.right[frameIndex] = right;
                        }
                    } else {
                        std::fill(chunk.left.begin(), chunk.left.end(), 0.0f);
                        std::fill(chunk.right.begin(), chunk.right.end(), 0.0f);
                    }

                    pushChunk(std::move(chunk));
                }

                captureClient->ReleaseBuffer(framesToRead);
                hr = captureClient->GetNextPacketSize(&packetFrames);
                if (FAILED(hr)) {
                    break;
                }
            }

            if (FAILED(hr) || stopRequested_.load()) {
                break;
            }

            if (WaitForSingleObject(stopEvent_, sleepMilliseconds) == WAIT_OBJECT_0) {
                break;
            }
        }

        if (mmcssHandle != nullptr) {
            AvRevertMmThreadCharacteristics(mmcssHandle);
        }

        audioClient->Stop();
        CoTaskMemFree(mixFormat);

        std::lock_guard<std::mutex> lock(stateMutex_);
        active_ = false;
    }

    void notifyStartSuccess(const std::string& deviceId,
                            const std::string& deviceLabel,
                            double sampleRate,
                            UINT32 channelCount) {
        {
            std::lock_guard<std::mutex> lock(stateMutex_);
            active_ = true;
            activeDeviceId_ = deviceId;
            activeDeviceLabel_ = deviceLabel;
            sampleRate_ = sampleRate;
            channelCount_ = channelCount;
            sequence_ = 0;
            startSucceeded_ = true;
            startPending_ = false;
            startError_.clear();
        }

        {
            std::lock_guard<std::mutex> lock(chunkMutex_);
            chunkQueue_.clear();
            overwriteCount_ = 0;
        }

        startCondition_.notify_all();
    }

    void notifyStartFailure(const std::string& message) {
        {
            std::lock_guard<std::mutex> lock(stateMutex_);
            startSucceeded_ = false;
            startPending_ = false;
            startError_ = message;
            active_ = false;
        }
        startCondition_.notify_all();
    }

    void pushChunk(CapturedChunk chunk) {
        {
            std::lock_guard<std::mutex> lock(stateMutex_);
            chunk.sequence = ++sequence_;
        }

        std::lock_guard<std::mutex> lock(chunkMutex_);
        if (chunkQueue_.size() >= kMaxQueuedChunks) {
            chunkQueue_.pop_front();
            ++overwriteCount_;
        }
        chunkQueue_.push_back(std::move(chunk));
    }

    std::mutex stateMutex_;
    std::condition_variable startCondition_;
    std::mutex chunkMutex_;
    std::deque<CapturedChunk> chunkQueue_;
    std::thread captureThread_;
    HANDLE stopEvent_ = nullptr;
    std::atomic<bool> stopRequested_{false};

    uint64_t overwriteCount_ = 0;
    uint64_t sequence_ = 0;
    bool active_ = false;
    bool startPending_ = false;
    bool startSucceeded_ = false;
    std::string startError_;
    std::string activeDeviceId_;
    std::string activeDeviceLabel_;
    double sampleRate_ = 48000.0;
    UINT32 channelCount_ = 2;
};

WindowsNativeCaptureEngine& engine() {
    static WindowsNativeCaptureEngine instance;
    return instance;
}

Napi::Value WindowsGetSupport(const Napi::CallbackInfo& info) {
    return engine().GetSupport(info.Env());
}

Napi::Value WindowsListOutputDevices(const Napi::CallbackInfo& info) {
    return engine().ListOutputDevices(info.Env());
}

Napi::Value WindowsStart(const Napi::CallbackInfo& info) {
    std::string requestedDeviceId;
    if (info.Length() >= 1 && info[0].IsString()) {
        requestedDeviceId = info[0].As<Napi::String>().Utf8Value();
    }
    return engine().Start(info.Env(), requestedDeviceId);
}

Napi::Value WindowsStop(const Napi::CallbackInfo& info) {
    engine().Stop();
    return info.Env().Undefined();
}

Napi::Value WindowsDrain(const Napi::CallbackInfo& info) {
    size_t maxChunks = kDefaultDrainChunkLimit;
    if (info.Length() >= 1 && info[0].IsNumber()) {
        const int64_t requested = info[0].As<Napi::Number>().Int64Value();
        if (requested > 0) {
            maxChunks = static_cast<size_t>(requested);
        }
    }
    return engine().Drain(info.Env(), maxChunks);
}

Napi::Value WindowsNowMilliseconds(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine().NowMilliseconds());
}

Napi::Value WindowsMediaGetSupport(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    try {
        ScopedRoInit init;
        if (!init.usable()) {
            throw std::runtime_error(
                hresultMessage("RoInitialize(RO_INIT_MULTITHREADED)", init.result()));
        }

        auto manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().get();
        (void)manager;
        return createWindowsMediaSupport(env, true);
    } catch (const winrt::hresult_error& error) {
        return createWindowsMediaSupport(
            env,
            false,
            winrtErrorMessage(
                "Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager::RequestAsync",
                error));
    } catch (const std::exception& error) {
        return createWindowsMediaSupport(env, false, error.what());
    }
}

Napi::Value WindowsMediaGetSpotifyPlaybackState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    try {
        ScopedRoInit init;
        if (!init.usable()) {
            throw std::runtime_error(
                hresultMessage("RoInitialize(RO_INIT_MULTITHREADED)", init.result()));
        }

        const auto manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().get();
        const auto session = findSpotifySession(manager);
        if (!session.has_value()) {
            return env.Null();
        }

        const auto playbackInfo = session->GetPlaybackInfo();
        const auto timeline = session->GetTimelineProperties();
        const auto mediaProperties = session->TryGetMediaPropertiesAsync().get();

        const auto positionMs = std::max<int64_t>(
            0,
            std::chrono::duration_cast<std::chrono::milliseconds>(timeline.Position()).count());
        const auto durationMs = std::max<int64_t>(
            0,
            std::chrono::duration_cast<std::chrono::milliseconds>(
                timeline.EndTime() - timeline.StartTime())
                .count());

        Napi::Object payload = Napi::Object::New(env);
        payload.Set(
            "playbackStatus",
            Napi::String::New(
                env, playbackStatusToString(playbackInfo.PlaybackStatus())));
        payload.Set("positionMs", Napi::Number::New(env, static_cast<double>(positionMs)));
        payload.Set("durationMs", Napi::Number::New(env, static_cast<double>(durationMs)));
        payload.Set("title", Napi::String::New(env, winrt::to_string(mediaProperties.Title())));
        payload.Set("artist", Napi::String::New(env, winrt::to_string(mediaProperties.Artist())));
        payload.Set(
            "album", Napi::String::New(env, winrt::to_string(mediaProperties.AlbumTitle())));
        payload.Set(
            "sourceAppUserModelId",
            Napi::String::New(env, winrt::to_string(session->SourceAppUserModelId())));
        return payload;
    } catch (const winrt::hresult_error& error) {
        Napi::Error::New(
            env,
            winrtErrorMessage(
                "Windows.Media.Control.GlobalSystemMediaTransportControlsSession",
                error))
            .ThrowAsJavaScriptException();
        return env.Null();
    } catch (const std::exception& error) {
        Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value WindowsMediaSendSpotifyControl(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected a Spotify control command.").ThrowAsJavaScriptException();
        return env.Null();
    }

    const std::string command = info[0].As<Napi::String>().Utf8Value();

    try {
        ScopedRoInit init;
        if (!init.usable()) {
            throw std::runtime_error(
                hresultMessage("RoInitialize(RO_INIT_MULTITHREADED)", init.result()));
        }

        const auto manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().get();
        const auto session = findSpotifySession(manager);
        if (!session.has_value()) {
            throw std::runtime_error("Spotify is not running.");
        }

        bool accepted = false;
        if (command == "play") {
            accepted = session->TryPlayAsync().get();
        } else if (command == "pause") {
            accepted = session->TryPauseAsync().get();
        } else if (command == "next") {
            accepted = session->TrySkipNextAsync().get();
        } else if (command == "previous") {
            accepted = session->TrySkipPreviousAsync().get();
        } else {
            throw std::runtime_error("Unsupported Spotify control command.");
        }

        if (!accepted) {
            throw std::runtime_error("Spotify did not allow Prism to complete that request.");
        }

        return Napi::Boolean::New(env, true);
    } catch (const winrt::hresult_error& error) {
        Napi::Error::New(
            env,
            winrtErrorMessage(
                "Windows.Media.Control.GlobalSystemMediaTransportControlsSession",
                error))
            .ThrowAsJavaScriptException();
        return env.Null();
    } catch (const std::exception& error) {
        Napi::Error::New(env, error.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

}  // namespace

void RegisterWindowsCapture(Napi::Env env, Napi::Object exports) {
    Napi::Object captureExports = Napi::Object::New(env);
    captureExports.Set("getSupport", Napi::Function::New(env, WindowsGetSupport));
    captureExports.Set(
        "listOutputDevices", Napi::Function::New(env, WindowsListOutputDevices));
    captureExports.Set("start", Napi::Function::New(env, WindowsStart));
    captureExports.Set("stop", Napi::Function::New(env, WindowsStop));
    captureExports.Set("drain", Napi::Function::New(env, WindowsDrain));
    captureExports.Set("nowMilliseconds", Napi::Function::New(env, WindowsNowMilliseconds));
    exports.Set("windowsCapture", captureExports);

    Napi::Object mediaExports = Napi::Object::New(env);
    mediaExports.Set("getSupport", Napi::Function::New(env, WindowsMediaGetSupport));
    mediaExports.Set(
        "getSpotifyPlaybackState",
        Napi::Function::New(env, WindowsMediaGetSpotifyPlaybackState));
    mediaExports.Set(
        "sendSpotifyControl",
        Napi::Function::New(env, WindowsMediaSendSpotifyControl));
    exports.Set("windowsMedia", mediaExports);
}

#endif  // defined(_WIN32)
