const fs = require('node:fs');
const { bgraToPng } = require('./png');

const FRAME_WAIT_MS = 1500;
const FRAME_POLL_MS = 4;
const EXIT_DELAY_MS = 50;
const RO_INIT_MULTITHREADED = 1;
const D3D_DRIVER_TYPE_HARDWARE = 1;
const D3D11_CREATE_DEVICE_BGRA_SUPPORT = 0x20;
const D3D11_SDK_VERSION = 7;
const FORMAT_BGRA8 = 87;
const D3D11_USAGE_STAGING = 3;
const D3D11_CPU_ACCESS_READ = 0x20000;
const D3D11_MAP_READ = 1;

const IID = {
  itemInterop: '3628e81b-3cac-4c60-b7f4-23ce0e0c3356',
  item: '79c3f95b-31f7-4ec2-a464-632ef5d30760',
  poolStatics2: '589b103f-6bbc-5df5-a991-02e28b3b66d5',
  session2: '2c39ae40-7d2e-5044-804e-8b6799d4cf9e',
  session3: 'f2cdd966-22ae-5ea1-9596-3a289344c3be',
  closable: '30d5a829-7fa4-4026-83bb-d75bae4ea99e',
  dxgiAccess: 'a9b3d012-3df2-4ee3-b8d1-8695f457d3c1',
  dxgiDevice: '54ec77fa-1377-44e6-8c32-88fd5f44c84c',
  texture2D: '6f15aaf2-d208-4e89-9ab4-489535d34f9c',
};

// Positions in each interface's vtable.
const SLOT = {
  queryInterface: 0,
  release: 2,
  createForWindow: 3,
  getInterface: 3,
  createTexture2D: 5,
  factory: 6,
  startCapture: 6,
  close: 6,
  getSurface: 6,
  itemSize: 7,
  nextFrame: 7,
  putCursor: 7,
  putBorder: 7,
  contentSize: 8,
  createSession: 10,
  getDesc: 10,
  map: 14,
  unmap: 15,
  copyResource: 47,
};

function guid(text) {
  const out = Buffer.from(text.replace(/-/g, ''), 'hex');
  out.subarray(0, 4).reverse();
  out.subarray(4, 6).reverse();
  out.subarray(6, 8).reverse();
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bind() {
  const koffi = require('koffi');
  const combase = koffi.load('combase.dll');
  const d3d11 = koffi.load('d3d11.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const Ptr = 'void *';
  const outPtr = koffi.out(koffi.pointer(Ptr));
  const Size = koffi.struct({ width: 'int32', height: 'int32' });
  const Mapped = koffi.struct({ data: Ptr, rowPitch: 'uint32', depthPitch: 'uint32' });
  const TextureDesc = koffi.struct({
    width: 'uint32',
    height: 'uint32',
    mipLevels: 'uint32',
    arraySize: 'uint32',
    format: 'uint32',
    sampleCount: 'uint32',
    sampleQuality: 'uint32',
    usage: 'uint32',
    bindFlags: 'uint32',
    cpuAccess: 'uint32',
    misc: 'uint32',
  });
  const method = (args, result = 'int32') => koffi.proto('__stdcall', result, [Ptr, ...args]);

  return {
    vtable: (object, slot) => koffi.decode(koffi.decode(object, Ptr), slot * 8, Ptr),
    call: koffi.call,
    proto: {
      queryInterface: method([Ptr, outPtr]),
      release: method([], 'uint32'),
      createForWindow: method(['intptr', Ptr, outPtr]),
      getSize: method([koffi.out(koffi.pointer(Size))]),
      createPool: method([Ptr, 'int32', 'int32', Size, outPtr]),
      createSession: method([Ptr, outPtr]),
      putBool: method(['uint8']),
      plain: method([]),
      getPtr: method([outPtr]),
      getInterface: method([Ptr, outPtr]),
      getDesc: method([koffi.out(koffi.pointer(TextureDesc))], 'void'),
      createTexture: method([koffi.pointer(TextureDesc), Ptr, outPtr]),
      copy: method([Ptr, Ptr], 'void'),
      map: method([Ptr, 'uint32', 'uint32', 'uint32', koffi.out(koffi.pointer(Mapped))]),
      unmap: method([Ptr, 'uint32'], 'void'),
    },
    initialize: combase.func('__stdcall', 'RoInitialize', 'int32', ['int32']),
    createString: combase.func('__stdcall', 'WindowsCreateString', 'int32', ['str16', 'uint32', outPtr]),
    deleteString: combase.func('__stdcall', 'WindowsDeleteString', 'int32', [Ptr]),
    getFactory: combase.func('__stdcall', 'RoGetActivationFactory', 'int32', [Ptr, Ptr, outPtr]),
    createDevice: d3d11.func('__stdcall', 'D3D11CreateDevice', 'int32',
      [Ptr, 'int32', Ptr, 'uint32', Ptr, 'uint32', 'uint32', outPtr, Ptr, outPtr]),
    wrapDevice: d3d11.func('__stdcall', 'CreateDirect3D11DeviceFromDXGIDevice', 'int32', [Ptr, outPtr]),
    copyMemory: kernel32.func('__stdcall', 'RtlMoveMemory', 'void', [Ptr, Ptr, 'size_t']),
  };
}

function check(what, result) {
  if (result < 0) throw new Error(`${what} failed (0x${(result >>> 0).toString(16)})`);
}

function comScope(api) {
  const held = [];
  const closing = [];
  const call = (object, slot, proto, ...args) => api.call(api.vtable(object, slot), proto, object, ...args);

  function keep(what, result, out) {
    check(what, result);
    if (!out[0]) throw new Error(`${what} gave nothing`);
    held.push(out[0]);
    return out[0];
  }

  function made(what, object, slot, proto, ...args) {
    const out = [null];
    return keep(what, call(object, slot, proto, ...args, out), out);
  }

  const as = (object, iid) => made('QueryInterface', object, SLOT.queryInterface, api.proto.queryInterface, guid(iid));

  // Older Windows lacks the newer interfaces.
  function ifSupported(object, iid, use) {
    try {
      use(as(object, iid));
    } catch {}
  }

  function factory(name, iid) {
    const text = [null];
    check('WindowsCreateString', api.createString(name, name.length, text));
    try {
      const out = [null];
      return keep(name, api.getFactory(text[0], guid(iid), out), out);
    } finally {
      api.deleteString(text[0]);
    }
  }

  function release() {
    for (const object of closing.reverse()) ifSupported(object, IID.closable, (c) => call(c, SLOT.close, api.proto.plain));
    for (const object of held.reverse()) call(object, SLOT.release, api.proto.release);
  }

  return { call, keep, made, as, ifSupported, factory, release, closeLater: (object) => closing.push(object) };
}

async function nextFrame(com, api, pool) {
  const deadline = Date.now() + FRAME_WAIT_MS;
  for (;;) {
    const out = [null];
    check('TryGetNextFrame', com.call(pool, SLOT.nextFrame, api.proto.getPtr, out));
    if (out[0]) return com.keep('TryGetNextFrame', 0, out);
    if (Date.now() > deadline) throw new Error('No frame arrived');
    await sleep(FRAME_POLL_MS);
  }
}

async function grab(hwnd) {
  const api = bind();
  const { proto } = api;
  check('RoInitialize', api.initialize(RO_INIT_MULTITHREADED));
  const com = comScope(api);
  try {
    const deviceOut = [null];
    const contextOut = [null];
    const created = api.createDevice(null, D3D_DRIVER_TYPE_HARDWARE, null, D3D11_CREATE_DEVICE_BGRA_SUPPORT, null, 0, D3D11_SDK_VERSION, deviceOut, null, contextOut);
    const device = com.keep('D3D11CreateDevice', created, deviceOut);
    const context = com.keep('D3D11CreateDevice', created, contextOut);
    const wrapped = [null];
    const winrtDevice = com.keep('CreateDirect3D11DeviceFromDXGIDevice', api.wrapDevice(com.as(device, IID.dxgiDevice), wrapped), wrapped);

    const items = com.factory('Windows.Graphics.Capture.GraphicsCaptureItem', IID.itemInterop);
    const item = com.made('CreateForWindow', items, SLOT.createForWindow, proto.createForWindow, hwnd, guid(IID.item));
    const size = {};
    check('get_Size', com.call(item, SLOT.itemSize, proto.getSize, size));
    if (size.width <= 0 || size.height <= 0) throw new Error('The window has no size');

    const pools = com.factory('Windows.Graphics.Capture.Direct3D11CaptureFramePool', IID.poolStatics2);
    const pool = com.made('CreateFreeThreaded', pools, SLOT.factory, proto.createPool, winrtDevice, FORMAT_BGRA8, 1, size);
    com.closeLater(pool);
    const session = com.made('CreateCaptureSession', pool, SLOT.createSession, proto.createSession, item);
    com.closeLater(session);
    com.ifSupported(session, IID.session2, (s) => com.call(s, SLOT.putCursor, proto.putBool, 0));
    com.ifSupported(session, IID.session3, (s) => com.call(s, SLOT.putBorder, proto.putBool, 0));
    check('StartCapture', com.call(session, SLOT.startCapture, proto.plain));

    const frame = await nextFrame(com, api, pool);
    com.closeLater(frame);
    const content = {};
    check('get_ContentSize', com.call(frame, SLOT.contentSize, proto.getSize, content));
    const surface = com.made('get_Surface', frame, SLOT.getSurface, proto.getPtr);
    const texture = com.made('GetInterface', com.as(surface, IID.dxgiAccess), SLOT.getInterface, proto.getInterface, guid(IID.texture2D));
    const desc = {};
    com.call(texture, SLOT.getDesc, proto.getDesc, desc);
    const staging = com.made('CreateTexture2D', device, SLOT.createTexture2D, proto.createTexture, {
      ...desc, usage: D3D11_USAGE_STAGING, bindFlags: 0, cpuAccess: D3D11_CPU_ACCESS_READ, misc: 0,
    }, null);
    com.call(context, SLOT.copyResource, proto.copy, staging, texture);

    const mapped = {};
    check('Map', com.call(context, SLOT.map, proto.map, staging, 0, D3D11_MAP_READ, 0, mapped));
    try {
      const width = Math.min(desc.width, content.width);
      const height = Math.min(desc.height, content.height);
      const pixels = Buffer.alloc(mapped.rowPitch * height);
      api.copyMemory(pixels, mapped.data, pixels.length);
      return { pixels, width, height, stride: mapped.rowPitch };
    } finally {
      com.call(context, SLOT.unmap, proto.unmap, staging, 0);
    }
  } finally {
    com.release();
  }
}

async function main([hwnd, file]) {
  const png = bgraToPng(await grab(Number(hwnd)));
  fs.writeFileSync(`${file}.tmp`, png);
  fs.renameSync(`${file}.tmp`, file);
}

main(process.argv.slice(2)).then(
  () => process.exit(0),
  (error) => {
    process.parentPort.postMessage(error.message);
    setTimeout(() => process.exit(1), EXIT_DELAY_MS);
  },
);
