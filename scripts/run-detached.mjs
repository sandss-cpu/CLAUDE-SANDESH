#!/usr/bin/env node
/**
 * Starts a server in its own session, writing its output to a log, and returns at once:
 *
 *   node scripts/run-detached.mjs <log file> <working folder> <command> [arguments…]
 *
 * Used by Start_Bato.command. A server started with plain `&` stays in the process group
 * of whatever started it (a Terminal window, a script, an assistant's shell), and goes
 * down when that group is stopped. In its own session it runs until Stop_Bato.command or
 * a restart of the Mac.
 */
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';

const [log, cwd, command, ...args] = process.argv.slice(2);
if (!log || !cwd || !command) {
  console.error('usage: node scripts/run-detached.mjs <log file> <working folder> <command> [arguments…]');
  process.exit(2);
}
const out = openSync(log, 'w');
const child = spawn(command, args, { cwd, detached: true, stdio: ['ignore', out, out], env: process.env });
child.on('error', (e) => {
  console.error(`could not start ${command}: ${e.message}`);
  process.exit(1);
});
child.on('spawn', () => {
  child.unref();
  process.exit(0);
});
