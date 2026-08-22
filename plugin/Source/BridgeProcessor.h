#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_core/juce_core.h>
#include <array>
#include <atomic>
#include <memory>

class PrismBridgeEditor;

class PrismBridgeProcessor final : public juce::AudioProcessor,
                                   private juce::Thread
{
public:
    static constexpr int packetFrames = 512;
    static constexpr int packetCapacity = 128;

    PrismBridgeProcessor();
    ~PrismBridgeProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    void updateTrackProperties(const TrackProperties&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;

    void setCustomName(const juce::String&);
    juce::String getCustomName() const;
    juce::String getDisplayName() const;
    juce::String getHostName() const;
    juce::String getTrackName() const;
    juce::String getConnectionDescription() const;
    uint64_t getDroppedFrameCount() const noexcept { return droppedFrames.load(); }

#if defined(PRISM_BRIDGE_TESTING) && PRISM_BRIDGE_TESTING
    void setSelectedForTesting(bool value) noexcept { selected.store(value); }
    int getQueuedPacketCountForTesting() const noexcept { return fifo.getNumReady(); }
    void clearQueuedPacketsForTesting() noexcept { discardQueuedPackets(); }
#endif

private:
#if defined(PRISM_BRIDGE_TESTING) && PRISM_BRIDGE_TESTING
public:
#endif
    struct TransportData
    {
        int64_t timeInSamples = 0;
        double timeInSeconds = 0.0;
        double ppqPosition = 0.0;
        double bpm = 0.0;
        double lastBarPpq = 0.0;
        double loopStartPpq = 0.0;
        double loopEndPpq = 0.0;
        int16_t numerator = 4;
        int16_t denominator = 4;
        bool hasTimeInSamples = false;
        bool hasTimeInSeconds = false;
        bool hasPpq = false;
        bool hasBpm = false;
        bool hasTimeSignature = false;
        bool isPlaying = false;
        bool isRecording = false;
        bool isLooping = false;
    };

    struct AudioPacket
    {
        std::array<float, packetFrames> left {};
        std::array<float, packetFrames> right {};
        TransportData transport;
        uint32_t sequence = 0;
        uint16_t frameCount = 0;
        uint8_t channelCount = 2;
        double sampleRate = 48000.0;
    };

#if defined(PRISM_BRIDGE_TESTING) && PRISM_BRIDGE_TESTING
    TransportData offsetTransportForTesting(const TransportData& value, int offset) const noexcept
    {
        return offsetTransport(value, offset);
    }
    size_t encodeAudioPayloadForTesting(const AudioPacket& packet, uint8_t* destination, size_t capacity) const noexcept
    {
        return encodeAudioPayload(packet, destination, capacity);
    }
#endif

private:

    void run() override;
    void enqueuePacket(const float*, const float*, int, int, const TransportData&) noexcept;
    bool popPacket(AudioPacket&) noexcept;
    void discardQueuedPackets() noexcept;
    TransportData readTransport() const noexcept;
    TransportData offsetTransport(const TransportData&, int sampleOffset) const noexcept;
    bool connectSocket();
    void closeSocket();
    bool sendHello(uint16_t messageType = 1);
    bool sendHeartbeat();
    bool sendAudioPacket(const AudioPacket&);
    size_t encodeAudioPayload(const AudioPacket&, uint8_t*, size_t) const noexcept;
    bool readControlMessages();
    bool sendFrame(uint16_t messageType, const void*, size_t);
    bool writeAll(const void*, size_t);
    void parseControlBuffer();
    juce::String buildIdentityJson() const;

    // AbstractFifo reserves one sentinel slot, so allocate one extra element to
    // make packetCapacity the actual writable packet count.
    juce::AbstractFifo fifo { packetCapacity + 1 };
    std::array<AudioPacket, packetCapacity + 1> packets;
    std::atomic<double> currentSampleRate { 48000.0 };
    std::atomic<uint32_t> nextSequence { 0 };
    std::atomic<uint64_t> droppedFrames { 0 };
    std::atomic<bool> connected { false };
    std::atomic<bool> selected { false };
    std::atomic<bool> identityDirty { true };

    mutable juce::CriticalSection identityLock;
    juce::String sourceId;
    const juce::String instanceId;
    juce::String customName;
    juce::String trackName;
    juce::String hostName;

    std::unique_ptr<juce::StreamingSocket> socket;
    juce::MemoryBlock controlBuffer;
    uint64_t reportedDroppedFrames = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PrismBridgeProcessor)
};
