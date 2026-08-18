#include "display_model.h"

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <limits>
#include <sstream>

namespace Prism::Tui {
namespace {

float frequencyAt(float position, float minFrequency, float maxFrequency) {
    const float logMin = std::log10(minFrequency);
    const float logMax = std::log10(maxFrequency);
    return std::pow(10.0f, logMin + position * (logMax - logMin));
}

void placeLabel(std::string& axis, size_t position, const std::string& label) {
    if (axis.empty() || label.size() > axis.size()) {
        return;
    }
    const size_t start = std::min(
        axis.size() - label.size(),
        position > label.size() / 2 ? position - label.size() / 2 : size_t{0});
    for (size_t index = 0; index < label.size(); ++index) {
        axis[start + index] = label[index];
    }
}

}  // namespace

std::vector<float> projectSpectrum(const std::vector<float>& magnitudes,
                                   size_t fftSize,
                                   size_t columns,
                                   const SpectrumProjectionOptions& options) {
    if (magnitudes.empty() || fftSize == 0 || columns == 0 || options.sampleRate <= 0.0f) {
        return {};
    }

    const float nyquist = options.sampleRate * 0.5f;
    const float minFrequency = std::max(1.0f, std::min(options.minFrequency, nyquist));
    const float maxFrequency = std::max(
        minFrequency,
        std::min(options.maxFrequency, nyquist));
    const float binWidth = options.sampleRate / static_cast<float>(fftSize);
    const float dbSpan = std::max(1.0f, options.maxDecibels - options.minDecibels);

    std::vector<float> projected(columns, 0.0f);
    for (size_t column = 0; column < columns; ++column) {
        const float leftPosition = static_cast<float>(column) / static_cast<float>(columns);
        const float rightPosition = static_cast<float>(column + 1) / static_cast<float>(columns);
        const float leftFrequency = frequencyAt(leftPosition, minFrequency, maxFrequency);
        const float rightFrequency = frequencyAt(rightPosition, minFrequency, maxFrequency);
        const size_t firstBin = std::min(
            magnitudes.size() - 1,
            static_cast<size_t>(std::floor(leftFrequency / binWidth)));
        const size_t lastBin = std::min(
            magnitudes.size() - 1,
            std::max(firstBin, static_cast<size_t>(std::ceil(rightFrequency / binWidth))));

        float peakDb = -120.0f;
        for (size_t bin = firstBin; bin <= lastBin; ++bin) {
            const float value = std::isfinite(magnitudes[bin]) ? magnitudes[bin] : -120.0f;
            peakDb = std::max(peakDb, value);
        }

        const float centerFrequency = std::sqrt(leftFrequency * rightFrequency);
        const float tilt = options.tiltDbPerOctave *
            std::log2(std::max(1.0f, centerFrequency) / std::max(1.0f, options.tiltReferenceHz));
        projected[column] = std::clamp(
            (peakDb + tilt - options.minDecibels) / dbSpan,
            0.0f,
            1.0f);
    }
    return projected;
}

std::vector<std::string> buildSpectrumRows(const std::vector<float>& normalized,
                                           size_t rowCount) {
    if (normalized.empty() || rowCount == 0) {
        return {};
    }

    static const char* partialBlocks[] = {" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇"};
    std::vector<std::string> rows(rowCount);
    const int totalUnits = static_cast<int>(rowCount * 8);
    for (size_t row = 0; row < rowCount; ++row) {
        std::string line;
        const int rowBottom = static_cast<int>((rowCount - row - 1) * 8);
        for (float value : normalized) {
            const int filled = static_cast<int>(std::round(std::clamp(value, 0.0f, 1.0f) * totalUnits));
            const int units = std::clamp(filled - rowBottom, 0, 8);
            line += units == 8 ? "█" : partialBlocks[units];
        }
        rows[row] = std::move(line);
    }
    return rows;
}

std::string buildFrequencyAxis(size_t columns, float maxFrequency) {
    std::string axis(columns, ' ');
    if (columns < 8) {
        return axis;
    }
    const float resolvedMax = std::max(20.0f, maxFrequency);
    const auto positionFor = [&](float frequency) {
        const float position = std::log10(frequency / 20.0f) / std::log10(resolvedMax / 20.0f);
        return static_cast<size_t>(std::round(std::clamp(position, 0.0f, 1.0f) * (columns - 1)));
    };
    placeLabel(axis, 0, "20");
    if (resolvedMax >= 100.0f) placeLabel(axis, positionFor(100.0f), "100");
    if (resolvedMax >= 1000.0f) placeLabel(axis, positionFor(1000.0f), "1k");
    if (resolvedMax >= 10000.0f) placeLabel(axis, positionFor(10000.0f), "10k");
    placeLabel(axis, columns - 1, resolvedMax >= 19950.0f ? "20k" : "Nyq");
    return axis;
}

std::string buildMeterBar(float levelDb, float peakDb, size_t columns) {
    if (columns == 0) {
        return {};
    }
    const auto toPosition = [&](float db) {
        const float normalized = std::clamp((db + 60.0f) / 60.0f, 0.0f, 1.0f);
        return static_cast<size_t>(std::round(normalized * static_cast<float>(columns)));
    };
    const size_t level = std::min(columns, toPosition(levelDb));
    const size_t peak = std::min(columns - 1, toPosition(peakDb));
    std::string result;
    for (size_t column = 0; column < columns; ++column) {
        if (column == peak && peak > level) {
            result += "│";
        } else if (column < level) {
            result += "█";
        } else {
            result += "·";
        }
    }
    return result;
}

std::string formatDb(float value, int precision) {
    if (!std::isfinite(value) || value <= -60.0f) {
        return "-inf";
    }
    std::ostringstream output;
    output << std::fixed << std::setprecision(precision) << value;
    return output.str();
}

std::string formatLufs(float value) {
    return formatDb(value, 1);
}

std::string formatMaxTruePeakDb(float value, bool compact) {
    std::string formatted = formatDb(value, 1);
    if (std::isfinite(value) && value > -60.0f && value >= 0.0f) {
        formatted.insert(formatted.begin(), '+');
    }
    return compact
        ? formatted + "dBTP"
        : "MAX TP " + formatted + " dBTP";
}

}  // namespace Prism::Tui
