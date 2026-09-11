#include "WaterfallEngine.h"
#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>
#include <cmath>
#include <cstring>
#include <iostream>

namespace {
int failures = 0;
void expect(bool value, const char* message) {
    if (!value) { std::cerr << "FAIL: " << message << '\n'; ++failures; }
}
std::vector<float> floats(const juce::var& frame, const char* key) {
    juce::MemoryOutputStream bytes;
    expect(juce::Base64::convertFromBase64(bytes, frame.getProperty(key, "").toString()), "frame base64 decodes");
    std::vector<float> result(bytes.getDataSize() / sizeof(float));
    if (!result.empty()) std::memcpy(result.data(), bytes.getData(), bytes.getDataSize());
    return result;
}
}

// Optional, silent editor smoke test: exercise the real processor, DSP, native
// bridge and embedded WKWebView without requiring a DAW or an audio device.
int showEditor() {
    juce::ScopedJuceInitialiser_GUI initialise;
    juce::Process::makeForegroundProcess();
    struct Preview : juce::DocumentWindow, juce::Timer {
        PrismSpectrumProcessor processor;
        std::unique_ptr<juce::AudioProcessorEditor> editor;
        int64_t samples = 0;
        int stage = 0;
        bool waiting = false;
        Preview() : DocumentWindow("Prism Waterfall — plugin preview", juce::Colours::black, DocumentWindow::closeButton) {
            processor.prepareToPlay(48000, 800);
            processor.setSettingsJson(R"({"historySeconds":5,"colorMode":"heat"})");
            editor.reset(processor.createEditorIfNeeded());
            setUsingNativeTitleBar(true);
            setContentNonOwned(editor.get(), true);
            setResizable(true, false);
            centreWithSize(editor->getWidth(), editor->getHeight());
            setVisible(true);
            toFront(true);
            startTimerHz(60);
        }
        ~Preview() override { stopTimer(); clearContentComponent(); }
        void closeButtonPressed() override { juce::MessageManager::getInstance()->stopDispatchLoop(); }
        void inspect() {
            juce::WebBrowserComponent* browser = nullptr;
            for (auto* child : editor->getChildren())
                if (auto* web = dynamic_cast<juce::WebBrowserComponent*>(child)) browser = web;
            expect(browser != nullptr, "native plugin editor creates its webview");
            if (!browser) { closeButtonPressed(); return; }
            waiting = true;
            const int step = stage++;
            const juce::String actions = step == 0
                ? "document.querySelector('button[aria-label=Settings]').click();"
                : step == 1
                    ? "const select=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='heat'));if(!select)throw Error('Missing Waterfall color control');select.value='theme';select.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('button[aria-label=Settings]').click();"
                    : "";
            browser->evaluateJavascript("(()=>{if(!window.__waterfallQA){window.__waterfallQA={frames:0,raf:0,errors:[]};window.__JUCE__.backend.addEventListener('waterfallFrame',f=>{window.__waterfallQA.frames++;window.__waterfallQA.frame={revision:f.revision,columns:f.columns,audioSeconds:f.audioSeconds,ageBytes:f.ages.length};});window.addEventListener('error',e=>window.__waterfallQA.errors.push(e.message));const tick=()=>{window.__waterfallQA.raf++;requestAnimationFrame(tick)};requestAnimationFrame(tick);}const canvas=document.querySelector('canvas');if(!canvas)throw Error('No scope canvas');const result={stats:window.__waterfallQA,scope:window.__JUCE__.initialisationData.prismScope[0],png:canvas.toDataURL(),width:canvas.width,height:canvas.height,ink:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4===3&&v>0)};" + actions + "return JSON.stringify(result)})()",
                [this, step](auto result) {
                    const auto* value = result.getResult();
                    expect(value != nullptr, "native webview script evaluates");
                    if (value) {
                        const auto data = juce::JSON::parse(value->toString());
                        std::cout << "UI diagnostics: " << juce::JSON::toString(data["stats"]) << " ink=" << data["ink"].toString() << '\n';
                        expect((bool) data["ink"], "native Waterfall canvas actually paints");
                        expect(data["scope"].toString() == "waterfall", "native editor selects Waterfall UI");
                        expect((int) data["width"] > 300 && (int) data["height"] > 100, "scope canvas has a usable viewport");
                        const auto directory = juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("prism-waterfall-plugin-qa");
                        directory.createDirectory();
                        juce::MemoryOutputStream png;
                        juce::Base64::convertFromBase64(png, data["png"].toString().fromFirstOccurrenceOf(",", false, false));
                        const auto file = directory.getChildFile("native-editor-" + juce::String(step) + ".png");
                        expect(file.replaceWithData(png.getData(), png.getDataSize()), "native editor snapshot saves");
                        std::cout << file.getFullPathName() << '\n';
                    }
                    if (step == 2) {
                        expect(juce::JSON::parse(processor.getSettingsJson())["colorMode"].toString() == "theme",
                            "native editor settings control persists to the processor");
                        setSize(440, 240);
                    }
                    waiting = false;
                    if (step == 3) closeButtonPressed();
                });
        }
        void timerCallback() override {
            juce::AudioBuffer<float> audio(2, 800);
            juce::MidiBuffer midi;
            for (int i = 0; i < 800; ++i, ++samples) {
                const double t = samples / 48000.0;
                const double beat = std::exp(-std::fmod(t * 2, 1.0) * 10);
                const auto tone = [&](double hz) { return std::sin(t * 2 * juce::MathConstants<double>::pi * hz); };
                const float value = (float) (0.3 * tone(65) * (0.3 + beat) + 0.12 * tone(330)
                    + 0.13 * tone(1320) * (0.6 + 0.4 * std::sin(t * 2)) + 0.08 * tone(4200) * beat);
                audio.setSample(0, i, value);
                audio.setSample(1, i, -value);
            }
            processor.processBlock(audio, midi);
            if (!waiting && samples >= 48000 * (5 + stage * 3)) inspect();
            if (samples >= 48000 * 120) closeButtonPressed();
        }
    } preview;
    juce::MessageManager::getInstance()->runDispatchLoop();
    return failures ? 1 : 0;
}

int main(int argc, char** argv) {
    if (argc > 1 && juce::String(argv[1]) == "--ui") return showEditor();
    WaterfallEngine engine;
    engine.configure(juce::JSON::parse(R"({"fftSize":2048,"historySeconds":3,"smoothing":0,"tiltDbPerOctave":0})"));
    engine.configureNative(juce::JSON::parse(R"({"ridges":32,"columns":256,"revision":1})"));
    std::vector<float> left(48000 * 6), right(left.size());
    for (size_t i = 0; i < left.size(); ++i) {
        left[i] = 0.5f * std::sin((double) i * 2 * juce::MathConstants<double>::pi * 1007.8125 / 48000);
        right[i] = -left[i];
    }
    engine.process(left.data(), right.data(), (int) left.size());
    auto frame = engine.buildFrame(48000);
    auto levels = floats(frame, "levels");
    auto ages = floats(frame, "ages");
    expect(!levels.empty() && levels.size() == ages.size() * 256, "compact plot payload dimensions match");
    const float peak = *std::max_element(levels.begin(), levels.end());
    expect(peak > -6.4f && peak < -5.8f, "anti-phase stereo remains calibrated and visible");
    expect((double) frame["audioSeconds"] == 6 && ages.back() > 2.8f, "history uses audio duration");
    expect((int) frame["revision"] == 1, "responses echo the viewport revision");
    engine.process(nullptr, nullptr, 0);
    expect(juce::JSON::toString(engine.buildFrame(48000)) == juce::JSON::toString(frame), "suspended input holds its plot");

    engine.configure(juce::JSON::parse(R"({"historySeconds":3,"colorMode":"heat","density":"dense"})"));
    expect(floats(engine.buildFrame(48000), "levels") == levels, "appearance preserves history");
    engine.configureNative(juce::JSON::parse(R"({"ridges":8,"columns":40,"revision":2})"));
    frame = engine.buildFrame(48000);
    expect((int) frame["columns"] == 40 && floats(frame, "levels").size() <= 8 * 40, "resizing only requests visible data");
    expect((double) frame["audioSeconds"] == 6 && floats(frame, "ages").back() > 2.5f, "small plots retain the full selected timespan");
    engine.configure(juce::JSON::parse(R"({"historySeconds":30})"));
    expect((double) engine.buildFrame(48000)["audioSeconds"] == 6, "extending duration preserves available history");
    engine.resetAudioHistory();
    expect(floats(engine.buildFrame(48000), "ages").empty(), "audio discontinuity clears history");
    engine.process(left.data(), right.data(), 48000);
    engine.setSampleRate(44100);
    expect((double) engine.buildFrame(44100)["audioSeconds"] == 0, "sample-rate changes reset history");
    engine.configureNative(juce::JSON::parse(R"({"config":{"sampleRate":96000},"revision":3})"));
    expect((double) engine.buildFrame(96000)["sampleRate"] == 44100, "host sample rate wins over webview config");
    engine.process(left.data(), right.data(), 44100);
    engine.configure(juce::JSON::parse(R"({"fftSize":4096})"));
    expect(floats(engine.buildFrame(44100), "ages").empty(), "FFT-size changes reset history");
    engine.process(left.data(), right.data(), 44100);
    engine.configureNative(juce::JSON::parse(R"({"reset":true,"revision":4})"));
    expect((double) engine.buildFrame(44100)["audioSeconds"] == 0, "webview reset starts a new history span");

    PrismSpectrumProcessor processor;
    processor.prepareToPlay(48000, 512);
    expect(processor.consumeAudioDiscontinuity(), "prepare marks a fresh audio span");
    juce::MidiBuffer midi;
    for (int channels : {1, 2}) {
        juce::AudioBuffer<float> buffer(channels, 512), original;
        for (int channel = 0; channel < channels; ++channel)
            std::memcpy(buffer.getWritePointer(channel), channel == 0 ? left.data() : right.data(), 512 * sizeof(float));
        original.makeCopyOf(buffer);
        processor.processBlock(buffer, midi);
        for (int channel = 0; channel < channels; ++channel)
            expect(std::memcmp(buffer.getReadPointer(channel), original.getReadPointer(channel), 512 * sizeof(float)) == 0,
                "mono and stereo host audio pass through bit-identically");
        float drainedLeft[512], drainedRight[512];
        expect(processor.drainStereo(drainedLeft, drainedRight, 512) == 512, "FIFO preserves sample count");
        expect(std::memcmp(drainedRight, channels == 1 ? left.data() : right.data(), 512 * sizeof(float)) == 0,
            "mono duplicates correctly and stereo preserves phase");
    }
    juce::AudioBuffer<float> overflow(2, 70000);
    overflow.clear();
    processor.processBlock(overflow, midi);
    expect(processor.consumeAudioDiscontinuity() && !processor.consumeAudioDiscontinuity(), "FIFO overrun is reported once");
    processor.restartAudioHistory();
    expect(processor.consumeAudioDiscontinuity(), "editor reopen discards stale buffered history");
    const juce::String settings = R"({"historySeconds":17,"colorMode":"heat","density":"dense","fftSize":8192,"scaleMode":"mel","smoothing":0.7,"tiltDbPerOctave":4,"showGrid":false})";
    processor.setSettingsJson(settings);
    juce::MemoryBlock state;
    processor.getStateInformation(state);
    PrismSpectrumProcessor restored;
    restored.setStateInformation(state.getData(), (int) state.getSize());
    expect(restored.getSettingsJson() == settings, "Waterfall settings round-trip through DAW project state");
    std::cout << (failures ? "Waterfall plugin tests failed\n" : "Waterfall plugin tests passed\n");
    return failures ? 1 : 0;
}
