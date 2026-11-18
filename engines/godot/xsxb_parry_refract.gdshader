shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled;

uniform sampler2D screen_tex : hint_screen_texture, repeat_disable, filter_linear_mipmap;
uniform sampler2D refr_tex : filter_linear_mipmap, repeat_disable;
uniform float strength_px720 = 30.0;
uniform float ring_r = 0.5;
uniform float ring_wid = 0.08;
uniform float fade = 0.0;
uniform int mode = 0;

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	if (r > 1.0 || fade <= 0.001 || strength_px720 <= 0.01) {
		discard;
	}
	vec2 offset_px = vec2(0.0);
	if (mode == 3) {
		float e = 0.01;
		float h0 = texture(refr_tex, UV).r;
		float hx = texture(refr_tex, UV + vec2(e, 0.0)).r;
		float hy = texture(refr_tex, UV + vec2(0.0, e)).r;
		vec2 g = vec2(hx - h0, hy - h0) / e * 0.08;
		float m = smoothstep(ring_r * 1.05, ring_r * 0.5, r);
		offset_px = g * (strength_px720 * fade * m);
	} else {
		vec2 d = (r > 1e-4) ? (p / r) : vec2(0.0);
		float o = 0.0;
		if (mode == 0) {
			float dr = (r - ring_r) / max(ring_wid, 0.005);
			o = exp(-dr * dr);
		} else if (mode == 1) {
			o = sin(clamp(r / max(ring_r, 0.05), 0.0, 1.0) * 3.14159265) * (1.0 - r);
		} else {
			float dr1 = (r - ring_r) / max(ring_wid, 0.005);
			float dr2 = (r - ring_r * 0.62) / max(ring_wid * 0.8, 0.005);
			o = exp(-dr1 * dr1) + 0.6 * exp(-dr2 * dr2);
		}
		offset_px = d * (o * strength_px720 * fade * smoothstep(1.0, 0.85, r));
	}
	// Flip Y screen offset to match screen-space UV convention; adds zero colour
	vec2 o_uv = vec2(offset_px.x, -offset_px.y) * (VIEWPORT_SIZE.y / 720.0) / max(VIEWPORT_SIZE, vec2(1.0));
	vec2 uv = SCREEN_UV - o_uv;
	vec3 col = vec3(
		textureLod(screen_tex, clamp(uv - o_uv * 0.06, vec2(0.001), vec2(0.999)), 0.0).r,
		textureLod(screen_tex, clamp(uv, vec2(0.001), vec2(0.999)), 0.0).g,
		textureLod(screen_tex, clamp(uv + o_uv * 0.06, vec2(0.001), vec2(0.999)), 0.0).b
	);
	ALBEDO = min(col, vec3(16.0));
	ALPHA = clamp(length(offset_px) * 0.4, 0.0, 1.0);
}
