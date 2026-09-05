import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MacCompatibilityStackSelector } from "./MacCompatibilityStackSelector.ts";
import type {
  MacCompatibilityComponent,
  MacSystemInfo,
  MacWineVersion,
} from "./MacCompatibilityTypes.ts";

const system: MacSystemInfo = {
  platform: "macos",
  architecture: "arm64",
  osVersion: "unknown",
  computerName: "Test Mac",
  isAppleSilicon: true,
  isIntel: false,
  memoryBytes: 0,
  availableDiskBytes: 0,
  wineAvailable: true,
  protonAvailable: false,
  rosettaAvailable: true,
  compatibilityComponents: [],
};

const armWine: MacWineVersion = {
  id: "wine-arm",
  name: "Wine ARM",
  version: "wine-test",
  type: "wine",
  executablePath: "/tmp/wine-arm",
  isInstalled: true,
  isRecommended: true,
  architecture: "arm64",
};

const intelWine: MacWineVersion = {
  id: "wine-intel",
  name: "Wine Intel",
  version: "wine-test",
  type: "wine",
  executablePath: "/tmp/wine-intel",
  isInstalled: true,
  isRecommended: false,
  architecture: "x64",
};

const metalTool: MacCompatibilityComponent = {
  id: "apple-metal-compiler",
  name: "Apple Metal compiler",
  type: "tooling",
  version: null,
  executablePath: "/usr/bin/metal",
  isInstalled: true,
  architectures: ["arm64", "x64"],
};

describe("MacCompatibilityStackSelector", () => {
  it("prefers a recommended architecture-matching runtime", () => {
    const selector = new MacCompatibilityStackSelector();
    const candidates = selector.select({
      systemInfo: system,
      wineVersions: [intelWine, armWine],
      components: [metalTool],
    });

    assert.equal(candidates[0]?.stack.id, "wine:wine-arm");
    assert.ok((candidates[0]?.score ?? 0) > (candidates[1]?.score ?? 0));
    assert.ok(candidates[0]?.stack.toolingComponentIds.includes("apple-metal-compiler"));
  });

  it("does not select an incompatible runtime architecture", () => {
    const selector = new MacCompatibilityStackSelector();
    const candidates = selector.select({
      systemInfo: system,
      wineVersions: [intelWine],
      components: [],
    });

    assert.deepEqual(candidates, []);
  });

  it("gives a stored preferred stack a deterministic bonus", () => {
    const selector = new MacCompatibilityStackSelector();
    const candidates = selector.select({
      systemInfo: system,
      wineVersions: [armWine],
      components: [],
      preferredStackId: "wine:wine-arm",
    });

    assert.equal(candidates[0]?.stack.confidence, null);
    assert.equal(candidates[0]?.stack.id, "wine:wine-arm");
    assert.match(candidates[0]?.reasons.join(" ") ?? "", /stored preferred stack/i);
  });
});
