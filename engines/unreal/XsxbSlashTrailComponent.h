// XSXB-Slash trail for Unreal 5 (recipe v1, docs/SPEC.md). One ProceduralMesh ribbon per recipe layer.
// Build.cs: add "ProceduralMeshComponent", "Json" to PublicDependencyModuleNames (and the plugin ProceduralMeshComponent).
// Attach this component to the weapon mesh; set HiltSocket / TipSocket (socket or bone names on that mesh),
// RecipeFile (absolute or project-relative path to recipe.json), the three textures, and the two parent materials
// built from XsxbSlashLayer.hlsl (one Translucent, one Additive).
#pragma once
#include "CoreMinimal.h"
#include "Components/SceneComponent.h"
#include "XsxbSlashTrailComponent.generated.h"

class UProceduralMeshComponent;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UTexture;

UCLASS(ClassGroup=(Effects), meta=(BlueprintSpawnableComponent))
class UXsxbSlashTrailComponent : public USceneComponent
{
	GENERATED_BODY()
public:
	UXsxbSlashTrailComponent();

	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") FString RecipeFile;
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") FName HiltSocket;
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") FName TipSocket;
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") TObjectPtr<UTexture> ShapeTex;
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") TObjectPtr<UTexture> MaskTex;
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") TObjectPtr<UTexture> HighlightTex;
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") TObjectPtr<UTexture> WhiteTex;   // optional, for shapeTexture "white"
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") TObjectPtr<UMaterialInterface> AlphaMaterial;
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") TObjectPtr<UMaterialInterface> AdditiveMaterial;
	/** Tip speed in m/s above which the blade counts as swinging. */
	/** Multiplies every layer width (recipe assumes a ~1 m blade). */
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") float WidthScale = 1.f;
	/** Stretch shape/highlight textures over the whole visible trail (U = age / oldest age of the stroke). Off = U is plain age. */
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") bool bFillTexture = true;
	/** Off = no new trail (existing trail fades out). Drive it from attack windows / anim notifies for clean combos. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail") bool bEmitting = true;
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail") float MinTipSpeed = 2.f;
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail", meta=(ClampMin=1, ClampMax=16)) int32 Substeps = 6;   // samples per frame along a Catmull-Rom curve
	/** 0 off, 1 UV0 (red age, green V), 2 frac(dist). */
	UPROPERTY(EditAnywhere, Category="XsxbSlashTrail", meta=(ClampMin=0, ClampMax=2)) int32 DebugMode = 0;

	// ---- Finish (docs/SPEC.md 4c): how a stroke ends. Read from recipe.finish in BeginPlay (missing = off). ----
	/** Tail-out: after emitting stops keep following the blade for TailOutS, alpha fading 1 -> 0 (width unchanged). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") bool bTailOut = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float TailOutS = .08f;
	/** Head cut: once a stroke stops growing, its newest HeadLenM metres get a ragged, blurred, fainter edge instead of a straight cut. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") bool bHeadCut = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float HeadLenM = .22f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float HeadRampS = .04f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float HeadRagged = .85f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float HeadBlur = 2.5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float HeadSoftExtra = .18f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float HeadFade = .5f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float HeadNoiseTile = 2.5f;
	/** > 0 narrows the OLD end of each stroke to a point (never the head). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float TailTip = 0.f;
	/** Noise dissolve over age (from DissStart to the end of life). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") bool bDissolve = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float DissStart = .4f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float DissSoft = .12f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float DissEdgeGlow = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") float DissEdgeW = .06f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbSlashTrail|Finish") FLinearColor DissEdgeColor = FLinearColor(.58f, .32f, .06f, 0.f);

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

private:
	struct FSample { FVector Tip; FVector Dir; double T; float Dist; int32 Swing; float F = 1.f; };
	struct FRun
	{
		float WidthM = .8f, LifeS = .4f, Taper = .55f;
		TObjectPtr<UProceduralMeshComponent> Mesh;
		TObjectPtr<UMaterialInstanceDynamic> Mat;
	};
	TArray<FRun> Runs;
	UPROPERTY() TArray<TObjectPtr<UObject>> Keep;   // keeps meshes / MIDs alive
	struct FKey { FVector Tip; FVector Hilt; double T; };
	TArray<FSample> Samples;   // shared by all layers; each layer draws the part younger than its life
	TArray<FKey> Keys;         // last frame poses of the current swing (Catmull-Rom control points)
	FKey PrevKey{};
	int32 ProvStart = -1;      // samples from here on belong to the newest segment and are redrawn next frame
	float ProvDist = 0.f, MaxLife = 0.f;
	bool bHasPrev = false, bWas = false;
	float Dist = 0.f;   // metres
	int32 Swing = 0;
	double TailStart = -1.0;   // time of the last sample inside the window while tailing out (< 0 = not tailing)
	float SampleDt = 1.f / 60.f;
	void ReadFinish(const TSharedPtr<class FJsonObject>& Root);
	void SetFinishParams(class UMaterialInstanceDynamic* M) const;
	double Now = 0.0;

	void AddSample(const FVector& Tip, const FVector& Hilt, double T);
	void Segment(const FKey& A, const FKey& B, const FKey* Before, const FKey* After);
	void Build(FRun& R);
};
