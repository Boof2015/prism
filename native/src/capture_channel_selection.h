#pragma once

#include <cstddef>
#include <cstdint>

namespace Prism::Capture {

enum class SampleEncoding {
    Float,
    SignedInteger,
    Unsupported,
};

struct PCMFormat {
    SampleEncoding encoding = SampleEncoding::Unsupported;
    uint32_t bitsPerChannel = 0;
    bool bigEndian = false;
};

struct PCMBufferView {
    const uint8_t* data = nullptr;
    size_t byteLength = 0;
    uint32_t channelCount = 0;
};

/**
 * Selects a stereo pair from one or more interleaved or planar PCM buffers.
 * The output arrays must each have room for frameCount samples. Invalid routes
 * are rendered as silence and reported by the return value.
 */
bool selectStereoChannels(const PCMBufferView* buffers,
                          size_t bufferCount,
                          const PCMFormat& format,
                          size_t frameCount,
                          uint32_t sourceChannelCount,
                          uint32_t leftChannel,
                          uint32_t rightChannel,
                          float* leftOutput,
                          float* rightOutput);

}  // namespace Prism::Capture
