#define _USE_MATH_DEFINES
#include "spectrum.h"
#include <cmath>
#include <algorithm>
#include <cstring>

namespace Visualizer {

Spectrum::Spectrum(size_t fftSize)
    : fftSize_(fftSize)
    , sampleRate_(44100.0f)
    , smoothing_(0.9f)
    , bufferedSamples_(0) {
    fft_ = std::make_unique<DSP::FFT>(fftSize);
    historyBuffer_.resize(fftSize, 0.0f);
    sideHistoryBuffer_.resize(fftSize, 0.0f);
    windowedInput_.resize(fftSize);
    midSpectrum_.resize(fftSize);
    sideSpectrum_.resize(fftSize);
    rawMagnitudes_.resize(fftSize / 2, -100.0f);
    // Initialize to silence (-100.0f dB)
    smoothedMagnitudes_.resize(fftSize / 2, -100.0f);
    sideRawMagnitudes_.resize(fftSize / 2, -100.0f);
    sideSmoothedMagnitudes_.resize(fftSize / 2, -100.0f);
    leftSmoothedMagnitudes_.resize(fftSize / 2, -100.0f);
    rightSmoothedMagnitudes_.resize(fftSize / 2, -100.0f);
    channelMaxMagnitudes_.resize(fftSize / 2, -100.0f);
}

void Spectrum::setFFTSize(size_t size) {
    if (size != fftSize_) {
        fftSize_ = size;
        fft_ = std::make_unique<DSP::FFT>(size);
        historyBuffer_.assign(size, 0.0f);
        sideHistoryBuffer_.assign(size, 0.0f);
        windowedInput_.resize(size);
        midSpectrum_.resize(size);
        sideSpectrum_.resize(size);
        rawMagnitudes_.assign(size / 2, -100.0f);
        // Initialize to silence (-100.0f dB)
        smoothedMagnitudes_.assign(size / 2, -100.0f);
        sideRawMagnitudes_.assign(size / 2, -100.0f);
        sideSmoothedMagnitudes_.assign(size / 2, -100.0f);
        leftSmoothedMagnitudes_.assign(size / 2, -100.0f);
        rightSmoothedMagnitudes_.assign(size / 2, -100.0f);
        channelMaxMagnitudes_.assign(size / 2, -100.0f);
        bufferedSamples_ = 0;
    }
}

void Spectrum::setSampleRate(float sampleRate) {
    sampleRate_ = sampleRate;
}

void Spectrum::setSmoothing(float smoothing) {
    smoothing_ = std::clamp(smoothing, 0.0f, 0.99f);
}

void Spectrum::applyWindow(const float* input, float* output, size_t length) {
    if (length <= 1) {
        if (length == 1) {
            output[0] = input[0];
        }
        return;
    }

    // Hann window
    for (size_t i = 0; i < length; i++) {
        float window = 0.5f * (1.0f - cosf(2.0f * M_PI * i / (length - 1)));
        output[i] = input[i] * window;
    }
}

void Spectrum::pushHistory(std::vector<float>& history, const float* input, size_t length) {
    if (length == 0 || fftSize_ == 0) {
        return;
    }

    // Keep only the most recent fftSize_ samples.
    if (length >= fftSize_) {
        std::memcpy(history.data(), input + (length - fftSize_), fftSize_ * sizeof(float));
        return;
    }

    const size_t keep = fftSize_ - length;
    std::move(history.begin() + length, history.end(), history.begin());
    std::memcpy(history.data() + keep, input, length * sizeof(float));
}

void Spectrum::pushZeroHistory(std::vector<float>& history, size_t length) {
    if (length == 0 || fftSize_ == 0) {
        return;
    }

    if (length >= fftSize_) {
        std::fill(history.begin(), history.end(), 0.0f);
        return;
    }

    const size_t keep = fftSize_ - length;
    std::move(history.begin() + length, history.end(), history.begin());
    std::fill(history.begin() + keep, history.end(), 0.0f);
}

float Spectrum::magnitudeToDb(float magnitude, float correctionDb) const {
    const float db = 20.0f * log10f(std::max(magnitude, 1e-10f)) + correctionDb;
    return std::clamp(db, -120.0f, 12.0f);
}

void Spectrum::updateSmoothedMagnitude(float db, float& smoothedMagnitude) {
    if (bufferedSamples_ < fftSize_) {
        smoothedMagnitude = db;
    } else {
        smoothedMagnitude = smoothing_ * smoothedMagnitude + (1.0f - smoothing_) * db;
    }
    if (!std::isfinite(smoothedMagnitude)) {
        smoothedMagnitude = -100.0f;
    }
}

void Spectrum::updateMagnitudes() {
    if (historyBuffer_.empty() || rawMagnitudes_.empty()) {
        return;
    }

    applyWindow(historyBuffer_.data(), windowedInput_.data(), fftSize_);
    fft_->forward(windowedInput_.data(), midSpectrum_.data());
    applyWindow(sideHistoryBuffer_.data(), windowedInput_.data(), fftSize_);
    fft_->forward(windowedInput_.data(), sideSpectrum_.data());

    const float scale = 2.0f / static_cast<float>(fftSize_);
    const float coherentGain = fftSize_ > 1
        ? static_cast<float>(fftSize_ - 1) / (2.0f * static_cast<float>(fftSize_))
        : 1.0f;
    const float correctionDb = -20.0f * log10f(coherentGain);
    for (size_t i = 0; i < rawMagnitudes_.size(); i++) {
        const std::complex<float> mid = midSpectrum_[i];
        const std::complex<float> side = sideSpectrum_[i];
        const float midDb = magnitudeToDb(std::abs(mid) * scale, correctionDb);
        const float sideDb = magnitudeToDb(std::abs(side) * scale, correctionDb);
        const float leftDb = magnitudeToDb(std::abs(mid + side) * scale, correctionDb);
        const float rightDb = magnitudeToDb(std::abs(mid - side) * scale, correctionDb);

        rawMagnitudes_[i] = midDb;
        sideRawMagnitudes_[i] = sideDb;
        updateSmoothedMagnitude(midDb, smoothedMagnitudes_[i]);
        updateSmoothedMagnitude(sideDb, sideSmoothedMagnitudes_[i]);
        updateSmoothedMagnitude(leftDb, leftSmoothedMagnitudes_[i]);
        updateSmoothedMagnitude(rightDb, rightSmoothedMagnitudes_[i]);
        channelMaxMagnitudes_[i] = std::max(leftSmoothedMagnitudes_[i], rightSmoothedMagnitudes_[i]);
    }
}

void Spectrum::pushSamples(const float* input, size_t length) {
    if (input != nullptr && length > 0) {
        pushHistory(historyBuffer_, input, length);
        pushZeroHistory(sideHistoryBuffer_, length);
        bufferedSamples_ = length >= fftSize_ ? fftSize_ : std::min(fftSize_, bufferedSamples_ + length);
        updateMagnitudes();
        return;
    }
    updateMagnitudes();
}

void Spectrum::pushStereoSamples(const float* left, const float* right, size_t length) {
    if (left != nullptr && right != nullptr && length > 0 && fftSize_ > 0) {
        if (length >= fftSize_) {
            const size_t start = length - fftSize_;
            for (size_t i = 0; i < fftSize_; i++) {
                const float leftValue = left[start + i];
                const float rightValue = right[start + i];
                historyBuffer_[i] = (leftValue + rightValue) * 0.5f;
                sideHistoryBuffer_[i] = (leftValue - rightValue) * 0.5f;
            }
            bufferedSamples_ = fftSize_;
        } else {
            const size_t keep = fftSize_ - length;
            std::move(historyBuffer_.begin() + length, historyBuffer_.end(), historyBuffer_.begin());
            std::move(sideHistoryBuffer_.begin() + length, sideHistoryBuffer_.end(), sideHistoryBuffer_.begin());
            for (size_t i = 0; i < length; i++) {
                const float leftValue = left[i];
                const float rightValue = right[i];
                historyBuffer_[keep + i] = (leftValue + rightValue) * 0.5f;
                sideHistoryBuffer_[keep + i] = (leftValue - rightValue) * 0.5f;
            }
            bufferedSamples_ = std::min(fftSize_, bufferedSamples_ + length);
        }
    }
    updateMagnitudes();
}

const std::vector<float>& Spectrum::process(const float* audioData, size_t length) {
    pushSamples(audioData, length);
    return smoothedMagnitudes_;
}

float Spectrum::binToFrequency(int bin) const {
    return bin * sampleRate_ / fftSize_;
}

void Spectrum::reset() {
    std::fill(historyBuffer_.begin(), historyBuffer_.end(), 0.0f);
    std::fill(sideHistoryBuffer_.begin(), sideHistoryBuffer_.end(), 0.0f);
    std::fill(rawMagnitudes_.begin(), rawMagnitudes_.end(), -100.0f);
    std::fill(smoothedMagnitudes_.begin(), smoothedMagnitudes_.end(), -100.0f);
    std::fill(sideRawMagnitudes_.begin(), sideRawMagnitudes_.end(), -100.0f);
    std::fill(sideSmoothedMagnitudes_.begin(), sideSmoothedMagnitudes_.end(), -100.0f);
    std::fill(leftSmoothedMagnitudes_.begin(), leftSmoothedMagnitudes_.end(), -100.0f);
    std::fill(rightSmoothedMagnitudes_.begin(), rightSmoothedMagnitudes_.end(), -100.0f);
    std::fill(channelMaxMagnitudes_.begin(), channelMaxMagnitudes_.end(), -100.0f);
    bufferedSamples_ = 0;
}

} // namespace Visualizer
