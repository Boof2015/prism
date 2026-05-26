#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <atomic>
#include <vector>

/**
 * Prism Spectrum — analyzer plugin.
 *
 * Passes audio through unchanged. On the realtime thread (processBlock) it mixes
 * the input to mono and writes it into a lock-free FIFO. The editor's timer drains
 * the FIFO off the realtime thread, runs the reused Prism DSP (native/src/spectrum.cpp),
 * and pushes magnitudes to the webview. No DSP or allocation happens on the audio thread.
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

    const juce::String getName() const override { return "Prism Spectrum"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock&) override {}
    void setStateInformation(const void*, int) override {}

    /** Latest negotiated sample rate (read from the message thread). */
    double getSampleRateHz() const noexcept { return currentSampleRate.load(); }

    /** Copy up to `maxSamples` of buffered mono audio into `dest`; returns count written. */
    int drainSamples(float* dest, int maxSamples) noexcept;

private:
    void pushMonoToFifo(const float* data, int num) noexcept;

    juce::AbstractFifo fifo { 1 << 16 };
    std::vector<float> fifoBuffer;       // backing storage for `fifo`
    std::vector<float> monoScratch;      // realtime-thread mono mixdown buffer
    std::atomic<double> currentSampleRate { 48000.0 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PrismSpectrumProcessor)
};
