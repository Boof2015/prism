execute_process(
    COMMAND "${PRISM_TUI_EXECUTABLE}" --help
    RESULT_VARIABLE help_result
    OUTPUT_VARIABLE help_output
    ERROR_VARIABLE help_error)
if(NOT help_result EQUAL 0 OR NOT help_output MATCHES "Usage: prism-tui")
    message(FATAL_ERROR "--help failed (${help_result}): ${help_output}${help_error}")
endif()

execute_process(
    COMMAND "${PRISM_TUI_EXECUTABLE}" --version
    RESULT_VARIABLE version_result
    OUTPUT_VARIABLE version_output
    ERROR_VARIABLE version_error)
if(NOT version_result EQUAL 0 OR NOT version_output MATCHES "prism-tui ${EXPECTED_VERSION}")
    message(FATAL_ERROR "--version failed (${version_result}): ${version_output}${version_error}")
endif()

execute_process(
    COMMAND "${PRISM_TUI_EXECUTABLE}" --definitely-invalid
    RESULT_VARIABLE invalid_result
    OUTPUT_VARIABLE invalid_output
    ERROR_VARIABLE invalid_error)
if(NOT invalid_result EQUAL 2 OR NOT invalid_error MATCHES "Unknown argument")
    message(FATAL_ERROR "invalid CLI exit was ${invalid_result}: ${invalid_output}${invalid_error}")
endif()

execute_process(
    COMMAND "${PRISM_TUI_EXECUTABLE}"
    RESULT_VARIABLE noninteractive_result
    OUTPUT_VARIABLE noninteractive_output
    ERROR_VARIABLE noninteractive_error)
if(NOT noninteractive_result EQUAL 1)
    message(FATAL_ERROR
        "noninteractive CLI exit was ${noninteractive_result}: "
        "${noninteractive_output}${noninteractive_error}")
endif()
