#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <cstring>

PrismSpectrumProcessor::PrismSpectrumProcessor()
    : juce::AudioProcessor(BusesProperties()
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
        .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
    fifoBuffer.assign((size_t) fifo.getTotalSize(), 0.0f);
}

void PrismSpectrumProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    currentSampleRate.store(sampleRate);
    monoScratch.assign((size_t) juce::jmax(samplesPerBlock, 1), 0.0f);
    fifo.reset();
}

bool PrismSpectrumProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    const auto& mainOut = layouts.getMainOutputChannelSet();
    if (mainOut != juce::AudioChannelSet::mono() && mainOut != juce::AudioChannelSet::stereo())
        return false;

    // Analyzer passes audio through, so the input layout must match the output.
    return mainOut == layouts.getMainInputChannelSet();
}

void PrismSpectrumProcessor::pushMonoToFifo(const float* data, int num) noexcept
{
    int start1, size1, start2, size2;
    fifo.prepareToWrite(num, start1, size1, start2, size2);
    if (size1 > 0)
        std::memcpy(fifoBuffer.data() + start1, data, (size_t) size1 * sizeof(float));
    if (size2 > 0)
        std::memcpy(fifoBuffer.data() + start2, data + size1, (size_t) size2 * sizeof(float));
    fifo.finishedWrite(size1 + size2);
}

int PrismSpectrumProcessor::drainSamples(float* dest, int maxSamples) noexcept
{
    const int num = juce::jmin(maxSamples, fifo.getNumReady());
    int start1, size1, start2, size2;
    fifo.prepareToRead(num, start1, size1, start2, size2);
    if (size1 > 0)
        std::memcpy(dest, fifoBuffer.data() + start1, (size_t) size1 * sizeof(float));
    if (size2 > 0)
        std::memcpy(dest + size1, fifoBuffer.data() + start2, (size_t) size2 * sizeof(float));
    fifo.finishedRead(size1 + size2);
    return size1 + size2;
}

void PrismSpectrumProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int numSamples = buffer.getNumSamples();
    const int numChannels = buffer.getNumChannels();
    if (numSamples <= 0 || numChannels <= 0)
        return;

    if ((int) monoScratch.size() < numSamples)
        monoScratch.resize((size_t) numSamples);

    if (numChannels >= 2)
    {
        const float* left = buffer.getReadPointer(0);
        const float* right = buffer.getReadPointer(1);
        for (int i = 0; i < numSamples; ++i)
            monoScratch[(size_t) i] = 0.5f * (left[i] + right[i]);
    }
    else
    {
        const float* mono = buffer.getReadPointer(0);
        for (int i = 0; i < numSamples; ++i)
            monoScratch[(size_t) i] = mono[i];
    }

    pushMonoToFifo(monoScratch.data(), numSamples);

    // Pure analyzer: the audio buffer is left untouched (pass-through).
    juce::ignoreUnused(numChannels);
}

juce::AudioProcessorEditor* PrismSpectrumProcessor::createEditor()
{
    return new PrismSpectrumEditor(*this);
}

// This creates the plugin instance, called by the JUCE plugin wrappers.
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PrismSpectrumProcessor();
}
