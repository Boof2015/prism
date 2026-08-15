#include "cli.h"
#include "system_audio_capture.h"
#include "tui_runtime.h"

#include <exception>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#ifndef PRISM_VERSION
#define PRISM_VERSION "development"
#endif

namespace {

int run(const std::vector<std::string>& arguments) {
    const auto parsed = Prism::Tui::parseArguments(arguments);
    if (!parsed.ok) {
        std::cerr << "prism-tui: " << parsed.error << "\n\n" << Prism::Tui::usageText();
        return 2;
    }
    if (parsed.options.command == Prism::Tui::Command::Help) {
        std::cout << Prism::Tui::usageText();
        return 0;
    }
    if (parsed.options.command == Prism::Tui::Command::Version) {
        std::cout << "prism-tui " << PRISM_VERSION << '\n';
        return 0;
    }

    auto capture = Prism::Capture::createSystemAudioCapture();
    const auto support = capture->getSupport();
    if (!support.available) {
        std::cerr << "prism-tui: " << support.reason << '\n';
        return 1;
    }

    if (parsed.options.command == Prism::Tui::Command::ListDevices) {
        const auto devices = capture->listOutputDevices();
        if (devices.empty()) {
            std::cerr << "prism-tui: no system output devices found.\n";
            return 1;
        }
        for (const auto& device : devices) {
            std::cout << device.id << '\t' << device.label;
            if (device.isDefault) {
                std::cout << "\t(default)";
            }
            std::cout << '\t' << static_cast<int>(device.sampleRate) << " Hz"
                      << '\t' << device.channelCount << " ch\n";
        }
        return 0;
    }

    if (!Prism::Tui::stdinAndStdoutAreTerminals()) {
        std::cerr << "prism-tui: interactive mode requires a terminal on stdin and stdout.\n";
        return 1;
    }

    const auto outputDevices = capture->listOutputDevices();
    Prism::Capture::StartResult started;
    std::string errorMessage;
    if (!capture->start(parsed.options.deviceId, &started, &errorMessage)) {
        std::cerr << "prism-tui: "
                  << (errorMessage.empty() ? "System audio capture failed to start." : errorMessage)
                  << '\n';
        return 1;
    }

    return Prism::Tui::runInteractive(
        std::move(capture),
        started,
        parsed.options.deviceId,
        outputDevices);
}

}  // namespace

int main(int argc, char** argv) {
    try {
        std::vector<std::string> arguments;
        for (int index = 1; index < argc; ++index) {
            arguments.emplace_back(argv[index]);
        }
        return run(arguments);
    } catch (const std::exception& error) {
        std::cerr << "prism-tui: " << error.what() << '\n';
        return 1;
    } catch (...) {
        std::cerr << "prism-tui: unexpected runtime failure.\n";
        return 1;
    }
}
