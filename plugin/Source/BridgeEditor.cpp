#include "BridgeEditor.h"
#include "BridgeProcessor.h"

PrismBridgeEditor::PrismBridgeEditor(PrismBridgeProcessor& p)
    : juce::AudioProcessorEditor(&p), bridgeProcessor(p)
{
    title.setText("PRISM BRIDGE", juce::dontSendNotification);
    title.setFont(juce::Font(juce::FontOptions(22.0f, juce::Font::bold)));
    title.setColour(juce::Label::textColourId, juce::Colour(0xfff1f5f9));
    addAndMakeVisible(title);

    nameLabel.setText("Source name", juce::dontSendNotification);
    nameLabel.setColour(juce::Label::textColourId, juce::Colour(0xff94a3b8));
    addAndMakeVisible(nameLabel);

    nameEditor.setText(bridgeProcessor.getCustomName(), false);
    nameEditor.setTextToShowWhenEmpty(bridgeProcessor.getDisplayName(), juce::Colour(0xff64748b));
    nameEditor.setColour(juce::TextEditor::backgroundColourId, juce::Colour(0xff111827));
    nameEditor.setColour(juce::TextEditor::textColourId, juce::Colour(0xfff8fafc));
    nameEditor.setColour(juce::TextEditor::outlineColourId, juce::Colour(0xff334155));
    nameEditor.onReturnKey = [this] { commitName(); };
    nameEditor.onFocusLost = [this] { commitName(); };
    addAndMakeVisible(nameEditor);

    for (auto* label : { &sourceInfo, &connectionInfo, &droppedInfo })
    {
        label->setColour(juce::Label::textColourId, juce::Colour(0xffcbd5e1));
        addAndMakeVisible(*label);
    }
    connectionInfo.setColour(juce::Label::textColourId, juce::Colour(0xff38bdf8));

    setResizable(false, false);
    setSize(440, 220);
    timerCallback();
    startTimerHz(4);
}

void PrismBridgeEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff080d18));
    g.setColour(juce::Colour(0xff1e293b));
    g.drawRoundedRectangle(getLocalBounds().toFloat().reduced(10.0f), 10.0f, 1.0f);
}

void PrismBridgeEditor::resized()
{
    auto bounds = getLocalBounds().reduced(24);
    title.setBounds(bounds.removeFromTop(34));
    bounds.removeFromTop(8);
    nameLabel.setBounds(bounds.removeFromTop(20));
    nameEditor.setBounds(bounds.removeFromTop(32));
    bounds.removeFromTop(12);
    sourceInfo.setBounds(bounds.removeFromTop(24));
    connectionInfo.setBounds(bounds.removeFromTop(24));
    droppedInfo.setBounds(bounds.removeFromTop(24));
}

void PrismBridgeEditor::timerCallback()
{
    const auto track = bridgeProcessor.getTrackName();
    const auto host = bridgeProcessor.getHostName();
    sourceInfo.setText(
        "Host: " + (host.isNotEmpty() ? host : "Unknown")
            + "   Track: " + (track.isNotEmpty() ? track : "Not provided"),
        juce::dontSendNotification);
    connectionInfo.setText(bridgeProcessor.getConnectionDescription(), juce::dontSendNotification);
    droppedInfo.setText(
        "Dropped frames: " + juce::String(bridgeProcessor.getDroppedFrameCount()),
        juce::dontSendNotification);
}

void PrismBridgeEditor::commitName()
{
    bridgeProcessor.setCustomName(nameEditor.getText());
    nameEditor.setText(bridgeProcessor.getCustomName(), false);
    nameEditor.setTextToShowWhenEmpty(bridgeProcessor.getDisplayName(), juce::Colour(0xff64748b));
}
