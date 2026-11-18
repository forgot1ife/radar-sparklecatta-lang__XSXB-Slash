"""XSXB-Slash Parry Burst installer & runtime preview driver for Unreal Engine 5 (`xsxb-parry` v1, docs/SPEC_PARRY.md).

Usage inside UE5 Editor Python console or `-ExecutePythonScript`:
    import sys
    sys.path.append(r"<path-to>/XSXB-Slash/engines/unreal")
    import XsxbParryInstall
    assets = XsxbParryInstall.install_bundle(
        r"<path-to>/XSXB-Slash/examples/parry_fable",
        dest_game_path="/Game/XsxbParry/ParryFable",
        save_assets=True,
    )
"""
from __future__ import annotations

import json
import math
import pathlib
from typing import Any, Dict, List, Optional, Tuple


FIXED_DT = 1.0 / 240.0
MAX_DURATION = 1.85


# ---------------- Deterministic RNG & Math (matches parry_core.js) ----------------
def _imul32(x: int, y: int) -> int:
    return ((x & 0xFFFFFFFF) * (y & 0xFFFFFFFF)) & 0xFFFFFFFF


def hash_ints(*vals: int) -> int:
    h = 2166136261
    for v in vals:
        x = ((int(v) & 0xFFFFFFFF) + 0x9E3779B9) & 0xFFFFFFFF
        h = _imul32(h ^ x, 2246822507)
        h = _imul32(h ^ (h >> 13), 3266489909)
        h = (h ^ (h >> 16)) & 0xFFFFFFFF
    return h


class SeededRng:
    def __init__(self, seed_val: int) -> None:
        self.a = seed_val & 0xFFFFFFFF
        if self.a == 0:
            self.a = 1

    def next(self) -> float:
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = _imul32(self.a ^ (self.a >> 15), 1 | self.a)
        t = (t + _imul32(t ^ (t >> 7), 61 | t)) ^ t
        t &= 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    def range_f(self, lo: float, hi: float) -> float:
        return lo + (hi - lo) * self.next()


def sstep(a: float, b: float, x: float) -> float:
    if abs(b - a) < 1e-9:
        return 1.0 if x >= b else 0.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def v3_norm(v: Tuple[float, float, float]) -> Tuple[float, float, float]:
    l = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if l < 1e-9:
        return (0.0, 0.0, 1.0)
    return (v[0] / l, v[1] / l, v[2] / l)


def v3_cross(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> Tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def v3_dot(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def v3_rot_axis(v: Tuple[float, float, float], axis: Tuple[float, float, float], rad: float) -> Tuple[float, float, float]:
    k = v3_norm(axis)
    c = math.cos(rad)
    s = math.sin(rad)
    kv = v3_cross(k, v)
    kd = v3_dot(k, v) * (1.0 - c)
    return (
        v[0] * c + kv[0] * s + k[0] * kd,
        v[1] * c + kv[1] * s + k[1] * kd,
        v[2] * c + kv[2] * s + k[2] * kd,
    )


def web_dir_to_ue(v: List[float]) -> Tuple[float, float, float]:
    # Web (RH): +X right, +Y up, +Z toward camera -> UE5 (LH, camera at -X facing +X): -X toward camera, +Y right, +Z up
    return v3_norm((-float(v[2]), float(v[0]), float(v[1])))


def load_and_validate_recipe(recipe_path: str | pathlib.Path) -> Dict[str, Any]:
    p = pathlib.Path(recipe_path)
    if p.is_dir():
        p = p / "recipe.json"
    data = json.loads(p.read_text(encoding="utf-8"))
    fmt = data.get("format") or data.get("kind")
    ver = data.get("version")
    if fmt != "xsxb-parry" or ver != 1:
        raise ValueError(f"Unsupported parry recipe format={fmt!r} version={ver!r} in {p}")
    return data


def heat_col(
    h: float,
    hot: List[float],
    mid: List[float],
    cool: List[float],
    hdr: float,
) -> Tuple[float, float, float]:
    if h > 0.7:
        k = (h - 0.7) / 0.3
        c = [mid[i] + (hot[i] - mid[i]) * k for i in range(3)]
    elif h > 0.32:
        k = (h - 0.32) / 0.38
        c = [cool[i] + (mid[i] - cool[i]) * k for i in range(3)]
    else:
        k = max(0.0, h / 0.32)
        c = [cool[i] * k for i in range(3)]
    hh = max(0.0, h)
    e = hdr * (hh ** 2.2) + 2.6 * hh
    return (c[0] * e, c[1] * e, c[2] * e)


def _cone_dir_ue(rng: SeededRng, axis: Optional[Tuple[float, float, float]], half_deg: float) -> Tuple[float, float, float]:
    if axis is None:
        z = 2.0 * rng.next() - 1.0
        ph = math.tau * rng.next()
        q = math.sqrt(max(0.0, 1.0 - z * z))
        up = abs(z) * 0.6 + z * 0.4 + 0.15
        return v3_norm((q * math.sin(ph), q * math.cos(ph), up))
    ax = v3_norm(axis)
    ct = math.cos(math.radians(half_deg))
    ct = ct + (1.0 - ct) * rng.next()
    st = math.sqrt(max(0.0, 1.0 - ct * ct))
    ph = math.tau * rng.next()
    ref = (0.0, 0.0, 1.0) if abs(ax[2]) < 0.9 else (0.0, 1.0, 0.0)
    u = v3_norm(v3_cross(ax, ref))
    w = v3_norm(v3_cross(ax, u))
    cp, sp = math.cos(ph), math.sin(ph)
    return v3_norm((
        ax[0] * ct + u[0] * st * cp + w[0] * st * sp,
        ax[1] * ct + u[1] * st * cp + w[1] * st * sp,
        ax[2] * ct + u[2] * st * cp + w[2] * st * sp,
    ))


# ---------------- Deterministic 240 Hz Simulator (UE5 cm, Z-up) ----------------
class XsxbParrySimulator:
    def __init__(self, recipe: Dict[str, Any], clash_origin_cm: Tuple[float, float, float] = (0.0, 0.0, 110.0), scale_mul: float = 1.0) -> None:
        self.recipe = recipe
        self.origin = clash_origin_cm
        self.scale_mul = scale_mul
        self.cm = 100.0 * scale_mul
        raw_t = str(recipe.get("tier", "perfect"))
        self.active_tier = "normal" if raw_t == "normal" else "perfect"
        self.active_seed = int(recipe.get("seed", 77))
        self.sim_t = 0.0
        self.sparks: List[Dict[str, Any]] = []
        self.dark_sparks: List[Dict[str, Any]] = []
        self.debris: List[Dict[str, Any]] = []
        self.smoke_puffs: List[Dict[str, Any]] = []
        self.reset(self.active_tier, self.active_seed)

    def tier_dict(self) -> Dict[str, Any]:
        tk = "normal" if self.active_tier == "normal" else "perfect"
        tiers = self.recipe.get("tiers")
        if isinstance(tiers, dict) and isinstance(tiers.get(tk), dict):
            return tiers[tk]
        return self.recipe

    def sfx_sync_info(self, lead_s: float = 0.0, pick_seed: Optional[int] = None) -> Dict[str, Any]:
        td = self.tier_dict()
        sx = td.get("sfx", {})
        tk = "normal" if self.active_tier == "normal" else "perfect"
        pool = sx.get("pool", [])
        chosen = None
        if isinstance(pool, list) and len(pool) > 0:
            rng_s = _Rng((self.active_seed if pick_seed is None else int(pick_seed)) ^ (17 if tk == "normal" else 53))
            chosen = pool[int(rng_s.next() * len(pool)) % len(pool)]
        peak = max(0.0, float((chosen or sx).get("peakOffsetS", sx.get("peakOffsetS", 0.015))))
        lead = max(0.0, float(lead_s))
        return {
            "enabled": bool(sx.get("enabled", True)),
            "playMode": str(sx.get("playMode", "random")),
            "file": str((chosen or sx).get("file", f"audio/parry_{tk}.wav")),
            "pool": pool,
            "peak_offset_s": peak,
            "start_offset_s": max(0.0, peak - lead),
            "delay_s": max(0.0, lead - peak),
        }

    def flags(self) -> Dict[str, Any]:
        td = self.tier_dict()
        has_tiers = isinstance(self.recipe.get("tiers"), dict)
        is_norm = self.active_tier == "normal"
        lt_cfg = td.get("light", td.get("star", {}).get("light", {}))
        if has_tiers:
            return {
                "star_on": bool(td.get("star", {}).get("enabled", True)),
                "light_on": bool(lt_cfg.get("enabled", True)),
                "flash_on": bool(td.get("flash", {}).get("enabled", True)),
                "sparks_on": bool(td.get("sparks", {}).get("enabled", True)),
                "ember_on": bool(td.get("ember", {}).get("enabled", False)),
                "ribbon_on": bool(td.get("ribbon", {}).get("enabled", not is_norm)),
                "smoke_on": bool(td.get("smoke", {}).get("enabled", not is_norm)),
                "debris_on": bool(td.get("debris", {}).get("enabled", not is_norm)),
                "refr_on": bool(td.get("refraction", {}).get("enabled", not is_norm)),
                "star_mul": 1.0,
                "spark_mul": 1.0,
                "flash_bonus": 0,
                "refr_double": False,
            }
        return {
            "star_on": bool(td.get("star", {}).get("enabled", True)),
            "light_on": bool(lt_cfg.get("enabled", True)),
            "flash_on": bool(td.get("flash", {}).get("enabled", True)),
            "sparks_on": bool(td.get("sparks", {}).get("enabled", True)),
            "ember_on": bool(td.get("ember", {}).get("enabled", False)),
            "ribbon_on": False if is_norm else bool(td.get("ribbon", {}).get("enabled", True)),
            "smoke_on": False if is_norm else bool(td.get("smoke", {}).get("enabled", True)),
            "debris_on": False if is_norm else bool(td.get("debris", {}).get("enabled", True)),
            "refr_on": False if is_norm else bool(td.get("refraction", {}).get("enabled", True)),
            "star_mul": 0.82 if is_norm else 1.0,
            "spark_mul": 0.75 if is_norm else 1.0,
            "flash_bonus": 0,
            "refr_double": False,
        }

    def floor_z_cm(self) -> float:
        rel_m = float(self.recipe.get("frame", {}).get("floorY", -1.1))
        return self.origin[2] + rel_m * self.cm

    def sample_clash_motion(self, tau: float) -> Dict[str, Any]:
        cl = self.tier_dict().get("clash", self.recipe.get("clash", {}))
        hs = float(cl.get("hitstopS", 0.08))
        tremor = float(cl.get("tremor", 1.0))
        shake = float(cl.get("shake", 1.0))
        hz = float(cl.get("tremorHz", 44.0))
        if tau < 0.0:
            return {"hitstop": False, "tremor_deg": 0.0, "shake_cm": (0.0, 0.0, 0.0)}
        tr_deg = tremor * 1.6 * math.exp(-tau / (hs + 0.07)) * math.sin(math.tau * hz * tau)
        sh_cm = (0.6 * shake * math.exp(-tau / 0.06)) if tau < 0.25 else 0.0
        return {
            "hitstop": tau < hs,
            "tremor_deg": tr_deg,
            "shake_cm": (0.0, sh_cm * math.sin(tau * 260.0), sh_cm * math.cos(tau * 310.0)),
        }

    def sample_flash(self, tau: float) -> Dict[str, Any]:
        fl_on = self.flags()["flash_on"]
        fl = self.tier_dict().get("flash", self.recipe.get("flash", {}))
        life_s = max(0.02, float(fl.get("lifeS", 0.14)))
        op = float(fl.get("opacity", 0.68))
        if not fl_on or tau < 0.0 or op <= 0.001 or tau >= life_s * 1.75:
            return {"visible": False, "size_cm": 0.0, "opacity_fade": 0.0, "blur": 0.28, "hollow": 0.0, "hdr": 0.0, "spin_rad": 0.0}
        fade = sstep(0.0, 0.008, tau) * ((max(0.0, 1.0 - tau / (life_s * 1.75))) ** 1.35)
        if fade * op <= 0.001:
            return {"visible": False, "size_cm": 0.0, "opacity_fade": 0.0, "blur": 0.28, "hollow": 0.0, "hdr": 0.0, "spin_rad": 0.0}
        ex = float(fl.get("expand", 0.55))
        grow0 = max(0.2, 1.0 - ex * 0.55)
        grow1 = 1.0 + ex * 0.45
        grow = grow0 + (grow1 - grow0) * (1.0 - math.exp(-tau / max(0.014, life_s * 0.42)))
        size_cm = float(fl.get("sizeM", 1.05)) * grow * self.cm
        fl_seed = int(fl.get("seed", 17))
        rot = ((hash_ints(self.active_seed, fl_seed) % 628) / 100.0) + tau * float(fl.get("spin", 0.0))
        return {
            "visible": True,
            "style": str(fl.get("style", "sphere")),
            "size_cm": size_cm,
            "opacity_fade": op * fade,
            "blur": max(0.02, min(0.95, float(fl.get("blur", 0.28)))),
            "hollow": max(0.0, min(0.85, float(fl.get("hollow", 0.0)))),
            "hdr": float(fl.get("hdr", 9.5)),
            "core": fl.get("core", [1.0, 0.96, 0.85]),
            "color": fl.get("color", [1.0, 0.55, 0.16]),
            "spin_rad": rot,
        }

    def reset(self, tier: Optional[str] = None, seed: Optional[int] = None) -> None:
        if tier:
            self.active_tier = "normal" if tier == "normal" else "perfect"
        td_root = self.tier_dict()
        if seed is not None:
            self.active_seed = seed
        else:
            self.active_seed = int(td_root.get("seed", self.recipe.get("seed", 77)))
        self.sim_t = 0.0
        self.sparks.clear()
        self.dark_sparks.clear()
        self.debris.clear()
        self.smoke_puffs.clear()

        fl = self.flags()
        frm = self.recipe.get("frame", {})
        s1 = web_dir_to_ue(frm.get("sprayMain", [0.3996, 0.9114, 0.0985]))
        s2 = web_dir_to_ue(frm.get("spraySecondary", [-0.6813, 0.5190, 0.5162]))
        blade_a = web_dir_to_ue(frm.get("bladeA", [0.5507, 0.8211, -0.1502]))
        blade_b = web_dir_to_ue(frm.get("bladeB", [-0.5698, 0.8098, 0.1400]))
        edge_a = web_dir_to_ue(frm.get("edgeA", [0.7917, -0.5708, -0.2177]))

        sp_cfg = td_root.get("sparks", {})
        lobes = []
        for lb in sp_cfg.get("lobes", []):
            ax_raw = lb.get("axis")
            ax_ue = web_dir_to_ue(ax_raw) if isinstance(ax_raw, list) else None
            lobes.append((ax_ue, float(lb.get("share", 1.0)), float(lb.get("coneMul", 1.0))))
        if not lobes:
            lobes = [(s1, 0.65, 1.0), (s2, 0.35, 1.0)]

        rng_sp = SeededRng(hash_ints(self.active_seed, 207, 101))
        if fl["sparks_on"]:
            for ti, td in enumerate(sp_cfg.get("tiers", [])):
                cnt = round(int(td.get("count", 60)) * fl["spark_mul"])
                for i in range(cnt):
                    pick = rng_sp.next()
                    chosen = lobes[-1]
                    for lb in lobes:
                        if pick < lb[1]:
                            chosen = lb
                            break
                        pick -= lb[1]
                    d = _cone_dir_ue(rng_sp, chosen[0], float(td.get("cone", 40.0)) * chosen[2])
                    pw = 0.6 if ti == 0 else 1.4
                    spd_r = td.get("speed", [2.0, 8.0])
                    sp_cm = (spd_r[0] + (spd_r[1] - spd_r[0]) * (rng_sp.next() ** pw)) * self.cm
                    drg_r = td.get("drag", [1.0, 3.0])
                    lif_r = td.get("life", [0.3, 1.0])
                    wid_r = td.get("width", [0.001, 0.002])
                    ht_r = td.get("heat", [0.9, 1.0])
                    cl_r = td.get("cool", [0.4, 1.0])
                    delay = (rng_sp.next() * 0.018) if ti == 1 else ((rng_sp.next() ** 2) * 0.03 if ti == 0 else 0.0)
                    self.sparks.append({
                        "ti": ti,
                        "p": [self.origin[0] + d[0] * self.scale_mul, self.origin[1] + d[1] * self.scale_mul, self.origin[2] + d[2] * self.scale_mul],
                        "v": [d[0] * sp_cm, d[1] * sp_cm, d[2] * sp_cm],
                        "drag": rng_sp.range_f(drg_r[0], drg_r[1]),
                        "life": min(MAX_DURATION, rng_sp.range_f(lif_r[0], lif_r[1])),
                        "w": rng_sp.range_f(wid_r[0], wid_r[1]) * self.cm,
                        "heat": rng_sp.range_f(ht_r[0], ht_r[1]),
                        "cool": rng_sp.range_f(cl_r[0], cl_r[1]),
                        "g": float(td.get("gravity", 1.0)),
                        "delay": delay,
                        "dist": 0.0,
                        "bounces": 0,
                        "id": i + ti * 1000,
                        "bri": rng_sp.range_f(0.45, 1.25),
                        "lk": (0.5 + 1.9 * (rng_sp.next() ** 2.2)) if ti == 0 else (0.55 + 1.15 * (rng_sp.next() ** 1.5)),
                        "clip": float(td.get("clip", 0.0)),
                        "streak": float(td.get("streak", 0.032)),
                        "max_len": float(td.get("maxLen", 0.42)) * self.cm,
                        "leader": False,
                        "trail": [],
                        "curl": (0.0, 0.0, 0.0),
                        "rb_mode": "",
                    })

        em_cfg = td_root.get("ember", {})
        if fl.get("ember_on") and isinstance(em_cfg, dict) and em_cfg:
            rng_em = SeededRng(hash_ints(self.active_seed, int(em_cfg.get("seed", 25)), 102))
            etd = em_cfg.get("tier", {})
            em_cnt = round(int(etd.get("count", 68)) * fl["spark_mul"])
            em_spd = etd.get("speed", [2.0, 7.0])
            em_drg = etd.get("drag", [2.2, 4.4])
            em_lif = etd.get("life", [0.75, 1.7])
            em_wid = etd.get("width", [0.0046, 0.0088])
            em_ht = etd.get("heat", [0.92, 1.0])
            em_cl = etd.get("cool", [0.62, 1.35])
            em_grav = float(em_cfg.get("gravity", etd.get("gravity", 3.6))) * self.cm
            em_lobes = [(s1, 0.58, 1.0), (s2, 0.28, 1.05), (None, 0.14, 1.2)]
            for i in range(em_cnt):
                pk = rng_em.next()
                ch = em_lobes[-1]
                for lb in em_lobes:
                    if pk < lb[1]: ch = lb; break
                    pk -= lb[1]
                d = _cone_dir_ue(rng_em, ch[0], float(etd.get("cone", 58.0)) * ch[2])
                sp_cm = (em_spd[0] + (em_spd[1] - em_spd[0]) * (rng_em.next() ** 1.25)) * self.cm
                self.sparks.append({
                    "ti": 2, "p": [self.origin[0] + d[0] * self.scale_mul, self.origin[1] + d[1] * self.scale_mul, self.origin[2] + d[2] * self.scale_mul],
                    "v": [d[0] * sp_cm, d[1] * sp_cm, d[2] * sp_cm], "drag": rng_em.range_f(em_drg[0], em_drg[1]),
                    "life": min(MAX_DURATION, rng_em.range_f(em_lif[0], em_lif[1])), "w": rng_em.range_f(em_wid[0], em_wid[1]) * self.cm,
                    "heat": rng_em.range_f(em_ht[0], em_ht[1]), "cool": rng_em.range_f(em_cl[0], em_cl[1]), "g": 1.0, "g_abs": em_grav,
                    "delay": rng_em.next() * 0.012, "dist": 0.0, "bounces": 0, "id": 20000 + i, "bri": rng_em.range_f(0.65, 1.35),
                    "lk": 1.0, "clip": 0.3333, "streak": 0.006, "max_len": 0.035 * self.cm, "leader": False, "trail": [], "curl": (0.0, 0.0, 0.0), "rb_mode": "",
                })

        if fl["ribbon_on"]:
            rb_cfg = td_root.get("ribbon", {})
            rng_rb = SeededRng(hash_ints(self.active_seed, 207, 505))
            nl = max(1, int(rb_cfg.get("leaders", 12)))
            rb_style = str(rb_cfg.get("style", "whip"))
            sph_r = max(0.15, min(0.75, float(rb_cfg.get("sphereRadiusM", 0.34)))) * self.cm
            max_ang = math.radians(max(20.0, min(72.0, float(rb_cfg.get("sphereConeDeg", 48.0)))))
            sph_dir = web_dir_to_ue([-0.99, -0.03, 0.02])
            apex_off = 0.055 * self.cm
            p_apex = (self.origin[0] + sph_dir[0] * apex_off, self.origin[1] + sph_dir[1] * apex_off, self.origin[2] + sph_dir[2] * apex_off)
            sph_ctr = (self.origin[0] + sph_dir[0] * (sph_r + apex_off), self.origin[1] + sph_dir[1] * (sph_r + apex_off), self.origin[2] + sph_dir[2] * (sph_r + apex_off))
            v_ax = v3_norm((blade_a[0] + blade_b[0], blade_a[1] + blade_b[1], blade_a[2] + blade_b[2]))
            spin_sign = 1.0 if rng_rb.next() < 0.5 else -1.0
            if rb_style == "sphereScatter":
                ref_u = (0.0, 0.0, 1.0) if abs(sph_dir[2]) < 0.9 else (0.0, 1.0, 0.0)
                e1 = v3_norm(v3_cross(sph_dir, ref_u))
                e2 = v3_norm(v3_cross(sph_dir, e1))
                n_ribs = 7 + int(math.floor(rng_rb.next() * 5.0))
                ph0 = rng_rb.next() * math.tau
                ph1 = rng_rb.next() * math.tau
                ph2 = rng_rb.next() * math.tau
                for i in range(nl):
                    phi = (i / nl) * math.tau + (rng_rb.next() - 0.5) * (2.2 / max(4, nl))
                    flute = 1.0 + 0.21 * math.cos(n_ribs * phi + ph0) + 0.10 * math.sin(3.0 * phi + ph1) + 0.06 * math.cos(2.0 * phi + ph2)
                    rad_dir = v3_norm((
                        e1[0] * math.cos(phi) * 1.06 + e2[0] * math.sin(phi) * 0.86,
                        e1[1] * math.cos(phi) * 1.06 + e2[1] * math.sin(phi) * 0.86,
                        e1[2] * math.cos(phi) * 1.06 + e2[2] * math.sin(phi) * 0.86,
                    ))
                    strat = (i * 0.6180339887) % 1.0
                    rho = 0.25 if nl == 1 else (rng_rb.range_f(0.08, 0.14) if i == 0 else (0.20 + 0.80 * (strat * 0.72 + rng_rb.next() * 0.28)))
                    alpha = max(0.05, min(1.18, rho * (0.80 + 0.28 * flute) * max_ang))
                    l_cup = sph_r * (1.55 + (1.12 - 1.55) * rho) * (0.90 + 0.14 * flute)
                    r_rim = sph_r * (0.28 + 0.34 * rho) * flute + l_cup * math.tan(alpha) * 0.56
                    p_exit = (
                        p_apex[0] + sph_dir[0] * l_cup + rad_dir[0] * r_rim,
                        p_apex[1] + sph_dir[1] * l_cup + rad_dir[1] * r_rim,
                        p_apex[2] + sph_dir[2] * l_cup + rad_dir[2] * r_rim,
                    )
                    d_out = v3_norm((
                        sph_dir[0] * math.cos(alpha) + rad_dir[0] * math.sin(alpha),
                        sph_dir[1] * math.cos(alpha) + rad_dir[1] * math.sin(alpha),
                        sph_dir[2] * math.cos(alpha) + rad_dir[2] * math.sin(alpha),
                    ))
                    p1 = (
                        p_apex[0] + sph_dir[0] * (l_cup * 0.24) + rad_dir[0] * (r_rim * 0.78),
                        p_apex[1] + sph_dir[1] * (l_cup * 0.24) + rad_dir[1] * (r_rim * 0.78),
                        p_apex[2] + sph_dir[2] * (l_cup * 0.24) + rad_dir[2] * (r_rim * 0.78),
                    )
                    d0 = v3_norm((p1[0] - self.origin[0], p1[1] - self.origin[1], p1[2] - self.origin[2]))
                    sp_cm = rng_rb.range_f(8.6, 10.8) * self.cm
                    d01 = math.dist(self.origin, p1)
                    d12 = math.dist(p1, p_exit)
                    arc_len = max(14.0 * self.scale_mul, d01 + d12)
                    sw_ax = v3_norm(v3_cross(d_out, rad_dir))
                    sgn = 1.0 if (i % 2) == 1 else -1.0
                    flare_ax = v3_norm((sw_ax[0] * 0.72 * sgn + rad_dir[0] * 0.32, sw_ax[1] * 0.72 * sgn + rad_dir[1] * 0.32, sw_ax[2] * 0.72 * sgn + rad_dir[2] * 0.32))
                    cmag = rng_rb.range_f(2.2, 4.4) * (0.45 + 0.55 * rho)
                    post_curl_s = (flare_ax[0] * cmag, flare_ax[1] * cmag, flare_ax[2] * cmag)
                    self.sparks.append({
                        "ti": 1,
                        "p": list(self.origin),
                        "v": [d0[0] * sp_cm, d0[1] * sp_cm, d0[2] * sp_cm],
                        "drag": 0.02,
                        "life": min(MAX_DURATION, rng_rb.range_f(0.72, 1.12)),
                        "w": 0.0016 * self.cm,
                        "heat": 1.0,
                        "cool": rng_rb.range_f(0.90, 1.30),
                        "g": 0.0,
                        "delay": rng_rb.next() * 0.006,
                        "dist": 0.0,
                        "bounces": 0,
                        "id": 9000 + i,
                        "bri": 1.42,
                        "lk": 1.3,
                        "clip": 0.0,
                        "streak": 0.032,
                        "max_len": 0.42 * self.cm,
                        "leader": True,
                        "trail": [],
                        "curl": (0.0, 0.0, 0.0),
                        "post_curl": post_curl_s,
                        "rb_mode": rb_style,
                        "sph_u": sph_dir,
                        "p0": tuple(self.origin),
                        "p1": p1,
                        "p_exit": p_exit,
                        "d_out": d_out,
                        "arc_len": arc_len,
                        "s_param": 0.0,
                        "surf_spd": sp_cm,
                        "left_sphere": False,
                        "tip_dist": 75.0 * self.scale_mul,
                        "slid_off": False,
                        "flick": (0.0, 0.0, 1.0),
                        "v_ax": v_ax,
                        "v_omega": 0.0,
                        "skim_sign": 0.0,
                    })
            else:
                for i in range(nl):
                    cdir = v3_norm((rng_rb.next() - 0.5, rng_rb.next() - 0.5, rng_rb.next() - 0.5))
                    cmag = rng_rb.range_f(2.0, 4.2)
                    post_curl = (cdir[0] * cmag, cdir[1] * cmag, cdir[2] * cmag)
                    curl0 = (0.0, 0.0, 0.0)
                    rad_dir = (0.0, 1.0, 0.0)
                    flick = (0.0, 0.0, 1.0)
                    tip_dist = 75.0 * self.scale_mul
                    drg0 = rng_rb.range_f(0.5, 1.0)
                    g0 = 1.0
                    sp_cm = rng_rb.range_f(5.0, 8.5) * self.cm
                    if rb_style == "bladeSlide":
                        on_b = (i % 2) == 1
                        bd = blade_b if on_b else blade_a
                        sv = v3_norm(v3_cross(bd, edge_a))
                        jit = (rng_rb.next() - 0.5) * 0.08
                        d = v3_norm((bd[0] + sv[0] * jit, bd[1] + sv[1] * jit, bd[2] + sv[2] * jit))
                        sp_cm = rng_rb.range_f(12.5, 16.5) * self.cm
                        drg0 = 0.08; g0 = 0.0
                        tip_dist = (79.0 if on_b else 75.0) * self.scale_mul
                        sgn = -0.65 if on_b else 0.65
                        flick = v3_norm((edge_a[0] * sgn, edge_a[1] * sgn, edge_a[2] * sgn + 0.55))
                        ps = (1.0 if rng_rb.next() < 0.5 else -1.0) * rng_rb.range_f(6.5, 10.5)
                        post_curl = (sv[0] * ps, sv[1] * ps, sv[2] * ps)
                    elif rb_style == "deflectCone":
                        pu = s1
                        ne = (-edge_a[0], -edge_a[1], -edge_a[2])
                        dt_ne = v3_dot(ne, pu)
                        pv = v3_norm((ne[0] - pu[0] * dt_ne, ne[1] - pu[1] * dt_ne, ne[2] - pu[2] * dt_ne))
                        ang = -0.92 + 1.84 * ((i + 0.2 + 0.6 * rng_rb.next()) / nl)
                        d = v3_norm((pu[0] * math.cos(ang) + pv[0] * math.sin(ang), pu[1] * math.cos(ang) + pv[1] * math.sin(ang), pu[2] * math.cos(ang) + pv[2] * math.sin(ang)))
                        sp_cm = rng_rb.range_f(6.4, 9.6) * self.cm
                        drg0 = rng_rb.range_f(0.85, 1.25); g0 = 1.15
                    elif rb_style == "vortexWrap":
                        ref_v = (0.0, 0.0, 1.0) if abs(v_ax[2]) < 0.9 else (0.0, 1.0, 0.0)
                        u1 = v3_norm(v3_cross(v_ax, ref_v))
                        u2 = v3_norm(v3_cross(v_ax, u1))
                        ph = (i / nl) * math.tau + rng_rb.next() * 0.35
                        rv = (u1[0] * math.cos(ph) + u2[0] * math.sin(ph), u1[1] * math.cos(ph) + u2[1] * math.sin(ph), u1[2] * math.cos(ph) + u2[2] * math.sin(ph))
                        tg = v3_cross(v_ax, rv)
                        ka = rng_rb.range_f(0.52, 0.78)
                        d = v3_norm((v_ax[0] * ka + tg[0] * 0.68 * spin_sign + rv[0] * 0.22, v_ax[1] * ka + tg[1] * 0.68 * spin_sign + rv[1] * 0.22, v_ax[2] * ka + tg[2] * 0.68 * spin_sign + rv[2] * 0.22))
                        sp_cm = rng_rb.range_f(5.8, 8.6) * self.cm
                        drg0 = rng_rb.range_f(0.55, 0.95); g0 = 0.25
                    elif rb_style == "groundSkim":
                        az = -2.5 + 5.0 * ((i + 0.25 + 0.5 * rng_rb.next()) / nl)
                        d = web_dir_to_ue([math.sin(az) * 0.62, -rng_rb.range_f(0.78, 0.95), math.cos(az) * 0.52 + 0.16])
                        sp_cm = rng_rb.range_f(10.5, 14.8) * self.cm
                        drg0 = 0.32; g0 = 1.8
                    else:
                        bs = s2 if (i % 2 == 1) else s1
                        ax = v3_norm((bs[0] * 0.8, bs[1] * 0.8, bs[2] * 0.8 + 0.5))
                        d = _cone_dir_ue(rng_rb, ax, 40.0)
                        curl0 = post_curl
                    self.sparks.append({
                        "ti": 1,
                        "p": [self.origin[0] + d[0], self.origin[1] + d[1], self.origin[2] + d[2]],
                        "v": [d[0] * sp_cm, d[1] * sp_cm, d[2] * sp_cm],
                        "drag": drg0,
                        "life": min(MAX_DURATION, rng_rb.range_f(0.8, 1.3)),
                        "w": 0.0016 * self.cm,
                        "heat": 1.0,
                        "cool": rng_rb.range_f(0.8, 1.2),
                        "g": g0,
                        "delay": rng_rb.next() * 0.012,
                        "dist": 0.0,
                        "bounces": 0,
                        "id": 9000 + i,
                        "bri": 1.35,
                        "lk": 1.3,
                        "clip": 0.0,
                        "streak": 0.033,
                        "max_len": 0.44 * self.cm,
                        "leader": True,
                        "trail": [],
                        "curl": curl0,
                        "post_curl": post_curl,
                        "rb_mode": rb_style,
                        "sph_ctr": sph_ctr,
                        "sph_r": sph_r,
                        "sph_u": sph_dir,
                        "rad_dir": rad_dir,
                        "surf_spd": sp_cm,
                        "on_sphere": False,
                        "left_sphere": False,
                        "entry_dot": 0.0,
                        "exit_dot": -0.10,
                        "tip_dist": tip_dist,
                        "slid_off": False,
                        "flick": flick,
                        "v_ax": v_ax,
                        "v_omega": spin_sign * rng_rb.range_f(15.0, 22.0),
                        "skim_sign": (1.0 if (i % 2 == 1) else -1.0) * rng_rb.range_f(3.6, 6.4),
                    })

        if fl["smoke_on"]:
            sm_cfg = td_root.get("smoke", {})
            rng_dk = SeededRng(hash_ints(self.active_seed, 307, 202))
            for _ in range(int(sm_cfg.get("darkSparks", 30))):
                d = _cone_dir_ue(rng_dk, s1 if rng_dk.next() < 0.6 else s2, 55.0)
                sp_cm = rng_dk.range_f(2.5, 7.5) * self.cm
                self.dark_sparks.append({
                    "p": list(self.origin),
                    "v": [d[0] * sp_cm, d[1] * sp_cm, d[2] * sp_cm],
                    "drag": rng_dk.range_f(1.5, 3.0),
                    "life": rng_dk.range_f(0.35, 0.85),
                    "w": rng_dk.range_f(0.003, 0.006) * self.cm,
                    "g": 0.8,
                    "dist": 0.0,
                    "bounces": 0,
                })
            rng_pf = SeededRng(hash_ints(self.active_seed, 307, 404))
            style = str(sm_cfg.get("style", "ink"))
            is_ink = style == "ink"
            is_wisp = style == "wisp"
            is_puff = not is_ink and not is_wisp
            for _ in range(int(sm_cfg.get("puffs", 10))):
                d = _cone_dir_ue(rng_pf, s1 if rng_pf.next() < 0.55 else s2, 60.0 if is_ink else 50.0)
                spd = rng_pf.range_f(2.0, 4.5) if is_ink else (rng_pf.range_f(1.2, 2.6) if is_wisp else rng_pf.range_f(0.6, 1.7))
                self.smoke_puffs.append({
                    "d": d,
                    "spd": spd * self.cm,
                    "life": rng_pf.range_f(0.35, 0.7) * float(sm_cfg.get("lifeMul", 1.0)) * (1.15 if is_ink else 1.0),
                    "s0": rng_pf.range_f(0.2, 0.36) * float(sm_cfg.get("sizeMul", 1.0)) * self.cm * (0.7 if is_wisp else 1.0),
                    "ox": rng_pf.next(),
                    "oy": rng_pf.next(),
                    "rot": rng_pf.next() * math.tau,
                    "del": rng_pf.next() * 0.03,
                    "is_ink": is_ink,
                    "is_puff": is_puff,
                })

        if fl["debris_on"]:
            db_cfg = td_root.get("debris", {})
            rng_db = SeededRng(hash_ints(self.active_seed, 407, 303))
            sz_r = db_cfg.get("sizeM", [0.004, 0.011])
            sp_r = db_cfg.get("speedMS", [1.2, 4.8])
            for _ in range(int(db_cfg.get("count", 24))):
                d = _cone_dir_ue(rng_db, s1 if rng_db.next() < 0.55 else s2, 60.0)
                sp_cm = rng_db.range_f(sp_r[0], sp_r[1]) * float(db_cfg.get("speedMul", 1.0)) * self.cm
                self.debris.append({
                    "p": list(self.origin),
                    "v": [d[0] * sp_cm, d[1] * sp_cm, d[2] * sp_cm],
                    "drag": rng_db.range_f(0.5, 1.4),
                    "g": 1.0,
                    "size": rng_db.range_f(sz_r[0], sz_r[1]) * float(db_cfg.get("sizeMul", 1.0)) * self.cm,
                    "ax": v3_norm((rng_db.next() - 0.5, rng_db.next() - 0.5, rng_db.next() - 0.5)),
                    "spin": rng_db.range_f(15.0, 45.0) * (-1.0 if rng_db.next() < 0.5 else 1.0),
                    "dist": 0.0,
                    "bounces": 0,
                })

    def step_to(self, target_tau: float) -> None:
        if target_tau < self.sim_t:
            self.reset(self.active_tier, self.active_seed)
        td_root = self.tier_dict()
        sp_cfg = td_root.get("sparks", {})
        gmul_cm = float(sp_cfg.get("gravity", 12.5)) * self.cm
        bounce = float(sp_cfg.get("floorBounce", 0.48))
        db_bounce = float(td_root.get("debris", {}).get("floorBounce", 0.32))
        trail_s = float(td_root.get("ribbon", {}).get("trailS", 0.26))
        fz = self.floor_z_cm() + 0.2 * self.scale_mul

        while self.sim_t + FIXED_DT <= target_tau + 1e-9:
            self.sim_t += FIXED_DT
            for q in self.sparks:
                if self.sim_t < q["delay"] or (self.sim_t - q["delay"]) > q["life"]:
                    continue
                v = q["v"]
                p = q["p"]
                rbm = q.get("rb_mode", "")
                v[2] -= (q["g_abs"] if "g_abs" in q else gmul_cm * q["g"]) * FIXED_DT
                if rbm == "vortexWrap":
                    vax = q["v_ax"]
                    rx, ry, rz = p[0] - self.origin[0], p[1] - self.origin[1], p[2] - self.origin[2]
                    proj = rx * vax[0] + ry * vax[1] + rz * vax[2]
                    rx -= vax[0] * proj; ry -= vax[1] * proj; rz -= vax[2] * proj
                    rl = math.sqrt(rx * rx + ry * ry + rz * rz)
                    if rl > 1e-4:
                        rn = (rx / rl, ry / rl, rz / rl)
                        tg = v3_cross(vax, rn)
                        spd_v = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
                        om = q["v_omega"] * 0.32 * self.cm
                        v[0] += (-rn[0] * spd_v * 2.8 + tg[0] * om) * FIXED_DT
                        v[1] += (-rn[1] * spd_v * 2.8 + tg[1] * om) * FIXED_DT
                        v[2] += (-rn[2] * spd_v * 2.8 + tg[2] * om) * FIXED_DT
                cx, cy, cz = q["curl"]
                if cx or cy or cz:
                    cr = v3_cross((v[0], v[1], v[2]), (cx, cy, cz))
                    v[0] += cr[0] * FIXED_DT
                    v[1] += cr[1] * FIXED_DT
                    v[2] += cr[2] * FIXED_DT
                inv_d = 1.0 / (1.0 + q["drag"] * FIXED_DT)
                v[0] *= inv_d; v[1] *= inv_d; v[2] *= inv_d
                ox, oy, oz = p[0], p[1], p[2]
                p[0] += v[0] * FIXED_DT; p[1] += v[1] * FIXED_DT; p[2] += v[2] * FIXED_DT
                if rbm == "sphereScatter" and not q["left_sphere"]:
                    q["s_param"] += (q["surf_spd"] / q["arc_len"]) * FIXED_DT
                    s = q["s_param"]
                    p0, p1, pe, do = q["p0"], q["p1"], q["p_exit"], q["d_out"]
                    sspd = q["surf_spd"]
                    if s < 1.0:
                        om = 1.0 - s
                        p[0] = om * om * p0[0] + 2.0 * om * s * p1[0] + s * s * pe[0]
                        p[1] = om * om * p0[1] + 2.0 * om * s * p1[1] + s * s * pe[1]
                        p[2] = om * om * p0[2] + 2.0 * om * s * p1[2] + s * s * pe[2]
                        tv = (
                            om * (p1[0] - p0[0]) + s * (pe[0] - p1[0]),
                            om * (p1[1] - p0[1]) + s * (pe[1] - p1[1]),
                            om * (p1[2] - p0[2]) + s * (pe[2] - p1[2]),
                        )
                        th = v3_norm(tv) if (tv[0] ** 2 + tv[1] ** 2 + tv[2] ** 2) > 1e-8 else do
                        v[0], v[1], v[2] = th[0] * sspd, th[1] * sspd, th[2] * sspd
                    else:
                        over = max(0.0, (s - 1.0) * q["arc_len"])
                        q["left_sphere"] = True; q["g"] = 0.52; q["drag"] = 0.75; q["curl"] = q.get("post_curl", (0.0, 0.0, 0.0))
                        p[0], p[1], p[2] = pe[0] + do[0] * over, pe[1] + do[1] * over, pe[2] + do[2] * over
                        v[0], v[1], v[2] = do[0] * sspd, do[1] * sspd, do[2] * sspd
                elif rbm == "bladeSlide" and not q["slid_off"] and q["dist"] >= q["tip_dist"]:
                    q["slid_off"] = True
                    spd_v = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
                    flk = q["flick"]
                    v[0] = (v[0] + flk[0] * spd_v * 0.46) * 0.72
                    v[1] = (v[1] + flk[1] * spd_v * 0.46) * 0.72
                    v[2] = (v[2] + flk[2] * spd_v * 0.46) * 0.72
                    q["g"] = 0.75; q["drag"] = 1.55; q["curl"] = q["post_curl"]
                if p[2] < fz:
                    if rbm == "groundSkim":
                        p[2] = fz + 0.3
                        if q["bounces"] == 0:
                            sp_h = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) * 0.82
                            hl = max(1e-4, math.hypot(v[0], v[1]))
                            v[0] = v[0] / hl * sp_h; v[1] = v[1] / hl * sp_h; v[2] = 4.0 * self.scale_mul
                            q["g"] = 0.05; q["drag"] = 1.05; q["curl"] = (0.0, 0.0, q["skim_sign"]); q["bounces"] = 1
                        elif v[2] < 0.0:
                            v[2] = 0.0
                    else:
                        p[2] = fz + (fz - p[2]) * 0.2
                        if v[2] < 0.0:
                            v[2] = -v[2] * bounce * (0.7 if q["bounces"] > 0 else 1.0)
                            v[0] *= 0.72; v[1] *= 0.72; q["bounces"] += 1; q["cool"] *= 0.75
                        if abs(v[2]) < 25.0 * self.scale_mul:
                            v[2] = 0.0
                            sk = max(0.0, 1.0 - 6.0 * FIXED_DT)
                            v[0] *= sk; v[1] *= sk
                q["dist"] += math.sqrt((p[0] - ox) ** 2 + (p[1] - oy) ** 2 + (p[2] - oz) ** 2)
                if q["leader"] and q.get("trail") is not None:
                    tr = q["trail"]
                    tr.append((p[0], p[1], p[2], self.sim_t))
                    while tr and (self.sim_t - tr[0][3]) > trail_s:
                        tr.pop(0)

            for q in self.dark_sparks:
                if self.sim_t > q["life"]:
                    continue
                v, p = q["v"], q["p"]
                v[2] -= gmul_cm * q["g"] * FIXED_DT
                inv_d = 1.0 / (1.0 + q["drag"] * FIXED_DT)
                v[0] *= inv_d; v[1] *= inv_d; v[2] *= inv_d
                ox, oy, oz = p[0], p[1], p[2]
                p[0] += v[0] * FIXED_DT; p[1] += v[1] * FIXED_DT; p[2] += v[2] * FIXED_DT
                if p[2] < fz:
                    p[2] = fz
                    if v[2] < 0.0:
                        v[2] = -v[2] * 0.2; v[0] *= 0.72; v[1] *= 0.72
                q["dist"] += math.sqrt((p[0] - ox) ** 2 + (p[1] - oy) ** 2 + (p[2] - oz) ** 2)

            for q in self.debris:
                v, p = q["v"], q["p"]
                v[2] -= gmul_cm * q["g"] * FIXED_DT
                inv_d = 1.0 / (1.0 + q["drag"] * FIXED_DT)
                v[0] *= inv_d; v[1] *= inv_d; v[2] *= inv_d
                p[0] += v[0] * FIXED_DT; p[1] += v[1] * FIXED_DT; p[2] += v[2] * FIXED_DT
                if p[2] < fz:
                    p[2] = fz
                    if v[2] < 0.0:
                        v[2] = -v[2] * db_bounce * (0.7 if q["bounces"] > 0 else 1.0)
                        v[0] *= 0.72; v[1] *= 0.72; q["bounces"] += 1
                    if abs(v[2]) < 25.0 * self.scale_mul:
                        v[2] = 0.0
                        sk = max(0.0, 1.0 - 6.0 * FIXED_DT)
                        v[0] *= sk; v[1] *= sk


# ---------------- UE5 Asset Importer & Material Builder ----------------
def _import_linear_mask_texture(png_path: pathlib.Path, dest_game_path: str, wrap_repeat: bool) -> Any:
    import unreal

    task = unreal.AssetImportTask()
    task.filename = str(png_path)
    task.destination_path = dest_game_path
    task.destination_name = f"T_XsxbParry_{png_path.stem}"
    task.replace_existing = True
    task.automated = True
    task.save = False
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])

    asset_path = f"{dest_game_path}/T_XsxbParry_{png_path.stem}"
    tex = unreal.EditorAssetLibrary.load_asset(asset_path)
    if tex is not None:
        tex.set_editor_property("srgb", False)
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_MASKS)
        addr = unreal.TextureAddress.TA_WRAP if wrap_repeat else unreal.TextureAddress.TA_CLAMP
        try:
            tex.set_editor_property("address_x", addr)
            tex.set_editor_property("address_y", addr)
        except Exception:
            pass
    return tex


def _create_material(asset_tools: Any, dest_game_path: str, name: str, blend_mode: Any, unlit: bool = True, disable_depth_test: bool = False) -> Any:
    import unreal

    full_path = f"{dest_game_path}/{name}"
    if unreal.EditorAssetLibrary.does_asset_exist(full_path):
        unreal.EditorAssetLibrary.delete_asset(full_path)
    fac = unreal.MaterialFactoryNew()
    mat = asset_tools.create_asset(name, dest_game_path, unreal.Material, fac)
    mat.set_editor_property("two_sided", True)
    mat.set_editor_property("blend_mode", blend_mode)
    if unlit:
        try:
            mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
        except Exception:
            pass
    if disable_depth_test:
        try:
            mat.set_editor_property("disable_depth_test", True)
        except Exception:
            pass
    return mat


def _add_custom_expr(mat: Any, code: str, output_type: Any, inputs: List[Tuple[str, Any, str]]) -> Any:
    import unreal

    mel = unreal.MaterialEditingLibrary
    cust = mel.create_material_expression(mat, unreal.MaterialExpressionCustom, -220, 0)
    cust.set_editor_property("code", code)
    cust.set_editor_property("output_type", output_type)
    cin_list = []
    for inp_name, _, _ in inputs:
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", inp_name)
        cin_list.append(ci)
    cust.set_editor_property("inputs", cin_list)
    for inp_name, expr, out_pin in inputs:
        mel.connect_material_expressions(expr, out_pin, cust, inp_name)
    return cust


def install_bundle(
    bundle_dir: str | pathlib.Path,
    dest_game_path: str = "/Game/XsxbParry/ParryFable",
    save_assets: bool = True,
) -> Dict[str, Any]:
    """Import textures (`sRGB=False`) and build UE5 Materials matching `docs/SPEC_PARRY.md`."""
    import unreal

    bdir = pathlib.Path(bundle_dir)
    recipe = load_and_validate_recipe(bdir / "recipe.json")
    mel = unreal.MaterialEditingLibrary
    asset_tools = unreal.AssetToolsHelpers.get_asset_tools()

    tex_dir = bdir / "textures"
    tex_assets: Dict[str, Any] = {}
    for stem, wrap in [("star", False), ("star_normal", False), ("spark", False), ("flash", False), ("flash_normal", False), ("smoke", True), ("refraction", False)]:
        p = tex_dir / f"{stem}.png"
        if p.exists():
            tex_assets[stem] = _import_linear_mask_texture(p, f"{dest_game_path}/Textures", wrap_repeat=wrap)

    audio_dir = bdir / "audio"
    sound_assets: Dict[str, Any] = {}
    if audio_dir.exists():
        for wp in sorted(audio_dir.glob("parry_*.wav")):
            stem = wp.stem
            atask = unreal.AssetImportTask()
            atask.filename = str(wp)
            atask.destination_path = f"{dest_game_path}/Audio"
            atask.destination_name = f"SW_XsxbParry_{stem}"
            atask.replace_existing = True
            atask.automated = True
            atask.save = False
            asset_tools.import_asset_tasks([atask])
            sound_assets[stem] = unreal.EditorAssetLibrary.load_asset(f"{dest_game_path}/Audio/SW_XsxbParry_{stem}")

    ush_text = (pathlib.Path(__file__).resolve().parent / "XsxbParryLayer.ush").read_text(encoding="utf-8")

    # 1. M_XsxbParry_Star (Unlit, Additive, DisableDepthTest = True)
    m_star = _create_material(asset_tools, dest_game_path, "M_XsxbParry_Star", unreal.BlendMode.BLEND_ADDITIVE, unlit=True, disable_depth_test=True)
    uv0 = mel.create_material_expression(m_star, unreal.MaterialExpressionTextureCoordinate, -640, -180)
    ts_star = mel.create_material_expression(m_star, unreal.MaterialExpressionTextureSampleParameter2D, -640, -40)
    ts_star.set_editor_property("parameter_name", "StarTex")
    ts_star.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
    if "star" in tex_assets and tex_assets["star"] is not None:
        ts_star.set_editor_property("texture", tex_assets["star"])
    vp_core = mel.create_material_expression(m_star, unreal.MaterialExpressionVectorParameter, -640, 140)
    vp_core.set_editor_property("parameter_name", "CoreCol")
    vp_core.set_editor_property("default_value", unreal.LinearColor(*recipe["star"]["core"], 1.0))
    vp_edge = mel.create_material_expression(m_star, unreal.MaterialExpressionVectorParameter, -640, 300)
    vp_edge.set_editor_property("parameter_name", "EdgeCol")
    vp_edge.set_editor_property("default_value", unreal.LinearColor(*recipe["star"]["edge"], 1.0))
    sp_gain = mel.create_material_expression(m_star, unreal.MaterialExpressionScalarParameter, -640, 460)
    sp_gain.set_editor_property("parameter_name", "Gain")
    sp_gain.set_editor_property("default_value", float(recipe["star"]["hdr"]))
    sp_pow = mel.create_material_expression(m_star, unreal.MaterialExpressionScalarParameter, -640, 560)
    sp_pow.set_editor_property("parameter_name", "ContrastPow")
    sp_pow.set_editor_property("default_value", float(recipe["star"]["contrastPow"]))
    sp_glow = mel.create_material_expression(m_star, unreal.MaterialExpressionScalarParameter, -640, 660)
    sp_glow.set_editor_property("parameter_name", "IsGlow")
    sp_glow.set_editor_property("default_value", 0.0)
    c_star = _add_custom_expr(
        m_star,
        """if (Gain <= 0.0005) return float3(0,0,0);
if (IsGlow > 0.5) {
    float2 p = UV * 2.0 - 1.0; float r2 = dot(p,p);
    float k = exp(-r2 * 9.0) * (1.0 - smoothstep(0.6, 1.0, r2));
    return EdgeCol.rgb * (k * Gain);
}
float k = pow(max(MaskR, 0.0), ContrastPow);
float3 c = lerp(EdgeCol.rgb, CoreCol.rgb, smoothstep(0.25, 0.9, MaskR));
return c * (k * Gain);""",
        unreal.CustomMaterialOutputType.CMOT_FLOAT3,
        [("UV", uv0, ""), ("MaskR", ts_star, "R"), ("CoreCol", vp_core, ""), ("EdgeCol", vp_edge, ""), ("Gain", sp_gain, ""), ("ContrastPow", sp_pow, ""), ("IsGlow", sp_glow, "")],
    )
    mel.connect_material_property(c_star, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(m_star)

    # 1b. M_XsxbParry_Flash (Circular impact flash: Translucent / Premultiplied, Unlit, DisableDepthTest = True)
    fl_def = recipe.get("flash", {})
    m_flash = _create_material(asset_tools, dest_game_path, "M_XsxbParry_Flash", unreal.BlendMode.BLEND_TRANSLUCENT, unlit=True, disable_depth_test=True)
    f_uv0 = mel.create_material_expression(m_flash, unreal.MaterialExpressionTextureCoordinate, -640, -180)
    ts_flash = mel.create_material_expression(m_flash, unreal.MaterialExpressionTextureSampleParameter2D, -640, -40)
    ts_flash.set_editor_property("parameter_name", "FlashTex")
    ts_flash.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
    if "flash" in tex_assets and tex_assets["flash"] is not None:
        ts_flash.set_editor_property("texture", tex_assets["flash"])
    f_core = mel.create_material_expression(m_flash, unreal.MaterialExpressionVectorParameter, -640, 140)
    f_core.set_editor_property("parameter_name", "CoreCol")
    f_core.set_editor_property("default_value", unreal.LinearColor(*fl_def.get("core", [1.0, 0.96, 0.85]), 1.0))
    f_edge = mel.create_material_expression(m_flash, unreal.MaterialExpressionVectorParameter, -640, 300)
    f_edge.set_editor_property("parameter_name", "EdgeCol")
    f_edge.set_editor_property("default_value", unreal.LinearColor(*fl_def.get("color", [1.0, 0.55, 0.16]), 1.0))
    f_prm = mel.create_material_expression(m_flash, unreal.MaterialExpressionVectorParameter, -640, 460)
    f_prm.set_editor_property("parameter_name", "FlashParams")
    f_prm.set_editor_property("default_value", unreal.LinearColor(float(fl_def.get("opacity", 0.68)), float(fl_def.get("blur", 0.28)), float(fl_def.get("hollow", 0.0)), float(fl_def.get("hdr", 9.5))))
    c_flash = _add_custom_expr(
        m_flash,
        """float op = saturate(PrmA_Op.r);
if (op <= 0.0005) return float4(0,0,0,0);
float2 p = UV * 2.0 - 1.0; float r = length(p);
if (r > 1.0) return float4(0,0,0,0);
float blur = PrmA_Op.g; float hollow = PrmA_Op.b; float hdr = PrmHdr;
float edgeEnv = smoothstep(1.0, 1.0 - max(0.02, blur * 0.92), r);
float inEnv = (hollow > 0.001) ? smoothstep(hollow * 0.58, hollow * 0.88 + 0.05, r) : 1.0;
float m = saturate(MaskR * edgeEnv * inEnv);
float3 c = lerp(EdgeCol.rgb, CoreCol.rgb, smoothstep(0.30, 0.90, MaskR * (1.0 - r * 0.40)));
float a = clamp(m * op * 0.62, 0.0, 0.92);
float3 rgb = c * (m * op * (0.35 + hdr * 0.22));
return float4(rgb / max(a, 0.001), a);""",
        unreal.CustomMaterialOutputType.CMOT_FLOAT4,
        [("UV", f_uv0, ""), ("MaskR", ts_flash, "R"), ("CoreCol", f_core, ""), ("EdgeCol", f_edge, ""), ("PrmA_Op", f_prm, ""), ("PrmHdr", f_prm, "A")],
    )
    fl_rgb = mel.create_material_expression(m_flash, unreal.MaterialExpressionComponentMask, -40, -40)
    fl_rgb.set_editor_property("r", True); fl_rgb.set_editor_property("g", True); fl_rgb.set_editor_property("b", True); fl_rgb.set_editor_property("a", False)
    fl_a = mel.create_material_expression(m_flash, unreal.MaterialExpressionComponentMask, -40, 80)
    fl_a.set_editor_property("r", False); fl_a.set_editor_property("g", False); fl_a.set_editor_property("b", False); fl_a.set_editor_property("a", True)
    mel.connect_material_expressions(c_flash, "", fl_rgb, "")
    mel.connect_material_expressions(c_flash, "", fl_a, "")
    mel.connect_material_property(fl_rgb, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(fl_a, "", unreal.MaterialProperty.MP_OPACITY)
    mel.recompile_material(m_flash)

    # 2. M_XsxbParry_Add (Supports both VertexColor*UV1 batched meshes & TintHdr/ModeMul MID planes)
    m_add = _create_material(asset_tools, dest_game_path, "M_XsxbParry_Add", unreal.BlendMode.BLEND_ADDITIVE, unlit=True)
    a_uv0 = mel.create_material_expression(m_add, unreal.MaterialExpressionTextureCoordinate, -640, -200)
    a_uv1 = mel.create_material_expression(m_add, unreal.MaterialExpressionTextureCoordinate, -640, -100)
    a_uv1.set_editor_property("coordinate_index", 1)
    a_vc = mel.create_material_expression(m_add, unreal.MaterialExpressionVertexColor, -640, 20)
    a_tint = mel.create_material_expression(m_add, unreal.MaterialExpressionVectorParameter, -640, 160)
    a_tint.set_editor_property("parameter_name", "TintHdr")
    a_tint.set_editor_property("default_value", unreal.LinearColor(1.0, 1.0, 1.0, 1.0))
    a_mm = mel.create_material_expression(m_add, unreal.MaterialExpressionVectorParameter, -640, 320)
    a_mm.set_editor_property("parameter_name", "ModeMul")
    a_mm.set_editor_property("default_value", unreal.LinearColor(0.0, 0.0, 0.0, 0.0))
    c_add = _add_custom_expr(
        m_add,
        """float u = UV0.x * 2.0 - 1.0;
float v = UV0.y;
bool useParam = (ModeMul.y > 0.5);
float m = useParam ? ModeMul.x : UV1.x;
float3 hdrCol = useParam ? TintRGB.rgb : (VColRGB.rgb * max(UV1.y, 1.0));
float alpha = useParam ? TintA : VColA;
if (m > 1.5 && m < 2.5) {
    float r2 = u*u + (v*2.0-1.0)*(v*2.0-1.0);
    if (1.0 - r2 < 0.3333) return float3(0,0,0);
    return hdrCol * alpha;
}
if (m > 0.5 && m < 1.5) {
    float e = 1.0 - abs(2.0 * v - 1.0); float w = max(0.015, e);
    float inten = pow(e, 1.25) * pow(max(0.0, 1.0 - abs(u) / w), 2.2) + exp(-u * u * 400.0) * e * e * 0.5;
    return hdrCol * (alpha * inten);
}
if (m > 2.5) {
    float a = max(0.0, 1.0 - abs(u));
    return hdrCol * (a * a * alpha);
}
float a = pow(max(0.0, 1.0 - abs(u)), 2.2);
float sInten = a * (0.22 + 0.78 * pow(max(v, 0.0), 0.75)) * smoothstep(1.0, 0.94, v) * smoothstep(0.0, 0.22, v);
return hdrCol * (alpha * sInten);""",
        unreal.CustomMaterialOutputType.CMOT_FLOAT3,
        [("UV0", a_uv0, ""), ("UV1", a_uv1, ""), ("VColRGB", a_vc, ""), ("VColA", a_vc, "A"), ("TintRGB", a_tint, ""), ("TintA", a_tint, "A"), ("ModeMul", a_mm, "")],
    )
    mel.connect_material_property(c_add, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(m_add)

    # 3. M_XsxbParry_Ember (Masked, OpacityMaskClipValue = 0.3333)
    m_emb = _create_material(asset_tools, dest_game_path, "M_XsxbParry_Ember", unreal.BlendMode.BLEND_MASKED, unlit=True)
    m_emb.set_editor_property("opacity_mask_clip_value", 0.3333)
    e_uv = mel.create_material_expression(m_emb, unreal.MaterialExpressionTextureCoordinate, -520, -80)
    e_col = mel.create_material_expression(m_emb, unreal.MaterialExpressionVectorParameter, -520, 60)
    e_col.set_editor_property("parameter_name", "EmberHdr")
    e_col.set_editor_property("default_value", unreal.LinearColor(6.0, 2.2, 0.4, 1.0))
    c_emb_mask = _add_custom_expr(
        m_emb,
        "float2 p = UV * 2.0 - 1.0; return 1.0 - dot(p, p);",
        unreal.CustomMaterialOutputType.CMOT_FLOAT1,
        [("UV", e_uv, "")],
    )
    mel.connect_material_property(e_col, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(c_emb_mask, "", unreal.MaterialProperty.MP_OPACITY_MASK)
    mel.recompile_material(m_emb)

    # 4. M_XsxbParry_Smoke (Translucent FBM dissolving smoke + dark streaks)
    m_smoke = _create_material(asset_tools, dest_game_path, "M_XsxbParry_Smoke", unreal.BlendMode.BLEND_TRANSLUCENT, unlit=True)
    s_uv0 = mel.create_material_expression(m_smoke, unreal.MaterialExpressionTextureCoordinate, -640, -180)
    s_uv1 = mel.create_material_expression(m_smoke, unreal.MaterialExpressionTextureCoordinate, -640, -80)
    s_uv1.set_editor_property("coordinate_index", 1)
    s_uv2 = mel.create_material_expression(m_smoke, unreal.MaterialExpressionTextureCoordinate, -640, 20)
    s_uv2.set_editor_property("coordinate_index", 2)
    s_vc = mel.create_material_expression(m_smoke, unreal.MaterialExpressionVertexColor, -640, 120)
    s_warm = mel.create_material_expression(m_smoke, unreal.MaterialExpressionVectorParameter, -640, 260)
    s_warm.set_editor_property("parameter_name", "WarmCol")
    s_warm.set_editor_property("default_value", unreal.LinearColor(*(x * 0.55 for x in recipe["star"]["edge"]), 1.0))
    s_tint = mel.create_material_expression(m_smoke, unreal.MaterialExpressionVectorParameter, -640, 400)
    s_tint.set_editor_property("parameter_name", "SmokeTint")
    s_tint.set_editor_property("default_value", unreal.LinearColor(0.05, 0.045, 0.04, 1.0))
    s_ppd = mel.create_material_expression(m_smoke, unreal.MaterialExpressionVectorParameter, -640, 540)
    s_ppd.set_editor_property("parameter_name", "SmokePD")
    s_ppd.set_editor_property("default_value", unreal.LinearColor(0.0, 0.0, 0.0, -2.0))
    c_smk = _add_custom_expr(
        m_smoke,
        """bool useP = (SmokePDW > -1.5);
float4 pd = useP ? float4(SmokePD3.xyz, SmokePDW) : float4(UV1.xy, UV2.xy);
float4 vc = useP ? float4(SmokeRGB.rgb, SmokeA) : float4(VColRGB.rgb, VColA);
if (pd.z < -0.5) {
    float u = UV0.x * 2.0 - 1.0; float v = UV0.y;
    float a = max(0.0, 1.0 - abs(u)); a = a * a;
    float inten = a * pow(max(v, 0.0), 1.2) * smoothstep(1.0, 0.85, v);
    return float4(vc.rgb, saturate(vc.a * inten));
}
float2 p = UV0 * 2.0 - 1.0; float r = length(p);
float2 q1 = UV0 * 3.2 + pd.xy * 4.0;
float2 q2 = UV0 * 7.5 - pd.yx * 6.0;
float n = 0.5 + 0.3 * sin(q1.x*3.1 + cos(q1.y*2.7)) + 0.2 * sin(q2.x*2.9 - sin(q2.y*3.3));
float rad = smoothstep(1.0, 0.05, r);
float d = pow(saturate(n), 1.5) * rad * 1.6;
float th = pd.z;
float a = smoothstep(th, th + 0.16, d) * pd.w;
float rim = 1.0 - smoothstep(th, th + 0.07, d);
float lit = 0.35 + 0.65 * vc.a;
float3 col = lerp(vc.rgb, float3(0.07, 0.066, 0.062), lit * (1.0 - d * 0.5)) + WarmCol.rgb * (rim * vc.a * 0.9);
return float4(col, saturate(a));""",
        unreal.CustomMaterialOutputType.CMOT_FLOAT4,
        [("UV0", s_uv0, ""), ("UV1", s_uv1, ""), ("UV2", s_uv2, ""), ("VColRGB", s_vc, ""), ("VColA", s_vc, "A"), ("WarmCol", s_warm, ""), ("SmokeRGB", s_tint, ""), ("SmokeA", s_tint, "A"), ("SmokePD3", s_ppd, ""), ("SmokePDW", s_ppd, "A")],
    )
    sm_rgb = mel.create_material_expression(m_smoke, unreal.MaterialExpressionComponentMask, -40, -40)
    sm_rgb.set_editor_property("r", True); sm_rgb.set_editor_property("g", True); sm_rgb.set_editor_property("b", True); sm_rgb.set_editor_property("a", False)
    sm_a = mel.create_material_expression(m_smoke, unreal.MaterialExpressionComponentMask, -40, 80)
    sm_a.set_editor_property("r", False); sm_a.set_editor_property("g", False); sm_a.set_editor_property("b", False); sm_a.set_editor_property("a", True)
    mel.connect_material_expressions(c_smk, "", sm_rgb, "")
    mel.connect_material_expressions(c_smk, "", sm_a, "")
    mel.connect_material_property(sm_rgb, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(sm_a, "", unreal.MaterialProperty.MP_OPACITY)
    mel.recompile_material(m_smoke)

    # 5. M_XsxbParry_Debris (DefaultLit metallic dark iron + cooling orange tip emissive)
    m_deb = _create_material(asset_tools, dest_game_path, "M_XsxbParry_Debris", unreal.BlendMode.BLEND_OPAQUE, unlit=False)
    d_base = mel.create_material_expression(m_deb, unreal.MaterialExpressionVectorParameter, -420, -140)
    d_base.set_editor_property("parameter_name", "MetalColor")
    d_base.set_editor_property("default_value", unreal.LinearColor(0.32, 0.33, 0.36, 1.0))
    d_met = mel.create_material_expression(m_deb, unreal.MaterialExpressionConstant, -420, 20)
    d_met.set_editor_property("r", 1.0)
    d_rgh = mel.create_material_expression(m_deb, unreal.MaterialExpressionConstant, -420, 100)
    d_rgh.set_editor_property("r", 0.22)
    d_uv1 = mel.create_material_expression(m_deb, unreal.MaterialExpressionTextureCoordinate, -520, 200)
    d_uv1.set_editor_property("coordinate_index", 1)
    d_hot = _add_custom_expr(
        m_deb,
        "return float3(1.0, 0.36, 0.06) * (UV1.x * 4.0);",
        unreal.CustomMaterialOutputType.CMOT_FLOAT3,
        [("UV1", d_uv1, "")],
    )
    mel.connect_material_property(d_base, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(d_met, "", unreal.MaterialProperty.MP_METALLIC)
    mel.connect_material_property(d_rgh, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(d_hot, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(m_deb)

    # 6. M_XsxbParry_Refract (Translucent refraction ring/bulge/double; Opacity = 0 -> adds zero colour)
    m_refr = _create_material(asset_tools, dest_game_path, "M_XsxbParry_Refract", unreal.BlendMode.BLEND_TRANSLUCENT, unlit=True)
    r_uv = mel.create_material_expression(m_refr, unreal.MaterialExpressionTextureCoordinate, -520, -100)
    r_prm = mel.create_material_expression(m_refr, unreal.MaterialExpressionVectorParameter, -520, 40)
    r_prm.set_editor_property("parameter_name", "RefrParams")
    r_prm.set_editor_property("default_value", unreal.LinearColor(30.0, 0.5, 0.08, 0.0))
    r_zero = mel.create_material_expression(m_refr, unreal.MaterialExpressionConstant, -220, -120)
    r_zero.set_editor_property("r", 0.0)
    c_ior = _add_custom_expr(
        m_refr,
        """float2 p = UV * 2.0 - 1.0; float r = length(p);
if (r > 1.0 || PrmA <= 0.001) return 1.0;
float dr = (r - PrmRGB.g) / max(PrmRGB.b, 0.01);
float o = exp(-dr * dr) * smoothstep(1.0, 0.85, r);
return 1.0 + o * (PrmRGB.r / 720.0) * PrmA * 1.8;""",
        unreal.CustomMaterialOutputType.CMOT_FLOAT1,
        [("UV", r_uv, ""), ("PrmRGB", r_prm, ""), ("PrmA", r_prm, "A")],
    )
    mel.connect_material_property(r_zero, "", unreal.MaterialProperty.MP_OPACITY)
    mel.connect_material_property(c_ior, "", unreal.MaterialProperty.MP_REFRACTION)
    mel.recompile_material(m_refr)

    # 7. Normal-tier material instances: star_normal / flash_normal were imported but nothing used them, so 普通格挡
    #    always showed the perfect-tier masks. MI_*_Normal override StarTex / FlashTex; the C++ component swaps the
    #    same parameters per tier from StarTexture/StarNormalTexture/FlashTexture/FlashNormalTexture (see component_props).
    mi_normal: Dict[str, Any] = {}
    for key, parent, param in [("star", m_star, "StarTex"), ("flash", m_flash, "FlashTex")]:
        tex_n = tex_assets.get(f"{key}_normal")
        if tex_n is None:
            continue
        mi_name = f"MI_XsxbParry_{key.capitalize()}_Normal"
        mi = asset_tools.create_asset(mi_name, dest_game_path, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        if mi is None:
            mi = unreal.EditorAssetLibrary.load_asset(f"{dest_game_path}/{mi_name}")
        mel.set_material_instance_parent(mi, parent)
        mel.set_material_instance_texture_parameter_value(mi, param, tex_n)
        mel.update_material_instance(mi)
        mi_normal[key] = mi

    component_props = {
        "StarMaterial": m_star, "FlashMaterial": m_flash, "AdditiveMaterial": m_add, "SmokeMaterial": m_smoke,
        "DebrisMaterial": m_deb, "RefractionMaterial": m_refr,
        "StarTexture": tex_assets.get("star"), "StarNormalTexture": tex_assets.get("star_normal") or tex_assets.get("star"),
        "FlashTexture": tex_assets.get("flash"), "FlashNormalTexture": tex_assets.get("flash_normal") or tex_assets.get("flash"),
    }

    if save_assets:
        unreal.EditorAssetLibrary.save_directory(dest_game_path, only_if_is_dirty=False, recursive=True)

    return {
        "component_props": component_props,
        "normal_material_instances": mi_normal,
        "recipe": recipe,
        "ush_length": len(ush_text),
        "textures": tex_assets,
        "sounds": sound_assets,
        "materials": {
            "star": m_star,
            "flash": m_flash,
            "add": m_add,
            "ember": m_emb,
            "smoke": m_smoke,
            "debris": m_deb,
            "refract": m_refr,
        },
    }
