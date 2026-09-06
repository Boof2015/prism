#include "capture_channel_selection_napi.h"

#include "capture_channel_selection.h"

#include <cstdint>
#include <vector>

namespace {

Napi::Value SelectFloat32(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 5 || !info[0].IsArray() || !info[1].IsNumber()
        || !info[2].IsNumber() || !info[3].IsNumber() || !info[4].IsNumber()) {
        Napi::TypeError::New(
            env,
            "Expected buffers, frame count, source channel count, left channel, and right channel.")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const Napi::Array sourceBuffers = info[0].As<Napi::Array>();
    std::vector<Napi::Float32Array> retainedArrays;
    std::vector<Prism::Capture::PCMBufferView> buffers;
    retainedArrays.reserve(sourceBuffers.Length());
    buffers.reserve(sourceBuffers.Length());
    for (uint32_t index = 0; index < sourceBuffers.Length(); ++index) {
        const Napi::Value value = sourceBuffers.Get(index);
        if (value.IsNull() || value.IsUndefined()) {
            buffers.push_back({nullptr, 0, 1});
            continue;
        }
        if (!value.IsObject()) {
            Napi::TypeError::New(env, "Each buffer must be an object or null.")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        const Napi::Object entry = value.As<Napi::Object>();
        const Napi::Value dataValue = entry.Get("data");
        const Napi::Value channelCountValue = entry.Get("channelCount");
        if (!dataValue.IsTypedArray() || !channelCountValue.IsNumber()) {
            Napi::TypeError::New(env, "Each buffer requires Float32Array data and channelCount.")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        const Napi::TypedArray typedArray = dataValue.As<Napi::TypedArray>();
        if (typedArray.TypedArrayType() != napi_float32_array) {
            Napi::TypeError::New(env, "Buffer data must be a Float32Array.")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
        retainedArrays.push_back(dataValue.As<Napi::Float32Array>());
        const auto& retained = retainedArrays.back();
        buffers.push_back({
            reinterpret_cast<const uint8_t*>(retained.Data()),
            retained.ElementLength() * sizeof(float),
            channelCountValue.As<Napi::Number>().Uint32Value(),
        });
    }

    const size_t frameCount = info[1].As<Napi::Number>().Uint32Value();
    Napi::Float32Array left = Napi::Float32Array::New(env, frameCount);
    Napi::Float32Array right = Napi::Float32Array::New(env, frameCount);
    const bool valid = Prism::Capture::selectStereoChannels(
        buffers.data(),
        buffers.size(),
        {Prism::Capture::SampleEncoding::Float, 32, false},
        frameCount,
        info[2].As<Napi::Number>().Uint32Value(),
        info[3].As<Napi::Number>().Uint32Value(),
        info[4].As<Napi::Number>().Uint32Value(),
        left.Data(),
        right.Data());

    Napi::Object result = Napi::Object::New(env);
    result.Set("valid", Napi::Boolean::New(env, valid));
    result.Set("left", left);
    result.Set("right", right);
    return result;
}

}  // namespace

void RegisterCaptureChannelSelection(Napi::Env env, Napi::Object exports) {
    Napi::Object helper = Napi::Object::New(env);
    helper.Set("selectFloat32", Napi::Function::New(env, SelectFloat32));
    exports.Set("captureChannelSelection", helper);
}
