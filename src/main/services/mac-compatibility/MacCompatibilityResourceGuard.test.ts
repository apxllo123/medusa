import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MacCompatibilityResourceGuard } from "./MacCompatibilityResourceGuard.ts";

describe("MacCompatibilityResourceGuard", () => {
  it("blocks experiments when free disk is below the budget", () => {
    const guard = new MacCompatibilityResourceGuard({
      maxConcurrentExperiments: 1,
      minimumFreeDiskBytes: 8 * 1024 ** 3,
    });

    assert.equal(guard.canStart(7 * 1024 ** 3), false);
    assert.throws(
      () => guard.acquire(7 * 1024 ** 3),
      /resource safety budget/i
    );
  });

  it("allows one experiment and blocks a second", () => {
    const guard = new MacCompatibilityResourceGuard({
      maxConcurrentExperiments: 1,
      minimumFreeDiskBytes: 0,
    });

    const release = guard.acquire(1);
    assert.equal(guard.activeCount, 1);
    assert.equal(guard.canStart(1), false);

    release();
    assert.equal(guard.activeCount, 0);
    assert.equal(guard.canStart(1), true);
  });

  it("release is idempotent", () => {
    const guard = new MacCompatibilityResourceGuard({
      maxConcurrentExperiments: 1,
      minimumFreeDiskBytes: 0,
    });

    const release = guard.acquire(1);
    release();
    release();

    assert.equal(guard.activeCount, 0);
  });
});
