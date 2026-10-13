import { writeNodeExecutable } from "../../support/node-executable.js";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A stand-in `claude` executable for browser journeys, so the real Claude Code adapter runs end to
 * end. It answers `--version`, `auth status --json` and the model-list request, and runs a step
 * from stream-json messages on stdin like the real CLI. While a `hold` file exists next to it, the
 * next step it runs stays open until it receives a second message (guidance), echoes it back and
 * finishes; the `hold` file is consumed by that step, so later steps finish at once.
 */
const script = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const hold = path.join(__dirname, 'hold');
const say = (event) => console.log(JSON.stringify(event));
if (args[0] === '--version') { console.log('2.1.295 (Claude Code)'); process.exit(0); }
if (args.join(' ') === 'auth status --json') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
if (args[0] !== '-p') process.exit(3);
const lines = require('readline').createInterface({ input: process.stdin });
if (!args.includes('--permission-mode')) {
  lines.on('line', (line) => {
    const request = JSON.parse(line);
    say({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: {
      models: [
        { value: 'sonnet', displayName: 'Sonnet 5.5', description: 'Most efficient for simpler tasks', supportedEffortLevels: ['low', 'medium', 'high'] },
        { value: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest for quick answers' },
      ] } } });
  });
} else {
  const messages = [];
  let holding = false;
  const finish = (text) => {
    say({ type: 'assistant', session_id: 'fake-session', message: { content: [{ type: 'text', text }] } });
    say({ type: 'result', subtype: 'success', is_error: false, session_id: 'fake-session', result: 'pass\\n' + text });
    process.exit(0);
  };
  lines.on('line', (line) => {
    messages.push(JSON.parse(line).message.content);
    if (messages.length === 1) {
      say({ type: 'system', subtype: 'init', session_id: 'fake-session' });
      say({ type: 'assistant', session_id: 'fake-session', message: { content: [{ type: 'text', text: 'Fake Claude is working.' }] } });
      if (fs.existsSync(hold)) { holding = true; fs.rmSync(hold); } else finish('Fake Claude finished.');
    } else if (holding) {
      finish('Guidance received: ' + messages[1]);
    }
  });
}
`;

export const writeFakeClaude = async (directory: string) => {
  const executable = join(directory, "claude");
  await writeNodeExecutable(executable, script);
  const hold = join(directory, "hold");
  return {
    executable,
    /** Make the next step wait for guidance. */
    holdNextStep: () => writeFile(hold, ""),
    release: () => rm(hold, { force: true }),
  };
};
