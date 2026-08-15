#include "tui_runtime.h"

#include "analysis_pipeline.h"
#include "dashboard_layout.h"
#include "display_model.h"
#include "meter_display_model.h"
#include "output_selection.h"
#include "profile_library.h"
#include "scope_plot_model.h"
#include "snapshot_store.h"
#include "tui_settings.h"
#include "tui_theme.h"

#include <ftxui/component/component.hpp>
#include <ftxui/component/event.hpp>
#include <ftxui/component/screen_interactive.hpp>
#include <ftxui/dom/canvas.hpp>
#include <ftxui/dom/elements.hpp>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <csignal>
#include <cstdio>
#include <exception>
#include <iomanip>
#include <optional>
#include <sstream>
#include <stdexcept>
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

std::chrono::microseconds displayFrameInterval(int framesPerSecond) {
    return std::chrono::microseconds(
        1000000 / std::max(1, framesPerSecond));
}

const char* spectrogramClarityConfig(SpectrogramClarity clarity) {
    switch (clarity) {
        case SpectrogramClarity::Classic: return "classic";
        case SpectrogramClarity::Sharp: return "sharp";
        case SpectrogramClarity::Sharper: return "sharper";
    }
    return "sharper";
}

const char* spectrogramScaleConfig(SpectrogramScale scale) {
    switch (scale) {
        case SpectrogramScale::Mel: return "mel";
        case SpectrogramScale::Logarithmic: return "log";
        case SpectrogramScale::Linear: return "linear";
    }
    return "log";
}

const char* spectrogramOrientationConfig(SpectrogramOrientation orientation) {
    return orientation == SpectrogramOrientation::Vertical
        ? "vertical"
        : "horizontal";
}

void applySpectrogramSettings(AnalysisPipeline& pipeline,
                              const TuiSettings& settings) {
    pipeline.setSpectrogramSettings(
        settings.spectrogramScrollSpeed,
        settings.spectrogramContrast,
        settings.spectrogramTiltDbPerOctave,
        spectrogramClarityConfig(settings.spectrogramClarity),
        spectrogramScaleConfig(settings.spectrogramScale),
        spectrogramOrientationConfig(settings.spectrogramOrientation));
}

void applyWaveformSettings(AnalysisPipeline& pipeline,
                           const TuiSettings& settings) {
    pipeline.setWaveformSettings(
        settings.waveformMode == WaveformMode::Stereo,
        settings.waveformScrollSpeed);
}

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
    std::optional<SpectrumPeakInfo> spectrumPeak;
    Visualizer::VUMeterSnapshot vu{};
    Visualizer::LUFSMeterSnapshot lufs{};
    OscilloscopeFrame oscilloscope;
    VectorscopeFrame vectorscope;
    SpectrogramFrame spectrogram;
    WaveformFrame waveform;
    double sampleRate = 48000.0;
    std::string backend;
    std::string device;
    bool captureOverrun = false;
};

struct OutputSwitchRequest {
    uint64_t serial = 0;
    std::string requestedDeviceId;
};

struct OutputSwitchNotice {
    uint64_t serial = 0;
    bool complete = false;
    bool success = false;
    std::string activeRequestedDeviceId;
    Prism::Capture::StartResult started;
    std::string error;
};

struct OutputListNotice {
    uint64_t serial = 0;
    std::vector<Prism::Capture::OutputDevice> devices;
};

enum class LayoutOverlay {
    None,
    AddScope,
    Help,
};

enum class ProfileOverlayMode {
    Browse,
    SaveAs,
    Rename,
    ConfirmOverwrite,
    ConfirmDelete,
    ConfirmLoad,
};

struct InterfaceState {
    PanelId focusedPanel = PanelId::Spectrum;
    std::optional<PanelId> expandedPanel;
    TuiSettings settings;
    TuiTheme theme = defaultTuiTheme();
    bool layoutEditing = false;
    LayoutOverlay layoutOverlay = LayoutOverlay::None;
    size_t layoutAddSelection = 0;
    std::string layoutStatus;
    bool settingsOpen = false;
    SettingsPage settingsPage = SettingsPage::Home;
    size_t settingsHomeSelection = 0;
    std::array<size_t, 10> settingsSelections{};
    std::string settingsStatus;
    bool profilesOpen = false;
    ProfileOverlayMode profileMode = ProfileOverlayMode::Browse;
    std::vector<TuiProfile> profiles;
    std::string activeProfileId;
    bool profileDirty = false;
    size_t profileSelection = 0;
    std::string profileInput;
    std::string profileStatus;
    bool profileStatusError = false;
    std::string pendingProfileId;
    bool outputsOpen = false;
    std::vector<Prism::Capture::OutputDevice> outputDevices;
    size_t outputSelection = 0;
    std::string activeRequestedDeviceId;
    std::string outputStatus;
    bool outputStatusError = false;
    bool outputSwitching = false;
    uint64_t outputSwitchSerial = 0;
    uint64_t appliedOutputSwitchSerial = 0;
    uint64_t outputListSerial = 0;
    uint64_t appliedOutputListSerial = 0;
};

const TuiTheme* renderTheme = nullptr;

const TuiTheme& palette() {
    static const TuiTheme fallback = defaultTuiTheme();
    return renderTheme == nullptr ? fallback : *renderTheme;
}

ftxui::Color terminalColor(const ThemeColor& color) {
    return ftxui::Color::RGB(color.red, color.green, color.blue);
}

void fillCanvasBackground(ftxui::Canvas& surface,
                          const ftxui::Color& background) {
    // Canvas nodes replace their parent cells after FTXUI's bgcolor decorator
    // has run. Seed every terminal cell in the canvas so scope backgrounds are
    // retained instead of exposing the terminal's own background.
    for (int y = 0; y < surface.height(); y += 4) {
        for (int x = 0; x < surface.width(); x += 2) {
            surface.Style(x, y, [background](ftxui::Cell& cell) {
                cell.background_color = background;
            });
        }
    }
}

ThemeColor scaleColor(const ThemeColor& color, float brightness) {
    const auto channel = [brightness](uint8_t value) {
        return static_cast<uint8_t>(std::lround(std::clamp(
            static_cast<float>(value) * brightness, 0.0f, 255.0f)));
    };
    return {channel(color.red), channel(color.green), channel(color.blue)};
}

const TuiProfile* activeProfile(const InterfaceState& state) {
    const auto found = std::find_if(
        state.profiles.begin(), state.profiles.end(), [&](const auto& profile) {
            return profile.id == state.activeProfileId;
        });
    return found == state.profiles.end() ? nullptr : &*found;
}

bool calculateUnsavedProfileChanges(const InterfaceState& state) {
    if (const auto* active = activeProfile(state)) {
        return !profileSettingsEqual(state.settings, active->settings);
    }
    return !profileSettingsEqual(state.settings, TuiSettings{});
}

bool hasUnsavedProfileChanges(const InterfaceState& state) {
    return state.profileDirty;
}

size_t settingsPageIndex(SettingsPage page) {
    return static_cast<size_t>(page);
}

size_t& settingsSelection(InterfaceState& state) {
    return state.settingsSelections[settingsPageIndex(state.settingsPage)];
}

const size_t& settingsSelection(const InterfaceState& state) {
    return state.settingsSelections[settingsPageIndex(state.settingsPage)];
}

std::string makeCaptureStatus(const DisplayFrame& frame,
                              const TuiSettings& settings,
                              bool compact) {
    std::ostringstream sampleRate;
    const double kilohertz = frame.sampleRate / 1000.0;
    sampleRate << std::fixed << std::setprecision(
        std::abs(kilohertz - std::round(kilohertz)) < 0.01 ? 0 : 1) << kilohertz;
    std::string footer = frame.backend + " • ";
    if (!compact) {
        footer += frame.device + " • ";
    }
    footer += sampleRate.str() + " kHz";
    if (settings.inputTrimDb != 0.0f) {
        std::ostringstream trim;
        trim << " • trim " << (settings.inputTrimDb > 0.0f ? "+" : "")
             << std::fixed << std::setprecision(1) << settings.inputTrimDb << " dB";
        footer += trim.str();
    }
    if (frame.captureOverrun) {
        footer += " • capture overrun";
    }
    return footer;
}

std::string formatSpectrumPeak(const SpectrumPeakInfo& peak, int width) {
    std::ostringstream frequency;
    frequency << std::fixed << std::setprecision(
        peak.frequencyHz < 1000.0f ? 1 : 0) << peak.frequencyHz << " Hz";
    if (width < 42) {
        return frequency.str();
    }
    std::ostringstream db;
    db << std::fixed << std::setprecision(1) << peak.dbfs << " dBFS";
    if (width < 58) {
        return db.str() + " • " + frequency.str();
    }
    return db.str() + " • " + frequency.str() + " • " + peak.pitch;
}

std::string panelName(PanelId panel) {
    switch (panel) {
        case PanelId::Spectrum:
            return "Spectrum";
        case PanelId::Oscilloscope:
            return "Oscilloscope";
        case PanelId::Vectorscope:
            return "Vectorscope";
        case PanelId::VUMeter:
            return "VU Meter";
        case PanelId::LUFSMeter:
            return "LUFS Meter";
        case PanelId::Spectrogram:
            return "Spectrogram";
        case PanelId::Waveform:
            return "Waveform";
    }
    return "Panel";
}

std::string panelNumber(PanelId panel) {
    switch (panel) {
        case PanelId::Spectrum:
            return "1";
        case PanelId::Oscilloscope:
            return "2";
        case PanelId::Vectorscope:
            return "3";
        case PanelId::VUMeter:
            return "4";
        case PanelId::LUFSMeter:
            return "5";
        case PanelId::Spectrogram:
            return "6";
        case PanelId::Waveform:
            return "7";
    }
    return "?";
}

std::vector<PanelId> removedRackPanels(const RackLayout& rack) {
    std::vector<PanelId> removed;
    for (const auto panel : panelOrder()) {
        if (!rackPanelLocation(rack, panel)) removed.push_back(panel);
    }
    return removed;
}

std::optional<NavigationDirection> plainArrowDirection(
    const ftxui::Event& event) {
    using ftxui::Event;
    if (event == Event::ArrowLeft) return NavigationDirection::Left;
    if (event == Event::ArrowRight) return NavigationDirection::Right;
    if (event == Event::ArrowUp) return NavigationDirection::Up;
    if (event == Event::ArrowDown) return NavigationDirection::Down;
    return std::nullopt;
}

std::optional<NavigationDirection> moveArrowDirection(
    const ftxui::Event& event) {
    using ftxui::Event;
    if (event == Event::ArrowLeftCtrl ||
        event == Event::Special("\x1b[1;2D") ||
        event == Event::Special("\x1b[d") ||
        event == Event::Character('H')) {
        return NavigationDirection::Left;
    }
    if (event == Event::ArrowRightCtrl ||
        event == Event::Special("\x1b[1;2C") ||
        event == Event::Special("\x1b[c") ||
        event == Event::Character('L')) {
        return NavigationDirection::Right;
    }
    if (event == Event::ArrowUpCtrl ||
        event == Event::Special("\x1b[1;2A") ||
        event == Event::Special("\x1b[a") ||
        event == Event::Character('K')) {
        return NavigationDirection::Up;
    }
    if (event == Event::ArrowDownCtrl ||
        event == Event::Special("\x1b[1;2B") ||
        event == Event::Special("\x1b[b") ||
        event == Event::Character('J')) {
        return NavigationDirection::Down;
    }
    return std::nullopt;
}

void eraseLastUtf8Character(std::string& value) {
    if (value.empty()) return;
    value.pop_back();
    while (!value.empty() &&
           (static_cast<unsigned char>(value.back()) & 0xc0) == 0x80) {
        value.pop_back();
    }
}

bool appendProfileNameCharacter(std::string& value,
                                const ftxui::Event& event) {
    if (!event.is_character()) return false;
    const std::string character = event.character();
    if (character.empty() || value.size() + character.size() > 64) return true;
    if (std::any_of(character.begin(), character.end(), [](unsigned char byte) {
            return byte < 0x20 || byte == 0x7f;
        })) {
        return true;
    }
    value += character;
    return true;
}

ftxui::Element panelTitle(PanelId panel,
                          bool focused,
                          const std::string& detail = {}) {
    using namespace ftxui;
    std::string label = " " + panelNumber(panel) + " " + panelName(panel);
    if (!detail.empty()) {
        label += "  •  " + detail;
    }
    label += " ";
    auto title = text(label);
    return focused
        ? title | color(terminalColor(palette().accent)) | bold
        : title | color(terminalColor(palette().muted));
}

ThemeColor panelBackground(PanelId panel) {
    const auto& theme = palette();
    switch (panel) {
        case PanelId::Spectrum: return theme.spectrumBackground;
        case PanelId::Oscilloscope: return theme.oscilloscopeBackground;
        case PanelId::Vectorscope: return theme.vectorscopeBackground;
        case PanelId::VUMeter: return theme.vuBackground;
        case PanelId::LUFSMeter: return theme.lufsBackground;
        case PanelId::Spectrogram: return theme.spectrogramBackground;
        case PanelId::Waveform: return theme.waveformBackground;
    }
    return theme.background;
}

ftxui::Element stylePanel(ftxui::Element content,
                          bool focused,
                          PanelId panel) {
    using namespace ftxui;
    return content |
        color(terminalColor(focused ? palette().text : palette().muted)) |
        bgcolor(terminalColor(panelBackground(panel)));
}

ftxui::Element renderSpectrumPanel(const DisplayFrame& frame,
                                   int width,
                                   int height,
                                   bool focused,
                                   const TuiSettings& settings) {
    using namespace ftxui;
    const size_t contentWidth = static_cast<size_t>(std::max(1, width - 2));
    const size_t contentHeight = static_cast<size_t>(std::max(1, height - 2));
    const size_t spectrumRows = contentHeight > 1 ? contentHeight - 1 : 1;

    SpectrumProjectionOptions projectionOptions;
    projectionOptions.sampleRate = static_cast<float>(frame.sampleRate);
    projectionOptions.maxFrequency = std::min(20000.0f, projectionOptions.sampleRate * 0.5f);
    projectionOptions.tiltDbPerOctave = settings.spectrumTiltDbPerOctave;
    const auto projected = projectSpectrum(
        frame.magnitudes,
        kDefaultFftSize,
        contentWidth,
        projectionOptions);
    const auto rows = buildSpectrumRows(projected, spectrumRows);

    Elements spectrumElements;
    spectrumElements.reserve(rows.size() + 1);
    for (const auto& row : rows) {
        spectrumElements.push_back(
            text(row) | color(terminalColor(palette().spectrumLine)));
    }
    if (contentHeight > 1) {
        spectrumElements.push_back(
            text(buildFrequencyAxis(contentWidth, projectionOptions.maxFrequency)) |
            color(terminalColor(palette().spectrumLabels)));
    }

    const std::string detail = settings.spectrumPeakReadout && frame.spectrumPeak
        ? formatSpectrumPeak(*frame.spectrumPeak, width)
        : "FFT " + std::to_string(kDefaultFftSize);
    auto panel = window(
        panelTitle(
            PanelId::Spectrum,
            focused,
            detail),
        vbox(std::move(spectrumElements)));
    return stylePanel(std::move(panel), focused, PanelId::Spectrum) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

ftxui::Element renderOscilloscopePanel(const DisplayFrame& frame,
                                       int width,
                                       int height,
                                       bool focused,
                                       const TuiSettings& settings) {
    using namespace ftxui;
    std::string detail = settings.oscilloscopePitchLock ? "Pitch lock" : "Free run";
    if (settings.oscilloscopeFrequencyReadout &&
        frame.oscilloscope.signalPresent &&
        std::isfinite(frame.oscilloscope.detectedPitch) &&
        frame.oscilloscope.detectedPitch > 0.0f) {
        detail = std::to_string(static_cast<int>(
            std::lround(frame.oscilloscope.detectedPitch))) + " Hz" +
            (settings.oscilloscopePitchLock ? " lock" : "");
    }

    auto plot = canvas([
        samples = frame.oscilloscope.samples,
        signalPresent = frame.oscilloscope.signalPresent,
        traceWeight = settings.oscilloscopeTraceWeight,
        guideColor = terminalColor(palette().oscilloscopeGuides),
        lineColor = terminalColor(palette().oscilloscopeLine),
        backgroundColor = terminalColor(palette().oscilloscopeBackground)
    ](Canvas& surface) {
        const int canvasWidth = surface.width();
        const int canvasHeight = surface.height();
        if (canvasWidth <= 0 || canvasHeight <= 0) {
            return;
        }
        fillCanvasBackground(surface, backgroundColor);

        const int centerY = oscilloscopeZeroY(canvasHeight);
        surface.DrawPointLine(
            0, centerY, canvasWidth - 1, centerY, guideColor);
        if (!signalPresent) {
            return;
        }
        const auto points = buildOscilloscopePlot(
            samples, canvasWidth, canvasHeight);
        for (size_t index = 1; index < points.size(); ++index) {
            for (int thickness = 0; thickness < traceWeight; ++thickness) {
                surface.DrawPointLine(
                    points[index - 1].x,
                    std::clamp(points[index - 1].y + thickness, 0, canvasHeight - 1),
                    points[index].x,
                    std::clamp(points[index].y + thickness, 0, canvasHeight - 1),
                    lineColor);
            }
        }
    }) | flex;

    auto panel = window(
        panelTitle(PanelId::Oscilloscope, focused, detail),
        std::move(plot));
    return stylePanel(std::move(panel), focused, PanelId::Oscilloscope) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

void drawVectorscopeGrid(ftxui::Canvas& surface,
                         VectorscopeMode mode,
                         const ftxui::Color& grid,
                         const ftxui::Color& guide) {
    using ftxui::Color;
    const auto layout = getVectorscopePlotLayout(
        surface.width(), surface.height(), mode);
    if (layout.radius <= 0 || mode == VectorscopeMode::Lissajous) {
        return;
    }

    const int left = layout.centerX - layout.radius;
    const int right = layout.centerX + layout.radius;
    const int top = layout.centerY - layout.radius;
    const int bottom = layout.centerY + layout.radius;
    const int halfRadius = std::max(1, layout.radius / 2);
    const int diagonal = static_cast<int>(std::lround(
        static_cast<float>(layout.radius) * 0.70710678f));
    const auto drawTriangle = [&](int radius, const Color& color) {
        surface.DrawPointLine(
            layout.centerX, layout.centerY - radius,
            layout.centerX - radius, layout.centerY, color);
        surface.DrawPointLine(
            layout.centerX - radius, layout.centerY,
            layout.centerX + radius, layout.centerY, color);
        surface.DrawPointLine(
            layout.centerX + radius, layout.centerY,
            layout.centerX, layout.centerY - radius, color);
    };
    const auto drawDiamond = [&](int radius, const Color& color) {
        surface.DrawPointLine(
            layout.centerX, layout.centerY - radius,
            layout.centerX + radius, layout.centerY, color);
        surface.DrawPointLine(
            layout.centerX + radius, layout.centerY,
            layout.centerX, layout.centerY + radius, color);
        surface.DrawPointLine(
            layout.centerX, layout.centerY + radius,
            layout.centerX - radius, layout.centerY, color);
        surface.DrawPointLine(
            layout.centerX - radius, layout.centerY,
            layout.centerX, layout.centerY - radius, color);
    };
    switch (mode) {
        case VectorscopeMode::PolarUnipolar:
            surface.DrawPointCircle(
                layout.centerX, layout.centerY, layout.radius, grid);
            surface.DrawPointCircle(
                layout.centerX, layout.centerY, halfRadius, guide);
            surface.DrawPointLine(
                layout.centerX, top, layout.centerX, layout.centerY, grid);
            surface.DrawPointLine(
                layout.centerX, layout.centerY,
                layout.centerX - diagonal, layout.centerY - diagonal, guide);
            surface.DrawPointLine(
                layout.centerX, layout.centerY,
                layout.centerX + diagonal, layout.centerY - diagonal, guide);
            break;
        case VectorscopeMode::PolarBipolar:
            surface.DrawPointCircle(
                layout.centerX, layout.centerY, layout.radius, grid);
            surface.DrawPointCircle(
                layout.centerX, layout.centerY, halfRadius, guide);
            surface.DrawPointLine(
                layout.centerX, top, layout.centerX, bottom, grid);
            surface.DrawPointLine(
                left, layout.centerY, right, layout.centerY, guide);
            surface.DrawPointLine(
                layout.centerX - diagonal, layout.centerY - diagonal,
                layout.centerX + diagonal, layout.centerY + diagonal, guide);
            surface.DrawPointLine(
                layout.centerX + diagonal, layout.centerY - diagonal,
                layout.centerX - diagonal, layout.centerY + diagonal, guide);
            break;
        case VectorscopeMode::LinearUnipolar:
            drawTriangle(layout.radius, grid);
            drawTriangle(halfRadius, guide);
            surface.DrawPointLine(
                layout.centerX, top, layout.centerX, layout.centerY, grid);
            break;
        case VectorscopeMode::LinearBipolar:
            drawDiamond(layout.radius, grid);
            drawDiamond(halfRadius, guide);
            surface.DrawPointLine(
                layout.centerX, top, layout.centerX, bottom, grid);
            surface.DrawPointLine(
                left, layout.centerY, right, layout.centerY, guide);
            break;
        case VectorscopeMode::Lissajous:
            break;
    }
}

ftxui::Element renderVectorscopePanel(const DisplayFrame& frame,
                                      int width,
                                      int height,
                                      bool focused,
                                      const TuiSettings& settings) {
    using namespace ftxui;
    const VectorscopeMode mode = settings.vectorscopeMode;
    const int densityDivisor = settings.vectorscopeDetail == VectorscopeDetail::Balanced
        ? 10
        : settings.vectorscopeDetail == VectorscopeDetail::Maximum ? 3 : 6;
    auto plot = canvas([
        multibandPoints = frame.vectorscope.multibandPoints,
        pointCount = frame.vectorscope.pointCount,
        mode,
        showGuides = settings.vectorscopeGuides,
        densityDivisor,
        gridColor = terminalColor(palette().vectorscopeGuides),
        guideColor = terminalColor(palette().vectorscopeGuidesSecondary),
        bandColors = palette().vectorscopeBands,
        backgroundColor = terminalColor(palette().vectorscopeBackground)
    ](Canvas& surface) {
        const int canvasWidth = surface.width();
        const int canvasHeight = surface.height();
        if (canvasWidth <= 0 || canvasHeight <= 0) {
            return;
        }
        fillCanvasBackground(surface, backgroundColor);

        if (showGuides) {
            drawVectorscopeGrid(surface, mode, gridColor, guideColor);
        }

        const auto bands = buildVectorscopePlot(
            multibandPoints,
            pointCount,
            canvasWidth,
            canvasHeight,
            mode,
            densityDivisor);
        constexpr int ageBuckets = 8;
        std::array<std::array<Color, ageBuckets>, 3> colors;
        for (size_t band = 0; band < colors.size(); ++band) {
            for (int bucket = 0; bucket < ageBuckets; ++bucket) {
                const float brightness = 0.3f + 0.7f *
                    static_cast<float>(bucket + 1) /
                    static_cast<float>(ageBuckets);
                colors[band][bucket] = terminalColor(
                    scaleColor(bandColors[band], brightness));
            }
        }
        for (int bucket = 0; bucket < ageBuckets; ++bucket) {
            for (size_t band = 0; band < bands.size(); ++band) {
                for (const auto& point : bands[band]) {
                    const int pointBucket = std::min(
                        ageBuckets - 1,
                        static_cast<int>(point.intensity *
                            static_cast<float>(ageBuckets)));
                    if (pointBucket != bucket) {
                        continue;
                    }
                    surface.DrawPoint(
                        point.x, point.y, true, colors[band][bucket]);
                }
            }
        }
    }) | flex;

    auto panel = window(
        panelTitle(
            PanelId::Vectorscope,
            focused,
            vectorscopeModeName(mode)),
        std::move(plot));
    return stylePanel(std::move(panel), focused, PanelId::Vectorscope) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

std::string formatVuReference(float referenceDbfs) {
    std::ostringstream output;
    output << std::fixed << std::setprecision(0) << referenceDbfs << " dBFS";
    return output.str();
}

ftxui::Element renderClassicVuGauge(float levelDb,
                                    float peakDb,
                                    float referenceDbfs,
                                    int columns) {
    using namespace ftxui;
    const int resolvedColumns = std::max(1, columns);
    const int levelColumns = std::clamp(
        static_cast<int>(std::lround(
            vuDbToNormalized(levelDb, referenceDbfs) * resolvedColumns)),
        0,
        resolvedColumns);
    const int peakColumn = std::clamp(
        static_cast<int>(std::lround(
            vuDbToNormalized(peakDb, referenceDbfs) * (resolvedColumns - 1))),
        0,
        resolvedColumns - 1);
    const int hotColumn = static_cast<int>(std::lround(
        classicVuToNormalized(0.0f) * resolvedColumns));
    const bool showPeak = std::isfinite(peakDb) && peakDb > -59.0f;

    Elements cells;
    cells.reserve(static_cast<size_t>(resolvedColumns));
    for (int column = 0; column < resolvedColumns; ++column) {
        if (showPeak && column == peakColumn) {
            const bool hot = dbfsToClassicVu(peakDb, referenceDbfs) > 0.0f;
            cells.push_back(text("│") | color(
                terminalColor(hot ? palette().vuClip : palette().vuPeak)));
        } else if (column < levelColumns) {
            cells.push_back(text("█") | color(
                terminalColor(column >= hotColumn
                    ? palette().vuClip
                    : palette().vuLevel)));
        } else {
            cells.push_back(text("·") | color(terminalColor(palette().vuTrack)));
        }
    }
    return hbox(std::move(cells)) | size(WIDTH, EQUAL, resolvedColumns);
}

ftxui::Element renderCorrelationGauge(float correlation, int columns) {
    using namespace ftxui;
    const int resolvedColumns = std::max(5, columns);
    const int center = resolvedColumns / 2;
    const float clamped = std::clamp(correlation, -1.0f, 1.0f);
    const int extent = static_cast<int>(std::lround(
        std::abs(clamped) * static_cast<float>(center)));
    Elements cells;
    cells.reserve(static_cast<size_t>(resolvedColumns));
    for (int column = 0; column < resolvedColumns; ++column) {
        const bool positiveFill = clamped >= 0.0f &&
            column >= center && column < center + extent;
        const bool negativeFill = clamped < 0.0f &&
            column < center && column >= center - extent;
        if (column == center) {
            cells.push_back(text("│") | color(terminalColor(palette().vuScale)));
        } else if (positiveFill) {
            cells.push_back(text("█") | color(terminalColor(palette().vuLevel)));
        } else if (negativeFill) {
            cells.push_back(text("█") | color(terminalColor(palette().vuClip)));
        } else {
            cells.push_back(text("·") | color(terminalColor(palette().vuTrack)));
        }
    }
    return hbox({
        text("-1 ") | dim,
        hbox(std::move(cells)) | size(WIDTH, EQUAL, resolvedColumns),
        text(" +1") | dim,
    });
}

std::string buildClassicVuScale(int columns) {
    std::string result(static_cast<size_t>(std::max(1, columns)), ' ');
    const auto place = [&](float vu, const std::string& label) {
        if (label.size() > result.size()) return;
        const size_t position = static_cast<size_t>(std::lround(
            classicVuToNormalized(vu) * static_cast<float>(result.size() - 1)));
        const size_t start = std::min(
            result.size() - label.size(),
            position > label.size() / 2 ? position - label.size() / 2 : size_t{0});
        result.replace(start, label.size(), label);
    };
    place(-20.0f, "-20");
    place(-10.0f, "-10");
    place(-5.0f, "-5");
    place(0.0f, "0");
    place(3.0f, "+3");
    return result;
}

ftxui::Element renderHorizontalVu(const DisplayFrame& frame,
                                  int contentWidth,
                                  int contentHeight,
                                  const TuiSettings& settings) {
    using namespace ftxui;
    const int gaugeWidth = std::max(5, contentWidth - 13);
    const auto channel = [&](const char* label, float level, float peak) {
        return hbox({
            text(std::string(label) + " ") | bold,
            renderClassicVuGauge(level, peak, settings.vuReferenceDbfs, gaugeWidth),
            text(" " + formatDb(level) + " dB") | dim,
        });
    };
    Elements body;
    body.push_back(filler());
    body.push_back(channel("L", frame.vu.vuLDb, frame.vu.peakLDb));
    body.push_back(channel("R", frame.vu.vuRDb, frame.vu.peakRDb));
    if (contentHeight >= 6) {
        body.push_back(hbox({
            text("  "),
            text(buildClassicVuScale(gaugeWidth)) | dim,
        }));
    }
    body.push_back(renderCorrelationGauge(
        frame.vu.correlation, std::max(5, contentWidth - 8)) | center);
    body.push_back(filler());
    return vbox(std::move(body));
}

ftxui::Element renderVerticalVuBar(float levelDb,
                                   float peakDb,
                                   float referenceDbfs,
                                   int row,
                                   int rows) {
    using namespace ftxui;
    const float level = vuDbToNormalized(levelDb, referenceDbfs);
    const float peak = vuDbToNormalized(peakDb, referenceDbfs);
    const float top = 1.0f - static_cast<float>(row) / static_cast<float>(rows);
    const float bottom = 1.0f - static_cast<float>(row + 1) / static_cast<float>(rows);
    const bool peakHere = peak > bottom && peak <= top;
    const bool filled = level > bottom;
    const bool hot = bottom >= classicVuToNormalized(0.0f);
    if (peakHere) return text("━━") | color(terminalColor(
        hot ? palette().vuClip : palette().vuPeak));
    if (filled) return text("██") | color(terminalColor(
        hot ? palette().vuClip : palette().vuLevel));
    return text("··") | color(terminalColor(palette().vuTrack));
}

ftxui::Element renderVerticalVu(const DisplayFrame& frame,
                                int contentWidth,
                                int contentHeight,
                                const TuiSettings& settings) {
    using namespace ftxui;
    const int meterRows = std::max(1, contentHeight - 3);
    Elements rows;
    rows.push_back(text("L      R") | center | bold);
    for (int row = 0; row < meterRows; ++row) {
        rows.push_back(hbox({
            renderVerticalVuBar(
                frame.vu.vuLDb, frame.vu.peakLDb,
                settings.vuReferenceDbfs, row, meterRows),
            text("    "),
            renderVerticalVuBar(
                frame.vu.vuRDb, frame.vu.peakRDb,
                settings.vuReferenceDbfs, row, meterRows),
        }) | center);
    }
    rows.push_back(text(
        formatDb(frame.vu.vuLDb) + "     " + formatDb(frame.vu.vuRDb) + " dB") |
        center | dim);
    rows.push_back(renderCorrelationGauge(
        frame.vu.correlation, std::max(5, contentWidth - 8)) | center);
    return vbox(std::move(rows));
}

ftxui::Element renderNeedleVu(const DisplayFrame& frame,
                              int contentWidth,
                              int contentHeight,
                              const TuiSettings& settings) {
    using namespace ftxui;
    const bool combined = settings.vuNeedleChannels == VUNeedleChannels::Combined;
    const float combinedDb = stereoRmsDbAverage(frame.vu.vuLDb, frame.vu.vuRDb);
    const float combinedPeak = std::max(frame.vu.peakLDb, frame.vu.peakRDb);
    const float referenceDbfs = settings.vuReferenceDbfs;
    const int plotRows = std::max(1, contentHeight - 2);
    auto face = canvas([
        left = frame.vu.vuLDb,
        right = frame.vu.vuRDb,
        leftPeak = frame.vu.peakLDb,
        rightPeak = frame.vu.peakRDb,
        combinedDb,
        combinedPeak,
        combined,
        referenceDbfs,
        scaleColor = terminalColor(palette().vuScale),
        trackColor = terminalColor(palette().vuTrack),
        clipColor = terminalColor(palette().vuClip),
        levelColor = terminalColor(palette().vuLevel),
        leftColor = terminalColor(palette().vuNeedleLeft),
        rightColor = terminalColor(palette().vuNeedleRight),
        combinedColor = terminalColor(palette().vuNeedleCombined),
        backgroundColor = terminalColor(palette().vuBackground)
    ](Canvas& surface) {
        constexpr float pi = 3.14159265358979323846f;
        const int canvasWidth = surface.width();
        const int canvasHeight = surface.height();
        if (canvasWidth <= 0 || canvasHeight <= 0) return;
        fillCanvasBackground(surface, backgroundColor);
        if (canvasWidth < 8 || canvasHeight < 8) return;
        const float startAngle = pi * 1.08f;
        const float endAngle = pi * 1.92f;
        const int centerX = canvasWidth / 2;
        const int centerY = canvasHeight - 2;
        const int radiusX = std::max(3, static_cast<int>(
            static_cast<float>(centerX - 2) / std::abs(std::cos(startAngle))));
        const int radiusY = std::max(3, std::min(
            centerY - 2,
            static_cast<int>(static_cast<float>(canvasHeight) * 0.78f)));
        const auto point = [&](float angle, float scale) {
            return std::pair<int, int>{
                centerX + static_cast<int>(std::lround(
                    std::cos(angle) * static_cast<float>(radiusX) * scale)),
                centerY + static_cast<int>(std::lround(
                    std::sin(angle) * static_cast<float>(radiusY) * scale)),
            };
        };
        const auto drawArc = [&](float from, float to, float scale, const Color& color) {
            constexpr int segments = 80;
            auto previous = point(from, scale);
            for (int index = 1; index <= segments; ++index) {
                const float amount = static_cast<float>(index) /
                    static_cast<float>(segments);
                const float angle = from + (to - from) * amount;
                const auto next = point(angle, scale);
                surface.DrawPointLine(
                    previous.first, previous.second,
                    next.first, next.second, color);
                previous = next;
            }
        };
        const auto angleForDb = [&](float db) {
            return startAngle + vuDbToNormalized(db, referenceDbfs) *
                (endAngle - startAngle);
        };
        const auto drawNeedle = [&](float db, float peak, float scale, const Color& color) {
            const float angle = angleForDb(db);
            const auto tip = point(angle, scale * 0.92f);
            surface.DrawPointLine(centerX, centerY, tip.first, tip.second, color);
            const float peakAngle = angleForDb(peak);
            const auto peakInner = point(peakAngle, scale * 0.91f);
            const auto peakOuter = point(peakAngle, scale * 1.04f);
            surface.DrawPointLine(
                peakInner.first, peakInner.second,
                peakOuter.first, peakOuter.second,
                dbfsToClassicVu(peak, referenceDbfs) > 0.0f
                    ? clipColor
                    : color);
        };

        drawArc(startAngle, endAngle, 1.0f, trackColor);
        if (!combined) drawArc(startAngle, endAngle, 0.78f, trackColor);
        const std::array<float, 9> ticks = {
            -20.0f, -10.0f, -5.0f, -3.0f, -1.0f, 0.0f, 1.0f, 2.0f, 3.0f};
        for (float vu : ticks) {
            const float angle = startAngle + classicVuToNormalized(vu) *
                (endAngle - startAngle);
            const auto inner = point(angle, 0.92f);
            const auto outer = point(angle, 1.05f);
            surface.DrawPointLine(
                inner.first, inner.second,
                outer.first, outer.second,
                vu >= 0.0f ? clipColor : scaleColor);
        }
        const float hotAngle = startAngle + classicVuToNormalized(0.0f) *
            (endAngle - startAngle);
        drawArc(hotAngle, endAngle, 1.0f, clipColor);

        if (combined) {
            drawArc(startAngle, angleForDb(combinedDb), 1.0f, levelColor);
            drawNeedle(combinedDb, combinedPeak, 1.0f, combinedColor);
        } else {
            drawArc(startAngle, angleForDb(left), 0.78f, leftColor);
            drawArc(startAngle, angleForDb(right), 1.0f, rightColor);
            drawNeedle(left, leftPeak, 0.78f, leftColor);
            drawNeedle(right, rightPeak, 1.0f, rightColor);
        }
        surface.DrawPointCircleFilled(
            centerX, centerY, 1, combined ? combinedColor : levelColor);
    }) | size(HEIGHT, EQUAL, plotRows) | flex;

    const std::string readings = combined
        ? formatDb(combinedDb) + " dB"
        : "L " + formatDb(frame.vu.vuLDb) + " dB    " +
            formatDb(frame.vu.vuRDb) + " dB R";
    return vbox({
        std::move(face),
        text(readings) | center | color(terminalColor(palette().vuLabels)),
        renderCorrelationGauge(
            frame.vu.correlation, std::max(5, contentWidth - 8)) | center,
    });
}

ftxui::Element renderVUMeterPanel(const DisplayFrame& frame,
                                  int width,
                                  int height,
                                  bool focused,
                                  const TuiSettings& settings) {
    using namespace ftxui;
    const int contentWidth = std::max(1, width - 2);
    const int contentHeight = std::max(1, height - 2);
    std::string detail = vuMeterModeName(settings.vuMeterMode);
    if (width >= 42 && settings.vuMeterMode == VUMeterMode::Bar) {
        detail += " • " + std::string(vuMeterOrientationName(
            settings.vuMeterOrientation));
    } else if (width >= 42) {
        detail += " • " + std::string(vuNeedleChannelsName(
            settings.vuNeedleChannels));
    }
    if (width >= 58) {
        detail += " • 0 VU " + formatVuReference(settings.vuReferenceDbfs);
    }

    Element body;
    if (settings.vuMeterMode == VUMeterMode::Needle) {
        body = renderNeedleVu(frame, contentWidth, contentHeight, settings);
    } else if (settings.vuMeterOrientation == VUMeterOrientation::Vertical) {
        body = renderVerticalVu(frame, contentWidth, contentHeight, settings);
    } else {
        body = renderHorizontalVu(frame, contentWidth, contentHeight, settings);
    }
    auto panel = window(
        panelTitle(PanelId::VUMeter, focused, detail),
        std::move(body));
    return stylePanel(std::move(panel), focused, PanelId::VUMeter) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

std::string lufsScaleLabel(int row, int rows) {
    const std::array<int, 6> ticks = {0, -6, -12, -24, -36, -50};
    for (int tick : ticks) {
        const int tickRow = static_cast<int>(std::lround(
            (1.0f - compactMeterToNormalized(static_cast<float>(tick))) *
            static_cast<float>(std::max(0, rows - 1))));
        if (tickRow == row) {
            std::ostringstream label;
            label << std::setw(3) << std::abs(tick);
            return label.str();
        }
    }
    return "   ";
}

ftxui::Element renderLufsBarCell(float levelDb,
                                 float peakDb,
                                 int row,
                                 int rows,
                                 int width,
                                 bool showPeak,
                                 bool targetRow) {
    using namespace ftxui;
    const float level = compactMeterToNormalized(levelDb);
    const float peak = compactMeterToNormalized(peakDb);
    const float top = 1.0f - static_cast<float>(row) / static_cast<float>(rows);
    const float bottom = 1.0f - static_cast<float>(row + 1) / static_cast<float>(rows);
    const bool peakHere = showPeak && peak > bottom && peak <= top;
    const bool filled = level > bottom;
    const auto repeat = [width](const char* glyph) {
        std::string result;
        for (int index = 0; index < width; ++index) result += glyph;
        return result;
    };
    if (targetRow) return text(repeat("─")) |
        color(terminalColor(palette().lufsTarget));
    if (peakHere) return text(repeat("━")) |
        color(terminalColor(palette().lufsLabels));
    if (filled) return text(repeat("█")) |
        color(terminalColor(palette().lufsLevel));
    return text(repeat("·")) |
        color(terminalColor(palette().lufsTrack));
}

ftxui::Element renderLUFSMeterPanel(const DisplayFrame& frame,
                                    int width,
                                    int height,
                                    bool focused,
                                    const TuiSettings& settings) {
    using namespace ftxui;
    constexpr float targetLufs = -14.0f;
    const int contentHeight = std::max(1, height - 2);
    const int meterRows = std::max(1, contentHeight - 1);
    const float selected = selectLufsReadout(
        frame.lufs.momentaryLUFS,
        frame.lufs.shortTermLUFS,
        frame.lufs.integratedLUFS,
        settings.lufsReadout);
    const int selectedRow = static_cast<int>(std::lround(
        (1.0f - compactMeterToNormalized(selected)) *
        static_cast<float>(std::max(0, meterRows - 1))));
    const int targetRow = static_cast<int>(std::lround(
        (1.0f - compactMeterToNormalized(targetLufs)) *
        static_cast<float>(std::max(0, meterRows - 1))));

    Elements rows;
    rows.push_back(hbox({
        text("    L R LUFS") | dim,
        filler(),
        text("target -14") | color(terminalColor(palette().lufsTarget)),
    }));
    for (int row = 0; row < meterRows; ++row) {
        Elements parts;
        const auto gap = [&]() {
            auto element = text(row == targetRow ? "─" : " ");
            return row == targetRow
                ? element | color(terminalColor(palette().lufsTarget))
                : element;
        };
        parts.push_back(text(lufsScaleLabel(row, meterRows)) | dim);
        parts.push_back(gap());
        parts.push_back(renderLufsBarCell(
            frame.lufs.barLDb, frame.lufs.peakLDb,
            row, meterRows, 2, true, row == targetRow));
        parts.push_back(gap());
        parts.push_back(renderLufsBarCell(
            frame.lufs.barRDb, frame.lufs.peakRDb,
            row, meterRows, 2, true, row == targetRow));
        parts.push_back(gap());
        parts.push_back(renderLufsBarCell(
            selected, selected,
            row, meterRows, 3, false, row == targetRow));
        parts.push_back(text(" "));
        if (row == selectedRow) {
            parts.push_back(
                text(" " + formatLufs(selected) + " LUFS ") |
                bgcolor(terminalColor(palette().lufsLevel)) |
                color(terminalColor(palette().lufsBackground)) | bold);
        }
        rows.push_back(hbox(std::move(parts)));
    }

    std::string detail = lufsReadoutName(settings.lufsReadout);
    if (width >= 52) {
        detail += " • M " + formatLufs(frame.lufs.momentaryLUFS) +
            " • S " + formatLufs(frame.lufs.shortTermLUFS) +
            " • I " + formatLufs(frame.lufs.integratedLUFS);
    }
    auto panel = window(
        panelTitle(PanelId::LUFSMeter, focused, detail),
        vbox(std::move(rows)));
    return stylePanel(std::move(panel), focused, PanelId::LUFSMeter) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

ftxui::Color interpolateColor(const ThemeColor& from,
                              const ThemeColor& to,
                              float amount) {
    const float t = std::clamp(amount, 0.0f, 1.0f);
    return ftxui::Color::RGB(
        static_cast<uint8_t>(std::lround(from.red +
            (static_cast<int>(to.red) - from.red) * t)),
        static_cast<uint8_t>(std::lround(from.green +
            (static_cast<int>(to.green) - from.green) * t)),
        static_cast<uint8_t>(std::lround(from.blue +
            (static_cast<int>(to.blue) - from.blue) * t)));
}

ftxui::Color spectrogramColor(float intensity, SpectrogramColorMode mode) {
    const float value = std::clamp(intensity, 0.0f, 1.0f);
    if (mode == SpectrogramColorMode::Mono) {
        return interpolateColor(
            palette().spectrogramBackground,
            palette().spectrogramMono,
            std::pow(value, 0.72f));
    }

    constexpr std::array<float, 4> stops = {0.0f, 0.20f, 0.62f, 1.0f};
    const std::array<ThemeColor, 4> colors = {{
        palette().spectrogramBackground,
        palette().spectrogramHeat[0],
        palette().spectrogramHeat[1],
        palette().spectrogramHeat[2],
    }};
    size_t upper = 1;
    while (upper + 1 < stops.size() && value > stops[upper]) ++upper;
    const size_t lower = upper - 1;
    const float span = stops[upper] - stops[lower];
    return interpolateColor(
        colors[lower], colors[upper],
        span > 0.0f ? (value - stops[lower]) / span : 0.0f);
}

float maxHistoryValue(const ScrollingHistoryFrame& history,
                      size_t column,
                      size_t firstRow,
                      size_t lastRow) {
    if (column >= history.columnCount || history.columnStride == 0 ||
        history.values.size() < history.columnCount * history.columnStride) {
        return 0.0f;
    }
    firstRow = std::min(firstRow, history.columnStride - 1);
    lastRow = std::min(std::max(firstRow + 1, lastRow), history.columnStride);
    float result = 0.0f;
    const size_t offset = column * history.columnStride;
    for (size_t row = firstRow; row < lastRow; ++row) {
        result = std::max(result, history.values[offset + row]);
    }
    return result;
}

float spectrogramPixelValue(const ScrollingHistoryFrame& history,
                            size_t column,
                            int frequencyPixel,
                            int frequencyPixels) {
    if (frequencyPixels <= 0 || frequencyPixel < 0 ||
        frequencyPixel >= frequencyPixels) {
        return 0.0f;
    }
    const float normalizedStart = static_cast<float>(frequencyPixel) /
        static_cast<float>(frequencyPixels);
    const float normalizedEnd = static_cast<float>(frequencyPixel + 1) /
        static_cast<float>(frequencyPixels);
    const size_t firstRow = static_cast<size_t>(std::floor(
        normalizedStart * static_cast<float>(history.columnStride)));
    const size_t lastRow = static_cast<size_t>(std::ceil(
        normalizedEnd * static_cast<float>(history.columnStride)));
    const float value = maxHistoryValue(history, column, firstRow, lastRow);
    return std::isfinite(value) ? std::clamp(value, 0.0f, 1.0f) : 0.0f;
}

void drawClassicSpectrogram(ftxui::Canvas& surface,
                            const ScrollingHistoryFrame& history,
                            SpectrogramColorMode colorMode,
                            bool vertical) {
    const int cellColumns = surface.width() / 2;
    const int cellRows = surface.height() / 4;
    if (cellColumns <= 0 || cellRows <= 0) return;

    const int timeCells = vertical ? cellRows : cellColumns;
    const int frequencyCells = vertical ? cellColumns : cellRows;
    const size_t visibleColumns = std::min(
        history.columnCount, static_cast<size_t>(timeCells));
    const size_t sourceStart = history.columnCount - visibleColumns;
    const int destinationStart = timeCells - static_cast<int>(visibleColumns);
    for (size_t time = 0; time < visibleColumns; ++time) {
        const size_t sourceColumn = sourceStart + time;
        const int timeCell = destinationStart + static_cast<int>(time);
        for (int frequencyCell = 0; frequencyCell < frequencyCells;
             ++frequencyCell) {
            const float intensity = spectrogramPixelValue(
                history, sourceColumn, frequencyCell, frequencyCells);
            if (intensity < 0.008f) continue;

            const int cellX = vertical ? frequencyCell : timeCell;
            const int cellY = vertical ? timeCell : frequencyCell;
            const ftxui::Color color = spectrogramColor(intensity, colorMode);
            for (int dx = 0; dx < 2; ++dx) {
                surface.DrawBlock(cellX * 2 + dx, cellY * 4, true, color);
                surface.DrawBlock(cellX * 2 + dx, cellY * 4 + 2, true, color);
            }
        }
    }
}

void drawDetailedSpectrogram(ftxui::Canvas& surface,
                             const ScrollingHistoryFrame& history,
                             SpectrogramColorMode colorMode,
                             SpectrogramClarity clarity,
                             bool vertical) {
    const int cellColumns = surface.width() / 2;
    const int cellRows = surface.height() / 4;
    if (cellColumns <= 0 || cellRows <= 0) return;

    // A terminal cell contains eight Braille dots. Treat those as a 2x4
    // spectrogram raster instead of collapsing the analyzer output to one
    // solid character. The ordered thresholds give quieter energy texture
    // without hiding the strongest narrow feature in each cell.
    constexpr std::array<float, 8> orderedThresholds = {
        1.0f / 9.0f, 5.0f / 9.0f,
        7.0f / 9.0f, 3.0f / 9.0f,
        2.0f / 9.0f, 6.0f / 9.0f,
        8.0f / 9.0f, 4.0f / 9.0f,
    };
    const float thresholdScale = clarity == SpectrogramClarity::Sharp
        ? 0.82f
        : 1.0f;
    const int timePixels = vertical ? surface.height() : surface.width();
    const int frequencyPixels = vertical ? surface.width() : surface.height();
    const size_t visibleColumns = std::min(
        history.columnCount, static_cast<size_t>(timePixels));
    const size_t sourceStart = history.columnCount - visibleColumns;
    const int destinationStart = timePixels - static_cast<int>(visibleColumns);

    for (int cellY = 0; cellY < cellRows; ++cellY) {
        for (int cellX = 0; cellX < cellColumns; ++cellX) {
            std::array<float, 8> intensities{};
            float strongest = 0.0f;
            size_t strongestIndex = 0;
            for (int dotY = 0; dotY < 4; ++dotY) {
                for (int dotX = 0; dotX < 2; ++dotX) {
                    const size_t index = static_cast<size_t>(dotY * 2 + dotX);
                    const int timePixel = vertical
                        ? cellY * 4 + dotY
                        : cellX * 2 + dotX;
                    const int frequencyPixel = vertical
                        ? cellX * 2 + dotX
                        : cellY * 4 + dotY;
                    if (timePixel < destinationStart) continue;
                    const size_t sourceColumn = sourceStart +
                        static_cast<size_t>(timePixel - destinationStart);
                    intensities[index] = spectrogramPixelValue(
                        history, sourceColumn, frequencyPixel, frequencyPixels);
                    if (intensities[index] > strongest) {
                        strongest = intensities[index];
                        strongestIndex = index;
                    }
                }
            }
            if (strongest < 0.008f) continue;

            const ftxui::Color color = spectrogramColor(strongest, colorMode);
            for (int dotY = 0; dotY < 4; ++dotY) {
                for (int dotX = 0; dotX < 2; ++dotX) {
                    const size_t index = static_cast<size_t>(dotY * 2 + dotX);
                    const bool strongestDot = index == strongestIndex;
                    const bool visible = intensities[index] >=
                        orderedThresholds[index] * thresholdScale;
                    if (strongestDot || visible) {
                        surface.DrawPoint(
                            cellX * 2 + dotX,
                            cellY * 4 + dotY,
                            true,
                            color);
                    }
                }
            }
        }
    }
}

ftxui::Element renderSpectrogramPanel(const DisplayFrame& frame,
                                      int width,
                                      int height,
                                      bool focused,
                                      const TuiSettings& settings) {
    using namespace ftxui;
    const bool heat = settings.spectrogramColor == SpectrogramColorMode::Heat;
    const auto& history = heat ? frame.spectrogram.heat : frame.spectrogram.display;
    const bool vertical =
        settings.spectrogramOrientation == SpectrogramOrientation::Vertical;
    auto plot = canvas([
        history,
        colorMode = settings.spectrogramColor,
        clarity = settings.spectrogramClarity,
        vertical,
        backgroundColor = terminalColor(palette().spectrogramBackground)
    ](Canvas& surface) {
        fillCanvasBackground(surface, backgroundColor);
        if (surface.width() <= 0 || surface.height() <= 0 ||
            history.columnCount == 0 ||
            history.columnStride == 0) {
            return;
        }
        if (clarity == SpectrogramClarity::Classic) {
            drawClassicSpectrogram(surface, history, colorMode, vertical);
        } else {
            drawDetailedSpectrogram(
                surface, history, colorMode, clarity, vertical);
        }
    }) | flex;

    std::string detail = std::string(
        spectrogramClarityName(settings.spectrogramClarity));
    if (width >= 42) {
        detail += " • " + std::string(
            spectrogramColorName(settings.spectrogramColor));
    }
    if (width >= 48) {
        detail += " • " + std::string(spectrogramScaleName(settings.spectrogramScale));
    }
    if (width >= 66) {
        detail += " • " + std::string(
            spectrogramOrientationName(settings.spectrogramOrientation));
    }
    auto panel = window(
        panelTitle(PanelId::Spectrogram, focused, detail),
        std::move(plot));
    return stylePanel(std::move(panel), focused, PanelId::Spectrogram) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

ftxui::Color waveformBandColor(const float* summary, bool multiband) {
    if (!multiband || summary == nullptr) {
        return terminalColor(palette().waveformLine);
    }
    std::array<float, 3> weights = {
        std::max(0.0f, summary[2]),
        std::max(0.0f, summary[3]),
        std::max(0.0f, summary[4]),
    };
    float total = weights[0] + weights[1] + weights[2];
    if (total <= 1.0e-8f) return terminalColor(palette().waveformLine);
    for (float& weight : weights) {
        weight = std::pow(weight / total, 2.6f);
    }
    total = weights[0] + weights[1] + weights[2];
    for (float& weight : weights) {
        weight /= std::max(total, 1.0e-8f);
    }
    std::array<int, 3> mixed{};
    for (size_t channel = 0; channel < mixed.size(); ++channel) {
        for (size_t band = 0; band < weights.size(); ++band) {
            const auto& color = palette().waveformBands[band];
            const uint8_t value = channel == 0
                ? color.red
                : channel == 1 ? color.green : color.blue;
            mixed[channel] += static_cast<int>(std::lround(
                weights[band] * static_cast<float>(value)));
        }
    }
    return ftxui::Color::RGB(
        std::clamp(mixed[0], 0, 255),
        std::clamp(mixed[1], 0, 255),
        std::clamp(mixed[2], 0, 255));
}

ftxui::Element renderWaveformPanel(const DisplayFrame& frame,
                                   int width,
                                   int height,
                                   bool focused,
                                   const TuiSettings& settings) {
    using namespace ftxui;
    const bool stereo = settings.waveformMode == WaveformMode::Stereo;
    auto plot = canvas([
        history = frame.waveform.history,
        stereo,
        multiband = settings.waveformMultiband,
        guideColor = terminalColor(palette().waveformGuides),
        secondaryGuideColor = terminalColor(palette().waveformGuidesSecondary),
        backgroundColor = terminalColor(palette().waveformBackground)
    ](Canvas& surface) {
        const int canvasWidth = surface.width();
        const int canvasHeight = surface.height();
        if (canvasWidth <= 0 || canvasHeight <= 0) return;
        fillCanvasBackground(surface, backgroundColor);

        const int laneCount = stereo ? 2 : 1;
        for (int lane = 0; lane < laneCount; ++lane) {
            const int centerY = static_cast<int>(std::lround(
                (static_cast<float>(lane) + 0.5f) *
                static_cast<float>(canvasHeight) / static_cast<float>(laneCount)));
            surface.DrawPointLine(
                0, centerY, canvasWidth - 1, centerY,
                guideColor);
        }
        if (stereo) {
            surface.DrawPointLine(
                0, canvasHeight / 2, canvasWidth - 1, canvasHeight / 2,
                secondaryGuideColor);
        }

        if (history.columnCount == 0 ||
            history.columnStride < Visualizer::WAVEFORM_STEREO_SUMMARY_STRIDE ||
            history.values.size() < history.columnCount * history.columnStride) {
            return;
        }
        const size_t visibleColumns = std::min(
            history.columnCount, static_cast<size_t>(canvasWidth));
        const size_t sourceStart = history.columnCount - visibleColumns;
        const int destinationStart = canvasWidth - static_cast<int>(visibleColumns);
        const float laneHeight = static_cast<float>(canvasHeight) /
            static_cast<float>(laneCount);
        const float radius = std::max(1.0f, laneHeight * 0.44f);
        for (size_t column = 0; column < visibleColumns; ++column) {
            const size_t sourceColumn = sourceStart + column;
            const float* summary = history.values.data() +
                sourceColumn * history.columnStride;
            const int x = destinationStart + static_cast<int>(column);
            for (int lane = 0; lane < laneCount; ++lane) {
                const float* channel = summary +
                    (lane == 0 ? 0 : Visualizer::WAVEFORM_MONO_SUMMARY_STRIDE);
                const float minimum = std::clamp(channel[0], -1.0f, 1.0f);
                const float maximum = std::clamp(channel[1], -1.0f, 1.0f);
                const float centerY = (static_cast<float>(lane) + 0.5f) * laneHeight;
                const int top = std::clamp(
                    static_cast<int>(std::lround(centerY - maximum * radius)),
                    0, canvasHeight - 1);
                const int bottom = std::clamp(
                    static_cast<int>(std::lround(centerY - minimum * radius)),
                    0, canvasHeight - 1);
                surface.DrawBlockLine(
                    x, std::min(top, bottom), x, std::max(top, bottom),
                    waveformBandColor(channel, multiband));
            }
        }
    }) | flex;

    std::string detail = waveformModeName(settings.waveformMode);
    if (settings.waveformMultiband) detail += " • Multiband";
    if (width >= 58) {
        detail += " • " + std::to_string(settings.waveformScrollSpeed) + "×";
    }
    auto panel = window(
        panelTitle(PanelId::Waveform, focused, detail),
        std::move(plot));
    return stylePanel(std::move(panel), focused, PanelId::Waveform) |
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
                                const InterfaceState& state) {
    using namespace ftxui;
    if (node.isLeaf()) {
        const auto* rect = findPanelRect(layout, *node.panel);
        if (rect == nullptr) {
            return emptyElement();
        }
        const bool focused = *node.panel == state.focusedPanel;
        switch (*node.panel) {
            case PanelId::Spectrum:
                return renderSpectrumPanel(
                    frame, rect->width, rect->height, focused, state.settings);
            case PanelId::Oscilloscope:
                return renderOscilloscopePanel(
                    frame, rect->width, rect->height, focused, state.settings);
            case PanelId::Vectorscope:
                return renderVectorscopePanel(
                    frame,
                    rect->width,
                    rect->height,
                    focused,
                    state.settings);
            case PanelId::VUMeter:
                return renderVUMeterPanel(
                    frame,
                    rect->width,
                    rect->height,
                    focused,
                    state.settings);
            case PanelId::LUFSMeter:
                return renderLUFSMeterPanel(
                    frame,
                    rect->width,
                    rect->height,
                    focused,
                    state.settings);
            case PanelId::Spectrogram:
                return renderSpectrogramPanel(
                    frame,
                    rect->width,
                    rect->height,
                    focused,
                    state.settings);
            case PanelId::Waveform:
                return renderWaveformPanel(
                    frame,
                    rect->width,
                    rect->height,
                    focused,
                    state.settings);
        }
    }

    Elements children;
    children.reserve(node.children.size());
    for (const auto& child : node.children) {
        children.push_back(renderLayoutNode(child, layout, frame, state));
    }
    return node.axis == SplitAxis::Columns
        ? hbox(std::move(children))
        : vbox(std::move(children));
}

ftxui::Element renderHeader(const DashboardLayout& layout,
                            const InterfaceState& state,
                            int width) {
    using namespace ftxui;
    std::ostringstream rackStatus;
    if (state.layoutEditing) {
        rackStatus << "EDIT LAYOUT";
        if (const auto location = rackPanelLocation(
                state.settings.rackLayout, state.focusedPanel)) {
            const auto& row = state.settings.rackLayout.rows[location->first];
            const auto& tile = row.tiles[location->second];
            rackStatus << " • row " << location->first + 1 << "/"
                       << state.settings.rackLayout.rows.size();
            if (width >= 76) {
                rackStatus << " • width " << tile.weight
                           << " • height " << row.weight;
            }
        }
        const size_t removedCount = removedRackPanels(
            state.settings.rackLayout).size();
        if (removedCount > 0 && width >= 110) {
            rackStatus << " • " << removedCount << " removed";
        }
    } else {
        rackStatus << "rack • " << layout.visibleRows << "/"
                   << layout.configuredRows << " rows";
        if (layout.hiddenPanels > 0 && width >= 80) {
            rackStatus << " • " << layout.hiddenPanels << " scope"
                       << (layout.hiddenPanels == 1 ? "" : "s") << " hidden";
        }
    }
    const auto* profile = activeProfile(state);
    const bool profileDirty = hasUnsavedProfileChanges(state);
    const std::string profileLabel = profile
        ? " • " + profile->name + (profileDirty ? " *" : "")
        : profileDirty ? " • Working *" : "";
    Element profileElement = width >= 90 && !profileLabel.empty()
        ? text(profileLabel) |
            (profileDirty ? color(terminalColor(palette().warning)) : dim) |
            size(WIDTH, LESS_THAN, 32)
        : emptyElement();
    return hbox({
        text(" PRISM") | color(terminalColor(palette().accent)) | bold,
        text(" TUI") | bold,
        std::move(profileElement),
        filler(),
        state.expandedPanel
            ? text("FOCUS • " + panelName(*state.expandedPanel) + " ") |
                color(terminalColor(palette().accent))
            : state.layoutEditing
                ? text(rackStatus.str() + " ") |
                    color(terminalColor(palette().accent)) | bold
                : text(rackStatus.str() + " ") | dim,
    });
}

ftxui::Element renderFooter(const DisplayFrame& frame,
                            const InterfaceState& state,
                            int width) {
    using namespace ftxui;
    const bool compact = width < 108;
    const bool minimal = width < 64;
    if (state.layoutEditing) {
        const std::string essentialControls = "a add • ? help • Enter done";
        if (!state.layoutStatus.empty()) {
            if (width < 80) {
                return text(" " + state.layoutStatus) |
                    color(terminalColor(palette().accent));
            }
            return hbox({
                text(" " + state.layoutStatus) |
                    color(terminalColor(palette().accent)) | bold,
                filler(),
                text(essentialControls + " ") |
                    color(terminalColor(palette().muted)),
            });
        }
        const std::string controls = width < 64
            ? essentialControls
            : width < 110
                ? "arrows select • Shift+arrows move • a add • ? help • Enter done"
                : width < 160
                    ? "arrows select • Shift+arrows move • [ ] width • a add • x remove • ? help • Enter done"
                    : "arrows select • Shift+arrows move • [] width • ,. height • n new row • a add • x remove • ? help • Enter done";
        return text(controls + " ") |
            color(terminalColor(palette().accent)) | align_right;
    }
    const std::string enterAction = state.expandedPanel ? "restore" : "expand";
    const std::string controls = minimal
        ? "Tab • Enter • o • p • s • q"
        : compact
            ? "Tab focus • Enter " + enterAction +
                " • o outputs • p profiles • s settings • q quit"
            : "Tab focus • Enter " + enterAction +
                " • o outputs • p profiles • s settings • l edit layout • r reset • q quit";
    auto status = text(makeCaptureStatus(frame, state.settings, compact)) | dim;
    if (frame.captureOverrun) {
        status = status | color(terminalColor(palette().danger));
    }
    return hbox({
        status,
        filler(),
        text(controls) | dim,
    });
}

ftxui::Element settingsRow(const std::string& label,
                           const std::string& value,
                           bool selected) {
    using namespace ftxui;
    auto row = hbox({
        text(selected ? " › " : "   "),
        text(label),
        filler(),
        text(value),
        text(" "),
    });
    if (selected) {
        row = row | color(terminalColor(palette().accent)) | bold |
            bgcolor(terminalColor(palette().selection));
    } else {
        row = row | color(terminalColor(palette().text));
    }
    return row | size(HEIGHT, EQUAL, 1);
}

ftxui::Element renderLayoutAddScope(const InterfaceState& state,
                                    int width,
                                    int height) {
    using namespace ftxui;
    const int contentWidth = std::max(1, width - 2);
    const int contentHeight = std::max(1, height - 2);
    const auto removed = removedRackPanels(state.settings.rackLayout);
    Elements rows;
    if (removed.empty()) {
        rows.push_back(filler());
        rows.push_back(
            text("All seven scopes are already in the rack.") |
            color(terminalColor(palette().muted)) | center);
        rows.push_back(filler());
    } else {
        const size_t selected = std::min(
            state.layoutAddSelection, removed.size() - 1);
        const size_t maximumVisible = static_cast<size_t>(
            std::max(1, contentHeight - 8));
        const size_t firstVisible = selected >= maximumVisible
            ? selected - maximumVisible + 1
            : 0;
        const size_t lastVisible = std::min(
            removed.size(), firstVisible + maximumVisible);
        for (size_t index = firstVisible; index < lastVisible; ++index) {
            rows.push_back(settingsRow(
                panelNumber(removed[index]) + "  " + panelName(removed[index]),
                index == selected ? "add" : "",
                index == selected));
        }
        rows.push_back(filler());
    }

    std::string destination = "after " + panelName(state.focusedPanel);
    if (const auto location = rackPanelLocation(
            state.settings.rackLayout, state.focusedPanel)) {
        destination += " in row " + std::to_string(location->first + 1);
    }
    auto content = vbox({
        text(" PRISM / EDIT LAYOUT / ADD SCOPE") |
            color(terminalColor(palette().accent)) | bold,
        separator(),
        removed.empty()
            ? text("Nothing to restore.") | dim
            : text("Choose a removed scope. It will be inserted " + destination + ".") | dim,
        separatorEmpty(),
        vbox(std::move(rows)),
        separator(),
        text(removed.empty()
            ? "Esc back"
            : "↑↓ select  •  Enter add  •  Esc back") | dim,
    }) | size(WIDTH, EQUAL, contentWidth) |
        size(HEIGHT, EQUAL, contentHeight);
    return std::move(content) | borderRounded |
        size(WIDTH, EQUAL, width) |
        size(HEIGHT, EQUAL, height);
}

ftxui::Element renderLayoutHelp(int width, int height) {
    using namespace ftxui;
    const int contentWidth = std::max(1, width - 2);
    const int contentHeight = std::max(1, height - 2);
    Elements instructions;
    if (contentHeight < 15) {
        instructions.push_back(text("Arrows select • Shift+arrows move."));
        instructions.push_back(text("Ctrl+arrows or H/J/K/L also move."));
        instructions.push_back(text("[ ] scope width • , . row height."));
        instructions.push_back(text("a adds by name • x removes."));
    } else {
        instructions.push_back(text("Arrow keys          Select the nearest scope spatially."));
        instructions.push_back(text("Tab / Shift-Tab     Select the next or previous visible scope."));
        instructions.push_back(text("Shift + arrows      Reorder within a row or move between rows."));
        instructions.push_back(text("Ctrl + arrows       Movement fallback for terminal compatibility."));
        instructions.push_back(text("H / J / K / L       Additional movement fallback (uppercase)."));
        instructions.push_back(text("[ / ]             Make the selected scope narrower or wider."));
        instructions.push_back(text(", / .             Make the selected row shorter or taller."));
        instructions.push_back(text("n                 Move the scope into a new row (three maximum)."));
        instructions.push_back(text("x                 Remove the selected scope."));
        instructions.push_back(text("a                 Add a removed scope by name."));
    }

    auto content = vbox({
        text(" PRISM / EDIT LAYOUT / HELP") |
            color(terminalColor(palette().accent)) | bold,
        separator(),
        vbox(std::move(instructions)),
        filler(),
        contentHeight >= 12
            ? text("Changes are saved immediately.") |
                color(terminalColor(palette().muted))
            : emptyElement(),
        separator(),
        text("? / Esc back") | dim,
    }) | size(WIDTH, EQUAL, contentWidth) |
        size(HEIGHT, EQUAL, contentHeight);
    return std::move(content) | borderRounded |
        size(WIDTH, EQUAL, width) |
        size(HEIGHT, EQUAL, height);
}

ftxui::Element renderSettings(const InterfaceState& state,
                              int width,
                              int height) {
    using namespace ftxui;
    const int contentWidth = std::max(1, width - 2);
    const int contentHeight = std::max(1, height - 2);
    const std::string breadcrumb = state.settingsPage == SettingsPage::Home
        ? " PRISM / SETTINGS"
        : " PRISM / SETTINGS › " + std::string(settingsPageName(state.settingsPage));
    Elements rows;
    std::string selectedDescription;
    const size_t maximumVisibleRows = static_cast<size_t>(
        std::max(1, contentHeight - 8));
    if (state.settingsPage == SettingsPage::Home) {
        const auto pages = settingsPages();
        const size_t selectedIndex = std::min(
            state.settingsHomeSelection,
            pages.empty() ? size_t{0} : pages.size() - 1);
        const size_t firstVisible = selectedIndex >= maximumVisibleRows
            ? selectedIndex - maximumVisibleRows + 1
            : 0;
        const size_t lastVisible = std::min(
            pages.size(), firstVisible + maximumVisibleRows);
        for (size_t index = firstVisible; index < lastVisible; ++index) {
            const bool selected = index == state.settingsHomeSelection;
            rows.push_back(settingsRow(
                std::to_string(index + 1) + "  " + settingsPageName(pages[index]),
                {},
                selected));
            if (selected) selectedDescription = settingsPageDescription(pages[index]);
        }
    } else {
        const auto& settings = settingsForPage(state.settingsPage);
        const size_t selectedIndex = std::min(
            settingsSelection(state),
            settings.empty() ? size_t{0} : settings.size() - 1);
        const size_t firstVisible = selectedIndex >= maximumVisibleRows
            ? selectedIndex - maximumVisibleRows + 1
            : 0;
        const size_t lastVisible = std::min(
            settings.size(), firstVisible + maximumVisibleRows);
        for (size_t index = firstVisible; index < lastVisible; ++index) {
            const bool selected = index == selectedIndex;
            rows.push_back(settingsRow(
                settings[index].name,
                settingValue(state.settings, settings[index].id),
                selected));
            if (selected) selectedDescription = settings[index].description;
        }
    }

    const std::string controls = state.settingsPage == SettingsPage::Home
        ? "↑↓ select  •  Enter open  •  s/Esc dashboard"
        : contentWidth < 76
            ? "↑↓ select  •  ←→ adjust  •  Enter  •  Esc back"
            : "↑↓ select  •  ←→ adjust  •  Enter toggle  •  Backspace default  •  Esc back";
    auto content = vbox({
        text(breadcrumb) | color(terminalColor(palette().accent)) | bold,
        separator(),
        text(settingsPageDescription(state.settingsPage)) | dim,
        separatorEmpty(),
        vbox(std::move(rows)),
        filler(),
        text(selectedDescription) | color(terminalColor(palette().muted)),
        state.settingsStatus.empty()
            ? emptyElement()
            : text(state.settingsStatus) | color(terminalColor(palette().danger)),
        separator(),
        text(controls) | dim,
    }) | size(WIDTH, EQUAL, contentWidth) |
        size(HEIGHT, EQUAL, contentHeight);
    return std::move(content) | borderRounded |
        size(WIDTH, EQUAL, width) |
        size(HEIGHT, EQUAL, height);
}

std::string outputFormat(const Prism::Capture::OutputDevice& device) {
    std::ostringstream result;
    const double kilohertz = device.sampleRate / 1000.0;
    result << std::fixed << std::setprecision(
        std::abs(kilohertz - std::round(kilohertz)) < 0.01 ? 0 : 1)
           << kilohertz << " kHz • " << device.channelCount << " ch";
    if (device.isDefault) result << " • default";
    return result.str();
}

ftxui::Element renderOutputs(const DisplayFrame& frame,
                             const InterfaceState& state,
                             int width,
                             int height) {
    using namespace ftxui;
    const int contentWidth = std::max(1, width - 2);
    const int contentHeight = std::max(1, height - 2);
    const size_t choiceCount = state.outputDevices.size() + 1;
    const size_t selected = std::min(
        state.outputSelection, choiceCount - 1);
    const size_t maximumVisibleRows = static_cast<size_t>(
        std::max(1, contentHeight - 9));
    const size_t firstVisible = selected >= maximumVisibleRows
        ? selected - maximumVisibleRows + 1
        : 0;
    const size_t lastVisible = std::min(
        choiceCount, firstVisible + maximumVisibleRows);

    Elements rows;
    for (size_t index = firstVisible; index < lastVisible; ++index) {
        const bool isSelected = index == selected;
        const bool followsDefault = index == 0;
        const bool isActive = followsDefault
            ? state.activeRequestedDeviceId.empty()
            : state.activeRequestedDeviceId == state.outputDevices[index - 1].id;
        const std::string label = followsDefault
            ? "Follow system default"
            : state.outputDevices[index - 1].label;
        const std::string format = followsDefault
            ? "automatic"
            : outputFormat(state.outputDevices[index - 1]);
        auto row = hbox({
            text(isSelected ? " › " : "   "),
            text(isActive ? "● " : "  ") |
                color(terminalColor(
                    isActive ? palette().accent : palette().muted)),
            text(label) | (isSelected ? bold : dim) | flex,
            text("  " + format + " ") | dim,
        });
        rows.push_back(isSelected
            ? std::move(row) |
                bgcolor(terminalColor(palette().selection)) |
                color(terminalColor(palette().accent))
            : std::move(row));
    }

    std::string selectionDescription;
    if (selected == 0) {
        selectionDescription =
            "Uses whichever output the operating system currently considers default.";
    } else {
        const auto& device = state.outputDevices[selected - 1];
        selectionDescription = contentWidth < 76
            ? device.id
            : "Output ID: " + device.id;
    }
    const std::string active = "Active: " +
        (frame.device.empty() ? std::string("unknown output") : frame.device) +
        (state.activeRequestedDeviceId.empty()
            ? " • following system default"
            : " • explicitly selected");

    auto content = vbox({
        text(" PRISM / OUTPUTS") |
            color(terminalColor(palette().accent)) | bold,
        separator(),
        text(active) | color(terminalColor(palette().text)),
        separatorEmpty(),
        vbox(std::move(rows)),
        filler(),
        text(selectionDescription) | color(terminalColor(palette().muted)),
        state.outputStatus.empty()
            ? emptyElement()
            : text(state.outputStatus) | color(terminalColor(
                state.outputStatusError
                    ? palette().danger
                    : palette().accent)),
        separator(),
        text(state.outputSwitching
            ? "Switching output…  •  Esc keeps this screen open until complete"
            : "↑↓ select  •  Enter switch  •  r refresh  •  o/Esc dashboard") | dim,
    }) | size(WIDTH, EQUAL, contentWidth) |
        size(HEIGHT, EQUAL, contentHeight);
    return std::move(content) | borderRounded |
        size(WIDTH, EQUAL, width) |
        size(HEIGHT, EQUAL, height);
}

ftxui::Element renderProfiles(const InterfaceState& state,
                              int width,
                              int height) {
    using namespace ftxui;
    const int contentWidth = std::max(1, width - 2);
    const int contentHeight = std::max(1, height - 2);
    const auto selectedIndex = state.profiles.empty()
        ? size_t{0}
        : std::min(state.profileSelection, state.profiles.size() - 1);
    const TuiProfile* selected = state.profiles.empty()
        ? nullptr
        : &state.profiles[selectedIndex];
    const TuiProfile* active = activeProfile(state);
    const bool dirty = hasUnsavedProfileChanges(state);

    if (state.profileMode == ProfileOverlayMode::Browse) {
        Elements rows;
        const size_t maximumVisibleRows = static_cast<size_t>(
            std::max(1, contentHeight - 8));
        const size_t firstVisible = selectedIndex >= maximumVisibleRows
            ? selectedIndex - maximumVisibleRows + 1
            : 0;
        const size_t lastVisible = std::min(
            state.profiles.size(), firstVisible + maximumVisibleRows);
        for (size_t index = firstVisible; index < lastVisible; ++index) {
            const auto& profile = state.profiles[index];
            const bool isSelected = index == selectedIndex;
            const bool isActive = profile.id == state.activeProfileId;
            auto row = hbox({
                text(isSelected ? " › " : "   "),
                text(isActive ? "● " : "  ") |
                    color(terminalColor(
                        isActive ? palette().accent : palette().muted)),
                text(profile.name) | (isSelected ? bold : dim),
                isActive && dirty
                    ? text("  * modified") |
                        color(terminalColor(palette().warning))
                    : emptyElement(),
                filler(),
                profile.isDefault ? text("default ") | dim : emptyElement(),
            });
            rows.push_back(isSelected
                ? std::move(row) | bgcolor(terminalColor(palette().selection)) |
                    color(terminalColor(palette().accent))
                : std::move(row));
        }
        const std::string activeDescription = active
            ? "Active: " + active->name + (dirty ? "  •  modified" : "")
            : dirty
                ? "Working setup is not saved to a profile."
                : "No active profile.";
        auto content = vbox({
            text(" PRISM / PROFILES") |
                color(terminalColor(palette().accent)) | bold,
            separator(),
            text(activeDescription) |
                (dirty
                    ? color(terminalColor(palette().warning))
                    : color(terminalColor(palette().text))),
            separatorEmpty(),
            vbox(std::move(rows)),
            filler(),
            state.profileStatus.empty()
                ? emptyElement()
                : text(state.profileStatus) | color(
                    terminalColor(state.profileStatusError
                        ? palette().danger
                        : palette().accent)),
            separator(),
            text(contentWidth < 60
                ? "↑↓ select • Enter load • n save • Esc"
                : contentWidth < 74
                    ? "↑↓ select • Enter load • n new • w write • Esc"
                : "↑↓ select  •  Enter load  •  n save as  •  w overwrite  •  r rename  •  d delete  •  Esc") | dim,
        }) | size(WIDTH, EQUAL, contentWidth) |
            size(HEIGHT, EQUAL, contentHeight);
        return std::move(content) | borderRounded |
            size(WIDTH, EQUAL, width) |
            size(HEIGHT, EQUAL, height);
    }

    std::string title;
    std::string message;
    std::string controls = "Enter confirm  •  Esc cancel";
    Element action = emptyElement();
    switch (state.profileMode) {
        case ProfileOverlayMode::SaveAs:
            title = " PRISM / PROFILES / SAVE AS";
            message = state.pendingProfileId.empty()
                ? "Save the current rack and scope settings as a new profile."
                : "Save the current setup before loading another profile.";
            action = hbox({
                text(" Name  ") | dim,
                text(state.profileInput.empty() ? " " : state.profileInput) | bold,
                text("▌") | color(terminalColor(palette().accent)),
            }) | border;
            break;
        case ProfileOverlayMode::Rename:
            title = " PRISM / PROFILES / RENAME";
            message = selected
                ? "Rename “" + selected->name + "”."
                : "Choose a profile to rename.";
            action = hbox({
                text(" Name  ") | dim,
                text(state.profileInput.empty() ? " " : state.profileInput) | bold,
                text("▌") | color(terminalColor(palette().accent)),
            }) | border;
            break;
        case ProfileOverlayMode::ConfirmOverwrite:
            title = " PRISM / PROFILES / OVERWRITE";
            message = active
                ? "Replace “" + active->name + "” with the current setup?"
                : "There is no active profile to overwrite.";
            action = text("This changes the saved .prsmt file.") |
                color(terminalColor(palette().warning));
            break;
        case ProfileOverlayMode::ConfirmDelete:
            title = " PRISM / PROFILES / DELETE";
            message = selected
                ? "Delete “" + selected->name + "”?"
                : "Choose a profile to delete.";
            action = text("This cannot be undone.") |
                color(terminalColor(palette().danger));
            controls = "d confirm delete  •  Esc cancel";
            break;
        case ProfileOverlayMode::ConfirmLoad:
            title = " PRISM / PROFILES / UNSAVED CHANGES";
            message = "Loading another profile will replace the current setup.";
            action = contentWidth < 60
                ? active
                    ? vbox({
                        text("w  save active profile, then load"),
                        text("n  save as a new profile, then load"),
                        text("d  discard changes and load"),
                    }) | color(terminalColor(palette().warning))
                    : vbox({
                        text("n  save as a new profile, then load"),
                        text("d  discard changes and load"),
                    }) | color(terminalColor(palette().warning))
                : text(active
                    ? "w save & load  •  n save as & load  •  d discard & load"
                    : "n save as & load  •  d discard & load") |
                    color(terminalColor(palette().warning));
            controls = "Choose an action  •  Esc cancel";
            break;
        case ProfileOverlayMode::Browse:
            break;
    }
    auto content = vbox({
        text(title) | color(terminalColor(palette().accent)) | bold,
        separator(),
        text(message),
        separatorEmpty(),
        std::move(action),
        filler(),
        state.profileStatus.empty()
            ? emptyElement()
            : text(state.profileStatus) | color(
                terminalColor(state.profileStatusError
                    ? palette().danger
                    : palette().accent)),
        separator(),
        text(controls) | dim,
    }) | size(WIDTH, EQUAL, contentWidth) |
        size(HEIGHT, EQUAL, contentHeight);
    return std::move(content) | borderRounded |
        size(WIDTH, EQUAL, width) |
        size(HEIGHT, EQUAL, height);
}

ftxui::Element renderFrame(const DisplayFrame& frame,
                           int width,
                           int height,
                           const InterfaceState& state) {
    using namespace ftxui;
    const auto layout = buildDashboardLayout(
        width, height, state.settings.rackLayout, state.expandedPanel);
    if (layout.terminalTooSmall) {
        return vbox({
            filler(),
            text("PRISM TUI") | bold |
                color(terminalColor(palette().accent)) | center,
            text("Terminal too small — need at least 44 × 12") | center,
            text("q quit") | dim | center,
            filler(),
        });
    }

    auto dashboard = vbox({
        renderHeader(layout, state, width) | size(HEIGHT, EQUAL, 1),
        renderLayoutNode(layout.root, layout, frame, state),
        renderFooter(frame, state, width) | size(HEIGHT, EQUAL, 1),
    });
    if (state.outputsOpen) {
        const int outputsWidth = std::min(96, std::max(44, width - 4));
        const int outputsHeight = std::min(20, std::max(12, height - 2));
        return dbox({
            std::move(dashboard) | dim,
            renderOutputs(frame, state, outputsWidth, outputsHeight) |
                borderEmpty | clear_under | center,
        });
    }
    if (state.profilesOpen) {
        const int profilesWidth = std::min(92, std::max(44, width - 4));
        const int profilesHeight = std::min(18, std::max(12, height - 2));
        return dbox({
            std::move(dashboard) | dim,
            renderProfiles(state, profilesWidth, profilesHeight) |
                borderEmpty | clear_under | center,
        });
    }
    if (state.settingsOpen) {
        const int settingsWidth = std::min(84, std::max(40, width - 4));
        const int settingsHeight = std::min(16, std::max(10, height - 2));
        return dbox({
            std::move(dashboard) | dim,
            renderSettings(state, settingsWidth, settingsHeight) |
                borderEmpty | clear_under | center,
        });
    }
    if (state.layoutEditing && state.layoutOverlay != LayoutOverlay::None) {
        const bool help = state.layoutOverlay == LayoutOverlay::Help;
        const int overlayWidth = std::min(
            help ? 84 : 72, std::max(40, width - 4));
        const int overlayHeight = std::min(
            help ? 18 : 16, std::max(10, height - 2));
        auto overlay = help
            ? renderLayoutHelp(overlayWidth, overlayHeight)
            : renderLayoutAddScope(state, overlayWidth, overlayHeight);
        return dbox({
            std::move(dashboard) | dim,
            std::move(overlay) | borderEmpty | clear_under | center,
        });
    }
    return dashboard;
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
                   const Prism::Capture::StartResult& started,
                   std::string requestedDeviceId,
                   std::vector<Prism::Capture::OutputDevice> outputDevices) {
    using namespace ftxui;
    signalRequested = 0;
    SignalHandlerGuard signalHandlerGuard;

    ScreenInteractive screen = ScreenInteractive::Fullscreen();
    SnapshotStore<DisplayFrame> frameStore;
    SnapshotStore<TuiSettings> settingsStore;
    SnapshotStore<OutputSwitchRequest> outputSwitchRequestStore;
    SnapshotStore<OutputSwitchNotice> outputSwitchNoticeStore;
    SnapshotStore<OutputListNotice> outputListNoticeStore;
    InterfaceState interfaceState;
    interfaceState.outputDevices = std::move(outputDevices);
    interfaceState.activeRequestedDeviceId = requestedDeviceId;
    const std::filesystem::path settingsPath = defaultSettingsPath();
    interfaceState.settings = loadSettings(settingsPath);
    IroThemeLibrary themeLibrary(defaultIroThemeDirectory());
    std::string themeLoadWarning;
    if (!themeLibrary.load(&themeLoadWarning)) {
        interfaceState.settingsStatus = themeLoadWarning;
    } else if (!themeLoadWarning.empty()) {
        interfaceState.settingsStatus = themeLoadWarning;
    }
    if (!themeLibrary.find(interfaceState.settings.themeId)) {
        interfaceState.settings.themeId = "Default";
    }
    interfaceState.theme = themeLibrary.resolve(interfaceState.settings.themeId);
    TuiProfileLibrary profileLibrary(
        defaultProfileDirectory(), defaultProfileStatePath());
    std::string profileLoadError;
    if (!profileLibrary.load(&profileLoadError)) {
        interfaceState.profileStatus =
            "Could not load profiles: " + profileLoadError;
        interfaceState.profileStatusError = true;
    }
    interfaceState.profiles = profileLibrary.profiles();
    interfaceState.activeProfileId = profileLibrary.activeProfileId();
    interfaceState.profileDirty =
        calculateUnsavedProfileChanges(interfaceState);
    settingsStore.publish(interfaceState.settings);
    DisplayFrame initial;
    initial.magnitudes.assign(kDefaultFftSize / 2, -100.0f);
    initial.sampleRate = started.sampleRate;
    initial.backend = capture->backendName();
    initial.device = started.deviceLabel.empty() ? started.deviceId : started.deviceLabel;
    frameStore.publish(initial);

    std::atomic<bool> running{true};
    std::atomic<bool> resetRequested{false};
    std::atomic<bool> redrawQueued{false};
    std::atomic<uint64_t> outputListRequested{0};
    std::exception_ptr workerError;
    auto exitLoop = screen.ExitLoopClosure();

    std::thread worker([&]() {
        try {
            TuiSettings appliedSettings = settingsStore.read();
            const auto makePipeline = [&](double sampleRate) {
                auto next = std::make_unique<AnalysisPipeline>(
                    static_cast<float>(sampleRate));
                next->setInputTrimDb(appliedSettings.inputTrimDb);
                next->setSpectrumTilt(appliedSettings.spectrumTiltDbPerOctave);
                next->setOscilloscopePitchLock(
                    appliedSettings.oscilloscopePitchLock);
                applySpectrogramSettings(*next, appliedSettings);
                applyWaveformSettings(*next, appliedSettings);
                return next;
            };
            auto pipeline = makePipeline(started.sampleRate);
            Prism::Capture::StartResult activeStarted = started;
            std::string activeRequestedDeviceId = requestedDeviceId;
            uint64_t handledOutputSwitchSerial = 0;
            uint64_t handledOutputListSerial = 0;

            bool captureOverrun = false;
            auto nextFrameAt = std::chrono::steady_clock::now();
            while (running.load()) {
                if (signalRequested != 0) {
                    running.store(false);
                    exitLoop();
                    break;
                }
                const uint64_t requestedOutputListSerial =
                    outputListRequested.load();
                if (requestedOutputListSerial > handledOutputListSerial) {
                    handledOutputListSerial = requestedOutputListSerial;
                    outputListNoticeStore.publish({
                        requestedOutputListSerial,
                        capture->listOutputDevices(),
                    });
                    if (running.load() && !redrawQueued.exchange(true)) {
                        screen.PostEvent(Event::Custom);
                    }
                }

                const OutputSwitchRequest outputSwitchRequest =
                    outputSwitchRequestStore.read();
                if (outputSwitchRequest.serial > handledOutputSwitchSerial) {
                    handledOutputSwitchSerial = outputSwitchRequest.serial;
                    const auto outcome = switchOutputCapture(
                        *capture,
                        activeRequestedDeviceId,
                        activeStarted,
                        outputSwitchRequest.requestedDeviceId);
                    if (outcome.captureRunning) {
                        activeStarted = outcome.started;
                        activeRequestedDeviceId = outcome.requestedDeviceId;
                        pipeline = makePipeline(activeStarted.sampleRate);
                        captureOverrun = false;
                        nextFrameAt = std::chrono::steady_clock::now();
                    }
                    outputSwitchNoticeStore.publish({
                        outputSwitchRequest.serial,
                        true,
                        outcome.success,
                        outcome.requestedDeviceId,
                        outcome.started,
                        outcome.error,
                    });
                    if (running.load() && !redrawQueued.exchange(true)) {
                        screen.PostEvent(Event::Custom);
                    }
                    if (!outcome.captureRunning) {
                        throw std::runtime_error(outcome.error);
                    }
                }
                if (resetRequested.exchange(false)) {
                    pipeline->reset();
                    captureOverrun = false;
                }

                const TuiSettings requestedSettings = settingsStore.read();
                if (requestedSettings != appliedSettings) {
                    const bool refreshChanged =
                        requestedSettings.refreshRate != appliedSettings.refreshRate;
                    pipeline->setInputTrimDb(requestedSettings.inputTrimDb);
                    pipeline->setSpectrumTilt(
                        requestedSettings.spectrumTiltDbPerOctave);
                    pipeline->setOscilloscopePitchLock(
                        requestedSettings.oscilloscopePitchLock);
                    const bool spectrogramAnalysisChanged =
                        requestedSettings.spectrogramClarity != appliedSettings.spectrogramClarity ||
                        requestedSettings.spectrogramScale != appliedSettings.spectrogramScale ||
                        requestedSettings.spectrogramOrientation != appliedSettings.spectrogramOrientation ||
                        requestedSettings.spectrogramScrollSpeed != appliedSettings.spectrogramScrollSpeed ||
                        requestedSettings.spectrogramContrast != appliedSettings.spectrogramContrast ||
                        requestedSettings.spectrogramTiltDbPerOctave != appliedSettings.spectrogramTiltDbPerOctave;
                    if (spectrogramAnalysisChanged) {
                        applySpectrogramSettings(*pipeline, requestedSettings);
                    }
                    if (requestedSettings.waveformMode != appliedSettings.waveformMode ||
                        requestedSettings.waveformScrollSpeed != appliedSettings.waveformScrollSpeed) {
                        applyWaveformSettings(*pipeline, requestedSettings);
                    }
                    appliedSettings = requestedSettings;
                    if (refreshChanged) {
                        nextFrameAt = std::chrono::steady_clock::now();
                    }
                }

                drainCapture(*capture, *pipeline, captureOverrun);

                const auto now = std::chrono::steady_clock::now();
                if (now >= nextFrameAt) {
                    DisplayFrame next;
                    auto analyzed = pipeline->snapshot();
                    next.magnitudes = std::move(analyzed.magnitudes);
                    next.spectrumPeak = std::move(analyzed.spectrumPeak);
                    next.vu = analyzed.vu;
                    next.lufs = analyzed.lufs;
                    next.oscilloscope = std::move(analyzed.oscilloscope);
                    next.vectorscope = std::move(analyzed.vectorscope);
                    next.spectrogram = std::move(analyzed.spectrogram);
                    next.waveform = std::move(analyzed.waveform);
                    next.sampleRate = activeStarted.sampleRate;
                    next.backend = capture->backendName();
                    next.device = activeStarted.deviceLabel.empty()
                        ? activeStarted.deviceId
                        : activeStarted.deviceLabel;
                    next.captureOverrun = captureOverrun;
                    frameStore.publish(std::move(next));
                    if (running.load() && !redrawQueued.exchange(true)) {
                        screen.PostEvent(Event::Custom);
                    }
                    nextFrameAt = now +
                        displayFrameInterval(appliedSettings.refreshRate);
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
        renderTheme = &interfaceState.theme;
        return renderFrame(
            frameStore.read(), screen.dimx(), screen.dimy(), interfaceState) |
            color(terminalColor(interfaceState.theme.text)) |
            bgcolor(terminalColor(interfaceState.theme.background));
    });
    const auto persistSettings = [&]() {
        interfaceState.settings = normalizeSettings(interfaceState.settings);
        if (!themeLibrary.find(interfaceState.settings.themeId)) {
            interfaceState.settings.themeId = "Default";
        }
        interfaceState.theme = themeLibrary.resolve(interfaceState.settings.themeId);
        interfaceState.profileDirty =
            calculateUnsavedProfileChanges(interfaceState);
        settingsStore.publish(interfaceState.settings);
        std::string error;
        if (!saveSettings(interfaceState.settings, settingsPath, &error)) {
            interfaceState.settingsStatus = "Settings were applied but could not be saved: " + error;
        } else {
            interfaceState.settingsStatus.clear();
        }
    };
    const auto syncProfiles = [&]() {
        interfaceState.profiles = profileLibrary.profiles();
        interfaceState.activeProfileId = profileLibrary.activeProfileId();
        interfaceState.profileDirty =
            calculateUnsavedProfileChanges(interfaceState);
        if (interfaceState.profiles.empty()) {
            interfaceState.profileSelection = 0;
        } else {
            interfaceState.profileSelection = std::min(
                interfaceState.profileSelection,
                interfaceState.profiles.size() - 1);
        }
    };
    const auto selectProfile = [&](const std::string& id) {
        const auto found = std::find_if(
            interfaceState.profiles.begin(),
            interfaceState.profiles.end(),
            [&](const auto& profile) { return profile.id == id; });
        if (found != interfaceState.profiles.end()) {
            interfaceState.profileSelection = static_cast<size_t>(
                std::distance(interfaceState.profiles.begin(), found));
        }
    };
    const auto loadProfile = [&](const std::string& id) {
        const auto* profile = profileLibrary.find(id);
        if (!profile) {
            interfaceState.profileStatus = "Profile was not found.";
            interfaceState.profileStatusError = true;
            return false;
        }
        const TuiSettings loaded = applyProfileSettings(
            profile->settings, interfaceState.settings);
        std::string error;
        if (!profileLibrary.activate(id, &error)) {
            interfaceState.profileStatus = "Could not activate profile: " + error;
            interfaceState.profileStatusError = true;
            return false;
        }
        interfaceState.settings = loaded;
        interfaceState.expandedPanel.reset();
        persistSettings();
        const auto dashboard = buildDashboardLayout(
            screen.dimx(),
            screen.dimy(),
            interfaceState.settings.rackLayout);
        if (!layoutContainsPanel(dashboard, interfaceState.focusedPanel)) {
            const auto visible = visiblePanelOrder(dashboard);
            if (!visible.empty()) interfaceState.focusedPanel = visible.front();
        }
        syncProfiles();
        selectProfile(id);
        interfaceState.profileStatus = "Loaded " + profile->name;
        interfaceState.profileStatusError = false;
        return true;
    };
    const auto closeSettings = [&]() {
        interfaceState.settingsOpen = false;
        interfaceState.settingsPage = SettingsPage::Home;
        const auto dashboard = buildDashboardLayout(
            screen.dimx(),
            screen.dimy(),
            interfaceState.settings.rackLayout,
            interfaceState.expandedPanel);
        if (!interfaceState.expandedPanel &&
            !layoutContainsPanel(dashboard, interfaceState.focusedPanel)) {
            const auto visible = visiblePanelOrder(dashboard);
            if (!visible.empty()) interfaceState.focusedPanel = visible.front();
        }
    };
    const auto panelForEvent = [](const Event& event) -> std::optional<PanelId> {
        if (event == Event::Character('1')) return PanelId::Spectrum;
        if (event == Event::Character('2')) return PanelId::Oscilloscope;
        if (event == Event::Character('3')) return PanelId::Vectorscope;
        if (event == Event::Character('4')) return PanelId::VUMeter;
        if (event == Event::Character('5')) return PanelId::LUFSMeter;
        if (event == Event::Character('6')) return PanelId::Spectrogram;
        if (event == Event::Character('7')) return PanelId::Waveform;
        return std::nullopt;
    };
    const auto addedScopeStatus = [&](PanelId panel) {
        const auto dashboard = buildDashboardLayout(
            screen.dimx(), screen.dimy(), interfaceState.settings.rackLayout);
        return "Added " + panelName(panel) +
            (layoutContainsPanel(dashboard, panel)
                ? ""
                : " • hidden at this terminal size");
    };
    const auto selectedOutputRequest = [&]() {
        if (interfaceState.outputSelection == 0 ||
            interfaceState.outputDevices.empty()) {
            return std::string{};
        }
        const size_t index = std::min(
            interfaceState.outputSelection - 1,
            interfaceState.outputDevices.size() - 1);
        return interfaceState.outputDevices[index].id;
    };
    const auto selectOutputRequest = [&](const std::string& id) {
        if (id.empty()) {
            interfaceState.outputSelection = 0;
            return;
        }
        const auto found = std::find_if(
            interfaceState.outputDevices.begin(),
            interfaceState.outputDevices.end(),
            [&](const auto& device) { return device.id == id; });
        interfaceState.outputSelection = found == interfaceState.outputDevices.end()
            ? 0
            : static_cast<size_t>(
                std::distance(interfaceState.outputDevices.begin(), found)) + 1;
    };
    const auto requestOutputList = [&]() {
        interfaceState.outputStatus = "Refreshing available outputs…";
        interfaceState.outputStatusError = false;
        outputListRequested.store(++interfaceState.outputListSerial);
    };
    selectOutputRequest(interfaceState.activeRequestedDeviceId);
    auto component = CatchEvent(renderer, [&](Event event) {
        if (event == Event::Custom) {
            redrawQueued.store(false);
            const OutputListNotice outputList = outputListNoticeStore.read();
            if (outputList.serial > interfaceState.appliedOutputListSerial) {
                const bool selectedDefault =
                    interfaceState.outputSelection == 0;
                const std::string selectedRequest = selectedOutputRequest();
                interfaceState.appliedOutputListSerial = outputList.serial;
                if (outputList.devices.empty()) {
                    interfaceState.outputStatus =
                        "No outputs were reported; current capture is unchanged.";
                    interfaceState.outputStatusError = true;
                } else {
                    interfaceState.outputDevices = outputList.devices;
                    selectOutputRequest(selectedDefault
                        ? std::string{}
                        : selectedRequest);
                    if (!interfaceState.outputSwitching) {
                        interfaceState.outputStatus =
                            std::to_string(interfaceState.outputDevices.size()) +
                            (interfaceState.outputDevices.size() == 1
                                ? " output available."
                                : " outputs available.");
                        interfaceState.outputStatusError = false;
                    }
                }
            }
            const OutputSwitchNotice outputSwitch =
                outputSwitchNoticeStore.read();
            if (outputSwitch.complete &&
                outputSwitch.serial > interfaceState.appliedOutputSwitchSerial) {
                interfaceState.appliedOutputSwitchSerial = outputSwitch.serial;
                interfaceState.outputSwitching = false;
                interfaceState.activeRequestedDeviceId =
                    outputSwitch.activeRequestedDeviceId;
                selectOutputRequest(interfaceState.activeRequestedDeviceId);
                interfaceState.outputStatusError = !outputSwitch.success;
                if (outputSwitch.success) {
                    const std::string label = outputSwitch.started.deviceLabel.empty()
                        ? outputSwitch.started.deviceId
                        : outputSwitch.started.deviceLabel;
                    interfaceState.outputStatus = "Now using " + label + ".";
                } else {
                    interfaceState.outputStatus = outputSwitch.error;
                }
            }
            return false;
        }
        if (event == Event::CtrlC) {
            running.store(false);
            exitLoop();
            return true;
        }
        if (interfaceState.outputsOpen) {
            if ((event == Event::Escape || event == Event::Character('o')) &&
                !interfaceState.outputSwitching) {
                interfaceState.outputsOpen = false;
                interfaceState.outputStatus.clear();
                return true;
            }
            if (interfaceState.outputSwitching) {
                return true;
            }
            const size_t choiceCount = interfaceState.outputDevices.size() + 1;
            if (event == Event::ArrowUp || event == Event::ArrowDown) {
                const int direction = event == Event::ArrowDown ? 1 : -1;
                interfaceState.outputSelection = static_cast<size_t>(
                    (static_cast<int>(interfaceState.outputSelection) +
                        direction + static_cast<int>(choiceCount)) %
                    static_cast<int>(choiceCount));
                interfaceState.outputStatus.clear();
                interfaceState.outputStatusError = false;
                return true;
            }
            if (event == Event::Character('r')) {
                requestOutputList();
                return true;
            }
            if (event == Event::Return) {
                const std::string nextOutput = selectedOutputRequest();
                if (nextOutput == interfaceState.activeRequestedDeviceId) {
                    interfaceState.outputStatus =
                        "That output selection is already active.";
                    interfaceState.outputStatusError = false;
                } else {
                    interfaceState.outputSwitching = true;
                    interfaceState.outputStatus = "Switching output…";
                    interfaceState.outputStatusError = false;
                    outputSwitchRequestStore.publish({
                        ++interfaceState.outputSwitchSerial,
                        nextOutput,
                    });
                }
                return true;
            }
            return true;
        }
        if (interfaceState.profilesOpen) {
            const auto selectedProfile = [&]() -> const TuiProfile* {
                if (interfaceState.profiles.empty()) return nullptr;
                return &interfaceState.profiles[std::min(
                    interfaceState.profileSelection,
                    interfaceState.profiles.size() - 1)];
            };
            const auto returnToProfileBrowser = [&]() {
                interfaceState.profileMode = ProfileOverlayMode::Browse;
                interfaceState.profileInput.clear();
                interfaceState.pendingProfileId.clear();
            };

            if (interfaceState.profileMode == ProfileOverlayMode::Browse) {
                if (event == Event::Escape || event == Event::Character('p')) {
                    interfaceState.profilesOpen = false;
                    interfaceState.profileStatus.clear();
                    return true;
                }
                if (!interfaceState.profiles.empty() &&
                    (event == Event::ArrowUp || event == Event::ArrowDown)) {
                    const int direction = event == Event::ArrowDown ? 1 : -1;
                    const int count = static_cast<int>(interfaceState.profiles.size());
                    interfaceState.profileSelection = static_cast<size_t>(
                        (static_cast<int>(interfaceState.profileSelection) +
                            direction + count) % count);
                    interfaceState.profileStatus.clear();
                    return true;
                }
                if (event == Event::Character('n')) {
                    interfaceState.profileMode = ProfileOverlayMode::SaveAs;
                    interfaceState.profileInput.clear();
                    interfaceState.profileStatus.clear();
                    return true;
                }
                if (event == Event::Character('w')) {
                    if (interfaceState.activeProfileId.empty()) {
                        interfaceState.profileStatus =
                            "No active profile. Use n to save this setup first.";
                        interfaceState.profileStatusError = true;
                    } else {
                        interfaceState.profileMode =
                            ProfileOverlayMode::ConfirmOverwrite;
                        interfaceState.profileStatus.clear();
                    }
                    return true;
                }
                if (event == Event::Character('r')) {
                    const auto* selected = selectedProfile();
                    if (!selected) {
                        interfaceState.profileStatus = "No profile is selected.";
                        interfaceState.profileStatusError = true;
                    } else if (selected->isDefault) {
                        interfaceState.profileStatus =
                            "The default profile cannot be renamed.";
                        interfaceState.profileStatusError = true;
                    } else {
                        interfaceState.profileMode = ProfileOverlayMode::Rename;
                        interfaceState.profileInput = selected->name;
                        interfaceState.profileStatus.clear();
                    }
                    return true;
                }
                if (event == Event::Character('d')) {
                    const auto* selected = selectedProfile();
                    if (!selected) {
                        interfaceState.profileStatus = "No profile is selected.";
                        interfaceState.profileStatusError = true;
                    } else if (selected->isDefault) {
                        interfaceState.profileStatus =
                            "The default profile cannot be deleted.";
                        interfaceState.profileStatusError = true;
                    } else {
                        interfaceState.profileMode =
                            ProfileOverlayMode::ConfirmDelete;
                        interfaceState.profileStatus.clear();
                    }
                    return true;
                }
                if (event == Event::Return) {
                    const auto* selected = selectedProfile();
                    if (!selected) {
                        interfaceState.profileStatus = "No profile is selected.";
                        interfaceState.profileStatusError = true;
                    } else if (selected->id == interfaceState.activeProfileId &&
                               !hasUnsavedProfileChanges(interfaceState)) {
                        interfaceState.profileStatus =
                            selected->name + " is already active.";
                        interfaceState.profileStatusError = false;
                    } else if (hasUnsavedProfileChanges(interfaceState)) {
                        interfaceState.pendingProfileId = selected->id;
                        interfaceState.profileMode =
                            ProfileOverlayMode::ConfirmLoad;
                        interfaceState.profileStatus.clear();
                    } else if (loadProfile(selected->id)) {
                        interfaceState.profilesOpen = false;
                    }
                    return true;
                }
                return true;
            }

            if (interfaceState.profileMode == ProfileOverlayMode::SaveAs ||
                interfaceState.profileMode == ProfileOverlayMode::Rename) {
                if (event == Event::Escape) {
                    if (interfaceState.profileMode == ProfileOverlayMode::SaveAs &&
                        !interfaceState.pendingProfileId.empty()) {
                        interfaceState.profileMode =
                            ProfileOverlayMode::ConfirmLoad;
                        interfaceState.profileInput.clear();
                    } else {
                        returnToProfileBrowser();
                    }
                    interfaceState.profileStatus.clear();
                    return true;
                }
                if (event == Event::Backspace) {
                    eraseLastUtf8Character(interfaceState.profileInput);
                    interfaceState.profileStatus.clear();
                    return true;
                }
                if (event == Event::Return) {
                    std::string error;
                    if (interfaceState.profileMode == ProfileOverlayMode::SaveAs) {
                        std::string createdId;
                        if (!profileLibrary.saveNew(
                                interfaceState.profileInput,
                                interfaceState.settings,
                                &createdId,
                                &error)) {
                            interfaceState.profileStatus = error;
                            interfaceState.profileStatusError = true;
                            return true;
                        }
                        const std::string pendingLoad =
                            interfaceState.pendingProfileId;
                        syncProfiles();
                        selectProfile(createdId);
                        interfaceState.profileInput.clear();
                        interfaceState.pendingProfileId.clear();
                        if (!pendingLoad.empty()) {
                            if (loadProfile(pendingLoad)) {
                                interfaceState.profilesOpen = false;
                            }
                        } else {
                            interfaceState.profileMode = ProfileOverlayMode::Browse;
                            interfaceState.profileStatus = "Saved new profile.";
                            interfaceState.profileStatusError = false;
                        }
                    } else {
                        const auto* selected = selectedProfile();
                        if (!selected) {
                            interfaceState.profileStatus =
                                "No profile is selected.";
                            interfaceState.profileStatusError = true;
                            return true;
                        }
                        const std::string id = selected->id;
                        if (!profileLibrary.renameProfile(
                                id, interfaceState.profileInput, &error)) {
                            interfaceState.profileStatus = error;
                            interfaceState.profileStatusError = true;
                            return true;
                        }
                        syncProfiles();
                        selectProfile(id);
                        interfaceState.profileMode = ProfileOverlayMode::Browse;
                        interfaceState.profileInput.clear();
                        interfaceState.profileStatus = "Profile renamed.";
                        interfaceState.profileStatusError = false;
                    }
                    return true;
                }
                if (appendProfileNameCharacter(
                        interfaceState.profileInput, event)) {
                    interfaceState.profileStatus.clear();
                    return true;
                }
                return true;
            }

            if (event == Event::Escape) {
                returnToProfileBrowser();
                interfaceState.profileStatus.clear();
                return true;
            }
            if (interfaceState.profileMode ==
                    ProfileOverlayMode::ConfirmOverwrite &&
                (event == Event::Return || event == Event::Character('w'))) {
                std::string error;
                if (!profileLibrary.overwrite(
                        interfaceState.activeProfileId,
                        interfaceState.settings,
                        &error)) {
                    interfaceState.profileStatus = error;
                    interfaceState.profileStatusError = true;
                } else {
                    const std::string activeId = interfaceState.activeProfileId;
                    syncProfiles();
                    selectProfile(activeId);
                    interfaceState.profileMode = ProfileOverlayMode::Browse;
                    interfaceState.profileStatus = "Active profile overwritten.";
                    interfaceState.profileStatusError = false;
                }
                return true;
            }
            if (interfaceState.profileMode ==
                    ProfileOverlayMode::ConfirmDelete &&
                event == Event::Character('d')) {
                const auto* selected = selectedProfile();
                if (!selected) {
                    returnToProfileBrowser();
                    interfaceState.profileStatus = "No profile is selected.";
                    interfaceState.profileStatusError = true;
                    return true;
                }
                const std::string deletedName = selected->name;
                std::string error;
                if (!profileLibrary.deleteProfile(selected->id, &error)) {
                    interfaceState.profileStatus = error;
                    interfaceState.profileStatusError = true;
                } else {
                    syncProfiles();
                    interfaceState.profileMode = ProfileOverlayMode::Browse;
                    interfaceState.profileStatus = "Deleted " + deletedName;
                    interfaceState.profileStatusError = false;
                }
                return true;
            }
            if (interfaceState.profileMode == ProfileOverlayMode::ConfirmLoad) {
                if (event == Event::Character('n')) {
                    interfaceState.profileMode = ProfileOverlayMode::SaveAs;
                    interfaceState.profileInput.clear();
                    interfaceState.profileStatus.clear();
                    return true;
                }
                if (event == Event::Character('w') &&
                    !interfaceState.activeProfileId.empty()) {
                    std::string error;
                    if (!profileLibrary.overwrite(
                            interfaceState.activeProfileId,
                            interfaceState.settings,
                            &error)) {
                        interfaceState.profileStatus = error;
                        interfaceState.profileStatusError = true;
                        return true;
                    }
                    syncProfiles();
                    const std::string pending = interfaceState.pendingProfileId;
                    interfaceState.pendingProfileId.clear();
                    if (loadProfile(pending)) {
                        interfaceState.profilesOpen = false;
                    }
                    return true;
                }
                if (event == Event::Character('d')) {
                    const std::string pending = interfaceState.pendingProfileId;
                    interfaceState.pendingProfileId.clear();
                    if (loadProfile(pending)) {
                        interfaceState.profilesOpen = false;
                    }
                    return true;
                }
            }
            return true;
        }
        if (event == Event::Character('o') &&
            !interfaceState.settingsOpen && !interfaceState.layoutEditing) {
            interfaceState.outputsOpen = true;
            selectOutputRequest(interfaceState.activeRequestedDeviceId);
            requestOutputList();
            return true;
        }
        if (event == Event::Character('q')) {
            running.store(false);
            exitLoop();
            return true;
        }
        if (event == Event::Character('p') &&
            !interfaceState.settingsOpen && !interfaceState.layoutEditing) {
            interfaceState.profilesOpen = true;
            interfaceState.profileMode = ProfileOverlayMode::Browse;
            interfaceState.profileInput.clear();
            interfaceState.pendingProfileId.clear();
            if (!interfaceState.profiles.empty()) {
                interfaceState.profileStatus.clear();
                interfaceState.profileStatusError = false;
            }
            if (!interfaceState.activeProfileId.empty()) {
                selectProfile(interfaceState.activeProfileId);
            }
            return true;
        }
        if (event == Event::Character('l') && !interfaceState.settingsOpen) {
            interfaceState.layoutEditing = !interfaceState.layoutEditing;
            interfaceState.expandedPanel.reset();
            interfaceState.layoutOverlay = LayoutOverlay::None;
            interfaceState.layoutAddSelection = 0;
            if (interfaceState.layoutEditing) {
                interfaceState.layoutStatus =
                    "Arrows select • Shift+arrows move • a restores scopes";
                const auto editableLayout = buildDashboardLayout(
                    screen.dimx(),
                    screen.dimy(),
                    interfaceState.settings.rackLayout);
                if (!layoutContainsPanel(
                        editableLayout, interfaceState.focusedPanel)) {
                    const auto visible = visiblePanelOrder(editableLayout);
                    if (!visible.empty()) {
                        interfaceState.focusedPanel = visible.front();
                    }
                }
            } else {
                interfaceState.layoutStatus.clear();
            }
            if (!interfaceState.layoutEditing) persistSettings();
            return true;
        }
        if (event == Event::Character('s')) {
            if (interfaceState.layoutEditing) {
                interfaceState.layoutEditing = false;
                interfaceState.layoutOverlay = LayoutOverlay::None;
                interfaceState.layoutStatus.clear();
                persistSettings();
            }
            if (interfaceState.settingsOpen) {
                closeSettings();
            } else {
                interfaceState.settingsOpen = true;
                interfaceState.settingsPage = SettingsPage::Home;
                interfaceState.settingsHomeSelection = 0;
            }
            return true;
        }
        if (interfaceState.layoutEditing) {
            if (interfaceState.layoutOverlay == LayoutOverlay::Help) {
                if (event == Event::Escape || event == Event::Return ||
                    event == Event::Character('?') ||
                    event == Event::Character('h')) {
                    interfaceState.layoutOverlay = LayoutOverlay::None;
                } else if (event == Event::Character('a')) {
                    interfaceState.layoutOverlay = LayoutOverlay::AddScope;
                    interfaceState.layoutAddSelection = 0;
                }
                return true;
            }
            if (interfaceState.layoutOverlay == LayoutOverlay::AddScope) {
                const auto removed = removedRackPanels(
                    interfaceState.settings.rackLayout);
                if (event == Event::Escape || event == Event::Character('a')) {
                    interfaceState.layoutOverlay = LayoutOverlay::None;
                    return true;
                }
                if (event == Event::Character('?') ||
                    event == Event::Character('h')) {
                    interfaceState.layoutOverlay = LayoutOverlay::Help;
                    return true;
                }
                if (!removed.empty() &&
                    (event == Event::ArrowUp || event == Event::ArrowDown)) {
                    const int direction = event == Event::ArrowDown ? 1 : -1;
                    const int count = static_cast<int>(removed.size());
                    interfaceState.layoutAddSelection = static_cast<size_t>(
                        (static_cast<int>(std::min(
                            interfaceState.layoutAddSelection,
                            removed.size() - 1)) + direction + count) % count);
                    return true;
                }
                if (event == Event::Return) {
                    if (removed.empty()) {
                        interfaceState.layoutStatus =
                            "All scopes are already in the rack";
                    } else {
                        const PanelId added = removed[std::min(
                            interfaceState.layoutAddSelection,
                            removed.size() - 1)];
                        if (addRackPanel(
                                interfaceState.settings.rackLayout,
                                added,
                                interfaceState.focusedPanel)) {
                            interfaceState.focusedPanel = added;
                            interfaceState.layoutStatus = addedScopeStatus(added);
                            persistSettings();
                        }
                    }
                    interfaceState.layoutOverlay = LayoutOverlay::None;
                    interfaceState.layoutAddSelection = 0;
                    return true;
                }
                return true;
            }
            if (event == Event::Character('?') ||
                event == Event::Character('h')) {
                interfaceState.layoutOverlay = LayoutOverlay::Help;
                interfaceState.layoutStatus.clear();
                return true;
            }
            if (event == Event::Character('a')) {
                interfaceState.layoutOverlay = LayoutOverlay::AddScope;
                interfaceState.layoutAddSelection = 0;
                interfaceState.layoutStatus.clear();
                return true;
            }
            if (event == Event::Escape || event == Event::Return) {
                interfaceState.layoutEditing = false;
                interfaceState.layoutOverlay = LayoutOverlay::None;
                interfaceState.layoutStatus.clear();
                persistSettings();
                return true;
            }
            if (event == Event::Tab || event == Event::TabReverse) {
                const auto navigationLayout = buildDashboardLayout(
                    screen.dimx(),
                    screen.dimy(),
                    interfaceState.settings.rackLayout);
                interfaceState.focusedPanel = nextPanel(
                    interfaceState.focusedPanel,
                    visiblePanelOrder(navigationLayout),
                    event == Event::TabReverse);
                interfaceState.layoutStatus =
                    "Selected " + panelName(interfaceState.focusedPanel);
                return true;
            }
            if (const auto direction = plainArrowDirection(event)) {
                const auto navigationLayout = buildDashboardLayout(
                    screen.dimx(),
                    screen.dimy(),
                    interfaceState.settings.rackLayout);
                if (const auto neighbor = spatialNeighbor(
                        navigationLayout,
                        interfaceState.focusedPanel,
                        *direction)) {
                    interfaceState.focusedPanel = *neighbor;
                    interfaceState.layoutStatus =
                        "Selected " + panelName(*neighbor);
                } else {
                    interfaceState.layoutStatus = "No scope in that direction";
                }
                return true;
            }

            bool changed = false;
            std::string feedback;
            if (const auto direction = moveArrowDirection(event)) {
                if (*direction == NavigationDirection::Left ||
                    *direction == NavigationDirection::Right) {
                    const int movement = *direction == NavigationDirection::Left
                        ? -1
                        : 1;
                    changed = moveRackPanelHorizontal(
                        interfaceState.settings.rackLayout,
                        interfaceState.focusedPanel,
                        movement);
                    feedback = changed
                        ? "Moved " + panelName(interfaceState.focusedPanel) +
                            (movement < 0 ? " left" : " right")
                        : movement < 0
                            ? "Already first in this row"
                            : "Already last in this row";
                } else {
                    const int movement = *direction == NavigationDirection::Up
                        ? -1
                        : 1;
                    changed = moveRackPanelVertical(
                        interfaceState.settings.rackLayout,
                        interfaceState.focusedPanel,
                        movement);
                    feedback = changed
                        ? "Moved " + panelName(interfaceState.focusedPanel) +
                            (movement < 0 ? " up" : " down")
                        : movement < 0 ? "No row above" : "No row below";
                }
            } else if (event == Event::Character('[')) {
                changed = resizeRackPanel(
                    interfaceState.settings.rackLayout,
                    interfaceState.focusedPanel,
                    -1);
                feedback = changed ? "Reduced scope width" : "Minimum scope width";
            } else if (event == Event::Character(']')) {
                changed = resizeRackPanel(
                    interfaceState.settings.rackLayout,
                    interfaceState.focusedPanel,
                    1);
                feedback = changed ? "Increased scope width" : "Maximum scope width";
            } else if (event == Event::Character(',')) {
                changed = resizeRackRow(
                    interfaceState.settings.rackLayout,
                    interfaceState.focusedPanel,
                    -1);
                feedback = changed ? "Reduced row height" : "Minimum row height";
            } else if (event == Event::Character('.')) {
                changed = resizeRackRow(
                    interfaceState.settings.rackLayout,
                    interfaceState.focusedPanel,
                    1);
                feedback = changed ? "Increased row height" : "Maximum row height";
            } else if (event == Event::Character('n')) {
                changed = splitRackRow(
                    interfaceState.settings.rackLayout,
                    interfaceState.focusedPanel);
                feedback = changed
                    ? "Created a new row for " + panelName(interfaceState.focusedPanel)
                    : "Cannot create another row here";
            } else if (event == Event::Character('x')) {
                const PanelId removedPanel = interfaceState.focusedPanel;
                const auto configured = configuredPanelOrder(
                    interfaceState.settings.rackLayout);
                const auto selected = std::find(
                    configured.begin(), configured.end(), interfaceState.focusedPanel);
                PanelId nextFocus = interfaceState.focusedPanel;
                if (configured.size() > 1 && selected != configured.end()) {
                    const size_t selectedIndex = static_cast<size_t>(
                        std::distance(configured.begin(), selected));
                    nextFocus = configured[
                        selectedIndex + 1 < configured.size()
                            ? selectedIndex + 1
                            : selectedIndex - 1];
                }
                changed = removeRackPanel(
                    interfaceState.settings.rackLayout,
                    interfaceState.focusedPanel);
                if (changed) {
                    interfaceState.focusedPanel = nextFocus;
                    feedback = "Removed " + panelName(removedPanel) +
                        " • a adds it back";
                } else {
                    feedback = "At least one scope must remain";
                }
            } else if (const auto selectedPanel = panelForEvent(event)) {
                if (rackPanelLocation(
                        interfaceState.settings.rackLayout, *selectedPanel)) {
                    interfaceState.focusedPanel = *selectedPanel;
                    feedback = "Selected " + panelName(*selectedPanel);
                } else {
                    changed = addRackPanel(
                        interfaceState.settings.rackLayout,
                        *selectedPanel,
                        interfaceState.focusedPanel);
                    if (changed) {
                        interfaceState.focusedPanel = *selectedPanel;
                        feedback = addedScopeStatus(*selectedPanel);
                    }
                }
            }
            if (!feedback.empty()) interfaceState.layoutStatus = feedback;
            if (changed) persistSettings();
            return true;
        }
        if (interfaceState.settingsOpen) {
            if (event == Event::Escape) {
                if (interfaceState.settingsPage == SettingsPage::Home) {
                    closeSettings();
                } else {
                    const auto pages = settingsPages();
                    const auto found = std::find(
                        pages.begin(), pages.end(), interfaceState.settingsPage);
                    interfaceState.settingsHomeSelection = found == pages.end()
                        ? 0
                        : static_cast<size_t>(std::distance(pages.begin(), found));
                    interfaceState.settingsPage = SettingsPage::Home;
                }
                return true;
            }

            if (interfaceState.settingsPage == SettingsPage::Home) {
                const auto pages = settingsPages();
                if (event == Event::ArrowUp || event == Event::ArrowDown) {
                    const int direction = event == Event::ArrowDown ? 1 : -1;
                    const int count = static_cast<int>(pages.size());
                    interfaceState.settingsHomeSelection = static_cast<size_t>(
                        (static_cast<int>(interfaceState.settingsHomeSelection) +
                            direction + count) % count);
                    return true;
                }
                if (event == Event::Return && !pages.empty()) {
                    interfaceState.settingsPage = pages[std::min(
                        interfaceState.settingsHomeSelection, pages.size() - 1)];
                    return true;
                }
                for (size_t index = 0; index < pages.size(); ++index) {
                    if (event == Event::Character(
                            static_cast<char>('1' + index))) {
                        interfaceState.settingsPage = pages[index];
                        interfaceState.settingsHomeSelection = index;
                        return true;
                    }
                }
                return true;
            }

            const auto& pageSettings = settingsForPage(interfaceState.settingsPage);
            size_t& selected = settingsSelection(interfaceState);
            if (!pageSettings.empty()) {
                selected = std::min(selected, pageSettings.size() - 1);
            }
            if ((event == Event::ArrowUp || event == Event::ArrowDown) &&
                !pageSettings.empty()) {
                const int direction = event == Event::ArrowDown ? 1 : -1;
                const int count = static_cast<int>(pageSettings.size());
                selected = static_cast<size_t>(
                    (static_cast<int>(selected) + direction + count) % count);
                return true;
            }
            if (!pageSettings.empty() &&
                (event == Event::ArrowLeft || event == Event::ArrowRight ||
                 event == Event::Return)) {
                const int direction = event == Event::ArrowLeft ? -1 : 1;
                const SettingId setting = pageSettings[selected].id;
                bool changed = false;
                if (setting == SettingId::Theme) {
                    const std::string nextTheme = themeLibrary.adjacentId(
                        interfaceState.settings.themeId, direction);
                    changed = nextTheme != interfaceState.settings.themeId;
                    interfaceState.settings.themeId = nextTheme;
                } else {
                    changed = adjustSetting(
                        interfaceState.settings, setting, direction);
                }
                if (changed) {
                    persistSettings();
                }
                return true;
            }
            if (!pageSettings.empty() && event == Event::Backspace) {
                if (resetSetting(interfaceState.settings, pageSettings[selected].id)) {
                    persistSettings();
                }
                return true;
            }
            return true;
        }
        if (event == Event::Escape) {
            running.store(false);
            exitLoop();
            return true;
        }
        if (event == Event::Character('r')) {
            resetRequested.store(true);
            return true;
        }
        if (event == Event::Tab || event == Event::TabReverse) {
            const auto navigationLayout = buildDashboardLayout(
                screen.dimx(),
                screen.dimy(),
                interfaceState.settings.rackLayout,
                interfaceState.expandedPanel);
            const auto navigationPanels = interfaceState.expandedPanel
                ? panelOrder()
                : visiblePanelOrder(navigationLayout);
            interfaceState.focusedPanel = nextPanel(
                interfaceState.focusedPanel,
                navigationPanels,
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
        if (const auto selectedPanel = panelForEvent(event)) {
            interfaceState.focusedPanel = *selectedPanel;
            if (interfaceState.expandedPanel) {
                interfaceState.expandedPanel = interfaceState.focusedPanel;
            } else {
                const auto currentLayout = buildDashboardLayout(
                    screen.dimx(), screen.dimy(), interfaceState.settings.rackLayout);
                if (!layoutContainsPanel(currentLayout, interfaceState.focusedPanel)) {
                    interfaceState.expandedPanel = interfaceState.focusedPanel;
                }
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
