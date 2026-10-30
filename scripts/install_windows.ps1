# Installs the epubtrans CLI (a single binary) from the latest GitHub release.
#
#   irm https://raw.githubusercontent.com/namnhfreelancer/epubtrans/main/scripts/install_windows.ps1 | iex
#
# Options (environment variables, set before running):
#   $env:EPUBTRANS_VERSION      release tag such as v3.0.0 (default: latest)
#   $env:EPUBTRANS_INSTALL_DIR  install directory (default: %LOCALAPPDATA%\Programs\epubtrans)
#   $env:EPUBTRANS_RELEASE_BASE_URL  mirror or local test server holding the release assets
#
# The download is verified against the SHA256SUMS file published with the release.

$Version = if ($env:EPUBTRANS_VERSION) { $env:EPUBTRANS_VERSION } else { 'latest' }
$InstallDir = if ($env:EPUBTRANS_INSTALL_DIR) { $env:EPUBTRANS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\epubtrans' }

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'namnhfreelancer/epubtrans'
# Only an x64 build is published; Windows on ARM runs it through emulation.
$asset = 'epubtrans-windows-x64.exe'
$baseUrl = if ($env:EPUBTRANS_RELEASE_BASE_URL) {
    $env:EPUBTRANS_RELEASE_BASE_URL.TrimEnd('/')
} elseif ($Version -eq 'latest') {
    "https://github.com/$repo/releases/latest/download"
} else {
    "https://github.com/$repo/releases/download/$Version"
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("epubtrans-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    Write-Host "Downloading $asset ($Version) ..."
    Invoke-WebRequest -Uri "$baseUrl/$asset" -OutFile (Join-Path $tmp $asset) -UseBasicParsing
    Invoke-WebRequest -Uri "$baseUrl/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS') -UseBasicParsing

    $line = Get-Content (Join-Path $tmp 'SHA256SUMS') |
        Where-Object { ($_ -split '\s+', 2)[1] -in @($asset, "*$asset") } |
        Select-Object -First 1
    if (-not $line) { throw "SHA256SUMS has no entry for $asset" }
    $expected = ($line -split '\s+', 2)[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $tmp $asset)).Hash.ToLowerInvariant()
    if ($expected -ne $actual) { throw "Checksum mismatch for $asset (expected $expected, got $actual); not installing" }
    Write-Host 'Checksum verified.'

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $target = Join-Path $InstallDir 'epubtrans.exe'
    Copy-Item -Force (Join-Path $tmp $asset) $target

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = if ($userPath) { $userPath -split ';' } else { @() }
    if ($entries -notcontains $InstallDir) {
        [Environment]::SetEnvironmentVariable('Path', (($entries + $InstallDir) -join ';').TrimStart(';'), 'User')
        Write-Host "Added $InstallDir to your user PATH. Open a new terminal to use 'epubtrans'."
    }
    Write-Host "Installed epubtrans $(& $target --version) to $target"
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
