#pragma once

#include <optional>
#include <string>
#include <vector>

namespace Prism::Tui {

enum class PanelId {
    Spectrum,
    Oscilloscope,
    Vectorscope,
    VUMeter,
    LUFSMeter,
    Spectrogram,
    Waveform,
};

enum class SplitAxis {
    Rows,
    Columns,
};

enum class LayoutPreset {
    Automatic,
    Stacked,
    Columns,
};

struct LayoutNode {
    std::optional<PanelId> panel;
    SplitAxis axis = SplitAxis::Rows;
    int weight = 1;
    std::vector<LayoutNode> children;

    static LayoutNode leaf(PanelId panel, int weight = 1);
    static LayoutNode split(SplitAxis axis,
                            std::vector<LayoutNode> children,
                            int weight = 1);
    bool isLeaf() const { return panel.has_value(); }
};

struct PanelRect {
    PanelId panel = PanelId::Spectrum;
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
};

struct DashboardLayout {
    bool terminalTooSmall = true;
    LayoutPreset requestedPreset = LayoutPreset::Automatic;
    LayoutPreset resolvedPreset = LayoutPreset::Stacked;
    LayoutNode root;
    std::vector<PanelRect> panels;
};

constexpr int kMinimumTerminalWidth = 44;
constexpr int kMinimumTerminalHeight = 12;

DashboardLayout buildDashboardLayout(int width,
                                     int height,
                                     LayoutPreset requestedPreset,
                                     std::optional<PanelId> expandedPanel = std::nullopt);
LayoutPreset nextLayoutPreset(LayoutPreset preset);
std::string layoutPresetName(LayoutPreset preset);
std::vector<PanelId> panelOrder();
PanelId nextPanel(PanelId panel, bool reverse = false);
PanelId nextPanel(PanelId panel,
                  const std::vector<PanelId>& panels,
                  bool reverse = false);
std::vector<PanelId> visiblePanelOrder(const DashboardLayout& layout);
bool layoutContainsPanel(const DashboardLayout& layout, PanelId panel);

}  // namespace Prism::Tui
