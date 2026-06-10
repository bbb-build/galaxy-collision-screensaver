# Galaxy Collision Screensaver

**Live demo: https://bbb-build.github.io/galaxy-collision-screensaver/**

A real-time N-body simulation of two galaxies colliding and merging, rendered to
look like NASA/Hubble photography. Ships as a single self-contained HTML file —
no build step, no dependencies, no server. Open it in a browser and a new,
randomly generated encounter begins; when the merger remnant settles, the scene
fades out and another encounter starts. It is designed to run forever as a
screensaver.

Reference imagery used as the visual target: M51 (Whirlpool), NGC 4038/4039
(Antennae), and NGC 4676 (Mice) — see `verify/ref-*.jpg`.

## Contents

| Path | Description |
|---|---|
| `galaxy-collision.html` | The entire application (WebGL2, Canvas2D fallback) |
| `index.html` | Redirect to the above, for GitHub Pages |
| `verify/` | Node.js verification harness (physics regression, soak tests, CPU rendering, in-browser profiling) |

## Physics model

The simulation uses the **restricted N-body method** of Toomre & Toomre (1972),
the classic technique that first reproduced tidal tails and bridges:

- Each galaxy is a softened point-mass core plus a rotating disk of **60,000
  test particles** (stars). Cores attract each other and every star; stars are
  massless and do not attract anything. This is what makes 60k particles
  tractable in real time on a single thread.
- Core orbits decay via a **dynamical friction** term (strongest near
  pericenter, ramping up after `t > 70` as a safety valve), so the galaxies
  sink together over several passes and merge.
- Integration uses **adaptive substepping**: a coarse step while the cores are
  far apart (`separation > 2.4`), refined to `h ≤ 0.004–0.012` during close
  encounters and fast-forward, keeping pericenter passages accurate.
- Simulation time advances **proportionally to wall-clock time** (smoothed with
  an EMA of frame dt), not per-frame — otherwise frame-rate jitter shows up as
  visible speed jitter in the motion.

Despite the simplification, the model reproduces the signature features of real
interacting galaxies: long **tidal tails** flung outward and a **bridge** of
stars connecting the two disks. For the calibration encounter, 40–43% of disk
stars end up in tails and 20–25% in the bridge (see *Verification* below).

## Randomized encounters

Every run draws a new set of encounter parameters, so no two collisions look
alike:

| Parameter | Range | Effect |
|---|---|---|
| `massRatio` | 0.3 – 1.0 | Equal-mass merger vs. minor merger |
| `rp` (pericenter distance) | 0.75 – 1.9 | Head-on plunge vs. grazing pass |
| `e` (eccentricity) | 0.90 – 1.0 | Bound orbit vs. near-parabolic flyby |
| `fric` (friction coefficient) | 0.16 – 0.30 | How quickly the orbit decays |
| `inc`, `node` per disk | random | Disk orientation — dramatically changes tail shapes |
| `spin` per disk | 60% prograde / 40% retrograde | Retrograde passes suppress tails |

Star positions and velocities within each disk (spiral-arm placement, bulge,
velocity dispersion) are also randomized per run.

## Rendering pipeline

A deferred, HDR-ish pipeline tuned against Hubble reference photos:

- **Star/gas split**: only intrinsically bright stars (`propX ≥ 1.0`) are drawn
  as sharp points; dim stars contribute only to a soft "gas" medium. Drawing
  every star as a point produces sand-grain noise — the single biggest visual
  lesson of this project.
- **Gas buffer at 1/3 resolution** (`GAS_RES = 3`, auto-degrading to 4 under
  load) with per-channel filmic tone mapping, knee at 0.35 to keep galaxy cores
  from clipping to white.
- **Dust lanes**: opacity (τ) is *accumulated* into a buffer and applied as
  multiplicative absorption `exp(-τ · (0.50, 0.75, 1.05))` at develop time,
  giving the red-brown dark lanes of real photos. (Subtractive dust simply
  vanishes inside HDR compression — it must be multiplicative.)
- **HII regions**: red star-forming knots `(1.0, 0.34, 0.30)` whose intensity
  scales ×2.2 with the starburst triggered by the collision. Rendered with
  exactly the same point geometry as white stars.
- **Depth-of-field portrait effect**: foreground red gas blurs while the
  galaxies stay in focus — an accident of depth dimming plus the low-resolution
  gas buffer that proved worth keeping.
- **Auto quality** (`AUTO_Q`): frame-time hysteresis (24 ms / 12 ms, 300-frame
  cooldown) switches gas resolution; switching is frozen during fast-forward.

## Post-merger choreography

A merger remnant never "freezes" — physically it oscillates around equilibrium
(±6%) forever. So the ending is staged:

1. **Turmoil** — the merger proper, at normal speed.
2. **Fast-forward** — up to ×7 (`WARP`), implemented by taking more physics
   substeps per frame (`h ≤ 0.012`), so accuracy is preserved; speed changes
   are exponential ramps only.
3. **Convergence gate** — the 80th-percentile star radius (computed over ~800
   strided samples; small samples make quantiles too noisy) must change less
   than 15% over 12 sim-time units.
4. **Slow-down and savor** — `SAVOR_S = 30` seconds at normal speed, camera
   blending gently toward the remnant.
5. **Fade out**, then a fresh encounter begins. `RELAX_S = 240` s is the hard
   safety ceiling for the whole phase.

The camera is driven by percentile radii of the star distribution (p80 while
debris is flying, p55 once settled) with rate limits (zoom ≤ 8%/s) so it never
lurches.

## Verification harness (`verify/`)

The physics and the look are both guarded by scripts (Node.js; the only
dependency is `pngjs`):

```sh
cd verify && npm install

node harness.js        # physics regression against the calibration encounter
node soak.js           # randomized-encounter soak test (no NaNs, no blowups)
node preview.js        # CPU re-implementation renders PNGs (preview-*.png)
node browser-check.js  # headless Edge via CDP: real renderer + fps measurement
node relax-timeline.js # post-merger timeline validation
node settle-profile.js # remnant settling profile
node step-cost.js      # measured cost of one physics step
```

### Calibration encounter (regression baseline)

For `massRatio = 0.7, rp = 1.3, e = 1.0`, all within ±1%:

| Event | Value |
|---|---|
| First pericenter | d = 1.2929 at t = 5.096 |
| First apocenter | d = 4.4708 at t = 16.480 |
| Merger | t = 36.864 |
| Tail fraction | 40 – 43% |
| Bridge fraction | 20 – 25% |

Tail/bridge metrics classify disk stars displaced > 1.0 from their own core,
within the inter-core span. The bridge metric has realization variance σ ≈ 2
and can straddle the upper bound — the working rule is two consecutive passing
runs.

`verify/extracted.js` is the simulation core extracted from the HTML so the
harness can run it under Node; `preview-*.png` are rendered snapshots of the
calibration encounter at key moments.

## Performance notes

- One physics step costs ~0.76 ms at N = 60,000, so even ×7 fast-forward stays
  under ~4 ms of physics per frame.
- The star buffer's full-screen afterglow decay pass was replaced with a plain
  clear — a large GPU saving at 4K that also sharpened the stars.
- Per-frame allocations were eliminated (module-scope scratch buffers,
  `Float32Array` + `TypedArray.sort` for quantiles) to avoid GC micro-pauses.
- If residual stutter ever returns, the next step is moving physics to a Web
  Worker.

## Design principles learned along the way

- No fixed twinkling background stars — they distract from the motion.
- Star points must stay tight; any blur reads as low quality.
- Pattern variety across mergers matters as much as any single render.
- "Looks physically plausible" and "looks like a NASA photo" are different
  targets; the verification harness pins the former so the latter can be
  iterated freely.
