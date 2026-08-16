#pragma once

#include "system_audio_capture.h"

#include <memory>
#include <string>
#include <vector>

namespace Prism::Tui {

bool stdinAndStdoutAreTerminals();
int runInteractive(std::unique_ptr<Prism::Capture::SystemAudioCapture> capture,
                   const Prism::Capture::StartResult& started,
                   std::string requestedDeviceId,
                   std::vector<Prism::Capture::OutputDevice> outputDevices,
                   std::string startupProfileSelector = {},
                   std::string startupThemeSelector = {});

}  // namespace Prism::Tui
