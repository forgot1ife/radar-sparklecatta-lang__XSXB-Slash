# XSXB-Slash export spec (recipe v1)

This file is the contract between the web tool and any engine. If an engine port follows it, the trail looks like the web preview.

## 1. Bundle contents

| File | What | Sampler |
|---|---|---|
| `recipe.json` | layers and all parameters | — |
| `textures/shape.png` | main shape, stretched once along the strip; full strength right at U=0 (the blade), fades out on the other three borders | **Clamp**, linear (sRGB off), no mips needed |
| `textures/mask.png` | tileable mask / dissolve noise | **Repeat**, linear (sRGB off), mips on |
| `textures/highlight.png` | highlight streaks, same layout as shape | **Clamp**, linear (sRGB off) |
| `preview.png` | web preview at `preview.previewTimeS` | reference only |

All textures are greyscale; read the red channel.

## 2. Strip geometry

Each layer is one ribbon (triangle strip). Every frame (or at a fixed rate, the web tool uses 240 Hz) while the blade swings, record one **sample**:

- `tip` = world position of the blade tip
- `dir` = unit vector from hilt to tip
- `t` = time the sample was taken
- `dist` = metres the tip has travelled since this swing started (sum of tip-to-tip distances)

Drop samples older than `lifeS`. For each remaining sample, `age = (now - t) / lifeS` (0..1), and emit two vertices:

```
w     = widthM * (1 - taper * age)
inner = tip - dir * w        UV0 = (age, 0)   UV1 = (dist, u)
outer = tip                  UV0 = (age, 1)   UV1 = (dist, u)
u     = min(1, age / ageOldest)   // ageOldest = age of the first visible sample of this stroke (uvFill)
```

Between frames, add `substeps` samples on a curve, not on straight lines: spline the **hilt position** and the **blade vector** (`tip - hilt`) with Catmull-Rom / Hermite through the frame poses, renormalise the blade vector and scale it to the interpolated blade length. That keeps fast swings on their arc. The newest segment has no "next" pose yet: draw it with the chord as tangent and redraw it once the next frame arrives (no added latency). The reference scripts do all of this.

**Sample after the animation has been applied this frame** (Unity: `LateUpdate`; Unreal: tick group PostUpdateWork; Godot: `RenderingServer.frame_pre_draw`, because skeletons and BoneAttachment3D update after `_process`). Sampling earlier makes the trail lag one frame behind the blade.

**Only emit while attacking.** Every reference script has an `emitting` switch: turn it on in the attack's active window (animation event / notify) and off afterwards, otherwise wind-ups, recoveries and turns also leave trails and a combo looks messy. `minTipSpeed` is only a fallback.

**Frame rate.** Combo animations can move the tip 40–60 m/s, i.e. half a turn per frame at 30 fps; no interpolation can recover that. At 60+ fps the engine's own bone interpolation gives the true arc. If you must run low frame rates, sample the animation itself at sub-frame times (engine-specific).

Connect consecutive samples with two triangles. Start a new strip when a new swing starts (do not join swings). Render both faces (no culling), no depth write, depth test on.

**U = age, not normalised length.** Most built-in trail components (Unity TrailRenderer, Niagara ribbon by default) put U on length. That changes the look, because the shape window and the dissolve depend on age. Use the reference trail scripts in `engines/`, or override U with the particle's normalised age.

**Texture fill (`uvFill`, default on everywhere: web preview, Unity `fillTexture`, Godot `fill_texture`, Unreal `bFillTexture`):** shape/highlight lookups and the head fade use `u = age / ageOldest` (UV1.y), so the texture's dark tail always lands on the trail's end and a still-growing trail is never cut off hard. Dissolve, taper and the shape window keep using true `age`. Once a stroke is older than `lifeS` this equals plain age. Off = `u = age`.

## 3. Pixel shader (per layer)

```
inputs:  x = UV0.x (age 0..1), v = UV0.y (0 inner .. 1 outer), d = UV1.x (metres), u = UV1.y (filled U), time (s)
consts:  from recipe.constants (erodeBase -0.12, erodeAgePow 1.5, erodeInner 0.1,
         maskTileV 0.8, maskAgeDrift 0.15, detailGain 1.6, headSoft 0.005)

sv    = 1 - (1 - v) * (1 + windowNarrow * x)          // shape window narrows to the outer edge with age
shp   = sv < 0 ? 0 : SHAPE(u, sv)                      // SHAPE = shape / highlight / white, per shapeTexture
m     = MASK(d * maskTilePerM + time * maskPanPerS,  v * maskTileV + x * maskAgeDrift)
det   = lerp(1, m * detailGain, maskAmount)
thr   = erodeBase + pow(x, erodeAgePow) * erodeSpeed + (1 - v) * erodeInner
mg    = m - thr
keep  = saturate(mg * erodeSharp)                      // dissolve
edge  = saturate(1 - mg / max(edgeWidth, 1e-3)) * keep // band at the dissolve edge
hl    = sv < 0 ? 0 : HIGHLIGHT(u, sv)
a     = saturate(shp * det * keep * alpha * smoothstep(0, headSoft, u))
rgb   = color * hdr + edgeColor * edge * edgeGlow + highlightColor * hl * highlight

blend "alpha":    out = (rgb, a)          src*a + dst*(1-a)
blend "additive": out = (rgb * a, 1)      src + dst
```

Texture lookups with the strip V:

- `SHAPE(u, sv)` / `HIGHLIGHT(u, sv)`: the PNG's **top row is the outer edge**. In engines whose UV origin is top-left (Unreal, Godot) sample at `(u, 1 - sv)`. In Unity (bottom-left origin) sample at `(u, sv)`.
- `MASK` is tileable; orientation does not matter.

Colours in `recipe.json` (`color`, `edgeColor`, `highlightColor`) are **linear** RGB. Feed them to the shader as-is (do not convert again). `colorHex` is only the sRGB picker value.

HDR: `hdr` multiplies `color`. Values above 1 bloom only if the engine has bloom with a threshold near 1 (the web preview: bloom threshold 1).

## 4. Layers

`recipe.layers` is ordered back to front. Draw each later layer on top (Unity: increasing `renderQueue`; Godot: increasing `render_priority`; Unreal: increasing Translucency Sort Priority).

| key | unit | meaning |
|---|---|---|
| `blend` | alpha / additive | blend mode |
| `color`, `alpha`, `hdr` | linear RGB, 0..1, × | body colour, opacity, brightness multiplier |
| `widthM`, `taper` | m, 0..1 | strip width at age 0; width shrinks by `taper` at age 1 |
| `lifeS` | s | sample lifetime |
| `windowNarrow` | — | how fast the shape window shrinks to the outer edge |
| `shapeTexture` | shape / highlight / white | which texture is SHAPE |
| `maskAmount`, `maskTilePerM`, `maskPanPerS` | 0..1, tiles/m, tiles/s | detail strength, tiling, scroll |
| `erodeSpeed`, `erodeSharp` | — | dissolve speed over age, edge hardness |
| `edgeWidth`, `edgeGlow`, `edgeColor` | —, ×, linear RGB | dissolve edge band |
| `highlight`, `highlightColor` | ×, linear RGB | highlight texture strength / colour |

## 4b. Preview-only fields (added in the v10 tool, same recipe version)

These are extra keys; the v1 engine ports ignore them and still draw the ribbon layers exactly as before.

- `layers[].turbulence {amount, tilePerM}`: detail wobble. In the preview: `n = noise(dist*tilePerM + time*0.5, V*1.7 + age*0.4) - 0.5; sv += n*amount; U += n*amount*0.3` before the shape lookup.
- `layers[].ageColor {color, amount}`: `col = mix(color, ageColor.color, smoothstep(0.2, 0.95, age) * amount)`.
- `fx.refraction[]`: screen-space distortion under a trail-shaped mask. `shape` = `wave` (sin/cos field), `ring` (rings spreading from the pivot), `ripple` (v12: water ripples, see below) or `mix` (0.6 × wave + 0.8 × ripple); `strengthPx720` = offset in pixels at 720p. These layers are not in `layers`.
  - `ripple`: screen space in 720p pixels `px`. Seeds on a 110 px grid, each jittered by `h = hash2(cell)` to `(cell + 0.15 + 0.7h) * 110`. For the 3×3 cells around `px`: `ph = fract(time*0.9 + h.x*7.13 + h.y*3.7)`, `rad = ph*160`, `e = px - seed`, `q = (|e| - rad)/24`; `offset += sin((|e| - rad)*0.19) * exp(-q²) * (1 - ph) * e/|e|`. Total `offset * 16 * 1.6 * amount`. `time` = sim time.
- `fx.sparks / fx.drops / fx.smoke`: particle settings (count per swing, colour, size, speed). The smoke flipbook is `assets/smoke_sheet_2048.png` (16x16 cells = 8 variants x 32 frames; RGB = shade, A = mask).
  - v12 `style` (missing = the original look): sparks `burst` (fast short radial streaks, strong drag), `ember` (slow rising dots that flicker), `twinkle` (dots that stay near the blade path and blink); smoke `rise` (climbs, grows ×1.35), `ground` (sinks to the floor and spreads), `wisp` (stays where it was born, small, lives ×1.4); drops `spray` (thrown along the swing), `drip` (hangs 0.12–0.47 s, then falls straight down), `mist` (×2.5 count, tiny, light gravity, short life).
- Texture styles (v12) are baked into the exported PNGs, so the recipe and engine shaders do not change: shape/highlight `crescent`, `feather`, `flame`, `brush`, `double`; mask `ripple`, `bolt`, `fiber`, `pixel`, `wave`, `scale` (all tileable).
- `preview.bladeLengthM / hiltOffsetM` now follow the loaded weapon (glb); `widthM` already includes the weapon's width scale.

## 4c. Finish: how a stroke ends (`recipe.finish`, added 2026-11-25, same recipe version)

Without it, when the attack window closes the newest end of the trail (at the weapon) is a straight, hard cut that stays on screen while the trail ages. Missing `finish` = all off (old look). All three parts are optional and independent; the reference scripts in `engines/` implement them.

**Tail-out** `finish.tailOut {on, durationS}` (default 0.08 s): when emitting turns off (attack window ends), keep sampling the blade for `durationS` more. Each sample stores `f = 0.5 + 0.5*cos(pi * clamp((t - tEnd) / durationS, 0, 1))`, `tEnd` = time of the last sample inside the window (`f = 1` before). **Alpha** is multiplied by `f`; the width is not changed. Hit detection is not touched.

**Head cut** `finish.headCut {on, lengthM, rampS, ragged, blurLod, extraSoftness, fade, noiseTileX, tailTip}`: per stroke, `H` = its newest sample.

```
k   = saturate((now - H.t - one sample interval) / rampS)          // 0 while the stroke still grows, then ramps in (0.04 s)
hr  = k * (1 - smoothstep(0, 1, (H.dist - dist) / lengthM))          // 1 at the head, 0 after lengthM metres
hr  = max(hr, 1 - f)                                                // the tail-out part counts as head
alphaMul = f * (1 - fade * hr)
width   *= smoothstep(0, 1, (1 - u) / tailTip)    only if tailTip > 0 (u = filled U; narrows the OLD end, never the head)
```

**Dissolve** `finish.dissolve {on, start, softness, headAmount = headCut.ragged, edgeGlow, edgeWidth, edgeColor}`:

```
p  = max(dissolve.on ? saturate((age - start) / (1 - start)) : 0,  headCut.on ? ragged * hr : 0)
```

Per vertex pass `(alphaMul, p, hr)` (Unreal UV2, Godot COLOR.rgb, Unity TEXCOORD2). In the pixel shader, after `a` is computed:

```
a *= alphaMul
if (p > 0):
    h  = softness + hr * extraSoftness
    n  = MASK(d * maskTilePerM * noiseTileX + maskOffset.x,  v * 0.8 + maskOffset.y,  mip bias = hr * blurLod)   // no pan: the holes grow in place
    q  = n + 2p - 1
    dz = smoothstep(saturate(p - h), saturate(p + h), q)            // 0 = kept, 1 = gone; p = 1 removes everything
    de = smoothstep(p - h - edgeWidth, p - h, q) * (1 - dz) * saturate(8p)
    a *= 1 - dz
    rgb += edgeColor * de * edgeGlow
```

The head therefore ends in a ragged, locally blurred (mip bias + wider smoothstep) and fainter edge instead of a straight line, and the width stays the same. Tool defaults: tail-out 0.08 s; head cut 0.22 m, ramp 0.04 s, ragged 0.85, blur 2.5, extra softness 0.18, fade 0.5, noise tile ×2.5, tailTip 0; dissolve start 0.4, softness 0.12, edge glow 0.

## 5. Self-check (do this after every port)

1. Set the debug mode in the reference shader to **1** (red = texture U: filled U `UV1.y`, or age when fill is off; green = V). Swing once:
   - at the blade the strip is **black/green** (age 0), the tail end is red;
   - the **outer** edge (tip path) is green, the inner edge is dark.
   If green is on the inner side, V is flipped. If the tail is black, U is flipped.
2. Debug mode **2** shows `frac(dist)`: stripes must stay fixed in the world while the strip ages (they must not slide).
3. Debug mode **0**: compare one frame with `preview.png` (same background colour, bloom threshold ~1).
4. Check that textures are imported **without sRGB** and with the right wrap mode (shape/highlight clamp, mask repeat). A shape with sRGB on looks too thin and too dark.
