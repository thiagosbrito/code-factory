// @vitest-environment jsdom

export const step = (id: string, stage: "implementation" | "review") => ({
  id,
  name: id === "quality" ? "Test quality" : id,
  kind: "agent" as const,
  stage,
  role: id,
  instruction: id,
});

export const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const projectConfig = { schemaVersion: 1 as const, name: "Demo", defaultBinding: null };

export const kiroGrant = {
  kiro: { scope: ["execute_bash"] as ["execute_bash"], grantedAt: "2026-10-07T10:00:00.000Z" },
};
