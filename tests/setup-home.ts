import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Trust decisions are user-level; tests must never read or write the real user configuration.
process.env.CODE_FACTORY_HOME = mkdtempSync(join(tmpdir(), "code-factory-home-"));
