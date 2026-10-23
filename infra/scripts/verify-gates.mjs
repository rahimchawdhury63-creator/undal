#!/usr/bin/env node
/**
 * @file infra/scripts/verify-gates.mjs
 * @description Constitutional quality-gate verifier executed on every commit and CI run.
 * Enforces:
 *   1. <= 500 lines hard limit on every authored repository file (File 28 §4).
 *   2. Secret & private-credential leak detection (D-03, File 09, SEC-02).
 *   3. Competitor brand & forbidden hex (#D70F64) purity check in product code (File 25).
 *   4. Zero placeholders (TODO/FIXME) & zero dead UI handlers in product code (File 26).
 *   5. Strict data-only FCM structural rule — zero `notification:` keys in FCM builders (ALM-01).
 *   6. All Plan Response 1 & Plan Response 2 deliverables present and non-empty (File 27).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_LINES = 500;

const READ_ONLY_PREFIXES = [
  'UNDAL-MASTER-GUIDE/',
  'reference-images/',
];

const GENERATED_FILENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'pubspec.lock',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.dart', '.kt', '.sql', '.css', '.html', '.yaml', '.yml',
]);

/**
 * Splits UTF-8 text into logical line count matching `wc -l` / editor line count.
 * @param {string} content File UTF-8 text content.
 * @returns {number} Logical line count.
 */
export function countLines(content) {
  if (content.length === 0) return 0;
  const normalized = content.endsWith('\n') ? content.slice(0, -1) : content;
  return normalized.split('\n').length;
}

/**
 * Evaluates a single file's content against all constitutional Undal quality rules.
 * @param {string} relPath POSIX path relative to repository root.
 * @param {string} content UTF-8 file content.
 * @returns {string[]} List of human-readable violation messages (empty if clean).
 */
export function evaluateFileContent(relPath, content) {
  const errors = [];
  const baseName = path.posix.basename(relPath);
  const ext = path.posix.extname(relPath).toLowerCase();

  if (READ_ONLY_PREFIXES.some((prefix) => relPath.startsWith(prefix))) {
    return errors;
  }

  // Gate 1: Strict <= 500 lines rule on every non-generated file.
  if (!GENERATED_FILENAMES.has(baseName)) {
    const lines = countLines(content);
    if (lines > MAX_LINES) {
      errors.push(`[LINE-CAP] ${relPath} has ${lines} lines (hard limit is ${MAX_LINES}).`);
    }
  }

  // Gate 2: Secret & credential pattern checks across ALL files (including docs/configs).
  const secretPatterns = [
    { name: 'Private Key Header', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { name: 'Google API Key (AIza)', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
    { name: 'Supabase Secret Key (sb_secret_)', regex: /\bsb_secret_[0-9A-Za-z_-]{20,}\b/ },
    { name: 'GitHub PAT', regex: /\bgh[pousr]_[0-9A-Za-z]{30,}\b/ },
  ];
  for (const rule of secretPatterns) {
    if (rule.regex.test(content)) {
      errors.push(`[SECRET-BAN] ${relPath} matched forbidden pattern: ${rule.name}.`);
    }
  }

  // Product-code-only checks (exclude docs/ markdown analysis & gate scripts themselves).
  const isDocsOrGateSelf =
    relPath.startsWith('docs/') ||
    relPath === 'README.md' ||
    relPath === 'PASTE-THIS-PROMPT.md' ||
    relPath.startsWith('infra/scripts/verify-gates');

  if (!isDocsOrGateSelf && CODE_EXTENSIONS.has(ext)) {
    // Gate 3: Brand purity — forbid competitor names and #D70F64 pink in product code.
    if (/#d70f64/i.test(content)) {
      errors.push(`[BRAND-PURITY] ${relPath} contains forbidden competitor hex #D70F64.`);
    }
    if (/\b(?:foodpanda|pandapro|pandamart|pandapay|pandabox)\b/i.test(content)) {
      errors.push(`[BRAND-PURITY] ${relPath} contains forbidden competitor brand identifier.`);
    }

    // Gate 4: Zero TODO/FIXME placeholders & zero dead empty UI tap handlers.
    if (/\b(?:TODO|FIXME)\b/.test(content)) {
      errors.push(`[NO-PLACEHOLDER] ${relPath} contains forbidden TODO/FIXME marker.`);
    }
    if (/onPressed\s*:\s*\(\s*\)\s*\{\s*\}|onClick\s*=\s*\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/.test(content)) {
      errors.push(`[NO-DEAD-UI] ${relPath} contains an empty dead click/tap handler.`);
    }

    // Gate 5: Strict data-only FCM rule — forbid `notification:` key in FCM sender modules.
    if (/fcm/i.test(relPath) && /['"]?notification['"]?\s*:/.test(content)) {
      errors.push(`[FCM-DATA-ONLY] ${relPath} defines forbidden 'notification:' key (must be data-only).`);
    }
  }

  return errors;
}

/**
 * Runs all repository-wide constitutional gates on `repoRoot`.
 * @param {string} repoRoot Absolute path to repository root.
 * @returns {{ filesChecked: number, errors: string[] }} Verification summary.
 */
export function verifyRepository(repoRoot) {
  const errors = [];
  const requiredFiles = [
    'docs/understanding/01-customer-surface-analysis.md',
    'docs/understanding/02-architecture-understanding.md',
    'docs/understanding/03-risk-register.md',
    'docs/understanding/04-partner-rider-analysis.md',
    'docs/understanding/04a-partner-screens-01-32.md',
    'docs/understanding/04b-partner-screens-33-63.md',
    'docs/understanding/04c-rider-screens-01-44.md',
    'docs/understanding/05-data-model-final.md',
    'docs/understanding/06-api-contract-final.md',
    'docs/understanding/07-admin-registry-final.md',
    'docs/understanding/BUILD-LEDGER.md',
    'docs/adr/ADR-0005-operator-workflow-refinements.md',
    'packages/shared_ts/src/tokens.ts',
    'packages/shared_ts/src/tokens.css',
    'packages/undal_core/lib/src/tokens/undal_tokens.dart',
    '.github/workflows/ci.yml',
    '.github/workflows/keystore-generate.yml',
    '.github/workflows/bootstrap-admin.yml',
  ];

  for (const reqFile of requiredFiles) {
    const abs = path.join(repoRoot, reqFile);
    if (!fs.existsSync(abs) || fs.statSync(abs).size < 100) {
      errors.push(`[MISSING-ARTIFACT] Required deliverable '${reqFile}' is missing or empty.`);
    }
  }

  const rawFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024,
  }).toString('utf8');

  const relPaths = rawFiles.split('\0').filter(Boolean);
  let filesChecked = 0;

  for (const relPath of relPaths) {
    if (READ_ONLY_PREFIXES.some((prefix) => relPath.startsWith(prefix))) continue;
    const absPath = path.join(repoRoot, relPath);
    if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) continue;

    const buf = fs.readFileSync(absPath);
    if (buf.includes(0)) continue; // Skip binary assets (.png, .wav, .ttf).

    filesChecked += 1;
    const fileErrors = evaluateFileContent(relPath, buf.toString('utf8'));
    errors.push(...fileErrors);
  }

  return { filesChecked, errors };
}

const isDirectCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectCli) {
  const repoRoot = process.cwd();
  const { filesChecked, errors } = verifyRepository(repoRoot);
  if (errors.length > 0) {
    console.error(`❌ Undal Quality Gates FAILED (${errors.length} violation(s) across ${filesChecked} files):`);
    for (const err of errors) console.error(`   - ${err}`);
    process.exit(1);
  }
  console.log(`✅ Undal Quality Gates PASSED (${filesChecked} authored text files audited; 0 violations).`);
}
