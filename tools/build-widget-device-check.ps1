$ErrorActionPreference='Stop'
$taskProject=Split-Path $PSScriptRoot -Parent
$taskSdk=Join-Path (Split-Path $taskProject -Parent) 'toolchain\android-sdk'
$taskBuildTools=Join-Path $taskSdk 'build-tools\35.0.0'
$taskAndroidJar=Join-Path $taskSdk 'platforms\android-35\android.jar'
$taskSource=Join-Path $PSScriptRoot 'widget-device-check'
$taskBuild=Join-Path $taskProject 'android\widget-device-check'
New-Item -ItemType Directory -Force -Path $taskBuild,"$taskBuild\classes","$taskBuild\dex" | Out-Null
& "$taskBuildTools\aapt2.exe" link -o "$taskBuild\unsigned.apk" -I $taskAndroidJar --manifest "$taskSource\AndroidManifest.xml" --min-sdk-version 26 --target-sdk-version 35
if($LASTEXITCODE -ne 0){throw 'Test resource package failed'}
& javac -encoding UTF-8 -source 8 -target 8 -classpath "$taskAndroidJar;$taskProject\android\direct-build\classes" -d "$taskBuild\classes" "$taskSource\cn\local\tomorrow\WidgetDeviceCheck.java"
if($LASTEXITCODE -ne 0){throw 'Test Java compilation failed'}
& jar cf "$taskBuild\classes.jar" -C "$taskBuild\classes" .
& java -cp "$taskBuildTools\lib\d8.jar" com.android.tools.r8.D8 --lib $taskAndroidJar --min-api 26 --output "$taskBuild\dex" "$taskBuild\classes.jar"
if($LASTEXITCODE -ne 0){throw 'Test DEX build failed'}
& python -X utf8 "$PSScriptRoot\package-widget-tests.py" $taskBuild
& "$taskBuildTools\zipalign.exe" -f 4 "$taskBuild\unsigned.apk" "$taskBuild\aligned.apk"
$taskKey=Join-Path (Split-Path $taskProject -Parent) 'toolchain\tomorrow-debug.keystore'
& "$taskBuildTools\apksigner.bat" sign --ks $taskKey --ks-pass pass:android --key-pass pass:android --out "$taskBuild\widget-tests.apk" "$taskBuild\aligned.apk"
if($LASTEXITCODE -ne 0){throw 'Test APK signing failed'}
Write-Output "Test APK: $taskBuild\widget-tests.apk"
