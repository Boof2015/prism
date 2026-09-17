#include "waterfall_napi.h"
#include "waterfall.h"
#include <algorithm>
#include <cstring>

namespace {
Visualizer::WaterfallAnalyzer analyzer;
Napi::Value configure(const Napi::CallbackInfo& info) {
    const auto env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected waterfall configuration").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const auto options = info[0].As<Napi::Object>();
    Visualizer::WaterfallConfig config;
    const auto number = [&](const char* name, float fallback) {
        auto value = options.Get(name);
        return value.IsNumber() ? value.As<Napi::Number>().FloatValue() : fallback;
    };
    config.sampleRate = number("sampleRate", config.sampleRate);
    auto fft = options.Get("fftSize");
    if (fft.IsNumber()) config.fftSize = fft.As<Napi::Number>().Uint32Value();
    config.historySeconds = number("historySeconds", config.historySeconds);
    config.smoothing = number("smoothing", config.smoothing);
    config.tiltDbPerOctave = number("tiltDbPerOctave", config.tiltDbPerOctave);
    config.minFrequency = number("minFrequency", config.minFrequency);
    config.maxFrequency = number("maxFrequency", config.maxFrequency);
    auto scale = options.Get("scaleMode");
    if (scale.IsString()) config.scaleMode = scale.As<Napi::String>().Utf8Value();
    analyzer.configure(config);
    return env.Undefined();
}
Napi::Value processStereo(const Napi::CallbackInfo& info) {
    const auto env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()
        || info[0].As<Napi::TypedArray>().TypedArrayType() != napi_float32_array
        || info[1].As<Napi::TypedArray>().TypedArrayType() != napi_float32_array) {
        Napi::TypeError::New(env, "Expected left and right Float32Array audio").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const auto left = info[0].As<Napi::Float32Array>();
    const auto right = info[1].As<Napi::Float32Array>();
    analyzer.processStereo(left.Data(), right.Data(), std::min(left.ElementLength(), right.ElementLength()));
    return env.Undefined();
}
Napi::Value getFrame(const Napi::CallbackInfo& info) {
    const auto env = info.Env();
    const size_t ridges = info.Length() > 0 && info[0].IsNumber() ? info[0].As<Napi::Number>().Uint32Value() : 32;
    const size_t columns = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().Uint32Value() : 256;
    const auto frame = analyzer.getFrame(ridges, columns);
    auto output = Napi::Object::New(env);
    const auto floats = [&](const char* name, const std::vector<float>& values) {
        auto array = Napi::Float32Array::New(env, values.size());
        if (!values.empty()) std::memcpy(array.Data(), values.data(), values.size() * sizeof(float));
        output.Set(name, array);
    };
    floats("levels", frame.levels);
    floats("ages", frame.ages);
    floats("frequencies", frame.frequencies);
    output.Set("columns", Napi::Number::New(env, frame.columns));
    output.Set("audioSeconds", Napi::Number::New(env, frame.audioSeconds));
    return output;
}
}

void RegisterWaterfall(Napi::Env env, Napi::Object exports) {
    auto api = Napi::Object::New(env);
    api.Set("configure", Napi::Function::New(env, configure));
    api.Set("processStereo", Napi::Function::New(env, processStereo));
    api.Set("getFrame", Napi::Function::New(env, getFrame));
    api.Set("reset", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        analyzer.reset();
        return info.Env().Undefined();
    }));
    exports.Set("waterfall", api);
}
