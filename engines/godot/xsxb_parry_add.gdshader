shader_type spatial;
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled;

uniform sampler2D spark_tex : filter_linear_mipmap, repeat_disable;
uniform sampler2D flash_tex : filter_linear_mipmap, repeat_disable;
uniform int use_textures = 1;

void fragment() {
	float u = UV.x;
	float v = UV.y;
	float m = UV2.x;
	// mode 2: alpha-clipped molten ember speck (clip at 0.3333)
	if (m > 1.5 && m < 2.5) {
		float r2 = u * u + v * v;
		if (1.0 - r2 < 0.3333) {
			discard;
		}
		ALBEDO = COLOR.rgb * COLOR.a;
	} else if (m > 0.5 && m < 1.5) {
		// mode 1: 90-degree crossed razor diamond needle (flash)
		float inten = 0.0;
		if (use_textures == 1) {
			inten = texture(flash_tex, vec2(u * 0.5 + 0.5, clamp(v, 0.0, 1.0))).r;
		} else {
			float e = 1.0 - abs(2.0 * v - 1.0);
			float w = max(0.015, e);
			inten = pow(e, 1.25) * pow(max(0.0, 1.0 - abs(u) / w), 2.2) + exp(-u * u * 400.0) * e * e * 0.5;
		}
		ALBEDO = COLOR.rgb * (COLOR.a * inten);
	} else if (m > 2.5) {
		// mode 3: leader ribbon strip
		float a = max(0.0, 1.0 - abs(u));
		ALBEDO = COLOR.rgb * (a * a * COLOR.a);
	} else {
		// mode 0: velocity-aligned spark streak (UV.y: 0=tail -> 1=head; spark_tex top y=0 is head)
		float inten = 0.0;
		if (use_textures == 1) {
			inten = texture(spark_tex, vec2(u * 0.5 + 0.5, clamp(1.0 - v, 0.0, 1.0))).r;
		} else {
			float a = pow(max(0.0, 1.0 - abs(u)), 2.2);
			inten = a * (0.1 + 0.9 * pow(max(v, 0.0), 0.75)) * smoothstep(1.0, 0.95, v) * smoothstep(0.0, 0.3, v);
		}
		ALBEDO = COLOR.rgb * (COLOR.a * inten);
	}
}
