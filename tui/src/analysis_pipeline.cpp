#include "analysis_pipeline.h"

#include <algorithm>

namespace Prism::Tui {

AnalysisPipeline::AnalysisPipeline(float sampleRate, size_t fftSize)
    : spectrum_(fftSize) {
    spectrum_.setSampleRate(sampleRate);
    spectrum_.setSmoothing(0.9f);
    vu_.setSampleRate(sampleRate);
    lufs_.setSampleRate(sampleRate);
}

void AnalysisPipeline::process(const Prism::Capture::AudioChunk& chunk) {
    const size_t count = std::min(chunk.left.size(), chunk.right.size());
    if (count == 0) {
        return;
    }
    spectrum_.pushStereoSamples(chunk.left.data(), chunk.right.data(), count);
    vu_.pushSamples(chunk.left.data(), chunk.right.data(), count);
    lufs_.pushSamples(chunk.left.data(), chunk.right.data(), count);
}

AnalysisFrame AnalysisPipeline::snapshot() {
    return {
        spectrum_.getChannelMaxMagnitudes(),
        vu_.getSnapshot(),
        lufs_.getSnapshot(),
    };
}

void AnalysisPipeline::reset() {
    spectrum_.reset();
    vu_.reset();
    lufs_.reset();
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
