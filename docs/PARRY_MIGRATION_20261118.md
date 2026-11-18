# 格挡特效 · 游戏端迁移说明：热浪改为整帧扭曲（2026-11-18 工具版）

接着 [PARRY_MIGRATION_20261117.md](PARRY_MIGRATION_20261117.md)，11-17 那份里的改动照旧有效。
工具是标准答案：网页 `index.html?tab=5`（格挡 → 热浪）里看到的就是要迁移的效果。
改动在 `assets/parry/parry_core.js`、`assets/parry/parry_tab.js`，改前版本备份为 `*.bak_20261118`。

## 1. 改了什么

| | 旧 | 新 |
|---|---|---|
| 作用对象 | 只扭曲刀后面的背景（刀被遮罩成 0 偏移；在 bloom 之前做，克莱因舞台只扭背景） | **整帧**：刀、所有特效层、背景一起扭（最后一个后处理 pass，作用在色调映射 + bloom + 舞台合成之后的成品画面上） |
| 默认样式 | `ring` 单个冲击环 | `ripple` 水波纹：从交击点向外扩散的几圈波，随寿命衰减 |
| 中心 | 交击点 | 交击点的屏幕投影（不变） |

新字段（recipe `refraction` 和网页参数 `refr`）：
- `waves`：波纹圈数，默认 3（网页「热浪 → 波纹圈数」，1–6）。
- `scope`：`'frame'`（默认，整帧）或 `'behind'`（旧行为，只扭背景，保留作对照）。网页「作用范围」。
- `center`、`ripple`：文字说明，写明中心和公式。

旧字段的含义不变：`strengthPx720`（720p 下的最大偏移像素）、`radiusM`（半径，米）、`lifeS`（寿命）、`style`。
旧样式 `ring / bulge / double` 和自定义贴图也都还能用，只是同样作用于整帧。

## 2. 公式（屏幕空间 UV 偏移，不加颜色）

```
k      = age / lifeS                              // 0..1
R      = lerp(0.08, 0.90, easeOut(k))             // 波前位置，单位 = radiusM
w      = lerp(0.05, 0.14, k)                      // 波宽
lam    = 1.6 * w                                  // 波长
r      = 屏幕上到交击点投影的距离 / 投影半径        // 投影半径 = radiusM 在交击点深度处的屏幕尺寸
x      = (R - r) / lam                            // 波前后面第几圈
h      = sin(2π·x) * smoothstep(-0.5, 0, x) * (1 - smoothstep(waves-0.5, waves+0.25, x)) * exp(-0.35·max(x,0))
fade   = (1-k)^1.4 * smoothstep(0, 0.015, age)
edge   = smoothstep(1, 0.85, r)                   // r>1 为 0
offsetPx = radialDir * h * strengthPx720 * fade * edge * (屏幕高/720)
最终颜色 = Scene(uv - offsetPx/屏幕尺寸)，R/B 通道各再偏 ±6% 做一点色散
```
- 外圈最强，往里一圈比一圈弱；正负交替，就是水波一推一拉的样子。
- 没有任何颜色叠加，只挪像素。

## 3. UE 里怎么做（建议）

用**后处理材质**，作用于整帧：
1. 材质 Domain = Post Process，**Blendable Location = After Tonemapping**（让刀、Niagara 火星、bloom 都被一起扭；放在 Before Tonemapping 会漏掉 bloom，效果差不多也可以接受）。
2. 输入参数（MPC 或动态材质实例，每帧由格挡组件写）：
   - `CenterUV`：交击点世界位置投影到屏幕（`ProjectWorldLocationToScreen` / 视口尺寸）。
   - `RadiusUV`：`radiusM` 在交击点深度处的屏幕半径（投影交击点和 交击点+相机Right×radiusM 两个点，取距离）。
   - `Age`、`Life`、`Strength`、`Waves`。
3. 材质里：`r = length((ScreenUV - CenterUV) * float2(aspect,1)) / RadiusUV`，按第 2 节算 `offset`，用 `SceneTexture:PostProcessInput0` 在 `ScreenUV - offset` 处采样输出。
4. `Age > Life` 时把 Blend Weight 设 0（或关掉 Post Process Volume 里这一项），不耗性能。

不要用 Niagara 的 refraction / 半透明扭曲材质做这件事：那种只扭它身后的东西，正是旧版"只扭背景"的问题。

Godot：`CanvasLayer` 上全屏 `ColorRect` + `hint_screen_texture` shader（放在所有 3D 和特效之后）。Unity URP：Full Screen Pass Renderer Feature，Injection Point = After Rendering Post Processing。
这次 `engines/` 下的插件都没改。

## 4. 验证（网页工具）
- 慢放对比图（克莱因舞台，关掉光球/星芒/打光，看得清刀和火星）：
  [heat_compare_closeup.png](../../../output/ParryFX_20261118/heat_compare_closeup.png)。三行分别是关热浪、改前、改后，时间 +30…+210 ms。改后的 30/60 ms 里，刀身和火星线都被波纹扭弯，而且仍然看得清。
- 全特效对比：[heat_compare_dark.png](../../../output/ParryFX_20261118/heat_compare_dark.png)、[heat_compare_klein.png](../../../output/ParryFX_20261118/heat_compare_klein.png)。
- 只留刀、开热浪（90 ms）时，改变的像素数：整帧 740，旧行为（只背景）305。可见刀也被扭了。
- `tests/parry_verify.py` 通过（`pass: true`），页面无报错。`?rec=1&mode=parry` / `BTG_parryRec` 接口不变。
