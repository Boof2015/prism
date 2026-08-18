#pragma once

#include <string>
#include <vector>

namespace Prism::Tui {

struct SpectrumProjectionOptions {
    float sampleRate = 48000.0f;
    float minFrequency = 20.0f;
    float maxFrequency = 20000.0f;
    float minDecibels = -90.0f;
    float maxDecibels = -10.0f;
    float tiltDbPerOctave = 2.0f;
    float tiltReferenceHz = 1000.0f;
};

std::vector<float> projectSpectrum(const std::vector<float>& magnitudes,
                                   size_t fftSize,
                                   size_t columns,
                                   const SpectrumProjectionOptions& options);

std::vector<std::string> buildSpectrumRows(const std::vector<float>& normalized,
                                           size_t rowCount);
std::string buildFrequencyAxis(size_t columns, float maxFrequency);
std::string buildMeterBar(float levelDb, float peakDb, size_t columns);
std::string formatDb(float value, int precision = 1);
std::string formatLufs(float value);
std::string formatMaxTruePeakDb(float value, bool compact = false);

}  // namespace Prism::Tui
