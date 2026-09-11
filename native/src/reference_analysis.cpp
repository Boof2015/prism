#include "reference_analysis.h"
#include "dsp_utils.h"
#include "../vendor/r8brain/CDSPResampler.h"
#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace Visualizer {
struct ReferenceResampler::Impl {
    double sourceRate;
    uint64_t inputCount = 0, outputCount = 0;
    std::unique_ptr<r8b::CDSPResampler24> converter;
    std::array<double, 4096> input {};
    std::vector<float> converted;
    explicit Impl(double rate) : sourceRate(rate) {
        if (rate < 8000 || rate > 384000 || !std::isfinite(rate)) throw std::runtime_error("Unsupported audio sample rate.");
        if (rate != referenceSampleRate) converter = std::make_unique<r8b::CDSPResampler24>(rate, referenceSampleRate, 4096);
    }
    void convert(size_t count, const std::function<void(const float*, size_t)>& output) {
        double* samples = nullptr;
        const int available = converter->process(input.data(), static_cast<int>(count), samples);
        const auto expected = static_cast<uint64_t>(std::llround(inputCount * referenceSampleRate / sourceRate));
        const size_t n = std::min<uint64_t>(static_cast<uint64_t>(available), expected - std::min(expected, outputCount));
        if (!n) return;
        converted.resize(n);
        for (size_t i = 0; i < n; ++i) converted[i] = static_cast<float>(samples[i]);
        output(converted.data(), n);
        outputCount += n;
    }
};
ReferenceResampler::ReferenceResampler(double rate) : impl(std::make_unique<Impl>(rate)) {}
ReferenceResampler::~ReferenceResampler() = default;
void ReferenceResampler::reset() { impl = std::make_unique<Impl>(impl->sourceRate); }
void ReferenceResampler::push(const float* samples, size_t count, const std::function<void(const float*, size_t)>& output) {
    if (!impl->converter) { impl->inputCount += count; impl->outputCount += count; output(samples, count); return; }
    while (count) {
        const size_t n = std::min(count, impl->input.size());
        for (size_t i = 0; i < n; ++i) impl->input[i] = samples[i];
        impl->inputCount += n;
        impl->convert(n, output);
        count -= n; samples += n;
    }
}
void ReferenceResampler::finish(const std::function<void(const float*, size_t)>& output) {
    if (!impl->converter) return;
    const auto expected = static_cast<uint64_t>(std::llround(impl->inputCount * referenceSampleRate / impl->sourceRate));
    impl->input.fill(0);
    for (int i = 0; impl->outputCount < expected && i < 128; ++i) impl->convert(impl->input.size(), output);
    if (impl->outputCount != expected) throw std::runtime_error("Could not finish audio resampling.");
}

struct ReferenceAccumulator::Impl {
    struct Band {
        size_t size, hop;
        DSP::FFT fft;
        std::vector<float> pending, window, input;
        std::vector<std::complex<float>> output;
        std::vector<double> sum;
        double weight = 0, fullEnergy = 0;
        explicit Band(size_t n) : size(n), hop(n / 4), fft(n), window(n), input(n), output(n), sum(n / 2, 0) {
            pending.reserve(n + 4096);
            for (size_t i = 0; i < n; ++i) {
                window[i] = static_cast<float>(0.5 * (1 - std::cos(2 * M_PI * i / (n - 1))));
                fullEnergy += static_cast<double>(window[i]) * window[i];
            }
        }
        void frame(size_t valid, size_t offset = 0) {
            double windowSum = 0, energy = 0;
            std::fill(input.begin(), input.end(), 0);
            const size_t padding = (size - valid) / 2;
            for (size_t i = 0; i < valid; ++i) {
                const auto w = window[padding + i];
                input[padding + i] = pending[offset + i] * w;
                windowSum += w; energy += static_cast<double>(w) * w;
            }
            if (windowSum <= 0 || energy <= 0) return;
            fft.forward(input.data(), output.data());
            const double w = energy / fullEnergy;
            const double scale = 4 / (windowSum * windowSum);
            for (size_t i = 0; i < sum.size(); ++i) sum[i] += std::norm(output[i]) * scale * w;
            weight += w;
        }
        void push(const float* samples, size_t count) {
            pending.insert(pending.end(), samples, samples + count);
            size_t consumed = 0;
            while (pending.size() - consumed >= size) {
                frame(size, consumed);
                consumed += hop;
            }
            pending.erase(pending.begin(), pending.begin() + static_cast<std::ptrdiff_t>(consumed));
        }
        std::vector<float> curve() const {
            std::vector<float> result(sum.size(), 0);
            if (weight > 0) for (size_t i = 0; i < sum.size(); ++i) result[i] = static_cast<float>(sum[i] / weight);
            return result;
        }
    };
    double sourceRate;
    ReferenceResampler resampler;
    std::array<std::unique_ptr<Band>, 5> bands;
    uint64_t samples = 0;
    double power = 0;
    bool finished = false;
    explicit Impl(double rate) : sourceRate(rate), resampler(rate) {
        for (size_t i = 0; i < bands.size(); ++i) bands[i] = std::make_unique<Band>(referenceFFTSizes[i]);
    }
    void accumulate(const float* data, size_t count) {
        for (size_t i = 0; i < count; ++i) power += static_cast<double>(data[i]) * data[i];
        samples += count;
        for (auto& band : bands) band->push(data, count);
    }
};
ReferenceAccumulator::ReferenceAccumulator(double rate) : impl(std::make_unique<Impl>(rate)) {}
ReferenceAccumulator::~ReferenceAccumulator() = default;
void ReferenceAccumulator::push(const float* data, size_t count) {
    if (impl->finished) throw std::runtime_error("Reference analysis is already complete.");
    impl->resampler.push(data, count, [this](const float* p, size_t n) { impl->accumulate(p, n); });
}
ReferenceCurve ReferenceAccumulator::snapshot(bool finish) {
    if (finish && !impl->finished) {
        impl->resampler.finish([this](const float* p, size_t n) { impl->accumulate(p, n); });
        for (auto& band : impl->bands) if (!band->pending.empty()) band->frame(band->pending.size());
        impl->finished = true;
    }
    ReferenceCurve result;
    result.sourceNyquistHz = impl->sourceRate / 2;
    result.durationSeconds = static_cast<double>(impl->samples) / referenceSampleRate;
    result.meanSquare = impl->samples ? impl->power / impl->samples : 0;
    for (size_t i = 0; i < impl->bands.size(); ++i) result.powers[i] = impl->bands[i]->curve();
    return result;
}

ReferenceLiveState::ReferenceLiveState(double rate)
    : leftResampler(rate), rightResampler(rate), powers(referenceSampleRate * 3, 0), recentPowers(static_cast<size_t>(std::ceil(rate / 10)), 0) {}
ReferenceLiveState::~ReferenceLiveState() = default;
void ReferenceLiveState::push(const float* left, const float* right, size_t count,
                             const std::function<void(const float*, const float*, size_t)>& output) {
    if (!count) return;
    const auto now = std::chrono::steady_clock::now();
    if (lastInput != std::chrono::steady_clock::time_point() && now - lastInput > std::chrono::milliseconds(300)) {
        std::fill(powers.begin(), powers.end(), 0);
        std::fill(recentPowers.begin(), recentPowers.end(), 0);
        position = filled = recentPosition = 0; sum = recentSum = 0;
        leftResampler.reset(); rightResampler.reset(); leftPending.clear(); rightPending.clear();
    }
    lastInput = now;
    for (size_t i = 0; i < count; ++i) {
        const double mid = (static_cast<double>(left[i]) + (right ? right[i] : left[i])) * 0.5;
        recentSum -= recentPowers[recentPosition]; recentPowers[recentPosition] = mid * mid; recentSum += recentPowers[recentPosition];
        recentPosition = (recentPosition + 1) % recentPowers.size();
    }
    leftResampler.push(left, count, [this](const float* p, size_t n) { leftPending.insert(leftPending.end(), p, p + n); });
    rightResampler.push(right ? right : left, count, [this](const float* p, size_t n) { rightPending.insert(rightPending.end(), p, p + n); });
    const size_t n = std::min(leftPending.size(), rightPending.size());
    if (!n) return;
    for (size_t i = 0; i < n; ++i) {
        const double mid = (static_cast<double>(leftPending[i]) + rightPending[i]) * 0.5;
        sum -= powers[position]; powers[position] = mid * mid; sum += powers[position];
        position = (position + 1) % powers.size(); filled = std::min(filled + 1, powers.size());
    }
    output(leftPending.data(), rightPending.data(), n);
    leftPending.erase(leftPending.begin(), leftPending.begin() + static_cast<std::ptrdiff_t>(n));
    rightPending.erase(rightPending.begin(), rightPending.begin() + static_cast<std::ptrdiff_t>(n));
}
double ReferenceLiveState::meanSquare() const {
    // Matching uses the three-second average only while the most recent 100 ms
    // contain signal. Old power must not enable Match on silence/stopped capture.
    return seconds() > 0 && recentSum / recentPowers.size() > 1e-9
        ? std::max(0.0, sum / filled) : 0;
}
double ReferenceLiveState::seconds() const {
    return std::chrono::steady_clock::now() - lastInput < std::chrono::milliseconds(300)
        ? static_cast<double>(filled) / referenceSampleRate : 0;
}
}
