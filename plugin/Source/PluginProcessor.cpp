#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <cstring>
#include <stdexcept>

PrismSpectrumProcessor::~PrismSpectrumProcessor() {
    stopTimer();
    referenceTracks.cancel();
    detachedTransfers.clear();
}

void PrismSpectrumProcessor::retainReferenceTransfer(std::unique_ptr<juce::WebBrowserComponent> browser) {
    const auto id = referenceTracks.activeUploadId();
    if (id.isEmpty() || !browser) return;
    // Keep the File/Blob and its acknowledged reads alive until the native temp
    // file is complete, even if the DAW destroys the visible editor meanwhile.
    auto window = std::make_unique<juce::DocumentWindow>("Prism reference import", juce::Colours::black, 0);
    window->setContentOwned(browser.release(), false);
    window->setSize(1, 1);
    detachedTransfers.push_back({ id, std::move(window) });
    startTimer(100);
}

void PrismSpectrumProcessor::timerCallback() {
    const auto active = referenceTracks.activeUploadId();
    detachedTransfers.erase(std::remove_if(detachedTransfers.begin(), detachedTransfers.end(),
        [&active](const auto& transfer) { return transfer.id != active; }), detachedTransfers.end());
    if (detachedTransfers.empty()) stopTimer();
}

void PrismSpectrumProcessor::handleReferenceTransfer(juce::var payload, juce::WebBrowserComponent* browser) {
    auto* response = new juce::DynamicObject();
    response->setProperty("requestId", payload.getProperty("requestId", juce::var()));
    try {
        const auto action = payload.getProperty("action", "").toString();
        if (action == "getState") response->setProperty("state", referenceTracks.snapshot());
        else if (action == "cancel") referenceTracks.cancel();
        else if (action == "cancelUpload") referenceTracks.cancelUpload(payload.getProperty("uploadId", "").toString());
        else if (action == "beginUpload") response->setProperty("uploadId", referenceTracks.beginUpload(payload.getProperty("name", "audio").toString(), static_cast<juce::int64>(payload.getProperty("size", 0))));
        else if (action == "appendUpload") referenceTracks.appendUpload(payload.getProperty("uploadId", "").toString(), static_cast<juce::int64>(payload.getProperty("offset", 0)), payload.getProperty("data", "").toString());
        else if (action == "finishUpload") referenceTracks.finishUpload(payload.getProperty("uploadId", "").toString());
        else throw std::runtime_error("Unknown reference command.");
        response->setProperty("ok", true);
    } catch (const std::exception& error) {
        response->setProperty("ok", false); response->setProperty("error", juce::String::fromUTF8(error.what()));
        referenceTracks.cancelUpload(payload.getProperty("uploadId", "").toString());
    }
    if (browser) browser->emitEventIfBrowserIsVisible("prismReferenceResponse", juce::var(response));
}

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
    audioDiscontinuity.store(true);
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
    if (size1 + size2 < num) audioDiscontinuity.store(true);
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
    auto settings = juce::JSON::parse(json);
    if (settings.isObject() && settings.hasProperty("reference")) {
        settings.getDynamicObject()->setProperty("reference", normalizeSpectrumReference(settings.getProperty("reference", juce::var())));
        settingsJson = juce::JSON::toString(settings);
    } else settingsJson = json;
}

juce::String PrismSpectrumProcessor::getSettingsJson()
{
    syncReferenceResult();
    const juce::ScopedLock sl(settingsLock);
    return settingsJson;
}

bool PrismSpectrumProcessor::syncReferenceResult()
{
    const juce::ScopedLock sl(settingsLock);
    auto asset = referenceTracks.takeCompletedAsset();
    if (!asset.isObject()) return false;
    auto settings = juce::JSON::parse(settingsJson);
    if (!settings.isObject()) settings = juce::var(new juce::DynamicObject());
    const auto previous = settings.getProperty("reference", juce::var());
    auto* reference = new juce::DynamicObject();
    reference->setProperty("asset", asset); reference->setProperty("trimDb", 0.0);
    reference->setProperty("view", previous.getProperty("view", "overlay"));
    settings.getDynamicObject()->setProperty("reference", juce::var(reference));
    settingsJson = juce::JSON::toString(settings);
    return true;
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
    referenceTracks.cancel();
    audioDiscontinuity.store(true);
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
