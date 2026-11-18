# XSXB-Slash Parry Burst for Godot 4 (`xsxb-parry` v1, docs/SPEC_PARRY.md).
# Install: copy `engines/godot/*` into `res://addons/xsxb_slash/` (or any folder together with the 4 `xsxb_parry_*.gdshader` files).
# Use: add `XsxbParryBurst` to your 3D scene at the clash point, set `recipe_path` to `recipe.json` (sibling `textures/*.png` auto-load as linear masks, or assign Texture2D overrides), and call `trigger()`.
class_name XsxbParryBurst
extends Node3D

@export_file("*.json") var recipe_path := ""
@export var star_tex: Texture2D
@export var star_normal_tex: Texture2D
@export var spark_tex: Texture2D
@export var flash_tex: Texture2D
@export var flash_normal_tex: Texture2D
@export var smoke_tex: Texture2D
@export var refraction_tex: Texture2D
@export var normal_sfx: AudioStream
@export var perfect_sfx: AudioStream
@export var normal_sfx_pool: Array[AudioStream] = []
@export var perfect_sfx_pool: Array[AudioStream] = []
@export var sfx_enabled := true
@export var sfx_2d := true
@export var normal_sfx_volume_db := 2.6
@export var perfect_sfx_volume_db := 4.8
@export var scale_mul := 1.0
@export var floor_y_override := NAN          ## NaN = use recipe.frame.floorY (default -1.1 m relative to clash point)
@export var auto_trigger_on_ready := false
@export var manual_clock := false            ## true = driven externally via seek(tau)

const FIXED_DT := 1.0 / 240.0
const MAX_DURATION := 1.85

var _recipe: Dictionary = {}
var _loaded := false
var _playing := false
var _tau := -1.0
var _sim_t := 0.0
var _active_seed := 77
var _active_tier := "perfect"
var _frame_basis := Basis.IDENTITY

var _star_inst: MeshInstance3D
var _glow_inst: MeshInstance3D
var _flash_inst: MeshInstance3D
var _star_mat: ShaderMaterial
var _glow_mat: ShaderMaterial
var _flash_mat: ShaderMaterial
var _light: OmniLight3D

var _add_mesh: ImmediateMesh
var _add_inst: MeshInstance3D
var _add_mat: ShaderMaterial

var _dark_mesh: ImmediateMesh
var _dark_inst: MeshInstance3D
var _dark_mat: ShaderMaterial

var _smoke_mesh: ArrayMesh
var _smoke_inst: MeshInstance3D
var _smoke_mat: ShaderMaterial

var _debris_mm: MultiMesh
var _debris_inst: MultiMeshInstance3D
var _debris_mat: StandardMaterial3D

var _refr_inst: MeshInstance3D
var _refr_mat: ShaderMaterial
var _sfx_player: AudioStreamPlayer3D
var _sfx_player_2d: AudioStreamPlayer
var _loaded_sfx: Dictionary = {"normal": null, "perfect": null}
var _loaded_sfx_pool: Dictionary = {"normal": [], "perfect": []}
var _last_sfx_pick: Dictionary = {"normal": -1, "perfect": -1}
var _pending_sfx: Dictionary = {"normal": null, "perfect": null}
var _sfx_rng := RandomNumberGenerator.new()
var _loaded_star_tex: Dictionary = {"normal": null, "perfect": null}
var _loaded_flash_tex: Dictionary = {"normal": null, "perfect": null}
var _pre_lead_timer := -1.0
var _pre_lead_tier := "perfect"

var _proc_noise_tex: ImageTexture
var _smoke_is_mask := false

var _sparks_state: Array = []
var _dark_state: Array = []
var _debris_state: Array = []
var _smoke_puffs_cfg: Array = []


class SeededRng:
	var a: int
	func _init(seed_val: int) -> void:
		a = seed_val & 0xFFFFFFFF
		if a == 0:
			a = 1
	func next() -> float:
		a = (a + 0x6D2B79F5) & 0xFFFFFFFF
		var t: int = _imul32(a ^ (a >> 15), 1 | a)
		var u: int = _imul32(t ^ (t >> 7), 61 | t)
		t = (t + u) ^ t
		t &= 0xFFFFFFFF
		var out: int = (t ^ (t >> 14)) & 0xFFFFFFFF
		return float(out) / 4294967296.0
	func range_f(lo: float, hi: float) -> float:
		return lo + (hi - lo) * next()
	static func _imul32(x: int, y: int) -> int:
		var xl := x & 0xFFFF
		var xh := (x >> 16) & 0xFFFF
		var yl := y & 0xFFFF
		var yh := (y >> 16) & 0xFFFF
		return (xl * yl + (((xh * yl + xl * yh) & 0xFFFF) << 16)) & 0xFFFFFFFF


static func _hash_ints(vals: Array) -> int:
	var h: int = 2166136261
	for v in vals:
		var x: int = ((int(v) & 0xFFFFFFFF) + 0x9E3779B9) & 0xFFFFFFFF
		h = SeededRng._imul32(h ^ x, 2246822507)
		h = SeededRng._imul32(h ^ (h >> 13), 3266489909)
		h = (h ^ (h >> 16)) & 0xFFFFFFFF
	return h


static func _sstep(edge0: float, edge1: float, x: float) -> float:
	if absf(edge1 - edge0) < 1e-9:
		return 1.0 if x >= edge1 else 0.0
	var t := clampf((x - edge0) / (edge1 - edge0), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)


static func _v3(arr: Variant, fallback := Vector3.ZERO) -> Vector3:
	if arr is Array and arr.size() >= 3:
		return Vector3(float(arr[0]), float(arr[1]), float(arr[2]))
	return fallback


static func _col_v3(arr: Variant, fallback := Vector3.ONE) -> Vector3:
	return _v3(arr, fallback)


func _ready() -> void:
	_build_nodes()
	if recipe_path != "":
		load_recipe(recipe_path)
	if auto_trigger_on_ready and _loaded:
		trigger()


func _load_sibling_shader(fname: String) -> Shader:
	var script_res := get_script() as Script
	if script_res and script_res.resource_path != "":
		var p := script_res.resource_path.get_base_dir().path_join(fname)
		if ResourceLoader.exists(p):
			return load(p) as Shader
	var fallback := "res://addons/xsxb_slash/" + fname
	if ResourceLoader.exists(fallback):
		return load(fallback) as Shader
	push_error("XsxbParryBurst: missing shader " + fname)
	return null


func _build_nodes() -> void:
	if _star_inst != null:
		return
	var quad := QuadMesh.new()
	quad.size = Vector2(1.0, 1.0)

	var sh_star := _load_sibling_shader("xsxb_parry_star.gdshader")
	var sh_flash := _load_sibling_shader("xsxb_parry_flash.gdshader")
	var sh_add := _load_sibling_shader("xsxb_parry_add.gdshader")
	var sh_smoke := _load_sibling_shader("xsxb_parry_smoke.gdshader")
	var sh_refr := _load_sibling_shader("xsxb_parry_refract.gdshader")

	_flash_mat = ShaderMaterial.new()
	_flash_mat.shader = sh_flash
	_flash_mat.render_priority = 4
	_flash_inst = MeshInstance3D.new()
	_flash_inst.mesh = quad
	_flash_inst.material_override = _flash_mat
	_flash_inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_flash_inst.extra_cull_margin = 16.0
	_flash_inst.visible = false
	add_child(_flash_inst)

	_glow_mat = ShaderMaterial.new()
	_glow_mat.shader = sh_star
	_glow_mat.render_priority = 6
	_glow_mat.set_shader_parameter("is_glow", 1)
	_glow_inst = MeshInstance3D.new()
	_glow_inst.mesh = quad
	_glow_inst.material_override = _glow_mat
	_glow_inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_glow_inst.extra_cull_margin = 16.0
	_glow_inst.visible = false
	add_child(_glow_inst)

	_star_mat = ShaderMaterial.new()
	_star_mat.shader = sh_star
	_star_mat.render_priority = 7
	_star_mat.set_shader_parameter("is_glow", 0)
	_star_inst = MeshInstance3D.new()
	_star_inst.mesh = quad
	_star_inst.material_override = _star_mat
	_star_inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_star_inst.extra_cull_margin = 16.0
	_star_inst.visible = false
	add_child(_star_inst)

	_light = OmniLight3D.new()
	_light.omni_range = 6.0
	_light.omni_attenuation = 2.0
	_light.light_energy = 0.0
	_light.shadow_enabled = false
	add_child(_light)

	_add_mesh = ImmediateMesh.new()
	_add_mat = ShaderMaterial.new()
	_add_mat.shader = sh_add
	_add_mat.render_priority = 5
	_add_inst = MeshInstance3D.new()
	_add_inst.mesh = _add_mesh
	_add_inst.material_override = _add_mat
	_add_inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_add_inst.extra_cull_margin = 32.0
	_add_inst.top_level = true
	add_child(_add_inst)

	_dark_mesh = ImmediateMesh.new()
	_dark_mat = ShaderMaterial.new()
	_dark_mat.shader = sh_smoke
	_dark_mat.render_priority = 2
	_dark_mat.set_shader_parameter("is_dark_streak", 1)
	_dark_inst = MeshInstance3D.new()
	_dark_inst.mesh = _dark_mesh
	_dark_inst.material_override = _dark_mat
	_dark_inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_dark_inst.extra_cull_margin = 32.0
	_dark_inst.top_level = true
	add_child(_dark_inst)

	_smoke_mesh = ArrayMesh.new()
	_smoke_mat = ShaderMaterial.new()
	_smoke_mat.shader = sh_smoke
	_smoke_mat.render_priority = 1
	_smoke_mat.set_shader_parameter("is_dark_streak", 0)
	_smoke_inst = MeshInstance3D.new()
	_smoke_inst.mesh = _smoke_mesh
	_smoke_inst.material_override = _smoke_mat
	_smoke_inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_smoke_inst.extra_cull_margin = 32.0
	_smoke_inst.top_level = true
	add_child(_smoke_inst)

	_debris_mat = StandardMaterial3D.new()
	_debris_mat.albedo_color = Color(0.60, 0.61, 0.64, 1.0)
	_debris_mat.metallic = 1.0
	_debris_mat.roughness = 0.22
	_debris_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_debris_mm = MultiMesh.new()
	_debris_mm.transform_format = MultiMesh.TRANSFORM_3D
	_debris_mm.mesh = _build_splinter_mesh()
	_debris_mm.instance_count = 128
	_debris_mm.visible_instance_count = 0
	_debris_inst = MultiMeshInstance3D.new()
	_debris_inst.multimesh = _debris_mm
	_debris_inst.material_override = _debris_mat
	_debris_inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_debris_inst.extra_cull_margin = 32.0
	_debris_inst.top_level = true
	add_child(_debris_inst)

	_refr_mat = ShaderMaterial.new()
	_refr_mat.shader = sh_refr
	_refr_mat.render_priority = -5
	_refr_inst = MeshInstance3D.new()
	_refr_inst.mesh = quad
	_refr_inst.material_override = _refr_mat
	_refr_inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_refr_inst.extra_cull_margin = 16.0
	_refr_inst.visible = false
	add_child(_refr_inst)

	_sfx_player = AudioStreamPlayer3D.new()
	_sfx_player.max_distance = 28.0
	_sfx_player.unit_size = 6.0
	add_child(_sfx_player)
	_sfx_player_2d = AudioStreamPlayer.new()
	add_child(_sfx_player_2d)


static func _build_splinter_mesh() -> ArrayMesh:
	# Stretched flat-shaded octahedron splinter (2.8 x 0.38 x 0.9) matching parry_core.js
	var pts := [
		Vector3(2.8, 0.0, 0.0), Vector3(-2.8, 0.0, 0.0),
		Vector3(0.0, 0.38, 0.0), Vector3(0.0, -0.38, 0.0),
		Vector3(0.0, 0.0, 0.9), Vector3(0.0, 0.0, -0.9)
	]
	var tris := [
		[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0],
		[4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]
	]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for tri in tris:
		var p0: Vector3 = pts[tri[0]]
		var p1: Vector3 = pts[tri[1]]
		var p2: Vector3 = pts[tri[2]]
		var n := (p1 - p0).cross(p2 - p0).normalized()
		st.set_normal(n)
		st.add_vertex(p0)
		st.set_normal(n)
		st.add_vertex(p1)
		st.set_normal(n)
		st.add_vertex(p2)
	return st.commit()


static func _make_proc_noise_tex(seed_val: int, n_sz: int = 128) -> ImageTexture:
	var img := Image.create(n_sz, n_sz, false, Image.FORMAT_RF)
	for y in range(n_sz):
		for x in range(n_sz):
			var s := 0.0
			var amp := 0.5
			var c := 4
			for o in range(5):
				var fx := float(x) / float(n_sz) * float(c)
				var fy := float(y) / float(n_sz) * float(c)
				var ix := int(floor(fx))
				var iy := int(floor(fy))
				var tx := fx - float(ix)
				var ty := fy - float(iy)
				var sx := tx * tx * (3.0 - 2.0 * tx)
				var sy := ty * ty * (3.0 - 2.0 * ty)
				var a := float(_hash_ints([ix % c, iy % c, o, seed_val])) / 4294967296.0
				var b := float(_hash_ints([(ix + 1) % c, iy % c, o, seed_val])) / 4294967296.0
				var cc := float(_hash_ints([ix % c, (iy + 1) % c, o, seed_val])) / 4294967296.0
				var d := float(_hash_ints([(ix + 1) % c, (iy + 1) % c, o, seed_val])) / 4294967296.0
				s += (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy) * amp
				amp *= 0.5
				c *= 2
			img.set_pixel(x, y, Color(clampf(s / 0.97, 0.0, 1.0), 0.0, 0.0, 1.0))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


static func _load_linear_png(abs_or_res_path: String) -> Array:
	# Returns [ImageTexture or null, Image or null]
	var real_path := ProjectSettings.globalize_path(abs_or_res_path) if abs_or_res_path.begins_with("res://") else abs_or_res_path
	var img := Image.new()
	if FileAccess.file_exists(real_path):
		var err := img.load(real_path)
		if err == OK:
			img.generate_mipmaps()
			return [ImageTexture.create_from_image(img), img]
	if ResourceLoader.exists(abs_or_res_path):
		var tex := load(abs_or_res_path) as Texture2D
		if tex != null:
			return [tex, tex.get_image()]
	return [null, null]


static func _load_wav_stream(abs_or_res_path: String) -> AudioStream:
	if ResourceLoader.exists(abs_or_res_path):
		var s := load(abs_or_res_path) as AudioStream
		if s != null:
			return s
	var real_path := ProjectSettings.globalize_path(abs_or_res_path) if abs_or_res_path.begins_with("res://") else abs_or_res_path
	if not FileAccess.file_exists(real_path):
		return null
	var bytes := FileAccess.get_file_as_bytes(real_path)
	if bytes.size() < 44:
		return null
	if bytes.slice(0, 4).get_string_from_ascii() != "RIFF" or bytes.slice(8, 12).get_string_from_ascii() != "WAVE":
		return null
	var pos := 12
	var ch := 2
	var sr := 48000
	var bits := 16
	var data_off := 0
	var data_len := 0
	while pos + 8 <= bytes.size():
		var cid := bytes.slice(pos, pos + 4).get_string_from_ascii()
		var csz := bytes.decode_u32(pos + 4)
		if cid == "fmt ":
			ch = bytes.decode_u16(pos + 10)
			sr = bytes.decode_u32(pos + 12)
			bits = bytes.decode_u16(pos + 22)
		elif cid == "data":
			data_off = pos + 8
			data_len = mini(csz, bytes.size() - data_off)
			break
		pos += 8 + csz + (csz & 1)
	if data_off <= 0 or data_len <= 0:
		return null
	var wav := AudioStreamWAV.new()
	wav.mix_rate = sr
	wav.stereo = ch >= 2
	wav.format = AudioStreamWAV.FORMAT_16_BITS if bits == 16 else AudioStreamWAV.FORMAT_8_BITS
	wav.data = bytes.slice(data_off, data_off + data_len)
	return wav


static func _make_proc_flash_tex(style: String, seed_val: int, rings: int = 3, n: int = 256) -> ImageTexture:
	var rng := SeededRng.new(_hash_ints([seed_val, 19]))
	var nr := clampi(rings, 1, 8)
	var p1 := rng.next() * TAU
	var p2 := rng.next() * TAU
	var p3 := rng.next() * TAU
	var k1 := 3 + int(floor(rng.next() * 4.0))
	var k2 := 5 + int(floor(rng.next() * 6.0))
	var r_in := lerpf(0.48, 0.58, rng.next())
	var img := Image.create(n, n, false, Image.FORMAT_RF)
	for y in range(n):
		for x in range(n):
			var px := (float(x) + 0.5) / float(n) * 2.0 - 1.0
			var py := (float(y) + 0.5) / float(n) * 2.0 - 1.0
			var rr := sqrt(px * px + py * py)
			if rr >= 0.99:
				img.set_pixel(x, y, Color(0.0, 0.0, 0.0, 1.0))
				continue
			var ang := atan2(py, px)
			var b_env := _sstep(0.99, 0.935, rr)
			var v := 0.0
			if style == "ripple":
				var rw := rr + 0.012 * sin(float(k1) * ang + p1) + 0.008 * cos(float(k2) * ang + p2)
				var ph := clampf((rw - 0.10) / 0.83, 0.0, 1.0) * float(nr) * TAU - p3 * 0.35
				var waves := pow(0.5 + 0.5 * cos(ph), 2.8) * _sstep(0.06, 0.18, rr) * (0.55 + 0.45 * _sstep(0.95, 0.25, rr))
				v = 0.82 * exp(-pow(rr / 0.14, 2.0)) + waves * 0.78 + 0.52 * exp(-pow((rr - 0.90) / 0.042, 2.0))
			elif style == "halo":
				var wob := 1.0 + 0.014 * sin(float(k1) * ang + p1)
				v = 0.84 * exp(-pow((rr * wob - 0.83) / 0.058, 2.0)) + 0.38 * exp(-pow((rr - 0.64) / 0.040, 2.0)) + 0.24 * maxf(0.0, 1.0 - pow(rr / 0.92, 2.0)) + 0.50 * exp(-pow(rr / 0.11, 2.0))
			else:
				var u := minf(1.0, rr / 0.945)
				var z := sqrt(maxf(0.0, 1.0 - u * u))
				var vol := 0.36 * z + 0.44 * pow(u, 2.5) * _sstep(0.985, 0.85, rr) + 0.42 * exp(-pow((rr - 0.90) / 0.042, 2.0))
				v = 0.90 * exp(-pow(rr / 0.15, 2.0)) + vol + 0.50 * exp(-pow((rr - r_in) / 0.040, 2.0))
			var fv := clampf(v, 0.0, 1.0) * b_env
			img.set_pixel(x, y, Color(fv, fv, fv, 1.0))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _tier_dict() -> Dictionary:
	var tk := "normal" if _active_tier == "normal" else "perfect"
	var tiers_v: Variant = _recipe.get("tiers", null)
	if tiers_v is Dictionary and (tiers_v as Dictionary).has(tk):
		var sub: Variant = (tiers_v as Dictionary)[tk]
		if sub is Dictionary:
			return sub as Dictionary
	return _recipe


func load_recipe(path: String) -> bool:
	_build_nodes()
	if path == "":
		return false
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		push_error("XsxbParryBurst: cannot read recipe at " + path)
		return false
	var parsed: Variant = JSON.parse_string(text)
	if not (parsed is Dictionary):
		push_error("XsxbParryBurst: invalid JSON in " + path)
		return false
	var r: Dictionary = parsed
	var fmt := String(r.get("format", r.get("kind", "")))
	var ver := int(r.get("version", 0))
	if fmt != "xsxb-parry" or ver != 1:
		push_error("XsxbParryBurst: unsupported recipe format=%s version=%d" % [fmt, ver])
		return false
	_recipe = r
	recipe_path = path
	_active_seed = int(r.get("seed", 77))
	var raw_tier := String(r.get("tier", "perfect"))
	_active_tier = "normal" if raw_tier == "normal" else "perfect"

	var base_dir := path.get_base_dir()
	var st_rel := String(r.get("star", {}).get("texture", "textures/star.png"))
	var fl_rel := String(r.get("flash", {}).get("texture", "textures/flash.png"))
	var sp_rel := String(r.get("sparks", {}).get("texture", "textures/spark.png"))
	var sm_rel := String(r.get("smoke", {}).get("texture", "textures/smoke.png"))
	var rf_rel_v: Variant = r.get("refraction", {}).get("texture", null)

	var st_loaded := _load_linear_png(base_dir.path_join(st_rel)) if star_tex == null else [star_tex, star_tex.get_image()]
	var fl_loaded := _load_linear_png(base_dir.path_join(fl_rel)) if flash_tex == null else [flash_tex, flash_tex.get_image()]
	var sp_loaded := _load_linear_png(base_dir.path_join(sp_rel)) if spark_tex == null else [spark_tex, spark_tex.get_image()]
	var sm_loaded := _load_linear_png(base_dir.path_join(sm_rel)) if smoke_tex == null else [smoke_tex, smoke_tex.get_image()]

	_loaded_star_tex["perfect"] = st_loaded[0]
	_loaded_star_tex["normal"] = star_normal_tex if star_normal_tex != null else st_loaded[0]
	var fl_fallback_p: Texture2D = fl_loaded[0]
	if fl_fallback_p == null:
		var fl_top: Dictionary = r.get("flash", {})
		fl_fallback_p = _make_proc_flash_tex(String(fl_top.get("style", "sphere")), int(fl_top.get("seed", 17)), int(fl_top.get("rings", 3)))
	_loaded_flash_tex["perfect"] = fl_fallback_p
	_loaded_flash_tex["normal"] = flash_normal_tex if flash_normal_tex != null else fl_fallback_p
	var tiers_d: Variant = r.get("tiers", null)
	if star_tex == null and star_normal_tex == null and tiers_d is Dictionary:
		var tn_st := String((tiers_d as Dictionary).get("normal", {}).get("star", {}).get("texture", ""))
		if tn_st != "" and tn_st != st_rel:
			var sn_l := _load_linear_png(base_dir.path_join(tn_st))
			if sn_l[0] != null:
				_loaded_star_tex["normal"] = sn_l[0]
	if flash_tex == null and flash_normal_tex == null and tiers_d is Dictionary:
		var tn_fl_d: Dictionary = (tiers_d as Dictionary).get("normal", {}).get("flash", {})
		var tn_fl := String(tn_fl_d.get("texture", ""))
		if tn_fl != "" and tn_fl != fl_rel:
			var fn_l := _load_linear_png(base_dir.path_join(tn_fl))
			if fn_l[0] != null:
				_loaded_flash_tex["normal"] = fn_l[0]
			else:
				_loaded_flash_tex["normal"] = _make_proc_flash_tex(String(tn_fl_d.get("style", "sphere")), int(tn_fl_d.get("seed", 17)), int(tn_fl_d.get("rings", 3)))

	if st_loaded[0] != null:
		_star_mat.set_shader_parameter("star_tex", st_loaded[0])
	if _loaded_flash_tex["perfect"] != null:
		_flash_mat.set_shader_parameter("flash_tex", _loaded_flash_tex["perfect"])
	if sp_loaded[0] != null:
		_add_mat.set_shader_parameter("spark_tex", sp_loaded[0])
		if fl_loaded[0] != null:
			_add_mat.set_shader_parameter("flash_tex", fl_loaded[0])
		_add_mat.set_shader_parameter("use_textures", 1)
	else:
		_add_mat.set_shader_parameter("use_textures", 0)

	_proc_noise_tex = _make_proc_noise_tex(_active_seed + 307, 128)
	_smoke_is_mask = false
	if sm_loaded[0] != null and sm_loaded[1] != null:
		var sm_img: Image = sm_loaded[1]
		var w := sm_img.get_width()
		var h := sm_img.get_height()
		var corner_avg := (
			sm_img.get_pixel(0, 0).r +
			sm_img.get_pixel(w - 1, 0).r +
			sm_img.get_pixel(0, h - 1).r +
			sm_img.get_pixel(w - 1, h - 1).r
		) * 0.25
		if corner_avg < 0.03 and w >= 256:
			_smoke_is_mask = true
			_smoke_mat.set_shader_parameter("noise_tex", _proc_noise_tex)
			_smoke_mat.set_shader_parameter("mask_tex", sm_loaded[0])
			_smoke_mat.set_shader_parameter("use_mask", 1)
		else:
			_smoke_mat.set_shader_parameter("noise_tex", sm_loaded[0])
			_smoke_mat.set_shader_parameter("use_mask", 0)
	else:
		_smoke_mat.set_shader_parameter("noise_tex", _proc_noise_tex)
		_smoke_mat.set_shader_parameter("use_mask", 0)

	if refraction_tex != null:
		_refr_mat.set_shader_parameter("refr_tex", refraction_tex)
	elif rf_rel_v is String and String(rf_rel_v) != "":
		var rf_loaded := _load_linear_png(base_dir.path_join(String(rf_rel_v)))
		if rf_loaded[0] != null:
			_refr_mat.set_shader_parameter("refr_tex", rf_loaded[0])

	_sfx_rng.randomize()
	_loaded_sfx["normal"] = normal_sfx if normal_sfx != null else _load_wav_stream(base_dir.path_join("audio/parry_normal.wav"))
	_loaded_sfx["perfect"] = perfect_sfx if perfect_sfx != null else _load_wav_stream(base_dir.path_join("audio/parry_perfect.wav"))
	if _loaded_sfx["perfect"] == null and r.has("sfx"):
		var sf_rel := String(r.get("sfx", {}).get("file", ""))
		if sf_rel != "":
			_loaded_sfx["perfect"] = _load_wav_stream(base_dir.path_join(sf_rel))
	for tk in ["normal", "perfect"]:
		var pool_list: Array = []
		var exp_pool: Array = normal_sfx_pool if tk == "normal" else perfect_sfx_pool
		var td_tk: Dictionary = r.get("tiers", {}).get(tk, {}) if r.has("tiers") else r
		var sx_tk: Dictionary = td_tk.get("sfx", {})
		var def_pk := maxf(0.0, float(sx_tk.get("peakOffsetS", 0.015)))
		var json_pool: Array = sx_tk.get("pool", [])
		if exp_pool.size() > 0:
			for idx in range(exp_pool.size()):
				var st_item: AudioStream = exp_pool[idx]
				if st_item != null:
					var pk_i := float(json_pool[idx].get("peakOffsetS", def_pk)) if idx < json_pool.size() and json_pool[idx] is Dictionary else def_pk
					pool_list.append({"stream": st_item, "peak": maxf(0.0, pk_i)})
		elif json_pool.size() > 0:
			for ent in json_pool:
				if ent is Dictionary:
					var st_item := _load_wav_stream(base_dir.path_join(String(ent.get("file", ""))))
					if st_item != null:
						pool_list.append({"stream": st_item, "peak": maxf(0.0, float(ent.get("peakOffsetS", def_pk)))})
		if pool_list.is_empty() and _loaded_sfx.get(tk) != null:
			pool_list.append({"stream": _loaded_sfx[tk], "peak": def_pk})
		_loaded_sfx_pool[tk] = pool_list
		_last_sfx_pick[tk] = -1
		_pending_sfx[tk] = null

	_loaded = true
	return true


func align_to_weapons(defender_hilt_to_clash: Vector3, attacker_hilt_to_clash := Vector3.ZERO) -> void:
	if not _loaded:
		return
	var ref_a := _v3(_recipe.get("frame", {}).get("bladeA", [0.5507, 0.8211, -0.1502])).normalized()
	var tgt_a := defender_hilt_to_clash.normalized()
	if ref_a.length_squared() > 0.5 and tgt_a.length_squared() > 0.5:
		var axis := ref_a.cross(tgt_a)
		if axis.length_squared() > 1e-6:
			_frame_basis = Basis(axis.normalized(), ref_a.angle_to(tgt_a))
		else:
			_frame_basis = Basis.IDENTITY
	else:
		_frame_basis = Basis.IDENTITY


func sample_clash_motion(tau: float) -> Dictionary:
	var cl: Dictionary = _tier_dict().get("clash", _recipe.get("clash", {}))
	var hs := float(cl.get("hitstopS", 0.08))
	var tremor := float(cl.get("tremor", 1.0))
	var shake := float(cl.get("shake", 1.0))
	var hz := float(cl.get("tremorHz", 44.0))
	if tau < 0.0:
		return {"hitstop_active": false, "tremor_rad": 0.0, "shake_offset": Vector3.ZERO}
	var tr_deg := tremor * 1.6 * exp(-tau / (hs + 0.07)) * sin(TAU * hz * tau)
	var sh_amp := 0.006 * shake * exp(-tau / 0.06) if tau < 0.25 else 0.0
	return {
		"hitstop_active": tau < hs,
		"tremor_rad": deg_to_rad(tr_deg),
		"shake_offset": Vector3(sh_amp * sin(tau * 260.0), sh_amp * cos(tau * 310.0), 0.0)
	}


func _pick_sfx_variant(tk: String) -> Dictionary:
	var pool: Array = _loaded_sfx_pool.get(tk, [])
	if pool.is_empty():
		var fallback: AudioStream = _loaded_sfx.get(tk) if _loaded_sfx.get(tk) != null else _loaded_sfx.get("perfect")
		var def_pk := maxf(0.0, float(_tier_dict().get("sfx", {}).get("peakOffsetS", 0.015)))
		return {"stream": fallback, "peak": def_pk} if fallback != null else {}
	var idx := 0 if pool.size() == 1 else _sfx_rng.randi_range(0, pool.size() - 1)
	var last := int(_last_sfx_pick.get(tk, -1))
	if pool.size() > 1 and idx == last:
		idx = (idx + _sfx_rng.randi_range(1, pool.size() - 1)) % pool.size()
	_last_sfx_pick[tk] = idx
	return pool[idx]


func _play_tier_sfx(lead_s: float) -> void:
	if not sfx_enabled:
		return
	var tk := "normal" if _active_tier == "normal" else "perfect"
	var td := _tier_dict()
	var sfx_cfg: Dictionary = td.get("sfx", {})
	if not bool(sfx_cfg.get("enabled", true)):
		return
	var picked: Dictionary = _pending_sfx[tk] if _pending_sfx.get(tk) is Dictionary else _pick_sfx_variant(tk)
	_pending_sfx[tk] = null
	var stream: AudioStream = picked.get("stream", null)
	if stream == null:
		return
	var peak_off := maxf(0.0, float(picked.get("peak", sfx_cfg.get("peakOffsetS", 0.015))))
	var seek_t := maxf(0.0, peak_off - maxf(0.0, lead_s))
	var vol_db := normal_sfx_volume_db if tk == "normal" else perfect_sfx_volume_db
	if sfx_2d and _sfx_player_2d != null:
		_sfx_player_2d.stream = stream
		_sfx_player_2d.volume_db = vol_db
		_sfx_player_2d.play(seek_t)
	elif _sfx_player != null:
		_sfx_player.global_position = global_position
		_sfx_player.stream = stream
		_sfx_player.volume_db = vol_db
		_sfx_player.play(seek_t)


func trigger_pre_lead(lead_s: float, tier_override := "") -> void:
	if not _loaded and recipe_path != "":
		load_recipe(recipe_path)
	if not _loaded:
		return
	var raw_t := tier_override if tier_override != "" else String(_recipe.get("tier", "perfect"))
	_active_tier = "normal" if raw_t == "normal" else "perfect"
	var picked := _pick_sfx_variant(_active_tier)
	_pending_sfx[_active_tier] = picked if not picked.is_empty() else null
	var peak_off := float(picked.get("peak", _tier_dict().get("sfx", {}).get("peakOffsetS", 0.015)))
	if lead_s <= 0.001:
		trigger(_active_tier)
		return
	_pre_lead_tier = _active_tier
	_pre_lead_timer = lead_s
	if lead_s <= peak_off:
		_play_tier_sfx(lead_s)


func trigger(tier_override := "", seed_override := -1, world_basis_override := Basis.IDENTITY) -> void:
	if not _loaded and recipe_path != "":
		load_recipe(recipe_path)
	if not _loaded:
		return
	var raw_t := tier_override if tier_override != "" else String(_recipe.get("tier", "perfect"))
	_active_tier = "normal" if raw_t == "normal" else "perfect"
	var td := _tier_dict()
	_active_seed = seed_override if seed_override >= 0 else int(td.get("seed", _recipe.get("seed", 77)))
	if world_basis_override != Basis.IDENTITY:
		_frame_basis = world_basis_override
	var st_tex: Texture2D = star_tex if star_tex != null else _loaded_star_tex.get(_active_tier)
	if st_tex != null:
		_star_mat.set_shader_parameter("star_tex", st_tex)
	var fl_t: Texture2D = flash_tex if flash_tex != null else (_loaded_flash_tex.get(_active_tier) as Texture2D)
	if fl_t != null:
		_flash_mat.set_shader_parameter("flash_tex", fl_t)
	_pre_lead_timer = -1.0
	_reset_simulation()
	_tau = 0.0
	_playing = true
	_play_tier_sfx(0.0)
	_render_at_tau(0.0)


func seek(tau: float, tier_override := "", seed_override := -1) -> void:
	if not _loaded and recipe_path != "":
		load_recipe(recipe_path)
	if not _loaded:
		return
	var raw_t := tier_override if tier_override != "" else String(_recipe.get("tier", "perfect"))
	var want_tier := "normal" if raw_t == "normal" else "perfect"
	var want_seed := seed_override if seed_override >= 0 else int(_recipe.get("seed", 77))
	if tau < 0.0:
		_playing = false
		_hide_all()
		return
	if want_tier != _active_tier or want_seed != _active_seed or tau < _sim_t or (_sparks_state.is_empty() and _sim_t == 0.0):
		_active_tier = want_tier
		_active_seed = want_seed
		var st_tex: Texture2D = star_tex if star_tex != null else _loaded_star_tex.get(_active_tier)
		if st_tex != null:
			_star_mat.set_shader_parameter("star_tex", st_tex)
		var fl_t: Texture2D = flash_tex if flash_tex != null else (_loaded_flash_tex.get(_active_tier) as Texture2D)
		if fl_t != null:
			_flash_mat.set_shader_parameter("flash_tex", fl_t)
		_reset_simulation()
	_tau = tau
	_playing = tau < MAX_DURATION
	_step_simulation_to(tau)
	_render_at_tau(tau)


func _process(delta: float) -> void:
	if not _loaded:
		return
	if _pre_lead_timer >= 0.0:
		var prev_lead := _pre_lead_timer
		_pre_lead_timer -= minf(delta, 0.05)
		var peak_off := float(_tier_dict().get("sfx", {}).get("peakOffsetS", 0.015))
		if prev_lead > peak_off and _pre_lead_timer <= peak_off and _pre_lead_timer > 0.0:
			_play_tier_sfx(_pre_lead_timer)
		if _pre_lead_timer <= 0.0:
			_pre_lead_timer = -1.0
			_reset_simulation()
			_tau = 0.0
			_playing = true
			_render_at_tau(0.0)
			return
	if manual_clock or not _playing:
		return
	_tau += minf(delta, 0.05)
	if _tau >= MAX_DURATION:
		_playing = false
		_hide_all()
		return
	_step_simulation_to(_tau)
	_render_at_tau(_tau)


func _hide_all() -> void:
	if _star_inst: _star_inst.visible = false
	if _glow_inst: _glow_inst.visible = false
	if _flash_inst: _flash_inst.visible = false
	if _light: _light.light_energy = 0.0
	if _add_mesh: _add_mesh.clear_surfaces()
	if _dark_mesh: _dark_mesh.clear_surfaces()
	if _smoke_mesh: _smoke_mesh.clear_surfaces()
	if _debris_mm: _debris_mm.visible_instance_count = 0
	if _refr_inst: _refr_inst.visible = false


func _effective_flags() -> Dictionary:
	var has_tiers := _recipe.get("tiers", null) is Dictionary
	var td := _tier_dict()
	var is_norm := _active_tier == "normal"
	var lt_on := bool(td.get("light", td.get("star", {}).get("light", {})).get("enabled", true))
	if has_tiers:
		return {
			"star_on": bool(td.get("star", {}).get("enabled", true)),
			"light_on": lt_on,
			"flash_on": bool(td.get("flash", {}).get("enabled", true)),
			"sparks_on": bool(td.get("sparks", {}).get("enabled", true)),
			"ember_on": bool(td.get("ember", {}).get("enabled", false)),
			"ribbon_on": bool(td.get("ribbon", {}).get("enabled", not is_norm)),
			"smoke_on": bool(td.get("smoke", {}).get("enabled", not is_norm)),
			"debris_on": bool(td.get("debris", {}).get("enabled", not is_norm)),
			"refr_on": bool(td.get("refraction", {}).get("enabled", not is_norm)),
			"star_mul": 1.0,
			"spark_mul": 1.0,
			"flash_count_bonus": 0,
			"refr_double": false
		}
	return {
		"star_on": bool(td.get("star", {}).get("enabled", true)),
		"light_on": lt_on,
		"flash_on": bool(td.get("flash", {}).get("enabled", true)),
		"sparks_on": bool(td.get("sparks", {}).get("enabled", true)),
		"ember_on": bool(td.get("ember", {}).get("enabled", false)),
		"ribbon_on": false if is_norm else bool(td.get("ribbon", {}).get("enabled", true)),
		"smoke_on": false if is_norm else bool(td.get("smoke", {}).get("enabled", true)),
		"debris_on": false if is_norm else bool(td.get("debris", {}).get("enabled", true)),
		"refr_on": false if is_norm else bool(td.get("refraction", {}).get("enabled", true)),
		"star_mul": 0.82 if is_norm else 1.0,
		"spark_mul": 0.75 if is_norm else 1.0,
		"flash_count_bonus": 0,
		"refr_double": false
	}


static func _cone_dir(rng: SeededRng, axis_v: Variant, half_deg: float) -> Vector3:
	if axis_v == null:
		var z := 2.0 * rng.next() - 1.0
		var ph := TAU * rng.next()
		var q := sqrt(maxf(0.0, 1.0 - z * z))
		return Vector3(q * cos(ph), absf(z) * 0.6 + z * 0.4 + 0.15, q * sin(ph)).normalized()
	var axis: Vector3 = (axis_v as Vector3).normalized()
	var ct := lerpf(cos(deg_to_rad(half_deg)), 1.0, rng.next())
	var st := sqrt(maxf(0.0, 1.0 - ct * ct))
	var ph := TAU * rng.next()
	var ref := Vector3.UP if absf(axis.y) < 0.9 else Vector3.RIGHT
	var u := axis.cross(ref).normalized()
	var w := axis.cross(u).normalized()
	return (axis * ct + u * (st * cos(ph)) + w * (st * sin(ph))).normalized()


func _xf_dir(local_dir: Vector3) -> Vector3:
	return (global_transform.basis * (_frame_basis * local_dir)).normalized()


func _floor_world_y() -> float:
	var rel_y := floor_y_override if not is_nan(floor_y_override) else float(_recipe.get("frame", {}).get("floorY", -1.1))
	return global_position.y + rel_y * scale_mul


func _reset_simulation() -> void:
	_sim_t = 0.0
	_sparks_state.clear()
	_dark_state.clear()
	_debris_state.clear()
	_smoke_puffs_cfg.clear()

	var flags := _effective_flags()
	var td_root := _tier_dict()
	var origin := global_position
	var frm: Dictionary = _recipe.get("frame", {})
	var s1 := _xf_dir(_v3(frm.get("sprayMain", [0.3996, 0.9114, 0.0985])))
	var s2 := _xf_dir(_v3(frm.get("spraySecondary", [-0.6813, 0.5190, 0.5162])))
	var blade_a := _xf_dir(_v3(frm.get("bladeA", [0.5507, 0.8211, -0.1502])))
	var blade_b := _xf_dir(_v3(frm.get("bladeB", [-0.5698, 0.8098, 0.14])))
	var edge_a := _xf_dir(_v3(frm.get("edgeA", [0.7917, -0.5708, -0.2177])))

	var sp_cfg: Dictionary = td_root.get("sparks", {})
	var lobes_raw: Array = sp_cfg.get("lobes", [])
	var lobes: Array = []
	for lb in lobes_raw:
		var ax_raw: Variant = lb.get("axis", null)
		var ax_val: Variant = _xf_dir(_v3(ax_raw)) if (ax_raw is Array) else null
		lobes.append([ax_val, float(lb.get("share", 1.0)), float(lb.get("coneMul", 1.0))])
	if lobes.is_empty():
		lobes.append([s1, 0.65, 1.0])
		lobes.append([s2, 0.35, 1.0])

	var rng_sp := SeededRng.new(_hash_ints([_active_seed, 207, 101]))
	var tiers: Array = sp_cfg.get("tiers", [])
	if flags["sparks_on"]:
		for ti in range(tiers.size()):
			var t_cfg: Dictionary = tiers[ti]
			var cnt := int(round(float(t_cfg.get("count", 60)) * float(flags["spark_mul"])))
			var spd_r: Array = t_cfg.get("speed", [2.0, 8.0])
			var drg_r: Array = t_cfg.get("drag", [1.0, 3.0])
			var lif_r: Array = t_cfg.get("life", [0.3, 1.0])
			var wid_r: Array = t_cfg.get("width", [0.001, 0.002])
			var ht_r: Array = t_cfg.get("heat", [0.9, 1.0])
			var cl_r: Array = t_cfg.get("cool", [0.4, 1.0])
			var cone_deg := float(t_cfg.get("cone", 40.0))
			var grav_k := float(t_cfg.get("gravity", 1.0))
			var clip_v := float(t_cfg.get("clip", 0.0))
			var streak_k := float(t_cfg.get("streak", 0.032))
			var max_len := float(t_cfg.get("maxLen", 0.42))

			for i in range(cnt):
				var pick := rng_sp.next()
				var chosen: Array = lobes[lobes.size() - 1]
				for lb in lobes:
					if pick < float(lb[1]):
						chosen = lb
						break
					pick -= float(lb[1])
				var d := _cone_dir(rng_sp, chosen[0], cone_deg * float(chosen[2]))
				var pw := 0.6 if ti == 0 else 1.4
				var sp := lerpf(float(spd_r[0]), float(spd_r[1]), pow(rng_sp.next(), pw)) * scale_mul
				var delay := (rng_sp.next() * 0.018) if ti == 1 else (pow(rng_sp.next(), 2.0) * 0.03 if ti == 0 else 0.0)
				_sparks_state.append({
					"ti": ti, "p": origin + d * (0.01 * scale_mul), "v": d * sp,
					"drag": rng_sp.range_f(float(drg_r[0]), float(drg_r[1])),
					"life": minf(MAX_DURATION, rng_sp.range_f(float(lif_r[0]), float(lif_r[1]))),
					"w": rng_sp.range_f(float(wid_r[0]), float(wid_r[1])) * scale_mul,
					"heat": rng_sp.range_f(float(ht_r[0]), float(ht_r[1])),
					"cool": rng_sp.range_f(float(cl_r[0]), float(cl_r[1])),
					"g": grav_k, "delay": delay, "dist": 0.0, "bounces": 0, "id": i + ti * 1000,
					"bri": rng_sp.range_f(0.45, 1.25),
					"lk": lerpf(0.5, 2.4, pow(rng_sp.next(), 2.2)) if ti == 0 else lerpf(0.55, 1.7, pow(rng_sp.next(), 1.5)),
					"clip": clip_v, "streak": streak_k, "max_len": max_len * scale_mul,
					"leader": false, "trail": [], "curl": Vector3.ZERO, "rb_mode": ""
				})

	var em_cfg: Dictionary = td_root.get("ember", {})
	if flags.get("ember_on", false) and not em_cfg.is_empty():
		var rng_em := SeededRng.new(_hash_ints([_active_seed, int(em_cfg.get("seed", 25)), 102]))
		var em_tier: Dictionary = em_cfg.get("tier", {})
		var em_cnt := int(round(float(em_tier.get("count", 68)) * float(flags["spark_mul"])))
		var em_spd: Array = em_tier.get("speed", [2.0, 7.0])
		var em_drg: Array = em_tier.get("drag", [2.2, 4.4])
		var em_lif: Array = em_tier.get("life", [0.75, 1.7])
		var em_wid: Array = em_tier.get("width", [0.0046, 0.0088])
		var em_ht: Array = em_tier.get("heat", [0.92, 1.0])
		var em_cl: Array = em_tier.get("cool", [0.62, 1.35])
		var em_cone := float(em_tier.get("cone", 58.0))
		var em_grav := float(em_cfg.get("gravity", em_tier.get("gravity", 3.6)))
		var em_lobes := [[s1, 0.58, 1.0], [s2, 0.28, 1.05], [null, 0.14, 1.2]]
		for i in range(em_cnt):
			var pk := rng_em.next()
			var ch: Array = em_lobes[em_lobes.size() - 1]
			for lb in em_lobes:
				if pk < float(lb[1]):
					ch = lb
					break
				pk -= float(lb[1])
			var d := _cone_dir(rng_em, ch[0], em_cone * float(ch[2]))
			var sp := lerpf(float(em_spd[0]), float(em_spd[1]), pow(rng_em.next(), 1.25)) * scale_mul
			_sparks_state.append({
				"ti": 2, "p": origin + d * (0.01 * scale_mul), "v": d * sp,
				"drag": rng_em.range_f(float(em_drg[0]), float(em_drg[1])),
				"life": minf(MAX_DURATION, rng_em.range_f(float(em_lif[0]), float(em_lif[1]))),
				"w": rng_em.range_f(float(em_wid[0]), float(em_wid[1])) * scale_mul,
				"heat": rng_em.range_f(float(em_ht[0]), float(em_ht[1])),
				"cool": rng_em.range_f(float(em_cl[0]), float(em_cl[1])),
				"g": 1.0, "g_abs": em_grav, "delay": rng_em.next() * 0.012, "dist": 0.0, "bounces": 0, "id": 20000 + i,
				"bri": rng_em.range_f(0.65, 1.35), "lk": 1.0, "clip": 0.3333, "streak": 0.006, "max_len": 0.035 * scale_mul,
				"standalone_ember": true, "leader": false, "trail": [], "curl": Vector3.ZERO, "rb_mode": ""
			})

	var rb_cfg: Dictionary = td_root.get("ribbon", {})
	if flags["ribbon_on"]:
		var rng_rb := SeededRng.new(_hash_ints([_active_seed, 207, 505]))
		var nl := maxi(1, int(rb_cfg.get("leaders", 12)))
		var rb_style := String(rb_cfg.get("style", "whip"))
		var sph_r := clampf(float(rb_cfg.get("sphereRadiusM", 0.34)), 0.15, 0.75) * scale_mul
		var max_ang := deg_to_rad(clampf(float(rb_cfg.get("sphereConeDeg", 48.0)), 20.0, 72.0))
		var sph_dir := _xf_dir(Vector3(-0.99, -0.03, 0.02).normalized())
		var p_apex := origin + sph_dir * (0.055 * scale_mul)
		var sph_ctr := origin + sph_dir * (sph_r + 0.055 * scale_mul)
		var v_ax := (blade_a + blade_b).normalized()
		if v_ax.length_squared() < 0.1:
			v_ax = Vector3.UP
		var spin_sign := 1.0 if rng_rb.next() < 0.5 else -1.0
		if rb_style == "sphereScatter":
			# Invisible fluted jelly-cup shell obstacle (blunt rounded nose + longitudinal fluted conical wall + flared rim)
			var ref_u := Vector3.UP if absf(sph_dir.y) < 0.9 else Vector3.RIGHT
			var e1 := sph_dir.cross(ref_u).normalized()
			var e2 := sph_dir.cross(e1).normalized()
			var n_ribs := 7 + int(floor(rng_rb.next() * 5.0))
			var ph0 := rng_rb.next() * TAU
			var ph1 := rng_rb.next() * TAU
			var ph2 := rng_rb.next() * TAU
			for i in range(nl):
				var phi := (float(i) / float(nl)) * TAU + (rng_rb.next() - 0.5) * (2.2 / float(maxi(4, nl)))
				var flute := 1.0 + 0.21 * cos(float(n_ribs) * phi + ph0) + 0.10 * sin(3.0 * phi + ph1) + 0.06 * cos(2.0 * phi + ph2)
				var rad_dir := (e1 * (cos(phi) * 1.06) + e2 * (sin(phi) * 0.86)).normalized()
				var strat := fmod(float(i) * 0.6180339887, 1.0)
				var rho := 0.25 if nl == 1 else (rng_rb.range_f(0.08, 0.14) if i == 0 else lerpf(0.20, 1.0, strat * 0.72 + rng_rb.next() * 0.28))
				var alpha := clampf(rho * (0.80 + 0.28 * flute) * max_ang, 0.05, 1.18)
				var l_cup := sph_r * lerpf(1.55, 1.12, rho) * (0.90 + 0.14 * flute)
				var r_rim := sph_r * (0.28 + 0.34 * rho) * flute + l_cup * tan(alpha) * 0.56
				var p_exit := p_apex + sph_dir * l_cup + rad_dir * r_rim
				var d_out := (sph_dir * cos(alpha) + rad_dir * sin(alpha)).normalized()
				var p1 := p_apex + sph_dir * (l_cup * 0.24) + rad_dir * (r_rim * 0.78)
				var d0 := (p1 - origin).normalized()
				var sp0 := rng_rb.range_f(8.6, 10.8) * scale_mul
				var arc_len := maxf(0.14 * scale_mul, origin.distance_to(p1) + p1.distance_to(p_exit))
				var sw_ax := d_out.cross(rad_dir).normalized()
				var flare_ax := (sw_ax * (0.72 * (1.0 if (i % 2) == 1 else -1.0)) + rad_dir * 0.32).normalized()
				var post_curl_s := flare_ax * (rng_rb.range_f(2.2, 4.4) * (0.45 + 0.55 * rho))
				_sparks_state.append({
					"ti": 1, "p": origin, "v": d0 * sp0,
					"drag": 0.02, "life": minf(MAX_DURATION, rng_rb.range_f(0.72, 1.12)),
					"w": 0.0016 * scale_mul, "heat": 1.0, "cool": rng_rb.range_f(0.90, 1.30),
					"g": 0.0, "delay": rng_rb.next() * 0.006, "dist": 0.0, "bounces": 0, "id": 9000 + i,
					"bri": 1.42, "lk": 1.3, "clip": 0.0,
					"streak": 0.032, "max_len": 0.42 * scale_mul,
					"leader": true, "has_trail": true, "trail": [], "curl": Vector3.ZERO, "rb_mode": rb_style,
					"sph_ctr": sph_ctr, "sph_r": sph_r, "sph_u": sph_dir, "flute": flute,
					"p0": origin, "p1": p1, "p_exit": p_exit, "d_out": d_out,
					"arc_len": arc_len, "s_param": 0.0, "surf_spd": sp0, "left_sphere": false,
					"post_curl": post_curl_s, "tip_dist": 0.75 * scale_mul, "slid_off": false, "flick": Vector3.UP,
					"v_ax": v_ax, "v_orig": origin, "v_omega": 0.0, "skim_sign": 0.0
				})
		else:
			for i in range(nl):
				var d := Vector3.UP
				var sp0 := rng_rb.range_f(5.0, 8.5) * scale_mul
				var drg0 := rng_rb.range_f(0.5, 1.0)
				var g0 := 1.0
				var curl0 := Vector3.ZERO
				var post_curl := Vector3(rng_rb.next() - 0.5, rng_rb.next() - 0.5, rng_rb.next() - 0.5).normalized() * rng_rb.range_f(2.0, 4.2)
				var tip_dist := 0.75 * scale_mul
				var flick := Vector3.UP
				var rad_dir := Vector3.RIGHT
				if rb_style == "bladeSlide":
					var on_b := (i % 2) == 1
					var b_dir := blade_b if on_b else blade_a
					var side_v := b_dir.cross(edge_a).normalized()
					d = (b_dir + side_v * ((rng_rb.next() - 0.5) * 0.08)).normalized()
					sp0 = rng_rb.range_f(12.5, 16.5) * scale_mul
					drg0 = 0.08
					g0 = 0.0
					tip_dist = (0.79 if on_b else 0.75) * scale_mul
					flick = (edge_a * (-0.65 if on_b else 0.65) + Vector3.UP * 0.55).normalized()
					post_curl = side_v * ((1.0 if rng_rb.next() < 0.5 else -1.0) * rng_rb.range_f(6.5, 10.5))
				elif rb_style == "deflectCone":
					var pu := s1.normalized()
					var pv := (-edge_a - pu * (-edge_a).dot(pu)).normalized()
					var ang := lerpf(-0.92, 0.92, (float(i) + 0.2 + 0.6 * rng_rb.next()) / float(nl))
					d = (pu * cos(ang) + pv * sin(ang)).normalized()
					sp0 = rng_rb.range_f(6.4, 9.6) * scale_mul
					drg0 = rng_rb.range_f(0.85, 1.25)
					g0 = 1.15
				elif rb_style == "vortexWrap":
					var ref_v := Vector3.UP if absf(v_ax.y) < 0.9 else Vector3.RIGHT
					var u1 := v_ax.cross(ref_v).normalized()
					var u2 := v_ax.cross(u1).normalized()
					var ph := (float(i) / float(nl)) * TAU + rng_rb.next() * 0.35
					var r_v := u1 * cos(ph) + u2 * sin(ph)
					var tang := v_ax.cross(r_v) * spin_sign
					d = (v_ax * rng_rb.range_f(0.52, 0.78) + tang * 0.68 + r_v * 0.22).normalized()
					sp0 = rng_rb.range_f(5.8, 8.6) * scale_mul
					drg0 = rng_rb.range_f(0.55, 0.95)
					g0 = 0.25
				elif rb_style == "groundSkim":
					var az := lerpf(-2.5, 2.5, (float(i) + 0.25 + 0.5 * rng_rb.next()) / float(nl))
					d = _xf_dir(Vector3(sin(az) * 0.62, -rng_rb.range_f(0.78, 0.95), cos(az) * 0.52 + 0.16).normalized())
					sp0 = rng_rb.range_f(10.5, 14.8) * scale_mul
					drg0 = 0.32
					g0 = 1.8
				else:
					var base_s := s2 if (i % 2 == 1) else s1
					var ax := (base_s * 0.8 + Vector3.UP * 0.5).normalized()
					d = _cone_dir(rng_rb, ax, 40.0)
					curl0 = post_curl
				_sparks_state.append({
					"ti": 1, "p": origin + d * (0.01 * scale_mul), "v": d * sp0,
					"drag": drg0, "life": minf(MAX_DURATION, rng_rb.range_f(0.8, 1.3)),
					"w": 0.0016 * scale_mul, "heat": 1.0, "cool": rng_rb.range_f(0.8, 1.2),
					"g": g0, "delay": rng_rb.next() * 0.012, "dist": 0.0, "bounces": 0, "id": 9000 + i,
					"bri": 1.35, "lk": 1.3, "clip": 0.0, "streak": 0.033, "max_len": 0.44 * scale_mul,
					"leader": true, "has_trail": true, "trail": [], "curl": curl0, "rb_mode": rb_style,
					"sph_ctr": sph_ctr, "sph_r": sph_r, "sph_u": sph_dir, "rad_dir": rad_dir,
					"surf_spd": sp0, "on_sphere": false, "left_sphere": false, "entry_dot": 0.0, "exit_dot": -0.10,
					"post_curl": post_curl, "tip_dist": tip_dist, "slid_off": false, "flick": flick,
					"v_ax": v_ax, "v_orig": origin, "v_omega": spin_sign * rng_rb.range_f(15.0, 22.0),
					"skim_sign": (1.0 if (i % 2 == 1) else -1.0) * rng_rb.range_f(3.6, 6.4)
				})

	var sm_cfg: Dictionary = td_root.get("smoke", {})
	if flags["smoke_on"]:
		var rng_dk := SeededRng.new(_hash_ints([_active_seed, 307, 202]))
		var dk_cnt := int(sm_cfg.get("darkSparks", 30))
		for i in range(dk_cnt):
			var d := _cone_dir(rng_dk, s1 if rng_dk.next() < 0.6 else s2, 55.0)
			_dark_state.append({
				"p": origin, "v": d * (rng_dk.range_f(2.5, 7.5) * scale_mul),
				"drag": rng_dk.range_f(1.5, 3.0), "life": rng_dk.range_f(0.35, 0.85),
				"w": rng_dk.range_f(0.003, 0.006) * scale_mul, "g": 0.8, "dist": 0.0,
				"bounces": 0, "curl": Vector3.ZERO, "rb_mode": ""
			})

		var rng_pf := SeededRng.new(_hash_ints([_active_seed, 307, 404]))
		var style := String(sm_cfg.get("style", "ink"))
		var is_ink := style == "ink"
		var is_wisp := style == "wisp"
		var is_puff := not is_ink and not is_wisp
		var puff_cnt := int(sm_cfg.get("puffs", 10))
		if _smoke_is_mask:
			puff_cnt = maxi(1, int(round(float(puff_cnt) / 4.0)))
		var sz_mul := float(sm_cfg.get("sizeMul", 1.0)) * scale_mul
		var lf_mul := float(sm_cfg.get("lifeMul", 1.0))
		for i in range(puff_cnt):
			var d := _cone_dir(rng_pf, s1 if rng_pf.next() < 0.55 else s2, 60.0 if is_ink else 50.0)
			var spd := rng_pf.range_f(2.0, 4.5) if is_ink else (rng_pf.range_f(1.2, 2.6) if is_wisp else rng_pf.range_f(0.6, 1.7))
			var life := rng_pf.range_f(0.35, 0.7) * lf_mul * (1.2 if _smoke_is_mask else 1.0) * (1.15 if is_ink else 1.0)
			var s0 := rng_pf.range_f(0.2, 0.36) * sz_mul * (2.6 if _smoke_is_mask else 1.0) * (0.7 if is_wisp else 1.0)
			_smoke_puffs_cfg.append({
				"d": d, "spd": spd * scale_mul, "life": life, "s0": s0,
				"ox": rng_pf.next(), "oy": rng_pf.next(), "rot": rng_pf.next() * TAU,
				"del": rng_pf.next() * 0.03, "is_ink": is_ink, "is_puff": is_puff
			})

	var db_cfg: Dictionary = td_root.get("debris", {})
	if flags["debris_on"]:
		var rng_db := SeededRng.new(_hash_ints([_active_seed, 407, 303]))
		var db_cnt := mini(128, int(db_cfg.get("count", 24)))
		var sz_r: Array = db_cfg.get("sizeM", [0.004, 0.011])
		var sp_r: Array = db_cfg.get("speedMS", [1.2, 4.8])
		var sz_m := float(db_cfg.get("sizeMul", 1.0)) * scale_mul
		var sp_m := float(db_cfg.get("speedMul", 1.0)) * scale_mul
		for i in range(db_cnt):
			var d := _cone_dir(rng_db, s1 if rng_db.next() < 0.55 else s2, 60.0)
			var ax := Vector3(rng_db.next() - 0.5, rng_db.next() - 0.5, rng_db.next() - 0.5).normalized()
			if ax.length_squared() < 1e-5:
				ax = Vector3.UP
			_debris_state.append({
				"p": origin, "v": d * (rng_db.range_f(float(sp_r[0]), float(sp_r[1])) * sp_m),
				"drag": rng_db.range_f(0.5, 1.4), "g": 1.0,
				"size": rng_db.range_f(float(sz_r[0]), float(sz_r[1])) * sz_m,
				"ax": ax, "spin": rng_db.range_f(15.0, 45.0) * (-1.0 if rng_db.next() < 0.5 else 1.0),
				"dist": 0.0, "bounces": 0, "curl": Vector3.ZERO, "rb_mode": ""
			})


func _step_particle(q: Dictionary, dt: float, bounce: float, gmul: float, floor_y: float) -> void:
	var v: Vector3 = q["v"]
	var p: Vector3 = q["p"]
	var rbm := String(q.get("rb_mode", ""))
	v.y -= (float(q["g_abs"]) * scale_mul if q.has("g_abs") else gmul * float(q["g"])) * dt
	if rbm == "vortexWrap":
		var v_ax: Vector3 = q["v_ax"]
		var rel: Vector3 = p - (q["v_orig"] as Vector3)
		rel -= v_ax * rel.dot(v_ax)
		if rel.length_squared() > 1e-8:
			var rn := rel.normalized()
			var tang := v_ax.cross(rn)
			v += (-rn * (v.length() * 2.8) + tang * (float(q["v_omega"]) * 0.32 * scale_mul)) * dt
	var curl: Vector3 = q["curl"]
	if curl.length_squared() > 1e-6:
		v += v.cross(curl) * dt
	v *= 1.0 / (1.0 + float(q["drag"]) * dt)
	var old_p := p
	p += v * dt
	if rbm == "sphereScatter":
		if not bool(q["left_sphere"]):
			var arc_len := float(q["arc_len"])
			var s_spd := float(q["surf_spd"])
			var s_p := float(q["s_param"]) + (s_spd / arc_len) * dt
			q["s_param"] = s_p
			var p0: Vector3 = q["p0"]
			var p1: Vector3 = q["p1"]
			var p_ex: Vector3 = q["p_exit"]
			var d_out: Vector3 = q["d_out"]
			if s_p < 1.0:
				var om := 1.0 - s_p
				p = p0 * (om * om) + p1 * (2.0 * om * s_p) + p_ex * (s_p * s_p)
				var tan_v := (p1 - p0) * om + (p_ex - p1) * s_p
				v = (tan_v.normalized() if tan_v.length_squared() > 1e-8 else d_out) * s_spd
			else:
				var over := maxf(0.0, (s_p - 1.0) * arc_len)
				q["left_sphere"] = true
				q["g"] = 0.52
				q["drag"] = 0.75
				q["curl"] = q["post_curl"]
				p = p_ex + d_out * over
				v = d_out * s_spd
	elif rbm == "bladeSlide" and not bool(q["slid_off"]) and float(q["dist"]) >= float(q["tip_dist"]):
		q["slid_off"] = true
		v = (v + (q["flick"] as Vector3) * (v.length() * 0.46)) * 0.72
		q["g"] = 0.75
		q["drag"] = 1.55
		q["curl"] = q["post_curl"]
	var fy := floor_y + 0.002 * scale_mul
	if p.y < fy:
		if rbm == "groundSkim":
			p.y = fy + 0.003 * scale_mul
			if int(q["bounces"]) == 0:
				var sp_h := v.length() * 0.82
				var hl := maxf(1e-4, Vector2(v.x, v.z).length())
				v.x = v.x / hl * sp_h
				v.z = v.z / hl * sp_h
				v.y = 0.04 * scale_mul
				q["g"] = 0.05
				q["drag"] = 1.05
				q["curl"] = Vector3(0.0, float(q["skim_sign"]), 0.0)
				q["bounces"] = 1
			elif v.y < 0.0:
				v.y = 0.0
		elif rbm == "sphereScatter":
			p.y = fy + 0.028 * scale_mul
			if v.y < 0.0:
				v.y = maxf(0.08 * scale_mul, -v.y * 0.12)
			v.x *= 0.96
			v.z *= 0.96
		else:
			p.y = fy + (fy - p.y) * 0.2
			if v.y < 0.0:
				var b_cnt := int(q["bounces"])
				v.y = -v.y * bounce * (0.7 if b_cnt > 0 else 1.0)
				v.x *= 0.72
				v.z *= 0.72
				q["bounces"] = b_cnt + 1
				if q.has("cool"):
					q["cool"] = float(q["cool"]) * 0.75
			if absf(v.y) < 0.25 * scale_mul:
				v.y = 0.0
				var sk := maxf(0.0, 1.0 - 6.0 * dt)
				v.x *= sk
				v.z *= sk
	q["v"] = v
	q["p"] = p
	q["dist"] = float(q["dist"]) + p.distance_to(old_p)


func _step_simulation_to(target_tau: float) -> void:
	var td_root := _tier_dict()
	var sp_cfg: Dictionary = td_root.get("sparks", {})
	var gmul := float(sp_cfg.get("gravity", 12.0)) * scale_mul
	var bounce := float(sp_cfg.get("floorBounce", 0.45))
	var db_bounce := float(td_root.get("debris", {}).get("floorBounce", 0.32))
	var trail_s := float(td_root.get("ribbon", {}).get("trailS", 0.25))
	var floor_y := _floor_world_y()

	while _sim_t + FIXED_DT <= target_tau + 1e-9:
		_sim_t += FIXED_DT
		for q in _sparks_state:
			var del := float(q["delay"])
			if _sim_t < del or (_sim_t - del) > float(q["life"]):
				continue
			_step_particle(q, FIXED_DT, bounce, gmul, floor_y)
			if bool(q["leader"]) and bool(q.get("has_trail", true)):
				var tr: Array = q["trail"]
				tr.append([q["p"], _sim_t])
				while not tr.is_empty() and (_sim_t - float(tr[0][1])) > trail_s:
					tr.pop_front()
		for q in _dark_state:
			if _sim_t <= float(q["life"]):
				_step_particle(q, FIXED_DT, 0.2, gmul, floor_y)
		for q in _debris_state:
			_step_particle(q, FIXED_DT, db_bounce, gmul, floor_y)


static func _heat_col(h: float, hot: Vector3, mid: Vector3, cool: Vector3, hdr: float) -> Vector3:
	var c: Vector3
	if h > 0.7:
		c = mid.lerp(hot, (h - 0.7) / 0.3)
	elif h > 0.32:
		c = cool.lerp(mid, (h - 0.32) / 0.38)
	else:
		c = cool * (h / 0.32)
	var e := hdr * pow(maxf(h, 0.0), 2.2) + 2.6 * maxf(h, 0.0)
	return c * e


static func _emit_quad(im: ImmediateMesh, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, c0: Color, c1: Color, mode: float, uvs: Array) -> void:
	# uvs: [u0,v0, u1,v1, u2,v2, u3,v3]
	var uv2 := Vector2(mode, 0.0)
	im.surface_set_color(c0); im.surface_set_uv(Vector2(uvs[0], uvs[1])); im.surface_set_uv2(uv2); im.surface_add_vertex(p0)
	im.surface_set_color(c0); im.surface_set_uv(Vector2(uvs[2], uvs[3])); im.surface_set_uv2(uv2); im.surface_add_vertex(p1)
	im.surface_set_color(c1); im.surface_set_uv(Vector2(uvs[4], uvs[5])); im.surface_set_uv2(uv2); im.surface_add_vertex(p2)

	im.surface_set_color(c0); im.surface_set_uv(Vector2(uvs[0], uvs[1])); im.surface_set_uv2(uv2); im.surface_add_vertex(p0)
	im.surface_set_color(c1); im.surface_set_uv(Vector2(uvs[4], uvs[5])); im.surface_set_uv2(uv2); im.surface_add_vertex(p2)
	im.surface_set_color(c1); im.surface_set_uv(Vector2(uvs[6], uvs[7])); im.surface_set_uv2(uv2); im.surface_add_vertex(p3)


func _render_at_tau(tau: float) -> void:
	var vp := get_viewport()
	var cam := vp.get_camera_3d() if vp else null
	var origin := global_position
	var cam_pos := cam.global_position if cam else (origin + Vector3(0.28, 0.45, 2.15))
	var cam_basis := cam.global_transform.basis if cam else Basis.IDENTITY
	var cam_right := cam_basis.x.normalized()
	var cam_up := cam_basis.y.normalized()
	var to_cam := (cam_pos - origin).normalized()
	if to_cam.length_squared() < 1e-6:
		to_cam = Vector3.BACK

	var vp_h := float(vp.get_visible_rect().size.y) if vp else 1080.0
	var fov_deg := cam.fov if cam else 42.0
	var px_k := 2.0 * tan(deg_to_rad(fov_deg * 0.5)) / maxf(1.0, vp_h)

	var flags := _effective_flags()
	var td_root := _tier_dict()

	# 1a. Star (pinpoint + razor rays) & 1b. Standalone Light + Atmospheric Glow
	var st_cfg: Dictionary = td_root.get("star", {})
	_star_inst.visible = false
	_glow_inst.visible = false
	_flash_inst.visible = false
	_light.light_energy = 0.0
	var rise := _sstep(0.0, 0.012, tau)
	var edge_c := _col_v3(st_cfg.get("edge", [1, 0.45, 0.11]))
	if flags["star_on"]:
		var life_s := float(st_cfg.get("lifeS", 0.13))
		var dec := exp(-tau / maxf(0.005, life_s * 0.38)) if tau < life_s * 1.8 else 0.0
		var inten := rise * dec
		var core_c := _col_v3(st_cfg.get("core", [1, 1, 1]))
		if inten > 0.002:
			var sz_m := float(st_cfg.get("sizeM", 1.0)) * float(flags["star_mul"]) * scale_mul
			var sc := sz_m * (0.5 + 0.5 * _sstep(0.0, 0.02, tau)) * (1.0 + 0.35 * tau / maxf(0.01, life_s))
			var star_pos := origin + to_cam * (0.06 * scale_mul)
			var rot_z := float(_hash_ints([_active_seed, 107]) % 628) / 100.0 + tau * 0.6
			var star_b := cam_basis * Basis(Vector3.FORWARD, rot_z)
			_star_inst.global_transform = Transform3D(star_b.scaled(Vector3.ONE * sc), star_pos)
			_star_mat.set_shader_parameter("core_col", core_c)
			_star_mat.set_shader_parameter("edge_col", edge_c)
			_star_mat.set_shader_parameter("gain", float(st_cfg.get("hdr", 24.0)) * inten)
			_star_mat.set_shader_parameter("contrast_pow", float(st_cfg.get("contrastPow", 2.2)))
			_star_inst.visible = true

	if bool(flags.get("light_on", true)):
		var lt_cfg: Dictionary = td_root.get("light", st_cfg.get("light", {}))
		var lt_int := float(lt_cfg.get("intensity", 16.0))
		var lt_dec := maxf(0.01, float(lt_cfg.get("decayS", 0.085)))
		var lt_rng := maxf(0.5, float(lt_cfg.get("rangeM", 6.5))) * scale_mul
		var lt_off := float(lt_cfg.get("offsetTowardsCamM", 0.18)) * scale_mul
		var lt_raw_c := _col_v3(lt_cfg.get("color", [edge_c.x, edge_c.y, edge_c.z]))
		var lt_col := lt_raw_c.lerp(Vector3.ONE, 0.32)
		_light.omni_range = lt_rng
		_light.global_position = origin + to_cam * lt_off
		_light.light_color = Color(lt_col.x, lt_col.y, lt_col.z, 1.0)
		_light.light_energy = (lt_int * 0.18) * rise * exp(-tau / lt_dec) if tau < maxf(0.55, lt_dec * 7.5) else 0.0

		var glow_cfg: Dictionary = lt_cfg.get("glow", st_cfg.get("glow", {}))
		var glow_amt := float(glow_cfg.get("amount", 0.38))
		if glow_amt > 0.002:
			var g_gain := (0.16 + 0.34 * glow_amt) * rise * exp(-tau / maxf(0.045, lt_dec * 1.95))
			if g_gain > 0.0015:
				var glow_sz := (1.65 + 1.1 * glow_amt) * float(glow_cfg.get("sizeMul", 1.0)) * scale_mul
				var glow_pos := origin + to_cam * minf(0.14 * scale_mul, lt_off * 0.5)
				_glow_inst.global_transform = Transform3D(cam_basis.scaled(Vector3.ONE * glow_sz), glow_pos)
				_glow_mat.set_shader_parameter("edge_col", lt_raw_c)
				_glow_mat.set_shader_parameter("gain", g_gain)
				_glow_inst.visible = true

	# 2 & 3 & 4. Additive batch: Flash 90-deg Crossed Needles + 3-Tier Sparks + Ribbons + Debris Hot Tips
	_add_mesh.clear_surfaces()
	var add_started := false
	var std_uv := [-1.0, 0.0, 1.0, 0.0, 1.0, 1.0, -1.0, 1.0]
	var speck_uv := [-1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0]

	var fl_cfg: Dictionary = td_root.get("flash", {})
	var is_circ_flash := fl_cfg.has("style") or fl_cfg.has("sizeM") or fl_cfg.has("opacity")
	var nd_cfg: Dictionary = td_root.get("needles", {})
	if flags["flash_on"] and is_circ_flash:
		var fl_life := maxf(0.02, float(fl_cfg.get("lifeS", 0.14)))
		var fl_op := float(fl_cfg.get("opacity", 0.68))
		if fl_op > 0.001 and tau < fl_life * 1.75:
			var fl_fade := _sstep(0.0, 0.008, tau) * pow(clampf(1.0 - tau / (fl_life * 1.75), 0.0, 1.0), 1.35)
			if fl_fade * fl_op > 0.001:
				var fl_ex := float(fl_cfg.get("expand", 0.55))
				var fl_grow := lerpf(maxf(0.2, 1.0 - fl_ex * 0.55), 1.0 + fl_ex * 0.45, 1.0 - exp(-tau / maxf(0.014, fl_life * 0.42)))
				var fl_sz := float(fl_cfg.get("sizeM", 1.05)) * fl_grow * scale_mul
				var fl_pos := origin + to_cam * (0.035 * scale_mul)
				var fl_seed := int(fl_cfg.get("seed", 17))
				var fl_rot := float(_hash_ints([_active_seed, fl_seed]) % 628) / 100.0 + tau * float(fl_cfg.get("spin", 0.0))
				var fl_b := cam_basis * Basis(Vector3.FORWARD, fl_rot)
				_flash_inst.global_transform = Transform3D(fl_b.scaled(Vector3.ONE * fl_sz), fl_pos)
				_flash_mat.set_shader_parameter("core_col", _col_v3(fl_cfg.get("core", [1.0, 0.96, 0.85])))
				_flash_mat.set_shader_parameter("edge_col", _col_v3(fl_cfg.get("color", [1.0, 0.55, 0.16])))
				_flash_mat.set_shader_parameter("opacity_fade", fl_op * fl_fade)
				_flash_mat.set_shader_parameter("blur_amt", clampf(float(fl_cfg.get("blur", 0.28)), 0.02, 0.95))
				_flash_mat.set_shader_parameter("hollow_amt", clampf(float(fl_cfg.get("hollow", 0.0)), 0.0, 0.85))
				_flash_mat.set_shader_parameter("hdr_gain", float(fl_cfg.get("hdr", 9.5)))
				_flash_inst.visible = true
	var needle_src: Dictionary = nd_cfg if not nd_cfg.is_empty() else (fl_cfg if not is_circ_flash else {})
	var needle_on := bool(nd_cfg.get("enabled", true)) if not nd_cfg.is_empty() else (flags["flash_on"] and not is_circ_flash)
	if needle_on and not needle_src.is_empty():
		var fl_life := maxf(0.02, float(needle_src.get("lifeS", 0.075)))
		if tau < fl_life * 1.4:
			var fk := exp(-tau / maxf(0.005, fl_life * 0.42))
			var grow := (0.45 + 0.55 * _sstep(0.0, 0.022, tau)) * (1.0 + 0.3 * tau / maxf(0.01, fl_life))
			var thin := pow(clampf(1.0 - tau / (fl_life * 1.4), 0.0, 1.0), 0.6)
			var fcol := _col_v3(needle_src.get("color", [1, 0.76, 0.38])) * (float(needle_src.get("hdr", 28.0)) * fk)
			var axes_raw: Array = needle_src.get("axes", [[0.17, 0.93, -0.33], [0.98, -0.17, 0.04], [0.55, 0.78, -0.29], [0.0, 1.0, 0.0]])
			var lmul: Array = needle_src.get("lengthMul", [1.0, 0.62, 0.42, 0.32])
			var cnt := mini(4, int(needle_src.get("count", 2)) + (0 if not nd_cfg.is_empty() else int(flags["flash_count_bonus"])))
			var spread := float(needle_src.get("spreadDeg", 22.0))
			var base_len := float(needle_src.get("lengthM", 2.45)) * scale_mul
			var wr := float(needle_src.get("widthRatio", 0.0022))

			for i in range(cnt):
				var ax_local := _v3(axes_raw[i % axes_raw.size()]).normalized()
				var jitter := float((_hash_ints([_active_seed, i]) % 40) - 20) if i > 0 else 0.0
				var ax_world := _xf_dir(ax_local).rotated(to_cam, deg_to_rad(spread + jitter)).normalized()
				var lm := float(lmul[i % lmul.size()])
				var seg_l := base_len * lm * grow
				var hw := base_len * lm * wr * thin
				var center := origin + to_cam * (0.04 * scale_mul)
				var min_hw := 0.75 * px_k * cam_pos.distance_to(center)
				var col_scale := 1.0
				if hw < min_hw and min_hw > 1e-6:
					col_scale = hw / min_hw
					hw = min_hw
				var p0 := center - ax_world * (seg_l * 0.5)
				var p1 := center + ax_world * (seg_l * 0.5)
				var n1 := ax_world.cross(to_cam).normalized()
				if n1.length_squared() < 1e-5:
					n1 = ax_world.cross(Vector3.UP).normalized()
				var n2 := ax_world.cross(n1).normalized()
				var qc := Color(fcol.x * col_scale, fcol.y * col_scale, fcol.z * col_scale, 1.0)
				if not add_started:
					_add_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
					add_started = true
				for n in [n1, n2]:
					_emit_quad(_add_mesh, p0 - n * hw, p0 + n * hw, p1 + n * hw, p1 - n * hw, qc, qc, 1.0, std_uv)

	var sp_cfg: Dictionary = td_root.get("sparks", {})
	var hot_c := _col_v3(sp_cfg.get("hot", [1, 0.9, 0.72]))
	var mid_c := _col_v3(sp_cfg.get("mid", [1, 0.45, 0.06]))
	var cool_c := _col_v3(sp_cfg.get("cool", [0.67, 0.04, 0.01]))
	var sp_hdr := float(sp_cfg.get("hdr", 12.0))
	var rb_cfg: Dictionary = td_root.get("ribbon", {})
	var rb_col := _col_v3(rb_cfg.get("color", [1, 0.51, 0.16]))
	var rb_hdr := float(rb_cfg.get("hdr", 16.0))
	var rb_w := float(rb_cfg.get("widthM", 0.0075)) * scale_mul
	var rb_life := maxf(0.02, float(rb_cfg.get("trailS", 0.26)))

	for q in _sparks_state:
		var age := tau - float(q["delay"])
		var life := float(q["life"])
		if age < 0.0 or age > life:
			continue
		var h := float(q["heat"]) * exp(-age / maxf(0.01, float(q["cool"])))
		var fade := _sstep(life, life * 0.75, age)
		var pos: Vector3 = q["p"]

		# Ember layer / legacy ember tier: alpha-clipped molten speck (< 0.3333) + flicker
		if float(q["clip"]) > 0.0:
			var is_em := bool(q.get("standalone_ember", false))
			var em_d: Dictionary = td_root.get("ember", {})
			var fl_pct := int(round(clampf(float(em_d.get("flicker", 0.18)), 0.0, 0.6) * 100.0)) if is_em else 18
			if (_hash_ints([int(q["id"]), int(floor(tau * 34.0))]) % 100) < fl_pct:
				continue
			var e_hot := _col_v3(em_d.get("hot", sp_cfg.get("hot", [1, 0.9, 0.72]))) if is_em else hot_c
			var e_mid := _col_v3(em_d.get("mid", sp_cfg.get("mid", [1, 0.45, 0.06]))) if is_em else mid_c
			var e_cool := _col_v3(em_d.get("cool", sp_cfg.get("cool", [0.67, 0.04, 0.01]))) if is_em else cool_c
			var e_hdr := (float(em_d.get("hdr", 12.0)) * 1.15 * float(q["bri"])) if is_em else (sp_hdr * 0.52)
			var s_rad := float(q["w"])
			var mn_rad := 1.15 * px_k * cam_pos.distance_to(pos)
			var e_ck := 1.0
			if s_rad < mn_rad and mn_rad > 1e-6:
				e_ck = maxf(0.45, s_rad / mn_rad)
				s_rad = mn_rad
			var ec := _heat_col(maxf(h, 0.16), e_hot, e_mid, e_cool, e_hdr) * e_ck
			var cr := cam_right * s_rad
			var cu := cam_up * s_rad
			if not add_started:
				_add_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
				add_started = true
			var qce := Color(ec.x, ec.y, ec.z, fade)
			_emit_quad(_add_mesh, pos - cr - cu, pos + cr - cu, pos + cr + cu, pos - cr + cu, qce, qce, 2.0, speck_uv)
			continue

		var ti := int(q["ti"])
		var dist := float(q["dist"])
		var hdr_boost := (lerpf(2.4, 1.0, _sstep(0.05 * scale_mul, 0.55 * scale_mul, dist)) if ti == 0 else 1.6) * float(q["bri"])
		var sc := _heat_col(h, hot_c, mid_c, cool_c, sp_hdr * hdr_boost)
		var vel: Vector3 = q["v"]
		var spd := vel.length()
		if spd >= 1e-4 or ti == 1:
			var lk := float(q["lk"])
			var seg_len := minf(float(q["max_len"]) * lk, maxf(0.014 * scale_mul, spd * float(q["streak"]) * lk))
			seg_len = minf(seg_len, dist + 0.004 * scale_mul)
			var tail := pos - (vel / maxf(spd, 1e-4)) * seg_len
			var bounced := int(q["bounces"]) > 0
			var fb := 1.6 if bounced else 1.0
			if bounced:
				var bs := float(q["w"]) * 2.2
				var bcr := cam_right * bs
				var bcu := cam_up * bs
				if not add_started:
					_add_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
					add_started = true
				var bcol := Color(sc.x * 0.5, sc.y * 0.5, sc.z * 0.5, fade)
				_emit_quad(_add_mesh, pos - bcr - bcu, pos + bcr - bcu, pos + bcr + bcu, pos - bcr + bcu, bcol, bcol, 2.0, speck_uv)

			if flags["sparks_on"] or bool(q["leader"]):
				var hw := float(q["w"]) * fb * (1.0 if ti == 0 else (0.6 + 0.6 * h)) * (1.25 - 0.35 * lk)
				var side := (pos - tail).cross(cam_pos - pos)
				var sl := side.length()
				if sl > 1e-9:
					var min_hw := 0.75 * px_k * cam_pos.distance_to(pos)
					var ck := 1.0
					if hw < min_hw and min_hw > 1e-6:
						ck = hw / min_hw
						hw = min_hw
					side *= hw / sl
					var alpha_in := fade * _sstep(0.0, 0.05 * scale_mul, dist)
					var st_col := Color(sc.x * fb * ck, sc.y * fb * ck, sc.z * fb * ck, alpha_in)
					if not add_started:
						_add_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
						add_started = true
					_emit_quad(_add_mesh, tail - side, tail + side, pos + side, pos - side, st_col, st_col, 0.0, std_uv)

		# Leader ribbon strip (shared mitered vertices across consecutive trail points)
		if bool(q["leader"]) and bool(q.get("has_trail", true)) and flags["ribbon_on"]:
			var tr: Array = q["trail"]
			var n_pts := tr.size()
			if n_pts > 2:
				var has_prev := false
				var prev_l := Vector3.ZERO
				var prev_r := Vector3.ZERO
				var prev_c := Color.BLACK
				for j in range(n_pts):
					var pt_j: Vector3 = tr[j][0]
					var pt_a: Vector3 = tr[maxi(0, j - 1)][0]
					var pt_b: Vector3 = tr[mini(n_pts - 1, j + 1)][0]
					var kj := float(j) / float(n_pts - 1)
					var agj := clampf(1.0 - (tau - float(tr[j][1])) / rb_life, 0.0, 1.0)
					var wj := rb_w * pow(kj, 0.8) * 0.5
					var ej := rb_hdr * (0.1 + h * h) * agj * fade
					var mn_r := 0.8 * px_k * cam_pos.distance_to(pt_j)
					if wj < mn_r and wj > 1e-6:
						ej *= wj / mn_r
						wj = mn_r
					var rside := (pt_b - pt_a).cross(cam_pos - pt_j)
					if rside.length_squared() < 1e-10:
						has_prev = false
						continue
					rside = rside.normalized()
					var cur_l := pt_j - rside * wj
					var cur_r := pt_j + rside * wj
					var cur_c := Color(rb_col.x * ej, rb_col.y * ej, rb_col.z * ej, 1.0)
					if has_prev:
						if not add_started:
							_add_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
							add_started = true
						_emit_quad(_add_mesh, prev_l, prev_r, cur_r, cur_l, prev_c, cur_c, 3.0, std_uv)
					prev_l = cur_l
					prev_r = cur_r
					prev_c = cur_c
					has_prev = true

	# 5a. Debris: lit spinning iron shards + hot orange tip speck
	if flags["debris_on"] and not _debris_state.is_empty():
		var hot_tip := _heat_col(0.95, hot_c, mid_c, cool_c, 10.0)
		var k_end := _sstep(MAX_DURATION, MAX_DURATION - 0.4, tau)
		var vis_cnt := 0
		for q in _debris_state:
			if vis_cnt >= _debris_mm.instance_count:
				break
			var bounced := int(q["bounces"]) > 0
			var ang := float(q["spin"]) * minf(tau, 0.35 + tau * 0.2 * (0.0 if bounced else 1.0))
			var sz := float(q["size"]) * k_end
			var rot_b := Basis(q["ax"] as Vector3, ang)
			var pos: Vector3 = q["p"]
			_debris_mm.set_instance_transform(vis_cnt, Transform3D(rot_b.scaled(Vector3.ONE * maxf(sz, 1e-5)), pos))
			vis_cnt += 1
			var ht := exp(-tau / 0.25)
			if ht > 0.03:
				var tip_pos := pos + (rot_b * Vector3(sz * 2.8, 0.0, 0.0))
				var ts := 0.0026 * scale_mul
				var cr := cam_right * ts
				var cu := cam_up * ts
				if not add_started:
					_add_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
					add_started = true
				var tcol := Color(hot_tip.x * ht, hot_tip.y * ht, hot_tip.z * ht, 1.0)
				_emit_quad(_add_mesh, tip_pos - cr - cu, tip_pos + cr - cu, tip_pos + cr + cu, tip_pos - cr + cu, tcol, tcol, 2.0, speck_uv)
		_debris_mm.visible_instance_count = vis_cnt
	else:
		_debris_mm.visible_instance_count = 0

	if add_started:
		_add_mesh.surface_end()

	# 5b. Smoke dark streaks + dissolving FBM puffs
	_dark_mesh.clear_surfaces()
	_smoke_mesh.clear_surfaces()
	if flags["smoke_on"]:
		var sm_cfg: Dictionary = td_root.get("smoke", {})
		var sm_col := _col_v3(sm_cfg.get("color", [0.002, 0.002, 0.003]))
		var dk_started := false
		for q in _dark_state:
			var life := float(q["life"])
			if tau > life:
				continue
			var vel: Vector3 = q["v"]
			var spd := vel.length()
			if spd < 1e-4:
				continue
			var seg_l := minf(0.18 * scale_mul, maxf(0.015 * scale_mul, spd * 0.03))
			seg_l = minf(seg_l, float(q["dist"]) + 0.003 * scale_mul)
			var pos: Vector3 = q["p"]
			var tail := pos - (vel / spd) * seg_l
			var side := (pos - tail).cross(cam_pos - pos)
			var sl := side.length()
			if sl <= 1e-9:
				continue
			side *= maxf(float(q["w"]), 0.75 * px_k * cam_pos.distance_to(pos)) / sl
			var dcol := Color(sm_col.x, sm_col.y, sm_col.z, 0.85 * _sstep(life, life * 0.6, tau))
			if not dk_started:
				_dark_mesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
				dk_started = true
			_emit_quad(_dark_mesh, tail - side, tail + side, pos + side, pos - side, dcol, dcol, 0.0, std_uv)
		if dk_started:
			_dark_mesh.surface_end()

		var edge_warm := _col_v3(td_root.get("light", {}).get("color", st_cfg.get("edge", [1, 0.45, 0.11]))) * 0.55
		_smoke_mat.set_shader_parameter("warm_col", edge_warm)
		var opacity := float(sm_cfg.get("opacity", 0.78))
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		st.set_custom_format(0, SurfaceTool.CUSTOM_RGBA_FLOAT)
		var puff_drawn := 0
		for pf in _smoke_puffs_cfg:
			var age := tau - float(pf["del"])
			var life := float(pf["life"])
			if age < 0.0 or age > life:
				continue
			var k := age / maxf(0.01, life)
			var d: Vector3 = pf["d"]
			var is_puff := bool(pf["is_puff"])
			var is_ink := bool(pf["is_ink"])
			var dist := float(pf["spd"]) / 3.0 * (1.0 - exp(-3.0 * age))
			var p := origin + d * (dist * (1.0 if is_puff else 0.6) + 0.03 * scale_mul) + Vector3.UP * (age * 0.12 * scale_mul)
			var sz := float(pf["s0"]) * (0.55 + 1.1 * sqrt(k))
			var ca := cos(float(pf["rot"]) + age * 0.4)
			var sa := sin(float(pf["rot"]) + age * 0.4)
			var stretch := 1.0
			if not is_puff and not _smoke_is_mask:
				ca = d.dot(cam_right)
				sa = d.dot(cam_up)
				var ll := sqrt(ca * ca + sa * sa)
				if ll > 1e-5:
					ca /= ll
					sa /= ll
				else:
					ca = 1.0
					sa = 0.0
				stretch = 2.6 if is_ink else 3.2
			var ax := cam_right * (ca * sz * stretch) + cam_up * (sa * sz * stretch)
			var ay_k := 0.42 if stretch > 1.0 else 1.0
			var ay := cam_right * (-sa * sz * ay_k) + cam_up * (ca * sz * ay_k)
			var corners := [p - ax - ay, p + ax - ay, p + ax + ay, p - ax + ay]
			var uvs := [Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)]
			var thresh := lerpf(0.12, 0.95, pow(k, 0.8)) * (0.9 if is_ink else 1.0)
			var pd := Color(float(pf["ox"]), float(pf["oy"]) + age * 0.05, thresh, opacity * _sstep(0.0, 0.06, age))
			var pc := Color(sm_col.x, sm_col.y, sm_col.z, exp(-age / 0.12))
			for idx in [0, 1, 2, 0, 2, 3]:
				st.set_color(pc)
				st.set_custom(0, pd)
				st.set_uv(uvs[idx])
				st.add_vertex(corners[idx])
			puff_drawn += 1
		if puff_drawn > 0:
			st.commit(_smoke_mesh)

	# 6. Screen-space Heatwave Refraction (adds zero colour)
	var rf_cfg: Dictionary = td_root.get("refraction", {})
	var rf_life := float(rf_cfg.get("lifeS", 0.32))
	if flags["refr_on"] and tau < rf_life:
		var k := clampf(tau / maxf(0.01, rf_life), 0.0, 1.0)
		var ease_k := 1.0 - pow(1.0 - k, 3.0)
		var has_tex := (refraction_tex != null) or (rf_cfg.get("texture", null) is String and String(rf_cfg.get("texture", "")) != "")
		var style := "double" if bool(flags["refr_double"]) else String(rf_cfg.get("style", "ring"))
		var mode := 3 if has_tex else (1 if style == "bulge" else (2 if style == "double" else 0))
		var ring_r := lerpf(0.3, 1.0, ease_k) if has_tex else lerpf(0.08, 0.9, ease_k)
		var ring_w := lerpf(0.05, 0.14, k)
		var fade := pow(1.0 - k, 1.4) * _sstep(0.0, 0.015, tau)
		var diam := float(rf_cfg.get("radiusM", 1.45)) * 2.0 * scale_mul
		_refr_inst.global_transform = Transform3D(cam_basis.scaled(Vector3.ONE * diam), origin)
		_refr_mat.set_shader_parameter("mode", mode)
		_refr_mat.set_shader_parameter("ring_r", ring_r)
		_refr_mat.set_shader_parameter("ring_wid", ring_w)
		_refr_mat.set_shader_parameter("fade", fade)
		_refr_mat.set_shader_parameter("strength_px720", float(rf_cfg.get("strengthPx720", 30.0)))
		_refr_inst.visible = true
	else:
		_refr_inst.visible = false
