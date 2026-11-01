/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { authorise, inScope, actorKeys, type Principal } from "../src/rbac/guard.ts";
import { ALL_PERMISSION_KEYS, PERMISSION_COUNT, isPermissionKey, riskOf } from "../src/rbac/keys.ts";
import { ROLE_COUNT, SYSTEM_ROLES, grantsFor, roleAllows } from "../src/rbac/roles.ts";
import { blastRadius, totalGrants, unheldKeys } from "../src/rbac/blast-radius.ts";
import { STEP_UP_KEYS, requiresStepUp, stepUpFresh } from "../src/rbac/step-up.ts";
import { ScopedQuery, zonePredicate, UnscopedQueryError } from "../src/rbac/scope.ts";

/**
 * The authorisation model, as a matrix.
 *
 * 412 keys against 7 roles is 2 884 assertions, and each one is a real question: does this
 * role hold this permission? A role definition written as a predicate can be wrong in a
 * single case, and that case is a support agent issuing a refund they should not, or a
 * dispatcher reading a customer's phone number.
 */

const admin = (role: string, overrides: Partial<Principal> = {}): Principal => ({
  userId: "0193f2a1-7c3e-7890-abcd-ef0123456789",
  actorType: "ADMIN",
  role,
  sessionId: "0193f2a1-7c3e-7890-abcd-ef01234567aa",
  deviceId: "0193f2a1-7c3e-7890-abcd-ef01234567bb",
  zoneScope: null,
  stepUpAtMs: null,
  impersonating: false,
  ...overrides,
});

describe("permission register", () => {
  test("holds exactly 412 unique keys in domain.resource.action form", () => {
    assert.equal(ALL_PERMISSION_KEYS.length, PERMISSION_COUNT);
    assert.equal(new Set(ALL_PERMISSION_KEYS).size, PERMISSION_COUNT);
    for (const key of ALL_PERMISSION_KEYS) {
      assert.match(key, /^[a-z]+(\.[a-z_]+)+$/u, key);
      assert.ok(isPermissionKey(key));
    }
    assert.equal(isPermissionKey("finance.payout.mark_paid"), true);
    assert.equal(isPermissionKey("finance.payout.mark_paid.typo"), false);
  });

  test("classifies risk by verb, and money verbs are critical", () => {
    assert.equal(riskOf("finance.payout.mark_paid"), "CRITICAL");
    assert.equal(riskOf("order.read"), "LOW");
    assert.equal(riskOf("vendor.update"), "HIGH");
    assert.equal(riskOf("analytics.export.personal_data"), "CRITICAL");
  });

  test("the twenty-three step-up actions exist in the register", () => {
    assert.equal(STEP_UP_KEYS.length, 23);
    for (const key of STEP_UP_KEYS) {
      assert.ok(isPermissionKey(key), key);
      assert.equal(requiresStepUp(key), true);
    }
    assert.equal(requiresStepUp("order.read"), false);
  });

  test("every key is reachable and every role is a system role", () => {
    assert.equal(ROLE_COUNT, 7);
    assert.deepEqual(unheldKeys(), []);
    assert.ok(totalGrants() > 400);
    for (const role of SYSTEM_ROLES) assert.equal(role.isSystem, true);
  });
});

describe("the RBAC matrix: 412 keys x 7 roles", () => {
  test("every cell answers consistently, and the invariants hold", () => {
    let cells = 0;
    for (const role of SYSTEM_ROLES) {
      const held = new Set(grantsFor(role.key));
      for (const key of ALL_PERMISSION_KEYS) {
        assert.equal(roleAllows(role.key, key), held.has(key), `${role.key} ${key}`);
        cells += 1;

        // Invariants that make the matrix meaningful rather than a table of booleans.
        if (role.key === "ANALYST" && held.has(key)) assert.notEqual(riskOf(key), "CRITICAL", `analyst holds ${key}`);
        if (role.key === "DISPATCHER" && held.has(key)) assert.ok(!key.startsWith("finance."), `dispatcher holds ${key}`);
        if (role.key === "ONBOARDING" && held.has(key)) assert.ok(!key.startsWith("finance."), `onboarding holds ${key}`);
        if (role.key === "SUPPORT" && held.has(key)) assert.ok(!["finance.cash.write_off", "order.force_cancel"].includes(key));
      }
    }
    assert.equal(cells, PERMISSION_COUNT * ROLE_COUNT);
  });

  test("blast radius is counted, not declared", () => {
    const superAdmin = blastRadius("SUPER_ADMIN");
    assert.equal(superAdmin.keys, PERMISSION_COUNT);
    assert.equal(superAdmin.byRisk.CRITICAL > 0, true);
    const analyst = blastRadius("ANALYST");
    assert.equal(analyst.byRisk.CRITICAL, 0);
    assert.deepEqual(blastRadius("NO_SUCH_ROLE").keys, 0);
  });
});

describe("the guard", () => {
  test("refuses an unauthenticated caller, an unheld permission and a stale step-up", () => {
    assert.equal(authorise(null, { permission: "order.read" }).allowed, false);
    const support = admin("SUPPORT");
    const denied = authorise(support, { permission: "finance.payout.mark_paid" });
    assert.equal(denied.allowed, false);
    assert.equal(denied.allowed === false ? denied.code : "", "PERM_DENIED");

    const finance = admin("FINANCE", { stepUpAtMs: null });
    const stepUp = authorise(finance, { permission: "finance.payout.mark_paid" });
    assert.equal(stepUp.allowed === false ? stepUp.code : "", "PERM_STEP_UP_REQUIRED");
    const proven = admin("FINANCE", { stepUpAtMs: stepUpFreshNow });
    assert.equal(authorise(proven, { permission: "finance.payout.mark_paid" }, { nowMs: stepUpFreshNow }).allowed, true);
    const stale = admin("FINANCE", { stepUpAtMs: stepUpFreshNow - 10 * 60_000 });
    assert.equal(
      authorise(stale, { permission: "finance.payout.mark_paid" }, { nowMs: stepUpFreshNow }).allowed,
      false,
    );
  });

  test("an impersonation session cannot write, whatever role it carries", () => {
    const impersonating = admin("SUPER_ADMIN", { impersonating: true });
    const write = authorise(impersonating, { permission: "order.cancel", write: true });
    assert.equal(write.allowed === false ? write.code : "", "PERM_IMPERSONATION_READONLY");
    assert.equal(authorise(impersonating, { permission: "order.read" }).allowed, true);
  });

  test("zone scope is a predicate, and acting on another zone is refused", () => {
    const scoped = admin("DISPATCHER", { zoneScope: ["sylhet"] });
    assert.equal(inScope(scoped, "sylhet"), true);
    assert.equal(inScope(scoped, "dhaka"), false);
    assert.equal(inScope(scoped, undefined), false);
    const denied = authorise(scoped, { permission: "dispatch.read", zoneId: "dhaka" });
    assert.equal(denied.allowed === false ? denied.code : "", "PERM_ZONE_OUT_OF_SCOPE");
  });

  test("a reason is required where the specification requires one", () => {
    // A ledger adjustment also needs a fresh TOTP, so the reason is the *second* refusal;
    // testing it without the step-up would only re-test the first.
    const finance = admin("FINANCE", { stepUpAtMs: Date.now() });
    const missing = authorise(finance, { permission: "finance.ledger.adjust", reasonRequired: true }, { reason: "fix" });
    assert.equal(missing.allowed === false ? missing.code : "", "VALIDATION_REQUIRED");
    const present = authorise(
      finance,
      { permission: "finance.ledger.adjust", reasonRequired: true },
      { reason: "duplicate posting reversal" },
    );
    assert.equal(present.allowed, true);
  });

  test("customers, vendors and riders hold only their own self-service keys", () => {
    assert.ok(actorKeys("CUSTOMER").includes("order.create"));
    assert.ok(!actorKeys("CUSTOMER").includes("order.force_cancel"));
    assert.ok(!actorKeys("RIDER").includes("finance.payout.mark_paid"));
    const customer = { ...admin("SUPER_ADMIN"), actorType: "CUSTOMER" as const, role: null };
    assert.equal(authorise(customer, { permission: "customer.address.read" }).allowed, true);
    assert.equal(authorise(customer, { permission: "finance.cash.settle" }).allowed, false);
  });
});

const stepUpFreshNow = Date.now();

describe("scoped queries", () => {
  test("a global principal renders without a predicate", () => {
    const query = new ScopedQuery("SELECT `id` FROM `orders`", admin("SUPER_ADMIN")).where("`state` = ?", ["PLACED"]);
    const rendered = query.render();
    assert.equal(rendered.sql, "SELECT `id` FROM `orders` WHERE `state` = ?");
    assert.deepEqual(rendered.params, ["PLACED"]);
  });

  test("a zone-scoped principal always gets its predicate appended", () => {
    const scoped = admin("DISPATCHER", { zoneScope: ["sylhet", "dhaka"] });
    const rendered = new ScopedQuery("SELECT `id` FROM `orders`", scoped).where("`state` = ?", ["PLACED"]).render();
    assert.match(rendered.sql, /`state` = \? AND `zone_id` IN \(\?, \?\)/u);
    assert.deepEqual(rendered.params, ["PLACED", "sylhet", "dhaka"]);
  });

  test("the builder refuses a base statement that already holds a WHERE", () => {
    assert.throws(() => new ScopedQuery("SELECT 1 FROM `orders` WHERE 1 = 1", admin("DISPATCHER")), UnscopedQueryError);
  });

  test("an empty scope denies everything rather than widening", () => {
    const predicate = zonePredicate(admin("DISPATCHER", { zoneScope: [] }));
    assert.equal(predicate?.sql, "1 = 0");
  });
});
