param(
  [string]$BuildDir,
  [string]$Configuration = 'Release',
  [string]$Formats = 'VST3,CLAP',
  [switch]$Elevated
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-PrismWindowsInstallPlan {
  param([string]$SourceRoot, [string]$Config, [string]$SelectedFormats, [string]$DestinationRoot)
  if ($Config -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid build configuration.' }
  $formatList = @($SelectedFormats -split ',' | Select-Object -Unique)
  if ($formatList.Count -eq 0 -or @($formatList | Where-Object { $_ -notin @('VST3', 'CLAP') }).Count -gt 0) {
    throw 'Expected VST3 and/or CLAP formats.'
  }
  $products = @(
    @('PrismSpectrum', 'Prism Spectrum'), @('PrismOscilloscope', 'Prism Oscilloscope'),
    @('PrismVUMeter', 'Prism VU Meter'), @('PrismLUFSMeter', 'Prism Loudness Meter'),
    @('PrismVectorscope', 'Prism Vectorscope'), @('PrismSpectrogram', 'Prism Spectrogram'),
    @('PrismWaveform', 'Prism Waveform'), @('PrismWaterfall', 'Prism Waterfall'),
    @('PrismBridge', 'Prism Bridge')
  )
  foreach ($format in $formatList) {
    $destinationDirectory = [IO.Path]::GetFullPath((Join-Path $DestinationRoot $format))
    foreach ($product in $products) {
      $name = $product[1] + '.' + $format.ToLowerInvariant()
      $source = [IO.Path]::GetFullPath((Join-Path $SourceRoot ($product[0] + "_artefacts\$Config\$format\$name")))
      $destination = [IO.Path]::GetFullPath((Join-Path $destinationDirectory $name))
      if ([IO.Path]::GetDirectoryName($destination) -ne $destinationDirectory) { throw "Invalid destination: $destination" }
      $pathType = if ($format -eq 'VST3') { 'Container' } else { 'Leaf' }
      if (-not (Test-Path -LiteralPath $source -PathType $pathType)) { throw "Missing built plugin: $source" }
      if ($format -eq 'VST3') {
        $contents = Join-Path $source 'Contents'
        $binaries = @(Get-ChildItem -LiteralPath $contents -Directory | Where-Object Name -Like '*-win' |
          ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Filter '*.vst3' -File })
        if ($binaries.Count -eq 0) { throw "Missing plugin binary: $source" }
      }
      if ((Test-Path -LiteralPath $destination) -and
          ((Get-Item -LiteralPath $destination -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Cannot install over a linked plugin: $destination"
      }
      [PSCustomObject]@{ Source = $source; Directory = $destinationDirectory; Destination = $destination }
    }
  }
}

function Copy-PrismWindowsPlugins {
  param([object[]]$Plan)
  foreach ($entry in $Plan) {
    New-Item -ItemType Directory -Path $entry.Directory -Force | Out-Null
    Copy-Item -LiteralPath $entry.Source -Destination $entry.Directory -Recurse -Force
    Write-Host "Installed $($entry.Destination)"
  }
}

function Get-PrismElevationArguments {
  param([string]$Script, [string]$SourceRoot, [string]$Config, [string]$SelectedFormats)
  # Encode the complete invocation so Start-Process cannot lose quotes around
  # paths containing spaces, apostrophes, or PowerShell metacharacters.
  $invocation = "& '" + $Script.Replace("'", "''") + "' -BuildDir '" + $SourceRoot.Replace("'", "''") +
    "' -Configuration '" + $Config.Replace("'", "''") + "' -Formats '" + $SelectedFormats.Replace("'", "''") + "' -Elevated"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($invocation))
  return @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded)
}

# Dot-sourcing exposes only the copy/planning functions for isolated tests.
if ($MyInvocation.InvocationName -ne '.') {
  try {
    $commonFiles = $env:CommonProgramW6432
    if (-not $commonFiles) { $commonFiles = [Environment]::GetFolderPath('CommonProgramFiles') }
    $plan = @(Get-PrismWindowsInstallPlan $BuildDir $Configuration $Formats $commonFiles)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      if ($Elevated) { throw 'Windows did not grant administrator permissions.' }
      Write-Host 'Requesting administrator permission to copy the built Prism plugins...'
      $arguments = Get-PrismElevationArguments $PSCommandPath $BuildDir $Configuration $Formats
      try {
        $child = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
      } catch {
        $exception = $_.Exception
        while ($exception) {
          if ($exception -is [ComponentModel.Win32Exception] -and $exception.NativeErrorCode -eq 1223) { exit 1223 }
          $exception = $exception.InnerException
        }
        throw
      }
      if ($child.ExitCode -ne 0) { Write-Host 'The elevated copy failed. Close DAWs using Prism plugins and check permissions in Common Files.' }
      else { Write-Host "Installed $($plan.Count) plugins into $commonFiles." }
      exit $child.ExitCode
    }
    Copy-PrismWindowsPlugins $plan
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
  }
}
