// Unity Editor installer for XSXB-Slash Parry bundles (`xsxb-parry` v1, docs/SPEC_PARRY.md).
// Place in an `Editor/` folder (e.g. `Assets/XsxbSlash/Editor/XsxbParryInstaller.cs`).
// Menu: Tools -> XSXB-Slash -> Install Parry Bundle from Folder...
#if UNITY_EDITOR
using System;
using System.IO;
using UnityEditor;
using UnityEngine;

public static class XsxbParryInstaller
{
    [MenuItem("Tools/XSXB-Slash/Install Parry Bundle from Folder...")]
    public static void InstallFromFolderMenu()
    {
        string srcFolder = EditorUtility.OpenFolderPanel("Select XSXB-Parry Export Folder (containing recipe.json)", "", "");
        if (string.IsNullOrEmpty(srcFolder)) return;

        string recipeSrc = Path.Combine(srcFolder, "recipe.json");
        if (!File.Exists(recipeSrc))
        {
            EditorUtility.DisplayDialog("XSXB-Parry Installer", "Selected folder does not contain recipe.json.", "OK");
            return;
        }

        string bundleName = new DirectoryInfo(srcFolder).Name;
        string dstAssetFolder = "Assets/XsxbParry/" + bundleName;
        GameObject go = InstallBundleToAssets(srcFolder, dstAssetFolder, createSceneInstance: true);
        if (go != null)
        {
            Selection.activeGameObject = go;
            EditorGUIUtility.PingObject(go);
        }
    }

    public static GameObject InstallBundleToAssets(string srcFolder, string dstAssetFolder, bool createSceneInstance = true)
    {
        string projectRoot = Directory.GetParent(Application.dataPath).FullName;
        string dstAbs = Path.Combine(projectRoot, dstAssetFolder.Replace('/', Path.DirectorySeparatorChar));
        string dstTexAbs = Path.Combine(dstAbs, "textures");
        string dstAudioAbs = Path.Combine(dstAbs, "audio");
        Directory.CreateDirectory(dstTexAbs);
        Directory.CreateDirectory(dstAudioAbs);

        File.Copy(Path.Combine(srcFolder, "recipe.json"), Path.Combine(dstAbs, "recipe.json"), overwrite: true);
        string srcTexDir = Path.Combine(srcFolder, "textures");
        if (Directory.Exists(srcTexDir))
        {
            foreach (string png in Directory.GetFiles(srcTexDir, "*.png"))
            {
                File.Copy(png, Path.Combine(dstTexAbs, Path.GetFileName(png)), overwrite: true);
            }
        }
        string srcAudioDir = Path.Combine(srcFolder, "audio");
        if (Directory.Exists(srcAudioDir))
        {
            foreach (string wav in Directory.GetFiles(srcAudioDir, "*.wav"))
            {
                File.Copy(wav, Path.Combine(dstAudioAbs, Path.GetFileName(wav)), overwrite: true);
            }
        }

        AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

        ConfigureLinearMask(dstAssetFolder + "/textures/star.png", TextureWrapMode.Clamp);
        ConfigureLinearMask(dstAssetFolder + "/textures/star_normal.png", TextureWrapMode.Clamp);
        ConfigureLinearMask(dstAssetFolder + "/textures/spark.png", TextureWrapMode.Clamp);
        ConfigureLinearMask(dstAssetFolder + "/textures/flash.png", TextureWrapMode.Clamp);
        ConfigureLinearMask(dstAssetFolder + "/textures/flash_normal.png", TextureWrapMode.Clamp);
        ConfigureLinearMask(dstAssetFolder + "/textures/smoke.png", TextureWrapMode.Repeat);
        ConfigureLinearMask(dstAssetFolder + "/textures/refraction.png", TextureWrapMode.Clamp);
        ConfigureClashAudio(dstAssetFolder + "/audio/parry_normal.wav");
        ConfigureClashAudio(dstAssetFolder + "/audio/parry_perfect.wav");
        string[] normalAudioFiles = Directory.Exists(dstAudioAbs) ? Directory.GetFiles(dstAudioAbs, "parry_normal*.wav") : Array.Empty<string>();
        string[] perfectAudioFiles = Directory.Exists(dstAudioAbs) ? Directory.GetFiles(dstAudioAbs, "parry_perfect*.wav") : Array.Empty<string>();
        Array.Sort(normalAudioFiles, StringComparer.OrdinalIgnoreCase);
        Array.Sort(perfectAudioFiles, StringComparer.OrdinalIgnoreCase);
        foreach (string wav in normalAudioFiles) ConfigureClashAudio(dstAssetFolder + "/audio/" + Path.GetFileName(wav));
        foreach (string wav in perfectAudioFiles) ConfigureClashAudio(dstAssetFolder + "/audio/" + Path.GetFileName(wav));

        TextAsset recipeAsset = AssetDatabase.LoadAssetAtPath<TextAsset>(dstAssetFolder + "/recipe.json");
        Shader sh = Shader.Find("XSXB-Slash/ParryBurst");

        GameObject go = new GameObject("XsxbParryBurst_" + Path.GetFileName(dstAssetFolder));
        XsxbParryBurst burst = go.AddComponent<XsxbParryBurst>();
        burst.recipe = recipeAsset;
        burst.parryShader = sh;
        burst.starTex = AssetDatabase.LoadAssetAtPath<Texture2D>(dstAssetFolder + "/textures/star.png");
        burst.starNormalTex = AssetDatabase.LoadAssetAtPath<Texture2D>(dstAssetFolder + "/textures/star_normal.png");
        burst.sparkTex = AssetDatabase.LoadAssetAtPath<Texture2D>(dstAssetFolder + "/textures/spark.png");
        burst.flashTex = AssetDatabase.LoadAssetAtPath<Texture2D>(dstAssetFolder + "/textures/flash.png");
        burst.flashNormalTex = AssetDatabase.LoadAssetAtPath<Texture2D>(dstAssetFolder + "/textures/flash_normal.png");
        burst.smokeTex = AssetDatabase.LoadAssetAtPath<Texture2D>(dstAssetFolder + "/textures/smoke.png");
        burst.refractionTex = AssetDatabase.LoadAssetAtPath<Texture2D>(dstAssetFolder + "/textures/refraction.png");
        var nPool = new System.Collections.Generic.List<AudioClip>();
        foreach (string wav in normalAudioFiles)
        {
            AudioClip c = AssetDatabase.LoadAssetAtPath<AudioClip>(dstAssetFolder + "/audio/" + Path.GetFileName(wav));
            if (c != null) nPool.Add(c);
        }
        var pPool = new System.Collections.Generic.List<AudioClip>();
        foreach (string wav in perfectAudioFiles)
        {
            AudioClip c = AssetDatabase.LoadAssetAtPath<AudioClip>(dstAssetFolder + "/audio/" + Path.GetFileName(wav));
            if (c != null) pPool.Add(c);
        }
        burst.normalSfxPool = nPool.ToArray();
        burst.perfectSfxPool = pPool.ToArray();
        burst.normalSfx = nPool.Count > 0 ? nPool[0] : AssetDatabase.LoadAssetAtPath<AudioClip>(dstAssetFolder + "/audio/parry_normal.wav");
        burst.perfectSfx = pPool.Count > 0 ? pPool[0] : AssetDatabase.LoadAssetAtPath<AudioClip>(dstAssetFolder + "/audio/parry_perfect.wav");

        string prefabPath = dstAssetFolder + "/XsxbParryBurst.prefab";
        PrefabUtility.SaveAsPrefabAsset(go, prefabPath);
        if (!createSceneInstance)
        {
            UnityEngine.Object.DestroyImmediate(go);
            return AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
        }
        return go;
    }

    private static void ConfigureLinearMask(string assetPath, TextureWrapMode wrapMode)
    {
        if (!File.Exists(Path.Combine(Directory.GetParent(Application.dataPath).FullName, assetPath)))
            return;
        TextureImporter ti = AssetImporter.GetAtPath(assetPath) as TextureImporter;
        if (ti == null) return;
        bool dirty = false;
        if (ti.sRGBTexture) { ti.sRGBTexture = false; dirty = true; }
        if (ti.wrapMode != wrapMode) { ti.wrapMode = wrapMode; dirty = true; }
        if (!ti.isReadable) { ti.isReadable = true; dirty = true; }
        if (ti.textureCompression != TextureImporterCompression.Uncompressed)
        {
            ti.textureCompression = TextureImporterCompression.Uncompressed;
            dirty = true;
        }
        if (dirty) ti.SaveAndReimport();
    }

    private static void ConfigureClashAudio(string assetPath)
    {
        if (!File.Exists(Path.Combine(Directory.GetParent(Application.dataPath).FullName, assetPath)))
            return;
        AudioImporter ai = AssetImporter.GetAtPath(assetPath) as AudioImporter;
        if (ai == null) return;
        AudioImporterSampleSettings s = ai.defaultSampleSettings;
        if (s.loadType != AudioClipLoadType.DecompressOnLoad)
        {
            s.loadType = AudioClipLoadType.DecompressOnLoad;
            ai.defaultSampleSettings = s;
            ai.SaveAndReimport();
        }
    }
}
#endif
