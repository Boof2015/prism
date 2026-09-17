#pragma once

#include <cstddef>
#include <cstdint>

namespace Prism::Capture {

enum class SampleEncoding {
    Float,
    SignedInteger,
    UnsignedInteger,
    Unsupported,
};

struct PCMFormat {
    SampleEncoding encoding = SampleEncoding::Unsupported;
    uint32_t bitsPerChannel = 0;
    bool bigEndian = false;
    // Zero uses bitsPerChannel (the byte-aligned storage/container width).
    uint32_t validBitsPerChannel = 0;
    bool highAligned = false;
    // Preserve the original macOS signed-PCM scale by default. PulseAudio uses
    // the negative full-scale magnitude (e.g. 32768 for signed 16-bit PCM).
    bool normalizeByPowerOfTwo = false;
};

bool isSupportedPCMFormat(const PCMFormat& format);

struct PCMBufferView {
    const uint8_t* data = nullptr;
    size_t byteLength = 0;
    uint32_t channelCount = 0;
};

/** Writes one finite absolute peak per source channel, before stereo routing. */
void measureSourceChannelPeaks(const PCMBufferView* buffers,
                               size_t bufferCount,
                               const PCMFormat& format,
                               size_t frameCount,
                               uint32_t sourceChannelCount,
                               float* peaksOutput);

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
