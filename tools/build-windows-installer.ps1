param([string]$OutputDirectory,[string]$CompilerPath)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$deliverables=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{Join-Path (Split-Path (Split-Path $projectRoot -Parent) -Parent) 'outputs'}
$appDirectory=Join-Path $deliverables 'windows-1.1.9-rc1\JiangshuiSchedule-win32-x64'
$compiler=if($CompilerPath){[IO.Path]::GetFullPath($CompilerPath)}else{Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'}
if(!(Test-Path -LiteralPath $compiler)) { throw 'Specify the Inno Setup compiler path with -CompilerPath.' }
if(!(Test-Path -LiteralPath (Join-Path $appDirectory 'JiangshuiSchedule.exe'))) { throw 'Run npm run package:win first.' }
$env:JIANGSHUI_SOURCE=$appDirectory
$env:JIANGSHUI_OUTPUT=$deliverables
$env:JIANGSHUI_ICON=Join-Path $projectRoot 'assets\app-icon.ico'
& $compiler /Qp (Join-Path $PSScriptRoot 'windows-installer.iss')
if($LASTEXITCODE -ne 0){throw "Installer build failed: $LASTEXITCODE"}
Write-Output "Installer built in $deliverables"
