#pragma once

namespace Prism::Tui {

enum class VUMeterMode {
    Bar,
    Needle,
};

enum class VUMeterOrientation {
    Horizontal,
    Vertical,
};

enum class VUNeedleChannels {
    Stereo,
    Combined,
};

enum class LUFSReadout {
    Momentary,
    ShortTerm,
    Integrated,
};

float dbfsToClassicVu(float dbfs, float referenceDbfs);
float classicVuToNormalized(float vu);
float vuDbToNormalized(float dbfs, float referenceDbfs);
float compactMeterToNormalized(float db);
float stereoRmsDbAverage(float leftDb, float rightDb);
float selectLufsReadout(float momentary,
                        float shortTerm,
                        float integrated,
                        LUFSReadout readout);

const char* vuMeterModeName(VUMeterMode mode);
const char* vuMeterOrientationName(VUMeterOrientation orientation);
const char* vuNeedleChannelsName(VUNeedleChannels channels);
const char* lufsReadoutName(LUFSReadout readout);

}  // namespace Prism::Tui
