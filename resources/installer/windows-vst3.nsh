; Custom NSIS include for electron-builder.
;
; Wizard installer (oneClick=false, perMachine=true) with an optional VST3
; install step. After the directory page, we add a custom page with a checkbox:
;
;   [x] Install Prism VST3 plugins (recommended)
;
; If checked, customInstall xcopies the bundled .vst3 bundles from
; $INSTDIR\resources\plugins\VST3\ into $COMMONFILES64\VST3\ — the standard
; system VST3 folder. The whole installer already runs elevated (perMachine=true
; → UAC prompt at launch), so writes to Common Files succeed without a second
; elevation. On uninstall, the bundles are removed unconditionally (harmless if
; the user opted out at install time).

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var PRISM_VST_CHECKBOX
Var PRISM_VST_STATE

; Hook called from electron-builder's assistedInstaller.nsh between the directory
; page and the install-files page. Adds our custom checkbox page.
!macro customPageAfterChangeDir
  Page custom prismVstOptionsPage prismVstOptionsPageLeave
!macroend

Function prismVstOptionsPage
  !insertmacro MUI_HEADER_TEXT "VST3 Plugins" "Choose whether to install the Prism scope plugins."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckBox} 0 0u 100% 12u "Install Prism VST3 plugins (recommended)"
  Pop $PRISM_VST_CHECKBOX
  ${NSD_Check} $PRISM_VST_CHECKBOX

  ${NSD_CreateLabel} 0 22u 100% 80u "Installs the seven Prism scope plugins (Spectrum, Oscilloscope, Vectorscope, Spectrogram, VU Meter, Loudness Meter, Waveform) to:$\r$\n$\r$\n    $COMMONFILES64\VST3$\r$\n$\r$\nDAWs (FL Studio, Ableton, Logic, Reaper, etc.) will find them on the next plugin rescan.$\r$\n$\r$\nUncheck to install only the Prism desktop app. You can re-run this installer at any time to add the plugins later."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function prismVstOptionsPageLeave
  ${NSD_GetState} $PRISM_VST_CHECKBOX $PRISM_VST_STATE
FunctionEnd

!macro customInstall
  ${If} $PRISM_VST_STATE == ${BST_CHECKED}
    DetailPrint "Installing Prism VST3 plugins to $COMMONFILES64\VST3"
    CreateDirectory "$COMMONFILES64\VST3"
    ; xcopy /E recurse, /I treat dest as dir, /Y overwrite without prompt.
    ; The trailing "\*" + "/E" copies each *.vst3 bundle subfolder verbatim.
    nsExec::ExecToLog 'cmd.exe /c xcopy /E /I /Y "$INSTDIR\resources\plugins\VST3\*" "$COMMONFILES64\VST3\"'
  ${Else}
    DetailPrint "Prism VST3 plugins: skipped (opted out)."
  ${EndIf}
!macroend

!macro customUnInstall
  ; Always attempt removal — harmless RMDir if the bundle isn't there (user opted
  ; out at install or removed manually).
  RMDir /r "$COMMONFILES64\VST3\Prism Spectrum.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Oscilloscope.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism VU Meter.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Loudness Meter.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Vectorscope.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Spectrogram.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Waveform.vst3"
!macroend
