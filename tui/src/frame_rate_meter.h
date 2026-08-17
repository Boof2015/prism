#pragma once

#include <cstddef>
#include <deque>

namespace Prism::Tui {

class FrameRateMeter {
public:
    explicit FrameRateMeter(double windowSeconds = 1.0);

    double record(double timestampSeconds);
    double framesPerSecond() const { return framesPerSecond_; }
    void reset();

private:
    double windowSeconds_ = 1.0;
    double framesPerSecond_ = 0.0;
    std::deque<double> timestamps_;
};

}  // namespace Prism::Tui
