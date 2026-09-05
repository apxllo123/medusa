const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");
const { execFile } = require("node:child_process");

const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const sourcePath = path.join(
  projectRoot,
  "src",
  "main",
  "native",
  "mac-screen-observer",
  "main.swift"
);
const outputDir = path.join(projectRoot, "mac-native");
const outputPath = path.join(outputDir, "mac-screen-observer");

async function build() {
  if (process.platform !== "darwin") {
    console.log("Skipping Mac screen observer build on non-macOS host.");
    return;
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Swift source not found at ${sourcePath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  await execFileAsync(
    "swiftc",
    [
      "-O",
      "-parse-as-library",
      "-framework",
      "AppKit",
      "-framework",
      "ScreenCaptureKit",
      "-framework",
      "Vision",
      sourcePath,
      "-o",
      outputPath,
    ],
    {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  fs.chmodSync(outputPath, 0o755);
  console.log(`Mac screen observer ready at ${outputPath}`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
