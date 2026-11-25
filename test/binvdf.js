function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function body(object, strings) {
  const parts = [];
  const key = (name) => {
    if (!strings) return Buffer.from(`${name}\0`);
    if (!strings.includes(name)) strings.push(name);
    return u32(strings.indexOf(name));
  };
  for (const [name, value] of Object.entries(object)) {
    if (value && typeof value === 'object') parts.push(Buffer.from([0]), key(name), body(value, strings));
    else if (typeof value === 'number') parts.push(Buffer.from([2]), key(name), u32(value));
    else parts.push(Buffer.from([1]), key(name), Buffer.from(`${value}\0`));
  }
  parts.push(Buffer.from([8]));
  return Buffer.concat(parts);
}

// A v41 appinfo.vdf: key names live in a table after the entries.
function appInfo(apps) {
  const strings = [];
  const parts = [u32(0x07564429), u32(1), Buffer.alloc(8)];
  for (const [id, app] of Object.entries(apps)) {
    const data = Buffer.concat([Buffer.from([0]), u32(strings.push('appinfo') - 1), body(app, strings), Buffer.from([8])]);
    parts.push(u32(Number(id)), u32(60 + data.length), Buffer.alloc(60), data);
  }
  parts.push(u32(0));
  const head = Buffer.concat(parts);
  const table = Buffer.concat([u32(strings.length), ...strings.map((text) => Buffer.from(`${text}\0`))]);
  head.writeBigInt64LE(BigInt(head.length), 8);
  return Buffer.concat([head, table]);
}

// A v40 packageinfo.vdf: keys are written inline.
function packageInfo(packages) {
  const parts = [u32(0x06565528), u32(1)];
  for (const [id, info] of Object.entries(packages)) {
    parts.push(u32(Number(id)), Buffer.alloc(32), Buffer.from([0]), Buffer.from(`${id}\0`), body({ packageid: Number(id), billingtype: 1, licensetype: 1, status: 0, ...info }), Buffer.from([8]));
  }
  parts.push(u32(0xffffffff));
  return Buffer.concat(parts);
}

module.exports = { appInfo, packageInfo };
