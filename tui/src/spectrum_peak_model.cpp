#include "spectrum_peak_model.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <iomanip>
#include <limits>
#include <sstream>

namespace Prism::Tui {
namespace {

constexpr float kMinFrequency = 20.0f;
constexpr float kMaxFrequency = 20000.0f;
constexpr float kTiltReferenceHz = 1000.0f;
constexpr float kMaximumStickyDistanceOctaves = 0.5f;
constexpr float kSwitchThresholdDb = 4.0f;
constexpr float kLowFrequencyBiasDbPerOctave = 0.75f;
constexpr float kUpwardSwitchThresholdDb = 2.0f;
constexpr float kSilenceThresholdDbfs = -90.0f;

float finiteMagnitude(const std::vector<float>& magnitudes, size_t index) {
    return std::isfinite(magnitudes[index]) ? magnitudes[index] : -120.0f;
}

float frequencyForBin(float bin, float sampleRate, size_t fftSize) {
    return bin * sampleRate / static_cast<float>(fftSize);
}

float displayDb(float dbfs, float frequencyHz, float tiltDbPerOctave) {
    return dbfs + tiltDbPerOctave * std::log2(
        std::max(1.0f, frequencyHz) / kTiltReferenceHz);
}

float score(float dbfs, float frequencyHz, float tiltDbPerOctave) {
    const float tilted = displayDb(dbfs, frequencyHz, tiltDbPerOctave);
    const float octaveOffset = std::max(
        0.0f, std::log2(std::max(1.0f, frequencyHz) / kMinFrequency));
    return tilted - octaveOffset * kLowFrequencyBiasDbPerOctave;
}

SpectrumPeakInfo peakAt(const std::vector<float>& magnitudes,
                        size_t bin,
                        float sampleRate,
                        size_t fftSize) {
    float offset = 0.0f;
    float dbfs = finiteMagnitude(magnitudes, bin);
    if (bin > 0 && bin + 1 < magnitudes.size()) {
        const float previous = finiteMagnitude(magnitudes, bin - 1);
        const float current = dbfs;
        const float next = finiteMagnitude(magnitudes, bin + 1);
        const float denominator = previous - 2.0f * current + next;
        if (std::abs(denominator) > 1.0e-9f) {
            offset = std::clamp(
                0.5f * (previous - next) / denominator, -0.5f, 0.5f);
            dbfs = current - 0.25f * (previous - next) * offset;
        }
    }
    const float frequency = frequencyForBin(
        static_cast<float>(bin) + offset, sampleRate, fftSize);
    return {dbfs, frequency, formatSpectrumPitch(frequency)};
}

}  // namespace

std::string formatSpectrumPitch(float frequencyHz) {
    if (!std::isfinite(frequencyHz) || frequencyHz <= 0.0f) {
        return "--";
    }
    static constexpr std::array<const char*, 12> noteNames = {
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    };
    const float midi = 69.0f + 12.0f * std::log2(frequencyHz / 440.0f);
    const int nearest = static_cast<int>(std::lround(midi));
    const int cents = static_cast<int>(std::lround((midi - nearest) * 100.0f));
    const int noteIndex = ((nearest % 12) + 12) % 12;
    const int octave = static_cast<int>(std::floor(static_cast<float>(nearest) / 12.0f)) - 1;
    std::ostringstream output;
    output << noteNames[static_cast<size_t>(noteIndex)] << octave << ' '
           << (cents > 0 ? "+" : "") << cents << 'c';
    return output.str();
}

std::optional<SpectrumPeakInfo> SpectrumPeakTracker::select(
    const std::vector<float>& magnitudes,
    float sampleRate,
    size_t fftSize,
    float tiltDbPerOctave) {
    if (magnitudes.size() < 3 || sampleRate <= 0.0f || fftSize == 0) {
        previous_.reset();
        return std::nullopt;
    }

    const float binWidth = sampleRate / static_cast<float>(fftSize);
    const size_t firstBin = std::clamp<size_t>(
        static_cast<size_t>(std::ceil(kMinFrequency / binWidth)),
        1,
        magnitudes.size() - 2);
    const size_t lastBin = std::clamp<size_t>(
        static_cast<size_t>(std::floor(
            std::min(kMaxFrequency, sampleRate * 0.5f) / binWidth)),
        firstBin,
        magnitudes.size() - 2);

    std::vector<size_t> candidates;
    for (size_t bin = firstBin; bin <= lastBin; ++bin) {
        const float previous = finiteMagnitude(magnitudes, bin - 1);
        const float current = finiteMagnitude(magnitudes, bin);
        const float next = finiteMagnitude(magnitudes, bin + 1);
        if (current >= previous && current >= next &&
            (current > previous || current > next)) {
            candidates.push_back(bin);
        }
    }
    if (candidates.empty()) {
        const auto best = std::max_element(
            magnitudes.begin() + static_cast<std::ptrdiff_t>(firstBin),
            magnitudes.begin() + static_cast<std::ptrdiff_t>(lastBin + 1));
        candidates.push_back(static_cast<size_t>(
            std::distance(magnitudes.begin(), best)));
    }

    const auto candidateScore = [&](size_t bin) {
        const float frequency = frequencyForBin(
            static_cast<float>(bin), sampleRate, fftSize);
        return score(finiteMagnitude(magnitudes, bin), frequency, tiltDbPerOctave);
    };
    const auto better = [&](size_t left, size_t right) {
        const float leftScore = candidateScore(left);
        const float rightScore = candidateScore(right);
        if (leftScore != rightScore) return leftScore > rightScore;
        const float leftDb = finiteMagnitude(magnitudes, left);
        const float rightDb = finiteMagnitude(magnitudes, right);
        return leftDb != rightDb ? leftDb > rightDb : left < right;
    };

    size_t strongest = candidates.front();
    for (size_t candidate : candidates) {
        if (better(candidate, strongest)) strongest = candidate;
    }
    size_t selected = strongest;
    if (previous_ && previous_->frequencyHz > 0.0f) {
        std::optional<size_t> sticky;
        for (size_t candidate : candidates) {
            const float frequency = frequencyForBin(
                static_cast<float>(candidate), sampleRate, fftSize);
            const float distance = std::abs(std::log2(
                frequency / previous_->frequencyHz));
            if (distance <= kMaximumStickyDistanceOctaves &&
                (!sticky || better(candidate, *sticky))) {
                sticky = candidate;
            }
        }
        if (sticky) {
            const float upwardPenalty = strongest > *sticky
                ? kUpwardSwitchThresholdDb
                : 0.0f;
            if (candidateScore(strongest) <
                candidateScore(*sticky) + kSwitchThresholdDb + upwardPenalty) {
                selected = *sticky;
            }
        }
    }

    SpectrumPeakInfo result = peakAt(magnitudes, selected, sampleRate, fftSize);
    if (!std::isfinite(result.dbfs) || result.dbfs <= kSilenceThresholdDbfs) {
        previous_.reset();
        return std::nullopt;
    }
    previous_ = result;
    return result;
}

void SpectrumPeakTracker::reset() {
    previous_.reset();
}

}  // namespace Prism::Tui
