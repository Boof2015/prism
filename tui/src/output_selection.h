#pragma once

#include "system_audio_capture.h"

#include <string>

namespace Prism::Tui {

struct OutputSwitchOutcome {
    bool success = false;
    bool captureRunning = false;
    Prism::Capture::StartResult started;
    std::string requestedDeviceId;
    std::string error;
};

OutputSwitchOutcome switchOutputCapture(
    Prism::Capture::SystemAudioCapture& capture,
    const std::string& currentRequestedDeviceId,
    const Prism::Capture::StartResult& currentStarted,
    const std::string& nextRequestedDeviceId);

}  // namespace Prism::Tui
