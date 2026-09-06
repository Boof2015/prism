#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>

class PrismBridgeProcessor;

class PrismBridgeEditor final : public juce::AudioProcessorEditor,
                                private juce::Timer
{
public:
    explicit PrismBridgeEditor(PrismBridgeProcessor&);
    ~PrismBridgeEditor() override = default;
    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void commitName();

    PrismBridgeProcessor& bridgeProcessor;
    juce::Label title;
    juce::Label nameLabel;
    juce::TextEditor nameEditor;
    juce::Label sourceInfo;
    juce::Label connectionInfo;
    juce::Label droppedInfo;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PrismBridgeEditor)
};
