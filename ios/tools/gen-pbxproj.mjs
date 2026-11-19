#!/usr/bin/env node
// 生成 ios/Jiangshui.xcodeproj/project.pbxproj。
// 本机是 Windows，没有 XcodeGen / Xcode，因此提交一份等价的 pbxproj：
// - 确定性：对象 id = SHA-1(kind:key) 前 24 位大写 hex，重复运行逐字节一致
// - 幂等：扫描 ios/Jiangshui 与 ios/JiangshuiWidgets，队友新增 .swift 后重跑即可纳入 Sources
// - 双 target：主 App Jiangshui（iOS 15.0）+ Widget Extension JiangshuiWidgetsExtension（iOS 16.1）
// - 扩展以 .appex 形式经 PBXCopyFilesBuildPhase(dstSubfolderSpec=13) 嵌入主 App
// - 与 ios/project.yml 等价：cn.local.tomorrow / 1.3.1 (48)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const iosDir = resolve(scriptDir, "..");
const repoRoot = resolve(iosDir, "..");
const sourceRoot = join(iosDir, "Jiangshui");
const widgetRoot = join(iosDir, "JiangshuiWidgets");
const webRoot = join(repoRoot, "web");
const outputDir = join(iosDir, "Jiangshui.xcodeproj");
const outputPath = join(outputDir, "project.pbxproj");

const NAME = "Jiangshui";
const WIDGET_NAME = "JiangshuiWidgetsExtension";
const WIDGET_DIR = "JiangshuiWidgets";
const WIDGET_BUNDLE_ID = "cn.local.tomorrow.widgets";
const BUNDLE_ID = "cn.local.tomorrow";
const VERSION = "1.3.1";
const BUILD = "48";
const TARGET_OS = "15.0";
const WIDGET_OS = "16.1";
const SWIFT = "5.0";

const H = (kind, key) => createHash("sha1").update(kind + ":" + key).digest("hex").slice(0, 24).toUpperCase();
const Q = (value) => {
  const text = String(value);
  // Xcode 的 OpenStep plist 里 "$(" 这类变量引用必须加引号（"$(TARGET_NAME)"），
  // 裸写会让 Xcode 解析报 unexpected character。
  if (text.includes("$(")) return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  if (/^[A-Za-z0-9_$.\/()-]+$/.test(text)) return text;
  return '"' + text.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
};

if (!existsSync(sourceRoot)) { console.error("缺少目录: " + sourceRoot); process.exit(1); }
if (!existsSync(widgetRoot)) { console.error("缺少目录: " + widgetRoot); process.exit(1); }
if (!existsSync(webRoot)) { console.error("缺少目录: " + webRoot); process.exit(1); }

// ---------- 1. 扫描两个源码根 ----------
const files = [];
const SKIP_DIRS = new Set(["__pycache__", "node_modules"]);
const SKIP_FILES = new Set([".DS_Store", ".gitignore"]);
function walk(dir, relDir) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relDir + "/" + name;
    if (statSync(full).isDirectory()) {
      if (name.endsWith(".xcassets")) files.push({ rel, name, kind: "asset" });
      else walk(full, rel);
      continue;
    }
    if (SKIP_FILES.has(name) || name.endsWith(".md")) continue;
    if (name === "Info.plist") files.push({ rel, name, kind: "plist" });
    else if (name.endsWith(".swift")) files.push({ rel, name, kind: "swift" });
    else if (name.toLowerCase().endsWith(".png")) files.push({ rel, name, kind: "png" });
    else if (/\.(xcprivacy|plist|xml)$/i.test(name)) files.push({ rel, name, kind: "xml" });
    else files.push({ rel, name, kind: "other" });
  }
}
walk(sourceRoot, "Jiangshui");
walk(widgetRoot, WIDGET_DIR);
files.sort((a, b) => a.rel.localeCompare(b.rel));

const appFiles = files.filter((f) => f.rel.startsWith("Jiangshui/"));
const widgetFiles = files.filter((f) => f.rel.startsWith(WIDGET_DIR + "/"));
const appSwift = appFiles.filter((f) => f.kind === "swift");
const widgetSwift = widgetFiles.filter((f) => f.kind === "swift");
// 共享契约只允许 Shared/ 下的文件进主 App；widget 专属视图不得进主 App。
const sharedSwift = widgetSwift.filter((f) => f.rel.startsWith(WIDGET_DIR + "/Shared/"));
const appSources = appSwift.concat(sharedSwift).sort((a, b) => a.rel.localeCompare(b.rel));
const widgetSources = widgetSwift.slice().sort((a, b) => a.rel.localeCompare(b.rel));
const appResources = appFiles.filter((f) => f.kind === "asset" || f.kind === "png" || f.kind === "xml" || f.kind === "other");
const widgetResources = widgetFiles.filter((f) => f.kind === "asset" || f.kind === "png" || f.kind === "xml" || f.kind === "other");

// ---------- 2. 固定 id ----------
const pid = H("project", NAME);
const tid = H("target", NAME);
const wid = H("target", WIDGET_NAME);
const productRef = H("product", NAME);
const widgetProductRef = H("product", WIDGET_NAME);
const mainGroup = H("group", "__root__");
const productsGroup = H("group", "Products");
const sourcesPhase = H("phase", "Sources");
const frameworksPhase = H("phase", "Frameworks");
const resourcesPhase = H("phase", "Resources");
const embedPhase = H("phase", "Embed App Extensions");
const widgetSourcesPhase = H("phase", WIDGET_NAME + "/Sources");
const widgetFrameworksPhase = H("phase", WIDGET_NAME + "/Frameworks");
const widgetResourcesPhase = H("phase", WIDGET_NAME + "/Resources");
const projectConfigs = H("configList", "project");
const targetConfigs = H("configList", "target");
const widgetConfigs = H("configList", WIDGET_NAME);
const projectDebug = H("buildConfig", "project/Debug");
const projectRelease = H("buildConfig", "project/Release");
const targetDebug = H("buildConfig", "target/Debug");
const targetRelease = H("buildConfig", "target/Release");
const widgetDebug = H("buildConfig", WIDGET_NAME + "/Debug");
const widgetRelease = H("buildConfig", WIDGET_NAME + "/Release");
const webRef = H("fileRef", "web");
const webBuild = H("buildFile", "web");
const embedBuild = H("buildFile", "embed/" + WIDGET_NAME);
const widgetDependency = H("dependency", WIDGET_NAME);
const widgetProxy = H("proxy", WIDGET_NAME);
const fid = (rel) => H("fileRef", rel);
const bid = (rel) => H("buildFile", rel);
const appBid = (rel) => (rel.startsWith(WIDGET_DIR + "/") ? H("buildFile", "app/" + rel) : bid(rel));
const widgetBid = (rel) => H("buildFile", "widget/" + rel);
const gid = (relDir) => H("group", relDir);

// ---------- 3. PBXFileReference ----------
const FILETYPE = { swift: "sourcecode.swift", plist: "text.plist.xml", asset: "folder.assetcatalog", png: "image.png", xml: "text.xml", other: "text" };
const fileRefLines = files.map((f) => "\t\t" + fid(f.rel) + " /* " + f.name + " */ = {isa = PBXFileReference; lastKnownFileType = " + (FILETYPE[f.kind] || "text") + "; path = " + Q(f.name) + "; sourceTree = \"<group>\"; };");
fileRefLines.push("\t\t" + webRef + " /* web */ = {isa = PBXFileReference; lastKnownFileType = folder; name = web; path = ../web; sourceTree = \"<group>\"; };");
fileRefLines.push("\t\t" + productRef + " /* " + NAME + ".app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = " + NAME + ".app; sourceTree = BUILT_PRODUCTS_DIR; };");
fileRefLines.push("\t\t" + widgetProductRef + " /* " + WIDGET_NAME + ".appex */ = {isa = PBXFileReference; explicitFileType = \"wrapper.app-extension\"; includeInIndex = 0; path = " + WIDGET_NAME + ".appex; sourceTree = BUILT_PRODUCTS_DIR; };");

// ---------- 4. PBXGroup 树 ----------
function buildTree(entries) {
  const tree = { children: new Map(), files: [] };
  for (const f of entries) {
    const parts = f.rel.split("/");
    let node = tree;
    for (const dir of parts.slice(1, -1)) {
      if (!node.children.has(dir)) node.children.set(dir, { children: new Map(), files: [] });
      node = node.children.get(dir);
    }
    node.files.push(f);
  }
  return tree;
}
const groupLines = [];
function renderGroup(node, relDir, title, pathValue) {
  const kids = [];
  for (const child of [...node.children.keys()].sort()) {
    kids.push(gid(relDir + "/" + child) + " /* " + child + " */");
    renderGroup(node.children.get(child), relDir + "/" + child, child, child);
  }
  for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) kids.push(fid(f.rel) + " /* " + f.name + " */");
  const out = ["\t\t" + gid(relDir) + " /* " + title + " */ = {", "\t\t\tisa = PBXGroup;", "\t\t\tchildren = ("];
  for (const kid of kids) out.push("\t\t\t\t" + kid + ",");
  out.push("\t\t\t);");
  if (pathValue) out.push("\t\t\tpath = " + Q(pathValue) + ";");
  out.push("\t\t\tsourceTree = \"<group>\";", "\t\t};");
  groupLines.push(out.join("\n"));
}
renderGroup(buildTree(appFiles), "Jiangshui", NAME, NAME);
renderGroup(buildTree(widgetFiles), WIDGET_DIR, WIDGET_DIR, WIDGET_DIR);
groupLines.push([
  "\t\t" + productsGroup + " /* Products */ = {", "\t\t\tisa = PBXGroup;", "\t\t\tchildren = (",
  "\t\t\t\t" + productRef + " /* " + NAME + ".app */,",
  "\t\t\t\t" + widgetProductRef + " /* " + WIDGET_NAME + ".appex */,",
  "\t\t\t);", "\t\t\tname = Products;", "\t\t\tsourceTree = \"<group>\";", "\t\t};"
].join("\n"));
groupLines.push([
  "\t\t" + mainGroup + " = {", "\t\t\tisa = PBXGroup;", "\t\t\tchildren = (",
  "\t\t\t\t" + gid("Jiangshui") + " /* " + NAME + " */,",
  "\t\t\t\t" + gid(WIDGET_DIR) + " /* " + WIDGET_DIR + " */,",
  "\t\t\t\t" + webRef + " /* web */,",
  "\t\t\t\t" + productsGroup + " /* Products */,",
  "\t\t\t);", "\t\t\tsourceTree = \"<group>\";", "\t\t};"
].join("\n"));

// ---------- 5. build files / phases ----------
const buildFileLines = [];
for (const f of appSources) buildFileLines.push("\t\t" + appBid(f.rel) + " /* " + f.name + " in Sources */ = {isa = PBXBuildFile; fileRef = " + fid(f.rel) + " /* " + f.name + " */; };");
for (const f of widgetSources) buildFileLines.push("\t\t" + widgetBid(f.rel) + " /* " + f.name + " in Sources */ = {isa = PBXBuildFile; fileRef = " + fid(f.rel) + " /* " + f.name + " */; };");
for (const f of appResources) buildFileLines.push("\t\t" + bid(f.rel) + " /* " + f.name + " in Resources */ = {isa = PBXBuildFile; fileRef = " + fid(f.rel) + " /* " + f.name + " */; };");
for (const f of widgetResources) buildFileLines.push("\t\t" + widgetBid(f.rel) + " /* " + f.name + " in Resources */ = {isa = PBXBuildFile; fileRef = " + fid(f.rel) + " /* " + f.name + " */; };");
buildFileLines.push("\t\t" + webBuild + " /* web in Resources */ = {isa = PBXBuildFile; fileRef = " + webRef + " /* web */; };");
buildFileLines.push("\t\t" + embedBuild + " /* " + WIDGET_NAME + ".appex in Embed App Extensions */ = {isa = PBXBuildFile; fileRef = " + widgetProductRef + " /* " + WIDGET_NAME + ".appex */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };");

function phaseLines(idValue, title, isa, entries) {
  const out = ["\t\t" + idValue + " /* " + title + " */ = {", "\t\t\tisa = " + isa + ";", "\t\t\tbuildActionMask = 2147483647;", "\t\t\tfiles = ("];
  for (const entry of entries) out.push("\t\t\t\t" + entry + ",");
  out.push("\t\t\t);", "\t\t\trunOnlyForDeploymentPostprocessing = 0;", "\t\t};");
  return out.join("\n");
}
const sourcesPhaseLines = phaseLines(sourcesPhase, "Sources", "PBXSourcesBuildPhase", appSources.map((f) => appBid(f.rel) + " /* " + f.name + " in Sources */"));
const resourcesPhaseLines = phaseLines(resourcesPhase, "Resources", "PBXResourcesBuildPhase", appResources.map((f) => bid(f.rel) + " /* " + f.name + " in Resources */").concat(webBuild + " /* web in Resources */"));
const frameworksPhaseLines = phaseLines(frameworksPhase, "Frameworks", "PBXFrameworksBuildPhase", []);
const widgetSourcesPhaseLines = phaseLines(widgetSourcesPhase, "Sources", "PBXSourcesBuildPhase", widgetSources.map((f) => widgetBid(f.rel) + " /* " + f.name + " in Sources */"));
const widgetResourcesPhaseLines = phaseLines(widgetResourcesPhase, "Resources", "PBXResourcesBuildPhase", widgetResources.map((f) => widgetBid(f.rel) + " /* " + f.name + " in Resources */"));
const widgetFrameworksPhaseLines = phaseLines(widgetFrameworksPhase, "Frameworks", "PBXFrameworksBuildPhase", []);
const embedPhaseLines = [
  "\t\t" + embedPhase + " /* Embed App Extensions */ = {", "\t\t\tisa = PBXCopyFilesBuildPhase;", "\t\t\tbuildActionMask = 2147483647;",
  "\t\t\tdstPath = \"\";", "\t\t\tdstSubfolderSpec = 13;", "\t\t\tfiles = (",
  "\t\t\t\t" + embedBuild + " /* " + WIDGET_NAME + ".appex in Embed App Extensions */,",
  "\t\t\t);", "\t\t\tname = \"Embed App Extensions\";", "\t\t\trunOnlyForDeploymentPostprocessing = 0;", "\t\t};"
].join("\n");

// ---------- 6. target / project / dependency ----------
const targetLines = [
  "\t\t" + tid + " /* " + NAME + " */ = {", "\t\t\tisa = PBXNativeTarget;",
  "\t\t\tbuildConfigurationList = " + targetConfigs + " /* Build configuration list for PBXNativeTarget \"" + NAME + "\" */;",
  "\t\t\tbuildPhases = (", "\t\t\t\t" + sourcesPhase + " /* Sources */,", "\t\t\t\t" + frameworksPhase + " /* Frameworks */,",
  "\t\t\t\t" + resourcesPhase + " /* Resources */,", "\t\t\t\t" + embedPhase + " /* Embed App Extensions */,", "\t\t\t);",
  "\t\t\tbuildRules = (", "\t\t\t);", "\t\t\tdependencies = (", "\t\t\t\t" + widgetDependency + " /* PBXTargetDependency */,", "\t\t\t);",
  "\t\t\tname = " + NAME + ";", "\t\t\tproductName = " + NAME + ";",
  "\t\t\tproductReference = " + productRef + " /* " + NAME + ".app */;",
  "\t\t\tproductType = \"com.apple.product-type.application\";", "\t\t};"
].join("\n");
const widgetTargetLines = [
  "\t\t" + wid + " /* " + WIDGET_NAME + " */ = {", "\t\t\tisa = PBXNativeTarget;",
  "\t\t\tbuildConfigurationList = " + widgetConfigs + " /* Build configuration list for PBXNativeTarget \"" + WIDGET_NAME + "\" */;",
  "\t\t\tbuildPhases = (", "\t\t\t\t" + widgetSourcesPhase + " /* Sources */,", "\t\t\t\t" + widgetFrameworksPhase + " /* Frameworks */,",
  "\t\t\t\t" + widgetResourcesPhase + " /* Resources */,", "\t\t\t);",
  "\t\t\tbuildRules = (", "\t\t\t);", "\t\t\tdependencies = (", "\t\t\t);",
  "\t\t\tname = " + WIDGET_NAME + ";", "\t\t\tproductName = " + WIDGET_NAME + ";",
  "\t\t\tproductReference = " + widgetProductRef + " /* " + WIDGET_NAME + ".appex */;",
  "\t\t\tproductType = \"com.apple.product-type.app-extension\";", "\t\t};"
].join("\n");
const proxyLines = [
  "\t\t" + widgetProxy + " /* PBXContainerItemProxy */ = {", "\t\t\tisa = PBXContainerItemProxy;",
  "\t\t\tcontainerPortal = " + pid + " /* Project object */;", "\t\t\tproxyType = 1;",
  "\t\t\tremoteGlobalIDString = " + wid + ";", "\t\t\tremoteInfo = " + WIDGET_NAME + ";", "\t\t};"
].join("\n");
const targetDependencyLines = [
  "\t\t" + widgetDependency + " /* PBXTargetDependency */ = {", "\t\t\tisa = PBXTargetDependency;",
  "\t\t\ttarget = " + wid + " /* " + WIDGET_NAME + " */;", "\t\t\ttargetProxy = " + widgetProxy + " /* PBXContainerItemProxy */;", "\t\t};"
].join("\n");

const projectLines = [
  "\t\t" + pid + " /* Project object */ = {", "\t\t\tisa = PBXProject;", "\t\t\tattributes = {",
  "\t\t\t\tBuildIndependentTargetsInParallel = 1;", "\t\t\t\tLastSwiftUpdateCheck = 1400;", "\t\t\t\tLastUpgradeCheck = 1400;",
  "\t\t\t\tTargetAttributes = {",
  "\t\t\t\t\t" + tid + " = {", "\t\t\t\t\t\tCreatedOnToolsVersion = 14.0;", "\t\t\t\t\t};",
  "\t\t\t\t\t" + wid + " = {", "\t\t\t\t\t\tCreatedOnToolsVersion = 14.0;", "\t\t\t\t\t};",
  "\t\t\t\t};", "\t\t\t};",
  "\t\t\tbuildConfigurationList = " + projectConfigs + " /* Build configuration list for PBXProject \"" + NAME + "\" */;",
  "\t\t\tcompatibilityVersion = \"Xcode 14.0\";", "\t\t\tdevelopmentRegion = en;", "\t\t\thasScannedForEncodings = 0;",
  "\t\t\tknownRegions = (", "\t\t\t\ten,", "\t\t\t\tBase,", "\t\t\t);", "\t\t\tmainGroup = " + mainGroup + ";",
  "\t\t\tproductRefGroup = " + productsGroup + " /* Products */;", "\t\t\tprojectDirPath = \"\";", "\t\t\tprojectRoot = \"\";",
  "\t\t\ttargets = (", "\t\t\t\t" + tid + " /* " + NAME + " */,", "\t\t\t\t" + wid + " /* " + WIDGET_NAME + " */,", "\t\t\t);", "\t\t};"
].join("\n");

// ---------- 7. build settings ----------
const projectShared = {
  SDKROOT: "iphoneos", IPHONEOS_DEPLOYMENT_TARGET: TARGET_OS, SWIFT_VERSION: SWIFT,
  CLANG_ENABLE_MODULES: "YES", CLANG_ENABLE_OBJC_ARC: "YES", ENABLE_STRICT_OBJC_MSGSEND: "YES",
  GCC_C_LANGUAGE_STANDARD: "gnu17", GCC_NO_COMMON_BLOCKS: "YES"
};
const projectDebugSettings = Object.assign({}, projectShared, {
  COPY_PHASE_STRIP: "NO", DEBUG_INFORMATION_FORMAT: "dwarf", ENABLE_TESTABILITY: "YES", GCC_OPTIMIZATION_LEVEL: "0",
  GCC_PREPROCESSOR_DEFINITIONS: ["DEBUG=1", "$(inherited)"], ONLY_ACTIVE_ARCH: "YES",
  SWIFT_ACTIVE_COMPILATION_CONDITIONS: "DEBUG", SWIFT_OPTIMIZATION_LEVEL: "-Onone"
});
const projectReleaseSettings = Object.assign({}, projectShared, {
  COPY_PHASE_STRIP: "NO", DEBUG_INFORMATION_FORMAT: "dwarf-with-dsym", ENABLE_NS_ASSERTIONS: "NO",
  SWIFT_COMPILATION_MODE: "wholemodule", SWIFT_OPTIMIZATION_LEVEL: "-O", VALIDATE_PRODUCT: "YES"
});
const targetShared = {
  ASSETCATALOG_COMPILER_APPICON_NAME: "AppIcon", ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: "AccentColor",
  CODE_SIGN_STYLE: "Automatic", CURRENT_PROJECT_VERSION: BUILD, GENERATE_INFOPLIST_FILE: "NO",
  INFOPLIST_FILE: "Jiangshui/Resources/Info.plist", IPHONEOS_DEPLOYMENT_TARGET: TARGET_OS, MARKETING_VERSION: VERSION,
  PRODUCT_BUNDLE_IDENTIFIER: BUNDLE_ID, PRODUCT_NAME: "$(TARGET_NAME)", SWIFT_EMIT_LOC_STRINGS: "YES",
  SWIFT_VERSION: SWIFT, TARGETED_DEVICE_FAMILY: "1,2"
};
const widgetShared = {
  APPLICATION_EXTENSION_API_ONLY: "YES", CODE_SIGN_STYLE: "Automatic", CURRENT_PROJECT_VERSION: BUILD,
  GENERATE_INFOPLIST_FILE: "NO", INFOPLIST_FILE: WIDGET_DIR + "/Info.plist", IPHONEOS_DEPLOYMENT_TARGET: WIDGET_OS,
  LD_RUNPATH_SEARCH_PATHS: ["$(inherited)", "@executable_path/Frameworks", "@executable_path/../../Frameworks"],
  MARKETING_VERSION: VERSION, PRODUCT_BUNDLE_IDENTIFIER: WIDGET_BUNDLE_ID, PRODUCT_NAME: "$(TARGET_NAME)",
  SKIP_INSTALL: "YES", SUPPORTED_PLATFORMS: "iphoneos iphonesimulator", SWIFT_EMIT_LOC_STRINGS: "YES",
  SWIFT_VERSION: SWIFT, TARGETED_DEVICE_FAMILY: "1,2"
};
function renderSettings(settings) {
  const out = [];
  for (const key of Object.keys(settings).sort()) {
    const value = settings[key];
    if (Array.isArray(value)) {
      out.push("\t\t\t\t" + key + " = (");
      for (const item of value) out.push("\t\t\t\t\t" + Q(item) + ",");
      out.push("\t\t\t\t);");
    } else out.push("\t\t\t\t" + key + " = " + Q(value) + ";");
  }
  return out.join("\n");
}
function renderConfig(idValue, name, settings) {
  return ["\t\t" + idValue + " /* " + name + " */ = {", "\t\t\tisa = XCBuildConfiguration;", "\t\t\tbuildSettings = {",
    renderSettings(settings), "\t\t\t};", "\t\t\tname = " + name + ";", "\t\t};"].join("\n");
}
function renderConfigList(idValue, title, debug, release) {
  return ["\t\t" + idValue + " /* " + title + " */ = {", "\t\t\tisa = XCConfigurationList;", "\t\t\tbuildConfigurations = (",
    "\t\t\t\t" + debug + " /* Debug */,", "\t\t\t\t" + release + " /* Release */,", "\t\t\t);",
    "\t\t\tdefaultConfigurationIsVisible = 0;", "\t\t\tdefaultConfigurationName = Release;", "\t\t};"].join("\n");
}

// ---------- 8. 拼装 ----------
function section(title, entries) {
  return "/* Begin " + title + " section */\n" + entries.join("\n") + "\n/* End " + title + " section */\n";
}
const output = [
  "// !$*UTF8*$!", "{", "\tarchiveVersion = 1;", "\tclasses = {", "\t};", "\tobjectVersion = 56;", "\tobjects = {", "",
  section("PBXBuildFile", buildFileLines),
  section("PBXContainerItemProxy", [proxyLines]),
  section("PBXCopyFilesBuildPhase", [embedPhaseLines]),
  section("PBXFileReference", fileRefLines),
  section("PBXFrameworksBuildPhase", [frameworksPhaseLines, widgetFrameworksPhaseLines]),
  section("PBXGroup", groupLines),
  section("PBXNativeTarget", [targetLines, widgetTargetLines]),
  section("PBXProject", [projectLines]),
  section("PBXResourcesBuildPhase", [resourcesPhaseLines, widgetResourcesPhaseLines]),
  section("PBXSourcesBuildPhase", [sourcesPhaseLines, widgetSourcesPhaseLines]),
  section("PBXTargetDependency", [targetDependencyLines]),
  section("XCBuildConfiguration", [
    renderConfig(projectDebug, "Debug", projectDebugSettings), renderConfig(projectRelease, "Release", projectReleaseSettings),
    renderConfig(targetDebug, "Debug", targetShared), renderConfig(targetRelease, "Release", targetShared),
    renderConfig(widgetDebug, "Debug", widgetShared), renderConfig(widgetRelease, "Release", widgetShared)
  ]),
  section("XCConfigurationList", [
    renderConfigList(projectConfigs, "Build configuration list for PBXProject \"" + NAME + "\"", projectDebug, projectRelease),
    renderConfigList(targetConfigs, "Build configuration list for PBXNativeTarget \"" + NAME + "\"", targetDebug, targetRelease),
    renderConfigList(widgetConfigs, "Build configuration list for PBXNativeTarget \"" + WIDGET_NAME + "\"", widgetDebug, widgetRelease)
  ]),
  "\t};", "\trootObject = " + pid + " /* Project object */;", "}", ""
].join("\n");

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, output, "utf8");
console.log("已生成 " + outputPath);
console.log("主 App Swift " + appSources.length + " 个（其中共享 " + sharedSwift.length + " 个）/ 资源 " + appResources.length + " 个 / 文件引用 " + fileRefLines.length + " 条");
console.log("Widget Extension " + WIDGET_NAME + ": Swift " + widgetSources.length + " 个 / 资源 " + widgetResources.length + " 个 / iOS " + WIDGET_OS + " / bundle " + WIDGET_BUNDLE_ID);
console.log("扩展是否生成：是（" + WIDGET_NAME + ".appex 经 Embed App Extensions 嵌入主 App）");
console.log("web folder reference 1 个");
