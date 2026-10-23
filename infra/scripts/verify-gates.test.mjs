/**
 * @file infra/scripts/verify-gates.test.mjs
 * @description Automated unit tests for Undal's constitutional CI quality-gate verifier.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countLines, evaluateFileContent, verifyRepository } from './verify-gates.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('countLines handles empty, trailing-newline, and multi-line strings accurately', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('single line\n'), 1);
  assert.equal(countLines('a\nb\nc'), 3);
  assert.equal(countLines('a\nb\nc\n'), 3);
});

test('evaluateFileContent enforces strict 500-line ceiling on authored files', () => {
  const ok500 = Array.from({ length: 500 }, (_, i) => `const x${i} = ${i};`).join('\n');
  assert.deepEqual(evaluateFileContent('workers/api/src/sample.ts', ok500), []);

  const bad501 = Array.from({ length: 501 }, (_, i) => `const x${i} = ${i};`).join('\n');
  const errs = evaluateFileContent('workers/api/src/sample.ts', bad501);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /\[LINE-CAP\]/);
});

test('evaluateFileContent blocks competitor brand leaks, dead UI handlers, TODOs, and FCM notification keys', () => {
  const badCode = [
    'const accent = "#D70F64";',
    '// TODO: wire later',
    'ElevatedButton(onPressed: () {}, child: Text("foodpanda"))',
  ].join('\n');
  const errs = evaluateFileContent('apps/customer_app/lib/bad.dart', badCode);
  assert.equal(errs.length, 4);

  const badFcm = 'export const msg = { notification: { title: "Bad" }, data: { type: "NEW_ORDER" } };';
  const fcmErrs = evaluateFileContent('workers/realtime/src/fcm.ts', badFcm);
  assert.equal(fcmErrs.length, 1);
  assert.match(fcmErrs[0], /\[FCM-DATA-ONLY\]/);
});

test('verifyRepository passes cleanly against the live Undal repository workspace', () => {
  const result = verifyRepository(REPO_ROOT);
  assert.equal(result.errors.length, 0, `Unexpected gate errors: ${result.errors.join('; ')}`);
  assert.ok(result.filesChecked >= 10, 'Expected repository files to be audited');
});
