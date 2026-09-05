import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MacCompatibilityGameKey } from "../MacCompatibilityTypes.js";

export const DEFAULT_MAC_ENVIRONMENTS_REGISTRY_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "Hydra",
  "mac-compatibility",
  "environments.json"
);

export const DEFAULT_MAC_ENVIRONMENTS_PATH = join(
  homedir(),
  "Library",
  "Application Support",
  "Hydra",
  "mac-compatibility",
  "environments"
);

export const DEFAULT_MAC_EXPERIMENTS_PATH = join(
  DEFAULT_MAC_ENVIRONMENTS_PATH,
  "experiments"
);

const IDENTITY_HASH_LENGTH = 16;
const MAX_LABEL_LENGTH = 48;

export function sanitizeEnvironmentIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function createEnvironmentId(game: MacCompatibilityGameKey): string {
  const shopLabel = sanitizeEnvironmentIdPart(game.shop) || "shop";
  const objectLabel =
    sanitizeEnvironmentIdPart(game.objectId)
      .slice(0, MAX_LABEL_LENGTH)
      .replace(/-+$/, "") || "game";
  const identityHash = createHash("sha256")
    .update(`${game.shop}\u0000${game.objectId}`)
    .digest("hex")
    .slice(0, IDENTITY_HASH_LENGTH);

  return `${shopLabel}-${objectLabel}-${identityHash}`;
}

export function resolveManagedPrefixPath(
  environmentsPath: string,
  game: MacCompatibilityGameKey
): string {
  return join(resolve(environmentsPath), createEnvironmentId(game));
}

function isContainedIn(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

async function realpathIfExists(targetPath: string): Promise<string | null> {
  try {
    return await realpath(targetPath);
  } catch {
    return null;
  }
}

export async function assertManagedPrefixPath(
  environmentsPath: string,
  prefixPath: string | null | undefined
): Promise<string> {
  if (typeof prefixPath !== "string" || prefixPath.trim() === "") {
    throw new Error(
      "Refusing to modify a Wine environment: no prefix path was provided."
    );
  }

  const resolvedRoot = resolve(environmentsPath);
  const resolvedTarget = resolve(prefixPath);

  if (resolvedTarget === resolvedRoot) {
    throw new Error(
      `Refusing to modify a Wine environment: "${resolvedTarget}" is the environments folder itself.`
    );
  }

  if (!isContainedIn(resolvedRoot, resolvedTarget)) {
    throw new Error(
      `Refusing to modify a Wine environment: "${resolvedTarget}" is outside "${resolvedRoot}".`
    );
  }

  const segments = relative(resolvedRoot, resolvedTarget).split(sep);
  if (segments.length !== 1) {
    throw new Error(
      `Refusing to modify a Wine environment: "${resolvedTarget}" is not a direct child of "${resolvedRoot}".`
    );
  }

  const realRoot = (await realpathIfExists(resolvedRoot)) ?? resolvedRoot;
  const realTarget = await realpathIfExists(resolvedTarget);

  if (realTarget !== null && (realTarget === realRoot || !isContainedIn(realRoot, realTarget))) {
    throw new Error(
      `Refusing to modify a Wine environment: "${resolvedTarget}" really points at "${realTarget}", which is outside "${realRoot}".`
    );
  }

  return resolvedTarget;
}

/**
 * Experiment prefixes may be nested under the dedicated experiment root,
 * but can never escape it. Symlink targets are checked against the real root.
 */
export async function assertManagedExperimentPrefixPath(
  experimentsPath: string,
  prefixPath: string | null | undefined
): Promise<string> {
  if (typeof prefixPath !== "string" || prefixPath.trim() === "") {
    throw new Error(
      "Refusing to modify an experiment prefix: no prefix path was provided."
    );
  }

  const resolvedRoot = resolve(experimentsPath);
  const resolvedTarget = resolve(prefixPath);

  if (!isContainedIn(resolvedRoot, resolvedTarget)) {
    throw new Error(
      `Refusing to modify an experiment prefix: "${resolvedTarget}" is outside "${resolvedRoot}".`
    );
  }

  const realRoot = (await realpathIfExists(resolvedRoot)) ?? resolvedRoot;
  const realTarget = await realpathIfExists(resolvedTarget);

  if (realTarget !== null && !isContainedIn(realRoot, realTarget)) {
    throw new Error(
      `Refusing to modify an experiment prefix: "${resolvedTarget}" really points at "${realTarget}", which is outside "${realRoot}".`
    );
  }

  return resolvedTarget;
}

export function assertPathInsidePrefix(
  prefixPath: string,
  targetPath: string
): string {
  const resolvedPrefix = resolve(prefixPath);
  const resolvedTarget = resolve(targetPath);

  if (!isContainedIn(resolvedPrefix, resolvedTarget)) {
    throw new Error(
      `Refusing to delete "${resolvedTarget}": it is outside the Wine prefix "${resolvedPrefix}".`
    );
  }

  return resolvedTarget;
}
