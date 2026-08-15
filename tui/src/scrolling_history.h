#pragma once

#include <cstddef>
#include <vector>

namespace Prism::Tui {

struct ScrollingHistoryFrame {
    std::vector<float> values;
    size_t columnCount = 0;
    size_t columnStride = 0;
};

// Fixed-capacity column storage. Audio processing appends into the ring while
// snapshots expose a stable, chronological copy to the renderer.
class ScrollingHistory {
public:
    ScrollingHistory(size_t columnStride, size_t capacityColumns);

    void append(const float* values, size_t columnCount);
    void append(const std::vector<float>& values);
    ScrollingHistoryFrame snapshot() const;
    void reset();

    size_t columnCount() const { return columnCount_; }
    size_t columnStride() const { return columnStride_; }

private:
    size_t columnStride_ = 0;
    size_t capacityColumns_ = 0;
    size_t columnCount_ = 0;
    size_t writeColumn_ = 0;
    std::vector<float> values_;
};

}  // namespace Prism::Tui
