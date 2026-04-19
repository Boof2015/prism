#include "linux_capture.h"

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

struct OutputDeviceInfo {
    std::string id;
    std::string label;
    std::string monitorSourceName;
    pa_sample_spec sampleSpec{};
    pa_channel_map channelMap{};
    bool hasChannelMap = false;
    bool isDefault = false;
};

struct CapturedChunk {
    std::vector<float> left;
    std::vector<float> right;
    uint32_t channelCount = 2;
    double capturedAtMilliseconds = 0.0;
    uint64_t sequence = 0;
};

double monotonicMilliseconds() {
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return std::chrono::duration<double, std::milli>(now).count();
}

uint32_t readUint24LE(const uint8_t* data) {
    return static_cast<uint32_t>(data[0]) |
           (static_cast<uint32_t>(data[1]) << 8) |
           (static_cast<uint32_t>(data[2]) << 16);
}

uint32_t readUint24BE(const uint8_t* data) {
    return static_cast<uint32_t>(data[2]) |
           (static_cast<uint32_t>(data[1]) << 8) |
           (static_cast<uint32_t>(data[0]) << 16);
}

uint32_t readUint32LE(const uint8_t* data) {
    return static_cast<uint32_t>(data[0]) |
           (static_cast<uint32_t>(data[1]) << 8) |
           (static_cast<uint32_t>(data[2]) << 16) |
           (static_cast<uint32_t>(data[3]) << 24);
}

uint32_t readUint32BE(const uint8_t* data) {
    return static_cast<uint32_t>(data[3]) |
           (static_cast<uint32_t>(data[2]) << 8) |
           (static_cast<uint32_t>(data[1]) << 16) |
           (static_cast<uint32_t>(data[0]) << 24);
}

int32_t signExtend24(uint32_t value) {
    if ((value & 0x00800000U) != 0) {
        value |= 0xFF000000U;
    }
    return static_cast<int32_t>(value);
}

bool isSupportedSampleFormat(pa_sample_format_t format) {
    switch (format) {
        case PA_SAMPLE_U8:
        case PA_SAMPLE_S16LE:
        case PA_SAMPLE_S16BE:
        case PA_SAMPLE_S24LE:
        case PA_SAMPLE_S24BE:
        case PA_SAMPLE_S24_32LE:
        case PA_SAMPLE_S24_32BE:
        case PA_SAMPLE_S32LE:
        case PA_SAMPLE_S32BE:
        case PA_SAMPLE_FLOAT32LE:
        case PA_SAMPLE_FLOAT32BE:
            return true;
        default:
            return false;
    }
}

float readNormalizedSample(const uint8_t* data, pa_sample_format_t format) {
    if (data == nullptr) {
        return 0.0f;
    }

    switch (format) {
        case PA_SAMPLE_U8:
            return (static_cast<int>(data[0]) - 128) / 128.0f;
        case PA_SAMPLE_S16LE:
            return static_cast<int16_t>(
                       static_cast<uint16_t>(data[0]) |
                       (static_cast<uint16_t>(data[1]) << 8)) /
                   32768.0f;
        case PA_SAMPLE_S16BE:
            return static_cast<int16_t>(
                       static_cast<uint16_t>(data[1]) |
                       (static_cast<uint16_t>(data[0]) << 8)) /
                   32768.0f;
        case PA_SAMPLE_S24LE:
            return signExtend24(readUint24LE(data)) / 8388608.0f;
        case PA_SAMPLE_S24BE:
            return signExtend24(readUint24BE(data)) / 8388608.0f;
        case PA_SAMPLE_S24_32LE: {
            uint32_t raw = readUint32LE(data) & 0x00FFFFFFU;
            return signExtend24(raw) / 8388608.0f;
        }
        case PA_SAMPLE_S24_32BE: {
            uint32_t raw = readUint32BE(data) & 0x00FFFFFFU;
            return signExtend24(raw) / 8388608.0f;
        }
        case PA_SAMPLE_S32LE:
            return static_cast<int32_t>(readUint32LE(data)) / 2147483648.0f;
        case PA_SAMPLE_S32BE:
            return static_cast<int32_t>(readUint32BE(data)) / 2147483648.0f;
        case PA_SAMPLE_FLOAT32LE: {
            const uint32_t raw = readUint32LE(data);
            float value = 0.0f;
            std::memcpy(&value, &raw, sizeof(value));
            return value;
        }
        case PA_SAMPLE_FLOAT32BE: {
            const uint32_t raw = readUint32BE(data);
            float value = 0.0f;
            std::memcpy(&value, &raw, sizeof(value));
            return value;
        }
        default:
            return 0.0f;
    }
}

struct SinkEnumerationState {
    pa_threaded_mainloop* mainloop = nullptr;
    std::string defaultSinkName;
    std::vector<OutputDeviceInfo> devices;
};

void HandleServerInfo(pa_context*, const pa_server_info* info, void* userdata) {
    auto* state = static_cast<SinkEnumerationState*>(userdata);
    if (state != nullptr && info != nullptr && info->default_sink_name != nullptr) {
        state->defaultSinkName = info->default_sink_name;
    }
    if (state != nullptr && state->mainloop != nullptr) {
        pa_threaded_mainloop_signal(state->mainloop, 0);
    }
}

void HandleSinkInfo(pa_context*, const pa_sink_info* info, int eol, void* userdata) {
    auto* state = static_cast<SinkEnumerationState*>(userdata);
    if (state == nullptr || state->mainloop == nullptr) {
        return;
    }

    if (eol > 0) {
        pa_threaded_mainloop_signal(state->mainloop, 0);
        return;
    }

    if (info != nullptr && info->name != nullptr && info->monitor_source_name != nullptr) {
        OutputDeviceInfo device;
        device.id = info->name;
        device.label = info->description != nullptr ? info->description : info->name;
        device.monitorSourceName = info->monitor_source_name;
        device.sampleSpec = info->sample_spec;
        device.channelMap = info->channel_map;
        device.hasChannelMap = info->channel_map.channels > 0;
        state->devices.push_back(device);
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

    bool enumerateOutputDevices(std::vector<OutputDeviceInfo>* outDevices,
                                std::string* outErrorMessage) {
        if (outDevices == nullptr) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = "Could not store PulseAudio output devices.";
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

        SinkEnumerationState state;
        state.mainloop = mainloop_;

        pa_operation* serverOperation =
            pa_context_get_server_info(context_, &HandleServerInfo, &state);
        if (!waitForOperationLocked(serverOperation, outErrorMessage)) {
            pa_threaded_mainloop_unlock(mainloop_);
            return false;
        }

        pa_operation* sinkOperation =
            pa_context_get_sink_info_list(context_, &HandleSinkInfo, &state);
        if (!waitForOperationLocked(sinkOperation, outErrorMessage)) {
            pa_threaded_mainloop_unlock(mainloop_);
            return false;
        }

        pa_threaded_mainloop_unlock(mainloop_);

        for (auto& device : state.devices) {
            device.isDefault = device.id == state.defaultSinkName;
        }

        if (state.devices.empty()) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage = "No Linux output devices are available.";
            }
            return false;
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

class LinuxNativeCaptureEngine {
public:
    Napi::Value GetSupport(const Napi::CallbackInfo& info) const {
        Napi::Object support = Napi::Object::New(info.Env());

        PulseContextConnection connection;
        std::string errorMessage;
        std::vector<OutputDeviceInfo> devices;
        const bool available =
            connection.connect("Prism Linux Capture Probe", &errorMessage) &&
            connection.enumerateOutputDevices(&devices, &errorMessage);

        support.Set("available", Napi::Boolean::New(info.Env(), available));
        if (available) {
            support.Set("reason", info.Env().Null());
        } else {
            const std::string reason = errorMessage.empty()
                ? "Native Linux capture is unavailable."
                : errorMessage;
            support.Set("reason", Napi::String::New(info.Env(), reason));
        }
        return support;
    }

    Napi::Value ListOutputDevices(const Napi::CallbackInfo& info) const {
        Napi::Env env = info.Env();
        Napi::Array devicesArray = Napi::Array::New(env);

        PulseContextConnection connection;
        std::string errorMessage;
        std::vector<OutputDeviceInfo> devices;
        if (!connection.connect("Prism Linux Capture Devices", &errorMessage) ||
            !connection.enumerateOutputDevices(&devices, &errorMessage)) {
            return devicesArray;
        }

        for (size_t index = 0; index < devices.size(); ++index) {
            const auto& device = devices[index];
            Napi::Object entry = Napi::Object::New(env);
            entry.Set("id", Napi::String::New(env, device.id));
            entry.Set("label", Napi::String::New(env, device.label));
            entry.Set("kind", Napi::String::New(env, "system"));
            entry.Set("isDefault", Napi::Boolean::New(env, device.isDefault));
            entry.Set(
                "sampleRate",
                Napi::Number::New(env, static_cast<double>(device.sampleSpec.rate)));
            entry.Set(
                "channelCount",
                Napi::Number::New(env, static_cast<double>(device.sampleSpec.channels)));
            devicesArray.Set(static_cast<uint32_t>(index), entry);
        }

        return devicesArray;
    }

    Napi::Value Start(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        std::string requestedDeviceId;
        if (info.Length() > 0 && info[0].IsString()) {
            requestedDeviceId = info[0].As<Napi::String>().Utf8Value();
        }

        std::string errorMessage;
        if (!startInternal(requestedDeviceId, &errorMessage)) {
            const std::string reason = errorMessage.empty()
                ? "Native Linux monitor capture failed to start."
                : errorMessage;
            Napi::Error::New(env, reason)
                .ThrowAsJavaScriptException();
            return env.Null();
        }

        std::lock_guard<std::mutex> lock(stateMutex_);
        Napi::Object result = Napi::Object::New(env);
        result.Set("sampleRate", Napi::Number::New(env, sampleRate_));
        result.Set("channelCount", Napi::Number::New(env, static_cast<double>(channelCount_)));
        result.Set("deviceId", Napi::String::New(env, activeDeviceId_));
        result.Set("deviceLabel", Napi::String::New(env, activeDeviceLabel_));
        return result;
    }

    Napi::Value Stop(const Napi::CallbackInfo& info) {
        stopInternal();
        return info.Env().Undefined();
    }

    Napi::Value Drain(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        const size_t maxChunks = info.Length() > 0 && info[0].IsNumber()
            ? std::max<size_t>(1, info[0].As<Napi::Number>().Uint32Value())
            : kDefaultDrainChunkLimit;

        std::deque<CapturedChunk> drainedChunks;
        size_t overwriteCount = 0;
        size_t queueDepth = 0;

        {
            std::lock_guard<std::mutex> lock(chunkMutex_);
            const size_t chunkCount = std::min(maxChunks, chunkQueue_.size());
            for (size_t index = 0; index < chunkCount; ++index) {
                drainedChunks.push_back(std::move(chunkQueue_.front()));
                chunkQueue_.pop_front();
            }
            overwriteCount = overwriteCount_;
            overwriteCount_ = 0;
            queueDepth = chunkQueue_.size();
        }

        Napi::Array chunks = Napi::Array::New(env, drainedChunks.size());
        for (size_t index = 0; index < drainedChunks.size(); ++index) {
            const auto& chunk = drainedChunks[index];
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

    Napi::Value NowMilliseconds(const Napi::CallbackInfo& info) const {
        return Napi::Number::New(info.Env(), monotonicMilliseconds());
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

        std::vector<OutputDeviceInfo> devices;
        if (!connection_.enumerateOutputDevices(&devices, outErrorMessage)) {
            connection_.disconnect();
            return false;
        }

        const OutputDeviceInfo* selected = nullptr;
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
                        "The selected Linux output device is no longer available.";
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

        if (!isSupportedSampleFormat(selected->sampleSpec.format)) {
            if (outErrorMessage != nullptr) {
                *outErrorMessage =
                    "Unsupported PulseAudio sample format for Linux monitor capture.";
            }
            connection_.disconnect();
            return false;
        }

        pa_threaded_mainloop_lock(connection_.mainloop());

        stream_ = pa_stream_new(
            connection_.context(),
            "Prism Output Monitor",
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
            stream_, selected->monitorSourceName.c_str(), &requestedBufferAttr, flags);
        if (connectResult < 0) {
            const std::string errorMessage = buildContextErrorMessage(
                connection_.context(), "Could not start Linux monitor capture.");
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
                            "PulseAudio monitor stream failed to initialize.");
                    }
                    return false;
                default:
                    pa_threaded_mainloop_wait(connection_.mainloop());
                    break;
            }
        }

        if (outErrorMessage != nullptr) {
            *outErrorMessage = "PulseAudio monitor stream is unavailable.";
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
            {
                std::lock_guard<std::mutex> lock(stateMutex_);
                if (!active_) {
                    pa_stream_drop(stream_);
                    break;
                }
                sampleSpec = sampleSpec_;
                channelCount = channelCount_;
                sequence = ++sequence_;
            }

            const size_t bytesPerFrame = pa_frame_size(&sampleSpec);
            if (bytesPerFrame == 0) {
                pa_stream_drop(stream_);
                break;
            }

            const size_t bytesPerSample = pa_sample_size_of_format(sampleSpec.format);
            const size_t frames = length / bytesPerFrame;
            if (frames == 0) {
                pa_stream_drop(stream_);
                break;
            }

            CapturedChunk chunk;
            chunk.channelCount = channelCount;
            chunk.capturedAtMilliseconds = monotonicMilliseconds();
            chunk.sequence = sequence;
            chunk.left.resize(frames);
            chunk.right.resize(frames);

            if (data != nullptr) {
                const auto* rawData = static_cast<const uint8_t*>(data);
                for (size_t frameIndex = 0; frameIndex < frames; ++frameIndex) {
                    const uint8_t* frameData = rawData + (frameIndex * bytesPerFrame);
                    const float left = readNormalizedSample(frameData, sampleSpec.format);
                    const float right = channelCount > 1
                        ? readNormalizedSample(frameData + bytesPerSample, sampleSpec.format)
                        : left;
                    chunk.left[frameIndex] = left;
                    chunk.right[frameIndex] = right;
                }
            } else {
                std::fill(chunk.left.begin(), chunk.left.end(), 0.0f);
                std::fill(chunk.right.begin(), chunk.right.end(), 0.0f);
            }

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

LinuxNativeCaptureEngine& GetLinuxNativeCaptureEngine() {
    static LinuxNativeCaptureEngine engine;
    return engine;
}

Napi::Value LinuxGetSupport(const Napi::CallbackInfo& info) {
    return GetLinuxNativeCaptureEngine().GetSupport(info);
}

Napi::Value LinuxListOutputDevices(const Napi::CallbackInfo& info) {
    return GetLinuxNativeCaptureEngine().ListOutputDevices(info);
}

Napi::Value LinuxStart(const Napi::CallbackInfo& info) {
    return GetLinuxNativeCaptureEngine().Start(info);
}

Napi::Value LinuxStop(const Napi::CallbackInfo& info) {
    return GetLinuxNativeCaptureEngine().Stop(info);
}

Napi::Value LinuxDrain(const Napi::CallbackInfo& info) {
    return GetLinuxNativeCaptureEngine().Drain(info);
}

Napi::Value LinuxNowMilliseconds(const Napi::CallbackInfo& info) {
    return GetLinuxNativeCaptureEngine().NowMilliseconds(info);
}

}  // namespace

void RegisterLinuxCapture(Napi::Env env, Napi::Object exports) {
    Napi::Object captureExports = Napi::Object::New(env);
    captureExports.Set("getSupport", Napi::Function::New(env, LinuxGetSupport));
    captureExports.Set(
        "listOutputDevices", Napi::Function::New(env, LinuxListOutputDevices));
    captureExports.Set("start", Napi::Function::New(env, LinuxStart));
    captureExports.Set("stop", Napi::Function::New(env, LinuxStop));
    captureExports.Set("drain", Napi::Function::New(env, LinuxDrain));
    captureExports.Set("nowMilliseconds", Napi::Function::New(env, LinuxNowMilliseconds));
    exports.Set("linuxCapture", captureExports);
}

#endif
