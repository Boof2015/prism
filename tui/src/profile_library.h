#pragma once

#include "tui_settings.h"

#include <filesystem>
#include <string>
#include <vector>

namespace Prism::Tui {

constexpr const char* kTuiProfileExtension = ".prsmt";
constexpr const char* kDefaultTuiProfileId = "profile_default";

struct TuiProfile {
    std::string id;
    std::string name;
    TuiSettings settings;
    bool isDefault = false;
};

class TuiProfileLibrary {
public:
    TuiProfileLibrary(std::filesystem::path directory,
                      std::filesystem::path statePath);

    bool load(std::string* error = nullptr);
    const std::vector<TuiProfile>& profiles() const { return profiles_; }
    const std::string& activeProfileId() const { return activeProfileId_; }
    const TuiProfile* find(const std::string& id) const;
    const TuiProfile* findSelector(const std::string& nameOrId) const;

    bool activate(const std::string& id, std::string* error = nullptr);
    bool selectForSession(const std::string& id,
                          std::string* error = nullptr);
    bool saveNew(const std::string& name,
                 const TuiSettings& settings,
                 std::string* createdId = nullptr,
                 std::string* error = nullptr);
    bool overwrite(const std::string& id,
                   const TuiSettings& settings,
                   std::string* error = nullptr);
    bool renameProfile(const std::string& id,
                       const std::string& name,
                       std::string* error = nullptr);
    bool deleteProfile(const std::string& id,
                       std::string* error = nullptr);

private:
    struct ManagedProfile {
        TuiProfile profile;
        std::filesystem::path path;
    };

    bool reloadProfiles(std::string* error);
    bool writeActiveState(std::string* error) const;
    ManagedProfile* findManaged(const std::string& id);
    const ManagedProfile* findManaged(const std::string& id) const;
    bool nameIsAvailable(const std::string& name,
                         const std::string& excludingId = {}) const;
    std::filesystem::path uniqueProfilePath(
        const std::string& name,
        const std::filesystem::path& current = {}) const;
    void publishProfiles();

    std::filesystem::path directory_;
    std::filesystem::path statePath_;
    std::vector<ManagedProfile> managed_;
    std::vector<TuiProfile> profiles_;
    std::string activeProfileId_;
};

std::filesystem::path defaultProfileDirectory();
std::filesystem::path defaultProfileStatePath();
bool profileSettingsEqual(const TuiSettings& left,
                          const TuiSettings& right);
TuiSettings applyProfileSettings(const TuiSettings& profile,
                                 const TuiSettings& working);

}  // namespace Prism::Tui
