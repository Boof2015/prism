#include "reference_napi.h"
#include "reference_analysis.h"
#include <map>
#include <mutex>
#include <cstring>

namespace {
std::atomic<uint32_t> nextJob { 1 };
std::mutex jobsMutex;
std::map<uint32_t, std::shared_ptr<std::atomic<bool>>> jobs;

Napi::Object toJS(Napi::Env env, const Visualizer::ReferenceCurve& curve) {
    auto result = Napi::Object::New(env);
    result.Set("sourceNyquistHz", curve.sourceNyquistHz);
    result.Set("durationSeconds", curve.durationSeconds);
    result.Set("meanSquare", curve.meanSquare);
    auto curves = Napi::Object::New(env);
    for (size_t i = 0; i < curve.powers.size(); ++i) {
        auto array = Napi::Float32Array::New(env, curve.powers[i].size());
        std::memcpy(array.Data(), curve.powers[i].data(), curve.powers[i].size() * sizeof(float));
        curves.Set(std::to_string(Visualizer::referenceFFTSizes[i]), array);
    }
    result.Set("curves", curves);
    return result;
}
struct Progress { double fraction; Visualizer::ReferenceCurve curve; };
class ReferenceWorker : public Napi::AsyncWorker {
public:
    ReferenceWorker(uint32_t id, std::string file, const Napi::Function& onProgress, const Napi::Function& done, size_t chunkSize)
        : Napi::AsyncWorker(done), jobId(id), chunkFrames(chunkSize), path(std::move(file)), cancelled(std::make_shared<std::atomic<bool>>(false)),
          progress(Napi::ThreadSafeFunction::New(done.Env(), onProgress, "Reference analysis", 1, 1)) {
        std::lock_guard<std::mutex> lock(jobsMutex); jobs[jobId] = cancelled;
    }
    ~ReferenceWorker() override { std::lock_guard<std::mutex> lock(jobsMutex); jobs.erase(jobId); }
    void Execute() override {
        try {
            result = Visualizer::analyzeReferenceFile(path, *cancelled, [this](double fraction, const Visualizer::ReferenceCurve& curve) {
                auto* update = new Progress { fraction, curve };
                const auto status = progress.NonBlockingCall(update, [](Napi::Env env, Napi::Function callback, Progress* value) {
                    std::unique_ptr<Progress> owned(value);
                    if (env && callback) callback.Call({Napi::Number::New(env, value->fraction), toJS(env, value->curve)});
                });
                if (status != napi_ok) delete update;
            }, chunkFrames);
        } catch (const std::exception& error) { SetError(error.what()); }
        progress.Release();
    }
    void OnOK() override {
        if (cancelled->load()) { Callback().Call({Napi::String::New(Env(), "Reference analysis cancelled."), Env().Null()}); return; }
        Callback().Call({Env().Null(), toJS(Env(), result)});
    }
    void OnError(const Napi::Error& error) override { Callback().Call({error.Value(), Env().Null()}); }
private:
    uint32_t jobId;
    size_t chunkFrames;
    std::string path;
    std::shared_ptr<std::atomic<bool>> cancelled;
    Napi::ThreadSafeFunction progress;
    Visualizer::ReferenceCurve result;
};
}
void initReferenceAnalysis(Napi::Env env, Napi::Object exports) {
    auto api = Napi::Object::New(env);
    api.Set("start", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        if ((info.Length() < 3 || info.Length() > 4) || !info[0].IsString() || !info[1].IsFunction() || !info[2].IsFunction()) {
            Napi::TypeError::New(info.Env(), "Expected a file path, progress callback, and completion callback.").ThrowAsJavaScriptException();
            return info.Env().Undefined();
        }
        const uint32_t id = nextJob.fetch_add(1);
        (new ReferenceWorker(id, info[0].As<Napi::String>().Utf8Value(), info[1].As<Napi::Function>(), info[2].As<Napi::Function>(), info.Length() > 3 && info[3].IsNumber() ? info[3].As<Napi::Number>().Uint32Value() : 4096))->Queue();
        return Napi::Number::New(info.Env(), id);
    }));
    api.Set("cancel", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        if (info.Length() && info[0].IsNumber()) {
            std::lock_guard<std::mutex> lock(jobsMutex);
            const auto found = jobs.find(info[0].As<Napi::Number>().Uint32Value());
            if (found != jobs.end()) found->second->store(true);
        }
        return info.Env().Undefined();
    }));
    exports.Set("referenceAnalysis", api);
}
