# Mobile / touch (2026-11-21, branch `mobile`)

Keyboard stays the default. Touch UI turns on only on a touch-only device (coarse pointer, no fine pointer, no hover)
or when the player picks **Kontroller > Giriş aygıtı > Dokunmatik**.

## Controls (landscape)
| Side | Control | Action |
|---|---|---|
| Left bottom | Steering: **pads** (default), **drag wheel**, or **tilt** | analog `steerAxis` |
| Right bottom | **GAZ** / **FREN** pedals (multi-touch; optional partial travel by finger height) | analog throttle / brake |
| Left column | Pause, camera, MFD, PIT (opens MFD strategy + box request) | `pause`, `cameraNext`, `mfdNext`, `mfd1` |
| Right column | DRS, ERS (hold = overtake), gear + / − (manual gearbox only) | `drs`, `ersOvertake`, `gearUp/Down` |
| HUD | MFD header = next page, MFD rows = options 1–4 | `mfdNext`, `mfd1..4` |

Touch feeds `InputManager.setAnalog` (the gamepad path) after the pad poll; buttons press actions like pad buttons.
The sim only sees the latched `DriverControls` → replays / ghosts / flashback stay deterministic.
Tilt: DeviceOrientation β/γ → roll in the screen plane (any orientation), 60 ms low-pass, calibrated centre,
deadzone, full lock at 25° / sensitivity. iOS asks for motion permission inside the tap that picks tilt.

## Settings (Kontroller)
Device `touch`; steering mode; size 0.8–1.3; opacity; left-handed swap; tilt sensitivity / deadzone / centre;
partial pedals; vibration (navigator.vibrate on kerbs / contact, Android only). Live "Dokunmatik testi" row.
First run on a touch-only device: device touch, **beginner assists**, mobile quality, HUD scale 1.25. Stored desktop
defaults opened on a phone follow the device until the player sets device / quality themselves. Desktop unchanged.

## Layout
- Phone (touch UI, short side < 600 px): menu stage fits the width and each screen scrolls; rows ≥ 44 px; key hints
  hidden; floating back button (top left). Tablets keep the desktop stage with touch-sized rows.
- HUD: 64 px side gutters for the button columns; speedo + MFD centred at the bottom, small minimap left of it
  (hidden under 830 px width); weather / tyre block via MFD pages instead.
- Portrait: "Cihazı yan çevir" overlay; an offline race pauses. First tap: fullscreen + landscape lock (Android).
- Wake Lock while racing and while hosting a browser room. Audio unlocks on the first tap (touchend for iOS).

## Performance
- Mobile default quality: `low`, `medium` on strong phones (Apple GPU / Adreno 7xx+ / Immortalis, ≥ 6 cores, ≥ 6 GB).
- `mobilePreset()` (same ids, desktop tables untouched): render scale ≤ 0.7/0.8, FXAA, one 1024 shadow map over ≤ 35 m,
  no AO / live mirrors / CA lens, 128 env map, anisotropy 2, 60 % trees, 50 % crowd, no grass cards, far ≤ 1800 m.
- Governor (mobile only, runtime only): 5 s average < 30 fps → one preset down + toast. `?governor=0` disables it.
- The 20 km Eifel ring keeps its existing ≤ 11 AI cap; on a phone fewer AI (5–9) is the practical choice.

## Try it on a real phone
1. Same Wi-Fi. In the worktree: `cmd /c npx.cmd vite --config vite.worktree.config.ts --port 5190 --strictPort --host`.
2. Open `http://<PC LAN IP>:5190` on the phone (IP from `ipconfig`, printed by Vite as "Network").
3. Plain http on a LAN IP is **not a secure context**: tilt (DeviceOrientation), Fullscreen, Wake Lock and clipboard
   paste may be blocked; pads / wheel / pedals work. For https use the Cloudflare quick tunnel
   (`scripts/online-tunnel.ps1`, prints an `https://….trycloudflare.com` URL) or the future GitHub Pages build.
4. Online: phones can join P2P rooms and server rooms; hosting a P2P room on a phone works but warns
   ("Telefonda oda kurmak yavaş olabilir; bilgisayar önerilir") and keeps the screen awake.

## Not verifiable here
Real FPS / thermals, tilt feel and sign on iOS + Android, haptics, notch insets, fullscreen / orientation lock
behaviour, iOS Safari audio unlock, share sheet.
