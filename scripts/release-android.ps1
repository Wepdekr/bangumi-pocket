param(
  [string]$ExistingApk,
  [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
$toolsRoot = Join-Path $projectRoot '.toolchain'
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a stable x.y.z version in package.json.' }
$gradle = Get-Content android/app/build.gradle -Raw
$androidVersion = [regex]::Match($gradle, 'versionName\s+"([^"]+)"').Groups[1].Value
$versionCode = [regex]::Match($gradle, 'versionCode\s+(\d+)').Groups[1].Value
if ($version -ne $androidVersion) { throw 'Frontend and Android versions differ.' }
$changelog = Get-Content CHANGELOG.md -Raw -Encoding utf8
$section = [regex]::Match($changelog, '(?ms)^## ' + [regex]::Escape($version) + ' · [^\r\n]+\r?\n(.*?)(?=^## |\z)')
if (!$section.Success -or !$section.Groups[1].Value.Trim()) { throw 'Add this version to CHANGELOG.md before publishing.' }
if (@(git status --porcelain).Count) { throw 'Commit all source and changelog changes before publishing.' }
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Git repository status.' }
if (!$ExistingApk) {
  & npm.cmd run android:build
  if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
  $ExistingApk = 'artifacts/bangumi-pocket-debug.apk'
}
$apkSource = (Resolve-Path -LiteralPath $ExistingApk).Path
if (Test-Path (Join-Path $toolsRoot 'jdk')) { $env:JAVA_HOME = Join-Path $toolsRoot 'jdk' }
$sdkRoot = $env:ANDROID_HOME
if (Test-Path (Join-Path $toolsRoot 'android-sdk')) { $sdkRoot = Join-Path $toolsRoot 'android-sdk' }
if (!$sdkRoot) { throw 'Android SDK is required to verify the APK.' }
$buildTools = Get-ChildItem (Join-Path $sdkRoot 'build-tools') -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (!$buildTools) { throw 'Android SDK build-tools not found.' }
& (Join-Path $buildTools.FullName 'apksigner.bat') verify $apkSource
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
$badging = & (Join-Path $buildTools.FullName 'aapt.exe') dump badging $apkSource
if ($LASTEXITCODE -ne 0) { throw 'Cannot read APK metadata.' }
$metadata = $badging | Select-Object -First 1
if ($metadata -notmatch "name='tv.bgm.pocket'" -or
    $metadata -notmatch ("versionName='" + [regex]::Escape($version) + "'") -or
    $metadata -notmatch ("versionCode='" + $versionCode + "'")) {
  throw 'APK package or version does not match this source checkout.'
}
$artifactDir = Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$assetName = "bangumi-pocket-$version.apk"
$apk = Join-Path $artifactDir $assetName
if ($apkSource -ne $apk) { Copy-Item -LiteralPath $apkSource -Destination $apk -Force }
$sha256 = [Security.Cryptography.SHA256]::Create()
$apkStream = [IO.File]::OpenRead($apk)
try { $hash = [BitConverter]::ToString($sha256.ComputeHash($apkStream)).Replace('-', '').ToLower() }
finally { $apkStream.Dispose(); $sha256.Dispose() }
$checksum = "$apk.sha256"
[System.IO.File]::WriteAllText($checksum, "$hash  $assetName`n", [System.Text.Encoding]::ASCII)
$notes = Join-Path $artifactDir "release-$version.md"
$releaseNotes = $section.Groups[1].Value.Trim() + "`n`n## 下载与安装`n`n点击下方 Assets 中的 ``$assetName`` 下载 Android 安装包，不要下载 Source code。最低 Android 7.0。`n`n此 APK 使用现有开发调试签名，与此前提供的安装包保持一致，可覆盖安装。``.sha256`` 文件用于核对下载文件。`n"
[System.IO.File]::WriteAllText($notes, $releaseNotes, [System.Text.UTF8Encoding]::new($false))
$manifest = Join-Path $artifactDir 'update.json'
$manifestOrigin = git remote get-url origin
$manifestRepo = [regex]::Match($manifestOrigin, '^(?:https://github\.com/|git@github\.com:)([^/]+/[^/]+?)(?:\.git)?$')
if ($LASTEXITCODE -ne 0 -or !$manifestRepo.Success) { throw 'GitHub origin required to generate update metadata.' }
$manifestData = [ordered]@{
  tag_name = "v$version"
  draft = $false
  prerelease = $false
  body = $releaseNotes
  assets = @(@{
    name = $assetName
    state = 'uploaded'
    size = (Get-Item -LiteralPath $apk).Length
    browser_download_url = "https://github.com/$($manifestRepo.Groups[1].Value)/releases/download/v$version/$assetName"
    digest = "sha256:$hash"
  })
}
[IO.File]::WriteAllText($manifest, ($manifestData | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
if ($ValidateOnly) { Write-Output "Validated APK $version (versionCode $versionCode), signature and SHA256: $hash"; exit 0 }

$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
$gh = if ($ghCommand) { $ghCommand.Source } else { Join-Path $toolsRoot 'github-cli/bin/gh.exe' }
if (!(Test-Path -LiteralPath $gh)) { throw 'Install official GitHub CLI and run gh auth login first.' }
$localGhConfig = Join-Path $toolsRoot 'github-cli/config'
if (!$env:GH_CONFIG_DIR -and (Test-Path $localGhConfig)) { $env:GH_CONFIG_DIR = $localGhConfig }
$githubUri = [Uri]'https://github.com'
$proxy = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy($githubUri)
if (!$env:HTTPS_PROXY -and $proxy.Host -ne $githubUri.Host) {
  $env:HTTPS_PROXY = $proxy.AbsoluteUri
  $env:HTTP_PROXY = $proxy.AbsoluteUri
}
$origin = git remote get-url origin
if ($LASTEXITCODE -ne 0) { throw 'Git origin is missing.' }
$remoteMatch = [regex]::Match($origin, '^(?:https://github\.com/|git@github\.com:)([^/]+/[^/]+?)(?:\.git)?$')
if (!$remoteMatch.Success) { throw 'Origin must be a GitHub repository URL.' }
$repo = $remoteMatch.Groups[1].Value
$head = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot read source commit.' }
$branch = git branch --show-current
if ($branch -ne 'main') { throw 'Publish from the main branch.' }
$remoteHead = git ls-remote origin refs/heads/main
if ($LASTEXITCODE -ne 0 -or ($remoteHead -split '\s+')[0] -ne $head) {
  throw 'Push source commits to origin/main before publishing.'
}
$tag = "v$version"
$existingJson = & $gh release list --repo $repo --limit 1000 --json tagName
if ($LASTEXITCODE -ne 0) { throw 'Cannot check existing releases.' }
$existing = $existingJson | ConvertFrom-Json
if ($existing | Where-Object { $_.tagName -eq $tag }) {
  throw "Release $tag already exists. Do not replace APKs under an existing version; finish any existing draft manually or publish a new version."
}
& $gh release create $tag $apk $checksum $manifest --repo $repo --target $head --title "番组口袋 $version" --notes-file $notes --draft
if ($LASTEXITCODE -ne 0) { throw 'Draft creation or asset upload failed. Any created draft remains unpublished.' }
$draftInfoJson = & $gh release view $tag --repo $repo --json databaseId
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate created draft.' }
$draftId = ($draftInfoJson | ConvertFrom-Json).databaseId
$draftJson = & $gh api "repos/$repo/releases/$draftId"
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify uploaded release assets.' }
$draft = $draftJson | ConvertFrom-Json
$uploaded = $draft.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
$uploadedChecksum = $draft.assets | Where-Object { $_.name -eq "$assetName.sha256" } | Select-Object -First 1
$uploadedManifest = $draft.assets | Where-Object { $_.name -eq 'update.json' } | Select-Object -First 1
if (!$uploadedManifest -or $uploadedManifest.size -ne (Get-Item -LiteralPath $manifest).Length) { throw 'Update metadata upload failed; draft remains unpublished.' }
if (!$uploaded -or $uploaded.size -ne (Get-Item -LiteralPath $apk).Length -or !$uploadedChecksum) {
  throw 'Release assets are incomplete; draft remains unpublished.'
}
if ($uploaded.digest -and $uploaded.digest -ne "sha256:$hash") { throw 'Uploaded APK checksum differs; draft remains unpublished.' }
& $gh release edit $tag --repo $repo --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'Publishing failed; inspect the release draft.' }
$publishedJson = & $gh release view $tag --repo $repo --json isDraft,url
if ($LASTEXITCODE -ne 0) { throw 'Cannot confirm published release.' }
$published = $publishedJson | ConvertFrom-Json
if ($published.isDraft) { throw 'Release is still a draft.' }
Write-Output "Release published: $($published.url)"
Write-Output "APK download: https://github.com/$repo/releases/download/$tag/$assetName"
