shader_type spatial;
render_mode unshaded, blend_mix, cull_disabled, depth_draw_never, shadows_disabled;

uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
uniform sampler2D mask_tex : filter_linear_mipmap, repeat_disable;
uniform int use_mask = 0;
uniform int is_dark_streak = 0;
uniform vec3 warm_col = vec3(0.55, 0.25, 0.06);

varying vec4 v_pd;

void vertex() {
	v_pd = CUSTOM0;
}

void fragment() {
	if (is_dark_streak == 1) {
		float u = UV.x;
		float v = UV.y;
		float a = max(0.0, 1.0 - abs(u));
		a = a * a;
		float inten = a * pow(max(v, 0.0), 1.2) * smoothstep(1.0, 0.85, v);
		float alpha = COLOR.a * inten;
		if (alpha < 0.003) {
			discard;
		}
		ALBEDO = COLOR.rgb;
		ALPHA = alpha;
	} else {
		vec2 p = UV * 2.0 - 1.0;
		float r = length(p);
		float n = texture(noise_tex, UV * 0.62 + v_pd.xy).r * 0.62
				+ texture(noise_tex, UV * 1.7 - v_pd.yx * 1.3).r * 0.38;
		float rad = (use_mask == 1) ? (texture(mask_tex, UV).r * 1.15) : smoothstep(1.0, 0.05, r);
		float d = pow(max(n, 0.0), 1.6) * rad * 1.6;
		float th = v_pd.z;
		float a = smoothstep(th, th + 0.16, d) * v_pd.w;
		if (a < 0.003) {
			discard;
		}
		float rim = 1.0 - smoothstep(th, th + 0.07, d);
		float lit = 0.35 + 0.65 * COLOR.a;
		ALBEDO = mix(COLOR.rgb, vec3(0.07, 0.066, 0.062), lit * (1.0 - d * 0.5)) + warm_col * (rim * COLOR.a * 0.9);
		ALPHA = clamp(a, 0.0, 1.0);
	}
}
