{
  "targets": [
    {
      "target_name": "visualizer_dsp",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17", "-O3", "-ffast-math"],
      "sources": [
        "src/main.cpp",
        "src/oscilloscope.cpp",
        "src/spectrum.cpp",
        "src/vectorscope.cpp",
        "src/dsp_utils.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "sources": [
            "src/macos_capture.mm"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_LDFLAGS": [
              "-framework Foundation",
              "-framework CoreAudio",
              "-framework AudioToolbox"
            ]
          }
        }],
        ["OS=='win'", {
          "sources": [
            "src/macos_capture_stub.cpp"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/O2"]
            }
          }
        }],
        ["OS=='linux'", {
          "sources": [
            "src/macos_capture_stub.cpp"
          ],
          "cflags_cc": ["-std=c++17", "-O3", "-ffast-math", "-fPIC"]
        }]
      ]
    }
  ]
}
