# Would You Rather: The Duel 🦆⚔️🐴

**Would you rather fight 1 horse-sized duck, or 100 duck-sized horses?**

Pick one. Dave (an unpaid volunteer in a nice sweater, armed with nothing but fists,
feet, and vibes) loads into the arena and the simulation does the rest. You just watch.

## Run it

Any static file server works. From this directory:

```sh
python3 -m http.server 8741
# then open http://localhost:8741
```

(It must be served over HTTP — ES modules and GLB loading don't work from `file://`.)

### URL parameters

| param | effect |
|---|---|
| `?pick=duck` / `?pick=horses` | skip the menu and start a battle |
| `&mute=1` | start muted |
| `&dist=8` | fixed camera distance (debug) |

## Controls

- **Drag** — orbit the camera · **Wheel** / pinch — zoom
- **M** — mute all · **B** — battle drums on/off · **K** — hit markers on/off · **P** — pause · **H** — hide HUD (clean capture)
- Everything else is Dave's problem.

## Features

- Dave fights bare-handed with proper fists — jab, cross, roundhouse kick, and a spinning roundhouse when surrounded. (The rig has no finger bones, so his fists are honest geometry bolted onto shrunken hands.) He's an autonomous AI with a per-battle temperament (Brave / Cautious / Showboat —
  the showboat taunts mid-fight; this is rarely wise).
- The horse-sized duck: pecks, telegraphed charge attacks (with a dust wake), leaping
  ground-stomps with an expanding shockwave, a counter-move when you mash it, and an
  enrage below 45% HP.
- The 100 duck-sized horses: flocking, circling, bite-rate coordination, periodic
  organized stampedes, and a "nothing left to lose" buff for the last 25.
- Knockdowns: a direct charge hit, a stomp, or 4 bites inside a second put Dave on the
  ground for a couple of seconds. He falls flat on his back, then plays his death animation in reverse
  to get back up, which is exactly as dignified as it sounds.
- Fighting-game juice: hit-stop, slow-mo kills, screen shake, impact rings, sparks,
  feather bursts, squash-and-stretch, damage numbers, "POW! / WHAM! / PENTA-PONY!!"
  announcer, battle drums that heat up with the fight, confetti, and a sad trombone.
- Nearly every sound is a real recording: two mallards (slowed to 0.3× with a sub-bass
  layer for the giant duck), three real whinnies in chipmunk register, a looping
  six-horse stampede recording under the horde, Kenney punch/kick/wood/body-slam
  impacts, real hoof scuffs, an actual sad trombone, and a US Air Force brass fanfare
  for victories. Synthesis covers only whooshes, quake sub-bass, and the battle drums.

## Asset credits

| Asset | Source | License |
|---|---|---|
| Dave (`models/Dave.glb`, Modular Men "Casual") | [Quaternius](https://quaternius.com) | CC0 |
| Dave's animations (`models/DaveAnims.glb`, Cyberpunk pack character) | [Quaternius](https://quaternius.com) | CC0 |
| Horse (`models/Horse.glb`) | [three.js examples](https://github.com/mrdoob/three.js) (from ro.me) | MIT / CC-BY |
| Duck (`models/Duck.glb`) | [Khronos glTF Sample Models](https://github.com/KhronosGroup/glTF-Sample-Models) | SCEA Shared Source 1.0 |
| Quack (`sounds/quack.mp3`) | [Wikimedia Commons — Mallard XC62258](https://commons.wikimedia.org/wiki/File:Anas_platyrhynchos_-_Mallard_XC62258.mp3) by Jonathon Jongsma | CC BY-SA 3.0 |
| Impact sounds (`sounds/kenney/impact_*.ogg` — punches, kicks, wood, body-slams, bites, hoof scuffs) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 |
| UI click/hover (`sounds/kenney/click1.wav`, `rollover1.wav`) | [Kenney — UI Audio](https://kenney.nl/assets/ui-audio) | CC0 |
| Second quack (`sounds/quack2.ogg`) | [Wikimedia Commons — Mallard (W1CDR0001518 BD17)](https://commons.wikimedia.org/wiki/File:Mallard_(Anas_platyrhynchos)_(W1CDR0001518_BD17).ogg), British Library | CC BY-SA 4.0 |
| Stampede loop (`sounds/gallop.ogg`) | [Wikimedia Commons — Six Horses Galloping By](https://commons.wikimedia.org/wiki/File:Six_Horses_Galloping_By.ogg) | CC0 |
| Sad trombone (`sounds/trombone.ogg`) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sad_Trombone-Joe_Lamb-665429450.ogg) by Joe Lamb | CC BY 3.0 |
| Victory fanfare (`sounds/fanfare.mp3`) | [Wikimedia Commons — USAF Heritage of America Band](https://commons.wikimedia.org/wiki/File:Ceremonial_Fanfare_-_Concert_Band_-_United_States_Air_Force_Heritage_of_America_Band.mp3) | Public domain |
| Whinny (`sounds/whinny.ogg`) | [Wikimedia Commons — Wiehern.ogg](https://commons.wikimedia.org/wiki/File:Wiehern.ogg) | Public domain |
| Whinnies 2 & 3 (`sounds/whinny2.oga`, `whinny3.oga`) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Mares-Prefer-the-Voices-of-Highly-Fertile-Stallions-pone.0118468.s002.oga) — Lemasson et al., *Mares Prefer the Voices of Highly Fertile Stallions*, PLOS ONE | CC BY 4.0 |
| Engine (`vendor/three.module.js` r166 + addons) | [three.js](https://threejs.org) | MIT |

Everything else (arena, particles, UI, drums, announcer) is generated in code.
