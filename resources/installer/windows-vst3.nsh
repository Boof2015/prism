; Custom NSIS include for electron-builder.
;
; After the main Prism app install finishes, copy the bundled VST3 plugin
; bundles out of $INSTDIR\resources\plugins\VST3\ into the system VST3 folder
; (C:\Program Files\Common Files\VST3\) so DAWs find them. On uninstall, remove
; them. The main NSIS installer already requested admin elevation (it has to,
; for Program Files), so writes to CommonFiles64 succeed without a second UAC.

!macro customInstall
  ; Ensure the destination exists; xcopy creates trees but not the leaf root.
  CreateDirectory "$COMMONFILES64\VST3"
  ; xcopy /E recurse, /I treat dest as dir, /Y overwrite without prompt.
  ; The trailing "\*" + "/E" copies each *.vst3 bundle subfolder verbatim.
  nsExec::ExecToLog 'cmd.exe /c xcopy /E /I /Y "$INSTDIR\resources\plugins\VST3\*" "$COMMONFILES64\VST3\"'
!macroend

!macro customUnInstall
  RMDir /r "$COMMONFILES64\VST3\Prism Spectrum.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Oscilloscope.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism VU Meter.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Loudness Meter.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Vectorscope.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Spectrogram.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Waveform.vst3"
!macroend
