#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <cstring>

PrismSpectrumProcessor::PrismSpectrumProcessor()
    : juce::AudioProcessor(BusesProperties()
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
        .withOutput("Output", juce::AudioChannelSet::stereo(), true))
{
    leftBuffer.assign((size_t) fifo.getTotalSize(), 0.0f);
    rightBuffer.assign((size_t) fifo.getTotalSize(), 0.0f);
}

void PrismSpectrumProcessor::prepareToPlay(double sampleRate, int)
{
    currentSampleRate.store(sampleRate);
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

void PrismSpectrumProcessor::pushStereoToFifo(const float* left, const float* right, int num) noexcept
{
    int start1, size1, start2, size2;
    fifo.prepareToWrite(num, start1, size1, start2, size2);
    if (size1 > 0)
    {
        std::memcpy(leftBuffer.data()  + start1, left,  (size_t) size1 * sizeof(float));
        std::memcpy(rightBuffer.data() + start1, right, (size_t) size1 * sizeof(float));
    }
    if (size2 > 0)
    {
        std::memcpy(leftBuffer.data()  + start2, left  + size1, (size_t) size2 * sizeof(float));
        std::memcpy(rightBuffer.data() + start2, right + size1, (size_t) size2 * sizeof(float));
    }
    fifo.finishedWrite(size1 + size2);
}

int PrismSpectrumProcessor::drainStereo(float* destLeft, float* destRight, int maxSamples) noexcept
{
    const int num = juce::jmin(maxSamples, fifo.getNumReady());
    int start1, size1, start2, size2;
    fifo.prepareToRead(num, start1, size1, start2, size2);
    if (size1 > 0)
    {
        std::memcpy(destLeft,  leftBuffer.data()  + start1, (size_t) size1 * sizeof(float));
        std::memcpy(destRight, rightBuffer.data() + start1, (size_t) size1 * sizeof(float));
    }
    if (size2 > 0)
    {
        std::memcpy(destLeft  + size1, leftBuffer.data()  + start2, (size_t) size2 * sizeof(float));
        std::memcpy(destRight + size1, rightBuffer.data() + start2, (size_t) size2 * sizeof(float));
    }
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

    const float* left  = buffer.getReadPointer(0);
    const float* right = numChannels >= 2 ? buffer.getReadPointer(1) : left;
    pushStereoToFifo(left, right, numSamples);

    // Pure analyzer: the audio buffer is left untouched (pass-through).
}

void PrismSpectrumProcessor::setSettingsJson(const juce::String& json)
{
    const juce::ScopedLock sl(settingsLock);
    settingsJson = json;
}

juce::String PrismSpectrumProcessor::getSettingsJson() const
{
    const juce::ScopedLock sl(settingsLock);
    return settingsJson;
}

void PrismSpectrumProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    const juce::String json = getSettingsJson();
    destData.setSize(0);
    destData.append(json.toRawUTF8(), json.getNumBytesAsUTF8());
}

void PrismSpectrumProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    if (data == nullptr || sizeInBytes <= 0)
        return;
    setSettingsJson(juce::String::fromUTF8(static_cast<const char*>(data), sizeInBytes));

    // If the editor is already open (host restored state after opening it), push
    // the settings to the UI now — the prismReady reply alone would have missed it.
    if (auto* editor = dynamic_cast<PrismSpectrumEditor*>(getActiveEditor()))
        editor->pushRestoreSettings();
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
