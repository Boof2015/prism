#pragma once

#include "spectrum.h"
#include <cstdint>
#include <string>
#include <vector>

namespace Visualizer {

struct WaterfallConfig {
    float sampleRate = 48000;
    size_t fftSize = 2048;
    float historySeconds = 5;
    float smoothing = 0.9f;
    float tiltDbPerOctave = 2;
    float minFrequency = 10;
    float maxFrequency = 24000;
    std::string scaleMode = "log";
};

// Newest ridge first. Levels retain dB units; projection and painting are separate.
struct WaterfallFrame {
    std::vector<float> levels;
    std::vector<float> ages;
    std::vector<float> frequencies;
    size_t columns = 0;
    double audioSeconds = 0;
};

class WaterfallAnalyzer {
public:
    WaterfallAnalyzer();
    void configure(const WaterfallConfig& config);
    void processStereo(const float* left, const float* right, size_t length);
    WaterfallFrame getFrame(size_t ridges, size_t columns) const;
    void reset();
    size_t storedSlices() const { return count_; }
    size_t capacitySlices() const { return capacity_; }

private:
    WaterfallConfig config_;
    Spectrum spectrum_{2048};
    std::vector<float> history_;
    std::vector<double> times_;
    std::vector<float> pendingLeft_, pendingRight_;
    size_t capacity_ = 0, count_ = 0, write_ = 0;
    uint64_t samples_ = 0, tick_ = 1;
    void resizeHistory(size_t capacity);
    void append();
};

} // namespace Visualizer
