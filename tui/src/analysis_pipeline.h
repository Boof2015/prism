#pragma once

#include "lufsmeter.h"
#include "spectrum.h"
#include "system_audio_capture.h"
#include "vumeter.h"

#include <vector>

namespace Prism::Tui {

constexpr size_t kDefaultFftSize = 4096;

struct AnalysisFrame {
    std::vector<float> magnitudes;
    Visualizer::VUMeterSnapshot vu{};
    Visualizer::LUFSMeterSnapshot lufs{};
};

class AnalysisPipeline {
public:
    explicit AnalysisPipeline(float sampleRate, size_t fftSize = kDefaultFftSize);

    void process(const Prism::Capture::AudioChunk& chunk);
    AnalysisFrame snapshot();
    void reset();

private:
    Visualizer::Spectrum spectrum_;
    Visualizer::VUMeterAnalyzer vu_;
    Visualizer::LUFSMeterAnalyzer lufs_;
};

size_t drainCapture(Prism::Capture::SystemAudioCapture& capture,
                    AnalysisPipeline& pipeline,
                    bool& captureOverrun,
                    size_t maxChunks = 64);

}  // namespace Prism::Tui
