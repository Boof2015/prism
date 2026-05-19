#include <napi.h>
#include <algorithm>
#include <cstring>
#include <string>
#include "linux_capture.h"
#include "macos_capture.h"
#include "windows_capture.h"
#include "oscilloscope.h"
#include "spectrum.h"
#include "spectrogram.h"
#include "vectorscope.h"
#include "waveform.h"
#include "vumeter.h"
#include "lufsmeter.h"

// Global instances
static Visualizer::Oscilloscope oscilloscope;
static Visualizer::Spectrum spectrum(2048);
static Visualizer::SpectrogramAnalyzer spectrogramAnalyzer;
static Visualizer::Vectorscope vectorscope;
static Visualizer::WaveformMultibandAnalyzer waveform;
static Visualizer::VUMeterAnalyzer vuMeter;
static Visualizer::LUFSMeterAnalyzer lufsMeter;

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

// ============== Spectrogram ==============

namespace {
float GetObjectFloat(const Napi::Object& obj, const char* key, float fallback) {
    Napi::Value value = obj.Get(key);
    return value.IsNumber() ? value.As<Napi::Number>().FloatValue() : fallback;
}

size_t GetObjectSize(const Napi::Object& obj, const char* key, size_t fallback) {
    Napi::Value value = obj.Get(key);
    return value.IsNumber() ? static_cast<size_t>(value.As<Napi::Number>().Uint32Value()) : fallback;
}

std::string GetObjectString(const Napi::Object& obj, const char* key, const std::string& fallback) {
    Napi::Value value = obj.Get(key);
    return value.IsString() ? value.As<Napi::String>().Utf8Value() : fallback;
}
} // namespace

Napi::Value SpectrogramConfigure(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected spectrogram options object").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object options = info[0].As<Napi::Object>();
    Visualizer::SpectrogramConfig config;
    config.fftSize = GetObjectSize(options, "fftSize", config.fftSize);
    config.sampleRate = GetObjectFloat(options, "sampleRate", config.sampleRate);
    config.rowCount = GetObjectSize(options, "rowCount", config.rowCount);
    config.minFrequency = GetObjectFloat(options, "minFrequency", config.minFrequency);
    config.maxFrequency = GetObjectFloat(options, "maxFrequency", config.maxFrequency);
    config.minDecibels = GetObjectFloat(options, "minDecibels", config.minDecibels);
    config.maxDecibels = GetObjectFloat(options, "maxDecibels", config.maxDecibels);
    config.scrollSpeed = GetObjectFloat(options, "scrollSpeed", config.scrollSpeed);
    config.contrast = GetObjectFloat(options, "contrast", config.contrast);
    config.tiltDbPerOctave = GetObjectFloat(options, "tiltDbPerOctave", config.tiltDbPerOctave);
    config.clarityMode = GetObjectString(options, "clarityMode", config.clarityMode);
    config.scaleMode = GetObjectString(options, "scaleMode", config.scaleMode);
    config.orientation = GetObjectString(options, "orientation", config.orientation);

    spectrogramAnalyzer.configure(config);
    return env.Undefined();
}

Napi::Value SpectrogramProcess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected Float32Array").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array audioData = info[0].As<Napi::Float32Array>();
    auto result = spectrogramAnalyzer.process(audioData.Data(), audioData.ElementLength());

    Napi::Float32Array display = Napi::Float32Array::New(env, result.display.size());
    Napi::Float32Array heat = Napi::Float32Array::New(env, result.heat.size());
    if (!result.display.empty()) {
        memcpy(display.Data(), result.display.data(), result.display.size() * sizeof(float));
    }
    if (!result.heat.empty()) {
        memcpy(heat.Data(), result.heat.data(), result.heat.size() * sizeof(float));
    }

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("display", display);
    obj.Set("heat", heat);
    obj.Set("columnCount", Napi::Number::New(env, static_cast<double>(result.columnCount)));
    obj.Set("rowCount", Napi::Number::New(env, static_cast<double>(result.rowCount)));
    return obj;
}

Napi::Value SpectrogramReset(const Napi::CallbackInfo& info) {
    spectrogramAnalyzer.reset();
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

Napi::Value VectorscopePushMultibandSamples(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected two Float32Arrays (left, right)").ThrowAsJavaScriptException();
        return env.Null();
    }
    Napi::Float32Array leftData = info[0].As<Napi::Float32Array>();
    Napi::Float32Array rightData = info[1].As<Napi::Float32Array>();
    size_t length = std::min(leftData.ElementLength(), rightData.ElementLength());
    vectorscope.pushMultibandSamples(leftData.Data(), rightData.Data(), length);
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

Napi::Value VectorscopeGetMultibandPoints(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected max points count").ThrowAsJavaScriptException();
        return env.Null();
    }

    const size_t maxPoints = static_cast<size_t>(info[0].As<Napi::Number>().Uint32Value());
    Napi::Float32Array data = Napi::Float32Array::New(env, maxPoints * Visualizer::MULTIBAND_POINT_STRIDE);
    const size_t actual = vectorscope.getMultibandPoints(data.Data(), maxPoints);

    Napi::Object result = Napi::Object::New(env);
    if (actual < maxPoints) {
        Napi::Float32Array trimmed = Napi::Float32Array::New(env, actual * Visualizer::MULTIBAND_POINT_STRIDE);
        if (actual > 0) {
            memcpy(trimmed.Data(), data.Data(), actual * Visualizer::MULTIBAND_POINT_STRIDE * sizeof(float));
        }
        result.Set("data", trimmed);
    } else {
        result.Set("data", data);
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

// ============== Waveform ==============

Napi::Value WaveformConfigure(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected sample rate and samples per column").ThrowAsJavaScriptException();
        return env.Null();
    }

    const float sampleRate = info[0].As<Napi::Number>().FloatValue();
    const size_t samplesPerColumn = static_cast<size_t>(info[1].As<Napi::Number>().Uint32Value());
    waveform.configure(sampleRate, samplesPerColumn);
    return env.Undefined();
}

Napi::Value WaveformProcessMono(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected Float32Array").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array samples = info[0].As<Napi::Float32Array>();
    const auto& summaries = waveform.processMono(samples.Data(), samples.ElementLength());
    Napi::Float32Array result = Napi::Float32Array::New(env, summaries.size());
    if (!summaries.empty()) {
        memcpy(result.Data(), summaries.data(), summaries.size() * sizeof(float));
    }
    return result;
}

Napi::Value WaveformProcessStereo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected two Float32Arrays (left, right)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array leftData = info[0].As<Napi::Float32Array>();
    Napi::Float32Array rightData = info[1].As<Napi::Float32Array>();
    const size_t length = std::min(leftData.ElementLength(), rightData.ElementLength());
    const auto& summaries = waveform.processStereo(leftData.Data(), rightData.Data(), length);
    Napi::Float32Array result = Napi::Float32Array::New(env, summaries.size());
    if (!summaries.empty()) {
        memcpy(result.Data(), summaries.data(), summaries.size() * sizeof(float));
    }
    return result;
}

Napi::Value WaveformReset(const Napi::CallbackInfo& info) {
    waveform.reset();
    return info.Env().Undefined();
}

// ============== VU Meter ==============

Napi::Value VUMeterSetSampleRate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected sample rate").ThrowAsJavaScriptException();
        return env.Null();
    }
    vuMeter.setSampleRate(info[0].As<Napi::Number>().FloatValue());
    return env.Undefined();
}

Napi::Value VUMeterPushSamples(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected two Float32Arrays (left, right)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array leftData = info[0].As<Napi::Float32Array>();
    Napi::Float32Array rightData = info[1].As<Napi::Float32Array>();
    const size_t length = std::min(leftData.ElementLength(), rightData.ElementLength());
    vuMeter.pushSamples(leftData.Data(), rightData.Data(), length);
    return env.Undefined();
}

Napi::Value VUMeterGetSnapshot(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const auto snapshot = vuMeter.getSnapshot();

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("vuLDb", Napi::Number::New(env, snapshot.vuLDb));
    obj.Set("vuRDb", Napi::Number::New(env, snapshot.vuRDb));
    obj.Set("barLDb", Napi::Number::New(env, snapshot.barLDb));
    obj.Set("barRDb", Napi::Number::New(env, snapshot.barRDb));
    obj.Set("peakLDb", Napi::Number::New(env, snapshot.peakLDb));
    obj.Set("peakRDb", Napi::Number::New(env, snapshot.peakRDb));
    obj.Set("correlation", Napi::Number::New(env, snapshot.correlation));
    return obj;
}

Napi::Value VUMeterReset(const Napi::CallbackInfo& info) {
    vuMeter.reset();
    return info.Env().Undefined();
}

// ============== LUFS Meter ==============

Napi::Value LUFSMeterSetSampleRate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected sample rate").ThrowAsJavaScriptException();
        return env.Null();
    }
    lufsMeter.setSampleRate(info[0].As<Napi::Number>().FloatValue());
    return env.Undefined();
}

Napi::Value LUFSMeterPushSamples(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsTypedArray() || !info[1].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected two Float32Arrays (left, right)").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Float32Array leftData = info[0].As<Napi::Float32Array>();
    Napi::Float32Array rightData = info[1].As<Napi::Float32Array>();
    const size_t length = std::min(leftData.ElementLength(), rightData.ElementLength());
    lufsMeter.pushSamples(leftData.Data(), rightData.Data(), length);
    return env.Undefined();
}

Napi::Value LUFSMeterGetSnapshot(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const auto snapshot = lufsMeter.getSnapshot();

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("momentaryLUFS", Napi::Number::New(env, snapshot.momentaryLUFS));
    obj.Set("shortTermLUFS", Napi::Number::New(env, snapshot.shortTermLUFS));
    obj.Set("integratedLUFS", Napi::Number::New(env, snapshot.integratedLUFS));
    obj.Set("vuLDb", Napi::Number::New(env, snapshot.vuLDb));
    obj.Set("vuRDb", Napi::Number::New(env, snapshot.vuRDb));
    obj.Set("barLDb", Napi::Number::New(env, snapshot.barLDb));
    obj.Set("barRDb", Napi::Number::New(env, snapshot.barRDb));
    obj.Set("peakLDb", Napi::Number::New(env, snapshot.peakLDb));
    obj.Set("peakRDb", Napi::Number::New(env, snapshot.peakRDb));
    obj.Set("correlation", Napi::Number::New(env, snapshot.correlation));
    return obj;
}

Napi::Value LUFSMeterReset(const Napi::CallbackInfo& info) {
    lufsMeter.reset();
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

    // Spectrogram
    Napi::Object spectrogramExports = Napi::Object::New(env);
    spectrogramExports.Set("configure", Napi::Function::New(env, SpectrogramConfigure));
    spectrogramExports.Set("process", Napi::Function::New(env, SpectrogramProcess));
    spectrogramExports.Set("reset", Napi::Function::New(env, SpectrogramReset));
    exports.Set("spectrogram", spectrogramExports);

    // Vectorscope
    Napi::Object vecExports = Napi::Object::New(env);
    vecExports.Set("setSampleRate", Napi::Function::New(env, VectorscopeSetSampleRate));
    vecExports.Set("pushSamples", Napi::Function::New(env, VectorscopePushSamples));
    vecExports.Set("pushMultibandSamples", Napi::Function::New(env, VectorscopePushMultibandSamples));
    vecExports.Set("fillPoints", Napi::Function::New(env, VectorscopeFillPoints));
    vecExports.Set("getPoints", Napi::Function::New(env, VectorscopeGetPoints));
    vecExports.Set("getMultibandPoints", Napi::Function::New(env, VectorscopeGetMultibandPoints));
    vecExports.Set("setBufferSize", Napi::Function::New(env, VectorscopeSetBufferSize));
    vecExports.Set("getBufferSize", Napi::Function::New(env, VectorscopeGetBufferSize));
    vecExports.Set("process", Napi::Function::New(env, VectorscopeProcess));
    vecExports.Set("reset", Napi::Function::New(env, VectorscopeReset));
    exports.Set("vectorscope", vecExports);

    // Waveform
    Napi::Object waveformExports = Napi::Object::New(env);
    waveformExports.Set("configure", Napi::Function::New(env, WaveformConfigure));
    waveformExports.Set("processMono", Napi::Function::New(env, WaveformProcessMono));
    waveformExports.Set("processStereo", Napi::Function::New(env, WaveformProcessStereo));
    waveformExports.Set("reset", Napi::Function::New(env, WaveformReset));
    exports.Set("waveform", waveformExports);

    // VU Meter
    Napi::Object vuExports = Napi::Object::New(env);
    vuExports.Set("setSampleRate", Napi::Function::New(env, VUMeterSetSampleRate));
    vuExports.Set("pushSamples", Napi::Function::New(env, VUMeterPushSamples));
    vuExports.Set("getSnapshot", Napi::Function::New(env, VUMeterGetSnapshot));
    vuExports.Set("reset", Napi::Function::New(env, VUMeterReset));
    exports.Set("vumeter", vuExports);

    // LUFS Meter
    Napi::Object lufsExports = Napi::Object::New(env);
    lufsExports.Set("setSampleRate", Napi::Function::New(env, LUFSMeterSetSampleRate));
    lufsExports.Set("pushSamples", Napi::Function::New(env, LUFSMeterPushSamples));
    lufsExports.Set("getSnapshot", Napi::Function::New(env, LUFSMeterGetSnapshot));
    lufsExports.Set("reset", Napi::Function::New(env, LUFSMeterReset));
    exports.Set("lufsmeter", lufsExports);

    RegisterMacOSCapture(env, exports);
    RegisterWindowsCapture(env, exports);
    RegisterLinuxCapture(env, exports);

    return exports;
}

NODE_API_MODULE(visualizer_dsp, Init)
