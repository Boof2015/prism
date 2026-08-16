#define _USE_MATH_DEFINES
#include "spectrogram.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

namespace Visualizer {

namespace {
constexpr size_t FFT_PAD_FACTOR = 4;
constexpr float HANN_EQUIVALENT_NOISE_BANDWIDTH_BINS = 1.5f;
constexpr float REASSIGNED_POWER_NORMALIZATION = static_cast<float>(FFT_PAD_FACTOR)
    * HANN_EQUIVALENT_NOISE_BANDWIDTH_BINS;
constexpr float SPECTROGRAM_HEAT_GAMMA = 1.45f;
constexpr float TILT_REFERENCE_HZ = 1000.0f;
constexpr float HEAT_MIN_DB = -100.0f;
constexpr float HEAT_MAX_DB = -20.0f;
constexpr float SLANEY_F_SP = 200.0f / 3.0f;
constexpr float SLANEY_MIN_LOG_HZ = 1000.0f;
constexpr float SLANEY_MIN_LOG_MEL = SLANEY_MIN_LOG_HZ / SLANEY_F_SP;
constexpr float SLANEY_LOG_STEP = 1.8562979903656263f / 27.0f; // log(6.4) / 27

bool isPowerOfTwo(size_t value) {
    return value >= 2 && (value & (value - 1)) == 0;
}

float clamp01(float value) {
    return std::max(0.0f, std::min(1.0f, value));
}

float normalizeHeatDb(float db) {
    if (!std::isfinite(db)) {
        return 0.0f;
    }
    return clamp01((db - HEAT_MIN_DB) / (HEAT_MAX_DB - HEAT_MIN_DB));
}

float hzToMelSlaney(float frequencyHz) {
    if (frequencyHz < SLANEY_MIN_LOG_HZ) {
        return frequencyHz / SLANEY_F_SP;
    }
    return SLANEY_MIN_LOG_MEL + (std::log(frequencyHz / SLANEY_MIN_LOG_HZ) / SLANEY_LOG_STEP);
}

float melToHzSlaney(float mel) {
    if (mel < SLANEY_MIN_LOG_MEL) {
        return mel * SLANEY_F_SP;
    }
    return SLANEY_MIN_LOG_HZ * std::exp(SLANEY_LOG_STEP * (mel - SLANEY_MIN_LOG_MEL));
}

float wrapPhase(float value) {
    const float twoPi = static_cast<float>(2.0 * M_PI);
    float wrapped = std::remainder(value, twoPi);
    if (!std::isfinite(wrapped)) {
        return 0.0f;
    }
    return wrapped;
}
} // namespace

SpectrogramAnalyzer::SpectrogramAnalyzer()
    : fftSize_(0)
    , paddedSize_(0)
    , frameFill_(0)
    , haveLastPhase_(false)
    , magnitudeScale_(1.0f) {
    configureFft(config_.fftSize);
    rebuildFrequencyMapping();
}

void SpectrogramAnalyzer::configure(const SpectrogramConfig& config) {
    SpectrogramConfig next = config;

    if (!isPowerOfTwo(next.fftSize)) {
        next.fftSize = 4096;
    }
    next.fftSize = std::clamp(next.fftSize, static_cast<size_t>(128), static_cast<size_t>(16384));
    next.sampleRate = std::isfinite(next.sampleRate) && next.sampleRate > 0.0f ? next.sampleRate : 48000.0f;
    next.rowCount = std::clamp(next.rowCount, static_cast<size_t>(1), static_cast<size_t>(8192));
    next.minFrequency = std::isfinite(next.minFrequency) && next.minFrequency > 0.0f ? next.minFrequency : 20.0f;
    next.maxFrequency = std::isfinite(next.maxFrequency) && next.maxFrequency > 0.0f ? next.maxFrequency : 20000.0f;
    next.minDecibels = std::isfinite(next.minDecibels) ? next.minDecibels : -90.0f;
    next.maxDecibels = std::isfinite(next.maxDecibels) ? next.maxDecibels : -12.0f;
    if (next.maxDecibels <= next.minDecibels) {
        next.maxDecibels = next.minDecibels + 1.0f;
    }
    next.scrollSpeed = std::isfinite(next.scrollSpeed) ? next.scrollSpeed : 2.0f;
    next.contrast = std::isfinite(next.contrast) ? next.contrast : 1.0f;
    next.contrast = std::clamp(next.contrast, 0.1f, 8.0f);
    next.tiltDbPerOctave = std::isfinite(next.tiltDbPerOctave) ? next.tiltDbPerOctave : 4.0f;
    next.tiltDbPerOctave = std::clamp(next.tiltDbPerOctave, -12.0f, 12.0f);
    if (next.scaleMode != "linear" && next.scaleMode != "mel" && next.scaleMode != "log") {
        next.scaleMode = "log";
    }
    if (next.orientation != "vertical") {
        next.orientation = "horizontal";
    }
    if (next.clarityMode != "classic"
        && next.clarityMode != "focused"
        && next.clarityMode != "sharp"
        && next.clarityMode != "sharper") {
        next.clarityMode = "sharper";
    }

    const bool fftChanged = next.fftSize != fftSize_;
    const bool sampleRateChanged = next.sampleRate != config_.sampleRate;
    const bool mappingChanged = fftChanged
        || sampleRateChanged
        || next.rowCount != config_.rowCount
        || next.minFrequency != config_.minFrequency
        || next.maxFrequency != config_.maxFrequency
        || next.scaleMode != config_.scaleMode
        || next.orientation != config_.orientation;

    config_ = next;

    if (fftChanged) {
        configureFft(config_.fftSize);
    } else if (sampleRateChanged) {
        haveLastPhase_ = false;
    }

    if (mappingChanged) {
        rebuildFrequencyMapping();
    }
}

void SpectrogramAnalyzer::configureFft(size_t fftSize) {
    fftSize_ = fftSize;
    paddedSize_ = fftSize_ * FFT_PAD_FACTOR;
    fft_ = std::make_unique<DSP::FFT>(paddedSize_);
    frameBuffer_.assign(fftSize_, 0.0f);
    rightFrameBuffer_.assign(fftSize_, 0.0f);
    window_.assign(fftSize_, 1.0f);
    windowedInput_.assign(paddedSize_, 0.0f);
    rightWindowedInput_.assign(paddedSize_, 0.0f);
    fftOutput_.assign(paddedSize_, std::complex<float>(0.0f, 0.0f));
    rightFftOutput_.assign(paddedSize_, std::complex<float>(0.0f, 0.0f));
    magnitudesDb_.assign(paddedSize_ / 2, -200.0f);
    magnitudesLinear_.assign(paddedSize_ / 2, 0.0f);
    phases_.assign(paddedSize_ / 2, 0.0f);
    lastPhases_.assign(paddedSize_ / 2, 0.0f);
    rightPhases_.assign(paddedSize_ / 2, 0.0f);
    rightLastPhases_.assign(paddedSize_ / 2, 0.0f);
    dominantRight_.assign(paddedSize_ / 2, 0);
    frameFill_ = 0;
    haveLastPhase_ = false;

    if (fftSize_ <= 1) {
        return;
    }

    for (size_t index = 0; index < fftSize_; index += 1) {
        window_[index] = 0.5f * (1.0f - std::cos((2.0f * static_cast<float>(M_PI) * index) / (fftSize_ - 1)));
    }

    float windowSum = 0.0f;
    for (const float coefficient : window_) {
        windowSum += coefficient;
    }
    magnitudeScale_ = windowSum > std::numeric_limits<float>::epsilon()
        ? 2.0f / windowSum
        : 1.0f;
}

void SpectrogramAnalyzer::reset() {
    std::fill(frameBuffer_.begin(), frameBuffer_.end(), 0.0f);
    std::fill(rightFrameBuffer_.begin(), rightFrameBuffer_.end(), 0.0f);
    std::fill(lastPhases_.begin(), lastPhases_.end(), 0.0f);
    std::fill(rightLastPhases_.begin(), rightLastPhases_.end(), 0.0f);
    frameFill_ = 0;
    haveLastPhase_ = false;
}

size_t SpectrogramAnalyzer::resolveHopSize() const {
    const float baseHopDivisor = 8.0f;
    const float speed = std::isfinite(config_.scrollSpeed) ? config_.scrollSpeed : 2.0f;
    const int divisor = std::clamp(static_cast<int>(std::lround(baseHopDivisor * speed)), 2, 64);
    return std::max(static_cast<size_t>(1), fftSize_ / static_cast<size_t>(divisor));
}

void SpectrogramAnalyzer::rebuildFrequencyMapping() {
    const size_t rowCount = std::max(static_cast<size_t>(1), config_.rowCount);
    const float sampleRate = std::max(1.0f, config_.sampleRate);
    const float nyquist = sampleRate * 0.5f;
    const float minFrequency = std::max(1.0f, std::min(config_.minFrequency, nyquist));
    const float maxFrequency = std::max(minFrequency, std::min(config_.maxFrequency, nyquist));
    config_.minFrequency = minFrequency;
    config_.maxFrequency = maxFrequency;

    rowCenterBins_.assign(rowCount, 0.0f);
    rowBandStartBins_.assign(rowCount, 0.0f);
    rowBandEndBins_.assign(rowCount, 0.0f);
    rowCenterFrequencies_.assign(rowCount, minFrequency);
    standardRaw_.assign(rowCount, 0.0f);
    standardHeat_.assign(rowCount, 0.0f);
    reassignedPower_.assign(rowCount, 0.0f);
    focusedPower_.assign(rowCount, 0.0f);
    sourceRaw_.assign(rowCount, 0.0f);
    sourceHeat_.assign(rowCount, 0.0f);
    shapedDisplay_.assign(rowCount, 0.0f);
    shapedHeat_.assign(rowCount, 0.0f);
    strokedDisplay_.assign(rowCount, 0.0f);
    strokedHeat_.assign(rowCount, 0.0f);

    const float rowSpan = static_cast<float>(std::max(static_cast<size_t>(1), rowCount - 1));
    const float numBins = static_cast<float>(std::max(static_cast<size_t>(1), paddedSize_ / 2));
    const float binWidth = nyquist / numBins;

    for (size_t row = 0; row < rowCount; row += 1) {
        const float rowF = static_cast<float>(row);
        const float normalizedPosition = config_.orientation == "vertical"
            ? rowF / rowSpan
            : 1.0f - (rowF / rowSpan);

        float upperEdgeNormalized;
        float lowerEdgeNormalized;
        if (config_.orientation == "vertical") {
            upperEdgeNormalized = row == rowCount - 1 ? 1.0f : (rowF + 0.5f) / rowSpan;
            lowerEdgeNormalized = row == 0 ? 0.0f : (rowF - 0.5f) / rowSpan;
        } else {
            upperEdgeNormalized = row == 0 ? 1.0f : 1.0f - ((rowF - 0.5f) / rowSpan);
            lowerEdgeNormalized = row == rowCount - 1 ? 0.0f : 1.0f - ((rowF + 0.5f) / rowSpan);
        }

        const float centerFrequency = frequencyFromScale(normalizedPosition);
        const float lowerFrequency = frequencyFromScale(clamp01(lowerEdgeNormalized));
        const float upperFrequency = frequencyFromScale(clamp01(upperEdgeNormalized));

        rowCenterFrequencies_[row] = centerFrequency;
        rowCenterBins_[row] = std::clamp(centerFrequency / binWidth, 0.0f, numBins - 1.0f);
        rowBandStartBins_[row] = std::clamp(std::min(lowerFrequency, upperFrequency) / binWidth, 0.0f, numBins);
        rowBandEndBins_[row] = std::clamp(std::max(lowerFrequency, upperFrequency) / binWidth, 0.0f, numBins);
    }
}

float SpectrogramAnalyzer::frequencyFromScale(float normalizedPosition) const {
    const float t = clamp01(normalizedPosition);
    const float minFrequency = std::max(1.0f, config_.minFrequency);
    const float maxFrequency = std::max(minFrequency, config_.maxFrequency);

    if (maxFrequency <= minFrequency) {
        return minFrequency;
    }

    if (config_.scaleMode == "linear") {
        return minFrequency + (t * (maxFrequency - minFrequency));
    }

    if (config_.scaleMode == "mel") {
        const float melMin = hzToMelSlaney(minFrequency);
        const float melMax = hzToMelSlaney(maxFrequency);
        return melToHzSlaney(melMin + (t * (melMax - melMin)));
    }

    const float logMin = std::log10(minFrequency);
    const float logMax = std::log10(maxFrequency);
    return std::pow(10.0f, logMin + (t * (logMax - logMin)));
}

float SpectrogramAnalyzer::frequencyToRow(float frequency) const {
    if (config_.rowCount <= 1) {
        return 0.0f;
    }

    const float minFrequency = std::max(1.0f, config_.minFrequency);
    const float maxFrequency = std::max(minFrequency, config_.maxFrequency);
    if (maxFrequency <= minFrequency) {
        return config_.orientation == "vertical" ? 0.0f : static_cast<float>(config_.rowCount - 1);
    }
    const float clampedFrequency = std::clamp(frequency, minFrequency, maxFrequency);
    float normalized = 0.0f;

    if (config_.scaleMode == "linear") {
        normalized = (clampedFrequency - minFrequency) / std::max(maxFrequency - minFrequency, std::numeric_limits<float>::epsilon());
    } else if (config_.scaleMode == "mel") {
        const float melMin = hzToMelSlaney(minFrequency);
        const float melMax = hzToMelSlaney(maxFrequency);
        normalized = (hzToMelSlaney(clampedFrequency) - melMin) / std::max(melMax - melMin, std::numeric_limits<float>::epsilon());
    } else {
        const float logMin = std::log10(minFrequency);
        const float logMax = std::log10(maxFrequency);
        normalized = (std::log10(clampedFrequency) - logMin) / std::max(logMax - logMin, std::numeric_limits<float>::epsilon());
    }

    const float rowSpan = static_cast<float>(std::max(static_cast<size_t>(1), config_.rowCount - 1));
    return config_.orientation == "vertical"
        ? clamp01(normalized) * rowSpan
        : (1.0f - clamp01(normalized)) * rowSpan;
}

float SpectrogramAnalyzer::applyDisplayTilt(float db, float frequency) const {
    const float safeFrequency = std::max(1.0f, frequency);
    const float tiltAmount = config_.tiltDbPerOctave * std::log2(safeFrequency / TILT_REFERENCE_HZ);
    return db + tiltAmount;
}

float SpectrogramAnalyzer::displayDbToIntensity(float db) const {
    const float range = std::max(1.0e-6f, config_.maxDecibels - config_.minDecibels);
    return clamp01((db - config_.minDecibels) / range);
}

float SpectrogramAnalyzer::sampleDbAtBin(float bin) const {
    if (magnitudesDb_.empty()) {
        return -200.0f;
    }

    const float clampedBin = std::clamp(bin, 0.0f, static_cast<float>(magnitudesDb_.size() - 1));
    const size_t i1 = static_cast<size_t>(std::floor(clampedBin));
    const float frac = clampedBin - static_cast<float>(i1);
    const size_t i0 = i1 > 0 ? i1 - 1 : i1;
    const size_t i2 = std::min(magnitudesDb_.size() - 1, i1 + 1);
    const size_t i3 = std::min(magnitudesDb_.size() - 1, i1 + 2);
    const float m0 = magnitudesDb_[i0];
    const float m1 = magnitudesDb_[i1];
    const float m2 = magnitudesDb_[i2];
    const float m3 = magnitudesDb_[i3];
    const float f2 = frac * frac;
    const float f3 = f2 * frac;

    return 0.5f * (
        (2.0f * m1)
        + ((-m0 + m2) * frac)
        + ((2.0f * m0 - 5.0f * m1 + 4.0f * m2 - m3) * f2)
        + ((-m0 + 3.0f * m1 - 3.0f * m2 + m3) * f3)
    );
}

float SpectrogramAnalyzer::samplePeakDbInBand(float startBin, float endBin, float& peakBin) const {
    if (magnitudesDb_.empty()) {
        peakBin = 0.0f;
        return -200.0f;
    }

    const float lastBin = static_cast<float>(magnitudesDb_.size() - 1);
    const float lo = std::clamp(std::min(startBin, endBin), 0.0f, lastBin);
    const float hi = std::clamp(std::max(startBin, endBin), 0.0f, lastBin);
    peakBin = 0.5f * (lo + hi);
    float peakDb = sampleDbAtBin(peakBin);

    const auto consider = [&](float candidateBin) {
        const float candidateDb = sampleDbAtBin(candidateBin);
        if (candidateDb > peakDb) {
            peakDb = candidateDb;
            peakBin = candidateBin;
        }
    };

    consider(lo);
    consider(hi);
    const size_t firstWholeBin = static_cast<size_t>(std::ceil(lo));
    const size_t lastWholeBin = static_cast<size_t>(std::floor(hi));
    for (size_t bin = firstWholeBin; bin <= lastWholeBin && bin < magnitudesDb_.size(); bin += 1) {
        consider(static_cast<float>(bin));
    }

    return peakDb;
}

void SpectrogramAnalyzer::computeStandardSpectrum() {
    const size_t rowCount = config_.rowCount;
    const float binWidth = std::max(1.0f, config_.sampleRate) / static_cast<float>(paddedSize_);
    for (size_t row = 0; row < rowCount; row += 1) {
        float peakBin = rowCenterBins_[row];
        const float rawDb = samplePeakDbInBand(rowBandStartBins_[row], rowBandEndBins_[row], peakBin);
        const float displayDb = applyDisplayTilt(rawDb, peakBin * binWidth);
        standardRaw_[row] = displayDbToIntensity(displayDb);
        standardHeat_[row] = normalizeHeatDb(displayDb);
    }
}

void SpectrogramAnalyzer::computeReassignedSpectrum() {
    std::fill(reassignedPower_.begin(), reassignedPower_.end(), 0.0f);
    if (!haveLastPhase_ || magnitudesLinear_.size() < 3 || config_.rowCount == 0) {
        return;
    }

    const float sampleRate = std::max(1.0f, config_.sampleRate);
    const float binWidth = sampleRate / static_cast<float>(paddedSize_);
    const float hopDt = static_cast<float>(resolveHopSize()) / sampleRate;
    // Reassign every bin that can contribute to either output. Limiting this to
    // local maxima throws away low-level partials and ambience — exactly the
    // detail a sharpened spectrogram is meant to retain.
    const float visibleFloorDb = std::min(config_.minDecibels, HEAT_MIN_DB);
    const float ampThreshold = std::pow(10.0f, visibleFloorDb / 20.0f);
    const float twoPi = static_cast<float>(2.0 * M_PI);

    for (size_t bin = 1; bin + 1 < magnitudesLinear_.size(); bin += 1) {
        const float mag = magnitudesLinear_[bin];
        if (mag <= ampThreshold) {
            continue;
        }

        const float nominalFrequency = static_cast<float>(bin) * binWidth;
        if (nominalFrequency < config_.minFrequency || nominalFrequency > config_.maxFrequency) {
            continue;
        }

        const float expected = twoPi * nominalFrequency * hopDt;
        const bool useRightPhase = dominantRight_[bin] != 0;
        const float currentPhase = useRightPhase ? rightPhases_[bin] : phases_[bin];
        const float previousPhase = useRightPhase ? rightLastPhases_[bin] : lastPhases_[bin];
        const float correctionHz = wrapPhase(currentPhase - previousPhase - expected) / (twoPi * hopDt);
        const float reassignedFrequency = nominalFrequency + correctionHz;

        if (reassignedFrequency < config_.minFrequency || reassignedFrequency > config_.maxFrequency) {
            continue;
        }
        const float rowF = frequencyToRow(reassignedFrequency);
        const size_t row0 = static_cast<size_t>(std::floor(std::clamp(rowF, 0.0f, static_cast<float>(config_.rowCount - 1))));
        const float frac = rowF - static_cast<float>(row0);
        // A coherently-normalized Hann spectrum contains 1.5 bins of equivalent
        // noise bandwidth. With 4x zero padding, a bin-centered sinusoid therefore
        // contributes 6x its signal power across the positive-frequency bins.
        // Divide that back out so relocation conserves calibrated signal power.
        const float power = (mag * mag) / REASSIGNED_POWER_NORMALIZATION;

        reassignedPower_[row0] += power * (1.0f - frac);
        if (row0 + 1 < config_.rowCount) {
            reassignedPower_[row0 + 1] += power * frac;
        }
    }
}

void SpectrogramAnalyzer::computeFocusedSpectrum() {
    std::fill(focusedPower_.begin(), focusedPower_.end(), 0.0f);
    if (!haveLastPhase_ || magnitudesLinear_.size() < 3 || config_.rowCount == 0) {
        return;
    }

    const float sampleRate = std::max(1.0f, config_.sampleRate);
    const float binWidth = sampleRate / static_cast<float>(paddedSize_);
    const float hopDt = static_cast<float>(resolveHopSize()) / sampleRate;
    const float ampThreshold = std::pow(10.0f, config_.minDecibels / 20.0f);
    const float twoPi = static_cast<float>(2.0 * M_PI);

    // Focused intentionally restores Prism's former peak-isolation aesthetic:
    // only local FFT maxima are relocated, with conservative phase correction
    // and a local spectral centroid. It is kept separate from Sharp/Sharper so
    // their energy-preserving reassignment cannot silently lose texture.
    for (size_t bin = 1; bin + 1 < magnitudesLinear_.size(); bin += 1) {
        const float mag = magnitudesLinear_[bin];
        if (mag <= ampThreshold
            || mag < magnitudesLinear_[bin - 1]
            || mag < magnitudesLinear_[bin + 1]) {
            continue;
        }

        const float nominalFrequency = static_cast<float>(bin) * binWidth;
        if (nominalFrequency < config_.minFrequency || nominalFrequency > config_.maxFrequency) {
            continue;
        }

        const float expected = twoPi * nominalFrequency * hopDt;
        const bool useRightPhase = dominantRight_[bin] != 0;
        const float currentPhase = useRightPhase ? rightPhases_[bin] : phases_[bin];
        const float previousPhase = useRightPhase ? rightLastPhases_[bin] : lastPhases_[bin];
        float correctionHz = wrapPhase(currentPhase - previousPhase - expected) / (twoPi * hopDt);
        correctionHz = std::clamp(correctionHz, -1.5f * binWidth, 1.5f * binWidth);
        float focusedFrequency = nominalFrequency + correctionHz;

        const float leftWeight = magnitudesLinear_[bin - 1];
        const float centerWeight = mag;
        const float rightWeight = magnitudesLinear_[bin + 1];
        const float weightSum = leftWeight + centerWeight + rightWeight;
        if (weightSum > std::numeric_limits<float>::epsilon()) {
            const float centroidFrequency = (
                (static_cast<float>(bin - 1) * binWidth * leftWeight)
                + (nominalFrequency * centerWeight)
                + (static_cast<float>(bin + 1) * binWidth * rightWeight)
            ) / weightSum;
            focusedFrequency = 0.5f * focusedFrequency + 0.5f * centroidFrequency;
        }

        if (focusedFrequency < config_.minFrequency || focusedFrequency > config_.maxFrequency) {
            continue;
        }
        const float rowF = frequencyToRow(focusedFrequency);
        const size_t row0 = static_cast<size_t>(std::floor(
            std::clamp(rowF, 0.0f, static_cast<float>(config_.rowCount - 1))
        ));
        const float frac = rowF - static_cast<float>(row0);
        const float power = mag * mag;

        focusedPower_[row0] += power * (1.0f - frac);
        if (row0 + 1 < config_.rowCount) {
            focusedPower_[row0 + 1] += power * frac;
        }
    }
}

SpectrogramAnalyzer::ClarityProfile SpectrogramAnalyzer::clarityProfile(const std::string& mode) {
    if (mode == "classic") {
        return {1.4f, 0.42f, 0.32f, false};
    }
    if (mode == "sharp") {
        return {1.25f, 0.22f, 0.16f, true};
    }
    return {1.1f, 0.08f, 0.06f, true};
}

void SpectrogramAnalyzer::shapeColumn(std::vector<float>& display, std::vector<float>& heat) {
    if (config_.clarityMode == "focused") {
        shapeFocusedColumn(display, heat);
        return;
    }

    const size_t rowCount = config_.rowCount;
    const ClarityProfile clarity = clarityProfile(config_.clarityMode);
    const bool useReassignedColumn = clarity.useReassignment && haveLastPhase_;

    for (size_t row = 0; row < rowCount; row += 1) {
        if (useReassignedColumn && reassignedPower_[row] > 0.0f) {
            const float reassignedMag = std::sqrt(reassignedPower_[row]);
            const float reassignedDb = 20.0f * std::log10(std::max(reassignedMag, 1.0e-10f));
            const float displayDb = applyDisplayTilt(reassignedDb, rowCenterFrequencies_[row]);
            sourceRaw_[row] = displayDbToIntensity(displayDb);
            sourceHeat_[row] = normalizeHeatDb(displayDb);
        } else if (!useReassignedColumn) {
            // The first phase-history frame falls back to Classic. Subsequent Sharp
            // and Sharper frames contain only reassigned energy — no hidden Classic
            // layer and no local-contrast gate.
            sourceRaw_[row] = standardRaw_[row];
            sourceHeat_[row] = standardHeat_[row];
        } else {
            sourceRaw_[row] = 0.0f;
            sourceHeat_[row] = 0.0f;
        }
    }

    const float effectiveGamma = clarity.gamma * config_.contrast;
    for (size_t row = 0; row < rowCount; row += 1) {
        shapedDisplay_[row] = std::pow(clamp01(sourceRaw_[row]), effectiveGamma);
        shapedHeat_[row] = std::pow(clamp01(sourceHeat_[row]), SPECTROGRAM_HEAT_GAMMA);
        strokedDisplay_[row] = shapedDisplay_[row];
        strokedHeat_[row] = shapedHeat_[row];
    }

    for (size_t row = 0; row < rowCount; row += 1) {
        const float displayShoulder = shapedDisplay_[row] * clarity.displayShoulder;
        const float heatShoulder = shapedHeat_[row] * clarity.heatShoulder;
        if (row > 0) {
            strokedDisplay_[row - 1] = std::max(strokedDisplay_[row - 1], displayShoulder);
            strokedHeat_[row - 1] = std::max(strokedHeat_[row - 1], heatShoulder);
        }
        if (row + 1 < rowCount) {
            strokedDisplay_[row + 1] = std::max(strokedDisplay_[row + 1], displayShoulder);
            strokedHeat_[row + 1] = std::max(strokedHeat_[row + 1], heatShoulder);
        }
    }

    const size_t offset = display.size();
    display.resize(offset + rowCount);
    heat.resize(offset + rowCount);
    for (size_t row = 0; row < rowCount; row += 1) {
        display[offset + row] = strokedDisplay_[row];
        heat[offset + row] = strokedHeat_[row];
    }
}

void SpectrogramAnalyzer::shapeFocusedColumn(std::vector<float>& display, std::vector<float>& heat) {
    const size_t rowCount = config_.rowCount;
    constexpr float standardWeight = 0.45f;
    constexpr float reassignedWeight = 1.0f;
    constexpr float sharpness = 5.0f;
    constexpr float lineWidth = 2.0f;
    constexpr float detailPreserve = 0.14f;
    constexpr float gamma = 2.0f;
    constexpr float displayShoulderWeight = 0.42f;
    constexpr float heatShoulderWeight = 0.32f;

    for (size_t row = 0; row < rowCount; row += 1) {
        float focusedRaw = 0.0f;
        float focusedHeat = 0.0f;
        if (focusedPower_[row] > 0.0f) {
            const float focusedMag = std::sqrt(focusedPower_[row]);
            const float focusedDb = 20.0f * std::log10(std::max(focusedMag, 1.0e-10f));
            const float displayDb = applyDisplayTilt(focusedDb, rowCenterFrequencies_[row]);
            focusedRaw = displayDbToIntensity(displayDb);
            focusedHeat = normalizeHeatDb(displayDb);
        }

        sourceRaw_[row] = std::max(standardRaw_[row] * standardWeight, focusedRaw * reassignedWeight);
        sourceHeat_[row] = std::max(standardHeat_[row] * standardWeight, focusedHeat * reassignedWeight);
    }

    const std::vector<float> peakSource = sourceRaw_;
    const float mainlobePaddedBins = 4.0f * static_cast<float>(FFT_PAD_FACTOR);
    for (size_t row = 0; row < rowCount; row += 1) {
        const float bandWidthPerRow = std::max(0.1f, rowBandEndBins_[row] - rowBandStartBins_[row]);
        const float mainlobePixels = mainlobePaddedBins / bandWidthPerRow;
        const int halfWindow = std::max(
            2,
            std::min(50, static_cast<int>(std::lround(mainlobePixels * 0.5f)))
        );
        const float scaleFactor = std::max(1.0f, mainlobePixels / lineWidth);
        const float effectiveSharpness = sharpness * scaleFactor;

        float localMax = peakSource[row];
        for (int offset = 1; offset <= halfWindow; offset += 1) {
            if (row >= static_cast<size_t>(offset)) {
                localMax = std::max(localMax, peakSource[row - static_cast<size_t>(offset)]);
            }
            if (row + static_cast<size_t>(offset) < rowCount) {
                localMax = std::max(localMax, peakSource[row + static_cast<size_t>(offset)]);
            }
        }

        if (localMax > 1.0e-6f) {
            const float suppression = std::pow(clamp01(sourceRaw_[row] / localMax), effectiveSharpness);
            const float rawBefore = sourceRaw_[row];
            const float heatBefore = sourceHeat_[row];
            sourceRaw_[row] = std::max(rawBefore * suppression, rawBefore * detailPreserve);
            sourceHeat_[row] = std::max(heatBefore * suppression, heatBefore * detailPreserve);
        }
    }

    const float effectiveGamma = gamma * config_.contrast;
    for (size_t row = 0; row < rowCount; row += 1) {
        shapedDisplay_[row] = std::pow(clamp01(sourceRaw_[row]), effectiveGamma);
        shapedHeat_[row] = std::pow(clamp01(sourceHeat_[row]), SPECTROGRAM_HEAT_GAMMA);
        strokedDisplay_[row] = shapedDisplay_[row];
        strokedHeat_[row] = shapedHeat_[row];
    }

    for (size_t row = 0; row < rowCount; row += 1) {
        const float displayShoulder = shapedDisplay_[row] * displayShoulderWeight;
        const float heatShoulder = shapedHeat_[row] * heatShoulderWeight;
        if (row > 0) {
            strokedDisplay_[row - 1] = std::max(strokedDisplay_[row - 1], displayShoulder);
            strokedHeat_[row - 1] = std::max(strokedHeat_[row - 1], heatShoulder);
        }
        if (row + 1 < rowCount) {
            strokedDisplay_[row + 1] = std::max(strokedDisplay_[row + 1], displayShoulder);
            strokedHeat_[row + 1] = std::max(strokedHeat_[row + 1], heatShoulder);
        }
    }

    const size_t offset = display.size();
    display.resize(offset + rowCount);
    heat.resize(offset + rowCount);
    for (size_t row = 0; row < rowCount; row += 1) {
        display[offset + row] = strokedDisplay_[row];
        heat[offset + row] = strokedHeat_[row];
    }
}

void SpectrogramAnalyzer::processFrame(std::vector<float>& display, std::vector<float>& heat) {
    std::fill(windowedInput_.begin(), windowedInput_.end(), 0.0f);
    std::fill(rightWindowedInput_.begin(), rightWindowedInput_.end(), 0.0f);
    for (size_t index = 0; index < fftSize_; index += 1) {
        windowedInput_[index] = frameBuffer_[index] * window_[index];
        rightWindowedInput_[index] = rightFrameBuffer_[index] * window_[index];
    }

    fft_->forward(windowedInput_.data(), fftOutput_.data());
    fft_->forward(rightWindowedInput_.data(), rightFftOutput_.data());

    const size_t numBins = paddedSize_ / 2;
    for (size_t bin = 0; bin < numBins; bin += 1) {
        const float leftRe = fftOutput_[bin].real();
        const float leftIm = fftOutput_[bin].imag();
        const float rightRe = rightFftOutput_[bin].real();
        const float rightIm = rightFftOutput_[bin].imag();
        const float leftMagnitude = std::sqrt((leftRe * leftRe) + (leftIm * leftIm)) * magnitudeScale_;
        const float rightMagnitude = std::sqrt((rightRe * rightRe) + (rightIm * rightIm)) * magnitudeScale_;
        const float stereoMagnitude = std::sqrt(
            0.5f * ((leftMagnitude * leftMagnitude) + (rightMagnitude * rightMagnitude))
        );
        magnitudesLinear_[bin] = stereoMagnitude;
        magnitudesDb_[bin] = 20.0f * std::log10(std::max(stereoMagnitude, 1.0e-10f));
        phases_[bin] = std::atan2(leftIm, leftRe);
        rightPhases_[bin] = std::atan2(rightIm, rightRe);
        dominantRight_[bin] = rightMagnitude > leftMagnitude ? 1 : 0;
    }

    computeStandardSpectrum();
    if (config_.clarityMode == "focused") {
        computeFocusedSpectrum();
    } else {
        computeReassignedSpectrum();
    }
    shapeColumn(display, heat);

    lastPhases_ = phases_;
    rightLastPhases_ = rightPhases_;
    haveLastPhase_ = true;
}

SpectrogramProcessResult SpectrogramAnalyzer::process(const float* samples, size_t length) {
    return processStereo(samples, samples, length);
}

SpectrogramProcessResult SpectrogramAnalyzer::processStereo(const float* left, const float* right, size_t length) {
    SpectrogramProcessResult result;
    result.rowCount = config_.rowCount;
    if (!left || !right || length == 0 || fftSize_ == 0 || config_.rowCount == 0) {
        return result;
    }

    const size_t hopSize = resolveHopSize();
    const size_t overlapSamples = fftSize_ - hopSize;

    for (size_t index = 0; index < length; index += 1) {
        frameBuffer_[frameFill_] = left[index];
        rightFrameBuffer_[frameFill_] = right[index];
        frameFill_ += 1;

        if (frameFill_ >= fftSize_) {
            processFrame(result.display, result.heat);
            result.columnCount += 1;

            if (overlapSamples > 0) {
                std::memmove(frameBuffer_.data(), frameBuffer_.data() + hopSize, overlapSamples * sizeof(float));
                std::memmove(rightFrameBuffer_.data(), rightFrameBuffer_.data() + hopSize, overlapSamples * sizeof(float));
            }
            frameFill_ = overlapSamples;
        }
    }

    return result;
}

} // namespace Visualizer
