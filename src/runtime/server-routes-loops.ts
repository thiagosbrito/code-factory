import { parseLoop } from "../domain/loop.js";
import { catalogProblem } from "../domain/binding-catalog.js";
import {
  nativeCandidates,
  nativeFormats,
  previewNative,
  applyNative,
} from "./native-translation.js";
import { ProjectError, readProjectConfig } from "./project.js";
import {
  listLoops,
  listPublishedLoops,
  publishDraft,
  readDraft,
  readPublishedVersion,
  saveDraft,
} from "./storage.js";
import { json, readBody, type RouteHandler } from "./server-http.js";

/** The loops library and the native import/export routes; the non-GET-gated half. */
export const handleLoopRoutes: RouteHandler = async (ctx) => {
  const { request, response, pathname, projectDirectory, connections } = ctx;
  if (pathname === "/api/loops" && request.method === "GET") {
    json(response, 200, { loops: await listLoops(projectDirectory) });
    return true;
  }
  if (pathname === "/api/native/formats" && request.method === "GET") {
    json(response, 200, { formats: nativeFormats() });
    return true;
  }
  if (pathname === "/api/native/candidates" && request.method === "GET") {
    const format = ctx.url.searchParams.get("format") ?? "";
    json(response, 200, { names: await nativeCandidates(projectDirectory, format) });
    return true;
  }
  const nativePath = /^\/api\/native\/(import|export)\/(preview|apply)$/.exec(pathname);
  if (nativePath && request.method === "POST") {
    const input = await readBody(request);
    const direction = nativePath[1] as "import" | "export";
    json(
      response,
      200,
      nativePath[2] === "preview"
        ? await previewNative(projectDirectory, input, direction)
        : await applyNative(projectDirectory, input, direction),
    );
    return true;
  }
  const loopPath =
    /^\/api\/loops\/([a-z][a-z0-9-]{0,63})(?:\/(draft|publish|versions\/([1-9][0-9]*)))?$/.exec(
      pathname,
    );
  if (loopPath?.[1]) {
    const id = loopPath[1];
    const operation = loopPath[2];
    if (request.method === "GET" && operation === "draft") {
      json(response, 200, { loop: await readDraft(projectDirectory, id) });
      return true;
    }
    if (request.method === "GET" && operation?.startsWith("versions/")) {
      json(response, 200, {
        loop: await readPublishedVersion(projectDirectory, id, Number(loopPath[3])),
      });
      return true;
    }
    if (request.method === "PUT" && operation === "draft") {
      const loop = parseLoop(await readBody(request));
      if (loop.id !== id) throw new ProjectError("Loop path and draft ID differ.", 400);
      json(response, 200, { loop: await saveDraft(projectDirectory, loop) });
      return true;
    }
    if (request.method === "POST" && operation === "publish") {
      const draft = await readDraft(projectDirectory, id);
      if (!draft) throw new ProjectError("Save the draft before publishing.", 404);
      if (!draft.steps.length) throw new ProjectError("Add a step before publishing.", 422);
      const project = await readProjectConfig(projectDirectory);
      const agents = await connections.list();
      for (const step of draft.steps) {
        if (!step.expectedOutputs.length || step.expectedOutputs.some((output) => !output.trim()))
          throw new ProjectError(`${step.name} needs nonempty expected outputs.`, 422);
        const binding = step.binding ?? project?.defaultBinding;
        if (!binding)
          throw new ProjectError(`${step.name} needs a project default or step binding.`, 422);
        const connection = agents.find((agent) => agent.provider === binding.provider);
        if (!connection?.protocol || connection.authentication !== "authenticated")
          throw new ProjectError(`${step.name} needs a verified, authenticated agent.`, 422);
        const problem = catalogProblem(connection, binding);
        if (problem) throw new ProjectError(`${step.name} selects an unavailable ${problem}.`, 422);
      }
      json(response, 200, { loop: await publishDraft(projectDirectory, id) });
      return true;
    }
  }
  return false;
};

/** Published loops for the new-run picker; GET only. */
export const handleLoopReads: RouteHandler = async (ctx) => {
  if (ctx.pathname !== "/api/loops/published") return false;
  json(ctx.response, 200, { loops: await listPublishedLoops(ctx.projectDirectory) });
  return true;
};
