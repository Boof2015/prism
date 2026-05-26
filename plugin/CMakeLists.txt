cmake_minimum_required(VERSION 3.22)

project(PrismPlugins VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE: use a local checkout if provided (-DJUCE_PATH=/path/to/JUCE), otherwise
# fetch a pinned release. A local checkout makes reconfigures much faster.
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

juce_add_plugin(PrismSpectrum
    PRODUCT_NAME "Prism Spectrum"
    COMPANY_NAME "Prism"
    BUNDLE_ID com.astra.prism.spectrum
    PLUGIN_MANUFACTURER_CODE Prsm
    PLUGIN_CODE Pspc
    FORMATS AU VST3 Standalone
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    NEEDS_WEBVIEW2 FALSE          # macOS uses WKWebView; flip on for Windows later
    COPY_PLUGIN_AFTER_BUILD TRUE)

target_sources(PrismSpectrum PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    ${PRISM_NATIVE_DIR}/spectrum.cpp
    ${PRISM_NATIVE_DIR}/dsp_utils.cpp)

target_include_directories(PrismSpectrum PRIVATE
    Source
    ${PRISM_NATIVE_DIR})

# macOS: private-API helper to lift WKWebView's 60fps cap (no public alternative).
if(APPLE)
    target_sources(PrismSpectrum PRIVATE Source/WebViewFrameRate.mm)
    set_source_files_properties(Source/WebViewFrameRate.mm PROPERTIES COMPILE_FLAGS "-fno-objc-arc")
    target_link_libraries(PrismSpectrum PRIVATE "-framework WebKit")
endif()

target_compile_definitions(PrismSpectrum PRIVATE
    JUCE_WEB_BROWSER=1            # enables WebBrowserComponent (WKWebView on macOS)
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0)

# UI delivery: bundled (self-contained, default) vs Vite dev server (hot reload).
option(PRISM_DEV_SERVER "Load the webview UI from the Vite dev server instead of the embedded bundle" OFF)

if(PRISM_DEV_SERVER)
    target_compile_definitions(PrismSpectrum PRIVATE PRISM_USE_DEV_SERVER=1)
    message(STATUS "Prism: UI from Vite dev server (run 'npm run plugin-ui:dev')")
else()
    # Embed the built webview bundle (run 'npm run plugin-ui:build' first).
    set(PRISM_WEBUI_DIST ${CMAKE_CURRENT_SOURCE_DIR}/webview-dist)
    file(GLOB_RECURSE PRISM_WEBUI_FILES "${PRISM_WEBUI_DIST}/*")
    if(NOT PRISM_WEBUI_FILES)
        message(FATAL_ERROR "No webview bundle at ${PRISM_WEBUI_DIST}. Run: npm run plugin-ui:build")
    endif()
    juce_add_binary_data(PrismSpectrumWebUI SOURCES ${PRISM_WEBUI_FILES})
    target_link_libraries(PrismSpectrum PRIVATE PrismSpectrumWebUI)
    target_compile_definitions(PrismSpectrum PRIVATE PRISM_USE_DEV_SERVER=0)
    message(STATUS "Prism: UI embedded from ${PRISM_WEBUI_DIST}")
endif()

target_link_libraries(PrismSpectrum PRIVATE
    juce::juce_audio_utils
    juce::juce_gui_extra
    PRIVATE
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags)
