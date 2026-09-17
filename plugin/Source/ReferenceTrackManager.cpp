#include "ReferenceTrackManager.h"
#include <stdexcept>
#include <cmath>
#include <cstring>

juce::var normalizeSpectrumReference(const juce::var& reference) {
    const auto value = reference.getProperty("asset", juce::var());
    const auto numeric = [&value](const char* key, double min, double max) {
        const auto number = value.getProperty(key, juce::var());
        const auto n = static_cast<double>(number);
        return (number.isDouble() || number.isInt() || number.isInt64()) && std::isfinite(n) && n >= min && n <= max;
    };
    const auto id = value.getProperty("id", "").toString(), name = value.getProperty("name", "").toString();
    if (!value.isObject() || !numeric("version", 1, 1) || !numeric("sampleRate", 48000, 48000)
        || !numeric("sourceNyquistHz", 4000, 192000) || !numeric("durationSeconds", 1.0 / 48000, 1e12)
        || !numeric("meanSquare", 0, 1e12) || id.isEmpty() || id.length() > 128 || name.isEmpty() || name.length() > 1024)
        return {};
    const auto curves = value.getProperty("curves", juce::var());
    auto* cleanCurves = new juce::DynamicObject();
    juce::var curveOwner(cleanCurves);
    for (const int size : Visualizer::referenceFFTSizes) {
        const juce::Identifier key { juce::String(size) };
        const auto encoded = curves.getProperty(key, juce::var()).toString();
        juce::MemoryOutputStream bytes;
        if (encoded.length() != ((size * 2 + 2) / 3) * 4 || !juce::Base64::convertFromBase64(bytes, encoded)
            || bytes.getDataSize() != static_cast<size_t>(size * 2)) return {};
        for (size_t i = 0; i < bytes.getDataSize(); i += 4) {
            const auto bits = juce::ByteOrder::littleEndianInt(static_cast<const char*>(bytes.getData()) + i);
            float power; std::memcpy(&power, &bits, 4);
            if (!std::isfinite(power) || power < 0 || power > 1e12f) return {};
        }
        cleanCurves->setProperty(key, encoded);
    }
    auto* cleanAsset = new juce::DynamicObject();
    for (const auto* key : { "version", "id", "name", "sampleRate", "sourceNyquistHz", "durationSeconds", "meanSquare" })
        cleanAsset->setProperty(key, value.getProperty(key, juce::var()));
    cleanAsset->setProperty("curves", curveOwner);
    auto* result = new juce::DynamicObject();
    result->setProperty("asset", juce::var(cleanAsset));
    const double trim = static_cast<double>(reference.getProperty("trimDb", 0.0));
    result->setProperty("trimDb", std::isfinite(trim) ? std::round(juce::jlimit(-24.0, 24.0, trim) * 10) / 10 : 0.0);
    result->setProperty("view", reference.getProperty("view", "overlay").toString() == "difference" ? "difference" : "overlay");
    return juce::var(result);
}

namespace {
juce::var state(const juce::String& phase, const juce::String& id = {}, const juce::String& name = {}) {
    auto* value = new juce::DynamicObject();
    value->setProperty("phase", phase);
    value->setProperty("jobId", id.isEmpty() ? juce::var() : juce::var(id));
    value->setProperty("name", name);
    value->setProperty("progress", juce::var()); value->setProperty("preview", juce::var());
    value->setProperty("result", juce::var()); value->setProperty("error", juce::var());
    return juce::var(value);
}
juce::var asset(const Visualizer::ReferenceCurve& curve, const juce::String& id, const juce::String& name) {
    auto* value = new juce::DynamicObject();
    value->setProperty("version", 1); value->setProperty("id", id); value->setProperty("name", name.substring(0, 1024));
    value->setProperty("sampleRate", Visualizer::referenceSampleRate);
    value->setProperty("sourceNyquistHz", curve.sourceNyquistHz);
    value->setProperty("durationSeconds", curve.durationSeconds); value->setProperty("meanSquare", curve.meanSquare);
    auto* curves = new juce::DynamicObject();
    for (size_t i = 0; i < curve.powers.size(); ++i)
        curves->setProperty(juce::Identifier(juce::String(Visualizer::referenceFFTSizes[i])),
            juce::Base64::toBase64(curve.powers[i].data(), curve.powers[i].size() * sizeof(float)));
    value->setProperty("curves", juce::var(curves));
    return juce::var(value);
}
}

ReferenceTrackManager::~ReferenceTrackManager() {
    cancel();
    for (auto& worker : workers) worker.job->cancelled.store(true);
    for (auto& worker : workers) if (worker.thread.joinable()) worker.thread.join();
}
void ReferenceTrackManager::cleanUpload() {
    uploadStream.reset();
    if (uploadFile != juce::File()) uploadFile.deleteFile();
    uploadFile = juce::File(); uploadName = {}; uploadId = {}; uploadWritten = uploadSize = 0; uploadState = juce::var();
}
void ReferenceTrackManager::cancel() {
    std::lock_guard<std::recursive_mutex> ownerLock(ownerMutex);
    ++ownerGeneration;
    if (current) current->cancelled.store(true);
    current.reset(); cleanUpload();
    ++*workerRevision;
}
void ReferenceTrackManager::start(const juce::File& file, const juce::String& name, bool temporary) {
    std::lock_guard<std::recursive_mutex> ownerLock(ownerMutex);
    cancel();
    for (auto it = workers.begin(); it != workers.end();) {
        if (it->job->done.load()) { it->thread.join(); it = workers.erase(it); } else ++it;
    }
    auto job = std::make_shared<Job>();
    const auto id = juce::Uuid().toString(), label = name.isEmpty() ? file.getFileName() : name;
    job->state = state("opening", id, label); job->revision = workerRevision;
    current = job; ++*workerRevision;
    workers.push_back({ job, std::thread([job, file, temporary, id, label] {
        const auto publish = [job](juce::var next) {
            if (job->cancelled.load()) return;
            { std::lock_guard<std::mutex> lock(job->mutex); job->state = std::move(next); }
            ++*job->revision;
        };
        try {
            const auto result = Visualizer::analyzeReferenceFile(file.getFullPathName().toStdString(), job->cancelled,
                [&](double fraction, const Visualizer::ReferenceCurve& curve) {
                    auto next = state("analyzing", id, label);
                    next.getDynamicObject()->setProperty("progress", fraction >= 0 ? juce::var(fraction) : juce::var());
                    if (curve.durationSeconds > 0) next.getDynamicObject()->setProperty("preview", asset(curve, id, label));
                    publish(next);
                });
            auto next = state("ready", id, label);
            next.getDynamicObject()->setProperty("progress", 1.0);
            next.getDynamicObject()->setProperty("result", asset(result, id, label));
            publish(next);
        } catch (const std::exception& error) {
            auto next = state("error", id, label); next.getDynamicObject()->setProperty("error", juce::String::fromUTF8(error.what()));
            publish(next);
        }
        if (temporary) file.deleteFile();
        job->done.store(true);
    }) });
}
juce::var ReferenceTrackManager::snapshot() const {
    std::lock_guard<std::recursive_mutex> ownerLock(ownerMutex);
    if (uploadState.isObject()) return uploadState;
    if (!current) return state("idle");
    std::lock_guard<std::mutex> lock(current->mutex);
    return current->state;
}
juce::var ReferenceTrackManager::takeCompletedAsset() {
    std::lock_guard<std::recursive_mutex> ownerLock(ownerMutex);
    if (!current) return {};
    std::lock_guard<std::mutex> lock(current->mutex);
    if (current->committed || current->state.getProperty("phase", {}).toString() != "ready") return {};
    current->committed = true;
    return current->state.getProperty("result", {});
}
juce::String ReferenceTrackManager::beginUpload(const juce::String& name, int64_t bytes) {
    std::lock_guard<std::recursive_mutex> ownerLock(ownerMutex);
    cancel();
    if (bytes <= 0) throw std::runtime_error("Choose a non-empty audio file.");
    uploadFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
        .getNonexistentChildFile("prism-reference-" + juce::Uuid().toString(), ".audio", false);
    uploadStream = uploadFile.createOutputStream();
    if (!uploadStream || !uploadStream->openedOk()) { cleanUpload(); throw std::runtime_error("Could not create a temporary audio file."); }
    uploadName = name.substring(0, 1024); uploadSize = bytes; uploadWritten = 0;
    uploadId = juce::Uuid().toString();
    uploadState = state("opening", uploadId, uploadName); ++*workerRevision;
    return uploadId;
}
void ReferenceTrackManager::cancelUpload(const juce::String& id) {
    std::lock_guard<std::recursive_mutex> ownerLock(ownerMutex);
    if (id.isNotEmpty() && id == uploadId) cancel();
}
juce::String ReferenceTrackManager::activeUploadId() const {
    std::lock_guard<std::recursive_mutex> ownerLock(ownerMutex);
    return uploadStream ? uploadId : juce::String();
}
void ReferenceTrackManager::appendUpload(const juce::String& id, int64_t offset, const juce::String& base64) {
    std::lock_guard<std::recursive_mutex> ownerLock(ownerMutex);
    if (id.isEmpty() || id != uploadId) throw std::runtime_error("This audio transfer was superseded.");
    if (!uploadStream || offset != uploadWritten || base64.length() > 349528) throw std::runtime_error("The audio transfer was interrupted.");
    juce::MemoryOutputStream bytes;
    if (!juce::Base64::convertFromBase64(bytes, base64) || bytes.getDataSize() > 262144
        || bytes.getDataSize() == 0 || uploadWritten + static_cast<int64_t>(bytes.getDataSize()) > uploadSize)
        throw std::runtime_error("Invalid audio transfer chunk.");
    if (!uploadStream->write(bytes.getData(), bytes.getDataSize())) throw std::runtime_error("Could not write the temporary audio file.");
    uploadWritten += static_cast<int64_t>(bytes.getDataSize());
}
void ReferenceTrackManager::finishUpload(const juce::String& id) {
    std::lock_guard<std::recursive_mutex> ownerLock(ownerMutex);
    if (id.isEmpty() || id != uploadId) throw std::runtime_error("This audio transfer was superseded.");
    if (!uploadStream || uploadWritten != uploadSize) throw std::runtime_error("The audio transfer is incomplete.");
    uploadStream->flush();
    if (uploadStream->getStatus().failed()) throw std::runtime_error("Could not finish the temporary audio file.");
    uploadStream.reset();
    const auto file = uploadFile; const auto name = uploadName;
    uploadFile = juce::File(); uploadState = juce::var();
    start(file, name, true);
}
