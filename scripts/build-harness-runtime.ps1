[CmdletBinding()]
param(
  [string]$SourceDirectory = '',
  [string]$OutputDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repository = 'https://github.com/deepseek-ai/deepseek-harness.git'
$Tag = 'dsh-v0.1.2-rc.1'
$Commit = 'a66e4702047846cdaa10c66c9d3df3951f5ea70d'
$HarnessVersion = '0.1.2-rc.1'
$PnpmVersion = '11.7.0'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Node = Join-Path $Root 'vendor\runtime\win32-x64\node.exe'
$Pnpm = Join-Path $Root 'node_modules\harness-build-pnpm\bin\pnpm.cjs'
$Assembler = Join-Path $PSScriptRoot 'assemble-harness-runtime.cjs'
if ($OutputDirectory -eq '') { $OutputDirectory = Join-Path $Root "vendor\harness-hoisted-$HarnessVersion" }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$StagingDirectory = "$OutputDirectory.staging-$([guid]::NewGuid().ToString('N'))"
$OwnSource = $SourceDirectory -eq ''
if ($OwnSource) {
  $SourceDirectory = Join-Path ([IO.Path]::GetTempPath()) "dsh-harness-source-$([guid]::NewGuid().ToString('N'))"
}
$SourceDirectory = [IO.Path]::GetFullPath($SourceDirectory)

function Invoke-Checked {
  param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory)
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$FilePath exited with code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
}

function Remove-OwnedTemporaryDirectory {
  param([string]$Path)
  $Resolved = [IO.Path]::GetFullPath($Path)
  $TempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if (-not $Resolved.StartsWith($TempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove a directory outside the temporary root: $Resolved"
  }
  for ($Attempt = 1; $Attempt -le 3 -and (Test-Path -LiteralPath $Resolved); $Attempt += 1) {
    try {
      Remove-Item -LiteralPath $Resolved -Recurse -Force -ErrorAction Stop
    } catch {
      if ($Attempt -lt 3) { Start-Sleep -Milliseconds 300 }
      else { Write-Warning "Temporary Harness source could not be fully removed: $Resolved" }
    }
  }
}

if (-not (Test-Path -LiteralPath $Node -PathType Leaf)) { throw 'Bundled Node.js is missing. Run pnpm runtime:fetch first.' }
if (-not (Test-Path -LiteralPath $Pnpm -PathType Leaf)) { throw 'Pinned Harness build pnpm is missing. Run pnpm install first.' }
if (Test-Path -LiteralPath $OutputDirectory) { throw "Refusing to overwrite an existing Harness runtime: $OutputDirectory" }
if (Test-Path -LiteralPath $StagingDirectory) { throw "Unexpected staging collision: $StagingDirectory" }

$PnpmManifest = Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent (Split-Path -Parent $Pnpm)) 'package.json') | ConvertFrom-Json
if ($PnpmManifest.version -ne $PnpmVersion) { throw "Expected pnpm $PnpmVersion, got $($PnpmManifest.version)." }

$Succeeded = $false
try {
  if ($OwnSource) {
    Invoke-Checked -FilePath 'git.exe' -Arguments @('clone', '--depth', '1', '--branch', $Tag, '--single-branch', $Repository, $SourceDirectory) -WorkingDirectory ([IO.Path]::GetTempPath())
  }
  if (-not (Test-Path -LiteralPath (Join-Path $SourceDirectory '.git'))) { throw "Harness source is not a Git checkout: $SourceDirectory" }
  $ActualCommit = (& git.exe -C $SourceDirectory rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $ActualCommit -ne $Commit) { throw "Harness source commit mismatch: $ActualCommit" }
  $TrackedChanges = @(& git.exe -C $SourceDirectory status --porcelain --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to verify the Harness source worktree.' }
  if ($TrackedChanges.Count -ne 0) { throw "Harness source checkout is not clean:`n$($TrackedChanges -join "`n")" }
  $SourceManifest = Get-Content -Raw -LiteralPath (Join-Path $SourceDirectory 'package.json') | ConvertFrom-Json
  if ($SourceManifest.version -ne $HarnessVersion -or $SourceManifest.packageManager -ne "pnpm@$PnpmVersion") {
    throw "Harness source identity mismatch: $($SourceManifest.version), $($SourceManifest.packageManager)"
  }

  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  $env:CI = '1'
  $env:npm_config_verify_deps_before_run = 'false'
  $env:PATH = "$(Split-Path -Parent $Node);$env:PATH"
  Invoke-Checked -FilePath $Node -Arguments @($Pnpm, 'install', '--frozen-lockfile') -WorkingDirectory $SourceDirectory
  Invoke-Checked -FilePath $Node -Arguments @($Pnpm, 'run', 'build:official') -WorkingDirectory $SourceDirectory
  Invoke-Checked -FilePath $Node -Arguments @($Pnpm, 'run', 'release:verify', '--family', 'dsh') -WorkingDirectory $SourceDirectory
  Invoke-Checked -FilePath $Node -Arguments @($Pnpm, 'run', 'verify-built-package-invariants') -WorkingDirectory $SourceDirectory

  Invoke-Checked -FilePath $Node -Arguments @(
    $Pnpm, '--filter', '@deepseek-ai/dsh', 'deploy', $StagingDirectory,
    '--prod', '--frozen-lockfile', '--ignore-scripts',
    '--config.node-linker=hoisted', '--config.inject-workspace-packages=true'
  ) -WorkingDirectory $SourceDirectory

  $Koffi = Join-Path $StagingDirectory 'node_modules\koffi'
  Invoke-Checked -FilePath $Node -Arguments @('cnoke.cjs', '-P', '.', '-D', 'src/koffi', '--prebuild', '--release') -WorkingDirectory $Koffi
  $NodePty = Join-Path $StagingDirectory 'node_modules\node-pty'
  Invoke-Checked -FilePath $Node -Arguments @('scripts\prebuild.js') -WorkingDirectory $NodePty
  Invoke-Checked -FilePath $Node -Arguments @('scripts\post-install.js') -WorkingDirectory $NodePty
  $SubprocessLocal = Join-Path $StagingDirectory 'node_modules\@deepseek-ai\dsh-subprocess-local'
  Invoke-Checked -FilePath $Node -Arguments @('scripts\ensure-spawn-helper.mjs') -WorkingDirectory $SubprocessLocal

  Invoke-Checked -FilePath $Node -Arguments @(
    $Assembler,
    "--source-root=$SourceDirectory",
    "--runtime-root=$StagingDirectory",
    "--node=$Node",
    "--pnpm=$Pnpm",
    "--repository=$Repository",
    "--tag=$Tag",
    "--commit=$Commit"
  ) -WorkingDirectory $Root
  Invoke-Checked -FilePath $Node -Arguments @((Join-Path $StagingDirectory 'node_modules\@deepseek-ai\dsh\lib\bin.js'), '--version') -WorkingDirectory $Root
  Move-Item -LiteralPath $StagingDirectory -Destination $OutputDirectory
  $Succeeded = $true
  Write-Host "Harness runtime ready: $OutputDirectory"
} finally {
  if (-not $Succeeded -and (Test-Path -LiteralPath $StagingDirectory)) {
    Write-Warning "Incomplete staging directory retained for diagnosis: $StagingDirectory"
  }
  if ($OwnSource -and $Succeeded) { Remove-OwnedTemporaryDirectory -Path $SourceDirectory }
  elseif ($OwnSource) { Write-Warning "Harness source retained for diagnosis: $SourceDirectory" }
}
