#include "analysis_pipeline.h"

#include <algorithm>
#include <cmath>

namespace Prism::Tui {
namespace {

int normalizedOscilloscopeDisplaySamples(float sampleRate) {
    constexpr int baseSamples = 2048;
    constexpr float baseRateMin = 44100.0f;
    constexpr float baseRateMax = 48000.0f;
    float samples = static_cast<float>(baseSamples);
    if (sampleRate > 0.0f && sampleRate < baseRateMin) {
        samples *= sampleRate / baseRateMin;
    } else if (sampleRate > baseRateMax) {
        samples *= sampleRate / baseRateMax;
    }
    return std::clamp(
        static_cast<int>(std::lround(samples)),
        64,
        static_cast<int>(Visualizer::OSCILLOSCOPE_BUFFER_SIZE - 1));
}

}  // namespace

AnalysisPipeline::AnalysisPipeline(float sampleRate, size_t fftSize)
    : spectrum_(fftSize), sampleRate_(sampleRate), fftSize_(fftSize) {
    spectrum_.setSampleRate(sampleRate);
    spectrum_.setSmoothing(0.9f);
    vu_.setSampleRate(sampleRate);
    lufs_.setSampleRate(sampleRate);
    oscilloscope_.setSampleRate(sampleRate);
    oscilloscope_.setPitchLock(true);
    oscilloscope_.setDisplaySamples(normalizedOscilloscopeDisplaySamples(sampleRate));
    vectorscope_.setSampleRate(sampleRate);
}

void AnalysisPipeline::process(const Prism::Capture::AudioChunk& chunk) {
    const size_t count = std::min(chunk.left.size(), chunk.right.size());
    if (count == 0) {
        return;
    }
    const float* left = chunk.left.data();
    const float* right = chunk.right.data();
    if (inputGainLinear_ != 1.0f) {
        trimmedLeftScratch_.resize(count);
        trimmedRightScratch_.resize(count);
        for (size_t index = 0; index < count; ++index) {
            trimmedLeftScratch_[index] = chunk.left[index] * inputGainLinear_;
            trimmedRightScratch_[index] = chunk.right[index] * inputGainLinear_;
        }
        left = trimmedLeftScratch_.data();
        right = trimmedRightScratch_.data();
    }
    spectrum_.pushStereoSamples(left, right, count);
    vu_.pushSamples(left, right, count);
    lufs_.pushSamples(left, right, count);
    monoScratch_.resize(count);
    for (size_t index = 0; index < count; ++index) {
        monoScratch_[index] = (left[index] + right[index]) * 0.5f;
    }
    oscilloscope_.pushSamples(monoScratch_.data(), count);
    vectorscope_.pushMultibandSamples(left, right, count);
}

AnalysisFrame AnalysisPipeline::snapshot() {
    AnalysisFrame frame;
    frame.magnitudes = spectrum_.getChannelMaxMagnitudes();
    frame.spectrumPeak = spectrumPeakTracker_.select(
        frame.magnitudes, sampleRate_, fftSize_, spectrumTiltDbPerOctave_);
    frame.vu = vu_.getSnapshot();
    frame.lufs = lufs_.getSnapshot();

    const auto oscilloscopeResult = oscilloscope_.process();
    const size_t oscilloscopeSamples = static_cast<size_t>(
        std::max(0, oscilloscopeResult.samplesToShow));
    frame.oscilloscope.samples.resize(oscilloscopeSamples);
    if (!frame.oscilloscope.samples.empty()) {
        oscilloscope_.getSamplesInterpolated(
            frame.oscilloscope.samples.data(),
            oscilloscopeResult.triggerIndex,
            frame.oscilloscope.samples.size());
        frame.oscilloscope.signalPresent = std::any_of(
            frame.oscilloscope.samples.begin(),
            frame.oscilloscope.samples.end(),
            [](float sample) { return std::isfinite(sample) && std::abs(sample) > 0.001f; });
    }
    const float latestPitch = oscilloscope_.getLatestDetectedPitch();
    if (std::isfinite(latestPitch) && latestPitch > 0.0f) {
        constexpr float previousWeight = 0.6f;
        displayPitch_ = displayPitch_ > 0.0f
            ? displayPitch_ * previousWeight + latestPitch * (1.0f - previousWeight)
            : latestPitch;
    }
    frame.oscilloscope.detectedPitch = displayPitch_;

    frame.vectorscope.multibandPoints.resize(
        kVectorscopeDisplayPoints * Visualizer::MULTIBAND_POINT_STRIDE);
    frame.vectorscope.pointCount = vectorscope_.getMultibandPoints(
        frame.vectorscope.multibandPoints.data(),
        kVectorscopeDisplayPoints);
    frame.vectorscope.multibandPoints.resize(
        frame.vectorscope.pointCount * Visualizer::MULTIBAND_POINT_STRIDE);
    return frame;
}

void AnalysisPipeline::reset() {
    spectrum_.reset();
    vu_.reset();
    lufs_.reset();
    oscilloscope_.reset();
    vectorscope_.reset();
    spectrumPeakTracker_.reset();
    monoScratch_.clear();
    trimmedLeftScratch_.clear();
    trimmedRightScratch_.clear();
    displayPitch_ = 0.0f;
}

void AnalysisPipeline::setInputTrimDb(float db) {
    const float normalized = std::clamp(
        std::isfinite(db) ? db : 0.0f, -12.0f, 12.0f);
    inputGainLinear_ = std::pow(10.0f, normalized / 20.0f);
}

void AnalysisPipeline::setSpectrumTilt(float dbPerOctave) {
    spectrumTiltDbPerOctave_ = std::clamp(
        std::isfinite(dbPerOctave) ? dbPerOctave : 2.0f, -2.0f, 8.0f);
}

void AnalysisPipeline::setOscilloscopePitchLock(bool enabled) {
    oscilloscope_.setPitchLock(enabled);
}

size_t drainCapture(Prism::Capture::SystemAudioCapture& capture,
                    AnalysisPipeline& pipeline,
                    bool& captureOverrun,
                    size_t maxChunks) {
    auto drained = capture.drain(maxChunks);
    captureOverrun = captureOverrun || drained.overwriteCount > 0;
    for (const auto& chunk : drained.chunks) {
        pipeline.process(chunk);
    }
    return drained.chunks.size();
}

}  // namespace Prism::Tui
