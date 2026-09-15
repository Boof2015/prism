#include "BridgeEditor.h"
#include "BridgeProcessor.h"

PrismBridgeEditor::PrismBridgeEditor(PrismBridgeProcessor& p)
    : juce::AudioProcessorEditor(&p), bridgeProcessor(p)
{
    title.setText("PRISM BRIDGE", juce::dontSendNotification);
    title.setFont(juce::Font(juce::FontOptions(11.0f, juce::Font::bold)));
    title.setColour(juce::Label::textColourId, juce::Colour(0xff94a3b8));
    title.setBorderSize(juce::BorderSize<int>(0));
    addAndMakeVisible(title);

    nameLabel.setName("Source name");
    nameLabel.setFont(juce::Font(juce::FontOptions(23.0f, juce::Font::bold)));
    nameLabel.setColour(juce::Label::textColourId, juce::Colour(0xfff1f5f9));
    nameLabel.setColour(juce::Label::textWhenEditingColourId, juce::Colour(0xfff1f5f9));
    nameLabel.setColour(juce::Label::backgroundWhenEditingColourId, juce::Colour(0xff111827));
    nameLabel.setColour(juce::Label::outlineWhenEditingColourId, juce::Colour(0xff38bdf8));
    nameLabel.setBorderSize(juce::BorderSize<int>(4, 0, 4, 0));
    nameLabel.setMinimumHorizontalScale(1.0f);
    nameLabel.setEditable(true, false, false);
    nameLabel.setMouseCursor(juce::MouseCursor::IBeamCursor);
    nameLabel.onEditorShow = [this]
    {
        if (auto* editor = nameLabel.getCurrentTextEditor())
        {
            editor->setInputRestrictions(160);
            editor->setSelectAllWhenFocused(true);
            editor->selectAll();
        }
    };
    nameLabel.onTextChange = [this]
    {
        bridgeProcessor.setCustomName(nameLabel.getText());
        timerCallback();
    };
    addAndMakeVisible(nameLabel);

    instanceTag.setName("Bridge instance tag");
    instanceTag.setText(bridgeProcessor.getInstanceTag(), juce::dontSendNotification);
    instanceTag.setFont(juce::Font(juce::FontOptions(11.0f)));
    instanceTag.setColour(juce::Label::textColourId, juce::Colour(0xff64748b));
    instanceTag.setBorderSize(juce::BorderSize<int>(0));
    instanceTag.setTooltip("Match this tag in Prism when sources have the same name.\nInstance: "
                           + bridgeProcessor.getInstanceId());
    addAndMakeVisible(instanceTag);
    addAndMakeVisible(connectionDot);

    // A text editor is created only on click or keyboard navigation.
    // Merely opening the plug-in must not start a rename.
    setResizable(false, false);
    setSize(320, 104);
    timerCallback();
    startTimerHz(4);
}

void PrismBridgeEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff080d18));
    g.setColour(juce::Colour(0xff1e293b));
    g.drawRoundedRectangle(getLocalBounds().toFloat().reduced(6.0f), 7.0f, 1.0f);
}

void PrismBridgeEditor::resized()
{
    auto bounds = getLocalBounds().reduced(20, 16);
    auto header = bounds.removeFromTop(14);
    connectionDot.setBounds(header.removeFromRight(16));
    title.setBounds(header);
    bounds.removeFromTop(4);
    nameLabel.setBounds(bounds.removeFromTop(36));
    bounds.removeFromTop(4);
    instanceTag.setBounds(bounds);
}

void PrismBridgeEditor::timerCallback()
{
    // Host track/state changes must not replace an in-progress edit.
    if (!nameLabel.isBeingEdited())
        nameLabel.setText(bridgeProcessor.getDisplayName(), juce::dontSendNotification);

    nameLabel.setTooltip(bridgeProcessor.getDisplayName()
        + "\nClick to rename. Clear the name to use the DAW track name automatically.");
    connectionDot.setStatus(bridgeProcessor.isConnectedToPrism(),
                            bridgeProcessor.isSelectedInPrism(),
                            bridgeProcessor.getConnectionDescription());
}

void PrismBridgeEditor::ConnectionDot::setStatus(bool connected, bool selected,
                                                const juce::String& description)
{
    const auto nextColour = !connected ? juce::Colour(0xff64748b)
        : selected ? juce::Colour(0xff4ade80) : juce::Colour(0xff38bdf8);
    setTitle(description);
    setTooltip(description);
    if (colour != nextColour)
    {
        colour = nextColour;
        repaint();
    }
}

void PrismBridgeEditor::ConnectionDot::paint(juce::Graphics& g)
{
    g.setColour(colour);
    g.fillEllipse(getLocalBounds().toFloat().withSizeKeepingCentre(6.0f, 6.0f));
}
