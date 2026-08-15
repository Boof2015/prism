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
    : spectrum_(fftSize),
      spectrogramDisplayHistory_(kSpectrogramHistoryRows, kSpectrogramHistoryColumns),
      spectrogramHeatHistory_(kSpectrogramHistoryRows, kSpectrogramHistoryColumns),
      waveformHistory_(Visualizer::WAVEFORM_STEREO_SUMMARY_STRIDE,
                       kWaveformHistoryColumns),
      sampleRate_(sampleRate),
      fftSize_(fftSize) {
    spectrum_.setSampleRate(sampleRate);
    spectrum_.setSmoothing(0.9f);
    vu_.setSampleRate(sampleRate);
    lufs_.setSampleRate(sampleRate);
    oscilloscope_.setSampleRate(sampleRate);
    oscilloscope_.setPitchLock(true);
    oscilloscope_.setDisplaySamples(normalizedOscilloscopeDisplaySamples(sampleRate));
    vectorscope_.setSampleRate(sampleRate);
    setSpectrogramSettings(2.0f, 1.0f, 4.0f, "sharper", "log", "horizontal");
    setWaveformSettings(false, 1);
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

    const auto spectrogramColumns = spectrogram_.process(monoScratch_.data(), count);
    spectrogramDisplayHistory_.append(spectrogramColumns.display);
    spectrogramHeatHistory_.append(spectrogramColumns.heat);

    if (waveformStereo_) {
        const auto& columns = waveform_.processStereo(left, right, count);
        waveformHistory_.append(columns);
    } else {
        const auto& columns = waveform_.processMono(monoScratch_.data(), count);
        const size_t columnCount = columns.size() / Visualizer::WAVEFORM_MONO_SUMMARY_STRIDE;
        waveformMonoScratch_.resize(
            columnCount * Visualizer::WAVEFORM_STEREO_SUMMARY_STRIDE);
        for (size_t column = 0; column < columnCount; ++column) {
            const size_t source = column * Visualizer::WAVEFORM_MONO_SUMMARY_STRIDE;
            const size_t destination = column * Visualizer::WAVEFORM_STEREO_SUMMARY_STRIDE;
            for (size_t value = 0; value < Visualizer::WAVEFORM_MONO_SUMMARY_STRIDE; ++value) {
                waveformMonoScratch_[destination + value] = columns[source + value];
                waveformMonoScratch_[destination + Visualizer::WAVEFORM_MONO_SUMMARY_STRIDE + value] =
                    columns[source + value];
            }
        }
        waveformHistory_.append(waveformMonoScratch_);
    }
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
    frame.spectrogram.display = spectrogramDisplayHistory_.snapshot();
    frame.spectrogram.heat = spectrogramHeatHistory_.snapshot();
    frame.waveform.history = waveformHistory_.snapshot();
    frame.waveform.stereo = waveformStereo_;
    return frame;
}

void AnalysisPipeline::reset() {
    spectrum_.reset();
    vu_.reset();
    lufs_.reset();
    oscilloscope_.reset();
    vectorscope_.reset();
    spectrogram_.reset();
    waveform_.reset();
    spectrogramDisplayHistory_.reset();
    spectrogramHeatHistory_.reset();
    waveformHistory_.reset();
    spectrumPeakTracker_.reset();
    monoScratch_.clear();
    trimmedLeftScratch_.clear();
    trimmedRightScratch_.clear();
    waveformMonoScratch_.clear();
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

void AnalysisPipeline::setSpectrogramSettings(float scrollSpeed,
                                              float contrast,
                                              float tiltDbPerOctave,
                                              const std::string& clarityMode,
                                              const std::string& scaleMode,
                                              const std::string& orientation) {
    Visualizer::SpectrogramConfig config;
    config.fftSize = fftSize_;
    config.sampleRate = sampleRate_;
    config.rowCount = kSpectrogramHistoryRows;
    config.minFrequency = 20.0f;
    config.maxFrequency = 20000.0f;
    config.minDecibels = -90.0f;
    config.maxDecibels = -12.0f;
    config.scrollSpeed = std::clamp(scrollSpeed, 0.5f, 4.0f);
    config.contrast = std::clamp(contrast, 0.5f, 2.0f);
    config.tiltDbPerOctave = std::clamp(tiltDbPerOctave, -2.0f, 8.0f);
    config.clarityMode = clarityMode;
    config.scaleMode = scaleMode;
    config.orientation = orientation;
    spectrogram_.configure(config);
    spectrogramDisplayHistory_.reset();
    spectrogramHeatHistory_.reset();
}

void AnalysisPipeline::setWaveformSettings(bool stereo, int scrollSpeed) {
    waveformStereo_ = stereo;
    waveformScrollSpeed_ = std::clamp(scrollSpeed, 1, 8);
    constexpr float baseColumnsPerSecond = 128.0f;
    const size_t samplesPerColumn = static_cast<size_t>(std::max(
        1.0f,
        std::round(sampleRate_ /
                   (baseColumnsPerSecond * static_cast<float>(waveformScrollSpeed_)))));
    waveform_.configure(sampleRate_, samplesPerColumn);
    waveformHistory_.reset();
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
