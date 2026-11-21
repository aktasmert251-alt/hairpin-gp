# HAIRPIN GP

[Türkçe](README.md) · **English**

**Play:** https://aktasmert251-alt.github.io/hairpin-gp/

HAIRPIN GP is a free racing game that runs in the browser (three.js). No installation is needed; open it in Chrome or Edge. All teams, drivers, sponsors and logos in the game are **entirely fictional** and have nothing to do with any real brand, team or person.

## Features

- **Time trial** (with a ghost lap) and **quick race** (AI opponents, adjustable difficulty)
- Weather (dry, rain), day / sunset / night; safety car, penalties, pit stops, flashback
- **Online:** direct (peer-to-peer) rooms that any player can create in their own browser and join with an invite code; custom teams are available in online mode only
- Keyboard (default), Xbox-style gamepad, and touch controls on phones
- Turkish and English interface, adjustable graphics quality

## Circuits

Istanbul Circuit · Lombardy Park Circuit · Bosphorus Shore Circuit · Ardennes Forest Circuit · Alpine Pass Circuit · Eifel Forest Ring (20 km) · Cappadocia Valley Circuit · Desert Cliff Circuit · Aegean Islands Circuit · Dance with Death – Volcano Rim

Some are inspired by real geography (OpenStreetMap data, ODbL); others are original designs. Details are in the in-game **About** screen.

## Controls (keyboard)

| Action | Key |
|---|---|
| Throttle / Brake | W, S or Up, Down arrow |
| Steering | A, D or Left, Right arrow |
| Gear up / down | E / Q |
| DRS | Space |
| ERS overtake | F |
| Pit limiter | L |
| Camera / Look back | C / V |
| Flashback | R |
| Pause | Esc or P |

Keys and gamepad bindings can be changed in **Settings > Controls**. On a phone, hold the device in landscape; touch controls turn on automatically.

## Online rooms

1. Room host: **Online → Host a room → Guests → New invite code**, then tap **Send with WhatsApp** (the invite goes out as a tappable link).
2. Guest: taps the link; the game opens with the invite already filled in. After typing a nickname the answer is made automatically; **Send with WhatsApp** returns it to the host as a link.
3. The host taps the answer link **in the browser where the room is open**; the answer reaches the room tab by itself and the connection is made. Nothing is pasted.

You can also copy and paste the invite and answer codes instead of using the link.

The room runs in the host's browser; the game has no server. With a direct connection your IP address can be visible to the other players in the room. On some networks (strict firewalls, mobile data) a connection may not be possible. Details: [docs/design/multiplayer-p2p.md](docs/design/multiplayer-p2p.md).

## Development

Node.js >= 24 is required.

```
npm install
npm run dev          # development server
npm run typecheck    # TypeScript check
npm test             # unit and architecture tests
npm run build        # production build (dist/)
```

Docs: [architecture](docs/ARCHITECTURE.md), [decisions](docs/sprints/DECISIONS.md), [design notes](docs/design).

## Licence and privacy

All rights reserved (see [LICENSE](LICENSE)). The source code may be read; it may not be copied, modified or redistributed without permission. Third-party components keep their own licences: [CREDITS.md](CREDITS.md), [THIRD-PARTY-LICENSES](public/THIRD-PARTY-LICENSES.txt). The privacy and KVKK (Turkish data protection law) texts are in the game (**About**) and in [docs/legal](docs/legal). Use this repository's **Issues** page for bug reports and data-protection requests.
