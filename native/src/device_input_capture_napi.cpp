#include "device_input_capture_napi.h"

#include "device_input_capture.h"

#include <algorithm>
#include <cstring>
#include <memory>
#include <string>

namespace {

constexpr size_t kDefaultDrainChunkLimit = 64;
constexpr size_t kMaxDrainChunkLimit = 256;

std::unique_ptr<Prism::Capture::DeviceInputCapture>& activeInputCapture() {
    static std::unique_ptr<Prism::Capture::DeviceInputCapture> capture =
        Prism::Capture::createDeviceInputCapture();
    return capture;
}

Napi::Object routingToNapi(Napi::Env env, const Prism::Capture::ChannelRouting& routing) {
    Napi::Object result = Napi::Object::New(env);
    result.Set("left", Napi::Number::New(env, routing.left));
    result.Set("right", Napi::Number::New(env, routing.right));
    return result;
}

Napi::Value GetSupport(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const auto support = activeInputCapture()->getSupport();
    Napi::Object result = Napi::Object::New(env);
    result.Set("available", Napi::Boolean::New(env, support.available));
    result.Set("reason", support.reason.empty()
        ? static_cast<Napi::Value>(env.Null())
        : static_cast<Napi::Value>(Napi::String::New(env, support.reason)));
    return result;
}

Napi::Value ListInputDevices(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const auto devices = activeInputCapture()->listInputDevices();
    Napi::Array result = Napi::Array::New(env, devices.size());
    for (size_t index = 0; index < devices.size(); ++index) {
        const auto& device = devices[index];
        Napi::Object entry = Napi::Object::New(env);
        entry.Set("id", Napi::String::New(env, device.id));
        entry.Set("label", Napi::String::New(env, device.label));
        entry.Set("kind", Napi::String::New(env, "device"));
        entry.Set("isDefault", Napi::Boolean::New(env, device.isDefault));
        entry.Set("sampleRate", Napi::Number::New(env, device.sampleRate));
        entry.Set("channelCount", Napi::Number::New(env, device.channelCount));
        entry.Set("channelRoutingAvailable", Napi::Boolean::New(env, true));

        Napi::Array channels = Napi::Array::New(env, device.channelCount);
        for (uint32_t channelIndex = 0; channelIndex < device.channelCount; ++channelIndex) {
            Napi::Object channel = Napi::Object::New(env);
            const std::string label = channelIndex < device.channels.size()
                && !device.channels[channelIndex].label.empty()
                ? device.channels[channelIndex].label
                : "Channel " + std::to_string(channelIndex + 1);
            channel.Set("index", Napi::Number::New(env, channelIndex));
            channel.Set("label", Napi::String::New(env, label));
            channels.Set(channelIndex, channel);
        }
        entry.Set("channels", channels);
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
            activeInputCapture()->setChannelRouting(
                routing.Get("left").As<Napi::Number>().Uint32Value(),
                routing.Get("right").As<Napi::Number>().Uint32Value());
        }
    }

    Prism::Capture::StartResult started;
    std::string errorMessage;
    if (!activeInputCapture()->start(requestedDeviceId, &started, &errorMessage)) {
        Napi::Error::New(
            env,
            errorMessage.empty() ? "Device input capture failed to start." : errorMessage)
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
        activeInputCapture()->setChannelRouting(
            info[0].As<Napi::Number>().Uint32Value(),
            info[1].As<Napi::Number>().Uint32Value()));
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
    activeInputCapture()->stop();
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

    Napi::Env env = info.Env();
    auto drained = activeInputCapture()->drain(maxChunks);
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
    result.Set("queueDepth", Napi::Number::New(env, drained.queueDepth));
    return result;
}

Napi::Value NowMilliseconds(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), activeInputCapture()->nowMilliseconds());
}

}  // namespace

void RegisterDeviceInputCapture(Napi::Env env, Napi::Object exports) {
    Napi::Object capture = Napi::Object::New(env);
    capture.Set("getSupport", Napi::Function::New(env, GetSupport));
    capture.Set("listInputDevices", Napi::Function::New(env, ListInputDevices));
    capture.Set("start", Napi::Function::New(env, Start));
    capture.Set("setChannelRouting", Napi::Function::New(env, SetChannelRouting));
    capture.Set("stop", Napi::Function::New(env, Stop));
    capture.Set("drain", Napi::Function::New(env, Drain));
    capture.Set("nowMilliseconds", Napi::Function::New(env, NowMilliseconds));
    exports.Set("deviceInputCapture", capture);
}
