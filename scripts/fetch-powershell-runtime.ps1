[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-PsPlainPath([string]$Path, [bool]$AllowMissing = $false) {
    $full = [IO.Path]::GetFullPath($Path)
    $current = $full
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if ($item) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked path refused: $current" }
        } elseif (($current -eq $full) -and -not $AllowMissing) { throw "Missing path: $current" }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
    return $full
}

function Write-PsEvidence([string]$Path, $Value) {
    $json = $Value | ConvertTo-Json -Depth 12
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json + "`n")
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}

function Get-PsZipPlan([string]$Archive) {
    Assert-PsPlainPath $Archive | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        if ($zip.Entries.Count -gt 8192) { throw 'ZIP entry limit exceeded' }
        $names = [Collections.Generic.Dictionary[string,bool]]::new([StringComparer]::OrdinalIgnoreCase)
        $plan = [Collections.Generic.List[object]]::new()
        [long]$total = 0
        foreach ($entry in $zip.Entries) {
            $raw = $entry.FullName
            if ([string]::IsNullOrWhiteSpace($raw) -or $raw.Contains('\') -or $raw.StartsWith('/') -or $raw.Contains(':')) { throw "Unsafe ZIP path: $raw" }
            $isDirectory = $raw.EndsWith('/')
            $name = $raw.TrimEnd('/')
            if (-not $name -or $name.Length -gt 220) { throw "Invalid ZIP path length: $raw" }
            $parts = $name.Split('/')
            foreach ($part in $parts) {
                if (-not $part -or $part -in @('.', '..') -or $part -match '[\x00-\x1f<>:"|?*]' -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)') { throw "Unsafe ZIP component: $raw" }
            }
            [uint32]$attributes = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$entry.ExternalAttributes), 0)
            $unixType = ($attributes -shr 16) -band 0xf000
            if (($unixType -ne 0) -and ($unixType -ne 0x8000) -and ($unixType -ne 0x4000)) { throw "ZIP link/special file refused: $raw" }
            if (($attributes -band 0x400) -ne 0) { throw "ZIP reparse entry refused: $raw" }
            if (($unixType -eq 0x4000) -and -not $isDirectory) { throw "Directory type mismatch: $raw" }
            if ($names.ContainsKey($name)) { throw "ZIP duplicate/case collision: $raw" }
            $names.Add($name, $isDirectory)
            if ($entry.Length -gt 134217728 -or $entry.Length -lt 0) { throw "ZIP per-file size limit: $raw" }
            if ($isDirectory -and $entry.Length -ne 0) { throw "Directory payload refused: $raw" }
            $total += $entry.Length
            if ($total -gt 1073741824) { throw 'ZIP expanded-size limit exceeded' }
            $plan.Add([pscustomobject]@{ name=$name; directory=$isDirectory; size=$entry.Length; compressedSize=$entry.CompressedLength })
        }
        foreach ($record in $plan) {
            $ancestor = $record.name
            while ($ancestor.Contains('/')) {
                $ancestor = $ancestor.Substring(0, $ancestor.LastIndexOf('/'))
                if ($names.ContainsKey($ancestor) -and -not $names[$ancestor]) { throw "ZIP file/ancestor collision: $ancestor" }
            }
        }
        return [pscustomobject]@{ entries=@($plan.ToArray()); totalBytes=$total }
    } finally { $zip.Dispose() }
}

function Expand-PsVerifiedZip([string]$Archive, [string]$Destination, $Plan) {
    Assert-PsPlainPath $Destination $true | Out-Null
    if (Test-Path -LiteralPath $Destination) { throw 'Extraction destination already exists; preserve it' }
    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    $root = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($record in $Plan.entries) {
            $target = [IO.Path]::GetFullPath([IO.Path]::Combine($Destination, $record.name.Replace('/', '\')))
            if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'ZIP destination escaped private root' }
            Assert-PsPlainPath $target $true | Out-Null
            if ($record.directory) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            Assert-PsPlainPath ([IO.Path]::GetDirectoryName($target)) | Out-Null
            $entry = $zip.GetEntry($record.name)
            if (-not $entry -or $entry.Length -ne $record.size) { throw 'ZIP changed after validation' }
            $inputStream = $entry.Open()
            $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $inputStream.CopyTo($outputStream); $outputStream.Flush($true) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
            if ((Get-Item -LiteralPath $target).Length -ne $record.size) { throw 'Extracted file length mismatch' }
        }
    } finally { $zip.Dispose() }
}

# Dot-sourcing exposes only the path/ZIP guards to focused fixture tests.
if ($MyInvocation.InvocationName -eq '.') { return }

$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$profilePath = Join-Path $project 'runtime/powershell/profile.json'
Assert-PsPlainPath $profilePath | Out-Null
$pin = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
if ($pin.version -notmatch '^\d+\.\d+\.\d+$' -or $pin.tag -ne "v$($pin.version)" -or $pin.asset -ne "PowerShell-$($pin.version)-win-x64.zip" -or $pin.sha256 -notmatch '^[0-9a-f]{64}$' -or $pin.commit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid fixed runtime profile' }
$expectedUrl = "https://github.com/PowerShell/PowerShell/releases/download/$($pin.tag)/$($pin.asset)"
if ($pin.repository -ne 'https://github.com/PowerShell/PowerShell' -or $pin.url -ne $expectedUrl -or $pin.promotionAllowed -ne $false) { throw 'Runtime profile source/promotion boundary failed' }
$base = Join-Path $project 'artifacts/powershell-runtime-20261007'
Assert-PsPlainPath $base $true | Out-Null
[IO.Directory]::CreateDirectory($base) | Out-Null
$run = Join-Path $base ('acquire-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($run) | Out-Null
$startedAt = [DateTime]::UtcNow.ToString('o')
$phase = 'metadata'
try {
    $headers = @{ 'User-Agent'='lulu-fixed-runtime-acquisition'; Accept='application/vnd.github+json' }
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/PowerShell/PowerShell/releases/tags/$($pin.tag)" -Headers $headers -TimeoutSec 60
    $tagRef = Invoke-RestMethod -Uri "https://api.github.com/repos/PowerShell/PowerShell/git/ref/tags/$($pin.tag)" -Headers $headers -TimeoutSec 60
    $tag = Invoke-RestMethod -Uri "https://api.github.com/repos/PowerShell/PowerShell/git/tags/$($pin.tagObject)" -Headers $headers -TimeoutSec 60
    $asset = @($release.assets | Where-Object { $_.name -eq $pin.asset })
    if ($release.id -ne $pin.releaseId -or $release.draft -or $release.prerelease -or $release.tag_name -ne $pin.tag -or $asset.Count -ne 1) { throw 'Official release identity changed' }
    if ($tagRef.object.sha -ne $pin.tagObject -or $tag.object.type -ne 'commit' -or $tag.object.sha -ne $pin.commit) { throw 'Official tag/commit identity changed' }
    if ($asset[0].id -ne $pin.assetId -or $asset[0].size -ne $pin.size -or $asset[0].digest -ne "sha256:$($pin.sha256)" -or $asset[0].browser_download_url -ne $pin.url -or -not $release.body.ToLowerInvariant().Contains($pin.sha256)) { throw 'Official asset metadata changed' }
    Write-PsEvidence (Join-Path $run 'metadata.json') ([ordered]@{ checkedAt=[DateTime]::UtcNow.ToString('o'); releaseId=$release.id; publishedAt=$release.published_at; tag=$tagRef.object; commit=$tag.object; tagVerification=$tag.verification | Select-Object verified,reason; asset=$asset[0] | Select-Object id,name,size,digest,browser_download_url; profileSha256=(Get-FileHash -LiteralPath $profilePath -Algorithm SHA256).Hash.ToLowerInvariant(); scriptSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant() })
    $phase = 'download'
    $archive = Join-Path $run $pin.asset
    $curl = Join-Path ([Environment]::GetFolderPath('System')) 'curl.exe'
    Assert-PsPlainPath $curl | Out-Null
    if (Test-Path -LiteralPath $archive) { throw 'Download destination already exists' }
    # Use explicit overall/low-speed bounds. Do not infer progress from directory
    # length while another process holds the output open; verify after close.
    $curlArgs = @('--location','--fail','--proto','=https','--proto-redir','=https','--connect-timeout','20','--max-time','1200','--speed-time','60','--speed-limit','1024','--max-filesize',[string]$pin.size,'--silent','--show-error','--output',$archive,'--write-out','%{http_code} %{size_download}',$pin.url)
    $downloadResult = & $curl @curlArgs 2> (Join-Path $run 'download-stderr.log')
    $downloadExit = $LASTEXITCODE
    Write-PsEvidence (Join-Path $run 'download.json') ([ordered]@{ transport='Windows system curl'; executable=$curl; exitCode=$downloadExit; summary=[string]$downloadResult; timeoutSeconds=1200; stalledTransferSeconds=60; fixedOfficialSource=$pin.url })
    if ($downloadExit -ne 0) { throw "Official ZIP transfer failed: curl exit $downloadExit" }
    if ((Get-Item -LiteralPath $archive).Length -ne $pin.size -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.sha256) { throw 'Downloaded archive size/hash failed' }
    $phase = 'zip-validation'
    $plan = Get-PsZipPlan $archive
    Write-PsEvidence (Join-Path $run 'zip-plan.json') $plan
    $runtime = Join-Path $run 'runtime'
    $phase = 'extraction'
    Expand-PsVerifiedZip $archive $runtime $plan
    $manifest = @($plan.entries | Where-Object { -not $_.directory } | ForEach-Object {
        $file = Join-Path $runtime $_.name
        Assert-PsPlainPath $file | Out-Null
        [pscustomobject]@{ path=$_.name; size=(Get-Item -LiteralPath $file).Length; sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    $manifestPath = Join-Path $runtime 'runtime-manifest.json'
    Write-PsEvidence $manifestPath $manifest
    $manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($manifestSha256 -ne $pin.manifestSha256 -or $manifest.Count -ne $pin.fileCount -or $plan.totalBytes -ne $pin.expandedBytes) { throw 'Extracted payload manifest does not match fixed profile' }
    $phase = 'license-and-signatures'
    $license = Get-Content -LiteralPath (Join-Path $runtime $pin.licenseFile) -Raw
    $notices = Get-Content -LiteralPath (Join-Path $runtime $pin.noticesFile) -Raw
    if ($license -notmatch 'MIT License' -or $license -notmatch 'Microsoft Corporation' -or $notices.Length -lt 1000) { throw 'Required license/third-party notices missing' }
    $signatures = @($pin.criticalSignedFiles | ForEach-Object {
        $sig = Get-AuthenticodeSignature -LiteralPath (Join-Path $runtime $_)
        [pscustomobject]@{ path=$_; status=[string]$sig.Status; statusMessage=$sig.StatusMessage; subject=$sig.SignerCertificate.Subject; thumbprint=$sig.SignerCertificate.Thumbprint; issuer=$sig.SignerCertificate.Issuer; timestampSubject=if ($sig.TimeStamperCertificate) {$sig.TimeStamperCertificate.Subject} else {$null} }
    })
    Write-PsEvidence (Join-Path $run 'signatures.json') $signatures
    if (@($signatures | Where-Object { $_.status -ne 'Valid' -or $_.subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)' }).Count -ne 0) { throw 'Critical Microsoft Authenticode signature failed' }
    $phase = 'version-probe'
    $pwsh = Join-Path $runtime 'pwsh.exe'
    if ((Get-FileHash -LiteralPath $pwsh -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.executableSha256) { throw 'Executable does not match fixed profile' }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $pwsh
    $info.Arguments = '-NoLogo -NoProfile -NonInteractive -Command "[pscustomobject]@{version=$PSVersionTable.PSVersion.ToString();edition=$PSVersionTable.PSEdition;architecture=[Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString();framework=[Runtime.InteropServices.RuntimeInformation]::FrameworkDescription;home=$PSHOME}|ConvertTo-Json -Compress"'
    $info.UseShellExecute = $false; $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    $info.WorkingDirectory = $run
    $info.EnvironmentVariables.Clear()
    foreach ($key in @('SystemRoot','WINDIR','TEMP','TMP')) { $value=[Environment]::GetEnvironmentVariable($key); if ($value) { $info.EnvironmentVariables[$key]=$value } }
    $info.EnvironmentVariables['POWERSHELL_TELEMETRY_OPTOUT']='1'
    $info.EnvironmentVariables['POWERSHELL_UPDATECHECK']='Off'
    $info.EnvironmentVariables['PSModuleAnalysisCachePath']=(Join-Path $run 'probe-module-analysis-cache')
    $process = [Diagnostics.Process]::new(); $process.StartInfo=$info
    if (-not $process.Start()) { throw 'Version probe did not start' }
    $stdoutTask=$process.StandardOutput.ReadToEndAsync(); $stderrTask=$process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(30000)) { $process.Kill(); $process.WaitForExit(); throw 'Version probe timed out' }
    $stdout=$stdoutTask.GetAwaiter().GetResult(); $stderr=$stderrTask.GetAwaiter().GetResult(); $exitCode=$process.ExitCode; $process.Dispose()
    Write-PsEvidence (Join-Path $run 'version-probe.json') ([ordered]@{ exitCode=$exitCode; stdout=$stdout; stderr=$stderr })
    if ($exitCode -ne 0) { throw 'Version probe failed' }
    $version=$stdout | ConvertFrom-Json
    if ($version.version -ne $pin.version -or $version.edition -ne 'Core' -or $version.architecture -ne 'X64' -or $version.home -ne $runtime -or $version.framework -ne ".NET $($pin.frameworkVersion)") { throw 'Runtime identity probe mismatch' }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $pin.sha256) { throw 'Archive changed during verification' }
    $result=[ordered]@{ startedAt=$startedAt; finishedAt=[DateTime]::UtcNow.ToString('o'); status='acquired-not-product-integrated'; runtime=$runtime; executable=$pwsh; archive=$archive; archiveSha256=$pin.sha256; manifestSha256=$manifestSha256; executableSha256=(Get-FileHash -LiteralPath $pwsh -Algorithm SHA256).Hash.ToLowerInvariant(); fileCount=$manifest.Count; expandedBytes=$plan.totalBytes; version=$version; criticalSignatures='Valid Microsoft Corporation'; allFilesHashed=$true; promotionAllowed=$false; windows10Tested=$false; globalSettingsChanged=$false }
    Write-PsEvidence (Join-Path $run 'result.json') $result
    $result | ConvertTo-Json -Depth 6
} catch {
    Write-PsEvidence (Join-Path $run 'failure.json') ([ordered]@{ startedAt=$startedAt; failedAt=[DateTime]::UtcNow.ToString('o'); phase=$phase; message=$_.Exception.Message; artifactsPreserved=$true })
    throw
}
