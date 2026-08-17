#ifndef PRISM_CAPTURE_CORE_ONLY
#include "windows_capture.h"
#endif
#include "system_audio_capture.h"

#if defined(_WIN32)

#include <Audioclient.h>
#include <propkeydef.h>
#include <Functiondiscoverykeys_devpkey.h>
#include <Mmdeviceapi.h>
#include <ksmedia.h>
#include <mmreg.h>
#include <propidl.h>
#include <avrt.h>
#include <wrl/client.h>
#include <windows.h>
#ifndef PRISM_CAPTURE_CORE_ONLY
#include <roapi.h>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Media.Control.h>
#include <winrt/Windows.Storage.Streams.h>
#endif

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
#ifndef PRISM_CAPTURE_CORE_ONLY
using winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSession;
using winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
using winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;
#endif

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

#ifndef PRISM_CAPTURE_CORE_ONLY
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
#endif

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

#ifndef PRISM_CAPTURE_CORE_ONLY
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

static const char kBase64Chars[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string base64Encode(const std::vector<uint8_t>& data) {
    std::string result;
    result.reserve(((data.size() + 2) / 3) * 4);
    for (size_t i = 0; i < data.size(); i += 3) {
        const uint32_t b0 = data[i];
        const uint32_t b1 = (i + 1 < data.size()) ? data[i + 1] : 0u;
        const uint32_t b2 = (i + 2 < data.size()) ? data[i + 2] : 0u;
        result += kBase64Chars[(b0 >> 2) & 0x3F];
        result += kBase64Chars[((b0 << 4) | (b1 >> 4)) & 0x3F];
        result += (i + 1 < data.size()) ? kBase64Chars[((b1 << 2) | (b2 >> 6)) & 0x3F] : '=';
        result += (i + 2 < data.size()) ? kBase64Chars[b2 & 0x3F] : '=';
    }
    return result;
}

// Thumbnail is fetched on a background thread to avoid blocking the NAPI call
// thread with cross-process WinRT async I/O.
std::mutex s_thumbMutex;
std::string s_thumbTrackKey;
std::string s_thumbDataUrl;
bool s_thumbFetching = false;

void launchThumbnailFetch(
    const std::string& trackKey,
    winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties props) {
    const auto thumbnailRef = props.Thumbnail();
    if (!thumbnailRef) {
        std::lock_guard<std::mutex> lock(s_thumbMutex);
        s_thumbFetching = false;
        return;
    }
    std::thread([trackKey, thumbnailRef]() {
        std::string result;
        try {
            using winrt::Windows::Storage::Streams::DataReader;
            const HRESULT hr = RoInitialize(RO_INIT_MULTITHREADED);
            if (SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE) {
                const auto stream = thumbnailRef.OpenReadAsync().get();
                const uint64_t size = stream.Size();
                if (size > 0 && size <= 4u * 1024u * 1024u) {
                    const auto reader = DataReader(stream);
                    const uint32_t loaded = reader.LoadAsync(static_cast<uint32_t>(size)).get();
                    if (loaded > 0) {
                        std::vector<uint8_t> bytes(loaded);
                        reader.ReadBytes(bytes);
                        std::string mimeType = winrt::to_string(stream.ContentType());
                        if (mimeType.empty()) {
                            mimeType = "image/jpeg";
                        }
                        result = "data:" + mimeType + ";base64," + base64Encode(bytes);
                    }
                }
                if (SUCCEEDED(hr)) {
                    RoUninitialize();
                }
            }
        } catch (...) {}
        std::lock_guard<std::mutex> lock(s_thumbMutex);
        if (s_thumbTrackKey == trackKey) {
            s_thumbDataUrl = std::move(result);
        }
        s_thumbFetching = false;
    }).detach();
}

std::string getOrFetchThumbnail(
    const std::string& trackKey,
    winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties props) {
    bool shouldFetch = false;
    std::string result;
    {
        std::lock_guard<std::mutex> lock(s_thumbMutex);
        if (s_thumbTrackKey == trackKey) {
            result = s_thumbDataUrl;
        } else {
            s_thumbTrackKey = trackKey;
            s_thumbDataUrl.clear();
            if (!s_thumbFetching) {
                s_thumbFetching = true;
                shouldFetch = true;
            }
        }
    }
    if (shouldFetch) {
        launchThumbnailFetch(trackKey, std::move(props));
    }
    return result;
}
#endif

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

class WindowsNativeCaptureEngine final : public Prism::Capture::SystemAudioCapture {
public:
    ~WindowsNativeCaptureEngine() override {
        stop();
    }

    Prism::Capture::Support getSupport() const override {
        return {true, {}};
    }

    std::vector<Prism::Capture::OutputDevice> listOutputDevices() override {
        const auto devices = enumerateOutputDevices();
        std::vector<Prism::Capture::OutputDevice> result;
        result.reserve(devices.size());
        for (const auto& device : devices) {
            result.push_back({
                device.id,
                device.label,
                device.sampleRate,
                static_cast<uint32_t>(device.channelCount),
                device.isDefault,
            });
        }
        return result;
    }

    bool start(const std::string& requestedDeviceId,
               Prism::Capture::StartResult* result,
               std::string* errorMessage) override {
        if (!startInternal(requestedDeviceId, errorMessage)) {
            return false;
        }
        if (result != nullptr) {
            std::lock_guard<std::mutex> lock(stateMutex_);
            result->sampleRate = sampleRate_;
            result->channelCount = static_cast<uint32_t>(channelCount_);
            result->deviceId = activeDeviceId_;
            result->deviceLabel = activeDeviceLabel_;
        }
        return true;
    }

    void stop() override {
        stopInternal();
    }

    Prism::Capture::DrainResult drain(size_t maxChunks) override {
        const size_t drainLimit =
            maxChunks == 0 ? kDefaultDrainChunkLimit : std::min(maxChunks, kMaxQueuedChunks);
        std::deque<CapturedChunk> drained;
        Prism::Capture::DrainResult result;
        {
            std::lock_guard<std::mutex> lock(chunkMutex_);
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
        return "WASAPI";
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

        // WASAPI loopback stops delivering packets entirely when no application
        // is rendering audio. To keep visualizers ticking through silence at
        // real-time pacing (instead of freezing on the last frame), synthesize
        // zero-filled chunks once WASAPI has truly stalled past the device
        // period. The stall threshold has to be comfortably larger than the
        // device period — packet delivery is bursty (typically one packet per
        // device period, but our poll loop runs ~2× faster), so a tighter
        // threshold would mistake the inter-packet gap for silence and
        // interleave zeros into legitimate playback.
        const double devicePeriodMs = static_cast<double>(defaultPeriod) / 10000.0;
        const double silenceStallThresholdMs =
            std::max<double>(25.0, devicePeriodMs * 2.5);
        const UINT32 maxSilenceFrames = std::max<UINT32>(
            64,
            static_cast<UINT32>(
                static_cast<double>(format.sampleRate) *
                static_cast<double>(sleepMilliseconds) * 4.0 / 1000.0));
        const double startMs = monotonicMilliseconds();
        double lastChunkPushedAtMs = startMs;
        double lastRealPacketAtMs = startMs;

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
            bool pushedThisIteration = false;
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

                    lastChunkPushedAtMs = chunk.capturedAtMilliseconds;
                    lastRealPacketAtMs = chunk.capturedAtMilliseconds;
                    pushChunk(std::move(chunk));
                    pushedThisIteration = true;
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

            if (!pushedThisIteration) {
                const double nowMs = monotonicMilliseconds();
                const double stallMs = nowMs - lastRealPacketAtMs;
                const double sinceLastChunkMs = nowMs - lastChunkPushedAtMs;
                if (stallMs >= silenceStallThresholdMs && sinceLastChunkMs >= 1.0) {
                    const UINT32 silenceFrames = std::min<UINT32>(
                        maxSilenceFrames,
                        std::max<UINT32>(
                            1,
                            static_cast<UINT32>(
                                sinceLastChunkMs *
                                static_cast<double>(format.sampleRate) / 1000.0)));
                    CapturedChunk silentChunk;
                    silentChunk.channelCount = std::max<UINT32>(1, format.channels);
                    silentChunk.capturedAtMilliseconds = nowMs;
                    silentChunk.left.assign(silenceFrames, 0.0f);
                    silentChunk.right.assign(silenceFrames, 0.0f);
                    lastChunkPushedAtMs = nowMs;
                    pushChunk(std::move(silentChunk));
                }
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

#ifndef PRISM_CAPTURE_CORE_ONLY
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

        const auto durationMs = std::max<int64_t>(
            0,
            std::chrono::duration_cast<std::chrono::milliseconds>(
                timeline.EndTime() - timeline.StartTime())
                .count());

        // Position() is stamped at LastUpdatedTime(); extrapolate forward when playing.
        int64_t positionMs;
        if (playbackInfo.PlaybackStatus() ==
            GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing) {
            const auto elapsed = winrt::clock::now() - timeline.LastUpdatedTime();
            const auto extrapolated = timeline.Position() + elapsed;
            positionMs = std::min(
                durationMs,
                std::max<int64_t>(
                    0,
                    std::chrono::duration_cast<std::chrono::milliseconds>(extrapolated).count()));
        } else {
            positionMs = std::max<int64_t>(
                0,
                std::chrono::duration_cast<std::chrono::milliseconds>(timeline.Position())
                    .count());
        }

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

        const std::string trackKey =
            winrt::to_string(mediaProperties.Title()) + "\n" +
            winrt::to_string(mediaProperties.Artist());
        const std::string artworkDataUrl = getOrFetchThumbnail(trackKey, mediaProperties);
        payload.Set(
            "artworkDataUrl",
            artworkDataUrl.empty() ? env.Null() : Napi::String::New(env, artworkDataUrl));

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
#endif

}  // namespace

#ifndef PRISM_CAPTURE_CORE_ONLY
void RegisterWindowsMedia(Napi::Env env, Napi::Object exports) {
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
#endif

namespace Prism::Capture {

std::unique_ptr<SystemAudioCapture> createSystemAudioCapture() {
    return std::make_unique<WindowsNativeCaptureEngine>();
}

}  // namespace Prism::Capture

#endif  // defined(_WIN32)
