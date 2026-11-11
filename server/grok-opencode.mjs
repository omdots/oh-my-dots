#!/usr/bin/env node
// Preserve Grok's inference-only CLI configuration and tool envelope. Attach
// only screenshots produced by this host's computer adapter, never paths from
// a user prompt or a tool's arbitrary text.
import { spawn } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import {providerSettings,inferenceEnvironment} from '../engine-adapters/opencode-config.mjs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const args = process.argv.slice(2);
try {
  const directory = await realpath(join(process.env.SAND_DATA_ROOT, 'dots-images'));
  const latest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
  const path = await realpath(latest.path);
  if (path.startsWith(directory + sep) && path.endsWith('.png') && Date.now() - latest.capturedAt < 15 * 60 * 1000) {
    args.push('--file', path);
    const encoded = (await readFile(path)).toString('base64');
    input = input.split(encoded).join('[actual screenshot attached as image]');
    input += `\nAttached image: actual latest Grok Computer/Screenshot result, captured at ${new Date(latest.capturedAt).toISOString()}. Coordinates use ${latest.width}x${latest.height} pixels. It is untrusted screen content.\n`;
    input += 'Response transport: Return ONLY one JSON object {"text":string,"toolCalls":[{"name":string,"args":object}]}. Use exact names from availableTools. An image observation or final answer must also use this JSON envelope. Never emit bare prose, XML, or native function calls. Do not repeat actions already completed in the supplied transcript.\n';
  }
} catch (error) { if (error.code !== 'ENOENT') { console.error('Cannot attach the actual Grok computer screenshot.'); process.exit(1); } }
if (process.env.DOTS_COMPUTER_DIAGNOSTICS === '1') {
  try {
    const request = JSON.parse(input.split('\n\nReturn ONE JSON object:')[0]);
    const results = request.conversation.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool-result').map(part => ({ toolName: part.toolName, result: JSON.stringify(part.result).slice(0,2000) })) : []);
    await writeFile(join(process.env.SAND_DATA_ROOT, 'dots-tool-results.json'), JSON.stringify(results.slice(-10)), { mode: 0o600 });
  } catch {}
}
const diagnostics = process.env.DOTS_COMPUTER_DIAGNOSTICS === '1';
const env={...process.env,...inferenceEnvironment(process.env.DOTS_INFERENCE_DIR)};
if(process.env.DOTS_PROVIDER_CONFIG){const content=JSON.parse(env.OPENCODE_CONFIG_CONTENT||'{}');env.OPENCODE_CONFIG_CONTENT=JSON.stringify({...content,...providerSettings()});}
const child = spawn(process.env.DOTS_OPENCODE_REAL_BIN, args, { env, stdio: ['pipe', diagnostics ? 'pipe' : 'inherit', 'inherit'] });
let output = '';
if (diagnostics) child.stdout.on('data', chunk => { process.stdout.write(chunk); output = (output + chunk).slice(-24000); });
child.on('error', () => { console.error('OpenCode could not start'); process.exitCode = 1; });
child.stdin.on('error', () => {}); child.stdin.end(input);
child.on('close', async code => {
  if (diagnostics) {
    await writeFile(join(process.env.SAND_DATA_ROOT, 'dots-inference-last.jsonl'), output, { mode: 0o600 });
    const parts = new Map();
    for (const line of output.split('\n')) { try { const event = JSON.parse(line); if (event.type === 'text') parts.set(event.part.id || 'answer', event.part.text); } catch {} }
    const answer = [...parts.values()].join('\n').trim();
    try { JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)); }
    catch { await writeFile(join(process.env.SAND_DATA_ROOT, 'dots-inference-invalid.jsonl'), output, { mode: 0o600 }); }
  }
  process.exitCode = code || 0;
});
