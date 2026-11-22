// Per-console defaults: which emulator runs it, which files count as games, and the launch arguments.

// Each emulator: its exe name, and the arguments that start a game fullscreen.
// RetroArch also gets the core to load; the others ignore it.
const EMULATORS = {
  dolphin: { label: 'Dolphin', exe: 'Dolphin.exe', args: (rom) => ['-b', '-e', rom] },
  cemu: { label: 'Cemu', exe: 'Cemu.exe', args: (rom) => ['-f', '-g', rom] },
  eden: { label: 'Eden', exe: 'eden.exe', args: (rom) => ['-f', '-g', rom] },
  pcsx2: { label: 'PCSX2', exe: 'pcsx2-qt.exe', args: (rom) => ['-batch', '-fullscreen', '--', rom] },
  shadps4: { label: 'shadPS4', exe: 'shadPS4.exe', args: (rom) => ['-g', rom] },
  azahar: { label: 'Azahar', exe: 'azahar.exe', args: (rom) => ['-f', rom] },
  retroarch: {
    label: 'RetroArch',
    exe: 'retroarch.exe',
    args: (rom, core) => ['-f', '-L', `cores\\${core}_libretro.dll`, rom],
  },
};

const PS_DISCS = ['.iso', '.chd', '.cso', '.cue', '.bin'];

// kind "files" (the default): files with these extensions. "folders": folders holding eboot.bin.
// "anything": every file and folder, for consoles whose emulator the user picks.
// Cartridge systems also take .zip, which RetroArch opens directly.
const CONSOLES = {
  gamecube: { name: 'GameCube', emulator: 'dolphin', extensions: ['.iso', '.gcm', '.gcz', '.rvz', '.ciso'] },
  wii: { name: 'Wii', emulator: 'dolphin', extensions: ['.iso', '.rvz', '.wbfs', '.wad', '.gcz', '.ciso'] },
  wiiu: { name: 'Wii U', emulator: 'cemu', extensions: ['.wua', '.wud', '.wux', '.rpx'] },
  switch: { name: 'Switch', emulator: 'eden', extensions: ['.nsp', '.xci', '.nro'] },
  switch2: { name: 'Switch 2', emulator: null, kind: 'anything' },
  ps2: { name: 'PS2', emulator: 'pcsx2', extensions: PS_DISCS },
  ps4: { name: 'PS4', emulator: 'shadps4', kind: 'folders' },
  ps5: { name: 'PS5', emulator: null, kind: 'anything' },
  '3ds': { name: '3DS', emulator: 'azahar', extensions: ['.3ds', '.cci', '.cxi', '.3dsx'] },
  nes: { name: 'NES', emulator: 'retroarch', core: 'mesen', extensions: ['.nes', '.fds', '.unf', '.unif', '.zip'] },
  snes: { name: 'SNES', emulator: 'retroarch', core: 'snes9x', extensions: ['.sfc', '.smc', '.fig', '.swc', '.zip'] },
  n64: { name: 'N64', emulator: 'retroarch', core: 'mupen64plus_next', extensions: ['.z64', '.n64', '.v64', '.zip'] },
  gb: { name: 'Game Boy', emulator: 'retroarch', core: 'gambatte', extensions: ['.gb', '.zip'] },
  gbc: { name: 'Game Boy Color', emulator: 'retroarch', core: 'gambatte', extensions: ['.gbc', '.zip'] },
  gba: { name: 'Game Boy Advance', emulator: 'retroarch', core: 'mgba', extensions: ['.gba', '.zip'] },
  ds: { name: 'DS', emulator: 'retroarch', core: 'melondsds', extensions: ['.nds', '.zip'] },
  megadrive: { name: 'Mega Drive', emulator: 'retroarch', core: 'genesis_plus_gx', extensions: ['.md', '.gen', '.smd', '.bin', '.zip'] },
  mastersystem: { name: 'Master System', emulator: 'retroarch', core: 'genesis_plus_gx', extensions: ['.sms', '.zip'] },
  gamegear: { name: 'Game Gear', emulator: 'retroarch', core: 'genesis_plus_gx', extensions: ['.gg', '.zip'] },
  ps1: { name: 'PS1', emulator: 'retroarch', core: 'swanstation', extensions: ['.cue', '.chd', '.pbp', '.iso'] },
  dreamcast: { name: 'Dreamcast', emulator: 'retroarch', core: 'flycast', extensions: ['.gdi', '.cdi', '.chd', '.cue'] },
};

// The exe and arguments that start one game. Consoles without a preset emulator get just the game path.
function launchSpec(consoleId, exe, gamePath) {
  const preset = CONSOLES[consoleId];
  const args = preset.emulator ? EMULATORS[preset.emulator].args(gamePath, preset.core) : [gamePath];
  return { exe, args };
}

module.exports = { EMULATORS, CONSOLES, launchSpec };
