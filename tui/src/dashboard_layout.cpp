#include "dashboard_layout.h"

#include <algorithm>
#include <numeric>
#include <utility>

namespace Prism::Tui {
namespace {

struct MinimumSize {
    int width = 1;
    int height = 1;
};

MinimumSize panelMinimumSize(PanelId panel) {
    switch (panel) {
        case PanelId::Spectrum:
            return {30, 5};
        case PanelId::Oscilloscope:
            return {30, 5};
        case PanelId::Vectorscope:
            return {30, 8};
        case PanelId::VUMeter:
            return {30, 5};
        case PanelId::LUFSMeter:
            return {30, 7};
        case PanelId::Spectrogram:
            return {30, 8};
        case PanelId::Waveform:
            return {30, 7};
    }
    return {1, 1};
}

MinimumSize nodeMinimumSize(const LayoutNode& node) {
    if (node.isLeaf()) {
        return panelMinimumSize(*node.panel);
    }

    MinimumSize result;
    result.width = node.axis == SplitAxis::Columns ? 0 : 1;
    result.height = node.axis == SplitAxis::Rows ? 0 : 1;
    for (const auto& child : node.children) {
        const auto childMinimum = nodeMinimumSize(child);
        if (node.axis == SplitAxis::Columns) {
            result.width += childMinimum.width;
            result.height = std::max(result.height, childMinimum.height);
        } else {
            result.width = std::max(result.width, childMinimum.width);
            result.height += childMinimum.height;
        }
    }
    return result;
}

std::vector<int> partitionExtent(int total,
                                 const std::vector<int>& weights,
                                 const std::vector<int>& minimums) {
    if (weights.empty()) {
        return {};
    }

    std::vector<int> result(weights.size(), 0);
    const int minimumTotal = std::accumulate(minimums.begin(), minimums.end(), 0);
    if (minimumTotal <= total) {
        int remaining = total;
        int remainingWeight = std::accumulate(weights.begin(), weights.end(), 0);
        for (size_t index = 0; index < result.size(); ++index) {
            const int weight = std::max(1, weights[index]);
            result[index] = index + 1 == result.size()
                ? remaining
                : remaining * weight / std::max(1, remainingWeight);
            remaining -= result[index];
            remainingWeight -= weight;
        }

        // Preserve the requested ratio whenever possible, then borrow from
        // larger panes to honor each panel's usable minimum size.
        for (size_t index = 0; index < result.size(); ++index) {
            int needed = std::max(0, minimums[index] - result[index]);
            for (size_t donor = 0; donor < result.size() && needed > 0; ++donor) {
                if (donor == index) continue;
                const int available = std::max(0, result[donor] - minimums[donor]);
                const int transfer = std::min(needed, available);
                result[donor] -= transfer;
                result[index] += transfer;
                needed -= transfer;
            }
        }
        return result;
    }

    int remaining = std::max(0, total);
    int remainingWeight = std::accumulate(weights.begin(), weights.end(), 0);
    for (size_t index = 0; index < result.size(); ++index) {
        const int weight = std::max(1, weights[index]);
        result[index] = index + 1 == result.size()
            ? remaining
            : remaining * weight / std::max(1, remainingWeight);
        remaining -= result[index];
        remainingWeight -= weight;
    }
    return result;
}

void resolveNode(const LayoutNode& node,
                 int x,
                 int y,
                 int width,
                 int height,
                 std::vector<PanelRect>& output) {
    if (node.isLeaf()) {
        output.push_back({*node.panel, x, y, width, height});
        return;
    }
    if (node.children.empty()) {
        return;
    }

    std::vector<int> weights;
    std::vector<int> minimums;
    weights.reserve(node.children.size());
    minimums.reserve(node.children.size());
    for (const auto& child : node.children) {
        weights.push_back(std::max(1, child.weight));
        const auto minimum = nodeMinimumSize(child);
        minimums.push_back(node.axis == SplitAxis::Columns
            ? minimum.width
            : minimum.height);
    }

    const int extent = node.axis == SplitAxis::Columns ? width : height;
    const auto spans = partitionExtent(extent, weights, minimums);
    int offset = 0;
    for (size_t index = 0; index < node.children.size(); ++index) {
        if (node.axis == SplitAxis::Columns) {
            resolveNode(node.children[index], x + offset, y, spans[index], height, output);
        } else {
            resolveNode(node.children[index], x, y + offset, width, spans[index], output);
        }
        offset += spans[index];
    }
}

LayoutPreset resolvePreset(LayoutPreset requested, int width, int height) {
    constexpr int minimumColumnsWidth = 72;
    constexpr int minimumColumnsHeight = 18;
    if (requested == LayoutPreset::Columns &&
        (width < minimumColumnsWidth || height < minimumColumnsHeight)) {
        return LayoutPreset::Stacked;
    }
    if (requested != LayoutPreset::Automatic) {
        return requested;
    }
    return width >= minimumColumnsWidth && height >= minimumColumnsHeight
        ? LayoutPreset::Columns
        : LayoutPreset::Stacked;
}

LayoutNode makeRoot(LayoutPreset preset, int width, int height) {
    if (preset == LayoutPreset::Columns) {
        if (width >= 108 && height >= 34) {
            return LayoutNode::split(SplitAxis::Columns, {
                LayoutNode::split(SplitAxis::Rows, {
                    LayoutNode::leaf(PanelId::Spectrum, 3),
                    LayoutNode::leaf(PanelId::Oscilloscope, 2),
                    LayoutNode::leaf(PanelId::Waveform, 2),
                }, 3),
                LayoutNode::split(SplitAxis::Rows, {
                    LayoutNode::leaf(PanelId::Vectorscope, 2),
                    LayoutNode::leaf(PanelId::VUMeter, 1),
                    LayoutNode::leaf(PanelId::LUFSMeter, 1),
                    LayoutNode::leaf(PanelId::Spectrogram, 2),
                }, 1),
            });
        }
        return LayoutNode::split(SplitAxis::Columns, {
            LayoutNode::split(SplitAxis::Rows, {
                LayoutNode::leaf(PanelId::Spectrum, 3),
                LayoutNode::leaf(PanelId::Oscilloscope, 2),
            }, 3),
            LayoutNode::split(SplitAxis::Rows, {
                LayoutNode::leaf(PanelId::Vectorscope, 2),
                LayoutNode::leaf(PanelId::VUMeter, 1),
                LayoutNode::leaf(PanelId::LUFSMeter, 1),
            }, 1),
        });
    }
    if (width >= 60 && height >= 14) {
        return LayoutNode::split(SplitAxis::Rows, {
            LayoutNode::leaf(PanelId::Spectrum, 3),
            LayoutNode::split(SplitAxis::Columns, {
                LayoutNode::leaf(PanelId::VUMeter),
                LayoutNode::leaf(PanelId::LUFSMeter),
            }, 2),
        });
    }
    return LayoutNode::split(SplitAxis::Rows, {
        LayoutNode::leaf(PanelId::Spectrum, 4),
        LayoutNode::leaf(PanelId::VUMeter, 1),
    });
}

}  // namespace

LayoutNode LayoutNode::leaf(PanelId panel, int weight) {
    LayoutNode node;
    node.panel = panel;
    node.weight = weight;
    return node;
}

LayoutNode LayoutNode::split(SplitAxis axis,
                             std::vector<LayoutNode> children,
                             int weight) {
    LayoutNode node;
    node.axis = axis;
    node.weight = weight;
    node.children = std::move(children);
    return node;
}

DashboardLayout buildDashboardLayout(int width,
                                     int height,
                                     LayoutPreset requestedPreset,
                                     std::optional<PanelId> expandedPanel) {
    DashboardLayout layout;
    layout.requestedPreset = requestedPreset;
    layout.terminalTooSmall = width < kMinimumTerminalWidth || height < kMinimumTerminalHeight;
    if (layout.terminalTooSmall) {
        return layout;
    }

    layout.resolvedPreset = resolvePreset(requestedPreset, width, height);
    layout.root = expandedPanel
        ? LayoutNode::leaf(*expandedPanel)
        : makeRoot(layout.resolvedPreset, width, height);

    // The header and footer each consume one terminal row.
    resolveNode(layout.root, 0, 0, width, height - 2, layout.panels);
    return layout;
}

LayoutPreset nextLayoutPreset(LayoutPreset preset) {
    switch (preset) {
        case LayoutPreset::Automatic:
            return LayoutPreset::Stacked;
        case LayoutPreset::Stacked:
            return LayoutPreset::Columns;
        case LayoutPreset::Columns:
            return LayoutPreset::Automatic;
    }
    return LayoutPreset::Automatic;
}

std::string layoutPresetName(LayoutPreset preset) {
    switch (preset) {
        case LayoutPreset::Automatic:
            return "auto";
        case LayoutPreset::Stacked:
            return "stacked";
        case LayoutPreset::Columns:
            return "columns";
    }
    return "auto";
}

std::vector<PanelId> panelOrder() {
    return {
        PanelId::Spectrum,
        PanelId::Oscilloscope,
        PanelId::Vectorscope,
        PanelId::VUMeter,
        PanelId::LUFSMeter,
        PanelId::Spectrogram,
        PanelId::Waveform,
    };
}

PanelId nextPanel(PanelId panel, bool reverse) {
    return nextPanel(panel, panelOrder(), reverse);
}

PanelId nextPanel(PanelId panel,
                  const std::vector<PanelId>& panels,
                  bool reverse) {
    if (panels.empty()) {
        return panel;
    }
    const auto found = std::find(panels.begin(), panels.end(), panel);
    if (found == panels.end()) {
        return reverse ? panels.back() : panels.front();
    }
    const size_t index = static_cast<size_t>(std::distance(panels.begin(), found));
    if (reverse) {
        return panels[(index + panels.size() - 1) % panels.size()];
    }
    return panels[(index + 1) % panels.size()];
}

std::vector<PanelId> visiblePanelOrder(const DashboardLayout& layout) {
    std::vector<PanelId> result;
    for (const auto panel : panelOrder()) {
        if (layoutContainsPanel(layout, panel)) {
            result.push_back(panel);
        }
    }
    return result;
}

bool layoutContainsPanel(const DashboardLayout& layout, PanelId panel) {
    return std::any_of(
        layout.panels.begin(),
        layout.panels.end(),
        [panel](const PanelRect& rect) { return rect.panel == panel; });
}

}  // namespace Prism::Tui
