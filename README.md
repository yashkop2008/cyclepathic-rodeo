# Cyclepathic Rodeo

Your phone is the ground. Tilt it and the course tilts with it; your goofy unicyclist stays upright in the real
world and rolls downhill. Steeper is faster, but too steep and you wipe out. Race 4–6 friends across three worlds;
finish first and you become a **Gravity God** who tilts everyone else's world.

HackPSU, General Track: The Mystery Stack (Phone Motion · Rivalry · Group Play).

**Demo video:** https://youtu.be/llDes7fpg_c

## Run it

Needs Node 18+.

```bash
npm install
npm start
```

- **Big screen (laptop/TV):** http://localhost:3000/host/ shows the whole course, wrapped into three rows.
- **Phones:** scan the QR code on the host screen. The whole phone side is landscape (join screen included; portrait
  shows a "turn your phone" prompt). Each phone shows its own close-up view.

### Phones need to reach the laptop over HTTPS

Venue Wi-Fi usually blocks devices from talking to each other, and browsers only allow motion sensors on HTTPS.
A Cloudflare quick tunnel fixes both:

```bash
winget install --id Cloudflare.cloudflared -e
cloudflared tunnel --url http://localhost:3000
```

Open the printed `https://….trycloudflare.com` URL **with `/host/` on the end, on the laptop**. The QR code
then points phones at the tunnel. The URL changes every time you restart the tunnel.

No internet? Put everyone on a phone hotspot and run `npm run https` (phones tap through a certificate warning once).

### True fullscreen on phones

- **Android / iPad:** joining goes fullscreen and locks landscape; there's also a FULLSCREEN button.
- **iPhone:** Safari doesn't let web pages go fullscreen. Tap **Share → Add to Home Screen** and open Rodeo from the
  home screen: no browser bars, straight into that room. (Settings → Safari → Landscape Tab Bar off also helps.)

## Test without phones

On the host lobby: `B` add bot · `K` keyboard rider (`←`/`→` tilt) · `X` remove bots · `Space` start.
Click the red ✕ on any rider's slot to remove them (a removed phone goes back to its join screen).
In a race, `Esc` ends it early. Add `?debug=1` to the host URL to see physics bodies.

### Bot test harness

Race bots at full speed (no rendering) from the host page's browser console, to check balance after any change:

```js
const sim = await import('/host/js/sim.js');
sim.holdTest(1, 8);   // 8 races on Space: riders holding a fixed tilt vs terrain-reading bots
sim.race(0, ['bot', 'human', 'human', 'hold:35']);
sim.fullFlow(['human', 'human', 'bot', 'bot', 'hold:30', 'hold:40']); // whole Grand Prix incl. results screens
sim.done();           // back to the normal game
```

`human` riders use the bot brain with 150 ms of network lag and shakier hands. Current numbers (40 hold-test
races): riders holding one angle won 2/40 (both on Space, by under 2 s against a slow bot field) and finish last
in full Grand Prix runs; all three worlds complete with no errors.

### Recording a demo video

Open http://localhost:3000/host/demo-recorder.html and run `runDemo({ record: true })` in its console. It runs the
big screen and one phone side by side (bots race; the phone's tilt comes from the bot brain through a simulated
motion sensor), adds captions, and records a 1080p MP4. When it finishes it POSTs the video to
`http://localhost:3001/raw/<name>`, so run a small local receiver there first (or change that line to download
the blob instead). `runDemo({ record: false })` just plays it.

## How it plays (and why "tilt and hold" loses)

Your rider always stands upright in the real world, so how far they lean against the ground is exactly how steep
the ground under them is: **your tilt + the slope you're on**. The balance meter on your phone shows it.

- **Too steep = wipeout.** Lean past ~50° for 0.35 s (on the ground or skimming just above it) and you go over. Mud,
  loose sand, quicksand and slick metal have less grip, so the limit drops (≈ 50° × √grip). Hold a big tilt and the
  downhills crash you; hold a small one and the steep climbs roll you back. You have to keep adjusting.
- **Land level.** In the air your tilt still steers gravity. Only real jumps (0.5 s+ of air) are judged:
  within 14° of level = **PERFECT** speed boost · fine up to 28° · past that **SLOPPY** (you lose half your speed) ·
  past 62°, or a very hard crooked landing = crash. Holding a big tilt lands sloppy every time.
- **Lag forgiveness:** phones are ~0.1–0.2 s behind over the internet, so the host judges landings and wipeouts with
  your most level tilt from the last 0.25 s. Leveling out "just in time" on your screen counts.
- **Crash = back to the last checkpoint**, clock still running, with 1.5 s of ghost-mode. Three crashes in a row at the
  same spot and you respawn with a running start, so nobody can get permanently stuck.
- **Moving obstacles** (timed off the race clock, identical on every screen): tire swing, space pod and swinging
  boulder on cranes; a bouncing beach ball and drifting asteroid; Space's energy gate (flickers before it switches on);
  hopping tumbleweeds. Touching one is a **BONK**: knocked back with 1 s of see-through recovery, no checkpoint reset.
  Speed up or brake to slip through: every one has a window, and waiting just outside its reach is safe.
- **Track features:** kickers over gaps (fall in = crash), bounce pads (spring / hover pad / barrel), a timed seesaw
  (World) or rotating station ring (Space) whose ends can block you if you hit them at the wrong moment, a wagon wheel
  bridging a canyon (Desert), and low-grip patches.
- **Gravity Gods:** finishers' tilt is added to everyone still racing (35% strength). Lead changes, crashes, perfect
  landings and finishes are called out live on the big screen.
- 25 s after the first finisher the race ends (DNF = 0 pts). Points 10/8/6/5/4/3. Three worlds = one Grand Prix:
  **Sunny Grassland** (normal gravity, mud), **Low-Gravity Space** (0.4× gravity, thin air, slick metal),
  **Dusty Desert** (loose sand, quicksand). Riders wear the world's outfit: classic, astronaut, cowboy.

Simulated with "human-like" riders plus bots: zero landing crashes across all three worlds, a few gap falls,
0–7 bonks each, races ~22–56 s. Riders holding a fixed tilt mostly fail to finish (wipe out on drops, land sloppy,
stall on climbs). Every climb is kept below the lean limit of its surface (a rider can always get up it).

## Sound

All music and sound effects are 8-bit chiptune generated live with Web Audio (`shared/audio.js`, no audio files):
a track per world (bouncy Grassland, floaty minor-key Space, galloping western Desert) plus lobby and results
themes, and effects for the countdown, GO, crashes, bonks, perfect/sloppy landings, bounce pads, checkpoints,
finishes, lead changes and a warning blip when your ground is too steep. Phones play the music quietly under the
big screen and add their own effects. Mute music or effects with the 🎵 / 🔊 buttons (big screen: right edge,
or `M` / `N`; phones: bottom-left). Each device remembers its choice. Sound starts after the first tap or key press
(browser rule).

## Performance and smoothness

- **Never draw vector circles in Phaser Graphics** (`fillCircle`/`strokeCircle`/`arc`): Phaser builds each from
  ~600 points, redrawn every frame. Space's starfield alone made the big screen run at 17 fps. Use small textures,
  `fillRect`, or `fillEllipse(…, 16)` instead.
- The big screen bakes the terrain (half resolution) and its static HUD frame into textures once per race, and
  each of its three row cameras skips scenery outside its third of the track. (Compute a camera's range from
  `midPoint`/`zoom`: `worldView` isn't valid until the first render, which once hid the whole map.)
- Phones render ~0.1 s in the past and interpolate between snapshots on the host's clock (the delay adapts to
  network jitter), so riders and the camera glide instead of snapping 20 times a second.
- Phone HUD updates every frame with transforms (no layout work) and eases values; it scales with screen height
  (`--ui`).
- The big screen's standings bar uses critically-damped springs (no overshoot, momentum kept if places change
  mid-slide, frame time clamped so hitches can't jump it) and only swaps two riders once one is 40 px clearly ahead
  (`PASS_MARGIN`), so riders rocking side by side on bumps don't make it flicker.

## App icon

One bold white unicycle, tilted, on the game's red: `controller/icon.svg` (browser tabs) plus PNGs for home-screen
installs (`icon-180.png` for iPhone, `icon-192/512.png` for Android). The PNGs are generated from the same design by
`npm run icons` (no dependencies). An already-installed home-screen app keeps its old icon until it's removed and
added again.

## Art

From the art handoff (`UNICYCLE_GAME_HANDOFF.md` + style guide): the procedural rider/unicycle rig, the six player
colours, per-world palettes and outfits, the HUD layout (rank shield, world title, progress bar with a marker per
rider, timer pill, landscape tilt icon). Opponents on your phone are translucent ghosts. The rig is cached as three
texture layers (back leg, wheel, body) so the wheel spins live; terrain is vector so it stays crisp at any zoom.

Deviations from the handoff (its "SUGGESTED" items): tilt is read from `deviceorientation` (rebuilt into a gravity
vector, no calibration needed) because that's what tested well on phones; the host runs all physics and streams
snapshots; no 2 extra colours, so rooms cap at 6.

## Code map

```
server/index.js             Express + Socket.IO relay (rooms, QR, snapshots, home-screen manifest). No game logic.
shared/                     Used by both host and phones
  rig.js                    Rider + unicycle rig (from the handoff), texture layers, RiderView
  maps.js                   Worlds, track feature lists → geometry, groundAt(), crash RULES
  art.js                    Cartoon terrain, parallax backdrops, props, pads, platforms, flags, text style
  protocol.js               Snapshot row layout
host/                       Big screen: Phaser 3 + Matter physics, runs the simulation
  js/unicycle.js            Physics wheel, crash/landing/checkpoint rules, poses. TUNING lives here.
  js/scenes/RaceScene.js    3-row whole-map cameras, platforms, bots, HUD, live feed, snapshots
  js/scenes/LobbyScene.js   Room code, QR, how-to-play, rider slots
  js/scenes/ResultsScene.js Podium, times, Grand Prix awards
  js/scenes/ui.js           Cards, buttons, rank badges
  js/sim.js                 Dev-only bot test harness (console)
  demo-recorder.html        Dev-only: plays a scripted, captioned demo (big screen + one phone) and records it
controller/                 Phone
  index.html                Join, HUD, how-to-play + tilt demo, rotate prompt
  js/phone.js               Tilt sensing, orientation lock workaround, rendering, effects, balance meter
```

## Tuning

Crash and landing limits: `RULES` in `shared/maps.js`. Obstacles: `['pendulum' | 'bobber' | 'gate' | 'tumble', …]`
entries in each world's feature list (keep a pendulum's swing high at the ends, or it becomes impassable). Feel: `TUNING` in `host/js/unicycle.js` (drag, crash timing, boost,
ghost time). Tracks: each world's `features` list in `shared/maps.js`; keep ~800 px of run-up between a checkpoint
and the next gap. Phone view: `VIEW_H`, `VIEW_H_FAST` in `controller/js/phone.js`.
