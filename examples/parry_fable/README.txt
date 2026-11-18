XSXB-Slash 格挡 (parry) export

recipe.json             dual-tier (tiers.normal + tiers.perfect) parameters: star, standalone light, flash, sparks, 6-style ribbon, smoke, debris, refraction, and peak-synced sfx
textures/*.png          linear grey masks (turn sRGB OFF on import)
audio/parry_normal.wav  48 kHz 16-bit stereo WAV for 普通格挡 (sync peak via recipe.tiers.normal.sfx.peakOffsetS)
audio/parry_perfect.wav 48 kHz 16-bit stereo WAV for 精防 (sync peak via recipe.tiers.perfect.sfx.peakOffsetS)
preview.png             web preview 0.06 s after contact

Install into Godot 4 / Unity / Unreal Engine 5: see docs/SPEC_PARRY.md, engines/<engine>/, or skill/xsxb-slash-install/SKILL.md.
