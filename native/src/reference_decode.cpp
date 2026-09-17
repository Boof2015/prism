#include "reference_analysis.h"
#define DR_WAV_IMPLEMENTATION
#define DR_FLAC_IMPLEMENTATION
#define DR_MP3_IMPLEMENTATION
#include "../vendor/dr_libs/dr_wav.h"
#include "../vendor/dr_libs/dr_flac.h"
#include "../vendor/dr_libs/dr_mp3.h"
#include <algorithm>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <stdexcept>

namespace Visualizer {
namespace {
struct Decoder {
    drwav wav {};
    drmp3 mp3 {};
    drflac* flac = nullptr;
    int kind = 0, channels = 0, rate = 0;
    uint64_t frames = 0;
    explicit Decoder(const std::string& path) {
        const auto nativePath = std::filesystem::u8path(path);
        // dr_wav deliberately tolerates truncated containers. Reject a declared
        // RIFF/AIFF size beyond EOF rather than silently saving a partial track.
        std::ifstream headerFile(nativePath, std::ios::binary);
        unsigned char header[12] {};
        if (headerFile.read(reinterpret_cast<char*>(header), sizeof(header))) {
            const bool little = std::memcmp(header, "RIFF", 4) == 0;
            const bool big = std::memcmp(header, "FORM", 4) == 0 || std::memcmp(header, "RIFX", 4) == 0;
            if (little || big) {
                uint64_t declared = 0;
                for (int i = 0; i < 4; ++i) declared |= static_cast<uint64_t>(header[4 + i]) << (8 * (little ? i : 3 - i));
                std::error_code error;
                const auto bytes = std::filesystem::file_size(nativePath, error);
                if (!error && declared != 0xffffffff && declared + 8 > bytes)
                    throw std::runtime_error("This audio file is incomplete or damaged.");
            }
        }
#ifdef _WIN32
        const auto* file = nativePath.c_str();
        if (drwav_init_file_w(&wav, file, nullptr)) kind = 1;
        else if ((flac = drflac_open_file_w(file, nullptr))) kind = 2;
        else if (drmp3_init_file_w(&mp3, file, nullptr)) kind = 3;
#else
        const auto* file = nativePath.c_str();
        if (drwav_init_file(&wav, file, nullptr)) kind = 1;
        else if ((flac = drflac_open_file(file, nullptr))) kind = 2;
        else if (drmp3_init_file(&mp3, file, nullptr)) kind = 3;
#endif
        if (kind == 1) { channels = wav.channels; rate = wav.sampleRate; frames = wav.totalPCMFrameCount; }
        if (kind == 2) { channels = flac->channels; rate = flac->sampleRate; frames = flac->totalPCMFrameCount; }
        if (kind == 3) { channels = mp3.channels; rate = mp3.sampleRate; frames = mp3.totalPCMFrameCount == DRMP3_UINT64_MAX ? 0 : mp3.totalPCMFrameCount; }
        if (!kind) throw std::runtime_error("Could not open this audio file. Choose a WAV, AIFF, FLAC, or MP3 file.");
    }
    ~Decoder() {
        if (kind == 1) drwav_uninit(&wav);
        if (kind == 2) drflac_close(flac);
        if (kind == 3) drmp3_uninit(&mp3);
    }
    size_t read(float* data, size_t n) {
        if (kind == 1) return static_cast<size_t>(drwav_read_pcm_frames_f32(&wav, n, data));
        if (kind == 2) return static_cast<size_t>(drflac_read_pcm_frames_f32(flac, n, data));
        return static_cast<size_t>(drmp3_read_pcm_frames_f32(&mp3, n, data));
    }
};
bool finiteSample(float value) {
    // Keep validation effective even in the existing -ffast-math native build.
    uint32_t bits; std::memcpy(&bits, &value, sizeof(bits));
    return (bits & 0x7f800000u) != 0x7f800000u;
}
}
ReferenceCurve analyzeReferenceFile(const std::string& path, std::atomic<bool>& cancelled,
                                  const ReferenceProgress& progress, size_t chunkFrames) {
    Decoder decoder(path);
    if (decoder.channels != 1 && decoder.channels != 2) throw std::runtime_error("Choose a mono or stereo reference track.");
    ReferenceAccumulator accumulator(decoder.rate);
    chunkFrames = std::clamp<size_t>(chunkFrames, 1, 16384);
    std::vector<float> interleaved(chunkFrames * decoder.channels), mid(chunkFrames);
    uint64_t frames = 0;
    auto lastProgress = std::chrono::steady_clock::now() - std::chrono::seconds(1);
    while (!cancelled.load()) {
        const auto count = decoder.read(interleaved.data(), chunkFrames);
        if (!count) break;
        for (size_t i = 0; i < count; ++i) {
            const float left = interleaved[i * decoder.channels];
            const float right = decoder.channels == 2 ? interleaved[i * 2 + 1] : left;
            if (!finiteSample(left) || !finiteSample(right) || std::abs(left) > 1e6f || std::abs(right) > 1e6f)
                throw std::runtime_error("The reference contains invalid audio samples.");
            mid[i] = left * 0.5f + right * 0.5f;
        }
        accumulator.push(mid.data(), count);
        frames += count;
        const auto now = std::chrono::steady_clock::now();
        if (progress && now - lastProgress >= std::chrono::milliseconds(100)) {
            progress(decoder.frames ? std::min(0.999, static_cast<double>(frames) / decoder.frames) : -1, accumulator.snapshot());
            lastProgress = now;
        }
    }
    if (cancelled.load()) throw std::runtime_error("Reference analysis cancelled.");
    if (frames == 0) throw std::runtime_error("This audio file is empty.");
    // MP3 totals may include codec delay/padding, unlike decoded PCM counts.
    if (decoder.kind != 3 && decoder.frames && frames < decoder.frames)
        throw std::runtime_error("This audio file is incomplete or damaged.");
    auto result = accumulator.snapshot(true);
    if (result.meanSquare <= 1e-12) throw std::runtime_error("This track has no usable signal in the spectrum's Mid channel.");
    return result;
}
}
