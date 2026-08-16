#include "tui_theme.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <optional>
#include <sstream>
#include <unordered_map>

#if defined(_WIN32)
#include <windows.h>
#include <knownfolders.h>
#include <shlobj.h>
#endif

namespace Prism::Tui {
namespace {

struct RgbaColor {
    float red = 0.0f;
    float green = 0.0f;
    float blue = 0.0f;
    float alpha = 1.0f;
};

using TokenMap = std::unordered_map<std::string, RgbaColor>;

std::string trim(std::string value) {
    const auto notSpace = [](unsigned char character) {
        return !std::isspace(character);
    };
    value.erase(value.begin(), std::find_if(value.begin(), value.end(), notSpace));
    value.erase(std::find_if(value.rbegin(), value.rend(), notSpace).base(), value.end());
    return value;
}

std::string normalizeKey(const std::string& value) {
    std::string result;
    bool separator = false;
    for (const unsigned char character : trim(value)) {
        if (std::isalnum(character)) {
            if (separator && !result.empty()) result.push_back('_');
            result.push_back(static_cast<char>(std::tolower(character)));
            separator = false;
        } else {
            separator = true;
        }
    }
    return result;
}

float clampByte(float value) {
    return std::clamp(value, 0.0f, 255.0f);
}

std::optional<float> parseNumber(const std::string& token) {
    try {
        size_t consumed = 0;
        const float value = std::stof(trim(token), &consumed);
        if (consumed != trim(token).size() || !std::isfinite(value)) {
            return std::nullopt;
        }
        return value;
    } catch (...) {
        return std::nullopt;
    }
}

std::vector<std::string> split(const std::string& value, char separator) {
    std::vector<std::string> parts;
    std::istringstream input(value);
    std::string part;
    while (std::getline(input, part, separator)) parts.push_back(trim(part));
    return parts;
}

std::optional<RgbaColor> parseHexColor(const std::string& value) {
    if (value.empty() || value.front() != '#') return std::nullopt;
    std::string digits = value.substr(1);
    if (digits.size() == 3 || digits.size() == 4) {
        std::string expanded;
        for (const char digit : digits) {
            expanded.push_back(digit);
            expanded.push_back(digit);
        }
        digits = expanded;
    }
    if (digits.size() != 6 && digits.size() != 8) return std::nullopt;
    try {
        const auto channel = [&](size_t offset) {
            return static_cast<float>(std::stoul(digits.substr(offset, 2), nullptr, 16));
        };
        return RgbaColor{
            channel(0), channel(2), channel(4),
            digits.size() == 8 ? channel(6) / 255.0f : 1.0f};
    } catch (...) {
        return std::nullopt;
    }
}

std::optional<RgbaColor> parseFunctionColor(const std::string& value) {
    const std::string normalized = normalizeKey(
        value.substr(0, value.find('(')));
    if (normalized != "rgb" && normalized != "rgba") return std::nullopt;
    const size_t open = value.find('(');
    const size_t close = value.rfind(')');
    if (open == std::string::npos || close == std::string::npos || close <= open) {
        return std::nullopt;
    }
    const auto parts = split(value.substr(open + 1, close - open - 1), ',');
    if (parts.size() != 3 && parts.size() != 4) return std::nullopt;
    const auto red = parseNumber(parts[0]);
    const auto green = parseNumber(parts[1]);
    const auto blue = parseNumber(parts[2]);
    if (!red || !green || !blue) return std::nullopt;
    float alpha = 1.0f;
    if (parts.size() == 4) {
        const auto parsedAlpha = parseNumber(parts[3]);
        if (!parsedAlpha) return std::nullopt;
        alpha = *parsedAlpha > 1.0f ? *parsedAlpha / 255.0f : *parsedAlpha;
    }
    return RgbaColor{
        clampByte(*red), clampByte(*green), clampByte(*blue),
        std::clamp(alpha, 0.0f, 1.0f)};
}

std::optional<RgbaColor> parseChannelColor(const std::string& value) {
    const auto parts = split(value, ',');
    if (parts.size() != 3 && parts.size() != 4) return std::nullopt;
    const auto red = parseNumber(parts[0]);
    const auto green = parseNumber(parts[1]);
    const auto blue = parseNumber(parts[2]);
    if (!red || !green || !blue) return std::nullopt;
    float alpha = 1.0f;
    if (parts.size() == 4) {
        const auto parsedAlpha = parseNumber(parts[3]);
        if (!parsedAlpha) return std::nullopt;
        alpha = *parsedAlpha / 255.0f;
    }
    return RgbaColor{
        clampByte(*red), clampByte(*green), clampByte(*blue),
        std::clamp(alpha, 0.0f, 1.0f)};
}

std::optional<RgbaColor> parseColor(const std::string& rawValue) {
    const std::string value = trim(rawValue);
    if (const auto color = parseHexColor(value)) return color;
    if (const auto color = parseFunctionColor(value)) return color;
    return parseChannelColor(value);
}

RgbaColor rgba(float red, float green, float blue, float alpha = 1.0f) {
    return {red, green, blue, alpha};
}

RgbaColor withAlpha(RgbaColor color, float alpha) {
    color.alpha = std::clamp(alpha, 0.0f, 1.0f);
    return color;
}

RgbaColor multiplyAlpha(RgbaColor color, float multiplier) {
    color.alpha = std::clamp(color.alpha * multiplier, 0.0f, 1.0f);
    return color;
}

ThemeColor flatten(RgbaColor foreground, ThemeColor background) {
    const float alpha = std::clamp(foreground.alpha, 0.0f, 1.0f);
    const auto channel = [&](float value, uint8_t base) {
        return static_cast<uint8_t>(std::lround(std::clamp(
            value * alpha + static_cast<float>(base) * (1.0f - alpha),
            0.0f,
            255.0f)));
    };
    return {
        channel(foreground.red, background.red),
        channel(foreground.green, background.green),
        channel(foreground.blue, background.blue)};
}

RgbaColor colorOr(const TokenMap& tokens,
                  const std::string& section,
                  const std::string& key,
                  RgbaColor fallback) {
    const auto found = tokens.find(section + "." + key);
    return found == tokens.end() ? fallback : found->second;
}

bool hasExtensionIro(const std::filesystem::path& path) {
    std::string extension = path.extension().string();
    std::transform(extension.begin(), extension.end(), extension.begin(),
        [](unsigned char character) {
            return static_cast<char>(std::tolower(character));
        });
    return extension == ".iro";
}

std::string environmentValue(const char* name) {
    const char* value = std::getenv(name);
    return value == nullptr ? std::string{} : std::string(value);
}

}  // namespace

TuiTheme defaultTuiTheme() {
    TuiTheme theme;
    const std::string content = R"iro(
[Theme]
format = prism-theme
version = 2
credit = Prism

[App]
accent = 56, 189, 248
success = 34, 197, 94
warning = 255, 191, 0
danger = 248, 113, 113
background = 0, 0, 0
border = 255, 255, 255, 23
text = 255, 255, 255
text_muted = 255, 255, 255, 107

[Scopes]
guides = 255, 255, 255, 26

[Vectorscope]
band_low = 255, 68, 68
band_mid = 68, 221, 68
band_high = 68, 136, 255

[Spectrogram]
heat_low = 15, 7, 33
heat_mid = 163, 26, 121
heat_high = 255, 241, 209

[VUMeter]
peak = 255, 127, 0
clip = 255, 120, 80, 230
needle_left = 199, 223, 255
needle_right = 255, 71, 126
needle_combined = 244, 248, 255

[Waveform]
band_low = 255, 68, 68
band_mid = 68, 221, 68
band_high = 68, 136, 255
)iro";
    std::string ignored;
    parseIroThemeText(content, "Default", theme, &ignored);
    return theme;
}

namespace {

struct BundledThemeSource {
    const char* name;
    const char* content;
};

std::vector<TuiTheme> bundledTuiThemes() {
    static constexpr std::array<BundledThemeSource, 5> sources = {{
        {"Alpha Centauri", R"iro(
[Theme]
format = prism-theme
version = 2
credit = MxnGxzr
description = It exists

[App]
accent = 0, 50, 220
background = 255, 255, 255
border = 255, 255, 255, 23
text = 0, 0, 0
text_muted = 0, 0, 0, 200

[Scopes]
background = 255, 255, 255
guides = 0, 0, 0, 170

[Spectrum]
background = 255, 255, 255
line = 0, 50, 220
guides = 0, 0, 0, 40
labels = 0, 0, 0, 40

[Oscilloscope]
line = 0, 50, 220
guides = 0, 0, 0, 40

[Vectorscope]
band_low = 0, 50, 180
band_mid = 11, 180, 140
band_high = 200, 50, 180
guides = 0, 0, 0, 70

[Spectrogram]
background = 255, 255, 255, 0
mono = 255, 105, 180
heat_low = 15, 30, 240
heat_mid = 15, 30, 240
heat_high = 255, 105, 180

[VUMeter]
peak = 240, 30, 180
scale = 0, 0, 0, 100
labels = 0, 0, 0, 120

[LUFSMeter]
level = 0, 50, 220
track = 0, 50, 220, 20
target = 0, 50, 220, 120
scale = 0, 0, 0, 200
labels = 0, 0, 0, 225

[Waveform]
line = 0, 0, 0, 120
band_low = 0, 50, 180
band_mid = 70, 160, 240
band_high = 255, 105, 180
guides = 0, 0, 0, 120
)iro"},
        {"Chroma Blue", R"iro(
[Theme]
format = prism-theme
version = 2
credit = Prism
description = Chroma key for transparent overlays

[App]
accent = 56, 140, 255
background = 8, 8, 14
border = 180, 200, 240, 23
text = 255, 255, 255
text_muted = 160, 180, 220
warning = 255, 210, 0
danger = 255, 75, 75

[Scopes]
background = 0, 0, 255
guides = 0, 0, 255

[Spectrum]
background = 0, 0, 255
line = 255, 255, 255
guides = 0, 0, 255
labels = 0, 0, 255

[Oscilloscope]
background = 0, 0, 255
line = 255, 255, 255
guides = 0, 0, 255

[Vectorscope]
background = 0, 0, 255
trace = 255, 255, 255
band_low = 255, 255, 255, 120
band_mid = 255, 255, 255, 120
band_high = 255, 255, 255, 120
guides = 0, 0, 255

[Spectrogram]
background = 0, 0, 255
mono = 255, 255, 255
heat_low = 0, 0, 255, 255
heat_high = 255, 255, 255, 255

[VUMeter]
background = 0, 0, 255
level = 255, 255, 255
track = 255, 255, 255, 255
peak = 255, 220, 0
clip = 255, 75, 75, 255
scale = 0, 0, 255
labels = 0, 0, 255

[LUFSMeter]
background = 0, 0, 255
level = 255, 255, 255
track = 255, 255, 255, 255
target = 255, 255, 255, 255
scale = 0, 0, 255
labels = 0, 0, 255

[Waveform]
background = 0, 0, 255
line = 255, 255, 255
band_low = 255, 255, 255, 120
band_mid = 255, 255, 255, 120
band_high = 255, 255, 255, 120
guides = 0, 0, 255
)iro"},
        {"Chroma Green", R"iro(
[Theme]
format = prism-theme
version = 2
credit = Prism
description = Chroma key for transparent overlays

[App]
accent = 0, 230, 80
background = 8, 12, 8
border = 200, 240, 200, 23
text = 255, 255, 255
text_muted = 160, 210, 160
warning = 255, 210, 0
danger = 255, 75, 75

[Scopes]
background = 0, 255, 0
guides = 0, 255, 0

[Spectrum]
background = 0, 255, 0
line = 255, 255, 255
guides = 0, 255, 0
labels = 0, 255, 0

[Oscilloscope]
background = 0, 255, 0
line = 255, 255, 255
guides = 0, 255, 0

[Vectorscope]
background = 0, 255, 0
trace = 255, 255, 255
band_low = 255, 255, 255, 120
band_mid = 255, 255, 255, 120
band_high = 255, 255, 255, 120
guides = 0, 255, 0

[Spectrogram]
background = 0, 255, 0
mono = 255, 255, 255
heat_low = 0, 255, 0, 255
heat_high = 255, 255, 255, 255

[VUMeter]
background = 0, 255, 0
level = 255, 255, 255
track = 255, 255, 255, 28
peak = 255, 220, 0
clip = 255, 75, 75, 230
scale = 0, 255, 0
labels = 0, 255, 0

[LUFSMeter]
background = 0, 255, 0
level = 255, 255, 255
track = 255, 255, 255, 28
target = 255, 255, 255, 75
scale = 0, 255, 0
labels = 0, 255, 0

[Waveform]
background = 0, 255, 0
line = 255, 255, 255
band_low = 255, 255, 255, 120
band_mid = 255, 255, 255, 120
band_high = 255, 255, 255, 120
guides = 0, 255, 0
)iro"},
        {"Redshift", R"iro(
[Theme]
format = prism-theme
version = 2
credit = Boof2015
description = A very red theme

[App]
accent = 230, 0, 69
background = 15, 15, 15
text = 255, 255, 255
text_muted = 172, 192, 222
warning = 230, 0, 69
danger = 230, 0, 69

[Scopes]
background = 15, 15, 15
guides = 59, 64, 71

[Spectrum]
line = 255, 255, 255
guides = 56, 58, 61
labels = 56, 58, 61

[Oscilloscope]
background = 15, 15, 15
line = 230, 0, 69
guides = 56, 58, 61

[Vectorscope]
background = 15, 15, 15
trace = 230, 0, 69
band_low = 230, 0, 69
band_mid = 102, 90, 255
band_high = 0, 255, 255
guides = 56, 58, 61

[Spectrogram]
mono = 230, 0, 69
heat_low = 180, 20, 40, 200
heat_mid = 220, 0, 55, 250
heat_high = 255, 200, 200

[VUMeter]
background = 15, 15, 15
level = 153, 0, 53
track = 153, 0, 53, 20
peak = 230, 0, 69
clip = 255, 0, 0, 230
scale = 86, 96, 111
labels = 86, 96, 111

[LUFSMeter]
background = 15, 15, 15
level = 230, 0, 69
track = 230, 0, 69, 20
target = 230, 0, 69, 64
scale = 86, 96, 111
labels = 86, 96, 111

[Waveform]
background = 15, 15, 15
line = 230, 0, 69
band_low = 230, 0, 69
band_mid = 102, 90, 255
band_high = 0, 255, 255
guides = 86, 96, 111
)iro"},
        {"Stanky Leg", R"iro(
[Theme]
format = prism-theme
version = 2
credit = MrAlibi
description = I tripped, and now my leg turned too stanky

[App]
accent = 69, 20, 184
background = 0, 0, 0
border = 255, 255, 255, 23
text = 255, 255, 255

[Scopes]
guides = 255, 255, 255, 26

[Vectorscope]
band_low = 177, 105, 219
band_mid = 108, 31, 196
band_high = 69, 20, 184

[Spectrogram]
mono = 86, 25, 230
heat_low = 86, 25, 230
heat_mid = 177, 105, 219
heat_high = 177, 105, 219

[Waveform]
line = 86, 25, 230
band_low = 177, 105, 219
band_mid = 108, 31, 196
band_high = 69, 20, 184
)iro"},
    }};

    std::vector<TuiTheme> themes;
    themes.reserve(sources.size() + 1);
    themes.push_back(defaultTuiTheme());
    for (const auto& source : sources) {
        TuiTheme parsed;
        std::string ignored;
        if (parseIroThemeText(source.content, source.name, parsed, &ignored)) {
            themes.push_back(std::move(parsed));
        }
    }
    return themes;
}

}  // namespace

bool parseIroThemeText(const std::string& content,
                       const std::string& fallbackName,
                       TuiTheme& theme,
                       std::string* error) {
    TokenMap tokens;
    std::string section;
    std::string credit;
    std::string description;
    bool formatSeen = false;
    bool versionSeen = false;

    std::istringstream input(content);
    std::string rawLine;
    size_t lineNumber = 0;
    while (std::getline(input, rawLine)) {
        ++lineNumber;
        const std::string line = trim(rawLine);
        if (line.empty() || line.front() == '#' || line.front() == ';') continue;
        if (line.front() == '[' && line.back() == ']') {
            section = normalizeKey(line.substr(1, line.size() - 2));
            continue;
        }
        const size_t separator = line.find('=');
        if (separator == std::string::npos || section.empty()) continue;
        const std::string key = normalizeKey(line.substr(0, separator));
        const std::string value = trim(line.substr(separator + 1));
        if (section == "theme") {
            if (key == "format") {
                formatSeen = true;
                if (value != "prism-theme") {
                    if (error) *error = "unsupported theme format at line " +
                        std::to_string(lineNumber);
                    return false;
                }
            } else if (key == "version") {
                versionSeen = true;
                if (value != "2") {
                    if (error) *error = "unsupported theme version at line " +
                        std::to_string(lineNumber);
                    return false;
                }
            } else if (key == "credit") {
                credit = value;
            } else if (key == "description") {
                description = value;
            }
            continue;
        }
        if (const auto parsed = parseColor(value)) {
            tokens[section + "." + key] = *parsed;
        }
    }
    (void)formatSeen;
    (void)versionSeen;

    const RgbaColor appBackground = colorOr(
        tokens, "app", "background", rgba(0, 0, 0));
    const ThemeColor background = flatten(appBackground, {0, 0, 0});
    const RgbaColor accentRaw = colorOr(
        tokens, "app", "accent", rgba(56, 189, 248));
    const RgbaColor textRaw = colorOr(
        tokens, "app", "text", rgba(255, 255, 255));
    const RgbaColor mutedRaw = colorOr(
        tokens, "app", "text_muted", withAlpha(textRaw, 0.42f));
    const RgbaColor borderRaw = colorOr(
        tokens, "app", "border", rgba(255, 255, 255, 0.09f));
    const RgbaColor guidesRaw = colorOr(
        tokens, "scopes", "guides", rgba(255, 255, 255, 0.10f));
    const RgbaColor scopeBackgroundRaw = colorOr(
        tokens, "scopes", "background", appBackground);
    const ThemeColor scopeBackground = flatten(scopeBackgroundRaw, background);

    theme = {};
    theme.id = fallbackName.empty() ? "Default" : fallbackName;
    theme.name = theme.id;
    theme.credit = credit;
    theme.description = description;
    theme.background = background;
    theme.accent = flatten(accentRaw, background);
    theme.text = flatten(textRaw, background);
    theme.muted = flatten(mutedRaw, background);
    theme.border = flatten(borderRaw, background);
    theme.selection = flatten(withAlpha(accentRaw, 0.18f), background);
    theme.warning = flatten(colorOr(
        tokens, "app", "warning", rgba(255, 191, 0)), background);
    theme.danger = flatten(colorOr(
        tokens, "app", "danger", rgba(248, 113, 113)), background);
    theme.scopeGuides = flatten(guidesRaw, scopeBackground);
    theme.scopeGuidesSecondary = flatten(multiplyAlpha(guidesRaw, 0.5f), scopeBackground);

    const auto resolveBackground = [&](const std::string& sectionName) {
        return flatten(colorOr(
            tokens, sectionName, "background", scopeBackgroundRaw), background);
    };
    theme.spectrumBackground = resolveBackground("spectrum");
    const RgbaColor spectrumLineRaw = colorOr(
        tokens, "spectrum", "line", accentRaw);
    theme.spectrumLine = flatten(spectrumLineRaw, theme.spectrumBackground);
    theme.spectrumLabels = flatten(colorOr(
        tokens, "spectrum", "labels", colorOr(
            tokens, "spectrum", "guides", guidesRaw)), theme.spectrumBackground);

    theme.oscilloscopeBackground = resolveBackground("oscilloscope");
    theme.oscilloscopeLine = flatten(colorOr(
        tokens, "oscilloscope", "line", accentRaw), theme.oscilloscopeBackground);
    theme.oscilloscopeGuides = flatten(colorOr(
        tokens, "oscilloscope", "guides", guidesRaw), theme.oscilloscopeBackground);

    theme.vectorscopeBackground = resolveBackground("vectorscope");
    theme.vectorscopeTrace = flatten(colorOr(
        tokens, "vectorscope", "trace", accentRaw), theme.vectorscopeBackground);
    const RgbaColor vectorGuidesRaw = colorOr(
        tokens, "vectorscope", "guides", guidesRaw);
    theme.vectorscopeGuides = flatten(vectorGuidesRaw, theme.vectorscopeBackground);
    theme.vectorscopeGuidesSecondary = flatten(
        multiplyAlpha(vectorGuidesRaw, 0.5f), theme.vectorscopeBackground);
    theme.vectorscopeBands = {{
        flatten(colorOr(tokens, "vectorscope", "band_low", rgba(255, 68, 68)), theme.vectorscopeBackground),
        flatten(colorOr(tokens, "vectorscope", "band_mid", rgba(68, 221, 68)), theme.vectorscopeBackground),
        flatten(colorOr(tokens, "vectorscope", "band_high", rgba(68, 136, 255)), theme.vectorscopeBackground),
    }};

    theme.spectrogramBackground = resolveBackground("spectrogram");
    theme.spectrogramMono = flatten(colorOr(
        tokens, "spectrogram", "mono", accentRaw), theme.spectrogramBackground);
    theme.spectrogramHeat = {{
        flatten(colorOr(tokens, "spectrogram", "heat_low", rgba(15, 7, 33)), theme.spectrogramBackground),
        flatten(colorOr(tokens, "spectrogram", "heat_mid", rgba(163, 26, 121)), theme.spectrogramBackground),
        flatten(colorOr(tokens, "spectrogram", "heat_high", rgba(255, 241, 209)), theme.spectrogramBackground),
    }};

    theme.vuBackground = resolveBackground("vumeter");
    const RgbaColor vuLevelRaw = colorOr(tokens, "vumeter", "level", accentRaw);
    const RgbaColor vuPeakRaw = colorOr(tokens, "vumeter", "peak", rgba(255, 127, 0));
    theme.vuLevel = flatten(vuLevelRaw, theme.vuBackground);
    theme.vuTrack = flatten(colorOr(
        tokens, "vumeter", "track", withAlpha(vuLevelRaw, 0.08f)), theme.vuBackground);
    theme.vuPeak = flatten(vuPeakRaw, theme.vuBackground);
    theme.vuClip = flatten(colorOr(
        tokens, "vumeter", "clip", rgba(255, 120, 80, 0.9f)), theme.vuBackground);
    theme.vuScale = flatten(colorOr(
        tokens, "vumeter", "scale", guidesRaw), theme.vuBackground);
    theme.vuLabels = flatten(colorOr(
        tokens, "vumeter", "labels", mutedRaw), theme.vuBackground);
    theme.vuNeedleLeft = flatten(colorOr(
        tokens, "vumeter", "needle_left", vuLevelRaw), theme.vuBackground);
    theme.vuNeedleRight = flatten(colorOr(
        tokens, "vumeter", "needle_right", vuPeakRaw), theme.vuBackground);
    theme.vuNeedleCombined = flatten(colorOr(
        tokens, "vumeter", "needle_combined", vuLevelRaw), theme.vuBackground);

    theme.lufsBackground = resolveBackground("lufsmeter");
    const RgbaColor lufsLevelRaw = colorOr(tokens, "lufsmeter", "level", accentRaw);
    theme.lufsLevel = flatten(lufsLevelRaw, theme.lufsBackground);
    theme.lufsTrack = flatten(colorOr(
        tokens, "lufsmeter", "track", withAlpha(lufsLevelRaw, 0.08f)), theme.lufsBackground);
    theme.lufsTarget = flatten(colorOr(
        tokens, "lufsmeter", "target", withAlpha(lufsLevelRaw, 0.25f)), theme.lufsBackground);
    theme.lufsScale = flatten(colorOr(
        tokens, "lufsmeter", "scale", guidesRaw), theme.lufsBackground);
    theme.lufsLabels = flatten(colorOr(
        tokens, "lufsmeter", "labels", mutedRaw), theme.lufsBackground);

    theme.waveformBackground = resolveBackground("waveform");
    theme.waveformLine = flatten(colorOr(
        tokens, "waveform", "line", accentRaw), theme.waveformBackground);
    const RgbaColor waveformGuidesRaw = colorOr(
        tokens, "waveform", "guides", guidesRaw);
    theme.waveformGuides = flatten(waveformGuidesRaw, theme.waveformBackground);
    theme.waveformGuidesSecondary = flatten(
        multiplyAlpha(waveformGuidesRaw, 0.5f), theme.waveformBackground);
    theme.waveformBands = {{
        flatten(colorOr(tokens, "waveform", "band_low", rgba(255, 68, 68)), theme.waveformBackground),
        flatten(colorOr(tokens, "waveform", "band_mid", rgba(68, 221, 68)), theme.waveformBackground),
        flatten(colorOr(tokens, "waveform", "band_high", rgba(68, 136, 255)), theme.waveformBackground),
    }};
    return true;
}

IroThemeLibrary::IroThemeLibrary(std::filesystem::path directory)
    : directory_(std::move(directory)) {}

bool IroThemeLibrary::load(std::string* warning) {
    themes_ = bundledTuiThemes();
    std::error_code filesystemError;
    if (!std::filesystem::exists(directory_, filesystemError)) return true;
    if (filesystemError || !std::filesystem::is_directory(directory_, filesystemError)) {
        if (warning) *warning = "Could not read Prism Themes at " + directory_.string();
        return false;
    }

    std::vector<std::filesystem::path> paths;
    for (const auto& entry : std::filesystem::directory_iterator(directory_, filesystemError)) {
        if (filesystemError) break;
        const std::string filename = entry.path().filename().string();
        if (entry.is_regular_file() && !filename.empty() && filename.front() != '_' &&
            hasExtensionIro(entry.path())) {
            paths.push_back(entry.path());
        }
    }
    std::sort(paths.begin(), paths.end());
    std::vector<std::string> skipped;
    for (const auto& path : paths) {
        std::ifstream input(path);
        if (!input) {
            skipped.push_back(path.filename().string());
            continue;
        }
        const std::string content{
            std::istreambuf_iterator<char>(input),
            std::istreambuf_iterator<char>()};
        TuiTheme parsed;
        std::string parseError;
        if (!parseIroThemeText(content, path.stem().string(), parsed, &parseError)) {
            skipped.push_back(path.filename().string());
            continue;
        }
        const auto existing = std::find_if(
            themes_.begin(), themes_.end(), [&](const TuiTheme& candidate) {
                return candidate.id == parsed.id;
            });
        if (existing == themes_.end()) {
            themes_.push_back(std::move(parsed));
        } else {
            *existing = std::move(parsed);
        }
    }
    std::stable_sort(themes_.begin(), themes_.end(), [](const auto& left, const auto& right) {
        if (left.id == "Default") return right.id != "Default";
        if (right.id == "Default") return false;
        return left.name < right.name;
    });
    if (warning && !skipped.empty()) {
        *warning = "Skipped " + std::to_string(skipped.size()) + " invalid .iro theme" +
            (skipped.size() == 1 ? "" : "s");
    }
    return true;
}

const TuiTheme* IroThemeLibrary::find(const std::string& id) const {
    const auto found = std::find_if(
        themes_.begin(), themes_.end(), [&](const TuiTheme& theme) {
            return theme.id == id;
        });
    return found == themes_.end() ? nullptr : &*found;
}

const TuiTheme* IroThemeLibrary::findSelector(
    const std::string& nameOrId) const {
    if (const auto* exactId = find(nameOrId)) return exactId;
    const auto exactName = std::find_if(
        themes_.begin(), themes_.end(), [&](const TuiTheme& theme) {
            return theme.name == nameOrId;
        });
    if (exactName != themes_.end()) return &*exactName;

    const std::string expected = normalizeKey(nameOrId);
    const auto insensitive = std::find_if(
        themes_.begin(), themes_.end(), [&](const TuiTheme& theme) {
            return normalizeKey(theme.id) == expected ||
                normalizeKey(theme.name) == expected;
        });
    return insensitive == themes_.end() ? nullptr : &*insensitive;
}

const TuiTheme& IroThemeLibrary::resolve(const std::string& id) const {
    if (const auto* theme = find(id)) return *theme;
    if (!themes_.empty()) return themes_.front();
    static const TuiTheme fallback = defaultTuiTheme();
    return fallback;
}

std::string IroThemeLibrary::adjacentId(const std::string& id, int direction) const {
    if (themes_.empty()) return "Default";
    const auto found = std::find_if(
        themes_.begin(), themes_.end(), [&](const TuiTheme& theme) {
            return theme.id == id;
        });
    const int current = found == themes_.end()
        ? 0
        : static_cast<int>(std::distance(themes_.begin(), found));
    const int count = static_cast<int>(themes_.size());
    return themes_[static_cast<size_t>(
        (current + (direction < 0 ? -1 : 1) + count) % count)].id;
}

std::filesystem::path defaultIroThemeDirectory() {
#if defined(_WIN32)
    PWSTR documents = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(
            FOLDERID_Documents, KF_FLAG_DEFAULT, nullptr, &documents)) &&
        documents != nullptr) {
        const std::filesystem::path path(documents);
        CoTaskMemFree(documents);
        return path / "Prism Themes";
    }
    const std::string userProfile = environmentValue("USERPROFILE");
    if (!userProfile.empty()) {
        return std::filesystem::path(userProfile) / "Documents" / "Prism Themes";
    }
#else
    const std::string home = environmentValue("HOME");
    if (!home.empty()) {
        return std::filesystem::path(home) / "Documents" / "Prism Themes";
    }
#endif
    return std::filesystem::path("Prism Themes");
}

}  // namespace Prism::Tui
