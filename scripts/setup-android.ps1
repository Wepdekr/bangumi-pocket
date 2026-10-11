$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$toolsRoot = Join-Path $projectRoot '.toolchain'
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
$ProgressPreference = 'SilentlyContinue'
if (!(Test-Path (Join-Path $toolsRoot 'jdk'))) {
  Write-Output 'Downloading JDK 21...'
  Invoke-WebRequest 'https://download.oracle.com/java/21/latest/jdk-21_windows-x64_bin.zip' -OutFile (Join-Path $toolsRoot 'jdk.zip')
  Expand-Archive -LiteralPath (Join-Path $toolsRoot 'jdk.zip') -DestinationPath (Join-Path $toolsRoot 'java-unpack') -Force
  $jdkFolder = Get-ChildItem (Join-Path $toolsRoot 'java-unpack') -Directory | Select-Object -First 1
  Move-Item -LiteralPath $jdkFolder.FullName -Destination (Join-Path $toolsRoot 'jdk')
}
$env:JAVA_HOME = Join-Path $toolsRoot 'jdk'
$env:ANDROID_HOME = Join-Path $toolsRoot 'android-sdk'
$env:ANDROID_USER_HOME = Join-Path $toolsRoot 'android-user'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$sdkTools = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest'
if (!(Test-Path $sdkTools)) {
  Write-Output 'Downloading Android command-line tools...'
  $archive = Join-Path $toolsRoot 'android-tools.zip'
  Invoke-WebRequest 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' -OutFile $archive
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a') { throw 'Android SDK archive checksum mismatch' }
  Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolsRoot 'sdk-unpack') -Force
  New-Item -ItemType Directory -Force -Path (Split-Path $sdkTools -Parent) | Out-Null
  Move-Item -LiteralPath (Join-Path $toolsRoot 'sdk-unpack\cmdline-tools') -Destination $sdkTools
}
Write-Output 'Installing Android platform and build tools...'
1..100 | ForEach-Object { 'y' } | & "$sdkTools\bin\sdkmanager.bat" "--sdk_root=$env:ANDROID_HOME" --licenses | Out-Null
& "$sdkTools\bin\sdkmanager.bat" "--sdk_root=$env:ANDROID_HOME" 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0' 'build-tools;36.0.0'
if ($LASTEXITCODE -ne 0) { throw 'Android SDK setup failed' }
Write-Output 'Android toolchain is ready.'
