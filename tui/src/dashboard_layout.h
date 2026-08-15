#pragma once

#include <optional>
#include <string>
#include <utility>
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

enum class NavigationDirection {
    Left,
    Right,
    Up,
    Down,
};

struct RackTile {
    PanelId panel = PanelId::Spectrum;
    int weight = 1;
};

struct RackRow {
    int weight = 1;
    std::vector<RackTile> tiles;
};

struct RackLayout {
    std::vector<RackRow> rows;
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
    size_t rowIndex = 0;
    size_t tileIndex = 0;
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
};

struct DashboardLayout {
    bool terminalTooSmall = true;
    size_t configuredRows = 0;
    size_t visibleRows = 0;
    size_t hiddenRows = 0;
    size_t hiddenPanels = 0;
    LayoutNode root;
    std::vector<PanelRect> panels;
};

constexpr int kMinimumTerminalWidth = 44;
constexpr int kMinimumTerminalHeight = 12;
constexpr size_t kMaximumRackRows = 3;
constexpr int kMaximumRackWeight = 8;

DashboardLayout buildDashboardLayout(int width,
                                     int height,
                                     const RackLayout& rack,
                                     std::optional<PanelId> expandedPanel = std::nullopt);
RackLayout defaultRackLayout();
RackLayout normalizeRackLayout(RackLayout rack);
std::string serializeRackLayout(const RackLayout& rack);
RackLayout parseRackLayout(const std::string& value,
                           const RackLayout& fallback);
bool operator==(const RackTile& left, const RackTile& right);
bool operator==(const RackRow& left, const RackRow& right);
bool operator==(const RackLayout& left, const RackLayout& right);
bool operator!=(const RackLayout& left, const RackLayout& right);
std::optional<std::pair<size_t, size_t>> rackPanelLocation(
    const RackLayout& rack,
    PanelId panel);
std::vector<PanelId> configuredPanelOrder(const RackLayout& rack);
bool moveRackPanelHorizontal(RackLayout& rack, PanelId panel, int direction);
bool moveRackPanelVertical(RackLayout& rack, PanelId panel, int direction);
bool resizeRackPanel(RackLayout& rack, PanelId panel, int direction);
bool resizeRackRow(RackLayout& rack, PanelId panel, int direction);
bool splitRackRow(RackLayout& rack, PanelId panel);
bool removeRackPanel(RackLayout& rack, PanelId panel);
bool addRackPanel(RackLayout& rack, PanelId panel, PanelId afterPanel);
std::vector<PanelId> panelOrder();
PanelId nextPanel(PanelId panel, bool reverse = false);
PanelId nextPanel(PanelId panel,
                  const std::vector<PanelId>& panels,
                  bool reverse = false);
std::vector<PanelId> visiblePanelOrder(const DashboardLayout& layout);
bool layoutContainsPanel(const DashboardLayout& layout, PanelId panel);
std::optional<PanelId> spatialNeighbor(const DashboardLayout& layout,
                                       PanelId panel,
                                       NavigationDirection direction);

}  // namespace Prism::Tui
