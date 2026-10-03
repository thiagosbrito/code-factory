import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "symphony-context-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const automation = join(root, "automation");
  const modulePath = new URL("../scripts/symphony/context.mjs", import.meta.url).pathname;
  const identityPath = new URL("../scripts/symphony/workspace-identity.mjs", import.meta.url)
    .pathname;
  const sourcePath = JSON.stringify(modulePath);
  const identitySource = JSON.stringify(identityPath);
  const bootstrap = `
    import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    const root = process.env.SYMPHONY_ROOT;
    const workspace = root + '/workspaces/THI-CONTEXT';
    const bare = root + '/repository.git';
    mkdirSync(root + '/workspaces', {recursive:true});
    mkdirSync(root + '/records', {recursive:true});
    mkdirSync(workspace, {recursive:true});
    const run = (args, cwd) => { const r=spawnSync('git',args,{cwd,encoding:'utf8'}); if(r.status) throw Error(r.stderr); };
    const seed=root+'/seed'; mkdirSync(seed);
    run(['init','-b','main',seed]); run(['config','user.name','Fixture'],seed); run(['config','user.email','fixture@example.test'],seed);
    writeFileSync(seed+'/source.txt','initial'); run(['add','.'],seed); run(['commit','-m','base'],seed);
    run(['clone','--bare',seed,bare]);
    run(['-C',bare,'config','user.name','Fixture']); run(['-C',bare,'config','user.email','fixture@example.test']);
    run(['-C',bare,'worktree','add','-b','symphony/THI-CONTEXT',workspace,'main']);
    const {workspaceIdentity,writeRecord} = await import(${identitySource});
    writeRecord(workspaceIdentity(workspace),'created');
    const {saveCheckpoint,loadCheckpoint,checkpointContext} = await import(${sourcePath});
    const args={phase:'validation',summary:'Implement bounded checkpoint',files:['source.txt'],remaining:['review result'],validationReceipts:[{name:'pnpm test',result:'passed'}]};
    saveCheckpoint(workspace,args);
    const before=loadCheckpoint(workspace);
    writeFileSync(workspace+'/source.txt','changed');
    const after=loadCheckpoint(workspace);
    let secretRejected=false, externalLinkRejected=false, emptyReceiptsRejected=false;
    try { saveCheckpoint(workspace,{...args,files:['.env']}); } catch { secretRejected=true; }
    writeFileSync(root+'/outside-secret','hidden'); symlinkSync(root+'/outside-secret',workspace+'/external-link');
    try { saveCheckpoint(workspace,{...args,files:['external-link']}); } catch { externalLinkRejected=true; }
    try { saveCheckpoint(workspace,{...args,files:[],validationReceipts:[{name:'test',result:'passed'}]}); } catch { emptyReceiptsRejected=true; }
    const context=checkpointContext(workspace);
    writeFileSync(root+'/records/THI-CONTEXT.context.json',JSON.stringify({phase:'unrecognized',summary:{},files:[null],remaining:'bad',validationReceipts:{},updatedAt:1}));
    const corrupt=loadCheckpoint(workspace);
    console.log(JSON.stringify({before,after,context,secretRejected,externalLinkRejected,emptyReceiptsRejected,corrupt}));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", bootstrap], {
    encoding: "utf8",
    env: { ...process.env, SYMPHONY_ROOT: automation },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("checkpoint hashes relevant files and drops receipts after changes", (t) => {
  const { before, after, context } = fixture(t);
  assert.equal(before.phase, "validation");
  assert.equal(before.validationReceipts.length, 1);
  assert.deepEqual(before.changedFiles, []);
  assert.deepEqual(after.changedFiles, ["source.txt"]);
  assert.deepEqual(after.validationReceipts, []);
  assert.match(context, /validation receipts cleared/);
});

test("checkpoint tool schema exposes bounded phases and payloads", async () => {
  const { checkpointTool } = await import("../scripts/symphony/context.mjs");
  assert.equal(checkpointTool.name, "symphony_checkpoint");
  assert.deepEqual(checkpointTool.inputSchema.properties.phase.enum, [
    "discovery",
    "implementation",
    "validation",
    "publication",
  ]);
  assert.equal(checkpointTool.inputSchema.properties.files.maxItems, 40);
});

test("checkpoint rejects secret paths and malformed metadata safely", (t) => {
  const result = fixture(t);
  assert.equal(result.secretRejected, true);
  assert.equal(result.externalLinkRejected, true);
  assert.equal(result.emptyReceiptsRejected, true);
  assert.equal(result.corrupt, null);
});
