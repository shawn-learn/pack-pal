# 🧳 Pack Pal

Family packing lists that remember your kinds of trips.

Pick a trip type, say who's coming, answer about 7 quick questions, and Pack Pal builds a packing list for each person. Tick things off from any phone or computer in the house, and everyone sees the changes live. When you get home, a short review teaches it what you forgot and what you never used, so the next list is better.

## Start it (Windows)

1. Install **Node.js** (the LTS version) from https://nodejs.org if you don't have it. Pack Pal has no other dependencies, so there's no `npm install` step.
2. Double-click **`start.bat`**. A window opens showing the addresses, and your browser opens http://localhost:3000.
3. Close that window to stop Pack Pal.

From a terminal you can also run `node server.js` (or `npm start`) in this folder.

The startup window also prints an **"On your Wi-Fi"** address such as `http://192.168.1.20:3000`. Open that on your family's phones. On a phone, use **Add to Home Screen** so it opens like an app.

## First run

1. Go to **Family** and add everyone: adults, kids and babies. Kids get kid things, and babies get diapers, wipes and sleepers.
2. On each device, set **"Who uses this device?"** so the list shows who packed what.
3. Click **✨ Plan a trip**.

## What's inside

- **13 trip types:** ski, rock climbing, paddle boarding, hiking, mountain biking, camping, beach, road trip, visiting family, international, city break, business and cruise. Each one has its own questions, plus two shared ones about weather and laundry. The rock climbing and hiking lists draw on the MEC checklists.
- **Easy-to-forget check:** every trip ends with one quick screen of yes/no questions about the things people most often leave behind, such as "Is there a hot tub or pool where you're staying?", "Does anyone wear glasses or contacts?" and "Any birthdays during the trip?". You can add your own under **Trip types → Everyday essentials** by ticking "Part of the easy-to-forget check".
- **Smart quantities:** clothing scales with the number of days, gets capped when you'll have laundry, and is counted per person.
- **Remembers your answers:** the next trip of the same type starts with last time's answers already filled in.
- **Learns as you go:** after adding something to a trip, tap **"Always pack for Ski trip"**. When a trip is over, use **⋯ → Trip done: review & learn**.
- **Edit everything:** under **Trip types** you can change questions, items, who an item is for, how many to bring and when it's included (for example, "only if Bringing your own skis = yes"). You can also create new trip types, starting blank or from a copy.
- **Live sync:** several people can pack at once, and ticks show up everywhere within a second.
- **Everyone view:** one row per item with a tickable face for each person. You can also switch to **By person** or tap someone's tab.
- Print, copy as text, untick everything for the trip home, dark mode, and confetti when you finish 🎉

## Before you put it on the internet

Turn on the family password. Open `start.bat` in Notepad, remove `REM ` from this line, and pick a password:

```bat
set PACK_PASSWORD=change-me
```

Each device then asks for the password once. Also make sure whatever you use to expose it serves **HTTPS**. Cloudflare Tunnel and Tailscale Funnel both handle that for you, and with Tailscale alone (no Funnel) the app stays private to your own devices.

Other settings you can put in `start.bat` the same way:

| Setting | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Use `127.0.0.1` to allow only this computer |
| `PACK_DATA_DIR` | `.\data` | Where the data file lives |

## Your data and backups

Everything is saved in one file: `data\packing-data.json`. Pack Pal also keeps a daily copy in `data\backups\` for the last 14 days. **Family → Download backup** saves a copy wherever you like.

To restore a backup, stop Pack Pal, copy the backup over `data\packing-data.json`, and start it again.

## For tinkerers

- `seed.js`: the built-in trip types and their packing rules
- `public/engine.js`: turns rules plus answers into a list
- `server.js`: a small web server with no dependencies
- `npm test`: runs the engine tests
