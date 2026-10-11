$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
$toolsRoot = Join-Path $projectRoot '.toolchain'
if (Test-Path (Join-Path $toolsRoot 'jdk')) { $env:JAVA_HOME = Join-Path $toolsRoot 'jdk' }
if (Test-Path (Join-Path $toolsRoot 'android-sdk')) { $env:ANDROID_HOME = Join-Path $toolsRoot 'android-sdk' }
if (!$env:JAVA_HOME -or !$env:ANDROID_HOME) { throw 'Install JDK 21 and Android SDK or run scripts/setup-android.ps1 first.' }
$env:GRADLE_USER_HOME = Join-Path $toolsRoot 'gradle-cache'
$env:ANDROID_USER_HOME = Join-Path $toolsRoot 'android-user'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$downloadUri = [Uri]'https://services.gradle.org'
$systemProxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy($downloadUri)
if ($systemProxy.Host -ne $downloadUri.Host) {
  $proxyOptions = "-Dhttps.proxyHost=$($systemProxy.Host) -Dhttps.proxyPort=$($systemProxy.Port) -Dhttp.proxyHost=$($systemProxy.Host) -Dhttp.proxyPort=$($systemProxy.Port)"
  $env:JAVA_OPTS = "$env:JAVA_OPTS $proxyOptions"
  $env:GRADLE_OPTS = "$env:GRADLE_OPTS $proxyOptions"
}
$sdkPath = $env:ANDROID_HOME.Replace('\','/')
"sdk.dir=$sdkPath" | Set-Content -Encoding ascii 'android/local.properties'
& npm.cmd run android:sync
if ($LASTEXITCODE -ne 0) { throw 'Web build or Android sync failed' }
Push-Location android
try {
  $localGradle = Join-Path $toolsRoot 'gradle-8.14.3\bin\gradle.bat'
  if (Test-Path $localGradle) { & $localGradle assembleDebug --no-daemon } else { & .\gradlew.bat assembleDebug --no-daemon }
  if ($LASTEXITCODE -ne 0) { throw 'APK build failed' }
} finally { Pop-Location }
New-Item -ItemType Directory -Force -Path artifacts | Out-Null
Copy-Item -LiteralPath 'android/app/build/outputs/apk/debug/app-debug.apk' -Destination 'artifacts/bangumi-pocket-debug.apk' -Force
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
Copy-Item -LiteralPath 'artifacts/bangumi-pocket-debug.apk' -Destination "artifacts/bangumi-pocket-$version-debug.apk" -Force
Write-Output 'APK ready: artifacts/bangumi-pocket-debug.apk'
