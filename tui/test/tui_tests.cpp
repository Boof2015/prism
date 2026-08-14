#include "analysis_pipeline.h"
#include "cli.h"
#include "display_model.h"
#include "snapshot_store.h"
#include "system_audio_capture.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <deque>
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
    require(Prism::Tui::buildSpectrumRows(projected, 6).size() == 6,
        "spectrum rows should follow the requested height");
    require(Prism::Tui::buildSpectrumRows(projected, 0).empty(),
        "zero-height spectrum should be empty");
    const auto meter = Prism::Tui::buildMeterBar(-12.0f, -6.0f, 20);
    require(!meter.empty(),
        "meter bar should render");
    require(meter.find("│") != std::string::npos,
        "meter bar should include its peak marker");

    const auto normal = Prism::Tui::calculateLayout(100, 30);
    const auto narrow = Prism::Tui::calculateLayout(44, 12);
    require(!normal.terminalTooSmall && normal.spectrumRowCount == 20,
        "normal terminal layout should fill available height");
    require(!narrow.terminalTooSmall && narrow.contentWidth == 40,
        "minimum terminal layout should remain renderable");
    require(Prism::Tui::calculateLayout(43, 12).terminalTooSmall,
        "narrow resize should select the compact screen");
    require(Prism::Tui::calculateLayout(80, 11).terminalTooSmall,
        "short resize should select the compact screen");
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
    require(frame.vu.barLDb > -20.0f && frame.vu.barLDb < -5.0f,
        "VU level should reflect deterministic input");
    require(std::isfinite(frame.lufs.momentaryLUFS) && frame.lufs.momentaryLUFS > -60.0f,
        "LUFS pipeline should produce a finite reading");
    require(std::abs(frame.lufs.momentaryLUFS + 12.03f) < 0.5f,
        "momentary LUFS should match the deterministic stereo tone");
    require(std::abs(frame.lufs.integratedLUFS + 12.03f) < 0.5f,
        "integrated LUFS should match the deterministic stereo tone");

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
    testPipelineAndFakeCapture();
    testThreadSafeSnapshots();
    std::cout << "Prism TUI tests passed\n";
    return 0;
}
