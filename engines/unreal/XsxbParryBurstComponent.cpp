// XSXB-Slash Parry Burst C++ component implementation (`xsxb-parry` v1, docs/SPEC_PARRY.md).
#include "XsxbParryBurstComponent.h"
#include "ProceduralMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/AudioComponent.h"
#include "Sound/SoundBase.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/Texture.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Kismet/GameplayStatics.h"
#include "Camera/PlayerCameraManager.h"

namespace
{
	static float Smooth01(float A, float B, float X)
	{
		const float T = FMath::Clamp((X - A) / FMath::Max(1e-6f, B - A), 0.f, 1.f);
		return T * T * (3.f - 2.f * T);
	}
	static FLinearColor ParseRgb(const TSharedPtr<FJsonObject>& Obj, const TCHAR* Key, const FLinearColor& Def)
	{
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (Obj.IsValid() && Obj->TryGetArrayField(Key, Arr) && Arr->Num() >= 3)
		{
			return FLinearColor((*Arr)[0]->AsNumber(), (*Arr)[1]->AsNumber(), (*Arr)[2]->AsNumber(), 1.f);
		}
		return Def;
	}
}

UXsxbParryBurstComponent::UXsxbParryBurstComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickGroup = TG_PostUpdateWork;
}

void UXsxbParryBurstComponent::BeginPlay()
{
	Super::BeginPlay();
	AActor* Owner = GetOwner();
	if (!Owner) return;

	StarMesh = NewObject<UProceduralMeshComponent>(Owner);
	StarMesh->SetupAttachment(this);
	StarMesh->SetCastShadow(false);
	StarMesh->RegisterComponent();

	FlashMesh = NewObject<UProceduralMeshComponent>(Owner);
	FlashMesh->SetupAttachment(this);
	FlashMesh->SetCastShadow(false);
	FlashMesh->RegisterComponent();

	AddMesh = NewObject<UProceduralMeshComponent>(Owner);
	AddMesh->SetupAttachment(this);
	AddMesh->SetCastShadow(false);
	AddMesh->RegisterComponent();

	ClashLight = NewObject<UPointLightComponent>(Owner);
	ClashLight->SetupAttachment(this);
	ClashLight->SetIntensityUnits(ELightUnits::Candelas);
	ClashLight->SetAttenuationRadius(600.f);
	ClashLight->SetCastShadows(false);
	ClashLight->SetIntensity(0.f);
	ClashLight->RegisterComponent();

	ClashAudio = NewObject<UAudioComponent>(Owner);
	ClashAudio->SetupAttachment(this);
	ClashAudio->bAutoActivate = false;
	ClashAudio->RegisterComponent();

	if (StarMaterial) StarMid = UMaterialInstanceDynamic::Create(StarMaterial, this);
	if (FlashMaterial) FlashMid = UMaterialInstanceDynamic::Create(FlashMaterial, this);
	if (AdditiveMaterial) AddMid = UMaterialInstanceDynamic::Create(AdditiveMaterial, this);
	if (!RecipeFile.IsEmpty()) LoadRecipe(RecipeFile);
	ApplyTierTextures();
}

void UXsxbParryBurstComponent::ApplyTierTextures()
{
	const bool bNorm = (ActiveTier == TEXT("normal"));
	UTexture* St = (bNorm && StarNormalTexture) ? StarNormalTexture.Get() : StarTexture.Get();
	UTexture* Fl = (bNorm && FlashNormalTexture) ? FlashNormalTexture.Get() : FlashTexture.Get();
	if (StarMid && St) StarMid->SetTextureParameterValue(TEXT("StarTex"), St);
	if (FlashMid && Fl) FlashMid->SetTextureParameterValue(TEXT("FlashTex"), Fl);
}

bool UXsxbParryBurstComponent::LoadRecipe(const FString& InRecipeFile)
{
	FString Full = FPaths::IsRelative(InRecipeFile) ? FPaths::ProjectDir() / InRecipeFile : InRecipeFile;
	FString JsonStr;
	if (!FFileHelper::LoadFileToString(JsonStr, *Full)) return false;

	TSharedPtr<FJsonObject> Root;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonStr);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid()) return false;

	FString Fmt = Root->HasField(TEXT("format")) ? Root->GetStringField(TEXT("format")) : Root->GetStringField(TEXT("kind"));
	if (Fmt != TEXT("xsxb-parry") || static_cast<int32>(Root->GetNumberField(TEXT("version"))) != 1) return false;

	ActiveSeed = static_cast<int32>(Root->GetNumberField(TEXT("seed")));
	const FString RawTier = Root->GetStringField(TEXT("tier"));
	ActiveTier = (RawTier == TEXT("normal")) ? TEXT("normal") : TEXT("perfect");
	if (const TSharedPtr<FJsonObject>* Frm = nullptr; Root->TryGetObjectField(TEXT("frame"), Frm))
		FloorRelZCm = (*Frm)->GetNumberField(TEXT("floorY")) * 100.f;

	auto ParseSfxPool = [](const TSharedPtr<FJsonObject>& TierObj, float& OutDefaultPeak, TArray<float>& OutPoolPeaks) {
		OutPoolPeaks.Reset();
		if (const TSharedPtr<FJsonObject>* SX = nullptr; TierObj->TryGetObjectField(TEXT("sfx"), SX))
		{
			if ((*SX)->HasField(TEXT("peakOffsetS"))) OutDefaultPeak = (*SX)->GetNumberField(TEXT("peakOffsetS"));
			if (const TArray<TSharedPtr<FJsonValue>>* PoolArr = nullptr; (*SX)->TryGetArrayField(TEXT("pool"), PoolArr))
			{
				for (const TSharedPtr<FJsonValue>& Val : *PoolArr)
				{
					const TSharedPtr<FJsonObject>* Entry = nullptr;
					if (Val.IsValid() && Val->TryGetObject(Entry) && (*Entry)->HasField(TEXT("peakOffsetS")))
						OutPoolPeaks.Add((*Entry)->GetNumberField(TEXT("peakOffsetS")));
					else
						OutPoolPeaks.Add(OutDefaultPeak);
				}
			}
		}
	};
	if (const TSharedPtr<FJsonObject>* TiersObj = nullptr; Root->TryGetObjectField(TEXT("tiers"), TiersObj))
	{
		if (const TSharedPtr<FJsonObject>* TN = nullptr; (*TiersObj)->TryGetObjectField(TEXT("normal"), TN))
			ParseSfxPool(*TN, NormalPeakOffsetS, NormalPoolPeakOffsetsS);
		if (const TSharedPtr<FJsonObject>* TP = nullptr; (*TiersObj)->TryGetObjectField(TEXT("perfect"), TP))
			ParseSfxPool(*TP, PerfectPeakOffsetS, PerfectPoolPeakOffsetsS);
	}

	if (const TSharedPtr<FJsonObject>* St = nullptr; Root->TryGetObjectField(TEXT("star"), St))
	{
		StarCore = ParseRgb(*St, TEXT("core"), StarCore);
		StarEdge = ParseRgb(*St, TEXT("edge"), StarEdge);
		StarHdr = (*St)->GetNumberField(TEXT("hdr"));
		StarSizeCm = (*St)->GetNumberField(TEXT("sizeM")) * 100.f;
		StarLifeS = (*St)->GetNumberField(TEXT("lifeS"));
		StarPow = (*St)->GetNumberField(TEXT("contrastPow"));
		LightColor = StarEdge;
		if (const TSharedPtr<FJsonObject>* Lt = nullptr; (*St)->TryGetObjectField(TEXT("light"), Lt))
		{
			LightIntensity = (*Lt)->GetNumberField(TEXT("intensity"));
			LightDecayS = (*Lt)->GetNumberField(TEXT("decayS"));
			LightColor = ParseRgb(*Lt, TEXT("color"), StarEdge);
		}
	}
	if (const TSharedPtr<FJsonObject>* TopLt = nullptr; Root->TryGetObjectField(TEXT("light"), TopLt))
	{
		if ((*TopLt)->HasField(TEXT("enabled"))) bLightEnabled = (*TopLt)->GetBoolField(TEXT("enabled"));
		if ((*TopLt)->HasField(TEXT("intensity"))) LightIntensity = (*TopLt)->GetNumberField(TEXT("intensity"));
		if ((*TopLt)->HasField(TEXT("rangeM"))) LightRangeCm = (*TopLt)->GetNumberField(TEXT("rangeM")) * 100.f;
		if ((*TopLt)->HasField(TEXT("decayS"))) LightDecayS = (*TopLt)->GetNumberField(TEXT("decayS"));
		LightColor = ParseRgb(*TopLt, TEXT("color"), LightColor);
	}
	if (const TSharedPtr<FJsonObject>* Fl = nullptr; Root->TryGetObjectField(TEXT("flash"), Fl))
	{
		if ((*Fl)->HasField(TEXT("enabled"))) bFlashEnabled = (*Fl)->GetBoolField(TEXT("enabled"));
		bFlashCircular = (*Fl)->HasField(TEXT("style")) || (*Fl)->HasField(TEXT("sizeM")) || (*Fl)->HasField(TEXT("opacity"));
		FlashCore = ParseRgb(*Fl, TEXT("core"), FlashCore);
		FlashCol = ParseRgb(*Fl, TEXT("color"), FlashCol);
		if ((*Fl)->HasField(TEXT("sizeM"))) FlashSizeCm = (*Fl)->GetNumberField(TEXT("sizeM")) * 100.f;
		if ((*Fl)->HasField(TEXT("opacity"))) FlashOpacity = (*Fl)->GetNumberField(TEXT("opacity"));
		if ((*Fl)->HasField(TEXT("blur"))) FlashBlur = (*Fl)->GetNumberField(TEXT("blur"));
		if ((*Fl)->HasField(TEXT("hdr"))) FlashHdr = (*Fl)->GetNumberField(TEXT("hdr"));
		if ((*Fl)->HasField(TEXT("lifeS"))) FlashLifeS = (*Fl)->GetNumberField(TEXT("lifeS"));
		if ((*Fl)->HasField(TEXT("expand"))) FlashExpand = (*Fl)->GetNumberField(TEXT("expand"));
		if ((*Fl)->HasField(TEXT("hollow"))) FlashHollow = (*Fl)->GetNumberField(TEXT("hollow"));
		if ((*Fl)->HasField(TEXT("spin"))) FlashSpin = (*Fl)->GetNumberField(TEXT("spin"));
		if ((*Fl)->HasField(TEXT("seed"))) FlashSeed = static_cast<int32>((*Fl)->GetNumberField(TEXT("seed")));
		if ((*Fl)->HasField(TEXT("lengthM"))) FlashLenCm = (*Fl)->GetNumberField(TEXT("lengthM")) * 100.f;
		if ((*Fl)->HasField(TEXT("widthRatio"))) FlashWidthRatio = (*Fl)->GetNumberField(TEXT("widthRatio"));
		if ((*Fl)->HasField(TEXT("count"))) FlashCount = static_cast<int32>((*Fl)->GetNumberField(TEXT("count")));
	}
	if (const TSharedPtr<FJsonObject>* Sp = nullptr; Root->TryGetObjectField(TEXT("sparks"), Sp))
	{
		SpHot = ParseRgb(*Sp, TEXT("hot"), SpHot);
		SpMid = ParseRgb(*Sp, TEXT("mid"), SpMid);
		SpCool = ParseRgb(*Sp, TEXT("cool"), SpCool);
		SpHdr = (*Sp)->GetNumberField(TEXT("hdr"));
		SpGravityCm = (*Sp)->GetNumberField(TEXT("gravity")) * 100.f;
		SpBounce = (*Sp)->GetNumberField(TEXT("floorBounce"));
	}
	bLoaded = true;
	return true;
}

void UXsxbParryBurstComponent::PlayTierSfx(float LeadSeconds)
{
	if (!bEnableSfx || !ClashAudio) return;
	const bool bNorm = (ActiveTier == TEXT("normal"));
	const TArray<TObjectPtr<USoundBase>>& Pool = bNorm ? NormalSoundPool : PerfectSoundPool;
	const TArray<float>& PeakPool = bNorm ? NormalPoolPeakOffsetsS : PerfectPoolPeakOffsetsS;
	int32& LastPick = bNorm ? LastNormalSfxPick : LastPerfectSfxPick;
	int32& PendingIdx = bNorm ? PendingNormalSfxIdx : PendingPerfectSfxIdx;
	USoundBase* Snd = nullptr;
	float PeakOff = bNorm ? NormalPeakOffsetS : PerfectPeakOffsetS;
	if (Pool.Num() > 0)
	{
		int32 Idx = (PendingIdx >= 0 && PendingIdx < Pool.Num()) ? PendingIdx : 0;
		if (PendingIdx < 0)
		{
			Idx = (Pool.Num() == 1) ? 0 : FMath::RandRange(0, Pool.Num() - 1);
			if (Pool.Num() > 1 && Idx == LastPick) Idx = (Idx + 1 + FMath::RandRange(0, Pool.Num() - 2)) % Pool.Num();
		}
		LastPick = Idx;
		PendingIdx = -1;
		Snd = Pool[Idx].Get();
		if (PeakPool.IsValidIndex(Idx)) PeakOff = PeakPool[Idx];
	}
	if (!Snd)
		Snd = bNorm ? (NormalSound ? NormalSound.Get() : PerfectSound.Get()) : (PerfectSound ? PerfectSound.Get() : NormalSound.Get());
	if (!Snd) return;
	const float StartOff = FMath::Max(0.f, PeakOff - FMath::Max(0.f, LeadSeconds));
	const float Vol = FMath::Max(0.f, SfxVolumeMultiplier * (bNorm ? NormalSfxVolume : PerfectSfxVolume));
	ClashAudio->bIsUISound = bPlaySfx2D;
	ClashAudio->bAllowSpatialization = !bPlaySfx2D;
	ClashAudio->SetVolumeMultiplier(Vol);
	ClashAudio->SetSound(Snd);
	ClashAudio->Play(StartOff);
}

void UXsxbParryBurstComponent::TriggerParryWithLead(float LeadSeconds, const FString& TierOverride)
{
	if (!bLoaded) return;
	if (!TierOverride.IsEmpty()) ActiveTier = (TierOverride == TEXT("normal")) ? TEXT("normal") : TEXT("perfect");
	const bool bNorm = (ActiveTier == TEXT("normal"));
	const TArray<TObjectPtr<USoundBase>>& Pool = bNorm ? NormalSoundPool : PerfectSoundPool;
	const TArray<float>& PeakPool = bNorm ? NormalPoolPeakOffsetsS : PerfectPoolPeakOffsetsS;
	int32& LastPick = bNorm ? LastNormalSfxPick : LastPerfectSfxPick;
	int32& PendingIdx = bNorm ? PendingNormalSfxIdx : PendingPerfectSfxIdx;
	float PeakOff = bNorm ? NormalPeakOffsetS : PerfectPeakOffsetS;
	if (Pool.Num() > 0)
	{
		int32 Idx = (Pool.Num() == 1) ? 0 : FMath::RandRange(0, Pool.Num() - 1);
		if (Pool.Num() > 1 && Idx == LastPick) Idx = (Idx + 1 + FMath::RandRange(0, Pool.Num() - 2)) % Pool.Num();
		PendingIdx = Idx;
		if (PeakPool.IsValidIndex(Idx)) PeakOff = PeakPool[Idx];
	}
	if (LeadSeconds <= .001f) { TriggerParry(ActiveTier); return; }
	PreLeadTimer = LeadSeconds;
	if (LeadSeconds <= PeakOff) PlayTierSfx(LeadSeconds);
}

void UXsxbParryBurstComponent::TriggerParry(const FString& TierOverride, int32 SeedOverride)
{
	if (!bLoaded) return;
	if (!TierOverride.IsEmpty()) ActiveTier = (TierOverride == TEXT("normal")) ? TEXT("normal") : TEXT("perfect");
	if (SeedOverride >= 0) ActiveSeed = SeedOverride;
	ApplyTierTextures();
	PreLeadTimer = -1.f;
	PlayTierSfx(0.f);

	FRandomStream Rng(ActiveSeed ^ 0x5A17);
	Sparks.Reset();
	for (int32 Tier = 0; Tier < 3; ++Tier)
	{
		const int32 Cnt = (Tier == 0) ? 95 : ((Tier == 1) ? 165 : 60);
		for (int32 i = 0; i < Cnt; ++i)
		{
			FSparkState S;
			S.TierIdx = Tier;
			S.Id = Tier * 1000 + i;
			S.Pos = GetComponentLocation();
			const FVector Dir = Rng.VRandCone(FVector(0.2f, 0.8f, 0.55f).GetSafeNormal(), FMath::DegreesToRadians(Tier == 2 ? 72.f : 42.f));
			const float Spd = (Tier == 0 ? Rng.FRandRange(320.f, 1900.f) : (Tier == 1 ? Rng.FRandRange(170.f, 700.f) : Rng.FRandRange(65.f, 340.f))) * ScaleMul;
			S.Vel = Dir * Spd;
			S.Drag = (Tier == 0) ? Rng.FRandRange(7.f, 17.f) : ((Tier == 1) ? Rng.FRandRange(.9f, 2.4f) : Rng.FRandRange(2.5f, 5.f));
			S.Life = (Tier == 0) ? Rng.FRandRange(.08f, .22f) : Rng.FRandRange(.8f, 1.65f);
			S.GravMul = (Tier == 0) ? .25f : ((Tier == 1) ? 1.f : .3f);
			S.WidthCm = Rng.FRandRange(.11f, .24f) * ScaleMul;
			S.Clip = (Tier == 2) ? .3333f : 0.f;
			Sparks.Add(S);
		}
	}
	SimT = 0.f;
	Tau = 0.f;
	bPlaying = true;
}

void UXsxbParryBurstComponent::StepTo(float TargetTau)
{
	constexpr float Dt = 1.f / 240.f;
	const float FloorZ = GetComponentLocation().Z + FloorRelZCm * ScaleMul;
	while (SimT + Dt <= TargetTau + 1e-6f)
	{
		SimT += Dt;
		for (FSparkState& S : Sparks)
		{
			if (SimT < S.Delay || (SimT - S.Delay) > S.Life) continue;
			S.Vel.Z -= SpGravityCm * ScaleMul * S.GravMul * Dt;
			S.Vel /= (1.f + S.Drag * Dt);
			const FVector Old = S.Pos;
			S.Pos += S.Vel * Dt;
			if (S.Pos.Z < FloorZ)
			{
				S.Pos.Z = FloorZ;
				if (S.Vel.Z < 0.f)
				{
					S.Vel.Z = -S.Vel.Z * SpBounce * (S.Bounces > 0 ? .7f : 1.f);
					S.Vel.X *= .72f; S.Vel.Y *= .72f;
					++S.Bounces; S.Cool *= .75f;
				}
				if (FMath::Abs(S.Vel.Z) < 25.f * ScaleMul) { S.Vel.Z = 0.f; S.Vel.X *= (1.f - 6.f * Dt); S.Vel.Y *= (1.f - 6.f * Dt); }
			}
			S.DistCm += FVector::Dist(S.Pos, Old);
		}
	}
}

void UXsxbParryBurstComponent::RebuildMeshes(float InTau)
{
	if (ClashLight)
	{
		if (!bLightEnabled)
		{
			ClashLight->SetIntensity(0.f);
		}
		else
		{
			const float Rise = Smooth01(0.f, .012f, InTau);
			ClashLight->SetAttenuationRadius(LightRangeCm * ScaleMul);
			ClashLight->SetLightColor(FMath::Lerp(LightColor, FLinearColor::White, .32f));
			ClashLight->SetIntensity(InTau < .6f ? LightIntensity * 45.f * Rise * FMath::Exp(-InTau / FMath::Max(.005f, LightDecayS)) : 0.f);
		}
	}
	if (FlashMesh)
	{
		FlashMesh->ClearAllMeshSections();
		const float FlLife = FMath::Max(.02f, FlashLifeS);
		if (bFlashEnabled && bFlashCircular && FlashOpacity > .001f && InTau >= 0.f && InTau < FlLife * 1.75f)
		{
			const float Fade = Smooth01(0.f, .008f, InTau) * FMath::Pow(FMath::Clamp(1.f - InTau / (FlLife * 1.75f), 0.f, 1.f), 1.35f);
			if (Fade * FlashOpacity > .001f)
			{
				const float Grow = FMath::Lerp(FMath::Max(.2f, 1.f - FlashExpand * .55f), 1.f + FlashExpand * .45f, 1.f - FMath::Exp(-InTau / FMath::Max(.014f, FlLife * .42f)));
				const float HalfSz = FlashSizeCm * Grow * ScaleMul * .5f;
				FVector CamLoc = GetComponentLocation() + FVector(-200.f, 0.f, 30.f);
				FRotator CamRot = FRotator::ZeroRotator;
				if (APlayerCameraManager* CamMgr = UGameplayStatics::GetPlayerCameraManager(this, 0))
				{
					CamLoc = CamMgr->GetCameraLocation();
					CamRot = CamMgr->GetCameraRotation();
				}
				const FVector ToCam = (CamLoc - GetComponentLocation()).GetSafeNormal(1e-4f, FVector(-1.f, 0.f, 0.f));
				const FVector Ctr = FlashMesh->GetComponentTransform().InverseTransformPosition(GetComponentLocation() + ToCam * (3.5f * ScaleMul));
				const float SpinRad = static_cast<float>(((ActiveSeed ^ (FlashSeed * 2654435761u)) & 0xFFFF) % 628) / 100.f + InTau * FlashSpin;
				const FQuat BillboardQ = FQuat(CamRot) * FQuat(FVector::ForwardVector, SpinRad);
				const FVector R = FlashMesh->GetComponentTransform().InverseTransformVectorNoScale(BillboardQ.GetAxisY() * HalfSz);
				const FVector U = FlashMesh->GetComponentTransform().InverseTransformVectorNoScale(BillboardQ.GetAxisZ() * HalfSz);
				TArray<FVector> V = { Ctr - R - U, Ctr + R - U, Ctr + R + U, Ctr - R + U };
				TArray<int32> I = { 0, 2, 1, 0, 3, 2 };
				TArray<FVector> N = { -ToCam, -ToCam, -ToCam, -ToCam };
				TArray<FVector2D> UV0 = { FVector2D(0.f, 1.f), FVector2D(1.f, 1.f), FVector2D(1.f, 0.f), FVector2D(0.f, 0.f) };
				TArray<FColor> C;
				TArray<FProcMeshTangent> T;
				FlashMesh->CreateMeshSection(0, V, I, N, UV0, C, T, false);
				if (FlashMid)
				{
					FlashMid->SetVectorParameterValue(TEXT("CoreCol"), FlashCore);
					FlashMid->SetVectorParameterValue(TEXT("EdgeCol"), FlashCol);
					FlashMid->SetVectorParameterValue(TEXT("FlashParams"), FLinearColor(FlashOpacity * Fade, FMath::Clamp(FlashBlur, .02f, .95f), FMath::Clamp(FlashHollow, 0.f, .85f), FlashHdr));
					FlashMesh->SetMaterial(0, FlashMid);
				}
			}
		}
	}
}

void UXsxbParryBurstComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	if (!bLoaded) return;
	if (PreLeadTimer >= 0.f)
	{
		const float Prev = PreLeadTimer;
		PreLeadTimer -= FMath::Min(DeltaTime, .05f);
		const bool bNorm = (ActiveTier == TEXT("normal"));
		const TArray<float>& PeakPool = bNorm ? NormalPoolPeakOffsetsS : PerfectPoolPeakOffsetsS;
		const int32 PendingIdx = bNorm ? PendingNormalSfxIdx : PendingPerfectSfxIdx;
		const float PeakOff = PeakPool.IsValidIndex(PendingIdx) ? PeakPool[PendingIdx] : (bNorm ? NormalPeakOffsetS : PerfectPeakOffsetS);
		if (Prev > PeakOff && PreLeadTimer <= PeakOff && PreLeadTimer > 0.f) PlayTierSfx(PreLeadTimer);
		if (PreLeadTimer <= 0.f) { PreLeadTimer = -1.f; TriggerParry(ActiveTier, ActiveSeed); return; }
	}
	if (!bPlaying) return;
	Tau += FMath::Min(DeltaTime, .05f);
	if (Tau >= 1.85f)
	{
		bPlaying = false;
		if (ClashLight) ClashLight->SetIntensity(0.f);
		if (StarMesh) StarMesh->ClearAllMeshSections();
		if (FlashMesh) FlashMesh->ClearAllMeshSections();
		if (AddMesh) AddMesh->ClearAllMeshSections();
		return;
	}
	StepTo(Tau);
	RebuildMeshes(Tau);
}
