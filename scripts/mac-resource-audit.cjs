const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const appRoot = path.join(
  root,
  "dist",
  "mac-arm64",
  "Medusa.app",
  "Contents",
  "Resources"
);

const requiredResources = [
  { path: "7zz", kind: "file", required: true },
  { path: "hydra-python-rpc/hydra-python-rpc", kind: "file", required: true },
  { path: "mac-screen-observer", kind: "file", required: true },
];

const findings = requiredResources.map((entry) => {
  const absolutePath = path.join(appRoot, entry.path);
  const exists = fs.existsSync(absolutePath);
  let executable = false;

  if (exists && entry.kind === "file") {
    try {
      const stat = fs.statSync(absolutePath);
      executable = (stat.mode & 0o111) !== 0;
    } catch {
      executable = false;
    }
  }

  return {
    ...entry,
    absolutePath,
    exists,
    executable,
    ok: exists && executable,
  };
});

const passed = findings.every((finding) => finding.ok);
const result = {
  generatedAt: new Date().toISOString(),
  appResourcesRoot: appRoot,
  passed,
  findings,
};

fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
const outputPath = path.join(root, "artifacts", "mac-resource-audit.json");
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

for (const finding of findings) {
  console.log(
    `[mac-resource-audit] ${finding.ok ? "OK" : "MISSING/BAD"}: ${finding.path}`
  );
}

console.log(`Mac resource audit: ${passed ? "PASS" : "FAIL"}`);
console.log(`Wrote ${outputPath}`);

if (!passed) {
  process.exitCode = 1;
}
