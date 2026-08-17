#pragma once

#include <array>
#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace Prism::Tui {

struct ThemeColor {
    uint8_t red = 0;
    uint8_t green = 0;
    uint8_t blue = 0;

    bool operator==(const ThemeColor& other) const {
        return red == other.red && green == other.green && blue == other.blue;
    }
};

struct TuiTheme {
    std::string id = "Default";
    std::string name = "Default";
    std::string credit;
    std::string description;

    ThemeColor background;
    ThemeColor accent;
    ThemeColor text;
    ThemeColor muted;
    ThemeColor border;
    ThemeColor selection;
    ThemeColor warning;
    ThemeColor danger;

    ThemeColor scopeGuides;
    ThemeColor scopeGuidesSecondary;

    ThemeColor spectrumBackground;
    ThemeColor spectrumLine;
    ThemeColor spectrumLabels;

    ThemeColor oscilloscopeBackground;
    ThemeColor oscilloscopeLine;
    ThemeColor oscilloscopeGuides;

    ThemeColor vectorscopeBackground;
    ThemeColor vectorscopeTrace;
    ThemeColor vectorscopeGuides;
    ThemeColor vectorscopeGuidesSecondary;
    std::array<ThemeColor, 3> vectorscopeBands{};

    ThemeColor spectrogramBackground;
    ThemeColor spectrogramMono;
    std::array<ThemeColor, 3> spectrogramHeat{};

    ThemeColor vuBackground;
    ThemeColor vuLevel;
    ThemeColor vuTrack;
    ThemeColor vuPeak;
    ThemeColor vuClip;
    ThemeColor vuScale;
    ThemeColor vuLabels;
    ThemeColor vuNeedleLeft;
    ThemeColor vuNeedleRight;
    ThemeColor vuNeedleCombined;

    ThemeColor lufsBackground;
    ThemeColor lufsLevel;
    ThemeColor lufsTrack;
    ThemeColor lufsTarget;
    ThemeColor lufsScale;
    ThemeColor lufsLabels;

    ThemeColor waveformBackground;
    ThemeColor waveformLine;
    ThemeColor waveformGuides;
    ThemeColor waveformGuidesSecondary;
    std::array<ThemeColor, 3> waveformBands{};
};

TuiTheme defaultTuiTheme();
bool parseIroThemeText(const std::string& content,
                       const std::string& fallbackName,
                       TuiTheme& theme,
                       std::string* error = nullptr);

class IroThemeLibrary {
public:
    explicit IroThemeLibrary(std::filesystem::path directory);

    bool load(std::string* warning = nullptr);
    const std::vector<TuiTheme>& themes() const { return themes_; }
    const TuiTheme* find(const std::string& id) const;
    const TuiTheme* findSelector(const std::string& nameOrId) const;
    const TuiTheme& resolve(const std::string& id) const;
    std::string adjacentId(const std::string& id, int direction) const;
    const std::filesystem::path& directory() const { return directory_; }

private:
    std::filesystem::path directory_;
    std::vector<TuiTheme> themes_;
};

std::filesystem::path defaultIroThemeDirectory();

}  // namespace Prism::Tui
