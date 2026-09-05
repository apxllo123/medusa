export type MacGraphicsApi = "d3d10" | "d3d11" | "d3d12" | "vulkan" | "opengl" | "unknown";

export interface MacGameRequirements {
  graphicsApis: MacGraphicsApi[];
  windowsArchitectures: Array<"x64" | "x86">;
  minimumMemoryBytes: number | null;
  minimumDiskBytes: number | null;
  requiresSsd: boolean;
}

/**
 * Verified public requirements for known titles. This catalog is intentionally
 * small and normalized; it is not the source of truth for whether a stack
 * actually works. Runtime probing remains authoritative.
 */
const KNOWN_REQUIREMENTS: Record<string, MacGameRequirements> = {
  "steam:3751950": {
    graphicsApis: ["d3d12"],
    windowsArchitectures: ["x64"],
    minimumMemoryBytes: 16 * 1024 ** 3,
    minimumDiskBytes: 65 * 1024 ** 3,
    requiresSsd: true,
  },
};

export function getMacGameRequirements(
  shop: string,
  objectId: string
): MacGameRequirements | null {
  return KNOWN_REQUIREMENTS[`${shop}:${objectId}`] ?? null;
}
