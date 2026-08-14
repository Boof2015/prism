#include "scope_plot_model.h"

#include "multiband.h"

#include <algorithm>
#include <cmath>

namespace Prism::Tui {
namespace {

constexpr float kInverseSqrtTwo = 0.7071067811865475f;

bool isUnipolar(VectorscopeMode mode) {
    return mode == VectorscopeMode::PolarUnipolar ||
        mode == VectorscopeMode::LinearUnipolar;
}

bool isPolar(VectorscopeMode mode) {
    return mode == VectorscopeMode::PolarUnipolar ||
        mode == VectorscopeMode::PolarBipolar;
}

bool transformVectorscopePoint(float left,
                               float right,
                               VectorscopeMode mode,
                               float& x,
                               float& y) {
    if (mode == VectorscopeMode::Lissajous) {
        x = right;
        y = left;
        return true;
    }

    const float mid = (left + right) * kInverseSqrtTwo;
    const float side = (right - left) * kInverseSqrtTwo;
    if (isUnipolar(mode) && mid < 0.0f) {
        return false;
    }

    if (isPolar(mode)) {
        const float amplitudeSquared = mid * mid + side * side;
        if (amplitudeSquared < 1e-12f) {
            x = 0.0f;
            y = 0.0f;
            return true;
        }
        const float amplitude = std::sqrt(amplitudeSquared);
        const float scaledAmplitude = std::pow(amplitude, 0.35f);
        const float factor = scaledAmplitude / amplitude;
        x = side * factor;
        y = mid * factor;
        return true;
    }

    x = side;
    y = mid;
    return true;
}

}  // namespace

std::vector<PlotPoint> buildOscilloscopePlot(const std::vector<float>& samples,
                                             int pixelWidth,
                                             int pixelHeight) {
    if (samples.empty() || pixelWidth <= 0 || pixelHeight <= 0) {
        return {};
    }

    std::vector<PlotPoint> points;
    points.reserve(static_cast<size_t>(pixelWidth));
    const float sampleSpan = static_cast<float>(samples.size() - 1);
    const float xSpan = static_cast<float>(std::max(1, pixelWidth - 1));
    const float ySpan = static_cast<float>(std::max(0, pixelHeight - 1));
    for (int x = 0; x < pixelWidth; ++x) {
        const float samplePosition = static_cast<float>(x) / xSpan * sampleSpan;
        const size_t first = std::min(
            samples.size() - 1,
            static_cast<size_t>(std::floor(samplePosition)));
        const size_t second = std::min(samples.size() - 1, first + 1);
        const float fraction = samplePosition - static_cast<float>(first);
        const float firstSample = std::isfinite(samples[first]) ? samples[first] : 0.0f;
        const float secondSample = std::isfinite(samples[second]) ? samples[second] : 0.0f;
        const float sample = std::clamp(
            firstSample + (secondSample - firstSample) * fraction,
            -1.0f,
            1.0f);
        const int y = static_cast<int>(std::lround(
            (1.0f - sample) * 0.5f * ySpan));
        points.push_back({x, std::clamp(y, 0, pixelHeight - 1)});
    }
    return points;
}

int oscilloscopeZeroY(int pixelHeight) {
    if (pixelHeight <= 0) {
        return 0;
    }
    return static_cast<int>(std::lround(
        static_cast<float>(pixelHeight - 1) * 0.5f));
}

VectorscopeBands buildVectorscopePlot(const std::vector<float>& multibandPoints,
                                      size_t pointCount,
                                      int pixelWidth,
                                      int pixelHeight,
                                      VectorscopeMode mode,
                                      int densityDivisor) {
    VectorscopeBands result;
    if (pixelWidth <= 0 || pixelHeight <= 0 || multibandPoints.empty()) {
        return result;
    }

    const size_t count = std::min(
        pointCount,
        multibandPoints.size() / Visualizer::MULTIBAND_POINT_STRIDE);
    const size_t pixelCapacity = static_cast<size_t>(pixelWidth) *
        static_cast<size_t>(pixelHeight);
    const size_t sampleBudget = std::min(
        count,
        std::max<size_t>(64, pixelCapacity /
            static_cast<size_t>(std::max(1, densityDivisor))));
    const size_t stride = sampleBudget > 0
        ? std::max<size_t>(1, (count + sampleBudget - 1) / sampleBudget)
        : 1;
    const size_t firstIndex = count > 0 ? (count - 1) % stride : 0;
    for (auto& band : result) {
        band.reserve(sampleBudget);
    }

    const auto layout = getVectorscopePlotLayout(pixelWidth, pixelHeight, mode);

    for (size_t index = firstIndex; index < count; index += stride) {
        const size_t base = index * Visualizer::MULTIBAND_POINT_STRIDE;
        const float intensity = count > 1
            ? 0.15f + 0.85f * static_cast<float>(index) /
                static_cast<float>(count - 1)
            : 1.0f;
        for (size_t band = 0; band < result.size(); ++band) {
            const float leftValue = multibandPoints[base + band * 2];
            const float rightValue = multibandPoints[base + band * 2 + 1];
            const float left = std::isfinite(leftValue)
                ? std::clamp(leftValue, -1.25f, 1.25f)
                : 0.0f;
            const float right = std::isfinite(rightValue)
                ? std::clamp(rightValue, -1.25f, 1.25f)
                : 0.0f;
            if (std::abs(left) + std::abs(right) < 1e-5f) {
                continue;
            }
            float transformedX = 0.0f;
            float transformedY = 0.0f;
            if (!transformVectorscopePoint(
                    left, right, mode, transformedX, transformedY)) {
                continue;
            }
            const int x = static_cast<int>(std::lround(
                static_cast<float>(layout.centerX) +
                transformedX * static_cast<float>(layout.radius)));
            const int y = static_cast<int>(std::lround(
                static_cast<float>(layout.centerY) -
                transformedY * static_cast<float>(layout.radius)));
            result[band].push_back({
                std::clamp(x, 0, pixelWidth - 1),
                std::clamp(y, 0, pixelHeight - 1),
                intensity,
            });
        }
    }
    return result;
}

VectorscopePlotLayout getVectorscopePlotLayout(int pixelWidth,
                                               int pixelHeight,
                                               VectorscopeMode mode) {
    VectorscopePlotLayout layout;
    if (pixelWidth <= 0 || pixelHeight <= 0) {
        return layout;
    }

    layout.centerX = (pixelWidth - 1) / 2;
    layout.unipolar = isUnipolar(mode);
    if (layout.unipolar) {
        const int margin = std::max(1, pixelHeight / 25);
        layout.centerY = pixelHeight - 1 - margin;
        layout.radius = static_cast<int>(std::lround(
            static_cast<float>(std::min(
                pixelWidth / 2,
                std::max(0, layout.centerY))) * 0.88f));
    } else {
        layout.centerY = (pixelHeight - 1) / 2;
        layout.radius = static_cast<int>(std::lround(
            static_cast<float>(std::min(pixelWidth, pixelHeight)) * 0.45f));
    }
    layout.radius = std::max(0, layout.radius);
    return layout;
}

VectorscopeMode nextVectorscopeMode(VectorscopeMode mode) {
    switch (mode) {
        case VectorscopeMode::Lissajous:
            return VectorscopeMode::PolarUnipolar;
        case VectorscopeMode::PolarUnipolar:
            return VectorscopeMode::PolarBipolar;
        case VectorscopeMode::PolarBipolar:
            return VectorscopeMode::LinearUnipolar;
        case VectorscopeMode::LinearUnipolar:
            return VectorscopeMode::LinearBipolar;
        case VectorscopeMode::LinearBipolar:
            return VectorscopeMode::Lissajous;
    }
    return VectorscopeMode::Lissajous;
}

const char* vectorscopeModeName(VectorscopeMode mode) {
    switch (mode) {
        case VectorscopeMode::Lissajous:
            return "Lissajous";
        case VectorscopeMode::PolarUnipolar:
            return "Polar +";
        case VectorscopeMode::PolarBipolar:
            return "Polar ±";
        case VectorscopeMode::LinearUnipolar:
            return "Linear +";
        case VectorscopeMode::LinearBipolar:
            return "Linear ±";
    }
    return "Lissajous";
}

}  // namespace Prism::Tui
