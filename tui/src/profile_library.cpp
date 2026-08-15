#include "profile_library.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <fstream>
#include <iomanip>
#include <iterator>
#include <random>
#include <sstream>
#include <system_error>

namespace Prism::Tui {
namespace {

constexpr const char* kProfileFormat = "prism-tui-profile";
constexpr int kProfileVersion = 1;

std::string readFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) return {};
    return std::string(
        std::istreambuf_iterator<char>(input),
        std::istreambuf_iterator<char>());
}

std::string metadataValue(const std::string& text, const std::string& key) {
    std::istringstream input(text);
    std::string line;
    while (std::getline(input, line)) {
        const size_t separator = line.find('=');
        if (separator == std::string::npos || line.substr(0, separator) != key) {
            continue;
        }
        return line.substr(separator + 1);
    }
    return {};
}

std::string decodeQuoted(const std::string& value) {
    std::istringstream input(value);
    std::string decoded;
    if (input >> std::quoted(decoded)) return decoded;
    return value;
}

std::string trimName(std::string name) {
    name.erase(
        name.begin(),
        std::find_if(name.begin(), name.end(), [](unsigned char character) {
            return !std::isspace(character);
        }));
    name.erase(
        std::find_if(name.rbegin(), name.rend(), [](unsigned char character) {
            return !std::isspace(character);
        }).base(),
        name.end());
    name.erase(
        std::remove_if(name.begin(), name.end(), [](unsigned char character) {
            return character < 0x20 || character == 0x7f;
        }),
        name.end());
    if (name.size() > 64) name.resize(64);
    return name;
}

std::string lowercaseAscii(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return value;
}

bool validProfileId(const std::string& id) {
    return !id.empty() && id.size() <= 96 &&
        std::all_of(id.begin(), id.end(), [](unsigned char character) {
            return std::isalnum(character) || character == '_' || character == '-';
        });
}

std::string profileText(const TuiProfile& profile) {
    std::ostringstream output;
    output << "format=" << kProfileFormat << '\n'
           << "version=" << kProfileVersion << '\n'
           << "id=" << profile.id << '\n'
           << "name=" << std::quoted(profile.name) << '\n'
           << serializeSettingsText(profile.settings, false);
    return output.str();
}

bool writeFile(const std::filesystem::path& path,
               const std::string& text,
               std::string* error) {
    std::error_code filesystemError;
    if (!path.parent_path().empty()) {
        std::filesystem::create_directories(path.parent_path(), filesystemError);
        if (filesystemError) {
            if (error) *error = filesystemError.message();
            return false;
        }
    }
    std::filesystem::path temporary = path;
    temporary += ".tmp";
    {
        std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
        if (!output) {
            if (error) *error = "could not open temporary profile file";
            return false;
        }
        output << text;
        if (!output) {
            output.close();
            std::error_code ignored;
            std::filesystem::remove(temporary, ignored);
            if (error) *error = "could not write profile file";
            return false;
        }
    }
    std::filesystem::rename(temporary, path, filesystemError);
#if defined(_WIN32)
    if (filesystemError && std::filesystem::exists(path)) {
        filesystemError.clear();
        std::filesystem::remove(path, filesystemError);
        if (!filesystemError) {
            std::filesystem::rename(temporary, path, filesystemError);
        }
    }
#endif
    if (filesystemError) {
        std::error_code ignored;
        std::filesystem::remove(temporary, ignored);
        if (error) *error = filesystemError.message();
        return false;
    }
    return true;
}

std::optional<TuiProfile> parseProfile(const std::string& text,
                                       std::string* error) {
    if (metadataValue(text, "format") != kProfileFormat) {
        if (error) *error = "unsupported profile format";
        return std::nullopt;
    }
    if (metadataValue(text, "version") != std::to_string(kProfileVersion)) {
        if (error) *error = "unsupported profile version";
        return std::nullopt;
    }
    TuiProfile profile;
    profile.id = metadataValue(text, "id");
    profile.name = trimName(decodeQuoted(metadataValue(text, "name")));
    if (!validProfileId(profile.id) || profile.name.empty()) {
        if (error) *error = "profile metadata is invalid";
        return std::nullopt;
    }
    profile.settings = parseSettingsText(text);
    profile.isDefault = profile.id == kDefaultTuiProfileId;
    return profile;
}

std::string filenameStem(std::string name) {
    name = trimName(std::move(name));
    for (char& character : name) {
        const unsigned char byte = static_cast<unsigned char>(character);
        if (byte < 0x20 || character == '/' || character == '\\' ||
            character == ':' || character == '*' || character == '?' ||
            character == '"' || character == '<' || character == '>' ||
            character == '|') {
            character = '_';
        }
    }
    while (!name.empty() && (name.back() == ' ' || name.back() == '.')) {
        name.pop_back();
    }
    return name.empty() ? "Profile" : name;
}

std::string generateProfileId() {
    static std::mt19937_64 generator(std::random_device{}());
    const auto timestamp = std::chrono::high_resolution_clock::now()
        .time_since_epoch().count();
    std::ostringstream output;
    output << "profile_" << std::hex << timestamp << generator();
    return output.str();
}

}  // namespace

TuiProfileLibrary::TuiProfileLibrary(std::filesystem::path directory,
                                     std::filesystem::path statePath)
    : directory_(std::move(directory)), statePath_(std::move(statePath)) {}

bool TuiProfileLibrary::load(std::string* error) {
    std::error_code filesystemError;
    std::filesystem::create_directories(directory_, filesystemError);
    if (filesystemError) {
        if (error) *error = filesystemError.message();
        return false;
    }
    if (!reloadProfiles(error)) return false;
    if (!findManaged(kDefaultTuiProfileId)) {
        TuiProfile defaultProfile{
            kDefaultTuiProfileId,
            "Default",
            TuiSettings{},
            true,
        };
        const auto path = uniqueProfilePath(defaultProfile.name);
        if (!writeFile(path, profileText(defaultProfile), error)) return false;
        if (!reloadProfiles(error)) return false;
    }

    activeProfileId_ = metadataValue(readFile(statePath_), "active_profile_id");
    if (!activeProfileId_.empty() && !findManaged(activeProfileId_)) {
        activeProfileId_.clear();
    }
    publishProfiles();
    return true;
}

bool TuiProfileLibrary::reloadProfiles(std::string* error) {
    managed_.clear();
    std::error_code filesystemError;
    for (const auto& entry : std::filesystem::directory_iterator(
             directory_, filesystemError)) {
        if (filesystemError) break;
        if (!entry.is_regular_file() ||
            lowercaseAscii(entry.path().extension().string()) != kTuiProfileExtension) {
            continue;
        }
        std::string parseError;
        const auto parsed = parseProfile(readFile(entry.path()), &parseError);
        if (!parsed || findManaged(parsed->id)) continue;
        managed_.push_back({*parsed, entry.path()});
    }
    if (filesystemError) {
        if (error) *error = filesystemError.message();
        return false;
    }
    std::sort(managed_.begin(), managed_.end(), [](const auto& left, const auto& right) {
        if (left.profile.isDefault != right.profile.isDefault) {
            return left.profile.isDefault;
        }
        return lowercaseAscii(left.profile.name) < lowercaseAscii(right.profile.name);
    });
    publishProfiles();
    return true;
}

const TuiProfile* TuiProfileLibrary::find(const std::string& id) const {
    const auto* managed = findManaged(id);
    return managed ? &managed->profile : nullptr;
}

TuiProfileLibrary::ManagedProfile* TuiProfileLibrary::findManaged(
    const std::string& id) {
    const auto found = std::find_if(
        managed_.begin(), managed_.end(), [&](const auto& entry) {
            return entry.profile.id == id;
        });
    return found == managed_.end() ? nullptr : &*found;
}

const TuiProfileLibrary::ManagedProfile* TuiProfileLibrary::findManaged(
    const std::string& id) const {
    const auto found = std::find_if(
        managed_.begin(), managed_.end(), [&](const auto& entry) {
            return entry.profile.id == id;
        });
    return found == managed_.end() ? nullptr : &*found;
}

bool TuiProfileLibrary::writeActiveState(std::string* error) const {
    return writeFile(
        statePath_, "active_profile_id=" + activeProfileId_ + "\n", error);
}

bool TuiProfileLibrary::activate(const std::string& id, std::string* error) {
    if (!findManaged(id)) {
        if (error) *error = "profile was not found";
        return false;
    }
    activeProfileId_ = id;
    return writeActiveState(error);
}

bool TuiProfileLibrary::nameIsAvailable(
    const std::string& name,
    const std::string& excludingId) const {
    const std::string expected = lowercaseAscii(trimName(name));
    return std::none_of(managed_.begin(), managed_.end(), [&](const auto& entry) {
        return entry.profile.id != excludingId &&
            lowercaseAscii(entry.profile.name) == expected;
    });
}

std::filesystem::path TuiProfileLibrary::uniqueProfilePath(
    const std::string& name,
    const std::filesystem::path& current) const {
    const std::string stem = filenameStem(name);
    for (int suffix = 0; suffix < 10000; ++suffix) {
        const std::string filename = stem +
            (suffix == 0 ? "" : " " + std::to_string(suffix + 1)) +
            kTuiProfileExtension;
        const auto candidate = directory_ / filename;
        if (candidate == current || !std::filesystem::exists(candidate)) {
            return candidate;
        }
    }
    return directory_ / (generateProfileId() + kTuiProfileExtension);
}

bool TuiProfileLibrary::saveNew(const std::string& rawName,
                                const TuiSettings& settings,
                                std::string* createdId,
                                std::string* error) {
    const std::string name = trimName(rawName);
    if (name.empty()) {
        if (error) *error = "profile name cannot be empty";
        return false;
    }
    if (!nameIsAvailable(name)) {
        if (error) *error = "a profile with that name already exists";
        return false;
    }
    std::string id;
    do {
        id = generateProfileId();
    } while (findManaged(id));
    TuiProfile profile{id, name, normalizeSettings(settings), false};
    const auto path = uniqueProfilePath(name);
    if (!writeFile(path, profileText(profile), error)) return false;
    if (!reloadProfiles(error)) return false;
    activeProfileId_ = id;
    if (!writeActiveState(error)) return false;
    if (createdId) *createdId = id;
    return true;
}

bool TuiProfileLibrary::overwrite(const std::string& id,
                                  const TuiSettings& settings,
                                  std::string* error) {
    auto* entry = findManaged(id);
    if (!entry) {
        if (error) *error = "profile was not found";
        return false;
    }
    TuiProfile updated = entry->profile;
    updated.settings = normalizeSettings(settings);
    if (!writeFile(entry->path, profileText(updated), error)) return false;
    return reloadProfiles(error);
}

bool TuiProfileLibrary::renameProfile(const std::string& id,
                                      const std::string& rawName,
                                      std::string* error) {
    auto* entry = findManaged(id);
    if (!entry) {
        if (error) *error = "profile was not found";
        return false;
    }
    if (entry->profile.isDefault) {
        if (error) *error = "the default profile cannot be renamed";
        return false;
    }
    const std::string name = trimName(rawName);
    if (name.empty()) {
        if (error) *error = "profile name cannot be empty";
        return false;
    }
    if (!nameIsAvailable(name, id)) {
        if (error) *error = "a profile with that name already exists";
        return false;
    }
    const auto oldPath = entry->path;
    const auto nextPath = uniqueProfilePath(name, oldPath);
    TuiProfile updated = entry->profile;
    updated.name = name;
    if (!writeFile(nextPath, profileText(updated), error)) return false;
    if (nextPath != oldPath) {
        std::error_code filesystemError;
        std::filesystem::remove(oldPath, filesystemError);
        if (filesystemError) {
            if (error) *error = filesystemError.message();
            return false;
        }
    }
    return reloadProfiles(error);
}

bool TuiProfileLibrary::deleteProfile(const std::string& id,
                                      std::string* error) {
    auto* entry = findManaged(id);
    if (!entry) {
        if (error) *error = "profile was not found";
        return false;
    }
    if (entry->profile.isDefault) {
        if (error) *error = "the default profile cannot be deleted";
        return false;
    }
    std::error_code filesystemError;
    std::filesystem::remove(entry->path, filesystemError);
    if (filesystemError) {
        if (error) *error = filesystemError.message();
        return false;
    }
    if (activeProfileId_ == id) {
        activeProfileId_.clear();
        if (!writeActiveState(error)) return false;
    }
    return reloadProfiles(error);
}

void TuiProfileLibrary::publishProfiles() {
    profiles_.clear();
    profiles_.reserve(managed_.size());
    for (const auto& entry : managed_) profiles_.push_back(entry.profile);
}

std::filesystem::path defaultProfileDirectory() {
    return defaultSettingsPath().parent_path() / "tui-profiles";
}

std::filesystem::path defaultProfileStatePath() {
    return defaultSettingsPath().parent_path() / "tui-profile-state.conf";
}

bool profileSettingsEqual(const TuiSettings& left,
                          const TuiSettings& right) {
    TuiSettings normalizedLeft = normalizeSettings(left);
    TuiSettings normalizedRight = normalizeSettings(right);
    normalizedLeft.refreshRate = normalizedRight.refreshRate;
    normalizedLeft.terminalCompatibility =
        normalizedRight.terminalCompatibility;
    return normalizedLeft == normalizedRight;
}

TuiSettings applyProfileSettings(const TuiSettings& profile,
                                 const TuiSettings& working) {
    TuiSettings applied = normalizeSettings(profile);
    applied.refreshRate = normalizeSettings(working).refreshRate;
    applied.terminalCompatibility =
        normalizeSettings(working).terminalCompatibility;
    return applied;
}

}  // namespace Prism::Tui
