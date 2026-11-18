shader_type spatial;
render_mode unshaded, blend_premul_alpha, cull_disabled, depth_draw_never, depth_test_disabled, shadows_disabled;

uniform sampler2D flash_tex : filter_linear_mipmap, repeat_disable;
uniform vec3 core_col = vec3(1.0, 0.96, 0.85);
uniform vec3 edge_col = vec3(1.0, 0.55, 0.16);
uniform float opacity_fade = 0.0;
uniform float blur_amt = 0.28;
uniform float hollow_amt = 0.0;
uniform float hdr_gain = 9.5;

void fragment() {
	float op = clamp(opacity_fade, 0.0, 1.0);
	if (op <= 0.0005) {
		discard;
	}
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	if (r > 1.0) {
		discard;
	}
	float s = texture(flash_tex, UV).r;
	float edge_env = smoothstep(1.0, 1.0 - max(0.02, blur_amt * 0.92), r);
	float in_env = (hollow_amt > 0.001) ? smoothstep(hollow_amt * 0.58, hollow_amt * 0.88 + 0.05, r) : 1.0;
	float m = clamp(s * edge_env * in_env, 0.0, 1.0);
	vec3 c = mix(edge_col, core_col, smoothstep(0.30, 0.90, s * (1.0 - r * 0.40)));
	float a = clamp(m * op * 0.62, 0.0, 0.92);
	vec3 rgb = c * (m * op * (0.35 + hdr_gain * 0.22));
	ALBEDO = rgb;
	ALPHA = a;
}
