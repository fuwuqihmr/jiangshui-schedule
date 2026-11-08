#!/usr/bin/env node
'use strict';
// HarmonyOS hvigor wrapper shim (project-local, portable).
// Locates a Command Line Tools installation and delegates to its bundled hvigor.
// No absolute machine paths are stored in the project: set DEVECO_CLI_HOME
// (or HARMONY_CLI_HOME), or write the CLI path into hvigor/cli-home.txt.
// When neither is set the wrapper exits with an actionable error instead of guessing.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const hintFile = path.join(__dirname, 'cli-home.txt');

function exists(p) {
  try { fs.accessSync(p); return true; } catch (e) { return false; }
}
function isCliHome(p) {
  return !!p && exists(path.join(p, 'hvigor', 'bin', 'hvigorw.js'));
}
function cliCandidates() {
  const list = [];
  ['DEVECO_CLI_HOME', 'HARMONY_CLI_HOME', 'OHOS_CLI_HOME', 'COMMAND_LINE_TOOLS_HOME']
    .forEach(function (k) { if (process.env[k]) list.push(process.env[k]); });
  if (exists(hintFile)) {
    const hint = fs.readFileSync(hintFile, 'utf8').split(/\r?\n/)[0].trim();
    if (hint) list.push(hint);
  }
  if (process.env.DEVECO_HOME) list.push(path.join(process.env.DEVECO_HOME, 'sdk', 'command-line-tools'));
  list.push(path.join(projectRoot, '..', 'command-line-tools'));
  list.push(path.join(projectRoot, 'command-line-tools'));
  return list;
}
function nodeCandidates(cliHome) {
  const list = [];
  if (process.env.DEVECO_NODE_HOME) list.push(path.join(process.env.DEVECO_NODE_HOME, 'node.exe'), path.join(process.env.DEVECO_NODE_HOME, 'node'));
  list.push(path.join(cliHome, 'tool', 'node', 'node.exe'));
  list.push(path.join(cliHome, 'tool', 'node', 'node'));
  list.push(process.execPath);
  if (process.env.NODE_HOME) list.push(path.join(process.env.NODE_HOME, 'node.exe'), path.join(process.env.NODE_HOME, 'node'));
  return list.filter(Boolean).filter(exists);
}

const args = process.argv.slice(2);
const cliHome = cliCandidates().map(function (p) { return p && path.resolve(p); }).filter(isCliHome)[0];

if (!cliHome) {
  console.error('[hvigorw] ERROR: cannot locate HarmonyOS Command Line Tools (hvigor/bin/hvigorw.js).');
  console.error('[hvigorw] Set DEVECO_CLI_HOME to the "command-line-tools" directory, or write that path into hvigor/cli-home.txt.');
  console.error('[hvigorw] e.g. DEVECO_CLI_HOME=/path/to/command-line-tools');
  process.exit(127);
}

const wrapperJs = path.join(cliHome, 'hvigor', 'bin', 'hvigorw.js');
const nodeBin = nodeCandidates(cliHome)[0];
if (!nodeBin) {
  console.error('[hvigorw] ERROR: no Node.js runtime found (set DEVECO_NODE_HOME, or put node on PATH).');
  process.exit(127);
}

const env = Object.assign({}, process.env);
if (!env.DEVECO_SDK_HOME && exists(path.join(cliHome, 'sdk'))) env.DEVECO_SDK_HOME = path.join(cliHome, 'sdk');
if (!env.DEVECO_CLI_HOME) env.DEVECO_CLI_HOME = cliHome;

process.stderr.write('[hvigorw] CLI: ' + cliHome + '\n');
process.stderr.write('[hvigorw] node: ' + nodeBin + '\n');

const result = spawnSync(nodeBin, [wrapperJs].concat(args), { stdio: 'inherit', cwd: projectRoot, env: env });
if (result.error) {
  console.error('[hvigorw] ERROR: failed to launch hvigor: ' + result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
