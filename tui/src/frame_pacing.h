#pragma once

#include <chrono>

namespace Prism::Tui {

// Preserve the cadence anchor while skipping missed slots so late frames never
// create a catch-up backlog.
std::chrono::steady_clock::time_point advanceFrameDeadline(
    std::chrono::steady_clock::time_point currentDeadline,
    std::chrono::steady_clock::time_point renderedAt,
    std::chrono::steady_clock::duration frameInterval);

}  // namespace Prism::Tui
