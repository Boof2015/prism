#include "dashboard_layout.h"

#include <algorithm>
#include <cstdlib>
#include <numeric>
#include <sstream>
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
            return {30, 4};
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
        output.push_back({*node.panel, 0, 0, x, y, width, height});
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

int rackRowMinimumHeight(const RackRow& row) {
    int result = 1;
    for (const auto& tile : row.tiles) {
        result = std::max(result, panelMinimumSize(tile.panel).height);
    }
    return result;
}

std::vector<RackTile> visibleRackTiles(const RackRow& row, int width) {
    std::vector<RackTile> result;
    int requiredWidth = 0;
    for (const auto& tile : row.tiles) {
        const int tileMinimum = panelMinimumSize(tile.panel).width;
        if (!result.empty() && requiredWidth + tileMinimum > width) {
            break;
        }
        result.push_back(tile);
        requiredWidth += tileMinimum;
    }
    return result;
}

const char* panelConfigName(PanelId panel) {
    switch (panel) {
        case PanelId::Spectrum: return "spectrum";
        case PanelId::Oscilloscope: return "oscilloscope";
        case PanelId::Vectorscope: return "vectorscope";
        case PanelId::VUMeter: return "vu";
        case PanelId::LUFSMeter: return "lufs";
        case PanelId::Spectrogram: return "spectrogram";
        case PanelId::Waveform: return "waveform";
    }
    return "spectrum";
}

std::optional<PanelId> parsePanelConfigName(const std::string& value) {
    if (value == "spectrum") return PanelId::Spectrum;
    if (value == "oscilloscope") return PanelId::Oscilloscope;
    if (value == "vectorscope") return PanelId::Vectorscope;
    if (value == "vu") return PanelId::VUMeter;
    if (value == "lufs") return PanelId::LUFSMeter;
    if (value == "spectrogram") return PanelId::Spectrogram;
    if (value == "waveform") return PanelId::Waveform;
    return std::nullopt;
}

size_t rackPanelCount(const RackLayout& rack) {
    size_t result = 0;
    for (const auto& row : rack.rows) result += row.tiles.size();
    return result;
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
                                     const RackLayout& rawRack,
                                     std::optional<PanelId> expandedPanel) {
    DashboardLayout layout;
    const RackLayout rack = normalizeRackLayout(rawRack);
    layout.configuredRows = rack.rows.size();
    layout.terminalTooSmall = width < kMinimumTerminalWidth || height < kMinimumTerminalHeight;
    if (layout.terminalTooSmall) {
        return layout;
    }

    if (expandedPanel) {
        layout.root = LayoutNode::leaf(*expandedPanel);
        layout.visibleRows = 1;
    } else {
        const int availableHeight = height - 2;
        int requiredHeight = 0;
        std::vector<LayoutNode> visibleRows;
        for (size_t rowIndex = 0; rowIndex < rack.rows.size(); ++rowIndex) {
            const auto& row = rack.rows[rowIndex];
            const int rowMinimum = rackRowMinimumHeight(row);
            if (!visibleRows.empty() &&
                requiredHeight + rowMinimum > availableHeight) {
                break;
            }

            const auto visibleTiles = visibleRackTiles(row, width);
            std::vector<LayoutNode> tileNodes;
            tileNodes.reserve(visibleTiles.size());
            for (const auto& tile : visibleTiles) {
                tileNodes.push_back(LayoutNode::leaf(tile.panel, tile.weight));
            }
            visibleRows.push_back(LayoutNode::split(
                SplitAxis::Columns, std::move(tileNodes), row.weight));
            requiredHeight += rowMinimum;
        }
        layout.visibleRows = visibleRows.size();
        layout.hiddenRows = layout.configuredRows - layout.visibleRows;
        layout.root = LayoutNode::split(SplitAxis::Rows, std::move(visibleRows));
    }

    // The header and footer each consume one terminal row.
    resolveNode(layout.root, 0, 0, width, height - 2, layout.panels);
    for (auto& panel : layout.panels) {
        if (const auto location = rackPanelLocation(rack, panel.panel)) {
            panel.rowIndex = location->first;
            panel.tileIndex = location->second;
        }
    }
    layout.hiddenPanels = expandedPanel
        ? 0
        : rackPanelCount(rack) - layout.panels.size();
    return layout;
}

RackLayout defaultRackLayout() {
    return {{
        {3, {
            {PanelId::Spectrum, 2},
            {PanelId::Oscilloscope, 3},
            {PanelId::Vectorscope, 1},
        }},
        {2, {
            {PanelId::Waveform, 3},
            {PanelId::VUMeter, 1},
            {PanelId::LUFSMeter, 1},
        }},
        {2, {
            {PanelId::Spectrogram, 1},
        }},
    }};
}

RackLayout normalizeRackLayout(RackLayout rack) {
    RackLayout result;
    std::vector<PanelId> seen;
    for (auto& row : rack.rows) {
        if (result.rows.size() >= kMaximumRackRows) break;
        RackRow normalizedRow;
        normalizedRow.weight = std::clamp(
            row.weight, 1, kMaximumRackWeight);
        for (auto& tile : row.tiles) {
            if (std::find(seen.begin(), seen.end(), tile.panel) != seen.end()) {
                continue;
            }
            tile.weight = std::clamp(tile.weight, 1, kMaximumRackWeight);
            normalizedRow.tiles.push_back(tile);
            seen.push_back(tile.panel);
        }
        if (!normalizedRow.tiles.empty()) {
            result.rows.push_back(std::move(normalizedRow));
        }
    }
    return result.rows.empty() ? defaultRackLayout() : result;
}

std::string serializeRackLayout(const RackLayout& rawRack) {
    const RackLayout rack = normalizeRackLayout(rawRack);
    std::ostringstream output;
    for (size_t rowIndex = 0; rowIndex < rack.rows.size(); ++rowIndex) {
        if (rowIndex > 0) output << ';';
        const auto& row = rack.rows[rowIndex];
        output << row.weight << ':';
        for (size_t tileIndex = 0; tileIndex < row.tiles.size(); ++tileIndex) {
            if (tileIndex > 0) output << ',';
            output << panelConfigName(row.tiles[tileIndex].panel)
                   << '*' << row.tiles[tileIndex].weight;
        }
    }
    return output.str();
}

RackLayout parseRackLayout(const std::string& value,
                           const RackLayout& fallback) {
    RackLayout parsed;
    std::stringstream rows(value);
    std::string rowValue;
    try {
        while (std::getline(rows, rowValue, ';')) {
            const size_t separator = rowValue.find(':');
            if (separator == std::string::npos) continue;
            RackRow row;
            row.weight = std::stoi(rowValue.substr(0, separator));
            std::stringstream tiles(rowValue.substr(separator + 1));
            std::string tileValue;
            while (std::getline(tiles, tileValue, ',')) {
                const size_t weightSeparator = tileValue.find('*');
                if (weightSeparator == std::string::npos) continue;
                const auto panel = parsePanelConfigName(
                    tileValue.substr(0, weightSeparator));
                if (!panel) continue;
                row.tiles.push_back({
                    *panel,
                    std::stoi(tileValue.substr(weightSeparator + 1)),
                });
            }
            if (!row.tiles.empty()) parsed.rows.push_back(std::move(row));
        }
    } catch (...) {
        return normalizeRackLayout(fallback);
    }
    return parsed.rows.empty()
        ? normalizeRackLayout(fallback)
        : normalizeRackLayout(std::move(parsed));
}

bool operator==(const RackTile& left, const RackTile& right) {
    return left.panel == right.panel && left.weight == right.weight;
}

bool operator==(const RackRow& left, const RackRow& right) {
    return left.weight == right.weight && left.tiles == right.tiles;
}

bool operator==(const RackLayout& left, const RackLayout& right) {
    return left.rows == right.rows;
}

bool operator!=(const RackLayout& left, const RackLayout& right) {
    return !(left == right);
}

std::optional<std::pair<size_t, size_t>> rackPanelLocation(
    const RackLayout& rack,
    PanelId panel) {
    for (size_t rowIndex = 0; rowIndex < rack.rows.size(); ++rowIndex) {
        const auto& row = rack.rows[rowIndex];
        for (size_t tileIndex = 0; tileIndex < row.tiles.size(); ++tileIndex) {
            if (row.tiles[tileIndex].panel == panel) {
                return std::make_pair(rowIndex, tileIndex);
            }
        }
    }
    return std::nullopt;
}

std::vector<PanelId> configuredPanelOrder(const RackLayout& rack) {
    std::vector<PanelId> result;
    for (const auto& row : rack.rows) {
        for (const auto& tile : row.tiles) result.push_back(tile.panel);
    }
    return result;
}

bool moveRackPanelHorizontal(RackLayout& rack,
                             PanelId panel,
                             int direction) {
    rack = normalizeRackLayout(std::move(rack));
    const RackLayout before = rack;
    const auto location = rackPanelLocation(rack, panel);
    if (!location || direction == 0) return false;
    auto& tiles = rack.rows[location->first].tiles;
    const int destination = static_cast<int>(location->second) +
        (direction > 0 ? 1 : -1);
    if (destination < 0 || destination >= static_cast<int>(tiles.size())) {
        return false;
    }
    std::swap(tiles[location->second], tiles[static_cast<size_t>(destination)]);
    return rack != before;
}

bool moveRackPanelVertical(RackLayout& rack,
                           PanelId panel,
                           int direction) {
    rack = normalizeRackLayout(std::move(rack));
    const RackLayout before = rack;
    const auto location = rackPanelLocation(rack, panel);
    if (!location || direction == 0) return false;
    const int targetRow = static_cast<int>(location->first) +
        (direction > 0 ? 1 : -1);
    if (targetRow < 0 || targetRow >= static_cast<int>(rack.rows.size())) {
        return false;
    }

    RackTile tile = rack.rows[location->first].tiles[location->second];
    rack.rows[location->first].tiles.erase(
        rack.rows[location->first].tiles.begin() +
        static_cast<std::ptrdiff_t>(location->second));
    size_t resolvedTarget = static_cast<size_t>(targetRow);
    if (rack.rows[location->first].tiles.empty()) {
        rack.rows.erase(rack.rows.begin() +
            static_cast<std::ptrdiff_t>(location->first));
        if (location->first < resolvedTarget) --resolvedTarget;
    }
    auto& targetTiles = rack.rows[resolvedTarget].tiles;
    const size_t insertion = std::min(location->second, targetTiles.size());
    targetTiles.insert(
        targetTiles.begin() + static_cast<std::ptrdiff_t>(insertion), tile);
    rack = normalizeRackLayout(std::move(rack));
    return rack != before;
}

bool resizeRackPanel(RackLayout& rack, PanelId panel, int direction) {
    rack = normalizeRackLayout(std::move(rack));
    const RackLayout before = rack;
    const auto location = rackPanelLocation(rack, panel);
    if (!location || direction == 0) return false;
    auto& weight = rack.rows[location->first].tiles[location->second].weight;
    weight = std::clamp(
        weight + (direction > 0 ? 1 : -1), 1, kMaximumRackWeight);
    return rack != before;
}

bool resizeRackRow(RackLayout& rack, PanelId panel, int direction) {
    rack = normalizeRackLayout(std::move(rack));
    const RackLayout before = rack;
    const auto location = rackPanelLocation(rack, panel);
    if (!location || direction == 0) return false;
    auto& weight = rack.rows[location->first].weight;
    weight = std::clamp(
        weight + (direction > 0 ? 1 : -1), 1, kMaximumRackWeight);
    return rack != before;
}

bool splitRackRow(RackLayout& rack, PanelId panel) {
    rack = normalizeRackLayout(std::move(rack));
    const RackLayout before = rack;
    const auto location = rackPanelLocation(rack, panel);
    if (!location || rack.rows.size() >= kMaximumRackRows ||
        rack.rows[location->first].tiles.size() <= 1) {
        return false;
    }
    RackTile tile = rack.rows[location->first].tiles[location->second];
    rack.rows[location->first].tiles.erase(
        rack.rows[location->first].tiles.begin() +
        static_cast<std::ptrdiff_t>(location->second));
    rack.rows.insert(
        rack.rows.begin() + static_cast<std::ptrdiff_t>(location->first + 1),
        RackRow{1, {tile}});
    rack = normalizeRackLayout(std::move(rack));
    return rack != before;
}

bool removeRackPanel(RackLayout& rack, PanelId panel) {
    rack = normalizeRackLayout(std::move(rack));
    const RackLayout before = rack;
    if (configuredPanelOrder(rack).size() <= 1) return false;
    const auto location = rackPanelLocation(rack, panel);
    if (!location) return false;
    auto& tiles = rack.rows[location->first].tiles;
    tiles.erase(tiles.begin() + static_cast<std::ptrdiff_t>(location->second));
    rack = normalizeRackLayout(std::move(rack));
    return rack != before;
}

bool addRackPanel(RackLayout& rack, PanelId panel, PanelId afterPanel) {
    rack = normalizeRackLayout(std::move(rack));
    const RackLayout before = rack;
    if (rackPanelLocation(rack, panel)) return false;
    const auto target = rackPanelLocation(rack, afterPanel);
    if (!target) return false;
    auto& tiles = rack.rows[target->first].tiles;
    tiles.insert(
        tiles.begin() + static_cast<std::ptrdiff_t>(target->second + 1),
        RackTile{panel, 1});
    rack = normalizeRackLayout(std::move(rack));
    return rack != before;
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
    for (const auto& panel : layout.panels) {
        result.push_back(panel.panel);
    }
    return result;
}

bool layoutContainsPanel(const DashboardLayout& layout, PanelId panel) {
    return std::any_of(
        layout.panels.begin(),
        layout.panels.end(),
        [panel](const PanelRect& rect) { return rect.panel == panel; });
}

std::optional<PanelId> spatialNeighbor(const DashboardLayout& layout,
                                       PanelId panel,
                                       NavigationDirection direction) {
    const auto current = std::find_if(
        layout.panels.begin(),
        layout.panels.end(),
        [panel](const PanelRect& rect) { return rect.panel == panel; });
    if (current == layout.panels.end()) return std::nullopt;

    if (direction == NavigationDirection::Left ||
        direction == NavigationDirection::Right) {
        const PanelRect* best = nullptr;
        for (const auto& candidate : layout.panels) {
            if (candidate.rowIndex != current->rowIndex) continue;
            const bool inDirection = direction == NavigationDirection::Left
                ? candidate.tileIndex < current->tileIndex
                : candidate.tileIndex > current->tileIndex;
            if (!inDirection) continue;
            if (best == nullptr ||
                (direction == NavigationDirection::Left
                    ? candidate.tileIndex > best->tileIndex
                    : candidate.tileIndex < best->tileIndex)) {
                best = &candidate;
            }
        }
        return best == nullptr
            ? std::nullopt
            : std::optional<PanelId>{best->panel};
    }

    std::optional<size_t> targetRow;
    for (const auto& candidate : layout.panels) {
        const bool inDirection = direction == NavigationDirection::Up
            ? candidate.rowIndex < current->rowIndex
            : candidate.rowIndex > current->rowIndex;
        if (!inDirection) continue;
        if (!targetRow ||
            (direction == NavigationDirection::Up
                ? candidate.rowIndex > *targetRow
                : candidate.rowIndex < *targetRow)) {
            targetRow = candidate.rowIndex;
        }
    }
    if (!targetRow) return std::nullopt;

    const int currentLeft = current->x;
    const int currentRight = current->x + current->width;
    const int currentCenterTwice = currentLeft + currentRight;
    const PanelRect* best = nullptr;
    int bestOverlap = -1;
    int bestCenterDistance = 0;
    for (const auto& candidate : layout.panels) {
        if (candidate.rowIndex != *targetRow) continue;
        const int candidateLeft = candidate.x;
        const int candidateRight = candidate.x + candidate.width;
        const int overlap = std::max(
            0,
            std::min(currentRight, candidateRight) -
                std::max(currentLeft, candidateLeft));
        const int centerDistance = std::abs(
            currentCenterTwice - (candidateLeft + candidateRight));
        if (best == nullptr || overlap > bestOverlap ||
            (overlap == bestOverlap && centerDistance < bestCenterDistance) ||
            (overlap == bestOverlap && centerDistance == bestCenterDistance &&
                candidate.tileIndex < best->tileIndex)) {
            best = &candidate;
            bestOverlap = overlap;
            bestCenterDistance = centerDistance;
        }
    }
    return best == nullptr
        ? std::nullopt
        : std::optional<PanelId>{best->panel};
}

}  // namespace Prism::Tui
