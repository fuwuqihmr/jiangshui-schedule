import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  checkPermissionSnapshotShape,
  checkPermissionReporterSource,
  runChecks
} from '../tools/check-ios.mjs';

const reporter = readFileSync(path.join(ROOT, 'ios', 'Jiangshui', 'Services', 'PermissionReporter.swift'), 'utf8');

function snapshot() {
  return {
    notifications: { runtime: false, granted: true, systemEnabled: true, allowed: true },
    exactAlarm: { required: false, allowed: true, supported: false },
    battery: { exempt: true },
    autostart: { supported: false, known: false, oem: '', openedAt: 0 }
  };
}

test('permissionStatus 合法快照没有问题', () => {
  assert.deepEqual(checkPermissionSnapshotShape(snapshot()), []);
});

test('permissionStatus 拒绝缺失分组', () => {
  const value = snapshot();
  delete value.notifications;
  assert.ok(checkPermissionSnapshotShape(value).length > 0);
});

test('permissionStatus 拒绝非布尔字段', () => {
  const value = snapshot();
  value.notifications.systemEnabled = 'true';
  assert.ok(checkPermissionSnapshotShape(value).some((item) => item.includes('systemEnabled')));
});

test('permissionStatus 要求 allowed === granted && systemEnabled', () => {
  const value = snapshot();
  value.notifications.allowed = false;
  assert.ok(checkPermissionSnapshotShape(value).some((item) => item.includes('allowed')));
  const value2 = snapshot();
  value2.notifications.systemEnabled = false;
  value2.notifications.allowed = true;
  assert.ok(checkPermissionSnapshotShape(value2).some((item) => item.includes('allowed')));
});

test('permissionStatus 拒绝未登记字段与非负整数约束', () => {
  const extra = snapshot();
  extra.sdk = 33;
  assert.ok(checkPermissionSnapshotShape(extra).some((item) => item.includes('sdk')));
  const nested = snapshot();
  nested.notifications.importance = 4;
  assert.ok(checkPermissionSnapshotShape(nested).length > 0);
  const badOpenedAt = snapshot();
  badOpenedAt.autostart.openedAt = -1;
  assert.ok(checkPermissionSnapshotShape(badOpenedAt).length > 0);
  assert.deepEqual(checkPermissionSnapshotShape(null), ['permissionStatus 必须是对象']);
});

test('PermissionReporter 源码映射固定：runtime=false，systemEnabled/allowed=granted', () => {
  assert.deepEqual(checkPermissionReporterSource(reporter), []);
  const compact = reporter.replace(/\s+/g, '');
  assert.ok(compact.includes('notifications["runtime"]=false'));
  assert.ok(compact.includes('notifications["granted"]=granted'));
  assert.ok(compact.includes('notifications["systemEnabled"]=granted'));
  assert.ok(compact.includes('notifications["allowed"]=granted'));
  // supported=false：iOS 没有精确闹钟概念，web 端据此整行不渲染。
  assert.ok(compact.includes('exactAlarm:JSONObject=["required":false,"allowed":true,"supported":false]'));
  // supported=false：iOS 没有电池优化豁免流程，web 端据此整行不渲染。
  assert.ok(compact.includes('battery:JSONObject=["exempt":true,"supported":false]'));
  assert.ok(compact.includes('autostart:JSONObject=["supported":false,"known":false,"oem":"","openedAt":0]'));
});

test('PermissionReporter 被改坏时能被检出', () => {
  const broken = reporter.replace('notifications["runtime"] = false', 'notifications["runtime"] = true');
  assert.notEqual(broken, reporter);
  assert.ok(checkPermissionReporterSource(broken).length > 0);
});

const results = runChecks(ROOT);
const byId = new Map(results.map((item) => [item.id, item]));
const item = byId.get('C3');
test('检查 C3（NativeServices 13 成员）通过', () => {
  assert.ok(item);
  assert.equal(item.ok, true, item.detail || '');
});
