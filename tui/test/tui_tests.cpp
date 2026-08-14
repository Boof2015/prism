#include "analysis_pipeline.h"
#include "cli.h"
#include "dashboard_layout.h"
#include "display_model.h"
#include "meter_display_model.h"
#include "scope_plot_model.h"
#include "snapshot_store.h"
#include "spectrum_peak_model.h"
#include "system_audio_capture.h"
#include "tui_settings.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <deque>
#include <filesystem>
#include <iostream>
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
        return {{"fake", "Fake Output", 48000.0, 2, true}};
    }
    bool start(const std::string& requested,
               Prism::Capture::StartResult* result,
               std::string*) override {
        if (!requested.empty() && requested != "fake") return false;
        if (result) *result = {48000.0, 2, "fake", "Fake Output"};
        return true;
    }
    void stop() override { stopped = true; }
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
};

void testCli() {
    auto parsed = Prism::Tui::parseArguments({"--device", "device-id"});
    require(parsed.ok, "device arguments should parse");
    require(parsed.options.command == Prism::Tui::Command::Run, "device command should run");
    require(parsed.options.deviceId == "device-id", "device ID should be retained");
    require(Prism::Tui::parseArguments({"--list-devices"}).options.command ==
        Prism::Tui::Command::ListDevices, "list command should parse");
    require(!Prism::Tui::parseArguments({"--device"}).ok, "missing device ID should fail");
    require(!Prism::Tui::parseArguments({"--device", "--help"}).ok,
        "an option should not be accepted as a device ID");
    require(!Prism::Tui::parseArguments({"--wat"}).ok, "unknown option should fail");
    require(!Prism::Tui::parseArguments({"--device", "fake", "--device", "fake"}).ok,
        "duplicate device options should fail");
    require(!Prism::Tui::parseArguments({"--help", "--version"}).ok,
        "exclusive commands should not combine");
    require(Prism::Tui::usageText().find("Tab / Shift-Tab") != std::string::npos,
        "help should describe dashboard keyboard controls");
    require(Prism::Tui::usageText().find("Cycle vectorscope") != std::string::npos,
        "help should describe vectorscope mode controls");
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

    const auto wide = Prism::Tui::buildDashboardLayout(
        100, 30, Prism::Tui::LayoutPreset::Automatic);
    require(!wide.terminalTooSmall &&
        wide.resolvedPreset == Prism::Tui::LayoutPreset::Columns,
        "wide, tall terminals should use the columns dashboard");
    require(wide.panels.size() == 5 &&
        wide.panels[0].panel == Prism::Tui::PanelId::Spectrum &&
        wide.panels[1].panel == Prism::Tui::PanelId::Oscilloscope &&
        wide.panels[2].panel == Prism::Tui::PanelId::Vectorscope &&
        wide.panels[3].panel == Prism::Tui::PanelId::VUMeter &&
        wide.panels[4].panel == Prism::Tui::PanelId::LUFSMeter,
        "the dashboard should contain all five scope panels");
    require(wide.panels[0].width == wide.panels[1].width &&
        wide.panels[2].width == wide.panels[3].width &&
        wide.panels[3].width == wide.panels[4].width &&
        wide.panels[0].width + wide.panels[2].width == 100 &&
        wide.panels[0].width > wide.panels[2].width,
        "dashboard columns should fill the width and favor visual plots");
    require(wide.panels[0].height + wide.panels[1].height == 28 &&
        wide.panels[2].height + wide.panels[3].height +
            wide.panels[4].height == 28,
        "both dashboard columns should fill the available height");

    const auto stacked = Prism::Tui::buildDashboardLayout(
        60, 20, Prism::Tui::LayoutPreset::Automatic);
    require(stacked.resolvedPreset == Prism::Tui::LayoutPreset::Stacked,
        "short terminals should stack their panels");
    require(stacked.panels.size() == 3 &&
        stacked.panels[0].panel == Prism::Tui::PanelId::Spectrum &&
        stacked.panels[1].panel == Prism::Tui::PanelId::VUMeter &&
        stacked.panels[2].panel == Prism::Tui::PanelId::LUFSMeter &&
        stacked.panels[0].height + stacked.panels[1].height == 18 &&
        stacked.panels[1].height == stacked.panels[2].height &&
        stacked.panels[1].width + stacked.panels[2].width == 60,
        "compact dashboards should keep VU and LUFS as separate scopes");

    const auto minimum = Prism::Tui::buildDashboardLayout(
        44, 12, Prism::Tui::LayoutPreset::Automatic);
    require(!minimum.terminalTooSmall && minimum.panels.size() == 2 &&
        minimum.panels[0].height == 5 && minimum.panels[1].height == 5,
        "minimum terminal layout should keep both panels usable");
    require(Prism::Tui::buildDashboardLayout(
        43, 12, Prism::Tui::LayoutPreset::Automatic).terminalTooSmall,
        "narrow resize should select the compact screen");
    require(Prism::Tui::buildDashboardLayout(
        80, 11, Prism::Tui::LayoutPreset::Automatic).terminalTooSmall,
        "short resize should select the compact screen");

    const auto expanded = Prism::Tui::buildDashboardLayout(
        100, 30, Prism::Tui::LayoutPreset::Columns, Prism::Tui::PanelId::LUFSMeter);
    require(expanded.panels.size() == 1 &&
        expanded.panels[0].panel == Prism::Tui::PanelId::LUFSMeter &&
        expanded.panels[0].width == 100 && expanded.panels[0].height == 28,
        "expanded panels should occupy the complete dashboard area");
    require(Prism::Tui::nextPanel(Prism::Tui::PanelId::Spectrum) ==
        Prism::Tui::PanelId::Oscilloscope,
        "panel focus should cycle forward");
    require(Prism::Tui::nextPanel(Prism::Tui::PanelId::Spectrum, true) ==
        Prism::Tui::PanelId::LUFSMeter,
        "panel focus should cycle backward");
    const auto compactPanels = Prism::Tui::visiblePanelOrder(stacked);
    require(compactPanels.size() == 3 &&
        Prism::Tui::nextPanel(
            Prism::Tui::PanelId::Spectrum, compactPanels) == Prism::Tui::PanelId::VUMeter,
        "compact layout focus should skip hidden visual scopes");
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
    require(pages.size() == 6 &&
        Prism::Tui::settingsForPage(Prism::Tui::SettingsPage::General).size() == 3,
        "settings should expose shallow category pages");
    Prism::Tui::TuiSettings adjusted;
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
    require(Prism::Tui::resetSetting(
        adjusted, Prism::Tui::SettingId::InputTrim) &&
        adjusted.inputTrimDb == 0.0f,
        "individual settings should reset to defaults");

    const auto settingsPath = std::filesystem::temp_directory_path() /
        "prism-tui-settings-test.conf";
    std::error_code ignored;
    std::filesystem::remove(settingsPath, ignored);
    adjusted.layoutPreset = Prism::Tui::LayoutPreset::Columns;
    adjusted.vectorscopeMode = Prism::Tui::VectorscopeMode::PolarBipolar;
    adjusted.vectorscopeDetail = Prism::Tui::VectorscopeDetail::Maximum;
    std::string error;
    require(Prism::Tui::saveSettings(adjusted, settingsPath, &error),
        "settings should persist to a TUI-specific configuration file");
    require(Prism::Tui::loadSettings(settingsPath) == adjusted,
        "persisted settings should round-trip without changing values");
    std::filesystem::remove(settingsPath, ignored);
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
    for (int index = 0; index < 20; ++index) {
        stereoPipeline.process(stereoSineChunk(1000.0f, 0.5f, 0.125f, 2400, 48000.0f));
    }
    const auto stereo = stereoPipeline.snapshot();
    require(stereo.vu.barLDb > stereo.vu.barRDb + 10.0f,
        "stereo VU values should preserve independent channel levels");
    pipeline.reset();
    const auto reset = pipeline.snapshot();
    require(reset.lufs.integratedLUFS <= -59.0f, "reset should clear integrated loudness");
    require(!reset.oscilloscope.signalPresent,
        "reset should clear the oscilloscope display window");
    require(reset.oscilloscope.detectedPitch == 0.0f,
        "reset should clear the fast pitch readout");
    require(reset.vectorscope.pointCount == 0 && reset.vectorscope.multibandPoints.empty(),
        "reset should clear vectorscope history");
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

}  // namespace

int main() {
    testCli();
    testProjectionAndLayout();
    testMeterDisplayModels();
    testSpectrumPeakModel();
    testSettingsModelAndPersistence();
    testScopePlotModels();
    testPitchReadoutResponse();
    testPipelineAndFakeCapture();
    testThreadSafeSnapshots();
    std::cout << "Prism TUI tests passed\n";
    return 0;
}
