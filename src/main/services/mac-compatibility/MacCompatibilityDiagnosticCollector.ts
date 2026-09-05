export interface MacCompatibilityDiagnosticEvidence {
  source: "process" | "runtime" | "screen" | "system";
  text: string;
  timestamp: string;
  confidence: number;
}

export interface MacCompatibilityDiagnosticRecord {
  id: string;
  failureSignature: string | null;
  evidence: MacCompatibilityDiagnosticEvidence[];
  summary: string;
  createdAt: string;
}

const ANSI_ESCAPE_PATTERN = /\u001B\[[0-?]*[ -/]*[@-~]/g;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Normalizes noisy process/runtime output into a stable signature that can
 * be persisted on a game profile and compared across launches. The
 * diagnostic layer deliberately does not claim that a signature identifies
 * the fix; it only makes repeated failures recognizable.
 */
export function normalizeDiagnosticSignature(text: string): string | null {
  const normalized = text
    .replace(ANSI_ESCAPE_PATTERN, " ")
    .replace(/0x[0-9a-f]+/gi, "0xADDR")
    .replace(/\b\d{1,10}(?:\.\d+){1,4}\b/g, "VERSION")
    .replace(WHITESPACE_PATTERN, " ")
    .trim()
    .toUpperCase();

  if (normalized.length === 0) {
    return null;
  }

  return normalized.slice(0, 1_000);
}

export function createDiagnosticRecord(
  evidence: MacCompatibilityDiagnosticEvidence[]
): MacCompatibilityDiagnosticRecord {
  const text = evidence
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n");

  const failureSignature = normalizeDiagnosticSignature(text);

  const summary =
    evidence.length === 0
      ? "No diagnostic evidence was captured."
      : failureSignature
        ? `Captured ${evidence.length} diagnostic evidence item(s).`
        : "Diagnostic evidence contained no usable text.";

  return {
    id: `diagnostic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    failureSignature,
    evidence,
    summary,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Parses a process result into the same evidence shape that future screen
 * capture and system telemetry collectors will use. Keeping this normalized
 * now lets the autonomous recovery loop reason over one record type.
 */
export function createProcessDiagnosticEvidence(
  stdout: string,
  stderr: string
): MacCompatibilityDiagnosticEvidence[] {
  const timestamp = new Date().toISOString();
  const evidence: MacCompatibilityDiagnosticEvidence[] = [];

  if (stdout.trim()) {
    evidence.push({
      source: "process",
      text: stdout,
      timestamp,
      confidence: 1,
    });
  }

  if (stderr.trim()) {
    evidence.push({
      source: "runtime",
      text: stderr,
      timestamp,
      confidence: 1,
    });
  }

  return evidence;
}
