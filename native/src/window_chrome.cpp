#include "window_chrome.h"

#ifdef _WIN32

#include <windows.h>
#include <dwmapi.h>

// These DWM attributes/values exist on Windows 11 (build 22000+) but may be
// missing from older SDK headers, so provide fallback definitions.
#ifndef DWMWA_NCRENDERING_POLICY
#define DWMWA_NCRENDERING_POLICY 2
#endif
#ifndef DWMNCRP_DISABLED
#define DWMNCRP_DISABLED 1
#endif
#ifndef DWMWA_WINDOW_CORNER_PREFERENCE
#define DWMWA_WINDOW_CORNER_PREFERENCE 33
#endif
#ifndef DWMWA_BORDER_COLOR
#define DWMWA_BORDER_COLOR 34
#endif
#ifndef DWMWCP_DONOTROUND
#define DWMWCP_DONOTROUND 1
#endif
#ifndef DWMWA_COLOR_NONE
#define DWMWA_COLOR_NONE 0xFFFFFFFE
#endif

namespace {

Napi::Value ApplyFlatFrame(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Expected native window handle Buffer")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Buffer<uint8_t> handle = info[0].As<Napi::Buffer<uint8_t>>();
    if (handle.Length() < sizeof(HWND)) {
        Napi::TypeError::New(env, "Window handle Buffer is too small")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    HWND hwnd = *reinterpret_cast<HWND*>(handle.Data());
    if (hwnd == nullptr || !IsWindow(hwnd)) {
        return Napi::Boolean::New(env, false);
    }

    // The window keeps WS_THICKFRAME so native Aero Snap and edge resize work, but
    // on Windows 11 that style makes DWM paint a visible border and a drop shadow
    // ("depth"). Disabling DWM non-client rendering removes that shadow/border,
    // and squaring the corners + clearing the accent border color restores the old
    // flat, borderless look. All four calls are no-ops/benign on Windows 10 and
    // fail harmlessly on unsupported builds.
    DWORD ncRendering = DWMNCRP_DISABLED;
    DwmSetWindowAttribute(hwnd, DWMWA_NCRENDERING_POLICY, &ncRendering, sizeof(ncRendering));

    DWORD cornerPreference = DWMWCP_DONOTROUND;
    DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &cornerPreference, sizeof(cornerPreference));

    COLORREF borderColor = DWMWA_COLOR_NONE;
    DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, &borderColor, sizeof(borderColor));

    MARGINS margins = {0, 0, 0, 0};
    DwmExtendFrameIntoClientArea(hwnd, &margins);

    return Napi::Boolean::New(env, true);
}

}  // namespace

void RegisterWindowChrome(Napi::Env env, Napi::Object exports) {
    Napi::Object chrome = Napi::Object::New(env);
    chrome.Set("applyFlatFrame", Napi::Function::New(env, ApplyFlatFrame));
    exports.Set("windowChrome", chrome);
}

#else  // !_WIN32

namespace {

Napi::Value ApplyFlatFrameNoop(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

}  // namespace

void RegisterWindowChrome(Napi::Env env, Napi::Object exports) {
    Napi::Object chrome = Napi::Object::New(env);
    chrome.Set("applyFlatFrame", Napi::Function::New(env, ApplyFlatFrameNoop));
    exports.Set("windowChrome", chrome);
}

#endif  // _WIN32
