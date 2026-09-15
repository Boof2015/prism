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

    class ConnectionDot final : public juce::Component,
                                public juce::SettableTooltipClient
    {
    public:
        void setStatus(bool connected, bool selected, const juce::String& description);
        void paint(juce::Graphics&) override;

    private:
        juce::Colour colour { 0xff64748b };
    };

    PrismBridgeProcessor& bridgeProcessor;
    juce::Label title;
    juce::Label nameLabel;
    juce::Label instanceTag;
    ConnectionDot connectionDot;
    juce::TooltipWindow tooltip { this, 500 };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PrismBridgeEditor)
};
