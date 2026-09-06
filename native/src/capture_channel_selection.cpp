#include "capture_channel_selection.h"

#include <algorithm>
#include <cstring>

namespace Prism::Capture {
namespace {

uint64_t readUnsignedSample(const uint8_t* data, size_t byteCount, bool bigEndian) {
    uint64_t value = 0;
    if (bigEndian) {
        for (size_t index = 0; index < byteCount; ++index) {
            value = (value << 8) | data[index];
        }
    } else {
        for (size_t index = 0; index < byteCount; ++index) {
            value |= static_cast<uint64_t>(data[index]) << (index * 8);
        }
    }
    return value;
}

float decodeSample(const uint8_t* data, const PCMFormat& format) {
    const size_t byteCount = format.bitsPerChannel / 8;
    if (data == nullptr || byteCount == 0 || byteCount > sizeof(uint64_t)) return 0.0f;

    if (format.encoding == SampleEncoding::Float && format.bitsPerChannel == 32) {
        uint32_t bits = static_cast<uint32_t>(readUnsignedSample(data, byteCount, format.bigEndian));
        float value = 0.0f;
        std::memcpy(&value, &bits, sizeof(value));
        return value;
    }
    if (format.encoding == SampleEncoding::Float && format.bitsPerChannel == 64) {
        const uint64_t bits = readUnsignedSample(data, byteCount, format.bigEndian);
        double value = 0.0;
        std::memcpy(&value, &bits, sizeof(value));
        return static_cast<float>(value);
    }
    if (format.encoding != SampleEncoding::SignedInteger || format.bitsPerChannel > 32) {
        return 0.0f;
    }

    const uint64_t raw = readUnsignedSample(data, byteCount, format.bigEndian);
    const uint64_t signBit = uint64_t{1} << (format.bitsPerChannel - 1);
    const int64_t signedValue = (raw & signBit) != 0
        ? static_cast<int64_t>(raw) - static_cast<int64_t>(uint64_t{1} << format.bitsPerChannel)
        : static_cast<int64_t>(raw);
    const double maximum = static_cast<double>(signBit - 1);
    return maximum > 0.0 ? static_cast<float>(static_cast<double>(signedValue) / maximum) : 0.0f;
}

float readChannelFrame(const PCMBufferView* buffers,
                       size_t bufferCount,
                       const PCMFormat& format,
                       uint32_t channel,
                       size_t frame) {
    const size_t bytesPerSample = format.bitsPerChannel / 8;
    uint32_t channelBase = 0;
    for (size_t bufferIndex = 0; bufferIndex < bufferCount; ++bufferIndex) {
        const PCMBufferView& buffer = buffers[bufferIndex];
        const uint32_t channelsInBuffer = std::max<uint32_t>(1, buffer.channelCount);
        if (channel >= channelBase + channelsInBuffer) {
            channelBase += channelsInBuffer;
            continue;
        }

        const size_t localChannel = channel - channelBase;
        const size_t sampleIndex = frame * channelsInBuffer + localChannel;
        const size_t byteOffset = sampleIndex * bytesPerSample;
        if (buffer.data == nullptr || byteOffset + bytesPerSample > buffer.byteLength) return 0.0f;
        return decodeSample(buffer.data + byteOffset, format);
    }
    return 0.0f;
}

}  // namespace

bool selectStereoChannels(const PCMBufferView* buffers,
                          size_t bufferCount,
                          const PCMFormat& format,
                          size_t frameCount,
                          uint32_t sourceChannelCount,
                          uint32_t leftChannel,
                          uint32_t rightChannel,
                          float* leftOutput,
                          float* rightOutput) {
    if (leftOutput == nullptr || rightOutput == nullptr) return false;
    const bool valid = buffers != nullptr
        && bufferCount > 0
        && format.bitsPerChannel >= 8
        && format.bitsPerChannel % 8 == 0
        && format.encoding != SampleEncoding::Unsupported
        && sourceChannelCount > 0
        && leftChannel < sourceChannelCount
        && rightChannel < sourceChannelCount;
    if (!valid) {
        std::fill_n(leftOutput, frameCount, 0.0f);
        std::fill_n(rightOutput, frameCount, 0.0f);
        return false;
    }

    for (size_t frame = 0; frame < frameCount; ++frame) {
        leftOutput[frame] = readChannelFrame(buffers, bufferCount, format, leftChannel, frame);
        rightOutput[frame] = readChannelFrame(buffers, bufferCount, format, rightChannel, frame);
    }
    return true;
}

}  // namespace Prism::Capture
