/* =========================================================================
   IL GABBIANO — prototipo di volo (Fase 1)
   Fisica di volo adattata da A Short Hike (Player.cs), portata in 2D laterale.

   Concetti ripresi (vedi ashorthike-decompiled/ANALISI-PLAYER.md):
   - FLAP: imposta vy verso l'alto (come jumpSpeed / UseFeather), consuma energia
   - STAMINA DI VOLO: al posto delle "piume". Si ricarica POSANDOSI a terra.
   - PLANATA: tenendo il flap, scambi QUOTA <-> VELOCITA'. Pichi -> acceleri e
     scendi; plani piatto -> rallenti e scendi poco. Drag bassissimo = voli lontano.
   - minGlideFallSpeed: discesa minima quando plani piatto.
   - Virata dolce in volo (glideTurnSpeed basso).
   Tutto deltaTime-based come il motore di Eddy.
   ========================================================================= */
'use strict';

// ----------------------------- costanti mondo -------------------------------
const VIEW_W = 960, VIEW_H = 460;
const WORLD_W = 4000;
const FPS_REF = 60;              // riferimento per normalizzare deltaTime

// ---- fisica base (valori ispirati a Player.cs, scalati al 2D pixel) --------
const GRAV            = 0.95;    // gravità quando NON plani (caduta normale)
const FLAP_VY         = -9.5;    // spinta verticale del flap (cfr jumpSpeed)
const FLAP_COST       = 0.22;    // energia consumata per flap (0..1)
const FLAP_COOLDOWN   = 0.18;    // s tra un flap e l'altro
const WALK_ACC        = 0.8;     // accelerazione orizzontale a terra
const AIR_TURN_ACC    = 0.35;    // "virata" orizzontale in volo (dolce)
const MOVE_MAX_GROUND = 4.0;     // vel. orizz. max a terra
const FRICTION_GROUND = 0.80;

// ---- planata (cuore della meccanica) ---------------------------------------
const GLIDE_DRAG       = 0.012;  // drag bassissimo in planata (cfr glideDrag=0.05)
const MAX_GLIDE_SPEED  = 12.0;   // tetto velocità in planata (cfr maxGlideSpeed)
const MIN_GLIDE_FALL   = 0.6;    // discesa minima planando piatto (cfr minGlideFallSpeed)
const MAX_DIVE_FALL    = 10.0;   // discesa massima in picchiata
const PITCH_SPEED      = 3.0;    // quanto rapido cambia l'angolo del muso
const GLIDE_GRAV       = 0.22;   // gravità "morbida" che alimenta lo scambio quota->vel
const GLIDE_HOLD_DELAY = 0.12;   // ritardo prima che la planata parta (cfr holdGlideButtonTime)
const GLIDE_STAMINA_DRAIN = 0.05;// planare consuma poca energia (al secondo)

// ---- stamina di volo -------------------------------------------------------
const STAMINA_REGEN    = 0.9;    // ricarica/s quando a terra (cfr staminaRegainSpeed)
const STAMINA_AIR_IDLE = 0.0;    // in aria senza planare: nessuna ricarica

// ---- termiche (updraft) - predisposte per Fase 2 ---------------------------
const UPDRAFT_FORCE    = 0.45;   // spinta verso l'alto dentro una termica

const rnd  = (a,b)=>Math.random()*(b-a)+a;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp =(a,b,t)=>a+(b-a)*t;

// terreno: altezza del suolo ad una data x del mondo (collina dolce)
function groundY(x){
  return 380
    + Math.sin(x*0.0016)*42
    + Math.sin(x*0.0005+1.3)*60;
}

// ----------------------------- LAGO (acqua + pesci) -------------------------
// Regione d'acqua (cfr WaterRegion.cs): superficie con onde sinusoidali.
const lake = { x0:1550, x1:2050, surfaceY:405, depth:140 };
function inLake(x){ return x>lake.x0 && x<lake.x1; }
// altezza del pelo dell'acqua a una x (piccole onde animate)
function waterY(x){
  return lake.surfaceY + Math.sin(x*0.03 + performance.now()*0.002)*2.5;
}

// pesci che nuotano nel lago (cfr FishShadow.cs)
const FISH_SPECIES = {
  trota:   { color:'#7a9460', belly:'#d7e0b0', fin:'#5c7347', spot:'#c0392b', value:120, label:'Trota' },
  carpa:   { color:'#c79350', belly:'#f0d9a8', fin:'#a06a2c', spot:'#8a5a2b', value:160, label:'Carpa' },
  dorata:  { color:'#f2c230', belly:'#fff1b0', fin:'#d99a1a', spot:'#ffffff', value:260, label:'Dorata' },
};
const fishes = [];
function spawnFish(){
  const keys=Object.keys(FISH_SPECIES);
  const sp=keys[Math.floor(Math.random()*keys.length)];
  const fromLeft=Math.random()<0.5;
  fishes.push({
    x: fromLeft ? lake.x0+10 : lake.x1-10,
    y: rnd(lake.surfaceY+25, lake.surfaceY+lake.depth-25),
    dir: fromLeft ? 1 : -1,
    speed: rnd(0.4,0.9),
    species: sp,
    wobble: rnd(0,6.28),
    size: sp==='dorata' ? 1.3 : 1,
    caught: false,
    spotted: false,   // avvistato dal gabbiano dall'alto
  });
}
// popola il lago con qualche pesce iniziale
for(let i=0;i<4;i++){ spawnFish(); fishes[i].x = rnd(lake.x0+40, lake.x1-40); }

// ----------------------------- NPC (animaletti + dialoghi) ------------------
// NPC che gironzolano (cfr WanderNPCMovement) e con cui si può parlare
// (cfr DialogueController). Alcuni danno indizi sui tesori.
const npcs = [
  { id:'lumaca', emoji:'\ud83d\udc0c', x:700, homeMin:640, homeMax:820, dir:1, speed:0.25,
    name:'Lumaca Lumi', color:'#b86fd0',
    lines:[ 'Ciao! Vai piano come me...','Ho visto una stella luccicare in cielo, lassù tra le nuvole!','Il gabbiano ci arriverà di sicuro.' ] },
  { id:'riccio', emoji:'\ud83e\udd94', x:2850, homeMin:2760, homeMax:2980, dir:-1, speed:0.5,
    name:'Riccio Spino', color:'#8a6a4a',
    lines:[ 'Brr, che fifa l\'acqua!','Dicono che i pesci dorati valgano un bel po\'.','Prova a tuffarti col gabbiano per pescarli!' ] },
  { id:'rana', emoji:'\ud83d\udc38', x:1600, homeMin:1560, homeMax:1640, dir:1, speed:0.35,
    name:'Rana Gina', color:'#4e9d3a',
    lines:[ 'Grac! Questo è il mio lago.','Se premi l\'interruttore laggiù con Eddy...','...si apre una corrente d\'aria calda per volare in alto!' ] },
].map(n=>({ ...n, y:0, talkCooldown:0, lineIdx:0, facing:n.dir }));
npcs.forEach(n=>{ n.y = groundY(n.x) - 24; });

// stato dialogo attivo
let activeDialogue = null;  // { npc, line, timer }

// ----------------------------- AUDIO (sintetizzato) -------------------------
const Sfx = (()=>{
  let ac=null, muted=false;
  const ensure=()=>{ if(!ac) ac=new (window.AudioContext||window.webkitAudioContext)(); return ac; };
  function play(notes,type='sine',vol=0.07){
    if(muted) return;
    try{ const c=ensure(); let t=c.currentTime;
      for(const [f,d] of notes){
        const o=c.createOscillator(), g=c.createGain();
        o.type=type; o.frequency.setValueAtTime(f,t);
        g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.0001,t+d);
        o.connect(g); g.connect(c.destination); o.start(t); o.stop(t+d); t+=d;
      }
    }catch(e){}
  }
  // --- vento di planata: rumore continuo filtrato, volume/pitch dinamici ---
  let windNode=null, windGain=null, windFilter=null;
  function ensureWind(){
    if(windNode) return;
    const c=ensure();
    // buffer di rumore bianco in loop
    const buf=c.createBuffer(1, c.sampleRate*2, c.sampleRate);
    const data=buf.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
    windNode=c.createBufferSource(); windNode.buffer=buf; windNode.loop=true;
    windFilter=c.createBiquadFilter(); windFilter.type='bandpass'; windFilter.frequency.value=600; windFilter.Q.value=0.7;
    windGain=c.createGain(); windGain.gain.value=0;
    windNode.connect(windFilter); windFilter.connect(windGain); windGain.connect(c.destination);
    windNode.start();
  }
  return {
    unlock: ensure,
    flap:  ()=>play([[520,0.05],[380,0.08]],'sine',0.06),
    land:  ()=>play([[300,0.05],[200,0.08]],'triangle',0.06),
    tired: ()=>play([[220,0.08],[160,0.12]],'sawtooth',0.05),
    chime: ()=>play([[784,0.06],[1047,0.06],[1319,0.14]],'sine',0.07),
    // intensità 0..1 (es. velocità di planata); pitch segue l'angolo
    setWind:(intensity, pitch)=>{
      if(muted){ if(windGain) windGain.gain.value=0; return; }
      ensureWind();
      const c=ensure();
      windGain.gain.setTargetAtTime(clamp(intensity,0,1)*0.12, c.currentTime, 0.1);
      windFilter.frequency.setTargetAtTime(400+pitch*900, c.currentTime, 0.1);
    },
  };
})();

// ----------------------------- il GABBIANO ----------------------------------
const gull = {
  x: 200, y: 0, w: 34, h: 24,
  vx: 0, vy: 0,
  facing: 1,            // 1 destra, -1 sinistra
  onGround: false,
  gliding: false,
  stamina: 1,           // 0..1 energia d'ali
  pitch: 0,             // -1 (muso su) .. +1 (picchiata), angolo di planata
  glideHoldTime: 0,     // da quanto tieni premuto il flap in aria
  flapCooldown: 0,
  flapAnim: 0,          // fase animazione ali
  walkCycle: 0,         // fase animazione camminata (zampe a terra)
  tiredFlash: 0,
  reset(){
    this.x=200; this.y=groundY(200)-this.h; this.vx=0; this.vy=0;
    this.facing=1; this.onGround=true; this.gliding=false;
    this.stamina=1; this.pitch=0; this.glideHoldTime=0; this.flapCooldown=0;
  }
};

// ----------------------------- EDDY (scoiattolo a terra) --------------------
// Platform classico: cammina, salta. Niente volo. Compagno del gabbiano.
const EDDY_GRAV   = 0.95;
const EDDY_JUMP   = -14;
const EDDY_ACC    = 1.0;
const EDDY_MAX    = 4.6;
const EDDY_FRICT  = 0.80;
// --- nuoto (cfr Player.cs swim/float) ---
const EDDY_WATER_GRAV  = 0.18;   // affonda lentamente (galleggiamento)
const EDDY_SWIM_UP     = -3.2;   // bracciata/risalita premendo su
const EDDY_SWIM_DOWN   = 3.0;    // scende premendo giù
const EDDY_SWIM_MAX_V  = 3.2;    // velocità max in acqua
const EDDY_WATER_DRAG  = 0.88;   // resistenza dell'acqua
const eddy = {
  x: 120, y: 0, w: 28, h: 44,
  vx: 0, vy: 0, facing: 1, onGround: false,
  runCycle: 0, jumping: false, swimming: false, swimCycle: 0,
  reset(){
    this.x=120; this.y=groundY(134)-this.h; this.vx=0; this.vy=0;
    this.facing=1; this.onGround=true; this.jumping=false; this.runCycle=0;
    this.swimming=false; this.swimCycle=0;
  }
};

// chi "guidi" adesso: 'gull' oppure 'eddy'
let active = 'gull';
let gameWon = false;

// stato globale + input
const cam = { x:0, y:0 };
const keys = {};
const updrafts = [
  { x:1200, y:120, w:140, h:320 },
  { x:2600, y:80,  w:160, h:380 },
  { x:3400, y:100, w:150, h:340 },
  // termica COOPERATIVA: spenta finché Eddy non preme l'interruttore
  { x:1980, y:70, w:150, h:360, coop:true, active:false },
];

// interruttore a terra che Eddy preme per attivare la termica cooperativa
const coopSwitch = { x:2300, y:0, w:34, h:14, pressed:false };
coopSwitch.y = groundY(coopSwitch.x+coopSwitch.w/2) - coopSwitch.h;

// ---- particelle (effetti reattivi allo stato, cfr PlayerEffects.cs) ----
const particles = [];   // {x,y,vx,vy,life,maxLife,color,size,kind}
const trail = [];       // scia delle ali in planata: {x,y,life}
function spawnDust(x,y,n,color){
  for(let i=0;i<n;i++) particles.push({
    x,y, vx:rnd(-1.4,1.4), vy:rnd(-2.2,-0.3),
    life:rnd(300,600), maxLife:600, color:color||'#cdbb97', size:rnd(2,4), kind:'dust'
  });
}
function spawnFeather(x,y){
  particles.push({ x,y, vx:rnd(-0.6,0.6), vy:rnd(-0.4,0.6), life:900, maxLife:900,
    color:'#ffffff', size:rnd(3,5), kind:'feather', spin:rnd(0,6.28), spd:rnd(-0.1,0.1) });
}

// ======================= STORE A TAG (cfr GlobalData.cs) =====================
// "Tutto è un tag osservabile": la UI si sottoscrive ai cambiamenti.
// Persistito in localStorage. Qui lo usiamo per i tesori raccolti.
const SAVE_KEY = 'eddy-seagull-save';
const Store = (()=>{
  let tags = {};
  const watchers = {};  // tag -> [callback]
  function load(){ try{ tags = JSON.parse(localStorage.getItem(SAVE_KEY))||{}; }catch(e){ tags={}; } }
  function save(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(tags)); }catch(e){} }
  load();
  return {
    get:(k)=> tags[k]||0,
    getBool:(k)=> !!tags[k],
    set:(k,v)=>{ tags[k]=v; save(); (watchers[k]||[]).forEach(cb=>cb(v)); },
    add:(k,n)=>{ tags[k]=(tags[k]||0)+n; save(); (watchers[k]||[]).forEach(cb=>cb(tags[k])); },
    watch:(k,cb)=>{ (watchers[k]||(watchers[k]=[])).push(cb); cb(tags[k]||0); },
    reset:()=>{ tags={}; save(); for(const k in watchers) watchers[k].forEach(cb=>cb(0)); },
    all:()=> ({...tags}),
  };
})();

// ----------------------------- TESORI ---------------------------------------
// kind: 'ground' (bassi -> per Eddy) o 'air' (alti -> per il gabbiano)
// Chi può raccoglierli dipende dall'altezza, ma per chiarezza li coloriamo.
const TREASURE_TYPES = {
  acorn:      { value:100, color:'#d99a2b', label:'Ghianda',  emoji:'🌰' },
  shell:      { value:150, color:'#f3c6d6', label:'Conchiglia', emoji:'🐚' },
  star:       { value:300, color:'#ffd43b', label:'Stella',   emoji:'⭐' },
  feather:    { value:250, color:'#eafaff', label:'Piuma d\'oro', emoji:'🪶' },
};
const treasures = [
  // --- tesori BASSI (Eddy, a terra) ---
  { id:'t1', x:420,  type:'acorn',  kind:'ground' },
  { id:'t2', x:980,  type:'shell',  kind:'ground' },
  { id:'t3', x:1750, type:'acorn',  kind:'ground' },
  { id:'t4', x:3050, type:'shell',  kind:'ground' },
  // --- tesori ALTI (gabbiano, in cielo/su picchi) ---
  { id:'t5', x:1260, y:150, type:'star',    kind:'air' },
  { id:'t6', x:2660, y:110, type:'feather', kind:'air' },
  { id:'t7', x:3460, y:140, type:'star',    kind:'air' },
  { id:'t8', x:2000, y:90,  type:'feather', kind:'air' },
].map(t=>({
  ...t,
  y: t.y!=null ? t.y : groundY(t.x)-30,   // i 'ground' stanno appena sopra il suolo
  bob: rnd(0,6.28),
  got: Store.getBool('TREASURE_'+t.id),   // ripristina da salvataggio
}));

const TREASURE_TOTAL = treasures.length;
function treasuresGot(){ return treasures.filter(t=>t.got).length; }
function scoreTotal(){
  return treasures.filter(t=>t.got).reduce((s,t)=>s+TREASURE_TYPES[t.type].value,0);
}

// popup di raccolta (cfr ItemPrompt)
const popups = [];  // {x,y,text,color,life,maxLife}
function addPopup(x,y,text,color){ popups.push({x,y,text,color:color||'#fff',life:1100,maxLife:1100}); }

// raccoglie un tesoro: aggiorna lo store (persistente) + feedback
function collectTreasure(t){
  if(t.got) return;
  t.got = true;
  Store.set('TREASURE_'+t.id, true);
  const tt = TREASURE_TYPES[t.type];
  addPopup(t.x, t.y-10, '+'+tt.value+' '+tt.label, tt.color);
  for(let i=0;i<10;i++) particles.push({ x:t.x,y:t.y, vx:rnd(-2,2),vy:rnd(-3,-0.5),
    life:rnd(300,600),maxLife:600,color:tt.color,size:rnd(2,4),kind:'dust' });
  Sfx.chime();
}

// elementi DOM
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const stateTxt = document.getElementById('stateTxt');
const speedTxt = document.getElementById('speedTxt');
const altTxt   = document.getElementById('altTxt');
const staminaBar = document.getElementById('staminaBar');
const staminaWrap= document.getElementById('staminaWrap');
const treasureTxt= document.getElementById('treasureTxt');

// ----------------------------- input ----------------------------------------
document.addEventListener('keydown', (e)=>{
  const k=e.key.toLowerCase();
  if(['arrowleft','arrowright','arrowup','arrowdown',' ','tab'].includes(k)) e.preventDefault();
  keys[k]=true; Sfx.unlock();
  if(k==='r'){ resetGame(); }
  if(k==='tab'){ switchCharacter(); }
  if(k==='e'){ const n=nearbyNPC(); if(n) talkToNPC(n); }   // parla con l'NPC vicino
});
document.addEventListener('keyup', (e)=>{ keys[e.key.toLowerCase()]=false; });

function isFlapKey(){ return keys[' ']||keys['w']||keys['arrowup']; }

// ----------------------------- SWITCH PERSONAGGIO ---------------------------
function switchCharacter(){
  if(gameWon) return;
  active = (active==='gull') ? 'eddy' : 'gull';
  Sfx.chime();
}

// ----------------------------- VITTORIA -------------------------------------
const overlay = document.getElementById('overlay');
function onVictory(){
  // melodia di vittoria
  Sfx.chime(); setTimeout(()=>Sfx.chime(),180); setTimeout(()=>Sfx.chime(),360);
  if(!overlay) return;
  overlay.style.display='flex';
  overlay.innerHTML =
    '<div style="font-size:34px;color:#ffe14d;text-shadow:2px 2px 0 #c0392b">🎉 TUTTI I TESORI RACCOLTI!</div>' +
    '<div style="font-size:16px;color:#dff">Eddy e il Gabbiano hanno completato l\'avventura insieme.</div>' +
    '<div style="font-size:18px;color:#ffe14d">Punteggio totale: '+scoreTotal()+'</div>' +
    '<div style="font-size:14px;color:#9fd3e7;margin-top:6px">Premi <b>R</b> per rigiocare</div>';
}
function resetGame(){
  gameWon=false;
  if(overlay) overlay.style.display='none';
  Store.reset();
  treasures.forEach(t=>t.got=false);
  const coop=updrafts.find(u=>u.coop); if(coop) coop.active=false;
  coopSwitch.pressed=false;
  activeDialogue=null;
  gull.reset(); eddy.reset();
  active='gull';
}

// ----------------------------- NPC ------------------------------------------
function updateNPCs(dt){
  const f=dt/(1000/FPS_REF), s=dt/1000;
  for(const n of npcs){
    if(n.talkCooldown>0) n.talkCooldown -= s;
    // gironzola avanti e indietro nella sua zona (cfr WanderNPCMovement)
    if(!activeDialogue || activeDialogue.npc!==n){
      n.x += n.dir*n.speed*f;
      if(n.x < n.homeMin){ n.x=n.homeMin; n.dir=1; }
      if(n.x > n.homeMax){ n.x=n.homeMax; n.dir=-1; }
      n.facing = n.dir;
    }
    n.y = groundY(n.x) - 24;
  }
  // avanzamento/chiusura dialogo
  if(activeDialogue){
    activeDialogue.timer -= dt;
    const a=(active==='gull')?gull:eddy;
    // se ti allontani troppo, chiudi
    if(Math.abs((a.x+a.w/2)-(activeDialogue.npc.x)) > 120) activeDialogue=null;
  }
}

// trova l'NPC vicino al personaggio attivo (per interagire)
function nearbyNPC(){
  const a=(active==='gull')?gull:eddy;
  const ax=a.x+a.w/2;
  for(const n of npcs){ if(Math.abs(ax-n.x)<50 && Math.abs((a.y+a.h)-(n.y+24))<70) return n; }
  return null;
}

// avvia o avanza il dialogo con un NPC
function talkToNPC(n){
  if(!activeDialogue || activeDialogue.npc!==n){
    activeDialogue = { npc:n, line:0, timer:6000 };
    n.facing = ((active==='gull'?gull.x:eddy.x) < n.x) ? -1 : 1;  // si gira verso di te
    Sfx.chime();
  } else {
    activeDialogue.line++;
    activeDialogue.timer = 6000;
    if(activeDialogue.line >= n.lines.length){ activeDialogue=null; }  // fine dialogo
  }
}

// ----------------------------- PESCI ----------------------------------------
function updateFishes(dt){
  const s=dt/1000, f=dt/(1000/FPS_REF);
  for(let i=fishes.length-1;i>=0;i--){
    const fish=fishes[i];
    if(fish.caught){ fishes.splice(i,1); continue; }
    fish.x += fish.dir*fish.speed*f;
    fish.wobble += s*3;
    fish.y += Math.sin(fish.wobble)*0.3*f;
    fish.y = clamp(fish.y, lake.surfaceY+20, lake.surfaceY+lake.depth-20);
    // avvistamento dal gabbiano: se vola basso sopra il lago, "illumina" i pesci
    if(active==='gull' && !gull.onGround){
      const gx=gull.x+gull.w/2;
      if(Math.abs(gx-fish.x)<60 && gull.y < lake.surfaceY && gull.y > lake.surfaceY-180){
        if(!fish.spotted){ fish.spotted=true; }
      }
    }
    // esce dal lago -> rimuovi e respawn
    if(fish.x < lake.x0-20 || fish.x > lake.x1+20){ fishes.splice(i,1); }
  }
  // mantieni ~4 pesci
  if(fishes.length < 4 && Math.random()<0.02) spawnFish();
}

// cattura i pesci vicino a un personaggio dentro/sopra l'acqua
function tryCatchFish(ch){
  const cx=ch.x+ch.w/2, cy=ch.y+ch.h/2;
  for(const fish of fishes){
    if(fish.caught) continue;
    if(Math.abs(cx-fish.x)<22 && Math.abs(cy-fish.y)<28){
      fish.caught=true;
      const sp=FISH_SPECIES[fish.species];
      Store.add('FISH_CAUGHT', 1);
      addPopup(fish.x, fish.y-10, '🐟 '+sp.label+' +'+sp.value, sp.color);
      for(let i=0;i<8;i++) particles.push({ x:fish.x,y:fish.y, vx:rnd(-2,2),vy:rnd(-3,-0.5),
        life:rnd(300,500),maxLife:500,color:'#a8ddf7',size:rnd(2,4),kind:'dust' });
      Sfx.chime();
      return true;
    }
  }
  return false;
}

// ----------------------------- UPDATE (dispatcher) --------------------------
function update(dt){
  const s = dt/1000;
  const f = dt/(1000/FPS_REF);
  // il personaggio ATTIVO riceve gli input; l'altro resta inerte (solo fisica)
  if(active==='gull'){ updateGull(dt, true);  updateEddyFollow(dt); }
  else              { updateEddy(dt, true);  updateGullFollow(dt); }
  // camera segue il personaggio attivo
  const a = (active==='gull') ? gull : eddy;
  cam.x = clamp(a.x - VIEW_W*0.42, 0, WORLD_W-VIEW_W);
  cam.y = clamp(a.y - VIEW_H*0.5, -200, 300);

  // ---- RACCOLTA TESORI: ENTRAMBI i personaggi possono raccogliere ----
  // (i tesori 'air' stanno in alto -> li prende il gabbiano; i 'ground' in
  //  basso -> li prende Eddy; ma non lo vincoliamo: conta la sovrapposizione)
  for(const ch of [gull, eddy]){
    const box={x:ch.x,y:ch.y,w:ch.w,h:ch.h};
    for(const t of treasures){
      if(t.got) continue;
      if(box.x < t.x+14 && box.x+box.w > t.x-14 && box.y < t.y+14 && box.y+box.h > t.y-14){
        collectTreasure(t);
      }
    }
  }

  // ---- NPC + dialoghi ----
  updateNPCs(dt);

  // ---- PESCI nel lago ----
  updateFishes(dt);
  // il gabbiano cattura i pesci tuffandosi (quando entra in acqua vicino a uno)
  if(active==='gull' && gull.y+gull.h > lake.surfaceY && inLake(gull.x+gull.w/2)){
    tryCatchFish(gull);
  }

  // ---- INTERRUTTORE COOPERATIVO ----
  // Eddy (solo lui, a terra) preme l'interruttore -> attiva la termica coop,
  // che permette al gabbiano di salire fino a un tesoro altrimenti irraggiungibile.
  const onSwitch = eddy.onGround &&
    eddy.x+eddy.w > coopSwitch.x && eddy.x < coopSwitch.x+coopSwitch.w &&
    Math.abs((eddy.y+eddy.h) - (coopSwitch.y+coopSwitch.h)) < 20;
  const coopThermal = updrafts.find(u=>u.coop);
  if(coopThermal){
    // latching: una volta premuto, l'interruttore RESTA attivo (single-player friendly)
    // così puoi premerlo con Eddy e poi passare al gabbiano per salire.
    if(onSwitch && !coopThermal.active){
      coopThermal.active=true; coopSwitch.pressed=true; Sfx.chime();
      addPopup(coopSwitch.x+coopSwitch.w/2, coopSwitch.y-20, 'TERMICA ATTIVATA!', '#8fd3ff');
    }
  }

  // ---- popup di raccolta ----
  for(const pu of popups){ pu.y -= 0.4*f; pu.life -= dt; }
  for(let i=popups.length-1;i>=0;i--) if(popups[i].life<=0) popups.splice(i,1);

  // ---- VITTORIA: tutti i tesori raccolti ----
  if(!gameWon && treasuresGot() >= TREASURE_TOTAL){ gameWon = true; onVictory(); }

  updateHUD();
}

// =================== FOLLOW: il compagno segue l'attivo =====================
// Così non devi mai tornare indietro a recuperarlo.
const FOLLOW_DIST = 70;        // distanza oltre la quale il compagno rincorre
const GULL_FOLLOW_H = 80;      // quota a cui il gabbiano vola sopra l'attivo

// Il GABBIANO segue (volando sopra) il personaggio attivo (Eddy).
function updateGullFollow(dt){
  const f=dt/(1000/FPS_REF), s=dt/1000;
  const target = eddy;                       // segue chi sta a terra
  const tx = target.x, ty = target.y - GULL_FOLLOW_H;
  const dx = tx - gull.x, dy = ty - gull.y;
  const dist = Math.hypot(dx,dy);
  gull.gliding = false;
  if(dist > FOLLOW_DIST){
    // vola verso il punto sopra l'attivo (moto fluido verso il target)
    gull.vx += clamp(dx*0.01, -0.5, 0.5)*f;
    gull.vy += clamp(dy*0.012, -0.6, 0.6)*f;
    if(Math.abs(dx)>4) gull.facing = dx<0?-1:1;
  } else {
    gull.vx *= Math.pow(0.9,f); gull.vy *= Math.pow(0.9,f);
  }
  gull.vx = clamp(gull.vx,-7,7); gull.vy = clamp(gull.vy,-7,7);
  gull.x += gull.vx*f; gull.y += gull.vy*f;
  gull.x = clamp(gull.x,0,WORLD_W-gull.w);
  // non sprofondare nel terreno
  const gy=groundY(gull.x+gull.w/2);
  if(gull.y+gull.h>gy){ gull.y=gy-gull.h; if(gull.vy>0) gull.vy=0; }
  gull.onGround=false;
  gull.flapAnim = (Math.abs(gull.vy)>0.5||Math.abs(gull.vx)>1.5) ? 1 : 0; // sbatte le ali se si muove
  gull.stamina = Math.min(1, gull.stamina + STAMINA_REGEN*0.5*s); // recupera lentamente mentre segue
}

// EDDY segue (correndo/saltando a terra) il personaggio attivo (gabbiano).
function updateEddyFollow(dt){
  const f=dt/(1000/FPS_REF);
  const target = gull;
  const dx = target.x - eddy.x;
  // corri verso l'attivo se troppo lontano orizzontalmente
  if(Math.abs(dx) > FOLLOW_DIST){
    eddy.vx += Math.sign(dx)*EDDY_ACC*0.9*f;
    eddy.facing = dx<0?-1:1;
    // salta se il gabbiano è più in alto e siamo a terra (per seguire su dislivelli)
    if(eddy.onGround && target.y < eddy.y-40 && Math.abs(dx)<160){ eddy.vy=EDDY_JUMP; eddy.onGround=false; eddy.jumping=true; }
  } else {
    eddy.vx *= Math.pow(EDDY_FRICT,f);
  }
  eddy.vx = clamp(eddy.vx,-EDDY_MAX,EDDY_MAX);
  const cx=eddy.x+eddy.w/2;
  const overWater = inLake(cx);
  // sopra il lago: galleggia a pelo d'acqua (nuota). Altrimenti gravità normale.
  if(overWater){ eddy.vy += EDDY_WATER_GRAV*2*f; eddy.vy=clamp(eddy.vy,-4,4); eddy.swimming=true; }
  else { eddy.vy += EDDY_GRAV*f; eddy.vy=clamp(eddy.vy,-20,18); eddy.swimming=false; }
  eddy.x += eddy.vx*f; eddy.x=clamp(eddy.x,0,WORLD_W-eddy.w);
  eddy.y += eddy.vy*f;
  if(overWater){
    // resta vicino alla superficie quando segue sopra il lago
    const surf = waterY(cx) - eddy.h*0.4;
    eddy.y = clamp(eddy.y, surf-4, lakeBottomY(cx)-eddy.h);
    if(eddy.y < surf) eddy.y += (surf-eddy.y)*0.1*f;
    eddy.onGround=false; eddy.swimCycle += 0.1*f;
  } else {
    const gy=groundY(cx);
    if(eddy.y+eddy.h>=gy){ eddy.y=gy-eddy.h; eddy.vy=0; eddy.onGround=true; eddy.jumping=false; }
    else eddy.onGround=false;
  }
  if(eddy.onGround && Math.abs(eddy.vx)>0.4) eddy.runCycle += Math.abs(eddy.vx)*(dt/1000)*7;
  else eddy.runCycle = 0;
}

// ----------------------------- UPDATE GABBIANO ------------------------------
let flapWasDown=false;

function updateGull(dt, controlled){
  const f = dt/ (1000/FPS_REF);     // fattore deltaTime (1 = 60fps)
  const s = dt/1000;                // secondi reali

  // rileva il "fronte" del tasto flap (press singola)
  const flapDown = controlled && isFlapKey();
  const flapPressed = flapDown && !flapWasDown;
  flapWasDown = flapDown;

  if(gull.flapCooldown>0) gull.flapCooldown -= s;
  if(gull.tiredFlash>0)   gull.tiredFlash   -= s;

  // ---- input orizzontale (vira) ----
  const left  = controlled && (keys['arrowleft']||keys['a']);
  const right = controlled && (keys['arrowright']||keys['d']);
  const acc = gull.onGround ? WALK_ACC : AIR_TURN_ACC;
  if(left){  gull.vx -= acc*f; gull.facing=-1; }
  if(right){ gull.vx += acc*f; gull.facing=1; }

  // ---- dentro una termica? (updraft) ----
  const cx = gull.x+gull.w/2, cyy = gull.y+gull.h/2;
  let inUpdraft=false, curUpdraft=null;
  for(const u of updrafts){
    if(u.coop && !u.active) continue;   // la termica cooperativa conta solo se attivata
    if(cx>u.x && cx<u.x+u.w && cyy>u.y && cyy<u.y+u.h){ inUpdraft=true; curUpdraft=u; break; }
  }

  // =================== FLAP (battito d'ali) ===================
  // come UseFeather + salto: imposta vy verso l'alto, consuma energia.
  if(flapPressed && gull.flapCooldown<=0){
    if(gull.stamina>0){
      gull.vy = Math.min(gull.vy, FLAP_VY);   // SetY(max up) come in Player.cs
      gull.stamina = Math.max(0, gull.stamina - FLAP_COST);
      gull.flapCooldown = FLAP_COOLDOWN;
      gull.flapAnim = 1;
      gull.onGround = false;
      gull.glideHoldTime = 0;
      Sfx.flap();
    } else {
      gull.tiredFlash = 0.3; Sfx.tired();   // niente energia: non puoi battere
    }
  }

  // =================== PLANATA ===================
  // Se sei in aria e TIENI premuto il flap (dopo un piccolo ritardo) -> plani.
  const airborne = !gull.onGround;
  if(airborne && flapDown){
    gull.glideHoldTime += s;
  } else {
    gull.glideHoldTime = 0;
  }
  gull.gliding = airborne && flapDown && gull.glideHoldTime >= GLIDE_HOLD_DELAY && gull.stamina>0;

  // angolo del muso (pitch): ↓ = picchiata (pitch->+1), nessun input = plani piatto
  let targetPitch = 0;
  if(gull.gliding){
    if(keys['arrowdown']||keys['s']) targetPitch = 1;       // picchi
    else if(inUpdraft)               targetPitch = -1;      // termica: muso su
    else                             targetPitch = 0.25;    // planata leggermente in discesa
  }
  gull.pitch = lerp(gull.pitch, targetPitch, clamp(s*PITCH_SPEED, 0, 1));

  // =================== FISICA VERTICALE ===================
  if(gull.gliding){
    // Scambio quota<->velocità: in picchiata guadagni vx e scendi; piatto rallenti.
    // vy "obiettivo" di discesa in base all'angolo (sin del pitch).
    const diveFall = lerp(MIN_GLIDE_FALL, MAX_DIVE_FALL, Math.max(0,gull.pitch));
    gull.vy += GLIDE_GRAV*f;
    gull.vy = Math.min(gull.vy, diveFall);               // cap discesa alla planata
    if(gull.pitch<0) gull.vy = Math.min(gull.vy, -0.5);  // muso su (updraft): lieve salita
    // conversione quota->velocità: se pichi, accelera in avanti
    if(gull.pitch>0.1){
      gull.vx += gull.facing * gull.pitch * 0.25 * f;
    }
    // drag bassissimo -> conservi slancio
    gull.vx *= Math.pow(1-GLIDE_DRAG, f);
    gull.vx = clamp(gull.vx, -MAX_GLIDE_SPEED, MAX_GLIDE_SPEED);
    // consumo lieve d'energia planando (ma NON dentro una termica)
    if(!inUpdraft) gull.stamina = Math.max(0, gull.stamina - GLIDE_STAMINA_DRAIN*s);
  } else if(airborne){
    // caduta normale (non plani): gravità piena
    gull.vy += GRAV*f;
    // attrito aria orizzontale leggero
    gull.vx *= Math.pow(0.985, f);
  } else {
    // a terra: attrito + clamp velocità camminata
    if(!left && !right) gull.vx *= Math.pow(FRICTION_GROUND, f);
    gull.vx = clamp(gull.vx, -MOVE_MAX_GROUND, MOVE_MAX_GROUND);
  }

  // spinta termica (updraft): sale gratis mentre sei dentro (cfr Updraft.cs)
  // - forza verso l'alto (upwardForce)
  // - attrazione verso il centro (inwardForce) -> salita "in spirale"
  // - NON consuma stamina: le termiche sono carburante gratuito
  if(inUpdraft && airborne && curUpdraft){
    gull.vy -= UPDRAFT_FORCE*f;
    gull.vy = Math.min(gull.vy, -2.2);               // salita GARANTITA mentre sei dentro
    const centerX = curUpdraft.x + curUpdraft.w/2;
    gull.vx += Math.sign(centerX - cx) * 0.12 * f;   // inwardForce (spirale)
    // le termiche RICARICANO l'energia d'ali (carburante gratuito)
    gull.stamina = Math.min(1, gull.stamina + 0.3*s);
  }

  gull.vy = clamp(gull.vy, -16, 16);

  // =================== INTEGRAZIONE POSIZIONE ===================
  gull.x += gull.vx*f;
  gull.x = clamp(gull.x, 0, WORLD_W-gull.w);
  gull.y += gull.vy*f;

  // collisione col terreno
  const gy = groundY(gull.x+gull.w/2);
  if(gull.y+gull.h >= gy){
    if(!gull.onGround && gull.vy>2){
      Sfx.land();
      spawnDust(gull.x+gull.w/2, gy, Math.min(14, 4+Math.round(gull.vy)), '#cdbb97'); // polvere atterraggio
    }
    gull.y = gy-gull.h;
    gull.vy = 0;
    gull.onGround = true;
    gull.gliding = false;
    gull.pitch = lerp(gull.pitch, 0, 0.5);
  } else {
    gull.onGround = false;
  }

  // =================== STAMINA ===================
  if(gull.onGround){
    gull.stamina = Math.min(1, gull.stamina + STAMINA_REGEN*s);
  }

  // animazione ali
  if(gull.flapAnim>0) gull.flapAnim = Math.max(0, gull.flapAnim - s*6);
  // ciclo di camminata (solo a terra, proporzionale alla velocità)
  if(gull.onGround && Math.abs(gull.vx)>0.3) gull.walkCycle += Math.abs(gull.vx)*s*6;
  else gull.walkCycle = 0;
  // piumetta ad ogni flap
  if(flapPressed && gull.stamina>0) spawnFeather(gull.x+gull.w*0.3, gull.y+gull.h*0.6);

  // =================== EFFETTI reattivi allo stato (cfr PlayerEffects.cs) ===================
  // scia delle ali SOLO in planata (come wingTrails attive se isGliding)
  if(gull.gliding && Math.abs(gull.vx)>2){
    trail.push({ x:gull.x+gull.w*0.2, y:gull.y+gull.h*0.5, life:260 });
  }
  for(let i=trail.length-1;i>=0;i--){ trail[i].life-=dt; if(trail[i].life<=0) trail.splice(i,1); }
  // particelle
  for(const p of particles){
    p.vy += (p.kind==='feather'?0.02:0.12)*f;
    p.x += p.vx*f; p.y += p.vy*f; p.life -= dt;
    if(p.kind==='feather'){ p.spin+=p.spd*f; p.vx += Math.sin(p.spin)*0.03*f; }
  }
  for(let i=particles.length-1;i>=0;i--) if(particles[i].life<=0) particles.splice(i,1);

  // audio del vento: intensità = velocità di planata; pitch = angolo del muso
  const windIntensity = gull.gliding ? clamp(Math.abs(gull.vx)/MAX_GLIDE_SPEED,0,1) : 0;
  Sfx.setWind(windIntensity, Math.max(0,gull.pitch));
  gull._inUpdraft = inUpdraft;   // per l'HUD
}

// ----------------------------- UPDATE EDDY ----------------------------------
function updateEddy(dt, controlled){
  const f = dt/(1000/FPS_REF);
  const left  = controlled && (keys['arrowleft']||keys['a']);
  const right = controlled && (keys['arrowright']||keys['d']);
  const up    = controlled && (keys['arrowup']||keys['w']);
  const down  = controlled && (keys['arrowdown']||keys['s']);
  const jump  = controlled && (keys[' ']||keys['arrowup']||keys['w']);

  const cx = eddy.x+eddy.w/2;
  // Eddy "nuota" se il centro corpo è dentro il lago e sotto il pelo dell'acqua
  const inWater = inLake(cx) && (eddy.y+eddy.h*0.5) > waterY(cx);

  // --- movimento orizzontale (più lento in acqua) ---
  let moving=false;
  const hAcc = inWater ? EDDY_ACC*0.7 : EDDY_ACC;
  if(left){  eddy.vx -= hAcc*f; eddy.facing=-1; moving=true; }
  if(right){ eddy.vx += hAcc*f; eddy.facing=1;  moving=true; }

  if(inWater){
    // ===== NUOTO (cfr Player.cs swim/float) =====
    eddy.swimming = true;
    if(!moving) eddy.vx *= Math.pow(EDDY_WATER_DRAG,f);
    eddy.vx = clamp(eddy.vx,-EDDY_SWIM_MAX_V,EDDY_SWIM_MAX_V);
    // verticale: su con ↑/SPAZIO, giù con ↓; altrimenti galleggia lentamente verso il basso
    if(up||jump)      eddy.vy += (EDDY_SWIM_UP - eddy.vy)*0.15*f;
    else if(down)     eddy.vy += (EDDY_SWIM_DOWN - eddy.vy)*0.15*f;
    else              eddy.vy += EDDY_WATER_GRAV*f;   // leggero affondamento
    eddy.vy = clamp(eddy.vy,-EDDY_SWIM_MAX_V,EDDY_SWIM_MAX_V);
    eddy.onGround=false; eddy.jumping=false;

    eddy.x += eddy.vx*f; eddy.x=clamp(eddy.x,0,WORLD_W-eddy.w);
    eddy.y += eddy.vy*f;
    // limite alla superficie (non saltar fuori dall'acqua nuotando) e al fondo del lago
    const topLimit = waterY(cx) - eddy.h*0.5;
    const botLimit = lakeBottomY(cx) - eddy.h;
    eddy.y = clamp(eddy.y, topLimit, botLimit);
    // pesca: Eddy cattura i pesci che tocca sott'acqua
    tryCatchFish(eddy);
    // animazione bracciata
    eddy.swimCycle += (0.1 + Math.abs(eddy.vx)*0.03 + Math.abs(eddy.vy)*0.03)*f;
    eddy.runCycle = 0;
    return;
  }

  // ===== A TERRA / IN ARIA (fisica platform) =====
  eddy.swimming = false;
  if(!moving) eddy.vx *= Math.pow(EDDY_FRICT,f);
  eddy.vx = clamp(eddy.vx,-EDDY_MAX,EDDY_MAX);

  if(jump && eddy.onGround){ eddy.vy=EDDY_JUMP; eddy.onGround=false; eddy.jumping=true; Sfx.flap(); }
  eddy.vy += EDDY_GRAV*f; eddy.vy=clamp(eddy.vy,-20,18);

  eddy.x += eddy.vx*f; eddy.x=clamp(eddy.x,0,WORLD_W-eddy.w);
  eddy.y += eddy.vy*f;
  // collisione col terreno; sopra il lago il "fondo" di appoggio è la superficie dell'acqua
  // (così Eddy non sprofonda a terra ma entra in acqua nuotando)
  const gy = inLake(cx) ? waterY(cx) : groundY(cx);
  if(eddy.y+eddy.h>=gy){
    if(inLake(cx)){ eddy.onGround=false; }  // toccata l'acqua -> inizia a nuotare al prossimo frame
    else { eddy.y=gy-eddy.h; eddy.vy=0; eddy.onGround=true; eddy.jumping=false; }
  } else eddy.onGround=false;

  if(eddy.onGround && Math.abs(eddy.vx)>0.4) eddy.runCycle += Math.abs(eddy.vx)*(dt/1000)*7;
  else eddy.runCycle = 0;
}

function updateHUD(){
  if(active==='gull'){
    let st = gull.onGround ? 'GABBIANO · A TERRA' : (gull.gliding ? 'GABBIANO · PLANATA ✈' : 'GABBIANO · IN VOLO');
    if(gull._inUpdraft) st += ' 🌀';
    stateTxt.textContent = st;
    speedTxt.textContent = Math.abs(gull.vx).toFixed(1);
    altTxt.textContent   = Math.max(0, Math.round(groundY(gull.x+gull.w/2) - (gull.y+gull.h)));
    staminaBar.style.width = Math.round(gull.stamina*100)+'%';
    staminaWrap.classList.toggle('low', gull.stamina<0.25);
    staminaWrap.style.opacity = 1;
  } else {
    stateTxt.textContent = eddy.swimming ? 'EDDY · NUOTA 🏊' : (eddy.onGround ? 'EDDY · A TERRA' : (eddy.jumping ? 'EDDY · SALTO' : 'EDDY · IN ARIA'));
    speedTxt.textContent = Math.abs(eddy.vx).toFixed(1);
    altTxt.textContent   = Math.max(0, Math.round(groundY(eddy.x+eddy.w/2) - (eddy.y+eddy.h)));
    staminaWrap.style.opacity = 0.25;   // Eddy non usa la stamina di volo
  }
  if(treasureTxt) treasureTxt.textContent = treasuresGot()+' / '+TREASURE_TOTAL;
}

// ============================= DISEGNO =======================================
function draw(){
  ctx.clearRect(0,0,VIEW_W,VIEW_H);
  drawSky();
  drawClouds();
  drawUpdrafts();
  drawGround();
  drawLake();
  drawSwitch();
  drawNPCs();
  drawTreasures();
  drawTrail();
  drawParticles();
  // disegna prima quello NON attivo, poi l'attivo sopra; indicatore sul controllato
  if(active==='gull'){ drawEddy(); drawGull(); drawActiveArrow(gull); }
  else              { drawGull(); drawEddy(); drawActiveArrow(eddy); }
  drawPopups();
  drawInteractHint();
  drawDialogue();
}

// NPC: animaletti (emoji su un corpo colorato) con nome
function drawNPCs(){
  ctx.textAlign='center';
  for(const n of npcs){
    const sx=n.x-cam.x, sy=n.y-cam.y;
    if(sx<-40||sx>VIEW_W+40) continue;
    // ombra
    ctx.fillStyle='rgba(0,0,0,.15)'; ctx.beginPath(); ctx.ellipse(sx,sy+24,13,3,0,0,6.28); ctx.fill();
    // corpo tondo colorato
    ctx.fillStyle=n.color; ctx.beginPath(); ctx.arc(sx,sy+10,13,0,6.28); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(sx-4,sy+6,5,0,6.28); ctx.fill();
    // emoji animaletto
    ctx.font='20px sans-serif'; ctx.fillText(n.emoji, sx, sy+17);
  }
}

// suggerimento "premi E per parlare" quando sei vicino a un NPC
function drawInteractHint(){
  if(activeDialogue) return;
  const n=nearbyNPC();
  if(!n) return;
  const sx=n.x-cam.x, sy=n.y-cam.y-18;
  const bob=Math.sin(performance.now()*0.006)*2;
  ctx.fillStyle='rgba(0,0,0,.65)'; roundRect(sx-30, sy-14+bob, 60, 18, 6); ctx.fill();
  ctx.fillStyle='#ffe14d'; ctx.font='bold 11px "Trebuchet MS",sans-serif'; ctx.textAlign='center';
  ctx.fillText('E  parla', sx, sy-1+bob);
}

// fumetto di dialogo
function drawDialogue(){
  if(!activeDialogue) return;
  const n=activeDialogue.npc;
  const text=n.lines[activeDialogue.line]||'';
  const sx=n.x-cam.x, sy=n.y-cam.y;
  ctx.font='13px "Trebuchet MS",sans-serif'; ctx.textAlign='left';
  const padding=10, maxW=300;
  const lines=wrapText(text, maxW-padding*2);
  const boxW=Math.min(maxW, Math.max(...lines.map(l=>ctx.measureText(l).width))+padding*2);
  const boxH=lines.length*16 + padding*2 + 16;
  let bx=sx-boxW/2, by=sy-30-boxH;
  bx=clamp(bx, 8, VIEW_W-boxW-8); by=clamp(by, 8, VIEW_H-boxH-8);
  // riquadro
  ctx.fillStyle='rgba(255,255,255,.96)'; roundRect(bx,by,boxW,boxH,10); ctx.fill();
  ctx.strokeStyle=n.color; ctx.lineWidth=3; roundRect(bx,by,boxW,boxH,10); ctx.stroke();
  // codina del fumetto verso l'NPC
  ctx.fillStyle='rgba(255,255,255,.96)'; ctx.beginPath();
  const tipX=clamp(sx,bx+14,bx+boxW-14);
  ctx.moveTo(tipX-7,by+boxH-1); ctx.lineTo(tipX+7,by+boxH-1); ctx.lineTo(sx,sy-26); ctx.closePath(); ctx.fill();
  // nome
  ctx.fillStyle=n.color; ctx.font='bold 12px "Trebuchet MS",sans-serif';
  ctx.fillText(n.name, bx+padding, by+padding+10);
  // testo
  ctx.fillStyle='#2a2a2a'; ctx.font='13px "Trebuchet MS",sans-serif';
  lines.forEach((l,i)=> ctx.fillText(l, bx+padding, by+padding+28+i*16));
  // hint avanzamento
  ctx.fillStyle='#999'; ctx.font='10px "Trebuchet MS",sans-serif'; ctx.textAlign='right';
  ctx.fillText('E \u25b8', bx+boxW-8, by+boxH-6);
}

// helper: riquadro arrotondato
function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}
// helper: wrap testo
function wrapText(text,maxW){
  const words=text.split(' '); const lines=[]; let cur='';
  for(const w of words){ const test=cur?cur+' '+w:w;
    if(ctx.measureText(test).width>maxW && cur){ lines.push(cur); cur=w; } else cur=test; }
  if(cur) lines.push(cur); return lines;
}

// ----------------------------- disegno TESORI -------------------------------
function drawTreasures(){
  for(const t of treasures){
    if(t.got) continue;
    const sx=t.x-cam.x, sy=t.y-cam.y+Math.sin(t.bob+performance.now()*0.003)*4;
    if(sx<-30||sx>VIEW_W+30) continue;
    const tt=TREASURE_TYPES[t.type];
    // alone
    ctx.globalAlpha=0.3; ctx.fillStyle=tt.color;
    ctx.beginPath(); ctx.arc(sx,sy,13,0,6.28); ctx.fill(); ctx.globalAlpha=1;
    // icona pixel per tipo
    if(t.type==='acorn'){
      ctx.fillStyle='#d99a2b'; ctx.fillRect(sx-6,sy-2,12,10);
      ctx.fillStyle='#7a4a1e'; ctx.fillRect(sx-7,sy-7,14,6); ctx.fillStyle='#5e3714'; ctx.fillRect(sx-1,sy-11,3,4);
    } else if(t.type==='shell'){
      ctx.fillStyle='#f3c6d6'; ctx.beginPath(); ctx.arc(sx,sy+4,8,Math.PI,0); ctx.fill();
      ctx.strokeStyle='#d98aa8'; ctx.lineWidth=1.5;
      for(let i=-2;i<=2;i++){ ctx.beginPath(); ctx.moveTo(sx,sy+4); ctx.lineTo(sx+i*3.5,sy-4); ctx.stroke(); }
    } else if(t.type==='star'){
      ctx.save(); ctx.translate(sx,sy); ctx.rotate(Math.sin(t.bob)*0.3); ctx.fillStyle='#ffd43b';
      ctx.beginPath(); for(let i=0;i<5;i++){ const a=-Math.PI/2+i*2*Math.PI/5;
        ctx.lineTo(Math.cos(a)*9,Math.sin(a)*9); const a2=a+Math.PI/5; ctx.lineTo(Math.cos(a2)*4,Math.sin(a2)*4); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    } else if(t.type==='feather'){
      ctx.save(); ctx.translate(sx,sy); ctx.rotate(-0.4); ctx.fillStyle='#ffe14d';
      ctx.beginPath(); ctx.ellipse(0,0,4,10,0,0,6.28); ctx.fill();
      ctx.strokeStyle='#d9a01a'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,-9); ctx.lineTo(0,9); ctx.stroke();
      ctx.restore();
    }
  }
}

function drawPopups(){
  ctx.save(); ctx.textAlign='center'; ctx.font='bold 15px "Trebuchet MS",sans-serif';
  for(const pu of popups){
    const sx=pu.x-cam.x, sy=pu.y-cam.y;
    if(sx<-60||sx>VIEW_W+60) continue;
    ctx.globalAlpha=Math.max(0,pu.life/pu.maxLife);
    ctx.lineWidth=3; ctx.strokeStyle='rgba(0,0,0,.6)'; ctx.strokeText(pu.text,sx,sy);
    ctx.fillStyle=pu.color; ctx.fillText(pu.text,sx,sy);
  }
  ctx.restore(); ctx.globalAlpha=1;
}

// freccia che indica il personaggio che stai controllando
function drawActiveArrow(ent){
  const sx=ent.x-cam.x+ent.w/2, sy=ent.y-cam.y-16;
  const bob=Math.sin(performance.now()*0.006)*3;
  ctx.fillStyle='#ffe14d'; ctx.strokeStyle='rgba(0,0,0,.4)'; ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(sx,sy+bob+8); ctx.lineTo(sx-6,sy+bob); ctx.lineTo(sx+6,sy+bob); ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function drawTrail(){
  for(const t of trail){
    const sx=t.x-cam.x, sy=t.y-cam.y;
    ctx.globalAlpha = (t.life/260)*0.4;
    ctx.fillStyle='#ffffff';
    ctx.beginPath(); ctx.arc(sx,sy,3,0,6.28); ctx.fill();
  }
  ctx.globalAlpha=1;
}

function drawParticles(){
  for(const p of particles){
    const sx=p.x-cam.x, sy=p.y-cam.y;
    if(sx<-20||sx>VIEW_W+20) continue;
    ctx.globalAlpha = clamp(p.life/p.maxLife,0,1);
    if(p.kind==='feather'){
      ctx.save(); ctx.translate(sx,sy); ctx.rotate(p.spin||0);
      ctx.fillStyle='#ffffff'; ctx.beginPath();
      ctx.ellipse(0,0,p.size,p.size*0.45,0,0,6.28); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle=p.color; ctx.fillRect(sx-p.size/2,sy-p.size/2,p.size,p.size);
    }
  }
  ctx.globalAlpha=1;
}

function drawSky(){
  const g=ctx.createLinearGradient(0,0,0,VIEW_H);
  g.addColorStop(0,'#7fc9f5'); g.addColorStop(0.55,'#a8ddf7'); g.addColorStop(1,'#d8f1ff');
  ctx.fillStyle=g; ctx.fillRect(0,0,VIEW_W,VIEW_H);
  // sole
  ctx.fillStyle='#fff6c8'; ctx.beginPath(); ctx.arc(VIEW_W-100,80,30,0,6.28); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,.45)'; ctx.beginPath(); ctx.arc(VIEW_W-100,80,44,0,6.28); ctx.fill();
}

const _clouds = Array.from({length:10}, ()=>({ x:rnd(0,WORLD_W), y:rnd(20,200), s:rnd(0.7,1.6) }));
function drawClouds(){
  for(const c of _clouds){
    const sx=c.x-cam.x*0.4, sy=c.y-cam.y*0.3, s=c.s;
    if(sx<-160||sx>VIEW_W+160) continue;
    ctx.fillStyle='rgba(255,255,255,.9)';
    const puff=(dx,dy,r)=>{ ctx.beginPath(); ctx.arc(sx+dx*s,sy+dy*s,r*s,0,6.28); ctx.fill(); };
    puff(0,0,16); puff(20,4,20); puff(42,2,15); puff(13,-9,13); puff(32,-7,12);
  }
}

function drawUpdrafts(){
  for(const u of updrafts){
    const sx=u.x-cam.x, sy=u.y-cam.y;
    if(sx>VIEW_W||sx+u.w<0) continue;
    const off = u.coop && !u.active;        // termica cooperativa SPENTA
    if(off){
      // mostrata tratteggiata e scura: va attivata dall'interruttore
      ctx.setLineDash([6,6]); ctx.strokeStyle='rgba(150,170,190,.4)'; ctx.lineWidth=2;
      ctx.strokeRect(sx,sy,u.w,u.h); ctx.setLineDash([]);
      ctx.fillStyle='rgba(150,170,190,.06)'; ctx.fillRect(sx,sy,u.w,u.h);
      continue;
    }
    // colonna d'aria con frecce animate verso l'alto
    const coopGlow = u.coop ? 'rgba(255,225,120,.22)' : 'rgba(180,230,255,.18)';
    ctx.fillStyle=coopGlow; ctx.fillRect(sx,sy,u.w,u.h);
    ctx.strokeStyle = u.coop ? 'rgba(255,210,80,.7)' : 'rgba(120,200,255,.5)'; ctx.lineWidth=2;
    const t=performance.now()*0.002;
    for(let i=0;i<4;i++){
      const ax=sx+u.w*(0.2+i*0.2);
      const ay=sy+u.h - ((t*120 + i*90)%u.h);
      ctx.beginPath(); ctx.moveTo(ax-6,ay+8); ctx.lineTo(ax,ay); ctx.lineTo(ax+6,ay+8); ctx.stroke();
    }
  }
}

// interruttore a terra (pulsante che Eddy preme)
function drawSwitch(){
  const sx=coopSwitch.x-cam.x, sy=coopSwitch.y-cam.y;
  if(sx<-40||sx>VIEW_W+40) return;
  // base
  ctx.fillStyle='#5a4631'; ctx.fillRect(sx-3,sy+coopSwitch.h-3,coopSwitch.w+6,5);
  // pulsante (abbassato se premuto)
  const press = coopSwitch.pressed ? 4 : 0;
  ctx.fillStyle = coopSwitch.pressed ? '#58d68d' : '#e0b020';
  ctx.fillRect(sx, sy+press, coopSwitch.w, coopSwitch.h-press);
  ctx.fillStyle='rgba(255,255,255,.3)'; ctx.fillRect(sx, sy+press, coopSwitch.w, 2);
  // icona termica sopra
  ctx.fillStyle = coopSwitch.pressed ? '#58d68d' : 'rgba(255,255,255,.6)';
  ctx.font='12px sans-serif'; ctx.textAlign='center';
  ctx.fillText('🌀', sx+coopSwitch.w/2, sy-6);
}

function drawGround(){
  // superficie + riempimento
  ctx.beginPath();
  ctx.moveTo(0,VIEW_H);
  for(let sx=0; sx<=VIEW_W; sx+=6){
    const wx=sx+cam.x; ctx.lineTo(sx, groundY(wx)-cam.y);
  }
  ctx.lineTo(VIEW_W,VIEW_H); ctx.closePath();
  const g=ctx.createLinearGradient(0,250,0,VIEW_H);
  g.addColorStop(0,'#6fbf5a'); g.addColorStop(0.2,'#4e9d3a'); g.addColorStop(1,'#3a6d28');
  ctx.fillStyle=g; ctx.fill();
  // bordo erboso
  ctx.strokeStyle='#7fd06a'; ctx.lineWidth=4; ctx.beginPath();
  for(let sx=0; sx<=VIEW_W; sx+=6){ const wx=sx+cam.x; const y=groundY(wx)-cam.y;
    if(sx===0) ctx.moveTo(sx,y); else ctx.lineTo(sx,y); }
  ctx.stroke();
}

// -------------------------- LAGO (acqua + pesci) ----------------------------
// profilo del FONDO del lago: conca liscia (più profonda al centro)
function lakeBottomY(x){
  const t = (x-lake.x0)/(lake.x1-lake.x0);           // 0..1 lungo il lago
  const bowl = Math.sin(Math.max(0,Math.min(1,t))*Math.PI); // 0 ai bordi, 1 al centro
  return lake.surfaceY + 24 + bowl*lake.depth;
}
function drawLake(){
  const sx0=lake.x0-cam.x, sx1=lake.x1-cam.x;
  if(sx1<0 || sx0>VIEW_W) return;
  const surfY0 = lake.surfaceY-cam.y;
  const now = performance.now();

  ctx.save();
  // ---- CLIP alla forma organica del lago (superficie ondulata + conca) ----
  ctx.beginPath();
  ctx.moveTo(sx0, surfY0);
  for(let x=lake.x0; x<=lake.x1; x+=6){ ctx.lineTo(x-cam.x, waterY(x)-cam.y); }
  for(let x=lake.x1; x>=lake.x0; x-=6){ ctx.lineTo(x-cam.x, lakeBottomY(x)-cam.y); }
  ctx.closePath();
  ctx.save(); ctx.clip();

  // ---- ACQUA: gradiente di profondità ----
  const maxBot = lake.surfaceY+24+lake.depth-cam.y;
  const wg=ctx.createLinearGradient(0,surfY0,0,maxBot);
  wg.addColorStop(0,'#74c6e8'); wg.addColorStop(0.35,'#3f9fcf'); wg.addColorStop(0.75,'#2374a8'); wg.addColorStop(1,'#154e78');
  ctx.fillStyle=wg; ctx.fillRect(sx0-10, surfY0-4, (sx1-sx0)+20, lake.depth+80);

  // ---- fondo sabbioso + sassi ----
  ctx.fillStyle='rgba(120,100,60,.55)';
  ctx.beginPath(); ctx.moveTo(sx0, maxBot+20);
  for(let x=lake.x0; x<=lake.x1; x+=8){ ctx.lineTo(x-cam.x, lakeBottomY(x)-cam.y); }
  ctx.lineTo(sx1, maxBot+20); ctx.closePath(); ctx.fill();
  // sassolini sul fondo
  ctx.fillStyle='rgba(90,75,50,.6)';
  for(let i=0;i<6;i++){ const x=lake.x0+ (i+0.5)*(lake.x1-lake.x0)/6;
    const px=x-cam.x, py=lakeBottomY(x)-cam.y-3;
    ctx.beginPath(); ctx.ellipse(px,py,5+(i%3)*2,3,0,0,6.28); ctx.fill(); }
  // alghe ondeggianti sul fondo
  ctx.strokeStyle='rgba(40,110,70,.55)'; ctx.lineWidth=3; ctx.lineCap='round';
  for(let i=0;i<4;i++){ const x=lake.x0+40+i*(lake.x1-lake.x0-80)/3;
    const px=x-cam.x, by=lakeBottomY(x)-cam.y-2;
    ctx.beginPath(); ctx.moveTo(px,by);
    for(let seg=1;seg<=3;seg++){ ctx.lineTo(px+Math.sin(now*0.002+i+seg)*4, by-seg*9); }
    ctx.stroke(); }

  // ---- caustiche (riflessi di luce ondulati) ----
  ctx.strokeStyle='rgba(255,255,255,.12)'; ctx.lineWidth=3;
  for(let r=0;r<3;r++){ ctx.beginPath();
    for(let x=lake.x0; x<=lake.x1; x+=10){ const px=x-cam.x;
      const py=surfY0+30+r*34+Math.sin(x*0.05+now*0.0015+r)*6;
      if(x===lake.x0) ctx.moveTo(px,py); else ctx.lineTo(px,py); }
    ctx.stroke(); }

  // ---- PESCI dettagliati ----
  for(const fish of fishes){
    if(fish.caught) continue;
    drawFish(fish, now);
  }
  ctx.restore();  // fine clip acqua

  // ---- SUPERFICIE: riflesso del cielo + linea luminosa ----
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx0, surfY0+14);
  for(let x=lake.x0; x<=lake.x1; x+=6){ ctx.lineTo(x-cam.x, waterY(x)-cam.y); }
  ctx.lineTo(sx1, surfY0+14); ctx.closePath(); ctx.clip();
  ctx.fillStyle='rgba(255,255,255,.14)';
  ctx.fillRect(sx0,surfY0-4,sx1-sx0,18);
  ctx.restore();
  // linea della superficie (brillante)
  ctx.strokeStyle='rgba(255,255,255,.6)'; ctx.lineWidth=2; ctx.beginPath();
  for(let x=lake.x0; x<=lake.x1; x+=6){ const px=x-cam.x, py=waterY(x)-cam.y;
    if(x===lake.x0) ctx.moveTo(px,py); else ctx.lineTo(px,py); }
  ctx.stroke();
  // luccichii puntiformi che si muovono
  ctx.fillStyle='rgba(255,255,255,.7)';
  for(let i=0;i<5;i++){ const x=lake.x0+ ((now*0.02+i*110)%(lake.x1-lake.x0));
    const px=x-cam.x, py=waterY(x)-cam.y-1; ctx.fillRect(px,py,6,1.5); }
  ctx.restore();

  // ---- RIVE: sponde erbose curve + canne + ninfee ----
  drawLakeShores(now);
}

// pesce con corpo, pinne, coda, occhio (invece di una semplice ombra)
function drawFish(fish, now){
  const sp=FISH_SPECIES[fish.species];
  const fx=fish.x-cam.x, fy=fish.y-cam.y, sz=fish.size;
  const spotted=fish.spotted;
  ctx.save(); ctx.translate(fx,fy); ctx.scale(fish.dir,1);
  const tailFlap=Math.sin(fish.wobble*2)*0.5;

  if(!spotted){
    // non avvistato: sagoma scura sfumata (ombra sott'acqua)
    ctx.fillStyle='rgba(12,40,58,.45)';
    ctx.beginPath(); ctx.ellipse(0,0,11*sz,4.5*sz,0,0,6.28); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-9*sz,0); ctx.lineTo(-16*sz,-4*sz); ctx.lineTo(-16*sz,4*sz); ctx.closePath(); ctx.fill();
    ctx.restore(); return;
  }
  // avvistato: pesce colorato e dettagliato
  // coda (si muove)
  ctx.fillStyle=sp.fin; ctx.save(); ctx.translate(-10*sz,0); ctx.rotate(tailFlap);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-8*sz,-5*sz); ctx.lineTo(-6*sz,0); ctx.lineTo(-8*sz,5*sz); ctx.closePath(); ctx.fill();
  ctx.restore();
  // pinna dorsale e ventrale
  ctx.fillStyle=sp.fin;
  ctx.beginPath(); ctx.moveTo(-2*sz,-4*sz); ctx.lineTo(2*sz,-8*sz); ctx.lineTo(4*sz,-3.5*sz); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0,4*sz); ctx.lineTo(2*sz,7*sz); ctx.lineTo(4*sz,3.5*sz); ctx.closePath(); ctx.fill();
  // corpo con gradiente
  const bg=ctx.createLinearGradient(0,-5*sz,0,5*sz);
  bg.addColorStop(0,sp.color); bg.addColorStop(1,sp.belly);
  ctx.fillStyle=bg; ctx.beginPath(); ctx.ellipse(0,0,10*sz,4.5*sz,0,0,6.28); ctx.fill();
  // pinna laterale
  ctx.fillStyle=sp.fin; ctx.beginPath(); ctx.ellipse(1*sz,2*sz,3*sz,1.6*sz,0.5,0,6.28); ctx.fill();
  // macchie/strisce distintive
  ctx.fillStyle=sp.spot;
  if(fish.species==='trota'){ for(let i=-1;i<=1;i++){ ctx.beginPath(); ctx.arc(i*4*sz,-1*sz,1*sz,0,6.28); ctx.fill(); } }
  else if(fish.species==='carpa'){ ctx.globalAlpha=0.4; for(let i=-2;i<=2;i++){ ctx.fillRect(i*3.5*sz,-4*sz,1,8*sz); } ctx.globalAlpha=1; }
  else { ctx.globalAlpha=0.5; ctx.beginPath(); ctx.arc(2*sz,-1*sz,2*sz,0,6.28); ctx.fill(); ctx.globalAlpha=1; }
  // testa/occhio
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(6*sz,-1*sz,1.6*sz,0,6.28); ctx.fill();
  ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(6.3*sz,-1*sz,0.9*sz,0,6.28); ctx.fill();
  ctx.restore();
}

// rive del lago: sponde erbose arrotondate, canne, ninfee, sassi
function drawLakeShores(now){
  const sxL=lake.x0-cam.x, sxR=lake.x1-cam.x, surfY=lake.surfaceY-cam.y;
  // bordino umido di fango appena sotto il pelo dell'acqua (sottile, naturale)
  ctx.strokeStyle='rgba(90,66,38,.6)'; ctx.lineWidth=4; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(sxL-10,surfY+10); ctx.quadraticCurveTo(sxL-2,surfY+2,sxL+8,surfY+8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sxR+10,surfY+10); ctx.quadraticCurveTo(sxR+2,surfY+2,sxR-8,surfY+8); ctx.stroke();
  // erba sulle rive
  ctx.strokeStyle='#4e9d3a'; ctx.lineWidth=2; ctx.lineCap='round';
  const grassAt=(gx)=>{ const px=gx-cam.x, py=groundY(gx)-cam.y;
    for(let i=0;i<3;i++){ ctx.beginPath(); ctx.moveTo(px+i*3-3,py); ctx.lineTo(px+i*3-3+Math.sin(now*0.002+i)*2,py-7); ctx.stroke(); } };
  grassAt(lake.x0-18); grassAt(lake.x0-6); grassAt(lake.x1+6); grassAt(lake.x1+18);
  // canne palustri alla riva destra
  ctx.strokeStyle='#3a7d2a'; ctx.lineWidth=3;
  for(let i=0;i<3;i++){ const x=lake.x1+10+i*7, px=x-cam.x, py=groundY(x)-cam.y;
    const sway=Math.sin(now*0.0015+i)*3;
    ctx.beginPath(); ctx.moveTo(px,py); ctx.quadraticCurveTo(px+sway,py-20,px+sway*1.5,py-34); ctx.stroke();
    ctx.fillStyle='#6a4a2a'; ctx.beginPath(); ctx.ellipse(px+sway*1.5,py-36,2.5,6,0,0,6.28); ctx.fill(); }
  // ninfee galleggianti
  ctx.fillStyle='#3a9d4a';
  for(let i=0;i<2;i++){ const x=lake.x0+60+i*150, px=x-cam.x, py=waterY(x)-cam.y+1;
    ctx.beginPath(); ctx.ellipse(px,py,11,4,0,0,6.28); ctx.fill();
    ctx.fillStyle='#2e7d32'; ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(px+5,py-1); ctx.lineTo(px+3,py+2); ctx.closePath(); ctx.fill();
    // fiorellino su una ninfea
    if(i===0){ ctx.fillStyle='#f6b8d0'; for(let p=0;p<5;p++){ const a=p*1.256; ctx.beginPath(); ctx.ellipse(px+Math.cos(a)*3,py-2+Math.sin(a)*2,2,1.2,a,0,6.28); ctx.fill(); } ctx.fillStyle='#ffe14d'; ctx.beginPath(); ctx.arc(px,py-2,1.4,0,6.28); ctx.fill(); }
    ctx.fillStyle='#3a9d4a';
  }
}

// -------------------------- gabbiano pixel-art ------------------------------
function drawGull(){
  const sx=Math.round(gull.x-cam.x), sy=Math.round(gull.y-cam.y);
  const WHITE='#fdfdfd', GREY='#c9d2d8', DARK='#3a4247', BEAK='#ffb02b', WINGT='#9aa6ad', LEG='#ffb02b', LEG_D='#d98a1a';
  const onGround = gull.onGround;

  ctx.save();
  ctx.translate(sx+gull.w/2, sy+gull.h/2);
  ctx.scale(gull.facing,1);
  // in volo: inclina il corpo col pitch. A terra: resta DRITTO (nessuna rotazione).
  if(!onGround) ctx.rotate(gull.pitch*0.5);
  ctx.translate(-gull.w/2, -gull.h/2);

  // ===== ZAMPE =====
  // A terra: due zampe in piedi con lieve passo (walkCycle). In volo: ritratte.
  if(onGround){
    const step = Math.sin(gull.walkCycle)*2.5;    // oscillazione passo
    // zampa posteriore (parte dal basso del corpo, scende fino al suolo)
    ctx.strokeStyle=LEG_D; ctx.lineWidth=2.5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(11,19); ctx.lineTo(11-step,27); ctx.stroke();
    ctx.fillStyle=LEG_D; ctx.fillRect(7-step,26,8,2.5);        // piede palmato dietro
    // zampa anteriore
    ctx.strokeStyle=LEG; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(19,19); ctx.lineTo(19+step,27); ctx.stroke();
    ctx.fillStyle=LEG; ctx.fillRect(16+step,26,9,2.5);         // piede palmato davanti
  } else {
    // zampe ritratte sotto il corpo (piccole, piegate indietro)
    ctx.strokeStyle=LEG; ctx.lineWidth=2; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(14,18); ctx.lineTo(10,20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(17,18); ctx.lineTo(13,20); ctx.stroke();
  }

  // ===== CORPO =====
  // a terra il corpo è leggermente più verticale (ellisse meno schiacciata)
  ctx.fillStyle=WHITE;
  ctx.beginPath(); ctx.ellipse(16,13,15,9,0,0,6.28); ctx.fill();     // corpo
  ctx.fillStyle=GREY; ctx.beginPath(); ctx.ellipse(10,16,11,6,0,0,6.28); ctx.fill(); // pancia ombra

  // coda
  ctx.fillStyle=WHITE; ctx.beginPath();
  ctx.moveTo(2,12); ctx.lineTo(-6,8); ctx.lineTo(-6,16); ctx.closePath(); ctx.fill();
  ctx.fillStyle=DARK; ctx.fillRect(-6,11,3,3);

  // ===== ALI =====
  ctx.fillStyle=GREY;
  let wingUp;
  if(gull.gliding)      wingUp = 0;
  else if(gull.flapAnim>0.5) wingUp = -10;          // battito su
  else if(onGround)     wingUp = 2;                 // chiuse (a riposo)
  else                  wingUp = 6;                 // battito giù
  if(gull.gliding){
    // ali distese larghe (planata)
    ctx.beginPath(); ctx.moveTo(14,10); ctx.lineTo(-10,6); ctx.lineTo(-6,14); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(18,10); ctx.lineTo(40,6);  ctx.lineTo(34,14); ctx.closePath(); ctx.fill();
    ctx.fillStyle=WINGT; ctx.fillRect(-10,6,4,3); ctx.fillRect(36,6,4,3);
  } else {
    // ala ripiegata sul fianco
    ctx.beginPath();
    ctx.moveTo(14,10); ctx.lineTo(24,10+wingUp); ctx.lineTo(20,16); ctx.closePath(); ctx.fill();
    ctx.fillStyle=WINGT; ctx.fillRect(22,10+wingUp,3,3);
  }

  // ===== TESTA + occhio + becco =====
  ctx.fillStyle=WHITE; ctx.beginPath(); ctx.arc(28,9,6,0,6.28); ctx.fill();
  ctx.fillStyle=DARK; ctx.fillRect(29,7,2,2);                 // occhio
  ctx.fillStyle=BEAK; ctx.beginPath();
  ctx.moveTo(33,9); ctx.lineTo(40,10); ctx.lineTo(33,12); ctx.closePath(); ctx.fill();

  // lampeggio "stanco" (niente energia)
  if(gull.tiredFlash>0 && Math.floor(performance.now()/80)%2===0){
    ctx.fillStyle='rgba(255,80,60,.5)'; ctx.fillRect(0,0,gull.w,gull.h);
  }
  ctx.restore();
}

// -------------------------- EDDY (scoiattolo, stile morbido) ----------------
function drawEddy(){
  const sx=Math.round(eddy.x-cam.x), sy=Math.round(eddy.y-cam.y);
  const swimming = eddy.swimming;
  ctx.save();
  if(swimming){
    // posa di nuoto: corpo inclinato in orizzontale, verso la direzione di moto
    ctx.translate(sx+eddy.w/2, sy+eddy.h/2); ctx.scale(eddy.facing,1);
    ctx.rotate(-0.9);                       // muso in avanti, pancia giù
    ctx.translate(-eddy.w/2, -eddy.h/2);
  } else {
    ctx.translate(sx+eddy.w/2, sy); ctx.scale(eddy.facing,1); ctx.translate(-eddy.w/2,0);
  }

  // palette pelliccia volpe/scoiattolo con sfumature
  const FUR='#e07f28', FUR_L='#f59a3e', FUR_D='#bd6418', BELLY='#fbe6c4', BELLY_D='#eccb9a';
  const DARK='#2e1c0e', NOSE='#5a3418', GREEN='#3a9d3f', GREEN_D='#2e7d32', YELLOW='#ffd43b', YELLOW_D='#e0b020';
  const airborne=!eddy.onGround && !swimming;
  const run = (eddy.onGround && Math.abs(eddy.vx)>0.4);
  const phase = swimming ? Math.sin(eddy.swimCycle*3) : Math.sin(eddy.runCycle);
  const bob = run ? Math.abs(Math.sin(eddy.runCycle))*1.2 : 0;  // saltello in corsa

  if(!swimming) ctx.translate(0,-bob);

  // ===== OMBRA a terra =====
  if(eddy.onGround){
    ctx.fillStyle='rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(13,37,13,3,0,0,6.28); ctx.fill();
  }

  // ===== CODA FOLTA (dietro il corpo), curva a punto di domanda =====
  // gradiente radiale per dare volume
  const tg=ctx.createLinearGradient(-16,0,6,0);
  tg.addColorStop(0,FUR_L); tg.addColorStop(0.6,FUR); tg.addColorStop(1,FUR_D);
  ctx.fillStyle=tg; ctx.beginPath();
  ctx.moveTo(7,32);
  ctx.quadraticCurveTo(-12,34,-16,18);           // fianco esterno coda
  ctx.quadraticCurveTo(-19,2,-6,-4);             // punta ricurva in alto
  ctx.quadraticCurveTo(-13,6,-9,16);             // rientro interno
  ctx.quadraticCurveTo(-7,26,7,28);              // ritorno al corpo
  ctx.closePath(); ctx.fill();
  // ciuffi/pelo sulla coda (chiaro)
  ctx.strokeStyle=FUR_L; ctx.lineWidth=1.5; ctx.lineCap='round';
  for(let i=0;i<5;i++){ const t=i/4; const bx=-16+t*10, by=16-t*16;
    ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx-3,by-3); ctx.stroke(); }
  // punta crema della coda
  ctx.fillStyle=BELLY; ctx.beginPath(); ctx.ellipse(-8,-2,4,5,0.4,0,6.28); ctx.fill();

  // ===== ZAMPE posteriori (gambe lunghe a due segmenti: coscia + stinco) =====
  const legA = run ? phase*5 : 0;      // oscillazione corsa (più ampia = più agile)
  // piede palmato con dita, orientato in avanti
  const drawFoot=(fx,fy)=>{ ctx.fillStyle=FUR_D; ctx.beginPath(); ctx.ellipse(fx+2,fy,5,2.6,0,0,6.28); ctx.fill();
    ctx.fillStyle=DARK; ctx.fillRect(fx+2,fy-1,1,3); ctx.fillRect(fx+4,fy-1,1,3); ctx.fillRect(fx+6,fy-1,1,3); };
  // disegna una gamba: anca(hx,hy) -> ginocchio -> piede(fy). segno=sfasamento corsa
  function drawLeg(hx, swing, kneeOut){
    const kneeX = hx + kneeOut, kneeY = 33;
    const footX = hx + swing;
    ctx.strokeStyle=FUR; ctx.lineWidth=5; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.beginPath(); ctx.moveTo(hx,26); ctx.lineTo(kneeX,kneeY); ctx.lineTo(footX,42); ctx.stroke();
    // stinco più chiaro per volume
    ctx.strokeStyle=FUR_L; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(kneeX,kneeY); ctx.lineTo(footX,41); ctx.stroke();
    drawFoot(footX-2,42);
  }
  if(airborne){
    // in salto: gambe raccolte in avanti
    drawLeg(9, -2, -3);
    drawLeg(17, 2, 3);
  } else {
    // a terra: in piedi, gambe lunghe quasi dritte; in corsa oscillano
    drawLeg(10, -legA, -1);
    drawLeg(16, legA, 1);
  }

  // ===== CORPO (forma a pera, pelliccia) =====
  const bg=ctx.createLinearGradient(4,12,22,32);
  bg.addColorStop(0,FUR_L); bg.addColorStop(1,FUR_D);
  ctx.fillStyle=bg; ctx.beginPath(); ctx.ellipse(13,24,10,11,0,0,6.28); ctx.fill();
  // pancia chiara
  ctx.fillStyle=BELLY; ctx.beginPath(); ctx.ellipse(13,26,6,8,0,0,6.28); ctx.fill();

  // ===== MAGLIETTA a righe (indossata sul torace) =====
  ctx.save();
  ctx.beginPath(); ctx.ellipse(13,22,9.5,7,0,0,Math.PI); ctx.clip();  // solo parte alta
  for(let i=0;i<4;i++){ ctx.fillStyle=(i%2===0)?GREEN:YELLOW; ctx.fillRect(3,16+i*3,20,3); }
  ctx.restore();
  ctx.fillStyle=GREEN_D; ctx.fillRect(4,16,18,1.5);                  // bordo collo maglia

  // ===== BRACCIA =====
  ctx.strokeStyle=FUR; ctx.lineWidth=4.5; ctx.lineCap='round';
  if(airborne){
    // in salto: zampette alzate
    ctx.beginPath(); ctx.moveTo(6,20); ctx.lineTo(3,14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(20,20); ctx.lineTo(23,14); ctx.stroke();
    ctx.fillStyle=BELLY; ctx.beginPath(); ctx.arc(3,14,2.2,0,6.28); ctx.fill(); ctx.beginPath(); ctx.arc(23,14,2.2,0,6.28); ctx.fill();
  } else {
    // a riposo/corsa: zampette raccolte davanti alla pancia
    const arm = run ? phase*2 : 0;
    ctx.beginPath(); ctx.moveTo(7,21); ctx.lineTo(9,26+arm); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(19,21); ctx.lineTo(17,26-arm); ctx.stroke();
    ctx.fillStyle=BELLY; ctx.beginPath(); ctx.arc(9,26+arm,2.2,0,6.28); ctx.fill(); ctx.beginPath(); ctx.arc(17,26-arm,2.2,0,6.28); ctx.fill();
  }

  // ===== TESTA =====
  const hg=ctx.createLinearGradient(6,-4,22,12);
  hg.addColorStop(0,FUR_L); hg.addColorStop(1,FUR);
  ctx.fillStyle=hg; ctx.beginPath(); ctx.ellipse(14,7,10,9,0,0,6.28); ctx.fill();

  // ORECCHIE a ciuffo appuntite
  ctx.fillStyle=FUR_D;
  ctx.beginPath(); ctx.moveTo(7,-1); ctx.lineTo(4,-9); ctx.lineTo(11,-3); ctx.closePath(); ctx.fill();   // sx
  ctx.beginPath(); ctx.moveTo(20,-2); ctx.lineTo(23,-10); ctx.lineTo(16,-4); ctx.closePath(); ctx.fill(); // dx
  ctx.fillStyle=BELLY_D; // interno orecchie + ciuffetto
  ctx.beginPath(); ctx.moveTo(7,-2); ctx.lineTo(5,-7); ctx.lineTo(10,-3); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(20,-3); ctx.lineTo(22,-8); ctx.lineTo(17,-4); ctx.closePath(); ctx.fill();

  // GUANCE / muso chiaro
  ctx.fillStyle=BELLY; ctx.beginPath(); ctx.ellipse(18,9,6,5,0,0,6.28); ctx.fill();
  ctx.fillStyle=BELLY; ctx.beginPath(); ctx.ellipse(10,10,4,3.5,0,0,6.28); ctx.fill();  // guancia vicina

  // NASO + bocca
  ctx.fillStyle=NOSE; ctx.beginPath(); ctx.ellipse(23,8,2,1.6,0,0,6.28); ctx.fill();
  ctx.strokeStyle=NOSE; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(23,9.5); ctx.lineTo(23,11); ctx.quadraticCurveTo(20,12,19,11); ctx.stroke();

  // OCCHIO grande espressivo con riflesso
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(16,6.5,3.2,0,6.28); ctx.fill();
  ctx.fillStyle=DARK;   ctx.beginPath(); ctx.arc(16.8,6.7,2.2,0,6.28); ctx.fill();
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(17.6,5.8,0.9,0,6.28); ctx.fill();  // riflesso
  // sopracciglio pelo
  ctx.strokeStyle=FUR_D; ctx.lineWidth=1.2; ctx.beginPath(); ctx.moveTo(13,3); ctx.quadraticCurveTo(16,2,19,3.5); ctx.stroke();

  ctx.restore();
}

// ============================= LOOP =========================================
let last=performance.now();
function loop(){
  const now=performance.now(); let dt=now-last; last=now; if(dt>50) dt=50;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

gull.reset();
eddy.reset();
loop();
