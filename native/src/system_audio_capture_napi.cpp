#include "system_audio_capture_napi.h"

#include "system_audio_capture.h"

#include <algorithm>
#include <cstring>
#include <memory>
#include <string>

namespace {

constexpr size_t kDefaultDrainChunkLimit = 64;
constexpr size_t kMaxDrainChunkLimit = 256;

std::unique_ptr<Prism::Capture::SystemAudioCapture>& activeCapture() {
    static std::unique_ptr<Prism::Capture::SystemAudioCapture> capture =
        Prism::Capture::createSystemAudioCapture();
    return capture;
}

const char* activeExportName() {
#if defined(__APPLE__)
    return "macosCapture";
#elif defined(_WIN32)
    return "windowsCapture";
#else
    return "linuxCapture";
#endif
}

Napi::Object supportToNapi(Napi::Env env, const Prism::Capture::Support& support) {
    Napi::Object result = Napi::Object::New(env);
    result.Set("available", Napi::Boolean::New(env, support.available));
    if (support.available || support.reason.empty()) {
        result.Set("reason", env.Null());
    } else {
        result.Set("reason", Napi::String::New(env, support.reason));
    }
    return result;
}

Napi::Array channelsToNapi(
    Napi::Env env,
    const std::vector<Prism::Capture::ChannelDescriptor>& channels,
    uint32_t fallbackCount) {
    const uint32_t count = channels.empty()
        ? fallbackCount
        : static_cast<uint32_t>(channels.size());
    Napi::Array result = Napi::Array::New(env, count);
    for (uint32_t index = 0; index < count; ++index) {
        Napi::Object channel = Napi::Object::New(env);
        const std::string label = index < channels.size() && !channels[index].label.empty()
            ? channels[index].label
            : "Channel " + std::to_string(index + 1);
        channel.Set("index", Napi::Number::New(env, index));
        channel.Set("label", Napi::String::New(env, label));
        result.Set(index, channel);
    }
    return result;
}

Napi::Object routingToNapi(Napi::Env env, const Prism::Capture::ChannelRouting& routing) {
    Napi::Object result = Napi::Object::New(env);
    result.Set("left", Napi::Number::New(env, routing.left));
    result.Set("right", Napi::Number::New(env, routing.right));
    return result;
}

Napi::Object drainToNapi(Napi::Env env, Prism::Capture::DrainResult&& drained) {
    Napi::Array chunks = Napi::Array::New(env, drained.chunks.size());
    for (size_t index = 0; index < drained.chunks.size(); ++index) {
        auto& chunk = drained.chunks[index];
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
        entry.Set("channelCount", Napi::Number::New(env, chunk.channelCount));
        entry.Set("capturedAtMilliseconds", Napi::Number::New(env, chunk.capturedAtMilliseconds));
        entry.Set("sequence", Napi::Number::New(env, static_cast<double>(chunk.sequence)));
        chunks.Set(static_cast<uint32_t>(index), entry);
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("chunks", chunks);
    result.Set("overwriteCount", Napi::Number::New(env, static_cast<double>(drained.overwriteCount)));
    result.Set("queueDepth", Napi::Number::New(env, static_cast<double>(drained.queueDepth)));
    return result;
}

Napi::Value GetSupport(const Napi::CallbackInfo& info) {
    return supportToNapi(info.Env(), activeCapture()->getSupport());
}

Napi::Value ListOutputDevices(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const auto devices = activeCapture()->listOutputDevices();
    Napi::Array result = Napi::Array::New(env, devices.size());
    for (size_t index = 0; index < devices.size(); ++index) {
        const auto& device = devices[index];
        Napi::Object entry = Napi::Object::New(env);
        entry.Set("id", Napi::String::New(env, device.id));
        entry.Set("label", Napi::String::New(env, device.label));
        entry.Set("kind", Napi::String::New(env, "system"));
        entry.Set("isDefault", Napi::Boolean::New(env, device.isDefault));
        entry.Set("sampleRate", Napi::Number::New(env, device.sampleRate));
        entry.Set("channelCount", Napi::Number::New(env, device.channelCount));
        entry.Set("channels", channelsToNapi(env, device.channels, device.channelCount));
#if defined(__APPLE__)
        entry.Set("channelRoutingAvailable", Napi::Boolean::New(env, true));
#else
        entry.Set("channelRoutingAvailable", Napi::Boolean::New(env, false));
#endif
        result.Set(static_cast<uint32_t>(index), entry);
    }
    return result;
}

Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string requestedDeviceId;
    if (info.Length() >= 1 && info[0].IsString()) {
        requestedDeviceId = info[0].As<Napi::String>().Utf8Value();
    }

    if (info.Length() >= 2 && info[1].IsObject()) {
        const Napi::Object routing = info[1].As<Napi::Object>();
        if (routing.Has("left") && routing.Has("right")
            && routing.Get("left").IsNumber() && routing.Get("right").IsNumber()) {
            activeCapture()->setChannelRouting(
                routing.Get("left").As<Napi::Number>().Uint32Value(),
                routing.Get("right").As<Napi::Number>().Uint32Value());
        }
    }

    Prism::Capture::StartResult started;
    std::string errorMessage;
    if (!activeCapture()->start(requestedDeviceId, &started, &errorMessage)) {
        Napi::Error::New(env, errorMessage.empty() ? "System audio capture failed to start." : errorMessage)
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("sampleRate", Napi::Number::New(env, started.sampleRate));
    result.Set("channelCount", Napi::Number::New(env, started.channelCount));
    result.Set("sourceChannelCount", Napi::Number::New(env, started.sourceChannelCount));
    result.Set("deviceId", Napi::String::New(env, started.deviceId));
    result.Set("deviceLabel", Napi::String::New(env, started.deviceLabel));
    return result;
}

Napi::Value SetChannelRouting(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected left and right channel indices.")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return routingToNapi(
        env,
        activeCapture()->setChannelRouting(
            info[0].As<Napi::Number>().Uint32Value(),
            info[1].As<Napi::Number>().Uint32Value()));
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
    activeCapture()->stop();
    return info.Env().Undefined();
}

Napi::Value Drain(const Napi::CallbackInfo& info) {
    size_t maxChunks = kDefaultDrainChunkLimit;
    if (info.Length() >= 1 && info[0].IsNumber()) {
        const int64_t requested = info[0].As<Napi::Number>().Int64Value();
        if (requested > 0) {
            maxChunks = std::min(static_cast<size_t>(requested), kMaxDrainChunkLimit);
        }
    }
    return drainToNapi(info.Env(), activeCapture()->drain(maxChunks));
}

Napi::Value NowMilliseconds(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), activeCapture()->nowMilliseconds());
}

void RegisterCaptureObject(Napi::Env env, Napi::Object exports, const char* exportName) {
    Napi::Object capture = Napi::Object::New(env);
    capture.Set("getSupport", Napi::Function::New(env, GetSupport));
    capture.Set("listOutputDevices", Napi::Function::New(env, ListOutputDevices));
    capture.Set("start", Napi::Function::New(env, Start));
    capture.Set("stop", Napi::Function::New(env, Stop));
    capture.Set("drain", Napi::Function::New(env, Drain));
    capture.Set("nowMilliseconds", Napi::Function::New(env, NowMilliseconds));
#if defined(__APPLE__)
    capture.Set("setChannelRouting", Napi::Function::New(env, SetChannelRouting));
#endif
    exports.Set(exportName, capture);
}

Napi::Value UnavailableGetSupport(const Napi::CallbackInfo& info) {
    Napi::Object support = Napi::Object::New(info.Env());
    support.Set("available", Napi::Boolean::New(info.Env(), false));
    support.Set(
        "reason",
        Napi::String::New(info.Env(), "This system-audio capture backend is unavailable on the current platform."));
    return support;
}

Napi::Value UnavailableListOutputDevices(const Napi::CallbackInfo& info) {
    return Napi::Array::New(info.Env());
}

Napi::Value UnavailableStart(const Napi::CallbackInfo& info) {
    Napi::Error::New(
        info.Env(), "This system-audio capture backend is unavailable on the current platform.")
        .ThrowAsJavaScriptException();
    return info.Env().Undefined();
}

Napi::Value UnavailableStop(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Value UnavailableDrain(const Napi::CallbackInfo& info) {
    Napi::Object result = Napi::Object::New(info.Env());
    result.Set("chunks", Napi::Array::New(info.Env()));
    result.Set("overwriteCount", Napi::Number::New(info.Env(), 0));
    result.Set("queueDepth", Napi::Number::New(info.Env(), 0));
    return result;
}

Napi::Value UnavailableNowMilliseconds(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), 0);
}

void RegisterUnavailableCaptureObject(Napi::Env env, Napi::Object exports, const char* exportName) {
    Napi::Object capture = Napi::Object::New(env);
    capture.Set("getSupport", Napi::Function::New(env, UnavailableGetSupport));
    capture.Set("listOutputDevices", Napi::Function::New(env, UnavailableListOutputDevices));
    capture.Set("start", Napi::Function::New(env, UnavailableStart));
    capture.Set("stop", Napi::Function::New(env, UnavailableStop));
    capture.Set("drain", Napi::Function::New(env, UnavailableDrain));
    capture.Set("nowMilliseconds", Napi::Function::New(env, UnavailableNowMilliseconds));
    exports.Set(exportName, capture);
}

}  // namespace

void RegisterSystemAudioCapture(Napi::Env env, Napi::Object exports) {
    RegisterCaptureObject(env, exports, activeExportName());
#if !defined(__APPLE__)
    RegisterUnavailableCaptureObject(env, exports, "macosCapture");
#endif
#if !defined(_WIN32)
    RegisterUnavailableCaptureObject(env, exports, "windowsCapture");
#endif
#if defined(__APPLE__) || defined(_WIN32)
    RegisterUnavailableCaptureObject(env, exports, "linuxCapture");
#endif
}
