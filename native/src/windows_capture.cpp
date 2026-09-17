#ifndef PRISM_CAPTURE_CORE_ONLY
#include "windows_capture.h"
#endif
#include "system_audio_capture.h"
#include "device_input_capture_adapter.h"
#include "capture_channel_selection.h"

#if defined(_WIN32)

#if defined(__MINGW32__)
// MinGW's import libraries do not supply the audio/property-key GUID objects.
#include <initguid.h>
#endif
#include <audioclient.h>
#include <propkeydef.h>
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
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
#include <map>
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

struct DeviceInfo {
    std::string id;
    std::string label;
    double sampleRate;
    UINT32 channelCount;
    bool isDefault;
    std::vector<Prism::Capture::ChannelDescriptor> channels;
};

using CapturedChunk = Prism::Capture::AudioChunk;

struct AudioFormatInfo {
    bool valid = false;
    Prism::Capture::PCMFormat pcm;
    DWORD channelMask = 0;
    WORD channels = 0;
    DWORD sampleRate = 48000;
    WORD bytesPerFrame = 0;
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

template <typename Operation>
auto awaitMediaOperation(const Operation& operation) {
    if (operation.wait_for(std::chrono::seconds(5)) == winrt::Windows::Foundation::AsyncStatus::Started) {
        operation.Cancel();
        throw std::runtime_error("Windows media request timed out. Retry after checking the player.");
    }
    return operation.GetResults();
}

bool isProviderSession(const GlobalSystemMediaTransportControlsSession& session, const std::string& provider) {
    if (!session) {
        return false;
    }

    const std::string sourceId = toLowerAscii(winrt::to_string(session.SourceAppUserModelId()));
    if (provider == "spotify") return sourceId.find("spotify") != std::string::npos;
    if (provider != "tidal") return false;
    return sourceId == "com.squirrel.tidal.tidal" || sourceId == "tidal" ||
        sourceId == "tidal.exe" || sourceId == "com.tidal.desktop" ||
        (sourceId.rfind("tidalmusicas.tidal_", 0) == 0 &&
         sourceId.size() > 6 && sourceId.compare(sourceId.size() - 6, 6, "!tidal") == 0);
}

std::optional<GlobalSystemMediaTransportControlsSession> findProviderSession(
    const GlobalSystemMediaTransportControlsSessionManager& manager, const std::string& provider) {
    const auto currentSession = manager.GetCurrentSession();
    if (isProviderSession(currentSession, provider)) {
        return currentSession;
    }

    for (const auto& session : manager.GetSessions()) {
        if (isProviderSession(session, provider)) {
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
struct ThumbnailCache {
    std::string trackKey;
    std::string dataUrl;
    bool fetching = false;
    std::chrono::steady_clock::time_point retryAfter{};
};
// One slot per provider; Spotify and TIDAL must not evict each other's artwork.
std::map<std::string, ThumbnailCache> s_thumbnailCaches;

void launchThumbnailFetch(
    const std::string& provider, const std::string& trackKey,
    winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties props) {
    const auto thumbnailRef = props.Thumbnail();
    if (!thumbnailRef) {
        std::lock_guard<std::mutex> lock(s_thumbMutex);
        s_thumbnailCaches[provider].fetching = false;
        return;
    }
    std::thread([provider, trackKey, thumbnailRef]() {
        std::string result;
        try {
            using winrt::Windows::Storage::Streams::DataReader;
            ScopedRoInit init;
            if (init.usable()) {
                const auto stream = awaitMediaOperation(thumbnailRef.OpenReadAsync());
                const uint64_t size = stream.Size();
                if (size > 0 && size <= 4u * 1024u * 1024u) {
                    const auto reader = DataReader(stream);
                    const uint32_t loaded = awaitMediaOperation(reader.LoadAsync(static_cast<uint32_t>(size)));
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
            }
        } catch (...) {}
        std::lock_guard<std::mutex> lock(s_thumbMutex);
        auto& cache = s_thumbnailCaches[provider];
        if (cache.trackKey == trackKey) {
            cache.dataUrl = std::move(result);
            cache.retryAfter = std::chrono::steady_clock::now() + std::chrono::seconds(30);
        }
        cache.fetching = false;
    }).detach();
}

std::string getOrFetchThumbnail(
    const std::string& provider, const std::string& trackKey,
    winrt::Windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties props) {
    bool shouldFetch = false;
    std::string result;
    {
        std::lock_guard<std::mutex> lock(s_thumbMutex);
        auto& cache = s_thumbnailCaches[provider];
        if (cache.trackKey != trackKey) {
            cache.trackKey = trackKey;
            cache.dataUrl.clear();
            cache.retryAfter = {};
        }
        result = cache.dataUrl;
        if (result.empty() && !cache.fetching && std::chrono::steady_clock::now() >= cache.retryAfter) {
            cache.fetching = true;
            cache.retryAfter = std::chrono::steady_clock::now() + std::chrono::seconds(30);
            shouldFetch = true;
        }
    }
    if (shouldFetch) {
        launchThumbnailFetch(provider, trackKey, std::move(props));
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
    using namespace Prism::Capture;
    AudioFormatInfo info;
    if (format == nullptr || format->nChannels == 0 || format->nSamplesPerSec == 0) return info;
    info.channels = format->nChannels;
    info.sampleRate = format->nSamplesPerSec;
    info.bytesPerFrame = format->nBlockAlign;
    info.pcm.bitsPerChannel = format->wBitsPerSample;
    if (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
        info.pcm.encoding = SampleEncoding::Float;
    } else if (format->wFormatTag == WAVE_FORMAT_PCM) {
        info.pcm.encoding = format->wBitsPerSample == 8
            ? SampleEncoding::UnsignedInteger : SampleEncoding::SignedInteger;
    } else if (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE
        && format->cbSize >= sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX)) {
        const auto* extensible = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(format);
        info.channelMask = extensible->dwChannelMask;
        info.pcm.validBitsPerChannel = extensible->Samples.wValidBitsPerSample;
        info.pcm.highAligned = true;
        if (IsEqualGUID(extensible->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) {
            info.pcm.encoding = SampleEncoding::Float;
        } else if (IsEqualGUID(extensible->SubFormat, KSDATAFORMAT_SUBTYPE_PCM)) {
            info.pcm.encoding = format->wBitsPerSample == 8
                ? SampleEncoding::UnsignedInteger : SampleEncoding::SignedInteger;
        }
    }
    info.valid = isSupportedPCMFormat(info.pcm)
        && info.bytesPerFrame == info.channels * (info.pcm.bitsPerChannel / 8);
    return info;
}

std::vector<Prism::Capture::ChannelDescriptor> channelDescriptors(const AudioFormatInfo& format) {
    // WAVEFORMATEXTENSIBLE interleaves speakers in ascending mask-bit order.
    static constexpr const char* speakerLabels[] = {
        "Front Left", "Front Right", "Front Center", "LFE", "Back Left", "Back Right",
        "Front Left of Center", "Front Right of Center", "Back Center", "Side Left", "Side Right",
        "Top Center", "Top Front Left", "Top Front Center", "Top Front Right",
        "Top Back Left", "Top Back Center", "Top Back Right",
    };
    std::vector<Prism::Capture::ChannelDescriptor> result;
    for (uint32_t bit = 0; bit < 32 && result.size() < format.channels; ++bit) {
        if ((format.channelMask & (DWORD{1} << bit)) == 0) continue;
        const auto index = static_cast<uint32_t>(result.size());
        result.push_back({index, bit < sizeof(speakerLabels) / sizeof(speakerLabels[0])
            ? speakerLabels[bit] : "Channel " + std::to_string(index + 1)});
    }
    while (result.size() < format.channels) {
        const auto index = static_cast<uint32_t>(result.size());
        result.push_back({index, "Channel " + std::to_string(index + 1)});
    }
    return result;
}

bool getDeviceMixFormat(IMMDevice* device, AudioFormatInfo* outFormat) {
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

    *outFormat = info;

    return true;
}

std::vector<DeviceInfo> enumerateDevices(bool input) {
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
    hr = enumerator->GetDefaultAudioEndpoint(input ? eCapture : eRender, eConsole, &defaultDevice);
    if (SUCCEEDED(hr) && defaultDevice) {
        defaultDeviceId = getDeviceId(defaultDevice.Get());
    }

    ComPtr<IMMDeviceCollection> collection;
    hr = enumerator->EnumAudioEndpoints(input ? eCapture : eRender, DEVICE_STATE_ACTIVE, &collection);
    if (FAILED(hr) || !collection) {
        return {};
    }

    UINT deviceCount = 0;
    hr = collection->GetCount(&deviceCount);
    if (FAILED(hr) || deviceCount == 0) {
        return {};
    }

    std::vector<DeviceInfo> devices;
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

        AudioFormatInfo format;
        if (!getDeviceMixFormat(device.Get(), &format)) continue;

        devices.push_back(DeviceInfo{
            deviceId,
            label,
            static_cast<double>(format.sampleRate),
            static_cast<UINT32>(format.channels),
            deviceId == defaultDeviceId,
            channelDescriptors(format),
        });
    }

    return devices;
}

class WindowsNativeCaptureEngine final : public Prism::Capture::SystemAudioCapture {
public:
    explicit WindowsNativeCaptureEngine(bool input = false) : input_(input) {}

    ~WindowsNativeCaptureEngine() override {
        stop();
    }

    Prism::Capture::Support getSupport() const override {
        return {true, {}};
    }

    std::vector<Prism::Capture::OutputDevice> listOutputDevices() override {
        const auto devices = enumerateDevices(input_);
        std::vector<Prism::Capture::OutputDevice> result;
        result.reserve(devices.size());
        for (const auto& device : devices) {
            result.push_back({
                device.id,
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
        if (!startInternal(requestedDeviceId, errorMessage)) {
            return false;
        }
        if (result != nullptr) {
            std::lock_guard<std::mutex> lock(stateMutex_);
            result->sampleRate = sampleRate_;
            result->channelCount = channelCount_ > 1 ? 2u : 1u;
            result->sourceChannelCount = channelCount_;
            result->deviceId = activeDeviceId_;
            result->deviceLabel = activeDeviceLabel_;
        }
        return true;
    }

    Prism::Capture::ChannelRouting setChannelRouting(uint32_t left, uint32_t right) override {
        std::lock_guard<std::mutex> lock(stateMutex_);
        routing_ = active_ ? Prism::Capture::normalizeChannelRouting({left, right}, channelCount_)
                          : Prism::Capture::ChannelRouting{left, right};
        return routing_;
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
            result.chunks.push_back(std::move(chunk));
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
                startError_ = "CreateEventW failed for Windows audio capture.";
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
                ? "Native Windows audio capture failed to start."
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
            hr = enumerator->GetDefaultAudioEndpoint(input_ ? eCapture : eRender, eConsole, &device);
        }

        if (FAILED(hr) || !device) {
            notifyStartFailure(hresultMessage("Get audio endpoint", hr));
            return;
        }

        ComPtr<IMMEndpoint> endpoint;
        EDataFlow flow = eAll;
        hr = device.As(&endpoint);
        if (FAILED(hr) || FAILED(endpoint->GetDataFlow(&flow))
            || flow != (input_ ? eCapture : eRender)) {
            notifyStartFailure("The selected Windows device has the wrong capture direction.");
            return;
        }

        const std::string deviceId = getDeviceId(device.Get());
        std::string deviceLabel = getDeviceFriendlyName(device.Get());
        if (deviceLabel.empty()) {
            deviceLabel = deviceId.empty() ? (input_ ? "Windows Input Device" : "Windows Output Device") : deviceId;
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
            notifyStartFailure("Unsupported WASAPI mix format for Windows audio capture.");
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
            AUDCLNT_SHAREMODE_SHARED, input_ ? 0 : AUDCLNT_STREAMFLAGS_LOOPBACK, 0, 0, mixFormat, nullptr);
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
                    chunk.channelCount = format.channels > 1 ? 2u : 1u;
                    chunk.capturedAtMilliseconds = monotonicMilliseconds();
                    chunk.left.resize(framesToRead);
                    chunk.right.resize(framesToRead);

                    chunk.sourceChannelPeaks.resize(format.channels);
                    Prism::Capture::ChannelRouting routing;
                    {
                        std::lock_guard<std::mutex> lock(stateMutex_);
                        routing = routing_;
                    }
                    const Prism::Capture::PCMBufferView buffer{
                        (flags & AUDCLNT_BUFFERFLAGS_SILENT) == 0 ? data : nullptr,
                        static_cast<size_t>(framesToRead) * format.bytesPerFrame, format.channels};
                    Prism::Capture::selectStereoChannels(&buffer, 1, format.pcm, framesToRead,
                        format.channels, routing.left, routing.right, chunk.left.data(), chunk.right.data());
                    Prism::Capture::measureSourceChannelPeaks(&buffer, 1, format.pcm, framesToRead,
                        format.channels, chunk.sourceChannelPeaks.data());

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

            if (!input_ && !pushedThisIteration) {
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
                    silentChunk.channelCount = format.channels > 1 ? 2u : 1u;
                    silentChunk.sourceChannelPeaks.assign(format.channels, 0.0f);
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
            routing_ = Prism::Capture::normalizeChannelRouting(routing_, channelCount_);
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

    const bool input_;
    Prism::Capture::ChannelRouting routing_;
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

        auto manager = awaitMediaOperation(GlobalSystemMediaTransportControlsSessionManager::RequestAsync());
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

Napi::Value WindowsMediaGetPlaybackState(const Napi::CallbackInfo& info, const std::string& provider) {
    Napi::Env env = info.Env();

    try {
        ScopedRoInit init;
        if (!init.usable()) {
            throw std::runtime_error(
                hresultMessage("RoInitialize(RO_INIT_MULTITHREADED)", init.result()));
        }

        const auto manager = awaitMediaOperation(GlobalSystemMediaTransportControlsSessionManager::RequestAsync());
        const auto session = findProviderSession(manager, provider);
        if (!session.has_value()) {
            return env.Null();
        }

        const auto playbackInfo = session->GetPlaybackInfo();
        const auto timeline = session->GetTimelineProperties();
        const auto mediaProperties = awaitMediaOperation(session->TryGetMediaPropertiesAsync());

        const auto durationMs = std::max<int64_t>(
            0,
            std::chrono::duration_cast<std::chrono::milliseconds>(
                timeline.EndTime() - timeline.StartTime())
                .count());

        // Position() is stamped at LastUpdatedTime(). Some players omit the timeline;
        // never extrapolate from the default Windows epoch or clamp unknown duration to zero.
        int64_t positionMs = std::max<int64_t>(0,
            std::chrono::duration_cast<std::chrono::milliseconds>(timeline.Position()).count());
        if (playbackInfo.PlaybackStatus() == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing &&
            timeline.LastUpdatedTime().time_since_epoch().count() > 0) {
            positionMs += std::max<int64_t>(0,
                std::chrono::duration_cast<std::chrono::milliseconds>(
                    winrt::clock::now() - timeline.LastUpdatedTime()).count());
        }
        if (durationMs > 0) positionMs = std::min(durationMs, positionMs);

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
            provider + "\n" + winrt::to_string(session->SourceAppUserModelId()) + "\n" +
            winrt::to_string(mediaProperties.Title()) + "\n" +
            winrt::to_string(mediaProperties.Artist()) + "\n" + winrt::to_string(mediaProperties.AlbumTitle());
        const std::string artworkDataUrl = getOrFetchThumbnail(provider, trackKey, mediaProperties);
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

Napi::Value WindowsMediaSendControl(const Napi::CallbackInfo& info, const std::string& provider) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected a media control command.").ThrowAsJavaScriptException();
        return env.Null();
    }

    const std::string command = info[0].As<Napi::String>().Utf8Value();

    try {
        ScopedRoInit init;
        if (!init.usable()) {
            throw std::runtime_error(
                hresultMessage("RoInitialize(RO_INIT_MULTITHREADED)", init.result()));
        }

        const auto manager = awaitMediaOperation(GlobalSystemMediaTransportControlsSessionManager::RequestAsync());
        const auto session = findProviderSession(manager, provider);
        if (!session.has_value()) {
            throw std::runtime_error(provider + " is not running.");
        }

        bool accepted = false;
        if (command == "play") {
            accepted = awaitMediaOperation(session->TryPlayAsync());
        } else if (command == "pause") {
            accepted = awaitMediaOperation(session->TryPauseAsync());
        } else if (command == "next") {
            accepted = awaitMediaOperation(session->TrySkipNextAsync());
        } else if (command == "previous") {
            accepted = awaitMediaOperation(session->TrySkipPreviousAsync());
        } else {
            throw std::runtime_error("Unsupported media control command.");
        }

        if (!accepted) {
            throw std::runtime_error(provider + " did not allow Prism to complete that request.");
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
Napi::Value WindowsMediaGetSpotifyPlaybackState(const Napi::CallbackInfo& info) {
    return WindowsMediaGetPlaybackState(info, "spotify");
}
Napi::Value WindowsMediaGetTidalPlaybackState(const Napi::CallbackInfo& info) {
    return WindowsMediaGetPlaybackState(info, "tidal");
}
Napi::Value WindowsMediaSendSpotifyControl(const Napi::CallbackInfo& info) {
    return WindowsMediaSendControl(info, "spotify");
}
Napi::Value WindowsMediaSendTidalControl(const Napi::CallbackInfo& info) {
    return WindowsMediaSendControl(info, "tidal");
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
    mediaExports.Set("getTidalPlaybackState", Napi::Function::New(env, WindowsMediaGetTidalPlaybackState));
    mediaExports.Set("sendTidalControl", Napi::Function::New(env, WindowsMediaSendTidalControl));
    exports.Set("windowsMedia", mediaExports);
}
#endif

namespace Prism::Capture {

std::unique_ptr<SystemAudioCapture> createSystemAudioCapture() {
    return std::make_unique<WindowsNativeCaptureEngine>();
}

std::unique_ptr<DeviceInputCapture> createDeviceInputCapture() {
    return std::make_unique<DeviceInputCaptureAdapter>(
        std::make_unique<WindowsNativeCaptureEngine>(true));
}

}  // namespace Prism::Capture

#endif  // defined(_WIN32)
