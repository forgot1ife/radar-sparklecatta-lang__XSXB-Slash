# XSXB-Slash trail for Godot 4 (recipe v1, docs/SPEC.md). Builds one ribbon per recipe layer.
# Install: copy this folder to res://addons/xsxb_slash/ (the shaders #include that path).
# Use: add a XsxbSlashTrail node anywhere, set recipe_path to the exported recipe.json, hilt/tip to two Node3D on the blade,
# and the three textures (Import dock: shape/highlight/mask as Texture2D; leave "sRGB" alone, the shader reads them as data).
@tool
class_name XsxbSlashTrail
extends Node3D

@export_file("*.json") var recipe_path := ""
@export var hilt: Node3D
@export var tip: Node3D
@export var shape_tex: Texture2D
@export var mask_tex: Texture2D
@export var highlight_tex: Texture2D
@export var width_scale := 1.0           ## multiplies every layer width (recipe assumes a ~1 m blade)
@export var emitting := true             ## off = no new trail; drive it from your attack windows for clean combos
@export var min_tip_speed := 2.0          ## m/s above which the blade counts as swinging
@export_range(1, 16) var substeps := 6     ## samples per frame along a Catmull-Rom curve through the frame poses
@export_range(0, 2) var debug_mode := 0:
	set(v):
		debug_mode = v
		for r in _runs: r.mat.set_shader_parameter("debug_mode", v)

const SH_ALPHA := preload("res://addons/xsxb_slash/xsxb_slash_trail_alpha.gdshader")
const SH_ADD := preload("res://addons/xsxb_slash/xsxb_slash_trail_add.gdshader")
const KEYMAP := {"alpha": "alpha", "hdr": "hdr", "windowNarrow": "window_narrow", "maskAmount": "mask_amount",
	"maskTilePerM": "mask_tile_per_m", "maskPanPerS": "mask_pan_per_s", "erodeSpeed": "erode_speed", "erodeSharp": "erode_sharp",
	"edgeWidth": "edge_width", "edgeGlow": "edge_glow", "highlight": "highlight"}
const CONSTMAP := {"erodeBase": "erode_base", "erodeAgePow": "erode_age_pow", "erodeInner": "erode_inner", "maskTileV": "mask_tile_v",
	"maskAgeDrift": "mask_age_drift", "detailGain": "detail_gain", "headSoft": "head_soft"}

var _runs := []          # [{p, mat, mesh, inst}]
var _samples := []       # shared by all layers: {tip, dir, t, dist, swing}; each layer draws the part younger than its life
var _keys := []          # last frame poses of the current swing: {tip, hilt, t} (Catmull-Rom control points)
var _prov_start := -1    # samples from here on belong to the newest segment and are redrawn next frame
var _prov_dist := 0.0
var _prev_key := {}
var _has_prev := false
var _was := false
var _dist := 0.0
var _swing := 0
var _time := 0.0
var _max_life := 0.0
# finish (docs/SPEC.md 4c), read from recipe.finish (missing = off). Edit these after _ready to override.
var tail_out := false
var tail_out_s := 0.08
var head_cut := false
var head_len_m := 0.22
var head_ramp_s := 0.04
var head_ragged := 0.85
var head_fade := 0.5
var tail_tip := 0.0
var dissolve := false
var diss_start := 0.4
var _tail_start := -1.0
var _sample_dt := 1.0 / 60.0
const FINMAP := {"softness": "diss_soft", "edgeGlow": "diss_edge_glow", "edgeWidth": "diss_edge_w"}
const HEADMAP := {"blurLod": "head_blur", "extraSoftness": "head_soft_extra", "noiseTileX": "head_noise_tile"}

func _ready() -> void:
	if Engine.is_editor_hint() or recipe_path == "":
		return
	var r: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(recipe_path))
	var consts: Dictionary = r.get("constants", {})
	var fin: Dictionary = r.get("finish", {})
	var fto: Dictionary = fin.get("tailOut", {})
	var fhc: Dictionary = fin.get("headCut", {})
	var fds: Dictionary = fin.get("dissolve", {})
	tail_out = fto.get("on", false); tail_out_s = float(fto.get("durationS", tail_out_s))
	head_cut = fhc.get("on", false); head_len_m = float(fhc.get("lengthM", head_len_m)); head_ramp_s = float(fhc.get("rampS", head_ramp_s))
	head_ragged = float(fhc.get("ragged", head_ragged)); head_fade = float(fhc.get("fade", head_fade)); tail_tip = float(fhc.get("tailTip", tail_tip))
	dissolve = fds.get("on", false); diss_start = float(fds.get("start", diss_start))
	var i := 0
	for p in r["layers"]:
		var mat := ShaderMaterial.new()
		mat.shader = SH_ADD if p["blend"] == "additive" else SH_ALPHA
		mat.render_priority = i
		var st: String = p.get("shapeTexture", "shape")
		mat.set_shader_parameter("shape_tex", highlight_tex if st == "highlight" else (null if st == "white" else shape_tex))
		mat.set_shader_parameter("mask_tex", mask_tex)
		mat.set_shader_parameter("highlight_tex", highlight_tex)
		mat.set_shader_parameter("color", _v3(p["color"]))
		mat.set_shader_parameter("edge_color", _v3(p["edgeColor"]))
		mat.set_shader_parameter("highlight_color", _v3(p["highlightColor"]))
		for k in KEYMAP: mat.set_shader_parameter(KEYMAP[k], float(p[k]))
		for k in CONSTMAP:
			if consts.has(k): mat.set_shader_parameter(CONSTMAP[k], float(consts[k]))
		mat.set_shader_parameter("debug_mode", debug_mode)
		for k in FINMAP:
			if fds.has(k): mat.set_shader_parameter(FINMAP[k], float(fds[k]))
		for k in HEADMAP:
			if fhc.has(k): mat.set_shader_parameter(HEADMAP[k], float(fhc[k]))
		if fds.has("edgeColor"): mat.set_shader_parameter("diss_edge_color", _v3(fds["edgeColor"]))
		var mesh := ImmediateMesh.new()
		var inst := MeshInstance3D.new()
		inst.mesh = mesh
		inst.top_level = true                       # vertices are world space
		inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		inst.extra_cull_margin = 16384.0
		add_child(inst)
		_runs.append({"p": p, "mat": mat, "mesh": mesh, "inst": inst})
		_max_life = max(_max_life, float(p["lifeS"]))
		i += 1

func _v3(a) -> Vector3:
	return Vector3(a[0], a[1], a[2])

var _pending_dt := 0.0

func _enter_tree() -> void:
	# Sample right before drawing: skeletons (and BoneAttachment3D) apply this frame's pose after _process,
	# so sampling in _process would read last frame's sword and the trail would lag behind the blade.
	if not Engine.is_editor_hint() and not RenderingServer.frame_pre_draw.is_connected(_tick):
		RenderingServer.frame_pre_draw.connect(_tick)

func _exit_tree() -> void:
	if RenderingServer.frame_pre_draw.is_connected(_tick):
		RenderingServer.frame_pre_draw.disconnect(_tick)

func _process(delta: float) -> void:
	_pending_dt += delta

func _tick() -> void:
	if _runs.is_empty() or hilt == null or tip == null or _pending_dt <= 0.0:
		return
	var delta := _pending_dt
	_pending_dt = 0.0
	_time += delta
	var dt: float = max(delta, 1e-5)
	var cur := {"tip": tip.global_position, "hilt": hilt.global_position, "t": _time}
	var on: bool = emitting and _has_prev and cur.tip.distance_to(_prev_key.tip) / dt > min_tip_speed
	_sample_dt = dt
	if on:
		_tail_start = -1.0
	elif _was and tail_out and tail_out_s > 0.0 and _tail_start < 0.0:
		_tail_start = _prev_key.t   # window just closed: keep following the blade, fading out
	var swinging: bool = on or (_tail_start >= 0.0 and _prev_key.t - _tail_start < tail_out_s)
	if not swinging:
		_tail_start = -1.0
	if swinging:
		if not _was:
			_swing += 1
			_dist = 0.0
			_keys = [_prev_key]
			_add(_prev_key.tip, _prev_key.hilt, _prev_key.t)
			_prov_start = -1
		_keys.append(cur)
		if _keys.size() > 4:
			_keys.pop_front()
		var n := _keys.size()
		if n >= 3 and _prov_start >= 0:
			# the next pose is known now: redraw the previous segment with full Catmull-Rom tangents
			_samples.resize(_prov_start)
			_dist = _prov_dist
			_segment(_keys[n - 3], _keys[n - 2], _keys[n - 4] if n >= 4 else null, _keys[n - 1])
		_prov_start = _samples.size()
		_prov_dist = _dist
		_segment(_keys[n - 2], _keys[n - 1], _keys[n - 3] if n >= 3 else null, null)
	else:
		_prov_start = -1
	_was = swinging
	_prev_key = cur
	_has_prev = true
	var old := 0
	while old < _samples.size() and _time - _samples[old].t > _max_life:
		old += 1
	if old > 0:
		_samples = _samples.slice(old)
		if _prov_start >= 0:
			_prov_start = max(0, _prov_start - old)
	for r in _runs:
		_build(r)

# Hermite segment a -> b. Tangents: Catmull-Rom (neighbour difference / 2) where the neighbour exists, else the chord.
func _segment(a: Dictionary, b: Dictionary, before, after) -> void:
	# spline the hilt position and the blade vector (tip - hilt) separately, then renormalise the blade:
	# a fast swing stays on its arc instead of cutting the corner
	var ra: Vector3 = a.tip - a.hilt
	var rb: Vector3 = b.tip - b.hilt
	var mra: Vector3 = (rb - (before.tip - before.hilt)) * .5 if before != null else rb - ra
	var mrb: Vector3 = ((after.tip - after.hilt) - ra) * .5 if after != null else rb - ra
	var mha: Vector3 = (b.hilt - before.hilt) * .5 if before != null else b.hilt - a.hilt
	var mhb: Vector3 = (after.hilt - a.hilt) * .5 if after != null else b.hilt - a.hilt
	var la := ra.length()
	var lb := rb.length()
	var last: Vector3 = a.tip
	for k in range(1, substeps + 1):
		var f := float(k) / substeps
		var hp := _herm(a.hilt, mha, b.hilt, mhb, f)
		var r := _herm(ra, mra, rb, mrb, f)
		var tp := hp + (r.normalized() if r.length_squared() > 1e-12 else rb.normalized()) * lerpf(la, lb, f)
		_dist += tp.distance_to(last)
		last = tp
		_add(tp, hp, lerpf(a.t, b.t, f))

func _herm(p0: Vector3, m0: Vector3, p1: Vector3, m1: Vector3, f: float) -> Vector3:
	var f2 := f * f
	var f3 := f2 * f
	return (2 * f3 - 3 * f2 + 1) * p0 + (f3 - 2 * f2 + f) * m0 + (-2 * f3 + 3 * f2) * p1 + (f3 - f2) * m1

func _add(t: Vector3, h: Vector3, time: float) -> void:
	var f := 1.0   # tail-out fade (alpha only)
	if _tail_start >= 0.0 and time > _tail_start:
		f = 0.5 + 0.5 * cos(PI * clampf((time - _tail_start) / maxf(tail_out_s, 1e-3), 0.0, 1.0))
	_samples.append({"tip": t, "dir": (t - h).normalized(), "t": time, "dist": _dist, "swing": _swing, "f": f})

## Stretch shape/highlight textures over the whole visible trail (U = age / oldest age of the stroke).
## Off = U is plain age, which cuts the texture while the trail is still growing.
@export var fill_texture := true

func _build(r: Dictionary) -> void:
	var life: float = max(0.02, float(r.p["lifeS"]))
	var first := 0
	while first < _samples.size() and _time - _samples[first].t > life:
		first += 1
	var s: Array = _samples.slice(first)
	var mesh: ImmediateMesh = r.mesh
	mesh.clear_surfaces()
	if s.size() < 2:
		return
	mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES, r.mat)
	var w0: float = float(r.p["widthM"]) * width_scale
	var taper: float = float(r.p["taper"])
	var oldest := 1.0
	var head := []   # newest sample of each stroke
	head.resize(s.size())
	var hd := s.size() - 1
	for i in range(s.size() - 1, -1, -1):
		if i < s.size() - 1 and s[i + 1].swing != s[i].swing:
			hd = i
		head[i] = s[hd]
	for i in range(1, s.size()):
		var a: Dictionary = s[i - 1]
		var b: Dictionary = s[i]
		if i == 1 or s[i - 2].swing != a.swing:
			oldest = maxf(clampf((_time - a.t) / life, 0.0, 1.0), 1e-3)   # first sample of a stroke = its oldest
		if a.swing != b.swing:
			continue
		var qa := _quad(a, life, w0, taper, oldest, head[i - 1])
		var qb := _quad(b, life, w0, taper, oldest, head[i])
		# two triangles: a.inner, b.inner, a.outer / a.outer, b.inner, b.outer
		for v in [qa[0], qb[0], qa[1], qa[1], qb[0], qb[1]]:
			mesh.surface_set_uv(v[1])
			mesh.surface_set_uv2(v[2])
			mesh.surface_set_color(v[3])
			mesh.surface_add_vertex(v[0])
	mesh.surface_end()

func _quad(smp: Dictionary, life: float, w0: float, taper: float, oldest: float, hs: Dictionary) -> Array:
	var age := clampf((_time - smp.t) / life, 0.0, 1.0)
	# finish (SPEC 4c): COLOR = (alpha multiplier, dissolve progress, head weight); the width never changes at the head
	var fa: float = smp.f
	var hr := 0.0
	var wm := 1.0
	if head_cut:
		var k := clampf((_time - hs.t - _sample_dt * 0.5) / maxf(head_ramp_s, 1e-3), 0.0, 1.0)
		hr = maxf(k * (1.0 - smoothstep(0.0, 1.0, (hs.dist - smp.dist) / maxf(head_len_m, 1e-4))), 1.0 - fa)
		fa *= 1.0 - head_fade * hr
		if tail_tip > 0.0:
			wm = smoothstep(0.0, 1.0, (1.0 - minf(1.0, age / oldest)) / tail_tip)
	var prog := maxf(clampf((age - diss_start) / maxf(1.0 - diss_start, 1e-3), 0.0, 1.0) if dissolve else 0.0, head_ragged * hr if head_cut else 0.0)
	var fc := Color(fa, prog, hr, 1.0)
	var w := w0 * (1.0 - taper * age) * wm
	var d := Vector2(smp.dist, minf(1.0, age / oldest) if fill_texture else age)   # y = filled U
	return [[smp.tip - smp.dir * w, Vector2(age, 0.0), d, fc], [smp.tip, Vector2(age, 1.0), d, fc]]
