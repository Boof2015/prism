#pragma once
#include <juce_core/juce_core.h>
#include "reference_analysis.h"
#include <thread>
#include <mutex>
#include <atomic>
#include <memory>

juce::var normalizeSpectrumReference(const juce::var& reference);

/** Processor-owned jobs. Workers touch only their own state, never an editor or audio callback. */
class ReferenceTrackManager {
public:
    ReferenceTrackManager() = default;
    ~ReferenceTrackManager();
    void start(const juce::File& file, const juce::String& name = {}, bool temporary = false);
    void cancel();
    juce::var snapshot() const;
    juce::var takeCompletedAsset();
    uint64_t revision() const { return workerRevision->load(); }
    uint64_t generation() const { return ownerGeneration.load(); }
    juce::String beginUpload(const juce::String& name, int64_t bytes);
    void appendUpload(const juce::String& id, int64_t offset, const juce::String& base64);
    void finishUpload(const juce::String& id);
    void cancelUpload(const juce::String& id);
    juce::String activeUploadId() const;
private:
    mutable std::recursive_mutex ownerMutex;
    std::atomic<uint64_t> ownerGeneration { 0 };
    struct Job {
        std::atomic<bool> cancelled { false }, done { false };
        mutable std::mutex mutex;
        juce::var state;
        bool committed = false;
        std::shared_ptr<std::atomic<uint64_t>> revision;
    };
    struct Worker { std::shared_ptr<Job> job; std::thread thread; };
    std::vector<Worker> workers;
    std::shared_ptr<Job> current;
    std::shared_ptr<std::atomic<uint64_t>> workerRevision = std::make_shared<std::atomic<uint64_t>>(0);
    juce::File uploadFile;
    std::unique_ptr<juce::FileOutputStream> uploadStream;
    juce::String uploadName, uploadId;
    int64_t uploadSize = 0, uploadWritten = 0;
    juce::var uploadState;
    void cleanUpload();
};
