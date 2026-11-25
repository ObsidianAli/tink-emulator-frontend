const REFRESH_MS = 3000;
const MAX_REPORTS = 64;
const INVALID_HANDLE = -1;
const GENERIC_READ = 0x80000000;
const SHARE_READ_WRITE = 3;
const OPEN_EXISTING = 3;
const FILE_FLAG_OVERLAPPED = 0x40000000;
const STATUS_PENDING = 0x103;
const HIDP_INPUT = 0;
const HIDP_SUCCESS = 0x110000;
const PAGE_DESKTOP = 1;
const PAGE_BUTTON = 9;
const PAD_USAGES = new Set([4, 5]);
const HID_INTERFACE = Buffer.from('b2551e4d6ff1cf1188cb001111000030', 'hex');
const PAD_PATH = /^\\\\\?\\hid#/i;
// XInput already reads these, and their HID side hides buttons.
const XINPUT_PATH = /[&#_]ig_/i;

const SONY = 0x054c;
const NINTENDO = 0x057e;
const DUALSHOCK_BLUETOOTH = 0x11;
const DUALSENSE_BLUETOOTH = 0x31;
const SWITCH_REPORTS = new Set([0x21, 0x30, 0x31]);

const SONY_LABELS = [, 'Square', 'Cross', 'Circle', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'Create', 'Options', 'L3', 'R3', 'PS', 'Touchpad', 'Mic'];
const SWITCH_LABELS = [, 'B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', 'Minus', 'Plus', 'Left stick', 'Right stick', 'Home', 'Capture'];
const SHARE_PADS = new Set([0x05c4, 0x09cc, 0x0ba0]);
// Where each Switch Pro button sits in its full report: [byte, bit], in SWITCH_LABELS order.
const SWITCH_BITS = [[3, 2], [3, 3], [3, 0], [3, 1], [5, 6], [3, 6], [5, 7], [3, 7], [4, 0], [4, 1], [4, 3], [4, 2], [4, 4], [4, 5]];

function sonyButtons(report, at, last) {
  const bits = (report[at] >> 4) | (report[at + 1] << 4) | (report[at + 2] << 12);
  const pressed = [];
  for (let n = 1; n <= last; n++) if (bits & (1 << (n - 1))) pressed.push(n);
  return pressed;
}

// Over Bluetooth these pads switch to reports Windows can't describe; null means Windows can read it.
function knownButtons(vid, report) {
  if (vid === SONY && report[0] === DUALSENSE_BLUETOOTH && report.length >= 12) return sonyButtons(report, 9, 15);
  if (vid === SONY && report[0] === DUALSHOCK_BLUETOOTH && report.length >= 10) return sonyButtons(report, 7, 14);
  if (vid === NINTENDO && SWITCH_REPORTS.has(report[0]) && report.length >= 6) {
    return SWITCH_BITS.flatMap(([byte, bit], i) => (report[byte] & (1 << bit) ? [i + 1] : []));
  }
  return null;
}

const hex = (number) => number.toString(16).padStart(4, '0');
const buttonId = (vid, pid, button) => `hid:${hex(vid)}:${hex(pid)}:${button}`;
const HID_ID = /^hid:([0-9a-f]{4}):([0-9a-f]{4}):([1-9]\d{0,2})$/;

function hidLabel(id) {
  const match = HID_ID.exec(id);
  if (!match) return null;
  const vid = parseInt(match[1], 16);
  const pid = parseInt(match[2], 16);
  const button = Number(match[3]);
  const names = vid === SONY ? SONY_LABELS : vid === NINTENDO ? SWITCH_LABELS : [];
  if (vid === SONY && button === 9 && SHARE_PADS.has(pid)) return 'Share';
  return names[button] || `Button ${button}`;
}

function openWindowsHid() {
  const koffi = require('koffi');
  const hid = koffi.load('hid.dll');
  const cfgmgr = koffi.load('cfgmgr32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const Attributes = koffi.struct({ size: 'uint32', vid: 'uint16', pid: 'uint16', version: 'uint16' });
  const Caps = koffi.struct({ usage: 'uint16', usagePage: 'uint16', inputLength: 'uint16', rest: koffi.array('uint16', 29) });
  const outU32 = koffi.out(koffi.pointer('uint32'));
  const listSize = cfgmgr.func('__stdcall', 'CM_Get_Device_Interface_List_SizeW', 'uint32', [outU32, 'void *', 'void *', 'uint32']);
  const list = cfgmgr.func('__stdcall', 'CM_Get_Device_Interface_ListW', 'uint32', ['void *', 'void *', 'void *', 'uint32', 'uint32']);
  const createFile = kernel32.func('__stdcall', 'CreateFileW', 'intptr', ['str16', 'uint32', 'uint32', 'void *', 'uint32', 'uint32', 'intptr']);
  const closeHandle = kernel32.func('__stdcall', 'CloseHandle', 'bool', ['intptr']);
  const readFile = kernel32.func('__stdcall', 'ReadFile', 'bool', ['intptr', 'void *', 'uint32', 'void *', 'void *']);
  const getResult = kernel32.func('__stdcall', 'GetOverlappedResult', 'bool', ['intptr', 'void *', outU32, 'bool']);
  const cancelIo = kernel32.func('__stdcall', 'CancelIoEx', 'bool', ['intptr', 'void *']);
  const getAttributes = hid.func('__stdcall', 'HidD_GetAttributes', 'bool', ['intptr', koffi.out(koffi.pointer(Attributes))]);
  const getPreparsed = hid.func('__stdcall', 'HidD_GetPreparsedData', 'bool', ['intptr', koffi.out(koffi.pointer('void *'))]);
  const freePreparsed = hid.func('__stdcall', 'HidD_FreePreparsedData', 'bool', ['void *']);
  const getCaps = hid.func('__stdcall', 'HidP_GetCaps', 'int32', ['void *', koffi.out(koffi.pointer(Caps))]);
  const maxUsages = hid.func('__stdcall', 'HidP_MaxUsageListLength', 'uint32', ['int32', 'uint16', 'void *']);
  const getUsages = hid.func('__stdcall', 'HidP_GetUsages', 'int32',
    ['int32', 'uint16', 'uint16', 'void *', koffi.inout(koffi.pointer('uint32')), 'void *', 'void *', 'uint32']);

  function paths() {
    const size = [0];
    if (listSize(size, HID_INTERFACE, null, 0) !== 0 || size[0] <= 1) return [];
    const buffer = Buffer.alloc(size[0] * 2);
    if (list(HID_INTERFACE, null, buffer, size[0], 0) !== 0) return [];
    return buffer.toString('utf16le').split('\0').filter(Boolean);
  }

  function describe(file) {
    const handle = createFile(file, 0, SHARE_READ_WRITE, null, OPEN_EXISTING, 0, 0);
    if (handle === INVALID_HANDLE) return null;
    const preparsed = [null];
    try {
      const attributes = {};
      const caps = {};
      if (!getAttributes(handle, attributes) || !getPreparsed(handle, preparsed)) return null;
      if (getCaps(preparsed[0], caps) !== HIDP_SUCCESS) return null;
      return caps.usagePage === PAGE_DESKTOP && PAD_USAGES.has(caps.usage) && caps.inputLength > 0
        ? { vid: attributes.vid, pid: attributes.pid, length: caps.inputLength }
        : null;
    } finally {
      if (preparsed[0]) freePreparsed(preparsed[0]);
      closeHandle(handle);
    }
  }

  function open(file) {
    const info = describe(file);
    if (!info) return null;
    const handle = createFile(file, GENERIC_READ, SHARE_READ_WRITE, null, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, 0);
    if (handle === INVALID_HANDLE) return null;
    const preparsedOut = [null];
    if (!getPreparsed(handle, preparsedOut)) {
      closeHandle(handle);
      return null;
    }
    const preparsed = preparsedOut[0];
    // Windows writes into these while a read is pending, so they can't be JS memory.
    const buffer = koffi.alloc('uint8', info.length);
    const overlapped = koffi.alloc('uint64', 4);
    const usageBytes = koffi.array('uint8', info.length, 'Typed');
    const usages = new Uint16Array(Math.max(1, maxUsages(HIDP_INPUT, PAGE_BUTTON, preparsed)));
    const status = () => Number(koffi.decode(overlapped, 'uint64'));
    let reading = false;

    function windowsButtons(report) {
      const count = [usages.length];
      const result = getUsages(HIDP_INPUT, PAGE_BUTTON, 0, usages, count, preparsed, report, report.length);
      return result === HIDP_SUCCESS ? [...usages.subarray(0, count[0])] : null;
    }

    return {
      vid: info.vid,
      pid: info.pid,
      // Returns one queued report's buttons, or null when nothing new arrived.
      next() {
        for (;;) {
          if (!reading) {
            koffi.encode(overlapped, koffi.array('uint64', 4), [0, 0, 0, 0]);
            readFile(handle, buffer, info.length, null, overlapped);
            reading = true;
          }
          const bytes = [0];
          if (!getResult(handle, overlapped, bytes, false)) {
            if (status() !== STATUS_PENDING) reading = false;
            return null;
          }
          reading = false;
          const report = koffi.decode(buffer, usageBytes).slice(0, bytes[0]);
          const buttons = knownButtons(info.vid, report) || windowsButtons(report);
          if (buttons) return buttons;
        }
      },
      close() {
        cancelIo(handle, overlapped);
        const done = !reading || getResult(handle, overlapped, [0], false) || status() !== STATUS_PENDING;
        closeHandle(handle);
        freePreparsed(preparsed);
        // Freeing memory Windows may still write to would crash Tink, so a stuck read keeps its few bytes.
        if (done) {
          koffi.free(buffer);
          koffi.free(overlapped);
        }
      },
    };
  }

  return { paths, open };
}

function openHidPads({ system = openWindowsHid, now = Date.now } = {}) {
  let windows;
  try {
    windows = system();
  } catch {
    return null;
  }
  const pads = new Map();
  let refreshAt = 0;

  function drop(file) {
    const pad = pads.get(file);
    pads.delete(file);
    if (pad) pad.device.close();
  }

  function refresh() {
    if (now() < refreshAt) return;
    refreshAt = now() + REFRESH_MS;
    const present = new Set(windows.paths().filter((file) => PAD_PATH.test(file) && !XINPUT_PATH.test(file)));
    for (const file of pads.keys()) if (!present.has(file)) drop(file);
    for (const file of present) {
      if (pads.has(file)) continue;
      const device = windows.open(file);
      pads.set(file, device && { device, held: [] });
    }
  }

  return {
    pressed() {
      refresh();
      const ids = new Set();
      for (const pad of pads.values()) {
        if (!pad) continue;
        const seen = new Set();
        let fresh = false;
        for (let i = 0; i < MAX_REPORTS; i++) {
          const buttons = pad.device.next();
          if (!buttons) break;
          fresh = true;
          pad.held = buttons;
          for (const button of buttons) seen.add(button);
        }
        for (const button of fresh ? seen : pad.held) ids.add(buttonId(pad.device.vid, pad.device.pid, button));
      }
      return ids;
    },
    close() {
      for (const file of [...pads.keys()]) drop(file);
    },
  };
}

module.exports = { openHidPads, knownButtons, hidLabel };
