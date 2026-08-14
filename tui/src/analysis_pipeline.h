#pragma once

#include "lufsmeter.h"
#include "oscilloscope.h"
#include "spectrum.h"
#include "spectrum_peak_model.h"
#include "system_audio_capture.h"
#include "vectorscope.h"
#include "vumeter.h"

#include <vector>
#include <optional>

namespace Prism::Tui {

constexpr size_t kDefaultFftSize = 4096;
constexpr size_t kVectorscopeDisplayPoints = 4096;

struct OscilloscopeFrame {
    std::vector<float> samples;
    float detectedPitch = 0.0f;
    bool signalPresent = false;
};

struct VectorscopeFrame {
    std::vector<float> multibandPoints;
    size_t pointCount = 0;
};

struct AnalysisFrame {
    std::vector<float> magnitudes;
    std::optional<SpectrumPeakInfo> spectrumPeak;
    Visualizer::VUMeterSnapshot vu{};
    Visualizer::LUFSMeterSnapshot lufs{};
    OscilloscopeFrame oscilloscope;
    VectorscopeFrame vectorscope;
};

class AnalysisPipeline {
public:
    explicit AnalysisPipeline(float sampleRate, size_t fftSize = kDefaultFftSize);

    void process(const Prism::Capture::AudioChunk& chunk);
    AnalysisFrame snapshot();
    void reset();
    void setInputTrimDb(float db);
    void setSpectrumTilt(float dbPerOctave);
    void setOscilloscopePitchLock(bool enabled);

private:
    Visualizer::Spectrum spectrum_;
    Visualizer::VUMeterAnalyzer vu_;
    Visualizer::LUFSMeterAnalyzer lufs_;
    Visualizer::Oscilloscope oscilloscope_;
    Visualizer::Vectorscope vectorscope_;
    SpectrumPeakTracker spectrumPeakTracker_;
    std::vector<float> monoScratch_;
    std::vector<float> trimmedLeftScratch_;
    std::vector<float> trimmedRightScratch_;
    float sampleRate_ = 48000.0f;
    size_t fftSize_ = kDefaultFftSize;
    float inputGainLinear_ = 1.0f;
    float spectrumTiltDbPerOctave_ = 2.0f;
    float displayPitch_ = 0.0f;
};

size_t drainCapture(Prism::Capture::SystemAudioCapture& capture,
                    AnalysisPipeline& pipeline,
                    bool& captureOverrun,
                    size_t maxChunks = 64);

}  // namespace Prism::Tui
