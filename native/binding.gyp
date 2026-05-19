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
        "src/spectrogram.cpp",
        "src/vectorscope.cpp",
        "src/multiband.cpp",
        "src/waveform.cpp",
        "src/vumeter.cpp",
        "src/lufsmeter.cpp",
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
            "src/macos_capture.mm",
            "src/windows_capture_stub.cpp",
            "src/linux_capture_stub.cpp"
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
            "src/macos_capture_stub.cpp",
            "src/windows_capture.cpp",
            "src/linux_capture_stub.cpp"
          ],
          "defines": [
            "WIN32_LEAN_AND_MEAN",
            "NOMINMAX"
          ],
          "libraries": [
            "ole32.lib",
            "avrt.lib",
            "runtimeobject.lib",
            "uuid.lib"
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
            "src/macos_capture_stub.cpp",
            "src/windows_capture_stub.cpp",
            "src/linux_capture.cpp"
          ],
          "cflags_cc": ["-std=c++17", "-O3", "-ffast-math", "-fPIC"],
          "libraries": [
            "-lpulse"
          ]
        }]
      ]
    }
  ]
}
