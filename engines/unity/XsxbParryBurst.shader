// XSXB-Slash Parry Burst shader (`xsxb-parry` v1, docs/SPEC_PARRY.md).
// Works in both URP and Built-in Render Pipeline without external package includes.
// Modes (_PassKind):
//   0 = Star / Atmospheric Glow (Additive, ZTest Always, ZWrite Off)
//   1 = Additive Batch: Streaks (uv2.x=0), 90-deg Crossed Needles (1), Alpha-Clipped 0.3333 Embers (2), Leader Ribbons (3)
//   2 = Translucent Dissolving FBM Smoke Puffs (SrcAlpha OneMinusSrcAlpha)
//   3 = Translucent Dark Sparks (SrcAlpha OneMinusSrcAlpha)
//   4 = Screen-Space Heatwave Refraction (samples _CameraOpaqueTexture with RGB split; adds zero colour)
//   5 = Lit Metallic Iron Debris Splinters (Opaque, ZWrite On, ZTest LEqual)
Shader "XSXB-Slash/ParryBurst"
{
    Properties
    {
        _MainTex ("Primary Mask (linear)", 2D) = "white" {}
        _SecondTex ("Secondary Mask (linear)", 2D) = "white" {}
        _CoreCol ("Core Color (linear)", Vector) = (1,1,1,1)
        _EdgeCol ("Edge Color (linear)", Vector) = (1,0.45,0.11,1)
        _WarmCol ("Smoke Warm Rim (linear)", Vector) = (0.55,0.25,0.06,1)
        _Gain ("HDR Gain", Float) = 1
        _ContrastPow ("Contrast Power", Float) = 2.2
        _PassKind ("Pass Kind", Float) = 1
        _SubMode ("Sub Mode", Float) = 0
        _UseTex ("Use Textures (0/1)", Float) = 1
        _RefrParams ("Refraction (strengthPx720, ringR, ringWid, fade)", Vector) = (30, 0.5, 0.08, 0)
        _FlashParams ("Flash (opacityFade, blur, hollow, hdr)", Vector) = (0, 0.28, 0, 9.5)
        _HasOpaqueTex ("Has _CameraOpaqueTexture (0/1)", Float) = 1
        [HideInInspector] _SrcBlend ("SrcBlend", Float) = 1
        [HideInInspector] _DstBlend ("DstBlend", Float) = 1
        [HideInInspector] _ZWrite ("ZWrite", Float) = 0
        [HideInInspector] _ZTest ("ZTest", Float) = 4
    }
    SubShader
    {
        Tags { "Queue"="Transparent" "RenderType"="Transparent" "IgnoreProjector"="True" }
        Pass
        {
            Blend [_SrcBlend] [_DstBlend]
            ZWrite [_ZWrite]
            ZTest [_ZTest]
            Cull Off

            CGPROGRAM
            #pragma target 3.0
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            sampler2D _MainTex;
            sampler2D _SecondTex;
            sampler2D _CameraOpaqueTexture;

            float4 _CoreCol;
            float4 _EdgeCol;
            float4 _WarmCol;
            float _Gain;
            float _ContrastPow;
            float _PassKind;
            float _SubMode;
            float _UseTex;
            float4 _RefrParams;
            float4 _FlashParams;
            float _HasOpaqueTex;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float4 color  : COLOR;
                float2 uv0    : TEXCOORD0;
                float4 uv1    : TEXCOORD1;
            };

            struct v2f
            {
                float4 pos       : SV_POSITION;
                float4 color     : COLOR;
                float2 uv0       : TEXCOORD0;
                float4 uv1       : TEXCOORD1;
                float4 screenPos : TEXCOORD2;
                float3 worldNrm  : TEXCOORD3;
                float3 worldPos  : TEXCOORD4;
            };

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.color = v.color;
                o.uv0 = v.uv0;
                o.uv1 = v.uv1;
                o.screenPos = ComputeScreenPos(o.pos);
                o.worldNrm = UnityObjectToWorldNormal(v.normal);
                o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
                return o;
            }

            float4 frag(v2f i) : SV_Target
            {
                // 0: Star + Glow + Circular Impact Flash (_SubMode == 2, premultiplied One/OneMinusSrcAlpha)
                if (_PassKind < 0.5)
                {
                    if (_SubMode > 1.5)
                    {
                        float op = saturate(_FlashParams.x);
                        if (op <= 0.0005) discard;
                        float2 pf = i.uv0 * 2.0 - 1.0;
                        float rf = length(pf);
                        if (rf > 1.0) discard;
                        float sf = tex2D(_MainTex, i.uv0).r;
                        float blur = _FlashParams.y;
                        float hollow = _FlashParams.z;
                        float hdr = _FlashParams.w;
                        float edgeEnv = smoothstep(1.0, 1.0 - max(0.02, blur * 0.92), rf);
                        float inEnv = (hollow > 0.001) ? smoothstep(hollow * 0.58, hollow * 0.88 + 0.05, rf) : 1.0;
                        float mf = saturate(sf * edgeEnv * inEnv);
                        float3 cf = lerp(_EdgeCol.rgb, _CoreCol.rgb, smoothstep(0.30, 0.90, sf * (1.0 - rf * 0.40)));
                        float af = clamp(mf * op * 0.62, 0.0, 0.92);
                        float3 rgbf = cf * (mf * op * (0.35 + hdr * 0.22));
                        return float4(rgbf, af);
                    }
                    if (_Gain <= 0.0005) discard;
                    if (_SubMode > 0.5)
                    {
                        float2 p = i.uv0 * 2.0 - 1.0;
                        float r2 = dot(p, p);
                        float k = exp(-r2 * 9.0) * (1.0 - smoothstep(0.6, 1.0, r2));
                        return float4(_EdgeCol.rgb * (k * _Gain), 1.0);
                    }
                    float s = tex2D(_MainTex, i.uv0).r;
                    float k = pow(max(s, 0.0), _ContrastPow);
                    float3 c = lerp(_EdgeCol.rgb, _CoreCol.rgb, smoothstep(0.25, 0.9, s));
                    return float4(c * (k * _Gain), 1.0);
                }

                // 1: Additive Batch (Sparks, Needles, Clipped Embers, Leader Ribbons)
                if (_PassKind < 1.5)
                {
                    float u = i.uv0.x;
                    float v = i.uv0.y;
                    float m = i.uv1.x;
                    float3 hdrRgb = i.color.rgb * i.uv1.y; // uv1.y carries HDR multiplier so Color stays unclamped or float

                    // mode 2: alpha-clipped molten ember speck (clip < 0.3333)
                    if (m > 1.5 && m < 2.5)
                    {
                        float r2 = u * u + v * v;
                        clip((1.0 - r2) - 0.3333);
                        return float4(hdrRgb * i.color.a, 1.0);
                    }
                    // mode 1: 90-deg crossed diamond needle
                    if (m > 0.5 && m < 1.5)
                    {
                        float inten = 0.0;
                        if (_UseTex > 0.5)
                        {
                            inten = tex2D(_SecondTex, float2(u * 0.5 + 0.5, saturate(v))).r;
                        }
                        else
                        {
                            float e = 1.0 - abs(2.0 * v - 1.0);
                            float w = max(0.015, e);
                            inten = pow(e, 1.25) * pow(max(0.0, 1.0 - abs(u) / w), 2.2) + exp(-u * u * 400.0) * e * e * 0.5;
                        }
                        return float4(hdrRgb * (i.color.a * inten), 1.0);
                    }
                    // mode 3: curling leader ribbon
                    if (m > 2.5)
                    {
                        float a = max(0.0, 1.0 - abs(u));
                        return float4(hdrRgb * (a * a * i.color.a), 1.0);
                    }
                    // mode 0: velocity-aligned streak (Unity PNG top row = head is at v = 1)
                    float sInten = 0.0;
                    if (_UseTex > 0.5)
                    {
                        sInten = tex2D(_MainTex, float2(u * 0.5 + 0.5, saturate(v))).r;
                    }
                    else
                    {
                        float a = pow(max(0.0, 1.0 - abs(u)), 2.2);
                        sInten = a * (0.1 + 0.9 * pow(max(v, 0.0), 0.75)) * smoothstep(1.0, 0.95, v) * smoothstep(0.0, 0.3, v);
                    }
                    return float4(hdrRgb * (i.color.a * sInten), 1.0);
                }

                // 2: Translucent FBM Dissolving Smoke Puffs
                if (_PassKind < 2.5)
                {
                    float2 p = i.uv0 * 2.0 - 1.0;
                    float r = length(p);
                    float n = tex2D(_MainTex, i.uv0 * 0.62 + i.uv1.xy).r * 0.62
                            + tex2D(_MainTex, i.uv0 * 1.7 - i.uv1.yx * 1.3).r * 0.38;
                    float rad = (_SubMode > 0.5) ? (tex2D(_SecondTex, i.uv0).r * 1.15) : smoothstep(1.0, 0.05, r);
                    float d = pow(max(n, 0.0), 1.6) * rad * 1.6;
                    float th = i.uv1.z;
                    float a = smoothstep(th, th + 0.16, d) * i.uv1.w;
                    clip(a - 0.003);
                    float rim = 1.0 - smoothstep(th, th + 0.07, d);
                    float lit = 0.35 + 0.65 * i.color.a;
                    float3 col = lerp(i.color.rgb, float3(0.07, 0.066, 0.062), lit * (1.0 - d * 0.5))
                               + _WarmCol.rgb * (rim * i.color.a * 0.9);
                    return float4(col, saturate(a));
                }

                // 3: Translucent Dark Sparks
                if (_PassKind < 3.5)
                {
                    float u = i.uv0.x;
                    float v = i.uv0.y;
                    float a = max(0.0, 1.0 - abs(u));
                    a = a * a;
                    float inten = a * pow(max(v, 0.0), 1.2) * smoothstep(1.0, 0.85, v);
                    float alpha = i.color.a * inten;
                    clip(alpha - 0.003);
                    return float4(i.color.rgb, saturate(alpha));
                }

                // 4: Screen-Space Heatwave Refraction (adds zero colour)
                if (_PassKind < 4.5)
                {
                    float strength = _RefrParams.x;
                    float ringR = _RefrParams.y;
                    float ringWid = max(_RefrParams.z, 0.005);
                    float fade = _RefrParams.w;
                    float2 p = i.uv0 * 2.0 - 1.0;
                    float r = length(p);
                    if (_HasOpaqueTex < 0.5 || r > 1.0 || fade <= 0.001 || strength <= 0.01) discard;

                    float2 offsetPx = float2(0.0, 0.0);
                    if (_SubMode > 2.5)
                    {
                        float e = 0.01;
                        float h0 = tex2D(_MainTex, i.uv0).r;
                        float hx = tex2D(_MainTex, i.uv0 + float2(e, 0.0)).r;
                        float hy = tex2D(_MainTex, i.uv0 + float2(0.0, e)).r;
                        float2 g = float2(hx - h0, hy - h0) / e * 0.08;
                        float m = smoothstep(ringR * 1.05, ringR * 0.5, r);
                        offsetPx = g * (strength * fade * m);
                    }
                    else
                    {
                        float2 d = (r > 1e-4) ? (p / r) : float2(0.0, 0.0);
                        float o = 0.0;
                        if (_SubMode < 0.5)
                        {
                            float dr = (r - ringR) / ringWid;
                            o = exp(-dr * dr);
                        }
                        else if (_SubMode < 1.5)
                        {
                            o = sin(saturate(r / max(ringR, 0.05)) * 3.14159265) * (1.0 - r);
                        }
                        else
                        {
                            float dr1 = (r - ringR) / ringWid;
                            float dr2 = (r - ringR * 0.62) / (ringWid * 0.8);
                            o = exp(-dr1 * dr1) + 0.6 * exp(-dr2 * dr2);
                        }
                        offsetPx = d * (o * strength * fade * smoothstep(1.0, 0.85, r));
                    }

                    float2 scrUv = i.screenPos.xy / max(i.screenPos.w, 1e-5);
                    float2 vp = max(_ScreenParams.xy, float2(1.0, 1.0));
                    float2 oUv = offsetPx * (vp.y / 720.0) / vp;
                    float2 uv = scrUv - oUv;
                    float cr = tex2Dlod(_CameraOpaqueTexture, float4(clamp(uv - oUv * 0.06, 0.001, 0.999), 0, 0)).r;
                    float cg = tex2Dlod(_CameraOpaqueTexture, float4(clamp(uv, 0.001, 0.999), 0, 0)).g;
                    float cb = tex2Dlod(_CameraOpaqueTexture, float4(clamp(uv + oUv * 0.06, 0.001, 0.999), 0, 0)).b;
                    float maskA = saturate(length(offsetPx) * 0.4);
                    return float4(min(float3(cr, cg, cb), float3(16.0, 16.0, 16.0)), maskA);
                }

                // 5: Lit Metallic Iron Debris Splinters
                float3 N = normalize(i.worldNrm);
                float3 V = normalize(_WorldSpaceCameraPos - i.worldPos);
                float3 L1 = normalize(float3(-0.45, 0.82, -0.35));
                float3 L2 = normalize(float3(0.45, 0.55, 0.70));
                float ndl1 = saturate(dot(N, L1));
                float ndl2 = saturate(dot(N, L2));
                float3 H1 = normalize(L1 + V);
                float3 H2 = normalize(L2 + V);
                float spec1 = pow(saturate(dot(N, H1)), 28.0) * 1.4;
                float spec2 = pow(saturate(dot(N, H2)), 24.0) * 1.1;
                float3 baseMetal = float3(0.28, 0.29, 0.32);
                float3 litCol = baseMetal * (0.28 + 0.75 * ndl1 + 0.45 * ndl2)
                              + float3(1.0, 0.94, 0.86) * spec1
                              + float3(0.62, 0.76, 1.0) * spec2
                              + float3(1.0, 0.36, 0.06) * (i.uv1.x * 4.0); // hot cooling orange glow
                return float4(litCol, 1.0);
            }
            ENDCG
        }
    }
}
