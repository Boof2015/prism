#include "scrolling_history.h"

#include <algorithm>
#include <stdexcept>

namespace Prism::Tui {

ScrollingHistory::ScrollingHistory(size_t columnStride, size_t capacityColumns)
    : columnStride_(columnStride),
      capacityColumns_(capacityColumns),
      values_(columnStride * capacityColumns, 0.0f) {
    if (columnStride == 0 || capacityColumns == 0) {
        throw std::invalid_argument("scrolling history dimensions must be non-zero");
    }
}

void ScrollingHistory::append(const float* values, size_t columnCount) {
    if (values == nullptr || columnCount == 0) {
        return;
    }
    if (columnCount >= capacityColumns_) {
        values += (columnCount - capacityColumns_) * columnStride_;
        columnCount = capacityColumns_;
        std::copy(values,
                  values + columnCount * columnStride_,
                  values_.begin());
        columnCount_ = capacityColumns_;
        writeColumn_ = 0;
        return;
    }

    for (size_t column = 0; column < columnCount; ++column) {
        const size_t destination = writeColumn_ * columnStride_;
        const size_t source = column * columnStride_;
        std::copy(values + source,
                  values + source + columnStride_,
                  values_.begin() + static_cast<std::ptrdiff_t>(destination));
        writeColumn_ = (writeColumn_ + 1) % capacityColumns_;
        columnCount_ = std::min(columnCount_ + 1, capacityColumns_);
    }
}

void ScrollingHistory::append(const std::vector<float>& values) {
    append(values.data(), values.size() / columnStride_);
}

ScrollingHistoryFrame ScrollingHistory::snapshot() const {
    ScrollingHistoryFrame frame;
    frame.columnCount = columnCount_;
    frame.columnStride = columnStride_;
    frame.values.resize(columnCount_ * columnStride_);
    if (columnCount_ == 0) {
        return frame;
    }

    const size_t oldest = columnCount_ == capacityColumns_ ? writeColumn_ : 0;
    for (size_t column = 0; column < columnCount_; ++column) {
        const size_t sourceColumn = (oldest + column) % capacityColumns_;
        std::copy(values_.begin() + static_cast<std::ptrdiff_t>(sourceColumn * columnStride_),
                  values_.begin() + static_cast<std::ptrdiff_t>((sourceColumn + 1) * columnStride_),
                  frame.values.begin() + static_cast<std::ptrdiff_t>(column * columnStride_));
    }
    return frame;
}

void ScrollingHistory::reset() {
    columnCount_ = 0;
    writeColumn_ = 0;
}

}  // namespace Prism::Tui
