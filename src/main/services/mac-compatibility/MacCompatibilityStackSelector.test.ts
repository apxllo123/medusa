import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MacCompatibilityStackSelector } from "./MacCompatibilityStackSelector.ts";
import { getMacGameRequirements } from "./MacGameRequirementsCatalog.ts";
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
  runtimeFamily: "wine",
};

const gptkWine: MacWineVersion = {
  id: "gptk-wine",
  name: "Game Porting Toolkit Wine",
  version: "wine-test-gptk",
  type: "wine",
  executablePath: "/Applications/Game Porting Toolkit.app/Contents/Resources/wine/bin/wine64",
  isInstalled: true,
  isRecommended: true,
  architecture: "x64",
  runtimeFamily: "apple-gptk",
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
  runtimeFamily: "wine",
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

const dx12Backend: MacCompatibilityComponent = {
  id: "test-dx12-backend",
  name: "Test DX12 graphics backend",
  type: "graphics",
  version: "test",
  executablePath: "/tmp/dx12-backend",
  isInstalled: true,
  architectures: ["arm64"],
  runtimeFamily: "wine",
  supportedGraphicsApis: ["d3d12"],
};

const gptkD3DMetal: MacCompatibilityComponent = {
  id: "apple-d3dmetal",
  name: "Apple D3DMetal (Game Porting Toolkit)",
  type: "graphics",
  version: null,
  executablePath:
    "/Applications/Game Porting Toolkit.app/Contents/Resources/wine/lib/external/D3DMetal.framework/D3DMetal",
  isInstalled: true,
  architectures: ["arm64"],
  runtimeFamily: "apple-gptk",
  supportedGraphicsApis: ["d3d11", "d3d12"],
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
    assert.equal(candidates[0]?.eligible, true);
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

  it("marks Black Flag Resynced ineligible when no DX12 backend exists", () => {
    const selector = new MacCompatibilityStackSelector();
    const candidates = selector.select({
      systemInfo: system,
      wineVersions: [armWine],
      components: [],
      requirements: getMacGameRequirements("steam", "3751950"),
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.eligible, false);
    assert.equal(candidates[0]?.stack.graphicsComponentId, null);
    assert.match(candidates[0]?.reasons.join(" ") ?? "", /D3D12/i);
  });

  it("makes a stack eligible when an installed matching graphics backend advertises DX12", () => {
    const selector = new MacCompatibilityStackSelector();
    const candidates = selector.select({
      systemInfo: system,
      wineVersions: [armWine],
      components: [dx12Backend],
      requirements: getMacGameRequirements("steam", "3751950"),
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.eligible, true);
    assert.equal(candidates[0]?.stack.graphicsComponentId, dx12Backend.id);
    assert.match(candidates[0]?.reasons.join(" ") ?? "", /supports d3d12/i);
  });

  it("allows GPTK Wine on Apple Silicon only when Rosetta is available", () => {
    const selector = new MacCompatibilityStackSelector();
    const candidates = selector.select({
      systemInfo: system,
      wineVersions: [gptkWine],
      components: [gptkD3DMetal],
      requirements: getMacGameRequirements("steam", "3751950"),
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.eligible, true);
    assert.equal(candidates[0]?.stack.runtimeFamily, "apple-gptk");
    assert.equal(candidates[0]?.stack.graphicsComponentId, "apple-d3dmetal");
  });

  it("does not pair Apple D3DMetal with ordinary Wine", () => {
    const selector = new MacCompatibilityStackSelector();
    const candidates = selector.select({
      systemInfo: system,
      wineVersions: [armWine],
      components: [gptkD3DMetal],
      requirements: getMacGameRequirements("steam", "3751950"),
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.eligible, false);
    assert.equal(candidates[0]?.stack.graphicsComponentId, null);
  });
});
