#include <napi.h>
#include <cstring>
#include "linux_capture.h"
#include "macos_capture.h"
#include "windows_capture.h"
#include "oscilloscope.h"
#include "spectrum.h"
#include "vectorscope.h"

// Global instances
static Visualizer::Oscilloscope oscilloscope;
static Visualizer::Spectrum spectrum(2048);
static Visualizer::Vectorscope vectorscope;

// ============== Oscilloscope ==============

Napi::Value OscilloscopeSetSampleRate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected sample rate").ThrowAsJavaScriptException();
        return env.Null();
    }
    oscilloscope.setSampleRate(info[0].As<Napi::Number>().FloatValue());
    return env.Undefined();
}

Napi::Value OscilloscopeSetPitchLock(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) {
        Napi::TypeError::New(env, "Expected boolean").ThrowAsJavaScriptException();
        return env.Null();
    }
    oscilloscope.setPitchLock(info[0].As<Napi::Boolean>().Value());
    return env.Undefined();
}

Napi::Value OscilloscopeSetDisplaySamples(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected number").ThrowAsJavaScriptException();
        return env.Null();
    }
    oscilloscope.setDisplaySamples(info[0].As<Napi::Number>().Int32Value());
    return env.Undefined();
}

Napi::Value OscilloscopePushSamples(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected Float32Array").ThrowAsJavaScriptException();
        return env.Null();
    }
    Napi::Float32Array audioData = info[0].As<Napi::Float32Array>();
    oscilloscope.pushSamples(audioData.Data(), audioData.ElementLength());
    return env.Undefined();
}

Napi::Value OscilloscopeProcessContinuous(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto result = oscilloscope.process();
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("triggerIndex", Napi::Number::New(env, result.triggerIndex));
    obj.Set("samplesToShow", Napi::Number::New(env, result.samplesToShow));
    obj.Set("detectedPitch", Napi::Number::New(env, result.detectedPitch));
    obj.Set("writePos", Napi::Number::New(env, static_cast<double>(oscilloscope.getWritePos())));
    return obj;
}

Napi::Value OscilloscopeProcess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected Float32Array").ThrowAsJavaScriptException();
        return env.Null();
    }
    Napi::Float32Array audioData = info[0].As<Napi::Float32Array>();
    auto result = oscilloscope.processSnapshot(audioData.Data(), audioData.ElementLength());
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("triggerIndex", Napi::Number::New(env, result.triggerIndex));
    obj.Set("samplesToShow", Napi::Number::New(env, result.samplesToShow));
    obj.Set("detectedPitch", Napi::Number::New(env, result.detectedPitch));
    obj.Set("writePos", Napi::Number::New(env, static_cast<double>(oscilloscope.getWritePos())));
    return obj;
}

Napi::Value OscilloscopeGetWritePos(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), static_cast<double>(oscilloscope.getWritePos()));
}

Napi::Value OscilloscopeGetSamples(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected startPos (float) and count").ThrowAsJavaScriptException();
        return env.Null();
    }
    float startPos = info[0].As<Napi::Number>().FloatValue();
    size_t count = static_cast<size_t>(info[1].As<Napi::Number>().Uint32Value());
    Napi::Float32Array output = Napi::Float32Array::New(env, count);
    oscilloscope.getSamplesInterpolated(output.Data(), startPos, count);
    return output;
}

Napi::Value OscilloscopeFillSamples(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected startPos (float) and output Float32Array").ThrowAsJavaScriptException();
        return env.Null();
    }
    float startPos = info[0].As<Napi::Number>().FloatValue();
    Napi::Float32Array output = info[1].As<Napi::Float32Array>();
    const size_t count = output.ElementLength();
    oscilloscope.getSamplesInterpolated(output.Data(), startPos, count);
    return Napi::Number::New(env, static_cast<double>(count));
}

Napi::Value OscilloscopeReset(const Napi::CallbackInfo& info) {
    oscilloscope.reset();
    return info.Env().Undefined();
}

// ============== Spectrum ==============

Napi::Value SpectrumSetFFTSize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected FFT size").ThrowAsJavaScriptException();
        return env.Null();
    }
    spectrum.setFFTSize(info[0].As<Napi::Number>().Uint32Value());
    return env.Undefined();
}

Napi::Value SpectrumGetFFTSize(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), spectrum.getFFTSize());
}

Napi::Value SpectrumSetSampleRate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected sample rate").ThrowAsJavaScriptException();
        return env.Null();
    }
    spectrum.setSampleRate(info[0].As<Napi::Number>().FloatValue());
    return env.Undefined();
}

Napi::Value SpectrumSetSmoothing(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected smoothing value").ThrowAsJavaScriptException();
        return env.Null();
    }
    spectrum.setSmoothing(info[0].As<Napi::Number>().FloatValue());
    return env.Undefined();
}

Napi::Value SpectrumPushSamples(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected Float32Array").ThrowAsJavaScriptException();
        return env.Null();
    }
    Napi::Float32Array audioData = info[0].As<Napi::Float32Array>();
    spectrum.pushSamples(audioData.Data(), audioData.ElementLength());
    return env.Undefined();
}

Napi::Value SpectrumGetMagnitudes(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const auto& magnitudes = spectrum.getMagnitudes();
    Napi::Float32Array result = Napi::Float32Array::New(env, magnitudes.size());
    memcpy(result.Data(), magnitudes.data(), magnitudes.size() * sizeof(float));
    return result;
}

Napi::Value SpectrumGetRawMagnitudes(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const auto& magnitudes = spectrum.getRawMagnitudes();
    Napi::Float32Array result = Napi::Float32Array::New(env, magnitudes.size());
    memcpy(result.Data(), magnitudes.data(), magnitudes.size() * sizeof(float));
    return result;
}

Napi::Value SpectrumFillRawMagnitudes(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected output Float32Array").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array output = info[0].As<Napi::Float32Array>();
    const auto& magnitudes = spectrum.getRawMagnitudes();
    const size_t count = std::min(output.ElementLength(), magnitudes.size());
    if (count > 0) {
        memcpy(output.Data(), magnitudes.data(), count * sizeof(float));
    }
    return Napi::Number::New(env, static_cast<double>(count));
}

Napi::Value SpectrumFillMagnitudes(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected output Float32Array").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array output = info[0].As<Napi::Float32Array>();
    const auto& magnitudes = spectrum.getMagnitudes();
    const size_t count = std::min(output.ElementLength(), magnitudes.size());
    if (count > 0) {
        memcpy(output.Data(), magnitudes.data(), count * sizeof(float));
    }
    return Napi::Number::New(env, static_cast<double>(count));
}

Napi::Value SpectrumProcess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected Float32Array").ThrowAsJavaScriptException();
        return env.Null();
    }
    Napi::Float32Array audioData = info[0].As<Napi::Float32Array>();
    const auto& magnitudes = spectrum.process(audioData.Data(), audioData.ElementLength());
    Napi::Float32Array result = Napi::Float32Array::New(env, magnitudes.size());
    memcpy(result.Data(), magnitudes.data(), magnitudes.size() * sizeof(float));
    return result;
}

Napi::Value SpectrumBinToFrequency(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected bin number").ThrowAsJavaScriptException();
        return env.Null();
    }
    return Napi::Number::New(env, spectrum.binToFrequency(info[0].As<Napi::Number>().Int32Value()));
}

Napi::Value SpectrumReset(const Napi::CallbackInfo& info) {
    spectrum.reset();
    return info.Env().Undefined();
}

// ============== Vectorscope ==============

Napi::Value VectorscopeSetSampleRate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected sample rate").ThrowAsJavaScriptException();
        return env.Null();
    }
    vectorscope.setSampleRate(info[0].As<Napi::Number>().FloatValue());
    return env.Undefined();
}

Napi::Value VectorscopePushSamples(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected two Float32Arrays (left, right)").ThrowAsJavaScriptException();
        return env.Null();
    }
    Napi::Float32Array leftData = info[0].As<Napi::Float32Array>();
    Napi::Float32Array rightData = info[1].As<Napi::Float32Array>();
    size_t length = std::min(leftData.ElementLength(), rightData.ElementLength());
    vectorscope.pushSamples(leftData.Data(), rightData.Data(), length);
    return env.Undefined();
}

Napi::Value VectorscopeGetPoints(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected max points count").ThrowAsJavaScriptException();
        return env.Null();
    }
    size_t maxPoints = static_cast<size_t>(info[0].As<Napi::Number>().Uint32Value());
    Napi::Float32Array xArray = Napi::Float32Array::New(env, maxPoints);
    Napi::Float32Array yArray = Napi::Float32Array::New(env, maxPoints);
    size_t actual = vectorscope.getPoints(xArray.Data(), yArray.Data(), maxPoints);
    Napi::Object result = Napi::Object::New(env);
    if (actual < maxPoints) {
        Napi::Float32Array xTrimmed = Napi::Float32Array::New(env, actual);
        Napi::Float32Array yTrimmed = Napi::Float32Array::New(env, actual);
        memcpy(xTrimmed.Data(), xArray.Data(), actual * sizeof(float));
        memcpy(yTrimmed.Data(), yArray.Data(), actual * sizeof(float));
        result.Set("x", xTrimmed);
        result.Set("y", yTrimmed);
    } else {
        result.Set("x", xArray);
        result.Set("y", yArray);
    }
    result.Set("count", Napi::Number::New(env, static_cast<double>(actual)));
    return result;
}

Napi::Value VectorscopeFillPoints(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected output x/y Float32Arrays").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array xArray = info[0].As<Napi::Float32Array>();
    Napi::Float32Array yArray = info[1].As<Napi::Float32Array>();
    const size_t maxPoints = std::min(xArray.ElementLength(), yArray.ElementLength());
    const size_t actual = vectorscope.getPoints(xArray.Data(), yArray.Data(), maxPoints);
    return Napi::Number::New(env, static_cast<double>(actual));
}

Napi::Value VectorscopeSetBufferSize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected buffer size").ThrowAsJavaScriptException();
        return env.Null();
    }
    vectorscope.setBufferSize(info[0].As<Napi::Number>().Uint32Value());
    return env.Undefined();
}

Napi::Value VectorscopeGetBufferSize(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), vectorscope.getBufferSize());
}

Napi::Value VectorscopeProcess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected two Float32Arrays (left, right)").ThrowAsJavaScriptException();
        return env.Null();
    }
    Napi::Float32Array leftData = info[0].As<Napi::Float32Array>();
    Napi::Float32Array rightData = info[1].As<Napi::Float32Array>();
    size_t length = std::min(leftData.ElementLength(), rightData.ElementLength());
    const auto& points = vectorscope.process(leftData.Data(), rightData.Data(), length);
    Napi::Float32Array xArray = Napi::Float32Array::New(env, points.size());
    Napi::Float32Array yArray = Napi::Float32Array::New(env, points.size());
    for (size_t i = 0; i < points.size(); i++) {
        xArray[i] = points[i].x;
        yArray[i] = points[i].y;
    }
    Napi::Object result = Napi::Object::New(env);
    result.Set("x", xArray);
    result.Set("y", yArray);
    return result;
}

Napi::Value VectorscopeReset(const Napi::CallbackInfo& info) {
    vectorscope.reset();
    return info.Env().Undefined();
}

// ============== Module Init ==============

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Oscilloscope
    Napi::Object oscExports = Napi::Object::New(env);
    oscExports.Set("setSampleRate", Napi::Function::New(env, OscilloscopeSetSampleRate));
    oscExports.Set("setPitchLock", Napi::Function::New(env, OscilloscopeSetPitchLock));
    oscExports.Set("setDisplaySamples", Napi::Function::New(env, OscilloscopeSetDisplaySamples));
    oscExports.Set("process", Napi::Function::New(env, OscilloscopeProcess));
    oscExports.Set("pushSamples", Napi::Function::New(env, OscilloscopePushSamples));
    oscExports.Set("processContinuous", Napi::Function::New(env, OscilloscopeProcessContinuous));
    oscExports.Set("getWritePos", Napi::Function::New(env, OscilloscopeGetWritePos));
    oscExports.Set("fillSamples", Napi::Function::New(env, OscilloscopeFillSamples));
    oscExports.Set("getSamples", Napi::Function::New(env, OscilloscopeGetSamples));
    oscExports.Set("reset", Napi::Function::New(env, OscilloscopeReset));
    exports.Set("oscilloscope", oscExports);

    // Spectrum
    Napi::Object specExports = Napi::Object::New(env);
    specExports.Set("setFFTSize", Napi::Function::New(env, SpectrumSetFFTSize));
    specExports.Set("getFFTSize", Napi::Function::New(env, SpectrumGetFFTSize));
    specExports.Set("setSampleRate", Napi::Function::New(env, SpectrumSetSampleRate));
    specExports.Set("setSmoothing", Napi::Function::New(env, SpectrumSetSmoothing));
    specExports.Set("pushSamples", Napi::Function::New(env, SpectrumPushSamples));
    specExports.Set("fillRawMagnitudes", Napi::Function::New(env, SpectrumFillRawMagnitudes));
    specExports.Set("fillMagnitudes", Napi::Function::New(env, SpectrumFillMagnitudes));
    specExports.Set("getRawMagnitudes", Napi::Function::New(env, SpectrumGetRawMagnitudes));
    specExports.Set("getMagnitudes", Napi::Function::New(env, SpectrumGetMagnitudes));
    specExports.Set("process", Napi::Function::New(env, SpectrumProcess));
    specExports.Set("binToFrequency", Napi::Function::New(env, SpectrumBinToFrequency));
    specExports.Set("reset", Napi::Function::New(env, SpectrumReset));
    exports.Set("spectrum", specExports);

    // Vectorscope
    Napi::Object vecExports = Napi::Object::New(env);
    vecExports.Set("setSampleRate", Napi::Function::New(env, VectorscopeSetSampleRate));
    vecExports.Set("pushSamples", Napi::Function::New(env, VectorscopePushSamples));
    vecExports.Set("fillPoints", Napi::Function::New(env, VectorscopeFillPoints));
    vecExports.Set("getPoints", Napi::Function::New(env, VectorscopeGetPoints));
    vecExports.Set("setBufferSize", Napi::Function::New(env, VectorscopeSetBufferSize));
    vecExports.Set("getBufferSize", Napi::Function::New(env, VectorscopeGetBufferSize));
    vecExports.Set("process", Napi::Function::New(env, VectorscopeProcess));
    vecExports.Set("reset", Napi::Function::New(env, VectorscopeReset));
    exports.Set("vectorscope", vecExports);

    RegisterMacOSCapture(env, exports);
    RegisterWindowsCapture(env, exports);
    RegisterLinuxCapture(env, exports);

    return exports;
}

NODE_API_MODULE(visualizer_dsp, Init)
