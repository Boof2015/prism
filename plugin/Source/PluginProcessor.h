#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <atomic>
#include <vector>

/**
 * Prism Spectrum — analyzer plugin.
 *
 * Passes audio through unchanged. On the realtime thread (processBlock) it writes
 * the input's L/R into a lock-free FIFO. The editor's frame callback drains the
 * FIFO off the realtime thread, runs the reused Prism DSP (native/src/spectrum.cpp)
 * as stereo (so mid + side are available), and pushes magnitudes to the webview.
 *
 * UI settings (JSON) are owned here so they survive editor open/close and DAW
 * session save/restore.
 */
class PrismSpectrumProcessor : public juce::AudioProcessor
{
public:
    PrismSpectrumProcessor();
    ~PrismSpectrumProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;

    double getSampleRateHz() const noexcept { return currentSampleRate.load(); }

    /** Copy up to `maxSamples` of buffered L/R audio into the destinations; returns count. */
    int drainStereo(float* destLeft, float* destRight, int maxSamples) noexcept;

    /** Persisted UI settings as a JSON string (set from the editor, read on save). */
    void setSettingsJson(const juce::String& json);
    juce::String getSettingsJson() const;

private:
    void pushStereoToFifo(const float* left, const float* right, int num) noexcept;

    juce::AbstractFifo fifo { 1 << 16 };
    std::vector<float> leftBuffer, rightBuffer; // backing storage for `fifo`
    std::atomic<double> currentSampleRate { 48000.0 };

    juce::CriticalSection settingsLock;
    juce::String settingsJson;
    std::atomic<int> editorWidth { 0 };
    std::atomic<int> editorHeight { 0 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PrismSpectrumProcessor)
};
