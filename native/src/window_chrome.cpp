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

// Undocumented but long-stable user32 API used for accent-policy acrylic.
// Unlike DWMWA_SYSTEMBACKDROP_TYPE acrylic, this blur stays active while the
// window is unfocused and renders on borderless transparent windows, which is
// exactly what an always-visible visualizer overlay needs.
struct AccentPolicy {
    int32_t AccentState;
    int32_t AccentFlags;
    uint32_t GradientColor;  // AABBGGRR
    int32_t AnimationId;
};

struct WindowCompositionAttribData {
    int32_t Attrib;
    void* pvData;
    SIZE_T cbData;
};

using SetWindowCompositionAttributeFn = BOOL(WINAPI*)(HWND, WindowCompositionAttribData*);

constexpr int32_t kAccentDisabled = 0;
constexpr int32_t kAccentEnableAcrylicBlurBehind = 4;
constexpr int32_t kWcaAccentPolicy = 19;
// A barely-visible tint keeps some Windows builds from optimizing the blur
// away entirely when the requested tint alpha is zero.
constexpr uint32_t kNearTransparentTint = 0x01000000u;

HWND ReadWindowHandle(const Napi::CallbackInfo& info, Napi::Env env) {
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        Napi::TypeError::New(env, "Expected native window handle Buffer")
            .ThrowAsJavaScriptException();
        return nullptr;
    }

    Napi::Buffer<uint8_t> handle = info[0].As<Napi::Buffer<uint8_t>>();
    if (handle.Length() < sizeof(HWND)) {
        Napi::TypeError::New(env, "Window handle Buffer is too small")
            .ThrowAsJavaScriptException();
        return nullptr;
    }

    HWND hwnd = *reinterpret_cast<HWND*>(handle.Data());
    if (hwnd == nullptr || !IsWindow(hwnd)) {
        return nullptr;
    }
    return hwnd;
}

Napi::Value SetAcrylicBlurBehind(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    HWND hwnd = ReadWindowHandle(info, env);
    if (env.IsExceptionPending() || hwnd == nullptr) {
        return env.IsExceptionPending() ? env.Undefined() : Napi::Boolean::New(env, false);
    }

    const bool enable = info.Length() > 1 && info[1].IsBoolean()
        ? info[1].As<Napi::Boolean>().Value()
        : true;

    HMODULE user32 = GetModuleHandleW(L"user32.dll");
    if (user32 == nullptr) {
        return Napi::Boolean::New(env, false);
    }

    auto setWindowCompositionAttribute = reinterpret_cast<SetWindowCompositionAttributeFn>(
        GetProcAddress(user32, "SetWindowCompositionAttribute"));
    if (setWindowCompositionAttribute == nullptr) {
        return Napi::Boolean::New(env, false);
    }

    AccentPolicy policy = {};
    policy.AccentState = enable ? kAccentEnableAcrylicBlurBehind : kAccentDisabled;
    policy.AccentFlags = 0;
    policy.GradientColor = enable ? kNearTransparentTint : 0u;
    policy.AnimationId = 0;

    WindowCompositionAttribData data = {};
    data.Attrib = kWcaAccentPolicy;
    data.pvData = &policy;
    data.cbData = sizeof(policy);

    return Napi::Boolean::New(env, setWindowCompositionAttribute(hwnd, &data) != FALSE);
}

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
    chrome.Set("setAcrylicBlurBehind", Napi::Function::New(env, SetAcrylicBlurBehind));
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
    chrome.Set("setAcrylicBlurBehind", Napi::Function::New(env, ApplyFlatFrameNoop));
    exports.Set("windowChrome", chrome);
}

#endif  // _WIN32
