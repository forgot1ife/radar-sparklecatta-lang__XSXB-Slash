# XSXB-Slash · 格挡 (parry) recipe spec — `xsxb-parry` v1

The 格挡 tab exports a zip: `recipe.json` + `textures/*.png` + `audio/parry_{normal,perfect}.wav` + `preview.png`.
This document is what an engine port (Godot 4 / Unity / Unreal Engine 5, or a coding agent with the `xsxb-slash-install` skill) needs to rebuild the exact visual & acoustic clash.

Units: metres, seconds, **linear** RGB colours with a separate HDR multiplier. All textures are linear grey masks (turn sRGB off). Audio files are 48 kHz 16-bit stereo PCM WAVs.

## 1. Two Tiers (`normal` vs `perfect`) & Item Priority

Only **two tiers** exist in UI and exported bundles: **`normal` (普通格挡)** and **`perfect` (精防)**:
- **🎲 Linked Random Mode (`manualSplit == false`)**: Rolling 🎲 (or `Space`) generates `tiers.normal` and `tiers.perfect` together with automatic progressive escalation (`normal < perfect` across star size/HDR, light intensity/glow, flash needles, ~1.45× spark count/speed, escalation layers `ribbon` + `smoke` + `debris` + `refraction` active on `perfect`, and heavier/more sonorous `sfx` on `perfect`).
- **✋ Independent Manual Mode (`manualSplit == true`)**: Adjusting any parameter manually modifies **only** the currently selected tier (`normal` or `perfect`), keeping both tiers saved independently inside `recipe.tiers.{normal, perfect}`.

| order | item | recipe key | what it is | time |
|---|---|---|---|---|
| 1 | 星芒 star | `star` | camera-facing HDR pinpoint + asymmetric razor rays (`ZTest Always`, Additive) | 0–0.16 s |
| 2 | 打光 light | `light` | standalone transient 3D `PointLight` + soft gaussian atmospheric `glow` (works even if `star` is off) | 0–0.45 s |
| 3 | 闪光 circular flash | `flash` | camera-facing circular shock-sphere / ripple / halo / corona / nebula / shatter (`One, OneMinusSrcAlpha`, `opacity`, `blur`, `hollow`) | 0–0.35 s |
| 4 | 火星 sparks | `sparks` | 240 Hz 3-tier ballistic simulation: burst needles, floor-bouncing arc sparks, `0.3333` alpha-clipped embers | 0–1.7 s |
| 5 | 拖尾丝 ribbons | `ribbon` | 6 distinct leader-spark flight styles (`whip`, `sphereScatter`, `bladeSlide`, `deflectCone`, `vortexWrap`, `groundSkim`) | 0–1.3 s |
| 6 | 暗烟 / 碎屑 | `smoke`, `debris` | FBM-dissolving translucent dark ink puffs + dark sparks; lit spinning metallic iron shards | 0–1.7 s |
| 7 | 热浪 refraction | `refraction` | screen-space UV offset ring/bulge; adds **zero colour** | 0–0.4 s |
| 8 | 音效 sfx | `sfx` | 3-bar combat metallic clash (`grade` 1..10, `weight` 0..1, `resonance` 0..1) peak-aligned to `T0` | 0–1.8 s |

## 2. Frame & Choreography

`frame` gives the effect's local frame: origin = clash point `(0, 1.1, 0)`, +Y = world up, +Z = foreground (towards camera).
- **Left Defender (`bladeA`) vs Right Attacker (`bladeB`)** (`clash.pose`: `'cross'` default | `'lunge'` | `'hang'`):
  - **`cross` (default)**: Both fighters hold hilts below `C` at chest/waist height (`hiltA ≈ (-0.14, 0.90, +0.04)` lower-left, `hiltB ≈ (+0.15, 0.89, -0.04)` lower-right) and cross at the forte (`dA = 0.25 m, dB = 0.26 m`) so ~`0.76 m` of curved katana blades soar upward in a dramatic `✕`.
  - **`lunge`**: Steep upward-right guard `/` vs lunging upward-left cleave `\`.
  - **`hang`**: High upper-left hanging guard angled down-right catching Right Attacker's upward-left blade.
- `sprayMain` / `spraySecondary` are the spark lobe axes; `floorY` is the floor height relative to the clash point (default −1.1 m).
- `clash.hitstopS` = weapon freeze window; `clash.tremor` = 44 Hz blade ringing; `clash.shake` = camera shake `0.006 m * shake * exp(-t/0.06)`. Effects run on real time (never frozen by hit-stop).

## 3. Layers (t = seconds since contact)

**star** — billboard at `C + toCam * 0.06 m`, additive, no depth test.
`gain = hdr * smoothstep(0,0.012,t) * exp(-t/(life*0.38))`, cut at `1.8*life`;
`size = sizeM * (0.5 + 0.5*smoothstep(0,0.02,t)) * (1 + 0.35*t/life)`;
colour `mix(edge, core, smoothstep(0.25,0.9,mask)) * pow(mask, contrastPow) * gain` (`textures/star.png`, or `textures/star_normal.png` when `normal` uses a distinct star mask).

**light** (standalone, independent of `star.enabled`) — transient 3D `PointLight` at `C + toCam * offsetTowardsCamM`, attenuation radius `rangeM`, colour `lerp(color, white, 0.32)`, `intensity * smoothstep(0,0.012,t) * exp(-t/decayS)`; plus soft zero-edge gaussian `glow` billboard (`exp(-9 r²)`, diameter `(1.65 + 1.1*amount) * sizeMul`, gain `(0.16 + 0.34*amount) * smoothstep(0,0.012,t) * exp(-t/(decayS*1.95))`).

**flash** (circular-base impact flash) — camera-facing quad at `C + toCam * 0.035 m`, premultiplied hybrid blend (`One, OneMinusSrcAlpha`), no depth test, `renderOrder = 4` (under sparks & star).
Samples `textures/flash.png` (`256×256` circular linear mask, or `textures/flash_normal.png` when `normal` uses a distinct mask; 6 procedural styles `sphere` | `ripple` | `halo` | `corona` | `nebula` | `shatter`, 4 built-ins, or custom circular mask):
`fade = smoothstep(0, 0.008, t) * (1 - t/(1.75*lifeS))^1.35`, `scale = sizeM * lerp(max(0.2, 1 - 0.55*expand), 1 + 0.45*expand, 1 - exp(-t/max(0.014, 0.42*lifeS)))`,
`edgeEnv = smoothstep(1.0, 1.0 - max(0.02, blur*0.92), r)`, `inEnv = hollow > 0.001 ? smoothstep(hollow*0.58, hollow*0.88 + 0.05, r) : 1.0`,
`m = clamp(mask * edgeEnv * inEnv, 0, 1)`, `op = clamp(opacity * fade, 0, 1)`, `a = clamp(m * op * 0.62, 0, 0.92)`, `rgb = mix(color, core, smoothstep(0.30, 0.90, mask*(1 - 0.40*r))) * m * op * (0.35 + hdr*0.22)`.

**sparks** — 240 Hz 3-tier ballistic integration (`burst`, `arc`, `ember`) with gravity, drag, floor bounce (`floorY`) & skitter friction, and blackbody cooling (`hot → mid → cool`, ember alpha-clipped at `< 0.3333` with ~18 % @ 34 Hz flicker).

**ribbon** — `leaders` camera-facing tapered additive strips (`widthM * k^0.8`, `trailS` history) with **6 flight styles** (`ribbon.style`):
1. `whip` (`狂舞飞丝`): high-speed curling leader sparks escaping above the spray cone (`curl` 2.5–5.5 rad/s).
2. `sphereScatter` (`护体球散射`): the protective sphere is **100 % invisible** (`S_ctr = C + u * (R + 0.04)`, `u = normalize(-0.99, -0.03, +0.02)`, radius `R = sphereRadiusM` in `0.15..0.75 m`, half-angle `maxAng = sphereConeDeg` in `15°..78°`). `leaders` continuous ribbon-spark rays enter as a tight backward beam from `C`, curve smoothly (`C¹` quadratic Bézier `C -> P_exit - 0.58 R d_out -> P_exit`) through the invisible sphere to `P_exit = S_ctr + R * d_out` (`d_out = cos(α) u + sin(α) rad`, `α ∈ [0, maxAng]`), and fan radially outward behind the Left Defender across the full `2 × maxAng` 3D cone without crossing.
3. `bladeSlide` (`贴刃流光`): streamers race along `bladeA` and `bladeB` out to both sword tips (`~0.75–0.79 m`), then whip tangentially off the tips with sharp curl.
4. `deflectCone` (`卸力扇面`): clean planar martial-arts shear fan across the deflection plane.
5. `vortexWrap` (`旋风缠刃`): helical corkscrew ribbons orbiting (`15–22 rad/s`) around the clash bisector axis.
6. `groundSkim` (`掠地火蛇`): streamers slam downward into `floorY` and skim horizontally across the ground in serpentine arcs.

**smoke & debris** — FBM-dissolving translucent dark puffs (`th: 0.12 → 0.95`, never an opaque disc) + `darkSparks`; spinning lit metallic splinters (`2.8 × 0.38 × 0.9`) with cooling orange tips.

**refraction** — screen-space UV offset (`ring`, `bulge`, `double`, or `textures/refraction.png` gradient) adding **zero colour**.

**sfx** (3-Bar Combat Audio + Frame-Exact `T0` Peak Sync) —
- Designed with 3 orthogonal controls rendered offline & live through identical WebAudio DSP:
  1. **Bar 1 `grade` (`1..10`)**: ordered weapon timbre (`#1` crisp rapier/single-hand sword → `#10` deep heavy warhammer).
  2. **Bar 2 `weight` (`0..1`)**: impact punch loudness, harmonic saturation drive, `80–220 Hz` chest-thump body EQ, and mass pitch (`1.06 → 0.92`).
  3. **Bar 3 `resonance` (`0..1`)**: sonorous loudness & ring (`2.6–4.4 kHz` metallic overtone sustain, stereo Haas width, bright early reflections + `0.14–1.45 s` hall reverb tail, and post-compressor makeup limiter).
- Exported as `audio/parry_normal.wav` and `audio/parry_perfect.wav` with sample-exact `peakOffsetS` (`argmax(|sample|) / sampleRate`) in `recipe.tiers.{normal,perfect}.sfx`:
  - **Pre-lead trigger (`leadS > 0`)**: start playback at `T_clash - peakOffsetS` (delay `max(0, leadS - peakOffsetS)`, seek `max(0, peakOffsetS - leadS)`) so the pre-transient scrape leads right into the acoustic peak at exact `T_clash`.
  - **Zero-lead instant trigger (`leadS == 0`)**: seek playback directly to `peakOffsetS` (`AudioStreamPlayer3D.play(peakOffsetS)` / `audioSource.time = peakOffsetS` / `AudioComp->Play(PeakOffsetS)`) so the waveform peak lands on **Frame 0** with zero attack lag.

## 4. Recording API

`index.html?rec=1&mode=parry&w=1280&h=720` → `window.BTG_parryRec`:
`reset()`, `tier('normal' | 'perfect', scheme)`, `set(patch)`, `params`, `seek(tInCycle, cycle=0)` (contact at `T0 = 0.42 s`, cycle `1.9 s`),
`cam(pos, target, fov)`, `opts({stageTheme: 'klein' | 'dark', bg, gridAlpha, bloom, exposure})`, `recipe()`, `texData(override?)`, `project([x,y,z])`, `loadWeapon(url, flip)`, `defaultWeapon()`.
Same parameters + same `t` → identical pixels.
