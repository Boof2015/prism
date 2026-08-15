#include "cli.h"

namespace Prism::Tui {

ParseResult parseArguments(const std::vector<std::string>& arguments) {
    ParseResult result;
    result.ok = true;

    for (size_t index = 0; index < arguments.size(); ++index) {
        const auto& argument = arguments[index];
        if (argument == "--help" || argument == "-h") {
            if (arguments.size() != 1) {
                return {false, {}, "--help cannot be combined with other arguments."};
            }
            result.options.command = Command::Help;
            continue;
        }
        if (argument == "--version" || argument == "-V") {
            if (arguments.size() != 1) {
                return {false, {}, "--version cannot be combined with other arguments."};
            }
            result.options.command = Command::Version;
            continue;
        }
        if (argument == "--list-devices") {
            if (arguments.size() != 1) {
                return {false, {}, "--list-devices cannot be combined with other arguments."};
            }
            result.options.command = Command::ListDevices;
            continue;
        }
        if (argument == "--device") {
            if (index + 1 >= arguments.size() || arguments[index + 1].empty() ||
                arguments[index + 1][0] == '-') {
                return {false, {}, "--device requires a non-empty device ID."};
            }
            if (!result.options.deviceId.empty()) {
                return {false, {}, "--device may only be specified once."};
            }
            result.options.deviceId = arguments[++index];
            continue;
        }
        return {false, {}, "Unknown argument: " + argument};
    }

    return result;
}

std::string usageText() {
    return
        "Usage: prism-tui [--device <id>]\n"
        "       prism-tui --list-devices\n"
        "       prism-tui --help\n"
        "       prism-tui --version\n\n"
        "Options:\n"
        "  --device <id>     Capture a specific system output device.\n"
        "  --list-devices    List available system output devices.\n"
        "  -h, --help        Show this help.\n"
        "  -V, --version     Show the Prism TUI version.\n\n"
        "Controls:\n"
        "  Tab / Shift-Tab   Focus the next or previous panel.\n"
        "  Enter             Expand the focused panel or restore the dashboard.\n"
        "  s                 Open settings.\n"
        "  l                 Cycle automatic, stacked, and column layouts.\n"
        "  v                 Cycle vectorscope display modes.\n"
        "  1 / 2 / 3 / 4 / 5 Focus Spectrum, Oscilloscope, Vectorscope, VU, or LUFS.\n"
        "  6 / 7             Focus Spectrogram or Waveform.\n"
        "  r                 Reset analyzers and integrated loudness.\n"
        "  q / Esc / Ctrl-C  Quit.\n";
}

}  // namespace Prism::Tui
