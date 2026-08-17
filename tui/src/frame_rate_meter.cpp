#include "frame_rate_meter.h"

#include <algorithm>
#include <cmath>

namespace Prism::Tui {

FrameRateMeter::FrameRateMeter(double windowSeconds)
    : windowSeconds_(
        std::isfinite(windowSeconds)
            ? std::clamp(windowSeconds, 0.25, 5.0)
            : 1.0) {}

double FrameRateMeter::record(double timestampSeconds) {
    if (!std::isfinite(timestampSeconds)) return framesPerSecond_;
    if (!timestamps_.empty() && timestampSeconds <= timestamps_.back()) {
        if (timestampSeconds < timestamps_.back()) reset();
        return framesPerSecond_;
    }

    timestamps_.push_back(timestampSeconds);
    const double cutoff = timestampSeconds - windowSeconds_;
    while (timestamps_.size() > 2 && timestamps_[1] <= cutoff) {
        timestamps_.pop_front();
    }
    if (timestamps_.size() < 2) {
        framesPerSecond_ = 0.0;
        return framesPerSecond_;
    }

    const double elapsed = timestamps_.back() - timestamps_.front();
    const double minimumSampleWindow = std::min(0.25, windowSeconds_);
    if (elapsed < minimumSampleWindow) return framesPerSecond_;

    framesPerSecond_ = elapsed > 0.0
        ? static_cast<double>(timestamps_.size() - 1) / elapsed
        : framesPerSecond_;
    return framesPerSecond_;
}

void FrameRateMeter::reset() {
    timestamps_.clear();
    framesPerSecond_ = 0.0;
}

}  // namespace Prism::Tui
