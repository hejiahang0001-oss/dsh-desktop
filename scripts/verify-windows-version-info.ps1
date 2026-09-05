param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,
  [string]$ExpectedProductName = 'DSH Desktop',
  [string]$ExpectedVersion = ''
)

$ErrorActionPreference = 'Stop'
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath).Path
if (-not $ExpectedVersion) {
  $manifestPath = Join-Path $PSScriptRoot '..\package.json'
  $ExpectedVersion = (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).version
}

$info = (Get-Item -LiteralPath $resolvedExecutable).VersionInfo
$actualFileVersion = (($info.FileVersion -split ' ')[0] -replace ',', '.').Trim()
$actualProductVersion = (($info.ProductVersion -split ' ')[0] -replace ',', '.').Trim()

function Get-NormalizedVersion([string]$Value) {
  $parts = @($Value -split '\.')
  if ($parts.Count -lt 1 -or $parts.Count -gt 4) { return $null }
  $numbers = [System.Collections.Generic.List[int]]::new()
  foreach ($part in $parts) {
    if ($part -notmatch '^\d+$') { return $null }
    $numbers.Add([int]$part)
  }
  while ($numbers.Count -lt 4) { $numbers.Add(0) }
  return ($numbers -join '.')
}

$expectedNormalizedVersion = Get-NormalizedVersion $ExpectedVersion
$fileNormalizedVersion = Get-NormalizedVersion $actualFileVersion
$productNormalizedVersion = Get-NormalizedVersion $actualProductVersion
$expectedOriginalFilename = "$ExpectedProductName.exe"
$originalFilenameAllowed = [string]::IsNullOrEmpty($info.OriginalFilename) -or $info.OriginalFilename -eq $expectedOriginalFilename
$valid = $info.ProductName -eq $ExpectedProductName `
  -and $info.FileDescription -eq $ExpectedProductName `
  -and $info.InternalName -eq $ExpectedProductName `
  -and $null -ne $expectedNormalizedVersion `
  -and $fileNormalizedVersion -eq $expectedNormalizedVersion `
  -and $productNormalizedVersion -eq $expectedNormalizedVersion `
  -and $info.CompanyName -eq 'DSH Desktop' `
  -and $originalFilenameAllowed `
  -and $info.OriginalFilename -ne 'electron.exe'

$result = [ordered]@{
  ok = $valid
  path = $resolvedExecutable
  expectedProductName = $ExpectedProductName
  expectedVersion = $ExpectedVersion
  productName = $info.ProductName
  fileDescription = $info.FileDescription
  internalName = $info.InternalName
  fileVersion = $actualFileVersion
  productVersion = $actualProductVersion
  companyName = $info.CompanyName
  originalFilename = $info.OriginalFilename
  expectedOriginalFilename = $expectedOriginalFilename
}
$result | ConvertTo-Json -Compress
if (-not $valid) { exit 1 }
