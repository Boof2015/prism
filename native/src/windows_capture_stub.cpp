#include "windows_capture.h"

namespace {

Napi::Value GetSupport(const Napi::CallbackInfo& info) {
    Napi::Object support = Napi::Object::New(info.Env());
    support.Set("available", Napi::Boolean::New(info.Env(), false));
    support.Set(
        "reason",
        Napi::String::New(
            info.Env(), "Native Windows output-device capture is unavailable on this platform."));
    return support;
}

Napi::Value ListOutputDevices(const Napi::CallbackInfo& info) {
    return Napi::Array::New(info.Env());
}

Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Error::New(
        info.Env(), "Native Windows output-device capture is unavailable on this platform.")
        .ThrowAsJavaScriptException();
    return info.Env().Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
    return info.Env().Undefined();
}

Napi::Value Drain(const Napi::CallbackInfo& info) {
    Napi::Object result = Napi::Object::New(info.Env());
    result.Set("chunks", Napi::Array::New(info.Env()));
    result.Set("overwriteCount", Napi::Number::New(info.Env(), 0));
    result.Set("queueDepth", Napi::Number::New(info.Env(), 0));
    return result;
}

Napi::Value NowMilliseconds(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), 0);
}

}  // namespace

void RegisterWindowsCapture(Napi::Env env, Napi::Object exports) {
    Napi::Object captureExports = Napi::Object::New(env);
    captureExports.Set("getSupport", Napi::Function::New(env, GetSupport));
    captureExports.Set(
        "listOutputDevices", Napi::Function::New(env, ListOutputDevices));
    captureExports.Set("start", Napi::Function::New(env, Start));
    captureExports.Set("stop", Napi::Function::New(env, Stop));
    captureExports.Set("drain", Napi::Function::New(env, Drain));
    captureExports.Set("nowMilliseconds", Napi::Function::New(env, NowMilliseconds));
    exports.Set("windowsCapture", captureExports);
}
