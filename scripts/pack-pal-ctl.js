#!/usr/bin/env node
// Starts Pack Pal in the background, or stops it. Used by start.bat and stop.bat.
//
//   node scripts/pack-pal-ctl.js start    start in the background (no window)
//   node scripts/pack-pal-ctl.js stop     stop it, saving everything first
//   node scripts/pack-pal-ctl.js status   say whether it is running
//
// While running, the server keeps its process id in run/pack-pal.pid and writes
// its output to run/pack-pal.log. To stop, this script drops a run/stop file;
// the server notices within a second, saves the data file and exits. If it
// hasn't exited after 10 seconds, the process is ended by force.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUN_DIR = path.join(ROOT, 'run');
const PID_FILE = path.join(RUN_DIR, 'pack-pal.pid');
const STOP_FILE = path.join(RUN_DIR, 'stop');
const LOG_FILE = path.join(RUN_DIR, 'pack-pal.log');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

function rm(file) { try { fs.unlinkSync(file); } catch {} }

function runningPid() {
  const pid = readPid();
  if (pid && isAlive(pid)) return pid;
  if (pid) rm(PID_FILE); // left over from a crash or a restart of the computer
  return null;
}

function readLog() {
  try { return fs.readFileSync(LOG_FILE, 'utf8'); } catch { return ''; }
}

function openBrowser() {
  const url = `http://localhost:${Number(process.env.PORT) || 3000}`;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref(); } catch {}
}

async function start() {
  const existing = runningPid();
  if (existing) {
    console.log(`\n  Pack Pal is already running (process ${existing}).`);
    if (process.env.PACK_OPEN_BROWSER) openBrowser();
    return 0;
  }
  fs.mkdirSync(RUN_DIR, { recursive: true });
  rm(STOP_FILE);
  const log = fs.openSync(LOG_FILE, 'w');
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PACK_BACKGROUND: '1' },
    stdio: ['ignore', log, log],
    detached: true,
    windowsHide: true,
  });
  let exited = null;
  child.on('exit', (code) => { exited = code; });
  child.unref();
  fs.closeSync(log);

  // The server writes its pid file once it is listening.
  for (let i = 0; i < 100; i++) {
    if (exited !== null) break;
    if (readPid() === child.pid) {
      console.log(readLog().trimEnd());
      return 0;
    }
    await sleep(100);
  }
  console.log('\n  Pack Pal did not start. Here is what it said:\n');
  console.log(readLog().trimEnd() || '  (nothing)');
  if (exited === null) { try { process.kill(child.pid); } catch {} }
  return 1;
}

async function stop() {
  const pid = runningPid();
  if (!pid) {
    console.log('\n  Pack Pal is not running.');
    return 0;
  }
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(STOP_FILE, String(Date.now()));
  for (let i = 0; i < 100 && isAlive(pid); i++) await sleep(100);
  if (isAlive(pid)) {
    console.log('  Pack Pal did not stop by itself, so it is being ended by force.');
    try { process.kill(pid, 'SIGKILL'); } catch {}
    for (let i = 0; i < 30 && isAlive(pid); i++) await sleep(100);
  }
  rm(STOP_FILE);
  if (isAlive(pid)) {
    console.log(`\n  Could not stop Pack Pal (process ${pid}). Try restarting the computer.`);
    return 1;
  }
  rm(PID_FILE);
  console.log('\n  Pack Pal has stopped.');
  return 0;
}

function status() {
  const pid = runningPid();
  console.log(pid ? `\n  Pack Pal is running (process ${pid}).` : '\n  Pack Pal is not running.');
  return 0;
}

const commands = { start, stop, status };
const cmd = commands[process.argv[2]];
if (!cmd) {
  console.log('Usage: node scripts/pack-pal-ctl.js start|stop|status');
  process.exit(2);
}
Promise.resolve(cmd()).then((code) => process.exit(code));
