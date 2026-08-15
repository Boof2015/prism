#include "tui_runtime.h"

#include "analysis_pipeline.h"
#include "dashboard_layout.h"
#include "display_model.h"
#include "meter_display_model.h"
#include "scope_plot_model.h"
#include "snapshot_store.h"
#include "tui_settings.h"

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

struct InterfaceState {
    PanelId focusedPanel = PanelId::Spectrum;
    std::optional<PanelId> expandedPanel;
    TuiSettings settings;
    bool settingsOpen = false;
    SettingsPage settingsPage = SettingsPage::Home;
    size_t settingsHomeSelection = 0;
    std::array<size_t, 9> settingsSelections{};
    std::string settingsStatus;
};

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
        spectrumElements.push_back(text(row) | color(Color::Cyan));
    }
    if (contentHeight > 1) {
        spectrumElements.push_back(
            text(buildFrequencyAxis(contentWidth, projectionOptions.maxFrequency)) |
            color(Color::GrayDark));
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
    return stylePanel(std::move(panel), focused) |
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
        traceWeight = settings.oscilloscopeTraceWeight
    ](Canvas& surface) {
        const int canvasWidth = surface.width();
        const int canvasHeight = surface.height();
        if (canvasWidth <= 0 || canvasHeight <= 0) {
            return;
        }

        const int centerY = oscilloscopeZeroY(canvasHeight);
        surface.DrawPointLine(
            0, centerY, canvasWidth - 1, centerY, Color::GrayDark);
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
                    Color::CyanLight);
            }
        }
    }) | flex;

    auto panel = window(
        panelTitle(PanelId::Oscilloscope, focused, detail),
        std::move(plot));
    return stylePanel(std::move(panel), focused) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

void drawVectorscopeGrid(ftxui::Canvas& surface, VectorscopeMode mode) {
    using ftxui::Color;
    const auto layout = getVectorscopePlotLayout(
        surface.width(), surface.height(), mode);
    if (layout.radius <= 0 || mode == VectorscopeMode::Lissajous) {
        return;
    }

    const auto grid = Color::RGB(76, 82, 88);
    const auto guide = Color::RGB(48, 53, 58);
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
        densityDivisor
    ](Canvas& surface) {
        const int canvasWidth = surface.width();
        const int canvasHeight = surface.height();
        if (canvasWidth <= 0 || canvasHeight <= 0) {
            return;
        }

        if (showGuides) {
            drawVectorscopeGrid(surface, mode);
        }

        const auto bands = buildVectorscopePlot(
            multibandPoints,
            pointCount,
            canvasWidth,
            canvasHeight,
            mode,
            densityDivisor);
        constexpr int ageBuckets = 8;
        const std::array<std::array<int, 3>, 3> baseColors = {{
            {{255, 68, 68}},
            {{68, 221, 68}},
            {{68, 136, 255}},
        }};
        std::array<std::array<Color, ageBuckets>, 3> colors;
        for (size_t band = 0; band < colors.size(); ++band) {
            for (int bucket = 0; bucket < ageBuckets; ++bucket) {
                const float brightness = 0.3f + 0.7f *
                    static_cast<float>(bucket + 1) /
                    static_cast<float>(ageBuckets);
                colors[band][bucket] = Color::RGB(
                    static_cast<uint8_t>(std::lround(
                        static_cast<float>(baseColors[band][0]) * brightness)),
                    static_cast<uint8_t>(std::lround(
                        static_cast<float>(baseColors[band][1]) * brightness)),
                    static_cast<uint8_t>(std::lround(
                        static_cast<float>(baseColors[band][2]) * brightness)));
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
    return stylePanel(std::move(panel), focused) |
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
                hot ? Color::RedLight : Color::CyanLight));
        } else if (column < levelColumns) {
            cells.push_back(text("█") | color(
                column >= hotColumn ? Color::Red : Color::Cyan));
        } else {
            cells.push_back(text("·") | color(Color::GrayDark));
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
            cells.push_back(text("│") | color(Color::GrayLight));
        } else if (positiveFill) {
            cells.push_back(text("█") | color(Color::Cyan));
        } else if (negativeFill) {
            cells.push_back(text("█") | color(Color::Red));
        } else {
            cells.push_back(text("·") | color(Color::GrayDark));
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
    if (peakHere) return text("━━") | color(hot ? Color::RedLight : Color::CyanLight);
    if (filled) return text("██") | color(hot ? Color::Red : Color::Cyan);
    return text("··") | color(Color::GrayDark);
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
        referenceDbfs
    ](Canvas& surface) {
        constexpr float pi = 3.14159265358979323846f;
        const int canvasWidth = surface.width();
        const int canvasHeight = surface.height();
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
                    ? Color::RedLight
                    : color);
        };

        drawArc(startAngle, endAngle, 1.0f, Color::GrayDark);
        if (!combined) drawArc(startAngle, endAngle, 0.78f, Color::RGB(54, 64, 68));
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
                vu >= 0.0f ? Color::Red : Color::GrayLight);
        }
        const float hotAngle = startAngle + classicVuToNormalized(0.0f) *
            (endAngle - startAngle);
        drawArc(hotAngle, endAngle, 1.0f, Color::Red);

        if (combined) {
            drawArc(startAngle, angleForDb(combinedDb), 1.0f, Color::Cyan);
            drawNeedle(combinedDb, combinedPeak, 1.0f, Color::CyanLight);
        } else {
            drawArc(startAngle, angleForDb(left), 0.78f, Color::BlueLight);
            drawArc(startAngle, angleForDb(right), 1.0f, Color::Cyan);
            drawNeedle(left, leftPeak, 0.78f, Color::BlueLight);
            drawNeedle(right, rightPeak, 1.0f, Color::CyanLight);
        }
        surface.DrawPointCircleFilled(centerX, centerY, 1, Color::CyanLight);
    }) | size(HEIGHT, EQUAL, plotRows) | flex;

    const std::string readings = combined
        ? formatDb(combinedDb) + " dB"
        : "L " + formatDb(frame.vu.vuLDb) + " dB    " +
            formatDb(frame.vu.vuRDb) + " dB R";
    return vbox({
        std::move(face),
        text(readings) | center | color(Color::CyanLight),
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
    return stylePanel(std::move(panel), focused) |
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
        color(Color::RedLight);
    if (peakHere) return text(repeat("━")) |
        color(Color::CyanLight);
    if (filled) return text(repeat("█")) |
        color(Color::Cyan);
    return text(repeat("·")) |
        color(Color::GrayDark);
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
        text("target -14") | color(Color::RedLight) | dim,
    }));
    for (int row = 0; row < meterRows; ++row) {
        Elements parts;
        const auto gap = [&]() {
            auto element = text(row == targetRow ? "─" : " ");
            return row == targetRow
                ? element | color(Color::RedLight)
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
                bgcolor(Color::Cyan) | color(Color::Black) | bold);
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
    return stylePanel(std::move(panel), focused) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

ftxui::Color interpolateColor(const std::array<int, 3>& from,
                              const std::array<int, 3>& to,
                              float amount) {
    const float t = std::clamp(amount, 0.0f, 1.0f);
    return ftxui::Color::RGB(
        static_cast<uint8_t>(std::lround(from[0] + (to[0] - from[0]) * t)),
        static_cast<uint8_t>(std::lround(from[1] + (to[1] - from[1]) * t)),
        static_cast<uint8_t>(std::lround(from[2] + (to[2] - from[2]) * t)));
}

ftxui::Color spectrogramColor(float intensity, SpectrogramColorMode mode) {
    const float value = std::clamp(intensity, 0.0f, 1.0f);
    if (mode == SpectrogramColorMode::Mono) {
        return interpolateColor(
            {{5, 12, 14}}, {{102, 255, 255}}, std::pow(value, 0.72f));
    }

    constexpr std::array<float, 6> stops = {0.0f, 0.16f, 0.36f, 0.58f, 0.78f, 1.0f};
    constexpr std::array<std::array<int, 3>, 6> colors = {{
        {{5, 3, 12}},
        {{15, 7, 33}},
        {{61, 11, 94}},
        {{163, 26, 121}},
        {{255, 82, 87}},
        {{255, 241, 209}},
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
        vertical
    ](Canvas& surface) {
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
    return stylePanel(std::move(panel), focused) |
        size(WIDTH, EQUAL, std::max(1, width)) |
        size(HEIGHT, EQUAL, std::max(1, height));
}

ftxui::Color waveformBandColor(const float* summary, bool multiband) {
    using namespace ftxui;
    if (!multiband || summary == nullptr) return Color::CyanLight;
    std::array<float, 3> weights = {
        std::max(0.0f, summary[2]),
        std::max(0.0f, summary[3]),
        std::max(0.0f, summary[4]),
    };
    float total = weights[0] + weights[1] + weights[2];
    if (total <= 1.0e-8f) return Color::CyanLight;
    for (float& weight : weights) {
        weight = std::pow(weight / total, 2.6f);
    }
    total = weights[0] + weights[1] + weights[2];
    for (float& weight : weights) {
        weight /= std::max(total, 1.0e-8f);
    }
    constexpr std::array<std::array<int, 3>, 3> colors = {{
        {{255, 68, 68}},
        {{68, 221, 68}},
        {{68, 136, 255}},
    }};
    std::array<int, 3> mixed{};
    for (size_t channel = 0; channel < mixed.size(); ++channel) {
        for (size_t band = 0; band < weights.size(); ++band) {
            mixed[channel] += static_cast<int>(std::lround(
                weights[band] * static_cast<float>(colors[band][channel])));
        }
    }
    return Color::RGB(
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
        multiband = settings.waveformMultiband
    ](Canvas& surface) {
        const int canvasWidth = surface.width();
        const int canvasHeight = surface.height();
        if (canvasWidth <= 0 || canvasHeight <= 0) return;

        const int laneCount = stereo ? 2 : 1;
        for (int lane = 0; lane < laneCount; ++lane) {
            const int centerY = static_cast<int>(std::lround(
                (static_cast<float>(lane) + 0.5f) *
                static_cast<float>(canvasHeight) / static_cast<float>(laneCount)));
            surface.DrawPointLine(
                0, centerY, canvasWidth - 1, centerY,
                Color::RGB(55, 61, 64));
        }
        if (stereo) {
            surface.DrawPointLine(
                0, canvasHeight / 2, canvasWidth - 1, canvasHeight / 2,
                Color::RGB(40, 45, 48));
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
                            const InterfaceState& state) {
    using namespace ftxui;
    std::string layoutName = layoutPresetName(state.settings.layoutPreset);
    if (state.settings.layoutPreset == LayoutPreset::Automatic) {
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
        ? "Tab • Enter • s • q"
        : compact
            ? "Tab focus • Enter " + enterAction + " • s settings • q quit"
            : "Tab focus • Enter " + enterAction +
                " • s settings • v mode • l layout • r reset • q quit";
    auto status = text(makeCaptureStatus(frame, state.settings, compact)) | dim;
    if (frame.captureOverrun) {
        status = status | color(Color::RedLight);
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
        row = row | color(Color::CyanLight) | bold |
            bgcolor(Color::RGB(24, 42, 46));
    } else {
        row = row | color(Color::GrayLight);
    }
    return row | size(HEIGHT, EQUAL, 1);
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
        text(breadcrumb) | color(Color::CyanLight) | bold,
        separator(),
        text(settingsPageDescription(state.settingsPage)) | dim,
        separatorEmpty(),
        vbox(std::move(rows)),
        filler(),
        text(selectedDescription) | color(Color::GrayLight),
        state.settingsStatus.empty()
            ? emptyElement()
            : text(state.settingsStatus) | color(Color::RedLight),
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
        width, height, state.settings.layoutPreset, state.expandedPanel);
    if (layout.terminalTooSmall) {
        return vbox({
            filler(),
            text("PRISM TUI") | bold | color(Color::CyanLight) | center,
            text("Terminal too small — need at least 44 × 12") | center,
            text("q quit") | dim | center,
            filler(),
        });
    }

    auto dashboard = vbox({
        renderHeader(layout, state) | size(HEIGHT, EQUAL, 1),
        renderLayoutNode(layout.root, layout, frame, state),
        renderFooter(frame, state, width) | size(HEIGHT, EQUAL, 1),
    });
    if (!state.settingsOpen) {
        return dashboard;
    }

    const int settingsWidth = std::min(84, std::max(40, width - 4));
    const int settingsHeight = std::min(16, std::max(10, height - 2));
    return dbox({
        std::move(dashboard) | dim,
        renderSettings(state, settingsWidth, settingsHeight) |
            borderEmpty | clear_under | center,
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
    SnapshotStore<TuiSettings> settingsStore;
    InterfaceState interfaceState;
    const std::filesystem::path settingsPath = defaultSettingsPath();
    interfaceState.settings = loadSettings(settingsPath);
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
    std::exception_ptr workerError;
    auto exitLoop = screen.ExitLoopClosure();

    std::thread worker([&]() {
        try {
            AnalysisPipeline pipeline(static_cast<float>(started.sampleRate));
            TuiSettings appliedSettings = settingsStore.read();
            pipeline.setInputTrimDb(appliedSettings.inputTrimDb);
            pipeline.setSpectrumTilt(appliedSettings.spectrumTiltDbPerOctave);
            pipeline.setOscilloscopePitchLock(appliedSettings.oscilloscopePitchLock);
            applySpectrogramSettings(pipeline, appliedSettings);
            applyWaveformSettings(pipeline, appliedSettings);

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

                const TuiSettings requestedSettings = settingsStore.read();
                if (requestedSettings != appliedSettings) {
                    const bool refreshChanged =
                        requestedSettings.refreshRate != appliedSettings.refreshRate;
                    pipeline.setInputTrimDb(requestedSettings.inputTrimDb);
                    pipeline.setSpectrumTilt(
                        requestedSettings.spectrumTiltDbPerOctave);
                    pipeline.setOscilloscopePitchLock(
                        requestedSettings.oscilloscopePitchLock);
                    const bool spectrogramAnalysisChanged =
                        requestedSettings.spectrogramClarity != appliedSettings.spectrogramClarity ||
                        requestedSettings.spectrogramScale != appliedSettings.spectrogramScale ||
                        requestedSettings.spectrogramOrientation != appliedSettings.spectrogramOrientation ||
                        requestedSettings.spectrogramScrollSpeed != appliedSettings.spectrogramScrollSpeed ||
                        requestedSettings.spectrogramContrast != appliedSettings.spectrogramContrast ||
                        requestedSettings.spectrogramTiltDbPerOctave != appliedSettings.spectrogramTiltDbPerOctave;
                    if (spectrogramAnalysisChanged) {
                        applySpectrogramSettings(pipeline, requestedSettings);
                    }
                    if (requestedSettings.waveformMode != appliedSettings.waveformMode ||
                        requestedSettings.waveformScrollSpeed != appliedSettings.waveformScrollSpeed) {
                        applyWaveformSettings(pipeline, requestedSettings);
                    }
                    appliedSettings = requestedSettings;
                    if (refreshChanged) {
                        nextFrameAt = std::chrono::steady_clock::now();
                    }
                }

                drainCapture(*capture, pipeline, captureOverrun);

                const auto now = std::chrono::steady_clock::now();
                if (now >= nextFrameAt) {
                    DisplayFrame next;
                    auto analyzed = pipeline.snapshot();
                    next.magnitudes = std::move(analyzed.magnitudes);
                    next.spectrumPeak = std::move(analyzed.spectrumPeak);
                    next.vu = analyzed.vu;
                    next.lufs = analyzed.lufs;
                    next.oscilloscope = std::move(analyzed.oscilloscope);
                    next.vectorscope = std::move(analyzed.vectorscope);
                    next.spectrogram = std::move(analyzed.spectrogram);
                    next.waveform = std::move(analyzed.waveform);
                    next.sampleRate = started.sampleRate;
                    next.backend = capture->backendName();
                    next.device = started.deviceLabel.empty() ? started.deviceId : started.deviceLabel;
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
        return renderFrame(
            frameStore.read(), screen.dimx(), screen.dimy(), interfaceState);
    });
    const auto persistSettings = [&]() {
        interfaceState.settings = normalizeSettings(interfaceState.settings);
        settingsStore.publish(interfaceState.settings);
        std::string error;
        if (!saveSettings(interfaceState.settings, settingsPath, &error)) {
            interfaceState.settingsStatus = "Settings were applied but could not be saved: " + error;
        } else {
            interfaceState.settingsStatus.clear();
        }
    };
    const auto closeSettings = [&]() {
        interfaceState.settingsOpen = false;
        interfaceState.settingsPage = SettingsPage::Home;
        const auto dashboard = buildDashboardLayout(
            screen.dimx(),
            screen.dimy(),
            interfaceState.settings.layoutPreset,
            interfaceState.expandedPanel);
        if (!interfaceState.expandedPanel &&
            !layoutContainsPanel(dashboard, interfaceState.focusedPanel)) {
            const auto visible = visiblePanelOrder(dashboard);
            if (!visible.empty()) interfaceState.focusedPanel = visible.front();
        }
    };
    auto component = CatchEvent(renderer, [&](Event event) {
        if (event == Event::Custom) {
            redrawQueued.store(false);
            return false;
        }
        if (event == Event::Character('q') || event == Event::CtrlC) {
            running.store(false);
            exitLoop();
            return true;
        }
        if (event == Event::Character('s')) {
            if (interfaceState.settingsOpen) {
                closeSettings();
            } else {
                interfaceState.settingsOpen = true;
                interfaceState.settingsPage = SettingsPage::Home;
                interfaceState.settingsHomeSelection = 0;
            }
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
                if (adjustSetting(
                        interfaceState.settings,
                        pageSettings[selected].id,
                        direction)) {
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
        if (event == Event::Character('v')) {
            adjustSetting(
                interfaceState.settings, SettingId::VectorscopeMode, 1);
            persistSettings();
            return true;
        }
        if (event == Event::Tab || event == Event::TabReverse) {
            const auto navigationLayout = buildDashboardLayout(
                screen.dimx(),
                screen.dimy(),
                interfaceState.settings.layoutPreset,
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
        if (event == Event::Character('l')) {
            adjustSetting(interfaceState.settings, SettingId::Layout, 1);
            persistSettings();
            interfaceState.expandedPanel.reset();
            const auto nextLayout = buildDashboardLayout(
                screen.dimx(), screen.dimy(), interfaceState.settings.layoutPreset);
            if (!layoutContainsPanel(nextLayout, interfaceState.focusedPanel)) {
                const auto visible = visiblePanelOrder(nextLayout);
                if (!visible.empty()) {
                    interfaceState.focusedPanel = visible.front();
                }
            }
            return true;
        }
        std::optional<PanelId> selectedPanel;
        if (event == Event::Character('1')) selectedPanel = PanelId::Spectrum;
        if (event == Event::Character('2')) selectedPanel = PanelId::Oscilloscope;
        if (event == Event::Character('3')) selectedPanel = PanelId::Vectorscope;
        if (event == Event::Character('4')) selectedPanel = PanelId::VUMeter;
        if (event == Event::Character('5')) selectedPanel = PanelId::LUFSMeter;
        if (event == Event::Character('6')) selectedPanel = PanelId::Spectrogram;
        if (event == Event::Character('7')) selectedPanel = PanelId::Waveform;
        if (selectedPanel) {
            interfaceState.focusedPanel = *selectedPanel;
            if (interfaceState.expandedPanel) {
                interfaceState.expandedPanel = interfaceState.focusedPanel;
            } else {
                const auto currentLayout = buildDashboardLayout(
                    screen.dimx(), screen.dimy(), interfaceState.settings.layoutPreset);
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
