#include "frame_pacing.h"

namespace Prism::Tui {

std::chrono::steady_clock::time_point advanceFrameDeadline(
    std::chrono::steady_clock::time_point currentDeadline,
    std::chrono::steady_clock::time_point renderedAt,
    std::chrono::steady_clock::duration frameInterval) {
    if (frameInterval <= std::chrono::steady_clock::duration::zero()) {
        return renderedAt;
    }

    const auto elapsed = renderedAt - currentDeadline;
    const auto intervalsToAdvance = elapsed >= decltype(elapsed)::zero()
        ? elapsed / frameInterval + 1
        : 1;
    return currentDeadline + frameInterval * intervalsToAdvance;
}

}  // namespace Prism::Tui
