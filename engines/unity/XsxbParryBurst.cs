// XSXB-Slash Parry Burst runtime for Unity (Built-in & URP, `xsxb-parry` v1, docs/SPEC_PARRY.md).
// Install: copy `XsxbParryBurst.shader` and `XsxbParryBurst.cs` into `Assets/XsxbSlash/` (and `Editor/XsxbParryInstaller.cs` into `Assets/XsxbSlash/Editor/`).
// Import all textures with sRGB OFF; `smoke.png` Repeat, others Clamp.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using UnityEngine;
using UnityEngine.Rendering;

[DisallowMultipleComponent]
public class XsxbParryBurst : MonoBehaviour
{
    public TextAsset recipe;
    public string recipeFilePath = ""; // Optional filesystem path fallback
    public Shader parryShader;
    public Texture2D starTex;
    public Texture2D starNormalTex;
    public Texture2D sparkTex;
    public Texture2D flashTex;
    public Texture2D flashNormalTex;
    public Texture2D smokeTex;
    public Texture2D refractionTex;
    public AudioClip normalSfx;
    public AudioClip perfectSfx;
    public AudioClip[] normalSfxPool;
    public AudioClip[] perfectSfxPool;
    public bool sfxEnabled = true;
    public bool sfx2D = true;
    public float normalSfxVolume = 1.35f;
    public float perfectSfxVolume = 1.75f;

    public float scaleMul = 1.0f;
    public float floorYOverride = float.NaN; // NaN = use recipe.frame.floorY (-1.1 m)
    public bool autoTriggerOnStart = false;
    public bool manualClock = false;
    public Camera renderCameraOverride;      // Optional camera reference for offscreen RenderTexture capture
    public bool hasOpaqueTexture = true;     // True when URP Opaque Texture is enabled

    private const float FixedDt = 1.0f / 240.0f;
    private const float MaxDuration = 1.85f;

    // Parsed recipe data
    private bool _loaded;
    private Dictionary<string, object> _rootJson;
    private bool _hasDualTiers;
    private int _recipeSeed = 77;
    private string _recipeTier = "perfect";
    private Vector3 _frameBladeA = new Vector3(0.5507f, 0.8211f, 0.1502f);
    private Vector3 _frameBladeB = new Vector3(-0.5698f, 0.8098f, -0.1400f);
    private Vector3 _frameEdgeA = new Vector3(0.7917f, -0.5708f, 0.2177f);
    private Vector3 _frameSpray1 = new Vector3(0.3996f, 0.9114f, -0.0985f);
    private Vector3 _frameSpray2 = new Vector3(-0.6813f, 0.5190f, -0.5162f);
    private float _frameFloorY = -1.1f;

    private float _hitstopS = 0.08f, _tremor = 1.0f, _shake = 1.0f, _tremorHz = 44.0f;

    private bool _starEnabled = true;
    private Vector3 _starCore = Vector3.one, _starEdge = new Vector3(1f, 0.45f, 0.11f);
    private float _starHdr = 26f, _starSizeM = 1.05f, _starLifeS = 0.13f, _starPow = 2.2f;

    private bool _lightEnabled = true;
    private float _glowAmt = 0.38f, _glowSizeMul = 1.0f;
    private float _lightInt = 20f, _lightRangeM = 6.5f, _lightDecayS = 0.085f, _lightOffsetZ = 0.18f;
    private Vector3 _lightCol = new Vector3(1f, 0.45f, 0.11f);

    private bool _flashEnabled = true;
    private bool _flashIsCircular = true;
    private string _flashStyle = "sphere";
    private Vector3 _flashCore = new Vector3(1f, 0.96f, 0.85f), _flashCol = new Vector3(1f, 0.55f, 0.16f);
    private float _flashSizeM = 1.05f, _flashOpacity = 0.68f, _flashBlur = 0.28f, _flashHdr = 9.5f, _flashLifeS = 0.14f;
    private float _flashExpand = 0.55f, _flashHollow = 0f, _flashSpin = 0f;
    private int _flashRings = 3, _flashSeed = 17;
    private float _flashLenM = 2.45f, _flashWidthRatio = 0.002f, _flashSpreadDeg = 22f;
    private int _flashCount = 2;
    private readonly List<Vector3> _flashAxes = new List<Vector3>();
    private readonly List<float> _flashLenMul = new List<float>();
    private bool _needlesEnabled;
    private Vector3 _needlesCol = new Vector3(1f, 0.76f, 0.4f);
    private float _needlesLenM = 2.45f, _needlesWidthRatio = 0.0022f, _needlesSpreadDeg = 22f, _needlesHdr = 28f, _needlesLifeS = 0.075f;
    private int _needlesCount = 2;
    private readonly List<Vector3> _needlesAxes = new List<Vector3>();
    private readonly List<float> _needlesLenMul = new List<float>();

    private struct LobeDef { public bool hasAxis; public Vector3 axis; public float share; public float coneMul; }
    private struct TierDef
    {
        public string name;
        public int count;
        public Vector2 speed, drag, life, width, heat, cool;
        public float gravity, streak, maxLen, cone, clip;
    }

    private bool _sparksEnabled = true;
    private Vector3 _spHot = new Vector3(1f, 0.9f, 0.72f), _spMid = new Vector3(1f, 0.45f, 0.06f), _spCool = new Vector3(0.67f, 0.04f, 0.01f);
    private float _spHdr = 12f, _spGravity = 12.5f, _spBounce = 0.48f;
    private readonly List<LobeDef> _spLobes = new List<LobeDef>();
    private readonly List<TierDef> _spTiers = new List<TierDef>();
    private bool _hasEmberObj, _emberEnabled;
    private int _emSeed = 25;
    private Vector3 _emHot = new Vector3(1f, 0.9f, 0.72f), _emMid = new Vector3(1f, 0.45f, 0.06f), _emCool = new Vector3(0.67f, 0.04f, 0.01f);
    private float _emHdr = 12f, _emGravity = 3.6f, _emFlicker = 0.18f;
    private TierDef _emTier;

    private bool _ribbonEnabled = true;
    private string _ribbonStyle = "whip";
    private int _ribbonLeaders = 8;
    private float _ribbonWidthM = 0.0075f, _ribbonTrailS = 0.26f, _ribbonHdr = 16f, _ribbonSphereR = 0.34f, _ribbonSphereCone = 48f;
    private Vector3 _ribbonCol = new Vector3(1f, 0.51f, 0.16f);

    private bool _sfxCfgEnabled = true;
    private float _sfxPeakOffsetS = 0.015f;
    private readonly Dictionary<string, float[]> _sfxPoolPeaks = new Dictionary<string, float[]>();
    private readonly Dictionary<string, int> _lastSfxPick = new Dictionary<string, int>();
    private int _pendingSfxIdx = -1;
    private float _preLeadTimer = -1f;

    private bool _smokeEnabled = true;
    private string _smokeStyle = "ink";
    private Vector3 _smokeCol = new Vector3(0.0015f, 0.0015f, 0.0021f);
    private float _smokeOpacity = 0.78f, _smokeSizeMul = 1f, _smokeLifeMul = 1f;
    private int _smokePuffs = 10, _smokeDark = 32;

    private bool _debrisEnabled = true;
    private int _debrisCount = 26;
    private float _debrisSizeMul = 1f, _debrisSpeedMul = 1.05f, _debrisBounce = 0.32f;
    private Vector2 _debrisSizeM = new Vector2(0.004f, 0.011f), _debrisSpeedMS = new Vector2(1.2f, 4.8f);

    private bool _refrEnabled = true;
    private string _refrStyle = "ring";
    private bool _refrHasTex;
    private float _refrStrength = 30f, _refrRadiusM = 1.45f, _refrLifeS = 0.32f;

    // Runtime state
    private bool _playing;
    private float _tau = -1f;
    private float _simT;
    private int _activeSeed = 77;
    private string _activeTier = "perfect";
    private Quaternion _frameBasis = Quaternion.identity;

    private struct TrailPt { public Vector3 p; public float t; }
    private class SparkP
    {
        public int ti, bounces, id;
        public Vector3 p, v, curl, postCurl, p0, p1, pExit, dOut, flick, vAx, vOrig;
        public float drag, life, w, heat, cool, g, delay, dist, bri, lk, clip, streak, maxLen;
        public float arcLen, sParam, surfSpd, tipDist, vOmega, skimSign;
        public bool leader, leftSphere, slidOff, standaloneEmber, useAbsG;
        public string rbMode;
        public List<TrailPt> trail;
    }
    private class DarkP { public Vector3 p, v; public float drag, life, w, g, dist; }
    private class DebrisP { public Vector3 p, v, ax; public float drag, g, size, spin, dist; public int bounces; }
    private struct SmokePuffCfg { public Vector3 d; public float spd, life, s0, ox, oy, rot, del; public bool isInk, isPuff; }

    private readonly List<SparkP> _sparksState = new List<SparkP>();
    private readonly List<DarkP> _darkState = new List<DarkP>();
    private readonly List<DebrisP> _debrisState = new List<DebrisP>();
    private readonly List<SmokePuffCfg> _smokeCfg = new List<SmokePuffCfg>();

    // Scene child objects & meshes
    private Transform _rootContainer;
    private MeshRenderer _starMr, _glowMr, _flashMr, _addMr, _darkMr, _smokeMr, _debrisMr, _refrMr;
    private Material _starMat, _glowMat, _flashMat, _addMat, _darkMat, _smokeMat, _debrisMat, _refrMat;
    private Mesh _quadMesh, _addMesh, _darkMesh, _smokeMesh, _debrisMesh;
    private Light _pointLight;
    private AudioSource _audioSource;
    private Texture2D _procNoiseTex, _procFlashTex;
    private bool _smokeIsMask;

    // Reusable dynamic geometry buffers
    private readonly List<Vector3> _vBuf = new List<Vector3>(4096);
    private readonly List<Vector3> _nBuf = new List<Vector3>(1024);
    private readonly List<Color> _cBuf = new List<Color>(4096);
    private readonly List<Vector2> _uv0Buf = new List<Vector2>(4096);
    private readonly List<Vector4> _uv1Buf = new List<Vector4>(4096);
    private readonly List<int> _iBuf = new List<int>(6144);

    public struct ClashMotion
    {
        public bool hitstopActive;
        public float tremorRad;
        public Vector3 shakeOffset;
    }

    private struct SeededRng
    {
        private uint _a;
        public SeededRng(uint seed) { _a = seed == 0u ? 1u : seed; }
        public float Next()
        {
            _a += 0x6D2B79F5u;
            uint t = (_a ^ (_a >> 15)) * (1u | _a);
            t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t;
            return ((t ^ (t >> 14)) >> 0) / 4294967296.0f;
        }
        public float Range(float lo, float hi) { return lo + (hi - lo) * Next(); }
    }

    private static uint HashInts(int a, int b)
    {
        uint h = 2166136261u;
        h = StepHash(h, a);
        h = StepHash(h, b);
        return h;
    }
    private static uint HashInts(int a, int b, int c)
    {
        uint h = 2166136261u;
        h = StepHash(h, a);
        h = StepHash(h, b);
        h = StepHash(h, c);
        return h;
    }
    private static uint HashInts(int a, int b, int c, int d)
    {
        uint h = 2166136261u;
        h = StepHash(h, a);
        h = StepHash(h, b);
        h = StepHash(h, c);
        h = StepHash(h, d);
        return h;
    }
    private static uint StepHash(uint h, int v)
    {
        unchecked
        {
            uint x = (uint)v + 0x9E3779B9u;
            h = (h ^ x) * 2246822507u;
            h = (h ^ (h >> 13)) * 3266489909u;
            return h ^ (h >> 16);
        }
    }

    private static float SStep(float a, float b, float x)
    {
        if (Mathf.Abs(b - a) < 1e-9f) return x >= b ? 1f : 0f;
        float t = Mathf.Clamp01((x - a) / (b - a));
        return t * t * (3f - 2f * t);
    }

    private void Awake()
    {
        EnsureNodes();
        if (recipe != null) LoadRecipeJson(recipe.text, null);
        else if (!string.IsNullOrEmpty(recipeFilePath) && File.Exists(recipeFilePath))
            LoadRecipeFromFile(recipeFilePath);
    }

    private void Start()
    {
        if (autoTriggerOnStart && _loaded) Trigger();
    }

    private void OnDestroy()
    {
        if (_rootContainer != null) DestroyImmediate(_rootContainer.gameObject);
        DestroySafe(_starMat); DestroySafe(_glowMat); DestroySafe(_flashMat); DestroySafe(_addMat);
        DestroySafe(_darkMat); DestroySafe(_smokeMat); DestroySafe(_debrisMat); DestroySafe(_refrMat);
        DestroySafe(_quadMesh); DestroySafe(_addMesh); DestroySafe(_darkMesh);
        DestroySafe(_smokeMesh); DestroySafe(_debrisMesh); DestroySafe(_procNoiseTex); DestroySafe(_procFlashTex);
    }

    private static void DestroySafe(UnityEngine.Object o)
    {
        if (o == null) return;
        if (Application.isPlaying) Destroy(o);
        else DestroyImmediate(o);
    }

    public bool LoadRecipeFromFile(string jsonPath)
    {
        if (string.IsNullOrEmpty(jsonPath) || !File.Exists(jsonPath)) return false;
        recipeFilePath = jsonPath;
        string txt = File.ReadAllText(jsonPath);
        return LoadRecipeJson(txt, Path.GetDirectoryName(jsonPath));
    }

    public bool LoadRecipeJson(string jsonText, string baseDir = null)
    {
        EnsureNodes();
        if (string.IsNullOrEmpty(jsonText)) return false;
        Dictionary<string, object> root = MiniJson.Parse(jsonText) as Dictionary<string, object>;
        if (root == null) return false;

        string fmt = GetStr(root, "format", GetStr(root, "kind", ""));
        int ver = GetInt(root, "version", 0);
        if (fmt != "xsxb-parry" || ver != 1)
        {
            Debug.LogError("XsxbParryBurst: unsupported recipe format=" + fmt + " version=" + ver);
            return false;
        }

        _rootJson = root;
        _hasDualTiers = GetObj(root, "tiers") != null;
        _recipeSeed = GetInt(root, "seed", 77);
        string rawTier = GetStr(root, "tier", "perfect");
        _recipeTier = rawTier == "normal" ? "normal" : "perfect";
        _activeSeed = _recipeSeed;
        _activeTier = _recipeTier;

        var frm = GetObj(root, "frame");
        if (frm != null)
        {
            // Flip Z from right-handed web frame to left-handed Unity frame
            _frameBladeA = FlipZ(GetVec3(frm, "bladeA", new Vector3(0.5507f, 0.8211f, -0.1502f)));
            _frameBladeB = FlipZ(GetVec3(frm, "bladeB", new Vector3(-0.5698f, 0.8098f, 0.1400f)));
            _frameEdgeA = FlipZ(GetVec3(frm, "edgeA", new Vector3(0.7917f, -0.5708f, -0.2177f)));
            _frameSpray1 = FlipZ(GetVec3(frm, "sprayMain", new Vector3(0.3996f, 0.9114f, 0.0985f)));
            _frameSpray2 = FlipZ(GetVec3(frm, "spraySecondary", new Vector3(-0.6813f, 0.5190f, 0.5162f)));
            _frameFloorY = GetFloat(frm, "floorY", -1.1f);
        }

        ApplyTierDict(_activeTier, baseDir, loadAssetsFromDisk: !string.IsNullOrEmpty(baseDir));
        BindLoadedTextures();
        _loaded = true;
        return true;
    }

    private void ApplyTierDict(string tierKey, string baseDir = null, bool loadAssetsFromDisk = false)
    {
        if (_rootJson == null) return;
        string tk = tierKey == "normal" ? "normal" : "perfect";
        Dictionary<string, object> tiersObj = GetObj(_rootJson, "tiers");
        Dictionary<string, object> src = (tiersObj != null ? GetObj(tiersObj, tk) : null) ?? _rootJson;
        _recipeSeed = GetInt(src, "seed", GetInt(_rootJson, "seed", 77));

        var cl = GetObj(src, "clash") ?? GetObj(_rootJson, "clash");
        if (cl != null)
        {
            _hitstopS = GetFloat(cl, "hitstopS", 0.08f);
            _tremor = GetFloat(cl, "tremor", 1.0f);
            _shake = GetFloat(cl, "shake", 1.0f);
            _tremorHz = GetFloat(cl, "tremorHz", 44.0f);
        }

        var st = GetObj(src, "star");
        if (st != null)
        {
            _starEnabled = GetBool(st, "enabled", true);
            _starCore = GetVec3(st, "core", Vector3.one);
            _starEdge = GetVec3(st, "edge", new Vector3(1f, 0.45f, 0.11f));
            _starHdr = GetFloat(st, "hdr", 26f);
            _starSizeM = GetFloat(st, "sizeM", 1.05f);
            _starLifeS = GetFloat(st, "lifeS", 0.13f);
            _starPow = GetFloat(st, "contrastPow", 2.2f);
            if (loadAssetsFromDisk)
            {
                if (starTex == null)
                    starTex = LoadLinearPng(Path.Combine(baseDir, GetStr(_rootJson != null ? GetObj(_rootJson, "star") : st, "texture", "textures/star.png")), TextureWrapMode.Clamp);
                if (starNormalTex == null && tiersObj != null)
                {
                    var normSt = GetObj(GetObj(tiersObj, "normal"), "star");
                    string nRel = GetStr(normSt, "texture", "");
                    if (!string.IsNullOrEmpty(nRel))
                        starNormalTex = LoadLinearPng(Path.Combine(baseDir, nRel), TextureWrapMode.Clamp);
                }
            }
        }

        var nd = GetObj(src, "needles");
        _needlesEnabled = nd != null && GetBool(nd, "enabled", true);
        if (nd != null)
        {
            _needlesCol = GetVec3(nd, "color", new Vector3(1f, 0.76f, 0.4f));
            _needlesLenM = GetFloat(nd, "lengthM", 2.45f);
            _needlesWidthRatio = GetFloat(nd, "widthRatio", 0.0022f);
            _needlesSpreadDeg = GetFloat(nd, "spreadDeg", 22f);
            _needlesHdr = GetFloat(nd, "hdr", 28f);
            _needlesLifeS = GetFloat(nd, "lifeS", 0.075f);
            _needlesCount = GetInt(nd, "count", 2);
            _needlesAxes.Clear();
            var nAx = GetList(nd, "axes");
            if (nAx != null) foreach (var it in nAx) if (it is List<object> l3 && l3.Count >= 3) _needlesAxes.Add(FlipZ(new Vector3(ToF(l3[0]), ToF(l3[1]), ToF(l3[2]))).normalized);
            if (_needlesAxes.Count == 0) { _needlesAxes.Add(FlipZ(new Vector3(0.55f, 0.82f, -0.15f)).normalized); _needlesAxes.Add(FlipZ(new Vector3(-0.57f, 0.81f, 0.14f)).normalized); }
            _needlesLenMul.Clear();
            var nLm = GetList(nd, "lengthMul");
            if (nLm != null) foreach (var m in nLm) _needlesLenMul.Add(ToF(m));
            if (_needlesLenMul.Count == 0) { _needlesLenMul.Add(1f); _needlesLenMul.Add(0.62f); _needlesLenMul.Add(0.42f); _needlesLenMul.Add(0.32f); }
        }

        var ltTop = GetObj(src, "light") ?? (st != null ? GetObj(st, "light") : null);
        if (ltTop != null)
        {
            _lightEnabled = GetBool(ltTop, "enabled", true);
            _lightInt = GetFloat(ltTop, "intensity", 16f);
            _lightRangeM = GetFloat(ltTop, "rangeM", 6.5f);
            _lightDecayS = GetFloat(ltTop, "decayS", 0.085f);
            _lightOffsetZ = GetFloat(ltTop, "offsetTowardsCamM", 0.18f);
            _lightCol = GetVec3(ltTop, "color", _starEdge);
            var gl = GetObj(ltTop, "glow") ?? (st != null ? GetObj(st, "glow") : null);
            if (gl != null) { _glowAmt = GetFloat(gl, "amount", 0.38f); _glowSizeMul = GetFloat(gl, "sizeMul", 1.0f); }
        }
        else if (st != null)
        {
            var gl = GetObj(st, "glow");
            if (gl != null) { _glowAmt = GetFloat(gl, "amount", 0.38f); _glowSizeMul = 1.0f; }
        }

        var fl = GetObj(src, "flash");
        if (fl != null)
        {
            _flashEnabled = GetBool(fl, "enabled", true);
            _flashIsCircular = fl.ContainsKey("style") || fl.ContainsKey("sizeM") || fl.ContainsKey("opacity");
            _flashStyle = GetStr(fl, "style", "sphere");
            _flashCore = GetVec3(fl, "core", new Vector3(1f, 0.96f, 0.85f));
            _flashCol = GetVec3(fl, "color", new Vector3(1f, 0.55f, 0.16f));
            _flashSizeM = GetFloat(fl, "sizeM", 1.05f);
            _flashOpacity = GetFloat(fl, "opacity", 0.68f);
            _flashBlur = GetFloat(fl, "blur", 0.28f);
            _flashHdr = GetFloat(fl, "hdr", _flashIsCircular ? 9.5f : 28f);
            _flashLifeS = GetFloat(fl, "lifeS", _flashIsCircular ? 0.14f : 0.105f);
            _flashExpand = GetFloat(fl, "expand", 0.55f);
            _flashHollow = GetFloat(fl, "hollow", 0f);
            _flashRings = GetInt(fl, "rings", 3);
            _flashSpin = GetFloat(fl, "spin", 0f);
            _flashSeed = GetInt(fl, "seed", 17);
            _flashLenM = GetFloat(fl, "lengthM", 2.45f);
            _flashWidthRatio = GetFloat(fl, "widthRatio", 0.002f);
            _flashCount = GetInt(fl, "count", 2);
            _flashSpreadDeg = GetFloat(fl, "spreadDeg", 22f);
            _flashAxes.Clear();
            var axList = GetList(fl, "axes");
            if (axList != null)
                foreach (var item in axList)
                    if (item is List<object> l3 && l3.Count >= 3)
                        _flashAxes.Add(FlipZ(new Vector3(ToF(l3[0]), ToF(l3[1]), ToF(l3[2]))).normalized);
            if (_flashAxes.Count == 0)
            {
                _flashAxes.Add(new Vector3(0.17f, 0.93f, 0.33f).normalized);
                _flashAxes.Add(new Vector3(0.98f, -0.17f, -0.04f).normalized);
            }
            _flashLenMul.Clear();
            var lmList = GetList(fl, "lengthMul");
            if (lmList != null) foreach (var m in lmList) _flashLenMul.Add(ToF(m));
            if (_flashLenMul.Count == 0) { _flashLenMul.Add(1f); _flashLenMul.Add(0.62f); _flashLenMul.Add(0.42f); }
            if (loadAssetsFromDisk)
            {
                var topFl = _rootJson != null ? (GetObj(_rootJson, "flash") ?? fl) : fl;
                if (flashTex == null)
                    flashTex = LoadLinearPng(Path.Combine(baseDir, GetStr(topFl, "texture", "textures/flash.png")), TextureWrapMode.Clamp);
                if (flashNormalTex == null && tiersObj != null)
                {
                    var normFl = GetObj(GetObj(tiersObj, "normal"), "flash");
                    string fnRel = GetStr(normFl, "texture", "");
                    if (!string.IsNullOrEmpty(fnRel))
                        flashNormalTex = LoadLinearPng(Path.Combine(baseDir, fnRel), TextureWrapMode.Clamp);
                }
            }
        }

        var sp = GetObj(src, "sparks");
        if (sp != null)
        {
            _sparksEnabled = GetBool(sp, "enabled", true);
            _spHot = GetVec3(sp, "hot", new Vector3(1f, 0.9f, 0.72f));
            _spMid = GetVec3(sp, "mid", new Vector3(1f, 0.45f, 0.06f));
            _spCool = GetVec3(sp, "cool", new Vector3(0.67f, 0.04f, 0.01f));
            _spHdr = GetFloat(sp, "hdr", 12f);
            _spGravity = GetFloat(sp, "gravity", 12.5f);
            _spBounce = GetFloat(sp, "floorBounce", 0.48f);

            _spLobes.Clear();
            var lbList = GetList(sp, "lobes");
            if (lbList != null)
            {
                foreach (var item in lbList)
                {
                    if (item is Dictionary<string, object> ld)
                    {
                        LobeDef lb = new LobeDef { share = GetFloat(ld, "share", 1f), coneMul = GetFloat(ld, "coneMul", 1f) };
                        if (ld.TryGetValue("axis", out object axObj) && axObj is List<object> al && al.Count >= 3)
                        {
                            lb.hasAxis = true;
                            lb.axis = FlipZ(new Vector3(ToF(al[0]), ToF(al[1]), ToF(al[2]))).normalized;
                        }
                        _spLobes.Add(lb);
                    }
                }
            }
            if (_spLobes.Count == 0)
            {
                _spLobes.Add(new LobeDef { hasAxis = true, axis = _frameSpray1, share = 0.65f, coneMul = 1f });
                _spLobes.Add(new LobeDef { hasAxis = true, axis = _frameSpray2, share = 0.35f, coneMul = 1f });
            }

            _spTiers.Clear();
            var trList = GetList(sp, "tiers");
            if (trList != null)
            {
                foreach (var item in trList)
                {
                    if (item is Dictionary<string, object> td)
                    {
                        _spTiers.Add(new TierDef
                        {
                            name = GetStr(td, "name", "arc"),
                            count = GetInt(td, "count", 60),
                            speed = GetVec2(td, "speed", new Vector2(2f, 8f)),
                            drag = GetVec2(td, "drag", new Vector2(1f, 3f)),
                            life = GetVec2(td, "life", new Vector2(0.3f, 1.0f)),
                            gravity = GetFloat(td, "gravity", 1f),
                            width = GetVec2(td, "width", new Vector2(0.001f, 0.002f)),
                            streak = GetFloat(td, "streak", 0.032f),
                            maxLen = GetFloat(td, "maxLen", 0.42f),
                            cone = GetFloat(td, "cone", 40f),
                            heat = GetVec2(td, "heat", new Vector2(0.9f, 1f)),
                            cool = GetVec2(td, "cool", new Vector2(0.4f, 1.0f)),
                            clip = GetFloat(td, "clip", 0f)
                        });
                    }
                }
            }
            if (loadAssetsFromDisk && sparkTex == null)
                sparkTex = LoadLinearPng(Path.Combine(baseDir, GetStr(sp, "texture", "textures/spark.png")), TextureWrapMode.Clamp);
        }

        var em = GetObj(src, "ember");
        _hasEmberObj = em != null;
        _emberEnabled = em != null && GetBool(em, "enabled", false);
        if (em != null)
        {
            _emSeed = GetInt(em, "seed", 25);
            _emHot = GetVec3(em, "hot", _spHot);
            _emMid = GetVec3(em, "mid", _spMid);
            _emCool = GetVec3(em, "cool", _spCool);
            _emHdr = GetFloat(em, "hdr", 12f);
            _emGravity = GetFloat(em, "gravity", 3.6f);
            _emFlicker = GetFloat(em, "flicker", 0.18f);
            var etd = GetObj(em, "tier") ?? new Dictionary<string, object>();
            _emTier = new TierDef
            {
                name = "ember",
                count = GetInt(etd, "count", 68),
                speed = GetVec2(etd, "speed", new Vector2(2f, 7f)),
                drag = GetVec2(etd, "drag", new Vector2(2.2f, 4.4f)),
                life = GetVec2(etd, "life", new Vector2(0.75f, 1.7f)),
                gravity = _emGravity,
                width = GetVec2(etd, "width", new Vector2(0.0046f, 0.0088f)),
                streak = 0.006f, maxLen = 0.035f,
                cone = GetFloat(etd, "cone", 58f),
                heat = GetVec2(etd, "heat", new Vector2(0.92f, 1f)),
                cool = GetVec2(etd, "cool", new Vector2(0.62f, 1.35f)),
                clip = 0.3333f
            };
        }

        var rb = GetObj(src, "ribbon");
        if (rb != null)
        {
            _ribbonEnabled = GetBool(rb, "enabled", true);
            _ribbonStyle = GetStr(rb, "style", "whip");
            _ribbonLeaders = GetInt(rb, "leaders", 8);
            _ribbonWidthM = GetFloat(rb, "widthM", 0.0075f);
            _ribbonTrailS = GetFloat(rb, "trailS", 0.26f);
            _ribbonHdr = GetFloat(rb, "hdr", 16f);
            _ribbonSphereR = GetFloat(rb, "sphereRadiusM", 0.34f);
            _ribbonSphereCone = GetFloat(rb, "sphereConeDeg", 48f);
            _ribbonCol = GetVec3(rb, "color", new Vector3(1f, 0.51f, 0.16f));
        }

        var sm = GetObj(src, "smoke");
        if (sm != null)
        {
            _smokeEnabled = GetBool(sm, "enabled", true);
            _smokeStyle = GetStr(sm, "style", "ink");
            _smokeCol = GetVec3(sm, "color", new Vector3(0.0015f, 0.0015f, 0.0021f));
            _smokeOpacity = GetFloat(sm, "opacity", 0.78f);
            _smokeSizeMul = GetFloat(sm, "sizeMul", 1f);
            _smokeLifeMul = GetFloat(sm, "lifeMul", 1f);
            _smokePuffs = GetInt(sm, "puffs", 10);
            _smokeDark = GetInt(sm, "darkSparks", 32);
            if (loadAssetsFromDisk && smokeTex == null)
                smokeTex = LoadLinearPng(Path.Combine(baseDir, GetStr(sm, "texture", "textures/smoke.png")), TextureWrapMode.Repeat);
        }

        var db = GetObj(src, "debris");
        if (db != null)
        {
            _debrisEnabled = GetBool(db, "enabled", true);
            _debrisCount = GetInt(db, "count", 26);
            _debrisSizeMul = GetFloat(db, "sizeMul", 1f);
            _debrisSpeedMul = GetFloat(db, "speedMul", 1.05f);
            _debrisSizeM = GetVec2(db, "sizeM", new Vector2(0.004f, 0.011f));
            _debrisSpeedMS = GetVec2(db, "speedMS", new Vector2(1.2f, 4.8f));
            _debrisBounce = GetFloat(db, "floorBounce", 0.32f);
        }

        var rf = GetObj(src, "refraction");
        if (rf != null)
        {
            _refrEnabled = GetBool(rf, "enabled", true);
            _refrStyle = GetStr(rf, "style", "ring");
            string rfTexRel = GetStr(rf, "texture", "");
            if (loadAssetsFromDisk && refractionTex == null && !string.IsNullOrEmpty(rfTexRel))
                refractionTex = LoadLinearPng(Path.Combine(baseDir, rfTexRel), TextureWrapMode.Clamp);
            _refrHasTex = refractionTex != null;
            _refrStrength = GetFloat(rf, "strengthPx720", 30f);
            _refrRadiusM = GetFloat(rf, "radiusM", 1.45f);
            _refrLifeS = GetFloat(rf, "lifeS", 0.32f);
        }

        var sx = GetObj(src, "sfx");
        if (sx != null)
        {
            _sfxCfgEnabled = GetBool(sx, "enabled", true);
            _sfxPeakOffsetS = Mathf.Max(0f, GetFloat(sx, "peakOffsetS", 0.015f));
            var poolObj = sx.ContainsKey("pool") ? sx["pool"] as List<object> : null;
            if (poolObj != null && poolObj.Count > 0)
            {
                var peaks = new List<float>(poolObj.Count);
                var clips = new List<AudioClip>(poolObj.Count);
                for (int pi = 0; pi < poolObj.Count; pi++)
                {
                    var ent = poolObj[pi] as Dictionary<string, object>;
                    float pk = ent != null ? Mathf.Max(0f, GetFloat(ent, "peakOffsetS", _sfxPeakOffsetS)) : _sfxPeakOffsetS;
                    peaks.Add(pk);
                    if (loadAssetsFromDisk && ent != null)
                    {
                        string rel = GetStr(ent, "file", "");
                        if (!string.IsNullOrEmpty(rel))
                        {
                            var c = LoadWavClip(Path.Combine(baseDir, rel), Path.GetFileNameWithoutExtension(rel));
                            if (c != null) clips.Add(c);
                        }
                    }
                }
                _sfxPoolPeaks[tk] = peaks.ToArray();
                if (loadAssetsFromDisk && clips.Count > 0)
                {
                    if (tk == "normal" && (normalSfxPool == null || normalSfxPool.Length == 0)) normalSfxPool = clips.ToArray();
                    if (tk == "perfect" && (perfectSfxPool == null || perfectSfxPool.Length == 0)) perfectSfxPool = clips.ToArray();
                }
            }
        }
        if (loadAssetsFromDisk)
        {
            if (normalSfx == null) normalSfx = LoadWavClip(Path.Combine(baseDir, "audio/parry_normal.wav"), "parry_normal");
            if (perfectSfx == null) perfectSfx = LoadWavClip(Path.Combine(baseDir, "audio/parry_perfect.wav"), "parry_perfect");
        }
    }

    private static AudioClip LoadWavClip(string path, string clipName)
    {
        if (!File.Exists(path)) return null;
        byte[] u8 = File.ReadAllBytes(path);
        if (u8.Length < 44) return null;
        if (u8[0] != 'R' || u8[1] != 'I' || u8[2] != 'F' || u8[3] != 'F') return null;
        int pos = 12, ch = 2, sr = 48000, bits = 16, dataOff = 0, dataLen = 0;
        while (pos + 8 <= u8.Length)
        {
            string id = System.Text.Encoding.ASCII.GetString(u8, pos, 4);
            int sz = BitConverter.ToInt32(u8, pos + 4);
            if (id == "fmt ")
            {
                ch = BitConverter.ToInt16(u8, pos + 10);
                sr = BitConverter.ToInt32(u8, pos + 12);
                bits = BitConverter.ToInt16(u8, pos + 22);
            }
            else if (id == "data")
            {
                dataOff = pos + 8;
                dataLen = Mathf.Min(sz, u8.Length - dataOff);
                break;
            }
            pos += 8 + sz + (sz & 1);
        }
        if (dataOff <= 0 || dataLen <= 0 || bits != 16 || ch <= 0) return null;
        int totalSamples = dataLen / 2;
        int frames = totalSamples / ch;
        float[] samples = new float[frames * ch];
        for (int i = 0; i < samples.Length; i++)
            samples[i] = BitConverter.ToInt16(u8, dataOff + i * 2) / 32768f;
        AudioClip clip = AudioClip.Create(clipName, frames, ch, sr, stream: false);
        clip.SetData(samples, 0);
        return clip;
    }

    private static Vector3 FlipZ(Vector3 v) { return new Vector3(v.x, v.y, -v.z); }

    private static Texture2D LoadLinearPng(string path, TextureWrapMode wrap)
    {
        if (!File.Exists(path)) return null;
        byte[] bytes = File.ReadAllBytes(path);
        Texture2D tex = new Texture2D(2, 2, TextureFormat.RGBA32, mipChain: true, linear: true);
        tex.LoadImage(bytes, markNonReadable: false);
        tex.wrapMode = wrap;
        tex.filterMode = FilterMode.Trilinear;
        return tex;
    }

    private static Texture2D MakeProcNoiseTex(int seedVal, int n = 128)
    {
        Texture2D tex = new Texture2D(n, n, TextureFormat.RFloat, mipChain: true, linear: true);
        tex.wrapMode = TextureWrapMode.Repeat;
        tex.filterMode = FilterMode.Trilinear;
        Color[] cols = new Color[n * n];
        for (int y = 0; y < n; y++)
        {
            for (int x = 0; x < n; x++)
            {
                float s = 0f, amp = 0.5f;
                int c = 4;
                for (int o = 0; o < 5; o++)
                {
                    float fx = (float)x / n * c, fy = (float)y / n * c;
                    int ix = Mathf.FloorToInt(fx), iy = Mathf.FloorToInt(fy);
                    float tx = fx - ix, ty = fy - iy;
                    float sx = tx * tx * (3f - 2f * tx), sy = ty * ty * (3f - 2f * ty);
                    float a = HashInts(ix % c, iy % c, o, seedVal) / 4294967296f;
                    float b = HashInts((ix + 1) % c, iy % c, o, seedVal) / 4294967296f;
                    float cc = HashInts(ix % c, (iy + 1) % c, o, seedVal) / 4294967296f;
                    float d = HashInts((ix + 1) % c, (iy + 1) % c, o, seedVal) / 4294967296f;
                    s += (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy) * amp;
                    amp *= 0.5f;
                    c *= 2;
                }
                float v = Mathf.Clamp01(s / 0.97f);
                cols[y * n + x] = new Color(v, v, v, 1f);
            }
        }
        tex.SetPixels(cols);
        tex.Apply(updateMipmaps: true, makeNoLongerReadable: false);
        return tex;
    }

    private static Texture2D MakeProcFlashTex(string style, int seedVal, int rings = 3, int n = 256)
    {
        SeededRng rng = new SeededRng(HashInts(seedVal, 19));
        int nr = Mathf.Clamp(rings, 1, 8);
        float p1 = rng.Next() * Mathf.PI * 2f, p2 = rng.Next() * Mathf.PI * 2f, p3 = rng.Next() * Mathf.PI * 2f;
        int k1 = 3 + Mathf.FloorToInt(rng.Next() * 4f), k2 = 5 + Mathf.FloorToInt(rng.Next() * 6f);
        float rIn = Mathf.Lerp(0.48f, 0.58f, rng.Next());
        Texture2D tex = new Texture2D(n, n, TextureFormat.RFloat, mipChain: true, linear: true);
        tex.wrapMode = TextureWrapMode.Clamp;
        tex.filterMode = FilterMode.Trilinear;
        Color[] cols = new Color[n * n];
        for (int y = 0; y < n; y++)
        {
            for (int x = 0; x < n; x++)
            {
                float px = (x + 0.5f) / n * 2f - 1f, py = (y + 0.5f) / n * 2f - 1f;
                float rr = Mathf.Sqrt(px * px + py * py);
                if (rr >= 0.99f) { cols[y * n + x] = new Color(0f, 0f, 0f, 1f); continue; }
                float ang = Mathf.Atan2(py, px), bEnv = SStep(0.99f, 0.935f, rr), v;
                if (style == "ripple")
                {
                    float rw = rr + 0.012f * Mathf.Sin(k1 * ang + p1) + 0.008f * Mathf.Cos(k2 * ang + p2);
                    float ph = Mathf.Clamp01((rw - 0.10f) / 0.83f) * nr * Mathf.PI * 2f - p3 * 0.35f;
                    float waves = Mathf.Pow(0.5f + 0.5f * Mathf.Cos(ph), 2.8f) * SStep(0.06f, 0.18f, rr) * (0.55f + 0.45f * SStep(0.95f, 0.25f, rr));
                    v = 0.82f * Mathf.Exp(-Mathf.Pow(rr / 0.14f, 2f)) + waves * 0.78f + 0.52f * Mathf.Exp(-Mathf.Pow((rr - 0.90f) / 0.042f, 2f));
                }
                else if (style == "halo")
                {
                    float wob = 1f + 0.014f * Mathf.Sin(k1 * ang + p1);
                    v = 0.84f * Mathf.Exp(-Mathf.Pow((rr * wob - 0.83f) / 0.058f, 2f)) + 0.38f * Mathf.Exp(-Mathf.Pow((rr - 0.64f) / 0.040f, 2f))
                      + 0.24f * Mathf.Max(0f, 1f - Mathf.Pow(rr / 0.92f, 2f)) + 0.50f * Mathf.Exp(-Mathf.Pow(rr / 0.11f, 2f));
                }
                else
                {
                    float u = Mathf.Min(1f, rr / 0.945f), z = Mathf.Sqrt(Mathf.Max(0f, 1f - u * u));
                    float vol = 0.36f * z + 0.44f * Mathf.Pow(u, 2.5f) * SStep(0.985f, 0.85f, rr) + 0.42f * Mathf.Exp(-Mathf.Pow((rr - 0.90f) / 0.042f, 2f));
                    v = 0.90f * Mathf.Exp(-Mathf.Pow(rr / 0.15f, 2f)) + vol + 0.50f * Mathf.Exp(-Mathf.Pow((rr - rIn) / 0.040f, 2f));
                }
                float fv = Mathf.Clamp01(v) * bEnv;
                cols[y * n + x] = new Color(fv, fv, fv, 1f);
            }
        }
        tex.SetPixels(cols);
        tex.Apply(updateMipmaps: true, makeNoLongerReadable: false);
        return tex;
    }

    private void BindLoadedTextures()
    {
        if (starTex != null) _starMat.SetTexture("_MainTex", starTex);
        DestroySafe(_procFlashTex);
        if (flashTex == null) _procFlashTex = MakeProcFlashTex(_flashStyle, _flashSeed, _flashRings, 256);
        Texture2D baseFlTex = flashTex != null ? flashTex : _procFlashTex;
        if (baseFlTex != null) _flashMat.SetTexture("_MainTex", baseFlTex);
        if (sparkTex != null)
        {
            _addMat.SetTexture("_MainTex", sparkTex);
            if (flashTex != null) _addMat.SetTexture("_SecondTex", flashTex);
            _addMat.SetFloat("_UseTex", 1f);
        }
        else
        {
            _addMat.SetFloat("_UseTex", 0f);
        }

        DestroySafe(_procNoiseTex);
        _procNoiseTex = MakeProcNoiseTex(_recipeSeed + 307, 128);
        _smokeIsMask = false;
        if (smokeTex != null && smokeTex.isReadable && smokeTex.width >= 256)
        {
            float cornerAvg = (
                smokeTex.GetPixel(0, 0).r +
                smokeTex.GetPixel(smokeTex.width - 1, 0).r +
                smokeTex.GetPixel(0, smokeTex.height - 1).r +
                smokeTex.GetPixel(smokeTex.width - 1, smokeTex.height - 1).r
            ) * 0.25f;
            if (cornerAvg < 0.03f) _smokeIsMask = true;
        }
        if (_smokeIsMask)
        {
            _smokeMat.SetTexture("_MainTex", _procNoiseTex);
            _smokeMat.SetTexture("_SecondTex", smokeTex);
            _smokeMat.SetFloat("_SubMode", 1f);
        }
        else
        {
            _smokeMat.SetTexture("_MainTex", smokeTex != null ? smokeTex : _procNoiseTex);
            _smokeMat.SetFloat("_SubMode", 0f);
        }

        if (refractionTex != null)
        {
            _refrMat.SetTexture("_MainTex", refractionTex);
            _refrHasTex = true;
        }
    }

    private void EnsureNodes()
    {
        if (_rootContainer != null) return;
        Shader sh = parryShader != null ? parryShader : Shader.Find("XSXB-Slash/ParryBurst");
        if (sh == null)
        {
            Debug.LogError("XsxbParryBurst: Shader 'XSXB-Slash/ParryBurst' not found.");
            return;
        }

        GameObject rootGo = new GameObject("_XsxbParryRuntime");
        rootGo.hideFlags = HideFlags.DontSave;
        _rootContainer = rootGo.transform;

        _quadMesh = BuildUnitQuad();
        _addMesh = new Mesh { name = "XsxbParryAdd" }; _addMesh.MarkDynamic();
        _darkMesh = new Mesh { name = "XsxbParryDark" }; _darkMesh.MarkDynamic();
        _smokeMesh = new Mesh { name = "XsxbParrySmoke" }; _smokeMesh.MarkDynamic();
        _debrisMesh = new Mesh { name = "XsxbParryDebris" }; _debrisMesh.MarkDynamic();

        _glowMat = CreatePassMat(sh, passKind: 0f, subMode: 1f, queue: 3060, additive: true, zTestAlways: true, opaque: false);
        _starMat = CreatePassMat(sh, passKind: 0f, subMode: 0f, queue: 3070, additive: true, zTestAlways: true, opaque: false);
        _flashMat = CreatePassMat(sh, passKind: 0f, subMode: 2f, queue: 3040, additive: false, zTestAlways: true, opaque: false);
        _flashMat.SetFloat("_SrcBlend", (float)BlendMode.One);
        _flashMat.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
        _addMat = CreatePassMat(sh, passKind: 1f, subMode: 0f, queue: 3050, additive: true, zTestAlways: false, opaque: false);
        _darkMat = CreatePassMat(sh, passKind: 3f, subMode: 0f, queue: 3020, additive: false, zTestAlways: false, opaque: false);
        _smokeMat = CreatePassMat(sh, passKind: 2f, subMode: 0f, queue: 3010, additive: false, zTestAlways: false, opaque: false);
        _debrisMat = CreatePassMat(sh, passKind: 5f, subMode: 0f, queue: 2050, additive: false, zTestAlways: false, opaque: true);
        _refrMat = CreatePassMat(sh, passKind: 4f, subMode: 0f, queue: 2990, additive: false, zTestAlways: false, opaque: false);

        _glowMr = MakeMeshChild("Glow", _quadMesh, _glowMat);
        _starMr = MakeMeshChild("Star", _quadMesh, _starMat);
        _flashMr = MakeMeshChild("CircularFlash", _quadMesh, _flashMat);
        _addMr = MakeMeshChild("AdditiveBatch", _addMesh, _addMat);
        _darkMr = MakeMeshChild("DarkSparks", _darkMesh, _darkMat);
        _smokeMr = MakeMeshChild("SmokePuffs", _smokeMesh, _smokeMat);
        _debrisMr = MakeMeshChild("DebrisShards", _debrisMesh, _debrisMat);
        _refrMr = MakeMeshChild("Refraction", _quadMesh, _refrMat);

        GameObject ltGo = new GameObject("ClashPointLight");
        ltGo.transform.SetParent(_rootContainer, false);
        _pointLight = ltGo.AddComponent<Light>();
        _pointLight.type = LightType.Point;
        _pointLight.range = 6.5f;
        _pointLight.shadows = LightShadows.None;
        _pointLight.intensity = 0f;

        GameObject auGo = new GameObject("ClashAudioSource");
        auGo.transform.SetParent(_rootContainer, false);
        _audioSource = auGo.AddComponent<AudioSource>();
        _audioSource.playOnAwake = false;
        _audioSource.spatialBlend = sfx2D ? 0f : 0.35f;
        _audioSource.minDistance = 2.5f;
        _audioSource.maxDistance = 28f;

        HideAll();
    }

    private static Material CreatePassMat(Shader sh, float passKind, float subMode, int queue, bool additive, bool zTestAlways, bool opaque)
    {
        Material m = new Material(sh) { renderQueue = queue, hideFlags = HideFlags.DontSave };
        m.SetFloat("_PassKind", passKind);
        m.SetFloat("_SubMode", subMode);
        if (opaque)
        {
            m.SetFloat("_SrcBlend", (float)BlendMode.One);
            m.SetFloat("_DstBlend", (float)BlendMode.Zero);
            m.SetFloat("_ZWrite", 1f);
            m.SetFloat("_ZTest", (float)CompareFunction.LessEqual);
        }
        else
        {
            m.SetFloat("_SrcBlend", (float)(additive ? BlendMode.One : BlendMode.SrcAlpha));
            m.SetFloat("_DstBlend", (float)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
            m.SetFloat("_ZWrite", 0f);
            m.SetFloat("_ZTest", (float)(zTestAlways ? CompareFunction.Always : CompareFunction.LessEqual));
        }
        return m;
    }

    private MeshRenderer MakeMeshChild(string childName, Mesh mesh, Material mat)
    {
        GameObject go = new GameObject(childName);
        go.transform.SetParent(_rootContainer, false);
        MeshFilter mf = go.AddComponent<MeshFilter>();
        mf.sharedMesh = mesh;
        MeshRenderer mr = go.AddComponent<MeshRenderer>();
        mr.sharedMaterial = mat;
        mr.shadowCastingMode = ShadowCastingMode.Off;
        mr.receiveShadows = false;
        return mr;
    }

    private static Mesh BuildUnitQuad()
    {
        Mesh m = new Mesh { name = "XsxbUnitQuad" };
        m.vertices = new[]
        {
            new Vector3(-0.5f, -0.5f, 0f),
            new Vector3( 0.5f, -0.5f, 0f),
            new Vector3( 0.5f,  0.5f, 0f),
            new Vector3(-0.5f,  0.5f, 0f)
        };
        m.uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) };
        m.triangles = new[] { 0, 2, 1, 0, 3, 2 };
        m.RecalculateBounds();
        return m;
    }

    public void AlignToWeapons(Vector3 defenderHiltToClash)
    {
        if (defenderHiltToClash.sqrMagnitude > 1e-4f && _frameBladeA.sqrMagnitude > 1e-4f)
            _frameBasis = Quaternion.FromToRotation(_frameBladeA.normalized, defenderHiltToClash.normalized);
        else
            _frameBasis = Quaternion.identity;
    }

    public ClashMotion SampleClashMotion(float tau)
    {
        if (tau < 0f) return new ClashMotion();
        float trDeg = _tremor * 1.6f * Mathf.Exp(-tau / (_hitstopS + 0.07f)) * Mathf.Sin(Mathf.PI * 2f * _tremorHz * tau);
        float shAmp = tau < 0.25f ? (0.006f * _shake * Mathf.Exp(-tau / 0.06f)) : 0f;
        return new ClashMotion
        {
            hitstopActive = tau < _hitstopS,
            tremorRad = trDeg * Mathf.Deg2Rad,
            shakeOffset = new Vector3(shAmp * Mathf.Sin(tau * 260f), shAmp * Mathf.Cos(tau * 310f), 0f)
        };
    }

    private int PickSfxIndex(string tk, int count)
    {
        if (count <= 1) { _lastSfxPick[tk] = 0; return 0; }
        int last = _lastSfxPick.TryGetValue(tk, out int lv) ? lv : -1;
        int idx = UnityEngine.Random.Range(0, count);
        if (idx == last) idx = (idx + UnityEngine.Random.Range(1, count)) % count;
        _lastSfxPick[tk] = idx;
        return idx;
    }

    private void PlayTierSfx(float leadSeconds)
    {
        if (!sfxEnabled || !_sfxCfgEnabled || _audioSource == null) return;
        string tk = _activeTier == "normal" ? "normal" : "perfect";
        AudioClip[] pool = tk == "normal" ? normalSfxPool : perfectSfxPool;
        AudioClip clip = null;
        float peakOff = _sfxPeakOffsetS;
        if (pool != null && pool.Length > 0)
        {
            int idx = (_pendingSfxIdx >= 0 && _pendingSfxIdx < pool.Length) ? _pendingSfxIdx : PickSfxIndex(tk, pool.Length);
            _pendingSfxIdx = -1;
            clip = pool[idx];
            if (_sfxPoolPeaks.TryGetValue(tk, out float[] pks) && idx < pks.Length) peakOff = pks[idx];
        }
        if (clip == null)
            clip = tk == "normal" ? (normalSfx != null ? normalSfx : perfectSfx) : (perfectSfx != null ? perfectSfx : normalSfx);
        if (clip == null) return;
        _audioSource.transform.position = transform.position;
        _audioSource.spatialBlend = sfx2D ? 0f : 0.35f;
        _audioSource.volume = Mathf.Max(0f, tk == "normal" ? normalSfxVolume : perfectSfxVolume);
        _audioSource.clip = clip;
        float seekT = Mathf.Clamp(peakOff - Mathf.Max(0f, leadSeconds), 0f, Mathf.Max(0f, clip.length - 0.01f));
        _audioSource.time = seekT;
        _audioSource.Play();
    }

    public void TriggerPreLead(float leadSeconds, string tierOverride = "")
    {
        if (!_loaded && recipe != null) LoadRecipeJson(recipe.text, null);
        if (!_loaded) return;
        string rawT = string.IsNullOrEmpty(tierOverride) ? _recipeTier : tierOverride;
        _activeTier = rawT == "normal" ? "normal" : "perfect";
        ApplyTierDict(_activeTier);
        AudioClip[] pool = _activeTier == "normal" ? normalSfxPool : perfectSfxPool;
        float peakOff = _sfxPeakOffsetS;
        if (pool != null && pool.Length > 0)
        {
            _pendingSfxIdx = PickSfxIndex(_activeTier, pool.Length);
            if (_sfxPoolPeaks.TryGetValue(_activeTier, out float[] pks) && _pendingSfxIdx < pks.Length) peakOff = pks[_pendingSfxIdx];
        }
        else _pendingSfxIdx = -1;
        if (leadSeconds <= 0.001f)
        {
            Trigger(_activeTier);
            return;
        }
        _preLeadTimer = leadSeconds;
        if (leadSeconds <= peakOff) PlayTierSfx(leadSeconds);
    }

    public void Trigger(string tierOverride = "", int seedOverride = -1)
    {
        if (!_loaded && recipe != null) LoadRecipeJson(recipe.text, null);
        if (!_loaded) return;
        string rawT = string.IsNullOrEmpty(tierOverride) ? _recipeTier : tierOverride;
        _activeTier = rawT == "normal" ? "normal" : "perfect";
        ApplyTierDict(_activeTier);
        Texture2D activeStar = (_activeTier == "normal" && starNormalTex != null) ? starNormalTex : starTex;
        if (activeStar != null) _starMat.SetTexture("_MainTex", activeStar);
        Texture2D activeFlash = (_activeTier == "normal" && flashNormalTex != null) ? flashNormalTex : (flashTex != null ? flashTex : _procFlashTex);
        if (activeFlash != null) _flashMat.SetTexture("_MainTex", activeFlash);
        _activeSeed = seedOverride >= 0 ? seedOverride : _recipeSeed;
        _preLeadTimer = -1f;
        ResetSimulation();
        _tau = 0f;
        _playing = true;
        PlayTierSfx(0f);
        RenderAtTau(0f);
    }

    public void Seek(float tau, string tierOverride = "", int seedOverride = -1)
    {
        if (!_loaded && recipe != null) LoadRecipeJson(recipe.text, null);
        if (!_loaded) return;
        if (tau < 0f)
        {
            _playing = false;
            HideAll();
            return;
        }
        string rawT = string.IsNullOrEmpty(tierOverride) ? _recipeTier : tierOverride;
        string wantTier = rawT == "normal" ? "normal" : "perfect";
        if (wantTier != _activeTier)
        {
            _activeTier = wantTier;
            ApplyTierDict(_activeTier);
            Texture2D activeStar = (_activeTier == "normal" && starNormalTex != null) ? starNormalTex : starTex;
            if (activeStar != null) _starMat.SetTexture("_MainTex", activeStar);
            ResetSimulation();
        }
        int wantSeed = seedOverride >= 0 ? seedOverride : _recipeSeed;
        if (wantSeed != _activeSeed || tau < _simT || (_sparksState.Count == 0 && _simT == 0f))
        {
            _activeSeed = wantSeed;
            ResetSimulation();
        }
        _tau = tau;
        _playing = tau < MaxDuration;
        StepSimulationTo(tau);
        RenderAtTau(tau);
    }

    private void LateUpdate()
    {
        if (!_loaded) return;
        if (_preLeadTimer >= 0f)
        {
            float prev = _preLeadTimer;
            _preLeadTimer -= Mathf.Min(Time.deltaTime, 0.05f);
            if (prev > _sfxPeakOffsetS && _preLeadTimer <= _sfxPeakOffsetS && _preLeadTimer > 0f)
                PlayTierSfx(_preLeadTimer);
            if (_preLeadTimer <= 0f)
            {
                _preLeadTimer = -1f;
                ResetSimulation();
                _tau = 0f;
                _playing = true;
                RenderAtTau(0f);
                return;
            }
        }
        if (manualClock || !_playing) return;
        _tau += Mathf.Min(Time.deltaTime, 0.05f);
        if (_tau >= MaxDuration)
        {
            _playing = false;
            HideAll();
            return;
        }
        StepSimulationTo(_tau);
        RenderAtTau(_tau);
    }

    private void HideAll()
    {
        if (_starMr != null) _starMr.enabled = false;
        if (_glowMr != null) _glowMr.enabled = false;
        if (_flashMr != null) _flashMr.enabled = false;
        if (_addMr != null) _addMr.enabled = false;
        if (_darkMr != null) _darkMr.enabled = false;
        if (_smokeMr != null) _smokeMr.enabled = false;
        if (_debrisMr != null) _debrisMr.enabled = false;
        if (_refrMr != null) _refrMr.enabled = false;
        if (_pointLight != null) _pointLight.intensity = 0f;
    }

    private Vector3 XfDir(Vector3 localDir)
    {
        return transform.TransformDirection(_frameBasis * localDir).normalized;
    }

    private float FloorWorldY()
    {
        float relY = float.IsNaN(floorYOverride) ? _frameFloorY : floorYOverride;
        return transform.position.y + relY * scaleMul;
    }

    private static Vector3 ConeDir(ref SeededRng rng, bool hasAxis, Vector3 axis, float halfDeg)
    {
        if (!hasAxis)
        {
            float z = 2f * rng.Next() - 1f;
            float ph = Mathf.PI * 2f * rng.Next();
            float q = Mathf.Sqrt(Mathf.Max(0f, 1f - z * z));
            return new Vector3(q * Mathf.Cos(ph), Mathf.Abs(z) * 0.6f + z * 0.4f + 0.15f, q * Mathf.Sin(ph)).normalized;
        }
        Vector3 ax = axis.normalized;
        float ct = Mathf.Lerp(Mathf.Cos(halfDeg * Mathf.Deg2Rad), 1f, rng.Next());
        float st = Mathf.Sqrt(Mathf.Max(0f, 1f - ct * ct));
        float phi = Mathf.PI * 2f * rng.Next();
        Vector3 refV = Mathf.Abs(ax.y) < 0.9f ? Vector3.up : Vector3.right;
        Vector3 u = Vector3.Cross(ax, refV).normalized;
        Vector3 w = Vector3.Cross(ax, u).normalized;
        return (ax * ct + u * (st * Mathf.Cos(phi)) + w * (st * Mathf.Sin(phi))).normalized;
    }

    private void GetTierFlags(out bool ribbonOn, out bool smokeOn, out bool debrisOn, out bool refrOn, out float starMul, out float sparkMul, out int flashBonus, out bool refrDouble)
    {
        if (_hasDualTiers)
        {
            ribbonOn = _ribbonEnabled;
            smokeOn = _smokeEnabled;
            debrisOn = _debrisEnabled;
            refrOn = _refrEnabled;
            starMul = 1f;
            sparkMul = 1f;
            flashBonus = 0;
            refrDouble = false;
            return;
        }
        bool isNorm = _activeTier == "normal";
        ribbonOn = !isNorm && _ribbonEnabled;
        smokeOn = !isNorm && _smokeEnabled;
        debrisOn = !isNorm && _debrisEnabled;
        refrOn = !isNorm && _refrEnabled;
        starMul = isNorm ? 0.82f : 1f;
        sparkMul = isNorm ? 0.75f : 1f;
        flashBonus = 0;
        refrDouble = false;
    }

    private void ResetSimulation()
    {
        _simT = 0f;
        _sparksState.Clear();
        _darkState.Clear();
        _debrisState.Clear();
        _smokeCfg.Clear();

        GetTierFlags(out bool ribbonOn, out bool smokeOn, out bool debrisOn, out _, out _, out float sparkMul, out _, out _);
        Vector3 origin = transform.position;
        Vector3 s1 = XfDir(_frameSpray1);
        Vector3 s2 = XfDir(_frameSpray2);
        Vector3 bA = XfDir(_frameBladeA);
        Vector3 bB = XfDir(_frameBladeB);
        Vector3 eA = XfDir(_frameEdgeA);

        SeededRng rngSp = new SeededRng(HashInts(_activeSeed, 207, 101));
        if (_sparksEnabled)
        {
            for (int ti = 0; ti < _spTiers.Count; ti++)
            {
                TierDef td = _spTiers[ti];
                int cnt = Mathf.RoundToInt(td.count * sparkMul);
                for (int i = 0; i < cnt; i++)
                {
                    float pick = rngSp.Next();
                    LobeDef chosen = _spLobes[_spLobes.Count - 1];
                    for (int l = 0; l < _spLobes.Count; l++)
                    {
                        if (pick < _spLobes[l].share) { chosen = _spLobes[l]; break; }
                        pick -= _spLobes[l].share;
                    }
                    Vector3 lobAx = chosen.hasAxis ? XfDir(chosen.axis) : Vector3.zero;
                    Vector3 d = ConeDir(ref rngSp, chosen.hasAxis, lobAx, td.cone * chosen.coneMul);
                    float pw = ti == 0 ? 0.6f : 1.4f;
                    float sp = Mathf.Lerp(td.speed.x, td.speed.y, Mathf.Pow(rngSp.Next(), pw)) * scaleMul;
                    float delay = ti == 1 ? (rngSp.Next() * 0.018f) : (ti == 0 ? (Mathf.Pow(rngSp.Next(), 2f) * 0.03f) : 0f);
                    _sparksState.Add(new SparkP
                    {
                        ti = ti,
                        p = origin + d * (0.01f * scaleMul),
                        v = d * sp,
                        drag = rngSp.Range(td.drag.x, td.drag.y),
                        life = Mathf.Min(MaxDuration, rngSp.Range(td.life.x, td.life.y)),
                        w = rngSp.Range(td.width.x, td.width.y) * scaleMul,
                        heat = rngSp.Range(td.heat.x, td.heat.y),
                        cool = rngSp.Range(td.cool.x, td.cool.y),
                        g = td.gravity,
                        delay = delay,
                        id = i + ti * 1000,
                        bri = rngSp.Range(0.45f, 1.25f),
                        lk = ti == 0 ? Mathf.Lerp(0.5f, 2.4f, Mathf.Pow(rngSp.Next(), 2.2f)) : Mathf.Lerp(0.55f, 1.7f, Mathf.Pow(rngSp.Next(), 1.5f)),
                        clip = td.clip,
                        streak = td.streak,
                        maxLen = td.maxLen * scaleMul,
                        rbMode = ""
                    });
                }
            }
        }

        if (_hasEmberObj && _emberEnabled && _emTier != null)
        {
            SeededRng rngEm = new SeededRng(HashInts(_activeSeed, _emSeed, 102));
            LobeDef[] emLobes = new[]
            {
                new LobeDef { hasAxis = true, axis = s1, share = 0.58f, coneMul = 1.0f },
                new LobeDef { hasAxis = true, axis = s2, share = 0.28f, coneMul = 1.05f },
                new LobeDef { hasAxis = false, axis = Vector3.zero, share = 0.14f, coneMul = 1.2f }
            };
            int emCnt = Mathf.RoundToInt(_emTier.count * sparkMul);
            for (int i = 0; i < emCnt; i++)
            {
                float pk = rngEm.Next();
                LobeDef ch = emLobes[2];
                for (int l = 0; l < 3; l++) { if (pk < emLobes[l].share) { ch = emLobes[l]; break; } pk -= emLobes[l].share; }
                Vector3 d = ConeDir(ref rngEm, ch.hasAxis, ch.axis, _emTier.cone * ch.coneMul);
                float sp = Mathf.Lerp(_emTier.speed.x, _emTier.speed.y, Mathf.Pow(rngEm.Next(), 1.25f)) * scaleMul;
                _sparksState.Add(new SparkP
                {
                    ti = 2, p = origin + d * (0.01f * scaleMul), v = d * sp,
                    drag = rngEm.Range(_emTier.drag.x, _emTier.drag.y),
                    life = Mathf.Min(MaxDuration, rngEm.Range(_emTier.life.x, _emTier.life.y)),
                    w = rngEm.Range(_emTier.width.x, _emTier.width.y) * scaleMul,
                    heat = rngEm.Range(_emTier.heat.x, _emTier.heat.y),
                    cool = rngEm.Range(_emTier.cool.x, _emTier.cool.y),
                    g = _emGravity, delay = rngEm.Next() * 0.012f, id = 20000 + i,
                    bri = rngEm.Range(0.65f, 1.35f), lk = 1f, clip = 0.3333f, streak = 0.006f, maxLen = 0.035f * scaleMul,
                    standaloneEmber = true, useAbsG = true, rbMode = ""
                });
            }
        }

        if (ribbonOn)
        {
            SeededRng rngRb = new SeededRng(HashInts(_activeSeed, 207, 505));
            int nl = Mathf.Max(1, _ribbonLeaders);
            string sty = string.IsNullOrEmpty(_ribbonStyle) ? "whip" : _ribbonStyle;
            float sphR = Mathf.Clamp(_ribbonSphereR, 0.15f, 0.75f) * scaleMul;
            float maxAng = Mathf.Clamp(_ribbonSphereCone, 20f, 72f) * Mathf.Deg2Rad;
            // FlipZ of web (-0.99, -0.03, +0.02) pointing straight from C through Left Defender
            Vector3 sphDir = XfDir(new Vector3(-0.99f, -0.03f, -0.02f).normalized);
            Vector3 pApex = origin + sphDir * (0.055f * scaleMul);
            Vector3 vAx = (bA + bB).sqrMagnitude > 0.1f ? (bA + bB).normalized : Vector3.up;
            float spinSign = rngRb.Next() < 0.5f ? 1f : -1f;

            if (sty == "sphereScatter")
            {
                Vector3 refU = Mathf.Abs(sphDir.y) < 0.9f ? Vector3.up : Vector3.right;
                Vector3 e1 = Vector3.Cross(sphDir, refU).normalized;
                Vector3 e2 = Vector3.Cross(sphDir, e1).normalized;
                int nRibs = 7 + Mathf.FloorToInt(rngRb.Next() * 5f);
                float ph0 = rngRb.Next() * Mathf.PI * 2f, ph1 = rngRb.Next() * Mathf.PI * 2f, ph2 = rngRb.Next() * Mathf.PI * 2f;
                for (int i = 0; i < nl; i++)
                {
                    float phi = ((float)i / nl) * Mathf.PI * 2f + (rngRb.Next() - 0.5f) * (2.2f / Mathf.Max(4, nl));
                    float flute = 1f + 0.21f * Mathf.Cos(nRibs * phi + ph0) + 0.10f * Mathf.Sin(3f * phi + ph1) + 0.06f * Mathf.Cos(2f * phi + ph2);
                    Vector3 radDir = (e1 * (Mathf.Cos(phi) * 1.06f) + e2 * (Mathf.Sin(phi) * 0.86f)).normalized;
                    float strat = (i * 0.6180339887f) % 1f;
                    float rho = nl == 1 ? 0.25f : (i == 0 ? rngRb.Range(0.08f, 0.14f) : Mathf.Lerp(0.20f, 1f, strat * 0.72f + rngRb.Next() * 0.28f));
                    float alpha = Mathf.Clamp(rho * (0.80f + 0.28f * flute) * maxAng, 0.05f, 1.18f);
                    float lCup = sphR * Mathf.Lerp(1.55f, 1.12f, rho) * (0.90f + 0.14f * flute);
                    float rRim = sphR * (0.28f + 0.34f * rho) * flute + lCup * Mathf.Tan(alpha) * 0.56f;
                    Vector3 pExit = pApex + sphDir * lCup + radDir * rRim;
                    Vector3 dOut = (sphDir * Mathf.Cos(alpha) + radDir * Mathf.Sin(alpha)).normalized;
                    Vector3 p1 = pApex + sphDir * (lCup * 0.24f) + radDir * (rRim * 0.78f);
                    Vector3 d0 = (p1 - origin).normalized;
                    float sp0 = rngRb.Range(8.6f, 10.8f) * scaleMul;
                    float arcLen = Mathf.Max(0.14f * scaleMul, Vector3.Distance(origin, p1) + Vector3.Distance(p1, pExit));
                    Vector3 swAx = Vector3.Cross(dOut, radDir).normalized;
                    Vector3 flareAx = (swAx * (0.72f * ((i % 2) == 1 ? 1f : -1f)) + radDir * 0.32f).normalized;
                    Vector3 postCurlS = flareAx * (rngRb.Range(2.2f, 4.4f) * (0.45f + 0.55f * rho));
                    _sparksState.Add(new SparkP
                    {
                        ti = 1, p = origin, v = d0 * sp0,
                        drag = 0.02f, life = Mathf.Min(MaxDuration, rngRb.Range(0.72f, 1.12f)),
                        w = 0.0016f * scaleMul, heat = 1f, cool = rngRb.Range(0.90f, 1.30f),
                        g = 0f, delay = rngRb.Next() * 0.006f, id = 9000 + i,
                        bri = 1.42f, lk = 1.3f, streak = 0.032f, maxLen = 0.42f * scaleMul,
                        leader = true, trail = new List<TrailPt>(64),
                        curl = Vector3.zero, postCurl = postCurlS, rbMode = sty,
                        p0 = origin, p1 = p1, pExit = pExit, dOut = dOut,
                        arcLen = arcLen, sParam = 0f, surfSpd = sp0
                    });
                }
            }
            else
            {
                for (int i = 0; i < nl; i++)
                {
                    Vector3 d = Vector3.up, curl0 = Vector3.zero, radDir = Vector3.right, flick = Vector3.up;
                    Vector3 postCurl = new Vector3(rngRb.Next() - 0.5f, rngRb.Next() - 0.5f, rngRb.Next() - 0.5f).normalized * rngRb.Range(2f, 4.2f);
                    float sp0 = rngRb.Range(5f, 8.5f) * scaleMul, drg0 = rngRb.Range(0.5f, 1f), g0 = 1f, tipDist = 0.75f * scaleMul;

                    if (sty == "bladeSlide")
                    {
                        bool onB = (i % 2) == 1;
                        Vector3 bd = onB ? bB : bA;
                        Vector3 sideV = Vector3.Cross(bd, eA).normalized;
                        d = (bd + sideV * ((rngRb.Next() - 0.5f) * 0.08f)).normalized;
                        sp0 = rngRb.Range(12.5f, 16.5f) * scaleMul; drg0 = 0.08f; g0 = 0f;
                        tipDist = (onB ? 0.79f : 0.75f) * scaleMul;
                        flick = (eA * (onB ? -0.65f : 0.65f) + Vector3.up * 0.55f).normalized;
                        postCurl = sideV * ((rngRb.Next() < 0.5f ? 1f : -1f) * rngRb.Range(6.5f, 10.5f));
                    }
                    else if (sty == "deflectCone")
                    {
                        Vector3 pu = s1.normalized;
                        Vector3 pv = (-eA - pu * Vector3.Dot(-eA, pu)).normalized;
                        float ang = Mathf.Lerp(-0.92f, 0.92f, (i + 0.2f + 0.6f * rngRb.Next()) / nl);
                        d = (pu * Mathf.Cos(ang) + pv * Mathf.Sin(ang)).normalized;
                        sp0 = rngRb.Range(6.4f, 9.6f) * scaleMul; drg0 = rngRb.Range(0.85f, 1.25f); g0 = 1.15f;
                    }
                    else if (sty == "vortexWrap")
                    {
                        Vector3 refV = Mathf.Abs(vAx.y) < 0.9f ? Vector3.up : Vector3.right;
                        Vector3 u1 = Vector3.Cross(vAx, refV).normalized;
                        Vector3 u2 = Vector3.Cross(vAx, u1).normalized;
                        float ph = ((float)i / nl) * Mathf.PI * 2f + rngRb.Next() * 0.35f;
                        Vector3 rV = u1 * Mathf.Cos(ph) + u2 * Mathf.Sin(ph);
                        Vector3 tang = Vector3.Cross(vAx, rV) * spinSign;
                        d = (vAx * rngRb.Range(0.52f, 0.78f) + tang * 0.68f + rV * 0.22f).normalized;
                        sp0 = rngRb.Range(5.8f, 8.6f) * scaleMul; drg0 = rngRb.Range(0.55f, 0.95f); g0 = 0.25f;
                    }
                    else if (sty == "groundSkim")
                    {
                        float az = Mathf.Lerp(-2.5f, 2.5f, (i + 0.25f + 0.5f * rngRb.Next()) / nl);
                        d = XfDir(new Vector3(Mathf.Sin(az) * 0.62f, -rngRb.Range(0.78f, 0.95f), -(Mathf.Cos(az) * 0.52f + 0.16f)).normalized);
                        sp0 = rngRb.Range(10.5f, 14.8f) * scaleMul; drg0 = 0.32f; g0 = 1.8f;
                    }
                    else
                    {
                        Vector3 ax = (((i % 2 == 1) ? s2 : s1) * 0.8f + Vector3.up * 0.5f).normalized;
                        d = ConeDir(ref rngRb, true, ax, 40f);
                        curl0 = postCurl;
                    }

                    _sparksState.Add(new SparkP
                    {
                        ti = 1, p = origin + d * (0.01f * scaleMul), v = d * sp0,
                        drag = drg0, life = Mathf.Min(MaxDuration, rngRb.Range(0.8f, 1.3f)),
                        w = 0.0016f * scaleMul, heat = 1f, cool = rngRb.Range(0.8f, 1.2f),
                        g = g0, delay = rngRb.Next() * 0.012f, id = 9000 + i,
                        bri = 1.35f, lk = 1.3f, streak = 0.033f, maxLen = 0.44f * scaleMul,
                        leader = true, trail = new List<TrailPt>(64),
                        curl = curl0, postCurl = postCurl, rbMode = sty,
                        surfSpd = sp0,
                        tipDist = tipDist, flick = flick, vAx = vAx, vOrig = origin,
                        vOmega = spinSign * rngRb.Range(15f, 22f),
                        skimSign = ((i % 2 == 1) ? 1f : -1f) * rngRb.Range(3.6f, 6.4f)
                    });
                }
            }
        }

        if (smokeOn)
        {
            SeededRng rngDk = new SeededRng(HashInts(_activeSeed, 307, 202));
            for (int i = 0; i < _smokeDark; i++)
            {
                Vector3 d = ConeDir(ref rngDk, true, rngDk.Next() < 0.6f ? s1 : s2, 55f);
                _darkState.Add(new DarkP
                {
                    p = origin,
                    v = d * (rngDk.Range(2.5f, 7.5f) * scaleMul),
                    drag = rngDk.Range(1.5f, 3.0f),
                    life = rngDk.Range(0.35f, 0.85f),
                    w = rngDk.Range(0.003f, 0.006f) * scaleMul,
                    g = 0.8f
                });
            }

            SeededRng rngPf = new SeededRng(HashInts(_activeSeed, 307, 404));
            bool isInk = _smokeStyle == "ink";
            bool isWisp = _smokeStyle == "wisp";
            bool isPuff = !isInk && !isWisp;
            int puffCnt = _smokeIsMask ? Mathf.Max(1, Mathf.RoundToInt(_smokePuffs / 4f)) : _smokePuffs;
            for (int i = 0; i < puffCnt; i++)
            {
                Vector3 d = ConeDir(ref rngPf, true, rngPf.Next() < 0.55f ? s1 : s2, isInk ? 60f : 50f);
                float spd = isInk ? rngPf.Range(2f, 4.5f) : (isWisp ? rngPf.Range(1.2f, 2.6f) : rngPf.Range(0.6f, 1.7f));
                float life = rngPf.Range(0.35f, 0.7f) * _smokeLifeMul * (_smokeIsMask ? 1.2f : 1f) * (isInk ? 1.15f : 1f);
                float s0 = rngPf.Range(0.2f, 0.36f) * _smokeSizeMul * scaleMul * (_smokeIsMask ? 2.6f : 1f) * (isWisp ? 0.7f : 1f);
                _smokeCfg.Add(new SmokePuffCfg
                {
                    d = d, spd = spd * scaleMul, life = life, s0 = s0,
                    ox = rngPf.Next(), oy = rngPf.Next(),
                    rot = rngPf.Next() * Mathf.PI * 2f, del = rngPf.Next() * 0.03f,
                    isInk = isInk, isPuff = isPuff
                });
            }
        }

        if (debrisOn)
        {
            SeededRng rngDb = new SeededRng(HashInts(_activeSeed, 407, 303));
            for (int i = 0; i < _debrisCount; i++)
            {
                Vector3 d = ConeDir(ref rngDb, true, rngDb.Next() < 0.55f ? s1 : s2, 60f);
                Vector3 ax = new Vector3(rngDb.Next() - 0.5f, rngDb.Next() - 0.5f, rngDb.Next() - 0.5f);
                ax = ax.sqrMagnitude > 1e-5f ? ax.normalized : Vector3.up;
                _debrisState.Add(new DebrisP
                {
                    p = origin,
                    v = d * (rngDb.Range(_debrisSpeedMS.x, _debrisSpeedMS.y) * _debrisSpeedMul * scaleMul),
                    drag = rngDb.Range(0.5f, 1.4f),
                    g = 1f,
                    size = rngDb.Range(_debrisSizeM.x, _debrisSizeM.y) * _debrisSizeMul * scaleMul,
                    ax = ax,
                    spin = rngDb.Range(15f, 45f) * (rngDb.Next() < 0.5f ? -1f : 1f)
                });
            }
        }
    }

    private void StepSimulationTo(float targetTau)
    {
        float gmul = _spGravity * scaleMul;
        float fy = FloorWorldY() + 0.002f * scaleMul;

        while (_simT + FixedDt <= targetTau + 1e-9f)
        {
            _simT += FixedDt;
            for (int i = 0; i < _sparksState.Count; i++)
            {
                SparkP q = _sparksState[i];
                if (_simT < q.delay || (_simT - q.delay) > q.life) continue;
                q.v.y -= (q.useAbsG ? q.g * scaleMul : gmul * q.g) * FixedDt;
                if (q.rbMode == "vortexWrap")
                {
                    Vector3 rel = q.p - q.vOrig;
                    rel -= q.vAx * Vector3.Dot(rel, q.vAx);
                    if (rel.sqrMagnitude > 1e-8f)
                    {
                        Vector3 rn = rel.normalized;
                        Vector3 tang = Vector3.Cross(q.vAx, rn);
                        q.v += (-rn * (q.v.magnitude * 2.8f) + tang * (q.vOmega * 0.32f * scaleMul)) * FixedDt;
                    }
                }
                if (q.curl.sqrMagnitude > 1e-6f) q.v += Vector3.Cross(q.v, q.curl) * FixedDt;
                q.v *= 1f / (1f + q.drag * FixedDt);
                Vector3 oldP = q.p;
                q.p += q.v * FixedDt;
                if (q.rbMode == "sphereScatter" && !q.leftSphere)
                {
                    q.sParam += (q.surfSpd / q.arcLen) * FixedDt;
                    if (q.sParam < 1f)
                    {
                        float s = q.sParam, om = 1f - s;
                        q.p = (om * om) * q.p0 + (2f * om * s) * q.p1 + (s * s) * q.pExit;
                        Vector3 tanV = om * (q.p1 - q.p0) + s * (q.pExit - q.p1);
                        q.v = (tanV.sqrMagnitude > 1e-8f ? tanV.normalized : q.dOut) * q.surfSpd;
                    }
                    else
                    {
                        float over = Mathf.Max(0f, (q.sParam - 1f) * q.arcLen);
                        q.leftSphere = true; q.g = 0.52f; q.drag = 0.75f; q.curl = q.postCurl;
                        q.p = q.pExit + q.dOut * over;
                        q.v = q.dOut * q.surfSpd;
                    }
                }
                else if (q.rbMode == "bladeSlide" && !q.slidOff && q.dist >= q.tipDist)
                {
                    q.slidOff = true;
                    q.v = (q.v + q.flick * (q.v.magnitude * 0.46f)) * 0.72f;
                    q.g = 0.75f; q.drag = 1.55f; q.curl = q.postCurl;
                }
                if (q.p.y < fy)
                {
                    if (q.rbMode == "groundSkim")
                    {
                        q.p.y = fy + 0.003f * scaleMul;
                        if (q.bounces == 0)
                        {
                            float spH = q.v.magnitude * 0.82f;
                            float hl = Mathf.Max(1e-4f, Mathf.Sqrt(q.v.x * q.v.x + q.v.z * q.v.z));
                            q.v.x = q.v.x / hl * spH; q.v.z = q.v.z / hl * spH; q.v.y = 0.04f * scaleMul;
                            q.g = 0.05f; q.drag = 1.05f; q.curl = new Vector3(0f, q.skimSign, 0f); q.bounces = 1;
                        }
                        else if (q.v.y < 0f) q.v.y = 0f;
                    }
                    else if (q.rbMode == "sphereScatter")
                    {
                        q.p.y = fy + 0.028f * scaleMul;
                        if (q.v.y < 0f) q.v.y = Mathf.Max(0.08f * scaleMul, -q.v.y * 0.12f);
                        q.v.x *= 0.96f; q.v.z *= 0.96f;
                    }
                    else
                    {
                        q.p.y = fy + (fy - q.p.y) * 0.2f;
                        if (q.v.y < 0f)
                        {
                            q.v.y = -q.v.y * _spBounce * (q.bounces > 0 ? 0.7f : 1f);
                            q.v.x *= 0.72f;
                            q.v.z *= 0.72f;
                            q.bounces++;
                            q.cool *= 0.75f;
                        }
                        if (Mathf.Abs(q.v.y) < 0.25f * scaleMul)
                        {
                            q.v.y = 0f;
                            float sk = Mathf.Max(0f, 1f - 6f * FixedDt);
                            q.v.x *= sk;
                            q.v.z *= sk;
                        }
                    }
                }
                q.dist += Vector3.Distance(q.p, oldP);
                if (q.leader && q.trail != null)
                {
                    q.trail.Add(new TrailPt { p = q.p, t = _simT });
                    while (q.trail.Count > 0 && (_simT - q.trail[0].t) > _ribbonTrailS)
                        q.trail.RemoveAt(0);
                }
            }

            for (int i = 0; i < _darkState.Count; i++)
            {
                DarkP q = _darkState[i];
                if (_simT > q.life) continue;
                q.v.y -= gmul * q.g * FixedDt;
                q.v *= 1f / (1f + q.drag * FixedDt);
                Vector3 oldP = q.p;
                q.p += q.v * FixedDt;
                if (q.p.y < fy)
                {
                    q.p.y = fy;
                    if (q.v.y < 0f) { q.v.y = -q.v.y * 0.2f; q.v.x *= 0.72f; q.v.z *= 0.72f; }
                }
                q.dist += Vector3.Distance(q.p, oldP);
            }

            for (int i = 0; i < _debrisState.Count; i++)
            {
                DebrisP q = _debrisState[i];
                q.v.y -= gmul * q.g * FixedDt;
                q.v *= 1f / (1f + q.drag * FixedDt);
                Vector3 oldP = q.p;
                q.p += q.v * FixedDt;
                if (q.p.y < fy)
                {
                    q.p.y = fy;
                    if (q.v.y < 0f)
                    {
                        q.v.y = -q.v.y * _debrisBounce * (q.bounces > 0 ? 0.7f : 1f);
                        q.v.x *= 0.72f;
                        q.v.z *= 0.72f;
                        q.bounces++;
                    }
                    if (Mathf.Abs(q.v.y) < 0.25f * scaleMul)
                    {
                        q.v.y = 0f;
                        float sk = Mathf.Max(0f, 1f - 6f * FixedDt);
                        q.v.x *= sk;
                        q.v.z *= sk;
                    }
                }
                q.dist += Vector3.Distance(q.p, oldP);
            }
        }
    }

    private static Vector3 HeatCol(float h, Vector3 hot, Vector3 mid, Vector3 cool, float hdr)
    {
        Vector3 c;
        if (h > 0.7f) c = Vector3.Lerp(mid, hot, (h - 0.7f) / 0.3f);
        else if (h > 0.32f) c = Vector3.Lerp(cool, mid, (h - 0.32f) / 0.38f);
        else c = cool * (h / 0.32f);
        float e = hdr * Mathf.Pow(Mathf.Max(h, 0f), 2.2f) + 2.6f * Mathf.Max(h, 0f);
        return c * e;
    }

    private void ClearBufs()
    {
        _vBuf.Clear(); _nBuf.Clear(); _cBuf.Clear(); _uv0Buf.Clear(); _uv1Buf.Clear(); _iBuf.Clear();
    }

    private void PushAddQuad(Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3, Vector3 hdrC0, float a0, Vector3 hdrC1, float a1, float mode, bool speckUv)
    {
        int b = _vBuf.Count;
        if (b + 4 > 65000) return;
        _vBuf.Add(p0); _vBuf.Add(p1); _vBuf.Add(p2); _vBuf.Add(p3);

        float m0 = Mathf.Max(1f, Mathf.Max(hdrC0.x, Mathf.Max(hdrC0.y, hdrC0.z)));
        float m1 = Mathf.Max(1f, Mathf.Max(hdrC1.x, Mathf.Max(hdrC1.y, hdrC1.z)));
        Color col0 = new Color(hdrC0.x / m0, hdrC0.y / m0, hdrC0.z / m0, a0);
        Color col1 = new Color(hdrC1.x / m1, hdrC1.y / m1, hdrC1.z / m1, a1);
        _cBuf.Add(col0); _cBuf.Add(col0); _cBuf.Add(col1); _cBuf.Add(col1);

        float v0 = speckUv ? -1f : 0f;
        _uv0Buf.Add(new Vector2(-1f, v0));
        _uv0Buf.Add(new Vector2( 1f, v0));
        _uv0Buf.Add(new Vector2( 1f, 1f));
        _uv0Buf.Add(new Vector2(-1f, 1f));

        _uv1Buf.Add(new Vector4(mode, m0, 0f, 0f));
        _uv1Buf.Add(new Vector4(mode, m0, 0f, 0f));
        _uv1Buf.Add(new Vector4(mode, m1, 0f, 0f));
        _uv1Buf.Add(new Vector4(mode, m1, 0f, 0f));

        _iBuf.Add(b); _iBuf.Add(b + 2); _iBuf.Add(b + 1);
        _iBuf.Add(b); _iBuf.Add(b + 3); _iBuf.Add(b + 2);
    }

    private void CommitDynamicMesh(Mesh m, MeshRenderer mr, bool withNormals = false)
    {
        m.Clear();
        if (_vBuf.Count == 0) { mr.enabled = false; return; }
        m.SetVertices(_vBuf);
        if (withNormals) m.SetNormals(_nBuf);
        if (_cBuf.Count == _vBuf.Count) m.SetColors(_cBuf);
        if (_uv0Buf.Count == _vBuf.Count) m.SetUVs(0, _uv0Buf);
        if (_uv1Buf.Count == _vBuf.Count) m.SetUVs(1, _uv1Buf);
        m.SetTriangles(_iBuf, 0, calculateBounds: true);
        mr.enabled = true;
    }

    private void RenderAtTau(float tau)
    {
        Camera cam = renderCameraOverride != null ? renderCameraOverride : Camera.main;
        Vector3 origin = transform.position;
        Vector3 camPos = cam != null ? cam.transform.position : (origin + new Vector3(0.28f, 0.45f, -2.15f));
        Quaternion camRot = cam != null ? cam.transform.rotation : Quaternion.identity;
        Vector3 camRight = cam != null ? cam.transform.right : Vector3.right;
        Vector3 camUp = cam != null ? cam.transform.up : Vector3.up;
        Vector3 toCam = (camPos - origin).sqrMagnitude > 1e-6f ? (camPos - origin).normalized : Vector3.back;

        float vpH = cam != null && cam.targetTexture != null ? cam.targetTexture.height : Mathf.Max(1, Screen.height);
        float fov = cam != null ? cam.fieldOfView : 42f;
        float pxK = 2f * Mathf.Tan(fov * 0.5f * Mathf.Deg2Rad) / Mathf.Max(1f, vpH);

        GetTierFlags(out bool ribbonOn, out bool smokeOn, out bool debrisOn, out bool refrOn, out float starMul, out _, out int flashBonus, out bool refrDouble);

        // 1a. Star & 1b. Standalone Light + Atmospheric Glow + 1c. Circular Impact Flash
        _starMr.enabled = false;
        _glowMr.enabled = false;
        _flashMr.enabled = false;
        _pointLight.intensity = 0f;
        float rise = SStep(0f, 0.012f, tau);
        if (_starEnabled)
        {
            float dec = tau < _starLifeS * 1.8f ? Mathf.Exp(-tau / Mathf.Max(0.005f, _starLifeS * 0.38f)) : 0f;
            float inten = rise * dec;
            if (inten > 0.002f)
            {
                float szM = _starSizeM * starMul * scaleMul;
                float sc = szM * (0.5f + 0.5f * SStep(0f, 0.02f, tau)) * (1f + 0.35f * tau / Mathf.Max(0.01f, _starLifeS));
                Vector3 starPos = origin + toCam * (0.06f * scaleMul);
                float rotDeg = ((HashInts(_activeSeed, 107) % 628u) / 100f + tau * 0.6f) * Mathf.Rad2Deg;

                _starMr.transform.SetPositionAndRotation(starPos, camRot * Quaternion.Euler(0f, 0f, rotDeg));
                _starMr.transform.localScale = Vector3.one * sc;
                _starMat.SetVector("_CoreCol", new Vector4(_starCore.x, _starCore.y, _starCore.z, 1f));
                _starMat.SetVector("_EdgeCol", new Vector4(_starEdge.x, _starEdge.y, _starEdge.z, 1f));
                _starMat.SetFloat("_Gain", _starHdr * inten);
                _starMat.SetFloat("_ContrastPow", _starPow);
                _starMr.enabled = true;
            }
        }
        if (_lightEnabled)
        {
            float decS = Mathf.Max(0.01f, _lightDecayS);
            float offZ = _lightOffsetZ * scaleMul;
            _pointLight.range = Mathf.Max(0.5f, _lightRangeM) * scaleMul;
            _pointLight.transform.position = origin + toCam * offZ;
            Vector3 lc = Vector3.Lerp(_lightCol, Vector3.one, 0.32f);
            _pointLight.color = new Color(lc.x, lc.y, lc.z, 1f);
            _pointLight.intensity = tau < Mathf.Max(0.55f, decS * 7.5f) ? (_lightInt * 0.25f * rise * Mathf.Exp(-tau / decS)) : 0f;
            if (_glowAmt > 0.002f)
            {
                float gGain = (0.16f + 0.34f * _glowAmt) * rise * Mathf.Exp(-tau / Mathf.Max(0.045f, decS * 1.95f));
                if (gGain > 0.0015f)
                {
                    Vector3 glowPos = origin + toCam * Mathf.Min(0.14f * scaleMul, offZ * 0.5f);
                    float glowSz = (1.65f + 1.1f * _glowAmt) * _glowSizeMul * scaleMul;
                    _glowMr.transform.SetPositionAndRotation(glowPos, camRot);
                    _glowMr.transform.localScale = Vector3.one * glowSz;
                    _glowMat.SetVector("_EdgeCol", new Vector4(_lightCol.x, _lightCol.y, _lightCol.z, 1f));
                    _glowMat.SetFloat("_Gain", gGain);
                    _glowMr.enabled = true;
                }
            }
        }

        if (_flashEnabled && _flashIsCircular)
        {
            float flLife = Mathf.Max(0.02f, _flashLifeS);
            if (_flashOpacity > 0.001f && tau < flLife * 1.75f)
            {
                float flFade = SStep(0f, 0.008f, tau) * Mathf.Pow(Mathf.Clamp01(1f - tau / (flLife * 1.75f)), 1.35f);
                if (flFade * _flashOpacity > 0.001f)
                {
                    float flGrow = Mathf.Lerp(Mathf.Max(0.2f, 1f - _flashExpand * 0.55f), 1f + _flashExpand * 0.45f, 1f - Mathf.Exp(-tau / Mathf.Max(0.014f, flLife * 0.42f)));
                    float flSz = _flashSizeM * flGrow * scaleMul;
                    Vector3 flPos = origin + toCam * (0.035f * scaleMul);
                    float flRotDeg = (((HashInts(_activeSeed, _flashSeed) % 628u) / 100f) + tau * _flashSpin) * Mathf.Rad2Deg;
                    _flashMr.transform.SetPositionAndRotation(flPos, camRot * Quaternion.Euler(0f, 0f, flRotDeg));
                    _flashMr.transform.localScale = Vector3.one * flSz;
                    _flashMat.SetVector("_CoreCol", new Vector4(_flashCore.x, _flashCore.y, _flashCore.z, 1f));
                    _flashMat.SetVector("_EdgeCol", new Vector4(_flashCol.x, _flashCol.y, _flashCol.z, 1f));
                    _flashMat.SetVector("_FlashParams", new Vector4(_flashOpacity * flFade, Mathf.Clamp(_flashBlur, 0.02f, 0.95f), Mathf.Clamp(_flashHollow, 0f, 0.85f), _flashHdr));
                    _flashMr.enabled = true;
                }
            }
        }

        // 2 & 3 & 4. Additive batch (Legacy Needles + 3-Tier Sparks + Ribbons + Debris Hot Tips)
        ClearBufs();
        bool runNeedles = _needlesEnabled || (_flashEnabled && !_flashIsCircular);
        float ndLife = _needlesEnabled ? _needlesLifeS : _flashLifeS;
        if (runNeedles && tau < ndLife * 1.4f)
        {
            float ndHdr = _needlesEnabled ? _needlesHdr : _flashHdr;
            Vector3 ndBaseCol = _needlesEnabled ? _needlesCol : _flashCol;
            float ndSpr = _needlesEnabled ? _needlesSpreadDeg : _flashSpreadDeg;
            float ndWr = _needlesEnabled ? _needlesWidthRatio : _flashWidthRatio;
            var ndAxes = _needlesEnabled ? _needlesAxes : _flashAxes;
            var ndLmul = _needlesEnabled ? _needlesLenMul : _flashLenMul;
            float fk = Mathf.Exp(-tau / Mathf.Max(0.005f, ndLife * 0.42f));
            float grow = (0.45f + 0.55f * SStep(0f, 0.022f, tau)) * (1f + 0.3f * tau / Mathf.Max(0.01f, ndLife));
            float thin = Mathf.Pow(Mathf.Clamp01(1f - tau / (ndLife * 1.4f)), 0.6f);
            Vector3 fcol = ndBaseCol * (ndHdr * fk);
            int cnt = _needlesEnabled ? Mathf.Clamp(_needlesCount, 1, 4) : Mathf.Min(3, _flashCount + flashBonus);
            float baseLen = (_needlesEnabled ? _needlesLenM : _flashLenM) * scaleMul;

            for (int i = 0; i < cnt; i++)
            {
                Vector3 axLocal = ndAxes[i % ndAxes.Count];
                float jitter = i > 0 ? ((int)(HashInts(_activeSeed, i) % 40u) - 20) : 0f;
                Vector3 axWorld = (Quaternion.AngleAxis(ndSpr + jitter, toCam) * XfDir(axLocal)).normalized;
                float lm = ndLmul[i % ndLmul.Count];
                float segL = baseLen * lm * grow;
                float hw = baseLen * lm * ndWr * thin;
                Vector3 center = origin + toCam * (0.04f * scaleMul);
                float minHw = 0.75f * pxK * Vector3.Distance(camPos, center);
                float colScale = 1f;
                if (hw < minHw && minHw > 1e-6f) { colScale = hw / minHw; hw = minHw; }
                Vector3 p0 = center - axWorld * (segL * 0.5f);
                Vector3 p1 = center + axWorld * (segL * 0.5f);
                Vector3 n1 = Vector3.Cross(axWorld, toCam);
                n1 = n1.sqrMagnitude > 1e-5f ? n1.normalized : Vector3.Cross(axWorld, Vector3.up).normalized;
                Vector3 n2 = Vector3.Cross(axWorld, n1).normalized;
                Vector3 qc = fcol * colScale;
                PushAddQuad(p0 - n1 * hw, p0 + n1 * hw, p1 + n1 * hw, p1 - n1 * hw, qc, 1f, qc, 1f, 1f, false);
                PushAddQuad(p0 - n2 * hw, p0 + n2 * hw, p1 + n2 * hw, p1 - n2 * hw, qc, 1f, qc, 1f, 1f, false);
            }
        }

        float rbW = _ribbonWidthM * scaleMul;
        float rbLife = Mathf.Max(0.02f, _ribbonTrailS);
        for (int i = 0; i < _sparksState.Count; i++)
        {
            SparkP q = _sparksState[i];
            float age = tau - q.delay;
            if (age < 0f || age > q.life) continue;
            float h = q.heat * Mathf.Exp(-age / Mathf.Max(0.01f, q.cool));
            float fade = SStep(q.life, q.life * 0.75f, age);

            if (q.clip > 0f)
            {
                uint flThr = q.standaloneEmber ? (uint)Mathf.RoundToInt(Mathf.Clamp(_emFlicker, 0f, 0.6f) * 100f) : 18u;
                if ((HashInts(q.id, Mathf.FloorToInt(tau * 34f)) % 100u) < flThr) continue;
                float eRad = q.w, mnRad = 1.15f * pxK * Vector3.Distance(camPos, q.p), eCk = 1f;
                if (eRad < mnRad && mnRad > 1e-6f) { eCk = Mathf.Max(0.45f, eRad / mnRad); eRad = mnRad; }
                Vector3 ec = HeatCol(Mathf.Max(h, 0.16f), q.standaloneEmber ? _emHot : _spHot, q.standaloneEmber ? _emMid : _spMid, q.standaloneEmber ? _emCool : _spCool, q.standaloneEmber ? (_emHdr * 1.15f * q.bri) : (_spHdr * 0.52f)) * eCk;
                Vector3 cr = camRight * eRad, cu = camUp * eRad;
                PushAddQuad(q.p - cr - cu, q.p + cr - cu, q.p + cr + cu, q.p - cr + cu, ec, fade, ec, fade, 2f, true);
                continue;
            }

            float hdrBoost = (q.ti == 0 ? Mathf.Lerp(2.4f, 1.0f, SStep(0.05f * scaleMul, 0.55f * scaleMul, q.dist)) : 1.6f) * q.bri;
            Vector3 sc = HeatCol(h, _spHot, _spMid, _spCool, _spHdr * hdrBoost);
            float spd = q.v.magnitude;
            if (spd >= 1e-4f || q.ti == 1)
            {
                float segLen = Mathf.Min(q.maxLen * q.lk, Mathf.Max(0.014f * scaleMul, spd * q.streak * q.lk));
                segLen = Mathf.Min(segLen, q.dist + 0.004f * scaleMul);
                Vector3 tail = q.p - (q.v / Mathf.Max(spd, 1e-4f)) * segLen;
                bool bounced = q.bounces > 0;
                float fb = bounced ? 1.6f : 1.0f;
                if (bounced)
                {
                    float bs = q.w * 2.2f;
                    Vector3 bcr = camRight * bs, bcu = camUp * bs;
                    PushAddQuad(q.p - bcr - bcu, q.p + bcr - bcu, q.p + bcr + bcu, q.p - bcr + bcu, sc * 0.5f, fade, sc * 0.5f, fade, 2f, true);
                }
                if (_sparksEnabled || q.leader)
                {
                    float hw = q.w * fb * (q.ti == 0 ? 1f : (0.6f + 0.6f * h)) * (1.25f - 0.35f * q.lk);
                    Vector3 side = Vector3.Cross(q.p - tail, camPos - q.p);
                    float sl = side.magnitude;
                    if (sl > 1e-9f)
                    {
                        float minHw = 0.75f * pxK * Vector3.Distance(camPos, q.p);
                        float ck = 1f;
                        if (hw < minHw && minHw > 1e-6f) { ck = hw / minHw; hw = minHw; }
                        side *= hw / sl;
                        float aIn = fade * SStep(0f, 0.05f * scaleMul, q.dist);
                        Vector3 stCol = sc * (fb * ck);
                        PushAddQuad(tail - side, tail + side, q.p + side, q.p - side, stCol, aIn, stCol, aIn, 0f, false);
                    }
                }
            }

            if (q.leader && ribbonOn && q.trail != null && q.trail.Count > 2)
            {
                int nPts = q.trail.Count;
                for (int j = 1; j < nPts; j++)
                {
                    Vector3 ptA = q.trail[j - 1].p, ptB = q.trail[j].p;
                    float k0 = (float)(j - 1) / (nPts - 1), k1 = (float)j / (nPts - 1);
                    float ag0 = Mathf.Clamp01(1f - (tau - q.trail[j - 1].t) / rbLife);
                    float ag1 = Mathf.Clamp01(1f - (tau - q.trail[j].t) / rbLife);
                    float w0 = Mathf.Max(0.5f * pxK * Vector3.Distance(camPos, ptA), rbW * Mathf.Pow(k0, 0.8f) * 0.5f);
                    float w1 = Mathf.Max(0.5f * pxK * Vector3.Distance(camPos, ptB), rbW * Mathf.Pow(k1, 0.8f) * 0.5f);
                    float e0 = _ribbonHdr * (0.1f + h * h) * ag0 * fade;
                    float e1 = _ribbonHdr * (0.1f + h * h) * ag1 * fade;
                    Vector3 rside = Vector3.Cross(ptB - ptA, camPos - ptB);
                    if (rside.sqrMagnitude < 1e-9f) continue;
                    rside.Normalize();
                    PushAddQuad(ptA - rside * w0, ptA + rside * w0, ptB + rside * w1, ptB - rside * w1, _ribbonCol * e0, 1f, _ribbonCol * e1, 1f, 3f, false);
                }
            }
        }

        // Debris hot orange tips inside additive batch
        if (debrisOn && _debrisState.Count > 0)
        {
            Vector3 hotTip = HeatCol(0.95f, _spHot, _spMid, _spCool, 10f);
            float kEnd = SStep(MaxDuration, MaxDuration - 0.4f, tau);
            float ht = Mathf.Exp(-tau / 0.25f);
            if (ht > 0.03f)
            {
                float ts = 0.0026f * scaleMul;
                Vector3 cr = camRight * ts, cu = camUp * ts;
                for (int i = 0; i < _debrisState.Count; i++)
                {
                    DebrisP q = _debrisState[i];
                    float angDeg = q.spin * Mathf.Min(tau, 0.35f + tau * 0.2f * (q.bounces > 0 ? 0f : 1f)) * Mathf.Rad2Deg;
                    Quaternion rot = Quaternion.AngleAxis(angDeg, q.ax);
                    Vector3 tipPos = q.p + rot * new Vector3(q.size * kEnd * 2.8f, 0f, 0f);
                    Vector3 tc = hotTip * ht;
                    PushAddQuad(tipPos - cr - cu, tipPos + cr - cu, tipPos + cr + cu, tipPos - cr + cu, tc, 1f, tc, 1f, 2f, true);
                }
            }
        }
        CommitDynamicMesh(_addMesh, _addMr);

        // 5a. Debris Lit Metallic Splinters
        ClearBufs();
        if (debrisOn && _debrisState.Count > 0)
        {
            float kEnd = SStep(MaxDuration, MaxDuration - 0.4f, tau);
            float hotGlow = Mathf.Exp(-tau / 0.22f);
            Vector3[] octPts =
            {
                new Vector3( 2.8f, 0f, 0f), new Vector3(-2.8f, 0f, 0f),
                new Vector3(0f,  0.38f, 0f), new Vector3(0f, -0.38f, 0f),
                new Vector3(0f, 0f,  0.9f), new Vector3(0f, 0f, -0.9f)
            };
            int[,] octTris = { {0,2,4}, {4,2,1}, {1,2,5}, {5,2,0}, {4,3,0}, {1,3,4}, {5,3,1}, {0,3,5} };
            for (int i = 0; i < _debrisState.Count; i++)
            {
                DebrisP q = _debrisState[i];
                float sz = Mathf.Max(1e-5f, q.size * kEnd);
                float angDeg = q.spin * Mathf.Min(tau, 0.35f + tau * 0.2f * (q.bounces > 0 ? 0f : 1f)) * Mathf.Rad2Deg;
                Quaternion rot = Quaternion.AngleAxis(angDeg, q.ax);
                for (int f = 0; f < 8; f++)
                {
                    Vector3 v0 = q.p + rot * (octPts[octTris[f, 0]] * sz);
                    Vector3 v1 = q.p + rot * (octPts[octTris[f, 1]] * sz);
                    Vector3 v2 = q.p + rot * (octPts[octTris[f, 2]] * sz);
                    Vector3 fn = Vector3.Cross(v1 - v0, v2 - v0).normalized;
                    int bi = _vBuf.Count;
                    _vBuf.Add(v0); _vBuf.Add(v1); _vBuf.Add(v2);
                    _nBuf.Add(fn); _nBuf.Add(fn); _nBuf.Add(fn);
                    _cBuf.Add(Color.white); _cBuf.Add(Color.white); _cBuf.Add(Color.white);
                    _uv0Buf.Add(Vector2.zero); _uv0Buf.Add(Vector2.right); _uv0Buf.Add(Vector2.up);
                    float g0 = octTris[f, 0] == 0 ? hotGlow : 0f;
                    float g1 = octTris[f, 1] == 0 ? hotGlow : 0f;
                    float g2 = octTris[f, 2] == 0 ? hotGlow : 0f;
                    _uv1Buf.Add(new Vector4(g0, 0, 0, 0));
                    _uv1Buf.Add(new Vector4(g1, 0, 0, 0));
                    _uv1Buf.Add(new Vector4(g2, 0, 0, 0));
                    _iBuf.Add(bi); _iBuf.Add(bi + 1); _iBuf.Add(bi + 2);
                }
            }
        }
        CommitDynamicMesh(_debrisMesh, _debrisMr, withNormals: true);

        // 5b. Smoke Dark Sparks & Dissolving Puffs
        ClearBufs();
        if (smokeOn)
        {
            for (int i = 0; i < _darkState.Count; i++)
            {
                DarkP q = _darkState[i];
                if (tau > q.life) continue;
                float spd = q.v.magnitude;
                if (spd < 1e-4f) continue;
                float segL = Mathf.Min(0.18f * scaleMul, Mathf.Max(0.015f * scaleMul, spd * 0.03f));
                segL = Mathf.Min(segL, q.dist + 0.003f * scaleMul);
                Vector3 tail = q.p - (q.v / spd) * segL;
                Vector3 side = Vector3.Cross(q.p - tail, camPos - q.p);
                float sl = side.magnitude;
                if (sl <= 1e-9f) continue;
                side *= Mathf.Max(q.w, 0.75f * pxK * Vector3.Distance(camPos, q.p)) / sl;
                int b = _vBuf.Count;
                _vBuf.Add(tail - side); _vBuf.Add(tail + side); _vBuf.Add(q.p + side); _vBuf.Add(q.p - side);
                Color dc = new Color(_smokeCol.x, _smokeCol.y, _smokeCol.z, 0.85f * SStep(q.life, q.life * 0.6f, tau));
                _cBuf.Add(dc); _cBuf.Add(dc); _cBuf.Add(dc); _cBuf.Add(dc);
                _uv0Buf.Add(new Vector2(-1f, 0f)); _uv0Buf.Add(new Vector2(1f, 0f)); _uv0Buf.Add(new Vector2(1f, 1f)); _uv0Buf.Add(new Vector2(-1f, 1f));
                _uv1Buf.Add(Vector4.zero); _uv1Buf.Add(Vector4.zero); _uv1Buf.Add(Vector4.zero); _uv1Buf.Add(Vector4.zero);
                _iBuf.Add(b); _iBuf.Add(b + 2); _iBuf.Add(b + 1); _iBuf.Add(b); _iBuf.Add(b + 3); _iBuf.Add(b + 2);
            }
        }
        CommitDynamicMesh(_darkMesh, _darkMr);

        ClearBufs();
        if (smokeOn)
        {
            Vector3 warm = _starEdge * 0.55f;
            _smokeMat.SetVector("_WarmCol", new Vector4(warm.x, warm.y, warm.z, 1f));
            for (int i = 0; i < _smokeCfg.Count; i++)
            {
                SmokePuffCfg pf = _smokeCfg[i];
                float age = tau - pf.del;
                if (age < 0f || age > pf.life) continue;
                float k = age / Mathf.Max(0.01f, pf.life);
                float dist = pf.spd / 3f * (1f - Mathf.Exp(-3f * age));
                Vector3 p = origin + pf.d * (dist * (pf.isPuff ? 1f : 0.6f) + 0.03f * scaleMul) + Vector3.up * (age * 0.12f * scaleMul);
                float sz = pf.s0 * (0.55f + 1.1f * Mathf.Sqrt(k));
                float ca = Mathf.Cos(pf.rot + age * 0.4f), sa = Mathf.Sin(pf.rot + age * 0.4f), st = 1f;
                if (!pf.isPuff && !_smokeIsMask)
                {
                    ca = Vector3.Dot(pf.d, camRight);
                    sa = Vector3.Dot(pf.d, camUp);
                    float ll = Mathf.Sqrt(ca * ca + sa * sa);
                    if (ll > 1e-5f) { ca /= ll; sa /= ll; } else { ca = 1f; sa = 0f; }
                    st = pf.isInk ? 2.6f : 3.2f;
                }
                Vector3 ax = camRight * (ca * sz * st) + camUp * (sa * sz * st);
                float ayK = st > 1f ? 0.42f : 1f;
                Vector3 ay = camRight * (-sa * sz * ayK) + camUp * (ca * sz * ayK);
                int b = _vBuf.Count;
                _vBuf.Add(p - ax - ay); _vBuf.Add(p + ax - ay); _vBuf.Add(p + ax + ay); _vBuf.Add(p - ax + ay);
                Color pc = new Color(_smokeCol.x, _smokeCol.y, _smokeCol.z, Mathf.Exp(-age / 0.12f));
                _cBuf.Add(pc); _cBuf.Add(pc); _cBuf.Add(pc); _cBuf.Add(pc);
                _uv0Buf.Add(new Vector2(0, 0)); _uv0Buf.Add(new Vector2(1, 0)); _uv0Buf.Add(new Vector2(1, 1)); _uv0Buf.Add(new Vector2(0, 1));
                float th = Mathf.Lerp(0.12f, 0.95f, Mathf.Pow(k, 0.8f)) * (pf.isInk ? 0.9f : 1f);
                Vector4 pd = new Vector4(pf.ox, pf.oy + age * 0.05f, th, _smokeOpacity * SStep(0f, 0.06f, age));
                _uv1Buf.Add(pd); _uv1Buf.Add(pd); _uv1Buf.Add(pd); _uv1Buf.Add(pd);
                _iBuf.Add(b); _iBuf.Add(b + 2); _iBuf.Add(b + 1); _iBuf.Add(b); _iBuf.Add(b + 3); _iBuf.Add(b + 2);
            }
        }
        CommitDynamicMesh(_smokeMesh, _smokeMr);

        // 6. Screen-Space Heatwave Refraction
        if (refrOn && tau < _refrLifeS)
        {
            float k = Mathf.Clamp01(tau / Mathf.Max(0.01f, _refrLifeS));
            float easeK = 1f - Mathf.Pow(1f - k, 3f);
            string style = refrDouble ? "double" : _refrStyle;
            float subMode = _refrHasTex ? 3f : (style == "bulge" ? 1f : (style == "double" ? 2f : 0f));
            float ringR = _refrHasTex ? Mathf.Lerp(0.3f, 1f, easeK) : Mathf.Lerp(0.08f, 0.9f, easeK);
            float ringW = Mathf.Lerp(0.05f, 0.14f, k);
            float fade = Mathf.Pow(1f - k, 1.4f) * SStep(0f, 0.015f, tau);
            _refrMr.transform.SetPositionAndRotation(origin, camRot);
            _refrMr.transform.localScale = Vector3.one * (_refrRadiusM * 2f * scaleMul);
            _refrMat.SetFloat("_SubMode", subMode);
            _refrMat.SetFloat("_HasOpaqueTex", hasOpaqueTexture ? 1f : 0f);
            _refrMat.SetVector("_RefrParams", new Vector4(_refrStrength, ringR, ringW, fade));
            _refrMr.enabled = true;
        }
        else
        {
            _refrMr.enabled = false;
        }
    }

    // ---------------- Minimal self-contained JSON parser (handles polymorphic fields) ----------------
    private static Dictionary<string, object> GetObj(Dictionary<string, object> d, string k)
    {
        return d != null && d.TryGetValue(k, out object v) ? v as Dictionary<string, object> : null;
    }
    private static List<object> GetList(Dictionary<string, object> d, string k)
    {
        return d != null && d.TryGetValue(k, out object v) ? v as List<object> : null;
    }
    private static string GetStr(Dictionary<string, object> d, string k, string def)
    {
        return d != null && d.TryGetValue(k, out object v) && v is string s ? s : def;
    }
    private static bool GetBool(Dictionary<string, object> d, string k, bool def)
    {
        return d != null && d.TryGetValue(k, out object v) && v is bool b ? b : def;
    }
    private static int GetInt(Dictionary<string, object> d, string k, int def)
    {
        return d != null && d.TryGetValue(k, out object v) && v != null ? Mathf.RoundToInt(ToF(v)) : def;
    }
    private static float GetFloat(Dictionary<string, object> d, string k, float def)
    {
        return d != null && d.TryGetValue(k, out object v) && v != null ? ToF(v) : def;
    }
    private static Vector2 GetVec2(Dictionary<string, object> d, string k, Vector2 def)
    {
        var l = GetList(d, k);
        return l != null && l.Count >= 2 ? new Vector2(ToF(l[0]), ToF(l[1])) : def;
    }
    private static Vector3 GetVec3(Dictionary<string, object> d, string k, Vector3 def)
    {
        var l = GetList(d, k);
        return l != null && l.Count >= 3 ? new Vector3(ToF(l[0]), ToF(l[1]), ToF(l[2])) : def;
    }
    private static float ToF(object o)
    {
        if (o is double dv) return (float)dv;
        if (o is float fv) return fv;
        if (o is long lv) return lv;
        if (o is int iv) return iv;
        float.TryParse(Convert.ToString(o, CultureInfo.InvariantCulture), NumberStyles.Float, CultureInfo.InvariantCulture, out float r);
        return r;
    }

    private static class MiniJson
    {
        public static object Parse(string s)
        {
            int idx = 0;
            return ParseVal(s, ref idx);
        }
        private static void SkipWs(string s, ref int i)
        {
            while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
        }
        private static object ParseVal(string s, ref int i)
        {
            SkipWs(s, ref i);
            if (i >= s.Length) return null;
            char c = s[i];
            if (c == '{') return ParseObj(s, ref i);
            if (c == '[') return ParseArr(s, ref i);
            if (c == '"') return ParseStr(s, ref i);
            if (c == 't' && i + 4 <= s.Length && s.Substring(i, 4) == "true") { i += 4; return true; }
            if (c == 'f' && i + 5 <= s.Length && s.Substring(i, 5) == "false") { i += 5; return false; }
            if (c == 'n' && i + 4 <= s.Length && s.Substring(i, 4) == "null") { i += 4; return null; }
            return ParseNum(s, ref i);
        }
        private static Dictionary<string, object> ParseObj(string s, ref int i)
        {
            var d = new Dictionary<string, object>();
            i++;
            while (i < s.Length)
            {
                SkipWs(s, ref i);
                if (i < s.Length && s[i] == '}') { i++; break; }
                string k = ParseStr(s, ref i);
                SkipWs(s, ref i);
                if (i < s.Length && s[i] == ':') i++;
                d[k] = ParseVal(s, ref i);
                SkipWs(s, ref i);
                if (i < s.Length && s[i] == ',') i++;
            }
            return d;
        }
        private static List<object> ParseArr(string s, ref int i)
        {
            var l = new List<object>();
            i++;
            while (i < s.Length)
            {
                SkipWs(s, ref i);
                if (i < s.Length && s[i] == ']') { i++; break; }
                l.Add(ParseVal(s, ref i));
                SkipWs(s, ref i);
                if (i < s.Length && s[i] == ',') i++;
            }
            return l;
        }
        private static string ParseStr(string s, ref int i)
        {
            if (s[i] == '"') i++;
            var sb = new System.Text.StringBuilder();
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') break;
                if (c == '\\' && i < s.Length)
                {
                    char e = s[i++];
                    if (e == 'n') sb.Append('\n');
                    else if (e == 'r') sb.Append('\r');
                    else if (e == 't') sb.Append('\t');
                    else if (e == 'u' && i + 4 <= s.Length)
                    {
                        if (ushort.TryParse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out ushort cp))
                            sb.Append((char)cp);
                        i += 4;
                    }
                    else sb.Append(e);
                }
                else sb.Append(c);
            }
            return sb.ToString();
        }
        private static double ParseNum(string s, ref int i)
        {
            int st = i;
            while (i < s.Length && "-+0123456789.eE".IndexOf(s[i]) >= 0) i++;
            double.TryParse(s.Substring(st, i - st), NumberStyles.Float, CultureInfo.InvariantCulture, out double v);
            return v;
        }
    }
}
