# Barnstorm, the browser extension

The plane game from Outpost's top bar, for any web page: click the extension's button and a little pixel plane appears over whatever you're looking at. It has both games: **Wreck** (fly over the page and shoot it to bits while dwarf builders put it back) and **Sortie** (a top-down shooter against waves of enemy aircraft, over the same page). Nothing on the page is really changed: Land, and it's all as it was.

## Build it and load it

```bash
npm run extension:build
```

That makes `extension/dist/`. Then, in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension/dist` folder.
4. Pin Barnstorm from the puzzle-piece menu, so its button is on the toolbar.

After changing the game, build again and press the reload arrow on Barnstorm's card on that page.

## Hand it to someone

```bash
npm run extension:pack
```

That builds it and makes `extension/barnstorm-<version>.zip`: one folder with the extension in it and a page of plain instructions (`HOW-TO-INSTALL.txt`). Send them the zip. They need nothing else: not this repository, and nothing installed but Chrome (or Edge, Brave, Arc).

Loading it this way means turning on Developer mode, which Chrome is a little grudging about (it may ask them now and then whether to keep it). The way round that is the Chrome Web Store: the same zip's contents are what it takes, the description already fits its limit, and once it's listed installing is one click and updates arrive by themselves. That needs a developer account of your own.

To send a newer one, raise `version` in `manifest.json` and pack again; they replace the folder and press the reload arrow on Barnstorm's card.

## Use it

| | |
|---|---|
| Click the button, or **Alt+Shift+B** | Start the game on this page |
| Click it again | Pause: the game gets out of the way and the page is yours. Once more to resume. |
| **P** | Pause |
| **Esc**, or **Land** | Stop, and put the page back |

The keys for each game are on the bar along the bottom of the window. Best scores are kept by the extension, so they're the same on every site.

## What it's allowed to do

It asks for nothing until you click it. Its permissions are:

- **activeTab**: the page you're on, at the moment you click the button, and no other.
- **scripting**: to put the game on that page.
- **storage**: to remember your best scores.

It doesn't run in the background on the pages you visit, read them, or send anything anywhere. (Which is also why there's no Konami code here, as there is in Outpost: listening for it would mean running on every page.)

## Where it won't work

- Pages the browser keeps extensions off: its own (`chrome://…`), the extension store, and the built-in PDF viewer. The button shows "no" for a moment.
- Inside frames: the game is over the page you clicked on, and can't shoot what's in an embedded frame (it goes as one piece).
- A game doesn't survive leaving the page: navigate or reload, and it's gone.

## How it's put together

It isn't a copy of the game. It's built from the same files Outpost's page is (`plugins/barnstorm/`), so there's one game to change:

- `src/content.tsx` puts the game on the page, in a shadow root so the site's styles and the game's can't touch each other.
- `src/store.ts` stands in for the one thing the game takes from Outpost: where it keeps best scores.
- `src/tokens.css` is the colours and type Outpost's stylesheet would have given it. The game's own styles are lifted out of `ui/src/styles.css` when it's built.
- `src/background.js` is what the button does.
- `scripts/extension-build.ts` (at the top of the repository) builds it, and draws the icons from the plane's pixels.
