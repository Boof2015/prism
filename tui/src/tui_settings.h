#pragma once

#include "dashboard_layout.h"
#include "scope_plot_model.h"

#include <filesystem>
#include <string>
#include <vector>

namespace Prism::Tui {

enum class SettingsPage {
    Home,
    General,
    Spectrum,
    Oscilloscope,
    Vectorscope,
};

enum class SettingId {
    InputTrim,
    RefreshRate,
    Layout,
    SpectrumPeakReadout,
    SpectrumTilt,
    OscilloscopePitchLock,
    OscilloscopeFrequencyReadout,
    OscilloscopeTraceWeight,
    VectorscopeMode,
    VectorscopeGuides,
    VectorscopeDetail,
};

enum class VectorscopeDetail {
    Balanced,
    Detailed,
    Maximum,
};

struct TuiSettings {
    float inputTrimDb = 0.0f;
    int refreshRate = 60;
    LayoutPreset layoutPreset = LayoutPreset::Automatic;
    bool spectrumPeakReadout = true;
    float spectrumTiltDbPerOctave = 2.0f;
    bool oscilloscopePitchLock = true;
    bool oscilloscopeFrequencyReadout = true;
    int oscilloscopeTraceWeight = 2;
    VectorscopeMode vectorscopeMode = VectorscopeMode::Lissajous;
    bool vectorscopeGuides = true;
    VectorscopeDetail vectorscopeDetail = VectorscopeDetail::Detailed;
};

struct SettingDescriptor {
    SettingId id;
    const char* name;
    const char* description;
};

TuiSettings normalizeSettings(TuiSettings settings);
bool operator==(const TuiSettings& left, const TuiSettings& right);
bool operator!=(const TuiSettings& left, const TuiSettings& right);

std::vector<SettingsPage> settingsPages();
const char* settingsPageName(SettingsPage page);
const char* settingsPageDescription(SettingsPage page);
const std::vector<SettingDescriptor>& settingsForPage(SettingsPage page);

std::string settingValue(const TuiSettings& settings, SettingId setting);
bool settingIsBoolean(SettingId setting);
bool adjustSetting(TuiSettings& settings, SettingId setting, int direction);
bool resetSetting(TuiSettings& settings, SettingId setting);

std::filesystem::path defaultSettingsPath();
TuiSettings loadSettings(const std::filesystem::path& path);
bool saveSettings(const TuiSettings& settings,
                  const std::filesystem::path& path,
                  std::string* error = nullptr);

}  // namespace Prism::Tui
