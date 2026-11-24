// With fullscreen off the flag is left out (PCSX2 gets its opposite); Dolphin and shadPS4 have no such flag.
const EMULATORS = {
  dolphin: { label: 'Dolphin', exe: 'Dolphin.exe', args: (rom) => ['-b', '-e', rom] },
  cemu: { label: 'Cemu', exe: 'Cemu.exe', args: (rom, _core, full) => [...(full ? ['-f'] : []), '-g', rom] },
  eden: { label: 'Eden', exe: 'eden.exe', args: (rom, _core, full) => [...(full ? ['-f'] : []), '-g', rom] },
  pcsx2: { label: 'PCSX2', exe: 'pcsx2-qt.exe', args: (rom, _core, full) => ['-batch', full ? '-fullscreen' : '-nofullscreen', '--', rom] },
  shadps4: { label: 'shadPS4', exe: 'shadPS4.exe', args: (rom) => ['-g', rom] },
  azahar: { label: 'Azahar', exe: 'azahar.exe', args: (rom, _core, full) => [...(full ? ['-f'] : []), rom] },
  retroarch: {
    label: 'RetroArch',
    exe: 'retroarch.exe',
    args: (rom, core, full) => [...(full ? ['-f'] : []), '-L', `cores\\${core}_libretro.dll`, rom],
  },
};

const PS_DISCS = ['.iso', '.chd', '.cso', '.cue', '.bin'];

const CONSOLES = {
  gamecube: { name: 'GameCube', libretro: 'Nintendo - GameCube', colour: '#4a4466', emulator: 'dolphin', extensions: ['.iso', '.gcm', '.gcz', '.rvz', '.ciso'] },
  wii: { name: 'Wii', libretro: 'Nintendo - Wii', colour: '#5c6670', emulator: 'dolphin', extensions: ['.iso', '.rvz', '.wbfs', '.wad', '.gcz', '.ciso'] },
  wiiu: { name: 'Wii U', libretro: 'Nintendo - Wii U', colour: '#3f5f6e', emulator: 'cemu', extensions: ['.wua', '.wud', '.wux', '.rpx'] },
  switch: { name: 'Switch', libretro: null, colour: '#6e4447', emulator: 'eden', extensions: ['.nsp', '.xci', '.nro'] },
  switch2: { name: 'Switch 2', libretro: null, colour: '#5a3f4f', emulator: null, kind: 'anything' },
  ps2: { name: 'PS2', libretro: 'Sony - PlayStation 2', colour: '#2f3b5c', emulator: 'pcsx2', extensions: PS_DISCS },
  ps4: { name: 'PS4', libretro: null, colour: '#2e4a63', emulator: 'shadps4', kind: 'folders' },
  ps5: { name: 'PS5', libretro: null, colour: '#4d5566', emulator: null, kind: 'anything' },
  '3ds': { name: '3DS', libretro: 'Nintendo - Nintendo 3DS', colour: '#6b4a4a', emulator: 'azahar', extensions: ['.3ds', '.cci', '.cxi', '.3dsx'] },
  nes: { name: 'NES', libretro: 'Nintendo - Nintendo Entertainment System', colour: '#5e5048', emulator: 'retroarch', core: 'mesen', extensions: ['.nes', '.fds', '.unf', '.unif', '.zip'] },
  snes: { name: 'SNES', libretro: 'Nintendo - Super Nintendo Entertainment System', colour: '#55506b', emulator: 'retroarch', core: 'snes9x', extensions: ['.sfc', '.smc', '.fig', '.swc', '.zip'] },
  n64: { name: 'N64', libretro: 'Nintendo - Nintendo 64', colour: '#3e5a4c', emulator: 'retroarch', core: 'mupen64plus_next', extensions: ['.z64', '.n64', '.v64', '.zip'] },
  gb: { name: 'Game Boy', libretro: 'Nintendo - Game Boy', colour: '#5b5f45', emulator: 'retroarch', core: 'gambatte', extensions: ['.gb', '.zip'] },
  gbc: { name: 'Game Boy Color', libretro: 'Nintendo - Game Boy Color', colour: '#5a4763', emulator: 'retroarch', core: 'gambatte', extensions: ['.gbc', '.zip'] },
  gba: { name: 'Game Boy Advance', libretro: 'Nintendo - Game Boy Advance', colour: '#463f6b', emulator: 'retroarch', core: 'mgba', extensions: ['.gba', '.zip'] },
  ds: { name: 'DS', libretro: 'Nintendo - Nintendo DS', colour: '#55595e', emulator: 'retroarch', core: 'melondsds', extensions: ['.nds', '.zip'] },
  megadrive: { name: 'Mega Drive', libretro: 'Sega - Mega Drive - Genesis', colour: '#3d3d45', emulator: 'retroarch', core: 'genesis_plus_gx', extensions: ['.md', '.gen', '.smd', '.bin', '.zip'] },
  mastersystem: { name: 'Master System', libretro: 'Sega - Master System - Mark III', colour: '#5c4343', emulator: 'retroarch', core: 'genesis_plus_gx', extensions: ['.sms', '.zip'] },
  gamegear: { name: 'Game Gear', libretro: 'Sega - Game Gear', colour: '#3f4a5a', emulator: 'retroarch', core: 'genesis_plus_gx', extensions: ['.gg', '.zip'] },
  ps1: { name: 'PS1', libretro: 'Sony - PlayStation', colour: '#4f5258', emulator: 'retroarch', core: 'swanstation', extensions: ['.cue', '.chd', '.pbp', '.iso'] },
  dreamcast: { name: 'Dreamcast', libretro: 'Sega - Dreamcast', colour: '#6a5a40', emulator: 'retroarch', core: 'flycast', extensions: ['.gdi', '.cdi', '.chd', '.cue'] },
};

const STEAM = { name: 'Steam', colour: '#3b4654' };

// Own keys only, so ids from the screen like "__proto__" never match.
const isConsole = (id) => Object.hasOwn(CONSOLES, id);
const isEmulator = (id) => Object.hasOwn(EMULATORS, id);

const coverColour = (consoleId) => (isConsole(consoleId) ? CONSOLES[consoleId].colour : STEAM.colour);

function launchSpec(consoleId, exe, gamePath, fullscreen = true) {
  const preset = CONSOLES[consoleId];
  const args = preset.emulator ? EMULATORS[preset.emulator].args(gamePath, preset.core, fullscreen) : [gamePath];
  return { exe, args };
}

module.exports = { EMULATORS, CONSOLES, STEAM, isConsole, isEmulator, coverColour, launchSpec };
