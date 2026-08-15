#include "output_selection.h"

#include <utility>

namespace Prism::Tui {

OutputSwitchOutcome switchOutputCapture(
    Prism::Capture::SystemAudioCapture& capture,
    const std::string& currentRequestedDeviceId,
    const Prism::Capture::StartResult& currentStarted,
    const std::string& nextRequestedDeviceId) {
    if (nextRequestedDeviceId == currentRequestedDeviceId) {
        return {
            true,
            true,
            currentStarted,
            currentRequestedDeviceId,
            {},
        };
    }

    capture.stop();

    Prism::Capture::StartResult nextStarted;
    std::string switchError;
    if (capture.start(nextRequestedDeviceId, &nextStarted, &switchError)) {
        return {
            true,
            true,
            std::move(nextStarted),
            nextRequestedDeviceId,
            {},
        };
    }

    Prism::Capture::StartResult restoredStarted;
    std::string restoreError;
    if (capture.start(
            currentRequestedDeviceId, &restoredStarted, &restoreError)) {
        return {
            false,
            true,
            std::move(restoredStarted),
            currentRequestedDeviceId,
            switchError.empty()
                ? "The selected output could not be opened; the previous output was restored."
                : switchError + " The previous output was restored.",
        };
    }

    std::string error = switchError.empty()
        ? "The selected output could not be opened."
        : switchError;
    error += restoreError.empty()
        ? " The previous output could not be restored."
        : " The previous output could not be restored: " + restoreError;
    return {
        false,
        false,
        currentStarted,
        currentRequestedDeviceId,
        std::move(error),
    };
}

}  // namespace Prism::Tui
