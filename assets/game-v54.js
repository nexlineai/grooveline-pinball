(() => {
'use strict';
// All positions, artwork and collisions share a 520 × 940 playfield.
// The fixed 240 Hz solver uses circle/capsule contacts and moving flipper surfaces.
const W=520,H=940,R=9,STEP=1/240,GRAVITY=850,MAX_SPEED=1550;
const $=id=>document.getElementById(id),canvas=$('game'),ctx=canvas.getContext('2d',{alpha:false});
const C={orange:'#ff5e6c',cream:'#e2e8f8',mint:'#00d4c8',green:'#1d2338',dark:'#0f1320',gold:'#f0c040',steel:'#9098b5'};
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let dpr=1,backdrop;
function resize(){dpr=Math.min(devicePixelRatio||1,2);canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);backdrop=document.createElement('canvas');backdrop.width=W*dpr;backdrop.height=H*dpr;const b=backdrop.getContext('2d');b.scale(dpr,dpr);drawStatic(b);}
let best=0;try{best=+localStorage.getItem('grooveline-v43-best')||0;}catch{}
const state={mode:'ready',score:0,best,ballNo:1,mult:1,groove:0,drop:0,time:0,saveUntil:0,combo:0,lastHit:-100,respawn:0,tilt:0,nudgeHeat:0,lastNudge:-100,lastShot:'—',skill:false,skillPending:false,shotCount:0,maxCombo:0};
let ball=null,charge=0,charging=false,pullPointer=null,launchAge=0,launched=false,toastTimer=0,shake=0,spinner=0,spinSpeed=0,spinnerCooldown=0,orbitCooldown=[0,0],bumperReset=0,targetReset=0;
const particles=[],rings=[],floaters=[],balls=[],releases=[];
let scene=null,captive=null;
const vaultMultiplier=()=>captive&&!state.vaultWaiting&&state.tilt<=0?state.vaultMult:1;
const activeCount=()=>balls.length+releases.length;
const readyBall=()=>balls.find(b=>b.ready);
Object.assign(state,{locks:0,multiball:false,mbSaveUntil:0,jackpotBase:5000,jackpotMult:1,jackpots:0,superLit:false,rampShots:0,vaultMult:1,vaultUntil:0,vaultTick:0,vaultBank:0,vaultCaptures:0,vaultWaiting:false,flightReady:false,flight:null,flightReward:false});
state.nexbreak=false;
let nexbreakWins=new Set(),nexbreakVisits=0,nexbreakPending=false,nexbreakFailedCapture=-1;
const input={left:new Set(),right:new Set(),launch:new Set()};
const flips=[{x:140,y:790,side:1,angle:.48,rest:.48,up:-.55,omega:0,len:96,hit:0},{x:350,y:790,side:-1,angle:Math.PI-.48,rest:Math.PI-.48,up:Math.PI+.55,omega:0,len:96,hit:0}];
const bumpers=[{x:176,y:233,r:30,label:'DECK A',color:C.orange,lit:false,hit:0,last:-10},{x:314,y:233,r:30,label:'DECK B',color:C.mint,lit:false,hit:0,last:-10},{x:245,y:328,r:30,label:'MASTER',color:C.gold,lit:false,hit:0,last:-10}];
const targets=[{x:109,y:391,label:'M',lit:false,hit:0,last:-10},{x:105,y:428,label:'I',lit:false,hit:0,last:-10},{x:101,y:465,label:'X',lit:false,hit:0,last:-10}];
const rollovers=[{x:185,y:139,lit:false,last:-10},{x:245,y:139,lit:false,last:-10},{x:305,y:139,lit:false,last:-10}];
// Middle-ground clearance: closer slings, with a full ball passage above raised flippers.
const slings=[{points:[[103,590],[110,690],[172,719]],side:1,hit:0,last:-10},{points:[[387,590],[380,690],[318,719]],side:-1,hit:0,last:-10}];
const rails=[];
function rail(points,r=5,kind='rail'){for(let i=1;i<points.length;i++)rails.push({ax:points[i-1][0],ay:points[i-1][1],bx:points[i][0],by:points[i][1],r,kind});}
const arch=[];for(let i=0;i<=36;i++){const a=Math.PI+Math.PI*i/36;arch.push([261+231*Math.cos(a),188+136*Math.sin(a)]);}rail(arch,7,'outer');
rail([[30,188],[30,617],[58,717],[140,790]],7,'outer');rail([[492,188],[492,873]],7,'outer');
rail([[451,174],[451,617],[422,717],[350,790]],6,'divider');
rail([[451,860],[492,860]],6,'floor');
// Open return lanes between the slings and outer rails; no converging dead-end channels.
rail([[106,176],[93,235],[85,332]],4,'orbit');rail([[384,176],[400,240],[407,336],[399,476]],4,'orbit');
for(const x of [155,215,275,335])rail([[x,111],[x,158]],4,'lane');
rail([[388,392],[377,437]],5,'rubber');
rail([[304,540],[340,516]],3,'ramp');rail([[416,540],[380,516]],3,'ramp');
rail([[74,540],[110,516]],3,'ramp');rail([[186,540],[150,516]],3,'ramp');
for(const s of slings){for(let i=0;i<3;i++){const a=s.points[i],b=s.points[(i+1)%3];rails.push({ax:a[0],ay:a[1],bx:b[0],by:b[1],r:5,kind:'sling',sling:s,active:i===2});}}
// Game effects have their own bus. The radio never enters this pause/mute path.
const audio=window.GroovelineSound.create(window.GroovelineRadio?.fxVolume??.35);
const studio=window.GroovelineSessions.create({notify:(title,sub)=>{toast(title,sub,3);$('featureStatus').textContent=title+'. '+sub;},fx:(kind,value)=>audio.fx(kind,value)});
let radioFrame={playing:false,levels:Array(12).fill(0),kind:'standby',energy:0},recordAngle=0;
function toast(title,sub='',duration=2){$('toastTitle').textContent=title;$('toastSub').textContent=sub;$('toast').classList.add('show');toastTimer=duration;}
function effect(x,y,color,n=12){rings.push({x,y,r:15,life:.45,color});if(!reduced)for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=50+Math.random()*130;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.3+Math.random()*.25,color});}}
function score(points,label,x,y,groove=0){if(state.tilt>0)return;const comboBonus=state.time-state.lastHit<2.2;state.combo=comboBonus?state.combo+1:1;state.maxCombo=Math.max(state.maxCombo,state.combo);state.lastHit=state.time;const amount=points*state.mult*(state.drop>0?2:1)*vaultMultiplier();state.score+=amount;state.lastShot=label;state.shotCount++;if(x!==undefined)floaters.push({x,y,text:'+'+amount,life:.85});if(window.GroovelineLiveTable?.hit(label))toast('BOOTH CREW','DJ CHALLENGE COMPLETE · BADGE EARNED',2.5);if(state.drop<=0){state.groove=Math.min(100,state.groove+groove);if(state.groove>=100){state.groove=0;state.drop=20;toast('THE DROP','DOUBLE POINTS · 20 SECONDS',2.8);effect(245,460,C.orange,30);audio.fx('drop');}}}
function saveBest(){if(state.score>state.best){state.best=state.score;try{localStorage.setItem('grooveline-v43-best',String(state.best));}catch{}}}
function makeBall(x,y,vx=0,vy=0){return{x,y,vx,vy,r:R,ready:false,trail:[],railSound:0,ramp:null,rampUntil:0,inShooter:false,shooterAge:0,vaultServe:false,laneContact:-1};}
function spawnBall(saved=false){ball=makeBall(472,806);ball.ready=true;balls.splice(0,balls.length,ball);charging=false;charge=0;input.launch.clear();launchAge=0;launched=false;state.skillPending=false;state.skill=false;state.saveUntil=saved?0:-1;}
function clearInput(){for(const s of Object.values(input))s.clear();charging=false;charge=0;pullPointer=null;heldPointers.clear();tablePointers.clear();document.querySelectorAll('.held').forEach(b=>b.classList.remove('held'));}
function start(withAudio=true){window.GroovelineNexbreak?.cancel();state.nexbreak=false;nexbreakWins.clear();nexbreakFailedCapture=-1;nexbreakVisits=0;nexbreakPending=false;saveBest();clearInput();resetFeatures();window.GroovelineLiveTable?.reset();Object.assign(state,{mode:'playing',score:0,ballNo:1,mult:1,groove:0,drop:0,time:0,saveUntil:0,combo:0,lastHit:-100,respawn:0,tilt:0,nudgeHeat:0,lastNudge:-100,lastShot:'—',shotCount:0,maxCombo:0,savedRespawn:false});for(const b of [...bumpers,...targets,...rollovers]){b.lit=false;b.hit=0;b.last=-10;}for(const s of slings){s.hit=0;s.last=-10;}for(const f of flips){f.angle=f.rest;f.omega=0;}bumperReset=targetReset=0;orbitCooldown=[0,0];spinnerCooldown=0;particles.length=rings.length=floaters.length=0;spinSpeed=0;shake=0;$('overlay').hidden=true;$('help').hidden=true;audio.resume();spawnBall();if(withAudio){audio.enable();window.GroovelineRadio?.start();}toast('YOU’RE UP','PULL SPRING OR HOLD SPACE · RELEASE TO LAUNCH',2.7);syncHUD();}
function launch(){
  const served=readyBall();if(state.mode!=='playing'||!served)return;
  ball=served;const power=Math.max(.12,charge),vaultLaunch=served.vaultServe;
  served.ready=false;served.y=802;served.vy=-(1090+power*215);served.vx=0;served.inShooter=true;served.shooterAge=0;served.vaultServe=false;
  if(!vaultLaunch){state.skill=power>=.62&&power<=.82;state.skillPending=true;state.saveUntil=state.saveUntil===-1?state.time+10:0;}
  charge=0;charging=false;launchAge=0;audio.fx('launch');
  if(vaultLaunch&&captive&&state.vaultWaiting){
    state.vaultWaiting=false;state.vaultUntil=state.time+20;state.vaultTick=state.time+1;
    celebrate('vaultstart','DOUBLE POINTS!','20 SECONDS · LEFT RAMP BOOSTS TO ×4',2);
    toast('VAULT BONUS LIVE','SHOOT RAMPS & TARGETS · ALL SHOTS ×2',3);
  }else toast('SIDE A · BALL '+state.ballNo,state.skill?'SWEET SPOT! MAKE IT TO THE TOP LANES':'KEEP IT SPINNING',1.4);
  if(vaultLaunch&&state.flightReward){state.flightReward=false;startMultiball();}
}
function drain(){if(!ball)return;const index=balls.indexOf(ball);if(index<0)return;balls.splice(index,1);ball=null;if(state.multiball&&state.tilt<=0&&state.time<state.mbSaveUntil)releases.push({delay:.65});if(!activeCount()&&captive)releaseVault(false);
if(balls.length+releases.length){checkMultiball();return;}checkMultiball();state.combo=0;if(state.time<state.saveUntil&&state.tilt<=0){state.respawn=1;toast('BALL SAVED','BACK ON THE PLUNGER · NO BALL LOST',1.7);state.savedRespawn=true;audio.fx('bonus');}else{state.savedRespawn=false;saveBest();if(state.ballNo>=3){state.mode='over';audio.pause();showOverlay('SESSION COMPLETE','One more record?',state.score.toLocaleString()+' points · '+state.shotCount+' scoring shots','PLAY AGAIN ↗');$('overlayFoot').textContent='BEST SESSION '+state.best.toLocaleString()+' · MAX COMBO '+state.maxCombo;clearInput();}else{state.ballNo++;state.respawn=1.25;state.mult=Math.max(1,state.mult-1);toast('TAKE A BREATH','BALL '+state.ballNo+' OF 3 · YOU’VE GOT THIS',1.8);audio.fx('drain');}}}
function showOverlay(tag,title,copy,button){$('overlayTag').textContent=tag;$('overlayTitle').textContent=title;$('overlayText').textContent=copy;$('playBtn').textContent=button;$('overlay').hidden=false;}
function pause(){if(state.nexbreak){window.GroovelineNexbreak?.togglePause();return;}if(state.mode==='playing'){state.mode='paused';clearInput();audio.pause();showOverlay('INTERMISSION','The record can wait.','Your session is paused. Pick up right where you left off.','RESUME SESSION ↗');$('overlayFoot').textContent='P TO RESUME';$('pauseBtn').setAttribute('aria-label','Resume game');}else if(state.mode==='paused'){state.mode='playing';$('overlay').hidden=true;audio.resume();$('pauseBtn').setAttribute('aria-label','Pause game');}}
function nudge(){if(state.nexbreak||state.flight||state.mode!=='playing'||!balls.some(b=>!b.ready)||state.tilt>0||state.time-state.lastNudge<.3)return;state.lastNudge=state.time;state.nudgeHeat+=1;if(state.nudgeHeat>2.25){state.tilt=3;state.saveUntil=0;state.mbSaveUntil=0;toast('TILT','FLIPPERS OFFLINE · EASY ON THE CABINET',2);audio.fx('drain');}else{for(const b of balls)if(!b.ready&&!b.ramp){b.vy-=190;b.vx+=(b.x<245?1:-1)*85;}shake=5;toast(state.nudgeHeat>1.3?'CAREFUL…':'A LITTLE HELP',state.nudgeHeat>1.3?'ONE MORE QUICK NUDGE WILL TILT':'NUDGE',.7);}}
// Capsule collision uses velocity relative to the contact surface, including rotation.
function contact(ax,ay,bx,by,r,restitution=.5,surface=null){const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy;const t=den?clamp(((ball.x-ax)*dx+(ball.y-ay)*dy)/den,0,1):0,qx=ax+t*dx,qy=ay+t*dy;let nx=ball.x-qx,ny=ball.y-qy,dist=Math.hypot(nx,ny);if(dist>=R+r)return null;if(dist<.0001){nx=0;ny=-1;dist=1;}else{nx/=dist;ny/=dist;}ball.x=qx+nx*(R+r+.025);ball.y=qy+ny*(R+r+.025);let sx=0,sy=0;if(surface){sx=-surface.omega*(qy-surface.y);sy=surface.omega*(qx-surface.x);}const vn=(ball.vx-sx)*nx+(ball.vy-sy)*ny;if(vn<0){const impulse=-(1+restitution)*vn;ball.vx+=nx*impulse;ball.vy+=ny*impulse;const tangent=-ball.vx*ny+ball.vy*nx;const friction=surface?.014:.003;ball.vx+=ny*tangent*friction;ball.vy-=nx*tangent*friction;}return{nx,ny,t,impact:-vn};}
function bumperHit(b,i,c){if(state.time-b.last<.1||c.impact<5)return;b.last=state.time;b.hit=1;if(state.tilt<=0){const speed=690;ball.vx=c.nx*speed+ball.vx*.12;ball.vy=c.ny*speed+ball.vy*.12-45;b.lit=true;score(150,b.label,b.x,b.y-35,7);effect(b.x,b.y,b.color);audio.fx('bumper',i,(b.x-245)/245);if(!bumperReset&&bumpers.every(b=>b.lit)){state.mult=Math.min(5,state.mult+1);score(500,'FULL GROOVE',245,266,9);bumperReset=state.time+.65;toast('IN THE GROOVE','MULTIPLIER ×'+state.mult,1.4);studio.note('mult',state.mult);}}}
function step(dt){if(state.nexbreak||tryNexbreak())return;if(state.flight){stepFlight(dt);return;}state.time+=dt;state.drop=Math.max(0,state.drop-dt);state.tilt=Math.max(0,state.tilt-dt);state.nudgeHeat=Math.max(0,state.nudgeHeat-dt*.24);if(state.time-state.lastHit>2.2)state.combo=0;
if(bumperReset&&state.time>=bumperReset){bumperReset=0;bumpers.forEach(b=>b.lit=false);}if(targetReset&&state.time>=targetReset){targetReset=0;targets.forEach(b=>b.lit=false);}
for(let i=0;i<2;i++){const f=flips[i],active=input[i===0?'left':'right'].size>0&&state.tilt<=0,target=active?f.up:f.rest;const old=f.angle;f.angle+=clamp(target-old,-(active?18:8)*dt,(active?18:8)*dt);f.omega=(f.angle-old)/dt;}
tickVault();
if(scene){scene.life=Math.max(0,scene.life-dt);if(!scene.life)scene=null;}
for(let i=releases.length-1;i>=0;i--){releases[i].delay-=dt;if(releases[i].delay<=0){const release=releases.splice(i,1)[0];
if(release.plunger){
  const served=makeBall(472,806);served.ready=true;served.vaultServe=true;balls.push(served);
  charging=false;charge=0;input.launch.clear();
  toast('BALL LOCKED · LAUNCH NEXT','PULL THE SPRING & RELEASE · SCORE ×2',4);
}else{const side=balls.length%2;balls.push(makeBall(side?305:185,185,side?-85:85,230));}}}
if(!balls.length&&!releases.length&&state.respawn>0){state.respawn-=dt;if(state.respawn<=0)spawnBall(state.savedRespawn);}
for(const active of [...balls]){if(!balls.includes(active))continue;ball=active;stepBall(dt);if(state.flight)break;}
if(state.flight)return;
collideBalls();ball=readyBall()||balls[0]||null;checkMultiball();
}
function stepBall(dt){
if(!ball)return;
if(ball.ramp){advanceRamp(dt);return;}
if(ball.ready){if(input.launch.size>0&&pullPointer===null){charging=true;charge=Math.min(1,charge+dt*.72);}ball.y=806+charge*23;return;}
launchAge+=dt;ball.shooterAge+=dt;ball.vy+=GRAVITY*dt;const drag=Math.exp(-.085*dt);ball.vx*=drag;ball.vy*=drag;const speed=Math.hypot(ball.vx,ball.vy);if(speed>MAX_SPEED){ball.vx*=MAX_SPEED/speed;ball.vy*=MAX_SPEED/speed;}const prevX=ball.x,prevY=ball.y;ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;
if(state.tilt<=0&&prevY>550&&ball.y<=550&&ball.x>80&&ball.x<180&&ball.vy<-250&&state.time>=ball.rampUntil){ball.ramp={elapsed:0,left:true,entry:[ball.x,ball.y]};ball.trail.length=0;audio.fx('vaultRamp',0,-.55);return;}
if(state.tilt<=0&&prevY>550&&ball.y<=550&&ball.x>310&&ball.x<410&&ball.vy<-250&&state.time>=ball.rampUntil){ball.ramp={elapsed:0,entry:[ball.x,ball.y]};ball.trail.length=0;audio.fx('ramp',0,.55);return;}
for(const r of rails){const hit=contact(r.ax,r.ay,r.bx,r.by,r.r,r.kind==='rubber'?.72:.48);if(hit&&r.sling&&r.active&&state.time-r.sling.last>.18&&hit.impact>60&&state.tilt<=0){const s=r.sling;s.last=state.time;s.hit=1;ball.vx=s.side*(470+Math.min(hit.impact*.07,60));ball.vy=-330;score(50,'SLING',ball.x,ball.y,2);effect(ball.x,ball.y,C.orange,5);audio.fx('sling',s.side,s.side===1?-.65:.65);}else if(hit&&hit.impact>150&&state.time>ball.railSound){ball.railSound=state.time+.065;audio.fx('rail',Math.min(hit.impact/500,2));}}
if(launched&&!ball.inShooter)contact(451,125,451,180,5,.4); // Each newly launched ball can exit; table balls cannot re-enter.
for(const t of targets){if(t.lit)continue;const hit=contact(t.x-2,t.y-9,t.x+2,t.y+9,5,.8);if(hit&&state.time-t.last>.12&&state.tilt<=0){t.last=state.time;t.hit=1;t.lit=true;score(350,t.label+' TARGET',t.x+15,t.y,8);effect(t.x,t.y,C.orange);audio.fx('target',targets.indexOf(t),-.4);if(targets.every(t=>t.lit)){score(3000,'FULL MIX',190,420,22);targetReset=state.time+1;toast('FULL MIX','3,000 POINTS · GROOVE BOOST',1.8);audio.fx('mix');}}}
for(let i=0;i<bumpers.length;i++){const b=bumpers[i],hit=contact(b.x,b.y,b.x,b.y,b.r,.55);if(hit)bumperHit(b,i,hit);}
for(const f of flips){const tx=f.x+Math.cos(f.angle)*f.len,ty=f.y+Math.sin(f.angle)*f.len;const hit=contact(f.x,f.y,tx,ty,7,.32,f);if(hit&&hit.impact>100){f.hit=.4;if(Math.abs(f.omega)>1)effect(ball.x,ball.y,C.cream,4);}}
const afterContactSpeed=Math.hypot(ball.vx,ball.vy);if(afterContactSpeed>MAX_SPEED){ball.vx*=MAX_SPEED/afterContactSpeed;ball.vy*=MAX_SPEED/afterContactSpeed;}
if(ball.x<438&&ball.y<182){launched=true;ball.inShooter=false;}
checkTopLanes();
if(launched&&ball.y>200)state.skillPending=false;
if(prevY>411&&ball.y<=411&&ball.x>214&&ball.x<277&&state.time>spinnerCooldown){spinnerCooldown=state.time+.3;spinSpeed=22;score(400,'SPINNER',245,410,10);audio.fx('spinner');effect(245,405,C.mint,5);if(state.multiball&&state.superLit&&state.tilt<=0)collectSuper();}
if(prevY>305&&ball.y<=305){const side=ball.x<80?0:ball.x>412&&ball.x<444?1:-1;if(side>=0&&state.time>orbitCooldown[side]){orbitCooldown[side]=state.time+1.5;score(1000,'ORBIT',ball.x,300,16);toast('ROUND & ROUND','ORBIT · 1,000 POINTS',1);audio.fx('orbit',side,side? .6:-.6);}}
// Weak launches settle back onto the plunger; only the center drain consumes a ball.
if(ball.inShooter&&ball.shooterAge>.8&&ball.x>451&&ball.y>805&&ball.vy>0){ball.ready=true;ball.inShooter=false;ball.vx=ball.vy=0;ball.y=806;charge=0;charging=false;input.launch.clear();return;}
if(ball.y>856&&ball.x<450)drain();
// Conservative recovery only outside the cabinet, never an invisible in-play kick.
if(ball&&(ball.x<-20||ball.x>W+20||ball.y<-40)){ball.x=clamp(ball.x,45,430);ball.y=70;ball.vx=0;ball.vy=100;}
}

// The lamp is a rollover contact, not a one-way line. At 240 Hz, the maximum
// 6.46px movement per step cannot skip this 34px-deep contact zone.
function checkTopLanes(){
  const index=rollovers.findIndex(r=>Math.abs(ball.x-r.x)<24&&Math.abs(ball.y-r.y)<=R+8);
  const previous=ball.laneContact;ball.laneContact=index;
  if(!launched||state.tilt>0||index<0||index===previous)return;
  const lane=rollovers[index];if(state.time-lane.last<=.7)return;
  lane.last=state.time;lane.lit=true;
  score(250,'TOP LANE',lane.x,165,5);audio.fx('lane',index);
  // Keep the launch skill-shot award attached to a descending return.
  if(state.skillPending&&ball.vy>0){
    state.skillPending=false;
    if(state.skill){score(2500,'SKILL SHOT',245,180,14);toast('SKILL SHOT','2,500 POINTS · BEAUTIFUL RELEASE',2);audio.fx('skill');}
  }
  if(rollovers.every(r=>r.lit)){
    score(1500,'ALL LANES',245,180,10);rollovers.forEach(r=>r.lit=false);
    state.flightReady=true;toast('NEEDLE DROP ARMED','SHOOT LEFT RAMP · CUE THE RECORD',2.5);audio.fx('skill');
  }
}

function resetFeatures(){
  balls.length=releases.length=0;scene=null;captive=null;studio.reset();
  Object.assign(state,{locks:0,multiball:false,mbSaveUntil:0,jackpotBase:5000,jackpotMult:1,jackpots:0,superLit:false,rampShots:0,vaultMult:1,vaultUntil:0,vaultTick:0,vaultBank:0,vaultCaptures:0,vaultWaiting:false,flightReady:false,flight:null,flightReward:false});
  if($('featureStatus'))$('featureStatus').textContent='';
}
function featureObjective(){
  if(nexbreakPending)return 'NEXBREAK READY · COMPLETE YOUR BONUS / LOCK LEFT RAMP';
  if(state.flight)return state.flight.kind?window.GroovelineSessions.names[state.flight.kind]+' · '+window.GroovelineSessions.instructions[state.flight.kind]:'NEEDLE DROP · FLIPPERS MOVE · SPACE / DROP CUES';
  if(state.flightReady&&!captive)return 'NEEDLE DROP ARMED · SHOOT LEFT RAMP';
  if(studio.data.queue.length)return window.GroovelineSessions.names[studio.data.queue[0]]+' READY · '+(state.multiball?'FINISH MULTIBALL':captive?'FINISH VAULT · THEN LEFT RAMP':'SHOOT LEFT RAMP');
  if(captive&&state.vaultWaiting)return state.flightReward?'PERFECT MIX · LAUNCH FOR MULTIBALL + ×2':'BALL LOCKED · LAUNCH NEXT FOR ×2 POINTS';
  if(captive)return 'BASS VAULT ×'+state.vaultMult+' · '+Math.ceil(state.vaultUntil-state.time)+'s · LEFT RAMP BOOSTS';
  if(state.multiball)return state.superLit?'SUPER LIT · SHOOT THE SPINNER':'RAMP JACKPOT '+(state.jackpotBase*state.jackpotMult).toLocaleString()+' · '+state.jackpots+'/3 TO SUPER';
  return 'RIGHT LOCKS '+state.locks+'/3 · LEFT RAMP = BASS VAULT ×2';
}
function celebrate(kind,title,sub,duration=1.8){
  scene={kind,title,sub,duration,life:duration};
  $('featureStatus').textContent=title+'. '+sub;
  audio.fx(kind);
}
function startMultiball(){
  state.multiball=true;state.locks=0;state.jackpots=0;state.superLit=false;state.saveUntil=0;
  state.mbSaveUntil=state.time+12;while(activeCount()<3)releases.push({delay:.35+releases.length*.45});
  celebrate('multiball','MULTIBALL','THREE BALLS · 12 SECOND SAVE',2.4);
}
function checkMultiball(){
  if(state.multiball&&balls.length+releases.length<=1){
    state.multiball=false;state.mbSaveUntil=0;state.superLit=false;state.jackpots=0;
    toast('BACK TO ONE','LOCK THREE RAMPS · NEXT JACKPOT ×'+state.jackpotMult,2);
  }
}
function collectJackpot(){
  const base=state.jackpotBase*state.jackpotMult,award=base*state.mult*(state.drop>0?2:1)*vaultMultiplier();
  score(base,'JACKPOT',397,540,5);state.jackpotBase+=2500;state.jackpots++;
  if(state.jackpots>=3)state.superLit=true;
  celebrate('jackpot','JACKPOT',award.toLocaleString()+' POINTS · '+(state.superLit?'SUPER LIT AT SPINNER':'NEXT RAMP BUILDS AGAIN'));
}
function collectSuper(){
  const base=state.jackpotBase*state.jackpotMult*3,award=base*state.mult*(state.drop>0?2:1)*vaultMultiplier();
  score(base,'SUPER JACKPOT',245,405,10);state.superLit=false;state.jackpots=0;
  state.jackpotMult=Math.min(5,state.jackpotMult+1);
  celebrate('super','SUPER JACKPOT',award.toLocaleString()+' · NEXT JACKPOTS ×'+state.jackpotMult,2.4);
}
// The elevated ramp follows one shared path for rendering and ball travel.
// Once on it, the ball is above playfield collisions; it rejoins at the return.
const rampControls=[[360,550],[421,465],[430,340],[429,226],[410,184],[382,220],[383,350],[386,480],[374,583],[340,628],[305,665]];
function smoothTrack(controls){
  const points=[];
  for(let i=0;i<controls.length-1;i++){
    const p0=controls[Math.max(0,i-1)],p1=controls[i],p2=controls[i+1],p3=controls[Math.min(controls.length-1,i+2)];
    for(let j=0;j<16;j++){const t=j/16,t2=t*t,t3=t2*t;points.push([0,1].map(k=>.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3)));}
  }
  points.push(controls.at(-1));return points;
}
const rampPath=smoothTrack(rampControls);
const rampDistances=[0];
for(let i=1;i<rampPath.length;i++)rampDistances.push(rampDistances[i-1]+Math.hypot(rampPath[i][0]-rampPath[i-1][0],rampPath[i][1]-rampPath[i-1][1]));
function rampPoint(progress){
  const distance=clamp(progress,0,1)*rampDistances.at(-1);let i=1;while(i<rampDistances.length-1&&rampDistances[i]<distance)i++;
  const f=(distance-rampDistances[i-1])/(rampDistances[i]-rampDistances[i-1]);return rampPath[i].map((v,k)=>rampPath[i-1][k]+(v-rampPath[i-1][k])*f);
}
function advanceRamp(dt){
  if(ball.ramp.left){advanceVaultRamp(dt);return;}
  ball.ramp.elapsed+=dt;const progress=ball.ramp.elapsed/1.8,[x,y]=rampPoint(progress);
  const blend=Math.min(1,ball.ramp.elapsed/.12),entry=ball.ramp.entry||[x,y];
  ball.x=entry[0]+(x-entry[0])*blend;ball.y=entry[1]+(y-entry[1])*blend;ball.vx=ball.vy=0;
  if(progress<1)return;
  ball.ramp=null;ball.rampUntil=state.time+1;ball.vx=-65;ball.vy=180;state.rampShots++;
  if(state.tilt>0)return;
  if(state.multiball)collectJackpot();
  else{state.locks++;score(1000,'RAMP LOCK',305,635,10);
    if(state.locks===3)startMultiball();
    else celebrate('lock','LOCK '+state.locks+' / 3',(3-state.locks)+' MORE RAMP'+(state.locks===1?'S':'')+' TO MULTIBALL',1.5);
  }
  studio.note('ramp');
}
// One captive ball; at most three served balls plus that reserve.
// Passive banking never triggers groove/combos; its timer uses simulation time.
const vaultPath=smoothTrack([[130,550],[66,479],[60,389],[62,296],[74,229],[111,197]]);
function vaultPoint(progress){
  const t=clamp(progress,0,1)*(vaultPath.length-1),i=Math.min(vaultPath.length-2,Math.floor(t)),f=t-i;
  return vaultPath[i].map((v,k)=>v+(vaultPath[i+1][k]-v)*f);
}
function advanceVaultRamp(dt){
  ball.ramp.elapsed+=dt;const progress=ball.ramp.elapsed/1.35;
  const [x,y]=vaultPoint(progress),blend=Math.min(1,ball.ramp.elapsed/.12),entry=ball.ramp.entry||[x,y];
  ball.x=entry[0]+(x-entry[0])*blend;ball.y=entry[1]+(y-entry[1])*blend;ball.vx=ball.vy=0;
  if(progress<1)return;
  ball.ramp=null;ball.rampUntil=state.time+2;
  if(state.tilt>0){ball.x=145;ball.y=545;ball.vx=80;ball.vy=180;return;}
  if(captive){
    state.vaultMult=Math.min(4,state.vaultMult+1);score(1000,'VAULT BOOST',111,215,5);
    ball.x=145;ball.y=545;ball.vx=80;ball.vy=180;
    celebrate('lock','VAULT ×'+state.vaultMult,'SHOT MULTIPLIER · TIMER KEEPS RUNNING',1.4);return;
  }
  captive=ball;balls.splice(balls.indexOf(ball),1);ball=null;
  state.vaultMult=2;state.vaultUntil=state.time+20;state.vaultTick=state.time+1;state.vaultBank=0;state.vaultCaptures++;
  state.saveUntil=0;
  const existing=readyBall(),pendingPlunger=releases.some(r=>r.plunger);
  if(existing||pendingPlunger||activeCount()<3){
    state.vaultWaiting=true;state.vaultUntil=0;state.vaultTick=0;
    if(existing)existing.vaultServe=true;
    else if(!pendingPlunger)releases.push({delay:.45,plunger:true});
    celebrate('capture','BALL LOCKED','LAUNCH NEXT · ACTIVATE ×2 POINTS',2.5);
  }else celebrate('capture','BASS VAULT','BALL HELD · SHOTS ×2 · 20 SECONDS',2);
  if(state.flightReady)startFlight();
  else if(!state.multiball&&activeCount()<=1&&studio.data.queue.length)startStudio();
}
function tickVault(){
  if(!captive)return;
  if(state.tilt>0){releaseVault(false);return;}
  if(state.vaultWaiting)return;
  while(state.time>=state.vaultTick&&state.vaultTick<=state.vaultUntil){
    const award=250*state.vaultMult;state.score+=award;state.vaultBank+=award;state.vaultTick+=1;
    floaters.push({x:111,y:176,text:'+'+award,life:.85});effect(111,197,C.gold,3);audio.fx('vault');
  }
  if(state.time>=state.vaultUntil)releaseVault(true);
}
function releaseVault(celebration){
  if(!captive)return;
  const released=captive;captive=null;released.x=145;released.y=545;released.vx=80;released.vy=180;released.rampUntil=state.time+2;
  balls.push(released);state.vaultMult=1;state.vaultUntil=0;state.vaultWaiting=false;
  if(activeCount()>1&&!state.multiball&&state.tilt<=0){state.multiball=true;state.jackpots=0;state.superLit=false;state.mbSaveUntil=0;}
  if(celebration)celebrate('release','VAULT RELEASE',state.vaultBank.toLocaleString()+' BANKED · RAMP JACKPOTS LIVE',2);
  else if(state.tilt<=0)toast('VAULT RESCUE','YOUR HELD BALL RETURNS · KEEP PLAYING',1.6);
}
function drawVault(g){
  drawWireRamp(g,vaultPath,C.orange);
  arrow(g,130,579,captive?C.gold:C.orange,1);
  rounded(g,56,592,74,22,4,'#170f1d',captive?C.gold:C.orange);
  text(g,captive?'BOOST ×'+state.vaultMult:state.flightReady?'NEEDLE DROP':'BASS VAULT',93,603,7,captive?C.gold:C.orange);
  circle(g,111,197,20,'#100e19',captive?C.gold:C.orange,2);
  if(captive){
    g.save();g.strokeStyle=C.gold;g.lineWidth=3;g.beginPath();g.arc(111,197,24,-Math.PI/2,-Math.PI/2+Math.PI*2*clamp((state.vaultWaiting?1:(state.vaultUntil-state.time)/20),0,1));g.stroke();g.restore();
    drawBall(captive);text(g,'×'+state.vaultMult+' · '+(state.vaultWaiting?'ARMED':Math.ceil(state.vaultUntil-state.time)+'s'),111,164,9,C.gold);
    text(g,state.vaultBank.toLocaleString(),111,231,9,C.gold);
  }else text(g,'HOLD',111,197,7,C.orange);
}
function collideBalls(){
  for(let i=0;i<balls.length;i++)for(let j=i+1;j<balls.length;j++){
    const a=balls[i],b=balls[j];if(a.ready||b.ready||a.ramp||b.ramp)continue;
    let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d>=R*2)continue;
    const nx=d>0?dx/d:1,ny=d>0?dy/d:0,overlap=(R*2-d+.01)/2;
    a.x-=nx*overlap;a.y-=ny*overlap;b.x+=nx*overlap;b.y+=ny*overlap;
    const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
    if(relative<0){const impulse=-relative*.92;a.vx-=nx*impulse;a.vy-=ny*impulse;b.vx+=nx*impulse;b.vy+=ny*impulse;}
    for(const item of [a,b]){const speed=Math.hypot(item.vx,item.vy);if(speed>MAX_SPEED){item.vx*=MAX_SPEED/speed;item.vy*=MAX_SPEED/speed;}}
  }
}
// Chrome wire rails, transparent trough, mounting collars and LED chase.
function drawWireRamp(g,points,color){
  g.save();line(g,points.map(([x,y])=>[x+3,y+6]),'#00000066',25);
  line(g,points,'#081b2580',20);line(g,points,color+'18',16);
  for(const sign of [-1,1]){
    const edge=points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;return[p[0]-dy/len*9*sign,p[1]+dx/len*9*sign];});
    line(g,edge,'#10232b',5);line(g,edge,'#7397a1',3);line(g,edge.map(([x,y])=>[x-.6,y-.8]),'#e2f7f6',1);
  }
  for(let i=8;i<points.length-8;i+=24){const p=points[i],q=points[i+1],a=Math.atan2(q[1]-p[1],q[0]-p[0]);
    line(g,[[p[0]-Math.sin(a)*11,p[1]+Math.cos(a)*11],[p[0]+Math.sin(a)*11,p[1]-Math.cos(a)*11]],'#68889188',2);
    circle(g,p[0]-Math.sin(a)*11,p[1]+Math.cos(a)*11,2,color);
  }
  if(!reduced)for(let i=0;i<4;i++){const p=points[Math.floor(((state.time*.18+i/4)%1)*(points.length-1))];circle(g,p[0],p[1],1.6,color);}
  const [x,y]=points[0];
  path(g,[[x-56,y+15],[x-20,y-34],[x+20,y-34],[x+56,y+15]]);g.closePath();g.fillStyle=color+'22';g.fill();
  line(g,[[x-56,y+15],[x-20,y-34]],'#d4edf1',2);line(g,[[x+56,y+15],[x+20,y-34]],'#d4edf1',2);
  line(g,[[x-50,y+12],[x+50,y+12]],color,3);arrow(g,x,y,color,1);
  g.restore();
}
function drawRamp(g){
  g.save();
  drawWireRamp(g,rampPath,C.mint);
  arrow(g,360,579,state.multiball?C.gold:C.mint,1);
  rounded(g,369,592,63,22,4,'#07151d',state.multiball?C.gold:C.mint);
  text(g,state.multiball?'JACKPOT':'LOCK RAMP',400,603,7,state.multiball?C.gold:C.mint);
  if(state.superLit){circle(g,245,409,32,null,C.gold,2);text(g,'SUPER',245,382,9,C.gold,'bold Orbitron');}
  g.restore();
}
function drawProgression(g){
  rounded(g,156,614,178,38,5,'#080e19dd','#00d4c844');
  const progress=studio.data;
  text(g,'NEEDLES '+(progress.needleWins%3)+'/3 · RAMPS '+(progress.ramps%4)+'/4 · CRATE '+(progress.highestMult<3?'×3':progress.highestMult<5?'×5':'✓'),245,658,8,C.cream);
  text(g,progress.queue.length?window.GroovelineSessions.names[progress.queue[0]]+' · '+(state.multiball?'AFTER MULTIBALL':captive?'AFTER VAULT':'LEFT RAMP'):'NEXBREAK '+nexbreakWins.size+'/'+(nexbreakVisits?4:2)+' · WIN DJ CHALLENGES',245,671,8,progress.queue.length?C.gold:C.mint);
  if(!state.multiball){text(g,'LOCK THE RAMP',245,625,8,C.mint,'Orbitron');for(let i=0;i<3;i++)lamp(g,224+i*21,641,4,C.gold,i<state.locks);}
  else{text(g,state.superLit?'SPINNER / SUPER JACKPOT':'RAMP / JACKPOT ×'+state.jackpotMult,245,625,8,C.gold,'Orbitron');text(g,(state.jackpotBase*state.jackpotMult).toLocaleString()+' · '+(balls.length+releases.length)+' BALLS',245,641,11,C.cream);}
}
// Keep the flight state/control contract: this is the same skill bonus, now a DJ cue.

// Distinct wins earn two visits per pinball session: first at 2/4, encore at 4/4.
function noteNexbreak(kind){
  if(!['needle','beat','crate','headliner'].includes(kind))return;
  nexbreakWins.add(kind);
  if(nexbreakVisits<2&&nexbreakWins.size>=(nexbreakVisits?4:2)){
    if(!nexbreakPending)toast('NEXBREAK ACCESS EARNED','YOUR BALL WILL WAIT · SECRET DJ STAGE',3);
    nexbreakPending=true;
  }
}
function syncNexbreakPass(){
  const el=$('nexbreakProgress');if(!el)return;
  el.textContent=nexbreakVisits>=2?'BOTH SETS PLAYED':nexbreakPending?'ACCESS EARNED':nexbreakWins.size+' / '+(nexbreakVisits?4:2)+' DJ WINS';
  const pass=$('nexbreakPass');
  pass.querySelectorAll('[data-win]').forEach(e=>e.classList.toggle('earned',nexbreakWins.has(e.getAttribute('data-win'))));
}
function tryNexbreak(){
  if(state.vaultCaptures===nexbreakFailedCapture||!nexbreakPending||!window.GroovelineNexbreak||state.flight||state.tilt>0||state.multiball||!captive||!state.vaultWaiting||balls.some(b=>!b.ready)||releases.some(r=>!r.plunger))return false;
  clearInput();state.nexbreak=true;scene=null;toastTimer=0;$('toast').classList.remove('show');
  const visit=nexbreakVisits;
  window.GroovelineNexbreak.open({encore:visit===1,
    fx:(kind,value)=>audio.fx(kind,value),sample:()=>radioFrame,
    done(result){
      if(!state.nexbreak)return;
      state.nexbreak=false;clearInput();
      if(!result.failed){nexbreakVisits++;nexbreakPending=nexbreakVisits<2&&nexbreakWins.size>=4;nexbreakFailedCapture=state.vaultCaptures;}
      else {nexbreakPending=true;nexbreakFailedCapture=state.vaultCaptures;}
      // Award exactly the displayed amount once, independently of held table multipliers.
      const reward=Number.isFinite(result.points)?Math.max(0,Math.min(100000,Math.floor(result.points))):0;
      state.score+=reward;state.lastShot=reward?'NEXBREAK BONUS':'BACK TO THE TABLE';
      saveBest();audio.resume();
      toast(result.failed?'NEXBREAK WILL RETRY':'WELCOME BACK',reward?'+'+reward.toLocaleString()+' POINTS · LAUNCH WHEN READY':'BALL SAFE · LAUNCH WHEN READY',4);
      syncHUD();
    }
  });return true;
}

function startStudio(kind){
  const f=studio.take(kind);if(!f)return false;
  clearInput();scene=null;toastTimer=0;$('toast').classList.remove('show');state.flight=f;
  $('featureStatus').textContent=window.GroovelineSessions.names[f.kind]+'. '+window.GroovelineSessions.instructions[f.kind];return true;
}
function finishStudio(){
  const f=state.flight;state.flight=null;clearInput();studio.complete(f);
  if(f.result==='won'){
    noteNexbreak(f.kind);
    const base={beat:6000,crate:8000,headliner:15000}[f.kind]*(f.level+1);
    score(base,window.GroovelineSessions.names[f.kind]+' JACKPOT',245,400);
    state.jackpotBase+=f.kind==='headliner'?7500:f.kind==='crate'?5000:2500;
    if(f.kind==='headliner'){
      state.jackpotMult=Math.min(5,state.jackpotMult+1);
      if(state.vaultWaiting)state.flightReward=true;else startMultiball();
    }
    celebrate('studioWin','SET COMPLETE',state.flightReward?'LAUNCH FOR MULTIBALL · JACKPOTS BUILT':'JACKPOTS BUILT · LAUNCH FOR VAULT ×2',2.5);
  }else celebrate('drain','BACK TO THE TABLE',state.flightReward?'NEEDLE REWARD SAFE · LAUNCH MULTIBALL':'BALL SAFE · LAUNCH FOR VAULT ×2',2.5);
}
function startFlight(){
  state.flightReady=false;clearInput();scene=null;toastTimer=0;$('toast').classList.remove('show');
  state.flight={time:0,x:245,targetX:245,health:3,gate:0,nextGate:2,gap:160,shotAt:-10,beam:0,feedback:'',feedbackUntil:0,cueAnnounced:false};
  $('featureStatus').textContent='Needle Drop. Flippers move the tonearm through three clean groove gaps. Then line up the needle with the gold cue point and press Space or DROP.';
  audio.fx('cueReady');
}
function finishFlight(won){
  state.flight=null;clearInput();
  if(won){
    const base=10000*state.jackpotMult;score(base,'PERFECT MIX',245,400);
    state.jackpotMult=Math.min(5,state.jackpotMult+1);
    state.flightReward=state.vaultWaiting;
    if(!state.vaultWaiting)startMultiball();
    studio.note('needle');noteNexbreak('needle');
    if(studio.data.needleWins%3===0&&startStudio('headliner'))return;
    celebrate('super','PERFECT NEEDLE DROP',state.vaultWaiting?'JACKPOT · LAUNCH TO RELEASE MULTIBALL':'JACKPOT · MULTIBALL CONTINUES',3);
  }else celebrate('drain','RE-CUE NEXT TIME','BALL SAFE · LAUNCH FOR VAULT ×2',2.5);
}
function stepFlight(dt){
  const f=state.flight;
  if(f.kind){if(studio.step(f,dt,{left:input.left.size>0,right:input.right.size>0}))finishStudio();return;}
  f.time+=dt;
  if(f.result){f.resultTime+=dt;if(f.resultTime>=1.1)finishFlight(true);return;}
  f.x=clamp(f.x+((input.right.size?1:0)-(input.left.size?1:0))*220*dt,110,380);
  f.targetX=245+Math.sin(f.time*.8)*95;f.beam=Math.max(0,f.beam-dt);
  if(f.gate<3&&f.time>=f.nextGate){
    const clean=Math.abs(f.x-f.gap)<=58;
    if(!clean)f.health--;
    audio.fx(clean?'cueGate':'cueMiss');
    f.feedback=clean?'CLEAN GROOVE':'SKIP · KEEP THE NEEDLE IN THE GAP';f.feedbackUntil=f.time+.65;
    f.gate++;f.nextGate+=2;f.gap=[160,330,200][f.gate]||245;
    if(f.health<=0){finishFlight(false);return;}
  }
  if(f.time>=7&&!f.cueAnnounced){
    f.cueAnnounced=true;audio.fx('cueReady');
    $('featureStatus').textContent='Cue point ready. Align the needle with the gold ring. Space or DROP lowers the needle.';
  }
  if(f.time>=17)finishFlight(false);
}
function fireFlight(){
  const f=state.flight;if(f?.kind){studio.press(f,'launch');return;}if(!f||f.result||f.time-f.shotAt<.3)return;
  f.shotAt=f.time;f.beam=.15;audio.fx('needle');
  if(f.time>=7&&Math.abs(f.x-f.targetX)<25){f.result='won';f.resultTime=0;audio.fx('cueSuccess');}
  else{f.feedback=f.time<7?'WAIT FOR THE GOLD CUE':'OFF CUE · SHIFT & DROP AGAIN';f.feedbackUntil=f.time+.65;if(f.time>=7)audio.fx('cueMiss');}
}
function drawFlight(g){
  if(state.flight.kind){window.GroovelineSessions.draw(g,state.flight,reduced);return;}
  const f=state.flight,ready=f.time>=7,won=!!f.result,aligned=ready&&Math.abs(f.x-f.targetX)<25;
  const cueColor=aligned?C.mint:C.gold,spin=reduced?0:f.time*1.8,tipY=532;
  g.save();rounded(g,58,196,404,552,14,'#050c13fa',C.mint);
  g.save();g.beginPath();g.roundRect(59,197,402,550,14);g.clip();
  const panel=g.createLinearGradient(60,300,460,620);panel.addColorStop(0,'#18232d');panel.addColorStop(.5,'#0b111b');panel.addColorStop(1,'#23303a');
  rounded(g,73,309,374,323,12,panel,'#4a5e6c');
  for(const [x,y] of [[84,320],[436,320],[84,620],[436,620]]){circle(g,x,y,3,'#637582');line(g,[[x-2,y],[x+2,y]],'#14212c',1);}
  // Top-down platter, concentric grooves and the rotating Grooveline record label.
  circle(g,250,468,152,'#020508','#889ba5',3);
  for(let i=0;i<64;i++){const a=i*Math.PI/32+spin*.2;circle(g,250+Math.cos(a)*148,468+Math.sin(a)*148,1.1,i%4?C.steel:C.mint);}
  circle(g,250,468,141,'#080d15','#29404c',2);
  for(let r=48;r<=137;r+=4)circle(g,250,468,r,null,r%3?'#27333e':'#3d4b56',.6);
  g.save();g.translate(250,468);g.rotate(spin);
  for(const a of [0,Math.PI]){g.beginPath();g.arc(0,0,120,a+.12,a+.53);g.strokeStyle='#9bb5cc20';g.lineWidth=24;g.stroke();}
  circle(g,0,0,43,'#006760',C.mint,1);
  text(g,'GROOVELINE',0,-11,8,C.cream,'bold Orbitron');
  for(let i=0;i<7;i++){const h=[6,11,17,22,15,10,5][i];rounded(g,-22+i*7,13-h,4,h,1,i%2?C.cream:C.mint);}
  text(g,'CUE / 001',0,28,6,'#b8eee8');g.restore();circle(g,250,468,4,'#c9d5dc','#080e13',1);
  // Three approaching scratch bands: keep the stylus inside each clean gap.
  if(f.gate<3){
    const y=329+clamp(1-(f.nextGate-f.time)/2,0,1)*(tipY-329);
    g.save();g.beginPath();g.arc(250,468,139,0,Math.PI*2);g.clip();
    for(const [a,b] of [[100,f.gap-60],[f.gap+60,400]]){
      line(g,[[a,y],[b,y]],'#ff5e6c44',16);line(g,[[a,y],[b,y]],C.orange,3);
      for(let x=a+4;x<b;x+=13)line(g,[[x,y-6],[Math.min(x+5,b),y+6]],'#ff899488',1);
    }
    line(g,[[f.gap-57,y],[f.gap+57,y]],'#00d4c877',2);g.restore();
    // Exact clean-window marker at the needle's scan line.
    line(g,[[f.gap-58,tipY+14],[f.gap-58,tipY+22],[f.gap+58,tipY+22],[f.gap+58,tipY+14]],C.mint,2);
  }
  if(ready){
    circle(g,f.targetX,tipY,25,'#f0c04018',cueColor,2);
    circle(g,f.targetX,tipY,7,null,cueColor,2);
    line(g,[[f.targetX-32,tipY],[f.targetX-27,tipY]],cueColor,2);
    line(g,[[f.targetX+27,tipY],[f.targetX+32,tipY]],cueColor,2);
    text(g,'CUE',f.targetX,tipY+41,9,cueColor);
  }
  // A real tonearm silhouette instead of a craft or projectile. The stylus is
  // directly above its contact point; dropping animates only this short travel.
  const lift=won||f.beam>0?0:10;
  line(g,[[427,591],[395,554],[f.x+19,tipY-62-lift],[f.x,tipY-43-lift]],'#00000099',13);
  line(g,[[427,587],[395,550],[f.x+19,tipY-66-lift],[f.x,tipY-47-lift]],'#798a99',9);
  line(g,[[427,585],[395,548],[f.x+19,tipY-68-lift],[f.x,tipY-49-lift]],'#d2e2e8',3);
  circle(g,427,587,16,'#172732','#8ba0ad',2);circle(g,427,587,7,'#03090f',C.mint,1);
  rounded(g,f.x-11,tipY-47-lift,22,33,4,'#b5c8ce','#f0f6fa');
  rounded(g,f.x-7,tipY-42-lift,14,12,2,'#0d252a',C.mint);
  line(g,[[f.x,tipY-14-lift],[f.x,tipY-lift]],C.orange,3);
  circle(g,f.x,tipY,3,won?C.gold:C.mint);
  if(f.beam>0||won)circle(g,f.x,tipY,won?14:9,null,C.mint,2);
  if(won){
    for(let i=0;i<3;i++)circle(g,f.x,tipY,reduced?24+i*13:12+((f.resultTime*95+i*28)%110),null,i%2?C.mint:C.gold,2);
  }
  // Mixer strip: progress lamps and short celebratory level bars, not a new
  // soundtrack. The independent radio and effects buses remain untouched.
  rounded(g,89,643,342,30,5,'#071019','#2e444f');
  for(let i=0;i<18;i++){const h=won?(reduced?13:6+(Math.sin(f.resultTime*18+i)+1)*8):4+(i%4)*3;rounded(g,101+i*9,665-h,5,h,1,won?C.gold:i%3?C.mint:C.orange);}
  text(g,won?'IN THE MIX':ready?'CUE READY':'33⅓ RPM',359,658,10,won?C.gold:C.mint);
  g.restore();
  text(g,'NEEDLE DROP',260,230,23,C.cream,'bold Orbitron');
  text(g,'TRACKING '+f.health+'/3 · '+Math.max(0,Math.ceil(17-f.time))+'s',260,255,11,C.mint);
  for(let i=0;i<3;i++)lamp(g,240+i*20,273,3,C.mint,i<f.gate);
  const hint=won?'PERFECT MIX!':f.feedbackUntil>f.time?f.feedback:ready?(aligned?'ON CUE · DROP NOW':'ALIGN WITH THE GOLD CUE'):'STEER THROUGH THE CLEAN GROOVE';
  text(g,hint,260,296,hint.length>28?9:12,won||ready?C.gold:C.mint,won?'bold Orbitron':'Share Tech Mono');
  text(g,'← FLIPPERS MOVE THE TONEARM →',260,694,10,C.cream);
  text(g,'SPACE / DROP = LOWER NEEDLE',260,716,11,C.gold);
  text(g,'PERFECT CUE → JACKPOT + MULTIBALL',260,736,8,C.mint);g.restore();
}
function drawScene(g){
  const elapsed=scene.duration-scene.life,p=elapsed/scene.duration;
  g.save();rounded(g,128,459,234,147,8,'#06131eef',scene.kind==='super'?C.gold:C.mint);
  g.save();g.beginPath();g.roundRect(129,460,232,145,8);g.clip();
  for(let i=0;i<15;i++){const phase=reduced?i/15:(i/15+p*.6)%1;line(g,[[130,606-phase*147],[360,606-phase*147]],'#00d4c820',1);}
  for(const side of [-1,1]){
    g.save();g.translate(245+side*50,505);if(!reduced)g.rotate(elapsed*side*3);
    circle(g,0,0,25,'#03090f',C.mint,1);for(let r=12;r<25;r+=4)circle(g,0,0,r,null,'#49868866',1);
    circle(g,0,0,9,side<0?C.orange:C.gold);line(g,[[0,-20],[12,-14]],'#ffffff88',2);g.restore();
  }
  if(!reduced){for(let i=0;i<12;i++){const x=135+i*19,h=4+(Math.sin(elapsed*6+i)+1)*6;rounded(g,x,589-h,8,h,1,i%3?C.mint:C.orange);}}
  g.restore();text(g,scene.title,245,545,scene.kind==='super'?16:20,scene.kind==='super'?C.gold:C.cream,'bold Orbitron');
  text(g,scene.sub,245,567,7,C.mint);g.restore();
}

function syncHUD(){syncNexbreakPass();document.body?.classList.toggle('flight-mode',!!state.flight);const studioKind=state.flight?.kind,studioName=studioKind?window.GroovelineSessions.names[studioKind]:'NEEDLE DROP',studioAction=studioKind?window.GroovelineSessions.actions[studioKind]:'DROP';$('flightFire').textContent=studioAction;$('flightFire').setAttribute('aria-label',studioKind?studioAction+' in '+studioName:'Drop the needle on the cue point');const n=String(state.score).padStart(6,'0');$('score').textContent=$('mobileScore').textContent=n;$('best').textContent=String(Math.max(state.best,state.score)).padStart(6,'0');const left=state.mode==='over'?0:4-state.ballNo;$('balls').textContent='●'.repeat(left)+'○'.repeat(3-left);$('mult').textContent='×'+state.mult+(state.drop>0?' ×2':'')+(captive?' VAULT ×'+state.vaultMult:'');$('mobileBalls').textContent='● '.repeat(left)+' ×'+state.mult+(state.drop>0?' ×2':'');$('lastShot').textContent=state.lastShot;$('grooveValue').textContent=state.drop>0?Math.ceil(state.drop)+'s':Math.floor(state.groove)+'%';$('grooveLabel').textContent=state.drop>0?'THE DROP · DOUBLE POINTS':'GROOVE LEVEL';$('grooveFill').style.width=(state.drop>0?state.drop/20*100:state.groove)+'%';$('bumperProgress').querySelectorAll('i').forEach((el,i)=>el.classList.toggle('on',bumpers[i].lit));$('targetProgress').querySelectorAll('i').forEach((el,i)=>el.classList.toggle('on',targets[i].lit));$('featureObjective').textContent=featureObjective();const save=state.saveUntil-state.time;$('tableStatus').innerHTML=state.mode==='playing'?(state.flight?'<b>'+studioName+'</b> SPACE / '+studioAction:state.tilt>0?'<b>TILT</b> '+state.tilt.toFixed(1)+'s':readyBall()?(charging?'<b>RELEASE TO LAUNCH</b> '+Math.round(charge*100)+'%':state.vaultWaiting?'<b>BALL LOCKED</b> LAUNCH FOR ×2':'<b>PULL SPRING</b> OR HOLD SPACE'):state.multiball?'<b>MULTIBALL</b> '+(state.superLit?'SPINNER · SUPER JACKPOT':state.time<state.mbSaveUntil?'BALL SAVE '+Math.ceil(state.mbSaveUntil-state.time)+'s':'RAMP · JACKPOT ×'+state.jackpotMult):state.drop>0?'<b>THE DROP</b> DOUBLE POINTS · '+Math.ceil(state.drop)+'s':save>0?'<b>BALL SAVE</b> '+Math.ceil(save)+'s':'<b>33⅓</b> RPM · KEEP IT SPINNING'):'<b>33⅓</b> RPM · STEREO PINBALL';$('mobileStatus').textContent=state.flight?studioName+' · '+studioAction:state.vaultWaiting?'LOCKED · LAUNCH FOR ×2':state.drop>0?'THE DROP · '+Math.ceil(state.drop)+'s':state.mode==='playing'?state.multiball?'MULTIBALL · '+(balls.length+releases.length):captive?'VAULT ×'+state.vaultMult+' · '+Math.ceil(state.vaultUntil-state.time)+'s':'BALL '+state.ballNo+' / 3':'ON AIR PINBALL';$('launchTouch').textContent=state.flight?studioAction:readyBall()?(charging?'RELEASE '+Math.round(charge*100)+'%':state.vaultWaiting?'LAUNCH ×2':'HOLD / LAUNCH'):'SPACE / LAUNCH';}
// Rendering: static silkscreen and cabinet are cached; moving mechanisms are layered on top.
function path(g,pts){g.beginPath();g.moveTo(...pts[0]);for(let i=1;i<pts.length;i++)g.lineTo(...pts[i]);}
function line(g,pts,color,width=1){path(g,pts);g.strokeStyle=color;g.lineWidth=width;g.lineCap='round';g.lineJoin='round';g.stroke();}
function circle(g,x,y,r,fill,stroke,width=1){g.beginPath();g.arc(x,y,r,0,Math.PI*2);if(fill){g.fillStyle=fill;g.fill();}if(stroke){g.strokeStyle=stroke;g.lineWidth=width;g.stroke();}}
function text(g,txt,x,y,size=10,color=C.cream,font='monospace',align='center'){g.fillStyle=color;g.textAlign=align;g.textBaseline='middle';font=font.replace('Georgia','Orbitron').replace('Arial','Orbitron');if(font==='monospace')font='Share Tech Mono';const fm=font.match(/^((?:(?:bold|italic|[1-9]00) )+)(.*)$/);g.font=fm?fm[1]+size+'px '+fm[2]:size+'px '+font;g.fillText(txt,x,y);}
function rounded(g,x,y,w,h,r,fill,stroke){g.beginPath();g.roundRect(x,y,w,h,r);if(fill){g.fillStyle=fill;g.fill();}if(stroke){g.strokeStyle=stroke;g.lineWidth=1;g.stroke();}}
function screw(g,x,y){circle(g,x,y,4,'#242838','#636981',1);line(g,[[x-2,y+1],[x+2,y-1]],'#0e111c',1.3);}
function lamp(g,x,y,r,color,on){if(on){g.save();g.shadowBlur=15;g.shadowColor=color;circle(g,x,y,r,color);g.restore();circle(g,x-1,y-1,r*.45,'#ffffff55');}else circle(g,x,y,r,'#292e42','#495170',.7);}
function arrow(g,x,y,color,alpha=1,angle=0){g.save();g.translate(x,y);g.rotate(angle);g.globalAlpha=alpha;path(g,[[-7,6],[0,-5],[7,6],[0,2]]);g.closePath();g.fillStyle=color;g.fill();g.restore();}
function drawStatic(g){const wood=g.createLinearGradient(0,0,W,0);wood.addColorStop(0,'#0a0c11');wood.addColorStop(.025,'#467078');wood.addColorStop(.035,'#282c3b');wood.addColorStop(.965,'#2d3243');wood.addColorStop(.982,'#2f6870');wood.addColorStop(1,'#0f1117');rounded(g,0,0,W,H,30,wood);rounded(g,15,11,490,918,23,'#0f1320','#005a56');const bg=g.createLinearGradient(0,40,450,870);bg.addColorStop(0,'#0a1b24');bg.addColorStop(.45,'#0b111f');bg.addColorStop(1,'#080c18');rounded(g,23,38,474,842,19,bg);g.save();rounded(g,23,38,474,842,19);g.clip();
// Printed concentric grooves give the table texture without hiding the ball.
for(let r=55;r<570;r+=12){circle(g,245,420,r,null,'#7c88b80a',1);}for(let y=44;y<885;y+=4){line(g,[[23,y],[497,y]],'#0c0e180a',.65);}for(let x=31;x<498;x+=17)for(let y=47;y<878;y+=19){circle(g,x,y,.55,'#9daae109');}
// Cream and tangerine screen-printed orbit stripes.
for(let i=0;i<3;i++){g.beginPath();g.moveTo(54+i*10,558);g.bezierCurveTo(40+i*10,349,47+i*10,98,174+i*5,86);g.strokeStyle=i===1?'#ff5e6c66':'#00d4c840';g.lineWidth=i===1?6:2;g.stroke();g.beginPath();g.moveTo(424-i*9,558);g.bezierCurveTo(454-i*9,340,429-i*9,99,322-i*3,86);g.stroke();}
// Sweeping lower graphic echoes a record sleeve.
for(let i=0;i<5;i++){g.beginPath();g.moveTo(123-i*7,550);g.bezierCurveTo(137-i*7,628,196-i*7,689,226-i*7,705);g.strokeStyle=i%2?'#00d4c830':'#ff5e6c40';g.lineWidth=i===2?8:2;g.stroke();g.beginPath();g.moveTo(367+i*7,550);g.bezierCurveTo(353+i*7,628,294+i*7,689,264+i*7,705);g.stroke();}
text(g,'GROOVELINE',245,83,23,C.cream,'bold Orbitron');text(g,'STREAMING DJS SINCE 2001',245,103,7,'#8994bf');
// Twin vinyl decks and mixer, adapted from the site's live-DJ player.
for(const [x,color,label] of [[176,C.mint,'DECK A'],[314,C.orange,'DECK B']]){
rounded(g,x-43,188,86,93,7,'#080d15','#00d4c836');screw(g,x-35,195);screw(g,x+35,274);
line(g,[[x+35,196],[x+30,225],[x+18,247]],'#92aebb',2);circle(g,x+35,196,3,'#34455d','#839db4');rounded(g,x+14,243,7,11,2,color);
}
rounded(g,223,192,44,91,4,'#090c15','#00d4c835');text(g,'MIXER',245,200,5,'#7a94ad');
for(const x of [233,245,257]){line(g,[[x,224],[x,261]],'#26324c',2);rounded(g,x-4,236+(x%3)*5,8,4,1,x===245?C.orange:C.mint);}
line(g,[[231,272],[259,272]],'#334258',2);rounded(g,242,269,5,6,1,C.mint);

// Rollover arch label.
text(g,'LANE CHANGE · ← FLIPPERS →',245,180,8,'#8690b7');
// Table center wordmark, grounded in the printed playfield.
g.save();g.translate(245,497);g.rotate(0);text(g,'LIVE RADIO / REAL PINBALL',0,-25,9,'#8f99c3','Orbitron');text(g,'GROOVELINE',0,12,24,'#e2e8f8','bold Orbitron');line(g,[[-91,50],[90,50]],'#7888c9',1);text(g,'LISBON → WORLDWIDE / SINCE 2001',0,66,8,'#828db9');g.restore();
text(g,'MIX',124,359,10,C.orange,'bold monospace');text(g,'3,000',129,490,8,'#8691bb');g.save();g.translate(54,388);g.rotate(-Math.PI/2);text(g,'ROUND & ROUND · 1,000',0,0,8,'#8692bf');g.restore();g.save();g.translate(432,395);g.rotate(Math.PI/2);text(g,'THE LONG PLAY · 1,000',0,0,8,'#8692bf');g.restore();
// Screw-down plastic under slings and lane return.
for(const s of slings){g.save();g.translate(0,4);path(g,s.points);g.closePath();g.fillStyle='#090b13';g.fill();g.restore();path(g,s.points);g.closePath();const grad=g.createLinearGradient(s.points[0][0],590,s.points[2][0],719);grad.addColorStop(0,'#535a77');grad.addColorStop(1,'#29304c');g.fillStyle=grad;g.fill();g.strokeStyle='#7e88b0';g.lineWidth=2;g.stroke();const cx=s.side===1?126:364;g.save();g.translate(cx,660);g.rotate(s.side===1?1.13:-1.13);text(g,'GROOVELINE',0,0,8,'#a0acdf','bold Arial');g.restore();screw(g,s.points[0][0],s.points[0][1]+14);screw(g,s.points[1][0]+s.side*7,s.points[1][1]-7);}
// Shooter well, visible spring and calibrated launch strip.
rounded(g,459,189,27,666,12,'#101321','#33384e');line(g,[[465,198],[465,797]],'#a4add23a',1);text(g,'↑',472,229,21,'#8793c4');g.save();g.translate(473,480);g.rotate(-Math.PI/2);text(g,'HOLD · RELEASE · REPEAT',0,0,8,'#7a85b0');g.restore();
g.restore();
// Steel rails: broad shadow, dark edge, steel body, narrow specular highlight.
for(let pass=0;pass<4;pass++)for(const r of rails){const p=pass===3?[[r.ax-.7,r.ay-1.3],[r.bx-.7,r.by-1.3]]:[[r.ax,r.ay],[r.bx,r.by]];line(g,p,pass===0?'#0c0e18':pass===1?'#4f556e':pass===2?(r.kind==='sling'?'#99a5d7':'#8a93b4'):'#acb7e499',[r.r*2+6,r.r*2,r.r*.8,1][pass]);}
// Spinner bracket and gate.
line(g,[[214,420],[214,402],[276,402],[276,420]],'#0c0e18',5);line(g,[[214,420],[214,402],[276,402],[276,420]],'#939bbd',2);text(g,'SPIN / 400',245,439,8,'#8993bb');
// Lamp inserts and apron lettering.
text(g,'B A L L   S A V E',245,822,8,'#7f8ab3');text(g,'G R O O V E',245,680,9,'#919bc7');text(g,'BUILD THE METER · MAKE THE DROP',245,724,7,'#828bb1');
const apron=g.createLinearGradient(0,864,0,940);apron.addColorStop(0,'#141725');apron.addColorStop(1,'#1c2030');rounded(g,20,866,480,59,8,apron,'#576082');line(g,[[34,875],[486,875]],'#535d83',1);text(g,'GROOVELINE',42,896,13,C.cream,'bold Orbitron','left');text(g,'STREAMING DJS SINCE 2001',43,912,7,'#747da0','monospace','left');text(g,'33⅓',466,896,22,'#8c9bd5','Orbitron');text(g,'STEREO',465,914,7,'#7b84aa');for(const x of [28,492])for(const y of [25,916])screw(g,x,y);
}
function drawBumper(b,i,t){const g=ctx;g.save();g.translate(b.x,b.y);const bounce=b.hit*3;circle(g,0,6,38,'#0c0f1a');if(b.lit||b.hit){g.shadowColor=b.color;g.shadowBlur=14+b.hit*20;}circle(g,0,1,34,b.hit>.5?'#dffffb':'#21444d');g.shadowBlur=0;circle(g,0,-bounce,30,'#030d0d',b.color,1.4);circle(g,0,-bounce,27,'#030a0a','#005a56',1);for(let r=13;r<27;r+=2.7)circle(g,0,-bounce,r,null,'#00d4c82e',.65);g.save();g.translate(0,-bounce);g.rotate(recordAngle*(i%2?-1:1)+b.hit*.08);g.beginPath();g.arc(0,0,22,-2.9,-1.7);g.strokeStyle='#98a3d130';g.lineWidth=3;g.stroke();g.restore();if(i===2&&radioFrame.kind==='automix'){const core=g.createRadialGradient(-4,-bounce-5,1,0,-bounce,14);core.addColorStop(0,'#e2e8ff');core.addColorStop(.4,'#7875e5');core.addColorStop(1,'#222547');circle(g,0,-bounce,13,core);}else circle(g,0,-bounce,13,i===2?C.gold:'#003330');text(g,i===0?'A':i===1?'B':'GL',0,-bounce,8,i===2?'#0d0d18':b.color,'bold Orbitron');circle(g,0,-bounce,1.4,'#191d2b');text(g,b.label,0,44,7,b.lit?b.color:'#909ac4','bold monospace');lamp(g,0,57,3,b.color,b.lit);g.restore();}
function drawFlipper(f){const g=ctx;g.save();g.translate(f.x,f.y);g.rotate(f.angle);g.shadowColor='#080910';g.shadowBlur=7;g.shadowOffsetY=5;const grad=g.createLinearGradient(0,-9,0,9);grad.addColorStop(0,'#bcc9fc');grad.addColorStop(.5,'#a7b2db');grad.addColorStop(1,'#7881a2');g.beginPath();g.moveTo(0,-10);g.lineTo(f.len,-6);g.arc(f.len,0,6,-Math.PI/2,Math.PI/2);g.lineTo(0,10);g.arc(0,0,10,Math.PI/2,Math.PI*1.5);g.closePath();g.fillStyle=C.orange;g.fill();g.shadowBlur=0;g.shadowOffsetY=0;g.beginPath();g.moveTo(0,-6.5);g.lineTo(f.len-1,-3);g.quadraticCurveTo(f.len+5,0,f.len-1,3);g.lineTo(0,6.5);g.arc(0,0,6.5,Math.PI/2,Math.PI*1.5);g.closePath();g.fillStyle=grad;g.fill();circle(g,0,0,4,'#6e7694','#aeb9e4');line(g,[[13,-3],[f.len-8,-1]],'#ffffff90',1);g.restore();}
function drawBall(ball){if(!ball)return;const g=ctx;if(!reduced&&!ball.ready&&Math.hypot(ball.vx,ball.vy)>350){for(let i=0;i<ball.trail.length;i++){const p=ball.trail[i];circle(g,p.x,p.y,R*(i/ball.trail.length)*.7,'rgba(215,230,193,'+(i/ball.trail.length*.12)+')');}}g.save();g.shadowColor='#090b13';g.shadowBlur=4;g.shadowOffsetY=5;circle(g,ball.x,ball.y,R,'#7a819c');g.shadowBlur=0;g.shadowOffsetY=0;const metal=g.createRadialGradient(ball.x-3,ball.y-4,.5,ball.x+1,ball.y+1,R*1.12);metal.addColorStop(0,'#ffffff');metal.addColorStop(.2,'#fafdf2');metal.addColorStop(.42,'#d4e0d6');metal.addColorStop(.55,'#757c9b');metal.addColorStop(.72,'#262b3e');metal.addColorStop(.87,'#a5b3a5');metal.addColorStop(1,'#c0c9eb');circle(g,ball.x,ball.y,R,metal);circle(g,ball.x-3,ball.y-4,2.4,'#fff');g.restore();}
function draw(t,dt){const g=ctx;g.setTransform(dpr,0,0,dpr,0,0);g.drawImage(backdrop,0,0,W,H);g.save();if(shake>.1&&!reduced)g.translate(Math.sin(t*105)*shake*.4,Math.cos(t*83)*shake*.4);
if(radioFrame.playing){g.save();g.globalAlpha=.2+radioFrame.energy*.35;for(const side of [0,1])line(g,side?[[451,186],[451,613]]:[[30,186],[30,613]],side?C.orange:C.mint,2.5);g.restore();}
for(let i=0;i<8;i++){const level=radioFrame.levels[i];rounded(g,230+i*4,207+(1-level)*10,2,Math.max(1,level*10),.5,i>5?C.orange:C.mint);}
if(radioFrame.waveform){g.save();g.beginPath();for(let i=0;i<128;i++){const x=156+i*1.4,y=586+(radioFrame.waveform[i]-128)/128*14;i?g.lineTo(x,y):g.moveTo(x,y);}g.strokeStyle=C.mint;g.lineWidth=1;g.globalAlpha=.65;g.stroke();g.restore();}
else{line(g,[[173,586],[193,586],[200,580],[208,592],[221,570],[234,602],[248,560],[259,610],[274,576],[282,586],[317,586]],'#00d4c838',1.2);}
for(const r of rollovers){lamp(g,r.x,r.y,8,C.orange,r.lit);text(g,'●',r.x,r.y,6,r.lit?'#bdcaff':'#596283');}
for(let i=0;i<bumpers.length;i++)drawBumper(bumpers[i],i,t);
line(g,[[451,174],launched?[451,125]:[429,132]],'#949fc9',2);circle(g,451,174,3,'#49506c','#8993bb');
for(const target of targets){g.save();g.translate(target.x,target.y);g.rotate(-.1);rounded(g,-7,-12,14,24,3,target.lit?'#33384d':C.orange,target.lit?'#566085':'#91a7ff');text(g,target.label,0,0,11,target.lit?'#818dbd':'#181d31','bold Arial');if(target.hit>.1){g.globalAlpha=target.hit;rounded(g,-9,-14,18,28,3,'#b0c0ff77');}g.restore();lamp(g,target.x+24,target.y,3,C.orange,target.lit);}
for(const s of slings)if(s.hit>.01){g.save();g.globalAlpha=s.hit;line(g,[s.points[0],s.points[2]],'#7b95ff',4);g.restore();}
for(let i=0;i<3;i++){arrow(g,67,245+i*28,C.orange,.25+Math.max(0,Math.sin(t*3-i))*.5);arrow(g,426,246+i*28,C.mint,.25+Math.max(0,Math.sin(t*3-i))*.5);}arrow(g,245,456,C.mint,.45);arrow(g,245,478,C.mint,.25);
// Spinner rotates around the horizontal axle, exposing alternating label and metal back.
g.save();g.translate(245,409);g.scale(1,Math.max(.08,Math.abs(Math.cos(spinner))));rounded(g,-23,-8,46,16,2,Math.cos(spinner)>0?'#a1acdb':'#6f7694','#b3bde6');text(g,'SPIN',0,0,8,'#25293c','bold Arial');g.restore();
const groove=state.drop>0?100:state.groove;for(let i=0;i<10;i++){const x=191+i*12;rounded(g,x,695,8,13,2,i<groove/10?(state.drop>0&&Math.sin(t*10+i)>.5?'#a4b6ff':C.orange):'#31374f','#4a5171');}lamp(g,245,842,6,C.orange,state.time<state.saveUntil||ball?.ready);
// Real spring charge and matching marked sweet spot.
const drop=charge*23;line(g,[[462,846],[482,846]],'#8c94b4',4);const spring=[];for(let i=0;i<=16;i++)spring.push([472+(i%2?6:-6),824+drop+(846-824-drop)*i/16]);line(g,spring,'#8991b3',1.5);rounded(g,460,816+drop,24,6,2,'#a4afd9','#4d536d');rounded(g,502,608,5,201,2,'#2f3343');rounded(g,501,809-201*.82,7,201*.2,1,C.gold);rounded(g,502,809-charge*201,5,charge*201,2,charge>=.62&&charge<=.82?'#9bacf3':C.orange);for(let i=0;i<=10;i++)line(g,[[510,809-i*20],[513,809-i*20]],'#737eab',1);
if(!scene)window.GroovelineLiveTable?.draw(g,reduced);
drawRamp(g);drawVault(g);drawProgression(g);if(scene)drawScene(g);
if(captive&&state.vaultWaiting){
  rounded(g,131,475,228,100,8,'#071520f5',C.gold);
  text(g,'BALL LOCKED',245,494,17,C.gold,'bold Orbitron');
  text(g,state.flightReward?'LAUNCH FOR MULTIBALL + ×2':'LAUNCH NEXT FOR ×2 POINTS',245,520,10,C.cream);
  text(g,'PULL SPRING / HOLD SPACE, RELEASE',245,541,8,C.mint);
  text(g,'20s BONUS STARTS WHEN YOU LAUNCH',245,559,8,C.gold);
}
for(const f of flips)drawFlipper(f);for(const b of balls)drawBall(b);
for(const r of rings){g.globalAlpha=Math.max(0,r.life/.45)*.7;circle(g,r.x,r.y,r.r,null,r.color,1.5);}g.globalAlpha=1;for(const p of particles){g.globalAlpha=Math.max(0,p.life*2);circle(g,p.x,p.y,1.5,p.color);}g.globalAlpha=1;for(const f of floaters){g.globalAlpha=Math.min(1,f.life*2);text(g,f.text,f.x,f.y,11,'#b8c6ff','bold monospace');}g.globalAlpha=1;
if(state.drop>0){g.strokeStyle=C.orange;g.lineWidth=3;g.globalAlpha=.3+Math.sin(t*6)*.1;g.beginPath();g.roundRect(20,39,477,824,20);g.stroke();g.globalAlpha=1;}if(state.tilt>0){g.fillStyle='#13141c77';g.fillRect(28,600,420,260);text(g,'T I L T',245,762,20,C.orange,'bold monospace');}g.restore();
// Subtle glass reflection along one edge, never over the action.
if(state.flight)drawFlight(g);
const glass=g.createLinearGradient(18,0,125,0);glass.addColorStop(0,'#cad4ff0a');glass.addColorStop(1,'#ffffff00');g.fillStyle=glass;g.fillRect(24,43,100,808);
}
function animateFX(dt){shake*=Math.exp(-12*dt);spinner+=spinSpeed*dt;spinSpeed*=Math.exp(-2*dt);for(const b of [...bumpers,...targets,...slings])b.hit=Math.max(0,b.hit-dt*4);for(let i=rings.length-1;i>=0;i--){const r=rings[i];r.life-=dt;r.r+=dt*90;if(r.life<=0)rings.splice(i,1);}for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=dt*220;if(p.life<=0)particles.splice(i,1);}for(let i=floaters.length-1;i>=0;i--){const f=floaters[i];f.life-=dt;f.y-=dt*30;if(f.life<=0)floaters.splice(i,1);}if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').classList.remove('show');}}
function setControl(which,key,down){
  if(state.nexbreak)return;
  const set=input[which];
  if(down){const was=set.size;set.add(key);
    if(!was&&state.mode==='playing'){
      if(state.flight){if(state.flight.kind)studio.press(state.flight,which);else if(which==='launch')fireFlight();return;}
      if(which!=='launch'){audio.fx('flip');if(state.tilt<=0){
        const lit=rollovers.map(r=>r.lit),direction=which==='left'?1:2;
        rollovers.forEach((r,i)=>r.lit=lit[(i+direction)%3]);
      }}
    }
  }else{const had=set.delete(key);if(which==='launch'&&had&&set.size===0&&!state.flight)launch();}
}
const keys={ArrowLeft:'left',KeyZ:'left',KeyA:'left',ArrowRight:'right',KeyM:'right',KeyD:'right',ArrowDown:'launch',Space:'launch'};
window.addEventListener('keydown',e=>{if(state.nexbreak)return;if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)||$('radioPanel').classList.contains('open'))return;if(!$('help').hidden){if(e.code==='Escape'){e.preventDefault();closeHelp();}return;}if(keys[e.code]){if(e.code==='Space'&&document.activeElement?.tagName==='BUTTON')return;e.preventDefault();if(state.mode==='playing')setControl(keys[e.code],e.code,true);}else if(!e.repeat){if(e.code==='KeyP'||e.code==='Escape'){e.preventDefault();pause();}if(e.code==='KeyN'||e.code==='Enter'&&state.mode==='playing'){e.preventDefault();nudge();}if(e.code==='KeyS')audio.toggle();if(e.code==='Enter'&&(state.mode==='ready'||state.mode==='over')){e.preventDefault();start();}}});
window.addEventListener('keyup',e=>{if(state.nexbreak)return;if(keys[e.code]){e.preventDefault();setControl(keys[e.code],e.code,false);}});
// Every contact has its own input token, including both thumbs on the same control.
// Cancel/lost capture never launches; global pointerup is a fallback if capture fails.
const heldPointers=new Map(),tablePointers=new Map();
// Touch identifiers are authoritative on touch-capable browsers. Safari can
// interrupt the parallel PointerEvent stream during native gestures.
const nativeTouch='ontouchstart' in window;
const isTouchPointer=e=>nativeTouch&&e.pointerType==='touch';
function releasePointer(id,cancel=false){
  const held=heldPointers.get(id);if(!held)return;
  heldPointers.delete(id);tablePointers.delete(id);
  if(held.drag)pullPointer=null;
  if(cancel){input[held.which].delete(held.token);if(held.which==='launch'){charge=0;charging=false;}}
  else setControl(held.which,held.token,false);
  try{if(held.el.hasPointerCapture?.(id))held.el.releasePointerCapture(id);}catch{}
  held.el.classList.toggle('held',[...heldPointers.values()].some(p=>p.el===held.el));
}
function capturePointer(el,e,which,drag=false){
  releasePointer(e.pointerId,true);
  const token='pointer'+e.pointerId;
  heldPointers.set(e.pointerId,{el,which,token,drag,startY:e.clientY,native:e.nativeTouch===true});
  el.classList.add('held');if(!e.nativeTouch)try{el.setPointerCapture(e.pointerId);}catch{}
  setControl(which,token,true);
  if(drag){pullPointer=e.pointerId;charge=0;charging=true;}
}
function bindTouch(id,which){
  const el=$(id);if(!el)return;
  bindNativeTouch(el,e=>capturePointer(el,e,which));
  el.addEventListener('pointerdown',e=>{if(isTouchPointer(e)||state.mode!=='playing')return;e.preventDefault();capturePointer(el,e,which);});
  el.addEventListener('lostpointercapture',e=>releasePointer(e.pointerId,true));
  el.addEventListener('pointerup',e=>releasePointer(e.pointerId));
  el.addEventListener('pointercancel',e=>releasePointer(e.pointerId,true));
}
for(const [id,which] of [['leftTouch','left'],['rightTouch','right'],['launchTouch','launch'],['sideLeft','left'],['sideRight','right'],['flightFire','launch']])bindTouch(id,which);
for(const id of ['nudgeTouch','nudgeFallback'])$(id)?.addEventListener('pointerdown',e=>{e.preventDefault();nudge();});
function pressTable(e){
  const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*W,y=(e.clientY-r.top)/r.height*H;
  const spring=readyBall()&&x>438&&y>670;
  const which=state.flight&&x>435?'launch':spring?'launch':x<245?'left':'right';
  const drag=!!spring&&e.pointerType!=='mouse';
  capturePointer(canvas,e,which,drag);tablePointers.set(e.pointerId,which);
}
bindNativeTouch(canvas,pressTable);
canvas.addEventListener('pointerdown',e=>{if(isTouchPointer(e)||state.mode!=='playing')return;e.preventDefault();pressTable(e);});
function movePointer(e){
  const held=heldPointers.get(e.pointerId);if(!held?.drag)return;
  const r=canvas.getBoundingClientRect();
  charge=clamp((e.clientY-held.startY)/Math.max(40,r.height*.085),0,1);
}
window.addEventListener('pointermove',e=>{
  if(isTouchPointer(e))return;
  if(e.buttons===0){releasePointer(e.pointerId,true);return;}
  if(heldPointers.get(e.pointerId)?.drag){e.preventDefault();movePointer(e);}
},{passive:false});
window.addEventListener('pointerup',e=>releasePointer(e.pointerId),true);
window.addEventListener('pointercancel',e=>releasePointer(e.pointerId,true),true);
canvas.addEventListener('lostpointercapture',e=>releasePointer(e.pointerId,true));
canvas.addEventListener('pointerup',e=>releasePointer(e.pointerId));
canvas.addEventListener('pointercancel',e=>releasePointer(e.pointerId,true));

// Native touch and pointer input never both own the same finger. Only gameplay
// contacts suppress gestures: score fields, help and mixer keep normal scrolling.
function touchPointer(t){return {pointerId:'touch'+t.identifier,pointerType:'touch',nativeTouch:true,clientX:t.clientX,clientY:t.clientY};}
function reconcileTouches(e,cancel=true){
  const active=new Set(Array.from(e.touches||[],t=>'touch'+t.identifier));
  for(const [id,held] of heldPointers)if(held.native&&!active.has(id))releasePointer(id,cancel);
}
function bindNativeTouch(el,press){
  if(!nativeTouch)return;
  el.addEventListener('touchstart',e=>{
    if(state.mode!=='playing')return;
    reconcileTouches(e);
    e.preventDefault();
    for(const t of Array.from(e.changedTouches))press(touchPointer(t));
  },{passive:false});
}
if(nativeTouch){
  window.addEventListener('touchstart',e=>reconcileTouches(e),{capture:true,passive:true});
  window.addEventListener('touchmove',e=>{
    reconcileTouches(e);
    let owned=false;
    for(const t of Array.from(e.touches)){const p=touchPointer(t);if(heldPointers.has(p.pointerId)){owned=true;movePointer(p);}}
    if(owned&&e.cancelable)e.preventDefault();
  },{capture:true,passive:false});
  window.addEventListener('touchend',e=>{
    // Only an explicitly ended spring may launch. Other missing contacts are
    // interruptions, not inferred releases (e.g. a lost earlier touchcancel).
    for(const t of Array.from(e.changedTouches||[]))releasePointer('touch'+t.identifier);
    reconcileTouches(e,true);
  },{capture:true,passive:true});
  window.addEventListener('touchcancel',e=>reconcileTouches(e,true),{capture:true,passive:true});
}
window.addEventListener('orientationchange',clearInput);
window.addEventListener('selectstart',e=>{
  if(e.target.closest?.('.cabinet,.side-flipper,.touch-controls,.flight-fire')&&!e.target.closest?.('input,textarea,select'))e.preventDefault();
});

window.addEventListener('contextmenu',e=>{
  if(e.target.closest?.('.cabinet,.side-flipper,.touch-controls,.flight-fire')){e.preventDefault();clearInput();}
});
window.addEventListener('blur',clearInput);
window.addEventListener('pagehide',clearInput);

$('playBtn').onclick=()=>{state.mode==='paused'?pause():start();$('playBtn').blur();};$('restartBtn').onclick=()=>{start();$('restartBtn').blur();};$('pauseBtn').onclick=()=>{pause();$('pauseBtn').blur();};$('soundBtn').onclick=()=>{audio.toggle();$('soundBtn').blur();};let helpWasPlaying=false;
$('helpBtn').onclick=()=>{helpWasPlaying=state.mode==='playing';if(helpWasPlaying)pause();$('help').hidden=false;$('closeHelp').focus();};function closeHelp(){$('help').hidden=true;if(helpWasPlaying&&state.mode==='paused')pause();$('helpBtn').focus();} $('closeHelp').onclick=closeHelp;
window.addEventListener('blur',()=>{clearInput();tablePointers.clear();if(state.mode==='playing'&&!state.nexbreak)pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(state.nexbreak)window.GroovelineNexbreak?.setPaused(true);else if(state.mode==='playing')pause();}});window.addEventListener('resize',resize);window.addEventListener('pagehide',saveBest);
window.GroovelineGame={nudge,isPlaying:()=>state.mode==='playing',pause:()=>{if(state.nexbreak)window.GroovelineNexbreak?.setPaused(true);else if(state.mode==='playing')pause();},resume:()=>{if(state.nexbreak)window.GroovelineNexbreak?.setPaused(false);else if(state.mode==='paused')pause();}};
let last=performance.now(),acc=0,hudClock=0;function frame(now){const dt=Math.min(.1,(now-last)/1000);last=now;radioFrame=window.GroovelineRadio?.sample()||{playing:false,levels:Array(12).fill(0),kind:'standby',energy:0};window.GroovelineLiveTable?.sync(radioFrame,dt,state.mode);window.GroovelineNexbreak?.tick(dt);if(state.mode==='playing'&&!state.nexbreak){acc+=dt;while(acc>=STEP){step(STEP);acc-=STEP;if(state.mode!=='playing'||state.nexbreak){acc=0;break;}}for(const b of balls){b.trail.push({x:b.x,y:b.y});if(b.trail.length>7)b.trail.shift();}animateFX(dt);audio.tick();}else acc=0;hudClock+=dt;if(hudClock>.065){syncHUD();hudClock=0;}if(radioFrame.playing&&!reduced)recordAngle+=dt*Math.PI*2/3.2;if(!state.nexbreak)draw(now/1000,dt);requestAnimationFrame(frame);}
// Explicit opt-in diagnostics. Simulation-only starts skip audio/network; user starts enable both.
if(new URLSearchParams(location.search).has('debug'))window.pinball={snapshot:()=>({state:{...state,flight:state.flight?JSON.parse(JSON.stringify(state.flight)):null},progress:studio.snapshot(),nexbreak:{wins:[...nexbreakWins],visits:nexbreakVisits,pending:nexbreakPending,active:state.nexbreak},lanes:rollovers.map(r=>r.lit),balls:balls.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,ready:b.ready,ramp:!!b.ramp})),pending:releases.length,captive:captive?{x:captive.x,y:captive.y}:null,scene:scene?{...scene}:null,audio:audio.snapshot?.(),geometry:{rampMouths:[[80,180,550],[310,410,550]],slings:slings.map(s=>s.points),flips:flips.map(f=>({x:f.x,y:f.y,len:f.len,up:f.up}))},ball:ball?{x:ball.x,y:ball.y,vx:ball.vx,vy:ball.vy,ready:ball.ready}:null,flippers:flips.map(f=>({angle:f.angle,omega:f.omega})),charge,inputs:Object.fromEntries(Object.entries(input).map(([k,v])=>[k,v.size])),heldPointers:heldPointers.size,launched,bumpers:bumpers.map(b=>b.lit),targets:targets.map(t=>t.lit)}),start:()=>start(false),advance(seconds){for(let i=0;i<Math.round(seconds/STEP)&&state.mode==='playing';i++)step(STEP);syncHUD();},setBall(x,y,vx=0,vy=0,index=0){const b=makeBall(x,y,vx,vy);balls[index]=b;ball=balls[0];launched=true;},nexbreakWin:noteNexbreak,control(which,down){setControl(which,'debug',down);},nudge,score,drain,pause};
resize();document.fonts.ready.then(resize);syncHUD();requestAnimationFrame(frame);
// Local review shortcut: deliberately opt-in, uses the real safe-capture path.
if(new URLSearchParams(location.search).has('debug')&&new URLSearchParams(location.search).get('nexbreak')==='preview'){
  start(false);noteNexbreak('needle');noteNexbreak('beat');
  const previewBall=makeBall(130,557,0,-600);balls.splice(0,balls.length,previewBall);ball=previewBall;launched=true;
}

})();
