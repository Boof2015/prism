; Custom NSIS include for electron-builder.
;
; Wizard installer (oneClick=false, perMachine=true) with an optional VST3
; install step. After the directory page, we add a custom page with a checkbox:
;
;   [x] Install Prism VST3 plugins (recommended)
;
; If checked, customInstall xcopies the bundled .vst3 bundles from
; $INSTDIR\resources\plugins\VST3\ into $COMMONFILES64\VST3\. The whole
; installer already runs elevated (perMachine=true → UAC at launch), so writes
; to Common Files succeed without a second elevation. On uninstall, the bundles
; are removed unconditionally (harmless if the user opted out at install time).

!include "LogicLib.nsh"
!include "WinMessages.nsh"

!ifndef BUILD_UNINSTALLER
  !include "nsDialogs.nsh"

  Var PRISM_VST_CHECKBOX
  Var PRISM_VST_STATE

  !macro customInit
    ; Silent installs skip the options page, so default to installing plugins.
    StrCpy $PRISM_VST_STATE ${BST_CHECKED}
  !macroend

  ; NOTE on parse order: this file is `!include`d before electron-builder's main
  ; installer template, so MUI references live inside inserted macro bodies.
  !macro customPageAfterChangeDir
    Page custom prismVstOptionsPage prismVstOptionsPageLeave

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
  !macroend

  !macro customInstall
    ${IfNot} ${FileExists} "$INSTDIR\resources\tui\prism-tui.exe"
      DetailPrint "ERROR: bundled prism-tui.exe was not found"
      MessageBox MB_OK|MB_ICONSTOP "The bundled prism-tui executable was not found.$\r$\n$\r$\nMissing path:$\r$\n$INSTDIR\resources\tui\prism-tui.exe" /SD IDOK
      Abort
    ${EndIf}

    ; Pass the path through the installer's process environment. Supplying it
    ; after PowerShell's -Command argument loses quotes at the native command
    ; line boundary and truncates the default path to "C:\Program".
    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PRISM_TUI_INSTALL_DIR", "$INSTDIR\resources\tui").r0'
    ${If} $0 == 0
      DetailPrint "ERROR: could not prepare the Prism TUI PATH update"
      MessageBox MB_OK|MB_ICONSTOP "Prism could not prepare the prism-tui PATH update." /SD IDOK
      Abort
    ${EndIf}

    ; PowerShell avoids NSIS string-length truncation on machines with a large
    ; PATH. It removes exact duplicates, safely repairs the truncated entry
    ; written by older installers, appends Prism once, and verifies the write.
    nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& { $$ErrorActionPreference = 'Stop'; $$entry = $$env:PRISM_TUI_INSTALL_DIR; if ([string]::IsNullOrWhiteSpace($$entry)) { exit 10 }; $$legacyEntry = $$null; $$removeLegacy = $$false; if ($$entry -match '\s') { $$legacyEntry = ($$entry -split '\s', 2)[0]; $$removeLegacy = $$legacyEntry -ine $$entry -and -not (Test-Path -LiteralPath $$legacyEntry -PathType Container) }; $$path = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $$entries = @($$path -split ';' | Where-Object { $$_ -and $$_ -ine $$entry -and (-not $$removeLegacy -or $$_ -ine $$legacyEntry) }); $$entries += $$entry; [Environment]::SetEnvironmentVariable('Path', ($$entries -join ';'), 'Machine'); $$updatedPath = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $$matches = @($$updatedPath -split ';' | Where-Object { $$_ -ieq $$entry }); if ($$matches.Count -ne 1) { exit 11 } }"`
    Pop $0
    ${If} $0 != 0
      DetailPrint "ERROR: could not add Prism TUI to the machine PATH (exit code $0)"
      MessageBox MB_OK|MB_ICONSTOP "Prism could not add prism-tui to the machine PATH.$\r$\n$\r$\nPowerShell exit code: $0" /SD IDOK
      Abort
    ${EndIf}
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
    DetailPrint "Added $INSTDIR\resources\tui to the machine PATH"

    ${If} $PRISM_VST_STATE == ${BST_CHECKED}
      DetailPrint "Installing Prism VST3 plugins to $COMMONFILES64\VST3"

      ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\VST3\*.vst3"
        ; Plugins are optional. Local app/TUI builds may intentionally omit the
        ; staged bundles, so do not roll back an otherwise valid installation.
        DetailPrint "WARNING: bundled Prism VST3 plugins were not found; skipping plugin installation"
        MessageBox MB_OK|MB_ICONEXCLAMATION "Prism was installed, but this package does not contain the optional VST3 plugins.$\r$\n$\r$\nprism-tui and the desktop app are ready to use." /SD IDOK
      ${Else}
        CreateDirectory "$COMMONFILES64\VST3"
        ; xcopy /E recurse, /I treat dest as dir, /Y overwrite without prompt.
        ; The trailing "\*" + "/E" copies each *.vst3 bundle subfolder verbatim.
        nsExec::ExecToLog 'cmd.exe /c xcopy /E /I /Y "$INSTDIR\resources\plugins\VST3\*" "$COMMONFILES64\VST3\"'
        Pop $0
        ${If} $0 != 0
          DetailPrint "ERROR: Prism VST3 plugin copy failed with xcopy exit code $0"
          MessageBox MB_OK|MB_ICONSTOP "Prism VST3 plugin installation failed while copying files to:$\r$\n$COMMONFILES64\VST3$\r$\n$\r$\nxcopy exit code: $0" /SD IDOK
          Abort
        ${EndIf}
      ${EndIf}
    ${Else}
      DetailPrint "Prism VST3 plugins: skipped (opted out)."
    ${EndIf}
  !macroend
!endif

!macro customUnInstall
  ; Remove only Prism's exact machine-PATH entry. A failure is non-fatal so an
  ; otherwise valid uninstall is never blocked.
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PRISM_TUI_INSTALL_DIR", "$INSTDIR\resources\tui").r0'
  ${If} $0 == 0
    DetailPrint "WARNING: could not prepare the Prism TUI PATH removal"
  ${Else}
    nsExec::ExecToLog `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& { $$ErrorActionPreference = 'Stop'; $$entry = $$env:PRISM_TUI_INSTALL_DIR; if ([string]::IsNullOrWhiteSpace($$entry)) { exit 10 }; $$legacyEntry = $$null; $$removeLegacy = $$false; if ($$entry -match '\s') { $$legacyEntry = ($$entry -split '\s', 2)[0]; $$removeLegacy = $$legacyEntry -ine $$entry -and -not (Test-Path -LiteralPath $$legacyEntry -PathType Container) }; $$path = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $$entries = @($$path -split ';' | Where-Object { $$_ -and $$_ -ine $$entry -and (-not $$removeLegacy -or $$_ -ine $$legacyEntry) }); [Environment]::SetEnvironmentVariable('Path', ($$entries -join ';'), 'Machine'); $$updatedPath = [Environment]::GetEnvironmentVariable('Path', 'Machine'); $$matches = @($$updatedPath -split ';' | Where-Object { $$_ -ieq $$entry }); if ($$matches.Count -ne 0) { exit 11 } }"`
    Pop $0
    ${If} $0 == 0
      SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
    ${Else}
      DetailPrint "WARNING: could not remove Prism TUI from the machine PATH (exit code $0)"
    ${EndIf}
  ${EndIf}

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
