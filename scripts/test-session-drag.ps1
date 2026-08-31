param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][string]$OutputRoot,
  [string]$SourceRoot = '',
  [string]$CredentialSource = '',
  [ValidateSet('documents','workflow','continuity')][string[]]$Cases = @('documents','continuity')
)
$ErrorActionPreference = 'Stop'
$Executable = [IO.Path]::GetFullPath($Executable)
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
if (Test-Path -LiteralPath $OutputRoot) { throw 'Use a fresh evidence directory.' }
if ($Cases -contains 'workflow') {
  if (!(Test-Path -LiteralPath $CredentialSource -PathType Leaf) -or [IO.Path]::GetFileName($CredentialSource) -ne '.credentials.dpapi.json') {
    throw 'Real-model workflow requires an explicit encrypted credential source.'
  }
}
New-Item -ItemType Directory -Path $OutputRoot | Out-Null
$summary = @()
foreach ($case in $Cases) {
  $flag = switch ($case) { 'documents' { 'document-intake' }; 'continuity' { 'continuity' }; 'workflow' { 'dock' } }
  $target = Join-Path $OutputRoot "$case.json"
  $taskArguments = @("--$flag-smoke-file=`"$target`"", '--smoke-cross-workspace')
  if ($SourceRoot) { $taskArguments = @("`"$([IO.Path]::GetFullPath($SourceRoot))`"") + $taskArguments }
  if ($case -eq 'workflow') {
    $taskArguments += @('--smoke-workflow', '--smoke-real-model', "--smoke-credential-source=`"$([IO.Path]::GetFullPath($CredentialSource))`"")
  }
  $taskProcess = Start-Process -FilePath $Executable -ArgumentList $taskArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $OutputRoot "$case.stdout.log") -RedirectStandardError (Join-Path $OutputRoot "$case.stderr.log")
  Write-Output "Started $case PID=$($taskProcess.Id)"
  $taskProcess.WaitForExit(); $taskProcess.Refresh()
  if (!(Test-Path -LiteralPath $target)) { throw "No result for $case; exit=$($taskProcess.ExitCode)" }
  $result = Get-Content -Raw -LiteralPath $target | ConvertFrom-Json
  $entry = [ordered]@{name=$case; exitCode=$taskProcess.ExitCode; ok=$result.ok; result=$target}
  $summary += $entry
  $summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputRoot 'summary.json') -Encoding utf8
  Write-Output ($entry | ConvertTo-Json -Compress)
  if ($taskProcess.ExitCode -ne 0 -or $result.ok -ne $true) { throw "Smoke failed: $case" }
}
