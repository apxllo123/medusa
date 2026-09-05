import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MacCompatibilityComponentDetector } from "./MacCompatibilityComponentDetector.ts";

const EXECUTABLE_FIXTURE = "/bin/echo";

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
      "xcrun --find metal": EXECUTABLE_FIXTURE,
      [`${EXECUTABLE_FIXTURE} --version`]: "Apple metal version",
      "xcrun --find gpucapture": EXECUTABLE_FIXTURE,
      [`${EXECUTABLE_FIXTURE} --help`]: "usage",
      "xcrun --find gpudebug": EXECUTABLE_FIXTURE,
      "which gameportingtoolkit": EXECUTABLE_FIXTURE,
      "which game-porting-toolkit": "",
    });

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
      EXECUTABLE_FIXTURE
    );
  });

  it("does not invent a component when the resolver fails", async () => {
    const { run } = makeRunner({
      "xcrun --find metal": EXECUTABLE_FIXTURE,
      [`${EXECUTABLE_FIXTURE} --version`]: "Apple metal version",
    });

    const detector = new MacCompatibilityComponentDetector(run);
    const components = await detector.discoverInstalledComponents("arm64");

    assert.deepEqual(components.map((component) => component.id), [
      "apple-metal-compiler",
    ]);
  });
});
