#include "window_docking.h"
#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#include <commctrl.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <unordered_map>

namespace {
constexpr UINT_PTR kSubclass = 0x5052444b;
struct Registration { RECT rectangle{}; bool positioned = false; };
std::unordered_map<HWND, Registration> registrations;
UINT CallbackMessage() { static UINT id = RegisterWindowMessageW(L"Prism.Docking.AppBar.v1"); return id; }

HWND ReadHandle(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsBuffer()) return nullptr;
    auto bytes = info[0].As<Napi::Buffer<uint8_t>>();
    if (bytes.Length() != sizeof(HWND)) return nullptr;
    HWND hwnd = nullptr;
    std::memcpy(&hwnd, bytes.Data(), sizeof(hwnd));
    return IsWindow(hwnd) ? hwnd : nullptr;
}

void Remove(HWND hwnd) {
    if (registrations.erase(hwnd) == 0) return;
    APPBARDATA data{};
    data.cbSize = sizeof(data);
    data.hWnd = hwnd;
    SHAppBarMessage(ABM_REMOVE, &data);
}

LRESULT CALLBACK DockSubclass(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR, DWORD_PTR) {
    if (message == WM_NCDESTROY) {
        Remove(hwnd);
        RemoveWindowSubclass(hwnd, DockSubclass, kSubclass);
    } else if (registrations.count(hwnd)) {
        // Block native resize/move without changing Electron's size constraints.
        // setResizable(false) also freezes programmatic restore/resize bounds.
        if (message == WM_SYSCOMMAND) {
            const WPARAM command = wParam & 0xfff0;
            if (command == SC_SIZE || command == SC_MOVE || command == SC_MAXIMIZE) return 0;
        }
        if (message == WM_NCHITTEST) {
            const LRESULT hit = DefSubclassProc(hwnd, message, wParam, lParam);
            return (hit >= HTLEFT && hit <= HTBOTTOMRIGHT) || hit == HTCAPTION ? HTCLIENT : hit;
        }
        APPBARDATA data{};
        data.cbSize = sizeof(data);
        data.hWnd = hwnd;
        if (message == WM_ACTIVATE) SHAppBarMessage(ABM_ACTIVATE, &data);
        if (message == WM_WINDOWPOSCHANGED) SHAppBarMessage(ABM_WINDOWPOSCHANGED, &data);
    }
    return DefSubclassProc(hwnd, message, wParam, lParam);
}

Napi::Value Register(const Napi::CallbackInfo& info) {
    HWND hwnd = ReadHandle(info);
    if (!hwnd) return Napi::Boolean::New(info.Env(), false);
    if (registrations.count(hwnd)) return Napi::Boolean::New(info.Env(), true);
    if (!SetWindowSubclass(hwnd, DockSubclass, kSubclass, 0)) return Napi::Boolean::New(info.Env(), false);
    APPBARDATA data{};
    data.cbSize = sizeof(data);
    data.hWnd = hwnd;
    data.uCallbackMessage = CallbackMessage();
    if (!data.uCallbackMessage || !SHAppBarMessage(ABM_NEW, &data)) {
        RemoveWindowSubclass(hwnd, DockSubclass, kSubclass);
        return Napi::Boolean::New(info.Env(), false);
    }
    registrations.emplace(hwnd, Registration{});
    return Napi::Boolean::New(info.Env(), true);
}

Napi::Value Unregister(const Napi::CallbackInfo& info) {
    HWND hwnd = ReadHandle(info);
    if (hwnd) {
        Remove(hwnd);
        RemoveWindowSubclass(hwnd, DockSubclass, kSubclass);
    }
    return info.Env().Undefined();
}

bool ReadCoordinate(Napi::Object object, const char* key, LONG& value) {
    auto raw = object.Get(key);
    if (!raw.IsNumber()) return false;
    double number = raw.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || number < -1000000 || number > 1000000) return false;
    value = static_cast<LONG>(std::round(number));
    return true;
}

Napi::Value Position(const Napi::CallbackInfo& info) {
    auto env = info.Env();
    HWND hwnd = ReadHandle(info);
    if (!hwnd || !registrations.count(hwnd) || info.Length() != 4 || !info[1].IsString()
        || !info[2].IsObject() || !info[3].IsNumber()) return env.Null();
    const auto edge = info[1].As<Napi::String>().Utf8Value();
    if (edge != "top" && edge != "bottom") return env.Null();
    auto monitor = info[2].As<Napi::Object>();
    LONG x, y, width, height;
    if (!ReadCoordinate(monitor, "x", x) || !ReadCoordinate(monitor, "y", y)
        || !ReadCoordinate(monitor, "width", width) || !ReadCoordinate(monitor, "height", height)
        || width <= 0 || height <= 0) return env.Null();
    const double requested = info[3].As<Napi::Number>().DoubleValue();
    if (!std::isfinite(requested) || requested <= 0) return env.Null();
    const LONG thickness = static_cast<LONG>(std::min(requested, static_cast<double>(height)));
    APPBARDATA data{};
    data.cbSize = sizeof(data);
    data.hWnd = hwnd;
    data.uEdge = edge == "top" ? ABE_TOP : ABE_BOTTOM;
    data.rc = { x, y, x + width, y + height };
    SHAppBarMessage(ABM_QUERYPOS, &data);
    const LONG available = data.rc.bottom - data.rc.top;
    if (available <= 0 || data.rc.right <= data.rc.left) return env.Null();
    const LONG actual = std::min(thickness, available);
    if (data.uEdge == ABE_TOP) data.rc.bottom = data.rc.top + actual;
    else data.rc.top = data.rc.bottom - actual;
    // Do not re-submit an unchanged reservation: ABM_SETPOS itself broadcasts
    // ABN_POSCHANGED, so doing so would create a shell notification loop.
    auto& registration = registrations.at(hwnd);
    if (!registration.positioned || !EqualRect(&registration.rectangle, &data.rc)) {
        if (!SHAppBarMessage(ABM_SETPOS, &data)) return env.Null();
        registration.rectangle = data.rc;
        registration.positioned = true;
    }
    // BrowserWindow.setBounds applies the negotiated physical rectangle after
    // converting it to Electron's display-independent coordinates.
    auto result = Napi::Object::New(env);
    result.Set("x", data.rc.left);
    result.Set("y", data.rc.top);
    result.Set("width", data.rc.right - data.rc.left);
    result.Set("height", data.rc.bottom - data.rc.top);
    return result;
}
}
#endif

void RegisterWindowDocking(Napi::Env env, Napi::Object exports) {
#ifdef _WIN32
    auto api = Napi::Object::New(env);
    api.Set("register", Napi::Function::New(env, Register));
    api.Set("remove", Napi::Function::New(env, Unregister));
    api.Set("lower", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        HWND hwnd = ReadHandle(info);
        if (hwnd) SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        return info.Env().Undefined();
    }));
    api.Set("position", Napi::Function::New(env, Position));
    api.Set("fullscreen", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        HWND hwnd = ReadHandle(info);
        HWND foreground = GetForegroundWindow();
        bool fullscreen = false;
        QUERY_USER_NOTIFICATION_STATE notificationState;
        if (hwnd && SUCCEEDED(SHQueryUserNotificationState(&notificationState))
            && notificationState == QUNS_RUNNING_D3D_FULL_SCREEN) fullscreen = true;
        // Borderless fullscreen does not consistently produce ABN_FULLSCREENAPP.
        // Ignore ordinary maximized windows, our owned panels and the desktop.
        if (!fullscreen && hwnd && foreground && foreground != hwnd && GetAncestor(foreground, GA_ROOTOWNER) != hwnd
            && foreground != GetShellWindow() && foreground != GetDesktopWindow()
            && IsWindowVisible(foreground) && !IsIconic(foreground) && !IsZoomed(foreground)
            && !(GetWindowLongPtrW(foreground, GWL_STYLE) & WS_CAPTION)) {
            MONITORINFO monitor{};
            monitor.cbSize = sizeof(monitor);
            RECT rectangle{};
            if (GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &monitor)
                && GetWindowRect(foreground, &rectangle)) {
                fullscreen = rectangle.left <= monitor.rcMonitor.left && rectangle.top <= monitor.rcMonitor.top
                    && rectangle.right >= monitor.rcMonitor.right && rectangle.bottom >= monitor.rcMonitor.bottom;
            }
        }
        return Napi::Boolean::New(info.Env(), fullscreen);
    }));
    api.Set("workArea", Napi::Function::New(env, [](const Napi::CallbackInfo& info) -> Napi::Value {
        if (info.Length() != 1 || !info[0].IsObject()) return info.Env().Null();
        auto monitor = info[0].As<Napi::Object>();
        LONG x, y, width, height;
        if (!ReadCoordinate(monitor, "x", x) || !ReadCoordinate(monitor, "y", y)
            || !ReadCoordinate(monitor, "width", width) || !ReadCoordinate(monitor, "height", height)
            || width <= 0 || height <= 0) return info.Env().Null();
        RECT rectangle{ x, y, x + width, y + height };
        MONITORINFO details{};
        details.cbSize = sizeof(details);
        if (!GetMonitorInfoW(MonitorFromRect(&rectangle, MONITOR_DEFAULTTONULL), &details)) return info.Env().Null();
        auto result = Napi::Object::New(info.Env());
        result.Set("x", details.rcWork.left);
        result.Set("y", details.rcWork.top);
        result.Set("width", details.rcWork.right - details.rcWork.left);
        result.Set("height", details.rcWork.bottom - details.rcWork.top);
        return result;
    }));
    api.Set("messages", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        auto result = Napi::Object::New(info.Env());
        result.Set("callback", CallbackMessage());
        result.Set("taskbarCreated", RegisterWindowMessageW(L"TaskbarCreated"));
        return result;
    }));
    exports.Set("windowDocking", api);
#endif
}
