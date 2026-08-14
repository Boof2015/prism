cmake_minimum_required(VERSION 3.22)

if(APPLE AND NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15" CACHE STRING "Minimum macOS version" FORCE)
endif()

project(PrismTui VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(PRISM_VERSION "development" CACHE STRING "Version printed by prism-tui --version")
set(PRISM_NATIVE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../native/src")

include(FetchContent)
set(FTXUI_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(FTXUI_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(FTXUI_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(FTXUI_BUILD_TESTS_FUZZER OFF CACHE BOOL "" FORCE)
set(FTXUI_ENABLE_INSTALL OFF CACHE BOOL "" FORCE)
FetchContent_Declare(ftxui
    GIT_REPOSITORY https://github.com/ArthurSonzogni/FTXUI.git
    # Commit tagged v7.0.1; use the immutable revision for reproducible builds.
    GIT_TAG c100eab535db2283b78d30fcb6d082a1f84fb683
    GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(ftxui)

find_package(Threads REQUIRED)

add_library(prism_tui_analysis STATIC
    src/analysis_pipeline.cpp
    src/cli.cpp
    src/dashboard_layout.cpp
    src/display_model.cpp
    ${PRISM_NATIVE_DIR}/spectrum.cpp
    ${PRISM_NATIVE_DIR}/vumeter.cpp
    ${PRISM_NATIVE_DIR}/lufsmeter.cpp
    ${PRISM_NATIVE_DIR}/dsp_utils.cpp)
target_include_directories(prism_tui_analysis PUBLIC
    src
    ${PRISM_NATIVE_DIR})
target_link_libraries(prism_tui_analysis PUBLIC Threads::Threads)

add_library(prism_system_capture STATIC)
target_include_directories(prism_system_capture PUBLIC ${PRISM_NATIVE_DIR})
target_compile_definitions(prism_system_capture PRIVATE PRISM_CAPTURE_CORE_ONLY=1)
target_link_libraries(prism_system_capture PUBLIC Threads::Threads)

if(APPLE)
    enable_language(OBJCXX)
    target_sources(prism_system_capture PRIVATE ${PRISM_NATIVE_DIR}/macos_capture.mm)
    target_link_libraries(prism_system_capture PRIVATE
        "-framework Foundation"
        "-framework CoreAudio"
        "-framework AudioToolbox")
elseif(WIN32)
    target_sources(prism_system_capture PRIVATE ${PRISM_NATIVE_DIR}/windows_capture.cpp)
    target_compile_definitions(prism_system_capture PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
    target_link_libraries(prism_system_capture PRIVATE ole32 avrt uuid)
else()
    find_package(PkgConfig REQUIRED)
    pkg_check_modules(PULSE REQUIRED IMPORTED_TARGET libpulse)
    target_sources(prism_system_capture PRIVATE ${PRISM_NATIVE_DIR}/linux_capture.cpp)
    target_link_libraries(prism_system_capture PRIVATE PkgConfig::PULSE)
endif()

add_executable(prism-tui
    src/main.cpp
    src/tui_runtime.cpp)
target_compile_definitions(prism-tui PRIVATE PRISM_VERSION="${PRISM_VERSION}")
if(MSVC)
    target_compile_options(prism-tui PRIVATE /utf-8)
    target_compile_options(prism_tui_analysis PRIVATE /utf-8)
endif()
target_link_libraries(prism-tui PRIVATE
    prism_tui_analysis
    prism_system_capture
    ftxui::ftxui)

set_target_properties(prism-tui PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")

include(CTest)
if(BUILD_TESTING)
    add_executable(prism-tui-tests test/tui_tests.cpp)
    if(MSVC)
        target_compile_options(prism-tui-tests PRIVATE /utf-8)
    endif()
    target_link_libraries(prism-tui-tests PRIVATE prism_tui_analysis)
    add_test(NAME prism-tui-tests COMMAND prism-tui-tests)
    add_test(
        NAME prism-tui-cli-exits
        COMMAND ${CMAKE_COMMAND}
            -DPRISM_TUI_EXECUTABLE=$<TARGET_FILE:prism-tui>
            -DEXPECTED_VERSION=${PRISM_VERSION}
            -P ${CMAKE_CURRENT_SOURCE_DIR}/test/cli_exit_tests.cmake)
endif()
