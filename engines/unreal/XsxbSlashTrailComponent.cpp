// XSXB-Slash trail for Unreal 5 (recipe v1, docs/SPEC.md). Rename the include if your module needs a path prefix.
#include "XsxbSlashTrailComponent.h"
#include "ProceduralMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

UXsxbSlashTrailComponent::UXsxbSlashTrailComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickGroup = TG_PostUpdateWork;   // after animation
}

static FLinearColor BTColor(const TSharedPtr<FJsonObject>& O, const TCHAR* Key)
{
	const TArray<TSharedPtr<FJsonValue>>* A;
	if (O->TryGetArrayField(Key, A) && A->Num() >= 3)
		return FLinearColor((float)(*A)[0]->AsNumber(), (float)(*A)[1]->AsNumber(), (float)(*A)[2]->AsNumber(), 0.f);   // already linear
	return FLinearColor::Black;
}

void UXsxbSlashTrailComponent::BeginPlay()
{
	Super::BeginPlay();
	FString Path = FPaths::IsRelative(RecipeFile) ? FPaths::Combine(FPaths::ProjectDir(), RecipeFile) : RecipeFile, Text;
	TSharedPtr<FJsonObject> Root;
	if (!FFileHelper::LoadFileToString(Text, *Path) || !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Root) || !Root)
	{
		UE_LOG(LogTemp, Warning, TEXT("XsxbSlashTrail: cannot read recipe %s"), *Path);
		return;
	}
	ReadFinish(Root);
	const TArray<TSharedPtr<FJsonValue>>* Layers;
	if (!Root->TryGetArrayField(TEXT("layers"), Layers)) return;
	int32 Index = 0;
	for (const TSharedPtr<FJsonValue>& V : *Layers)
	{
		const TSharedPtr<FJsonObject> L = V->AsObject();
		const bool bAdd = L->GetStringField(TEXT("blend")) == TEXT("additive");
		UMaterialInterface* Parent = bAdd ? AdditiveMaterial : AlphaMaterial;
		if (!Parent) continue;
		FRun R;
		R.WidthM = (float)L->GetNumberField(TEXT("widthM")) * WidthScale;
		R.LifeS = FMath::Max(.02f, (float)L->GetNumberField(TEXT("lifeS")));
		R.Taper = (float)L->GetNumberField(TEXT("taper"));
		R.Mat = UMaterialInstanceDynamic::Create(Parent, this);
		const FString ST = L->GetStringField(TEXT("shapeTexture"));
		R.Mat->SetTextureParameterValue(TEXT("ShapeTex"), ST == TEXT("highlight") ? HighlightTex.Get() : ST == TEXT("white") && WhiteTex ? WhiteTex.Get() : ShapeTex.Get());
		R.Mat->SetTextureParameterValue(TEXT("MaskTex"), MaskTex);
		R.Mat->SetTextureParameterValue(TEXT("HlTex"), HighlightTex);
		R.Mat->SetVectorParameterValue(TEXT("Color"), BTColor(L, TEXT("color")));
		R.Mat->SetVectorParameterValue(TEXT("EdgeColor"), BTColor(L, TEXT("edgeColor")));
		R.Mat->SetVectorParameterValue(TEXT("HlColor"), BTColor(L, TEXT("highlightColor")));
		static const TPair<const TCHAR*, const TCHAR*> Scalars[] = {
			{TEXT("alpha"), TEXT("Alpha")}, {TEXT("hdr"), TEXT("Hdr")}, {TEXT("windowNarrow"), TEXT("WindowNarrow")},
			{TEXT("maskAmount"), TEXT("MaskAmount")}, {TEXT("maskTilePerM"), TEXT("MaskTilePerM")}, {TEXT("maskPanPerS"), TEXT("MaskPanPerS")},
			{TEXT("erodeSpeed"), TEXT("ErodeSpeed")}, {TEXT("erodeSharp"), TEXT("ErodeSharp")}, {TEXT("edgeWidth"), TEXT("EdgeWidth")},
			{TEXT("edgeGlow"), TEXT("EdgeGlow")}, {TEXT("highlight"), TEXT("Highlight")}};
		for (const auto& P : Scalars) R.Mat->SetScalarParameterValue(P.Value, (float)L->GetNumberField(P.Key));
		R.Mat->SetScalarParameterValue(TEXT("Additive"), bAdd ? 1.f : 0.f);
		SetFinishParams(R.Mat);
		R.Mat->SetScalarParameterValue(TEXT("DebugMode"), (float)DebugMode);

		R.Mesh = NewObject<UProceduralMeshComponent>(GetOwner(), NAME_None, RF_Transient);
		R.Mesh->SetUsingAbsoluteLocation(true); R.Mesh->SetUsingAbsoluteRotation(true); R.Mesh->SetUsingAbsoluteScale(true);
		R.Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		R.Mesh->SetCastShadow(false);
		R.Mesh->bUseAsyncCooking = true;
		R.Mesh->SetTranslucentSortPriority(Index);   // later layers on top
		R.Mesh->RegisterComponent();
		R.Mesh->SetWorldTransform(FTransform::Identity);   // vertices are world space
		R.Mesh->SetMaterial(0, R.Mat);
		Keep.Add(R.Mesh); Keep.Add(R.Mat);
		MaxLife = FMath::Max(MaxLife, R.LifeS);
		Runs.Add(MoveTemp(R));
		++Index;
	}
}

void UXsxbSlashTrailComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	if (Runs.Num() == 0) return;
	const float Dt = FMath::Max(DeltaTime, 1e-5f);
	Now += Dt;
	USceneComponent* P = GetAttachParent() ? GetAttachParent() : this;
	const FVector Tip = P->GetSocketLocation(TipSocket), Hilt = P->GetSocketLocation(HiltSocket);
	const FKey Cur{Tip, Hilt, Now};
	const bool bOn = bEmitting && bHasPrev && FVector::Dist(Tip, PrevKey.Tip) * .01f / Dt > MinTipSpeed;   // cm -> m
	if (bOn) TailStart = -1.0;
	else if (bWas && bTailOut && TailOutS > 0.f && TailStart < 0.0) TailStart = PrevKey.T;   // window just closed: tail out
	const bool bSwing = bOn || (TailStart >= 0.0 && PrevKey.T - TailStart < TailOutS);
	if (!bSwing) TailStart = -1.0;
	SampleDt = Dt;
	if (bSwing)
	{
		if (!bWas) { ++Swing; Dist = 0.f; Keys.Reset(); Keys.Add(PrevKey); AddSample(PrevKey.Tip, PrevKey.Hilt, PrevKey.T); ProvStart = -1; }
		Keys.Add(Cur); if (Keys.Num() > 4) Keys.RemoveAt(0);
		const int32 N = Keys.Num();
		if (N >= 3 && ProvStart >= 0)
		{
			// the next pose is known now: redraw the previous segment with full Catmull-Rom tangents
			Samples.SetNum(ProvStart); Dist = ProvDist;
			Segment(Keys[N - 3], Keys[N - 2], N >= 4 ? &Keys[N - 4] : nullptr, &Keys[N - 1]);
		}
		ProvStart = Samples.Num(); ProvDist = Dist;
		Segment(Keys[N - 2], Keys[N - 1], N >= 3 ? &Keys[N - 3] : nullptr, nullptr);
	}
	else ProvStart = -1;
	bWas = bSwing; PrevKey = Cur; bHasPrev = true;
	int32 Old = 0; while (Old < Samples.Num() && Now - Samples[Old].T > MaxLife) ++Old;
	if (Old > 0) { Samples.RemoveAt(0, Old); if (ProvStart >= 0) ProvStart = FMath::Max(0, ProvStart - Old); }
	for (FRun& R : Runs) { R.Mat->SetScalarParameterValue(TEXT("DebugMode"), (float)DebugMode); Build(R); }
}

void UXsxbSlashTrailComponent::ReadFinish(const TSharedPtr<FJsonObject>& Root)
{
	const TSharedPtr<FJsonObject>* Fin = nullptr;
	if (!Root->TryGetObjectField(TEXT("finish"), Fin) || !Fin || !(*Fin).IsValid()) return;   // missing = all off (old look)
	auto Sub = [&](const TCHAR* K) { const TSharedPtr<FJsonObject>* O = nullptr; return (*Fin)->TryGetObjectField(K, O) && O ? *O : TSharedPtr<FJsonObject>(); };
	auto Num = [](const TSharedPtr<FJsonObject>& O, const TCHAR* K, float& Out) { double V; if (O->TryGetNumberField(K, V)) Out = (float)V; };
	if (const TSharedPtr<FJsonObject> T = Sub(TEXT("tailOut"))) { bTailOut = T->GetBoolField(TEXT("on")); Num(T, TEXT("durationS"), TailOutS); }
	if (const TSharedPtr<FJsonObject> H = Sub(TEXT("headCut")))
	{
		bHeadCut = H->GetBoolField(TEXT("on"));
		Num(H, TEXT("lengthM"), HeadLenM); Num(H, TEXT("rampS"), HeadRampS); Num(H, TEXT("ragged"), HeadRagged); Num(H, TEXT("blurLod"), HeadBlur);
		Num(H, TEXT("extraSoftness"), HeadSoftExtra); Num(H, TEXT("fade"), HeadFade); Num(H, TEXT("noiseTileX"), HeadNoiseTile); Num(H, TEXT("tailTip"), TailTip);
	}
	if (const TSharedPtr<FJsonObject> D = Sub(TEXT("dissolve")))
	{
		bDissolve = D->GetBoolField(TEXT("on"));
		Num(D, TEXT("start"), DissStart); Num(D, TEXT("softness"), DissSoft); Num(D, TEXT("edgeGlow"), DissEdgeGlow); Num(D, TEXT("edgeWidth"), DissEdgeW);
		const TArray<TSharedPtr<FJsonValue>>* A;
		if (D->TryGetArrayField(TEXT("edgeColor"), A) && A->Num() >= 3) DissEdgeColor = FLinearColor((float)(*A)[0]->AsNumber(), (float)(*A)[1]->AsNumber(), (float)(*A)[2]->AsNumber(), 0.f);
	}
}

void UXsxbSlashTrailComponent::SetFinishParams(UMaterialInstanceDynamic* M) const
{
	M->SetScalarParameterValue(TEXT("DissSoft"), DissSoft);
	M->SetScalarParameterValue(TEXT("HeadSoftExtra"), HeadSoftExtra);
	M->SetScalarParameterValue(TEXT("HeadBlur"), HeadBlur);
	M->SetScalarParameterValue(TEXT("HeadNoiseTile"), HeadNoiseTile);
	M->SetScalarParameterValue(TEXT("DissEdgeGlow"), DissEdgeGlow);
	M->SetScalarParameterValue(TEXT("DissEdgeW"), DissEdgeW);
	M->SetVectorParameterValue(TEXT("DissEdgeColor"), DissEdgeColor);
}

static FVector BTHerm(const FVector& P0, const FVector& M0, const FVector& P1, const FVector& M1, float F)
{
	const float F2 = F * F, F3 = F2 * F;
	return (2 * F3 - 3 * F2 + 1) * P0 + (F3 - 2 * F2 + F) * M0 + (-2 * F3 + 3 * F2) * P1 + (F3 - F2) * M1;
}

// Hermite segment A -> B. Tangents: Catmull-Rom (neighbour difference / 2) where the neighbour exists, else the chord.
void UXsxbSlashTrailComponent::Segment(const FKey& A, const FKey& B, const FKey* Before, const FKey* After)
{
	// spline the hilt position and the blade vector (tip - hilt) separately, then renormalise the blade:
	// a fast swing stays on its arc instead of cutting the corner
	const FVector RA = A.Tip - A.Hilt, RB = B.Tip - B.Hilt;
	const FVector MrA = Before ? (RB - (Before->Tip - Before->Hilt)) * .5f : RB - RA, MrB = After ? ((After->Tip - After->Hilt) - RA) * .5f : RB - RA;
	const FVector MhA = Before ? (B.Hilt - Before->Hilt) * .5f : B.Hilt - A.Hilt, MhB = After ? (After->Hilt - A.Hilt) * .5f : B.Hilt - A.Hilt;
	const float LA = RA.Size(), LB = RB.Size();
	FVector Last = A.Tip;
	for (int32 K = 1; K <= Substeps; ++K)
	{
		const float F = (float)K / Substeps;
		const FVector H = BTHerm(A.Hilt, MhA, B.Hilt, MhB, F), R = BTHerm(RA, MrA, RB, MrB, F);
		const FVector T = H + (R.SizeSquared() > 1e-8f ? R.GetUnsafeNormal() : RB.GetSafeNormal()) * FMath::Lerp(LA, LB, F);
		Dist += FVector::Dist(T, Last) * .01f; Last = T;   // cm -> m
		AddSample(T, H, FMath::Lerp(A.T, B.T, (double)F));
	}
}

void UXsxbSlashTrailComponent::AddSample(const FVector& T, const FVector& H, double Time)
{
	float F = 1.f;   // tail-out fade (alpha only)
	if (TailStart >= 0.0 && Time > TailStart) F = .5f + .5f * FMath::Cos(PI * FMath::Clamp(float((Time - TailStart) / FMath::Max(TailOutS, 1e-3f)), 0.f, 1.f));
	Samples.Add({T, (T - H).GetSafeNormal(), Time, Dist, Swing, F});
}

void UXsxbSlashTrailComponent::Build(FRun& R)
{
	int32 First = 0; while (First < Samples.Num() && Now - Samples[First].T > R.LifeS) ++First;
	TArray<FVector> Pos; TArray<int32> Tri; TArray<FVector2D> UV0, UV1, UV2, UV3;
	float Oldest = 1.f;
	const bool bFin = bTailOut || bHeadCut || bDissolve;
	TArray<int32> HeadIdx; HeadIdx.SetNumUninitialized(Samples.Num());   // newest sample of each stroke
	for (int32 I = Samples.Num() - 1, Hd = I; I >= First; --I) { if (I < Samples.Num() - 1 && Samples[I + 1].Swing != Samples[I].Swing) Hd = I; HeadIdx[I] = Hd; }
	for (int32 I = First; I < Samples.Num(); ++I)
	{
		const FSample& S = Samples[I]; const int32 J = I - First;
		const float Age = FMath::Clamp(float((Now - S.T) / R.LifeS), 0.f, 1.f);
		if (J == 0 || Samples[I - 1].Swing != S.Swing) Oldest = FMath::Max(Age, 1e-3f);   // first sample of a stroke = its oldest
		const float XU = bFillTexture ? FMath::Min(1.f, Age / Oldest) : Age;
		// finish (SPEC 4c): alpha multiplier, dissolve progress, head weight. The width never changes at the head.
		float FA = S.F, Hr = 0.f, Wm = 1.f;
		if (bHeadCut)
		{
			const FSample& Hs = Samples[HeadIdx[I]];
			const float K = FMath::Clamp(float((Now - Hs.T - SampleDt * .5) / FMath::Max(HeadRampS, 1e-3f)), 0.f, 1.f);
			Hr = FMath::Max(K * (1.f - FMath::SmoothStep(0.f, 1.f, (Hs.Dist - S.Dist) / FMath::Max(HeadLenM, 1e-4f))), 1.f - FA);
			FA *= 1.f - HeadFade * Hr;
			if (TailTip > 0.f) Wm = FMath::SmoothStep(0.f, 1.f, (1.f - FMath::Min(1.f, Age / Oldest)) / TailTip);
		}
		const float Prog = FMath::Max(bDissolve ? FMath::Clamp((Age - DissStart) / FMath::Max(1.f - DissStart, 1e-3f), 0.f, 1.f) : 0.f, bHeadCut ? HeadRagged * Hr : 0.f);
		const float W = R.WidthM * 100.f * (1.f - R.Taper * Age) * Wm;   // m -> cm
		UV2.Add(FVector2D(FA, Prog)); UV2.Add(FVector2D(FA, Prog)); UV3.Add(FVector2D(Hr, 0)); UV3.Add(FVector2D(Hr, 0));
		Pos.Add(S.Tip - S.Dir * W); UV0.Add(FVector2D(Age, 0)); UV1.Add(FVector2D(S.Dist, XU));   // inner
		Pos.Add(S.Tip);             UV0.Add(FVector2D(Age, 1)); UV1.Add(FVector2D(S.Dist, XU));   // outer
		if (J > 0 && Samples[I - 1].Swing == S.Swing)
		{
			const int32 A = (J - 1) * 2, B = J * 2;
			Tri.Append({A, B, A + 1, A + 1, B, B + 1});
		}
	}
	const TArray<FVector> Empty; const TArray<FColor> NoColor; const TArray<FProcMeshTangent> NoTan;
	if (bFin) SetFinishParams(R.Mat);
	R.Mesh->CreateMeshSection(0, Pos, Tri, Empty, UV0, UV1, UV2, UV3, NoColor, NoTan, false);
}
