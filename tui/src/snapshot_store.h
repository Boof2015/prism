#pragma once

#include <mutex>
#include <utility>

namespace Prism::Tui {

template <typename T>
class SnapshotStore {
public:
    void publish(T next) {
        std::lock_guard<std::mutex> lock(mutex_);
        snapshot_ = std::move(next);
    }

    T read() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return snapshot_;
    }

private:
    mutable std::mutex mutex_;
    T snapshot_{};
};

}  // namespace Prism::Tui
