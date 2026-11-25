const TYPE_END = 8;

class Reader {
  constructor(buffer, offset = 0, strings = null) {
    this.buffer = buffer;
    this.pos = offset;
    this.strings = strings;
  }

  need(count) {
    if (this.pos + count > this.buffer.length) throw new RangeError('Unexpected end of data');
  }

  u8() {
    this.need(1);
    return this.buffer[this.pos++];
  }

  i32() {
    this.need(4);
    const value = this.buffer.readInt32LE(this.pos);
    this.pos += 4;
    return value;
  }

  cString() {
    const end = this.buffer.indexOf(0, this.pos);
    if (end < 0) throw new RangeError('Unterminated string');
    const text = this.buffer.toString('utf8', this.pos, end);
    this.pos = end + 1;
    return text;
  }

  key() {
    if (!this.strings) return this.cString();
    const index = this.i32();
    if (index < 0 || index >= this.strings.length) throw new RangeError('Bad string index');
    return this.strings[index];
  }

  object() {
    const result = {};
    for (;;) {
      const type = this.u8();
      if (type === TYPE_END) return result;
      const key = this.key();
      switch (type) {
        case 0: result[key] = this.object(); break;
        case 1: result[key] = this.cString(); break;
        case 2: case 4: case 6: result[key] = this.i32(); break;
        case 3: this.need(4); result[key] = this.buffer.readFloatLE(this.pos); this.pos += 4; break;
        case 5: {
          let end = this.pos;
          while (end + 1 < this.buffer.length && (this.buffer[end] || this.buffer[end + 1])) end += 2;
          result[key] = this.buffer.toString('utf16le', this.pos, end);
          this.pos = end + 2;
          break;
        }
        case 7: this.need(8); result[key] = this.buffer.readBigUInt64LE(this.pos); this.pos += 8; break;
        case 10: this.need(8); result[key] = this.buffer.readBigInt64LE(this.pos); this.pos += 8; break;
        default: throw new RangeError('Unknown value type');
      }
    }
  }
}

// appinfo.vdf from Steam's own cache: v41 keeps key names in a table at the end; v40 and older write them inline.
function parseAppInfo(buffer, wanted = () => true) {
  const apps = new Map();
  if (buffer.length < 16) return apps;
  const magic = buffer.readUInt32LE(0);
  const version = magic & 0xff;
  if ((magic >>> 8) !== 0x075644 || version < 39 || version > 41) return apps;
  let strings = null;
  let end = buffer.length;
  if (version >= 41) {
    const tableAt = Number(buffer.readBigInt64LE(8));
    if (tableAt <= 16 || tableAt + 4 > buffer.length) return apps;
    const count = buffer.readUInt32LE(tableAt);
    strings = [];
    let pos = tableAt + 4;
    for (let i = 0; i < count && pos < buffer.length; i++) {
      const stop = buffer.indexOf(0, pos);
      if (stop < 0) return apps;
      strings.push(buffer.toString('utf8', pos, stop));
      pos = stop + 1;
    }
    end = tableAt;
  }
  let pos = 16 - (version >= 41 ? 0 : 8);
  const header = version >= 40 ? 60 : 40;
  while (pos + 8 <= end) {
    const appId = buffer.readUInt32LE(pos);
    if (appId === 0) break;
    const size = buffer.readUInt32LE(pos + 4);
    const next = pos + 8 + size;
    if (next > end || size < header) break;
    if (wanted(appId)) {
      try {
        const reader = new Reader(buffer, pos + 8 + header, strings);
        reader.u8();
        reader.key();
        apps.set(appId, reader.object());
      } catch {
      }
    }
    pos = next;
  }
  return apps;
}

// packageinfo.vdf: every licence package Steam has cached on this PC, with the apps each one grants.
function parsePackageInfo(buffer) {
  const packages = new Map();
  if (buffer.length < 8) return packages;
  const magic = buffer.readUInt32LE(0);
  const version = magic & 0xff;
  if ((magic >>> 8) !== 0x065655) return packages;
  if (version < 39 || version > 40) return packages;
  let pos = 8;
  const header = 20 + 4 + (version >= 40 ? 8 : 0);
  while (pos + 4 <= buffer.length) {
    const id = buffer.readUInt32LE(pos);
    if (id === 0xffffffff) break;
    pos += 4 + header;
    try {
      const reader = new Reader(buffer, pos);
      reader.u8();
      reader.cString();
      packages.set(id, reader.object());
      if (buffer[reader.pos] === TYPE_END) reader.pos++;
      pos = reader.pos;
    } catch {
      break;
    }
  }
  return packages;
}

module.exports = { parseAppInfo, parsePackageInfo };
