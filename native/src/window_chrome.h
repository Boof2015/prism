#pragma once

#include <napi.h>

// Registers the `windowChrome` export. On Windows it exposes `applyFlatFrame`,
// which strips the visible native frame/shadow from a frameless WS_THICKFRAME
// window while preserving native Aero Snap and edge resize. On other platforms
// it registers a no-op so the JS surface stays uniform.
void RegisterWindowChrome(Napi::Env env, Napi::Object exports);
