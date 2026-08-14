#pragma once

#include <optional>
#include <string>
#include <vector>

namespace Prism::Tui {

struct SpectrumPeakInfo {
    float dbfs = -100.0f;
    float frequencyHz = 0.0f;
    std::string pitch;
};

std::string formatSpectrumPitch(float frequencyHz);

class SpectrumPeakTracker {
public:
    std::optional<SpectrumPeakInfo> select(const std::vector<float>& magnitudes,
                                           float sampleRate,
                                           size_t fftSize,
                                           float tiltDbPerOctave);
    void reset();

private:
    std::optional<SpectrumPeakInfo> previous_;
};

}  // namespace Prism::Tui
