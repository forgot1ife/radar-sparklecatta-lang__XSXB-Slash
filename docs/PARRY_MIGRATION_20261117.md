# 格挡特效 · 游戏端迁移说明（2026-11-17 工具版）

工具是标准答案：网页 `index.html?tab=5`（格挡）里看到的就是要迁移的效果。
本次改了三处：暗烟改为原地扩散，拖尾火星沿球面平滑飞行，火星初速度提高。
改动全部在 `assets/parry/parry_core.js`（另在 `parry_tab.js` 加了一个滑杆）。改前的版本备份为 `*.bak_20261117b`。
导出的 recipe（`recipe.json`，`format: xsxb-parry`, `version: 1`）已带新数值和新字段，旧字段都保留。

> 注意：本仓库 `engines/godot|unity|unreal` 里的格挡插件**还是旧算法**（Bezier 杯形 + 直线脱离、旧速度）。
> 游戏端按本文迁移；插件端口要另外同步。

坐标约定（与 recipe 相同）：米、秒；原点 = 交击点；+Y 向上（Y-up，右手系）。
引擎是 Z-up（UE）时，按语义轴换算（见 §2.1），不要直接照抄分量。

---

## 1. 暗烟（smoke 烟团）：原地扩散

| | 旧 | 新 |
|---|---|---|
| 烟团中心 | 沿锥形方向飞出 `spd/2.2·(1−e^(−3.2·age))`（0.6–1.9 m），再加 `0.12·age` 上升 | **固定**在交击点 + 每团 0.03 m 的静态偏移（方向 = 生成时的锥形方向 d） |
| 上升 | 0.12 m/s，固定 | 新参数 `smoke.rise`（m/s），**默认 0**（网页「暗烟 → 详细 → 上升 m/s」，0–0.3） |
| 大小 | `s0·(0.55 + 1.1·√k)` | `s0·(0.55 + 1.5·√k)`，k = age/life（不再移动，所以扩散幅度加大） |
| 淡出、溶解、颜色、团数、寿命 | 不变 | 不变 |

公式：
```
p   = clash + d*0.03 + up*(rise*age)
size= s0 * (0.55 + 1.5*sqrt(age/life))
```
- 墨烟 / 细烟仍按 d 拉长（ink 2.6×，wisp 3.2×），只是中心不动。
- 随机数顺序不变：spd 照样抽一次，只是不再使用。这样同一个 seed 的其他属性不变。
- 「暗火星」（`smoke.darkSparks`，黑色细线）**没改**，仍然飞出。

recipe 新字段：`smoke.motion`（文字说明）、`smoke.riseMS`。

实测（精防预设，烟团中心到交击点的距离）：旧 0.12 / 0.33 / 0.55 / 0.82 m（50 / 150 / 300 / 500 ms），新 0.018 / 0.018 / 0.018 / 0.021 m。

---

## 2. 拖尾火星（ribbon，`style: 'sphereScatter'`）

### 2.1 球面位置：相对防守方（玩家）

球面以前用固定的世界方向 `(-0.99, -0.03, 0.02)`，所以在游戏里会偏到画面左边。
现在定义在**防守方坐标系**里，原点在交击点：

| 轴 | 定义（语义，与引擎无关） | 网页里的算法 |
|---|---|---|
| `toDefender` | 交击点 → 防守方（玩家），**水平投影**后归一化 | `normalize(horizontal(-bladeA))` |
| `up` | 世界竖直向上 | +Y |
| `side` | 防守方的**右手方向**：玩家站在自己位置、面朝交击点时的右边 | `cross(up, toDefender)`（Y-up 右手系） |

球心 = 交击点 + `sphere.centerLocalM` 在这三个轴上的分量：

```
dirLocal     = [0.96944, -0.03028, -0.24347]   // (toDefender, up, side)
shellRadius  = sphereR + 0.055 = 0.395 m       // sphereR 默认 0.34（精防）
centerLocalM = dirLocal * shellRadius = [0.3829, -0.0120, -0.0962]
```
即：球心在**朝玩家方向 0.383 m、向下 0.012 m、偏玩家左手 0.096 m**处。
默认的 `cross` 架势下，这和旧的世界位置完全一样，所以网页看起来没变。区别是现在它跟着防守方转。

游戏里：`toDefender = normalize(水平(玩家位置 − 交击点))`，`side = 玩家的右方向`（UE 里对应玩家 Actor 的 RightVector 的水平投影）。
recipe 里的 `ribbon.sphereOffset` 是旧字段（cross 架势下网页世界系的值），**不要用它**，改读 `ribbon.sphere`。

### 2.2 飞行：沿球面平滑走，切线脱离，没有折角

旧算法：沿二次 Bezier 走到 `pExit`，然后速度瞬间换成 `dOut` 直线飞出。实测在脱离那一帧转向 26°，前后几帧都只有 0.8–4°，这就是看到的折角。

新算法：每个领头火星的出发速度是**球面在顶点处的切线方向**。之后每一步（固定 240 Hz）都按「贴球权重」w 混合，w 在脱离角附近平滑地从 1 变到 0：

```
// 生成（每条领头火星 i）
u      = sphereDir (上面 2.1 的方向)；sc = clash + u*Rs；Rs = sphereR + 0.055
radDir = 与 u 垂直的放射方向（按 phi 均匀绕一圈，形状和旧版相同，带 flute 起伏）
alpha  = clamp(rho*(0.80+0.28*flute)*sphereConeDeg, 0.05, 1.18 rad)
thExit = 90° − alpha                  // 在这里脱离，脱离方向 = u*cos(alpha) + radDir*sin(alpha)
speed  = lerp(15.5, 19.4) * sparks.speed      // 旧 8.6–10.8，×1.8
p = clash;  v = radDir * speed;  drag 0.02;  gravity 0

// 每步（先做常规积分：v.y -= g*gMul*dt；curl；v *= 1/(1+drag*dt)；p += v*dt）
n  = normalize(p − sc);  th = acos(−n·u)
w  = 1 − smoothstep(thExit − 0.14, thExit + 0.14, th)      // 0.14 rad ≈ 8° 的过渡带
if w > 0:
    p = sc + n * lerp(|p − sc|, Rs, w)                      // 拉回球壳
    vt = v − (v·n) n                                        // 投到切平面
    vt = normalize(vt) * lerp(|v|, speed, w)                // 保持速率
    v  = lerp(v, vt, w)
o = 1 − w
gravity = 0.52*o;  drag = lerp(0.02, 2.5, o);  curl = postCurl * o   // 离开球面后才渐渐受力
```
- 旧的 `p0 / p1 / pExit / dOut / arcLen / sParam` 都不再用了。`leftSphere` 保留，表示 w≈0。
- 离开后的阻力从 0.75 改成 2.5：初速高了，阻力配大，射程大致不变，起手更猛。
- **贴地缓冲（新增）**：往下飞的领头火星，竖直速度被限制为 `vy ≥ −45 × (y − floor − 0.03)`，水平分量重新缩放以保持速率。这样它会滑行着落地，不会在地面撞出折角。
- 实测（精防，12 条，240 Hz 每步的方向变化）：旧版最大 66°（地面）/ 空中脱离 26°；新版最大 17°，99 分位 5.6°。
  球面上是匀速圆弧，大约每步 14°（24 m/s，半径 0.4 m），连续，没有突变。

recipe 新字段：`ribbon.sphere`（frame / axes / dirLocal / gapM / centerLocalM / shellRadiusM / launchSpeedMS / flight）。

---

## 3. 火星初速度（sparks、ember、ribbon）：×1.8，阻力相应加大

| 层 | 参数 | 旧 | 新 |
|---|---|---|---|
| sparks · burst | speed（× `sparks.speed`） | 6.4 – 24.0 | **11.5 – 43.2** |
| | drag（× `sparks.drag`） | 8.5 – 18.5 | **15.3 – 33.3** |
| sparks · arc | speed | 4.2 – 9.5 | **7.6 – 17.1** |
| | drag | 2.6 – 4.6 | **4.4 – 7.8** |
| ember（铁水） | speed（× `ember.speed`） | 1.8 – 6.2 | **3.2 – 11.2** |
| | drag（× `ember.drag`） | 2.2 – 4.4 | **3.7 – 7.5** |
| ribbon · sphereScatter | 出发速度 | 8.6 – 10.8 | **15.5 – 19.4**，脱离后 drag 0.75 → **2.5** |
| ribbon · bladeSlide | 速度 ×1.8；drag | .08 / 滑出后 1.55 | **.14 / 2.6** |
| ribbon · deflectCone | 速度 ×1.8；drag | .85–1.25 | **1.45–2.1** |
| ribbon · vortexWrap | 速度 ×1.8；drag | .55–.95 | **.95–1.6** |
| ribbon · groundSkim | 速度 ×1.8；drag | .32 / 贴地后 1.05 | **.55 / 1.8** |
| ribbon · whip | 速度 ×1.8；drag | .5–1.0 | **.85–1.7** |

寿命、数量、颜色、重力、拖尾长度都不变。预设里的倍率（例如精防 `sparks.speed 1.42`）也不变，乘在新基数上。
recipe 的 `sparks.tiers[].speed / drag`、`ember.tier.speed / drag` 直接就是新数值，游戏端读 recipe 即可。

实测（精防，平均值）：

| | 出发速度 m/s | 50 ms 飞出距离 m | 600 ms 距离 m |
|---|---|---|---|
| burst | 25.2 → **45.3** | 0.79 → **1.15** | （已熄灭） |
| arc | 8.9 → **16.1** | 0.36 → **0.61** | 1.58 → 2.08 |
| ribbon | 13.6 → **24.5** | 0.62 → **1.11** | 5.7 → 7.1 |
| ember | 4.7 → **8.4** | 0.21 → **0.35** | 1.07 → 1.36 |

前 50 ms 冲得更远，最终距离只多 20–30%：起手爆发，射程没失控。

### 3.1 渲染小修：飞进镜头的火星点淡出
初速变高后，偶尔有一颗铁水点会飞到镜头前，糊成一个大光斑。现在 camera-facing 的火星点按到相机的距离淡出：
`alpha *= smoothstep(0.35, 1.0, distToCamera)`。游戏端如果也出现贴脸光斑，照做。

---

## 4. 验证（网页工具）
- 慢放前后对比图：[compare_sheet.png](../../../output/ParryFX_20261117/compare_sheet.png)
  （3 组 × 7 帧：全部 / 只看拖尾 / 只看暗烟；+10…+400 ms）。
- `tests/parry_verify.py`：通过（`pass: true`）。Klein 背景色检查改成取几个角落里最干净的天空像素，因为火星更快以后，泛光会扫到原来那一个取样点。
- `?rec=1&mode=parry` 与 `BTG_parryRec` 接口不变（reset / tier / set / seek / cam / opts / recipe / texData 都能用）。画面会随新默认值改变，这是预期内的。
