Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
$productName = [string]$packageJson.build.productName
$version = [string]$packageJson.version
$outputDirectory = Join-Path $repoRoot ([string]$packageJson.build.directories.output)

$outputFiles = @(
  (Join-Path $outputDirectory "$productName Setup $version.exe"),
  (Join-Path $outputDirectory "$productName $version.exe"),
  (Join-Path $outputDirectory "win-unpacked\$productName.exe")
)
$lockedFiles = New-Object Collections.Generic.List[string]

foreach ($outputFile in $outputFiles) {
  if (-not (Test-Path -LiteralPath $outputFile -PathType Leaf)) {
    continue
  }

  try {
    $stream = [IO.File]::Open(
      $outputFile,
      [IO.FileMode]::Open,
      [IO.FileAccess]::ReadWrite,
      [IO.FileShare]::None
    )
    $stream.Close()
  } catch {
    $lockedFiles.Add($outputFile)
  }
}

if ($lockedFiles.Count -gt 0) {
  [Console]::Error.WriteLine('Cannot rebuild the Windows distribution because an output executable is still in use.')
  [Console]::Error.WriteLine('Close the Prism app and installer, then run `npm run dist` again:')
  foreach ($lockedFile in $lockedFiles) {
    [Console]::Error.WriteLine("  $lockedFile")
  }
  exit 1
}
