// A separate Code Factory process editing the shared trust file, for the cross-process lock test.
// Usage: node --import tsx trust-writer.ts <throwaway project> <project>...
import { grantToolPermission, trustProject, untrustProject } from "../../src/runtime/trust.js";

const [throwaway, ...projects] = process.argv.slice(2);
if (!throwaway) throw new Error("Pass a throwaway project and the projects to trust.");
for (const project of projects) {
  await trustProject(throwaway);
  await trustProject(project);
  await grantToolPermission(project, "kiro");
  await untrustProject(throwaway);
}
