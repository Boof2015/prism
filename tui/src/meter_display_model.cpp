#include "meter_display_model.h"

#include <algorithm>
#include <array>
#include <cmath>

namespace Prism::Tui {
namespace {

struct VuAnchor {
    float vu;
    float normalized;
};

constexpr std::array<VuAnchor, 12> kVuAnchors = {{
    {-20.0f, 0.00f},
    {-10.0f, 0.24f},
    {-7.0f, 0.36f},
    {-5.0f, 0.46f},
    {-4.0f, 0.53f},
    {-3.0f, 0.60f},
    {-2.0f, 0.67f},
    {-1.0f, 0.74f},
    {0.0f, 0.81f},
    {1.0f, 0.88f},
    {2.0f, 0.94f},
    {3.0f, 1.00f},
}};

}  // namespace

float dbfsToClassicVu(float dbfs, float referenceDbfs) {
    if (!std::isfinite(dbfs)) return -20.0f;
    return std::clamp(dbfs - referenceDbfs, -20.0f, 3.0f);
}

float classicVuToNormalized(float vu) {
    const float clamped = std::clamp(vu, -20.0f, 3.0f);
    for (size_t index = 1; index < kVuAnchors.size(); ++index) {
        const auto& left = kVuAnchors[index - 1];
        const auto& right = kVuAnchors[index];
        if (clamped <= right.vu) {
            const float amount = (clamped - left.vu) / (right.vu - left.vu);
            return left.normalized + amount * (right.normalized - left.normalized);
        }
    }
    return 1.0f;
}

float vuDbToNormalized(float dbfs, float referenceDbfs) {
    return classicVuToNormalized(dbfsToClassicVu(dbfs, referenceDbfs));
}

float compactMeterToNormalized(float db) {
    if (!std::isfinite(db)) return 0.0f;
    return std::clamp((db + 50.0f) / 50.0f, 0.0f, 1.0f);
}

float stereoRmsDbAverage(float leftDb, float rightDb) {
    if (!std::isfinite(leftDb) && !std::isfinite(rightDb)) return -60.0f;
    const float leftPower = std::isfinite(leftDb)
        ? std::pow(10.0f, leftDb / 10.0f)
        : 0.0f;
    const float rightPower = std::isfinite(rightDb)
        ? std::pow(10.0f, rightDb / 10.0f)
        : 0.0f;
    const float meanPower = (leftPower + rightPower) * 0.5f;
    return meanPower > 0.0f ? 10.0f * std::log10(meanPower) : -60.0f;
}

float selectLufsReadout(float momentary,
                        float shortTerm,
                        float integrated,
                        LUFSReadout readout) {
    switch (readout) {
        case LUFSReadout::Momentary: return momentary;
        case LUFSReadout::ShortTerm: return shortTerm;
        case LUFSReadout::Integrated: return integrated;
    }
    return shortTerm;
}

const char* vuMeterModeName(VUMeterMode mode) {
    return mode == VUMeterMode::Needle ? "Needle" : "Bar";
}

const char* vuMeterOrientationName(VUMeterOrientation orientation) {
    return orientation == VUMeterOrientation::Vertical ? "Vertical" : "Horizontal";
}

const char* vuNeedleChannelsName(VUNeedleChannels channels) {
    return channels == VUNeedleChannels::Combined ? "Combined" : "Stereo";
}

const char* lufsReadoutName(LUFSReadout readout) {
    switch (readout) {
        case LUFSReadout::Momentary: return "Momentary";
        case LUFSReadout::ShortTerm: return "Short term";
        case LUFSReadout::Integrated: return "Integrated";
    }
    return "Short term";
}

}  // namespace Prism::Tui
