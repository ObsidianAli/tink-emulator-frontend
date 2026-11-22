# Tink

A game launcher for the couch. Your emulator and Steam games sit on a shelf as little 3D cases, and you pick one with a controller.

Windows only.

## Getting it

Download `Tink.zip` from [Releases](https://github.com/ObsidianAli/tink-emulator-frontend/releases), unzip it anywhere and run `Tink.exe`. Windows might warn you since it isn't signed, just hit "More info" and "Run anyway".

It asks for updates by itself after that.

Your settings and covers live in the `data` folder next to `Tink.exe`, so don't delete that one.

## Controls

| Pad | Keyboard | |
| --- | --- | --- |
| Left / Right | Left / Right | Move along the shelf |
| LB / RB | Up / Down | Next shelf |
| A | Enter | Play |
| Y | F | Flip the case |
| X | Space | Open the case |
| B | Esc | Back |
| Menu | S | Settings |

Hold **Select + Start** for 2 seconds to quit a game and get back to Tink (View + Menu on an Xbox pad). Works for Steam games too.

## Emulators

Tink doesn't come with any, install the ones you want and it finds them. If it can't, point it to the exe in Settings.

- GameCube, Wii: Dolphin
- Wii U: Cemu
- Switch: Eden
- PS2: PCSX2
- PS4: shadPS4
- 3DS: Azahar
- Retro stuff: RetroArch (mesen, snes9x, mupen64plus_next, gambatte, mgba, melondsds, genesis_plus_gx, swanstation, flycast)
- Switch 2, PS5: pick whatever you use in Settings

## Covers

Covers come from libretro. For the newer consoles it doesn't have much, so you can add a free SteamGridDB key in Settings. Tink only goes online for covers and to check for updates.

## Running from source

```
npm ci
npm start
```
