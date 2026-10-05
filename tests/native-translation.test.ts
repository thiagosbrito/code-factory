import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLoopDraft, parseLoop } from "../src/domain/loop.js";
import {
  applyNative,
  nativeCandidates,
  nativeFormats,
  previewNative,
} from "../src/runtime/native-translation.js";

const roots: string[] = [];
const project = async () => {
  const root = await mkdtemp(join(tmpdir(), "factory-native-"));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const draft = () => createLoopDraft("native", "Native");
const request = (loop: unknown, name = "sample") => ({
  format: "cursor-rule-mdc",
  name,
  loop,
});
const rulePath = (root: string, name = "sample") => join(root, ".cursor", "rules", `${name}.mdc`);

describe("native configuration translation", () => {
  it("round trips representable name and instructions without implying a runner", async () => {
    const root = await project();
    const loop = parseLoop({
      ...draft(),
      steps: [
        {
          id: "write",
          name: "Review code",
          kind: "agent",
          role: "",
          instruction: "Review carefully.\n",
        },
      ],
    });
    expect(nativeFormats()).toEqual([
      {
        format: "cursor-rule-mdc",
        provider: "cursor",
        label: "Cursor project rule (.mdc)",
      },
    ]);
    const preview = await previewNative(root, request(loop), "export");
    expect(preview.relativePath).toBe(".cursor/rules/sample.mdc");
    expect(preview.report.issues).toContainEqual(
      expect.objectContaining({ field: "ruleActivation", kind: "lossy" }),
    );
    await applyNative(root, { ...request(loop), expectedRevision: preview.revision }, "export");
    expect(await readFile(rulePath(root), "utf8")).toContain('description: "Review code"');
    expect(await nativeCandidates(root, "cursor-rule-mdc")).toEqual(["sample"]);
    const imported = await previewNative(root, request(draft()), "import");
    if (!("loop" in imported)) throw new Error("Expected imported loop");
    const applied = await applyNative(
      root,
      { ...request(draft()), expectedRevision: imported.revision },
      "import",
    );
    expect(applied).toEqual(imported);
    expect(imported.loop?.steps[0]).toMatchObject({
      name: "Review code",
      instruction: "Review carefully.\n",
    });
    expect(imported.loop?.steps[0]?.binding).toBeUndefined();
    expect(imported.report.issues).toContainEqual(
      expect.objectContaining({ field: "alwaysApply", kind: "unsupported" }),
    );
  });

  it("reports lossy loop fields and rejects existing files without changing user content", async () => {
    const root = await project();
    const loop = parseLoop({
      ...draft(),
      steps: [
        { id: "one", name: "One", kind: "agent", role: "builder", instruction: "Do one" },
        { id: "two", name: "Two", kind: "agent", role: "", instruction: "Do two" },
      ],
      dependencies: [{ from: "one", to: "two" }],
    });
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    await writeFile(rulePath(root), "user content");
    await writeFile(join(root, ".cursor", "rules", "other.mdc"), "keep me");
    const preview = await previewNative(root, request(loop), "export");
    expect(preview.report.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(["steps", "dependencies", "steps[0].role"]),
    );
    expect(preview.conflicts).toHaveLength(1);
    await expect(
      applyNative(root, { ...request(loop), expectedRevision: preview.revision }, "export"),
    ).rejects.toThrow("already exists");
    expect(await readFile(rulePath(root), "utf8")).toBe("user content");
    expect(await readFile(join(root, ".cursor", "rules", "other.mdc"), "utf8")).toBe("keep me");
  });

  it("rejects malformed input, changed previews, links, path escapes, and incompatible versions", async () => {
    const root = await project();
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    await writeFile(rulePath(root), "---\ndescription: Rule\nalwaysApply: perhaps\n---\nBody");
    await expect(previewNative(root, request(draft()), "import")).rejects.toThrow("boolean");
    await writeFile(rulePath(root), "---\ndescription: Rule\nglobs: [\n---\nBody");
    await expect(previewNative(root, request(draft()), "import")).rejects.toThrow("globs");
    await writeFile(
      rulePath(root),
      "---\ndescription: Rule\nglobs: *.ts\nalwaysApply: true\n---\nBody",
    );
    const preview = await previewNative(root, request(draft()), "import");
    expect(preview.report.issues).toContainEqual(
      expect.objectContaining({ field: "globs", kind: "unsupported" }),
    );
    await writeFile(rulePath(root), "---\ndescription: Changed\nalwaysApply: true\n---\nBody");
    await expect(
      applyNative(root, { ...request(draft()), expectedRevision: preview.revision }, "import"),
    ).rejects.toThrow("changed since preview");
    await expect(previewNative(root, request(draft(), "../escape"), "import")).rejects.toThrow(
      "Invalid string",
    );
    await expect(
      previewNative(root, { ...request(draft()), format: "claude-instructions" }, "import"),
    ).rejects.toThrow("Unsupported");
    await expect(
      previewNative(root, request({ ...draft(), schemaVersion: 999 }), "import"),
    ).rejects.toThrow("Invalid input");
    await symlink(rulePath(root), rulePath(root, "linked"));
    await expect(previewNative(root, request(draft(), "linked"), "import")).rejects.toThrow("link");
  });

  it("preserves an existing draft on import and rejects linked provider directories", async () => {
    const root = await project();
    await symlink(tmpdir(), join(root, ".cursor"));
    await expect(previewNative(root, request(draft()), "export")).rejects.toThrow("link");
    await rm(join(root, ".cursor"));
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    await writeFile(rulePath(root), "---\ndescription: Rule\n---\nBody");
    const populated = parseLoop({
      ...draft(),
      steps: [{ id: "one", name: "One", kind: "agent", role: "", instruction: "Own" }],
    });
    await expect(previewNative(root, request(populated), "import")).rejects.toThrow("empty draft");
  });

  it("rejects an export when another writer creates the target after preview", async () => {
    const root = await project();
    const loop = parseLoop({
      ...draft(),
      steps: [{ id: "one", name: "One", kind: "agent", role: "", instruction: "Do one" }],
    });
    const preview = await previewNative(root, request(loop), "export");
    await mkdir(join(root, ".cursor", "rules"), { recursive: true });
    await writeFile(rulePath(root), "new user content");
    await expect(
      applyNative(root, { ...request(loop), expectedRevision: preview.revision }, "export"),
    ).rejects.toThrow("changed since preview");
    expect(await readFile(rulePath(root), "utf8")).toBe("new user content");
  });
});
