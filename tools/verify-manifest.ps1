# 按「增量清单-*.txt」校验归档是否与交付时一致。
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\tools\verify-manifest.ps1
#   powershell -ExecutionPolicy Bypass -File .\tools\verify-manifest.ps1 -Manifest '<归档目录>\增量清单-2026-10-17-rc1.txt'
# 清单由 CRLF/TAB 分隔：相对路径 <TAB> 字节数 <TAB> SHA-256，路径相对于清单所在目录。
# 注意：本文件必须保存为 UTF-8 带 BOM，否则 Windows PowerShell 5.1 会按 GBK 解码导致语法错误。
param(
  [string]$Manifest,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
if (-not $Manifest) {
  # tools → course-change → source → 归档根
  $root = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
  $Manifest = Get-ChildItem -LiteralPath $root -Filter '增量清单-*.txt' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $Manifest) { throw '没有找到 增量清单-*.txt，请用 -Manifest 指定' }
}
$Manifest = [IO.Path]::GetFullPath($Manifest)
$base = Split-Path $Manifest -Parent
Write-Output "清单：$Manifest"

# 同一路径出现多次时，以最后一次为准（清单末尾可追加「接手后勘误记录」而不破坏原基线）。
$entries = [ordered]@{}
$overrides = @()
foreach ($line in Get-Content -LiteralPath $Manifest -Encoding UTF8) {
  if (-not $line.Trim()) { continue }
  if ($line.StartsWith('#')) { continue }
  $parts = $line -split "`t"
  if ($parts.Count -ne 3) { continue }                 # 跳过表头/说明行
  $rel = $parts[0]; $size = $parts[1]; $sha = $parts[2]
  if ($size -notmatch '^\d+$' -or $sha -notmatch '^[0-9A-Fa-f]{64}$') { continue }   # 表头或说明行
  $key = $rel.ToLowerInvariant()
  if ($entries.Contains($key)) { $overrides += $rel }
  $entries[$key] = [pscustomobject]@{ Rel = $rel; Size = [int64]$size; Sha = $sha.ToUpperInvariant() }
}

$ok = 0; $bad = @(); $missing = @()
foreach ($e in $entries.Values) {
  $full = Join-Path $base $e.Rel
  if (-not (Test-Path -LiteralPath $full)) { $missing += $e.Rel; continue }
  $item = Get-Item -LiteralPath $full
  if ($item.Length -ne $e.Size) { $bad += "$($e.Rel)  大小不符：清单 $($e.Size) / 实际 $($item.Length)"; continue }
  $actual = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
  if ($actual -ne $e.Sha) { $bad += "$($e.Rel)  SHA-256 不符`n    清单 $($e.Sha)`n    实际 $actual"; continue }
  $ok++
}
Write-Output "检查 $($entries.Count) 条：一致 $ok，不一致 $($bad.Count)，缺失 $($missing.Count)"
if ($overrides.Count) { Write-Output "按末尾勘误覆盖 $($overrides.Count) 条：$($overrides -join '、')" }
$bad | ForEach-Object { Write-Output "不一致：$_" }
$missing | ForEach-Object { Write-Output "缺失：$_" }
if ($bad.Count -or $missing.Count) { exit 1 } else { Write-Output '归档校验通过' }
