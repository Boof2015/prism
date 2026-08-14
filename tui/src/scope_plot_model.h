#pragma once

#include <array>
#include <cstddef>
#include <vector>

namespace Prism::Tui {

struct PlotPoint {
    int x = 0;
    int y = 0;
    float intensity = 1.0f;
};

enum class VectorscopeMode {
    Lissajous,
    PolarUnipolar,
    PolarBipolar,
    LinearUnipolar,
    LinearBipolar,
};

struct VectorscopePlotLayout {
    int centerX = 0;
    int centerY = 0;
    int radius = 0;
    bool unipolar = false;
};

using VectorscopeBands = std::array<std::vector<PlotPoint>, 3>;

std::vector<PlotPoint> buildOscilloscopePlot(const std::vector<float>& samples,
                                             int pixelWidth,
                                             int pixelHeight);
int oscilloscopeZeroY(int pixelHeight);

VectorscopeBands buildVectorscopePlot(const std::vector<float>& multibandPoints,
                                      size_t pointCount,
                                      int pixelWidth,
                                      int pixelHeight,
                                      VectorscopeMode mode = VectorscopeMode::Lissajous,
                                      int densityDivisor = 6);

VectorscopePlotLayout getVectorscopePlotLayout(int pixelWidth,
                                               int pixelHeight,
                                               VectorscopeMode mode);
VectorscopeMode nextVectorscopeMode(VectorscopeMode mode);
const char* vectorscopeModeName(VectorscopeMode mode);

}  // namespace Prism::Tui
