cmake_minimum_required(VERSION 3.22)

# macOS deployment target. Without an override, the build inherits the host SDK
# (e.g. 26 on a current Mac) which restricts the plugin to that macOS or newer.
# 11.0 (Big Sur) is a reasonable floor; well within JUCE 8's supported range.
# Override on the command line with -DCMAKE_OSX_DEPLOYMENT_TARGET=X.X — the FORCE
# is only applied when the value is empty/unset, so explicit overrides win.
if(NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version supported" FORCE)
endif()

project(PrismPlugins VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE: use a local checkout if provided (-DJUCE_PATH=/path/to/JUCE), otherwise
# fetch a pinned release.
if(DEFINED JUCE_PATH)
    add_subdirectory(${JUCE_PATH} juce-build)
else()
    include(FetchContent)
    FetchContent_Declare(JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG 8.0.4
        GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(JUCE)
endif()

# Reused, unmodified Prism DSP (no N-API dependency).
set(PRISM_NATIVE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../native/src)

# UI delivery: bundled (self-contained, default) vs Vite dev server (hot reload).
option(PRISM_DEV_SERVER "Load the webview UI from the Vite dev server instead of the embedded bundle" OFF)

# Build controls. Defaults preserve the full local build; CI narrows these to
# the formats that are actually packaged. AU is macOS-only, so Linux/Windows
# default to the portable VST3 + Standalone set.
if(APPLE)
    set(PRISM_DEFAULT_PLUGIN_FORMATS "AU;VST3;Standalone")
else()
    set(PRISM_DEFAULT_PLUGIN_FORMATS "VST3;Standalone")
endif()
set(PRISM_PLUGIN_FORMATS "${PRISM_DEFAULT_PLUGIN_FORMATS}" CACHE STRING "JUCE plugin formats to build")
option(PRISM_COPY_PLUGIN_AFTER_BUILD "Copy built plugins into user plugin folders after build" ON)

set(PRISM_LINUX_UI_MODE "webview" CACHE STRING "Linux-only UI diagnostic mode: webview, web_smoke, native_smoke, or floating_webview")
set_property(CACHE PRISM_LINUX_UI_MODE PROPERTY STRINGS webview web_smoke native_smoke floating_webview)
set(PRISM_VALID_LINUX_UI_MODES webview web_smoke native_smoke floating_webview)
option(PRISM_LINUX_UI_DIAGNOSTICS "Write Linux VST UI diagnostic logs" OFF)

if(UNIX AND NOT APPLE)
    list(FIND PRISM_VALID_LINUX_UI_MODES "${PRISM_LINUX_UI_MODE}" PRISM_LINUX_UI_MODE_INDEX)
    if(PRISM_LINUX_UI_MODE_INDEX EQUAL -1)
        message(FATAL_ERROR "Invalid PRISM_LINUX_UI_MODE='${PRISM_LINUX_UI_MODE}'. Expected one of: ${PRISM_VALID_LINUX_UI_MODES}")
    endif()
else()
    if(NOT PRISM_LINUX_UI_MODE STREQUAL "webview")
        message(FATAL_ERROR "PRISM_LINUX_UI_MODE is Linux-only; macOS/Windows builds must use 'webview'.")
    endif()
endif()

set(PRISM_NEEDS_WEBUI OFF)
if(NOT PRISM_DEV_SERVER)
    if(NOT UNIX OR APPLE OR PRISM_LINUX_UI_MODE STREQUAL "webview" OR PRISM_LINUX_UI_MODE STREQUAL "floating_webview")
        set(PRISM_NEEDS_WEBUI ON)
    endif()
endif()

if(PRISM_NEEDS_WEBUI)
    set(PRISM_EMBED_WEBUI_DEFINITION PRISM_EMBED_WEBUI=1)
else()
    set(PRISM_EMBED_WEBUI_DEFINITION PRISM_EMBED_WEBUI=0)
endif()

string(TOUPPER "${PRISM_LINUX_UI_MODE}" PRISM_LINUX_UI_MODE_UPPER)
set(PRISM_LINUX_UI_MODE_DEFINITIONS
    PRISM_LINUX_UI_MODE_NAME="${PRISM_LINUX_UI_MODE}"
    PRISM_LINUX_UI_MODE_${PRISM_LINUX_UI_MODE_UPPER}=1)

# Embed the built webview bundle once; every scope plugin shares it (the C++ tells
# the UI which scope to mount via initialisation data).
if(PRISM_NEEDS_WEBUI)
    set(PRISM_WEBUI_DIST ${CMAKE_CURRENT_SOURCE_DIR}/webview-dist)
    file(GLOB_RECURSE PRISM_WEBUI_FILES "${PRISM_WEBUI_DIST}/*")
    if(NOT PRISM_WEBUI_FILES)
        message(FATAL_ERROR "No webview bundle at ${PRISM_WEBUI_DIST}. Run: npm run plugin-ui:build")
    endif()
    juce_add_binary_data(PrismWebUI SOURCES ${PRISM_WEBUI_FILES})
endif()

if(UNIX AND NOT APPLE)
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(PRISM_LINUX_WEBVIEW_DEPS REQUIRED
        webkit2gtk-4.1
        gtk+-x11-3.0)
endif()

# Define one per-scope plugin product from the shared codebase.
# SCOPE_DEFINE selects the ScopeEngine at compile time (empty = spectrum default).
function(add_prism_scope TARGET PRODUCT PLUGIN_CODE SCOPE_DEFINE)
    juce_add_plugin(${TARGET}
        PRODUCT_NAME ${PRODUCT}
        COMPANY_NAME "Prism"
        BUNDLE_ID com.astra.prism.${TARGET}
        PLUGIN_MANUFACTURER_CODE Prsm
        PLUGIN_CODE ${PLUGIN_CODE}
        FORMATS ${PRISM_PLUGIN_FORMATS}
        IS_SYNTH FALSE
        NEEDS_MIDI_INPUT FALSE
        NEEDS_MIDI_OUTPUT FALSE
        IS_MIDI_EFFECT FALSE
        NEEDS_WEBVIEW2 TRUE           # Windows: links Microsoft Edge WebView2. No-op elsewhere.
        COPY_PLUGIN_AFTER_BUILD ${PRISM_COPY_PLUGIN_AFTER_BUILD})

    target_sources(${TARGET} PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
        ${PRISM_NATIVE_DIR}/spectrum.cpp
        ${PRISM_NATIVE_DIR}/oscilloscope.cpp
        ${PRISM_NATIVE_DIR}/vumeter.cpp
        ${PRISM_NATIVE_DIR}/lufsmeter.cpp
        ${PRISM_NATIVE_DIR}/vectorscope.cpp
        ${PRISM_NATIVE_DIR}/multiband.cpp
        ${PRISM_NATIVE_DIR}/spectrogram.cpp
        ${PRISM_NATIVE_DIR}/waveform.cpp
        ${PRISM_NATIVE_DIR}/dsp_utils.cpp)

    target_include_directories(${TARGET} PRIVATE Source ${PRISM_NATIVE_DIR})

    target_compile_definitions(${TARGET} PRIVATE
        JUCE_WEB_BROWSER=1            # enables WebBrowserComponent (WKWebView on macOS)
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
        ${PRISM_EMBED_WEBUI_DEFINITION}
        PRISM_LINUX_UI_DIAGNOSTICS=$<BOOL:${PRISM_LINUX_UI_DIAGNOSTICS}>
        ${PRISM_LINUX_UI_MODE_DEFINITIONS})
    if(WIN32)
        # NEEDS_WEBVIEW2 links the WebView2 SDK but doesn't turn on the JUCE compile
        # paths that gate withResourceProvider. JUCE_USE_WIN_WEBVIEW2=1 enables the
        # WebView2-aware code (incl. the resource provider); _WITH_STATIC_LINKING=1
        # matches the static-linked SDK that NEEDS_WEBVIEW2 wires up.
        target_compile_definitions(${TARGET} PRIVATE
            JUCE_USE_WIN_WEBVIEW2=1
            JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
    endif()
    if(NOT SCOPE_DEFINE STREQUAL "")
        target_compile_definitions(${TARGET} PRIVATE ${SCOPE_DEFINE})
    endif()

    # macOS: private-API helper to lift WKWebView's 60fps cap (no public alternative).
    if(APPLE)
        target_sources(${TARGET} PRIVATE Source/WebViewFrameRate.mm)
        set_source_files_properties(Source/WebViewFrameRate.mm PROPERTIES COMPILE_FLAGS "-fno-objc-arc")
        target_link_libraries(${TARGET} PRIVATE "-framework WebKit")
    endif()

    if(PRISM_DEV_SERVER)
        target_compile_definitions(${TARGET} PRIVATE PRISM_USE_DEV_SERVER=1)
    else()
        target_compile_definitions(${TARGET} PRIVATE PRISM_USE_DEV_SERVER=0)
    endif()

    if(PRISM_NEEDS_WEBUI)
        target_link_libraries(${TARGET} PRIVATE PrismWebUI)
    endif()

    target_link_libraries(${TARGET} PRIVATE
        juce::juce_audio_utils
        juce::juce_gui_extra
        PRIVATE
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)

    if(UNIX AND NOT APPLE)
        # JUCE's Linux WebBrowserComponent dynamically opens WebKitGTK/GTK when
        # the editor is created. We need their headers to compile, but linking
        # them here makes DAW plugin scanners resolve WebKitGTK/JSC before the UI
        # is even opened, which is fragile when hosts carry their own GLib stack.
        target_include_directories(${TARGET} PRIVATE ${PRISM_LINUX_WEBVIEW_DEPS_INCLUDE_DIRS})
        target_compile_options(${TARGET} PRIVATE ${PRISM_LINUX_WEBVIEW_DEPS_CFLAGS_OTHER})

        # In plugin hosts, JUCE's Linux WebBrowserComponent must exec a helper
        # process for WebKitGTK. Without this, JUCE falls back to running WebKit
        # directly after fork(), which is unsafe in multi-threaded hosts and has
        # crashed during pluginval/DAW editor creation.
        juce_link_with_embedded_linux_subprocess(${TARGET})
    endif()
endfunction()

add_prism_scope(PrismSpectrum     "Prism Spectrum"     Pspc "")
add_prism_scope(PrismOscilloscope "Prism Oscilloscope" Posc "PRISM_SCOPE_OSCILLOSCOPE=1")
add_prism_scope(PrismVUMeter      "Prism VU Meter"     Pvum "PRISM_SCOPE_VUMETER=1")
add_prism_scope(PrismLUFSMeter    "Prism Loudness Meter" Pluf "PRISM_SCOPE_LUFSMETER=1")
add_prism_scope(PrismVectorscope  "Prism Vectorscope"  Pvct "PRISM_SCOPE_VECTORSCOPE=1")
add_prism_scope(PrismSpectrogram  "Prism Spectrogram"  Pspg "PRISM_SCOPE_SPECTROGRAM=1")
add_prism_scope(PrismWaveform     "Prism Waveform"     Pwav "PRISM_SCOPE_WAVEFORM=1")

set(PRISM_SCOPE_TARGETS
    PrismSpectrum
    PrismOscilloscope
    PrismVUMeter
    PrismLUFSMeter
    PrismVectorscope
    PrismSpectrogram
    PrismWaveform)

add_custom_target(PrismInstallerPlugins)
foreach(PRISM_SCOPE_TARGET IN LISTS PRISM_SCOPE_TARGETS)
    if("VST3" IN_LIST PRISM_PLUGIN_FORMATS)
        add_dependencies(PrismInstallerPlugins ${PRISM_SCOPE_TARGET}_VST3)
    endif()

    if(APPLE AND "AU" IN_LIST PRISM_PLUGIN_FORMATS)
        add_dependencies(PrismInstallerPlugins ${PRISM_SCOPE_TARGET}_AU)
    endif()
endforeach()
