#include "BridgeProcessor.h"
#include <iostream>

int runBridgeEditorTests(bool interactive);

// Exercise the real native label/editor with the message loop running. --ui
// keeps it open for manual checks; --ui-test checks edits and saves snapshots.
int runBridgeEditorTests(bool interactive)
{
    juce::ScopedJuceInitialiser_GUI initialise;
    juce::Process::makeForegroundProcess();
    struct Preview final : juce::DocumentWindow, private juce::Timer
    {
        PrismBridgeProcessor processor;
        std::unique_ptr<juce::AudioProcessorEditor> editor;
        juce::Label* name = nullptr;
        int step = 0;
        int failures = 0;

        explicit Preview(bool manual)
            : DocumentWindow("Prism Bridge - nameplate preview", juce::Colour(0xff080d18), closeButton)
        {
            setTrack("Drums");
            editor.reset(processor.createEditorIfNeeded());
            for (auto* child : editor->getChildren())
                if (child->getName() == "Source name") name = dynamic_cast<juce::Label*>(child);
            setUsingNativeTitleBar(true);
            setContentNonOwned(editor.get(), true);
            centreWithSize(editor->getWidth(), editor->getHeight());
            setVisible(true);
            toFront(true);
            if (!manual) startTimer(350);
        }

        ~Preview() override { stopTimer(); clearContentComponent(); }
        void closeButtonPressed() override { juce::MessageManager::getInstance()->stopDispatchLoop(); }
        void expect(bool value, const char* message)
        {
            if (!value) { std::cerr << "FAIL: " << message << '\n'; ++failures; }
        }
        void setTrack(const juce::String& value)
        {
            juce::AudioProcessor::TrackProperties track;
            track.name = value;
            processor.updateTrackProperties(track);
        }
        void edit(const juce::String& text, int key)
        {
            name->showEditor();
            auto* input = name->getCurrentTextEditor();
            expect(input != nullptr, "nameplate must open its text editor on demand");
            if (!input) return;
            input->setText(text, false);
            input->keyPressed(juce::KeyPress(key));
        }
        void snapshot(const juce::String& suffix)
        {
            const auto directory = juce::File::getSpecialLocation(juce::File::tempDirectory)
                .getChildFile("prism-bridge-nameplate-qa");
            directory.createDirectory();
            const auto file = directory.getChildFile(suffix + ".png");
            juce::FileOutputStream output(file);
            expect(output.openedOk(), "snapshot file must open");
            output.setPosition(0);
            output.truncate();
            expect(juce::PNGImageFormat().writeImageToStream(
                editor->createComponentSnapshot(editor->getLocalBounds(), true, 2.0f), output),
                "nameplate snapshot must save");
            std::cout << file.getFullPathName() << '\n';
        }
        void timerCallback() override
        {
            if (!name) { expect(false, "source-name label must exist"); closeButtonPressed(); return; }
            switch (step++)
            {
                case 0:
                    expect(!name->isBeingEdited(), "opening the editor must not start editing");
                    expect(name->getText() == "Drums", "nameplate must show the host name");
                    snapshot("automatic");
                    setTrack("Percussion");
                    break;
                case 1:
                    expect(name->getText() == "Percussion", "host renames must refresh the visible name");
                    edit("  Drum Bus  ", juce::KeyPress::returnKey);
                    break;
                case 2:
                    expect(processor.getCustomName() == "Drum Bus", "Enter must save and trim a name");
                    expect(name->getText() == "Drum Bus", "the displayed name must reflect the committed value");
                    setTrack("Rhythm");
                    break;
                case 3:
                    expect(name->getText() == "Drum Bus", "host changes must preserve a custom name");
                    edit("", juce::KeyPress::returnKey);
                    break;
                case 4:
                    expect(processor.getCustomName().isEmpty(), "clearing must restore automatic naming");
                    expect(name->getText() == "Rhythm", "clearing must display the latest host name");
                    edit("Cancelled", juce::KeyPress::escapeKey);
                    break;
                case 5:
                    expect(processor.getCustomName().isEmpty() && name->getText() == "Rhythm",
                           "Escape must leave automatic naming intact");
                    name->showEditor();
                    name->getCurrentTextEditor()->setText("Focus saved", false);
                    editor->setWantsKeyboardFocus(true);
                    editor->grabKeyboardFocus();
                    break;
                case 6:
                    expect(processor.getCustomName() == "Focus saved", "losing focus must commit the name");
                    name->showEditor();
                    name->getCurrentTextEditor()->setText("Still typing", false);
                    setTrack("Updated during edit");
                    break;
                case 7:
                    expect(name->isBeingEdited() && name->getCurrentTextEditor()->getText() == "Still typing",
                           "timer updates must not interrupt typing");
                    name->getCurrentTextEditor()->keyPressed(juce::KeyPress(juce::KeyPress::escapeKey));
                    processor.setCustomName("An exceptionally long source name that must stay readable without shrinking the text");
                    break;
                case 8:
                    snapshot("long-name");
                    processor.setCustomName("");
                    setTrack("");
                    break;
                case 9:
                    expect(name->getText() == "Bridge " + processor.getInstanceTag(), "unnamed bridges must show their tag");
                    snapshot("unnamed");
                    std::cout << "Bridge nameplate UI checks: " << (failures ? "FAILED" : "passed") << '\n';
                    closeButtonPressed();
                    break;
                default: closeButtonPressed(); break;
            }
        }
    } preview(interactive);
    juce::MessageManager::getInstance()->runDispatchLoop();
    return preview.failures ? 1 : 0;
}
