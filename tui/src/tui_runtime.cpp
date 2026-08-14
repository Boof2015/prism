#include "tui_runtime.h"

#include "analysis_pipeline.h"
#include "display_model.h"
#include "snapshot_store.h"

#include <ftxui/component/component.hpp>
#include <ftxui/component/event.hpp>
#include <ftxui/component/screen_interactive.hpp>
#include <ftxui/dom/elements.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <exception>
#include <iomanip>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#if defined(_WIN32)
#include <io.h>
#else
#include <unistd.h>
#endif

namespace Prism::Tui {
namespace {

constexpr size_t kFftSize = 2048;
constexpr auto kCapturePollInterval = std::chrono::milliseconds(2);
constexpr auto kDisplayFrameInterval = std::chrono::milliseconds(33);

volatile std::sig_atomic_t signalRequested = 0;

void handleSignal(int) {
    signalRequested = 1;
}

class SignalHandlerGuard {
public:
    SignalHandlerGuard()
        : previousSigInt_(std::signal(SIGINT, handleSignal)),
          previousSigTerm_(std::signal(SIGTERM, handleSignal)) {}

    ~SignalHandlerGuard() {
        if (previousSigInt_ != SIG_ERR) std::signal(SIGINT, previousSigInt_);
        if (previousSigTerm_ != SIG_ERR) std::signal(SIGTERM, previousSigTerm_);
    }

private:
    using Handler = void (*)(int);
    Handler previousSigInt_;
    Handler previousSigTerm_;
};

struct DisplayFrame {
    std::vector<float> magnitudes;
    Visualizer::VUMeterSnapshot vu{};
    Visualizer::LUFSMeterSnapshot lufs{};
    double sampleRate = 48000.0;
    std::string backend;
    std::string device;
    bool captureOverrun = false;
};

std::string makeFooter(const DisplayFrame& frame) {
    std::ostringstream sampleRate;
    const double kilohertz = frame.sampleRate / 1000.0;
    sampleRate << std::fixed << std::setprecision(
        std::abs(kilohertz - std::round(kilohertz)) < 0.01 ? 0 : 1) << kilohertz;
    std::string footer = frame.backend + " • " + frame.device + " • " +
        sampleRate.str() + " kHz";
    if (frame.captureOverrun) {
        footer += " • capture overrun";
    }
    footer += "                r reset • q/Esc/Ctrl-C quit";
    return footer;
}

ftxui::Element renderFrame(const DisplayFrame& frame, int width, int height) {
    using namespace ftxui;
    const auto layout = calculateLayout(width, height);
    if (layout.terminalTooSmall) {
        return vbox({
            filler(),
            text("Prism TUI") | bold | center,
            text("Terminal too small — need at least 44 × 12") | center,
            text("q quit") | dim | center,
            filler(),
        });
    }

    SpectrumProjectionOptions projectionOptions;
    projectionOptions.sampleRate = static_cast<float>(frame.sampleRate);
    projectionOptions.maxFrequency = std::min(20000.0f, projectionOptions.sampleRate * 0.5f);
    const auto projected = projectSpectrum(
        frame.magnitudes,
        kFftSize,
        layout.contentWidth,
        projectionOptions);
    const auto spectrumRows = buildSpectrumRows(projected, layout.spectrumRowCount);

    Elements spectrumElements;
    spectrumElements.reserve(spectrumRows.size() + 1);
    for (const auto& row : spectrumRows) {
        spectrumElements.push_back(text(row) | color(Color::Cyan));
    }
    spectrumElements.push_back(
        text(buildFrequencyAxis(layout.contentWidth, projectionOptions.maxFrequency)) | dim);

    const auto meterRow = [&](const char* label, float level, float peak) {
        return hbox({
            text(std::string(label) + " ") | bold,
            text(buildMeterBar(level, peak, layout.meterWidth)) | color(Color::Cyan),
            text("  " + formatDb(level) + " dB"),
        });
    };

    const std::string lufs =
        "LUFS   M " + formatLufs(frame.lufs.momentaryLUFS) +
        "   S " + formatLufs(frame.lufs.shortTermLUFS) +
        "   I " + formatLufs(frame.lufs.integratedLUFS);

    return vbox({
        text("PRISM TUI") | bold | center,
        window(text(" Spectrum ") | bold, vbox(std::move(spectrumElements))) | flex,
        meterRow("L", frame.vu.barLDb, frame.vu.peakLDb),
        meterRow("R", frame.vu.barRDb, frame.vu.peakRDb),
        text(lufs) | color(Color::Yellow),
        separator(),
        text(makeFooter(frame)) | dim,
    });
}

}  // namespace

bool stdinAndStdoutAreTerminals() {
#if defined(_WIN32)
    return _isatty(_fileno(stdin)) != 0 && _isatty(_fileno(stdout)) != 0;
#else
    return isatty(fileno(stdin)) != 0 && isatty(fileno(stdout)) != 0;
#endif
}

int runInteractive(std::unique_ptr<Prism::Capture::SystemAudioCapture> capture,
                   const Prism::Capture::StartResult& started) {
    using namespace ftxui;
    signalRequested = 0;
    SignalHandlerGuard signalHandlerGuard;

    ScreenInteractive screen = ScreenInteractive::Fullscreen();
    SnapshotStore<DisplayFrame> frameStore;
    DisplayFrame initial;
    initial.magnitudes.assign(kFftSize / 2, -100.0f);
    initial.sampleRate = started.sampleRate;
    initial.backend = capture->backendName();
    initial.device = started.deviceLabel.empty() ? started.deviceId : started.deviceLabel;
    frameStore.publish(initial);

    std::atomic<bool> running{true};
    std::atomic<bool> resetRequested{false};
    std::exception_ptr workerError;
    auto exitLoop = screen.ExitLoopClosure();

    std::thread worker([&]() {
        try {
            AnalysisPipeline pipeline(static_cast<float>(started.sampleRate), kFftSize);

            bool captureOverrun = false;
            auto nextFrameAt = std::chrono::steady_clock::now();
            while (running.load()) {
                if (signalRequested != 0) {
                    running.store(false);
                    exitLoop();
                    break;
                }
                if (resetRequested.exchange(false)) {
                    pipeline.reset();
                    captureOverrun = false;
                }

                drainCapture(*capture, pipeline, captureOverrun);

                const auto now = std::chrono::steady_clock::now();
                if (now >= nextFrameAt) {
                    DisplayFrame next;
                    auto analyzed = pipeline.snapshot();
                    next.magnitudes = std::move(analyzed.magnitudes);
                    next.vu = analyzed.vu;
                    next.lufs = analyzed.lufs;
                    next.sampleRate = started.sampleRate;
                    next.backend = capture->backendName();
                    next.device = started.deviceLabel.empty() ? started.deviceId : started.deviceLabel;
                    next.captureOverrun = captureOverrun;
                    frameStore.publish(std::move(next));
                    screen.PostEvent(Event::Custom);
                    nextFrameAt = now + kDisplayFrameInterval;
                }
                std::this_thread::sleep_for(kCapturePollInterval);
            }
        } catch (...) {
            workerError = std::current_exception();
            if (running.exchange(false)) {
                exitLoop();
            }
        }
    });

    auto renderer = Renderer([&]() {
        return renderFrame(frameStore.read(), screen.dimx(), screen.dimy());
    });
    auto component = CatchEvent(renderer, [&](Event event) {
        if (event == Event::Character('q') || event == Event::Escape || event == Event::CtrlC) {
            running.store(false);
            exitLoop();
            return true;
        }
        if (event == Event::Character('r')) {
            resetRequested.store(true);
            return true;
        }
        return false;
    });

    std::exception_ptr screenError;
    try {
        screen.Loop(component);
    } catch (...) {
        screenError = std::current_exception();
    }
    running.store(false);
    if (worker.joinable()) {
        worker.join();
    }
    capture->stop();

    if (workerError) {
        std::rethrow_exception(workerError);
    }
    if (screenError) {
        std::rethrow_exception(screenError);
    }
    return 0;
}

}  // namespace Prism::Tui
