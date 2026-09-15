; Custom NSIS include for electron-builder. Retained at its original path.
; Independent VST3/CLAP options default on, including silent installs.
; /VST3=0|1 and /CLAP=0|1 allow scripted selection and installer smoke tests.

!include "LogicLib.nsh"
!include "WinMessages.nsh"

!ifndef BUILD_UNINSTALLER
  !include "nsDialogs.nsh"
  !include "FileFunc.nsh"

  Var PRISM_VST_CHECKBOX
  Var PRISM_VST_STATE
  Var PRISM_CLAP_CHECKBOX
  Var PRISM_CLAP_STATE

  !macro customHeader
    ; electron-builder disables the standard NSIS details view in common.nsh.
    ; customHeader is inserted after common.nsh, so this supported hook can
    ; override that default without modifying electron-builder's templates.
    ShowInstDetails show

    ; This hidden section runs before electron-builder's main install section.
    ; Its message therefore remains visible while the bundled application is
    ; extracted and atomically copied into the selected installation folder.
    Section "-Prism install status"
      ${IfNot} ${Silent}
        SetDetailsPrint both
        DetailPrint "Step 1 of 4: Unpacking Prism application files. This may take a minute..."
      ${EndIf}
    SectionEnd
  !macroend

  !macro customInit
    ; Silent installs skip the options page, so default to installing plugins.
    StrCpy $PRISM_VST_STATE ${BST_CHECKED}
    StrCpy $PRISM_CLAP_STATE ${BST_CHECKED}
    ${GetParameters} $0
    ClearErrors
    ${GetOptions} $0 "/VST3=" $1
    ${IfNot} ${Errors}
      ${If} $1 == "0"
        StrCpy $PRISM_VST_STATE ${BST_UNCHECKED}
      ${ElseIf} $1 != "1"
        MessageBox MB_OK|MB_ICONSTOP "Expected /VST3=0 or /VST3=1." /SD IDOK
        SetErrorLevel 2
        Abort
      ${EndIf}
    ${EndIf}
    ClearErrors
    ${GetOptions} $0 "/CLAP=" $1
    ${IfNot} ${Errors}
      ${If} $1 == "0"
        StrCpy $PRISM_CLAP_STATE ${BST_UNCHECKED}
      ${ElseIf} $1 != "1"
        MessageBox MB_OK|MB_ICONSTOP "Expected /CLAP=0 or /CLAP=1." /SD IDOK
        SetErrorLevel 2
        Abort
      ${EndIf}
    ${EndIf}
  !macroend

  ; NOTE on parse order: this file is `!include`d before electron-builder's main
  ; installer template, so MUI references live inside inserted macro bodies.
  !macro customPageAfterChangeDir
    Page custom prismVstOptionsPage prismVstOptionsPageLeave

    Function prismVstOptionsPage
      !insertmacro MUI_HEADER_TEXT "Audio Plugins" "Choose the Prism plugin formats to install."

      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateCheckBox} 0 0u 100% 12u "Install Prism VST3 plugins (recommended)"
      Pop $PRISM_VST_CHECKBOX
      ${NSD_SetState} $PRISM_VST_CHECKBOX $PRISM_VST_STATE

      ${NSD_CreateCheckBox} 0 20u 100% 12u "Install Prism CLAP plugins (recommended)"
      Pop $PRISM_CLAP_CHECKBOX
      ${NSD_SetState} $PRISM_CLAP_CHECKBOX $PRISM_CLAP_STATE

      ${NSD_CreateLabel} 0 42u 100% 90u "Each format includes eight analyzers plus Prism Bridge.$\r$\n$\r$\nVST3: $COMMONFILES64\VST3$\r$\nCLAP: $COMMONFILES64\CLAP$\r$\n$\r$\nRescan plugins in a DAW that supports the selected format.$\r$\nPrism Bridge sends a track or bus to the Prism app.$\r$\nUncheck both to install only the app and prism-tui."
      Pop $0

      nsDialogs::Show
    FunctionEnd

    Function prismVstOptionsPageLeave
      ${NSD_GetState} $PRISM_VST_CHECKBOX $PRISM_VST_STATE
      ${NSD_GetState} $PRISM_CLAP_CHECKBOX $PRISM_CLAP_STATE
    FunctionEnd
  !macroend

  !macro customInstall
    SetDetailsPrint both

    ${IfNot} ${FileExists} "$INSTDIR\resources\tui\prism-tui.exe"
      DetailPrint "ERROR: bundled prism-tui.exe was not found"
      MessageBox MB_OK|MB_ICONSTOP "The bundled prism-tui executable was not found.$\r$\n$\r$\nMissing path:$\r$\n$INSTDIR\resources\tui\prism-tui.exe" /SD IDOK
      Abort
    ${EndIf}

    DetailPrint "Step 2 of 4: Adding prism-tui to the machine PATH..."

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
      DetailPrint "Step 3 of 4: Installing Prism VST3 plugins to $COMMONFILES64\VST3..."

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
        DetailPrint "Installed Prism VST3 plugins."
      ${EndIf}
    ${Else}
      DetailPrint "Step 3 of 4: Prism VST3 plugins skipped (opted out)."
    ${EndIf}

    ${If} $PRISM_CLAP_STATE == ${BST_CHECKED}
      DetailPrint "Step 3 of 4: Installing Prism CLAP plugins to $COMMONFILES64\CLAP..."
      ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\CLAP\*.clap"
        DetailPrint "WARNING: bundled Prism CLAP plugins were not found; skipping CLAP installation"
        MessageBox MB_OK|MB_ICONEXCLAMATION "Prism was installed, but this package does not contain the optional CLAP plugins." /SD IDOK
      ${Else}
        ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\CLAP\Prism Spectrum.clap"
          MessageBox MB_OK|MB_ICONSTOP "Missing bundled CLAP plugin: Prism Spectrum.clap" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
        ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\CLAP\Prism Oscilloscope.clap"
          MessageBox MB_OK|MB_ICONSTOP "Missing bundled CLAP plugin: Prism Oscilloscope.clap" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
        ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\CLAP\Prism VU Meter.clap"
          MessageBox MB_OK|MB_ICONSTOP "Missing bundled CLAP plugin: Prism VU Meter.clap" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
        ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\CLAP\Prism Loudness Meter.clap"
          MessageBox MB_OK|MB_ICONSTOP "Missing bundled CLAP plugin: Prism Loudness Meter.clap" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
        ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\CLAP\Prism Vectorscope.clap"
          MessageBox MB_OK|MB_ICONSTOP "Missing bundled CLAP plugin: Prism Vectorscope.clap" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
        ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\CLAP\Prism Spectrogram.clap"
          MessageBox MB_OK|MB_ICONSTOP "Missing bundled CLAP plugin: Prism Spectrogram.clap" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
        ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\CLAP\Prism Waveform.clap"
          MessageBox MB_OK|MB_ICONSTOP "Missing bundled CLAP plugin: Prism Waveform.clap" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
        ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\CLAP\Prism Waterfall.clap"
          MessageBox MB_OK|MB_ICONSTOP "Missing bundled CLAP plugin: Prism Waterfall.clap" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
        ${IfNot} ${FileExists} "$INSTDIR\resources\plugins\CLAP\Prism Bridge.clap"
          MessageBox MB_OK|MB_ICONSTOP "Missing bundled CLAP plugin: Prism Bridge.clap" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
        CreateDirectory "$COMMONFILES64\CLAP"
        ClearErrors
        CopyFiles /SILENT "$INSTDIR\resources\plugins\CLAP\Prism Spectrum.clap" "$COMMONFILES64\CLAP"
        CopyFiles /SILENT "$INSTDIR\resources\plugins\CLAP\Prism Oscilloscope.clap" "$COMMONFILES64\CLAP"
        CopyFiles /SILENT "$INSTDIR\resources\plugins\CLAP\Prism VU Meter.clap" "$COMMONFILES64\CLAP"
        CopyFiles /SILENT "$INSTDIR\resources\plugins\CLAP\Prism Loudness Meter.clap" "$COMMONFILES64\CLAP"
        CopyFiles /SILENT "$INSTDIR\resources\plugins\CLAP\Prism Vectorscope.clap" "$COMMONFILES64\CLAP"
        CopyFiles /SILENT "$INSTDIR\resources\plugins\CLAP\Prism Spectrogram.clap" "$COMMONFILES64\CLAP"
        CopyFiles /SILENT "$INSTDIR\resources\plugins\CLAP\Prism Waveform.clap" "$COMMONFILES64\CLAP"
        CopyFiles /SILENT "$INSTDIR\resources\plugins\CLAP\Prism Waterfall.clap" "$COMMONFILES64\CLAP"
        CopyFiles /SILENT "$INSTDIR\resources\plugins\CLAP\Prism Bridge.clap" "$COMMONFILES64\CLAP"
        ${If} ${Errors}
          DetailPrint "ERROR: Prism CLAP plugin copy failed"
          MessageBox MB_OK|MB_ICONSTOP "Prism CLAP plugin installation failed while copying files to:$\r$\n$COMMONFILES64\CLAP" /SD IDOK
          SetErrorLevel 1
          Abort
        ${EndIf}
        DetailPrint "Installed Prism CLAP plugins."
      ${EndIf}
    ${Else}
      DetailPrint "Step 3 of 4: Prism CLAP plugins skipped (opted out)."
    ${EndIf}

    DetailPrint "Step 4 of 4: Finishing Prism installation..."
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
  RMDir /r "$COMMONFILES64\VST3\Prism Waterfall.vst3"
  RMDir /r "$COMMONFILES64\VST3\Prism Bridge.vst3"
  Delete "$COMMONFILES64\CLAP\Prism Spectrum.clap"
  Delete "$COMMONFILES64\CLAP\Prism Oscilloscope.clap"
  Delete "$COMMONFILES64\CLAP\Prism VU Meter.clap"
  Delete "$COMMONFILES64\CLAP\Prism Loudness Meter.clap"
  Delete "$COMMONFILES64\CLAP\Prism Vectorscope.clap"
  Delete "$COMMONFILES64\CLAP\Prism Spectrogram.clap"
  Delete "$COMMONFILES64\CLAP\Prism Waveform.clap"
  Delete "$COMMONFILES64\CLAP\Prism Waterfall.clap"
  Delete "$COMMONFILES64\CLAP\Prism Bridge.clap"
!macroend
