// Watches for Select + Start held on an Xbox-style pad while a game runs.
// The window can't read the pad once an emulator has focus, so a small PowerShell helper calls XInput
// directly and prints 1 when both buttons are down on any pad and 0 when they're not.
const { spawn } = require('node:child_process');

const HOLD_MS = 2000;

// BACK 0x0020 + START 0x0010. Exits by itself if Tink goes away without stopping it.
const POLLER_SCRIPT = (parentPid) => `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class TinkPad {
  [StructLayout(LayoutKind.Sequential)]
  public struct State { public uint Packet; public ushort Buttons; public byte LT; public byte RT;
    public short LX; public short LY; public short RX; public short RY; }
  [DllImport("xinput1_4.dll")] static extern int XInputGetState(int index, out State state);
  public static bool ComboDown() {
    for (int i = 0; i < 4; i++) {
      State s;
      if (XInputGetState(i, out s) == 0 && (s.Buttons & 0x30) == 0x30) return true;
    }
    return false;
  }
}
'@
$last = -1
$tick = 0
while ($true) {
  $down = [int][TinkPad]::ComboDown()
  if ($down -ne $last) { [Console]::Out.WriteLine($down); [Console]::Out.Flush(); $last = $down }
  $tick++
  if ($tick % 20 -eq 0 -and -not (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue)) { exit }
  Start-Sleep -Milliseconds 50
}
`;

function defaultPoller() {
  const encoded = Buffer.from(POLLER_SCRIPT(process.pid), 'utf16le').toString('base64');
  return { exe: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded] };
}

// Calls onHold once both buttons have stayed down for holdMs. Releasing early starts the count again.
function holdTimer(holdMs, onHold) {
  let timer = null;
  return (down) => {
    if (down && !timer) {
      timer = setTimeout(onHold, holdMs);
    } else if (!down && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

// Starts polling the pad. Returns a function that stops it. onFail(code) hears if the helper dies on its own.
function watchCombo(onHold, { holdMs = HOLD_MS, poller = defaultPoller(), onFail = () => {} } = {}) {
  let stopped = false;
  const update = holdTimer(holdMs, () => {
    if (!stopped) onHold();
  });
  const child = spawn(poller.exe, poller.args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  child.on('error', () => {});
  child.on('close', (code) => {
    if (!stopped) onFail(code);
  });
  let buffered = '';
  child.stdout.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop();
    for (const line of lines) {
      if (line.trim() === '1') update(true);
      else if (line.trim() === '0') update(false);
    }
  });
  return () => {
    stopped = true;
    update(false);
    child.kill();
  };
}

module.exports = { watchCombo, holdTimer };
