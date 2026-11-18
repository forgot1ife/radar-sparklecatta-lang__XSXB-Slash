// XSXB-Slash · 格挡 (parry) core: scene, two clashing blades, deterministic VFX simulation + rendering.
// Clean-room: every texture here is generated from seeded formulas (or the AI-made built-ins in parry_builtin.js).
// Layer priority (what makes a parry read as a parry): 星芒 star + 闪光 cross needles + 火星 sparks first,
// then 拖尾丝 leader ribbons, 暗烟 dark smoke / 碎屑 iron shards, 热浪 screen-space refraction.
(()=>{
'use strict';
const boot=()=>{if(!window.BTG_THREE){window.addEventListener('btg-three',boot,{once:true});return;}window.PARRY_CORE=makeCore(window.BTG_THREE);window.dispatchEvent(new Event('parry-core'));};
boot();

function makeCore(B){
const {THREE,OrbitControls,EffectComposer,RenderPass,UnrealBloomPass,OutputPass,ShaderPass}=B;
const V3=(x,y,z)=>new THREE.Vector3(x,y,z);

// ---------------- seeded maths ----------------
const rng=s=>{let a=(s>>>0)||1;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};};
const hash=(...v)=>{let h=2166136261>>>0;for(const x of v){h=Math.imul(h^((x|0)+0x9e3779b9),2246822507);h=Math.imul(h^h>>>13,3266489909);h^=h>>>16;}return h>>>0;};
const lerp=(a,b,k)=>a+(b-a)*k,clamp=(x,a,b)=>x<a?a:x>b?b:x,sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const R2=(r,ab)=>ab[0]+(ab[1]-ab[0])*r();

// ---------------- default recipe ----------------
const DEF={
  seed:1,tier:'normal',scheme:'gold',
  clash:{pose:'cross',hitstop:.07,tremor:1,shake:1,speed:1},
  star:{on:1,style:'cross4',seed:11,tex:'',core:'#ffffff',edge:'#ffb25c',size:.95,hdr:24,life:.12,rays:6,asym:.6,pow:2.2},
  needles:{on:1,color:'#ffc266',len:2.45,count:2,width:.0022,spread:22,hdr:28,life:.075,seed:15},
  light:{on:1,color:'#ffb060',intensity:16,range:6.5,decay:.085,glow:.38,glowSize:1.0,offsetZ:.18},
  flash:{on:0,style:'sphere',seed:17,tex:'',customSrc:'',core:'#fff9eb',color:'#ffb85c',size:1.05,opacity:.68,blur:.28,hdr:9.5,life:.14,expand:.55,hollow:0,rings:3,spin:0},
  sparks:{on:1,style:'fan',seed:21,hot:'#fff3dc',mid:'#ffb347',cool:'#d63a17',burst:70,arc:130,speed:1.35,gravity:12,drag:1,bounce:.45,life:1,streak:1,width:1,cone:40,hdr:11},
  ember:{on:1,hot:'#fff3dc',mid:'#ffb347',cool:'#d63a17',count:68,speed:1.15,gravity:3.6,drag:1,life:1,size:1,cone:58,hdr:12,flicker:.18,seed:25},
  ribbon:{on:0,style:'whip',count:12,width:.007,life:.24,hdr:12,color:'#ffbe6e',sphereR:.34,sphereCone:48},
  smoke:{on:0,style:'ink',seed:31,tex:'',color:'#050507',opacity:.8,size:1,life:1,count:11,dark:34,rise:0},
  debris:{on:0,seed:41,count:22,size:1,speed:1.25},
  refr:{on:0,style:'ripple',tex:'',amt:30,radius:1.4,life:.32,waves:3,scope:'frame'},   // scope 'frame' = warps the final image (blade + all FX + bg); 'behind' = legacy, bg only
  sfx:{on:1,grade:3,weight:.32,resonance:.24},
};
const clone=o=>JSON.parse(JSON.stringify(o));

// ---------------- clash geometry (world, metres; floor y = 0) ----------------
// Left Fighter = Defender (W.A, bright silver katana), Right Fighter = Attacker (W.B, dark gunmetal tachi/katana).
// Default 'cross': both hilts held low at chest/waist (y ~ 0.90 m), crossing at the forte (dA=0.25, dB=0.26) so ~0.76 m of curved steel soars upward in a dramatic ✕.
const C=V3(0,1.1,0),UP=V3(0,1,0),TOCAM=V3(.18,.10,1).normalize();
const ortho=(v,d)=>v.clone().addScaledVector(d,-v.dot(d)).normalize();
const POSES={
  cross:{dirA:V3(.55,.82,-.15),dA:.25,eA:V3(.80,-.55,-.22),dirB:V3(-.57,.81,.14),dB:.26,eB:V3(-.80,-.55,.22),hang:false},
  lunge:{dirA:V3(.39,.91,-.15),dA:.25,eA:V3(.88,-.38,-.22),dirB:V3(-.69,.71,.14),dB:.27,eB:V3(-.70,-.69,.20),hang:false},
};
const F={C,pose:'',dirA:V3(1,0,0),dirB:V3(-1,0,0),dA:.25,dB:.26,hiltA:V3(),hiltB:V3(),edgeA:V3(0,1,0),edgeB:V3(0,-1,0),S1:V3(),S2:V3(),bis1:V3(),bis2:V3(),hang:false};
let QA=new THREE.Quaternion(),QB=new THREE.Quaternion();
const _mb=new THREE.Matrix4();
function basisQ(d,e){const z=new THREE.Vector3().crossVectors(d,e).normalize();_mb.makeBasis(d,e,z);return new THREE.Quaternion().setFromRotationMatrix(_mb);}
function applyPose(name){const k=POSES[name]?name:'cross';if(F.pose===k)return;const S=POSES[k];F.pose=k;F.hang=S.hang;
  F.dirA.copy(S.dirA).normalize();F.dirB.copy(S.dirB).normalize();F.dA=S.dA;F.dB=S.dB;
  F.hiltA.copy(C).addScaledVector(F.dirA,-F.dA);F.hiltB.copy(C).addScaledVector(F.dirB,-F.dB);
  F.edgeA.copy(ortho(S.eA,F.dirA));F.edgeB.copy(ortho(S.eB,F.dirB));
  if(S.hang){F.S1.copy(F.dirB).multiplyScalar(.55).addScaledVector(UP,.55).addScaledVector(TOCAM,.22).normalize();
    F.S2.copy(F.dirA).multiplyScalar(.75).addScaledVector(UP,.32).addScaledVector(TOCAM,.28).normalize();}
  else{F.S1.copy(F.dirA).multiplyScalar(.72).addScaledVector(UP,.38).addScaledVector(TOCAM,.22).normalize();
    F.S2.copy(F.dirB).multiplyScalar(.58).addScaledVector(F.dirA,-.45).addScaledVector(UP,.28).addScaledVector(TOCAM,.26).normalize();}
  F.bis1.copy(F.dirA).add(F.dirB).normalize();if(F.bis1.lengthSq()<.1)F.bis1.set(0,1,0);
  F.bis2.copy(F.dirA).sub(F.dirB).normalize();
  QA=basisQ(F.dirA,F.edgeA);QB=basisQ(F.dirB,F.edgeB);}
applyPose('cross');
const CYCLE=1.9,T0=.42;

// ---------------- procedural textures (seeded formulas) ----------------
function dataTex(arr,N,wrap){const d=new Uint8Array(N*N*4);for(let i=0;i<N*N;i++){const g=Math.round(clamp(arr[i],0,1)*255);d[i*4]=d[i*4+1]=d[i*4+2]=g;d[i*4+3]=255;}
  const t=new THREE.DataTexture(d,N,N,THREE.RGBAFormat);t.wrapS=t.wrapT=wrap?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
// 星芒: pinpoint core + asymmetric razor rays.  style: cross4 | six | shard | lance | burst
function genStar(style,seed,rays,asym,N=256){
  const r=rng(hash(seed,7)),R=[],rot=r()*Math.PI;const ray=(a,len,w)=>R.push({c:Math.cos(a),s:Math.sin(a),len,w});
  const L=k=>clamp(1-asym*Math.pow(r(),k),.18,1);
  if(style==='cross4'){const h=.97,v=lerp(.55,.85,r());ray(rot,h*L(3),.016);ray(rot+Math.PI,h*L(3),.016);ray(rot+Math.PI/2,v,.013);ray(rot-Math.PI/2,v*L(2),.013);
    for(let i=0;i<Math.max(0,rays-4);i++)ray(rot+Math.PI/4+i*Math.PI/2+(r()-.5)*.3,lerp(.18,.42,r()),.008);}
  else if(style==='six'){for(let i=0;i<6;i++)ray(rot+i*Math.PI/3+(r()-.5)*.12,lerp(.45,.95,r())*L(1.5),.015);for(let i=0;i<Math.max(0,rays-6);i++)ray(r()*6.283,lerp(.15,.35,r()),.007);}
  else if(style==='lance'){ray(rot,.98,.014);ray(rot+Math.PI,.9*L(2),.014);for(let i=0;i<Math.max(2,rays-2);i++)ray(r()*6.283,lerp(.14,.4,r()),.008);}
  else if(style==='burst'){const n=Math.max(16,rays*4);for(let i=0;i<n;i++)ray(i/n*6.283+(r()-.5)*.2,lerp(.25,.85,Math.pow(r(),1.6))*L(1),.005+.004*r());}
  else{const n=Math.max(8,rays*2);for(let i=0;i<n;i++)ray(r()*6.283,lerp(.2,.96,Math.pow(r(),1+asym*2)),.006+.012*r());}   // shard
  const out=new Float32Array(N*N);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const px=(x+.5)/N*2-1,py=(y+.5)/N*2-1,rr=Math.hypot(px,py);
    let v=Math.exp(-((rr/.03)**2))+.05*Math.exp(-((rr/.12)**2));
    for(const q of R){const d=px*q.c+py*q.s;if(d<=0)continue;const t=d/q.len;if(t>=1)continue;const p=-px*q.s+py*q.c,w=q.w*(1-.85*t)+.0015;v+=Math.pow(1-t,1.7)*Math.exp(-((p/w)**2));}
    out[y*N+x]=Math.min(1,v)*sstep(1,.9,rr);}
  return out;}
// 闪光: 6 circular-base impact masks (sphere | ripple | halo | corona | nebula | shatter) — macroscopically circular from afar, with high-frequency sketchy/dry-brush edge breakup up close
function genFlash(style,seed,rings=3,N=256){
  const r=rng(hash(seed,19)),out=new Float32Array(N*N),nr=clamp(Math.round(rings||3),1,8);
  const p1=r()*6.2832,p2=r()*6.2832,p3=r()*6.2832,k1=3+Math.floor(r()*4),k2=5+Math.floor(r()*6);
  const rIn=lerp(.46,.58,r()),nFib=36+Math.floor(r()*28),fib=[],cells=[];
  for(let i=0;i<nFib;i++)fib.push({a:(i/nFib)*6.2832+(r()-.5)*.20,w:lerp(.020,.060,r()),amp:lerp(.35,1,r()),l0:lerp(.05,.24,r()),l1:lerp(.74,.96,r())});
  for(let i=0;i<18;i++){const cr=lerp(.18,.88,Math.sqrt((i+.3)/18)),ca=i*2.39996+p1;cells.push([cr*Math.cos(ca),cr*Math.sin(ca),lerp(.16,.34,r())]);}
  const vNoise=(ux,uy)=>{let s=0,amp=.52,fr=2.6;for(let o=0;o<4;o++){const fx=ux*fr+o*3.7,fy=uy*fr-o*2.3,ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy,sx=tx*tx*(3-2*tx),sy=ty*ty*(3-2*ty);
    const H=(x,y)=>(hash(x,y,o,seed)/4294967296);const a=H(ix,iy),b=H(ix+1,iy),c=H(ix,iy+1),d=H(ix+1,iy+1);s+=(a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy)*amp;amp*=.5;fr*=2.05;}return s;};
  const angNoise=(ang,fr,ph)=>vNoise(Math.cos(ang)*fr+ph,Math.sin(ang)*fr-ph);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const px=(x+.5)/N*2-1,py=(y+.5)/N*2-1,rr=Math.hypot(px,py);
    if(rr>=.99){out[y*N+x]=0;continue;}
    const ang=Math.atan2(py,px),bEnv=sstep(.99,.925,rr);
    // Circular base macroscopically, with high-frequency sketchy brush edge jitter & dry-brush strokes
    const nSketch=vNoise(px*7.2-2.4,py*7.2+1.7)-.5,nFine=vNoise(px*15.5+3.1,py*15.5-2.6)-.5;
    const nAng=(angNoise(ang,6.5,p1*.3)-.5)*.024+(angNoise(ang,14.0,p2*.7)-.5)*.016;
    const rw=rr+nAng+nSketch*.030+nFine*.022;
    const brushEdge=.48+1.05*clamp(vNoise(px*9.5+p2,py*9.5-p3),0,1);
    const dryScratch=sstep(.18,.68,vNoise(Math.cos(ang)*4.8+rr*6.0,Math.sin(ang)*4.8-rr*6.0));
    let v=0;
    if(style==='ripple'){
      const ph=clamp((rw-.10)/.82,0,1)*nr*Math.PI*2-p3*.35;
      const waves=Math.pow(.5+.5*Math.cos(ph),2.5)*sstep(.06,.18,rr)*(.50+.50*sstep(.95,.22,rr))*(.45+.75*dryScratch);
      const rim=.50*Math.exp(-(((rw-.88)/(.032+.028*brushEdge))**2))*(.42+.78*dryScratch),core=.82*Math.exp(-((rr/.14)**2));
      v=core+waves*.80+rim;
    }else if(style==='halo'){
      const wMain=.036+.042*Math.abs(nSketch*2.2),wSec=.026+.032*Math.abs(nFine*2.4);
      const rMain=.86*Math.exp(-(((rw-.82)/wMain)**2))*(.45+.75*dryScratch);
      const rSec=.42*Math.exp(-(((rw-.62)/wSec)**2))*(.35+.80*brushEdge);
      const mist=.24*Math.max(0,1-(rr/.91)**2)*(.65+.55*nSketch),core=.52*Math.exp(-((rr/.11)**2));
      v=rMain+rSec+mist+core;
    }else if(style==='corona'){
      let rays=0;
      for(const f of fib){let da=Math.abs(ang-f.a);if(da>Math.PI)da=6.2831853-da;if(da>f.w*2.6)continue;
        rays+=f.amp*Math.exp(-((da/f.w)**2))*sstep(f.l0,f.l0+.10,rw)*sstep(f.l1,.5*(f.l0+f.l1),rw*.92);}
      const ring=.48*Math.exp(-(((rw-.36)/(.032+.028*brushEdge))**2))*(.45+.75*dryScratch),disc=.30*Math.max(0,1-(rr/.95)**1.6),rim=.34*Math.exp(-(((rw-.88)/.040)**2))*(.45+.75*dryScratch),core=.88*Math.exp(-((rr/.13)**2));
      v=core+ring+disc+rim+Math.min(.78,rays*.45);
    }else if(style==='nebula'){
      const n=vNoise(px+1.7,py-1.3),caust=Math.pow(Math.max(0,1-Math.abs(2*n-1)),2.6);
      const u=Math.min(1,rw/.93),limb=Math.pow(u,2.4)*sstep(.98,.83,rw);
      const body=(.28+.58*n)*Math.sqrt(Math.max(0,1-u*u))+.54*caust*(.35+.65*u)+.48*limb*(.55+.65*dryScratch)+.62*Math.exp(-((rr/.15)**2));
      v=body;
    }else if(style==='shatter'){
      let d1=9,d2=9;for(const c of cells){const d=Math.hypot(px-c[0],py-c[1])/c[2];if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;}
      const seam=Math.exp(-(((d2-d1)/(.10+.04*nSketch))**2)),arc=Math.pow(.5+.5*Math.cos((rw*nr*3.1416)+Math.sin(k1*ang+p2)*.9),3.8)*(.45+.75*dryScratch);
      const rim=.54*Math.exp(-(((rw-.88)/(.032+.026*brushEdge))**2))*(.45+.75*dryScratch),slab=.24*sstep(.96,.18,rr),core=.78*Math.exp(-((rr/.13)**2));
      v=core+slab+seam*.70*sstep(.08,.24,rr)+arc*.42+rim;
    }else{
      // 'sphere': circular shock-sphere & concentric band with high-frequency sketchy/brush-stroke edge feathering
      const u=Math.min(1,rr/.945),z=Math.sqrt(Math.max(0,1-u*u));
      let fil=0;for(let i=0;i<24;i++){const fa=fib[i].a;let da=Math.abs(ang-fa);if(da>Math.PI)da=6.2831853-da;if(da<.10)fil+=fib[i].amp*Math.exp(-((da/.036)**2));}
      const wBand=.022+.036*Math.abs(nSketch*2.2+nFine*1.4),wRim=.026+.038*Math.abs(nSketch*2.0+nFine*1.2);
      const vol=.34*z+.42*Math.pow(u,2.5)*sstep(.985,.84,rw)+.42*Math.exp(-(((rw-.88)/wRim)**2))*(.40+.80*dryScratch);
      const inBand=.50*Math.exp(-(((rw-rIn)/wBand)**2))*(.35+.85*dryScratch)*(.65+.55*brushEdge);
      const core=.90*Math.exp(-((rr/.15)**2));
      v=core+vol+inBand+Math.min(.30,fil*.16)*sstep(.08,.25,rr)*sstep(.94,.54,rr);
    }
    out[y*N+x]=clamp(v,0,1)*bEnv;
  }
  return out;}
// tileable value-noise fbm (smoke)
function genNoise(seed,N=128){const H=(x,y,o)=>{let h=hash(x,y,o,seed);return h/4294967296;};const out=new Float32Array(N*N);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){let s=0,amp=.5,c=4;for(let o=0;o<5;o++){const fx=x/N*c,fy=y/N*c,ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy,sx=tx*tx*(3-2*tx),sy=ty*ty*(3-2*ty);
      const a=H(ix%c,iy%c,o),b=H((ix+1)%c,iy%c,o),cc=H(ix%c,(iy+1)%c,o),d=H((ix+1)%c,(iy+1)%c,o);s+=(a+(b-a)*sx+(cc-a)*sy+(a-b-cc+d)*sx*sy)*amp;amp*=.5;c*=2;}
    out[y*N+x]=s/.97;}return out;}
const builtinTex={};
function getBuiltin(key){if(builtinTex[key])return builtinTex[key];const b=(window.PARRY_BUILTIN||{})[key];if(!b)return null;
  const t=new THREE.TextureLoader().load(b.src);t.colorSpace=THREE.NoColorSpace;builtinTex[key]=t;return t;}

// ---------------- renderer / scene ----------------
let host,renderer,scene,camera,controls,composer,renderPass,bloom,refrPass,heatPass,refrRT,refrScene,kleinPass,kleinBgRT,kleinScene,kleinCtx,kleinFloorTex,kleinSkyMat,kleinFloorMat,light,floor,ready=false;
const CLEAR_BLK=new THREE.Color(0x000000),stageState={theme:'dark',kleinBg:'#002FA7',darkBg:'#14161a',gridAlpha:.20};
const hexSrgb=h=>{const n=parseInt(String(h||'#002FA7').replace('#',''),16);return new THREE.Vector3(((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255);};
const W={A:null,B:null,custom:null};
function paintKleinFloor(){if(!kleinCtx)return;
  const x=kleinCtx;x.fillStyle=stageState.kleinBg;x.fillRect(0,0,256,256);x.strokeStyle=`rgba(245,241,232,${stageState.gridAlpha})`;x.lineWidth=2;
  for(const p of [0,128,256]){x.beginPath();x.moveTo(p,0);x.lineTo(p,256);x.moveTo(0,p);x.lineTo(256,p);x.stroke();}
  kleinFloorTex.needsUpdate=true;const b=hexSrgb(stageState.kleinBg);kleinSkyMat.uniforms.bg.value.copy(b);kleinFloorMat.uniforms.bg.value.copy(b);}
function setStageTheme(o={}){
  if(o.stageTheme)stageState.theme=o.stageTheme==='klein'?'klein':'dark';
  if(o.gridAlpha!=null)stageState.gridAlpha=+o.gridAlpha;
  if(o.bg){if(stageState.theme==='klein')stageState.kleinBg=o.bg;else stageState.darkBg=o.bg;}
  if(!ready&&!kleinPass)return stageState.theme;
  if(stageState.theme==='klein'){paintKleinFloor();floor.visible=false;scene.background=null;scene.fog=null;renderPass.clearColor=CLEAR_BLK;renderPass.clearAlpha=0;kleinPass.enabled=true;}
  else{floor.visible=true;scene.background=new THREE.Color(stageState.darkBg);scene.fog=new THREE.Fog(stageState.darkBg,6,15);renderPass.clearColor=null;renderPass.clearAlpha=1;kleinPass.enabled=false;}
  return stageState.theme;}
function init(el){
  host=el;renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;host.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color('#14161a');scene.fog=new THREE.Fog('#14161a',6,15);
  camera=new THREE.PerspectiveCamera(36,1,.02,60);controls=new OrbitControls(camera,renderer.domElement);setCam([.16,1.34,2.18],[.0,1.18,0],40);
  scene.add(new THREE.HemisphereLight(0xb9c2d6,0x1a1714,.5));const dl=new THREE.DirectionalLight(0xfff1e0,.95);dl.position.set(-1.5,3,2);scene.add(dl);
  const rim=new THREE.DirectionalLight(0x9cc0ff,1.35);rim.position.set(1.2,2.2,-2.5);scene.add(rim);const graze=new THREE.DirectionalLight(0xffffff,.95);graze.position.set(-.4,.6,3);scene.add(graze);   // cool rim + frontal grazing key: bevels gleam
  light=new THREE.PointLight(0xffb060,0,0,2);scene.add(light);
  // reflections for the steel: a tiny studio (softbox + warm side + cool rim)
  const pm=new THREE.PMREMGenerator(renderer),es=new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.BoxGeometry(10,10,10),new THREE.MeshBasicMaterial({color:0x15171c,side:THREE.BackSide})));
  const panel=(w,h,c,k,p)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(c).multiplyScalar(k),side:THREE.DoubleSide}));m.position.set(...p);m.lookAt(0,0,0);es.add(m);};
  panel(4,1.2,0xffffff,2.2,[0,4.5,1]);panel(1.2,4,0xffb070,1.6,[-4.5,0,1]);panel(1,3,0x9ab8ff,1.4,[4.5,1,-2]);panel(6,.25,0xffffff,2.5,[0,1,-4.8]);
  scene.environment=pm.fromScene(es,.03).texture;
  // dark checker floor (same look as the 刀光 tab)
  const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');x.fillStyle='#2c2f36';x.fillRect(0,0,256,256);x.fillStyle='#262930';x.fillRect(0,0,128,128);x.fillRect(128,128,128,128);
  x.fillStyle='#383c45';for(const p of [0,128,256]){x.fillRect(p-1.5,0,3,256);x.fillRect(0,p-1.5,256,3);}
  const ft=new THREE.CanvasTexture(c);ft.wrapS=ft.wrapT=THREE.RepeatWrapping;ft.colorSpace=THREE.SRGBColorSpace;ft.repeat.set(80,80);ft.anisotropy=renderer.capabilities.getMaxAnisotropy();
  floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({map:ft,roughness:.82,metalness:0,envMapIntensity:.15}));floor.rotation.x=-Math.PI/2;scene.add(floor);
  // unlit Klein Blue (#002FA7) + Cream (#F5F1E8) stage scene (bypasses ACES so sRGB #002FA7 stays exact while still warped by heatwave refraction)
  const kc=document.createElement('canvas');kc.width=kc.height=256;kleinCtx=kc.getContext('2d');
  kleinFloorTex=new THREE.CanvasTexture(kc);kleinFloorTex.wrapS=kleinFloorTex.wrapT=THREE.RepeatWrapping;kleinFloorTex.colorSpace=THREE.NoColorSpace;
  kleinFloorTex.magFilter=THREE.LinearFilter;kleinFloorTex.minFilter=THREE.LinearMipmapLinearFilter;kleinFloorTex.generateMipmaps=true;kleinFloorTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
  kleinScene=new THREE.Scene();
  kleinSkyMat=new THREE.ShaderMaterial({uniforms:{bg:{value:hexSrgb('#002FA7')}},vertexShader:`void main(){gl_Position=vec4(position.xy,.9999,1.);}`,fragmentShader:`uniform vec3 bg;void main(){gl_FragColor=vec4(bg,1.);}`,depthTest:false,depthWrite:false});
  const kSky=new THREE.Mesh(new THREE.PlaneGeometry(2,2),kleinSkyMat);kSky.frustumCulled=false;kSky.renderOrder=-10;kleinScene.add(kSky);
  kleinFloorMat=new THREE.ShaderMaterial({uniforms:{map:{value:kleinFloorTex},bg:{value:hexSrgb('#002FA7')},fog0:{value:5.5},fog1:{value:14.0}},
    vertexShader:`varying vec2 vUv;varying float vDist;void main(){vUv=uv*80.;vec4 mv=modelViewMatrix*vec4(position,1.);vDist=-mv.z;gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`uniform sampler2D map;uniform vec3 bg;uniform float fog0,fog1;varying vec2 vUv;varying float vDist;void main(){vec3 c=texture2D(map,vUv).rgb;gl_FragColor=vec4(mix(c,bg,smoothstep(fog0,fog1,vDist)),1.);}`});
  const kFl=new THREE.Mesh(new THREE.PlaneGeometry(40,40),kleinFloorMat);kFl.rotation.x=-Math.PI/2;kleinScene.add(kFl);paintKleinFloor();
  // Left Defender W.A: bright honed katana (打刀) vs Right Attacker W.B: dark gunmetal tachi/katana (敌方太刀)
  W.A=makeSword({len:1.00,w:.033,steel:0xdce2ea,guard:0x987036,katana:true});W.B=makeSword({len:1.05,w:.038,steel:0x78808e,guard:0x252220,katana:true,tachi:true});scene.add(W.A,W.B);
  initFX();
  composer=new EffectComposer(renderer,new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType}));
  renderPass=new RenderPass(scene,camera);composer.addPass(renderPass);
  refrRT=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType});kleinBgRT=new THREE.WebGLRenderTarget(1,1,{type:THREE.UnsignedByteType});
  refrPass=new ShaderPass(REFR_PASS);composer.addPass(refrPass);   // also clamps HDR so a hot specular can never blow up the bloom
  bloom=new UnrealBloomPass(new THREE.Vector2(1,1),.35,.4,1.0);bloom.compositeMaterial.uniforms.bloomFactors.value=[1,.62,.32,.13,.05];bloom.radius=0;   // tight HDR glow: the low mips would otherwise paint a big soft square
  const bm=bloom.blendMaterial||bloom.materialCopy||bloom.copyMaterial;if(bm){bm.blending=THREE.CustomBlending;bm.blendSrc=THREE.SrcAlphaFactor;bm.blendDst=THREE.OneFactor;bm.blendSrcAlpha=THREE.ZeroFactor;bm.blendDstAlpha=THREE.OneFactor;}
  composer.addPass(bloom);composer.addPass(new OutputPass());
  kleinPass=new ShaderPass(KLEIN_PASS);kleinPass.material.toneMapped=false;kleinPass.enabled=false;composer.addPass(kleinPass);
  heatPass=new ShaderPass(HEAT_PASS);heatPass.material.toneMapped=false;heatPass.enabled=false;composer.addPass(heatPass);   // last: full-frame heat ripple
  setStageTheme(stageState);
  new ResizeObserver(resize).observe(host);resize();ready=true;
}
function resize(){const w=host.clientWidth||800,h=host.clientHeight||600;renderer.setSize(w,h);composer.setSize(w,h);const db=renderer.getDrawingBufferSize(new THREE.Vector2());refrRT.setSize(db.x,db.y);kleinBgRT.setSize(db.x,db.y);
  refrPass.uniforms.res.value.set(db.x,db.y);kleinPass.uniforms.res.value.set(db.x,db.y);heatPass.uniforms.res.value.set(db.x,db.y);camera.aspect=w/h;camera.updateProjectionMatrix();}
function setCam(pos,tgt,fov){camera.position.set(...pos);controls.target.set(...tgt);if(fov){camera.fov=fov;camera.updateProjectionMatrix();}controls.update();}

// ---------------- forged blades ----------------
// local frame: grip/hand at the origin, blade along +X, cutting edge = +Y, flat = Z
function bladeGeo(len,w,t,dao,katana){const N=28,P=[];const sec=x=>{const k=x/len,tip=sstep(.86,1,k);const ww=w*(dao?1+.14*Math.sin(k*Math.PI)*(1-tip):1-.16*k)*(1-tip),tt=t*(1-.3*k)*(1-tip*.9);
    const sori=katana?-Math.pow(k,2)*.032:0;   // authentic Japanese sori: convex ha (+Y edge), concave mune (-Y spine), ~2mm at forte (k=0.25), 3.2cm curve at kissaki tip
    const back=-ww/2+sori,edge=ww/2+(dao?Math.sin(k*Math.PI)*.005:0)+sori;
    return [[x,edge,0],[x,(edge+back)/2+(dao?ww*.12:-ww*.08),tt/2],[x,back,dao?tt*.18:0],[x,(edge+back)/2+(dao?ww*.12:-ww*.08),-tt/2]];};
  const x0=.025;let prev=sec(x0);
  for(let i=1;i<=N;i++){const x=x0+(len-x0)*i/N,tipY=dao?-w*.18:katana?-.032+w*.14:0,cur=i===N?[[len,tipY,0],[len,tipY,0],[len,tipY,0],[len,tipY,0]]:sec(x);
    for(let j=0;j<4;j++){const a=prev[j],b=prev[(j+1)%4],c=cur[(j+1)%4],d=cur[j];P.push(...a,...b,...c,...a,...c,...d);}prev=cur;}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.computeVertexNormals();return g;}
function makeSword(o){const g=new THREE.Group();
  const steel=new THREE.MeshStandardMaterial({color:o.steel,metalness:1,roughness:o.tachi?.30:o.dao?.34:.22,side:THREE.DoubleSide,envMapIntensity:1.05});
  const blade=new THREE.Mesh(bladeGeo(o.len,o.w,o.tachi?.0082:o.dao?.009:.0072,o.dao,o.katana),steel);g.add(blade);
  const bronze=new THREE.MeshStandardMaterial({color:o.guard,metalness:.88,roughness:.34});
  const guard=new THREE.Mesh(o.katana?new THREE.CylinderGeometry(o.tachi?.045:.041,o.tachi?.045:.041,.0075,18):o.dao?new THREE.CylinderGeometry(.052,.052,.014,20):new THREE.BoxGeometry(.022,.13,.034),bronze);
  guard.position.x=.008;if(o.katana||o.dao)guard.rotation.z=Math.PI/2;if(o.katana)guard.scale.set(1,1,.85);g.add(guard);
  if(o.katana){const hab=new THREE.Mesh(new THREE.BoxGeometry(.024,o.w*.96,.011),bronze);hab.position.x=.022;g.add(hab);}
  const gl=o.tachi?.26:o.dao?.25:.24,grip=new THREE.Mesh(new THREE.CylinderGeometry(.015,.017,gl,12),new THREE.MeshStandardMaterial({color:o.tachi?0x221514:0x14161d,roughness:.92}));grip.rotation.z=Math.PI/2;grip.position.x=-gl/2;g.add(grip);
  const nw=8;for(let i=0;i<nw;i++){const wr=new THREE.Mesh(new THREE.TorusGeometry(.0165,.0028,6,14),new THREE.MeshStandardMaterial({color:o.tachi?0x3c241e:0x2b3140,roughness:.8}));wr.rotation.y=Math.PI/2;wr.position.x=-.022-i*.028;g.add(wr);}
  const pom=new THREE.Mesh(o.katana?new THREE.CylinderGeometry(.017,.017,.014,14):new THREE.SphereGeometry(.023,14,10),bronze);if(o.katana)pom.rotation.z=Math.PI/2;pom.position.x=-gl-.008;g.add(pom);
  g.traverse(m=>m.layers.enable(2));g.userData={len:o.len,hw:o.w/2,blade,steel,parts:g.children.slice()};return g;}
async function loadWeapon(url,flip){const GL=await B.GLTF();const gl=await new GLTFLoaderP(GL,url);const root=gl.scene;
  const box=new THREE.Box3().setFromObject(root),sz=box.getSize(new THREE.Vector3()),ctr=box.getCenter(new THREE.Vector3());
  const ax=sz.x>=sz.y&&sz.x>=sz.z?'x':sz.y>=sz.z?'y':'z',L=sz[ax],k=1.18/L;
  const inner=new THREE.Group();root.position.sub(ctr);inner.add(root);
  if(ax==='y')inner.rotation.z=-Math.PI/2;else if(ax==='z')inner.rotation.y=Math.PI/2;
  const holder=new THREE.Group();holder.add(inner);inner.scale.setScalar(k);if(flip)holder.rotation.z=Math.PI;
  const wrap=new THREE.Group();holder.position.x=1.18/2-.2;wrap.add(holder);
  root.traverse(m=>{if(m.isMesh&&m.material){for(const mt of [].concat(m.material)){mt.envMapIntensity=1;if(mt.emissiveIntensity!=null)mt.emissiveIntensity=Math.min(mt.emissiveIntensity,.15);}m.layers.enable(2);}});
  wrap.userData={len:1.18-.2,hw:.02,custom:true};
  if(W.custom)disposeCustom();W.custom=wrap;scene.add(wrap);W.A.visible=false;return wrap;}
function GLTFLoaderP(GL,url){return new Promise((res,rej)=>new GL().load(url,res,undefined,rej));}
function disposeCustom(){const o=W.custom;if(!o)return;scene.remove(o);W.custom=null;
  o.traverse(m=>{if(m.geometry)m.geometry.dispose();if(m.material)for(const mt of [].concat(m.material)){for(const k in mt){const v=mt[k];if(v&&v.isTexture)v.dispose();}mt.dispose();}});}
function useDefaultWeapon(){disposeCustom();W.A.visible=true;}

// ---------------- clash animation: human overhead cleave from Right vs braced upward guard on Left ----------------
const _q=new THREE.Quaternion(),_q2=new THREE.Quaternion(),_hA=new THREE.Vector3(),_hB=new THREE.Vector3();
const easeOut=x=>1-Math.pow(1-x,3);
function angles(t,P){const hs=P.clash.hitstop,tt=t-T0,u=tt-hs,D=Math.PI/180,cEnd=sstep(0,.016,Math.max(0,hs)),sA=F.hang?-1:1;
  let b=0,a=0,recA=0,recB=0,windB=0,rebB=0,dropA=0;
  // Right Attacker B: hands start high-right (+0.34,+0.42,-0.06) with blade cocked clockwise (-72°); drives down-left while blade whips CCW into C at T0; bounces CW (-26°) + up-right after hitstop
  if(t<T0-.19){b=72;windB=1;}
  else if(t<T0){const ki=(t-(T0-.19))/.19;b=72*(1-Math.pow(ki,2.3));windB=1-Math.pow(ki,1.9);}
  else if(u<0){b=0;recB=.026*sstep(0,.016,tt);}
  else{const r=sstep(.56,CYCLE-T0-hs-.05,u);rebB=(1-Math.exp(-u/.026))*Math.exp(-u/.45);b=26*rebB+72*r;recB=.026*cEnd*Math.exp(-u/.025);windB=r;}
  // Left Defender A: starts lower-left (-0.10,-0.10,+0.03) & 22° relaxed, snaps UP into guard 0.06s BEFORE T0, absorbs 0.028m down-left + 5° flex at T0, then pushes outward (+4.2°)
  if(t<T0-.38){a=22*sA;dropA=1;}
  else if(t<T0-.06){const ku=easeOut((t-(T0-.38))/.32);a=22*sA*(1-ku);dropA=1-ku;}
  else if(t<T0){a=0;}
  else if(u<0){const cp=sstep(0,.016,tt);a=-5*sA*cp;recA=.028*cp;}
  else{const r=sstep(.80,CYCLE-T0-hs-.05,u);a=-5*sA*cEnd*Math.exp(-u/.022)+4.2*sA*(1-Math.exp(-u/.028))*Math.exp(-u/.18)+22*sA*r;recA=.028*cEnd*Math.exp(-u/.09);dropA=r;}
  const tr=tt>=0?P.clash.tremor*Math.exp(-tt/(hs+.07))*Math.sin(2*Math.PI*44*tt):0;
  return {a:a*D,b:-b*D,tr:tr*1.6*D,tt,recA,recB,windB,rebB,dropA};}
function poseWeapons(t,P){applyPose(P.clash.pose||'cross');const k=angles(t,P);
  const set=(g,q0,hilt,edge,dir,ang,tw)=>{if(!g)return;const z=new THREE.Vector3().crossVectors(dir,edge).normalize();
    _q.setFromAxisAngle(z,ang);_q2.setFromAxisAngle(dir,tw);g.quaternion.copy(_q2).multiply(_q).multiply(q0);
    const hw=g.userData.hw||.017,off=edge.clone().applyQuaternion(_q).multiplyScalar(-hw);   // put the cutting edge (not the centre line) through the clash point
    g.position.copy(hilt).add(off);};
  _hA.copy(F.hiltA).addScaledVector(F.edgeA,-k.recA);_hA.x-=.10*k.dropA;_hA.y-=.10*k.dropA;_hA.z+=.03*k.dropA;
  _hB.copy(F.hiltB).addScaledVector(F.edgeA,-k.recB);
  _hB.x+=.34*k.windB+.10*k.rebB;_hB.y+=.42*k.windB+.12*k.rebB;_hB.z-=.06*k.windB+.03*k.rebB;
  set(W.custom||W.A,QA,_hA,F.edgeA,F.dirA,k.a,k.tr);set(W.B,QB,_hB,F.edgeB,F.dirB,k.b,-k.tr*1.3);
  return k;}

// ---------------- VFX buffers ----------------
const ADD_VS=`attribute vec4 pcol;attribute vec3 pinf;varying vec4 vC;varying vec3 vI;void main(){vC=pcol;vI=pinf;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// modes: 0 velocity streak (bright head, tapered tail) · 1 diamond needle · 2 alpha-clipped molten speck (clip .3333) · 3 ribbon (alpha in pcol.a)
const ADD_FS=`varying vec4 vC;varying vec3 vI;void main(){float u=vI.x,v=vI.y,m=vI.z,i;
 if(m>1.5&&m<2.5){float r2=u*u+v*v;if(1.-r2<.3333)discard;gl_FragColor=vec4(vC.rgb*vC.a,1.);return;}
 if(m>.5&&m<1.5){float e=1.-abs(2.*v-1.);float w=max(.015,e);i=pow(e,1.25)*pow(max(0.,1.-abs(u)/w),2.2);i+=exp(-u*u*400.)*e*e*.5;}
 else if(m>2.5){float a=1.-abs(u);i=a*a*vC.a;gl_FragColor=vec4(vC.rgb*i,1.);return;}
 else{float a=pow(1.-abs(u),2.2);i=a*(.1+.9*pow(v,.75))*smoothstep(1.,.95,v)*smoothstep(0.,.3,v);}   // razor needle: tapered tail, sharp head
 gl_FragColor=vec4(vC.rgb*vC.a*i,1.);}`;
const DARK_FS=`varying vec4 vC;varying vec3 vI;void main(){float u=vI.x,v=vI.y;float a=1.-abs(u);a=a*a;float i=a*pow(v,1.2)*smoothstep(1.,.85,v);gl_FragColor=vec4(vC.rgb,vC.a*i);}`;
function quadBuf(maxQ,fs,isDark){const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(maxQ*12),3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('pcol',new THREE.BufferAttribute(new Float32Array(maxQ*16),4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('pinf',new THREE.BufferAttribute(new Float32Array(maxQ*12),3).setUsage(THREE.DynamicDrawUsage));
  const I=new Uint32Array(maxQ*6);for(let q=0;q<maxQ;q++)I.set([q*4,q*4+1,q*4+2,q*4,q*4+2,q*4+3],q*6);g.setIndex(new THREE.BufferAttribute(I,1));
  const m=new THREE.Mesh(g,new THREE.ShaderMaterial({vertexShader:ADD_VS,fragmentShader:fs,transparent:true,depthWrite:false,side:THREE.DoubleSide,
    blending:THREE.CustomBlending,blendSrc:isDark?THREE.SrcAlphaFactor:THREE.OneFactor,blendDst:isDark?THREE.OneMinusSrcAlphaFactor:THREE.OneFactor,
    blendSrcAlpha:isDark?THREE.OneFactor:THREE.ZeroFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor}));
  if(!isDark)m.material.blendDstAlpha=THREE.OneFactor;
  m.frustumCulled=false;m.renderOrder=isDark?2:5;scene.add(m);return {m,g,n:0,max:maxQ};}
function qPush(Bf,p0,p1,p2,p3,c0,c1,mode,uvs){if(Bf.n>=Bf.max)return;const o=Bf.n++,P=Bf.g.attributes.position.array,Cc=Bf.g.attributes.pcol.array,I=Bf.g.attributes.pinf.array;
  P.set([p0.x,p0.y,p0.z,p1.x,p1.y,p1.z,p2.x,p2.y,p2.z,p3.x,p3.y,p3.z],o*12);Cc.set([...c0,...c0,...c1,...c1],o*16);
  const U=uvs||[-1,0,1,0,1,1,-1,1];I.set([U[0],U[1],mode,U[2],U[3],mode,U[4],U[5],mode,U[6],U[7],mode],o*12);}
function qFlush(Bf){const g=Bf.g;g.setDrawRange(0,Bf.n*6);g.attributes.position.needsUpdate=g.attributes.pcol.needsUpdate=g.attributes.pinf.needsUpdate=true;Bf.n=0;}
const _a=new THREE.Vector3(),_b=new THREE.Vector3(),_s=new THREE.Vector3(),_v=new THREE.Vector3(),_t0=new THREE.Vector3(),_t1=new THREE.Vector3(),_t2=new THREE.Vector3(),_t3=new THREE.Vector3();
// camera-facing streak from tail a to head b
let PXK=.001;   // world size of one pixel at 1 m (set per frame)
function streak(Bf,a,b,hw,col,mode,colTail){_s.subVectors(b,a);_v.subVectors(camera.position,b);_t0.crossVectors(_s,_v);const l=_t0.length();if(l<1e-9)return;
  const mn=.75*PXK*_v.length();if(hw<mn){const k=hw/mn;hw=mn;col=[col[0]*k,col[1]*k,col[2]*k,col[3]];if(colTail)colTail=[colTail[0]*k,colTail[1]*k,colTail[2]*k,colTail[3]];}   // never thinner than ~1.5 px (sub-pixel quads alias into dotted lines)
  _t0.multiplyScalar(hw/l);
  qPush(Bf,_t1.copy(a).sub(_t0),_t2.copy(a).add(_t0),_t3.copy(b).add(_t0),_b.copy(b).sub(_t0),colTail||col,col,mode||0);}
function speck(Bf,p,s,col){_v.subVectors(camera.position,p);const dc=_v.length(),mn=1.15*PXK*dc;let rad=s,ck=sstep(.35,1.0,dc);if(ck<.003)return;   // fade specks that fly into the lens (fast embers)

  if(rad<mn&&mn>1e-6){ck*=Math.max(.45,rad/mn);rad=mn;}
  const cr=_t0.setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(rad),cu=_s.setFromMatrixColumn(camera.matrixWorld,1).multiplyScalar(rad),c=[col[0]*ck,col[1]*ck,col[2]*ck,col[3]];
  qPush(Bf,_t1.copy(p).sub(cr).sub(cu),_t2.copy(p).add(cr).sub(cu),_t3.copy(p).add(cr).add(cu),_b.copy(p).sub(cr).add(cu),c,c,2,[-1,-1,1,-1,1,1,-1,1]);}

const _dbs=new THREE.Vector2();let ADD,DARK,starM,glowM,flashM,smokeB,debrisM,refrQ;
const STAR_FS=`uniform sampler2D map;uniform vec3 core,edge;uniform float gain,pw;varying vec2 vUv;void main(){float s=texture2D(map,vUv).r;float k=pow(s,pw);vec3 c=mix(edge,core,smoothstep(.25,.9,s));gl_FragColor=vec4(c*k*gain,1.);}`;
const GLOW_FS=`uniform vec3 edge;uniform float gain;varying vec2 vUv;void main(){vec2 p=vUv*2.-1.;float r2=dot(p,p);float k=exp(-r2*9.)*(1.-smoothstep(.6,1.,r2));gl_FragColor=vec4(edge*k*gain,1.);}`;
 const FLASH_FS=`uniform sampler2D map;uniform vec3 core,color;uniform float opacity,blur,hollow,hdr,fade;varying vec2 vUv;
void main(){float op=clamp(opacity*fade,0.,1.);if(op<=.0005)discard;
 vec2 p=vUv*2.-1.;float r=length(p);if(r>1.)discard;
 float s=texture2D(map,vUv).r;
 float rEdge=r-(s-.35)*.06;
 float edgeEnv=smoothstep(1.,1.-max(.02,blur*.92),rEdge);
 float inEnv=hollow>.001?smoothstep(hollow*.58,hollow*.88+.05,r+(s-.45)*.05):1.;
 float m=clamp(s*edgeEnv*inEnv,0.,1.);
 vec3 c=mix(color,core,smoothstep(.30,.90,s*(1.-r*.40)));
 float a=clamp(m*op*.62,0.,.92);
 vec3 rgb=c*(m*op*(.35+hdr*.22));
 gl_FragColor=vec4(rgb,a);}`;
const UV_VS=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const SMOKE_VS=`attribute vec4 pd;attribute vec4 pc;attribute vec2 puv;varying vec4 vD;varying vec4 vC;varying vec2 vUv;void main(){vD=pd;vC=pc;vUv=puv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const SMOKE_FS=`uniform sampler2D noiseT,maskT;uniform int useMask;uniform vec3 warm;varying vec4 vD;varying vec4 vC;varying vec2 vUv;
void main(){vec2 p=vUv*2.-1.;float r=length(p);
 float n=texture2D(noiseT,vUv*.62+vD.xy).r*.62+texture2D(noiseT,vUv*1.7-vD.yx*1.3).r*.38;
 float rad=useMask==1?texture2D(maskT,vUv).r*1.15:smoothstep(1.,.05,r);
 float d=pow(n,1.6)*rad*1.6;float a=smoothstep(vD.z,vD.z+.16,d)*vD.w;if(a<.003)discard;
 float rim=1.-smoothstep(vD.z,vD.z+.07,d);float lit=.35+.65*vC.a;gl_FragColor=vec4(mix(vC.rgb,vec3(.07,.066,.062),lit*(1.-d*.5))+warm*rim*vC.a*.9,a);}`;
const REFR_FS=`uniform float amt,R,wid,fade,waves;uniform int mode;uniform sampler2D tex;varying vec2 vUv;
void main(){vec2 p=vUv*2.-1.;float r=length(p);if(r>1.)discard;vec2 d=r>1e-4?p/r:vec2(0.);float o=0.;
 if(mode==0){o=exp(-pow((r-R)/wid,2.));}
 else if(mode==1){o=sin(clamp(r/max(R,.05),0.,1.)*3.14159)*(1.-r);}
 else if(mode==2){o=exp(-pow((r-R)/wid,2.))+.6*exp(-pow((r-R*.62)/(wid*.8),2.));}
 else if(mode==4){float lam=wid*1.6,x=(R-r)/lam;o=sin(x*6.2832)*smoothstep(-.5,0.,x)*(1.-smoothstep(waves-.5,waves+.25,x))*exp(-.35*max(x,0.));}   // water ripple: N rings trailing the front, outer ring strongest
 else{float e=.01;float h0=texture2D(tex,vUv).r,hx=texture2D(tex,vUv+vec2(e,0.)).r,hy=texture2D(tex,vUv+vec2(0.,e)).r;vec2 g=vec2(hx-h0,hy-h0)/e*.08;float m=smoothstep(R*1.05,R*.5,r);gl_FragColor=vec4(g*amt*fade*m,0.,1.);return;}
 gl_FragColor=vec4(d*o*amt*fade*smoothstep(1.,.85,r),0.,1.);}`;
const REFR_PASS={uniforms:{tDiffuse:{value:null},tRefr:{value:null},res:{value:new THREE.Vector2(1,1)},on:{value:0}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse,tRefr;uniform vec2 res;uniform float on;varying vec2 vUv;
  void main(){if(on<.5){vec4 t=texture2D(tDiffuse,vUv);gl_FragColor=vec4(min(t.rgb,vec3(16.)),t.a);return;}vec2 o=texture2D(tRefr,vUv).rg*(res.y/720.)/res;
   vec2 uv=vUv-o;vec4 base=texture2D(tDiffuse,uv);vec3 c=vec3(texture2D(tDiffuse,uv-o*.06).r,base.g,texture2D(tDiffuse,uv+o*.06).b);gl_FragColor=vec4(min(c,vec3(16.)),base.a);}`};
const HEAT_PASS={uniforms:{tDiffuse:{value:null},tRefr:{value:null},res:{value:new THREE.Vector2(1,1)}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse,tRefr;uniform vec2 res;varying vec2 vUv;
  void main(){vec2 o=texture2D(tRefr,vUv).rg*(res.y/720.)/res;vec2 uv=clamp(vUv-o,vec2(0.),vec2(1.));vec4 base=texture2D(tDiffuse,uv);
   gl_FragColor=vec4(texture2D(tDiffuse,uv-o*.06).r,base.g,texture2D(tDiffuse,uv+o*.06).b,base.a);}`};   // 热浪 on the finished frame: blade, every FX layer and the stage ripple together
const KLEIN_PASS={uniforms:{tDiffuse:{value:null},tKleinBg:{value:null},tRefr:{value:null},res:{value:new THREE.Vector2(1,1)},refrOn:{value:0}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse,tKleinBg,tRefr;uniform vec2 res;uniform float refrOn;varying vec2 vUv;
  void main(){vec4 fg=texture2D(tDiffuse,vUv);vec2 o=refrOn>.5?texture2D(tRefr,vUv).rg*(res.y/720.)/res:vec2(0.);
   vec3 bg=texture2D(tKleinBg,vUv-o).rgb;float mx=max(fg.r,max(fg.g,fg.b)),glowCov=clamp((mx-.08)*1.15,0.,1.);
   float keepBg=(1.-clamp(fg.a,0.,1.))*(1.-glowCov*.88);gl_FragColor=vec4(clamp(bg*keepBg+fg.rgb,0.,1.),1.);}`};
let noiseTex=null,noiseSeed=-1,starTex=null,starKey='',starArr=null,flashTex=null,flashKey='',flashArr=null;
const customTexCache={};
function getCustomTex(src){if(!src)return null;if(customTexCache[src])return customTexCache[src];
  const ks=Object.keys(customTexCache);if(ks.length>=4){customTexCache[ks[0]].dispose();delete customTexCache[ks[0]];}   // keep a few recent uploads (history thumbs), free older ones
  const t=new THREE.TextureLoader().load(src);t.colorSpace=THREE.NoColorSpace;customTexCache[src]=t;return t;}
function initFX(){
  const addBlend={blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor,blendSrcAlpha:THREE.ZeroFactor,blendDstAlpha:THREE.OneFactor};
  const premulBlend={blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor};
  const covBlend={blending:THREE.CustomBlending,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor};
  ADD=quadBuf(5000,ADD_FS,false);DARK=quadBuf(600,DARK_FS,true);
  starM=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial({vertexShader:UV_VS,fragmentShader:STAR_FS,uniforms:{map:{value:null},core:{value:new THREE.Color()},edge:{value:new THREE.Color()},gain:{value:0},pw:{value:1.5}},transparent:true,depthWrite:false,depthTest:false,...addBlend}));
  glowM=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial({vertexShader:UV_VS,fragmentShader:GLOW_FS,uniforms:{edge:{value:new THREE.Color()},gain:{value:0}},transparent:true,depthWrite:false,depthTest:false,...addBlend}));
  flashM=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial({vertexShader:UV_VS,fragmentShader:FLASH_FS,uniforms:{map:{value:null},core:{value:new THREE.Color()},color:{value:new THREE.Color()},opacity:{value:.68},blur:{value:.28},hollow:{value:0},hdr:{value:9.5},fade:{value:0}},transparent:true,depthWrite:false,depthTest:false,side:THREE.DoubleSide,...premulBlend}));
  starM.renderOrder=7;glowM.renderOrder=6;flashM.renderOrder=4;starM.frustumCulled=glowM.frustumCulled=flashM.frustumCulled=false;scene.add(flashM,glowM,starM);
  // smoke: dynamic billboards
  const MS=64,g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(MS*12),3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('pd',new THREE.BufferAttribute(new Float32Array(MS*16),4).setUsage(THREE.DynamicDrawUsage));g.setAttribute('pc',new THREE.BufferAttribute(new Float32Array(MS*16),4).setUsage(THREE.DynamicDrawUsage));
  const UVs=new Float32Array(MS*8);for(let q=0;q<MS;q++)UVs.set([0,0,1,0,1,1,0,1],q*8);g.setAttribute('puv',new THREE.BufferAttribute(UVs,2));
  const I=new Uint32Array(MS*6);for(let q=0;q<MS;q++)I.set([q*4,q*4+1,q*4+2,q*4,q*4+2,q*4+3],q*6);g.setIndex(new THREE.BufferAttribute(I,1));
  smokeB={g,max:MS,m:new THREE.Mesh(g,new THREE.ShaderMaterial({vertexShader:SMOKE_VS,fragmentShader:SMOKE_FS,uniforms:{noiseT:{value:null},maskT:{value:null},useMask:{value:0},warm:{value:new THREE.Color()}},transparent:true,depthWrite:false,side:THREE.DoubleSide,...covBlend}))};
  smokeB.m.frustumCulled=false;smokeB.m.renderOrder=8;scene.add(smokeB.m);   // drawn over the sparks: veils part of the burst (ink in front of molten gold)
  // iron shards: lit, dark, metallic, spinning
  const sg=new THREE.IcosahedronGeometry(1,0);sg.scale(2.8,.38,.9);   // splinters, not berries
  debrisM=new THREE.InstancedMesh(sg,new THREE.MeshStandardMaterial({color:0x9a9ca4,metalness:1,roughness:.22,flatShading:true}),120);debrisM.frustumCulled=false;debrisM.count=0;scene.add(debrisM);
  refrScene=new THREE.Scene();refrQ=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial({vertexShader:UV_VS,fragmentShader:REFR_FS,uniforms:{amt:{value:0},R:{value:0},wid:{value:.08},fade:{value:0},mode:{value:0},waves:{value:3},tex:{value:null}},transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending}));
  refrQ.frustumCulled=false;refrScene.add(refrQ);
}
function ensureStarTex(P){const s=P.star;if(s.tex){const t=getBuiltin(s.tex);if(t)return t;}
  const key=[s.style,s.seed,s.rays,s.asym].join('|');if(key!==starKey){starKey=key;starArr=genStar(s.style,s.seed,s.rays,s.asym);starTex&&starTex.dispose();starTex=dataTex(starArr,256,false);}return starTex;}
function ensureFlashTex(P){const f=P.flash;
  if(f.customSrc){const ct=getCustomTex(f.customSrc);if(ct)return ct;}
  if(f.tex){const bt=getBuiltin(f.tex);if(bt)return bt;}
  const key=[f.style||'sphere',f.seed??17,f.rings??3].join('|');
  if(key!==flashKey){flashKey=key;flashArr=genFlash(f.style||'sphere',f.seed??17,f.rings??3,256);flashTex&&flashTex.dispose();flashTex=dataTex(flashArr,256,false);}
  return flashTex;}
function ensureNoise(seed){if(seed!==noiseSeed){noiseSeed=seed;noiseTex&&noiseTex.dispose();noiseTex=dataTex(genNoise(seed),128,true);}return noiseTex;}
const lin=h=>{const c=new THREE.Color(h);return [c.r,c.g,c.b];};

// ---------------- spark tiers (shared by the preview simulation and the exported recipe) ----------------
function sparkTiers(s){const sp=s.speed,dr=s.drag,lf=s.life,wd=s.width,st=s.streak;
  return [
  {name:'burst',count:Math.round(s.burst),speed:[11.5*sp,43.2*sp],drag:[15.3*dr,33.3*dr],life:[.07*lf,.22*lf],gravity:.25,width:[.0009*wd,.002*wd],streak:.036*st,maxLen:.5*st,cone:Math.min(82,s.cone*1.12),heat:[1,1],cool:[.12,.22],clip:0},
  {name:'arc',count:Math.round(s.arc),speed:[7.6*sp,17.1*sp],drag:[4.4*dr,7.8*dr],life:[.8*lf,1.7*lf],gravity:1,width:[.0011*wd,.002*wd],streak:.032*st,maxLen:.42*st,cone:s.cone,heat:[.85,1],cool:[.6,1.25],clip:0}];}
function emberTier(e){const sp=e.speed??1.15,dr=e.drag??1,lf=e.life??1,sz=e.size??1;
  return {name:'ember',count:Math.round(e.count??68),speed:[3.2*sp,11.2*sp],drag:[3.7*dr,7.5*dr],life:[.75*lf,1.7*lf],gravity:e.gravity??3.6,width:[.0046*sz,.0088*sz],cone:clamp(e.cone??58,10,85),heat:[.92,1],cool:[.62,1.35],flicker:clamp(e.flicker??.18,0,.6),clip:.3333};}
// spray lobes per style: [axis, share, cone multiplier]
function lobes(style){if(style==='burst')return [[null,1,1]];if(style==='scrape')return [[F.S1,.85,.5],[F.S2,.15,.8]];
  if(style==='rain')return [[F.S1.clone().multiplyScalar(.4).add(UP).normalize(),.8,1.2],[F.S2,.2,1]];return [[F.S1,.62,.9],[F.S2,.3,1],[null,.08,1]];}
function coneDir(r,axis,half){if(!axis){const z=2*r()-1,ph=6.2832*r(),q=Math.sqrt(1-z*z);return V3(q*Math.cos(ph),Math.abs(z)*.6+z*.4+.15,q*Math.sin(ph)).normalize();}
  const ct=lerp(Math.cos(half*Math.PI/180),1,r()),st=Math.sqrt(1-ct*ct),ph=6.2832*r();const t1=Math.abs(axis.y)<.9?V3(0,1,0):V3(1,0,0);const u=new THREE.Vector3().crossVectors(axis,t1).normalize(),w=new THREE.Vector3().crossVectors(axis,u);
  return axis.clone().multiplyScalar(ct).addScaledVector(u,st*Math.cos(ph)).addScaledVector(w,st*Math.sin(ph));}

// ---------------- simulation: re-run from the clash at a fixed 240 Hz (deterministic, scrubbable) ----------------
const DT=1/240,FLOOR=0,MAXT=CYCLE-T0-.02;
// Ribbon sphere frame = DEFENDER frame (the player in a game), origin at the clash point:
//   toDef = normalize(horizontal(-bladeA))  (clash point -> defender, flattened), up = +Y, side = cross(up,toDef).
// SPHERE_LOCAL = sphere direction in that frame (= the old world (-.99,-.03,.02) for the default 'cross' pose).
function defFrame(dirA){const t=V3(-dirA.x,0,-dirA.z);if(t.lengthSq()<1e-6)t.set(-1,0,0);t.normalize();return {toDef:t,up:UP.clone(),side:new THREE.Vector3().crossVectors(UP,t).normalize()};}
const SPHERE_LOCAL=(()=>{const f=defFrame(POSES.cross.dirA.clone().normalize()),w=V3(-.99,-.03,.02).normalize();return [w.dot(f.toDef),w.dot(f.up),w.dot(f.side)];})();
function sphereDir(){const f=defFrame(F.dirA);return f.toDef.multiplyScalar(SPHERE_LOCAL[0]).addScaledVector(f.up,SPHERE_LOCAL[1]).addScaledVector(f.side,SPHERE_LOCAL[2]).normalize();}
const SPHERE_GAP=.055;
function getSphereCenter(rb){const R=clamp(+(rb&&rb.sphereR)||.34,.15,.75);return C.clone().addScaledVector(sphereDir(),R+SPHERE_GAP);}
function spawnRibbonLeaders(P,r,out){
  const rb=P.ribbon||{};if(!rb.on)return;
  const nl=Math.max(1,Math.round(rb.count||12)),s=P.sparks,TA=sparkTiers(s)[1],sty=rb.style||'whip',spdMul=s.speed||1;
  if(sty==='sphereScatter'){
    // Invisible sphere (centre sc, shell radius Rs = |C-sc|) the leaders glide over. Each leader runs along a great circle
    // from the apex (the clash point) and peels off smoothly along the tangent at polar angle thetaExit = 90deg - alpha,
    // so its exit heading fans out by alpha from the sphere axis (alpha spread over sphereConeDeg). See step(): no kinks.
    const R=clamp(+rb.sphereR||.34,.15,.75),maxAng=clamp(+rb.sphereCone||48,20,72)*Math.PI/180;
    const u=sphereDir(),sc=C.clone().addScaledVector(u,R+SPHERE_GAP),Rs=R+SPHERE_GAP;
    const ref=Math.abs(u.y)<.9?UP:V3(1,0,0),e1=new THREE.Vector3().crossVectors(u,ref).normalize(),e2=new THREE.Vector3().crossVectors(u,e1).normalize();
    const nRibs=7+Math.floor(r()*5),ph0=r()*6.2831853,ph1=r()*6.2831853,ph2=r()*6.2831853;
    for(let i=0;i<nl;i++){
      const phi=(i/nl)*6.2831853+(r()-.5)*(2.2/Math.max(4,nl));
      const flute=1+.21*Math.cos(nRibs*phi+ph0)+.10*Math.sin(3*phi+ph1)+.06*Math.cos(2*phi+ph2);
      const radDir=e1.clone().multiplyScalar(Math.cos(phi)*1.06).addScaledVector(e2,Math.sin(phi)*.86).normalize();
      const strat=(i*.6180339887)%1;
      const rho=nl===1?.25:(i===0?lerp(.08,.14,r()):lerp(.20,1.0,strat*.72+r()*.28));
      const alpha=clamp(rho*(.80+.28*flute)*maxAng,.05,1.18);
      const sp0=lerp(15.5,19.4,r())*spdMul;   // x1.8 launch speed
      const swAx=new THREE.Vector3().crossVectors(u,radDir).normalize();
      const flareAx=swAx.clone().multiplyScalar(.72*(i%2?1:-1)).addScaledVector(radDir,.32).normalize();
      const postCurl=flareAx.multiplyScalar(lerp(2.2,4.4,r())*(.45+.55*rho));
      out.push({ti:1,T:TA,p:C.clone(),v:radDir.clone().multiplyScalar(sp0),drag:.02,
        life:Math.min(MAXT,lerp(.72,1.12,r())),w:.0016,heat:1,cool:lerp(.90,1.30,r()),
        g:0,delay:r()*.006,dist:0,bounces:0,ph:0,id:9000+i,bri:1.42,lk:1.3,
        leader:1,trail:[],curl:null,postCurl,rbMode:'sphereScatter',
        sc,Rs,u,flute,rho,thExit:Math.PI/2-alpha,surfSpd:sp0,leftSphere:0});}
  }else if(sty==='bladeSlide'){
    for(let i=0;i<nl;i++){
      const onB=i%2===1,bDir=(onB?F.dirB:F.dirA).clone(),bEdge=(onB?F.edgeB:F.edgeA).clone(),tipDist=onB?(1.05-F.dB):(1.00-F.dA);
      const side=new THREE.Vector3().crossVectors(bDir,bEdge).normalize(),jit=bEdge.clone().multiplyScalar((r()-.5)*.06).addScaledVector(side,(r()-.5)*.06);
      const d=bDir.clone().add(jit).normalize(),sp0=lerp(12.5,16.5,r())*spdMul*RB_BOOST;
      const flick=bEdge.clone().multiplyScalar(onB?-.65:.65).addScaledVector(UP,.55).addScaledVector(side,(r()-.5)*.7).normalize();
      out.push({ti:1,T:TA,p:C.clone().addScaledVector(bDir,.015),v:d.multiplyScalar(sp0),drag:.14,life:Math.min(MAXT,lerp(.68,1.1,r())),w:.0016,heat:1,cool:lerp(.8,1.2,r()),
        g:0,delay:r()*.014,dist:0,bounces:0,ph:0,id:9000+i,bri:1.35,lk:1.3,leader:1,trail:[],rbMode:'bladeSlide',tipDist,slidOff:0,flick,
        postCurl:side.clone().multiplyScalar((r()<.5?-1:1)*lerp(6.5,10.5,r()))});}
  }else if(sty==='deflectCone'){
    const pU=F.S1.clone().normalize(),pV=ortho(F.edgeA.clone().negate().addScaledVector(TOCAM,.35),pU),pN=new THREE.Vector3().crossVectors(pU,pV).normalize();
    for(let i=0;i<nl;i++){
      const ang=lerp(-.92,.92,(i+.2+.6*r())/Math.max(1,nl)),d=pU.clone().multiplyScalar(Math.cos(ang)).addScaledVector(pV,Math.sin(ang)).addScaledVector(pN,(r()-.5)*.08).normalize();
      out.push({ti:1,T:TA,p:C.clone().addScaledVector(d,.01),v:d.multiplyScalar(lerp(6.4,9.6,r())*spdMul*RB_BOOST),drag:lerp(1.45,2.1,r()),life:Math.min(MAXT,lerp(.78,1.22,r())),w:.0016,heat:1,cool:lerp(.85,1.25,r()),
        g:1.15,delay:r()*.010,dist:0,bounces:0,ph:0,id:9000+i,bri:1.32,lk:1.3,leader:1,trail:[],rbMode:'deflectCone'});}
  }else if(sty==='vortexWrap'){
    const vAx=F.bis1.clone().multiplyScalar(.78).addScaledVector(TOCAM,.26).normalize(),ref=Math.abs(vAx.y)<.9?UP:V3(1,0,0);
    const u1=new THREE.Vector3().crossVectors(vAx,ref).normalize(),u2=new THREE.Vector3().crossVectors(vAx,u1).normalize(),spinSign=r()<.5?1:-1;
    for(let i=0;i<nl;i++){
      const ph=(i/nl)*6.2831853+r()*.35,rad=u1.clone().multiplyScalar(Math.cos(ph)).addScaledVector(u2,Math.sin(ph));
      const tang=new THREE.Vector3().crossVectors(vAx,rad).multiplyScalar(spinSign);
      const d=vAx.clone().multiplyScalar(lerp(.52,.78,r())).addScaledVector(tang,.68).addScaledVector(rad,.22).normalize();
      out.push({ti:1,T:TA,p:C.clone().addScaledVector(rad,.035),v:d.multiplyScalar(lerp(5.8,8.6,r())*spdMul*RB_BOOST),drag:lerp(.95,1.6,r()),life:Math.min(MAXT,lerp(.85,1.32,r())),w:.0016,heat:1,cool:lerp(.85,1.25,r()),
        g:.25,delay:r()*.012,dist:0,bounces:0,ph:0,id:9000+i,bri:1.35,lk:1.3,leader:1,trail:[],rbMode:'vortexWrap',vAx,vOrigin:C.clone(),vOmega:spinSign*lerp(15,22,r())});}
  }else if(sty==='groundSkim'){
    for(let i=0;i<nl;i++){
      const az=lerp(-2.5,2.5,(i+.25+.5*r())/Math.max(1,nl)),d=V3(Math.sin(az)*.62,-lerp(.78,.95,r()),Math.cos(az)*.52+.16).normalize();
      out.push({ti:1,T:TA,p:C.clone().addScaledVector(d,.015),v:d.multiplyScalar(lerp(10.5,14.8,r())*spdMul*RB_BOOST),drag:.55,life:Math.min(MAXT,lerp(.92,1.40,r())),w:.0017,heat:1,cool:lerp(.95,1.35,r()),
        g:1.8,delay:r()*.010,dist:0,bounces:0,ph:0,id:9000+i,bri:1.36,lk:1.3,leader:1,trail:[],rbMode:'groundSkim',skimSign:(i%2?1:-1)*lerp(3.6,6.4,r())});}
  }else{
    for(let i=0;i<nl;i++){const ax=(i%2?F.S2:F.S1).clone().multiplyScalar(.8).addScaledVector(UP,.5).normalize(),d=coneDir(r,ax,40);
      out.push({ti:1,T:TA,p:C.clone().addScaledVector(d,.01),v:d.multiplyScalar(lerp(5,8.5,r())*spdMul*RB_BOOST),drag:lerp(.85,1.7,r()),life:Math.min(MAXT,lerp(.8,1.3,r())),w:.0016,heat:1,cool:lerp(.8,1.2,r()),
        g:1,delay:r()*.012,dist:0,bounces:0,ph:0,id:9000+i,bri:1.3,lk:1.3,leader:1,trail:[],rbMode:'whip',curl:V3(r()-.5,r()-.5,r()-.5).normalize().multiplyScalar(lerp(2.5,5.5,r()))});}
  }
}
function spawnSparks(P,seed){const s=P.sparks,r=rng(hash(seed,s.seed,101)),L=lobes(s.style),out=[];
  sparkTiers(s).forEach((T,ti)=>{if(!s.on)return;for(let i=0;i<T.count;i++){let x=r(),lob=L[L.length-1];for(const l of L){if(x<l[1]){lob=l;break;}x-=l[1];}
    const d=coneDir(r,lob[0],T.cone*lob[2]),sp=lerp(T.speed[0],T.speed[1],Math.pow(r(),ti===0?.6:1.4));
    out.push({ti,T,p:C.clone().addScaledVector(d,.01),v:d.multiplyScalar(sp),drag:R2(r,T.drag),life:Math.min(MAXT,R2(r,T.life)),w:R2(r,T.width),heat:R2(r,T.heat),cool:R2(r,T.cool),
      g:T.gravity*(s.style==='rain'?1.4:1),delay:ti===1?r()*.018:ti===0?Math.pow(r(),2)*.03:0,dist:0,bounces:0,ph:r()*100,id:i,bri:lerp(.45,1.25,r()),lk:ti===0?lerp(.5,2.4,Math.pow(r(),2.2)):lerp(.55,1.7,Math.pow(r(),1.5))});}});
  spawnRibbonLeaders(P,rng(hash(seed,s.seed,505)),out);
  return out;}
function spawnEmbers(P,seed){const e=P.ember||DEF.ember;if(!e.on)return [];const T=emberTier(e),r=rng(hash(seed,e.seed??25,102)),L=[[F.S1,.58,1],[F.S2,.28,1.05],[null,.14,1.2]],out=[];
  for(let i=0;i<T.count;i++){let x=r(),lob=L[L.length-1];for(const l of L){if(x<l[1]){lob=l;break;}x-=l[1];}
    const d=coneDir(r,lob[0],T.cone*lob[2]),sp=lerp(T.speed[0],T.speed[1],Math.pow(r(),1.25));
    out.push({ti:2,T,p:C.clone().addScaledVector(d,.01),v:d.multiplyScalar(sp),drag:R2(r,T.drag),life:Math.min(MAXT,R2(r,T.life)),w:R2(r,T.width),heat:R2(r,T.heat),cool:R2(r,T.cool),
      g:T.gravity,delay:r()*.012,dist:0,bounces:0,ph:r()*100,id:20000+i,bri:lerp(.65,1.35,r()),lk:1});}
  return out;}
function spawnDark(P,seed){const s=P.smoke,r=rng(hash(seed,s.seed,202)),spMul=Math.max(1,(P.sparks&&P.sparks.speed)||1),out=[];for(let i=0;i<Math.round(s.dark);i++){const d=coneDir(r,r()<.6?F.S1:F.S2,55);
  out.push({p:C.clone(),v:d.multiplyScalar(lerp(4.0,10.2,r())*spMul*.78),drag:lerp(2.0,3.6,r()),life:lerp(.35,.85,r()),w:lerp(.003,.006,r()),g:.8,dist:0,bounces:0});}return out;}
function spawnDebris(P,seed){const s=P.debris,r=rng(hash(seed,s.seed,303)),out=[];for(let i=0;i<Math.round(s.count);i++){const d=coneDir(r,r()<.55?F.S1:F.S2,55);
  out.push({p:C.clone(),v:d.multiplyScalar(lerp(2.4,7.6,r())*s.speed),drag:lerp(.95,2.1,r()),g:1,size:lerp(.0045,.008,r())*s.size,ax:V3(r()-.5,r()-.5,r()-.5).normalize(),spin:lerp(15,45,r())*(r()<.5?-1:1),dist:0,bounces:0,life:MAXT});}return out;}
const SPH_BAND=.14,SPH_DRAG_OUT=2.5,RB_BOOST=1.8,SPH_CUSHION=45;   // radians of the peel-off blend; drag after leaving the sphere
const _cv=new THREE.Vector3(),_nrm=new THREE.Vector3(),_tan=new THREE.Vector3(),MASK=new THREE.MeshBasicMaterial({color:0x000000});
function step(q,dt,bounce,gmul,simT){
  q.v.y-=gmul*q.g*dt;
  if(q.rbMode==='vortexWrap'){
    _nrm.subVectors(q.p,q.vOrigin);_nrm.addScaledVector(q.vAx,-_nrm.dot(q.vAx));
    const rl=_nrm.length();if(rl>1e-4){_nrm.divideScalar(rl);_tan.crossVectors(q.vAx,_nrm);
      const spd=q.v.length();q.v.addScaledVector(_nrm,-spd*2.8*dt).addScaledVector(_tan,q.vOmega*.32*dt);}
  }
  if(q.curl){_cv.crossVectors(q.v,q.curl);q.v.addScaledVector(_cv,dt);}
  const k=1/(1+q.drag*dt);q.v.multiplyScalar(k);
  const ox=q.p.x,oy=q.p.y,oz=q.p.z;q.p.addScaledVector(q.v,dt);
  if(q.rbMode==='sphereScatter'){
    // w = sphere adherence: 1 on the shell, fades 1->0 (smoothstep) across +-SPH_BAND around thetaExit.
    // Position is pulled to the shell and velocity projected onto the tangent plane (speed kept) by w,
    // gravity / drag / curl come in by (1-w): the leader leaves along its tangent with no corner.
    _nrm.subVectors(q.p,q.sc);const dl=_nrm.length();
    if(dl>1e-5){_nrm.divideScalar(dl);
      const th=Math.acos(clamp(-_nrm.dot(q.u),-1,1)),w=1-sstep(q.thExit-SPH_BAND,q.thExit+SPH_BAND,th);
      if(w>1e-4){q.p.copy(q.sc).addScaledVector(_nrm,lerp(dl,q.Rs,w));
        const spd=q.v.length(),vn=q.v.dot(_nrm);_tan.copy(q.v).addScaledVector(_nrm,-vn);
        if(_tan.lengthSq()>1e-10){_tan.setLength(lerp(spd,q.surfSpd,w));q.v.lerp(_tan,w);}}
      const o=1-w;q.leftSphere=w<1e-3?1:0;q.g=.52*o;q.drag=lerp(.02,SPH_DRAG_OUT,o);q.curl=o>1e-3&&q.postCurl?q.postCurl.clone().multiplyScalar(o):null;}
  }else if(q.rbMode==='bladeSlide'&&!q.slidOff&&q.dist>=q.tipDist){
    q.slidOff=1;const spd=q.v.length();q.v.addScaledVector(q.flick,spd*.46).multiplyScalar(.72);q.g=.75;q.drag=2.6;q.curl=q.postCurl;
  }
  if(q.rbMode==='sphereScatter'&&q.v.y<0){const h=Math.max(0,q.p.y-FLOOR-.03),vyMin=-SPH_CUSHION*h;   // floor cushion: vertical speed limited to -C*height (exponential glide-in, speed kept) instead of a hard corner
    if(q.v.y<vyMin){const spd=q.v.length();q.v.y=vyMin;const hz=Math.hypot(q.v.x,q.v.z);if(hz>1e-5){const f=Math.sqrt(Math.max(0,spd*spd-vyMin*vyMin))/hz;q.v.x*=f;q.v.z*=f;}}}
  if(q.p.y<FLOOR+.002){
    if(q.rbMode==='groundSkim'){
      q.p.y=FLOOR+.018;
      if(!q.bounces){const sp=Math.hypot(q.v.x,q.v.y,q.v.z)*.82,hl=Math.hypot(q.v.x,q.v.z)||1;q.v.x=q.v.x/hl*sp;q.v.z=q.v.z/hl*sp;q.v.y=.04;q.g=.05;q.drag=1.8;q.curl=V3(0,q.skimSign,0);q.bounces=1;}
      else if(q.v.y<0)q.v.y=0;
    }else if(q.rbMode==='sphereScatter'){
      q.p.y=FLOOR+.03;if(q.v.y<0)q.v.y=Math.max(.08,-q.v.y*.12);q.v.x*=.96;q.v.z*=.96;
    }else{
      q.p.y=FLOOR+.002+(FLOOR-q.p.y)*.2;if(q.v.y<0){q.v.y=-q.v.y*bounce*(q.bounces?.7:1);q.v.x*=.72;q.v.z*=.72;q.bounces++;if(q.cool)q.cool*=.75;}
      if(Math.abs(q.v.y)<.25){q.v.y=0;q.v.x*=1-6*dt;q.v.z*=1-6*dt;}
    }
  }
  q.dist+=Math.hypot(q.p.x-ox,q.p.y-oy,q.p.z-oz);}
// blackbody-ish cooling ramp: hot white -> gold -> orange-red -> out
function heatCol(h,HOT,MID,COOL,hdr){let c;if(h>.7){const k=(h-.7)/.3;c=[lerp(MID[0],HOT[0],k),lerp(MID[1],HOT[1],k),lerp(MID[2],HOT[2],k)];}
  else if(h>.32){const k=(h-.32)/.38;c=[lerp(COOL[0],MID[0],k),lerp(COOL[1],MID[1],k),lerp(COOL[2],MID[2],k)];}else{const k=h/.32;c=[COOL[0]*k,COOL[1]*k,COOL[2]*k];}
  const e=hdr*Math.pow(h,2.2)+2.6*h;return [c[0]*e,c[1]*e,c[2]*e];}

let simCache={key:'',tau:-1,parts:null,embers:null,dark:null,deb:null};
function simulate(P,seed,tau){
  const rb=P.ribbon||{},em=P.ember||DEF.ember;
  const key=JSON.stringify([seed,P.clash.pose||'cross',P.sparks,em,rb.on,rb.style||'whip',rb.count,rb.life,rb.sphereR,rb.sphereCone,P.smoke.dark,P.smoke.seed,P.debris]);
  let S=simCache;if(S.key!==key||tau<S.tau){S=simCache={key,tau:0,t:0,parts:P.sparks.on||rb.on?spawnSparks(P,seed):[],embers:em.on?spawnEmbers(P,seed):[],dark:P.smoke.on?spawnDark(P,seed):[],deb:P.debris.on?spawnDebris(P,seed):[]};}
  const s=P.sparks,gm=s.gravity,bo=s.bounce,rl=rb.life||.24;
  while(S.t+DT<=tau+1e-9){S.t+=DT;
    for(const q of S.parts){if(S.t<q.delay||S.t-q.delay>q.life)continue;step(q,DT,bo,gm,S.t);if(q.trail){q.trail.push([q.p.x,q.p.y,q.p.z,S.t]);while(q.trail.length&&S.t-q.trail[0][3]>rl)q.trail.shift();}}
    for(const q of S.embers){if(S.t<q.delay||S.t-q.delay>q.life)continue;step(q,DT,.35,1,S.t);}
    for(const q of S.dark){if(S.t>q.life)continue;step(q,DT,.2,gm,S.t);}
    for(const q of S.deb)step(q,DT,.32,gm,S.t);}
  S.tau=tau;return S;}

// ---------------- draw one frame of the effect at time-since-clash tau ----------------
function drawFX(P,seed,tau){
  const on=tau>=0&&tau<MAXT;const toCam=_a.subVectors(camera.position,C).normalize().clone();
  // 1a. 星芒 (purely star rays & pinpoint core)
  const s=P.star;starM.visible=glowM.visible=flashM.visible=false;light.intensity=0;
  if(on&&s.on){const rise=sstep(0,.012,tau),dec=Math.exp(-tau/(s.life*.38))*(tau<s.life*1.8?1:0),I=rise*dec;
    if(I>.002){const sc=s.size*(.5+.5*sstep(0,.02,tau))*(1+.35*tau/s.life);starM.visible=true;
      starM.position.copy(C).addScaledVector(toCam,.06);starM.quaternion.copy(camera.quaternion);
      starM.rotateZ(hash(seed,s.seed)%628/100+tau*.6);starM.scale.setScalar(sc);
      const u=starM.material.uniforms;u.map.value=ensureStarTex(P);u.core.value.set(s.core);u.edge.value.set(s.edge);u.gain.value=s.hdr*I;u.pw.value=s.pow;}}
  // 1b. 打光 (standalone 3D PointLight + atmospheric soft halo glowM — completely independent of P.star.on)
  const lt=P.light||DEF.light;
  if(on&&lt.on){const rise=sstep(0,.012,tau),decS=Math.max(.01,lt.decay??.085),offZ=lt.offsetZ??.18,lcol=lt.color||s.edge||'#ffb060';
    light.position.copy(C).addScaledVector(toCam,offZ);light.distance=Math.max(.5,lt.range??6.5);
    light.color.set(lcol).lerp(new THREE.Color('#ffffff'),.32);
    light.intensity=(lt.intensity??16)*rise*Math.exp(-tau/decS)*(tau<Math.max(.55,decS*7.5)?1:0);
    const glAmt=lt.glow??.38;
    if(glAmt>.002){const gGain=(.16+.34*glAmt)*rise*Math.exp(-tau/Math.max(.045,decS*1.95));
      if(gGain>.0015){glowM.visible=true;glowM.position.copy(C).addScaledVector(toCam,Math.min(.14,offZ*.5));glowM.quaternion.copy(camera.quaternion);
        glowM.scale.setScalar((1.65+1.1*glAmt)*(lt.glowSize??1.0));glowM.material.uniforms.edge.value.set(lcol);glowM.material.uniforms.gain.value=gGain;}}}
  // 闪光: circular-base camera-facing impact flash (sphere / ripple / halo / corona / nebula / shatter / builtin / custom)
  const fl=P.flash||DEF.flash,flLife=Math.max(.02,fl.life??.14),flOp=fl.opacity??.68;
  if(on&&fl.on&&flOp>.001&&tau<flLife*1.75){
    const fade=sstep(0,.008,tau)*Math.pow(clamp(1-tau/(flLife*1.75),0,1),1.35);
    if(fade*flOp>.001){
      const ex=fl.expand??.55,grow=lerp(Math.max(.2,1-ex*.55),1+ex*.45,1-Math.exp(-tau/Math.max(.014,flLife*.42)));
      flashM.visible=true;flashM.position.copy(C).addScaledVector(toCam,.035);flashM.quaternion.copy(camera.quaternion);
      flashM.rotateZ((hash(seed,fl.seed??17)%628)/100+tau*(fl.spin||0));
      flashM.scale.setScalar((fl.size??1.05)*grow);
      const u=flashM.material.uniforms;u.map.value=ensureFlashTex(P);
      u.core.value.set(fl.core||'#fff9eb');u.color.value.set(fl.color||'#ffb85c');
      u.opacity.value=flOp;u.blur.value=clamp(fl.blur??.28,.02,.95);
      u.hollow.value=clamp(fl.hollow??0,0,.85);u.hdr.value=fl.hdr??9.5;u.fade.value=fade;
    }
  }
  // 1c. 十字光 (cross diamond needles along blade/clash axes)
  const nd=P.needles||DEF.needles,ndLife=Math.max(.02,nd.life??.075);
  if(on&&nd.on&&tau<ndLife*1.4){
    const fk=Math.exp(-tau/Math.max(.005,ndLife*.42));
    const grow=(.45+.55*sstep(0,.022,tau))*(1+.3*tau/ndLife);
    const thin=Math.pow(clamp(1-tau/(ndLife*1.4),0,1),.6);
    const ncol=lin(nd.color||'#ffc266'),nhdr=(nd.hdr??28)*fk;
    const axes=[F.dirA,F.dirB,F.bis2,F.bis1],lmul=[1,.62,.42,.32],cnt=clamp(Math.round(nd.count||2),1,4);
    const baseLen=nd.len??2.45,wr=nd.width??.0022,spr=nd.spread??22;
    for(let i=0;i<cnt;i++){
      const jit=i>0?((hash(seed,nd.seed??15,i)%40)-20):0;
      const axW=axes[i%axes.length].clone().applyAxisAngle(toCam,(spr+jit)*Math.PI/180).normalize();
      const lm=lmul[i%lmul.length],segL=baseLen*lm*grow,ctr=_a.copy(C).addScaledVector(toCam,.04);
      let hw=baseLen*lm*wr*thin,cs=1;
      const mnHw=.75*PXK*camera.position.distanceTo(ctr);if(hw<mnHw&&mnHw>1e-6){cs=hw/mnHw;hw=mnHw;}
      const p0=ctr.clone().addScaledVector(axW,-segL*.5),p1=ctr.clone().addScaledVector(axW,segL*.5);
      const n1=new THREE.Vector3().crossVectors(axW,toCam);if(n1.lengthSq()<1e-5)n1.crossVectors(axW,UP);n1.normalize();
      const n2=new THREE.Vector3().crossVectors(axW,n1).normalize();
      const qc=[ncol[0]*nhdr*cs,ncol[1]*nhdr*cs,ncol[2]*nhdr*cs,1];
      qPush(ADD,p0.clone().addScaledVector(n1,-hw),p0.clone().addScaledVector(n1,hw),p1.clone().addScaledVector(n1,hw),p1.clone().addScaledVector(n1,-hw),qc,qc,1,[-1,0,1,0,1,1,-1,1]);
      qPush(ADD,p0.clone().addScaledVector(n2,-hw),p0.clone().addScaledVector(n2,hw),p1.clone().addScaledVector(n2,hw),p1.clone().addScaledVector(n2,-hw),qc,qc,1,[-1,0,1,0,1,1,-1,1]);
    }
  }
  // 火星 + 铁水 + 拖尾丝 + dark sparks + shards
  const sp=P.sparks,HOT=lin(sp.hot),MID=lin(sp.mid),COOL=lin(sp.cool),em=P.ember||DEF.ember,rb=P.ribbon||DEF.ribbon;
  if(on&&(sp.on||em.on||rb.on||P.smoke.on||P.debris.on)){const S=simulate(P,seed,tau);
    if(em.on){const EH=lin(em.hot||sp.hot),EM=lin(em.mid||sp.mid),EC=lin(em.cool||sp.cool),emFl=Math.round(clamp(em.flicker??.18,0,.6)*100),emHdr=(em.hdr??12)*1.15;
      for(const q of S.embers){const age=tau-q.delay;if(age<0||age>q.life)continue;const flk=hash(q.id,Math.floor(tau*34))%100<emFl;if(flk)continue;const h=q.heat*Math.exp(-age/q.cool),fade=sstep(q.life,q.life*.72,age),c=heatCol(Math.max(h,.16),EH,EM,EC,emHdr*q.bri);speck(ADD,q.p,q.w,[c[0],c[1],c[2],fade]);}}
    for(const q of S.parts){const age=tau-q.delay;if(age<0||age>q.life)continue;const h=q.heat*Math.exp(-age/q.cool),fade=sstep(q.life,q.life*.75,age);
      const c=heatCol(h,HOT,MID,COOL,sp.hdr*(q.ti===0?lerp(2.4,1,sstep(.05,.55,q.dist)):1.6)*q.bri),spd=q.v.length();if(spd<1e-4&&q.ti!==1)continue;
      const L=Math.min(q.T.maxLen*q.lk,Math.max(.014,spd*q.T.streak*q.lk),q.dist+.004);_a.copy(q.p).addScaledVector(q.v,-L/Math.max(spd,1e-4));
      const fb=q.bounces?1.6:1;if(q.bounces)speck(ADD,q.p,q.w*2.2,[c[0]*.5,c[1]*.5,c[2]*.5,fade]);   // a glowing bead where it skitters on the floor
      if(sp.on||q.leader)streak(ADD,_a,q.p,q.w*fb*(q.ti===0?1:(.6+.6*h))*(1.25-.35*q.lk),[c[0]*fb,c[1]*fb,c[2]*fb,fade*sstep(0,.05,q.dist)],0);   // no additive pile-up at the spawn point
      if(q.trail&&rb.on&&q.trail.length>2){const RC=lin(rb.color),n=q.trail.length;
        let prevL=null,prevR=null,prevC=null;
        for(let j=0;j<n;j++){const Pj=q.trail[j],kj=j/(n-1),ag=clamp(1-(tau-Pj[3])/rb.life,0,1);
          let wj=rb.width*Math.pow(kj,.8)*.5,ej=rb.hdr*(.1+h*h)*ag*fade;
          _t1.set(Pj[0],Pj[1],Pj[2]);
          const Pa=q.trail[Math.max(0,j-1)],Pb=q.trail[Math.min(n-1,j+1)];
          _s.set(Pb[0]-Pa[0],Pb[1]-Pa[1],Pb[2]-Pa[2]);_v.subVectors(camera.position,_t1);
          const mnR=.8*PXK*_v.length();if(wj<mnR&&wj>1e-6){ej*=wj/mnR;wj=mnR;}
          _t2.crossVectors(_s,_v);if(_t2.lengthSq()<1e-10){prevL=null;continue;}_t2.normalize();
          const curL=new THREE.Vector3().copy(_t1).addScaledVector(_t2,-wj),curR=new THREE.Vector3().copy(_t1).addScaledVector(_t2,wj),curC=[RC[0]*ej,RC[1]*ej,RC[2]*ej,1];
          if(prevL)qPush(ADD,prevL,prevR,curR,curL,prevC,curC,3,[-1,0,1,0,1,1,-1,1]);
          prevL=curL;prevR=curR;prevC=curC;}}}
    if(P.smoke.on){const dc=lin(P.smoke.color);for(const q of S.dark){if(tau>q.life)continue;const spd=q.v.length(),L=Math.min(.18,Math.max(.015,spd*.03),q.dist+.003);_a.copy(q.p).addScaledVector(q.v,-L/Math.max(spd,1e-4));
      streak(DARK,_a,q.p,q.w,[dc[0],dc[1],dc[2],.85*sstep(q.life,q.life*.6,tau)],0);}}
    debrisM.count=0;if(P.debris.on){const HC=heatCol(.95,HOT,MID,COOL,10),tp=new THREE.Vector3();const m=new THREE.Matrix4(),qq=new THREE.Quaternion(),sc=new THREE.Vector3();for(const q of S.deb){const k=sstep(MAXT,MAXT-.4,tau);
      qq.setFromAxisAngle(q.ax,q.spin*Math.min(tau,.35+tau*.2*(q.bounces?0:1)));sc.setScalar(q.size*k);m.compose(q.p,qq,sc);debrisM.setMatrixAt(debrisM.count++,m);
      const ht=Math.exp(-tau/.3);if(ht>.03){tp.set(q.size*2.8*k,0,0).applyQuaternion(qq).add(q.p);speck(ADD,tp,.0026,[HC[0]*ht,HC[1]*ht,HC[2]*ht,1]);}}debrisM.instanceMatrix.needsUpdate=true;}}   // heat only on the fractured tip
  else debrisM.count=0;
  qFlush(ADD);qFlush(DARK);
  // 暗烟: translucent dark puffs with a dissolving fbm edge (never an opaque plate)
  const sm=P.smoke;let ns=0;if(on&&sm.on){const r=rng(hash(seed,sm.seed,404)),u=smokeB.m.material.uniforms,useTex=sm.tex?getBuiltin(sm.tex):null;
    u.noiseT.value=ensureNoise(sm.seed);u.maskT.value=useTex;u.useMask.value=useTex?1:0;u.warm.value.set((P.light&&P.light.color)||P.star.edge).multiplyScalar(.55);
    const n=useTex?Math.max(1,Math.round(sm.count/4)):Math.round(sm.count),PP=smokeB.g.attributes.position.array,PD=smokeB.g.attributes.pd.array,PC=smokeB.g.attributes.pc.array,dc=lin(sm.color);
    const cr=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),cu=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
    for(let i=0;i<n&&ns<smokeB.max;i++){const ink=sm.style==='ink',wisp=sm.style==='wisp',puff=!ink&&!wisp;const d=coneDir(r,r()<.55?F.S1:F.S2,ink?60:50),spd=ink?lerp(3.2,7.0,r()):wisp?lerp(2.0,4.4,r()):lerp(1.2,3.2,r()),life=lerp(.35,.7,r())*sm.life*(useTex?1.2:1)*(ink?1.15:1),s0=lerp(.2,.36,r())*sm.size*(useTex?2.6:1)*(wisp?.7:1);
      const ox=r(),oy=r(),rot=r()*6.283,del=r()*.03;const age=tau-del;if(age<0||age>life)continue;const k=age/life;
      const p=C.clone().addScaledVector(d,.03).addScaledVector(UP,age*(sm.rise||0)),sz=s0*(.55+1.5*Math.pow(k,.5));   // in place: centre fixed (spd only kept for RNG order)
      let ca=Math.cos(rot+age*.4),sa=Math.sin(rot+age*.4),st=1;if(!puff&&!useTex){ca=d.dot(cr);sa=d.dot(cu);const l=Math.hypot(ca,sa)||1;ca/=l;sa/=l;st=ink?2.6:3.2;}   // ink / wisp tear away stretched along their flight
      const ax=cr.clone().multiplyScalar(ca*sz*st).addScaledVector(cu,sa*sz*st),ay=cr.clone().multiplyScalar(-sa*sz*(st>1?.42:1)).addScaledVector(cu,ca*sz*(st>1?.42:1));
      const c=[p.clone().sub(ax).sub(ay),p.clone().add(ax).sub(ay),p.clone().add(ax).add(ay),p.clone().sub(ax).add(ay)];
      for(let j=0;j<4;j++){PP.set([c[j].x,c[j].y,c[j].z],ns*12+j*3);PD.set([ox,oy+age*.05,lerp(.12,.95,Math.pow(k,.8))*(ink?.9:1),sm.opacity*sstep(0,.06,age)],ns*16+j*4);PC.set([...dc,Math.exp(-age/.3)],ns*16+j*4);}ns++;}}
  smokeB.g.setDrawRange(0,ns*6);smokeB.g.attributes.position.needsUpdate=smokeB.g.attributes.pd.needsUpdate=smokeB.g.attributes.pc.needsUpdate=true;
  // 热浪: offsets only (drawn into refrRT), the colour of the frame is untouched
  const rf=P.refr;refrPass.uniforms.on.value=0;heatOn=0;
  if(on&&rf.on&&tau<rf.life){const k=tau/rf.life,u=refrQ.material.uniforms;u.mode.value=rf.tex?3:{ring:0,bulge:1,double:2,ripple:4}[rf.style]||0;u.waves.value=rf.waves||3;u.tex.value=rf.tex?getBuiltin(rf.tex):null;
    u.R.value=rf.tex?lerp(.3,1,easeOut(k)):lerp(.08,.9,easeOut(k));u.wid.value=lerp(.05,.14,k);u.fade.value=Math.pow(1-k,1.4)*sstep(0,.015,tau);u.amt.value=rf.amt;
    refrQ.position.copy(C);refrQ.quaternion.copy(camera.quaternion);refrQ.scale.setScalar(rf.radius*2);heatOn=rf.scope==='behind'?1:2;refrPass.uniforms.on.value=heatOn===1?1:0;}
}
// one full frame at sim time t inside the cycle
let heatOn=0;   // 0 off, 1 legacy (bg only, blades masked), 2 whole frame
function renderAt(P,t,cycleIdx=0,opt={}){
  const seed=hash(P.seed,cycleIdx);const k=poseWeapons(t,P);const tau=t-T0;
  if(!opt.rec)controls.update();const cp=camera.position.clone();   // rec: no orbit re-solve (it drifts by an ulp per call)
  if(P.clash.shake&&tau>=0&&tau<.25&&!opt.noShake){const a=P.clash.shake*.006*Math.exp(-tau/.06);camera.position.x+=a*Math.sin(tau*260);camera.position.y+=a*Math.cos(tau*310);}
  camera.updateMatrixWorld();PXK=2*Math.tan(camera.fov*Math.PI/360)/Math.max(1,renderer.getDrawingBufferSize(_dbs).y);drawFX(P,seed,tau);   // billboards read the camera matrix: refresh it after the shake
  if(heatOn){renderer.setRenderTarget(refrRT);renderer.setClearColor(0x000000,0);renderer.clear();renderer.render(refrScene,camera);renderer.setRenderTarget(null);}
  heatPass.enabled=heatOn===2;heatPass.uniforms.tRefr.value=refrRT.texture;
  if(heatOn===1){renderer.setRenderTarget(refrRT);
    // legacy scope 'behind': blades stay rigid: write zero offset over them (layer 2 = weapons)
    const bg=scene.background,fg=scene.fog;scene.background=null;scene.fog=null;scene.overrideMaterial=MASK;camera.layers.set(2);renderer.autoClear=false;renderer.render(scene,camera);
    renderer.autoClear=true;camera.layers.set(0);scene.overrideMaterial=null;scene.background=bg;scene.fog=fg;renderer.setRenderTarget(null);refrPass.uniforms.tRefr.value=refrRT.texture;}
  if(stageState.theme==='klein'){renderer.setRenderTarget(kleinBgRT);renderer.setClearColor(0x000000,1);renderer.clear();renderer.render(kleinScene,camera);renderer.setRenderTarget(null);
    kleinPass.uniforms.tKleinBg.value=kleinBgRT.texture;kleinPass.uniforms.tRefr.value=refrRT.texture;kleinPass.uniforms.refrOn.value=heatOn===1?1:0;renderer.setClearColor(0x000000,0);}
  composer.render();camera.position.copy(cp);return k;}
function project(p){const v=p.clone().project(camera);const c=renderer.domElement;return [(v.x*.5+.5)*c.width,(1-(v.y*.5+.5))*c.height];}

// ---------------- recipe (engine-neutral, see docs/SPEC_PARRY.md) ----------------
function tierLayers(P,sfxMeta,tx){
  tx=tx||{};const starTexPath=tx.star,flashTexPath=tx.flash;
  applyPose(P.clash.pose||'cross');const L=h=>lin(h).map(x=>+x.toFixed(5)),r3=v=>[+v.x.toFixed(4),+v.y.toFixed(4),+v.z.toFixed(4)];
  const nd=P.needles||DEF.needles,lt=P.light||DEF.light,fl=P.flash||DEF.flash,em=P.ember||DEF.ember,rb=P.ribbon||DEF.ribbon,sx=P.sfx||DEF.sfx,scOff=getSphereCenter(rb).sub(C);
  const bankInfo=(window.PARRY_AUDIO&&window.PARRY_AUDIO.getBankEntry?window.PARRY_AUDIO.getBankEntry(sx.grade):(window.PARRY_SFX_BANK||{})[sx.grade])||{name:'#'+sx.grade};
  const tierKey=P.tier==='normal'?'normal':'perfect';
  return {
    clash:{hitstopS:P.clash.hitstop,tremor:P.clash.tremor,shake:P.clash.shake,tremorHz:44},
    star:{enabled:!!P.star.on,texture:starTexPath||'textures/star.png',core:L(P.star.core),edge:L(P.star.edge),hdr:P.star.hdr,sizeM:P.star.size,lifeS:P.star.life,contrastPow:P.star.pow,
      curve:'gain = hdr * smoothstep(0,0.012,t) * exp(-t/(life*0.38)); size = sizeM*(0.5+0.5*smoothstep(0,0.02,t))*(1+0.35*t/life); camera facing, additive, no depth test',
      glow:{amount:lt.glow??.38,sizeMul:+((1.65+1.1*(lt.glow??.38))*(lt.glowSize??1)).toFixed(4),gain:'(0.16+0.34*amount)*smoothstep(0,0.012,t)*exp(-t/(decayS*1.95))'},
      light:{enabled:!!lt.on,intensity:lt.intensity??16,rangeM:lt.range??6.5,decayS:lt.decay??.085,color:L(lt.color||P.star.edge)}},
    needles:{enabled:!!nd.on,color:L(nd.color||'#ffc266'),lengthM:+(nd.len??2.45).toFixed(3),count:Math.round(nd.count??2),widthRatio:+(nd.width??.0022).toFixed(5),spreadDeg:+(nd.spread??22).toFixed(1),hdr:+(nd.hdr??28).toFixed(2),lifeS:+(nd.life??.075).toFixed(4),seed:nd.seed??15,axes:[r3(F.dirA),r3(F.dirB),r3(F.bis2),r3(F.bis1)],lengthMul:[1,.62,.42,.32]},
    light:{enabled:!!lt.on,color:L(lt.color||P.star.edge),intensity:lt.intensity??16,rangeM:lt.range??6.5,decayS:lt.decay??.085,offsetTowardsCamM:lt.offsetZ??.18,
      glow:{amount:lt.glow??.38,sizeMul:lt.glowSize??1.0,gain:'(0.16+0.34*amount)*smoothstep(0,0.012,t)*exp(-t/(decayS*1.95))'}},
    flash:{enabled:!!fl.on,style:fl.style||'sphere',texture:flashTexPath||'textures/flash.png',
      core:L(fl.core||'#fff9eb'),color:L(fl.color||'#ffb85c'),
      sizeM:+(fl.size??1.05).toFixed(4),opacity:+(fl.opacity??.68).toFixed(4),blur:+(fl.blur??.28).toFixed(4),
      hdr:+(fl.hdr??9.5).toFixed(3),lifeS:+(fl.life??.14).toFixed(4),
      expand:+(fl.expand??.55).toFixed(4),hollow:+(fl.hollow??0).toFixed(4),
      rings:Math.round(fl.rings??3),spin:+(fl.spin??0).toFixed(3),seed:fl.seed??17,
      curve:'fade = smoothstep(0,0.008,t) * (1 - t/(1.75*life))^1.35; scale = sizeM * lerp(max(0.2,1-0.55*expand), 1+0.45*expand, 1-exp(-t/max(0.014,0.42*life))); premultiplied circular billboard (One, OneMinusSrcAlpha), no depth test'},
    sparks:{enabled:!!P.sparks.on,texture:'textures/spark.png',style:P.sparks.style,hot:L(P.sparks.hot),mid:L(P.sparks.mid),cool:L(P.sparks.cool),hdr:P.sparks.hdr,gravity:P.sparks.gravity*(P.sparks.style==='rain'?1.4:1),floorBounce:P.sparks.bounce,
      lobes:lobes(P.sparks.style).map(([a,share,cm])=>({axis:a?r3(a):'any (upper-biased sphere)',share,coneMul:cm})),
      tiers:sparkTiers(P.sparks).map(T=>({...T,render:'velocity-aligned streak, length = clamp(speed*streak, 0.012, maxLen)'})),
      heat:'h = heat*exp(-age/cool); colour ramp hot (h>0.7) -> mid (0.32..0.7) -> cool -> black; emissive = hdr*h^2.2 + 2.6*h'},
    ember:{enabled:!!em.on,render:'camera-facing speck, alpha clip 0.3333',hot:L(em.hot||P.sparks.hot),mid:L(em.mid||P.sparks.mid),cool:L(em.cool||P.sparks.cool),hdr:em.hdr??12,gravity:em.gravity??3.6,floorBounce:.35,flicker:em.flicker??.18,seed:em.seed??25,
      tier:emberTier(em),
      heat:'h = heat*exp(-age/cool); colour ramp hot (h>0.7) -> mid (0.32..0.7) -> cool -> black; emissive = hdr*1.15*h^2.2 + 2.6*h'},
    ribbon:{enabled:!!rb.on,style:rb.style||'whip',leaders:rb.count,widthM:rb.width,trailS:rb.life,hdr:rb.hdr,color:L(rb.color),
      sphereRadiusM:+(rb.sphereR??.32).toFixed(3),sphereConeDeg:Math.round(rb.sphereCone??52),sphereOffset:r3(scOff),
      sphere:{frame:'defender',origin:'clash point',axes:'toDefender = normalize(horizontal(defenderPos - clashPos)) (web: horizontal(-bladeA)); up = +Y; side = normalize(cross(up,toDefender))',
        dirLocal:SPHERE_LOCAL.map(x=>+x.toFixed(5)),gapM:SPHERE_GAP,centerLocalM:SPHERE_LOCAL.map(x=>+(x*(clamp(+(rb.sphereR??.34),.15,.75)+SPHERE_GAP)).toFixed(4)),
        shellRadiusM:+(clamp(+(rb.sphereR??.34),.15,.75)+SPHERE_GAP).toFixed(4),launchSpeedMS:[15.5,19.4],launchSpeedMul:'sparks.speed',
        flight:'start at clash point with v = radDir*speed (tangent at apex). Each 240 Hz step: n = normalize(p - centre); theta = acos(-n.u); w = 1 - smoothstep(thetaExit-0.14, thetaExit+0.14, theta); p = centre + n*lerp(|p-centre|, shellRadius, w); v = lerp(v, tangent(v)*lerp(|v|,speed,w), w); gravity 0.52*(1-w); drag lerp(0.02, 2.5, 1-w); curl postCurl*(1-w). thetaExit = 90deg - alpha, alpha = clamp(rho*(0.8+0.28*flute)*sphereConeDeg, 0.05, 1.18 rad).'},
      leaderRule:'6 flight styles: whip | sphereScatter (invisible diverging sphere scattering rays radially across sphereConeDeg behind left defender) | bladeSlide | deflectCone | vortexWrap | groundSkim'},
    smoke:{enabled:!!P.smoke.on,motion:'in place: puff centres fixed at clash point (+0.03 m jitter), size = s0*(0.55+1.5*sqrt(age/life)), optional rise riseMS*age',riseMS:+(P.smoke.rise||0).toFixed(3),style:P.smoke.style,texture:tx.smoke||'textures/smoke.png',color:L(P.smoke.color),opacity:P.smoke.opacity,sizeMul:P.smoke.size,lifeMul:P.smoke.life,puffs:P.smoke.count,darkSparks:P.smoke.dark,blend:'alpha (translucent), dissolve threshold 0.12 -> 0.95 over life'},
    debris:{enabled:!!P.debris.on,count:P.debris.count,sizeMul:P.debris.size,speedMul:P.debris.speed,sizeM:[.004,.011],speedMS:[1.2,4.8],floorBounce:.32,material:'dark metal, lit'},
    refraction:{enabled:!!P.refr.on,style:P.refr.style,texture:P.refr.tex?(tx.refr||'textures/refraction.png'):null,strengthPx720:P.refr.amt,radiusM:P.refr.radius,lifeS:P.refr.life,waves:P.refr.waves||3,scope:P.refr.scope||'frame',
      center:'screen projection of the clash point',
      ripple:'front R(k)=lerp(.08,.9,easeOut(k)) and width w(k)=lerp(.05,.14,k) in units of radiusM (k=age/life); lam=1.6w; x=(R-r)/lam; h=sin(2*pi*x)*smoothstep(-.5,0,x)*(1-smoothstep(waves-.5,waves+.25,x))*exp(-.35*max(x,0)); offset=radialDir*h*strengthPx720*(1-k)^1.4*edge',
      note:'screen-space UV offset only, never adds colour; scope frame = last post pass over the finished image (blade, every FX layer, background)'},
    sfx:(sfxMeta&&sfxMeta.disabled)?{enabled:false,playMode:'random',grade:sx.grade||3,weight:+(sx.weight??.32).toFixed(3),resonance:+(sx.resonance??.24).toFixed(3),file:'',pool:[],note:'sfx pool empty for this tier: no audio exported'}:{enabled:!!sx.on,playMode:(sfxMeta&&sfxMeta.playMode)||'random',
      grade:sfxMeta&&sfxMeta.grade!=null?sfxMeta.grade:(sx.grade||3),label:sfxMeta&&sfxMeta.label?sfxMeta.label:(String(bankInfo.name||'').startsWith('#')?bankInfo.name:`#${sx.grade||3} ${bankInfo.name||''}`),
      weight:sfxMeta&&sfxMeta.weight!=null?sfxMeta.weight:+(sx.weight??.32).toFixed(3),resonance:sfxMeta&&sfxMeta.resonance!=null?sfxMeta.resonance:+(sx.resonance??.24).toFixed(3),
      file:(sfxMeta&&sfxMeta.file)||`audio/parry_${tierKey}.wav`,peakOffsetS:sfxMeta?sfxMeta.peakOffsetS:0.015,durationS:sfxMeta?sfxMeta.durationS:0.42,sampleRate:sfxMeta?sfxMeta.sampleRate:48000,
      pool:(sfxMeta&&Array.isArray(sfxMeta.pool)&&sfxMeta.pool.length)?sfxMeta.pool:[{file:`audio/parry_${tierKey}.wav`,grade:sx.grade||3,label:String(bankInfo.name||'').startsWith('#')?bankInfo.name:`#${sx.grade||3} ${bankInfo.name||''}`,weight:+(sx.weight??.32).toFixed(3),resonance:+(sx.resonance??.24).toFixed(3),peakOffsetS:sfxMeta?sfxMeta.peakOffsetS:0.015,durationS:sfxMeta?sfxMeta.durationS:0.42,sampleRate:sfxMeta?sfxMeta.sampleRate:48000}],
      syncRule:'pick randomly from sfx.pool (playMode: "random") on trigger; start playback at T_clash - variant.peakOffsetS (or seek to variant.peakOffsetS on zero-lead trigger) so acoustic peak hits at exact T0'}
  };
}
function tierTex(dual,tk){const o={};for(const k of ['star','flash','smoke','refr'])if(dual[k+'Tex'])o[k]=dual[k+'Tex'][tk];return o;}
function recipe(P,dual){
  applyPose(P.clash.pose||'cross');const r3=v=>[+v.x.toFixed(4),+v.y.toFixed(4),+v.z.toFixed(4)];
  const activeTier=P.tier==='normal'?'normal':'perfect';
  // root layer: engines (Godot/Unity/UE) load the root textures as the PERFECT-tier maps and tiers.normal.* as the normal ones,
  // so the root texture paths are always the perfect paths, whichever tier is being edited
  const tex=k=>dual&&dual.T&&dual[k+'Tex']?dual[k+'Tex'].perfect:(dual&&dual[k+'Tex']&&dual[k+'Tex'][activeTier]);
  const base=tierLayers(P,dual&&dual.sfx&&dual.sfx[activeTier],{star:tex('star'),flash:tex('flash'),smoke:tex('smoke'),refr:tex('refr')});
  const out={format:'xsxb-parry',version:1,generator:'XSXB-Slash 格挡',units:{length:'m',time:'s',color:'linear RGB, HDR multipliers separate'},
    seed:P.seed,tier:activeTier,manualSplit:!!(dual&&dual.manualSplit),
    frame:{note:'local frame of the effect: origin = clash point, +Y = world up. bladeA = left defender, bladeB = right attacker (unit vectors, from hilt towards the clash point). Rotate the whole frame so bladeA/bladeB match your weapons.',
      pose:F.pose,bladeA:r3(F.dirA),bladeB:r3(F.dirB),edgeA:r3(F.edgeA),sprayMain:r3(F.S1),spraySecondary:r3(F.S2),floorY:-C.y},
    ...base};
  if(dual&&dual.T){
    out.tiers={
      normal:{seed:dual.T.normal.seed,...tierLayers(dual.T.normal,dual.sfx&&dual.sfx.normal,tierTex(dual,'normal'))},
      perfect:{seed:dual.T.perfect.seed,...tierLayers(dual.T.perfect,dual.sfx&&dual.sfx.perfect,tierTex(dual,'perfect'))}
    };
  }
  return out;
}
// texture arrays for the export + live 2D compositor thumbnails
function texGreyFromImg(t,N){const im=t&&t.image;if(!im||!im.complete||!im.naturalWidth)return null;
  const c=document.createElement('canvas');c.width=c.height=N;const x=c.getContext('2d');x.drawImage(im,0,0,N,N);
  const d=x.getImageData(0,0,N,N).data,a=new Float32Array(N*N);for(let i=0;i<N*N;i++)a[i]=d[i*4]/255;return {a,w:N,h:N};}
function builtinGrey(key,N){return texGreyFromImg(getBuiltin(key),N);}
function exportTextures(P){const out={},fl=P.flash||DEF.flash;out.star=P.star.tex?null:{a:genStar(P.star.style,P.star.seed,P.star.rays,P.star.asym),w:256,h:256};
  const sp=new Float32Array(64*256);for(let y=0;y<256;y++)for(let x=0;x<64;x++){const u=Math.abs((x+.5)/32-1),v=1-(y+.5)/256;let a=1-u;a=a*a*(3-2*a);sp[y*64+x]=a*Math.pow(v,1.35)*sstep(1,.9,v);}out.spark={a:sp,w:64,h:256};
  out.flash=(fl.customSrc||fl.tex)?null:{a:genFlash(fl.style||'sphere',fl.seed??17,fl.rings??3,256),w:256,h:256};
  const n=genNoise(P.smoke.seed);out.smoke={a:n,w:128,h:128};return out;}
function texData(P){const out=exportTextures(P),fl=P.flash||DEF.flash;
  if(!out.star)out.star=builtinGrey(P.star.tex,256)||{a:genStar(P.star.style,P.star.seed,P.star.rays,P.star.asym),w:256,h:256};
  if(!out.flash){const cf=fl.customSrc?texGreyFromImg(getCustomTex(fl.customSrc),256):null;
    out.flash=cf||(fl.tex?builtinGrey(fl.tex,256):null)||{a:genFlash(fl.style||'sphere',fl.seed??17,fl.rings??3,256),w:256,h:256};}
  if(P.smoke.tex){const bs=builtinGrey(P.smoke.tex,128);if(bs)out.smoke=bs;}
  return out;}

return {init,get ready(){return ready;},get renderer(){return renderer;},get camera(){return camera;},get controls(){return controls;},get scene(){return scene;},get bloom(){return bloom;},
  get stageTheme(){return stageState.theme;},setStageTheme,
  get _dbg(){return {smokeB,ADD,DARK,refrPass,heatPass,refrQ,kleinPass,kleinBgRT,debrisM,starM,glowM,flashM,light,simulate,SPHERE_LOCAL,sphereDir,get SPHERE_DIR(){return sphereDir();},getSphereCenter};},DEF,POSES,applyPose,clone,F,C,T0,CYCLE,hash,rng,renderAt,setCam,project,recipe,exportTextures,texData,genStar,genFlash,genNoise,loadWeapon,useDefaultWeapon,resize,W,lin,getBuiltin};
}
})();
