#include "PluginProcessor.h"
#include "SpectrumEngine.h"
#include <juce_gui_extra/juce_gui_extra.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <cmath>
#include <cstring>
#include <iostream>

namespace {
int failures = 0;
void expect(bool value, const char* message) {
    if (!value) { std::cerr << "FAIL: " << message << '\n'; ++failures; }
}
bool finish(ReferenceTrackManager& manager) {
    for (int i = 0; i < 1000; ++i) {
        const auto phase = manager.snapshot()["phase"].toString();
        if (phase == "ready") return true;
        if (phase == "error" || phase == "idle") return false;
        juce::Thread::sleep(5);
    }
    return false;
}
juce::File makeAudio(const juce::File& directory, int repeats = 1) {
    const auto file = directory.getChildFile(juce::String::fromUTF8("référence 日本語.wav"));
    juce::WavAudioFormat format;
    std::unique_ptr<juce::AudioFormatWriter> writer(format.createWriterFor(file.createOutputStream().release(), 44100, 2, 24, {}, 0));
    juce::AudioBuffer<float> data(2, 44100 * 5);
    for (int i = 0; i < data.getNumSamples(); ++i) {
        const auto sample = static_cast<float>(0.1 * std::sin(2 * juce::MathConstants<double>::pi * 1500 * i / 44100));
        data.setSample(0, i, sample); data.setSample(1, i, sample);
    }
    for (int i = 0; i < repeats; ++i)
        expect(writer && writer->writeFromAudioSampleBuffer(data, 0, data.getNumSamples()), "test audio writes");
    return file;
}
}

// Optional native-editor preview for OS file-drop, picker, and narrow-layout QA.
int showEditor(const juce::File& initialFile) {
    juce::ScopedJuceInitialiser_GUI initialise;
    juce::Process::makeForegroundProcess();
    struct Preview : juce::DocumentWindow, juce::Timer {
        PrismSpectrumProcessor processor;
        struct TestHost : juce::Component, juce::ComponentListener {
            struct DragFile : juce::Label {
                juce::File file;
                explicit DragFile(juce::File path) : file(std::move(path)) { setText("Drag reference fixture into graph", juce::dontSendNotification); }
                void mouseDrag(const juce::MouseEvent&) override { juce::DragAndDropContainer::performExternalDragDropOfFiles({file.getFullPathName()}, false, this); }
            } dragFile;
            PrismSpectrumProcessor& processor;
            std::unique_ptr<juce::AudioProcessorEditor> editor;
            juce::TextButton toggle { "Close / reopen editor" };
            bool layingOut = false;
            TestHost(PrismSpectrumProcessor& p, const juce::File& file) : dragFile(file), processor(p) {
                addAndMakeVisible(dragFile); addAndMakeVisible(toggle);
                toggle.onClick = [this] {
                    if (editor) { editor->removeComponentListener(this); editor.reset(); }
                    else open();
                };
                open();
            }
            ~TestHost() override { if (editor) editor->removeComponentListener(this); }
            void open() {
                editor.reset(processor.createEditorIfNeeded());
                addAndMakeVisible(*editor); editor->addComponentListener(this);
                setSize(editor->getWidth(), editor->getHeight() + 30); resized();
            }
            void resized() override {
                layingOut = true;
                dragFile.setBounds(8, 0, juce::jmax(120, getWidth() - 190), 30);
                toggle.setBounds(getWidth() - 180, 2, 172, 26);
                if (editor) editor->setBounds(0, 30, getWidth(), juce::jmax(100, getHeight() - 30));
                layingOut = false;
            }
            void componentMovedOrResized(juce::Component&, bool, bool resizedFlag) override {
                if (!layingOut && resizedFlag && editor) setSize(editor->getWidth(), editor->getHeight() + 30);
            }
        };
        juce::File fixtureDirectory;
        std::unique_ptr<TestHost> host;
        int64_t samples = 0;
        Preview(const juce::File& file) : DocumentWindow("Prism Spectrum reference preview", juce::Colours::black, DocumentWindow::closeButton) {
            processor.prepareToPlay(48000, 800);
            processor.setSettingsJson(R"({"fftSize":4096,"smoothing":0.7,"peakInfoMode":"on"})");
            fixtureDirectory = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("prism-reference-ui-" + juce::Uuid().toString());
            fixtureDirectory.createDirectory();
            host = std::make_unique<TestHost>(processor, makeAudio(fixtureDirectory, 120));
            setUsingNativeTitleBar(true); setContentNonOwned(host.get(), true); setResizable(true, false);
            setResizeLimits(360, 210, 4096, 4096);
            centreWithSize(host->getWidth(), host->getHeight()); setVisible(true); toFront(true);
            if (file.existsAsFile()) processor.referenceTracks.start(file);
            startTimerHz(60);
        }
        ~Preview() override { stopTimer(); clearContentComponent(); host.reset(); processor.referenceTracks.cancel(); fixtureDirectory.deleteRecursively(); }
        void closeButtonPressed() override { juce::MessageManager::getInstance()->stopDispatchLoop(); }
        void timerCallback() override {
            juce::AudioBuffer<float> audio(2, 800); juce::MidiBuffer midi;
            for (int i = 0; i < 800; ++i, ++samples) {
                const auto value = static_cast<float>(0.05 * std::sin(2 * juce::MathConstants<double>::pi * 1500 * samples / 48000));
                audio.setSample(0, i, value); audio.setSample(1, i, value);
            }
            processor.processBlock(audio, midi);
        }
    } preview(initialFile);
    juce::MessageManager::getInstance()->runDispatchLoop();
    return 0;
}

int main(int argc, char** argv) {
#if JUCE_MAC
    if (argc == 1 && juce::File::getSpecialLocation(juce::File::currentApplicationFile).hasFileExtension("app")) return showEditor({});
#endif
    if (argc > 1 && juce::String(argv[1]) == "--ui") return showEditor(argc > 2 ? juce::File(argv[2]) : juce::File());
    const auto directory = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("prism-reference-test-" + juce::Uuid().toString());
    directory.createDirectory();
    const auto file = makeAudio(directory);
    PrismSpectrumProcessor first, second;
    first.prepareToPlay(48000, 512);
    first.referenceTracks.start(file);
    juce::AudioBuffer<float> audio(2, 512); juce::MidiBuffer midi;
    for (int i = 0; i < 512; ++i) { audio.setSample(0, i, i / 512.0f); audio.setSample(1, i, -i / 512.0f); }
    juce::AudioBuffer<float> original; original.makeCopyOf(audio);
    for (int i = 0; i < 200; ++i) first.processBlock(audio, midi);
    for (int channel = 0; channel < 2; ++channel)
        expect(std::memcmp(original.getReadPointer(channel), audio.getReadPointer(channel), 512 * sizeof(float)) == 0, "audio passes through unchanged during import");
    expect(finish(first.referenceTracks), "processor-owned job completes with no editor");
    if (failures) return 1;
    expect(first.syncReferenceResult(), "completed asset commits once");
    expect(!first.syncReferenceResult(), "completion is not applied twice");
    auto settings = juce::JSON::parse(first.getSettingsJson());
    expect(settings["reference"]["asset"]["name"].toString() == file.getFileName(), "Unicode filename survives import");
    expect(std::abs(static_cast<double>(settings["reference"]["asset"]["meanSquare"]) - 0.005) < 0.00001, "native plugin analysis matches Mid power");
    expect(second.getSettingsJson().isEmpty(), "references remain per plugin instance");

    settings["reference"].getDynamicObject()->setProperty("trimDb", -6.0);
    settings["reference"].getDynamicObject()->setProperty("view", "difference");
    first.setSettingsJson(juce::JSON::toString(settings));
    juce::MemoryBlock saved; first.getStateInformation(saved);
    file.deleteFile();
    second.setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
    expect(second.getSettingsJson() == first.getSettingsJson(), "DAW state recalls every curve after source deletion");
    auto invalid = juce::JSON::parse(first.getSettingsJson());
    invalid["reference"]["asset"]["curves"].getDynamicObject()->setProperty("2048", "bad");
    second.setSettingsJson(juce::JSON::toString(invalid));
    expect(juce::JSON::parse(second.getSettingsJson())["reference"].isVoid(), "invalid saved array is rejected");
    const juce::String legacy = R"({"fftSize":2048})";
    second.setStateInformation(legacy.toRawUTF8(), static_cast<int>(legacy.getNumBytesAsUTF8()));
    expect(!juce::JSON::parse(second.getSettingsJson()).hasProperty("reference"), "legacy state has no reference");

    const auto nextFile = makeAudio(directory);
    juce::MemoryBlock fileBytes; nextFile.loadFileAsData(fileBytes);
    auto& manager = second.referenceTracks;
    const auto stale = manager.beginUpload("old.wav", static_cast<int64_t>(fileBytes.getSize()));
    const auto id = manager.beginUpload("new.wav", static_cast<int64_t>(fileBytes.getSize()));
    bool rejected = false;
    try { manager.appendUpload(stale, 0, "AAAA"); } catch (...) { rejected = true; }
    manager.cancelUpload(stale);
    expect(rejected && manager.snapshot()["jobId"].toString() == id, "stale upload cannot write or cancel its replacement");
    for (size_t offset = 0; offset < fileBytes.getSize(); offset += 262144) {
        const auto count = std::min<size_t>(262144, fileBytes.getSize() - offset);
        manager.appendUpload(id, static_cast<int64_t>(offset), juce::Base64::toBase64(static_cast<const char*>(fileBytes.getData()) + offset, count));
    }
    manager.finishUpload(id);
    expect(finish(manager) && manager.snapshot()["name"].toString() == "new.wav", "bounded byte upload decodes successfully");
    const auto cancelled = manager.beginUpload("cancel.wav", 100);
    manager.cancelUpload(cancelled);
    expect(manager.snapshot()["phase"].toString() == "idle", "cancel clears upload state");
    manager.start(nextFile);
    second.setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
    expect(manager.snapshot()["phase"].toString() == "idle", "project restore cancels active analysis");
    expect(second.getSettingsJson() == first.getSettingsJson(), "canceled job cannot replace restored reference");
    manager.cancel();
    directory.deleteRecursively();
    std::cout << (failures ? "Reference plugin tests failed" : "Reference plugin tests passed") << '\n';
    return failures ? 1 : 0;
}
