param(
    [string]$OutputDirectory,
    [string]$BuildDirectory,
    [string]$XiaomiAppId,
    [string]$ToolchainRoot,
    [ValidateRange(1, 2147483647)][int]$VersionCode = 50,
    [ValidateNotNullOrEmpty()][string]$VersionName = '1.3.2'
)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
if($ToolchainRoot){$toolchainRoot=[IO.Path]::GetFullPath($ToolchainRoot)}else{$toolchainRoot=Join-Path (Split-Path $projectRoot -Parent) 'toolchain'}
if($VersionName -notmatch '^[0-9A-Za-z][0-9A-Za-z._+-]*$'){throw "VersionName contains unsupported characters: $VersionName"}
$sdkRoot=Join-Path $toolchainRoot 'android-sdk'
$buildTools=Join-Path $sdkRoot 'build-tools\35.0.0'
$platformJar=Join-Path $sdkRoot 'platforms\android-35\android.jar'
$buildRoot=if($BuildDirectory){[IO.Path]::GetFullPath($BuildDirectory)}else{Join-Path $projectRoot 'android\direct-build'}
New-Item -ItemType Directory -Force -Path $buildRoot,"$buildRoot\gen","$buildRoot\classes","$buildRoot\dex" | Out-Null
function Assert-Step { if($LASTEXITCODE -ne 0){throw "Build step failed: $LASTEXITCODE"} }
& "$buildTools\aapt2.exe" compile --dir "$projectRoot\android\app\src\main\res" -o "$buildRoot\resources.zip"
Assert-Step
$manifestPath="$projectRoot\android\app\src\main\AndroidManifest.xml"
# Read/write the manifest as UTF-8 explicitly. PowerShell's default code page
# can reinterpret Chinese labels as GBK and produce mojibake in the APK.
$utf8=[System.Text.UTF8Encoding]::new($false)
$manifest=$utf8.GetString([System.IO.File]::ReadAllBytes($manifestPath)).Replace('<manifest ','<manifest package="cn.local.tomorrow" ')
# Only an actual platform AppId is accepted. Missing credentials keep standard notifications active.
if($XiaomiAppId){
 if($XiaomiAppId -notmatch '^\d{6,30}$'){throw 'XiaomiAppId must be the numeric AppId issued by the developer platform'}
 $focusMetadata='<meta-data android:name="com.xiaomi.xms.APP_ID" android:value="'+$XiaomiAppId+'"/><meta-data android:name="com.xiaomi.xms.BUILD_TYPE_DEBUG" android:value="true"/>'
 $manifest=$manifest.Replace('</application>',$focusMetadata+'</application>')
}
[System.IO.File]::WriteAllText("$buildRoot\AndroidManifest.xml",$manifest,$utf8)
& "$buildTools\aapt2.exe" link -o "$buildRoot\unsigned.apk" -I $platformJar --manifest "$buildRoot\AndroidManifest.xml" --java "$buildRoot\gen" --min-sdk-version 26 --target-sdk-version 35 --version-code $VersionCode --version-name $VersionName "$buildRoot\resources.zip"
Assert-Step
$javaSources=Get-ChildItem -LiteralPath "$projectRoot\android\app\src\main\java\cn\local\tomorrow" -Filter *.java | ForEach-Object { $_.FullName }
& javac -encoding UTF-8 -source 8 -target 8 -classpath $platformJar -d "$buildRoot\classes" $javaSources "$buildRoot\gen\cn\local\tomorrow\R.java"
Assert-Step
& jar cf "$buildRoot\classes.jar" -C "$buildRoot\classes" .
Assert-Step
& java -cp "$buildTools\lib\d8.jar" com.android.tools.r8.D8 --lib $platformJar --min-api 26 --output "$buildRoot\dex" "$buildRoot\classes.jar"
Assert-Step
& python -X utf8 "$PSScriptRoot\package-apk.py" $projectRoot $buildRoot
Assert-Step
& "$buildTools\zipalign.exe" -f 4 "$buildRoot\unsigned.apk" "$buildRoot\aligned.apk"
Assert-Step
$keyFile=Join-Path $toolchainRoot 'tomorrow-debug.keystore'
if(!(Test-Path -LiteralPath $keyFile)){& keytool -genkeypair -keystore $keyFile -storepass android -keypass android -alias androiddebugkey -dname 'CN=Android Debug,O=Local Development,C=CN' -keyalg RSA -keysize 2048 -validity 365;Assert-Step}
$outputRoot=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path (Split-Path (Split-Path $projectRoot -Parent) -Parent) 'outputs'}
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
& "$buildTools\apksigner.bat" sign --ks $keyFile --ks-pass pass:android --key-pass pass:android --out "$outputRoot\TomorrowSchedule-debug.apk" "$buildRoot\aligned.apk"
Assert-Step
& "$buildTools\apksigner.bat" verify --verbose "$outputRoot\TomorrowSchedule-debug.apk"
Assert-Step
Write-Output "APK built: $outputRoot\TomorrowSchedule-debug.apk"
