#include "BridgeProcessor.h"
#include "BridgeEditor.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

namespace
{
constexpr uint32_t frameMagic = 0x4d535250;
constexpr uint16_t protocolVersion = 1;
constexpr uint16_t messageHello = 1;
constexpr uint16_t messageHeartbeat = 2;
constexpr uint16_t messageSourceUpdate = 3;
constexpr uint16_t messageSubscribe = 10;
constexpr uint16_t messageAudio = 20;
constexpr size_t frameHeaderBytes = 12;
constexpr size_t audioHeaderBytes = 76;
constexpr size_t maxPayloadBytes = 256 * 1024;
constexpr int serverPort = 51789;

template <typename Integer>
void writeLittleEndian(uint8_t* destination, Integer value) noexcept
{
    const auto little = juce::ByteOrder::swapIfBigEndian(value);
    std::memcpy(destination, &little, sizeof(little));
}

void writeDoubleLittleEndian(uint8_t* destination, double value) noexcept
{
    uint64_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    writeLittleEndian(destination, bits);
}

uint16_t readU16(const uint8_t* source) noexcept
{
    uint16_t value = 0;
    std::memcpy(&value, source, sizeof(value));
    return juce::ByteOrder::swapIfBigEndian(value);
}

uint32_t readU32(const uint8_t* source) noexcept
{
    uint32_t value = 0;
    std::memcpy(&value, source, sizeof(value));
    return juce::ByteOrder::swapIfBigEndian(value);
}
}

PrismBridgeProcessor::PrismBridgeProcessor()
    : juce::AudioProcessor(BusesProperties()
        .withInput("Input", juce::AudioChannelSet::stereo(), true)
        .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      juce::Thread("Prism Bridge network"),
      sourceId(juce::Uuid().toString()),
      instanceId(juce::Uuid().toString()),
      hostName(juce::PluginHostType().getHostDescription())
{
}

PrismBridgeProcessor::~PrismBridgeProcessor()
{
    signalThreadShouldExit();
    stopThread(1500);
    closeSocket();
}

void PrismBridgeProcessor::prepareToPlay(double sampleRate, int)
{
    currentSampleRate.store(sampleRate > 0.0 ? sampleRate : 48000.0);
    nextSequence.store(0);
    fifo.reset();
#if ! defined(PRISM_BRIDGE_TESTING) || ! PRISM_BRIDGE_TESTING
    if (!isThreadRunning())
        startThread(juce::Thread::Priority::normal);
#endif
    identityDirty.store(true);
}

void PrismBridgeProcessor::releaseResources()
{
    signalThreadShouldExit();
    stopThread(1000);
    closeSocket();
    connected.store(false);
    selected.store(false);
    discardQueuedPackets();
}

bool PrismBridgeProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    const auto input = layouts.getMainInputChannelSet();
    const auto output = layouts.getMainOutputChannelSet();
    return input == output
        && (input == juce::AudioChannelSet::mono() || input == juce::AudioChannelSet::stereo());
}

PrismBridgeProcessor::TransportData PrismBridgeProcessor::readTransport() const noexcept
{
    TransportData result;
    if (const auto* playHead = getPlayHead())
    {
        if (const auto position = playHead->getPosition())
        {
            result.isPlaying = position->getIsPlaying();
            result.isRecording = position->getIsRecording();
            result.isLooping = position->getIsLooping();
            if (const auto value = position->getTimeInSamples())
            {
                result.timeInSamples = *value;
                result.hasTimeInSamples = true;
            }
            if (const auto value = position->getTimeInSeconds())
            {
                result.timeInSeconds = *value;
                result.hasTimeInSeconds = true;
            }
            if (const auto value = position->getPpqPosition())
            {
                result.ppqPosition = *value;
                result.hasPpq = true;
            }
            if (const auto value = position->getBpm())
            {
                result.bpm = *value;
                result.hasBpm = std::isfinite(result.bpm) && result.bpm > 0.0;
            }
            if (const auto value = position->getPpqPositionOfLastBarStart())
                result.lastBarPpq = *value;
            else
                result.lastBarPpq = std::numeric_limits<double>::quiet_NaN();
            if (const auto value = position->getTimeSignature())
            {
                result.numerator = static_cast<int16_t>(value->numerator);
                result.denominator = static_cast<int16_t>(value->denominator);
                result.hasTimeSignature = value->numerator > 0 && value->denominator > 0;
            }
            if (const auto value = position->getLoopPoints())
            {
                result.loopStartPpq = value->ppqStart;
                result.loopEndPpq = value->ppqEnd;
            }
            else
            {
                result.loopStartPpq = std::numeric_limits<double>::quiet_NaN();
                result.loopEndPpq = std::numeric_limits<double>::quiet_NaN();
            }
        }
    }
    return result;
}

PrismBridgeProcessor::TransportData PrismBridgeProcessor::offsetTransport(
    const TransportData& base,
    int sampleOffset) const noexcept
{
    auto result = base;
    const double sampleRate = std::max(1.0, currentSampleRate.load());
    const double seconds = static_cast<double>(sampleOffset) / sampleRate;
    if (result.hasTimeInSamples) result.timeInSamples += sampleOffset;
    if (result.hasTimeInSeconds) result.timeInSeconds += seconds;
    if (result.hasPpq && result.hasBpm) result.ppqPosition += seconds * result.bpm / 60.0;
    return result;
}

void PrismBridgeProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    if (isNonRealtime() || !selected.load(std::memory_order_relaxed))
        return;

    const int frameCount = buffer.getNumSamples();
    const int channels = buffer.getNumChannels();
    if (frameCount <= 0 || channels <= 0)
        return;

    const auto transport = readTransport();
    const float* left = buffer.getReadPointer(0);
    const float* right = channels > 1 ? buffer.getReadPointer(1) : left;
    for (int offset = 0; offset < frameCount; offset += packetFrames)
    {
        const int count = std::min(packetFrames, frameCount - offset);
        enqueuePacket(left + offset, right + offset, count, channels, offsetTransport(transport, offset));
    }
}

void PrismBridgeProcessor::enqueuePacket(
    const float* left,
    const float* right,
    int frameCount,
    int channelCount,
    const TransportData& transport) noexcept
{
    int start1 = 0, size1 = 0, start2 = 0, size2 = 0;
    fifo.prepareToWrite(1, start1, size1, start2, size2);
    if (size1 == 0)
    {
        droppedFrames.fetch_add(static_cast<uint64_t>(frameCount), std::memory_order_relaxed);
        return;
    }

    auto& packet = packets[static_cast<size_t>(start1)];
    std::memcpy(packet.left.data(), left, static_cast<size_t>(frameCount) * sizeof(float));
    std::memcpy(packet.right.data(), right, static_cast<size_t>(frameCount) * sizeof(float));
    packet.transport = transport;
    packet.sequence = nextSequence.fetch_add(1, std::memory_order_relaxed) + 1;
    packet.frameCount = static_cast<uint16_t>(frameCount);
    packet.channelCount = static_cast<uint8_t>(channelCount > 1 ? 2 : 1);
    packet.sampleRate = currentSampleRate.load(std::memory_order_relaxed);
    fifo.finishedWrite(1);
}

bool PrismBridgeProcessor::popPacket(AudioPacket& destination) noexcept
{
    int start1 = 0, size1 = 0, start2 = 0, size2 = 0;
    fifo.prepareToRead(1, start1, size1, start2, size2);
    if (size1 == 0) return false;
    destination = packets[static_cast<size_t>(start1)];
    fifo.finishedRead(1);
    return true;
}

void PrismBridgeProcessor::discardQueuedPackets() noexcept
{
    AudioPacket scratch;
    while (popPacket(scratch)) {}
}

void PrismBridgeProcessor::run()
{
    int reconnectDelayMs = 250;
    int64_t lastHeartbeat = 0;
    AudioPacket packet;

    while (!threadShouldExit())
    {
        if (!socket || !socket->isConnected())
        {
            connected.store(false);
            selected.store(false);
            discardQueuedPackets();
            if (!connectSocket())
            {
                wait(reconnectDelayMs);
                reconnectDelayMs = std::min(5000, reconnectDelayMs * 2);
                continue;
            }
            reconnectDelayMs = 250;
            lastHeartbeat = static_cast<int64_t>(juce::Time::getMillisecondCounterHiRes());
        }

        if (!readControlMessages())
        {
            closeSocket();
            continue;
        }

        const auto currentDroppedFrames = droppedFrames.load();
        if ((identityDirty.exchange(false) || currentDroppedFrames != reportedDroppedFrames)
            && !sendHello(messageSourceUpdate))
        {
            closeSocket();
            continue;
        }
        reportedDroppedFrames = currentDroppedFrames;

        const auto now = static_cast<int64_t>(juce::Time::getMillisecondCounterHiRes());
        if (now - lastHeartbeat >= 1000)
        {
            if (!sendHeartbeat())
            {
                closeSocket();
                continue;
            }
            lastHeartbeat = now;
        }

        if (!selected.load())
        {
            discardQueuedPackets();
            wait(5);
            continue;
        }

        const auto maximumLivePackets = std::max(
            1,
            static_cast<int>(std::floor(currentSampleRate.load() * 0.05 / packetFrames)));
        if (fifo.getNumReady() > maximumLivePackets)
        {
            while (fifo.getNumReady() > maximumLivePackets && popPacket(packet))
                droppedFrames.fetch_add(packet.frameCount, std::memory_order_relaxed);
        }

        if (popPacket(packet))
        {
            if (!sendAudioPacket(packet))
                closeSocket();
        }
        else
        {
            wait(2);
        }
    }

    closeSocket();
}

bool PrismBridgeProcessor::connectSocket()
{
    socket = std::make_unique<juce::StreamingSocket>();
    if (!socket->connect("127.0.0.1", serverPort, 250))
    {
        socket.reset();
        return false;
    }
    connected.store(true);
    controlBuffer.setSize(0);
    if (!sendHello(messageHello))
    {
        closeSocket();
        return false;
    }
    reportedDroppedFrames = droppedFrames.load();
    return true;
}

void PrismBridgeProcessor::closeSocket()
{
    connected.store(false);
    selected.store(false);
    if (socket) socket->close();
    socket.reset();
}

juce::String PrismBridgeProcessor::buildIdentityJson() const
{
    const juce::ScopedLock lock(identityLock);
    auto object = new juce::DynamicObject();
    object->setProperty("sourceId", sourceId);
    object->setProperty("instanceId", instanceId);
    object->setProperty("customName", customName);
    object->setProperty("trackName", trackName);
    object->setProperty("hostName", hostName);
    object->setProperty("sampleRate", currentSampleRate.load());
    object->setProperty("channelCount", getTotalNumInputChannels());
    object->setProperty("droppedFrames", static_cast<double>(droppedFrames.load()));
    return juce::JSON::toString(juce::var(object), true);
}

bool PrismBridgeProcessor::sendHello(uint16_t messageType)
{
    const auto json = buildIdentityJson();
    return sendFrame(messageType, json.toRawUTF8(), static_cast<size_t>(json.getNumBytesAsUTF8()));
}

bool PrismBridgeProcessor::sendHeartbeat()
{
    return sendFrame(messageHeartbeat, nullptr, 0);
}

bool PrismBridgeProcessor::sendAudioPacket(const AudioPacket& packet)
{
    std::array<uint8_t, audioHeaderBytes + packetFrames * 2 * sizeof(float)> payload {};
    const auto payloadSize = encodeAudioPayload(packet, payload.data(), payload.size());
    return payloadSize > 0 && sendFrame(messageAudio, payload.data(), payloadSize);
}

size_t PrismBridgeProcessor::encodeAudioPayload(
    const AudioPacket& packet,
    uint8_t* payload,
    size_t capacity) const noexcept
{
    const auto requiredSize = audioHeaderBytes
        + static_cast<size_t>(packet.frameCount) * packet.channelCount * sizeof(float);
    if (!payload || packet.frameCount == 0 || packet.frameCount > packetFrames
        || (packet.channelCount != 1 && packet.channelCount != 2) || capacity < requiredSize)
        return 0;

    std::memset(payload, 0, requiredSize);
    writeLittleEndian(payload + 0, packet.sequence);
    writeLittleEndian(payload + 4, packet.frameCount);
    payload[6] = packet.channelCount;
    uint8_t flags = 0;
    if (packet.transport.isPlaying) flags |= 1 << 0;
    if (packet.transport.isRecording) flags |= 1 << 1;
    if (packet.transport.isLooping) flags |= 1 << 2;
    if (packet.transport.hasTimeInSamples) flags |= 1 << 3;
    if (packet.transport.hasTimeInSeconds) flags |= 1 << 4;
    if (packet.transport.hasPpq) flags |= 1 << 5;
    if (packet.transport.hasBpm) flags |= 1 << 6;
    if (packet.transport.hasTimeSignature) flags |= 1 << 7;
    payload[7] = flags;
    writeDoubleLittleEndian(payload + 8, packet.sampleRate);
    writeLittleEndian(payload + 16, packet.transport.timeInSamples);
    writeDoubleLittleEndian(payload + 24, packet.transport.timeInSeconds);
    writeDoubleLittleEndian(payload + 32, packet.transport.ppqPosition);
    writeDoubleLittleEndian(payload + 40, packet.transport.bpm);
    writeDoubleLittleEndian(payload + 48, packet.transport.lastBarPpq);
    writeDoubleLittleEndian(payload + 56, packet.transport.loopStartPpq);
    writeDoubleLittleEndian(payload + 64, packet.transport.loopEndPpq);
    writeLittleEndian(payload + 72, packet.transport.numerator);
    writeLittleEndian(payload + 74, packet.transport.denominator);

    size_t offset = audioHeaderBytes;
    for (size_t index = 0; index < packet.frameCount; ++index)
    {
        uint32_t bits = 0;
        std::memcpy(&bits, &packet.left[index], sizeof(bits));
        writeLittleEndian(payload + offset, bits);
        offset += sizeof(float);
    }
    if (packet.channelCount > 1)
    {
        for (size_t index = 0; index < packet.frameCount; ++index)
        {
            uint32_t bits = 0;
            std::memcpy(&bits, &packet.right[index], sizeof(bits));
            writeLittleEndian(payload + offset, bits);
            offset += sizeof(float);
        }
    }
    return offset;
}

bool PrismBridgeProcessor::sendFrame(uint16_t messageType, const void* payload, size_t payloadSize)
{
    if (payloadSize > maxPayloadBytes) return false;
    std::array<uint8_t, frameHeaderBytes> header {};
    writeLittleEndian(header.data() + 0, frameMagic);
    writeLittleEndian(header.data() + 4, protocolVersion);
    writeLittleEndian(header.data() + 6, messageType);
    writeLittleEndian(header.data() + 8, static_cast<uint32_t>(payloadSize));
    return writeAll(header.data(), header.size())
        && (payloadSize == 0 || writeAll(payload, payloadSize));
}

bool PrismBridgeProcessor::writeAll(const void* source, size_t byteCount)
{
    if (!socket || !socket->isConnected()) return false;
    const auto* bytes = static_cast<const uint8_t*>(source);
    size_t written = 0;
    while (written < byteCount && !threadShouldExit())
    {
        if (socket->waitUntilReady(false, 50) < 1) return false;
        const int result = socket->write(bytes + written, static_cast<int>(byteCount - written));
        if (result <= 0) return false;
        written += static_cast<size_t>(result);
    }
    return written == byteCount;
}

bool PrismBridgeProcessor::readControlMessages()
{
    if (!socket || !socket->isConnected()) return false;
    while (socket->waitUntilReady(true, 0) > 0)
    {
        std::array<uint8_t, 4096> buffer {};
        const int bytesRead = socket->read(buffer.data(), static_cast<int>(buffer.size()), false);
        if (bytesRead <= 0) return false;
        controlBuffer.append(buffer.data(), static_cast<size_t>(bytesRead));
        if (controlBuffer.getSize() > maxPayloadBytes + frameHeaderBytes) return false;
        parseControlBuffer();
    }
    return true;
}

void PrismBridgeProcessor::parseControlBuffer()
{
    while (controlBuffer.getSize() >= frameHeaderBytes)
    {
        const auto* data = static_cast<const uint8_t*>(controlBuffer.getData());
        const uint32_t magic = readU32(data + 0);
        const uint16_t version = readU16(data + 4);
        const uint16_t messageType = readU16(data + 6);
        const uint32_t payloadSize = readU32(data + 8);
        if (magic != frameMagic || version != protocolVersion || payloadSize > maxPayloadBytes)
        {
            closeSocket();
            return;
        }
        const size_t frameSize = frameHeaderBytes + payloadSize;
        if (controlBuffer.getSize() < frameSize) return;

        if (messageType == messageSubscribe)
        {
            const auto json = juce::String::fromUTF8(
                reinterpret_cast<const char*>(data + frameHeaderBytes),
                static_cast<int>(payloadSize));
            const auto parsed = juce::JSON::parse(json);
            if (const auto* object = parsed.getDynamicObject())
                selected.store(static_cast<bool>(object->getProperty("selected")));
        }

        juce::MemoryBlock remainder;
        if (controlBuffer.getSize() > frameSize)
            remainder.append(data + frameSize, controlBuffer.getSize() - frameSize);
        controlBuffer.swapWith(remainder);
    }
}

void PrismBridgeProcessor::updateTrackProperties(const TrackProperties& properties)
{
    {
        const juce::ScopedLock lock(identityLock);
        trackName = properties.name;
    }
    identityDirty.store(true);
}

void PrismBridgeProcessor::setCustomName(const juce::String& value)
{
    {
        const juce::ScopedLock lock(identityLock);
        customName = value.trim().substring(0, 160);
    }
    identityDirty.store(true);
    updateHostDisplay(ChangeDetails().withNonParameterStateChanged(true));
}

juce::String PrismBridgeProcessor::getCustomName() const
{
    const juce::ScopedLock lock(identityLock);
    return customName;
}

juce::String PrismBridgeProcessor::getDisplayName() const
{
    const juce::ScopedLock lock(identityLock);
    if (customName.isNotEmpty()) return customName;
    if (trackName.isNotEmpty()) return trackName;
    return "Prism Bridge " + sourceId.substring(0, 8);
}

juce::String PrismBridgeProcessor::getHostName() const
{
    const juce::ScopedLock lock(identityLock);
    return hostName;
}

juce::String PrismBridgeProcessor::getTrackName() const
{
    const juce::ScopedLock lock(identityLock);
    return trackName;
}

juce::String PrismBridgeProcessor::getConnectionDescription() const
{
    if (!connected.load()) return "Waiting for Prism";
    return selected.load() ? "Connected · selected in Prism" : "Connected · available in Prism";
}

void PrismBridgeProcessor::getStateInformation(juce::MemoryBlock& destination)
{
    const juce::ScopedLock lock(identityLock);
    auto object = new juce::DynamicObject();
    object->setProperty("sourceId", sourceId);
    object->setProperty("customName", customName);
    const auto json = juce::JSON::toString(juce::var(object));
    destination.setSize(0);
    destination.append(json.toRawUTF8(), static_cast<size_t>(json.getNumBytesAsUTF8()));
}

void PrismBridgeProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    if (!data || sizeInBytes <= 0) return;
    const auto parsed = juce::JSON::parse(juce::String::fromUTF8(static_cast<const char*>(data), sizeInBytes));
    if (const auto* object = parsed.getDynamicObject())
    {
        const juce::ScopedLock lock(identityLock);
        const auto restoredId = object->getProperty("sourceId").toString();
        if (restoredId.isNotEmpty()) sourceId = restoredId;
        customName = object->getProperty("customName").toString().trim().substring(0, 160);
    }
    identityDirty.store(true);
}

juce::AudioProcessorEditor* PrismBridgeProcessor::createEditor()
{
    return new PrismBridgeEditor(*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PrismBridgeProcessor();
}
