#include "tui_settings.h"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <system_error>

namespace Prism::Tui {
namespace {

const std::vector<SettingDescriptor> kGeneralSettings = {
    {SettingId::InputTrim, "Input trim", "Applies gain before every analyzer."},
    {SettingId::RefreshRate, "Refresh rate", "Controls how often the terminal display is published."},
    {SettingId::Layout, "Dashboard layout", "Chooses automatic, stacked, or column panes."},
};

const std::vector<SettingDescriptor> kSpectrumSettings = {
    {SettingId::SpectrumPeakReadout, "Peak readout", "Shows the strongest stable spectral peak in the panel title."},
    {SettingId::SpectrumTilt, "Display tilt", "Offsets the spectrum by decibels per octave around 1 kHz."},
};

const std::vector<SettingDescriptor> kOscilloscopeSettings = {
    {SettingId::OscilloscopePitchLock, "Pitch lock", "Stabilizes the waveform around its detected fundamental."},
    {SettingId::OscilloscopeFrequencyReadout, "Frequency readout", "Shows the live detected fundamental while pitch lock is enabled."},
    {SettingId::OscilloscopeTraceWeight, "Trace weight", "Changes the thickness of the oscilloscope trace."},
};

const std::vector<SettingDescriptor> kVectorscopeSettings = {
    {SettingId::VectorscopeMode, "Display mode", "Changes the stereo projection used by the vectorscope."},
    {SettingId::VectorscopeGuides, "Guides", "Shows the mode-specific reference contours and axes."},
    {SettingId::VectorscopeDetail, "Point detail", "Balances point density against terminal rendering cost."},
};

const std::vector<SettingDescriptor> kVUMeterSettings = {
    {SettingId::VUMeterMode, "Display mode", "Switches between Prism's bar and classic needle faces."},
    {SettingId::VUMeterOrientation, "Bar orientation", "Chooses horizontal or vertical bars when bar mode is active."},
    {SettingId::VUNeedleChannels, "Needle channels", "Shows stereo needles or one power-averaged needle."},
    {SettingId::VUReferenceLevel, "0 VU reference", "Calibrates 0 VU to a dBFS reference level."},
};

const std::vector<SettingDescriptor> kLUFSMeterSettings = {
    {SettingId::LUFSReadout, "Loudness readout", "Chooses which LUFS window drives the main bar and badge."},
};

float snap(float value, float step) {
    return std::round(value / step) * step;
}

std::string boolValue(bool enabled) {
    return enabled ? "● On" : "○ Off";
}

std::string trimFloat(float value, int precision) {
    std::ostringstream output;
    output << std::fixed << std::setprecision(precision) << value;
    return output.str();
}

std::string serializeLayout(LayoutPreset layout) {
    return layoutPresetName(layout);
}

std::string serializeVectorMode(VectorscopeMode mode) {
    switch (mode) {
        case VectorscopeMode::Lissajous: return "lissajous";
        case VectorscopeMode::PolarUnipolar: return "polar_unipolar";
        case VectorscopeMode::PolarBipolar: return "polar_bipolar";
        case VectorscopeMode::LinearUnipolar: return "linear_unipolar";
        case VectorscopeMode::LinearBipolar: return "linear_bipolar";
    }
    return "lissajous";
}

std::string serializeVectorDetail(VectorscopeDetail detail) {
    switch (detail) {
        case VectorscopeDetail::Balanced: return "balanced";
        case VectorscopeDetail::Detailed: return "detailed";
        case VectorscopeDetail::Maximum: return "maximum";
    }
    return "detailed";
}

std::string serializeVuMode(VUMeterMode mode) {
    return mode == VUMeterMode::Needle ? "needle" : "bar";
}

std::string serializeVuOrientation(VUMeterOrientation orientation) {
    return orientation == VUMeterOrientation::Vertical ? "vertical" : "horizontal";
}

std::string serializeVuNeedleChannels(VUNeedleChannels channels) {
    return channels == VUNeedleChannels::Combined ? "combined" : "stereo";
}

std::string serializeLufsReadout(LUFSReadout readout) {
    switch (readout) {
        case LUFSReadout::Momentary: return "momentary";
        case LUFSReadout::ShortTerm: return "short_term";
        case LUFSReadout::Integrated: return "integrated";
    }
    return "short_term";
}

bool parseBool(const std::string& value, bool fallback) {
    if (value == "true" || value == "1" || value == "on") return true;
    if (value == "false" || value == "0" || value == "off") return false;
    return fallback;
}

float parseFloat(const std::string& value, float fallback) {
    try {
        size_t consumed = 0;
        const float parsed = std::stof(value, &consumed);
        return consumed == value.size() && std::isfinite(parsed) ? parsed : fallback;
    } catch (...) {
        return fallback;
    }
}

int parseInt(const std::string& value, int fallback) {
    try {
        size_t consumed = 0;
        const int parsed = std::stoi(value, &consumed);
        return consumed == value.size() ? parsed : fallback;
    } catch (...) {
        return fallback;
    }
}

LayoutPreset parseLayout(const std::string& value, LayoutPreset fallback) {
    if (value == "auto") return LayoutPreset::Automatic;
    if (value == "stacked") return LayoutPreset::Stacked;
    if (value == "columns") return LayoutPreset::Columns;
    return fallback;
}

VectorscopeMode parseVectorMode(const std::string& value, VectorscopeMode fallback) {
    if (value == "lissajous") return VectorscopeMode::Lissajous;
    if (value == "polar_unipolar") return VectorscopeMode::PolarUnipolar;
    if (value == "polar_bipolar") return VectorscopeMode::PolarBipolar;
    if (value == "linear_unipolar") return VectorscopeMode::LinearUnipolar;
    if (value == "linear_bipolar") return VectorscopeMode::LinearBipolar;
    return fallback;
}

VectorscopeDetail parseVectorDetail(const std::string& value,
                                    VectorscopeDetail fallback) {
    if (value == "balanced") return VectorscopeDetail::Balanced;
    if (value == "detailed") return VectorscopeDetail::Detailed;
    if (value == "maximum") return VectorscopeDetail::Maximum;
    return fallback;
}

VUMeterMode parseVuMode(const std::string& value, VUMeterMode fallback) {
    if (value == "bar") return VUMeterMode::Bar;
    if (value == "needle") return VUMeterMode::Needle;
    return fallback;
}

VUMeterOrientation parseVuOrientation(const std::string& value,
                                      VUMeterOrientation fallback) {
    if (value == "horizontal") return VUMeterOrientation::Horizontal;
    if (value == "vertical") return VUMeterOrientation::Vertical;
    return fallback;
}

VUNeedleChannels parseVuNeedleChannels(const std::string& value,
                                       VUNeedleChannels fallback) {
    if (value == "stereo") return VUNeedleChannels::Stereo;
    if (value == "combined") return VUNeedleChannels::Combined;
    return fallback;
}

LUFSReadout parseLufsReadout(const std::string& value, LUFSReadout fallback) {
    if (value == "momentary") return LUFSReadout::Momentary;
    if (value == "short_term") return LUFSReadout::ShortTerm;
    if (value == "integrated") return LUFSReadout::Integrated;
    return fallback;
}

const char* environmentValue(const char* name) {
    const char* value = std::getenv(name);
    return value != nullptr && value[0] != '\0' ? value : nullptr;
}

}  // namespace

TuiSettings normalizeSettings(TuiSettings settings) {
    settings.inputTrimDb = std::clamp(snap(settings.inputTrimDb, 0.5f), -12.0f, 12.0f);
    settings.refreshRate = settings.refreshRate <= 30 ? 30 : 60;
    settings.spectrumTiltDbPerOctave = std::clamp(
        snap(settings.spectrumTiltDbPerOctave, 0.1f), -2.0f, 8.0f);
    settings.oscilloscopeTraceWeight = std::clamp(settings.oscilloscopeTraceWeight, 1, 3);
    settings.vuReferenceDbfs = std::clamp(
        snap(settings.vuReferenceDbfs, 1.0f), -30.0f, 0.0f);
    if (!settings.oscilloscopePitchLock) {
        settings.oscilloscopeFrequencyReadout = false;
    }
    return settings;
}

bool operator==(const TuiSettings& left, const TuiSettings& right) {
    return left.inputTrimDb == right.inputTrimDb &&
        left.refreshRate == right.refreshRate &&
        left.layoutPreset == right.layoutPreset &&
        left.spectrumPeakReadout == right.spectrumPeakReadout &&
        left.spectrumTiltDbPerOctave == right.spectrumTiltDbPerOctave &&
        left.oscilloscopePitchLock == right.oscilloscopePitchLock &&
        left.oscilloscopeFrequencyReadout == right.oscilloscopeFrequencyReadout &&
        left.oscilloscopeTraceWeight == right.oscilloscopeTraceWeight &&
        left.vectorscopeMode == right.vectorscopeMode &&
        left.vectorscopeGuides == right.vectorscopeGuides &&
        left.vectorscopeDetail == right.vectorscopeDetail &&
        left.vuMeterMode == right.vuMeterMode &&
        left.vuMeterOrientation == right.vuMeterOrientation &&
        left.vuNeedleChannels == right.vuNeedleChannels &&
        left.vuReferenceDbfs == right.vuReferenceDbfs &&
        left.lufsReadout == right.lufsReadout;
}

bool operator!=(const TuiSettings& left, const TuiSettings& right) {
    return !(left == right);
}

std::vector<SettingsPage> settingsPages() {
    return {
        SettingsPage::General,
        SettingsPage::Spectrum,
        SettingsPage::Oscilloscope,
        SettingsPage::Vectorscope,
        SettingsPage::VUMeter,
        SettingsPage::LUFSMeter,
    };
}

const char* settingsPageName(SettingsPage page) {
    switch (page) {
        case SettingsPage::Home: return "Settings";
        case SettingsPage::General: return "General";
        case SettingsPage::Spectrum: return "Spectrum";
        case SettingsPage::Oscilloscope: return "Oscilloscope";
        case SettingsPage::Vectorscope: return "Vectorscope";
        case SettingsPage::VUMeter: return "VU meter";
        case SettingsPage::LUFSMeter: return "LUFS meter";
    }
    return "Settings";
}

const char* settingsPageDescription(SettingsPage page) {
    switch (page) {
        case SettingsPage::Home: return "Choose a section.";
        case SettingsPage::General: return "Audio input and dashboard behavior.";
        case SettingsPage::Spectrum: return "Frequency analysis and readouts.";
        case SettingsPage::Oscilloscope: return "Waveform stabilization and presentation.";
        case SettingsPage::Vectorscope: return "Stereo projection and point rendering.";
        case SettingsPage::VUMeter: return "Classic level, peak, and phase metering.";
        case SettingsPage::LUFSMeter: return "Loudness window and target presentation.";
    }
    return {};
}

const std::vector<SettingDescriptor>& settingsForPage(SettingsPage page) {
    switch (page) {
        case SettingsPage::General: return kGeneralSettings;
        case SettingsPage::Spectrum: return kSpectrumSettings;
        case SettingsPage::Oscilloscope: return kOscilloscopeSettings;
        case SettingsPage::Vectorscope: return kVectorscopeSettings;
        case SettingsPage::VUMeter: return kVUMeterSettings;
        case SettingsPage::LUFSMeter: return kLUFSMeterSettings;
        case SettingsPage::Home: break;
    }
    static const std::vector<SettingDescriptor> empty;
    return empty;
}

std::string settingValue(const TuiSettings& settings, SettingId setting) {
    switch (setting) {
        case SettingId::InputTrim:
            return (settings.inputTrimDb > 0.0f ? "+" : "") +
                trimFloat(settings.inputTrimDb, 1) + " dB";
        case SettingId::RefreshRate:
            return std::to_string(settings.refreshRate) + " FPS";
        case SettingId::Layout:
            return layoutPresetName(settings.layoutPreset);
        case SettingId::SpectrumPeakReadout:
            return boolValue(settings.spectrumPeakReadout);
        case SettingId::SpectrumTilt:
            return trimFloat(settings.spectrumTiltDbPerOctave, 1) + " dB/oct";
        case SettingId::OscilloscopePitchLock:
            return boolValue(settings.oscilloscopePitchLock);
        case SettingId::OscilloscopeFrequencyReadout:
            return boolValue(settings.oscilloscopeFrequencyReadout);
        case SettingId::OscilloscopeTraceWeight:
            return std::to_string(settings.oscilloscopeTraceWeight);
        case SettingId::VectorscopeMode:
            return vectorscopeModeName(settings.vectorscopeMode);
        case SettingId::VectorscopeGuides:
            return boolValue(settings.vectorscopeGuides);
        case SettingId::VectorscopeDetail:
            switch (settings.vectorscopeDetail) {
                case VectorscopeDetail::Balanced: return "Balanced";
                case VectorscopeDetail::Detailed: return "Detailed";
                case VectorscopeDetail::Maximum: return "Maximum";
            }
        case SettingId::VUMeterMode:
            return vuMeterModeName(settings.vuMeterMode);
        case SettingId::VUMeterOrientation:
            return vuMeterOrientationName(settings.vuMeterOrientation);
        case SettingId::VUNeedleChannels:
            return vuNeedleChannelsName(settings.vuNeedleChannels);
        case SettingId::VUReferenceLevel:
            return trimFloat(settings.vuReferenceDbfs, 0) + " dBFS";
        case SettingId::LUFSReadout:
            return lufsReadoutName(settings.lufsReadout);
    }
    return {};
}

bool settingIsBoolean(SettingId setting) {
    return setting == SettingId::SpectrumPeakReadout ||
        setting == SettingId::OscilloscopePitchLock ||
        setting == SettingId::OscilloscopeFrequencyReadout ||
        setting == SettingId::VectorscopeGuides;
}

bool adjustSetting(TuiSettings& settings, SettingId setting, int direction) {
    if (direction == 0) return false;
    const TuiSettings before = settings;
    switch (setting) {
        case SettingId::InputTrim:
            settings.inputTrimDb += direction > 0 ? 0.5f : -0.5f;
            break;
        case SettingId::RefreshRate:
            settings.refreshRate = settings.refreshRate == 60 ? 30 : 60;
            break;
        case SettingId::Layout:
            if (direction > 0) {
                settings.layoutPreset = nextLayoutPreset(settings.layoutPreset);
            } else {
                settings.layoutPreset = settings.layoutPreset == LayoutPreset::Automatic
                    ? LayoutPreset::Columns
                    : settings.layoutPreset == LayoutPreset::Columns
                        ? LayoutPreset::Stacked
                        : LayoutPreset::Automatic;
            }
            break;
        case SettingId::SpectrumPeakReadout:
            settings.spectrumPeakReadout = !settings.spectrumPeakReadout;
            break;
        case SettingId::SpectrumTilt:
            settings.spectrumTiltDbPerOctave += direction > 0 ? 0.1f : -0.1f;
            break;
        case SettingId::OscilloscopePitchLock:
            settings.oscilloscopePitchLock = !settings.oscilloscopePitchLock;
            if (!settings.oscilloscopePitchLock) {
                settings.oscilloscopeFrequencyReadout = false;
            }
            break;
        case SettingId::OscilloscopeFrequencyReadout:
            if (!settings.oscilloscopePitchLock) {
                return false;
            }
            settings.oscilloscopeFrequencyReadout = !settings.oscilloscopeFrequencyReadout;
            break;
        case SettingId::OscilloscopeTraceWeight:
            settings.oscilloscopeTraceWeight += direction > 0 ? 1 : -1;
            break;
        case SettingId::VectorscopeMode:
            if (direction > 0) {
                settings.vectorscopeMode = nextVectorscopeMode(settings.vectorscopeMode);
            } else {
                for (int index = 0; index < 4; ++index) {
                    settings.vectorscopeMode = nextVectorscopeMode(settings.vectorscopeMode);
                }
            }
            break;
        case SettingId::VectorscopeGuides:
            settings.vectorscopeGuides = !settings.vectorscopeGuides;
            break;
        case SettingId::VectorscopeDetail: {
            int value = static_cast<int>(settings.vectorscopeDetail);
            value = std::clamp(value + (direction > 0 ? 1 : -1), 0, 2);
            settings.vectorscopeDetail = static_cast<VectorscopeDetail>(value);
            break;
        }
        case SettingId::VUMeterMode:
            settings.vuMeterMode = settings.vuMeterMode == VUMeterMode::Bar
                ? VUMeterMode::Needle
                : VUMeterMode::Bar;
            break;
        case SettingId::VUMeterOrientation:
            settings.vuMeterOrientation =
                settings.vuMeterOrientation == VUMeterOrientation::Horizontal
                    ? VUMeterOrientation::Vertical
                    : VUMeterOrientation::Horizontal;
            break;
        case SettingId::VUNeedleChannels:
            settings.vuNeedleChannels =
                settings.vuNeedleChannels == VUNeedleChannels::Stereo
                    ? VUNeedleChannels::Combined
                    : VUNeedleChannels::Stereo;
            break;
        case SettingId::VUReferenceLevel:
            settings.vuReferenceDbfs += direction > 0 ? 1.0f : -1.0f;
            break;
        case SettingId::LUFSReadout: {
            int value = static_cast<int>(settings.lufsReadout);
            value = (value + (direction > 0 ? 1 : 2)) % 3;
            settings.lufsReadout = static_cast<LUFSReadout>(value);
            break;
        }
    }
    settings = normalizeSettings(settings);
    return settings != before;
}

bool resetSetting(TuiSettings& settings, SettingId setting) {
    const TuiSettings defaults;
    const TuiSettings before = settings;
    switch (setting) {
        case SettingId::InputTrim: settings.inputTrimDb = defaults.inputTrimDb; break;
        case SettingId::RefreshRate: settings.refreshRate = defaults.refreshRate; break;
        case SettingId::Layout: settings.layoutPreset = defaults.layoutPreset; break;
        case SettingId::SpectrumPeakReadout: settings.spectrumPeakReadout = defaults.spectrumPeakReadout; break;
        case SettingId::SpectrumTilt: settings.spectrumTiltDbPerOctave = defaults.spectrumTiltDbPerOctave; break;
        case SettingId::OscilloscopePitchLock: settings.oscilloscopePitchLock = defaults.oscilloscopePitchLock; break;
        case SettingId::OscilloscopeFrequencyReadout: settings.oscilloscopeFrequencyReadout = defaults.oscilloscopeFrequencyReadout; break;
        case SettingId::OscilloscopeTraceWeight: settings.oscilloscopeTraceWeight = defaults.oscilloscopeTraceWeight; break;
        case SettingId::VectorscopeMode: settings.vectorscopeMode = defaults.vectorscopeMode; break;
        case SettingId::VectorscopeGuides: settings.vectorscopeGuides = defaults.vectorscopeGuides; break;
        case SettingId::VectorscopeDetail: settings.vectorscopeDetail = defaults.vectorscopeDetail; break;
        case SettingId::VUMeterMode: settings.vuMeterMode = defaults.vuMeterMode; break;
        case SettingId::VUMeterOrientation: settings.vuMeterOrientation = defaults.vuMeterOrientation; break;
        case SettingId::VUNeedleChannels: settings.vuNeedleChannels = defaults.vuNeedleChannels; break;
        case SettingId::VUReferenceLevel: settings.vuReferenceDbfs = defaults.vuReferenceDbfs; break;
        case SettingId::LUFSReadout: settings.lufsReadout = defaults.lufsReadout; break;
    }
    return settings != before;
}

std::filesystem::path defaultSettingsPath() {
#if defined(_WIN32)
    if (const char* appData = environmentValue("APPDATA")) {
        return std::filesystem::path(appData) / "Prism" / "tui.conf";
    }
#elif defined(__APPLE__)
    if (const char* home = environmentValue("HOME")) {
        return std::filesystem::path(home) /
            "Library" / "Application Support" / "Prism" / "tui.conf";
    }
#else
    if (const char* xdgConfig = environmentValue("XDG_CONFIG_HOME")) {
        return std::filesystem::path(xdgConfig) / "prism" / "tui.conf";
    }
    if (const char* home = environmentValue("HOME")) {
        return std::filesystem::path(home) / ".config" / "prism" / "tui.conf";
    }
#endif
    return std::filesystem::path("prism-tui.conf");
}

TuiSettings loadSettings(const std::filesystem::path& path) {
    TuiSettings settings;
    std::ifstream input(path);
    std::string line;
    while (std::getline(input, line)) {
        const size_t separator = line.find('=');
        if (separator == std::string::npos) continue;
        const std::string key = line.substr(0, separator);
        const std::string value = line.substr(separator + 1);
        if (key == "input_trim_db") settings.inputTrimDb = parseFloat(value, settings.inputTrimDb);
        else if (key == "refresh_rate") settings.refreshRate = parseInt(value, settings.refreshRate);
        else if (key == "layout") settings.layoutPreset = parseLayout(value, settings.layoutPreset);
        else if (key == "spectrum_peak") settings.spectrumPeakReadout = parseBool(value, settings.spectrumPeakReadout);
        else if (key == "spectrum_tilt") settings.spectrumTiltDbPerOctave = parseFloat(value, settings.spectrumTiltDbPerOctave);
        else if (key == "osc_pitch_lock") settings.oscilloscopePitchLock = parseBool(value, settings.oscilloscopePitchLock);
        else if (key == "osc_frequency") settings.oscilloscopeFrequencyReadout = parseBool(value, settings.oscilloscopeFrequencyReadout);
        else if (key == "osc_trace_weight") settings.oscilloscopeTraceWeight = parseInt(value, settings.oscilloscopeTraceWeight);
        else if (key == "vector_mode") settings.vectorscopeMode = parseVectorMode(value, settings.vectorscopeMode);
        else if (key == "vector_guides") settings.vectorscopeGuides = parseBool(value, settings.vectorscopeGuides);
        else if (key == "vector_detail") settings.vectorscopeDetail = parseVectorDetail(value, settings.vectorscopeDetail);
        else if (key == "vu_mode") settings.vuMeterMode = parseVuMode(value, settings.vuMeterMode);
        else if (key == "vu_orientation") settings.vuMeterOrientation = parseVuOrientation(value, settings.vuMeterOrientation);
        else if (key == "vu_needle_channels") settings.vuNeedleChannels = parseVuNeedleChannels(value, settings.vuNeedleChannels);
        else if (key == "vu_reference_dbfs") settings.vuReferenceDbfs = parseFloat(value, settings.vuReferenceDbfs);
        else if (key == "lufs_readout") settings.lufsReadout = parseLufsReadout(value, settings.lufsReadout);
    }
    return normalizeSettings(settings);
}

bool saveSettings(const TuiSettings& rawSettings,
                  const std::filesystem::path& path,
                  std::string* error) {
    const TuiSettings settings = normalizeSettings(rawSettings);
    std::error_code filesystemError;
    if (!path.parent_path().empty()) {
        std::filesystem::create_directories(path.parent_path(), filesystemError);
        if (filesystemError) {
            if (error) *error = filesystemError.message();
            return false;
        }
    }
    std::ofstream output(path, std::ios::trunc);
    if (!output) {
        if (error) *error = "could not open settings file";
        return false;
    }
    output << "input_trim_db=" << settings.inputTrimDb << '\n'
           << "refresh_rate=" << settings.refreshRate << '\n'
           << "layout=" << serializeLayout(settings.layoutPreset) << '\n'
           << "spectrum_peak=" << (settings.spectrumPeakReadout ? "true" : "false") << '\n'
           << "spectrum_tilt=" << settings.spectrumTiltDbPerOctave << '\n'
           << "osc_pitch_lock=" << (settings.oscilloscopePitchLock ? "true" : "false") << '\n'
           << "osc_frequency=" << (settings.oscilloscopeFrequencyReadout ? "true" : "false") << '\n'
           << "osc_trace_weight=" << settings.oscilloscopeTraceWeight << '\n'
           << "vector_mode=" << serializeVectorMode(settings.vectorscopeMode) << '\n'
           << "vector_guides=" << (settings.vectorscopeGuides ? "true" : "false") << '\n'
           << "vector_detail=" << serializeVectorDetail(settings.vectorscopeDetail) << '\n'
           << "vu_mode=" << serializeVuMode(settings.vuMeterMode) << '\n'
           << "vu_orientation=" << serializeVuOrientation(settings.vuMeterOrientation) << '\n'
           << "vu_needle_channels=" << serializeVuNeedleChannels(settings.vuNeedleChannels) << '\n'
           << "vu_reference_dbfs=" << settings.vuReferenceDbfs << '\n'
           << "lufs_readout=" << serializeLufsReadout(settings.lufsReadout) << '\n';
    if (!output) {
        if (error) *error = "could not write settings file";
        return false;
    }
    return true;
}

}  // namespace Prism::Tui
