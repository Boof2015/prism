#include "waterfall_plot_model.h"
#include <algorithm>
#include <cmath>

namespace Prism::Tui {
WaterfallPlotGeometry waterfallPlotGeometry(int dotHeight) {
    const float front = static_cast<float>(std::max(0, dotHeight - 2));
    const float available = std::max(0.0f, front - 2);
    return {front, available * 0.68f, available * 0.32f};
}

WaterfallPlotRequest waterfallPlotRequest(int panelWidth, int panelHeight, bool guides, size_t ridgeLimit) {
    const int contentWidth = std::max(1, panelWidth - 2);
    const int margin = guides && contentWidth >= 40 ? 10 : 0;
    const int dotHeight = std::max(1, panelHeight - 2 - (guides && panelHeight >= 5 ? 1 : 0)) * 4;
    // Leave at least a character row between two-dot-thick ridges. Ask the
    // analyzer for this resolution instead of reselecting rows every paint.
    const size_t ridges = static_cast<size_t>(waterfallPlotGeometry(dotHeight).depth / 6) + 1;
    return {std::clamp(ridges, size_t{2}, std::clamp(ridgeLimit, size_t{2}, size_t{64})),
            static_cast<size_t>(std::clamp(contentWidth * 2 - margin, 2, 512))};
}

std::vector<WaterfallPlotPoint> buildWaterfallPlot(const Visualizer::WaterfallFrame& frame,
    int width, int height, float historySeconds) {
    std::vector<WaterfallPlotPoint> points;
    if (width < 2 || height < 2 || frame.columns < 2 || frame.ages.empty()
        || frame.levels.size() < frame.columns * frame.ages.size()) return points;
    const auto geometry = waterfallPlotGeometry(height);
    std::vector<int> horizon(width, height);
    std::vector<float> softened(frame.columns);
    std::vector<float> levels(width), curve(width);
    // Every historical row is anchored to an audio timestamp by the analyzer.
    // Decimating by ages.size() here used to switch ALL visible slices whenever
    // the newest history row appeared or the oldest one expired.
    for (size_t row = 0; row < frame.ages.size(); ++row) {
        const float age = frame.ages[row];
        const float depth = std::clamp(age / std::max(1.0f, historySeconds), 0.0f, 1.0f);
        // A single light energy-domain filter removes sub-dot jaggedness while
        // retaining narrow peaks (an isolated peak loses at most 2.22 dB).
        const auto power = [&](size_t x) {
            const float db = frame.levels[row * frame.columns + x];
            return std::pow(10.0f, (std::isfinite(db) ? std::clamp(db, -160.0f, 40.0f) : -160.0f) / 10);
        };
        for (size_t x = 0; x < frame.columns; ++x) {
            softened[x] = 10 * std::log10(0.6f * power(x) +
                0.2f * power(x == 0 ? 0 : x - 1) + 0.2f * power(std::min(x + 1, frame.columns - 1)));
        }
        for (int x = 0; x < width; ++x) {
            const float position = static_cast<float>(x) * (frame.columns - 1) / (width - 1);
            const size_t a = static_cast<size_t>(position), b = std::min(a + 1, frame.columns - 1);
            const float db = softened[a] + (position - a) * (softened[b] - softened[a]);
            const float level = std::isfinite(db) ? std::clamp((db + 90) / 80, 0.0f, 1.0f) : 0;
            levels[x] = db;
            curve[x] = std::clamp(geometry.front - depth * geometry.depth - level * geometry.amplitude,
                0.0f, static_cast<float>(height - 1));
        }
        for (int x = 0; x < width; ++x) {
            // Split each slope at the boundary between dot columns, before
            // rounding. Putting the whole join in its right-hand column made
            // diagonals lopsided and added vertical tails beside sharp peaks.
            const float left = (curve[std::max(0, x - 1)] + curve[x]) * 0.5f;
            const float right = (curve[x] + curve[std::min(width - 1, x + 1)]) * 0.5f;
            const int start = static_cast<int>(std::lround(std::min({left, curve[x], right})));
            const int end = std::min(height - 1, static_cast<int>(std::lround(std::max({left, curve[x], right}))) + 1);
            if (start < horizon[x]) {
                for (int py = start; py <= end && py < horizon[x]; ++py) points.push_back({x, py, levels[x], age});
                // Leave one empty dot above a visible foreground ridge. A
                // fully hidden ridge must not expand this clearance further.
                horizon[x] = start - 1;
            }
        }
    }
    return points;
}

std::vector<WaterfallPlotCell> buildWaterfallCells(const std::vector<WaterfallPlotPoint>& points, int width, int height) {
    if (width < 1 || height < 1) return {};
    const int columns = (width + 1) / 2, rows = (height + 3) / 4;
    std::vector<WaterfallPlotCell> cells(static_cast<size_t>(columns * rows));
    for (const auto& point : points) {
        if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) continue;
        auto& cell = cells[(point.y / 4) * columns + point.x / 2];
        if (!cell.dots || point.age < cell.age) {
            cell.db = point.db;
            cell.age = point.age;
        } else if (point.age == cell.age) {
            cell.db = std::max(cell.db, point.db);
        }
        cell.x = point.x / 2;
        cell.y = point.y / 4;
        cell.dots |= static_cast<uint8_t>(1 << ((point.y % 4) * 2 + point.x % 2));
    }
    cells.erase(std::remove_if(cells.begin(), cells.end(), [](const auto& cell) { return !cell.dots; }), cells.end());
    return cells;
}

ThemeColor waterfallRidgeColor(float db, float age, float historySeconds, bool heat, const TuiTheme& theme) {
    const auto mix = [](ThemeColor a, ThemeColor b, float t) {
        return ThemeColor{static_cast<uint8_t>(std::lround(a.red + (b.red - a.red) * t)),
                          static_cast<uint8_t>(std::lround(a.green + (b.green - a.green) * t)),
                          static_cast<uint8_t>(std::lround(a.blue + (b.blue - a.blue) * t))};
    };
    ThemeColor line = theme.waterfallLine;
    if (heat) {
        const float level = std::clamp((db + 100) / 80, 0.0f, 1.0f) * 2;
        const size_t low = level < 1 ? 0 : 1;
        line = mix(theme.waterfallHeat[low], theme.waterfallHeat[low + 1], level - static_cast<float>(low));
    }
    const float depth = std::clamp(age / std::max(1.0f, historySeconds), 0.0f, 1.0f);
    line = mix(theme.waterfallBackground, line, 1 - 0.45f * depth);
    // Braille covers very little of a character. A heat palette designed for
    // filled pixels can otherwise make whole ridges effectively invisible.
    const auto luminance = [](ThemeColor color) {
        const auto linear = [](uint8_t channel) {
            const float s = channel / 255.0f;
            return s <= 0.04045f ? s / 12.92f : std::pow((s + 0.055f) / 1.055f, 2.4f);
        };
        return 0.2126f * linear(color.red) + 0.7152f * linear(color.green) + 0.0722f * linear(color.blue);
    };
    const float background = luminance(theme.waterfallBackground);
    const auto contrast = [&](ThemeColor color) {
        const float value = luminance(color);
        return (std::max(value, background) + 0.05f) / (std::min(value, background) + 0.05f);
    };
    const float minimumContrast = 4.5f - 1.5f * depth;
    if (contrast(line) >= minimumContrast) return line;
    const ThemeColor ink = background < 0.18f ? ThemeColor{255, 255, 255} : ThemeColor{0, 0, 0};
    float low = 0, high = 1;
    for (int i = 0; i < 8; ++i) {
        const float middle = (low + high) * 0.5f;
        if (contrast(mix(line, ink, middle)) < minimumContrast) low = middle;
        else high = middle;
    }
    return mix(line, ink, high);
}

std::string buildWaterfallFrequencyAxis(const Visualizer::WaterfallFrame& frame, size_t width) {
    std::string result(width, ' ');
    if (frame.frequencies.size() < 2 || width < 10) return result;
    const std::pair<float, const char*> guides[] = {{20, "20"}, {100, "100"}, {1000, "1k"}, {10000, "10k"}, {20000, "20k"}};
    size_t lastEnd = 0;
    for (const auto& guide : guides) {
        const auto it = std::lower_bound(frame.frequencies.begin(), frame.frequencies.end(), guide.first);
        if (it == frame.frequencies.end() || guide.first < frame.frequencies.front()) continue;
        const size_t index = it - frame.frequencies.begin();
        const size_t x = index * (width - 1) / (frame.frequencies.size() - 1);
        const std::string label = guide.second;
        const size_t start = std::min(width - label.size(), x > label.size() / 2 ? x - label.size() / 2 : 0);
        if (start < lastEnd) continue;
        result.replace(start, label.size(), label);
        lastEnd = start + label.size() + 2;
    }
    return result;
}
}
