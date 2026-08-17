#pragma once

#include "lufsmeter.h"
#include "oscilloscope.h"
#include "scrolling_history.h"
#include "spectrogram.h"
#include "spectrum.h"
#include "spectrum_peak_model.h"
#include "system_audio_capture.h"
#include "vectorscope.h"
#include "vumeter.h"
#include "waveform.h"

#include <optional>
#include <string>
#include <vector>

namespace Prism::Tui {

constexpr size_t kDefaultFftSize = 4096;
constexpr size_t kVectorscopeDisplayPoints = 4096;
constexpr size_t kSpectrogramHistoryRows = 128;
constexpr size_t kSpectrogramHistoryColumns = 1024;
constexpr size_t kWaveformHistoryColumns = 2048;

struct OscilloscopeFrame {
    std::vector<float> samples;
    float detectedPitch = 0.0f;
    bool signalPresent = false;
};

struct VectorscopeFrame {
    std::vector<float> multibandPoints;
    size_t pointCount = 0;
};

struct SpectrogramFrame {
    ScrollingHistoryFrame display;
    ScrollingHistoryFrame heat;
};

struct WaveformFrame {
    ScrollingHistoryFrame history;
    bool stereo = false;
};

struct AnalysisFrame {
    std::vector<float> magnitudes;
    std::optional<SpectrumPeakInfo> spectrumPeak;
    Visualizer::VUMeterSnapshot vu{};
    Visualizer::LUFSMeterSnapshot lufs{};
    OscilloscopeFrame oscilloscope;
    VectorscopeFrame vectorscope;
    SpectrogramFrame spectrogram;
    WaveformFrame waveform;
};

class AnalysisPipeline {
public:
    explicit AnalysisPipeline(float sampleRate, size_t fftSize = kDefaultFftSize);

    void process(const Prism::Capture::AudioChunk& chunk);
    AnalysisFrame snapshot();
    void reset();
    void setInputTrimDb(float db);
    void setSpectrumTilt(float dbPerOctave);
    void setOscilloscopePitchLock(bool enabled);
    void setSpectrogramSettings(float scrollSpeed,
                                float contrast,
                                float tiltDbPerOctave,
                                const std::string& clarityMode,
                                const std::string& scaleMode,
                                const std::string& orientation);
    void setWaveformSettings(bool stereo, int scrollSpeed);

private:
    Visualizer::Spectrum spectrum_;
    Visualizer::VUMeterAnalyzer vu_;
    Visualizer::LUFSMeterAnalyzer lufs_;
    Visualizer::Oscilloscope oscilloscope_;
    Visualizer::Vectorscope vectorscope_;
    Visualizer::SpectrogramAnalyzer spectrogram_;
    Visualizer::WaveformMultibandAnalyzer waveform_;
    ScrollingHistory spectrogramDisplayHistory_;
    ScrollingHistory spectrogramHeatHistory_;
    ScrollingHistory waveformHistory_;
    SpectrumPeakTracker spectrumPeakTracker_;
    std::vector<float> monoScratch_;
    std::vector<float> trimmedLeftScratch_;
    std::vector<float> trimmedRightScratch_;
    std::vector<float> waveformMonoScratch_;
    float sampleRate_ = 48000.0f;
    size_t fftSize_ = kDefaultFftSize;
    float inputGainLinear_ = 1.0f;
    float spectrumTiltDbPerOctave_ = 2.0f;
    float displayPitch_ = 0.0f;
    bool waveformStereo_ = false;
    int waveformScrollSpeed_ = 1;
};

size_t drainCapture(Prism::Capture::SystemAudioCapture& capture,
                    AnalysisPipeline& pipeline,
                    bool& captureOverrun,
                    size_t maxChunks = 64);

}  // namespace Prism::Tui
