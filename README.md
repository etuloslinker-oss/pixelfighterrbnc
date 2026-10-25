# Pixel Fighter: rollback netcode

```
index.html          -> Vercel (static site)
server/             -> Render (Node web service, WebSocket relay)
render.yaml         -> optional Render blueprint
```

## Deploy
1. **Render**: push this folder to GitHub, then New > Web Service (or Blueprint using `render.yaml`).
   Root directory `server`, build `npm install`, start `npm start`. Pick the region nearest your players.
   Copy the URL, e.g. `https://pixel-fighter-server.onrender.com`.
2. **Edit `index.html`**: find `const SERVER_URL=` and set it to `wss://pixel-fighter-server.onrender.com/ws`.
3. **Vercel**: import the repo as a static site (no build command, root = the folder with `index.html`).
4. **Lock it down** (optional): set Render env `ALLOWED_ORIGINS=https://your-app.vercel.app`.

Free Render services sleep when idle; the first Host/Join can take ~30-60 s (the page says so). Test with `?server=wss://...` to override the URL without editing.
Local: `cd server && npm i && npm start`, then open `index.html` via any static server (localhost pages use `ws://localhost:8080/ws`).

## How it works
- Both browsers run the full 60 Hz simulation. Only inputs travel (the server just relays).
- Your input is applied after a small delay (Auto = ~1/4 of your ping, or choose 0-5 frames in the "Online delay" box).
- The opponent's input is **predicted** (their held directions continue, no new button). If the real input differs, the game restores the snapshot from before that frame and silently re-simulates to the present (sound muted). Up to 12 predicted frames; beyond that it waits ("WAITING FOR OPPONENT").
- Clock sync: the machine that runs ahead slows itself by 2-10% so the other side's inputs arrive on time.
- Determinism: seeded RNG, plus deterministic sin/cos, are swapped in while stepping. Both sides exchange a checksum every 30 confirmed frames and show **DESYNC DETECTED** if they ever differ.
- HUD (bottom right): `PING`, `DELAY`, `RB last/max` rollback depth.

## Changing the game later
Anything that changes match state must live in the snapshot (see `rbSnap`): globals `F hs shk FT FP PT FX BL FR BZ KG KMK PR DPQ S HK`. If you add a new global that the sim mutates, add it there. Fields the renderer writes onto fighters go in `VIS`. New code that wraps `tick()` is fine (rollback runs the whole wrapped tick per frame).
