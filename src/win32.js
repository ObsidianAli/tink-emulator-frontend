const MIN_SIDE = 200;
const WS_EX_TOOLWINDOW = 0x80;
const GW_OWNER = 4;
const GWL_EXSTYLE = -20;
const SW_RESTORE = 9;
const VK_MENU = 0x12;
const KEYEVENTF_KEYUP = 0x2;
const ASFW_ANY = 0xffffffff;
const TH32CS_SNAPPROCESS = 0x2;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SYNCHRONIZE = 0x00100000;
const WAIT_TIMEOUT = 0x102;
const RRF_RT_REG_DWORD = 0x10;
// HKEY_CURRENT_USER is (HKEY)(LONG)0x80000001, so it is sign-extended on 64-bit.
const HKEY_CURRENT_USER = -0x7fffffff;
const INVALID_HANDLE = -1;

function isGameWindow({ visible, owner, exStyle, width, height }) {
  return visible && !owner && (exStyle & WS_EX_TOOLWINDOW) === 0 && width >= MIN_SIDE && height >= MIN_SIDE;
}

function pickGameWindow(windows, pids) {
  const hit = (windows || []).find((w) => pids.has(w.pid));
  return hit ? hit.hwnd : null;
}

function descendants(processes, rootPid) {
  const children = new Map();
  for (const { pid, ppid } of processes) {
    if (pid === ppid) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const found = new Set();
  const queue = [rootPid];
  while (queue.length) {
    for (const pid of children.get(queue.shift()) || []) {
      if (pid === rootPid || found.has(pid)) continue;
      found.add(pid);
      queue.push(pid);
    }
  }
  return [...found];
}

function bind() {
  const koffi = require('koffi');
  const kernel32 = koffi.load('kernel32.dll');
  const user32 = koffi.load('user32.dll');
  const advapi32 = koffi.load('advapi32.dll');

  const ProcessEntry = koffi.struct({
    dwSize: 'uint32',
    cntUsage: 'uint32',
    th32ProcessID: 'uint32',
    th32DefaultHeapID: 'uintptr',
    th32ModuleID: 'uint32',
    cntThreads: 'uint32',
    th32ParentProcessID: 'uint32',
    pcPriClassBase: 'int32',
    dwFlags: 'uint32',
    szExeFile: koffi.array('char16', 260, 'String'),
  });
  const Rect = koffi.struct({ left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  const EnumProc = koffi.proto('__stdcall', 'EnumWindowsProc', 'bool', ['intptr', 'intptr']);

  const k = {
    snapshot: kernel32.func('__stdcall', 'CreateToolhelp32Snapshot', 'intptr', ['uint32', 'uint32']),
    first: kernel32.func('__stdcall', 'Process32FirstW', 'bool', ['intptr', koffi.inout(koffi.pointer(ProcessEntry))]),
    next: kernel32.func('__stdcall', 'Process32NextW', 'bool', ['intptr', koffi.inout(koffi.pointer(ProcessEntry))]),
    open: kernel32.func('__stdcall', 'OpenProcess', 'intptr', ['uint32', 'bool', 'uint32']),
    imageName: kernel32.func('__stdcall', 'QueryFullProcessImageNameW', 'bool', ['intptr', 'uint32', 'void *', koffi.inout(koffi.pointer('uint32'))]),
    wait: kernel32.func('__stdcall', 'WaitForSingleObject', 'uint32', ['intptr', 'uint32']),
    close: kernel32.func('__stdcall', 'CloseHandle', 'bool', ['intptr']),
  };
  const u = {
    enumWindows: user32.func('__stdcall', 'EnumWindows', 'bool', [koffi.pointer(EnumProc), 'intptr']),
    visible: user32.func('__stdcall', 'IsWindowVisible', 'bool', ['intptr']),
    getWindow: user32.func('__stdcall', 'GetWindow', 'intptr', ['intptr', 'uint32']),
    exStyle: user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr', ['intptr', 'int32']),
    rect: user32.func('__stdcall', 'GetWindowRect', 'bool', ['intptr', koffi.out(koffi.pointer(Rect))]),
    threadProcess: user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['intptr', koffi.out(koffi.pointer('uint32'))]),
    iconic: user32.func('__stdcall', 'IsIconic', 'bool', ['intptr']),
    show: user32.func('__stdcall', 'ShowWindow', 'bool', ['intptr', 'int32']),
    setForeground: user32.func('__stdcall', 'SetForegroundWindow', 'bool', ['intptr']),
    foreground: user32.func('__stdcall', 'GetForegroundWindow', 'intptr', []),
    key: user32.func('__stdcall', 'keybd_event', 'void', ['uint8', 'uint8', 'uint32', 'uintptr']),
    allowForeground: user32.func('__stdcall', 'AllowSetForegroundWindow', 'bool', ['uint32']),
  };
  const regGetValue = advapi32.func('__stdcall', 'RegGetValueW', 'int32',
    ['intptr', 'str16', 'str16', 'uint32', 'void *', koffi.out(koffi.pointer('uint32')), koffi.inout(koffi.pointer('uint32'))]);

  const exeCache = new Map();

  function imagePath(pid) {
    const handle = k.open(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!handle) return null;
    try {
      const buffer = Buffer.alloc(2 * 1024);
      const size = [1024];
      return k.imageName(handle, 0, buffer, size) ? buffer.toString('utf16le', 0, size[0] * 2) : null;
    } finally {
      k.close(handle);
    }
  }

  function listProcesses() {
    const snap = k.snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap === INVALID_HANDLE || !snap) return null;
    const rows = [];
    try {
      const entry = { dwSize: koffi.sizeof(ProcessEntry) };
      for (let ok = k.first(snap, entry); ok; ok = k.next(snap, entry)) {
        rows.push({ pid: entry.th32ProcessID, ppid: entry.th32ParentProcessID });
      }
    } finally {
      k.close(snap);
    }
    const live = new Set(rows.map((row) => row.pid));
    for (const pid of exeCache.keys()) if (!live.has(pid)) exeCache.delete(pid);
    for (const row of rows) {
      if (!exeCache.has(row.pid)) {
        const exe = imagePath(row.pid);
        // Not cached when unreadable: a process can refuse while it is still starting.
        if (exe) exeCache.set(row.pid, exe);
      }
      row.exe = exeCache.get(row.pid) || null;
    }
    return rows;
  }

  function topWindows() {
    const found = [];
    u.enumWindows((hwnd) => {
      const rect = {};
      const pid = [0];
      if (!u.rect(hwnd, rect)) return true;
      u.threadProcess(hwnd, pid);
      const info = {
        hwnd,
        pid: pid[0],
        visible: u.visible(hwnd),
        owner: u.getWindow(hwnd, GW_OWNER),
        exStyle: Number(u.exStyle(hwnd, GWL_EXSTYLE)),
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
      };
      if (isGameWindow(info)) found.push({ hwnd, pid: info.pid });
      return true;
    }, 0);
    return found;
  }

  function bringToFront(hwnd) {
    if (!hwnd) return false;
    if (u.iconic(hwnd)) u.show(hwnd, SW_RESTORE);
    if (u.setForeground(hwnd) && u.foreground() === hwnd) return true;
    // Windows only lets the process that last had input take the foreground; a synthetic Alt press counts as input.
    u.key(VK_MENU, 0, 0, 0);
    u.key(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
    u.setForeground(hwnd);
    return u.foreground() === hwnd;
  }

  function isAlive(pid) {
    const handle = k.open(SYNCHRONIZE, false, pid);
    if (!handle) {
      const rows = listProcesses();
      return rows ? rows.some((row) => row.pid === pid) : false;
    }
    try {
      return k.wait(handle, 0) === WAIT_TIMEOUT;
    } finally {
      k.close(handle);
    }
  }

  function runningAppId() {
    const value = [0];
    const size = [4];
    return regGetValue(HKEY_CURRENT_USER, 'Software\\Valve\\Steam', 'RunningAppID', RRF_RT_REG_DWORD, null, value, size) === 0 ? value[0] : null;
  }

  return {
    listProcesses,
    topWindows,
    bringToFront,
    foreground: u.foreground,
    allowAnyForeground: () => u.allowForeground(ASFW_ANY),
    runningAppId,
    isAlive,
  };
}

let api;
function native() {
  if (api === undefined) {
    try {
      api = process.platform === 'win32' ? bind() : null;
    } catch {
      api = null;
    }
  }
  return api;
}

module.exports = { native, isGameWindow, pickGameWindow, descendants };
