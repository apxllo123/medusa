import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MacCompatibilityComponentDetector } from "./MacCompatibilityComponentDetector.ts";

const makeRunner = (responses: Record<string, string>) => {
  const calls: Array<{ file: string; args: string[] }> = [];

  const run = async (file: string, args: string[]): Promise<string> => {
    calls.push({ file, args });

    const key = `${file} ${args.join(" ")}`;
    const response = responses[key];

    if (response === undefined) {
      throw new Error(`Unexpected command: ${key}`);
    }

    return response;
  };

  return { run, calls };
};

describe("MacCompatibilityComponentDetector", () => {
  it("returns no components for an unknown architecture", async () => {
    const { run, calls } = makeRunner({});
    const detector = new MacCompatibilityComponentDetector(run);

    const components = await detector.discoverInstalledComponents("unknown");

    assert.deepEqual(components, []);
    assert.deepEqual(calls, []);
  });

  it("discovers positively located Apple Metal tooling", async () => {
    const { run } = makeRunner({
      "xcrun --find metal": "/Applications/Xcode.app/Contents/Developer/usr/bin/metal",
      "/Applications/Xcode.app/Contents/Developer/usr/bin/metal --version": "Apple metal version",
      "xcrun --find gpucapture": "/usr/bin/gpucapture",
      "/usr/bin/gpucapture --help": "usage",
      "xcrun --find gpudebug": "/usr/bin/gpudebug",
      "/usr/bin/gpudebug --help": "usage",
      "which gameportingtoolkit": "/opt/homebrew/bin/gameportingtoolkit",
      "/opt/homebrew/bin/gameportingtoolkit --help": "usage",
      "which game-porting-toolkit": "",
    });

    // The fake runner does not perform fs access checks, so this test is
    // about command resolution and component shaping rather than the host
    // filesystem. The real implementation adds the executable-bit check.
    const detector = new MacCompatibilityComponentDetector(run);
    const components = await detector.discoverInstalledComponents("arm64");

    assert.deepEqual(
      components.map((component) => component.id),
      [
        "apple-metal-compiler",
        "apple-gpucapture",
        "apple-gpudebug",
        "apple-gptk",
      ]
    );

    assert.equal(components[0]?.type, "tooling");
    assert.equal(
      components.find((component) => component.id === "apple-gptk")
        ?.executablePath,
      "/opt/homebrew/bin/gameportingtoolkit"
    );
  });

  it("does not invent a component when the resolver fails", async () => {
    const { run } = makeRunner({
      "xcrun --find metal": "/Applications/Xcode.app/Contents/Developer/usr/bin/metal",
      "/Applications/Xcode.app/Contents/Developer/usr/bin/metal --version": "Apple metal version",
      // Other resolvers are intentionally absent and therefore fail.
    });

    const detector = new MacCompatibilityComponentDetector(run);
    const components = await detector.discoverInstalledComponents("arm64");

    assert.deepEqual(components.map((component) => component.id), [
      "apple-metal-compiler",
    ]);
  });
});
