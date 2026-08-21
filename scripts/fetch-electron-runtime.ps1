param(
  [string]$Version = 'v35.7.5',
  [string]$ExpectedSha256 = 'b87b2d6167845ece1d373eb37f5ce49868a07ec90203de44b6bd415d6c673c6d'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archiveName = "electron-$Version-win32-x64.zip"
$target = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "build\$archiveName"))
$uri = "https://github.com/electron/electron/releases/download/$Version/$archiveName"

if (-not $target.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Electron archive target escaped the repository: $target"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
if (-not (Test-Path -LiteralPath $target)) {
  Invoke-WebRequest -Uri $uri -OutFile $target -UseBasicParsing
}

$stream = [System.IO.File]::OpenRead($target)
try {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $sha256.ComputeHash($stream)
    $actualSha256 = ([System.BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
} finally {
  $stream.Dispose()
}

if ($actualSha256 -ne $ExpectedSha256.ToLowerInvariant()) {
  throw "Electron archive hash mismatch. Expected $ExpectedSha256, got $actualSha256."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($target)
try {
  if (-not ($archive.Entries | Where-Object FullName -eq 'electron.exe')) {
    throw 'Downloaded Electron archive did not contain electron.exe.'
  }
} finally {
  $archive.Dispose()
}

Write-Output "Electron archive installed and verified: $Version"
