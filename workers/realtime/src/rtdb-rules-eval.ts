/**
 * @file workers/realtime/src/rtdb-rules-eval.ts
 * @description Pure deterministic Firebase Realtime Database Security Rules evaluator
 * executing `infra/firebase/database.rules.json` directly in CI without external JVM dependencies
 * (`Master Guide File 06 §6.4` & `File 26`).
 *
 * Implements exact Firebase RTDB rule semantics:
 *   - Default deny (`false`), top-down cascading `.read` / `.write` grant (`true` short-circuits),
 *   - Bottom-up `.validate` conjunction (ALL matching `.validate` expressions along the write path
 *     and existing target must evaluate to `true` when `newData` is non-null),
 *   - Full `RuleDataSnapshot` API (`val()`, `exists()`, `isNumber()`, `isString()`, `isBoolean()`,
 *     `hasChild()`, `hasChildren()`, `child()`, `parent()`), `auth`, `now`, `$wildcard` bindings,
 *     and service-account bypass (`isServiceAccount: true`).
 */

export interface RtdbAuthContext {
  readonly uid: string;
  readonly token: Readonly<Record<string, unknown>>;
}

interface SnapshotNode {
  val(): unknown;
  exists(): boolean;
  isNumber(): boolean;
  isString(): boolean;
  isBoolean(): boolean;
  child(relPath: string): SnapshotNode;
  parent(): SnapshotNode;
  hasChild(relPath: string): boolean;
  hasChildren(keys?: readonly string[]): boolean;
}

function getAtSegments(tree: unknown, segs: readonly string[]): unknown {
  let cur: unknown = tree;
  for (const seg of segs) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[seg] ?? null;
  }
  return cur === undefined ? null : cur;
}

function setAtSegments(tree: Record<string, unknown>, segs: readonly string[], value: unknown): Record<string, unknown> {
  const clone = structuredClone(tree);
  if (segs.length === 0) {
    return (value && typeof value === 'object' ? structuredClone(value) : {}) as Record<string, unknown>;
  }
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const seg = segs[i]!;
    const next = cur[seg];
    if (!next || typeof next !== 'object') {
      cur[seg] = {};
    }
    cur = cur[seg] as Record<string, unknown>;
  }
  const leaf = segs[segs.length - 1]!;
  if (value === null || value === undefined) {
    delete cur[leaf];
  } else {
    cur[leaf] = structuredClone(value);
  }
  return clone;
}

function createSnapshot(rootTree: unknown, segs: readonly string[]): SnapshotNode {
  const resolveVal = () => getAtSegments(rootTree, segs);
  return {
    val: resolveVal,
    exists: () => resolveVal() !== null,
    isNumber: () => typeof resolveVal() === 'number' && Number.isFinite(resolveVal() as number),
    isString: () => typeof resolveVal() === 'string',
    isBoolean: () => typeof resolveVal() === 'boolean',
    child: (relPath: string) => {
      const extra = relPath.split('/').filter(Boolean);
      return createSnapshot(rootTree, [...segs, ...extra]);
    },
    parent: () => createSnapshot(rootTree, segs.slice(0, -1)),
    hasChild: (relPath: string) => getAtSegments(rootTree, [...segs, ...relPath.split('/').filter(Boolean)]) !== null,
    hasChildren: (keys?: readonly string[]) => {
      const v = resolveVal();
      if (!v || typeof v !== 'object') return false;
      const obj = v as Record<string, unknown>;
      if (!keys) return Object.keys(obj).length > 0;
      return keys.every((k) => getAtSegments(v, k.split('/').filter(Boolean)) !== null);
    },
  };
}

function evalRuleExpr(
  rule: boolean | string | undefined,
  scope: Readonly<Record<string, unknown>>,
): boolean {
  if (rule === undefined) return false;
  if (typeof rule === 'boolean') return rule;
  const paramNames = Object.keys(scope);
  const paramValues = paramNames.map((k) => scope[k]);
  const fn = new Function(...paramNames, `"use strict"; return Boolean(${rule});`) as (
    ...args: unknown[]
  ) => boolean;
  try {
    return Boolean(fn(...paramValues));
  } catch {
    return false;
  }
}

function collectRuleChain(
  rulesRoot: Record<string, unknown>,
  pathSegs: readonly string[],
): {
  readonly chain: readonly { readonly node: Record<string, unknown>; readonly segIndex: number }[];
  readonly wildcards: Record<string, string>;
} {
  const chain: { node: Record<string, unknown>; segIndex: number }[] = [{ node: rulesRoot, segIndex: 0 }];
  const wildcards: Record<string, string> = {};
  let cursor: Record<string, unknown> | null = rulesRoot;

  for (let i = 0; i < pathSegs.length; i += 1) {
    if (!cursor) break;
    const seg = pathSegs[i]!;
    if (cursor[seg] && typeof cursor[seg] === 'object') {
      cursor = cursor[seg] as Record<string, unknown>;
      chain.push({ node: cursor, segIndex: i + 1 });
      continue;
    }
    const wildKey = Object.keys(cursor).find((k) => k.startsWith('$'));
    if (wildKey && cursor[wildKey] && typeof cursor[wildKey] === 'object') {
      wildcards[wildKey] = seg;
      cursor = cursor[wildKey] as Record<string, unknown>;
      chain.push({ node: cursor, segIndex: i + 1 });
      continue;
    }
    cursor = null;
  }

  return { chain, wildcards };
}

/** Evaluates a read operation against `database.rules.json` at `path`. */
export function evaluateRtdbRead(params: {
  readonly rulesJson: { readonly rules: Record<string, unknown> };
  readonly dbTree: Record<string, unknown>;
  readonly path: string;
  readonly auth: RtdbAuthContext | null;
  readonly isServiceAccount?: boolean;
  readonly nowMs?: number;
}): boolean {
  if (params.isServiceAccount) return true;
  const segs = params.path.split('/').filter(Boolean);
  const { chain, wildcards } = collectRuleChain(params.rulesJson.rules, segs);
  const now = params.nowMs ?? Date.now();

  for (const step of chain) {
    const stepSegs = segs.slice(0, step.segIndex);
    const scope: Record<string, unknown> = {
      auth: params.auth,
      now,
      root: createSnapshot(params.dbTree, []),
      data: createSnapshot(params.dbTree, stepSegs),
      ...wildcards,
    };
    if (evalRuleExpr(step.node['.read'] as boolean | string | undefined, scope)) {
      return true;
    }
  }
  return false;
}

/** Evaluates a write (`set` / `remove`) operation against `database.rules.json` at `path`. */
export function evaluateRtdbWrite(params: {
  readonly rulesJson: { readonly rules: Record<string, unknown> };
  readonly dbTree: Record<string, unknown>;
  readonly path: string;
  readonly newValue: unknown;
  readonly auth: RtdbAuthContext | null;
  readonly isServiceAccount?: boolean;
  readonly nowMs?: number;
}): { readonly allowed: boolean; readonly nextTree: Record<string, unknown> } {
  const segs = params.path.split('/').filter(Boolean);
  const candidateTree = setAtSegments(params.dbTree, segs, params.newValue);
  if (params.isServiceAccount) {
    return { allowed: true, nextTree: candidateTree };
  }

  const { chain, wildcards } = collectRuleChain(params.rulesJson.rules, segs);
  const now = params.nowMs ?? Date.now();

  let writePermitted = false;
  for (const step of chain) {
    const stepSegs = segs.slice(0, step.segIndex);
    const scope: Record<string, unknown> = {
      auth: params.auth,
      now,
      root: createSnapshot(params.dbTree, []),
      data: createSnapshot(params.dbTree, stepSegs),
      newData: createSnapshot(candidateTree, stepSegs),
      ...wildcards,
    };
    if (evalRuleExpr(step.node['.write'] as boolean | string | undefined, scope)) {
      writePermitted = true;
      break;
    }
  }
  if (!writePermitted) {
    return { allowed: false, nextTree: params.dbTree };
  }

  // Firebase rule law: deletes (`newValue === null`) skip `.validate`; non-null writes must satisfy ALL `.validate` rules along chain.
  if (params.newValue !== null && params.newValue !== undefined) {
    for (const step of chain) {
      if (step.node['.validate'] === undefined) continue;
      const stepSegs = segs.slice(0, step.segIndex);
      const scope: Record<string, unknown> = {
        auth: params.auth,
        now,
        root: createSnapshot(params.dbTree, []),
        data: createSnapshot(params.dbTree, stepSegs),
        newData: createSnapshot(candidateTree, stepSegs),
        ...wildcards,
      };
      if (!evalRuleExpr(step.node['.validate'] as boolean | string | undefined, scope)) {
        return { allowed: false, nextTree: params.dbTree };
      }
    }
  }

  return { allowed: true, nextTree: candidateTree };
}
