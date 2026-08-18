[CmdletBinding()]
param(
  [string]$InstallerPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'The Windows installer smoke test can only run on Windows.'
}

if ($env:GITHUB_ACTIONS -ne 'true') {
  throw 'This test changes the machine PATH and is restricted to the disposable GitHub Actions runner.'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'The Windows installer smoke test requires an elevated process.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
  $installerCandidates = @(
    Get-ChildItem -LiteralPath (Join-Path $repoRoot 'dist') -Filter '*.exe' -File |
      Where-Object { $_.Name -like '*Setup*.exe' }
  )
  if ($installerCandidates.Count -ne 1) {
    throw "Expected one NSIS setup executable in dist, found $($installerCandidates.Count)."
  }
  $InstallerPath = $installerCandidates[0].FullName
}

$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$tempRoot = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  [IO.Path]::GetTempPath()
} else {
  $env:RUNNER_TEMP
}
$testId = [Guid]::NewGuid().ToString('N')
$installRoot = Join-Path $tempRoot "Prism-$testId Installer Smoke"
$tuiDirectory = Join-Path $installRoot 'resources\tui'
$tuiExecutable = Join-Path $tuiDirectory 'prism-tui.exe'
$uninstallerPath = Join-Path $installRoot 'Uninstall Prism.exe'
$legacyEntry = ($tuiDirectory -split '\s', 2)[0]
$machinePathBefore = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$uninstalled = $false
$legacyDirectoryCreated = $false

function Get-PathEntries {
  param([AllowNull()][string]$Value)

  return @($Value -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Assert-PathEntriesEqual {
  param(
    [string[]]$Expected,
    [string[]]$Actual,
    [string]$Context
  )

  if ($Expected.Count -ne $Actual.Count) {
    throw "$Context entry count mismatch. Expected $($Expected.Count), got $($Actual.Count)."
  }

  for ($index = 0; $index -lt $Expected.Count; $index += 1) {
    if (-not [string]::Equals($Expected[$index], $Actual[$index], [StringComparison]::OrdinalIgnoreCase)) {
      throw "$Context differs at index $index. Expected '$($Expected[$index])', got '$($Actual[$index])'."
    }
  }
}

function Invoke-CheckedProcess {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [string]$Arguments = '',
    [hashtable]$Environment = @{},
    [switch]$CaptureOutput
  )

  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = $Arguments
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.RedirectStandardOutput = $CaptureOutput
  $startInfo.RedirectStandardError = $CaptureOutput
  foreach ($name in $Environment.Keys) {
    $startInfo.EnvironmentVariables[$name] = [string]$Environment[$name]
  }

  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Could not start $FilePath."
  }

  $stdout = ''
  $stderr = ''
  if ($CaptureOutput) {
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
  }
  $process.WaitForExit()

  if ($process.ExitCode -ne 0) {
    throw "$FilePath exited with code $($process.ExitCode).`n$stdout`n$stderr"
  }

  return [pscustomobject]@{
    Stdout = $stdout
    Stderr = $stderr
  }
}

try {
  if ([string]::Equals($legacyEntry, $tuiDirectory, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The smoke-test installation path must contain whitespace: $installRoot"
  }
  if (Test-Path -LiteralPath $legacyEntry -PathType Container) {
    throw "Refusing to use an existing directory as the legacy PATH fixture: $legacyEntry"
  }

  $originalEntries = @(Get-PathEntries $machinePathBefore)
  foreach ($entry in $originalEntries) {
    if ([string]::Equals($entry, $tuiDirectory, [StringComparison]::OrdinalIgnoreCase) -or
        [string]::Equals($entry, $legacyEntry, [StringComparison]::OrdinalIgnoreCase)) {
      throw "The machine PATH already contains a smoke-test entry: $entry"
    }
  }

  $seededEntries = @($originalEntries) + $legacyEntry
  [Environment]::SetEnvironmentVariable('Path', ($seededEntries -join ';'), 'Machine')

  # NSIS requires /D to be the final argument and consumes the remainder of the
  # command line as the install directory, including spaces.
  Invoke-CheckedProcess -FilePath $InstallerPath -Arguments "/S /D=$installRoot" | Out-Null

  if (-not (Test-Path -LiteralPath $tuiExecutable -PathType Leaf)) {
    throw "The installer did not install prism-tui.exe at $tuiExecutable."
  }
  if (-not (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
    throw "The installer did not create the expected uninstaller at $uninstallerPath."
  }

  $installedEntries = @(Get-PathEntries ([Environment]::GetEnvironmentVariable('Path', 'Machine')))
  $expectedInstalledEntries = @($originalEntries) + $tuiDirectory
  Assert-PathEntriesEqual -Expected $expectedInstalledEntries -Actual $installedEntries -Context 'Installed machine PATH'

  $matchingTuiEntries = @(
    $installedEntries | Where-Object {
      [string]::Equals($_, $tuiDirectory, [StringComparison]::OrdinalIgnoreCase)
    }
  )
  if ($matchingTuiEntries.Count -ne 1) {
    throw "Expected one Prism TUI PATH entry, found $($matchingTuiEntries.Count)."
  }
  if ($installedEntries -icontains $legacyEntry) {
    throw "The installer left the legacy truncated PATH entry in place: $legacyEntry"
  }

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $launchPath = (@($installedEntries) + @(Get-PathEntries $userPath)) -join ';'
  $launchResult = Invoke-CheckedProcess -FilePath $env:ComSpec `
    -Arguments '/D /C prism-tui.exe --version' `
    -Environment @{ Path = $launchPath } `
    -CaptureOutput
  if ($launchResult.Stdout.Trim() -notmatch '^prism-tui\s+') {
    throw "prism-tui did not return the expected version output: $($launchResult.Stdout.Trim())"
  }

  # Reinstall with the legacy prefix backed by a real directory. The safe
  # migration must now preserve that entry while continuing to deduplicate the
  # complete Prism TUI path.
  New-Item -ItemType Directory -Path $legacyEntry | Out-Null
  $legacyDirectoryCreated = $true
  [Environment]::SetEnvironmentVariable('Path', ((@($installedEntries) + $legacyEntry) -join ';'), 'Machine')
  Invoke-CheckedProcess -FilePath $InstallerPath -Arguments "/S /D=$installRoot" | Out-Null

  $reinstalledEntries = @(Get-PathEntries ([Environment]::GetEnvironmentVariable('Path', 'Machine')))
  $expectedReinstalledEntries = @($originalEntries) + $legacyEntry + $tuiDirectory
  Assert-PathEntriesEqual -Expected $expectedReinstalledEntries -Actual $reinstalledEntries -Context 'Reinstalled machine PATH'

  Invoke-CheckedProcess -FilePath $uninstallerPath -Arguments '/S' | Out-Null
  $uninstalled = $true

  $uninstalledEntries = @(Get-PathEntries ([Environment]::GetEnvironmentVariable('Path', 'Machine')))
  $expectedUninstalledEntries = @($originalEntries) + $legacyEntry
  Assert-PathEntriesEqual -Expected $expectedUninstalledEntries -Actual $uninstalledEntries -Context 'Uninstalled machine PATH'
  if ($uninstalledEntries -icontains $tuiDirectory) {
    throw "The uninstaller left the Prism TUI PATH entry in place: $tuiDirectory"
  }

  Write-Host "Windows installer PATH smoke test passed for $InstallerPath"
} finally {
  if (-not $uninstalled -and (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
    try {
      Invoke-CheckedProcess -FilePath $uninstallerPath -Arguments '/S' | Out-Null
    } catch {
      Write-Warning "Smoke-test uninstall cleanup failed: $($_.Exception.Message)"
    }
  }

  [Environment]::SetEnvironmentVariable('Path', $machinePathBefore, 'Machine')

  if (Test-Path -LiteralPath $installRoot) {
    $fullTempRoot = [IO.Path]::GetFullPath($tempRoot).TrimEnd('\') + '\'
    $fullInstallRoot = [IO.Path]::GetFullPath($installRoot)
    if ($fullInstallRoot.StartsWith($fullTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $fullInstallRoot -Recurse -Force
    } else {
      Write-Warning "Refusing to remove unexpected smoke-test directory: $fullInstallRoot"
    }
  }

  if ($legacyDirectoryCreated -and (Test-Path -LiteralPath $legacyEntry -PathType Container)) {
    $fullTempRoot = [IO.Path]::GetFullPath($tempRoot).TrimEnd('\') + '\'
    $fullLegacyEntry = [IO.Path]::GetFullPath($legacyEntry)
    if ($fullLegacyEntry.StartsWith($fullTempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $fullLegacyEntry -Recurse -Force
    } else {
      Write-Warning "Refusing to remove unexpected legacy fixture directory: $fullLegacyEntry"
    }
  }
}
