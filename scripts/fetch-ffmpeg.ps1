# Downloads the FFmpeg build that Driftwave bundles as a Tauri sidecar.
# It must be a GPL build that includes librubberband (time stretch / pitch) and
# libmp3lame (MP3 export). BtbN's win64 GPL builds include both.
#
#   pwsh scripts/fetch-ffmpeg.ps1          # skip if already present
#   pwsh scripts/fetch-ffmpeg.ps1 -Force   # re-download
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root 'src-tauri/binaries'
$target = Join-Path $binDir 'ffmpeg-x86_64-pc-windows-msvc.exe'
$url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'

if ((Test-Path $target) -and -not $Force) {
  Write-Host "FFmpeg already present: $target"
} else {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("dw-ffmpeg-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'ffmpeg.zip'
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $tmp
    $exe = Get-ChildItem -Path $tmp -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
    if (-not $exe) { throw 'ffmpeg.exe not found in archive' }
    New-Item -ItemType Directory -Force $binDir | Out-Null
    Copy-Item $exe.FullName $target -Force
    $lic = Get-ChildItem -Path $tmp -Recurse -Filter 'LICENSE.txt' | Select-Object -First 1
    if ($lic) { Copy-Item $lic.FullName (Join-Path $binDir 'FFMPEG-LICENSE.txt') -Force }
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

# Verify the features Driftwave depends on.
$filters = & $target -hide_banner -filters 2>&1 | Out-String
$encoders = & $target -hide_banner -encoders 2>&1 | Out-String
if ($filters -notmatch 'rubberband') { throw 'This FFmpeg build has no rubberband filter' }
if ($encoders -notmatch 'libmp3lame') { throw 'This FFmpeg build has no libmp3lame encoder' }
Write-Host ((& $target -hide_banner -version | Select-Object -First 1))
Write-Host 'FFmpeg OK (rubberband + libmp3lame)'
