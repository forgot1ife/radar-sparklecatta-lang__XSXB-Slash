shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, depth_test_disabled, shadows_disabled;

uniform sampler2D star_tex : filter_linear_mipmap, repeat_disable;
uniform vec3 core_col = vec3(1.0);
uniform vec3 edge_col = vec3(1.0, 0.45, 0.11);
uniform float gain = 0.0;
uniform float contrast_pow = 2.2;
uniform int is_glow = 0;

void fragment() {
	if (gain <= 0.0005) {
		discard;
	}
	if (is_glow == 1) {
		vec2 p = UV * 2.0 - 1.0;
		float r2 = dot(p, p);
		float k = exp(-r2 * 9.0) * (1.0 - smoothstep(0.6, 1.0, r2));
		ALBEDO = edge_col * (k * gain);
	} else {
		// Textures are linear masks; undo sRGB if imported with source_color or read linear ImageTexture
		float s = texture(star_tex, UV).r;
		float k = pow(max(s, 0.0), contrast_pow);
		vec3 c = mix(edge_col, core_col, smoothstep(0.25, 0.9, s));
		ALBEDO = c * (k * gain);
	}
}
