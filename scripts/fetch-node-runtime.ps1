param(
  [string]$Version = 'v24.19.0',
  [string]$ExpectedSha256 = '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73'
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$target = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'vendor\runtime\win32-x64'))
$nodeTarget = Join-Path $target 'node.exe'

if (-not $target.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Runtime target escaped the repository: $target"
}

if (Test-Path -LiteralPath $nodeTarget) {
  $installed = (& $nodeTarget --version).Trim()
  if ($installed -ne $Version) {
    throw "Runtime $installed already exists at $target; expected $Version. Refusing to overwrite it."
  }
  Write-Output "Node runtime already verified: $installed"
  exit 0
}

$archiveName = "node-$Version-win-x64.zip"
$downloadDir = Join-Path $repoRoot 'build\downloads'
$archivePath = Join-Path $downloadDir $archiveName
$extractRoot = Join-Path $repoRoot "build\node-runtime-$Version"
$extracted = Join-Path $extractRoot "node-$Version-win-x64"
$uri = "https://nodejs.org/dist/$Version/$archiveName"

New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
if (-not (Test-Path -LiteralPath $archivePath)) {
  Invoke-WebRequest -Uri $uri -OutFile $archivePath -UseBasicParsing
}

$stream = [System.IO.File]::OpenRead($archivePath)
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
  throw "Node archive hash mismatch. Expected $ExpectedSha256, got $actualSha256."
}

if (-not (Test-Path -LiteralPath $extracted)) {
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot
}

if (-not (Test-Path -LiteralPath (Join-Path $extracted 'node.exe'))) {
  throw "Downloaded Node archive did not contain node.exe."
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $extracted '*') -Destination $target -Recurse -Force

$verifiedVersion = (& $nodeTarget --version).Trim()
if ($verifiedVersion -ne $Version) {
  throw "Installed Node runtime reported $verifiedVersion; expected $Version."
}
Write-Output "Node runtime installed and verified: $verifiedVersion"
