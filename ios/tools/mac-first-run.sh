#!/usr/bin/env bash
# 江水课表 · iOS 首次在 Mac 上运行的一键引导脚本
# 用法（在解压出来的 jiangshui-ios/ 目录下）：
#   bash ios/tools/mac-first-run.sh
# 只做检查和编译，不改任何 Swift 源码；日志写到 ios/build-out/。

set -uo pipefail

IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$IOS_DIR/.." && pwd)"
OUT_DIR="$IOS_DIR/build-out"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$OUT_DIR/first-run-$STAMP.log"
mkdir -p "$OUT_DIR"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; RST=$'\033[0m'
say()  { printf "%s\n" "$*" | tee -a "$LOG"; }
ok()   { printf "${GRN}OK ${RST}%s\n" "$*" | tee -a "$LOG"; }
warn() { printf "${YEL}!! ${RST}%s\n" "$*" | tee -a "$LOG"; }
bad()  { printf "${RED}XX ${RST}%s\n" "$*" | tee -a "$LOG"; }
head1(){ printf "\n${CYN}==== %s ====${RST}\n" "$*" | tee -a "$LOG"; }

say "江水课表 iOS 首跑引导  $(date '+%F %T')"
say "工程目录: $IOS_DIR"
say "仓库根:   $ROOT_DIR"
say "日志:     $LOG"

# ---------- 1. 环境 ----------
head1 "1/6 环境检查"
if [ "$(uname -s)" != "Darwin" ]; then
  bad "这不是 macOS（$(uname -s)）。脚本只能在 Mac 上跑。"
  exit 1
fi
ok "macOS $(sw_vers -productVersion) / $(uname -m)"

if ! xcode-select -p >/dev/null 2>&1; then
  bad "没有找到 Xcode 命令行工具。先装 Xcode，再执行 sudo xcodebuild -license accept"
  exit 1
fi
ok "Developer 目录: $(xcode-select -p)"

if xcodebuild -version >/dev/null 2>&1; then
  ok "Xcode: $(xcodebuild -version | tr '\n' ' ')"
  XCMAJ="$(xcodebuild -version | head -1 | awk '{print $2}' | cut -d. -f1)"
  case "$XCMAJ" in
    1[6-9]|2[0-9]) warn "Xcode $XCMAJ 默认 Swift 6 并发检查更严格；若出现大量 Sendable/main-actor 报错，先按 MAC-RUNBOOK 第 3 步把 Swift Language Version 改 5" ;;
  esac
else
  bad "xcodebuild 不可用：可能只装了 Command Line Tools，或首次启动未同意许可。"
  say "  sudo xcodebuild -license accept   然后重跑本脚本"
  exit 1
fi

NODE="$(command -v node || true)"
if [ -n "$NODE" ]; then
  ok "node $(node -v) ($NODE)"
else
  warn "没有 node：将跳过「重新生成工程 / 静态门禁 / 测试」，直接用已提交的 pbxproj 编译。"
  warn "要装：brew install node   （只影响能否自动重生成工程，不影响 xcodebuild 本身）"
fi

# ---------- 2. 目录关系 ----------
head1 "2/6 目录关系"
if [ -d "$ROOT_DIR/web" ]; then
  ok "web/ 存在（工程用 ../web 相对路径把它打进 bundle）"
else
  bad "缺少 $ROOT_DIR/web —— 必须把 ios/ 和 web/ 放在同一个父目录下（zip 解压后就是这个结构）。"
  exit 1
fi
if [ -f "$IOS_DIR/Jiangshui.xcodeproj/project.pbxproj" ]; then
  ok "工程文件存在"
else
  bad "缺少 Jiangshui.xcodeproj/project.pbxproj"
  [ -n "$NODE" ] && say "  重跑 node ios/tools/gen-pbxproj.mjs 生成它"
  exit 1
fi

# ---------- 3. 重新生成工程 ----------
head1 "3/6 重新生成 Xcode 工程（幂等）"
if [ -n "$NODE" ]; then
  if ( cd "$IOS_DIR" && node tools/gen-pbxproj.mjs ) >>"$LOG" 2>&1; then
    ok "gen-pbxproj 完成"
  else
    bad "gen-pbxproj 失败，详见 $LOG"
  fi
else
  warn "跳过（无 node）"
fi

# ---------- 4. 静态门禁 ----------
head1 "4/6 静态门禁 50 项 + 校验器自测 82 项"
if [ -n "$NODE" ]; then
  if ( cd "$IOS_DIR" && node tools/check-ios.mjs ) >>"$LOG" 2>&1; then
    ok "check-ios 全绿"
  else
    bad "check-ios 有失败项，详见 $LOG"
  fi
  if ( cd "$IOS_DIR" && node --test tests/ ) >>"$LOG" 2>&1; then
    ok "tests 全绿"
  else
    bad "tests 有失败项，详见 $LOG"
  fi
else
  warn "跳过（无 node）"
fi

# ---------- 5. 编译模拟器版本 ----------
head1 "5/6 xcodebuild 编译（iOS Simulator，Debug，不签名）"
BUILD_LOG="$OUT_DIR/xcodebuild-$STAMP.log"
say "编译日志: $BUILD_LOG"
( cd "$IOS_DIR" && xcodebuild \
    -project Jiangshui.xcodeproj \
    -target Jiangshui \
    -configuration Debug \
    -sdk iphonesimulator \
    CODE_SIGNING_ALLOWED=NO \
    SYMROOT="$OUT_DIR/build" \
    build ) 2>&1 | tee "$BUILD_LOG" | tail -40
BUILD_RC=${PIPESTATUS[0]}
cat "$BUILD_LOG" >>"$LOG"

# ---------- 6. 汇总 ----------
head1 "6/6 结果"
ERRS="$(grep -E '(^| )error: ' "$BUILD_LOG" | sed 's|^.*/ios/||' | sort -u)"
COUNT=0
[ -n "$ERRS" ] && COUNT="$(printf '%s\n' "$ERRS" | grep -c .)"

if [ "$BUILD_RC" -eq 0 ]; then
  ok "编译成功 —— 这是本项目第一次真正编译通过。"
  say "  产物: $OUT_DIR/build/Debug-iphonesimulator/Jiangshui.app"
  say "  下一步：open ios/Jiangshui.xcodeproj，选模拟器 Run，验证 MAC-RUNBOOK 第 5 步的三件事"
else
  bad "编译失败，共 $COUNT 条去重错误（完整日志 $BUILD_LOG）"
  printf '%s\n' "$ERRS" | head -40 | tee -a "$LOG"
  say ""
  say "把 $BUILD_LOG 发回来即可（或只发上面这些 error 行）。"
  say "分类处理参考 MAC-RUNBOOK 第 4 步（A 并发/Sendable、B WKWebView 委托、C EventKit、D NWListener）。"
fi
say ""
say "全部日志: $LOG"
exit "$BUILD_RC"
