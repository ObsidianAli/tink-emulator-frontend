# Tink

A small, controller-friendly game launcher for Windows that shows your games as cases on a 3D shelf.

## Games folders

Until the settings screen exists, Tink reads `%APPDATA%\tink\settings.json`, with one games folder per console:

```json
{
  "consoles": {
    "gamecube": { "folder": "D:\Games\GameCube" },
    "snes": { "folder": "D:\Games\SNES" },
    "ps5": { "folder": "D:\Games\PS5", "exe": "D:\Emulators\ps5\emulator.exe" }
  }
}
```

Emulators are found on their own (beside Tink, in Program Files, AppData and RetroArch's usual folder). Add an `exe`
to use a different one; Switch 2 and PS5 always need one.

Console names: gamecube, wii, wiiu, switch, switch2, ps2, ps4, ps5, 3ds, nes, snes, n64, gb, gbc, gba, ds, megadrive,
mastersystem, gamegear, ps1, dreamcast.
