#include "system_audio_capture.h"
#include "device_input_capture_adapter.h"
#include "capture_channel_selection.h"

#if defined(__linux__)

#include <pulse/pulseaudio.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

namespace {

constexpr size_t kMaxQueuedChunks = 256;
constexpr size_t kDefaultDrainChunkLimit = 64;
constexpr pa_usec_t kTargetRecordFragmentMicroseconds = 10000;

struct DeviceInfo {
    std::string id;
    std::string label;
    std::string recordSourceName;
    pa_sample_spec sampleSpec{};
    pa_channel_map channelMap{};
    bool hasChannelMap = false;
    bool isDefault = false;
};

using CapturedChunk = Prism::Capture::AudioChunk;

double monotonicMilliseconds() {
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return std::chrono::duration<double, std::milli>(now).count();
}

Prism::Capture::PCMFormat getPCMFormat(pa_sample_format_t format) {
    using namespace Prism::Capture;
    PCMFormat pcm;
    pcm.normalizeByPowerOfTwo = true;
    switch (format) {
        case PA_SAMPLE_U8: pcm.encoding = SampleEncoding::UnsignedInteger; pcm.bitsPerChannel = 8; break;
        case PA_SAMPLE_S16LE: case PA_SAMPLE_S16BE:
            pcm.encoding = SampleEncoding::SignedInteger; pcm.bitsPerChannel = 16; break;
        case PA_SAMPLE_S24LE: case PA_SAMPLE_S24BE:
            pcm.encoding = SampleEncoding::SignedInteger; pcm.bitsPerChannel = 24; break;
        case PA_SAMPLE_S24_32LE: case PA_SAMPLE_S24_32BE:
            pcm.encoding = SampleEncoding::SignedInteger; pcm.bitsPerChannel = 32;
            pcm.validBitsPerChannel = 24; break;
        case PA_SAMPLE_S32LE: case PA_SAMPLE_S32BE:
            pcm.encoding = SampleEncoding::SignedInteger; pcm.bitsPerChannel = 32; break;
        case PA_SAMPLE_FLOAT32LE: case PA_SAMPLE_FLOAT32BE:
            pcm.encoding = SampleEncoding::Float; pcm.bitsPerChannel = 32; break;
        default: break;
    }
    pcm.bigEndian = pa_sample_format_is_be(format) > 0;
    return pcm;
}

std::vector<Prism::Capture::ChannelDescriptor> channelDescriptors(const DeviceInfo& device) {
    std::vector<Prism::Capture::ChannelDescriptor> result;
    for (uint32_t index = 0; index < device.sampleSpec.channels; ++index) {
        const char* label = device.hasChannelMap && index < device.channelMap.channels
            ? pa_channel_position_to_pretty_string(device.channelMap.map[index]) : nullptr;
        result.push_back({index, label != nullptr ? label : "Channel " + std::to_string(index + 1)});
    }
    return result;
}

struct DeviceEnumerationState {
    pa_threaded_mainloop* mainloop = nullptr;
    std::string defaultSinkName;
    std::string defaultSourceName;
    std::vector<DeviceInfo> devices;
};

void HandleServerInfo(pa_context*, const pa_server_info* info, void* userdata) {
    auto* state = static_cast<DeviceEnumerationState*>(userdata);
    if (state != nullptr && info != nullptr && info->default_sink_name != nullptr) {
        state->defaultSinkName = info->default_sink_name;
    }
    if (state != nullptr && info != nullptr && info->default_source_name != nullptr) {
        state->defaultSourceName = info->default_source_name;
    }
    if (state != nullptr && state->mainloop != nullptr) {
        pa_threaded_mainloop_signal(state->mainloop, 0);
    }
}

void HandleSinkInfo(pa_context*, const pa_sink_info* info, int eol, void* userdata) {
    auto* state = static_cast<DeviceEnumerationState*>(userdata);
    if (state == nullptr || state->mainloop == nullptr) {
        return;
    }

    if (eol > 0) {
        pa_threaded_mainloop_signal(state->mainloop, 0);
        return;
    }

    if (info != nullptr && info->name != nullptr && info->monitor_source_name != nullptr) {
        DeviceInfo device;
        device.id = info->name;
        device.label = info->description != nullptr ? info->description : info->name;
        device.recordSourceName = info->monitor_source_name;
        device.sampleSpec = info->sample_spec;
        device.channelMap = info->channel_map;
        device.hasChannelMap = info->channel_map.channels > 0;
        state->devices.push_back(device);
    }

    pa_threaded_mainloop_signal(state->mainloop, 0);
}

void HandleSourceInfo(pa_context*, const pa_source_info* info, int eol, void* userdata) {
    auto* state = static_cast<DeviceEnumerationState*>(userdata);
    if (state == nullptr || state->mainloop == nullptr) return;
    if (eol == 0 && info != nullptr && info->name != nullptr
        && info->monitor_of_sink == PA_INVALID_INDEX) {
        DeviceInfo device;
        device.id = info->name;
        device.label = info->description != nullptr ? info->description : info->name;
        device.recordSourceName = info->name;
        device.sampleSpec = info->sample_spec;
        device.channelMap = info->channel_map;
        device.hasChannelMap = info->channel_map.channels > 0;
        state->devices.push_back(std::move(device));
    }
    pa_threaded_mainloop_signal(state->mainloop, 0);
}

class PulseContextConnection {
public:
    PulseContextConnection() = default;

    ~PulseContextConnection() {
        disconnect();
    }

    bool connect(const std::string& contextName, std::string* outErrorMessage) {
        disconnect();

        mainloop_ = pa_threaded_mainloop_new();
        if (mainloop_ == nullptr) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = "Could not create a PulseAudio main loop.";
            }
            return false;
        }

        context_ =
            pa_context_new(pa_threaded_mainloop_get_api(mainloop_), contextName.c_str());
        if (context_ == nullptr) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = "Could not create a PulseAudio context.";
            }
            disconnect();
            return false;
        }

        pa_context_set_state_callback(context_, &PulseContextConnection::HandleContextState, mainloop_);

        if (pa_threaded_mainloop_start(mainloop_) < 0) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = "Could not start the PulseAudio main loop.";
            }
            disconnect();
            return false;
        }
        started_ = true;

        pa_threaded_mainloop_lock(mainloop_);
        const int connectResult = pa_context_connect(context_, nullptr, PA_CONTEXT_NOFLAGS, nullptr);
        if (connectResult < 0) {
            const std::string errorMessage = buildContextErrorMessage(
                "Could not connect to PulseAudio.", context_);
            pa_threaded_mainloop_unlock(mainloop_);
            if (outErrorMessage != nullptr) {
                *outErrorMessage = errorMessage;
            }
            disconnect();
            return false;
        }

        const bool ready = waitForContextReadyLocked(outErrorMessage);
        pa_threaded_mainloop_unlock(mainloop_);
        if (!ready) {
            disconnect();
            return false;
        }

        return true;
    }

    void disconnect() {
        if (mainloop_ != nullptr && started_) {
            pa_threaded_mainloop_lock(mainloop_);
            if (context_ != nullptr) {
                pa_context_set_state_callback(context_, nullptr, nullptr);
                pa_context_disconnect(context_);
                pa_context_unref(context_);
                context_ = nullptr;
            }
            pa_threaded_mainloop_unlock(mainloop_);
            pa_threaded_mainloop_stop(mainloop_);
        } else if (context_ != nullptr) {
            pa_context_unref(context_);
            context_ = nullptr;
        }

        if (mainloop_ != nullptr) {
            pa_threaded_mainloop_free(mainloop_);
            mainloop_ = nullptr;
        }

        started_ = false;
    }

    bool enumerateDevices(bool input, std::vector<DeviceInfo>* outDevices,
                                std::string* outErrorMessage) {
        if (outDevices == nullptr) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = "Could not store PulseAudio devices.";
            }
            return false;
        }

        if (context_ == nullptr || mainloop_ == nullptr) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = "PulseAudio is not connected.";
            }
            return false;
        }

        pa_threaded_mainloop_lock(mainloop_);

        DeviceEnumerationState state;
        state.mainloop = mainloop_;

        pa_operation* serverOperation =
            pa_context_get_server_info(context_, &HandleServerInfo, &state);
        if (!waitForOperationLocked(serverOperation, outErrorMessage)) {
            pa_threaded_mainloop_unlock(mainloop_);
            return false;
        }

        pa_operation* sinkOperation =
            input ? pa_context_get_source_info_list(context_, &HandleSourceInfo, &state)
                  : pa_context_get_sink_info_list(context_, &HandleSinkInfo, &state);
        if (!waitForOperationLocked(sinkOperation, outErrorMessage)) {
            pa_threaded_mainloop_unlock(mainloop_);
            return false;
        }

        pa_threaded_mainloop_unlock(mainloop_);

        for (auto& device : state.devices) {
            device.isDefault = device.id == (input ? state.defaultSourceName : state.defaultSinkName);
        }

        *outDevices = std::move(state.devices);
        return true;
    }

    pa_threaded_mainloop* mainloop() const {
        return mainloop_;
    }

    pa_context* context() const {
        return context_;
    }

    bool waitForOperationLocked(pa_operation* operation, std::string* outErrorMessage) {
        return waitForOperationLockedInternal(operation, outErrorMessage);
    }

private:
    static void HandleContextState(pa_context*, void* userdata) {
        auto* mainloop = static_cast<pa_threaded_mainloop*>(userdata);
        if (mainloop != nullptr) {
            pa_threaded_mainloop_signal(mainloop, 0);
        }
    }

    static std::string buildContextErrorMessage(const char* prefix, pa_context* context) {
        const char* pulseError = context != nullptr ? pa_strerror(pa_context_errno(context)) : nullptr;
        if (pulseError == nullptr || pulseError[0] == '\0') {
            return prefix;
        }
        return std::string(prefix) + " " + pulseError;
    }

    bool waitForContextReadyLocked(std::string* outErrorMessage) const {
        while (true) {
            const pa_context_state_t state = pa_context_get_state(context_);
            switch (state) {
                case PA_CONTEXT_READY:
                    return true;
                case PA_CONTEXT_FAILED:
                case PA_CONTEXT_TERMINATED:
                    if (outErrorMessage != nullptr) {
                        *outErrorMessage = buildContextErrorMessage(
                            "PulseAudio context failed to initialize.", context_);
                    }
                    return false;
                default:
                    pa_threaded_mainloop_wait(mainloop_);
                    break;
            }
        }
    }

    bool waitForOperationLockedInternal(pa_operation* operation,
                                        std::string* outErrorMessage) const {
        if (operation == nullptr) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = buildContextErrorMessage(
                    "PulseAudio request could not be started.", context_);
            }
            return false;
        }

        while (true) {
            const pa_operation_state_t state = pa_operation_get_state(operation);
            if (state == PA_OPERATION_DONE) {
                pa_operation_unref(operation);
                return true;
            }
            if (state == PA_OPERATION_CANCELLED) {
                pa_operation_unref(operation);
                if (outErrorMessage != nullptr) {
                    *outErrorMessage = buildContextErrorMessage(
                        "PulseAudio request was cancelled.", context_);
                }
                return false;
            }
            pa_threaded_mainloop_wait(mainloop_);
        }
    }

    pa_threaded_mainloop* mainloop_ = nullptr;
    pa_context* context_ = nullptr;
    bool started_ = false;
};

class LinuxNativeCaptureEngine final : public Prism::Capture::SystemAudioCapture {
public:
    explicit LinuxNativeCaptureEngine(bool input = false) : input_(input) {}

    ~LinuxNativeCaptureEngine() override {
        stop();
    }

    Prism::Capture::Support getSupport() const override {
        PulseContextConnection connection;
        std::string errorMessage;
        std::vector<DeviceInfo> devices;
        const bool available =
            connection.connect("Prism Linux Capture Probe", &errorMessage) &&
            connection.enumerateDevices(input_, &devices, &errorMessage);
        return {
            available,
            available ? std::string() : (errorMessage.empty()
                ? "Native Linux capture is unavailable."
                : errorMessage),
        };
    }

    std::vector<Prism::Capture::OutputDevice> listOutputDevices() override {
        PulseContextConnection connection;
        std::string errorMessage;
        std::vector<DeviceInfo> devices;
        if (!connection.connect("Prism Linux Capture Devices", &errorMessage) ||
            !connection.enumerateDevices(input_, &devices, &errorMessage)) {
            return {};
        }

        std::vector<Prism::Capture::OutputDevice> result;
        result.reserve(devices.size());
        for (const auto& device : devices) {
            result.push_back({
                device.id,
                device.label,
                static_cast<double>(device.sampleSpec.rate),
                static_cast<uint32_t>(device.sampleSpec.channels),
                device.isDefault,
                channelDescriptors(device),
            });
        }
        return result;
    }

    bool start(const std::string& requestedDeviceId,
               Prism::Capture::StartResult* result,
               std::string* errorMessage) override {
        if (!startInternal(requestedDeviceId, errorMessage)) {
            if (errorMessage != nullptr && errorMessage->empty()) {
                *errorMessage = "Native Linux audio capture failed to start.";
            }
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
        const size_t drainLimit = maxChunks == 0
            ? kDefaultDrainChunkLimit
            : std::min(maxChunks, kMaxQueuedChunks);
        std::deque<CapturedChunk> drained;
        Prism::Capture::DrainResult result;
        {
            std::lock_guard<std::mutex> lock(chunkMutex_);
            const size_t count = std::min(drainLimit, chunkQueue_.size());
            for (size_t index = 0; index < count; ++index) {
                drained.push_back(std::move(chunkQueue_.front()));
                chunkQueue_.pop_front();
            }
            result.overwriteCount = overwriteCount_;
            overwriteCount_ = 0;
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
        return "PulseAudio";
    }

private:
    static void HandleStreamState(pa_stream*, void* userdata) {
        auto* mainloop = static_cast<pa_threaded_mainloop*>(userdata);
        if (mainloop != nullptr) {
            pa_threaded_mainloop_signal(mainloop, 0);
        }
    }

    static void HandleStreamRead(pa_stream*, size_t, void* userdata) {
        auto* self = static_cast<LinuxNativeCaptureEngine*>(userdata);
        if (self != nullptr) {
            self->handleReadableStream();
        }
    }

    static std::string buildContextErrorMessage(pa_context* context, const char* prefix) {
        const char* pulseError = context != nullptr ? pa_strerror(pa_context_errno(context)) : nullptr;
        if (pulseError == nullptr || pulseError[0] == '\0') {
            return prefix;
        }
        return std::string(prefix) + " " + pulseError;
    }

    static pa_buffer_attr buildRecordBufferAttr(const pa_sample_spec& sampleSpec) {
        pa_buffer_attr attr{};
        attr.maxlength = UINT32_MAX;
        attr.tlength = UINT32_MAX;
        attr.prebuf = UINT32_MAX;
        attr.minreq = UINT32_MAX;

        const size_t requestedFragSize =
            pa_usec_to_bytes(kTargetRecordFragmentMicroseconds, &sampleSpec);
        attr.fragsize = requestedFragSize == 0
            ? 1
            : static_cast<uint32_t>(std::min<size_t>(requestedFragSize, UINT32_MAX));
        return attr;
    }

    bool startInternal(const std::string& requestedDeviceId, std::string* outErrorMessage) {
        stopInternal();

        if (!connection_.connect("Prism Linux Capture", outErrorMessage)) {
            return false;
        }

        std::vector<DeviceInfo> devices;
        if (!connection_.enumerateDevices(input_, &devices, outErrorMessage)) {
            connection_.disconnect();
            return false;
        }

        if (devices.empty()) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = input_ ? "No Linux input devices are available."
                                         : "No Linux output devices are available.";
            }
            connection_.disconnect();
            return false;
        }

        const DeviceInfo* selected = nullptr;
        if (!requestedDeviceId.empty()) {
            for (const auto& device : devices) {
                if (device.id == requestedDeviceId) {
                    selected = &device;
                    break;
                }
            }
            if (selected == nullptr) {
                if (outErrorMessage != nullptr) {
                    *outErrorMessage =
                        input_ ? "The selected Linux input device is no longer available."
                               : "The selected Linux output device is no longer available.";
                }
                connection_.disconnect();
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

        if (!Prism::Capture::isSupportedPCMFormat(getPCMFormat(selected->sampleSpec.format))) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage =
                    "Unsupported PulseAudio sample format for Linux audio capture.";
            }
            connection_.disconnect();
            return false;
        }

        pa_threaded_mainloop_lock(connection_.mainloop());

        stream_ = pa_stream_new(
            connection_.context(),
            input_ ? "Prism Device Input" : "Prism Output Monitor",
            &selected->sampleSpec,
            selected->hasChannelMap ? &selected->channelMap : nullptr);
        if (stream_ == nullptr) {
            const std::string errorMessage = buildContextErrorMessage(
                connection_.context(), "Could not create a PulseAudio recording stream.");
            pa_threaded_mainloop_unlock(connection_.mainloop());
            if (outErrorMessage != nullptr) {
                *outErrorMessage = errorMessage;
            }
            connection_.disconnect();
            return false;
        }

        pa_stream_set_state_callback(stream_, &HandleStreamState, connection_.mainloop());
        pa_stream_set_read_callback(stream_, &HandleStreamRead, this);

        const pa_buffer_attr requestedBufferAttr = buildRecordBufferAttr(selected->sampleSpec);
        const pa_stream_flags_t flags = static_cast<pa_stream_flags_t>(
            PA_STREAM_ADJUST_LATENCY |
            PA_STREAM_AUTO_TIMING_UPDATE |
            PA_STREAM_INTERPOLATE_TIMING |
            PA_STREAM_DONT_MOVE);
        const int connectResult = pa_stream_connect_record(
            stream_, selected->recordSourceName.c_str(), &requestedBufferAttr, flags);
        if (connectResult < 0) {
            const std::string errorMessage = buildContextErrorMessage(
                connection_.context(), "Could not start Linux audio capture.");
            pa_stream_set_read_callback(stream_, nullptr, nullptr);
            pa_stream_set_state_callback(stream_, nullptr, nullptr);
            pa_stream_unref(stream_);
            stream_ = nullptr;
            pa_threaded_mainloop_unlock(connection_.mainloop());
            if (outErrorMessage != nullptr) {
                *outErrorMessage = errorMessage;
            }
            connection_.disconnect();
            return false;
        }

        if (!waitForStreamReadyLocked(outErrorMessage)) {
            if (stream_ != nullptr) {
                pa_stream_set_read_callback(stream_, nullptr, nullptr);
                pa_stream_set_state_callback(stream_, nullptr, nullptr);
                pa_stream_disconnect(stream_);
                pa_stream_unref(stream_);
                stream_ = nullptr;
            }
            pa_threaded_mainloop_unlock(connection_.mainloop());
            connection_.disconnect();
            return false;
        }

        const pa_sample_spec* activeSpec = pa_stream_get_sample_spec(stream_);
        if (activeSpec != nullptr) {
            sampleSpec_ = *activeSpec;
        } else {
            sampleSpec_ = selected->sampleSpec;
        }
        const pa_buffer_attr* activeBufferAttr = pa_stream_get_buffer_attr(stream_);
        if (activeBufferAttr != nullptr) {
            bufferAttr_ = *activeBufferAttr;
        } else {
            bufferAttr_ = requestedBufferAttr;
        }

        {
            std::lock_guard<std::mutex> lock(stateMutex_);
            active_ = true;
            activeDeviceId_ = selected->id;
            activeDeviceLabel_ = selected->label;
            sampleRate_ = static_cast<double>(sampleSpec_.rate);
            channelCount_ = std::max<uint32_t>(1, sampleSpec_.channels);
            routing_ = Prism::Capture::normalizeChannelRouting(routing_, channelCount_);
            sequence_ = 0;
        }

        pa_threaded_mainloop_unlock(connection_.mainloop());
        return true;
    }

    bool waitForStreamReadyLocked(std::string* outErrorMessage) const {
        while (stream_ != nullptr) {
            const pa_stream_state_t state = pa_stream_get_state(stream_);
            switch (state) {
                case PA_STREAM_READY:
                    return true;
                case PA_STREAM_FAILED:
                case PA_STREAM_TERMINATED:
                    if (outErrorMessage != nullptr) {
                        *outErrorMessage = buildContextErrorMessage(
                            connection_.context(),
                            "PulseAudio recording stream failed to initialize.");
                    }
                    return false;
                default:
                    pa_threaded_mainloop_wait(connection_.mainloop());
                    break;
            }
        }

        if (outErrorMessage != nullptr) {
            *outErrorMessage = "PulseAudio recording stream is unavailable.";
        }
        return false;
    }

    void stopInternal() {
        if (connection_.mainloop() != nullptr) {
            pa_threaded_mainloop_lock(connection_.mainloop());
            if (stream_ != nullptr) {
                pa_stream_set_read_callback(stream_, nullptr, nullptr);
                pa_stream_set_state_callback(stream_, nullptr, nullptr);
                pa_stream_disconnect(stream_);
                pa_stream_unref(stream_);
                stream_ = nullptr;
            }
            pa_threaded_mainloop_unlock(connection_.mainloop());
        }

        connection_.disconnect();

        {
            std::lock_guard<std::mutex> lock(stateMutex_);
            active_ = false;
            activeDeviceId_.clear();
            activeDeviceLabel_.clear();
            sampleRate_ = 48000.0;
            channelCount_ = 2;
            sequence_ = 0;
            sampleSpec_ = pa_sample_spec{};
            bufferAttr_ = pa_buffer_attr{};
        }

        {
            std::lock_guard<std::mutex> lock(chunkMutex_);
            chunkQueue_.clear();
            overwriteCount_ = 0;
        }
    }

    void handleReadableStream() {
        if (stream_ == nullptr) {
            return;
        }

        while (true) {
            const void* data = nullptr;
            size_t length = 0;
            if (pa_stream_peek(stream_, &data, &length) < 0) {
                break;
            }

            if (length == 0) {
                pa_stream_drop(stream_);
                break;
            }

            pa_sample_spec sampleSpec{};
            uint32_t channelCount = 2;
            uint64_t sequence = 0;
            Prism::Capture::ChannelRouting routing;
            {
                std::lock_guard<std::mutex> lock(stateMutex_);
                if (!active_) {
                    pa_stream_drop(stream_);
                    break;
                }
                sampleSpec = sampleSpec_;
                channelCount = channelCount_;
                routing = routing_;
                sequence = ++sequence_;
            }

            const size_t bytesPerFrame = pa_frame_size(&sampleSpec);
            if (bytesPerFrame == 0) {
                pa_stream_drop(stream_);
                break;
            }

            const size_t frames = length / bytesPerFrame;
            if (frames == 0) {
                pa_stream_drop(stream_);
                break;
            }

            CapturedChunk chunk;
            chunk.channelCount = channelCount > 1 ? 2u : 1u;
            chunk.capturedAtMilliseconds = monotonicMilliseconds();
            chunk.sequence = sequence;
            chunk.left.resize(frames);
            chunk.right.resize(frames);

            chunk.sourceChannelPeaks.resize(channelCount);
            const Prism::Capture::PCMBufferView buffer{
                static_cast<const uint8_t*>(data), length, channelCount};
            const auto format = getPCMFormat(sampleSpec.format);
            Prism::Capture::selectStereoChannels(&buffer, 1, format, frames, channelCount,
                routing.left, routing.right, chunk.left.data(), chunk.right.data());
            Prism::Capture::measureSourceChannelPeaks(&buffer, 1, format, frames, channelCount,
                chunk.sourceChannelPeaks.data());

            pa_stream_drop(stream_);
            pushChunk(std::move(chunk));

            if (pa_stream_readable_size(stream_) == 0) {
                break;
            }
        }
    }

    void pushChunk(CapturedChunk&& chunk) {
        std::lock_guard<std::mutex> lock(chunkMutex_);
        if (chunkQueue_.size() >= kMaxQueuedChunks) {
            chunkQueue_.pop_front();
            ++overwriteCount_;
        }
        chunkQueue_.push_back(std::move(chunk));
    }

    const bool input_;
    Prism::Capture::ChannelRouting routing_;
    PulseContextConnection connection_;
    pa_stream* stream_ = nullptr;
    mutable std::mutex stateMutex_;
    mutable std::mutex chunkMutex_;
    bool active_ = false;
    std::string activeDeviceId_;
    std::string activeDeviceLabel_;
    double sampleRate_ = 48000.0;
    uint32_t channelCount_ = 2;
    uint64_t sequence_ = 0;
    pa_sample_spec sampleSpec_{};
    pa_buffer_attr bufferAttr_{};
    std::deque<CapturedChunk> chunkQueue_;
    size_t overwriteCount_ = 0;
};

}  // namespace

namespace Prism::Capture {

std::unique_ptr<SystemAudioCapture> createSystemAudioCapture() {
    return std::make_unique<LinuxNativeCaptureEngine>();
}

std::unique_ptr<DeviceInputCapture> createDeviceInputCapture() {
    return std::make_unique<DeviceInputCaptureAdapter>(
        std::make_unique<LinuxNativeCaptureEngine>(true));
}

}  // namespace Prism::Capture

#endif
