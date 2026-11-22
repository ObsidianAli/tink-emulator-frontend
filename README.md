# Tink

Tink is a small game launcher for Windows that shows your games as cases on a 3D shelf. You can use it with a controller from the couch, and it starts your emulator games and Steam games from the same place.

## Download

Get `Tink.zip` from the [Releases page](https://github.com/ObsidianAli/tink-emulator-frontend/releases) and unzip it somewhere you like, for example `C:\Games`. That gives you a `Tink` folder; run `Tink.exe` inside it. There is nothing to install, and you only need to download it once.

Tink keeps a `data` folder inside the `Tink` folder with your settings, the downloaded Covers and a log file. If something goes wrong, `data\tink.log` is where to look. To move Tink, move the whole folder.

Windows SmartScreen may warn you the first time, because Tink isn't signed. Click "More info", then "Run anyway".

## Updates

Tink updates itself. When a newer release is out, it downloads the new files in the background and asks if you want to update, once per start and only while you're on the shelf. Choosing Update replaces the program files and restarts Tink. Not now keeps the download for next time. Your `data` folder is kept, and Settings shows which version you're on. If an update fails, Tink stays as it is and writes a line to `data\tink.log`.

The release also has a single `Tink.exe`. It's only there so older versions that were a single exe can find the update, and it starts slowly because it unpacks itself every time.

## First run

Tink walks you through three screens:

1. It looks for your emulators and shows which ones it found. Pick the exe for any that are missing.
2. You choose one games folder for each console you play, and skip the rest.
3. You say whether Tink may download a Cover for each game.

Steam games are found on their own if Steam is installed. You can change everything later in Settings.

## Controls

| Controller | Keyboard | What it does |
| --- | --- | --- |
| D-pad or left stick, left and right | Left and Right | Move along the shelf |
| LB and RB, or D-pad up and down | Up and Down | Switch to another shelf |
| A | Enter | Play the game |
| Y | F | Flip the case to see the back |
| X | Space | Open the case |
| B | Esc | Close the case or flip it back |
| Menu | S | Open Settings |

In Settings and setup, A picks, B goes back or closes, and X is the second action on a row (Find automatically, Skip, Clear). The mouse works there too.

## Quitting a game

On an emulator game, hold Select and Start together for 2 seconds and Tink closes the emulator and comes back. On an Xbox pad these are View and Menu. Steam games are quit from Steam's own menu, and Tink returns when the game ends.

## Emulators

Tink doesn't include any emulators. Install the ones you need yourself, and Tink finds them beside itself, in Program Files, in AppData and in RetroArch's usual folder. If one isn't found, pick its exe in Settings.

| Console | Emulator |
| --- | --- |
| GameCube, Wii | Dolphin |
| Wii U | Cemu |
| Switch | Eden |
| PS2 | PCSX2 |
| PS4 | shadPS4 |
| 3DS | Azahar |
| NES | RetroArch, mesen core |
| SNES | RetroArch, snes9x core |
| N64 | RetroArch, mupen64plus_next core |
| Game Boy, Game Boy Color | RetroArch, gambatte core |
| Game Boy Advance | RetroArch, mgba core |
| DS | RetroArch, melondsds core |
| Mega Drive, Master System, Game Gear | RetroArch, genesis_plus_gx core |
| PS1 | RetroArch, swanstation core |
| Dreamcast | RetroArch, flycast core |
| Switch 2, PS5 | You pick the emulator yourself |

For RetroArch, install the cores above from its Online Updater.

## Covers

Covers come from the libretro thumbnail library when you allow it. For games it doesn't have, such as Wii U, Switch, PS4 and PS5 games, you can paste a free SteamGridDB key into Settings and Tink will search there too. Games with no Cover get a plain one with their title.

## Privacy

Tink goes online for two things: downloading Covers, only if you said yes, and asking GitHub on start whether there's a newer version. It never sends anything about you.

## Building from source

You need Node.js 22.

```
npm ci
npm start
npm test
npm run dist
```

`npm run dist` writes `dist\Tink.exe`. When run from source, Tink keeps its `data` folder in the project.
