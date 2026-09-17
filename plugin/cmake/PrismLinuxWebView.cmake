# Keep WebKit and host-bundled GTK/GLib in separate processes. JUCE 8.0.4
# probes WebKit inside the host even when using its external browser helper.
# Patch a build-local module copy so an external JUCE checkout is never edited.
function(prism_isolate_linux_webview)
    get_target_property(module_base juce_gui_extra INTERFACE_JUCE_MODULE_PATH)
    set(module_dir "${module_base}/juce_gui_extra")
    set(browser_file "native/juce_WebBrowserComponent_linux.cpp")
    file(READ "${module_dir}/${browser_file}" browser_source)
    string(REPLACE "\r\n" "\n" browser_source "${browser_source}")

    set(host_probe "        webKitIsAvailable = WebKitSymbols::getInstance()->isWebKitAvailable();")
    set(child_probe "        auto& wk = *WebKitSymbols::getInstance();\n\n        // webkit2gtk crashes")
    set(failed_launch "            killChild();\n            return;")
    foreach(anchor IN ITEMS host_probe child_probe failed_launch)
        string(FIND "${browser_source}" "${${anchor}}" location)
        if(location EQUAL -1)
            message(FATAL_ERROR "JUCE Linux WebView changed (${anchor}); review PrismLinuxWebView.cmake before building.")
        endif()
    endforeach()

    string(REPLACE "${host_probe}" [=[
       #if JUCE_USE_EXTERNAL_TEMPORARY_SUBPROCESS
        // The helper checks WebKit with system libraries. Loading it here can
        // fail against a DAW's bundled GLib before the helper even starts.
        webKitIsAvailable = ! JUCEApplicationBase::isStandaloneApp()
                            || WebKitSymbols::getInstance()->isWebKitAvailable();
       #else
        webKitIsAvailable = WebKitSymbols::getInstance()->isWebKitAvailable();
       #endif]=] browser_source "${browser_source}")
    string(REPLACE "${child_probe}" [=[
        auto& wk = *WebKitSymbols::getInstance();
        if (! wk.isWebKitAvailable())
        {
            std::cerr << "Prism WebView: WebKitGTK could not be loaded in the browser helper." << std::endl;
            return 1;
        }

        // webkit2gtk crashes]=] browser_source "${browser_source}")
    string(REPLACE "${failed_launch}" "            killChild();\n            webKitIsAvailable = false;\n            return;" browser_source "${browser_source}")

    set(copy_base "${CMAKE_CURRENT_BINARY_DIR}/prism-juce")
    set(copy_dir "${copy_base}/juce_gui_extra")
    file(COPY "${module_dir}" DESTINATION "${copy_base}" PATTERN "juce_WebBrowserComponent_linux.cpp" EXCLUDE)
    file(CONFIGURE OUTPUT "${copy_dir}/${browser_file}" CONTENT "${browser_source}" @ONLY)
    foreach(property IN ITEMS INTERFACE_SOURCES INTERFACE_JUCE_MODULE_SOURCES)
        get_target_property(sources juce_gui_extra ${property})
        string(REPLACE "${module_dir}/" "${copy_dir}/" sources "${sources}")
        set_property(TARGET juce_gui_extra PROPERTY ${property} "${sources}")
    endforeach()
endfunction()
