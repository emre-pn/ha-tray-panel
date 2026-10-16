# ha-tray-panel

Home Panel (*Ev Paneli* in Turkish) is a Windows tray app for [Home Assistant](https://www.home-assistant.io/). It gives you a quick panel for your favorite devices, a keyboard-driven command palette and global hotkeys, with your full dashboard one click away.

English | [Türkçe](README.tr.md)

## Features

- Tray icon with a quick panel: lights (with brightness presets and a slider), scenes, media and PC actions, plus a "recently used" row.
- Command palette (`Ctrl+Alt+P`) with fuzzy search. Typing `desk 40` sets a light to 40%, `desk 0` turns it off.
- Global hotkeys for the main window, the palette, any favorite and any dashboard. The shortcut fields record the keys you press.
- Your Home Assistant dashboard in a compact or wide window that hides when it loses focus.
- Live state over the Home Assistant WebSocket API, with REST polling as a fallback.
- Home and external addresses: the app tries the home address first and falls back to the external one.
- Command line actions for Stream Deck, Task Scheduler and scripts: `"Ev Paneli.exe" --eylem="desk 40"`.
- Cards for climate, media players, vacuums, fans, dehumidifiers, selects, numbers and timers, and colour and white-tone controls for lights.
- Optional info cards: a sensor strip with charts, a clock with weather, a read-only calendar and to-do lists.
- Right-click menu, pages (tabs), tile icon, colour and size, reordering with an undo history, and tiles pinned to the desktop.
- Notifications in the panel for Home Assistant messages, low batteries and updates, with alert rules and quiet hours. Desktop notifications are optional.
- Light, dark and high-contrast themes with preset or custom colours, text size, Windows 11 mica/acrylic, and an interface in English, Turkish, German, French and Spanish.
- Settings search, settings export/import with automatic backups, a diagnostics report without secrets, and an opt-in update check (off by default).
- A portable build that needs no installation.

## Safety

The app controls real devices, so a few rules are built in and are not configurable:

- Locks, alarm panels, sirens, doors, garage doors, gates, intercoms, shutters and similar devices are never listed, added to favorites, bound to a hotkey or run. Scenes that contain them are blocked too.
- Actions such as shutting down a PC need a press-and-hold (about one second) to run.
- The access token is encrypted with Electron `safeStorage` (Windows DPAPI). It never goes into logs or exports, and an address is checked without the token before the token is sent to it.
- If Home Assistant rejects the token, the app stops using it everywhere instead of retrying, so it will not trigger Home Assistant's IP ban.
- Plain `http://` is only accepted for local network addresses.

## Requirements

- Windows 11 (x64). Windows 10 should work but has not been tested.
- Home Assistant with a [long-lived access token](https://www.home-assistant.io/docs/authentication/#your-account-profile).
- Node.js 24 to build from source.

## Installation

Download `Ev-Paneli-Kurulum-<version>.exe` from the [latest release](https://github.com/emre-pn/ha-tray-panel/releases/latest) and run it. It installs for the current user and does not need admin rights.

The installer is not code-signed, so Windows SmartScreen may warn you the first time (More info → Run anyway). Each release lists the SHA-256 checksum of the installer if you want to verify the download.

### Building from source

```bash
git clone https://github.com/emre-pn/ha-tray-panel.git
cd ha-tray-panel
npm ci
npm run dist
```

The installer ends up in `dist/`.

## Getting started

1. Right-click the tray icon and open Settings.
2. Enter your home address (for example `http://homeassistant.local:8123`) and, if you have one, an external HTTPS address.
3. Paste a long-lived access token.
4. Pick your favorites. They show up in the tray menu, the quick panel and the palette.

The interface language follows Windows by default. You can change it under Settings → Appearance → Language.

## Development

```bash
npm start          # run in development mode
npm test           # run the test suite (no Home Assistant needed)
npm run kontrol    # static checks
npm run ikon       # regenerate the icons
npm run dist       # build the Windows installer
npm run dist:tasinabilir   # build the portable exe (no installer)
```

The code, comments and identifiers are in Turkish. Tests never talk to a real Home Assistant; all network calls are mocked. A detailed manual in Turkish is in [docs/KILAVUZ.md](docs/KILAVUZ.md), and the release notes are in [CHANGELOG.md](CHANGELOG.md).

## Contributing

Bug reports, translation fixes and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security issues should be reported privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Emre Sav ([@emre-pn](https://github.com/emre-pn))

This project is not affiliated with Home Assistant or Nabu Casa.
