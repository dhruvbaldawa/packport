// ABOUTME: Verifies pack.lock.yaml generation, parsing, and source drift detection.
// ABOUTME: Keeps lockfile authority deterministic before target adapters exist.

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { checkPackRepository } from "../src/core/check";
import { discoverPackRepository } from "../src/core/discovery";
import {
  createPackLock,
  detectLockDrift,
  PACK_LOCK_FILE,
  readPackLock,
  serializePackLock,
  writePackLock,
} from "../src/core/lockfile";

describe("pack.lock.yaml", () => {
  test("creates deterministic lockfile content from discovered sources", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");

    const serialized = serializePackLock(lock);
    const secondLock = await createPackLock(rootPath, discovery.index, "0.0.0");

    expect(serialized).toBe(serializePackLock(secondLock));
    expect(serialized).toContain("path: packs/essentials/PACK.md");
    expect(serialized).toContain("path: packs/essentials/commands/commit/COMMAND.md");
    expect(serialized).toContain("path: packs/essentials/commands/commit/ASSET.md");
    expect(serialized).not.toContain(rootPath);
  });

  test("round-trips through pack.lock.yaml", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");

    await writePackLock(rootPath, lock);

    expect(await readPackLock(rootPath)).toEqual({ diagnostics: [], lock });
    expect(await readFile(join(rootPath, PACK_LOCK_FILE), "utf8")).toBe(serializePackLock(lock));
  });

  test("detects changed locked source files", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");

    await writeFile(join(rootPath, "packs/essentials/commands/commit/COMMAND.md"), "# Changed\n");

    expect(await detectLockDrift(rootPath, lock, discovery.index)).toContainEqual({
      code: "source-drift",
      message: "Locked source file hash differs from current contents.",
      path: join(rootPath, "packs/essentials/commands/commit/COMMAND.md"),
      severity: "error",
    });
  });

  test("detects missing locked source files", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");

    await rm(join(rootPath, "packs/essentials/commands/commit/COMMAND.md"));

    expect(await detectLockDrift(rootPath, lock, discovery.index)).toContainEqual({
      code: "missing-locked-source",
      message: "Locked source file is missing.",
      path: join(rootPath, "packs/essentials/commands/commit/COMMAND.md"),
      severity: "error",
    });
  });

  test("reports locked source paths that are directories", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");
    const asset = first(lock.assets);
    const invalidLock = {
      ...lock,
      assets: [
        {
          ...asset,
          payloads: [{ hash: "abc", path: "packs/essentials/commands/commit" }],
        },
      ],
    };

    expect(await detectLockDrift(rootPath, invalidLock, discovery.index)).toContainEqual({
      code: "invalid-locked-source",
      message: "Locked source path must be a regular file.",
      path: join(rootPath, "packs/essentials/commands/commit"),
      severity: "error",
    });
  });

  test("reports in-memory locked source paths outside the repository", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");
    const pack = first(lock.packs);
    const invalidLock = {
      ...lock,
      packs: [{ ...pack, hash: "abc", path: "../outside/PACK.md" }],
    };

    expect(await detectLockDrift(rootPath, invalidLock, discovery.index)).toContainEqual({
      code: "invalid-locked-source",
      message: "Locked source path must be relative and stay inside the repository.",
      path: join(rootPath, "../outside/PACK.md"),
      severity: "error",
    });
  });

  test("reports in-memory locked source paths with backslashes", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");
    const pack = first(lock.packs);
    const invalidLock = {
      ...lock,
      packs: [{ ...pack, hash: "abc", path: "packs\\essentials\\PACK.md" }],
    };

    expect(await detectLockDrift(rootPath, invalidLock, discovery.index)).toContainEqual({
      code: "invalid-locked-source",
      message: "Locked source path must be relative and stay inside the repository.",
      path: join(rootPath, "packs\\essentials\\PACK.md"),
      severity: "error",
    });
  });

  test("reports locked source paths that are symlinks", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");
    await writeFile(join(rootPath, "outside.txt"), "outside\n");
    await symlink(join(rootPath, "outside.txt"), join(rootPath, "packs/essentials/link.md"));
    const pack = first(lock.packs);
    const invalidLock = {
      ...lock,
      packs: [{ ...pack, hash: "abc", path: "packs/essentials/link.md" }],
    };

    expect(await detectLockDrift(rootPath, invalidLock, discovery.index)).toContainEqual({
      code: "invalid-locked-source",
      message: "Locked source path must not contain symlinks.",
      path: join(rootPath, "packs/essentials/link.md"),
      severity: "error",
    });
  });

  test("reports locked source paths with intermediate symlink components", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");
    await mkdir(join(rootPath, "outside"));
    await writeFile(join(rootPath, "outside/COMMAND.md"), "# Outside\n");
    await symlink(join(rootPath, "outside"), join(rootPath, "packs/essentials/linked"));
    const pack = first(lock.packs);
    const invalidLock = {
      ...lock,
      packs: [{ ...pack, hash: "abc", path: "packs/essentials/linked/COMMAND.md" }],
    };

    expect(await detectLockDrift(rootPath, invalidLock, discovery.index)).toContainEqual({
      code: "invalid-locked-source",
      message: "Locked source path must not contain symlinks.",
      path: join(rootPath, "packs/essentials/linked"),
      severity: "error",
    });
  });

  test("refuses to hash discovered source symlinks", async () => {
    const rootPath = await createValidPackRepository();
    await rm(join(rootPath, "packs/essentials/commands/commit/COMMAND.md"));
    await writeFile(join(rootPath, "outside.md"), "# Outside\n");
    await symlink(
      join(rootPath, "outside.md"),
      join(rootPath, "packs/essentials/commands/commit/COMMAND.md"),
    );
    const discovery = await discoverPackRepository(rootPath);

    await expect(createPackLock(rootPath, discovery.index, "0.0.0")).rejects.toThrow(
      "Locked source path must not contain symlinks.",
    );
  });

  test("check reads existing pack.lock.yaml before reporting drift", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");
    await writePackLock(rootPath, lock);
    await writeFile(join(rootPath, "packs/essentials/commands/commit/COMMAND.md"), "# Changed\n");

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.lock).toEqual(lock);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("source-drift");
  });

  test("check reports malformed pack.lock.yaml without throwing", async () => {
    const rootPath = await createValidPackRepository();
    await writeFile(join(rootPath, PACK_LOCK_FILE), "packs: nope\n");

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "invalid-lockfile",
      message: "pack.lock.yaml must have lockfileVersion: 1.",
      path: join(rootPath, PACK_LOCK_FILE),
      severity: "error",
    });
  });

  test("check reports syntactically invalid pack.lock.yaml without throwing", async () => {
    const rootPath = await createValidPackRepository();
    await writeFile(join(rootPath, PACK_LOCK_FILE), "lockfileVersion: [\n");

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "invalid-lockfile-yaml",
    );
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "invalid-lockfile-yaml" &&
          diagnostic.path === join(rootPath, PACK_LOCK_FILE) &&
          diagnostic.severity === "error",
      ),
    ).toBe(true);
  });

  test("check validates lockfile tool metadata and top-level lists", async () => {
    const rootPath = await createValidPackRepository();
    await writeFile(
      join(rootPath, PACK_LOCK_FILE),
      `lockfileVersion: 1
tool:
  name: other
  version: 0.0.0
packs: nope
assets: nope
decisions: nope
outputs: nope
`,
    );

    const result = await checkPackRepository(rootPath);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message);

    expect(result.ok).toBe(false);
    expect(messages).toContain("pack.lock.yaml tool metadata is invalid.");
    expect(messages).toContain("pack.lock.yaml packs must be a list.");
    expect(messages).toContain("pack.lock.yaml assets must be a list.");
    expect(messages).toContain("pack.lock.yaml decisions must be a list.");
    expect(messages).toContain("pack.lock.yaml outputs must be a list.");
  });

  test("check validates lockfile asset and source entries", async () => {
    const rootPath = await createValidPackRepository();
    await writeFile(
      join(rootPath, PACK_LOCK_FILE),
      `lockfileVersion: 1
tool:
  name: packport
  version: 0.0.0
packs:
  - id: essentials
    version: 1.0.0
    path: packs/essentials/PACK.md
    hash: abc
assets:
  - id: essentials/command/broken
    kind: command
    payloads: nope
  - id: essentials/command/commit
    kind: command
    payloads:
      - path: packs/essentials/commands/commit/COMMAND.md
        hash: abc
    contract:
      path: ../outside/ASSET.md
      hash: abc
decisions: []
outputs: []
`,
    );

    const result = await checkPackRepository(rootPath);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message);

    expect(result.ok).toBe(false);
    expect(messages).toContain("Locked asset entry is invalid.");
    expect(messages).toContain("Locked source entry is invalid.");
  });

  test("check validates lockfile decision and output entries", async () => {
    const rootPath = await createValidPackRepository();
    await writeFile(
      join(rootPath, PACK_LOCK_FILE),
      `lockfileVersion: 1
tool:
  name: packport
  version: 0.0.0
packs: []
assets: []
decisions:
  - 1
outputs:
  - false
`,
    );

    const result = await checkPackRepository(rootPath);
    const messages = result.diagnostics.map((diagnostic) => diagnostic.message);

    expect(result.ok).toBe(false);
    expect(messages).toContain("Locked decision entries must be strings.");
    expect(messages).toContain("Locked output entries must be strings.");
  });

  test("check rejects lockfile paths outside the repository", async () => {
    const rootPath = await createValidPackRepository();
    await writeFile(
      join(rootPath, PACK_LOCK_FILE),
      `lockfileVersion: 1
tool:
  name: packport
  version: 0.0.0
packs:
  - id: essentials
    version: 1.0.0
    path: ../outside/PACK.md
    hash: abc
assets: []
decisions: []
outputs: []
`,
    );

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "invalid-lockfile",
      message: "Locked pack entry is invalid.",
      path: join(rootPath, PACK_LOCK_FILE),
      severity: "error",
    });
  });

  test("check rejects lockfile paths with backslashes", async () => {
    const rootPath = await createValidPackRepository();
    await writeFile(
      join(rootPath, PACK_LOCK_FILE),
      `lockfileVersion: 1
tool:
  name: packport
  version: 0.0.0
packs:
  - id: essentials
    version: 1.0.0
    path: packs\\essentials\\PACK.md
    hash: abc
assets: []
decisions: []
outputs: []
`,
    );

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "invalid-lockfile",
      message: "Locked pack entry is invalid.",
      path: join(rootPath, PACK_LOCK_FILE),
      severity: "error",
    });
  });

  test("check reports new source files not present in pack.lock.yaml", async () => {
    const rootPath = await createValidPackRepository();
    const discovery = await discoverPackRepository(rootPath);
    const lock = await createPackLock(rootPath, discovery.index, "0.0.0");
    await writePackLock(rootPath, lock);
    await mkdir(join(rootPath, "packs/essentials/commands/status"), { recursive: true });
    await writeFile(join(rootPath, "packs/essentials/commands/status/COMMAND.md"), "# Status\n");

    const result = await checkPackRepository(rootPath);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual({
      code: "unlocked-source",
      message: "Source file is not recorded in pack.lock.yaml.",
      path: join(rootPath, "packs/essentials/commands/status/COMMAND.md"),
      severity: "error",
    });
  });
});

/** Creates a valid temporary pack repository with one command and optional ASSET.md. */
async function createValidPackRepository(): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), "packport-lock-"));
  await mkdir(join(rootPath, "packs/essentials/commands/commit"), { recursive: true });
  await writeFile(
    join(rootPath, "packs/essentials/PACK.md"),
    `Name: Essentials
Version: 1.0.0
Description: Core workflows.
`,
  );
  await writeFile(join(rootPath, "packs/essentials/commands/commit/COMMAND.md"), "# Commit\n");
  await writeFile(
    join(rootPath, "packs/essentials/commands/commit/ASSET.md"),
    `# Packaging Notes

## Needs

- Git read capability.
`,
  );

  return rootPath;
}

/** Returns the first item or throws so tests do not rely on non-null assertions. */
function first<T>(items: readonly T[]): T {
  const item = items[0];

  if (item === undefined) {
    throw new Error("Expected test fixture to contain at least one item.");
  }

  return item;
}
