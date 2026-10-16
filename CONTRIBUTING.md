# Contributing

Thanks for taking the time to help. Bug reports, translation fixes and pull requests are all welcome.

## Reporting bugs

Open an issue with the bug report template. Include your Windows version, the app version (Windows Settings → Apps → Installed apps) and steps to reproduce. Please remove access tokens, addresses and device names from logs and screenshots before posting them.

Security problems should not go into public issues; see [SECURITY.md](SECURITY.md).

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Run `npm ci`, then make your change.
3. `npm test` and `npm run kontrol` must pass. Add tests for fixes and new features.
4. Keep each pull request to one topic and describe what changed and how you tested it.

A few rules are not up for discussion:

- **Tests never contact a real Home Assistant.** Use the existing fakes and mocks in `test/`.
- **The door rule only gets stricter.** Locks, alarm panels, doors, garage doors, gates, intercoms and similar devices must never be shown, favorited, bound to a hotkey or run. Pull requests that loosen this will be closed. New blocked words are welcome.
- **Secrets never reach logs, exports or error messages.** That covers access tokens, passwords and webhook IDs.

## Code style

The code, comments and identifiers are in Turkish. Keep new code consistent with the file you are editing. Comments in English are fine in a pull request; we can translate them together.

## Translations

The interface strings live in `src/lib/ceviri/`, one file per area. Each row is `[key, Turkish, English]`, and the tests check that both languages have the same keys and placeholders. If a translation reads oddly, a small pull request that fixes it is the best kind of contribution. Adding a language means adding a column to those rows and an entry to `DILLER` in `src/lib/dil.js`.

## Türkçe

Katkılar memnuniyetle karşılanır. Yukarıdaki kurallar Türkçe katkılar için de aynen geçerli: testler gerçek Home Assistant'a bağlanmaz, kapı kuralı yalnız sıkılaşır, sırlar günlüğe ya da dışa aktarılan dosyaya girmez. Issue ve pull request'leri Türkçe de açabilirsin.
