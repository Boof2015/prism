#pragma once
#include "waterfall.h"
#include "tui_theme.h"
#include <string>
#include <vector>

namespace Prism::Tui {
struct WaterfallPlotPoint {
    int x, y;
    float db, age;
};
struct WaterfallPlotRequest {
    size_t ridges = 2;
    size_t columns = 2;
};
struct WaterfallPlotGeometry {
    float front, depth, amplitude;
};
struct WaterfallPlotCell {
    int x, y;
    uint8_t dots = 0; // Row-major 2x4 dots, independent of Unicode encoding.
    float db = -100, age = 0;
};
WaterfallPlotGeometry waterfallPlotGeometry(int dotHeight);
WaterfallPlotRequest waterfallPlotRequest(int panelWidth, int panelHeight, bool guides, size_t ridgeLimit);
std::vector<WaterfallPlotPoint> buildWaterfallPlot(const Visualizer::WaterfallFrame& frame,
    int width, int height, float historySeconds);
std::vector<WaterfallPlotCell> buildWaterfallCells(const std::vector<WaterfallPlotPoint>& points, int width, int height);
ThemeColor waterfallRidgeColor(float db, float age, float historySeconds, bool heat, const TuiTheme& theme);
std::string buildWaterfallFrequencyAxis(const Visualizer::WaterfallFrame& frame, size_t width);
}
