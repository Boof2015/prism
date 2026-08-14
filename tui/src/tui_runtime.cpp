#include "tui_runtime.h"

#include "analysis_pipeline.h"
#include "dashboard_layout.h"
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

struct InterfaceState {
    PanelId focusedPanel = PanelId::Spectrum;
    LayoutPreset layoutPreset = LayoutPreset::Automatic;
    std::optional<PanelId> expandedPanel;
};

std::string makeCaptureStatus(const DisplayFrame& frame, bool compact) {
    std::ostringstream sampleRate;
    const double kilohertz = frame.sampleRate / 1000.0;
    sampleRate << std::fixed << std::setprecision(
        std::abs(kilohertz - std::round(kilohertz)) < 0.01 ? 0 : 1) << kilohertz;
    std::string footer = frame.backend + " • ";
    if (!compact) {
        footer += frame.device + " • ";
    }
    footer += sampleRate.str() + " kHz";
    if (frame.captureOverrun) {
        footer += " • capture overrun";
    }
    return footer;
}

std::string panelName(PanelId panel) {
    switch (panel) {
        case PanelId::Spectrum:
            return "Spectrum";
        case PanelId::Levels:
            return "Levels";
    }
    return "Panel";
}

ftxui::Element panelTitle(PanelId panel, bool focused) {
    using namespace ftxui;
    const std::string number = panel == PanelId::Spectrum ? "1" : "2";
    std::string label = " " + number + " " + panelName(panel);
    if (panel == PanelId::Spectrum) {
        label += "  •  FFT " + std::to_string(kDefaultFftSize);
    }
    label += " ";
    auto title = text(label);
    return focused
        ? title | color(Color::CyanLight) | bold
        : title | color(Color::GrayDark);
}

ftxui::Element stylePanel(ftxui::Element content, bool focused) {
    using namespace ftxui;
    return content | color(focused ? Color::GrayLight : Color::GrayDark);
}

ftxui::Element renderSpectrumPanel(const DisplayFrame& frame,
                                   int width,
                                   int height,
                                   bool focused) {
    using namespace ftxui;
    const size_t contentWidth = static_cast<size_t>(std::max(1, width - 2));
    const size_t contentHeight = static_cast<size_t>(std::max(1, height - 2));
    const size_t spectrumRows = contentHeight > 1 ? contentHeight - 1 : 1;

    SpectrumProjectionOptions projectionOptions;
    projectionOptions.sampleRate = static_cast<float>(frame.sampleRate);
    projectionOptions.maxFrequency = std::min(20000.0f, projectionOptions.sampleRate * 0.5f);
    const auto projected = projectSpectrum(
        frame.magnitudes,
        kDefaultFftSize,
        contentWidth,
        projectionOptions);
    const auto rows = buildSpectrumRows(projected, spectrumRows);

    Elements spectrumElements;
    spectrumElements.reserve(rows.size() + 1);
    for (const auto& row : rows) {
        spectrumElements.push_back(text(row) | color(Color::Cyan));
    }
    if (contentHeight > 1) {
        spectrumElements.push_back(
            text(buildFrequencyAxis(contentWidth, projectionOptions.maxFrequency)) |
            color(Color::GrayDark));
    }

    auto panel = window(
        panelTitle(PanelId::Spectrum, focused),
        vbox(std::move(spectrumElements)));
    return stylePanel(std::move(panel), focused) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

ftxui::Element renderLevelsPanel(const DisplayFrame& frame,
                                 int width,
                                 int height,
                                 bool focused) {
    using namespace ftxui;
    const int contentWidth = std::max(1, width - 2);
    const int contentHeight = std::max(1, height - 2);
    const size_t meterWidth = static_cast<size_t>(std::max(4, contentWidth - 14));

    const auto meterRow = [&](const char* label, float level, float peak) {
        return hbox({
            text(std::string(label) + " ") | bold,
            text(buildMeterBar(level, peak, meterWidth)) | color(Color::Cyan),
            text("  " + formatDb(level) + " dB"),
        });
    };

    Elements body;
    body.push_back(meterRow("L", frame.vu.barLDb, frame.vu.peakLDb));
    body.push_back(meterRow("R", frame.vu.barRDb, frame.vu.peakRDb));
    if (contentHeight >= 7) {
        body.push_back(separatorEmpty());
        const auto loudnessRow = [&](const char* label, float value) {
            return hbox({
                text(label) | color(Color::Yellow),
                filler(),
                text(formatLufs(value) + " LUFS") | color(Color::YellowLight),
            });
        };
        body.push_back(loudnessRow("Momentary", frame.lufs.momentaryLUFS));
        body.push_back(loudnessRow("Short term", frame.lufs.shortTermLUFS));
        body.push_back(loudnessRow("Integrated", frame.lufs.integratedLUFS));
    } else {
        const std::string lufs =
            "LUFS  M " + formatLufs(frame.lufs.momentaryLUFS) +
            "  S " + formatLufs(frame.lufs.shortTermLUFS) +
            "  I " + formatLufs(frame.lufs.integratedLUFS);
        body.push_back(text(lufs) | color(Color::Yellow));
    }
    while (static_cast<int>(body.size()) < contentHeight) {
        body.push_back(filler());
    }

    auto panel = window(
        panelTitle(PanelId::Levels, focused),
        vbox(std::move(body)));
    return stylePanel(std::move(panel), focused) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

const PanelRect* findPanelRect(const DashboardLayout& layout, PanelId panel) {
    const auto found = std::find_if(
        layout.panels.begin(), layout.panels.end(),
        [panel](const PanelRect& rect) { return rect.panel == panel; });
    return found == layout.panels.end() ? nullptr : &*found;
}

ftxui::Element renderLayoutNode(const LayoutNode& node,
                                const DashboardLayout& layout,
                                const DisplayFrame& frame,
                                PanelId focusedPanel) {
    using namespace ftxui;
    if (node.isLeaf()) {
        const auto* rect = findPanelRect(layout, *node.panel);
        if (rect == nullptr) {
            return emptyElement();
        }
        const bool focused = *node.panel == focusedPanel;
        switch (*node.panel) {
            case PanelId::Spectrum:
                return renderSpectrumPanel(frame, rect->width, rect->height, focused);
            case PanelId::Levels:
                return renderLevelsPanel(frame, rect->width, rect->height, focused);
        }
    }

    Elements children;
    children.reserve(node.children.size());
    for (const auto& child : node.children) {
        children.push_back(renderLayoutNode(child, layout, frame, focusedPanel));
    }
    return node.axis == SplitAxis::Columns
        ? hbox(std::move(children))
        : vbox(std::move(children));
}

ftxui::Element renderHeader(const DashboardLayout& layout,
                            const InterfaceState& state) {
    using namespace ftxui;
    std::string layoutName = layoutPresetName(state.layoutPreset);
    if (state.layoutPreset == LayoutPreset::Automatic) {
        layoutName += "→" + layoutPresetName(layout.resolvedPreset);
    }
    return hbox({
        text(" PRISM") | color(Color::CyanLight) | bold,
        text(" TUI") | bold,
        filler(),
        state.expandedPanel
            ? text("FOCUS • " + panelName(*state.expandedPanel) + " ") | color(Color::CyanLight)
            : text(layoutName + " ") | dim,
    });
}

ftxui::Element renderFooter(const DisplayFrame& frame,
                            const InterfaceState& state,
                            int width) {
    using namespace ftxui;
    const bool compact = width < 108;
    const bool minimal = width < 64;
    const std::string enterAction = state.expandedPanel ? "restore" : "expand";
    const std::string controls = minimal
        ? "Tab • Enter • l • q"
        : compact
            ? "Tab focus • Enter " + enterAction + " • l layout • q quit"
            : "Tab focus • Enter " + enterAction + " • l layout • r reset • q quit";
    auto status = text(makeCaptureStatus(frame, compact)) | dim;
    if (frame.captureOverrun) {
        status = status | color(Color::RedLight);
    }
    return hbox({
        status,
        filler(),
        text(controls) | dim,
    });
}

ftxui::Element renderFrame(const DisplayFrame& frame,
                           int width,
                           int height,
                           const InterfaceState& state) {
    using namespace ftxui;
    const auto layout = buildDashboardLayout(
        width, height, state.layoutPreset, state.expandedPanel);
    if (layout.terminalTooSmall) {
        return vbox({
            filler(),
            text("PRISM TUI") | bold | color(Color::CyanLight) | center,
            text("Terminal too small — need at least 44 × 12") | center,
            text("q quit") | dim | center,
            filler(),
        });
    }

    return vbox({
        renderHeader(layout, state) | size(HEIGHT, EQUAL, 1),
        renderLayoutNode(layout.root, layout, frame, state.focusedPanel),
        renderFooter(frame, state, width) | size(HEIGHT, EQUAL, 1),
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
    InterfaceState interfaceState;
    DisplayFrame initial;
    initial.magnitudes.assign(kDefaultFftSize / 2, -100.0f);
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
            AnalysisPipeline pipeline(static_cast<float>(started.sampleRate));

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
        return renderFrame(
            frameStore.read(), screen.dimx(), screen.dimy(), interfaceState);
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
        if (event == Event::Tab || event == Event::TabReverse) {
            interfaceState.focusedPanel = nextPanel(
                interfaceState.focusedPanel,
                event == Event::TabReverse);
            if (interfaceState.expandedPanel) {
                interfaceState.expandedPanel = interfaceState.focusedPanel;
            }
            return true;
        }
        if (event == Event::Return) {
            if (interfaceState.expandedPanel) {
                interfaceState.expandedPanel.reset();
            } else {
                interfaceState.expandedPanel = interfaceState.focusedPanel;
            }
            return true;
        }
        if (event == Event::Character('l')) {
            interfaceState.layoutPreset = nextLayoutPreset(interfaceState.layoutPreset);
            interfaceState.expandedPanel.reset();
            return true;
        }
        if (event == Event::Character('1') || event == Event::Character('2')) {
            interfaceState.focusedPanel = event == Event::Character('1')
                ? PanelId::Spectrum
                : PanelId::Levels;
            if (interfaceState.expandedPanel) {
                interfaceState.expandedPanel = interfaceState.focusedPanel;
            }
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
