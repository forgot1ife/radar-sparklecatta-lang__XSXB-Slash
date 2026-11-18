// XSXB-Slash · 格挡 tab: 双档位 (普通格挡 / 精防) 联动随机与独立手调、独立打光、6种拖尾丝飞行模式（含果冻壳曲面散射）、10档高频钢鸣母带+多音效池管理与随机抽播导出.
(()=>{
'use strict';
const go=()=>{if(!window.PARRY_CORE||!window.PARRY_AUDIO){window.addEventListener(!window.PARRY_CORE?'parry-core':'parry-audio',go,{once:true});return;}main(window.PARRY_CORE,window.BTG_THREE,window.PARRY_AUDIO);};
go();

function main(K,B,A){
const {THREE}=B,$=id=>document.getElementById(id),Q=new URLSearchParams(location.search),REC=!!B.REC_PARRY;
const SCHEMES={
  gold:{hot:'#fff3dc',mid:'#ffb347',cool:'#d63a17',core:'#ffffff',edge:'#ffb25c',light:'#ffb060',flashCore:'#fff9eb',flash:'#ffb85c',ribbon:'#ffbe6e'},
  steel:{hot:'#ffffff',mid:'#ffe4b0',cool:'#ff7a2e',core:'#ffffff',edge:'#d6e4ff',light:'#cfe0ff',flashCore:'#ffffff',flash:'#cfe2ff',ribbon:'#ffe0a0'},
  crimson:{hot:'#fff0e2',mid:'#ff6a2a',cool:'#b8121c',core:'#fff6ee',edge:'#ff4a24',light:'#ff5a32',flashCore:'#fff4ea',flash:'#ff5e2e',ribbon:'#ff6a3a'},
  azure:{hot:'#f4fbff',mid:'#7ccbff',cool:'#2457d6',core:'#ffffff',edge:'#6ab4ff',light:'#6eb8ff',flashCore:'#f5fcff',flash:'#6ec0ff',ribbon:'#8fd0ff'},
  jade:{hot:'#f4fff6',mid:'#7dffb0',cool:'#1a9a5a',core:'#ffffff',edge:'#62f0a0',light:'#68f0a4',flashCore:'#f4fff8',flash:'#64f0a4',ribbon:'#90ffc0'}};
const SCHEME_NAMES=[['gold','金'],['steel','白钢'],['crimson','赤红'],['azure','冰蓝'],['jade','翠']];
function applySchemeTo(p,name){const s=SCHEMES[name]||SCHEMES.gold;p.scheme=name;
  Object.assign(p.sparks,{hot:s.hot,mid:s.mid,cool:s.cool});Object.assign(p.ember,{hot:s.hot,mid:s.mid,cool:s.cool});Object.assign(p.star,{core:s.core,edge:s.edge});
  p.needles.color=s.flash;p.light.color=s.light;p.flash.core=s.flashCore;p.flash.color=s.flash;p.ribbon.color=s.ribbon;}

const TIERS={
  normal:p=>{p.tier='normal';
    Object.assign(p.star,{on:1,size:.85,hdr:22,life:.11});
    Object.assign(p.needles,{on:1,len:1.85,count:2,width:.0020,spread:22,hdr:22,life:.065});
    Object.assign(p.light,{on:1,intensity:14,range:6.0,decay:.075,glow:.28,glowSize:.95,offsetZ:.18});
    Object.assign(p.flash,{on:0,style:'sphere',tex:'',customSrc:'',size:.92,opacity:.55,blur:.30,hdr:8.5,life:.12,expand:.48,hollow:0,rings:3,spin:0});
    Object.assign(p.sparks,{on:1,burst:70,arc:125,speed:1.28});
    Object.assign(p.ember,{on:1,count:60,speed:1.12,size:1,gravity:3.6,hdr:12});
    Object.assign(p.ribbon,{on:0,style:'sphereScatter',count:8,hdr:13,sphereR:.34,sphereCone:48});
    p.smoke.on=0;p.debris.on=0;p.debris.speed=1.20;p.refr.on=0;
    Object.assign(p.sfx,{on:1,grade:3,weight:.34,resonance:.22});
    Object.assign(p.clash,{hitstop:.065,tremor:.95,shake:.8});},
  perfect:p=>{p.tier='perfect';
    Object.assign(p.star,{on:1,size:1.12,hdr:26,life:.135});
    Object.assign(p.needles,{on:1,len:2.65,count:3,width:.0024,spread:24,hdr:30,life:.085});
    Object.assign(p.light,{on:1,intensity:22,range:7.5,decay:.095,glow:.48,glowSize:1.15,offsetZ:.18});
    Object.assign(p.flash,{on:1,style:'sphere',tex:'',customSrc:'',size:1.28,opacity:.74,blur:.26,hdr:11.5,life:.155,expand:.62,hollow:0,rings:4,spin:0});
    Object.assign(p.sparks,{on:1,burst:105,arc:180,speed:1.42});
    Object.assign(p.ember,{on:1,count:85,speed:1.24,size:1.12,gravity:3.6,hdr:14});
    Object.assign(p.ribbon,{on:1,style:'sphereScatter',count:12,hdr:18,life:.26,sphereR:.34,sphereCone:48});
    p.smoke.on=1;p.smoke.style='ink';p.smoke.count=10;p.smoke.dark=32;p.smoke.opacity=.78;
    p.debris.on=1;p.debris.count=26;p.debris.speed=1.32;
    Object.assign(p.refr,{on:1,style:'ripple',amt:30,radius:1.45,waves:3,scope:'frame'});
    Object.assign(p.sfx,{on:1,grade:18,weight:.68,resonance:.62});
    Object.assign(p.clash,{hitstop:.085,tremor:1.25,shake:1.2});}
};
const TIER_NAMES=[['normal','普通格挡'],['perfect','精防']];

// Dual-tier state + Multi-SFX pools (each tier manages multiple saved variants; games randomly pick on trigger by default)
const T={normal:K.clone(K.DEF),perfect:K.clone(K.DEF)};
TIERS.normal(T.normal);applySchemeTo(T.normal,'gold');
TIERS.perfect(T.perfect);applySchemeTo(T.perfect,'gold');
let curTier='normal',manualSplit=false,P=T.normal;
let nextPoolId=1;
const maxBankId=()=>Math.max(1,(Array.isArray(window.PARRY_SFX_BANK)?window.PARRY_SFX_BANK.length:0)||20);
const mkPoolEntry=s=>({id:nextPoolId++,on:1,grade:Math.max(1,Math.min(maxBankId(),Math.round(+s.grade||3))),weight:+(+s.weight||0).toFixed(3),resonance:+(+(s.resonance??.22)).toFixed(3)});
const sfxPools={normal:[mkPoolEntry(T.normal.sfx)],perfect:[mkPoolEntry(T.perfect.sfx)]};
const sfxSel={normal:sfxPools.normal[0].id,perfect:sfxPools.perfect[0].id};
const sfxLocked={normal:false,perfect:false};
const sfxWork=K.clone(T.normal.sfx);
let sfxWorkTier='normal';   // which tier's pool the sfx editor buffer was loaded from (live-follow writes go back there)
const lastCyclePick={normal:-1,perfect:-1};

function syncPrimaryFromPool(tk){
  const list=sfxPools[tk];
  if(list.length){
    const chosen=list.find(x=>x.id===sfxSel[tk])||list[0];
    sfxSel[tk]=chosen.id;
    Object.assign(T[tk].sfx,{on:T[tk].sfx.on===0?0:1,grade:chosen.grade,weight:chosen.weight,resonance:chosen.resonance});
  }
}
function pickPoolSfxForPlayback(tk){
  if(!T[tk].sfx.on)return null;
  const list=sfxPools[tk];
  if(!list.length)return null;   // empty pool = this tier is silent (matches the export)
  if(list.length===1){lastCyclePick[tk]=0;return list[0];}
  let idx=Math.floor(Math.random()*list.length);
  if(idx===lastCyclePick[tk])idx=(idx+1+Math.floor(Math.random()*(list.length-1)))%list.length;
  lastCyclePick[tk]=idx;
  return list[idx];
}

// ---------- playback & peak-synced audio trigger ----------
let simT=0,paused=false,clock=performance.now(),cycleIdx=0,lastAudioCycle=-1,inited=false;
function ensureInit(){if(inited)return;inited=true;K.init($('three5'));}
function loop(){requestAnimationFrame(loop);if(REC||window.BTG_tab!==5||!K.ready)return;
  const t=performance.now(),dt=Math.min(.05,(t-clock)/1000);clock=t;
  if(!paused)simT+=dt*P.clash.speed;
  cycleIdx=Math.floor(simT/K.CYCLE);const tc=simT-cycleIdx*K.CYCLE;
  const onSfxTab=typeof U!=='undefined'&&U.sel==='sfx';
  const liveSfx=onSfxTab?(sfxWork.on?sfxWork:null):pickPoolSfxForPlayback(curTier);
  if(!paused&&!A.muted&&liveSfx&&liveSfx.on&&cycleIdx!==lastAudioCycle&&tc<K.T0){
    const wallToT0=(K.T0-tc)/Math.max(.05,P.clash.speed);
    if(wallToT0<=.30){lastAudioCycle=cycleIdx;A.scheduleAtClash(liveSfx,wallToT0);}
  }
  K.renderAt(P,tc,cycleIdx);
  $('info5').textContent=`${curTier==='normal'?'普通格挡':'精防'} · ${P.clash.speed<1?'慢放 ×'+P.clash.speed.toFixed(2):'正常速度'} · 拖动旋转 / 滚轮缩放 · 把 glb 拖进来换武器`;}
window.addEventListener('btg-tab',e=>{if(e.detail===5){ensureInit();clock=performance.now();lastAudioCycle=-1;requestAnimationFrame(()=>K.resize());}else A.stopAll();});

// ---------- recording API: ?rec=1&mode=parry&w=&h= (backward-compatible) ----------
const deep=(a,b)=>{for(const k in b){if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&a[k]&&typeof a[k]==='object')deep(a[k],b[k]);else a[k]=b[k];}return a;};
function applyLegacyCompat(target,patch){
  if(patch&&patch.star){
    if(patch.star.light!=null&&!(patch.light&&patch.light.intensity!=null)){target.light.intensity=+patch.star.light;target.light.on=patch.star.light>0?1:0;}
    if(patch.star.glow!=null&&!(patch.light&&patch.light.glow!=null))target.light.glow=+patch.star.glow;
  }
  if(patch&&patch.flash&&patch.flash.len!=null&&patch.flash.size==null){
    target.flash.size=+(+patch.flash.len*.52).toFixed(3);
  }
  if(patch&&patch.sparks&&patch.sparks.ember!=null&&!(patch.ember&&patch.ember.count!=null)){
    target.ember.count=Math.max(0,Math.round(+patch.sparks.ember));target.ember.on=target.ember.count>0?1:0;
  }
}
if(REC){const W=+Q.get('w')||1280,H=+Q.get('h')||720,st=document.createElement('style');
  st.textContent=`header,main:not(#tab5),#ctrl5,#info5,#bar5,#drop5{display:none!important}main#tab5{display:block!important;padding:0!important}#stage5{border-radius:0!important;box-shadow:none!important;height:${H}px!important}#three5{position:fixed!important;left:0;top:0;width:${W}px!important;height:${H}px!important}body{overflow:hidden;margin:0}`;
  document.head.appendChild(st);$('tab5').hidden=false;window.BTG_tab=5;ensureInit();}
window.BTG_parryRec={
  get ready(){return K.ready;},T0:K.T0,CYCLE:K.CYCLE,
  get canvas(){return K.renderer.domElement;},
  reset(){TIERS.normal(T.normal);applySchemeTo(T.normal,'gold');TIERS.perfect(T.perfect);applySchemeTo(T.perfect,'gold');curTier='normal';P=T.normal;return P;},
  tier(name,scheme){const k=(name==='perfect'||name==='final')?'perfect':'normal';curTier=k;P=T[k];TIERS[k](P);
    if(name==='final'){P=K.clone(T.perfect);P.star.size=1.28;P.light.intensity=26;P.sparks.burst=125;P.sparks.arc=205;}
    if(scheme)applySchemeTo(P,scheme);return K.clone(P);},
  set(patch){deep(P,patch);applyLegacyCompat(P,patch);return K.clone(P);},
  get params(){return K.clone(P);},
  seek(t,cycle=0,opt){K.renderAt(P,t,cycle,Object.assign({rec:true},opt||{}));return true;},
  cam(pos,tgt,fov){K.setCam(pos,tgt,fov);},
  opts(o){if(!o)return;if(o.bloom!=null)K.bloom.strength=o.bloom;if(o.exposure!=null)K.renderer.toneMappingExposure=o.exposure;if(o.stageTheme!=null||o.bg!=null||o.gridAlpha!=null)K.setStageTheme(o);},
  recipe(){return K.recipe(P,{T,manualSplit});},
  texData(over){const q=K.clone(P);if(over){deep(q,over);applyLegacyCompat(q,over);}return K.texData(q);},
  genStar:K.genStar,genFlash:K.genFlash,genNoise:K.genNoise,
  project(p){return K.project(new THREE.Vector3(...p));},
  loadWeapon(url,flip){return K.loadWeapon(url,flip).then(()=>true);},
  defaultWeapon(){K.useDefaultWeapon();},
};
if(REC){requestAnimationFrame(loop);return;}

// ================= UI =================
const U={sel:'star',stars:'any',flashes:'any',sparks:'any',smokes:'any',refrs:'any'};
const ITEMS=[['star','星芒'],['needles','十字光'],['light','打光'],['flash','光球'],['sparks','火星'],['ember','铁水'],['ribbon','拖尾丝'],['smoke','暗烟'],['debris','碎屑'],['refr','热浪'],['sfx','音效'],['all','全部']];
const STAR_STY=[['cross4','十字锐芒'],['six','六芒'],['shard','碎芒'],['lance','长枪芒'],['burst','放射']];
const FLASH_STY=[['sphere','震波光球'],['ripple','同心水波纹'],['halo','气浪光环'],['corona','日冕放射圆'],['nebula','星云能量泡'],['shatter','裂纹震波圆']];
const SPARK_STY=[['fan','扇形喷射'],['burst','全向爆散'],['scrape','贴刃刮擦'],['rain','上抛落雨']];
const RIBBON_STY=[['whip','狂舞飞丝'],['sphereScatter','护体球散射'],['bladeSlide','贴刃流光'],['deflectCone','卸力扇面'],['vortexWrap','旋风缠刃'],['groundSkim','掠地火蛇']];
const SMOKE_STY=[['puff','团雾'],['ink','水墨飞白'],['wisp','细烟']];
const REFR_STY=[['ripple','水波纹'],['ring','冲击环'],['bulge','热浪鼓包'],['double','双环']];

// ---------- 🎲 Linked Random Escalation (rolls BOTH T.normal & T.perfect progressively, never picks built-ins) ----------
const newSeed=()=>(Math.random()*4294967296)>>>0;
function rollItemPair(k,r,fromAll){
  const N=T.normal,Pf=T.perfect;
  if(k==='star'){
    const sty=U.stars!=='any'?U.stars:STAR_STY[Math.floor(r()*STAR_STY.length)][0],sd=Math.floor(r()*1e6);
    const rays=4+Math.floor(r()*5),asym=+(.25+r()*.55).toFixed(2),sz=+(.72+r()*.32).toFixed(2),hdr=+(19+r()*6).toFixed(1),lf=+(.095+r()*.03).toFixed(3),pw=+(1.8+r()*.75).toFixed(2);
    Object.assign(N.star,{on:1,tex:'',style:sty,seed:sd,rays,asym,size:sz,hdr,life:lf,pow:pw});
    Object.assign(Pf.star,{on:1,tex:'',style:sty,seed:sd,rays:Math.min(12,rays+2),asym,size:+(sz*1.28).toFixed(2),hdr:+(hdr*1.22).toFixed(1),life:+(lf*1.18).toFixed(3),pow:pw});
  }else if(k==='needles'){
    const sd=Math.floor(r()*1e6),ln=+(1.6+r()*1.1).toFixed(2),cnt=1+Math.floor(r()*2),w=+(.0016+r()*.0012).toFixed(4),sp=Math.round(-30+r()*60),hdr=+(18+r()*10).toFixed(1),lf=+(.055+r()*.03).toFixed(3);
    Object.assign(N.needles,{on:1,seed:sd,len:ln,count:cnt,width:w,spread:sp,hdr,life:lf});
    Object.assign(Pf.needles,{on:1,seed:sd,len:+(ln*1.32).toFixed(2),count:Math.min(4,cnt+1),width:+(w*1.15).toFixed(4),spread:sp,hdr:+(hdr*1.28).toFixed(1),life:+(lf*1.22).toFixed(3)});
  }else if(k==='light'){
    const inten=+(11+r()*7).toFixed(1),rngM=+(5.2+r()*2.2).toFixed(2),dec=+(.065+r()*.028).toFixed(3),gl=+(.20+r()*.20).toFixed(2),gs=+(.85+r()*.25).toFixed(2),oz=+(.14+r()*.20).toFixed(2);
    Object.assign(N.light,{on:1,intensity:inten,range:rngM,decay:dec,glow:gl,glowSize:gs,offsetZ:oz});
    Object.assign(Pf.light,{on:1,intensity:+(inten*1.52).toFixed(1),range:+(rngM*1.24).toFixed(2),decay:+(dec*1.22).toFixed(3),glow:+Math.min(1,gl*1.55+.08).toFixed(2),glowSize:+(gs*1.22).toFixed(2),offsetZ:oz});
  }else if(k==='flash'){
    const sty=U.flashes!=='any'?U.flashes:FLASH_STY[Math.floor(r()*FLASH_STY.length)][0],sd=Math.floor(r()*1e6);
    const sz=+(.76+r()*.42).toFixed(2),op=+(.46+r()*.24).toFixed(2),bl=+(.16+r()*.36).toFixed(2),hdr=+(6.5+r()*4.5).toFixed(1),lf=+(.10+r()*.045).toFixed(3),ex=+(.35+r()*.38).toFixed(2);
    const hl=sty==='halo'?+(.22+r()*.26).toFixed(2):+(r()<.22?(.08+r()*.18):0).toFixed(2),rg=2+Math.floor(r()*4),spn=r()<.3?+((r()-.5)*2.4).toFixed(1):0;
    Object.assign(N.flash,{on:fromAll?0:1,tex:'',customSrc:'',style:sty,seed:sd,size:sz,opacity:op,blur:bl,hdr,life:lf,expand:ex,hollow:hl,rings:rg,spin:spn});
    Object.assign(Pf.flash,{on:1,tex:'',customSrc:'',style:sty,seed:sd,size:+(sz*1.32).toFixed(2),opacity:+Math.min(.95,op*1.25+.06).toFixed(2),blur:+Math.max(.06,bl*.88).toFixed(2),hdr:+(hdr*1.28).toFixed(1),life:+(lf*1.22).toFixed(3),expand:+(ex*1.20).toFixed(2),hollow:hl,rings:Math.min(8,rg+1),spin:spn});
  }else if(k==='sparks'){
    const sty=U.sparks!=='any'?U.sparks:SPARK_STY[Math.floor(r()*SPARK_STY.length)][0],sd=Math.floor(r()*1e6);
    const bu=Math.round(48+r()*48),ar=Math.round(95+r()*75),spd=+(1.10+r()*.45).toFixed(2),gv=+(9.5+r()*6.5).toFixed(1),dr=+(.8+r()*.45).toFixed(2),bo=+(.28+r()*.24).toFixed(2),lf=+(.82+r()*.38).toFixed(2),st=+(.82+r()*.48).toFixed(2),cn=Math.round(28+r()*26),hdr=+(10+r()*4).toFixed(1);
    Object.assign(N.sparks,{on:1,style:sty,seed:sd,burst:bu,arc:ar,speed:spd,gravity:gv,drag:dr,bounce:bo,life:lf,streak:st,cone:cn,hdr});
    Object.assign(Pf.sparks,{on:1,style:sty,seed:sd,burst:Math.round(bu*1.46),arc:Math.round(ar*1.46),speed:+(spd*1.16).toFixed(2),gravity:gv,drag:dr,bounce:bo,life:+(lf*1.14).toFixed(2),streak:+(st*1.14).toFixed(2),cone:cn,hdr:+(hdr*1.18).toFixed(1)});
  }else if(k==='ember'){
    const sd=Math.floor(r()*1e6),cnt=Math.round(52+r()*46),spd=+(1.0+r()*.42).toFixed(2),gv=+(2.2+r()*3.0).toFixed(1),dr=+(.8+r()*.45).toFixed(2),lf=+(.85+r()*.42).toFixed(2),sz=+(.9+r()*.45).toFixed(2),cn=Math.round(42+r()*32),hdr=+(10+r()*5).toFixed(1);
    Object.assign(N.ember,{on:1,seed:sd,count:cnt,speed:spd,gravity:gv,drag:dr,life:lf,size:sz,cone:cn,hdr});
    Object.assign(Pf.ember,{on:1,seed:sd,count:Math.round(cnt*1.38),speed:+(spd*1.12).toFixed(2),gravity:gv,drag:dr,life:+(lf*1.12).toFixed(2),size:+(sz*1.12).toFixed(2),cone:cn,hdr:+(hdr*1.16).toFixed(1)});
  }else if(k==='ribbon'){
    const sty=RIBBON_STY[Math.floor(r()*RIBBON_STY.length)][0],cnt=sty==='sphereScatter'?(10+Math.floor(r()*7)):(6+Math.floor(r()*6)),w=+(.0055+r()*.0050).toFixed(4),lf=+(.18+r()*.14).toFixed(2),hdr=+(16+r()*8).toFixed(1),sR=+(.24+r()*.24).toFixed(2),sC=Math.round(38+r()*22);
    const normOn=fromAll?(r()<.28?1:0):1;
    Object.assign(N.ribbon,{on:normOn,style:sty,count:Math.max(4,Math.round(cnt*.65)),width:+(w*.78).toFixed(4),life:+(lf*.82).toFixed(2),hdr:+(hdr*.75).toFixed(1),sphereR:sR,sphereCone:Math.max(25,Math.round(sC*.86))});
    Object.assign(Pf.ribbon,{on:1,style:sty,count:cnt,width:w,life:lf,hdr,sphereR:sR,sphereCone:sC});
  }else if(k==='smoke'){
    const sty=U.smokes!=='any'?U.smokes:SMOKE_STY[Math.floor(r()*SMOKE_STY.length)][0],sd=Math.floor(r()*1e6),cnt=Math.round(8+r()*6),op=+(.66+r()*.20).toFixed(2),sz=+(.85+r()*.42).toFixed(2),lf=+(.85+r()*.42).toFixed(2),dk=Math.round(22+r()*24);
    Object.assign(N.smoke,{on:fromAll?0:1,tex:'',style:sty,seed:sd,count:Math.max(4,Math.round(cnt*.62)),opacity:+(op*.76).toFixed(2),size:+(sz*.82).toFixed(2),life:+(lf*.85).toFixed(2),dark:Math.round(dk*.58)});
    Object.assign(Pf.smoke,{on:1,tex:'',style:sty,seed:sd,count:cnt,opacity:op,size:sz,life:lf,dark:dk});
  }else if(k==='debris'){
    const sd=Math.floor(r()*1e6),cnt=Math.round(18+r()*18),sz=+(.8+r()*.55).toFixed(2),spd=+(1.10+r()*.52).toFixed(2);
    Object.assign(N.debris,{on:fromAll?0:1,seed:sd,count:Math.round(cnt*.55),size:+(sz*.82).toFixed(2),speed:+(spd*.86).toFixed(2)});
    Object.assign(Pf.debris,{on:1,seed:sd,count:cnt,size:sz,speed:spd});
  }else if(k==='refr'){
    const sty=U.refrs!=='any'?U.refrs:REFR_STY[Math.floor(r()*REFR_STY.length)][0],amt=Math.round(18+r()*16),rad=+(1.15+r()*.55).toFixed(2),lf=+(.22+r()*.14).toFixed(2);
    Object.assign(N.refr,{on:fromAll?0:1,tex:'',style:sty,amt:Math.round(amt*.58),radius:+(rad*.80).toFixed(2),life:+(lf*.82).toFixed(2)});
    Object.assign(Pf.refr,{on:1,tex:'',style:sty,amt,radius:rad,life:lf});
  }else if(k==='sfx'){
    const bank=Array.isArray(window.PARRY_SFX_BANK)?window.PARRY_SFX_BANK:[];
    const n=bank.length;
    const lightList=n?bank.slice(0,Math.max(1,Math.ceil(n*.55))):[];
    const heavyList=n?bank.slice(Math.max(0,Math.floor(n*.45))):[];
    const pickN=lightList.length?lightList[Math.floor(r()*lightList.length)]:{id:1+Math.floor(r()*10)};
    const pickP=heavyList.length?heavyList[Math.floor(r()*heavyList.length)]:{id:Math.min(maxBankId(),11+Math.floor(r()*10))};
    const g0=+pickN.id,g1=+pickP.id;
    const w0=+(.28+r()*.14).toFixed(2),rs0=+(.16+r()*.12).toFixed(2);
    const w1=+(.62+r()*.14).toFixed(2),rs1=+(.54+r()*.16).toFixed(2);
    if(!sfxLocked.normal){
      Object.assign(N.sfx,{on:1,grade:g0,weight:w0,resonance:rs0});
      sfxPools.normal=[mkPoolEntry(N.sfx)];sfxSel.normal=sfxPools.normal[0].id;
    }
    if(!sfxLocked.perfect){
      Object.assign(Pf.sfx,{on:1,grade:g1,weight:w1,resonance:rs1});
      sfxPools.perfect=[mkPoolEntry(Pf.sfx)];sfxSel.perfect=sfxPools.perfect[0].id;
    }
    if(!fromAll){
      Object.assign(sfxWork,{on:1,grade:curTier==='normal'?g0:g1,weight:curTier==='normal'?w0:w1,resonance:curTier==='normal'?rs0:rs1});
    }
  }
}
const RND={};
['star','needles','light','flash','sparks','ember','ribbon','smoke','debris','refr','sfx'].forEach(k=>{RND[k]=r=>{
  rollItemPair(k,r,false);manualSplit=false;P=T[curTier];
};});
RND.all=r=>{
  const sc=SCHEME_NAMES[Math.floor(r()*SCHEME_NAMES.length)][0];
  applySchemeTo(T.normal,sc);applySchemeTo(T.perfect,sc);
  for(const k of ['star','needles','light','flash','sparks','ember','ribbon','smoke','debris','refr','sfx'])rollItemPair(k,K.rng(Math.floor(r()*4294967296)),true);
  const sd=Math.floor(r()*1e6);T.normal.seed=sd;T.perfect.seed=sd;
  Object.assign(T.normal.clash,{hitstop:.065,tremor:.95,shake:.8});
  Object.assign(T.perfect.clash,{hitstop:.085,tremor:1.25,shake:1.2});
  manualSplit=false;P=T[curTier];
  if(!sfxLocked[curTier])Object.assign(sfxWork,P.sfx);
};

const HIST={},HIST_TABS=new Set(['star','needles','flash','sparks','ember','ribbon','smoke','all']);
ITEMS.forEach(([k])=>HIST[k]=[]);
const hexRgb=h=>{const n=parseInt(String(h||'#ffffff').replace('#',''),16);return [(n>>16)&255,(n>>8)&255,n&255];};
function thumb(k){
  const c=document.createElement('canvas');c.width=120;c.height=50;const x=c.getContext('2d');
  if(k==='star'||k==='flash'){
    x.fillStyle='#0d0f14';x.fillRect(0,0,120,50);
    const td=K.texData(P)[k],S=46,im=x.createImageData(S,S),dd=im.data;
    if(k==='star'){
      const c0=hexRgb(P.star.core),c1=hexRgb(P.star.edge),pw=P.star.pow||2.2;
      for(let py=0;py<S;py++)for(let px=0;px<S;px++){
        const tx=Math.min(255,Math.floor((px+.5)/S*256)),ty=Math.min(255,Math.floor((py+.5)/S*256)),s=td.a[ty*256+tx];
        const kv=Math.min(1,Math.pow(Math.max(0,s),pw)*1.5),t=Math.max(0,Math.min(1,(s-.25)/.65)),mt=t*t*(3-2*t),i=(py*S+px)*4;
        dd[i]=Math.round(13*(1-kv)+(c1[0]+(c0[0]-c1[0])*mt)*kv);
        dd[i+1]=Math.round(15*(1-kv)+(c1[1]+(c0[1]-c1[1])*mt)*kv);
        dd[i+2]=Math.round(20*(1-kv)+(c1[2]+(c0[2]-c1[2])*mt)*kv);dd[i+3]=255;
      }
    }else{
      const c0=hexRgb(P.flash.core),c1=hexRgb(P.flash.color),bl=Math.max(.02,(P.flash.blur??.28)*.92),hl=P.flash.hollow??0,op=Math.max(.2,P.flash.opacity??.68);
      for(let py=0;py<S;py++)for(let px=0;px<S;px++){
        const ux=(px+.5)/S*2-1,uy=(py+.5)/S*2-1,r=Math.hypot(ux,uy),i=(py*S+px)*4;
        if(r>1){dd[i]=13;dd[i+1]=15;dd[i+2]=20;dd[i+3]=255;continue;}
        const tx=Math.min(255,Math.floor((px+.5)/S*256)),ty=Math.min(255,Math.floor((py+.5)/S*256)),s=td.a[ty*256+tx];
        const rEdge=r-(s-.35)*.06,te=Math.max(0,Math.min(1,(1-rEdge)/bl)),eEnv=te*te*(3-2*te);
        const ti=hl>.001?Math.max(0,Math.min(1,(r+(s-.45)*.05-hl*.58)/Math.max(.01,hl*.30+.05))):1,iEnv=ti*ti*(3-2*ti);
        const m=Math.min(1,s*eEnv*iEnv*op*1.35),tc=Math.max(0,Math.min(1,(s*(1-r*.40)-.30)/.60)),mc=tc*tc*(3-2*tc);
        dd[i]=Math.round(13*(1-m)+(c1[0]+(c0[0]-c1[0])*mc)*m);
        dd[i+1]=Math.round(15*(1-m)+(c1[1]+(c0[1]-c1[1])*mc)*m);
        dd[i+2]=Math.round(20*(1-m)+(c1[2]+(c0[2]-c1[2])*mc)*m);dd[i+3]=255;
      }
    }
    x.putImageData(im,37,2);
    return c;
  }
  const layerKeys=['star','needles','light','flash','sparks','ember','ribbon','smoke','debris','refr'],saved={};
  if(k!=='all'){
    for(const lk of layerKeys){saved[lk]=P[lk].on;P[lk].on=0;}
    P[k].on=1;if(k==='smoke')P.light.on=1;
  }
  const tSnap=k==='sparks'?K.T0+.055:k==='ember'?K.T0+.12:k==='ribbon'?K.T0+.095:k==='smoke'?K.T0+.12:K.T0+.05;
  K.renderAt(P,tSnap,0,{noShake:true});
  const cv=K.renderer.domElement,[px,py]=K.project(K.C),w=cv.width*.42,h=w*50/120;
  x.drawImage(cv,px-w/2,py-h/2,w,h,0,0,120,50);
  if(k==='all'){x.fillStyle=P.flash.color||'#ffb85c';x.fillRect(0,47,60,3);x.fillStyle=P.sparks.hot||'#fff3dc';x.fillRect(60,47,60,3);}
  if(k!=='all'){for(const lk of layerKeys)P[lk].on=saved[lk];}
  const tc=simT-Math.floor(simT/K.CYCLE)*K.CYCLE;K.renderAt(P,tc,cycleIdx);
  return c;
}
function pushHist(k){
  if(!HIST_TABS.has(k))return;
  const sn=k==='all'?{all:1,n:K.clone(T.normal),p:K.clone(T.perfect),ms:manualSplit,sfx:{pools:K.clone(sfxPools),sel:{...sfxSel},locked:{...sfxLocked}}}:{all:0,k,n:K.clone(T.normal[k]),p:K.clone(T.perfect[k]),ms:manualSplit};
  const e={sn,thumb:thumb(k)};HIST[k].unshift(e);if(HIST[k].length>8)HIST[k].pop();HIST[k].on=0;
}
function showHist(){
  const wrap=$('histWrap5'),box=$('hist5'),H=HIST[U.sel]||[];box.innerHTML='';
  if(!HIST_TABS.has(U.sel)||!H.length){if(wrap)wrap.hidden=true;return;}
  if(wrap)wrap.hidden=false;
  H.forEach((e,i)=>{e.thumb.className=i===H.on?'on':'';e.thumb.title='换回这一次';e.thumb.onclick=()=>{
    if(e.sn.all){T.normal=K.clone(e.sn.n);T.perfect=K.clone(e.sn.p);}else{T.normal[e.sn.k]=K.clone(e.sn.n);T.perfect[e.sn.k]=K.clone(e.sn.p);}
    manualSplit=e.sn.ms;P=T[curTier];
    if(e.sn.all&&e.sn.sfx){const S=e.sn.sfx;for(const tk of ['normal','perfect']){sfxPools[tk]=K.clone(S.pools[tk]);sfxSel[tk]=S.sel[tk];sfxLocked[tk]=S.locked[tk];syncPrimaryFromPool(tk);if(!sfxPools[tk].length)T[tk].sfx.on=0;}
      const li=sfxPools[curTier],it=li.find(x=>x.id===sfxSel[curTier])||li[0];sfxWorkTier=curTier;
      Object.assign(sfxWork,it?{on:T[curTier].sfx.on,grade:it.grade,weight:it.weight,resonance:it.resonance}:T[curTier].sfx);}
    else if(e.sn.all&&!sfxLocked[curTier])Object.assign(sfxWork,P.sfx);
    H.on=i;showHist();refresh();restart();};box.appendChild(e.thumb);});}

function updateSplitBanner(){
  const el=$('splitHint5');if(!el)return;
  const show=manualSplit&&U.sel!=='sfx';
  el.hidden=!show;if(!show)return;
  el.textContent=`已切为独立手调：当前仅改「${curTier==='normal'?'普通格挡':'精防'}」（点 🎲 恢复双档联动）`;
}
function markManual(){manualSplit=true;updateSplitBanner();}

function restart(keepCycle){const cIdx=keepCycle?Math.max(0,Math.floor(simT/K.CYCLE)):0;simT=cIdx*K.CYCLE+K.T0-.35;lastAudioCycle=-1;A.stopAll();}
function randomSel(){const k=U.sel;A.unlock();RND[k](K.rng(newSeed()));pushHist(k);showHist();refresh();restart();if(k==='sfx')A.previewNow(sfxWork).then(en=>A.drawWave($('sfxWave5'),en));}
$('rand5').onclick=randomSel;
window.addEventListener('keydown',e=>{if(window.BTG_tab===5&&e.code==='Space'&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)){e.preventDefault();e.stopImmediatePropagation();randomSel();}},true);

// ---------- control builders ----------
const PN={},refreshers=[];function refresh(){P=T[curTier];refreshers.forEach(f=>f());uiMarks();updateSplitBanner();}
function panel(k){const p=document.createElement('div');p.className='pnl';p.hidden=true;$('panels5').appendChild(p);PN[k]=p;return p;}
function row(box,label,el,out){const d=document.createElement('div');d.className='qrow';const l=document.createElement('label');l.textContent=label;d.append(l,el);if(out)d.append(out);box.appendChild(d);return d;}
function qslider(box,label,o,k,mn,mx,st,cb,isGlobal){const i=document.createElement('input');i.type='range';i.min=mn;i.max=mx;i.step=st;const out=document.createElement('output');const dg=st>=1?0:st>=.1?1:st>=.01?2:3;
  i.oninput=()=>{o()[k]=+i.value;out.textContent=(+i.value).toFixed(dg);if(!isGlobal)markManual();cb&&cb(+i.value);refresh();};i.row=row(box,label,i,out);refreshers.push(()=>{i.value=o()[k];out.textContent=(+o()[k]).toFixed(dg);});return i;}
function qcolor(box,label,o,k){const i=document.createElement('input');i.type='color';i.oninput=()=>{o()[k]=i.value;markManual();};i.row=row(box,label,i,document.createElement('span'));refreshers.push(()=>i.value=o()[k]);return i;}
function qswitch(box,label,opts,o,k,cb,noManual){const sw=document.createElement('div');sw.className='sw';sw.style.gridColumn='2/4';
  opts.forEach(([v,t])=>{const b=document.createElement('button');b.textContent=t;b.dataset.v=String(v);b.onclick=()=>{o()[k]=v;if(!noManual)markManual();cb&&cb(v);refresh();};sw.appendChild(b);});
  row(box,label,sw);refreshers.push(()=>[...sw.children].forEach(b=>b.classList.toggle('on',b.dataset.v===String(o()[k]))));}
function qchips(box,label,list,get,set){const wrap=document.createElement('div'),cap=document.createElement('div');cap.className='cap';cap.textContent=label;const c=document.createElement('div');c.className='chips';
  list.forEach(([v,t])=>{const b=document.createElement('button');b.textContent=t;b.dataset.v=String(v);b.onclick=()=>{set(v);refresh();};c.appendChild(b);});
  refreshers.push(()=>[...c.children].forEach(b=>b.classList.toggle('on',b.dataset.v===String(get()))));wrap.append(cap,c);box.appendChild(wrap);return wrap;}
function qbuiltin(box,item,o,extraFn){const keys=Object.entries(window.PARRY_BUILTIN||{}).filter(([,v])=>v.item===item);if(!keys.length&&!extraFn)return;
  const cap=document.createElement('div');cap.className='cap';cap.textContent='贴图选择';const c=document.createElement('div');c.className='tiles';
  const stdBtns=[];
  const mk=(key,label,src)=>{const b=document.createElement('button');b.dataset.v=key;b.style.cssText='display:flex;align-items:center;gap:8px;justify-content:flex-start';
    if(src){const im=new Image();im.src=src;im.style.cssText='width:34px;height:34px;border-radius:8px;background:#000;flex:none';b.appendChild(im);}b.append(label);
    b.onclick=()=>{o().tex=key;if('customSrc' in o())o().customSrc='';o().on=1;markManual();pushHist(U.sel);showHist();refresh();restart();};c.appendChild(b);stdBtns.push(b);};
  mk('','程序生成',null);keys.forEach(([k,v])=>mk(k,v.label.replace('★ ',''),v.src));
  if(extraFn)extraFn(c);
  refreshers.push(()=>stdBtns.forEach(b=>b.classList.toggle('on',!o().customSrc&&b.dataset.v===(o().tex||''))));box.append(cap,c);return c;}
function details(box,title){const d=document.createElement('details');d.innerHTML=`<summary>${title}</summary>`;box.appendChild(d);return d;}
const onOff=[[1,'开'],[0,'关']];

// 1. 星芒 (star)
{const p=panel('star'),o=()=>P.star;qswitch(p,'星芒',onOff,o,'on');qcolor(p,'核心颜色',o,'core');qcolor(p,'边缘颜色',o,'edge');qslider(p,'大小 m',o,'size',.2,2.2,.01);qslider(p,'亮度 HDR',o,'hdr',2,40,.5);qslider(p,'寿命 s',o,'life',.05,.3,.005);
  const styW=qchips(p,'样式',[['any','🎲全部']].concat(STAR_STY),()=>P.star.style,v=>{if(v==='any'){U.stars='any';RND.star(K.rng(newSeed()));}else{U.stars=v;P.star.style=v;P.star.tex='';markManual();}pushHist('star');showHist();restart();});
  qbuiltin(p,'star',o);
  const d=details(p,'详细'),raysIn=qslider(d,'芒数',o,'rays',2,12,1),asymIn=qslider(d,'长短不齐',o,'asym',0,.95,.01);qslider(d,'对比度',o,'pow',.6,3,.05);
  refreshers.push(()=>{const hasT=!!P.star.tex;styW.hidden=hasT;raysIn.row.hidden=hasT;asymIn.row.hidden=hasT;});}
// 1b. 十字光 (needles)
{const p=panel('needles'),o=()=>P.needles;qswitch(p,'十字光',onOff,o,'on');qcolor(p,'颜色',o,'color');qslider(p,'长度 m',o,'len',.5,4.5,.05);qslider(p,'条数',o,'count',1,4,1);qslider(p,'亮度 HDR',o,'hdr',4,50,.5);qslider(p,'寿命 s',o,'life',.03,.25,.005);
  const d=details(p,'详细');qslider(d,'粗细',o,'width',.0008,.006,.0002);qslider(d,'偏转角 °',o,'spread',-90,90,1);}
// 2. 打光 (light)
{const p=panel('light'),o=()=>P.light;qswitch(p,'打光',onOff,o,'on');qcolor(p,'灯光颜色',o,'color');qslider(p,'照亮强度',o,'intensity',0,60,.5);qslider(p,'照射半径',o,'range',1,18,.25);
  qslider(p,'消散时长',o,'decay',.02,.35,.005);qslider(p,'空气柔光',o,'glow',0,1,.01);
  const d=details(p,'详细'),gsIn=qslider(d,'柔光尺寸',o,'glowSize',.4,2.5,.05);qslider(d,'朝镜头偏移',o,'offsetZ',.02,.80,.02);
  refreshers.push(()=>{gsIn.row.hidden=(P.light.glow??0)<=.005;});}
// 3. 光球 (flash)
{const p=panel('flash'),o=()=>P.flash;
  qswitch(p,'光球',onOff,o,'on');qcolor(p,'核心颜色',o,'core');qcolor(p,'边缘颜色',o,'color');
  qslider(p,'大小 m',o,'size',.25,3.2,.01);qslider(p,'不透明度',o,'opacity',0,1,.01);qslider(p,'边缘模糊',o,'blur',.02,.95,.01);qslider(p,'寿命 s',o,'life',.04,.45,.005);
  const styW=qchips(p,'样式',[['any','🎲全部']].concat(FLASH_STY),()=>P.flash.style||'sphere',v=>{
    if(v==='any'){U.flashes='any';RND.flash(K.rng(newSeed()));}
    else{U.flashes=v;P.flash.style=v;P.flash.tex='';P.flash.customSrc='';P.flash.on=1;markManual();}
    pushHist('flash');showHist();restart();});
  const fIn=document.createElement('input');fIn.type='file';fIn.accept='image/*';fIn.hidden=true;p.appendChild(fIn);
  let upTile=null;
  qbuiltin(p,'flash',o,tilesEl=>{
    upTile=document.createElement('button');upTile.dataset.v='__custom__';upTile.style.cssText='display:flex;align-items:center;gap:8px;justify-content:flex-start';
    upTile.onclick=()=>fIn.click();tilesEl.appendChild(upTile);
  });
  fIn.onchange=e=>{const f=e.target.files&&e.target.files[0];if(!f)return;const im=new Image(),u=URL.createObjectURL(f);
    im.onload=()=>{URL.revokeObjectURL(u);const N=256,cv=document.createElement('canvas');cv.width=cv.height=N;const cx=cv.getContext('2d');
      cx.fillStyle='#000';cx.fillRect(0,0,N,N);const s=Math.min(im.naturalWidth||N,im.naturalHeight||N);
      cx.drawImage(im,((im.naturalWidth||N)-s)/2,((im.naturalHeight||N)-s)/2,s,s,0,0,N,N);
      const id=cx.getImageData(0,0,N,N),dd=id.data;
      for(let y=0;y<N;y++)for(let x=0;x<N;x++){const i=(y*N+x)*4,px=(x+.5)/N*2-1,py=(y+.5)/N*2-1,rr=Math.hypot(px,py);
        const t=Math.max(0,Math.min(1,(.992-rr)/.04)),fd=t*t*(3-2*t);
        const lum=((.299*dd[i]+.587*dd[i+1]+.114*dd[i+2])*(dd[i+3]/255))*fd,g=Math.round(Math.max(0,Math.min(255,lum)));
        dd[i]=dd[i+1]=dd[i+2]=g;dd[i+3]=255;}
      cx.putImageData(id,0,0);P.flash.customSrc=cv.toDataURL('image/png');P.flash.tex='';P.flash.on=1;
      markManual();pushHist('flash');showHist();refresh();restart();fIn.value='';};
    im.src=u;};
  const d=details(p,'详细');qslider(d,'亮度 HDR',o,'hdr',.5,28,.5);qslider(d,'扩散幅度',o,'expand',0,1.4,.02);
  qslider(d,'中心镂空',o,'hollow',0,.85,.01);const ringsIn=qslider(d,'波纹层数',o,'rings',1,8,1);qslider(d,'旋转速度',o,'spin',-4,4,.1);
  refreshers.push(()=>{
    const hasC=!!P.flash.customSrc,baked=!!(P.flash.tex||hasC),st=P.flash.style||'sphere';
    if(upTile){upTile.classList.toggle('on',hasC);
      upTile.innerHTML=hasC?`<img src="${P.flash.customSrc}" style="width:34px;height:34px;border-radius:8px;background:#000;flex:none"><span>自定义贴图<small>点击更换</small></span>`:'<span>⬆ 上传贴图…<small>本地图片自动转圆</small></span>';}
    styW.hidden=baked;ringsIn.row.hidden=baked||(st!=='ripple'&&st!=='shatter');
  });}
// 4. 火星 (sparks)
{const p=panel('sparks'),o=()=>P.sparks;qswitch(p,'火星',onOff,o,'on');qcolor(p,'白热',o,'hot');qcolor(p,'金黄',o,'mid');qcolor(p,'冷却',o,'cool');qslider(p,'速度',o,'speed',.3,2.5,.05);qslider(p,'重力',o,'gravity',0,30,.5);
  qchips(p,'样式',[['any','🎲全部']].concat(SPARK_STY),()=>P.sparks.style,v=>{if(v==='any'){U.sparks='any';RND.sparks(K.rng(newSeed()));}else{U.sparks=v;P.sparks.style=v;markManual();}pushHist('sparks');showHist();restart();});
  const d=details(p,'详细');qslider(d,'爆散针',o,'burst',0,240,1);qslider(d,'抛物火花',o,'arc',0,360,1);qslider(d,'空气阻力',o,'drag',.3,3,.05);qslider(d,'弹地',o,'bounce',0,.8,.01);
  qslider(d,'寿命 ×',o,'life',.3,2,.05);qslider(d,'拉长',o,'streak',.3,3,.05);qslider(d,'粗细',o,'width',.4,3,.05);qslider(d,'喷射角 °',o,'cone',10,85,1);qslider(d,'亮度 HDR',o,'hdr',1,30,.5);}
// 4b. 铁水 (ember)
{const p=panel('ember'),o=()=>P.ember;qswitch(p,'铁水',onOff,o,'on');qcolor(p,'白热',o,'hot');qcolor(p,'金黄',o,'mid');qcolor(p,'冷却',o,'cool');
  qslider(p,'数量',o,'count',0,180,1);qslider(p,'速度',o,'speed',.3,2.5,.05);qslider(p,'颗粒大小',o,'size',.4,2.5,.05);qslider(p,'重力',o,'gravity',0,15,.2);
  const d=details(p,'详细');qslider(d,'空气阻力',o,'drag',.3,3,.05);qslider(d,'寿命 ×',o,'life',.3,2.5,.05);qslider(d,'喷射角 °',o,'cone',10,85,1);qslider(d,'亮度 HDR',o,'hdr',2,30,.5);qslider(d,'闪烁率',o,'flicker',0,.5,.02);}
// 5. 拖尾丝 (ribbon)
{const p=panel('ribbon'),o=()=>P.ribbon;qswitch(p,'拖尾丝',onOff,o,'on');qcolor(p,'颜色',o,'color');qslider(p,'条数',o,'count',1,24,1);qslider(p,'宽度 m',o,'width',.002,.03,.0005);qslider(p,'拖尾 s',o,'life',.08,.6,.01);
  qchips(p,'飞行模式',RIBBON_STY,()=>P.ribbon.style||'whip',v=>{P.ribbon.style=v;P.ribbon.on=1;markManual();pushHist('ribbon');showHist();restart();});
  const sBox=document.createElement('div');p.appendChild(sBox);
  qslider(sBox,'壳体尺寸',o,'sphereR',.15,.75,.01);
  qslider(sBox,'张开角度 °',o,'sphereCone',20,72,1);
  refreshers.push(()=>{sBox.hidden=(P.ribbon.style||'whip')!=='sphereScatter';});
  const d=details(p,'详细');qslider(d,'亮度 HDR',o,'hdr',2,34,.5);}
// 6. 暗烟 · 7. 碎屑 · 8. 热浪
{const p=panel('smoke'),o=()=>P.smoke;qswitch(p,'暗烟',onOff,o,'on');qcolor(p,'颜色',o,'color');qslider(p,'浓度',o,'opacity',0,1,.01);qslider(p,'大小',o,'size',.3,2.5,.05);qslider(p,'寿命 ×',o,'life',.3,2,.05);
  const styW=qchips(p,'样式',[['any','🎲全部']].concat(SMOKE_STY),()=>P.smoke.style,v=>{if(v==='any'){U.smokes='any';RND.smoke(K.rng(newSeed()));}else{U.smokes=v;P.smoke.style=v;P.smoke.tex='';markManual();}pushHist('smoke');showHist();restart();});
  qbuiltin(p,'smoke',o);refreshers.push(()=>{styW.hidden=!!P.smoke.tex;});
  const d=details(p,'详细');qslider(d,'团数',o,'count',1,24,1);qslider(d,'暗火星',o,'dark',0,80,1);qslider(d,'上升 m/s',o,'rise',0,.3,.01);}
{const p=panel('debris'),o=()=>P.debris;qswitch(p,'碎屑',onOff,o,'on');qslider(p,'数量',o,'count',0,100,1);qslider(p,'大小',o,'size',.3,3,.05);qslider(p,'速度',o,'speed',.3,2.5,.05);}
{const p=panel('refr'),o=()=>P.refr;qswitch(p,'热浪',onOff,o,'on');qslider(p,'强度 px',o,'amt',0,60,1);qslider(p,'半径 m',o,'radius',.3,2.5,.01);qslider(p,'寿命 s',o,'life',.08,.6,.01);qslider(p,'波纹圈数',o,'waves',1,6,1);
  qswitch(p,'作用范围',[['frame','整个画面'],['behind','只背景']],o,'scope');
  const styW=qchips(p,'样式',[['any','🎲全部']].concat(REFR_STY),()=>P.refr.style,v=>{if(v==='any'){U.refrs='any';RND.refr(K.rng(newSeed()));}else{U.refrs=v;P.refr.style=v;P.refr.tex='';markManual();}pushHist('refr');showHist();restart();});
  qbuiltin(p,'refr',o);refreshers.push(()=>{styW.hidden=!!P.refr.tex;});}

// 9. 音效 (sfx — ① 选择音色 [按轻→重排列 20条] → ② 普/精两种预设 → ③ 手动调整滑杆 → 试听 & 存入音效池)
{const p=panel('sfx'),o=()=>sfxWork;
  const syncOnState=()=>{const tw=sfxWorkTier;T.normal.sfx.on=T.perfect.sfx.on=sfxWork.on?1:0;for(const tk of ['normal','perfect'])if(!sfxPools[tk].length)T[tk].sfx.on=0;
    if(!sfxLocked[tw]&&sfxPools[tw].length===1){Object.assign(sfxPools[tw][0],{grade:sfxWork.grade,weight:sfxWork.weight,resonance:sfxWork.resonance});syncPrimaryFromPool(tw);}};
  qswitch(p,'音效',onOff,o,'on',()=>syncOnState(),true);
  let debT=null,savedFlash='',savedTimer=null;
  const trigPreview=()=>{clearTimeout(debT);debT=setTimeout(()=>{A.previewNow(sfxWork).then(en=>A.drawWave(wv,en));},75);};
  const bankArr=Array.isArray(window.PARRY_SFX_BANK)?window.PARRY_SFX_BANK:[];
  const allGradeBtns=[];
  {
    const wrap=document.createElement('div');wrap.className='sfx-group';
    const cap=document.createElement('div');cap.className='cap';cap.textContent=`① 选择音色（按轻 → 重排列，共 ${bankArr.length} 条）`;wrap.appendChild(cap);
    const box=document.createElement('div');box.className='sfx-grades';
    bankArr.forEach((item,idx)=>{
      const b=document.createElement('button');
      const hz=item.centroidHz?(item.centroidHz>=1000?(item.centroidHz/1000).toFixed(1)+'k':item.centroidHz+'Hz'):'';
      b.dataset.id=String(item.id);
      b.textContent=`#${idx+1}${hz?'·'+hz:''}`;
      b.title=`${item.name||('#'+item.id)} · ${item.desc||''}`;
      b.onclick=()=>{
        sfxWork.grade=+item.id;sfxWork.on=1;
        syncOnState();refresh();trigPreview();
      };
      box.appendChild(b);allGradeBtns.push(b);
    });
    wrap.appendChild(box);p.appendChild(wrap);
  }
  const preWrap=document.createElement('div');preWrap.className='sfx-group';
  const preCap=document.createElement('div');preCap.className='cap';preCap.textContent='② 预设方案';preWrap.appendChild(preCap);
  const preBox=document.createElement('div');preBox.className='sfx-presets';
  const mkPreBtn=(lbl,wVal,rVal,tip)=>{
    const b=document.createElement('button');b.textContent=lbl;b.title=tip;
    b.onclick=()=>{sfxWork.on=1;sfxWork.weight=wVal;sfxWork.resonance=rVal;syncOnState();refresh();trigPreview();};
    preBox.appendChild(b);return b;
  };
  const preNorm=mkPreBtn('普通',.34,.22,'切到普通格挡预设 (打击轻重 0.34 / 洪亮共鸣 0.22)');
  const prePerf=mkPreBtn('精防',.68,.62,'切到精防预设 (打击轻重 0.68 / 洪亮共鸣 0.62)');
  preWrap.appendChild(preBox);p.appendChild(preWrap);

  const manWrap=document.createElement('div');manWrap.className='sfx-group';
  const manCap=document.createElement('div');manCap.className='cap';manCap.textContent='③ 手动调整';manWrap.appendChild(manCap);
  qslider(manWrap,'打击轻重',o,'weight',0,1,.01,()=>{syncOnState();trigPreview();},true);
  qslider(manWrap,'洪亮共鸣',o,'resonance',0,1,.01,()=>{syncOnState();trigPreview();},true);
  p.appendChild(manWrap);
  const wv=document.createElement('canvas');wv.className='sfx-wave';wv.id='sfxWave5';wv.title='点击试听当前参数';
  wv.onclick=()=>{A.setMuted(false);uiMarks();A.previewNow(sfxWork).then(en=>A.drawWave(wv,en));};
  p.appendChild(wv);

  const sv=document.createElement('div');sv.className='sfx-saves';
  const btnNorm=document.createElement('button'),btnPerf=document.createElement('button');
  btnNorm.id='saveSfxNorm5';btnPerf.id='saveSfxPerf5';btnPerf.className='primary';
  sv.append(btnNorm,btnPerf);p.appendChild(sv);

  const poolsWrap=document.createElement('div');poolsWrap.className='sfx-pools';poolsWrap.id='sfxPools5';
  const mkPoolCol=(tk,title)=>{
    const col=document.createElement('div');col.className='sfx-pool';col.dataset.pool=tk;
    const hd=document.createElement('div');hd.className='sfx-pool-hd';
    const ttl=document.createElement('span');
    const clr=document.createElement('button');clr.textContent='清空';clr.title='清空此列表';
    clr.onclick=()=>{sfxPools[tk]=[];sfxSel[tk]=0;sfxLocked[tk]=true;T[tk].sfx.on=0;A.stopAll();refresh();};   // empty pool = tier silent, no WAV exported
    hd.append(ttl,clr);
    const listEl=document.createElement('div');listEl.className='sfx-pool-list';
    col.append(hd,listEl);poolsWrap.appendChild(col);
    return {col,ttl,clr,listEl};
  };
  const colNorm=mkPoolCol('normal','普通池'),colPerf=mkPoolCol('perfect','完美池');
  p.appendChild(poolsWrap);

  const addToPool=tk=>{
    sfxWork.on=1;T.normal.sfx.on=T.perfect.sfx.on=1;
    if(!sfxLocked[tk]&&sfxPools[tk].length===1&&savedFlash===''&&!sfxPools[tk][0]._userSaved){
      // First explicit save replaces the initial placeholder cleanly so user doesn't get an unwanted default leftover;
      // wait — if user wants to ADD multiple, let's check: only replace if identical, otherwise APPEND!
    }
    const entry=mkPoolEntry(sfxWork);entry._userSaved=true;
    // If initial default was untouched (!sfxLocked[tk]), keep it ONLY if different? No: user expects clicking "存入" N times to yield N saved items if they saved N times, OR if initial default was auto-seeded before first save:
    if(!sfxLocked[tk]){sfxPools[tk]=[entry];sfxLocked[tk]=true;}
    else sfxPools[tk].push(entry);
    sfxSel[tk]=entry.id;T[tk].sfx.on=1;
    syncPrimaryFromPool(tk);
    savedFlash=tk;clearTimeout(savedTimer);savedTimer=setTimeout(()=>{savedFlash='';renderPools();},1200);
    refresh();
  };
  btnNorm.onclick=()=>addToPool('normal');
  btnPerf.onclick=()=>addToPool('perfect');

  function renderPoolCol(tk,ui,label){
    const arr=sfxPools[tk];
    ui.ttl.textContent=`${label} (${arr.length}) · 随机播`;
    ui.clr.hidden=arr.length<2;
    ui.listEl.innerHTML='';
    if(!arr.length){
      const em=document.createElement('div');em.className='sfx-pool-empty';em.textContent='空 = 此档无音效、不导出（点上方按钮添加）';
      ui.listEl.appendChild(em);return;
    }
    arr.forEach((it,idx)=>{
      const rowEl=document.createElement('div');
      rowEl.className='sfx-chip'+(sfxSel[tk]===it.id?' on':'');
      const pick=document.createElement('button');pick.className='pick';
      pick.textContent=`${idx+1}. #${it.grade} 轻${(+it.weight).toFixed(2)} 共${(+it.resonance).toFixed(2)}`;
      pick.title='点击试听并回填到滑杆';
      pick.onclick=()=>{
        sfxSel[tk]=it.id;sfxWorkTier=tk;
        Object.assign(sfxWork,{on:1,grade:it.grade,weight:it.weight,resonance:it.resonance});
        syncPrimaryFromPool(tk);
        A.setMuted(false);refresh();
        A.previewNow(sfxWork).then(en=>A.drawWave(wv,en));
      };
      const upd=document.createElement('button');upd.className='act';upd.textContent='↺';upd.title='用当前滑杆覆盖此条';
      upd.onclick=()=>{
        Object.assign(it,{grade:sfxWork.grade,weight:+sfxWork.weight.toFixed(3),resonance:+sfxWork.resonance.toFixed(3),_userSaved:true});
        sfxLocked[tk]=true;sfxSel[tk]=it.id;syncPrimaryFromPool(tk);refresh();
      };
      const del=document.createElement('button');del.className='act';del.textContent='×';del.title='删除此条';
      del.onclick=()=>{
        sfxPools[tk]=arr.filter(x=>x.id!==it.id);
        sfxLocked[tk]=true;
        if(sfxSel[tk]===it.id)sfxSel[tk]=sfxPools[tk][0]?sfxPools[tk][0].id:0;
        if(!sfxPools[tk].length){T[tk].sfx.on=0;A.stopAll();}
        syncPrimaryFromPool(tk);refresh();
      };
      rowEl.append(pick,upd,del);
      ui.listEl.appendChild(rowEl);
    });
  }
  function renderPools(){
    btnNorm.innerHTML=`+ 存入普通音效<small>${savedFlash==='normal'?'✓ 已加入普通池 · ':''}共 ${sfxPools.normal.length} 条随机</small>`;
    btnPerf.innerHTML=`+ 存入完美音效<small>${savedFlash==='perfect'?'✓ 已加入完美池 · ':''}共 ${sfxPools.perfect.length} 条随机</small>`;
    renderPoolCol('normal',colNorm,'普通音效');
    renderPoolCol('perfect',colPerf,'完美音效');
  }
  refreshers.push(()=>{
    const g=sfxWork.grade||3;
    allGradeBtns.forEach(b=>{b.classList.toggle('on',+b.dataset.id===g);});
    preNorm.classList.toggle('on',Math.abs((+sfxWork.weight||0)-.34)<.02&&Math.abs((+sfxWork.resonance||0)-.22)<.02);
    prePerf.classList.toggle('on',Math.abs((+sfxWork.weight||0)-.68)<.02&&Math.abs((+sfxWork.resonance||0)-.62)<.02);
    renderPools();
    if(!PN.sfx.hidden)A.renderSfx(sfxWork).then(en=>A.drawWave(wv,en));
  });
}

// 10. 全部 (all)
{const p=panel('all');
  qchips(p,'配色',SCHEME_NAMES,()=>P.scheme,v=>{applySchemeTo(P,v);markManual();});
  const c1=document.createElement('div');c1.className='sh';c1.textContent='交锋';p.appendChild(c1);
  qchips(p,'格挡架势',[['cross','交叉架刀'],['lunge','突刺迎击']],()=>P.clash.pose||'cross',v=>{T.normal.clash.pose=T.perfect.clash.pose=v;K.applyPose(v);restart();});
  qslider(p,'播放速度',()=>P.clash,'speed',.05,1,.05,v=>{T.normal.clash.speed=T.perfect.clash.speed=v;},true);
  const c2=document.createElement('div');c2.className='sh';c2.textContent='武器';p.appendChild(c2);
  const wt=document.createElement('div');wt.className='tiles';const mkW=(t,s,f)=>{const b=document.createElement('button');b.innerHTML=`${t}<small>${s}</small>`;b.onclick=f;wt.appendChild(b);return b;};
  const wi=document.createElement('p');wi.className='note';wi.id='wInfo5';wi.hidden=true;
  const wb=[mkW('默认双刀','守方打刀 + 攻方太刀',()=>{K.useDefaultWeapon();markW(0);wi.hidden=true;}),mkW('加载 glb…','或直接拖进画面',()=>$('wFile5').click())];
  const markW=i=>wb.forEach((b,j)=>b.classList.toggle('on',i===j));markW(0);p.append(wt,wi);
  async function loadW(url,name,i){try{await K.loadWeapon(url);markW(i);wi.textContent=`守方武器：${name}`;wi.hidden=false;}catch(e){wi.textContent='加载失败：'+e.message;wi.hidden=false;}finally{if(url.startsWith('blob:'))URL.revokeObjectURL(url);}}
  $('wFile5').onchange=e=>{const f=e.target.files[0];if(f)loadW(URL.createObjectURL(f),f.name,1);};
  const st=$('stage5');st.addEventListener('dragover',e=>{e.preventDefault();$('drop5').classList.add('on');});st.addEventListener('dragleave',()=>$('drop5').classList.remove('on'));
  st.addEventListener('drop',e=>{e.preventDefault();$('drop5').classList.remove('on');const f=e.dataTransfer.files[0];if(f&&/\.gl(b|tf)$/i.test(f.name))loadW(URL.createObjectURL(f),f.name,1);});
  const d=details(p,'画面与震感');
  qslider(d,'顿帧 s',()=>P.clash,'hitstop',0,.2,.005);qslider(d,'刀身震颤',()=>P.clash,'tremor',0,3,.05);qslider(d,'震屏',()=>P.clash,'shake',0,3,.05);
  const V={bloom:.85,exp:1};qslider(d,'泛光',()=>V,'bloom',0,2.5,.05,()=>K.bloom.strength=V.bloom,true);qslider(d,'曝光',()=>V,'exp',.4,2,.05,()=>K.renderer.toneMappingExposure=V.exp,true);}

// ---------- item picker, 2-tier switcher, audio toggle, play controls ----------
ITEMS.forEach(([k,t])=>{const b=document.createElement('button');b.dataset.k=k;b.innerHTML=`${t}<i></i>`;b.onclick=()=>selectItem(k);$('items5').appendChild(b);});
function uiMarks(){
  for(const b of $('items5').children){const k=b.dataset.k,i=b.querySelector('i');b.classList.toggle('on',k===U.sel);i.hidden=k==='all';i.classList.toggle('lit',k!=='all'&&!!(P[k]&&P[k].on));}
  for(const b of $('tier5').children)b.classList.toggle('on',b.dataset.t===curTier);
  if($('bgsw5'))for(const b of $('bgsw5').children)b.classList.toggle('on',b.dataset.bg===K.stageTheme);
  if($('mute5')){$('mute5').classList.toggle('on',!A.muted);$('mute5').textContent=A.muted?'🔇 静音':'🔊 声音';}
  $('slow5').classList.toggle('on',P.clash.speed<1);$('play5').textContent=paused?'▶':'⏸';
}
function selectItem(k){U.sel=k;for(const q in PN)PN[q].hidden=q!==k;$('rand5').textContent='🎲 随机 · '+ITEMS.find(x=>x[0]===k)[1];showHist();refresh();}
function setTierView(k){
  curTier=k==='perfect'?'perfect':'normal';P=T[curTier];P.tier=curTier;
  const list=sfxPools[curTier],selIt=list.find(x=>x.id===sfxSel[curTier])||list[0];sfxWorkTier=curTier;
  if(selIt)Object.assign(sfxWork,{on:P.sfx.on,grade:selIt.grade,weight:selIt.weight,resonance:selIt.resonance});
  else Object.assign(sfxWork,P.sfx);
  refresh();restart(true);
}
TIER_NAMES.forEach(([k,t])=>{const b=document.createElement('button');b.dataset.t=k;b.textContent=t;b.onclick=()=>{A.unlock();setTierView(k);};$('tier5').appendChild(b);});
if($('bgsw5'))[...$('bgsw5').children].forEach(b=>b.onclick=()=>{K.setStageTheme({stageTheme:b.dataset.bg});uiMarks();});
if($('mute5'))$('mute5').onclick=()=>{A.setMuted(!A.muted);uiMarks();};
$('slow5').onclick=()=>{const sp=P.clash.speed<1?1:.3;T.normal.clash.speed=T.perfect.clash.speed=sp;refresh();};
$('play5').onclick=()=>{paused=!paused;if(paused)A.stopAll();else lastAudioCycle=-1;uiMarks();};

// ---------- export: dual-tier recipe.json + linear textures + multi-SFX pool WAVs + preview.png ----------
function greyPNG(a,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d'),im=x.createImageData(w,h);
  for(let i=0;i<w*h;i++){const g=Math.round(Math.min(1,Math.max(0,a[i]))*255);im.data[i*4]=im.data[i*4+1]=im.data[i*4+2]=g;im.data[i*4+3]=255;}
  x.putImageData(im,0,0);return new Promise(r=>c.toBlob(b=>r(B.blobBytes(b)),'image/png'));}
function dataURLBytes(u){const b=atob(u.split(',')[1]),o=new Uint8Array(b.length);for(let i=0;i<b.length;i++)o[i]=b.charCodeAt(i);return o;}
async function exportTierPool(tk){
  if(!sfxPools[tk].length||!T[tk].sfx.on)return {wavFiles:[],meta:{playMode:'random',disabled:true,pool:[]}};
  const sel=sfxPools[tk].find(x=>x.id===sfxSel[tk]);   // selected variant first: it is the tier's root file/grade/label
  const srcList=sel?[sel,...sfxPools[tk].filter(x=>x!==sel)]:sfxPools[tk];
  const rendered=await Promise.all(srcList.map(cfg=>A.exportWav(cfg)));
  const poolMeta=[],wavFiles=[];
  rendered.forEach((w,idx)=>{
    const rel=idx===0?`audio/parry_${tk}.wav`:`audio/parry_${tk}_${idx+1}.wav`;
    wavFiles.push({name:rel,data:w.wavBytes});
    poolMeta.push({
      file:rel,
      grade:w.grade,
      label:w.label,
      weight:+w.weight.toFixed(3),
      resonance:+w.resonance.toFixed(3),
      peakOffsetS:w.peakOffsetS,
      durationS:w.durationS,
      sampleRate:w.sampleRate
    });
  });
  const first=poolMeta[0];
  return {
    wavFiles,
    meta:{
      playMode:'random',
      file:first.file,
      peakOffsetS:first.peakOffsetS,
      durationS:first.durationS,
      sampleRate:first.sampleRate,
      grade:first.grade,
      label:first.label,
      weight:first.weight,
      resonance:first.resonance,
      pool:poolMeta
    }
  };
}
let exporting=false;
$('bundle5').onclick=async()=>{
  if(exporting)return;exporting=true;const btn=$('bundle5');btn.disabled=true;
  try{await exportBundle();}catch(e){console.error(e);alert('导出失败：'+e.message);}finally{exporting=false;btn.disabled=false;}
};
async function exportBundle(){
  const BI=window.PARRY_BUILTIN||{},enc=new TextEncoder(),files=[];
  syncPrimaryFromPool('normal');syncPrimaryFromPool('perfect');
  const [packNorm,packPerf]=await Promise.all([exportTierPool('normal'),exportTierPool('perfect')]);
  const starKeyOf=q=>[q.star.tex||'',q.star.style,q.star.seed,q.star.rays,q.star.asym].join('|');
  const sameStar=starKeyOf(T.normal)===starKeyOf(T.perfect);
  const starTexMap={normal:sameStar?'textures/star.png':'textures/star_normal.png',perfect:'textures/star.png'};
  const flashKeyOf=q=>[q.flash.customSrc||'',q.flash.tex||'',q.flash.style||'sphere',q.flash.seed??17,q.flash.rings??3].join('|');
  const sameFlash=flashKeyOf(T.normal)===flashKeyOf(T.perfect);
  const flashTexMap={normal:sameFlash?'textures/flash.png':'textures/flash_normal.png',perfect:'textures/flash.png'};
  const smKeyOf=q=>q.smoke.tex?'b:'+q.smoke.tex:'n:'+q.smoke.seed;
  const smRef=T.perfect.smoke.on?T.perfect:P,sameSmoke=!T.normal.smoke.on||smKeyOf(T.normal)===smKeyOf(smRef);
  const smokeTexMap={normal:sameSmoke?'textures/smoke.png':'textures/smoke_normal.png',perfect:'textures/smoke.png'};
  const rfP=T.perfect.refr.tex||T.normal.refr.tex,rfN=T.normal.refr.tex,sameRefr=!rfN||rfN===rfP;
  const refrTexMap={normal:sameRefr?'textures/refraction.png':'textures/refraction_normal.png',perfect:'textures/refraction.png'};
  const r=K.recipe(P,{T,manualSplit,sfx:{normal:packNorm.meta,perfect:packPerf.meta},starTex:starTexMap,flashTex:flashTexMap,smokeTex:smokeTexMap,refrTex:refrTexMap});
  r.preview={timeAfterClashS:.06};
  files.push({name:'recipe.json',data:enc.encode(JSON.stringify(r,null,1))});

  const texPerf=K.exportTextures(T.perfect),texNormAll=K.exportTextures(T.normal),texAct=K.exportTextures(P);
  const flashBytesOf=async(tierP,texObj)=>tierP.flash.customSrc?dataURLBytes(tierP.flash.customSrc):(tierP.flash.tex&&BI[tierP.flash.tex]?dataURLBytes(BI[tierP.flash.tex].src):await greyPNG(texObj.flash.a,256,256));
  files.push({name:'textures/star.png',data:T.perfect.star.tex&&BI[T.perfect.star.tex]?dataURLBytes(BI[T.perfect.star.tex].src):await greyPNG(texPerf.star.a,256,256)});
  if(!sameStar){
    files.push({name:'textures/star_normal.png',data:T.normal.star.tex&&BI[T.normal.star.tex]?dataURLBytes(BI[T.normal.star.tex].src):await greyPNG(texNormAll.star.a,256,256)});
  }
  files.push({name:'textures/spark.png',data:await greyPNG(texAct.spark.a,texAct.spark.w,texAct.spark.h)});
  files.push({name:'textures/flash.png',data:await flashBytesOf(T.perfect,texPerf)});
  if(!sameFlash){
    files.push({name:'textures/flash_normal.png',data:await flashBytesOf(T.normal,texNormAll)});
  }
  const smokeBytes=async q=>q.smoke.tex&&BI[q.smoke.tex]?dataURLBytes(BI[q.smoke.tex].src):await greyPNG(K.exportTextures(q).smoke.a,128,128);
  files.push({name:'textures/smoke.png',data:await smokeBytes(smRef)});
  if(!sameSmoke)files.push({name:'textures/smoke_normal.png',data:await smokeBytes(T.normal)});
  if(rfP&&BI[rfP])files.push({name:'textures/refraction.png',data:dataURLBytes(BI[rfP].src)});
  if(!sameRefr&&BI[rfN])files.push({name:'textures/refraction_normal.png',data:dataURLBytes(BI[rfN].src)});

  for(const wf of packNorm.wavFiles)files.push(wf);
  for(const wf of packPerf.wavFiles)files.push(wf);

  K.renderAt(P,K.T0+.06,0,{noShake:true});
  const prev=await new Promise(res=>K.renderer.domElement.toBlob(b=>res(B.blobBytes(b)),'image/png'));
  files.push({name:'preview.png',data:prev});
  files.push({name:'README.txt',data:enc.encode('XSXB-Slash 格挡 (parry) export\n\nrecipe.json                 dual-tier (tiers.normal + tiers.perfect) parameters + random sfx.pool metadata\ntextures/*.png              linear grey masks (turn sRGB OFF on import)\naudio/parry_normal*.wav     48 kHz 16-bit stereo WAV pool for 普通格挡 (randomly picked in game; sync peak via variant.peakOffsetS)\naudio/parry_perfect*.wav    48 kHz 16-bit stereo WAV pool for 精防 (randomly picked in game; sync peak via variant.peakOffsetS)\npreview.png                 web preview 0.06 s after contact\n\nInstall into Godot 4 / Unity / Unreal Engine 5: see docs/SPEC_PARRY.md, engines/<engine>/, or skill/xsxb-slash-install/SKILL.md.\n')});
  const a=document.createElement('a'),url=URL.createObjectURL(B.zipStore(files));a.href=url;a.download=`XSXB-Parry_${curTier}_${P.seed}.zip`;
  window.BTG_parryLastExport=files;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  return files;
}

function resetSfxPools(){
  sfxLocked.normal=sfxLocked.perfect=false;
  sfxPools.normal=[mkPoolEntry(T.normal.sfx)];sfxSel.normal=sfxPools.normal[0].id;
  sfxPools.perfect=[mkPoolEntry(T.perfect.sfx)];sfxSel.perfect=sfxPools.perfect[0].id;
  Object.assign(sfxWork,T[curTier].sfx);
  refresh();
}
window.BTG_parry={
  get P(){return P;},set P(v){T[curTier]=v;P=v;refresh();},
  get T(){return T;},get curTier(){return curTier;},get manualSplit(){return manualSplit;},
  sfxWork,sfxPools,sfxLocked,resetSfxPools,setTierView,RND,TIERS,applyScheme:v=>applySchemeTo(P,v),refresh,HIST
};
function uiInit(){ensureInit();setTierView('normal');selectItem('star');requestAnimationFrame(loop);}
if(window.BTG_tab===5)uiInit();else{const once=e=>{if(e.detail===5){window.removeEventListener('btg-tab',once);uiInit();}};window.addEventListener('btg-tab',once);}
if(Q.get('tab')==='5'||Q.get('mode')==='parry')document.querySelector('.tabs button[data-tab="5"]').click();
}
})();
