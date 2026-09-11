#pragma once
#include <chrono>

#include <array>
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace Visualizer {
constexpr int referenceSampleRate = 48000;
constexpr std::array<int, 5> referenceFFTSizes { 1024, 2048, 4096, 8192, 16384 };

class ReferenceResampler {
public:
    explicit ReferenceResampler(double sourceRate);
    ~ReferenceResampler();
    void push(const float* samples, size_t count, const std::function<void(const float*, size_t)>& output);
    void finish(const std::function<void(const float*, size_t)>& output);
    void reset();
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};

struct ReferenceCurve {
    double sourceNyquistHz = 24000;
    double durationSeconds = 0;
    double meanSquare = 0;
    std::array<std::vector<float>, 5> powers;
};

/** Every object owns its FFTs and accumulation buffers; no live-DSP singleton access. */
class ReferenceAccumulator {
public:
    explicit ReferenceAccumulator(double sourceRate);
    ~ReferenceAccumulator();
    void push(const float* mid, size_t count);
    ReferenceCurve snapshot(bool finish = false);
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};

using ReferenceProgress = std::function<void(double, const ReferenceCurve&)>;
ReferenceCurve analyzeReferenceFile(const std::string& path, std::atomic<bool>& cancelled,
                                  const ReferenceProgress& progress, size_t chunkFrames = 4096);

class ReferenceLiveState {
public:
    explicit ReferenceLiveState(double sampleRate);
    ~ReferenceLiveState();
    void push(const float* left, const float* right, size_t count,
              const std::function<void(const float*, const float*, size_t)>& output);
    double meanSquare() const;
    double seconds() const;
private:
    ReferenceResampler leftResampler, rightResampler;
    std::vector<float> leftPending, rightPending;
    std::vector<double> powers;
    std::vector<double> recentPowers;
    size_t position = 0, filled = 0, recentPosition = 0;
    double sum = 0, recentSum = 0;
    std::chrono::steady_clock::time_point lastInput {};
};
}
