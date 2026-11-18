// XSXB-Slash Parry Burst C++ component for Unreal Engine 5 (`xsxb-parry` v1, docs/SPEC_PARRY.md).
// Build.cs: add "ProceduralMeshComponent", "Json" to PublicDependencyModuleNames.
// Use `XsxbParryInstall.py` in Editor to import linear masks (sRGB OFF) and generate `M_XsxbParry_*` materials,
// or assign your own parent materials built with `XsxbParryLayer.ush`.
#pragma once

#include "CoreMinimal.h"
#include "Components/SceneComponent.h"
#include "XsxbParryBurstComponent.generated.h"

class UProceduralMeshComponent;
class UPointLightComponent;
class UAudioComponent;
class USoundBase;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UTexture;

UCLASS(ClassGroup=(Effects), meta=(BlueprintSpawnableComponent))
class UXsxbParryBurstComponent : public USceneComponent
{
	GENERATED_BODY()

public:
	UXsxbParryBurstComponent();

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	FString RecipeFile;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<UMaterialInterface> StarMaterial;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<UMaterialInterface> FlashMaterial;

	// Per-tier masks (the installer imports textures/star[_normal].png, flash[_normal].png). Null = keep the material's default
	// texture; a null *Normal* texture falls back to the perfect one, so a bundle without star_normal/flash_normal still works.
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<UTexture> StarTexture;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<UTexture> StarNormalTexture;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<UTexture> FlashTexture;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<UTexture> FlashNormalTexture;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<UMaterialInterface> AdditiveMaterial;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<UMaterialInterface> SmokeMaterial;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<UMaterialInterface> DebrisMaterial;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<UMaterialInterface> RefractionMaterial;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<USoundBase> NormalSound;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TObjectPtr<USoundBase> PerfectSound;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TArray<TObjectPtr<USoundBase>> NormalSoundPool;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	TArray<TObjectPtr<USoundBase>> PerfectSoundPool;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	bool bEnableSfx = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	bool bPlaySfx2D = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	float SfxVolumeMultiplier = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	float NormalSfxVolume = 1.35f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	float PerfectSfxVolume = 1.75f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="XsxbParry")
	float ScaleMul = 1.0f;

	UFUNCTION(BlueprintCallable, Category="XsxbParry")
	bool LoadRecipe(const FString& InRecipeFile);

	UFUNCTION(BlueprintCallable, Category="XsxbParry")
	void TriggerParry(const FString& TierOverride = TEXT(""), int32 SeedOverride = -1);

	UFUNCTION(BlueprintCallable, Category="XsxbParry")
	void TriggerParryWithLead(float LeadSeconds, const FString& TierOverride = TEXT(""));

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

private:
	struct FSparkState
	{
		int32 TierIdx = 0, Bounces = 0, Id = 0;
		FVector Pos = FVector::ZeroVector, Vel = FVector::ZeroVector;
		float Drag = 1.f, Life = 1.f, WidthCm = .15f, Heat = 1.f, Cool = .8f, GravMul = 1.f;
		float Delay = 0.f, DistCm = 0.f, Streak = .032f, MaxLenCm = 42.f, Clip = 0.f;
	};

	bool bLoaded = false;
	bool bPlaying = false;
	float Tau = -1.f;
	float SimT = 0.f;
	int32 ActiveSeed = 77;
	FString ActiveTier = TEXT("perfect");

	float StarHdr = 26.f, StarSizeCm = 108.f, StarLifeS = .13f, StarPow = 2.2f;
	FLinearColor StarCore = FLinearColor::White, StarEdge = FLinearColor(1.f, .45f, .11f, 1.f);
	bool bFlashEnabled = true, bFlashCircular = true;
	float FlashSizeCm = 105.f, FlashOpacity = .68f, FlashBlur = .28f, FlashHdr = 9.5f, FlashLifeS = .14f, FlashExpand = .55f, FlashHollow = 0.f, FlashSpin = 0.f;
	float FlashLenCm = 245.f, FlashWidthRatio = .002f;
	int32 FlashCount = 2, FlashSeed = 17;
	FLinearColor FlashCore = FLinearColor(1.f, .96f, .85f, 1.f), FlashCol = FLinearColor(1.f, .55f, .16f, 1.f);
	float SpHdr = 12.f, SpGravityCm = 1250.f, SpBounce = .48f, FloorRelZCm = -110.f;
	FLinearColor SpHot = FLinearColor(1.f, .9f, .72f, 1.f), SpMid = FLinearColor(1.f, .45f, .06f, 1.f), SpCool = FLinearColor(.67f, .04f, .01f, 1.f);
	bool bLightEnabled = true;
	float LightIntensity = 20.f, LightRangeCm = 650.f, LightDecayS = .085f;
	FLinearColor LightColor = FLinearColor(1.f, .45f, .11f, 1.f);
	float NormalPeakOffsetS = .015f, PerfectPeakOffsetS = .015f;
	TArray<float> NormalPoolPeakOffsetsS, PerfectPoolPeakOffsetsS;
	int32 LastNormalSfxPick = -1, LastPerfectSfxPick = -1, PendingNormalSfxIdx = -1, PendingPerfectSfxIdx = -1;
	float PreLeadTimer = -1.f;

	UPROPERTY(Transient) TObjectPtr<UProceduralMeshComponent> StarMesh;
	UPROPERTY(Transient) TObjectPtr<UProceduralMeshComponent> FlashMesh;
	UPROPERTY(Transient) TObjectPtr<UProceduralMeshComponent> AddMesh;
	UPROPERTY(Transient) TObjectPtr<UPointLightComponent> ClashLight;
	UPROPERTY(Transient) TObjectPtr<UAudioComponent> ClashAudio;
	UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> StarMid;
	UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> FlashMid;
	UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> AddMid;

	TArray<FSparkState> Sparks;
	void PlayTierSfx(float LeadSeconds);
	void ApplyTierTextures();
	void StepTo(float TargetTau);
	void RebuildMeshes(float InTau);
};
