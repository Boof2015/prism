#include "waterfall.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace Visualizer {
namespace {
float finiteOr(float value, float fallback) {
    // The addon is built with fast-math on some platforms; inspect IEEE bits so
    // NaN/Infinity sanitization cannot be optimized away under those flags.
    uint32_t bits;
    std::memcpy(&bits, &value, sizeof(bits));
    return (bits & 0x7f800000U) == 0x7f800000U ? fallback : value;
}
float mel(float hz) {
    return hz < 1000 ? hz / (200.0f / 3) : 15 + std::log(hz / 1000) / (std::log(6.4f) / 27);
}
float inverseMel(float value) {
    return value < 15 ? value * (200.0f / 3) : 1000 * std::exp((value - 15) * (std::log(6.4f) / 27));
}
float frequencyAt(float x, const WaterfallConfig& config) {
    const float high = std::min(config.maxFrequency, config.sampleRate * 0.5f);
    const float low = std::min(config.minFrequency, high);
    if (config.scaleMode == "linear") return low + x * (high - low);
    if (config.scaleMode == "mel") return inverseMel(mel(low) + x * (mel(high) - mel(low)));
    return low * std::pow(high / low, x);
}
}

WaterfallAnalyzer::WaterfallAnalyzer() { configure(config_); }

void WaterfallAnalyzer::resizeHistory(size_t capacity) {
    const size_t bins = config_.fftSize / 2;
    std::vector<float> values(capacity * bins, -100);
    std::vector<double> times(capacity);
    const size_t keep = std::min(count_, capacity);
    for (size_t i = 0; i < keep; ++i) {
        const size_t source = (write_ + capacity_ - keep + i) % capacity_;
        std::copy_n(history_.data() + source * bins, bins, values.data() + i * bins);
        times[i] = times_[source];
    }
    history_.swap(values);
    times_.swap(times);
    capacity_ = capacity;
    count_ = keep;
    write_ = keep % capacity;
}

void WaterfallAnalyzer::configure(const WaterfallConfig& value) {
    WaterfallConfig next = value;
    next.sampleRate = std::clamp(finiteOr(next.sampleRate, 48000), 8000.0f, 384000.0f);
    if (next.fftSize < 1024 || next.fftSize > 16384 || (next.fftSize & (next.fftSize - 1))) next.fftSize = 2048;
    next.historySeconds = std::clamp(finiteOr(next.historySeconds, 5), 1.0f, 30.0f);
    next.smoothing = std::clamp(finiteOr(next.smoothing, 0.9f), 0.0f, 0.99f);
    next.tiltDbPerOctave = std::clamp(finiteOr(next.tiltDbPerOctave, 2), -2.0f, 8.0f);
    next.minFrequency = std::clamp(finiteOr(next.minFrequency, 10), 1.0f, next.sampleRate * 0.5f);
    next.maxFrequency = std::clamp(finiteOr(next.maxFrequency, 24000), next.minFrequency, next.sampleRate * 0.5f);
    if (next.scaleMode != "mel" && next.scaleMode != "linear") next.scaleMode = "log";
    const bool restart = next.sampleRate != config_.sampleRate || next.fftSize != config_.fftSize;
    if (restart) reset();
    config_ = next;
    spectrum_.setFFTSize(config_.fftSize);
    spectrum_.setSampleRate(config_.sampleRate);
    spectrum_.setSmoothing(config_.smoothing);
    const size_t capacity = static_cast<size_t>(std::ceil(config_.historySeconds * 60)) + 2;
    if (restart || capacity != capacity_) resizeHistory(capacity);
    pendingLeft_.reserve(static_cast<size_t>(std::ceil(config_.sampleRate / 60)));
    pendingRight_.reserve(pendingLeft_.capacity());
}

void WaterfallAnalyzer::append() {
    const auto& levels = spectrum_.getChannelMaxMagnitudes();
    std::copy(levels.begin(), levels.end(), history_.begin() + write_ * levels.size());
    times_[write_] = static_cast<double>(samples_) / config_.sampleRate;
    write_ = (write_ + 1) % capacity_;
    count_ = std::min(count_ + 1, capacity_);
}

void WaterfallAnalyzer::processStereo(const float* left, const float* right, size_t length) {
    if (!left || !right) return;
    size_t offset = 0;
    while (offset < length) {
        const uint64_t boundary = static_cast<uint64_t>(std::ceil(tick_ * static_cast<double>(config_.sampleRate) / 60));
        const size_t take = std::min(length - offset, static_cast<size_t>(boundary - samples_));
        for (size_t i = 0; i < take; ++i) {
            pendingLeft_.push_back(finiteOr(left[offset + i], 0));
            pendingRight_.push_back(finiteOr(right[offset + i], 0));
        }
        offset += take;
        samples_ += take;
        if (samples_ == boundary) {
            spectrum_.pushStereoSamples(pendingLeft_.data(), pendingRight_.data(), pendingLeft_.size());
            pendingLeft_.clear();
            pendingRight_.clear();
            if (samples_ >= config_.fftSize) append();
            ++tick_;
        }
    }
}

WaterfallFrame WaterfallAnalyzer::getFrame(size_t ridges, size_t columns) const {
    WaterfallFrame frame;
    frame.columns = std::clamp(columns, size_t{2}, size_t{512});
    frame.audioSeconds = static_cast<double>(samples_) / config_.sampleRate;
    ridges = std::clamp(ridges, size_t{2}, size_t{64});
    frame.frequencies.resize(frame.columns);
    const size_t bins = config_.fftSize / 2;
    std::vector<float> positions(frame.columns), tilts(frame.columns);
    std::vector<size_t> starts(frame.columns), ends(frame.columns);
    for (size_t x = 0; x < frame.columns; ++x) {
        const float t = static_cast<float>(x) / (frame.columns - 1);
        const float half = 0.5f / (frame.columns - 1);
        const float hz = frequencyAt(t, config_);
        frame.frequencies[x] = hz;
        positions[x] = std::clamp(hz * config_.fftSize / config_.sampleRate, 0.0f, static_cast<float>(bins - 1));
        starts[x] = std::min(bins - 1, static_cast<size_t>(std::ceil(frequencyAt(std::max(0.0f, t - half), config_) * config_.fftSize / config_.sampleRate)));
        ends[x] = std::min(bins - 1, static_cast<size_t>(std::floor(frequencyAt(std::min(1.0f, t + half), config_) * config_.fftSize / config_.sampleRate)));
        tilts[x] = config_.tiltDbPerOctave * std::log2(hz / 1000);
    }
    // Anchor historical ridges to the audio timeline so they move without morphing.
    const double spacing = config_.historySeconds / static_cast<double>(ridges - 1);
    const double anchor = std::floor(frame.audioSeconds / spacing) * spacing;
    size_t cursor = 0;
    for (size_t ridge = 0; ridge < ridges; ++ridge) {
        const double target = ridge == 0 ? frame.audioSeconds : anchor - (ridge - 1) * spacing;
        if (ridge == 1 && frame.audioSeconds - anchor < 1.0 / 60) continue;
        while (cursor < count_) {
            const size_t index = (write_ + capacity_ - 1 - cursor) % capacity_;
            if (times_[index] <= target + 1e-8) break;
            ++cursor;
        }
        if (cursor >= count_) break;
        const size_t index = (write_ + capacity_ - 1 - cursor) % capacity_;
        const float age = static_cast<float>(frame.audioSeconds - times_[index]);
        if (age > config_.historySeconds) break;
        frame.ages.push_back(age);
        const float* values = history_.data() + index * bins;
        for (size_t x = 0; x < frame.columns; ++x) {
            const size_t lo = static_cast<size_t>(positions[x]);
            const size_t hi = std::min(lo + 1, bins - 1);
            float db = values[lo] + (values[hi] - values[lo]) * (positions[x] - lo);
            for (size_t bin = starts[x]; bin <= ends[x]; ++bin) db = std::max(db, values[bin]);
            frame.levels.push_back(db + tilts[x]);
        }
    }
    return frame;
}

void WaterfallAnalyzer::reset() {
    spectrum_.reset();
    pendingLeft_.clear();
    pendingRight_.clear();
    count_ = write_ = samples_ = 0;
    tick_ = 1;
}
} // namespace Visualizer
