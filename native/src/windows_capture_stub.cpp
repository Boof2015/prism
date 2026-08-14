#include "windows_capture.h"

namespace {

Napi::Value MediaGetSupport(const Napi::CallbackInfo& info) {
    Napi::Object support = Napi::Object::New(info.Env());
    support.Set("available", Napi::Boolean::New(info.Env(), false));
    support.Set(
        "reason",
        Napi::String::New(
            info.Env(), "Native Windows media-session integration is unavailable on this platform."));
    return support;
}

Napi::Value GetSpotifyPlaybackState(const Napi::CallbackInfo& info) {
    return info.Env().Null();
}

Napi::Value SendSpotifyControl(const Napi::CallbackInfo& info) {
    Napi::Error::New(
        info.Env(), "Native Windows media-session integration is unavailable on this platform.")
        .ThrowAsJavaScriptException();
    return info.Env().Undefined();
}

}  // namespace

void RegisterWindowsMedia(Napi::Env env, Napi::Object exports) {
    Napi::Object mediaExports = Napi::Object::New(env);
    mediaExports.Set("getSupport", Napi::Function::New(env, MediaGetSupport));
    mediaExports.Set(
        "getSpotifyPlaybackState",
        Napi::Function::New(env, GetSpotifyPlaybackState));
    mediaExports.Set("sendSpotifyControl", Napi::Function::New(env, SendSpotifyControl));
    exports.Set("windowsMedia", mediaExports);
}
