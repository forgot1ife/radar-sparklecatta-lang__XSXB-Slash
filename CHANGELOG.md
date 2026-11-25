# Changelog

## 2026-11-25: Finish (收尾)

- New 收尾 panel: tail-out fade after the attack window, ragged / blurred / fainter head cut (no narrowing), noise dissolve while the trail disappears. Each part has a switch and sliders; preview-only "window closes early" slider to see the effect.
- `recipe.json` gains an optional `finish` block (`tailOut`, `headCut`, `dissolve`). Missing = off, so old recipes look the same.
- Unity, Godot and Unreal reference trails implement it (per-vertex alpha / dissolve progress / head weight; mask lookup with mip bias for the blur). Spec: docs/SPEC.md section 4c.
- Recording mode (`?rec=1`) keeps all three off by default, so earlier captures stay pixel-identical.

## 2026-11-18: Parry tab

- 10-layer parry VFX + clash SFX, engine ports, new banner and README screenshots.

## 2026-11-12: First public release

- Slash-trail generator (shape / mask / highlight / gnaw / refraction / sparks / smoke / liquid), recipe v1 export, Unity / Godot / Unreal reference trails.
