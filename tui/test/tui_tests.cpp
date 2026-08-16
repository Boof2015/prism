#include "analysis_pipeline.h"
#include "cli.h"
#include "dashboard_layout.h"
#include "display_model.h"
#include "frame_rate_meter.h"
#include "meter_display_model.h"
#include "output_selection.h"
#include "profile_library.h"
#include "scope_plot_model.h"
#include "scrolling_history.h"
#include "snapshot_store.h"
#include "spectrum_peak_model.h"
#include "system_audio_capture.h"
#include "tui_settings.h"
#include "tui_theme.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << '\n';
        std::exit(1);
    }
}

Prism::Capture::AudioChunk sineChunk(float frequency,
                                     float amplitude,
                                     size_t count,
                                     float sampleRate) {
    Prism::Capture::AudioChunk chunk;
    chunk.left.resize(count);
    chunk.right.resize(count);
    chunk.channelCount = 2;
    constexpr float pi = 3.14159265358979323846f;
    for (size_t index = 0; index < count; ++index) {
        const float sample = amplitude * std::sin(
            2.0f * pi * frequency * static_cast<float>(index) / sampleRate);
        chunk.left[index] = sample;
        chunk.right[index] = sample;
    }
    return chunk;
}

Prism::Capture::AudioChunk stereoSineChunk(float frequency,
                                           float leftAmplitude,
                                           float rightAmplitude,
                                           size_t count,
                                           float sampleRate) {
    auto chunk = sineChunk(frequency, leftAmplitude, count, sampleRate);
    constexpr float pi = 3.14159265358979323846f;
    for (size_t index = 0; index < count; ++index) {
        chunk.right[index] = rightAmplitude * std::sin(
            2.0f * pi * frequency * static_cast<float>(index) / sampleRate);
    }
    return chunk;
}

class FakeCapture final : public Prism::Capture::SystemAudioCapture {
public:
    Prism::Capture::Support getSupport() const override { return {true, {}}; }
    std::vector<Prism::Capture::OutputDevice> listOutputDevices() override {
        return {
            {"fake", "Fake Output", 48000.0, 2, true},
            {"alternate", "Alternate Output", 44100.0, 2, false},
        };
    }
    bool start(const std::string& requested,
               Prism::Capture::StartResult* result,
               std::string* error) override {
        startRequests.push_back(requested);
        const std::string selected = requested.empty() ? "fake" : requested;
        if (failAllStarts || selected == failedDeviceId ||
            (selected != "fake" && selected != "alternate")) {
            if (error) *error = "Fake output failed to start.";
            return false;
        }
        stopped = false;
        activeDeviceId = selected;
        if (result) {
            *result = selected == "alternate"
                ? Prism::Capture::StartResult{
                    44100.0, 2, "alternate", "Alternate Output"}
                : Prism::Capture::StartResult{
                    48000.0, 2, "fake", "Fake Output"};
        }
        return true;
    }
    void stop() override {
        stopped = true;
        ++stopCount;
    }
    Prism::Capture::DrainResult drain(size_t maxChunks) override {
        Prism::Capture::DrainResult result;
        const size_t count = std::min(maxChunks, chunks.size());
        for (size_t index = 0; index < count; ++index) {
            result.chunks.push_back(std::move(chunks.front()));
            chunks.pop_front();
        }
        result.overwriteCount = nextOverwriteCount;
        nextOverwriteCount = 0;
        result.queueDepth = chunks.size();
        return result;
    }
    double nowMilliseconds() const override { return 1.0; }
    const char* backendName() const override { return "Fake"; }

    std::deque<Prism::Capture::AudioChunk> chunks;
    uint64_t nextOverwriteCount = 0;
    bool stopped = false;
    bool failAllStarts = false;
    std::string failedDeviceId;
    std::string activeDeviceId;
    std::vector<std::string> startRequests;
    size_t stopCount = 0;
};

void testCli() {
    auto parsed = Prism::Tui::parseArguments({"--device", "device-id"});
    require(parsed.ok, "device arguments should parse");
    require(parsed.options.command == Prism::Tui::Command::Run, "device command should run");
    require(parsed.options.deviceId == "device-id", "device ID should be retained");
    require(Prism::Tui::parseArguments({"--list-devices"}).options.command ==
        Prism::Tui::Command::ListDevices, "list command should parse");
    auto output = Prism::Tui::parseArguments({"--output", "output-id"});
    require(output.ok && output.options.deviceId == "output-id",
        "the output alias should retain its output ID");
    require(Prism::Tui::parseArguments({"--list-outputs"}).options.command ==
        Prism::Tui::Command::ListDevices, "the output-list alias should parse");
    auto startup = Prism::Tui::parseArguments({
        "--profile", "Studio Wide",
        "--theme", "Alpha Centauri",
        "--output", "output-id",
    });
    require(startup.ok && startup.options.profileSelector == "Studio Wide" &&
        startup.options.themeSelector == "Alpha Centauri" &&
        startup.options.deviceId == "output-id",
        "profile, theme, and output startup selections should combine");
    require(!Prism::Tui::parseArguments({"--device"}).ok, "missing device ID should fail");
    require(!Prism::Tui::parseArguments({"--device", "--help"}).ok,
        "an option should not be accepted as a device ID");
    require(!Prism::Tui::parseArguments({"--wat"}).ok, "unknown option should fail");
    require(!Prism::Tui::parseArguments({"--device", "fake", "--device", "fake"}).ok,
        "duplicate device options should fail");
    require(!Prism::Tui::parseArguments({"--device", "fake", "--output", "fake"}).ok,
        "mixed output aliases should still be rejected as duplicates");
    require(!Prism::Tui::parseArguments({"--profile"}).ok &&
        !Prism::Tui::parseArguments({"--theme", "--output"}).ok,
        "startup selectors should require a value");
    require(!Prism::Tui::parseArguments({
            "--profile", "one", "--profile", "two"}).ok &&
        !Prism::Tui::parseArguments({
            "--theme", "one", "--theme", "two"}).ok,
        "startup selectors should reject duplicate values");
    require(!Prism::Tui::parseArguments({"--help", "--version"}).ok,
        "exclusive commands should not combine");
    require(Prism::Tui::usageText().find("Tab / Shift-Tab") != std::string::npos,
        "help should describe dashboard keyboard controls");
    require(Prism::Tui::usageText().find("Cycle vectorscope") == std::string::npos,
        "help should not advertise the removed vectorscope shortcut");
    require(Prism::Tui::usageText().find("Open profiles") != std::string::npos,
        "help should describe the profile library shortcut");
    require(Prism::Tui::usageText().find("--list-outputs") != std::string::npos &&
        Prism::Tui::usageText().find("Choose the system output") != std::string::npos,
        "help should describe output aliases and the in-app picker");
    require(Prism::Tui::usageText().find("--profile <name>") != std::string::npos &&
        Prism::Tui::usageText().find("--theme <name>") != std::string::npos,
        "help should describe profile and theme startup selection");
}

void testOutputSwitching() {
    FakeCapture capture;
    Prism::Capture::StartResult started;
    std::string error;
    require(capture.start({}, &started, &error),
        "fake output should start before switching");

    const auto switched = Prism::Tui::switchOutputCapture(
        capture, {}, started, "alternate");
    require(switched.success && switched.captureRunning &&
        switched.requestedDeviceId == "alternate" &&
        switched.started.deviceId == "alternate" &&
        switched.started.sampleRate == 44100.0,
        "a live output switch should publish the new capture format");
    require(capture.stopCount == 1 && capture.activeDeviceId == "alternate",
        "a live switch should stop the old capture before starting the new one");

    capture.failedDeviceId = "fake";
    const auto restored = Prism::Tui::switchOutputCapture(
        capture,
        switched.requestedDeviceId,
        switched.started,
        "fake");
    require(!restored.success && restored.captureRunning &&
        restored.requestedDeviceId == "alternate" &&
        restored.started.deviceId == "alternate" &&
        restored.error.find("restored") != std::string::npos,
        "a failed output switch should restore the previous capture");

    capture.failAllStarts = true;
    const auto failed = Prism::Tui::switchOutputCapture(
        capture,
        restored.requestedDeviceId,
        restored.started,
        "fake");
    require(!failed.success && !failed.captureRunning &&
        failed.error.find("could not be restored") != std::string::npos,
        "an unrecoverable output switch should report that capture stopped");
}

void testProjectionAndLayout() {
    constexpr float sampleRate = 48000.0f;
    constexpr size_t fftSize = 2048;
    const float binFrequency = 43.0f * sampleRate / static_cast<float>(fftSize);
    Prism::Tui::AnalysisPipeline pipeline(sampleRate, fftSize);
    for (int index = 0; index < 20; ++index) {
        pipeline.process(sineChunk(binFrequency, 0.5f, fftSize, sampleRate));
    }
    const auto frame = pipeline.snapshot();
    const auto projected = Prism::Tui::projectSpectrum(
        frame.magnitudes, fftSize, 120, {sampleRate});
    require(projected.size() == 120, "projection should match terminal width");
    require(std::all_of(projected.begin(), projected.end(), [](float value) {
        return std::isfinite(value) && value >= 0.0f && value <= 1.0f;
    }), "projected values should be finite and normalized");
    const auto peak = static_cast<size_t>(std::distance(
        projected.begin(), std::max_element(projected.begin(), projected.end())));
    if (!(peak > 55 && peak < 75)) {
        std::cerr << "Projected 1 kHz peak column: " << peak << '\n';
    }
    require(peak > 55 && peak < 75, "1 kHz peak should land in the logarithmic center region");
    const auto blockRows = Prism::Tui::buildSpectrumRows(projected, 6);
    require(blockRows.size() == 6,
        "spectrum rows should follow the requested height");
    require(std::any_of(blockRows.begin(), blockRows.end(), [](const std::string& row) {
        return row.find("█") != std::string::npos;
    }), "spectrum should retain its solid block fill style");
    require(Prism::Tui::buildSpectrumRows(projected, 0).empty(),
        "zero-height spectrum should be empty");
    const auto meter = Prism::Tui::buildMeterBar(-12.0f, -6.0f, 20);
    require(!meter.empty(),
        "meter bar should render");
    require(meter.find("│") != std::string::npos,
        "meter bar should include its peak marker");

    const auto rack = Prism::Tui::defaultRackLayout();
    const auto full = Prism::Tui::buildDashboardLayout(140, 44, rack);
    require(!full.terminalTooSmall && full.configuredRows == 3 &&
        full.visibleRows == 3 && full.hiddenRows == 0 &&
        full.hiddenPanels == 0 && full.panels.size() == 7,
        "large dashboards should show the complete three-row scope rack");
    require(Prism::Tui::visiblePanelOrder(full) ==
        Prism::Tui::configuredPanelOrder(rack),
        "the dashboard should preserve rack row and tile order");
    require(std::all_of(full.panels.begin(), full.panels.end(), [](const auto& panel) {
        return panel.width >= 30 && panel.height >= 5;
    }), "all seven panes should retain usable bounds");

    const auto spectrumRight = Prism::Tui::spatialNeighbor(
        full,
        Prism::Tui::PanelId::Spectrum,
        Prism::Tui::NavigationDirection::Right);
    require(spectrumRight &&
        *spectrumRight == Prism::Tui::PanelId::Oscilloscope,
        "spatial navigation should select the adjacent scope in a row");
    const auto vectorscopeLeft = Prism::Tui::spatialNeighbor(
        full,
        Prism::Tui::PanelId::Vectorscope,
        Prism::Tui::NavigationDirection::Left);
    require(vectorscopeLeft &&
        *vectorscopeLeft == Prism::Tui::PanelId::Oscilloscope,
        "spatial navigation should move left within a row");
    const auto spectrumDown = Prism::Tui::spatialNeighbor(
        full,
        Prism::Tui::PanelId::Spectrum,
        Prism::Tui::NavigationDirection::Down);
    require(spectrumDown && *spectrumDown == Prism::Tui::PanelId::Waveform,
        "vertical navigation should choose the most-overlapping scope below");
    const auto vectorscopeDown = Prism::Tui::spatialNeighbor(
        full,
        Prism::Tui::PanelId::Vectorscope,
        Prism::Tui::NavigationDirection::Down);
    require(vectorscopeDown &&
        *vectorscopeDown == Prism::Tui::PanelId::LUFSMeter,
        "vertical navigation should respect unequal scope widths");
    const auto lufsUp = Prism::Tui::spatialNeighbor(
        full,
        Prism::Tui::PanelId::LUFSMeter,
        Prism::Tui::NavigationDirection::Up);
    require(lufsUp && *lufsUp == Prism::Tui::PanelId::Vectorscope,
        "vertical spatial navigation should be reversible across rows");
    require(!Prism::Tui::spatialNeighbor(
            full,
            Prism::Tui::PanelId::Spectrum,
            Prism::Tui::NavigationDirection::Left),
        "spatial navigation should stop at the dashboard edge");

    const auto twoRows = Prism::Tui::buildDashboardLayout(100, 20, rack);
    require(twoRows.visibleRows == 2 && twoRows.hiddenRows == 1 &&
        twoRows.panels.size() == 6 && twoRows.hiddenPanels == 1 &&
        !Prism::Tui::layoutContainsPanel(
            twoRows, Prism::Tui::PanelId::Spectrogram),
        "shorter terminals should remove complete bottom rows instead of squashing them");

    const auto oneRow = Prism::Tui::buildDashboardLayout(100, 14, rack);
    require(oneRow.visibleRows == 1 && oneRow.hiddenRows == 2 &&
        oneRow.panels.size() == 3 && oneRow.hiddenPanels == 4,
        "height collapse should retain the first rack row at its usable size");

    const auto narrow = Prism::Tui::buildDashboardLayout(60, 44, rack);
    require(narrow.visibleRows == 3 && narrow.panels.size() == 5 &&
        narrow.hiddenPanels == 2 &&
        std::all_of(narrow.panels.begin(), narrow.panels.end(), [](const auto& panel) {
            return panel.width >= 30;
        }),
        "narrow terminals should hide trailing scopes rather than crush their widths");

    const auto minimum = Prism::Tui::buildDashboardLayout(44, 12, rack);
    require(!minimum.terminalTooSmall && minimum.panels.size() == 1 &&
        minimum.panels[0].panel == Prism::Tui::PanelId::Spectrum &&
        minimum.panels[0].width == 44 && minimum.panels[0].height == 10,
        "the minimum terminal should retain one complete usable scope");
    require(Prism::Tui::buildDashboardLayout(43, 12, rack).terminalTooSmall,
        "narrow resize should select the compact screen");
    require(Prism::Tui::buildDashboardLayout(80, 11, rack).terminalTooSmall,
        "short resize should select the compact screen");

    Prism::Tui::RackLayout compactMeters{{
        {1, {{Prism::Tui::PanelId::LUFSMeter, 1}}},
        {1, {{Prism::Tui::PanelId::VUMeter, 1}}},
    }};
    const auto compactMeterLayout = Prism::Tui::buildDashboardLayout(
        44, 12, compactMeters);
    require(compactMeterLayout.visibleRows == 2 &&
        compactMeterLayout.panels.size() == 2,
        "LUFS should fit in a compact four-row pane without hiding the next row");

    const auto expanded = Prism::Tui::buildDashboardLayout(
        100, 30, rack, Prism::Tui::PanelId::LUFSMeter);
    require(expanded.panels.size() == 1 &&
        expanded.panels[0].panel == Prism::Tui::PanelId::LUFSMeter &&
        expanded.panels[0].width == 100 && expanded.panels[0].height == 28,
        "expanded panels should occupy the complete dashboard area");
    require(Prism::Tui::nextPanel(Prism::Tui::PanelId::Spectrum) ==
        Prism::Tui::PanelId::Oscilloscope,
        "panel focus should cycle forward");
    require(Prism::Tui::nextPanel(Prism::Tui::PanelId::Spectrum, true) ==
        Prism::Tui::PanelId::Waveform,
        "panel focus should cycle backward");
    const auto compactPanels = Prism::Tui::visiblePanelOrder(oneRow);
    require(compactPanels.size() == 3 &&
        Prism::Tui::nextPanel(
            Prism::Tui::PanelId::Spectrum, compactPanels) ==
                Prism::Tui::PanelId::Oscilloscope,
        "compact layout focus should follow only the visible rack scopes");

    const std::string encodedRack = Prism::Tui::serializeRackLayout(rack);
    require(Prism::Tui::parseRackLayout(encodedRack, {}) == rack,
        "rack layouts should round-trip through their compact configuration form");
    require(Prism::Tui::parseRackLayout("not-a-rack", rack) == rack,
        "malformed saved racks should fall back safely");
    auto editedRack = rack;
    require(Prism::Tui::moveRackPanelHorizontal(
            editedRack, Prism::Tui::PanelId::Spectrum, 1) &&
        editedRack.rows[0].tiles[1].panel == Prism::Tui::PanelId::Spectrum,
        "rack tiles should reorder within a row");
    require(Prism::Tui::moveRackPanelVertical(
            editedRack, Prism::Tui::PanelId::Spectrum, 1) &&
        Prism::Tui::rackPanelLocation(
            editedRack, Prism::Tui::PanelId::Spectrum)->first == 1,
        "rack tiles should move between rows");
    require(Prism::Tui::resizeRackPanel(
            editedRack, Prism::Tui::PanelId::Spectrum, 1) &&
        Prism::Tui::resizeRackRow(
            editedRack, Prism::Tui::PanelId::Spectrum, 1),
        "rack editing should resize both scope widths and row heights");

    Prism::Tui::RackLayout splitRack{{
        {1, {{Prism::Tui::PanelId::Spectrum, 1},
             {Prism::Tui::PanelId::Oscilloscope, 1}}},
    }};
    require(Prism::Tui::splitRackRow(
            splitRack, Prism::Tui::PanelId::Spectrum) &&
        splitRack.rows.size() == 2,
        "rack editing should split a scope into a new row");
    require(Prism::Tui::removeRackPanel(
            editedRack, Prism::Tui::PanelId::Vectorscope) &&
        Prism::Tui::addRackPanel(
            editedRack,
            Prism::Tui::PanelId::Vectorscope,
            Prism::Tui::PanelId::Oscilloscope),
        "rack editing should remove and restore optional scopes");
    Prism::Tui::RackLayout lastScope{{
        {1, {{Prism::Tui::PanelId::Spectrum, 1}}},
    }};
    require(!Prism::Tui::removeRackPanel(
            lastScope, Prism::Tui::PanelId::Spectrum),
        "rack editing should never remove the final scope");
}

void testMeterDisplayModels() {
    require(std::abs(Prism::Tui::dbfsToClassicVu(-14.0f, -14.0f)) < 0.001f,
        "the reference level should map exactly to 0 VU");
    require(std::abs(
        Prism::Tui::classicVuToNormalized(0.0f) - 0.81f) < 0.001f,
        "the TUI should preserve Prism's classic nonlinear VU scale");
    require(Prism::Tui::classicVuToNormalized(-10.0f) <
        Prism::Tui::classicVuToNormalized(-5.0f),
        "classic VU projection should remain monotonic");
    require(Prism::Tui::compactMeterToNormalized(-50.0f) == 0.0f &&
        Prism::Tui::compactMeterToNormalized(0.0f) == 1.0f,
        "LUFS compact bars should use the GUI's -50 to 0 range");
    require(std::abs(
        Prism::Tui::stereoRmsDbAverage(-10.0f, -10.0f) + 10.0f) < 0.001f,
        "combined VU needles should average channels in the power domain");
    require(Prism::Tui::selectLufsReadout(
        -10.0f, -12.0f, -14.0f, Prism::Tui::LUFSReadout::Integrated) == -14.0f,
        "LUFS readout selection should drive the dedicated loudness bar");
}

void testSpectrumPeakModel() {
    constexpr float sampleRate = 48000.0f;
    constexpr size_t fftSize = 4096;
    const float targetBin = 440.0f * static_cast<float>(fftSize) / sampleRate;
    std::vector<float> magnitudes(fftSize / 2, -100.0f);
    for (size_t bin = 1; bin + 1 < magnitudes.size(); ++bin) {
        const float distance = static_cast<float>(bin) - targetBin;
        magnitudes[bin] = std::max(-100.0f, -12.0f - 4.0f * distance * distance);
    }

    Prism::Tui::SpectrumPeakTracker tracker;
    const auto peak = tracker.select(magnitudes, sampleRate, fftSize, 2.0f);
    require(peak.has_value(), "a deterministic spectral peak should be detected");
    require(std::abs(peak->frequencyHz - 440.0f) < 1.0f,
        "quadratic peak interpolation should recover sub-bin frequency");
    require(std::abs(peak->dbfs + 12.0f) < 0.1f,
        "peak readout should preserve the untilted dBFS value");
    require(peak->pitch.find("A4") == 0,
        "peak readout should include its musical pitch");
    require(Prism::Tui::formatSpectrumPitch(261.6256f).find("C4") == 0,
        "pitch formatting should use conventional note and octave names");

    tracker.reset();
    std::fill(magnitudes.begin(), magnitudes.end(), -100.0f);
    require(!tracker.select(magnitudes, sampleRate, fftSize, 2.0f),
        "silent spectra should not produce a peak readout");
}

void testIroThemes() {
    constexpr const char* content = R"iro(
[Theme]
format = prism-theme
version = 2
credit = Prism Test
description = Native theme parser fixture

[App]
background = 10, 20, 30
accent = 40, 50, 60
text = 230, 240, 250
text_muted = 100, 110, 120
border = 70, 80, 90

[Scopes]
background = 11, 21, 31
guides = 71, 81, 91

[Spectrum]
line = 1, 2, 3

[Vectorscope]
band_low = 4, 5, 6
band_mid = 7, 8, 9
band_high = 10, 11, 12

[Spectrogram]
heat_low = 13, 14, 15
heat_mid = 16, 17, 18
heat_high = 19, 20, 21

[Waveform]
line = 22, 23, 24
)iro";

    Prism::Tui::TuiTheme parsed;
    std::string error;
    require(Prism::Tui::parseIroThemeText(content, "Test Theme", parsed, &error),
        "valid Prism v2 .iro themes should parse natively");
    require(parsed.id == "Test Theme" && parsed.credit == "Prism Test" &&
        parsed.background == Prism::Tui::ThemeColor{10, 20, 30} &&
        parsed.spectrumLine == Prism::Tui::ThemeColor{1, 2, 3},
        "theme metadata and primary scope colors should be retained");
    require(parsed.oscilloscopeLine == Prism::Tui::ThemeColor{40, 50, 60} &&
        parsed.oscilloscopeBackground == Prism::Tui::ThemeColor{11, 21, 31},
        "missing scope colors should inherit the shared Prism theme defaults");
    require(parsed.vectorscopeBands[2] == Prism::Tui::ThemeColor{10, 11, 12} &&
        parsed.spectrogramHeat[1] == Prism::Tui::ThemeColor{16, 17, 18} &&
        parsed.waveformLine == Prism::Tui::ThemeColor{22, 23, 24},
        "scope-specific .iro palettes should map to their TUI renderers");

    Prism::Tui::TuiTheme invalid;
    require(!Prism::Tui::parseIroThemeText(
            "[Theme]\nformat=prism-theme\nversion=99\n",
            "Invalid", invalid, &error),
        "unsupported .iro versions should be rejected");

    const auto root = std::filesystem::temp_directory_path() /
        "prism-tui-iro-theme-test";
    std::error_code ignored;
    std::filesystem::remove_all(root, ignored);
    std::filesystem::create_directories(root, ignored);
    {
        std::ofstream output(root / "Test Theme.iro");
        output << content;
    }
    {
        std::ofstream output(root / "Redshift.iro");
        output << content;
    }
    {
        std::ofstream output(root / "_TEMPLATE.iro");
        output << content;
    }
    {
        std::ofstream output(root / "Broken.iro");
        output << "[Theme]\nformat=not-prism\nversion=2\n";
    }

    Prism::Tui::IroThemeLibrary library(root);
    std::string warning;
    require(library.load(&warning) && library.themes().size() == 7 &&
        library.find("Default") && library.find("Alpha Centauri") &&
        library.find("Chroma Blue") && library.find("Chroma Green") &&
        library.find("Redshift") && library.find("Stanky Leg") &&
        library.find("Test Theme"),
        "theme discovery should include bundled themes, load .iro files, and ignore templates");
    require(library.find("Redshift")->spectrumLine ==
        Prism::Tui::ThemeColor{1, 2, 3},
        "managed .iro files should override bundled themes with the same filename stem");
    require(library.findSelector("alpha-centauri") &&
        library.findSelector("alpha-centauri")->id == "Alpha Centauri" &&
        library.findSelector("TEST THEME") &&
        !library.findSelector("Not A Theme"),
        "theme startup selectors should accept visible names and normalized IDs");
    const std::string nextTheme = library.adjacentId("Default", 1);
    require(!warning.empty() && nextTheme != "Default" &&
        library.find(nextTheme) && library.adjacentId(nextTheme, -1) == "Default",
        "theme discovery should report invalid files and cycle deterministically");
    std::filesystem::remove_all(root, ignored);
}

void testSettingsModelAndPersistence() {
    Prism::Tui::TuiSettings settings;
    settings.inputTrimDb = 30.0f;
    settings.refreshRate = 42;
    settings.spectrumTiltDbPerOctave = -8.0f;
    settings.oscilloscopeTraceWeight = 20;
    settings = Prism::Tui::normalizeSettings(settings);
    require(settings.inputTrimDb == 12.0f && settings.refreshRate == 60 &&
        settings.spectrumTiltDbPerOctave == -2.0f &&
        settings.oscilloscopeTraceWeight == 3,
        "settings normalization should enforce public ranges");

    const auto pages = Prism::Tui::settingsPages();
    require(pages.size() == 9 &&
        Prism::Tui::settingsForPage(Prism::Tui::SettingsPage::Appearance).size() == 2 &&
        Prism::Tui::settingsForPage(Prism::Tui::SettingsPage::General).size() == 2,
        "settings should expose shallow category pages");
    Prism::Tui::TuiSettings adjusted;
    require(Prism::Tui::adjustSetting(
            adjusted, Prism::Tui::SettingId::TerminalCompatibility, 1) &&
        adjusted.terminalCompatibility ==
            Prism::Tui::TerminalCompatibilityMode::Compatible &&
        Prism::Tui::effectiveRefreshRate(
            120, adjusted.terminalCompatibility) == 60,
        "compatible terminals should use the 256-color mode with a 60 FPS cap");
    require(Prism::Tui::adjustSetting(
            adjusted, Prism::Tui::SettingId::TerminalCompatibility, 1) &&
        adjusted.terminalCompatibility ==
            Prism::Tui::TerminalCompatibilityMode::Safe &&
        Prism::Tui::effectiveRefreshRate(
            120, adjusted.terminalCompatibility) == 30,
        "safe terminals should use the ANSI mode with a 30 FPS cap");
    require(Prism::Tui::adjustSetting(
            adjusted, Prism::Tui::SettingId::TerminalCompatibility, 1) &&
        adjusted.terminalCompatibility ==
            Prism::Tui::TerminalCompatibilityMode::Modern,
        "terminal compatibility should cycle back to modern truecolor");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::RefreshRate, 1) &&
        adjusted.refreshRate == 120 &&
        Prism::Tui::settingValue(
            adjusted, Prism::Tui::SettingId::RefreshRate).find("experimental") !=
            std::string::npos,
        "refresh settings should expose an explicit experimental 120 FPS mode");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::RefreshRate, 1) &&
        adjusted.refreshRate == 30 &&
        Prism::Tui::adjustSetting(
            adjusted, Prism::Tui::SettingId::RefreshRate, -1) &&
        adjusted.refreshRate == 120,
        "refresh settings should cycle through 30, 60, and 120 FPS in both directions");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::InputTrim, 1) &&
        adjusted.inputTrimDb == 0.5f,
        "numeric settings should adjust by their documented step");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::SpectrumPeakReadout, 1) &&
        !adjusted.spectrumPeakReadout,
        "boolean settings should toggle directly");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::OscilloscopePitchLock, 1) &&
        !adjusted.oscilloscopePitchLock &&
        !adjusted.oscilloscopeFrequencyReadout,
        "disabling pitch lock should also disable its frequency readout");
    require(!Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::OscilloscopeFrequencyReadout, 1) &&
        !adjusted.oscilloscopeFrequencyReadout,
        "frequency readout should remain unavailable without pitch lock");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::OscilloscopePitchLock, 1) &&
        adjusted.oscilloscopePitchLock,
        "pitch lock should remain independently re-enableable");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::VUMeterMode, 1) &&
        adjusted.vuMeterMode == Prism::Tui::VUMeterMode::Needle,
        "VU settings should expose the GUI's needle presentation");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::LUFSReadout, 1) &&
        adjusted.lufsReadout == Prism::Tui::LUFSReadout::Integrated,
        "LUFS settings should select an independent loudness window");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::SpectrogramClarity, -1) &&
        adjusted.spectrogramClarity == Prism::Tui::SpectrogramClarity::Sharp,
        "spectrogram settings should cycle through the native clarity modes");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::WaveformMode, 1) &&
        adjusted.waveformMode == Prism::Tui::WaveformMode::Stereo,
        "waveform settings should expose independent mono and stereo modes");
    require(Prism::Tui::adjustSetting(
        adjusted, Prism::Tui::SettingId::WaveformMultiband, 1) &&
        adjusted.waveformMultiband,
        "waveform settings should expose the GUI multiband color mode");
    require(Prism::Tui::resetSetting(
        adjusted, Prism::Tui::SettingId::InputTrim) &&
        adjusted.inputTrimDb == 0.0f,
        "individual settings should reset to defaults");

    const auto settingsPath = std::filesystem::temp_directory_path() /
        "prism-tui-settings-test.conf";
    std::error_code ignored;
    std::filesystem::remove(settingsPath, ignored);
    require(Prism::Tui::moveRackPanelHorizontal(
            adjusted.rackLayout, Prism::Tui::PanelId::Spectrum, 1),
        "settings persistence should include an edited rack layout");
    adjusted.vectorscopeMode = Prism::Tui::VectorscopeMode::PolarBipolar;
    adjusted.vectorscopeDetail = Prism::Tui::VectorscopeDetail::Maximum;
    adjusted.themeId = "Test Theme";
    adjusted.terminalCompatibility =
        Prism::Tui::TerminalCompatibilityMode::Compatible;
    std::string error;
    require(Prism::Tui::saveSettings(adjusted, settingsPath, &error),
        "settings should persist to a TUI-specific configuration file");
    require(Prism::Tui::loadSettings(settingsPath) == adjusted,
        "persisted settings should round-trip without changing values");
    std::filesystem::remove(settingsPath, ignored);
}

void testProfileLibrary() {
    const auto root = std::filesystem::temp_directory_path() /
        "prism-tui-profile-library-test";
    const auto profilesPath = root / "profiles";
    const auto statePath = root / "profile-state.conf";
    std::error_code ignored;
    std::filesystem::remove_all(root, ignored);

    Prism::Tui::TuiProfileLibrary library(profilesPath, statePath);
    std::string error;
    require(library.load(&error),
        "the profile library should initialize its managed directory");
    require(library.profiles().size() == 1 &&
        library.profiles().front().id == Prism::Tui::kDefaultTuiProfileId &&
        library.profiles().front().isDefault,
        "the profile library should always provide a default profile");

    Prism::Tui::TuiSettings settings;
    settings.themeId = "Test Theme";
    settings.terminalCompatibility =
        Prism::Tui::TerminalCompatibilityMode::Safe;
    settings.inputTrimDb = 4.0f;
    settings.refreshRate = 30;
    settings.spectrogramContrast = 1.7f;
    require(Prism::Tui::moveRackPanelHorizontal(
            settings.rackLayout, Prism::Tui::PanelId::Spectrum, 1),
        "profile fixtures should retain custom rack ordering");
    std::string profileId;
    require(library.saveNew("Studio Wide", settings, &profileId, &error),
        "the current TUI setup should save as a named profile");
    require(library.activeProfileId() == profileId &&
        library.find(profileId) &&
        Prism::Tui::profileSettingsEqual(
            library.find(profileId)->settings, settings),
        "saving a profile should activate and preserve its scoped settings");
    require(library.findSelector("studio wide") &&
        library.findSelector("studio wide")->id == profileId &&
        library.findSelector(profileId) &&
        !library.findSelector("Missing Profile"),
        "profile startup selectors should accept names and internal IDs");
    require(library.activate(Prism::Tui::kDefaultTuiProfileId, &error) &&
        library.selectForSession(profileId, &error) &&
        library.activeProfileId() == profileId,
        "startup profile selection should update the active session");
    Prism::Tui::TuiProfileLibrary sessionReload(profilesPath, statePath);
    require(sessionReload.load(&error) &&
        sessionReload.activeProfileId() == Prism::Tui::kDefaultTuiProfileId,
        "startup profile selection should not rewrite the persisted active profile");
    require(library.activate(profileId, &error),
        "profile fixtures should restore their persisted active selection");

    bool foundProfileFile = false;
    for (const auto& entry : std::filesystem::directory_iterator(profilesPath)) {
        if (entry.path().extension() != Prism::Tui::kTuiProfileExtension) continue;
        std::ifstream input(entry.path());
        const std::string text{
            std::istreambuf_iterator<char>(input),
            std::istreambuf_iterator<char>()};
        if (text.find("id=" + profileId) == std::string::npos) continue;
        foundProfileFile = true;
        require(text.find("format=prism-tui-profile") != std::string::npos &&
            text.find("theme_id=Test Theme") != std::string::npos &&
            text.find("refresh_rate=") == std::string::npos &&
            text.find("terminal_mode=") == std::string::npos,
            ".prsmt files should retain themes while excluding terminal runtime settings");
    }
    require(foundProfileFile,
        "saved TUI profiles should use the .prsmt extension");

    Prism::Tui::TuiSettings differentRefresh = settings;
    differentRefresh.refreshRate = 60;
    differentRefresh.terminalCompatibility =
        Prism::Tui::TerminalCompatibilityMode::Modern;
    require(Prism::Tui::profileSettingsEqual(settings, differentRefresh),
        "terminal runtime settings should not make an active profile dirty");
    const auto applied = Prism::Tui::applyProfileSettings(
        settings, differentRefresh);
    require(applied.refreshRate == 60 &&
        applied.terminalCompatibility ==
            Prism::Tui::TerminalCompatibilityMode::Modern &&
        applied.inputTrimDb == 4.0f,
        "loading a profile should preserve terminal runtime settings while applying trim");

    settings.waveformMultiband = true;
    require(library.overwrite(profileId, settings, &error) &&
        library.find(profileId)->settings.waveformMultiband,
        "overwriting should replace the active profile snapshot");
    require(library.renameProfile(profileId, "Live Rack", &error) &&
        library.find(profileId)->name == "Live Rack",
        "user profiles should be renameable without changing their identity");

    Prism::Tui::TuiProfileLibrary reloaded(profilesPath, statePath);
    require(reloaded.load(&error) &&
        reloaded.activeProfileId() == profileId &&
        reloaded.find(profileId)->name == "Live Rack",
        "the active profile and renamed file should survive a restart");
    require(!reloaded.renameProfile(
            Prism::Tui::kDefaultTuiProfileId, "Other", &error) &&
        !reloaded.deleteProfile(
            Prism::Tui::kDefaultTuiProfileId, &error),
        "the default profile should not be renamed or deleted");
    require(reloaded.deleteProfile(profileId, &error) &&
        reloaded.activeProfileId().empty() && !reloaded.find(profileId),
        "deleting the active profile should clear the active selection safely");

    std::filesystem::remove_all(root, ignored);
}

void testScopePlotModels() {
    const auto oscilloscope = Prism::Tui::buildOscilloscopePlot(
        {-1.0f, 0.0f, 1.0f}, 9, 9);
    require(oscilloscope.size() == 9,
        "oscilloscope projection should fill every Braille pixel column");
    require(oscilloscope.front().y == 8 && oscilloscope.back().y == 0,
        "oscilloscope projection should preserve full-scale polarity");
    require(std::all_of(
        oscilloscope.begin(), oscilloscope.end(), [](const Prism::Tui::PlotPoint& point) {
            return point.x >= 0 && point.x < 9 && point.y >= 0 && point.y < 9;
        }), "oscilloscope projection should remain bounded");
    const auto zeroLine = Prism::Tui::buildOscilloscopePlot({0.0f}, 1, 8);
    require(zeroLine.front().y == Prism::Tui::oscilloscopeZeroY(8) &&
        zeroLine.front().y == 4,
        "the oscilloscope zero line should use the waveform's center rounding");

    const std::vector<float> multiband = {
        1.0f, 0.0f,
        0.0f, 0.5f,
        -1.0f, -0.5f,
    };
    const auto vectorscope = Prism::Tui::buildVectorscopePlot(
        multiband, 1, 21, 21);
    require(vectorscope[0].size() == 1 &&
        vectorscope[1].size() == 1 &&
        vectorscope[2].size() == 1,
        "vectorscope projection should preserve all three frequency bands");
    for (const auto& band : vectorscope) {
        require(std::all_of(
            band.begin(), band.end(), [](const Prism::Tui::PlotPoint& point) {
                return point.x >= 0 && point.x < 21 && point.y >= 0 && point.y < 21;
            }), "vectorscope projection should remain bounded");
    }
    require(Prism::Tui::buildOscilloscopePlot({}, 10, 10).empty(),
        "an empty oscilloscope frame should render no points");

    auto mode = Prism::Tui::VectorscopeMode::Lissajous;
    for (int index = 0; index < 5; ++index) {
        require(std::string(Prism::Tui::vectorscopeModeName(mode)).size() > 0,
            "each vectorscope mode should have a display name");
        mode = Prism::Tui::nextVectorscopeMode(mode);
    }
    require(mode == Prism::Tui::VectorscopeMode::Lissajous,
        "vectorscope mode selection should cycle through all five modes");

    const std::vector<float> correlated = {
        0.25f, 0.25f,
        0.25f, 0.25f,
        0.25f, 0.25f,
    };
    const auto linear = Prism::Tui::buildVectorscopePlot(
        correlated,
        1,
        41,
        41,
        Prism::Tui::VectorscopeMode::LinearBipolar);
    const auto polar = Prism::Tui::buildVectorscopePlot(
        correlated,
        1,
        41,
        41,
        Prism::Tui::VectorscopeMode::PolarBipolar);
    const auto centeredLayout = Prism::Tui::getVectorscopePlotLayout(
        41, 41, Prism::Tui::VectorscopeMode::LinearBipolar);
    require(linear[0].front().x == centeredLayout.centerX &&
        linear[0].front().y < centeredLayout.centerY,
        "linear vectorscope mode should rotate correlated stereo onto the mono axis");
    require(polar[0].front().y < linear[0].front().y,
        "polar vectorscope mode should expand quiet points radially");

    const std::vector<float> negativeMid = {
        -0.5f, -0.5f,
        -0.5f, -0.5f,
        -0.5f, -0.5f,
    };
    const auto unipolar = Prism::Tui::buildVectorscopePlot(
        negativeMid,
        1,
        41,
        41,
        Prism::Tui::VectorscopeMode::PolarUnipolar);
    require(unipolar[0].empty() && unipolar[1].empty() && unipolar[2].empty(),
        "unipolar vectorscope modes should omit negative-mid points");
    const auto unipolarLayout = Prism::Tui::getVectorscopePlotLayout(
        41, 41, Prism::Tui::VectorscopeMode::PolarUnipolar);
    require(unipolarLayout.unipolar &&
        unipolarLayout.centerY > centeredLayout.centerY,
        "unipolar vectorscope modes should use the lower display origin");

    std::vector<float> denseMultiband(300 * Visualizer::MULTIBAND_POINT_STRIDE, 0.2f);
    const auto detailPreserving = Prism::Tui::buildVectorscopePlot(
        denseMultiband,
        300,
        12,
        12,
        Prism::Tui::VectorscopeMode::Lissajous);
    for (const auto& band : detailPreserving) {
        require(band.size() <= 64,
            "vectorscope projection should adapt its point budget to terminal resolution");
        require(!band.empty() && band.front().intensity < band.back().intensity &&
            band.back().intensity == 1.0f,
            "vectorscope projection should retain chronological intensity information");
    }
    const auto balancedDetail = Prism::Tui::buildVectorscopePlot(
        denseMultiband, 300, 30, 30, Prism::Tui::VectorscopeMode::Lissajous, 10);
    const auto maximumDetail = Prism::Tui::buildVectorscopePlot(
        denseMultiband, 300, 30, 30, Prism::Tui::VectorscopeMode::Lissajous, 3);
    require(balancedDetail[0].size() < maximumDetail[0].size(),
        "vectorscope detail settings should change the adaptive point budget");
}

void testPitchReadoutResponse() {
    constexpr float sampleRate = 48000.0f;
    Visualizer::Oscilloscope oscilloscope;
    oscilloscope.setSampleRate(sampleRate);
    oscilloscope.setPitchLock(true);

    const auto lowTone = sineChunk(100.0f, 0.5f, 4096, sampleRate);
    oscilloscope.pushSamples(lowTone.left.data(), lowTone.left.size());
    for (int index = 0; index < 24; ++index) {
        oscilloscope.process();
    }

    const auto highTone = sineChunk(400.0f, 0.5f, 4096, sampleRate);
    oscilloscope.pushSamples(highTone.left.data(), highTone.left.size());
    const auto locked = oscilloscope.process();
    const float latest = oscilloscope.getLatestDetectedPitch();
    require(latest > 0.0f &&
        std::abs(latest - 400.0f) < std::abs(locked.detectedPitch - 400.0f),
        "the fast pitch readout should respond before the stable trigger pitch");

    Visualizer::Oscilloscope freeRunning;
    freeRunning.setSampleRate(sampleRate);
    freeRunning.setPitchLock(false);
    freeRunning.setDisplaySamples(128);
    const auto firstChunk = sineChunk(200.0f, 0.5f, 512, sampleRate);
    freeRunning.pushSamples(firstChunk.left.data(), firstChunk.left.size());
    const auto firstWindow = freeRunning.process();
    require(firstWindow.triggerIndex == 384.0f,
        "free-running oscilloscopes should show the newest complete window");
    const auto nextChunk = sineChunk(200.0f, 0.5f, 64, sampleRate);
    freeRunning.pushSamples(nextChunk.left.data(), nextChunk.left.size());
    const auto nextWindow = freeRunning.process();
    require(nextWindow.triggerIndex == 448.0f &&
        nextWindow.triggerIndex != firstWindow.triggerIndex,
        "free-running oscilloscope windows should advance with every audio chunk");
}

void testScrollingHistory() {
    Prism::Tui::ScrollingHistory history(2, 3);
    history.append(std::vector<float>{
        1.0f, 10.0f,
        2.0f, 20.0f,
        3.0f, 30.0f,
        4.0f, 40.0f,
    });
    const auto wrapped = history.snapshot();
    require(wrapped.columnCount == 3 && wrapped.columnStride == 2,
        "rolling histories should remain at their fixed column capacity");
    require(wrapped.values == std::vector<float>({
        2.0f, 20.0f,
        3.0f, 30.0f,
        4.0f, 40.0f,
    }), "rolling history snapshots should publish oldest-to-newest columns");
    history.reset();
    require(history.snapshot().values.empty(),
        "history reset should remove old visual data");
}

void testPipelineAndFakeCapture() {
    FakeCapture capture;
    Prism::Capture::StartResult started;
    std::string error;
    require(capture.start({}, &started, &error), "fake capture should start");
    require(!capture.start("missing", &started, &error),
        "fake capture should reject an unknown selected device");
    for (int index = 0; index < 20; ++index) {
        capture.chunks.push_back(sineChunk(1000.0f, 0.25f, 2400, 48000.0f));
    }

    require(Prism::Tui::kDefaultFftSize == 4096,
        "the TUI spectrum should default to a 4096-point FFT");
    Prism::Tui::AnalysisPipeline pipeline(48000.0f);
    bool captureOverrun = false;
    capture.nextOverwriteCount = 3;
    std::thread worker([&]() {
        while (!capture.chunks.empty()) {
            Prism::Tui::drainCapture(capture, pipeline, captureOverrun, 4);
        }
        capture.stop();
    });
    worker.join();
    require(captureOverrun, "capture draining should publish queue overruns");
    const auto frame = pipeline.snapshot();
    require(frame.magnitudes.size() == Prism::Tui::kDefaultFftSize / 2,
        "the default analysis pipeline should publish the 4096-point spectrum");
    require(frame.oscilloscope.samples.size() == 2048 &&
        frame.oscilloscope.signalPresent,
        "the pipeline should publish a live pitch-locked oscilloscope window");
    require(std::isfinite(frame.oscilloscope.detectedPitch) &&
        frame.oscilloscope.detectedPitch > 0.0f,
        "the pipeline should publish the fast pitch readout");
    require(std::all_of(
        frame.oscilloscope.samples.begin(),
        frame.oscilloscope.samples.end(),
        [](float sample) { return std::isfinite(sample); }),
        "oscilloscope samples should remain finite");
    require(frame.vectorscope.pointCount == Prism::Tui::kVectorscopeDisplayPoints &&
        frame.vectorscope.multibandPoints.size() ==
            frame.vectorscope.pointCount * Visualizer::MULTIBAND_POINT_STRIDE,
        "the pipeline should publish a full multiband vectorscope frame");
    require(std::all_of(
        frame.vectorscope.multibandPoints.begin(),
        frame.vectorscope.multibandPoints.end(),
        [](float sample) { return std::isfinite(sample); }),
        "vectorscope samples should remain finite");
    require(frame.spectrogram.display.columnCount > 0 &&
        frame.spectrogram.display.columnStride == Prism::Tui::kSpectrogramHistoryRows &&
        frame.spectrogram.heat.columnCount == frame.spectrogram.display.columnCount,
        "the pipeline should publish synchronized spectrogram intensity histories");
    const size_t latestSpectrogramOffset =
        (frame.spectrogram.display.columnCount - 1) *
        frame.spectrogram.display.columnStride;
    const auto spectrogramBegin =
        frame.spectrogram.display.values.begin() +
        static_cast<std::ptrdiff_t>(latestSpectrogramOffset);
    const auto spectrogramEnd = spectrogramBegin +
        static_cast<std::ptrdiff_t>(frame.spectrogram.display.columnStride);
    const size_t dominantSpectrogramRow = static_cast<size_t>(std::distance(
        spectrogramBegin, std::max_element(spectrogramBegin, spectrogramEnd)));
    require(dominantSpectrogramRow > 42 && dominantSpectrogramRow < 68,
        "a deterministic 1 kHz tone should occupy the expected logarithmic spectrogram band");
    require(frame.waveform.history.columnCount > 0 &&
        frame.waveform.history.columnStride == Visualizer::WAVEFORM_STEREO_SUMMARY_STRIDE &&
        !frame.waveform.stereo,
        "the pipeline should publish a bounded mono waveform history by default");
    const size_t latestWaveformOffset =
        (frame.waveform.history.columnCount - 1) * frame.waveform.history.columnStride;
    const float* latestWaveform =
        frame.waveform.history.values.data() + latestWaveformOffset;
    require(latestWaveform[0] < -0.20f && latestWaveform[1] > 0.20f,
        "waveform columns should retain the real minimum and maximum sample envelope");
    require(std::all_of(latestWaveform + 2, latestWaveform + 5, [](float value) {
        return std::isfinite(value) && value >= 0.0f;
    }), "waveform columns should retain finite native multiband RMS values");
    require(frame.vu.barLDb > -20.0f && frame.vu.barLDb < -5.0f,
        "VU level should reflect deterministic input");
    require(std::isfinite(frame.lufs.momentaryLUFS) && frame.lufs.momentaryLUFS > -60.0f,
        "LUFS pipeline should produce a finite reading");
    require(std::abs(frame.lufs.momentaryLUFS + 12.03f) < 0.5f,
        "momentary LUFS should match the deterministic stereo tone");
    require(std::abs(frame.lufs.integratedLUFS + 12.03f) < 0.5f,
        "integrated LUFS should match the deterministic stereo tone");

    Prism::Tui::AnalysisPipeline trimmedPipeline(48000.0f);
    trimmedPipeline.setInputTrimDb(6.0f);
    for (int index = 0; index < 20; ++index) {
        trimmedPipeline.process(sineChunk(1000.0f, 0.25f, 2400, 48000.0f));
    }
    const auto trimmed = trimmedPipeline.snapshot();
    require(std::abs((trimmed.vu.barLDb - frame.vu.barLDb) - 6.0f) < 0.35f,
        "input trim should affect the real VU analyzer before processing");
    require(std::abs((trimmed.lufs.momentaryLUFS - frame.lufs.momentaryLUFS) - 6.0f) < 0.35f,
        "input trim should affect the real loudness analyzer before processing");

    Prism::Tui::AnalysisPipeline stereoPipeline(48000.0f);
    stereoPipeline.setWaveformSettings(true, 2);
    for (int index = 0; index < 20; ++index) {
        stereoPipeline.process(stereoSineChunk(1000.0f, 0.5f, 0.125f, 2400, 48000.0f));
    }
    const auto stereo = stereoPipeline.snapshot();
    require(stereo.vu.barLDb > stereo.vu.barRDb + 10.0f,
        "stereo VU values should preserve independent channel levels");
    require(stereo.waveform.stereo && stereo.waveform.history.columnCount > 0,
        "stereo waveform mode should publish independent channel envelopes");
    const size_t stereoWaveformOffset =
        (stereo.waveform.history.columnCount - 1) *
        stereo.waveform.history.columnStride;
    const float* stereoWaveform =
        stereo.waveform.history.values.data() + stereoWaveformOffset;
    require(stereoWaveform[1] > stereoWaveform[6] * 3.0f,
        "stereo waveform envelopes should preserve independent channel amplitudes");
    pipeline.reset();
    const auto reset = pipeline.snapshot();
    require(reset.lufs.integratedLUFS <= -59.0f, "reset should clear integrated loudness");
    require(!reset.oscilloscope.signalPresent,
        "reset should clear the oscilloscope display window");
    require(reset.oscilloscope.detectedPitch == 0.0f,
        "reset should clear the fast pitch readout");
    require(reset.vectorscope.pointCount == 0 && reset.vectorscope.multibandPoints.empty(),
        "reset should clear vectorscope history");
    require(reset.spectrogram.display.columnCount == 0 &&
        reset.spectrogram.heat.columnCount == 0,
        "reset should clear both spectrogram histories");
    require(reset.waveform.history.columnCount == 0,
        "reset should clear waveform history");
    require(capture.stopped, "fake capture should stop cleanly");
}

void testThreadSafeSnapshots() {
    Prism::Tui::SnapshotStore<size_t> snapshots;
    constexpr size_t finalValue = 10000;
    std::thread publisher([&]() {
        for (size_t value = 1; value <= finalValue; ++value) {
            snapshots.publish(value);
        }
    });
    size_t observed = 0;
    while (observed < finalValue) {
        observed = std::max(observed, snapshots.read());
    }
    publisher.join();
    require(snapshots.read() == finalValue,
        "immutable display snapshots should publish safely across threads");
}

void testFrameRateMeter() {
    Prism::Tui::FrameRateMeter meter;
    require(meter.record(0.0) == 0.0 && meter.record(0.01) == 0.0,
        "render telemetry should wait for a stable sample window");
    meter.reset();
    for (int frame = 0; frame <= 60; ++frame) {
        meter.record(static_cast<double>(frame) / 60.0);
    }
    require(std::abs(meter.framesPerSecond() - 60.0) < 0.1,
        "render telemetry should measure a deterministic 60 FPS cadence");
    meter.reset();
    require(meter.framesPerSecond() == 0.0 && meter.record(5.0) == 0.0,
        "render telemetry should reset without inventing an initial frame rate");
    require(meter.record(4.0) == 0.0,
        "render telemetry should recover safely from a regressing clock");
}

}  // namespace

int main() {
    testCli();
    testOutputSwitching();
    testProjectionAndLayout();
    testMeterDisplayModels();
    testSpectrumPeakModel();
    testIroThemes();
    testSettingsModelAndPersistence();
    testProfileLibrary();
    testScopePlotModels();
    testPitchReadoutResponse();
    testScrollingHistory();
    testPipelineAndFakeCapture();
    testFrameRateMeter();
    testThreadSafeSnapshots();
    std::cout << "Prism TUI tests passed\n";
    return 0;
}
