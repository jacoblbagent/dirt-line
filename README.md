# Dirt Line

A first-person trail-building sim: walk the woods at 6 ft, plan a jump line, then
actually dig it out of the ground. Real spoil volumes, real angle of repose, and
dirt that only stays where you pack it.

**🔗 Live:** https://jacoblbagent.github.io/dirt-line/ (GitHub Pages)
**Local:** `python3 -m http.server 5187` in this directory → http://localhost:5187/
(tailnet: http://jlb-hermes.tail1caa84.ts.net:5187)

![Jump line under construction](docs/screenshot-line.png)

Modelled on real build photos: tall woodland with a canopy overhead, pine-needle
and leaf litter underfoot, moss, fallen logs, fractured boulders — and the gear
that piles up at the edge of a dig (buckets, cooler, jug, trash bag, stacked
planks, tools left standing in the dirt).

![Staging area at the edge of the dirt zone](docs/screenshot-staging.png)

The riding surface is packed clay and reads noticeably lighter and smoother than
the dark loose spoil around it, because that's exactly what the soil model is
doing — packed cells are pale and firm, freshly dug or poured cells are dark and
about to slump.

![Packed lip face under the flat head](docs/screenshot-flathead.png)

## Models — every visible object is real geometry

Nothing in the game is a box, sphere, cylinder, cone or plane. Every object is
built procedurally from a geometry toolkit (`js/geo.js`): lofts through shaped
cross-sections, tapered tubes swept along curves with parallel-transport frames,
lathed profiles, and beveled extruded plates — then merged per material so a whole
object costs one draw call per material it uses.

| Object | How it's built |
|---|---|
| Spade | lathed shaft, D-grip from three swept tubes, forged socket with a rivet, arc-profile blade shell with real thickness, rolled top edge |
| Flat head | wide arc-profile blade with side bevels and a drawn edge, long orange socket with pressed step shoulders, knurled knob top |
| Pick axe | forged eye, tapered curving spike, chisel end, wedge in the eye, swelling shaft |
| Rake | bowed head bar, 12 tapered tines with forged bends, orange socket |
| Gloved hand | lofted palm that tapers from a slim wrist, four fingers swept 180° around the shaft, thumb over the top, knuckle pads, flared fabric cuff |
| Wheelbarrow | lofted tray with a rolled rim and pressed ribs, wooden handles with rubber grips, steel legs and fork braces, tire with tread lugs, dish rim, hub, six spokes, axle and hex nuts |
| Bucket | lathed vessel (outer wall, rim roll and inner wall) with ribs, bail handle with flattened ears, spoil inside |
| Cooler | lofted body with a lid seam, latches, hinges, moulded handle, drain plug |
| Water jug | lathed body with shoulder and ribs, ribbed cap, arch handle |
| Trash bag | crinkled lofted bag, cinched tie, knotted ears |
| Planks | lofted with a cup and chamfered, tapered ends, nail-hole dimples, splintered broken ends |
| Trees | 14 unique variants generated per world: trunk lofted with root flare and bark ridges, recursive tapered limbs, needle sprays (conifer) or folded leaf clusters (broadleaf), spread crowns, bare dead snags with splintered breaks |
| Rocks | lofted and displaced, sheared against two random fracture planes, faceted, with strata banding and moss on upward faces |
| Logs / stumps | curved knot-bulged trunks, sawn end grain with growth rings, splintered torn ends, branch stubs; stumps with a flared base, exposed roots and a cut top |
| Plan volumes | lofted from the intended jump profile — take-off face, tabletop, roller curve, landing slope, banked berm or bowl — so the guide shows the shape you're aiming for |

The model gallery (`tests/gallery.html`) renders every model in isolation with a
per-object vertex/NaN report, and is what the screenshots above were taken from.

![Tools](docs/screenshot-tools.png)

![Props](docs/screenshot-props.png)

![Trees](docs/screenshot-trees.png)

## What you do

1. **Plan the line first** — `P` opens an overhead plan view. Click the ground to
   drop lips, landings, rollers, tables, berms and dirt holes. Wheel = radius,
   `Shift`+wheel = height, `Q`/`R` = take-off heading, `RMB` deletes.
2. **Dig** — spade for soft ground, pick axe for hard or already-packed ground
   (it also loosens soil so later digging goes easier). Dirt leaves the ground:
   the hole you dig *is* the dirt you build with (in-situ volume, 25% bulking).
3. **Haul** — spoil goes in your hands (160 L) or gets shovelled into the
   wheelbarrow (`B` places it, 400 L). Digging next to the barrow loads it.
4. **Place** — `E` toggles PLACE DIRT. The dump radius is fully yours: wheel from
   a 3.2 m blanket down to a 0.15 m pinch. `LMB` pours, `RMB` trickles, `Shift`
   feathers it even finer. Aim at a jump and it lands on the jump.
5. **Pack** — poured dirt is *loose*: it slumps under gravity to its angle of
   repose (~38°) and keeps falling until it stops. Slap it flat with the flat head
   (preferred) or the back of the spade and it holds 60°+. Firm ground is pale and
   dry-looking; loose spoil is dark and muddy.
6. **Shave** — `Shift`+`LMB` with the flat head takes a clean flat cut off a lip or
   a landing face: a thin, even plane of dirt for precise adjustment.
7. **Rake** — levels and grooms, dragging high spots into hollows.

## Controls

| Key | Action |
|---|---|
| `W A S D` | walk (`Shift` run, `Ctrl` crouch, `Space` hop) |
| mouse | look (click once to lock the pointer) |
| `1 2 3 4` | spade / flat head / pick axe / rake (`Q`,`R` cycle) |
| `LMB` / `RMB` | tool primary / secondary (dig·pack, slap·chip, groom·spread) |
| `Shift`+`LMB` | shave a flat face |
| wheel | brush size (or dump radius in place mode) |
| `E` | toggle PLACE DIRT |
| `B` | place / pick up / tip the wheelbarrow |
| `P` | plan mode · `Tab` plan sheet |
| `H` help · `M` map · `V` plan volumes · `K` save · `L` load |

## The dirt model

Each of the 65,536 (`257²`) heightfield cells at 0.5 m keeps:

- **height** — the shape,
- **packed** (0–255) — how firm the ground is. Sets the angle it can hold
  (`tan = 0.70 + packed/255 · 3.30`, i.e. ~38° loose → ~66° packed),
- **hardness** — natural resistance; the pick axe eats it, the spade struggles in it,
- **settle** — metres already compacted out, so slapping a face a hundred times
  firms it without slowly flattening the jump you just built,
- **mark** — which tool last worked the cell, painted onto the ground texture
  (flat-head sheen, spade ridges, rake grooves, pick-axe pocks).

A cellular-automaton slump runs every frame on a dirty-cell queue: any cell steeper
than its own repose passes material downhill, volume-conserving to ~1e-4 m³. That
one rule gives you cone-shaped spoil heaps, dirt that runs off an unfinished lip,
and faces that stay exactly where you packed them.

## Running it

```bash
cd ~/Code/dirt-jumps
python3 -m http.server 5187        # ES modules need HTTP, not file://
```

No build step, no CDN: `three.module.js` (r160) is vendored locally. Save/load is
localStorage (`K` / `L`). `New world` on the title screen reseeds the procedural
terrain — rolling forest floor, a clear dirt zone for lines, scattered trees that
keep out of the way of the zone.

## Layout

```
index.html          HUD + overlays, error catcher, three.js module shim
style.css           HUD/overlay chrome
js/config.js        world + soil constants
js/noise.js         value noise / FBM
js/terrain.js       heightfield, soil state, brushes, slumping, surface texture
js/tools.js         tool definitions + first-person tool models and swing
js/player.js        first-person controller, aim ray-march, work loop, barrow
js/plan.js          plan features, ghost guides, progress, minimap
js/geo.js           geometry toolkit: lofts, tubes, lathes, beveled plates, merge
js/materials.js     shared vertex-coloured material set
js/models-tools.js  spade, flat head, pick axe, rake, gloved hand
js/models-props.js  wheelbarrow, bucket, cooler, jug, bag, planks, dirt heaps,
                    plan-feature profiles
js/models-plants.js trees (pine/broadleaf/birch/snag), rocks, logs, stumps
js/props.js         staging gear + fallen logs (scene dressing)
js/ui.js            HUD, plan sheet, plan-mode chrome
js/sfx.js           WebAudio foley (scrapes, tamps, pours, wind bed)
js/main.js          bootstrap, world build, input, main loop
```

## Verified

51/51 headless checks (Playwright + swiftshader Chromium) covering digging,
volume conservation, angle of repose, packing vs loose, shave, rake, tool
hardness bias, precision dump radius, plan round-trip and progress, player
locomotion at 1.83 m eye height, tree collision, barrow logistics, plan camera,
save/load, and the live render loop.

Budget: ~1.05 M triangles and 42 draw calls per frame for the whole world
(147 trees, 170 rocks, 34 logs/stumps, terrain, props, held tool), with 48
geometries resident. Run `tests/verify.js` against the served build; the headless
frame rate in those runs is software rasterisation and says nothing about real
hardware.
