---
name: xsxb-slash-install
description: Install a XSXB-Slash export (recipe.json + textures/*.png + audio/*.wav) as a sword / weapon slash trail ("XSXB-Slash-recipe") or dual-tier parry impact burst + SFX ("xsxb-parry") in Unity, Godot 4 or Unreal Engine 5. Use when the user has a XSXB-Slash or XSXB-Parry zip or folder and wants it working in their game project.
---

# Install XSXB-Slash Trails & Parry Bursts

Exports from XSXB-Slash are engine-neutral (`metres`, `seconds`, **linear** RGB colours + separate HDR multipliers, linear greyscale masks with sRGB OFF, and 48 kHz 16-bit stereo PCM WAV clash audio). Inspect `recipe.json` first to check which bundle type you have:
- **`format == "XSXB-Slash-recipe"` (`version == 1`)** → **Weapon Slash Trail** (`docs/SPEC.md`).
- **`format == "xsxb-parry"` (`version == 1`)** → **Parry Impact Burst + Clash SFX** (`docs/SPEC_PARRY.md`).

Do not invent ad-hoc shaders or giant opaque billboards: use the exact reference files in `engines/<engine>/`.

---

## Part A · Weapon Slash Trail (`format == "XSXB-Slash-recipe"`)

### 1. Import textures (all engines)
- `textures/shape.png`, `textures/highlight.png`: **sRGB OFF**, Wrap **Clamp**.
- `textures/mask.png`: **sRGB OFF**, Wrap **Repeat**.

### 2. Engine setup
- **Godot 4**: Copy `engines/godot/xsxb_slash_trail*` into `res://addons/xsxb_slash/`. Add `XsxbSlashTrail` (`xsxb_slash_trail.gd`), set `recipe_path`, two `Node3D` markers `hilt` and `tip` on the blade, and the 3 textures. Enable `WorldEnvironment` Glow (`HDR threshold ≈ 1.0`).
- **Unity (Built-in / URP)**: Copy `engines/unity/XsxbSlashTrail.shader` and `XsxbSlashTrail.cs` into `Assets/XsxbSlash/`. Ensure Linear Color Space. Add `XsxbSlashTrail`, assign `recipe` (`TextAsset`), `hilt`, `tip`, the 3 textures, and shader `XSXB-Slash/Layer`.
- **Unreal Engine 5**: Copy `engines/unreal/XsxbSlashTrailComponent.h/.cpp` into a C++ module (`"ProceduralMeshComponent", "Json"` in `Build.cs`). Build one Translucent and one Additive Unlit Two-Sided material using a Custom node containing `XsxbSlashLayer.hlsl`. Attach `UXsxbSlashTrailComponent` to the weapon mesh and set `HiltSocket`, `TipSocket`, `RecipeFile`, textures, and materials.

### 3. Verify & Swap
- Run `docs/SPEC.md` §5 self-check (`debugMode = 1` UV orientation, `debugMode = 2` world-locked stripes, `debugMode = 0` vs `preview.png`).
- To switch to a new trail later: overwrite only `recipe.json` and `textures/{shape,mask,highlight}.png` keeping sRGB OFF and Clamp/Repeat intact.

---

## Part B · Parry Impact Burst + SFX (`format == "xsxb-parry"`, `version == 1`)

### 1. Bundle contents, two tiers (`normal` / `perfect`), texture & audio rules (`docs/SPEC_PARRY.md`)
- Bundle contains `recipe.json` (with `tiers.normal` and `tiers.perfect`), `preview.png`, `textures/{star[,star_normal],spark,flash[,flash_normal],smoke[,refraction]}.png`, and `audio/parry_{normal,perfect}.wav`.
- **All textures are linear grey masks**: turn **sRGB OFF** (`TC_Masks` / linear).
- Wrap mode: `smoke.png` = **Repeat** (unless radial mask, which the runtimes auto-detect); `star*.png`, `spark.png` (top = head), `flash*.png`, `refraction.png` = **Clamp**.
- **Two tiers only**: `normal` (**普通格挡**) and `perfect` (**精防**).
- Layer & SFX architecture:
  1. `star`: camera-facing HDR pinpoint + asymmetric razor rays (`ZTest Always`, Additive).
  2. `light` (standalone): independent transient 3D `PointLight` (`rangeM`, `offsetTowardsCamM`, `decayS`) + soft gaussian `glow` billboard (fires even if `star` is disabled).
  3. `flash`: circular-base camera-facing impact flash (`sphere`, `ripple`, `halo`, `corona`, `nebula`, `shatter`, built-in masks, or custom circular mask; `256×256` `textures/flash.png`) using premultiplied hybrid blend (`One, OneMinusSrcAlpha`) with `opacity`, `blur` (edge softness), `hollow`, and `expand`.
  4. `sparks`: 240 Hz 3-tier ballistic simulation (`burst` streaks, floor-bouncing & skittering `arc` sparks off `frame.floorY`, and `ember` specks alpha-clipped at `< 0.3333` with ~18 % @ 34 Hz flicker).
  5. `ribbon`: tapered additive strips with **6 flight styles** (`whip`, `sphereScatter` gliding over an invisible protective sphere and shooting backward behind Left Defender in unison, `bladeSlide`, `deflectCone`, `vortexWrap`, `groundSkim`).
  6. `smoke` & `debris`: FBM-dissolving translucent dark puffs (`th: 0.12 → 0.95`, **never** an opaque disc) + `darkSparks` + spinning lit metallic iron splinters with cooling orange tips.
  7. `refraction`: screen-space UV distortion (`ring` / `bulge` / `double` / `refraction.png` gradient) adding **zero colour**.
  8. `sfx`: 48 kHz stereo `audio/parry_{normal,perfect}.wav` with sample-exact `peakOffsetS` (`recipe.tiers.{normal,perfect}.sfx.peakOffsetS`). Zero-lead `trigger()` seeks directly to `peakOffsetS` so the acoustic peak hits on Frame 0 with zero lag; pre-lead trigger (`trigger_pre_lead` / `TriggerPreLead` / `TriggerParryWithLead`) plays the full pre-transient scrape so the waveform peak lands at exact contact `T0`.

### 2. Engine setup
- **Godot 4**:
  1. Copy `engines/godot/XsxbParryBurst.gd` and `engines/godot/xsxb_parry_{star,flash,add,smoke,refract}.gdshader` into `res://addons/xsxb_slash/`.
  2. Copy the parry export folder (`recipe.json` + `textures/*.png` + `audio/*.wav`) into the project.
  3. Add `XsxbParryBurst` at the weapon contact point, set `recipe_path`, and call `burst.trigger("normal")` or `burst.trigger("perfect")` (or `burst.trigger_pre_lead(lead_s, "perfect")` when animation lead-in is known). Optional: `burst.align_to_weapons(defender_hilt_to_clash)` and `burst.sample_clash_motion(tau)`.
  4. Enable `WorldEnvironment` ACES Filmic tonemapping + tight HDR Glow (`threshold ≈ 0.9`).
- **Unity (URP / Built-in)**:
  1. Copy `engines/unity/XsxbParryBurst.shader` and `XsxbParryBurst.cs` into `Assets/XsxbSlash/`, and `engines/unity/Editor/XsxbParryInstaller.cs` into `Assets/XsxbSlash/Editor/`.
  2. In Unity Editor, run **`Tools → XSXB-Slash → Install Parry Bundle from Folder...`** (or `XsxbParryInstaller.InstallBundleToAssets`) to auto-configure `sRGB = false`, Wrap modes, `DecompressOnLoad` WAVs (`parry_normal.wav`, `parry_perfect.wav`), and generate a ready `XsxbParryBurst` prefab.
  3. Enable **Opaque Texture** on your URP Asset + ACES Tonemapping + tight Bloom (`threshold ≈ 0.9`). Trigger at runtime via `burst.Trigger("normal" | "perfect")` or `burst.TriggerPreLead(leadS, "perfect")`.
- **Unreal Engine 5**:
  1. Copy `engines/unreal/XsxbParryInstall.py` and `XsxbParryLayer.ush` (plus optional C++ `XsxbParryBurstComponent.h/.cpp` with `"ProceduralMeshComponent", "Json"` in `Build.cs`).
  2. Run `XsxbParryInstall.install_bundle(bundle_dir, "/Game/XsxbParry/MyParry")` in UE5's Python console to import linear masks (`sRGB = False`, `TC_Masks`), `SoundWave` assets (`SW_XsxbParry_parry_{normal,perfect}`), and build `M_XsxbParry_{Star,Flash,Add,Ember,Smoke,Debris,Refract}`.
  3. Attach `UXsxbParryBurstComponent`, assign `NormalSound` & `PerfectSound`, and call `TriggerParry("normal" | "perfect")` or `TriggerParryWithLead(LeadSeconds, "perfect")`.

### 3. Switching to a new parry export
Overwrite only `recipe.json`, `textures/*.png`, and `audio/*.wav` in place (keeping `sRGB = false` on textures) — no script, C#, C++, or shader edits needed.
