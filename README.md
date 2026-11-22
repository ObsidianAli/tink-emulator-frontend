# Tink

Every console you've ever owned, on one shelf.

## Download

`Tink.zip` from [Releases](https://github.com/ObsidianAli/tink-emulator-frontend/releases). Unzip, run `Tink.exe`. Windows 10 or 11.

It's not signed, so Windows may complain the first time ("More info" → "Run anyway"). Updates come through Tink itself after that. Keep the `data` folder, that's your settings and covers.

## Quitting a game

Hold Select + Start for 2 seconds (View + Menu on an Xbox pad). Steam games too.

## Emulators

Not included. Tink finds the usual install folders, or you can set the exe in Settings.

- GameCube, Wii: Dolphin
- Wii U: Cemu
- Switch: Eden
- PS2: PCSX2
- PS4: shadPS4
- 3DS: Azahar
- Retro: RetroArch with mesen, snes9x, mupen64plus_next, gambatte, mgba, melondsds, genesis_plus_gx, swanstation and flycast
- Switch 2, PS5: whatever you use, set in Settings

## Covers

Covers come from libretro. For the newer consoles it doesn't have much, so you can add a free SteamGridDB key in Settings. Tink only goes online for covers and to check for updates.

## Running from source

```
npm ci
npm start
```
