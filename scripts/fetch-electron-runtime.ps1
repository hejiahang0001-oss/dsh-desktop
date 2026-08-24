param(
  [string]$Version = 'v43.4.1',
  [string]$ExpectedSha256 = 'c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a',
  [ValidateRange(1, 5)]
  [int]$MaxAttempts = 3
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archiveName = "electron-$Version-win32-x64.zip"
$target = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "build\$archiveName"))
$partial = "$target.partial"
$uri = "https://github.com/electron/electron/releases/download/$Version/$archiveName"

if (-not $target.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Electron archive target escaped the repository: $target"
}

function Get-Sha256([string]$FilePath) {
  $stream = [System.IO.File]::OpenRead($FilePath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hashBytes = $sha256.ComputeHash($stream)
      return ([System.BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Assert-ElectronArchive([string]$FilePath) {
  $actualSha256 = Get-Sha256 $FilePath
  if ($actualSha256 -ne $ExpectedSha256.ToLowerInvariant()) {
    throw "Electron archive hash mismatch. Expected $ExpectedSha256, got $actualSha256."
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($FilePath)
  try {
    if (-not ($archive.Entries | Where-Object FullName -eq 'electron.exe')) {
      throw 'Downloaded Electron archive did not contain electron.exe.'
    }
  } finally {
    $archive.Dispose()
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
if (Test-Path -LiteralPath $target) {
  try {
    Assert-ElectronArchive $target
    Write-Output "Electron archive already installed and verified: $Version"
    return
  } catch {
    Remove-Item -LiteralPath $target -Force
  }
}

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
  if (Test-Path -LiteralPath $partial) {
    Remove-Item -LiteralPath $partial -Force
  }
  try {
    Invoke-WebRequest -Uri $uri -OutFile $partial -UseBasicParsing
    Assert-ElectronArchive $partial
    Move-Item -LiteralPath $partial -Destination $target -Force
    Write-Output "Electron archive installed and verified: $Version"
    return
  } catch {
    if (Test-Path -LiteralPath $partial) {
      Remove-Item -LiteralPath $partial -Force
    }
    if ($attempt -eq $MaxAttempts) {
      throw
    }
    Start-Sleep -Seconds ([Math]::Pow(2, $attempt - 1))
  }
}
