#pragma once

#include <string>
#include <vector>

namespace Prism::Tui {

enum class Command {
    Run,
    ListDevices,
    Help,
    Version,
};

struct Options {
    Command command = Command::Run;
    std::string deviceId;
    std::string profileSelector;
    std::string themeSelector;
};

struct ParseResult {
    bool ok = false;
    Options options;
    std::string error;
};

ParseResult parseArguments(const std::vector<std::string>& arguments);
std::string usageText();

}  // namespace Prism::Tui
