@echo off
rem HarmonyOS hvigor wrapper shim (project-local, portable).
rem Resolves a Node runtime and delegates to hvigor\hvigor-wrapper.js.
setlocal
set "HERE=%~dp0"
if defined DEVECO_NODE_HOME (
  if exist "%DEVECO_NODE_HOME%\node.exe" (
    set "NODE_BIN=%DEVECO_NODE_HOME%\node.exe"
  )
)
if not defined NODE_BIN (
  where node >nul 2>nul && for /f "delims=" %%i in ('where node') do if not defined NODE_BIN set "NODE_BIN=%%i"
)
if not defined NODE_BIN (
  if exist "%DEVECO_CLI_HOME%\tool\node\node.exe" set "NODE_BIN=%DEVECO_CLI_HOME%\tool\node\node.exe"
)
if not defined NODE_BIN (
  echo [hvigorw] ERROR: Node.js not found ^(set DEVECO_NODE_HOME or put node on PATH^). 1>&2
  exit /b 127
)
"%NODE_BIN%" "%HERE%hvigor\hvigor-wrapper.js" %*
exit /b %ERRORLEVEL%
