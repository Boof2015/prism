cmake_minimum_required(VERSION 3.22)

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

# Embed the built webview bundle once; every scope plugin shares it (the C++ tells
# the UI which scope to mount via initialisation data).
if(NOT PRISM_DEV_SERVER)
    set(PRISM_WEBUI_DIST ${CMAKE_CURRENT_SOURCE_DIR}/webview-dist)
    file(GLOB_RECURSE PRISM_WEBUI_FILES "${PRISM_WEBUI_DIST}/*")
    if(NOT PRISM_WEBUI_FILES)
        message(FATAL_ERROR "No webview bundle at ${PRISM_WEBUI_DIST}. Run: npm run plugin-ui:build")
    endif()
    juce_add_binary_data(PrismWebUI SOURCES ${PRISM_WEBUI_FILES})
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
        FORMATS AU VST3 Standalone
        IS_SYNTH FALSE
        NEEDS_MIDI_INPUT FALSE
        NEEDS_MIDI_OUTPUT FALSE
        IS_MIDI_EFFECT FALSE
        NEEDS_WEBVIEW2 FALSE          # macOS uses WKWebView; flip on for Windows later
        COPY_PLUGIN_AFTER_BUILD TRUE)

    target_sources(${TARGET} PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
        ${PRISM_NATIVE_DIR}/spectrum.cpp
        ${PRISM_NATIVE_DIR}/oscilloscope.cpp
        ${PRISM_NATIVE_DIR}/vumeter.cpp
        ${PRISM_NATIVE_DIR}/lufsmeter.cpp
        ${PRISM_NATIVE_DIR}/vectorscope.cpp
        ${PRISM_NATIVE_DIR}/multiband.cpp
        ${PRISM_NATIVE_DIR}/dsp_utils.cpp)

    target_include_directories(${TARGET} PRIVATE Source ${PRISM_NATIVE_DIR})

    target_compile_definitions(${TARGET} PRIVATE
        JUCE_WEB_BROWSER=1            # enables WebBrowserComponent (WKWebView on macOS)
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0)
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
        target_link_libraries(${TARGET} PRIVATE PrismWebUI)
        target_compile_definitions(${TARGET} PRIVATE PRISM_USE_DEV_SERVER=0)
    endif()

    target_link_libraries(${TARGET} PRIVATE
        juce::juce_audio_utils
        juce::juce_gui_extra
        PRIVATE
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags)
endfunction()

add_prism_scope(PrismSpectrum     "Prism Spectrum"     Pspc "")
add_prism_scope(PrismOscilloscope "Prism Oscilloscope" Posc "PRISM_SCOPE_OSCILLOSCOPE=1")
add_prism_scope(PrismVUMeter      "Prism VU Meter"     Pvum "PRISM_SCOPE_VUMETER=1")
add_prism_scope(PrismLUFSMeter    "Prism Loudness Meter" Pluf "PRISM_SCOPE_LUFSMETER=1")
add_prism_scope(PrismVectorscope  "Prism Vectorscope"  Pvct "PRISM_SCOPE_VECTORSCOPE=1")
