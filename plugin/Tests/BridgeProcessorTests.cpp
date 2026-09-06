#include "BridgeProcessor.h"
#include <cmath>
#include <cstring>
#include <iostream>

namespace
{
int failures = 0;

void expect(bool condition, const char* message)
{
    if (condition) return;
    std::cerr << "FAIL: " << message << '\n';
    ++failures;
}

void fillTestSignal(juce::AudioBuffer<float>& buffer)
{
    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
            buffer.setSample(channel, sample, std::sin(static_cast<float>(sample + channel * 7) * 0.013f));
}

void expectBitIdentical(const juce::AudioBuffer<float>& actual,
                        const juce::AudioBuffer<float>& expected,
                        const char* message)
{
    bool equal = actual.getNumChannels() == expected.getNumChannels()
        && actual.getNumSamples() == expected.getNumSamples();
    for (int channel = 0; equal && channel < actual.getNumChannels(); ++channel)
        equal = std::memcmp(actual.getReadPointer(channel),
                            expected.getReadPointer(channel),
                            static_cast<size_t>(actual.getNumSamples()) * sizeof(float)) == 0;
    expect(equal, message);
}
}

int main()
{
    PrismBridgeProcessor processor;
    processor.prepareToPlay(48000.0, 1024);
    processor.setSelectedForTesting(true);
    juce::MidiBuffer midi;

    juce::AudioBuffer<float> stereo(2, 1025);
    fillTestSignal(stereo);
    juce::AudioBuffer<float> stereoCopy;
    stereoCopy.makeCopyOf(stereo);
    processor.processBlock(stereo, midi);
    expectBitIdentical(stereo, stereoCopy, "stereo processing must be bit-identical");
    expect(processor.getQueuedPacketCountForTesting() == 3, "1025 stereo frames must produce three packets");

    processor.clearQueuedPacketsForTesting();
    juce::AudioBuffer<float> mono(1, PrismBridgeProcessor::packetFrames);
    fillTestSignal(mono);
    juce::AudioBuffer<float> monoCopy;
    monoCopy.makeCopyOf(mono);
    processor.processBlock(mono, midi);
    expectBitIdentical(mono, monoCopy, "mono processing must be bit-identical");
    expect(processor.getQueuedPacketCountForTesting() == 1, "one mono packet must be queued");

    processor.clearQueuedPacketsForTesting();
    processor.setNonRealtime(true);
    processor.processBlock(mono, midi);
    expect(processor.getQueuedPacketCountForTesting() == 0, "offline rendering must not enqueue audio");
    processor.setNonRealtime(false);

    for (int index = 0; index < PrismBridgeProcessor::packetCapacity + 2; ++index)
        processor.processBlock(mono, midi);
    expect(processor.getQueuedPacketCountForTesting() == PrismBridgeProcessor::packetCapacity,
           "the audio queue must remain bounded");
    expect(processor.getDroppedFrameCount() >= 2 * PrismBridgeProcessor::packetFrames,
           "overflow must report dropped frames");

    PrismBridgeProcessor::TransportData transport;
    transport.timeInSamples = 24000;
    transport.timeInSeconds = 0.5;
    transport.ppqPosition = 4.0;
    transport.bpm = 120.0;
    transport.hasTimeInSamples = true;
    transport.hasTimeInSeconds = true;
    transport.hasPpq = true;
    transport.hasBpm = true;
    const auto interpolated = processor.offsetTransportForTesting(transport, 24000);
    expect(interpolated.timeInSamples == 48000, "sample transport must interpolate by packet offset");
    expect(std::abs(interpolated.timeInSeconds - 1.0) < 1.0e-9,
           "seconds transport must interpolate by packet offset");
    expect(std::abs(interpolated.ppqPosition - 5.0) < 1.0e-9,
           "PPQ transport must interpolate using tempo");

    PrismBridgeProcessor::AudioPacket encodedPacket;
    encodedPacket.sequence = 0x01020304;
    encodedPacket.frameCount = 2;
    encodedPacket.channelCount = 2;
    encodedPacket.sampleRate = 48000.0;
    encodedPacket.transport = transport;
    encodedPacket.transport.isPlaying = true;
    encodedPacket.transport.hasTimeSignature = true;
    encodedPacket.transport.numerator = 7;
    encodedPacket.transport.denominator = 8;
    encodedPacket.left[0] = 0.25f;
    encodedPacket.left[1] = -0.5f;
    encodedPacket.right[0] = 0.75f;
    encodedPacket.right[1] = -1.0f;
    std::array<uint8_t, 128> encoded {};
    const auto encodedBytes = processor.encodeAudioPayloadForTesting(
        encodedPacket, encoded.data(), encoded.size());
    expect(encodedBytes == 92, "protocol payload must contain the fixed header and planar samples");
    expect(encoded[0] == 0x04 && encoded[1] == 0x03 && encoded[2] == 0x02 && encoded[3] == 0x01,
           "protocol sequence must be little-endian");
    expect(encoded[4] == 2 && encoded[5] == 0 && encoded[6] == 2,
           "protocol frame and channel counts must be encoded");
    expect(encoded[72] == 7 && encoded[74] == 8,
           "protocol time signature must be little-endian");
    float decodedLeft = 0.0f;
    std::memcpy(&decodedLeft, encoded.data() + 76, sizeof(decodedLeft));
    decodedLeft = juce::ByteOrder::swapIfBigEndian(decodedLeft);
    expect(decodedLeft == 0.25f, "protocol audio must be planar Float32");

    processor.setCustomName("Drum Bus");
    juce::MemoryBlock state;
    processor.getStateInformation(state);
    PrismBridgeProcessor restored;
    restored.setStateInformation(state.getData(), static_cast<int>(state.getSize()));
    expect(restored.getCustomName() == "Drum Bus", "custom source names must restore from DAW state");

    processor.releaseResources();
    if (failures == 0)
        std::cout << "Prism Bridge processor tests passed\n";
    return failures == 0 ? 0 : 1;
}
