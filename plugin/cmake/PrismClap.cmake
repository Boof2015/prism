# CLAP wraps the existing JUCE shared-code targets; it is not a JUCE FORMATS entry.
if("CLAP" IN_LIST PRISM_PLUGIN_FORMATS)
    set(CLAP_JUCE_EXTENSIONS_PATH "" CACHE PATH "Optional local clap-juce-extensions checkout (including submodules)")
    set(CLAP_JUCE_EXTENSIONS_BUILD_EXAMPLES OFF CACHE BOOL "Build CLAP extension examples" FORCE)
    if(CLAP_JUCE_EXTENSIONS_PATH)
        add_subdirectory("${CLAP_JUCE_EXTENSIONS_PATH}" clap-juce-extensions EXCLUDE_FROM_ALL)
    else()
        include(FetchContent)
        FetchContent_Declare(clap_juce_extensions
            GIT_REPOSITORY https://github.com/free-audio/clap-juce-extensions.git
            GIT_TAG 9fbefae3d9c3d130aafb558c1ec15427a4bd24be
            GIT_SUBMODULES_RECURSE TRUE)
        FetchContent_MakeAvailable(clap_juce_extensions)
    endif()
endif()

function(prism_add_clap target category)
    if(NOT "CLAP" IN_LIST PRISM_PLUGIN_FORMATS)
        return()
    endif()

    # Own the copy step so macOS signing happens after the wrapper assembles its
    # resources and before installation. The upstream helper has no Windows copy.
    get_target_property(copy_after_build ${target} JUCE_COPY_PLUGIN_AFTER_BUILD)
    set_target_properties(${target} PROPERTIES JUCE_COPY_PLUGIN_AFTER_BUILD FALSE)
    clap_juce_extensions_plugin(TARGET ${target}
        CLAP_ID "com.astra.prism.${target}"
        CLAP_FEATURES audio-effect ${category} mono stereo
        CLAP_MANUAL_URL "https://github.com/Boof2015/prism/blob/main/plugin/README.md"
        CLAP_SUPPORT_URL "https://github.com/Boof2015/prism/issues")
    set_target_properties(${target} PROPERTIES JUCE_COPY_PLUGIN_AFTER_BUILD ${copy_after_build})

    if(APPLE)
        add_custom_command(TARGET ${target}_CLAP POST_BUILD
            COMMAND codesign --force --deep --sign - "$<TARGET_BUNDLE_DIR:${target}_CLAP>"
            VERBATIM)
    endif()

    if(PRISM_COPY_PLUGIN_AFTER_BUILD)
        get_target_property(product ${target} JUCE_PRODUCT_NAME)
        if(APPLE)
            set(destination "$ENV{HOME}/Library/Audio/Plug-Ins/CLAP")
            add_custom_command(TARGET ${target}_CLAP POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E make_directory "${destination}"
                COMMAND ${CMAKE_COMMAND} -E copy_directory
                    "$<TARGET_BUNDLE_DIR:${target}_CLAP>" "${destination}/${product}.clap"
                VERBATIM)
        else()
            if(WIN32)
                file(TO_CMAKE_PATH "$ENV{CommonProgramW6432}" common_files)
                if(NOT common_files)
                    file(TO_CMAKE_PATH "$ENV{CommonProgramFiles}" common_files)
                endif()
                if(NOT common_files)
                    message(FATAL_ERROR "CLAP installation needs CommonProgramFiles; set PRISM_COPY_PLUGIN_AFTER_BUILD=OFF to build without installing.")
                endif()
                set(destination "${common_files}/CLAP")
            else()
                set(destination "$ENV{HOME}/.clap")
            endif()
            add_custom_command(TARGET ${target}_CLAP POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E make_directory "${destination}"
                COMMAND ${CMAKE_COMMAND} -E copy_if_different
                    "$<TARGET_FILE:${target}_CLAP>" "${destination}/${product}.clap"
                VERBATIM)
        endif()
    endif()
endfunction()
