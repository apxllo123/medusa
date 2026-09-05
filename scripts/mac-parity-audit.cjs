const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const sourceRoots = ["src/main", "src/renderer/src", "src/preload"];
const patterns = [
  /process\.platform\s*===\s*["']win32["']/,
  /process\.platform\s*===\s*["']linux["']/,
  /path\.win32/,
  /\\\\\\\\\\\\\\\\\\\\\\\\/, 
  /\.exe\b/i,
  /\.dll\b/i,
  /wineprefix/i,
  /winePrefix/i,
  /steamcompatdata/i,
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "out", "dist"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|cjs|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const findings = [];
for (const relativeRoot of sourceRoots) {
  for (const file of walk(path.join(root, relativeRoot))) {
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (patterns.some((pattern) => pattern.test(line))) {
        findings.push({ file: path.relative(root, file), line: index + 1, text: line.trim() });
      }
    });
  }
}

const result = {
  generatedAt: new Date().toISOString(),
  findingCount: findings.length,
  findings,
};

fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
const output = path.join(root, "artifacts", "mac-parity-audit.json");
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(`Mac parity audit: ${findings.length} findings`);
console.log(`Wrote ${output}`);
