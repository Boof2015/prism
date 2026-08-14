#pragma once

#include "system_audio_capture.h"

#include <memory>

namespace Prism::Tui {

bool stdinAndStdoutAreTerminals();
int runInteractive(std::unique_ptr<Prism::Capture::SystemAudioCapture> capture,
                   const Prism::Capture::StartResult& started);

}  // namespace Prism::Tui
