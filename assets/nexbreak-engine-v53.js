/* Adapted from the user's Nexbreak v29: physics, weapons and powerups.
   Dedicated Grooveline bonus. Original standalone game is untouched. */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let lowFpsMode=false,musicTension=0;
const keys={};let mouseX=280;
let elapsed=0,running=false,ended=false,encore=false,accumulator=0,previous=0,apiHooks=null;
let timers=[],timerId=0,noticeTime=0;
const audioCtx={get currentTime(){return elapsed;}};
function schedule(fn,ms){timers.push({id:++timerId,at:elapsed+ms/1000,fn});return timerId;}
function sound(kind,value){apiHooks?.fx(kind,value);}
const sfxBreak=()=>sound('target'),sfxShieldBreak=()=>sound('lock'),sfxPaddle=()=>sound('flip'),sfxWall=()=>sound('rail'),sfxPowerup=()=>sound('bonus'),sfxLose=()=>sound('cueMiss'),sfxDanger=()=>sound('cueReady'),sfxCombo=()=>sound('beatLock'),sfxBlast=()=>sound('mixCut'),sfxEMP=()=>sound('drop'),sfxLaserFire=()=>sound('needle');
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

const PADDLE_H      = 13;
const PADDLE_W_BASE = 106;
const BALL_R        = 7;
const BRICK_W       = 52;
const BRICK_H       = 22;
const BRICK_GAP     = 6;
const BRICK_COLS    = 9;
const BRICK_OFFSET_X = (W - (BRICK_COLS*(BRICK_W+BRICK_GAP)-BRICK_GAP)) / 2;
const BRICK_OFFSET_Y = 58;

/* ═══════════════════════════════════════════════════════════════
   GAME STATE
   ═══════════════════════════════════════════════════════════════ */
let state = 'idle'; // idle | playing | paused | levelup | gameover
let score = 0, lives = 3, level = 1, combo = 0, comboTimer = 0, continueUsedThisSession = false;
let spawning = false; // true during the 700ms respawn delay after losing a ball

// ─── DROP MECHANIC ───────────────────────────────────────────────
// Every 16 bars (~30s), 12-second window: ×5 damage, ×5 score, shields break
const DROP_EVERY_BARS = 16;
const DROP_DURATION = 12.0;
let dropActive = false;
let dropEndsAt = 0;
let dropStartedAt = 0;
let nextDropAtBar = DROP_EVERY_BARS;
let dropArmTimer = 0; // countdown to arm warning

let paddle = {
  x: W/2, y: H-44, w: PADDLE_W_BASE,
  shield: false, magnet: false, expand: false, narrow: false,
  shieldLife: 0, heatTrail: [],
};

let balls     = [];
let bricks    = [];
let particles = [];
let powerups  = [];
let lasers    = [];       // laser projectiles
let laserParticles = []; // laser hit sparks

// EMP
let empCooldown = 0;
let empWaves    = [];
let empHits     = [];

// Blast
let chargeTime  = 0;
let charging    = false;
let superBeam   = null;
let blastCooldown = 0;
const BLAST_COOLDOWN_MAX = 4.0; // seconds between blasts

// Laser
let laserActive  = false;
let laserTime    = 0;
let laserCooldown = 0;
const LASER_COOLDOWN_MAX = 90;

// Fx
let screenShake = { x: 0, y: 0, frames: 0 };
let scanlineY   = 0;    // animated scanline offset
let bgStars     = [];   // parallax stars

// Pre-baked off-screen canvases (computed once, drawn each frame)
let cachedVignette = null;   // radial gradient baked to ImageData
let cachedGrid = null;       // static grid baked to offscreen canvas
let cachedScanlines = null;  // even-row scanline mask baked once
let cachedNebula = null;     // soft coloured nebula clouds baked once

// Timing
let rafId = 0, lastTime = 0;
let fps = 0, _frames = 0, _fpsLast = 0;

const MAX_PARTICLES = 80; // hard cap to prevent explosion lag

/* ═══════════════════════════════════════════════════════════════
   LEVEL PATTERNS
   (dot=empty, 1-4=hp, S=shielded, M=mover, B=boss, X=explosive)
   ═══════════════════════════════════════════════════════════════ */
const PATTERNS = [];

function parsePattern(rows) {
  const result = [];
  rows.forEach((row, r) => {
    for (let c = 0; c < BRICK_COLS; c++) {
      const ch = row[c] || '.';
      if (ch === '.') continue;
      let hp = 1, type = 'normal';
      if (ch === '2') hp = 2;
      else if (ch === '3') hp = 3;
      else if (ch === '4') hp = 4;
      else if (ch === 'S') { hp = 1; type = 'shielded'; }
      else if (ch === 'M') { hp = 2; type = 'mover'; }
      else if (ch === 'B') { hp = 4; type = 'boss'; }
      else if (ch === 'X') { hp = 2; type = 'explosive'; }
      result.push(makeBrick(c, r, hp, type));
    }
  });
  return result;
}

function generateLevel(lvl) {
  const patternIdx = lvl - 1;
  if (patternIdx > 0 && patternIdx < PATTERNS.length && PATTERNS[patternIdx]) {
    bricks = parsePattern(PATTERNS[patternIdx]);
  } else {
    // Procedural fallback — scales difficulty with level
    bricks = [];
    const rows = Math.min(5 + lvl, 11);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        const rand = Math.random();
        let hp = 1, type = 'normal';
        if (lvl >= 2 && rand < 0.12) hp = 2;
        if (lvl >= 3 && rand < 0.08) hp = 3;
        if (lvl >= 4 && rand < 0.05) hp = 4;
        if (lvl >= 2 && rand < 0.06) type = 'shielded';
        if (lvl >= 3 && rand < 0.08) type = 'mover';
        if (lvl >= 4 && r === 0 && c % 4 === 0) { type='boss'; hp=4; }
        if (lvl >= 5 && rand < 0.05) { type='explosive'; hp=2; }
        bricks.push(makeBrick(c, r, hp, type));
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   BRICK FACTORY
   ═══════════════════════════════════════════════════════════════ */
const BRICK_COLORS = {
  1: '#00d4c8',
  2: '#ff5e6c',
  3: '#f0c040',
  4: '#f97316',
  mover: '#fbbf24',
  boss: '#f43f5e',
  shield: '#34d399',
  explosive: '#fb923c',
};

function makeBrick(col, row, hp=1, type='normal') {
  return {
    x: BRICK_OFFSET_X + col*(BRICK_W+BRICK_GAP),
    y: BRICK_OFFSET_Y + row*(BRICK_H+BRICK_GAP),
    w: BRICK_W, h: BRICK_H,
    hp, maxHp: hp, type, alive: true,
    hasShield: type === 'shielded',
    shieldAngle: Math.random()*Math.PI*2,
    vx: type === 'mover' ? (Math.random()>0.5?1.4:-1.4) : 0,
    pulseT: Math.random()*Math.PI*2,
    glowTimer: 0,
    glitchTimer: 0,
  };
}

/* ═══════════════════════════════════════════════════════════════
   POWERUP TYPES
   ═══════════════════════════════════════════════════════════════ */
const POWERUP_DEFS = {
  expand:    { color: '#fbbf24', icon: '↔', label: 'WIDE',      glow: '#fbbf24', bad: false },
  multi:     { color: '#38bdf8', icon: '×3', label: 'MULTI',     glow: '#38bdf8', bad: false },
  magnet:    { color: '#f472b6', icon: 'M',  label: 'MAGNET',    glow: '#f472b6', bad: false },
  shield:    { color: '#34d399', icon: '◈',  label: 'SHIELD',    glow: '#34d399', bad: false },
  slow:      { color: '#c084fc', icon: '⧖',  label: 'SLOW',      glow: '#c084fc', bad: false },
  narrow:    { color: '#ef4444', icon: '↕',  label: 'NARROW',    glow: '#ef4444', bad: true  },
  laser:     { color: '#f43f5e', icon: '▲',  label: 'LASER',     glow: '#f43f5e' },
  timewarp:  { color: '#a78bfa', icon: '⏱',  label: 'WARP',      glow: '#a78bfa' },
  explosive: { color: '#fb923c', icon: '💥', label: 'BOOM',      glow: '#fb923c' },
  ghost:     { color: '#6ee7b7', icon: 'G',  label: 'GHOST',     glow: '#6ee7b7' },
};
const POWERUP_TYPES = Object.keys(POWERUP_DEFS);

function legacyMaybeDropPowerup(bx, by) {
  const dropChance = Math.max(0.08, 0.22 - (level - 1) * 0.006);
  if (Math.random() < dropChance) {
    const t = POWERUP_TYPES[Math.floor(Math.random()*POWERUP_TYPES.length)];
    powerups.push({ x: bx, y: by, vy: 1.6, type: t, r: 11, alive: true, t: 0 });
  }
}

function applyPowerup(type) {
  switch(type) {
    case 'expand':
      paddle.w = Math.min(PADDLE_W_BASE*1.7, paddle.w*1.3);
      paddle.expand = true;
      schedule(()=>{ paddle.w=PADDLE_W_BASE; paddle.expand=false; }, 14000);
      break;
    case 'multi': {
      const b = balls[0] || { x:W/2, y:H/2, vx:3, vy:-5 };
      spawnBall(b.x+6, b.y, -b.vx*0.9, b.vy);
      spawnBall(b.x-6, b.y,  b.vx*1.1, b.vy*0.9);
      break;
    }
    case 'magnet':
      paddle.magnet = true;
      schedule(()=>{
        paddle.magnet=false;
        const spd=6.5+level*0.28;
        balls.forEach(b=>{
          if(b._stuck){
            b._stuck=false;
            const relX=(b.x-paddle.x)/(paddle.w/2);
            b.vx=relX*4; b.vy=-spd;
            const s=Math.sqrt(b.vx*b.vx+b.vy*b.vy)||1;
            b.vx=b.vx/s*spd; b.vy=b.vy/s*spd;
          }
        });
      }, 9000);
      break;
    case 'narrow':
      paddle.w = Math.max(38, paddle.w * 0.6);
      paddle.narrow = true;
      schedule(()=>{ paddle.w = PADDLE_W_BASE; paddle.narrow = false; }, 10000);
      break;
    case 'shield':
      paddle.shield = true;
      paddle.shieldLife = 3;
      break;
    case 'slow':
      balls.forEach(b=>{ b.vx*=0.55; b.vy*=0.55; });
      schedule(()=>{
        balls.forEach(b=>{
          const s=Math.sqrt(b.vx*b.vx+b.vy*b.vy);
          if(s<3){b.vx*=3/s; b.vy*=3/s;}
        });
      }, 9000);
      break;
    case 'laser':
      activateLaser();
      break;
    case 'timewarp':
      // Slow time for 5s
      balls.forEach(b=>{ b._vxSaved=b.vx; b._vySaved=b.vy; b.vx*=0.35; b.vy*=0.35; });
      paddle._warpActive = true;
      triggerScreenFlash('#a78bfa', 0.3);
      schedule(()=>{
        balls.forEach(b=>{
          if(b._vxSaved){ b.vx=b._vxSaved; b.vy=b._vySaved; delete b._vxSaved; delete b._vySaved; }
        });
        paddle._warpActive = false;
      }, 5000);
      break;
    case 'explosive':
      // Next 3 hits cause radius explosion
      balls.forEach(b => { b.explosiveHits = (b.explosiveHits||0) + 3; });
      break;
    case 'ghost':
      // One free bottom pass
      paddle._ghost = true;
      break;
  }
}

/* ═══════════════════════════════════════════════════════════════
   BALL FACTORY
   ═══════════════════════════════════════════════════════════════ */
function spawnBall(x, y, vx, vy) {
  balls.push({
    x: x || W/2,
    y: y || (paddle.y - BALL_R - 2),
    vx: vx || (Math.random()>0.5?2.8:-2.8),
    vy: vy || -6.5,
    trail: [],
    alive: true,
    r: BALL_R,
    glowTimer: 0,
    explosiveHits: 0,
    _stuck: false, _stuckOffset: 0,
  });
}

/* ═══════════════════════════════════════════════════════════════
   PARTICLES
   ═══════════════════════════════════════════════════════════════ */
function spawnParticles(x, y, color, n=12, speed=3, gravity=0.08) {
  // Cap total particles — trim oldest first if over budget
  const cap = lowFpsMode ? 30 : MAX_PARTICLES;
  const toAdd = Math.min(n, cap - particles.length);
  if (toAdd <= 0) return;
  for (let i = 0; i < toAdd; i++) {
    const ang = Math.random()*Math.PI*2;
    const sp  = speed * (0.5 + Math.random());
    particles.push({
      x, y,
      vx: Math.cos(ang)*sp,
      vy: Math.sin(ang)*sp,
      life: 1,
      maxLife: 0.38 + Math.random()*0.38,
      color,
      size: 1.5 + Math.random()*2.5,
      gravity,
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   STARS
   ═══════════════════════════════════════════════════════════════ */
function initStars() {
  bgStars = [];
  const STAR_COLORS = [
    '#ffffff', '#e0f0ff', '#cfe8ff', '#b9d7ff',
    '#fff6d6', '#ffe0b0', '#ffd9f0', '#d6fbff',
  ];
  for (let i = 0; i < 110; i++) {
    const layer = i < 60 ? 0 : i < 95 ? 1 : 2;
    bgStars.push({
      x: Math.random()*W,
      y: Math.random()*H,
      r: layer === 2 ? 1.0 + Math.random()*1.2 : layer === 1 ? 0.6 + Math.random()*0.7 : 0.25 + Math.random()*0.45,
      speed: Math.random()*0.5 + 0.05,
      layer,
      alpha: layer === 2 ? 0.55 + Math.random()*0.35 : layer === 1 ? 0.35 + Math.random()*0.3 : 0.18 + Math.random()*0.22,
      twinkle: Math.random()*Math.PI*2,
      color: layer === 2
        ? STAR_COLORS[Math.floor(Math.random()*STAR_COLORS.length)]
        : layer === 1 ? '#9ec4e8' : '#4a7090',
    });
  }
}

/* ═══════════════════════════════════════════════════════════════
   SCREEN FX
   ═══════════════════════════════════════════════════════════════ */
let flashAlpha = 0;
let flashColor = '#fff';

function triggerScreenShake(frames=10, intensity=6) {
  screenShake.frames = frames;
  screenShake.intensity = intensity;
}

function triggerScreenFlash(color='#fff', alpha=0.4) {
  flashColor = color;
  flashAlpha = alpha;
}

/* ═══════════════════════════════════════════════════════════════
   DROP MECHANIC
   ═══════════════════════════════════════════════════════════════ */
function armDrop() {
  dropArmTimer = 1.0; // 1 second countdown to actual drop
}

function triggerDrop() {
  dropActive = true;
  dropStartedAt = audioCtx?.currentTime || 0;
  dropEndsAt = dropStartedAt + DROP_DURATION;
  triggerScreenShake(20, 10);
  triggerScreenFlash('#f43f5e', 0.5);
}

function updateDrop(dt) {
  if (dropActive) {
    const elapsed = (audioCtx?.currentTime || 0) - dropStartedAt;
    if (elapsed >= DROP_DURATION) {
      dropActive = false;
    }
  }
  if (dropArmTimer > 0) {
    dropArmTimer -= dt;
  }
}

function dropMultiplier() {
  return dropActive ? 5 : 1;
}

function dropProgress() {
  if (!dropActive) return 0;
  const elapsed = (audioCtx?.currentTime || 0) - dropStartedAt;
  return Math.max(0, Math.min(1, elapsed / DROP_DURATION));
}

/* ═══════════════════════════════════════════════════════════════
   EMP
   ═══════════════════════════════════════════════════════════════ */
const EMP_COOLDOWN_MAX = 80; // was 100, now 20% faster

function activateEMP() {
  if (empCooldown > 0) return;
  empCooldown = EMP_COOLDOWN_MAX;
  empWaves.push({ x: paddle.x, y: paddle.y, r: 0, maxR: H*1.1, life: 1, speed: 13 });
  sfxEMP();
  triggerScreenShake(16, 7);
  triggerScreenFlash('#818cf8', 0.25);
  announceAbility('emp');
  if (navigator.vibrate) navigator.vibrate([40, 20, 80, 20, 40]);

  // Crack 6-10 random bricks, 3x damage
  const alive = bricks.filter(b=>b.alive);
  const numCracks = 6 + Math.floor(Math.random()*5);
  let hit = 0;
  for (let i = 0; i < Math.min(numCracks, alive.length); i++) {
    const b = alive[Math.floor(Math.random()*alive.length)];
    if (!b.alive) continue;
    b.hp -= 3;
    b.glowTimer = 0.5;
    b.glitchTimer = 0.25;
    empHits.push({ x: b.x+b.w/2, y: b.y+b.h/2, life: 1 });
    spawnParticles(b.x+b.w/2, b.y+b.h/2, '#818cf8', 8, 4);
    if (b.hp <= 0) {
      b.alive = false;
      score += 50 * Math.max(1, combo);
      maybeDropPowerup(b.x+b.w/2, b.y+b.h/2);
      hit++;
    }
  }
  // Wobble balls
  balls.forEach(b => { b.vx+=(Math.random()-0.5)*1.5; b.vy+=(Math.random()-0.5)*1.5; });
  if (hit > 0) { combo += hit; comboTimer = 2.5; }
}

/* ═══════════════════════════════════════════════════════════════
   BLAST
   ═══════════════════════════════════════════════════════════════ */
function fireBlast() {
  if (blastCooldown > 0) { charging=false; chargeTime=0; return; }
  const full = chargeTime >= 1.8;
  sfxBlast(full);
  const bw = full ? 38 : 12;
  superBeam = { x: paddle.x-bw/2, y: 0, w: bw, h: paddle.y, timer: full?0.55:0.35, full };
  const halfW = full ? (BRICK_W+BRICK_GAP/2) : (BRICK_W/2+4);
  let hits = 0;
  bricks.forEach(b => {
    if (!b.alive) return;
    const bc = b.x+b.w/2;
    if (bc >= paddle.x-halfW && bc <= paddle.x+halfW) {
      b.alive = false;
      spawnParticles(b.x+b.w/2, b.y+b.h/2, full?'#fbbf24':'#f472b6', full?14:8, full?5:4);
      score += (full?200:100) * Math.max(combo,1);
      maybeDropPowerup(b.x+b.w/2, b.y+b.h/2);
      hits++;
    }
  });
  if (hits > 0) { triggerScreenShake(8, 4); combo += hits; comboTimer = 2.5; }
  blastCooldown = BLAST_COOLDOWN_MAX;
  chargeTime = 0; charging = false;
}

/* ═══════════════════════════════════════════════════════════════
   LASER
   ═══════════════════════════════════════════════════════════════ */
const LASER_DURATION_MAX = 10;
let laserFireTimer = 0;

function activateLaser() {
  laserActive = true;
  laserTime = LASER_DURATION_MAX;
  laserCooldown = LASER_COOLDOWN_MAX;
  announceAbility('laser');
  if (navigator.vibrate) navigator.vibrate([20, 10, 20]);
}

function fireLaserShot() {
  if (!laserActive || laserTime <= 0) return;
  lasers.push({
    x: paddle.x - 14,
    y: paddle.y - PADDLE_H,
    w: 3, h: 12,
    vy: -14,
    alive: true,
  });
  lasers.push({
    x: paddle.x + 11,
    y: paddle.y - PADDLE_H,
    w: 3, h: 12,
    vy: -14,
    alive: true,
  });
  sfxLaserFire();
}

/* ═══════════════════════════════════════════════════════════════
   EXPLOSIVE RADIUS
   ═══════════════════════════════════════════════════════════════ */
function explodeArea(cx, cy, radius=60) {
  triggerScreenShake(8, 5);
  triggerScreenFlash('#fb923c', 0.2);
  spawnParticles(cx, cy, '#fb923c', 14, 5);
  bricks.forEach(b => {
    if (!b.alive) return;
    const bc = b.x+b.w/2, bcy = b.y+b.h/2;
    const dist = Math.sqrt((bc-cx)**2+(bcy-cy)**2);
    if (dist < radius) {
      b.hp--;
      b.glowTimer=0.4; b.glitchTimer=0.2;
      spawnParticles(bc, bcy, '#fb923c', 6, 3);
      if (b.hp <= 0) {
        b.alive = false;
        score += 80 * Math.max(1,combo);
        maybeDropPowerup(bc, bcy);
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   COLLISION HELPERS
   ═══════════════════════════════════════════════════════════════ */
function circleRect(cx,cy,cr,rx,ry,rw,rh) {
  const nx=Math.max(rx,Math.min(cx,rx+rw)), ny=Math.max(ry,Math.min(cy,ry+rh));
  const dx=cx-nx, dy=cy-ny;
  return dx*dx+dy*dy<cr*cr;
}
function collisionSide(cx,cy,cr,rx,ry,rw,rh) {
  const nx=Math.max(rx,Math.min(cx,rx+rw)), ny=Math.max(ry,Math.min(cy,ry+rh));
  return Math.abs(cx-nx) > Math.abs(cy-ny) ? 'side' : 'top';
}

/* ═══════════════════════════════════════════════════════════════
   MAIN UPDATE
   ═══════════════════════════════════════════════════════════════ */
function update(dt) {
  if (state !== 'playing') return;

  // Screen shake decay
  if (screenShake.frames > 0) {
    const i = screenShake.intensity || 5;
    screenShake.x = (Math.random()-0.5)*i * (screenShake.frames/10);
    screenShake.y = (Math.random()-0.5)*i * (screenShake.frames/10);
    screenShake.frames--;
  } else { screenShake.x=0; screenShake.y=0; }

  // Flash decay
  if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt*3);

  // Danger music tension
  const dangerFactor = lives === 1 ? 0.85 : lives === 2 ? 0.35 : 0;
  musicTension = Math.min(1, dangerFactor + (combo > 8 ? 0.3 : combo > 4 ? 0.15 : 0));
  document.getElementById('danger-vignette').style.opacity = lives===1 ? 0.8+Math.sin(Date.now()/400)*0.2 : 0;

  // Paddle movement
  const left = keys['ArrowLeft']||keys['KeyA']||keys['KeyZ'];
  const right = keys['ArrowRight']||keys['KeyD']||keys['KeyM'];
  const kbMoving = left||right;
  if (kbMoving) {
    if (left) paddle.x -= 8;
    if (right) paddle.x += 8;
  } else {
    paddle.x += (mouseX - paddle.x) * 0.28;
  }
  if (kbMoving) mouseX = paddle.x;
  paddle.x = Math.max(paddle.w/2, Math.min(W-paddle.w/2, paddle.x));
  if (paddle.shield && paddle.shieldLife>0) paddle.shieldLife -= dt;

  // Paddle heat trail
  paddle.heatTrail.push(paddle.x);
  if (paddle.heatTrail.length > 8) paddle.heatTrail.shift();

  // Blast cooldown tick
  if (blastCooldown > 0) blastCooldown -= dt;

  // Charge blast (hold for full power)
  if (charging) {
    chargeTime = Math.min(2, chargeTime + (chargeTime < 1.0 ? dt*0.5 : dt*0.18));
  }
  const chargeFill = document.getElementById('charge-fill');
  const blastBtn = document.getElementById('btn-blast');
  if (blastCooldown > 0) {
    // Show cooldown recharge
    const cdPct = Math.max(0,(1-blastCooldown/BLAST_COOLDOWN_MAX)*100);
    chargeFill.style.width = cdPct + '%';
    chargeFill.style.background = 'rgba(255,255,255,0.12)';
    blastBtn.classList.remove('charged','charging','ready');
  } else if (charging && chargeTime >= 1.8) {
    chargeFill.style.width = '100%';
    chargeFill.style.background='linear-gradient(90deg,#fbbf24,#f97316)';
    blastBtn.classList.add('charged');
    blastBtn.classList.remove('charging');
    if (!blastBtn._fullAnnounced) { blastBtn._fullAnnounced=true; announceAbility('blastFull');  }
  } else if (charging && chargeTime >= 0.3) {
    chargeFill.style.width = Math.min(chargeTime/2*100,100) + '%';
    chargeFill.style.background='linear-gradient(90deg,#38bdf8,#f472b6)';
    blastBtn.classList.add('charging');
    blastBtn.classList.remove('charged');
    blastBtn._readyAnnounced = true;
  } else if (!charging) {
    chargeFill.style.width = '100%';
    chargeFill.style.background='rgba(255,255,255,0.12)';
    blastBtn.classList.remove('charged','charging');
    blastBtn.classList.add('ready');
    blastBtn._readyAnnounced=false; blastBtn._fullAnnounced=false;
  }

  // EMP cooldown
  const prevEmpCooldown = empCooldown;
  if (empCooldown > 0) empCooldown -= dt;
  const empPct = empCooldown > 0 ? Math.max(0,(1-empCooldown/EMP_COOLDOWN_MAX)*100) : 100;
  document.getElementById('emp-fill').style.width = empPct + '%';
  const empBtn = document.getElementById('btn-emp');
  if (empCooldown <= 0) {
    empBtn.classList.add('ready');
    if (prevEmpCooldown > 0) { announceAbility('empReady');  }
  } else {
    empBtn.classList.remove('ready');
  }

  // Laser cooldown & firing
  const prevLaserCooldown = laserCooldown;
  if (laserCooldown > 0) laserCooldown -= dt;
  if (laserActive) {
    laserTime -= dt;
    if (laserTime <= 0) { laserActive=false; laserTime=0; }
    laserFireTimer -= dt;
    if (laserFireTimer <= 0) { fireLaserShot(); laserFireTimer=0.12; }
  }
  const laserPct = laserCooldown > 0 ? Math.max(0,(1-laserCooldown/LASER_COOLDOWN_MAX)*100) : 100;
  document.getElementById('laser-fill').style.width = laserActive
    ? (laserTime/LASER_DURATION_MAX*100) + '%'
    : laserPct + '%';
  const laserBtn = document.getElementById('btn-laser');
  if (laserActive) {
    laserBtn.classList.add('active'); laserBtn.classList.remove('ready');
  } else {
    laserBtn.classList.remove('active');
    if (laserCooldown <= 0) {
      laserBtn.classList.add('ready');
      if (prevLaserCooldown > 0) { announceAbility('laserReady');  }
    } else {
      laserBtn.classList.remove('ready');
    }
  }

  // Beam timer
  if (superBeam) { superBeam.timer -= dt; if(superBeam.timer<=0) superBeam=null; }

  // Combo decay
  if (combo > 0) { comboTimer -= dt; if(comboTimer<=0) combo=0; }

  // Update Drop mechanic
  updateDrop(dt);

  // Stars drift (parallax)
  bgStars.forEach(s => {
    s.y += s.speed * (1+s.layer*0.5) * (balls[0] ? Math.abs(balls[0].vy)/8 : 1) * dt * 30;
    s.twinkle += dt * 2;
    if (s.y > H) s.y = -2;
  });

  // Scanline
  scanlineY = (scanlineY + dt*25) % 3;

  // Bricks
  bricks.forEach(b => {
    if (!b.alive) return;
    b.pulseT += dt*2.2;
    b.glowTimer = Math.max(0, b.glowTimer-dt);
    b.glitchTimer = Math.max(0, b.glitchTimer-dt);
    if (b.type==='mover') {
      b.x += b.vx;
      if (b.x<=0 || b.x+b.w>=W) b.vx*=-1;
    }
    if (b.hasShield) b.shieldAngle += dt*2.8;
  });

  // Powerups
  powerups.forEach(p => {
    if (!p.alive) return;
    p.y += p.vy; p.t += dt;
    if (p.y > H) { p.alive=false; return; }
    const px=paddle.x-paddle.w/2, py=paddle.y-PADDLE_H/2;
    if (p.x>px && p.x<px+paddle.w && p.y+p.r>py && p.y-p.r<py+PADDLE_H) {
      applyPowerup(p.type);
      spawnParticles(p.x, p.y, POWERUP_DEFS[p.type].glow, 18, 4);
      showComboFlash(POWERUP_DEFS[p.type].label, POWERUP_DEFS[p.type].color);
      p.alive=false;
      sfxPowerup();
    }
  });

  // Particles
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    p.vy += p.gravity||0.06;
    p.life -= dt / p.maxLife;
  });
  for (let i=particles.length-1;i>=0;i--) if(particles[i].life<=0) particles.splice(i,1);

  // Laser particles
  laserParticles.forEach(p => {
    p.x+=p.vx; p.y+=p.vy; p.life-=dt*4;
  });
  laserParticles = laserParticles.filter(p=>p.life>0);

  // EMP waves
  empWaves.forEach(w => { w.r+=w.speed; w.life=Math.max(0,1-w.r/w.maxR); });
  empWaves = empWaves.filter(w=>w.life>0);
  empHits.forEach(h => h.life-=dt*2.5);
  empHits = empHits.filter(h=>h.life>0);

  // Laser projectiles
  lasers.forEach(l => {
    if (!l.alive) return;
    l.y += l.vy;
    if (l.y + l.h < 0) { l.alive=false; return; }
    // Brick hit
    for (let i=0; i<bricks.length; i++) {
      const b = bricks[i];
      if (!b.alive) continue;
      if (l.x+l.w > b.x && l.x < b.x+b.w && l.y < b.y+b.h && l.y+l.h > b.y) {
        l.alive = false;
        b.hp--; b.glowTimer=0.3; b.glitchTimer=0.15;
        combo++; comboTimer=1.8;
        for(let s=0;s<4;s++) laserParticles.push({
          x:l.x+l.w/2, y:l.y,
          vx:(Math.random()-0.5)*3, vy:(Math.random()-0.5)*3,
          life:1, color:'#f43f5e'
        });
        if(b.hp<=0) {
          b.alive=false;
          score += 60 * Math.max(1,combo);
          maybeDropPowerup(b.x+b.w/2, b.y+b.h/2);
        }
        break;
      }
    }
  });
  lasers = lasers.filter(l=>l.alive);

  // Balls
  balls.forEach(ball => {
    if (!ball.alive) return;

    // Magnet: ball sticks to paddle until canvas is tapped
    if (ball._stuck) {
      ball.x = paddle.x + (ball._stuckOffset || 0);
      ball.x = Math.max(ball.r, Math.min(W-ball.r, ball.x));
      ball.y = paddle.y - PADDLE_H/2 - ball.r;
      return; // skip all physics while stuck
    }

    ball.trail.push({ x:ball.x, y:ball.y });
    if (ball.trail.length > 8) ball.trail.shift();

    // Speed
    let spd = Math.sqrt(ball.vx*ball.vx+ball.vy*ball.vy);
    const maxSpd = 9 + level*0.4;
    if (spd > maxSpd) { ball.vx*=maxSpd/spd; ball.vy*=maxSpd/spd; spd=maxSpd; }
    // Recover a resting ball without dividing by zero and poisoning its motion.
    if (spd === 0) { ball.vy=-5; }
    else if (spd < 5) { const n=5/spd; ball.vx*=n; ball.vy*=n; }

    ball.x += ball.vx; ball.y += ball.vy;
    ball.glowTimer = Math.max(0, ball.glowTimer-dt);

    // Walls
    if (ball.x-ball.r<0) { ball.x=ball.r; ball.vx=Math.abs(ball.vx); sfxWall(); }
    if (ball.x+ball.r>W) { ball.x=W-ball.r; ball.vx=-Math.abs(ball.vx); sfxWall(); }
    if (ball.y-ball.r<0) { ball.y=ball.r; ball.vy=Math.abs(ball.vy); sfxWall(); }

    // Paddle
    const px=paddle.x-paddle.w/2, py=paddle.y-PADDLE_H/2;
    if (ball.y+ball.r>=py && ball.y-ball.r<=py+PADDLE_H &&
        ball.x>=px-4 && ball.x<=px+paddle.w+4 && ball.vy>0) {
      ball.y = py-ball.r;
      if (paddle.magnet) {
        // Stick the ball
        ball._stuck = true;
        ball._stuckOffset = ball.x - paddle.x;
        ball.vx = 0; ball.vy = 0;
        sfxPaddle();
        return;
      }
      const relX = (ball.x-paddle.x)/(paddle.w/2);
      ball.vx = relX*5.5;
      ball.vy = -Math.abs(ball.vy);
      const s = Math.sqrt(ball.vx*ball.vx+ball.vy*ball.vy);
      const base = 6.5+level*0.28;
      ball.vx=ball.vx/s*base; ball.vy=ball.vy/s*base;
      ball.glowTimer=0.25;
      sfxPaddle();
    }

    // Bottom
    if (ball.y-ball.r>H) {
      if (paddle._ghost) {
        paddle._ghost = false;
        ball.y=paddle.y-ball.r-2;
        ball.vy=-Math.abs(ball.vy);
        triggerScreenFlash('#6ee7b7', 0.3);
      } else if (paddle.shield && paddle.shieldLife>0) {
        ball.y=paddle.y-ball.r-2;
        ball.vy=-Math.abs(ball.vy);
        paddle.shieldLife-=1;
        sfxWall();
      } else {
        ball.alive=false;
        triggerScreenShake(8,4);
      }
    }

    // Brick collision
    for (let i=0; i<bricks.length; i++) {
      const b = bricks[i];
      if (!b.alive) continue;
      if (!circleRect(ball.x,ball.y,ball.r,b.x,b.y,b.w,b.h)) continue;

      if (b.hasShield) {
        // Drop breaks shields and continues through (no bounce)
        if (dropActive) {
          b.hasShield=false;
          spawnParticles(b.x+b.w/2, b.y+b.h/2, '#f87171', 18, 5);
          sfxShieldBreak();
          // During DROP, ball passes through shielded bricks without bouncing
          continue;
        } else {
          b.hasShield=false;
          spawnParticles(b.x+b.w/2, b.y+b.h/2, '#34d399', 14, 4);
          sfxShieldBreak();
          const side=collisionSide(ball.x,ball.y,ball.r,b.x,b.y,b.w,b.h);
          if(side==='side') ball.vx*=-1; else ball.vy*=-1;
          ball.glowTimer=0.2;
          continue;
        }
      }

      const dmg = dropActive ? 5 : 1;
      b.hp -= dmg; b.glowTimer=0.25; b.glitchTimer=0.12;
      combo++; comboTimer=2;
      if (combo%5===0) { sfxCombo(Math.floor(combo/5)); showComboFlash(`×${combo}`, '#fbbf24'); }

      if (dropActive) {
        // During DROP: destroy brick immediately, no bounce, penetrate
        b.hp = 0;
        b.alive = false;
        score += 10*b.maxHp * Math.max(1,combo) * dropMultiplier();
        maybeDropPowerup(b.x+b.w/2, b.y+b.h/2);
        spawnParticles(b.x+b.w/2, b.y+b.h/2, '#ff6b6b', 14, 5);
        sfxBreak(0);
        if (b.type==='boss') { spawnParticles(b.x+b.w/2, b.y+b.h/2, '#f43f5e', 18, 6); score+=500; triggerScreenShake(12,6); }
        continue;
      }

      const side=collisionSide(ball.x,ball.y,ball.r,b.x,b.y,b.w,b.h);
      if(side==='side') ball.vx*=-1; else ball.vy*=-1;
      ball.glowTimer=0.18;

      const bColor = BRICK_COLORS[b.hp+1]||BRICK_COLORS[1];
      spawnParticles(b.x+b.w/2, b.y+b.h/2, bColor, 5+b.maxHp*2, 3+b.maxHp);
      sfxBreak(b.hp);

      // Explosive ball
      if (ball.explosiveHits > 0) {
        ball.explosiveHits--;
        explodeArea(b.x+b.w/2, b.y+b.h/2, 65);
      }

      if (b.hp<=0) {
        b.alive=false;
        score += 10*b.maxHp * Math.max(1,combo) * dropMultiplier();
        maybeDropPowerup(b.x+b.w/2, b.y+b.h/2);
        if (b.type==='boss') {
          spawnParticles(b.x+b.w/2, b.y+b.h/2, '#f43f5e', 18, 6);
          score+=500;
          triggerScreenShake(12,6);
          triggerScreenFlash('#f43f5e',0.3);
        }
        if (b.type==='explosive') {
          explodeArea(b.x+b.w/2, b.y+b.h/2, 70);
        }
      }
    }
  });

  balls = balls.filter(b=>b.alive!==false);
  powerups = powerups.filter(p=>p.alive);

  // No balls left
  if (balls.length===0 && !spawning) {
    spawning = true;
    lives--;
    sfxLose();
    if (lives <= 0) {
      spawning = false;
      gameOver();
    } else {
      if (lives === 1) sfxDanger();
      schedule(()=>{ spawning=false; spawnBall(); }, 700);
    }
  }

  // Win check — only trigger once per level
  if (state==='playing' && bricks.filter(b=>b.alive).length===0) levelUp();

  updateHUD();
}

/* ═══════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════ */
function render() {
  const sx = screenShake.x, sy = screenShake.y;
  ctx.save();
  ctx.translate(sx, sy);

  drawBackground();
  bricks.forEach(drawBrick);
  drawSuperBeam();
  drawEMP();
  drawLasers();
  particles.forEach(drawParticle);
  laserParticles.forEach(lp => {
    ctx.globalAlpha = lp.life;
    ctx.fillStyle = lp.color;
    ctx.fillRect(lp.x-1.5, lp.y-1.5, 3, 3);
  });
  ctx.globalAlpha = 1;
  powerups.forEach(p => p.alive && drawPowerup(p));
  balls.forEach(drawBall);
  drawPaddle();
  drawDropOverlay();
  drawCRTOverlay();

  if (flashAlpha > 0) {
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = flashColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function buildBgCache() {
  // Grid — baked once to offscreen canvas with a gentle center fade
  const gc = document.createElement('canvas');
  gc.width = W; gc.height = H;
  const gx = gc.getContext('2d');
  gx.strokeStyle = 'rgba(56,189,248,0.05)';
  gx.lineWidth = 1;
  for (let x=0;x<=W;x+=40) { gx.beginPath();gx.moveTo(x+0.5,0);gx.lineTo(x+0.5,H);gx.stroke(); }
  for (let y=0;y<=H;y+=40) { gx.beginPath();gx.moveTo(0,y+0.5);gx.lineTo(W,y+0.5);gx.stroke(); }
  // Brighter intersection dots
  gx.fillStyle = 'rgba(129,140,248,0.12)';
  for (let x=0;x<=W;x+=40) {
    for (let y=0;y<=H;y+=40) {
      gx.fillRect(x-0.5, y-0.5, 1.5, 1.5);
    }
  }
  // Fade grid with a radial mask so center doesn't clutter gameplay
  gx.globalCompositeOperation = 'destination-in';
  const mask = gx.createRadialGradient(W/2,H*0.55,0, W/2,H*0.55, H*0.72);
  mask.addColorStop(0, 'rgba(0,0,0,0.25)');
  mask.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  mask.addColorStop(1, 'rgba(0,0,0,1)');
  gx.fillStyle = mask;
  gx.fillRect(0,0,W,H);
  gx.globalCompositeOperation = 'source-over';
  cachedGrid = gc;

  // Nebula — soft coloured clouds baked once
  const nc = document.createElement('canvas');
  nc.width = W; nc.height = H;
  const nx = nc.getContext('2d');
  const clouds = [
    { x: W*0.25, y: H*0.30, r: H*0.55, c: 'rgba(99,102,241,' },  // indigo
    { x: W*0.80, y: H*0.20, r: H*0.45, c: 'rgba(56,189,248,' },  // cyan
    { x: W*0.70, y: H*0.75, r: H*0.50, c: 'rgba(244,114,182,' }, // pink
    { x: W*0.15, y: H*0.80, r: H*0.40, c: 'rgba(34,211,238,' },  // teal
  ];
  clouds.forEach(cl => {
    const g = nx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.r);
    g.addColorStop(0, cl.c + '0.22)');
    g.addColorStop(0.5, cl.c + '0.08)');
    g.addColorStop(1, cl.c + '0)');
    nx.fillStyle = g;
    nx.fillRect(0,0,W,H);
  });
  cachedNebula = nc;

  // Vignette — baked once, deeper and richer
  const vc = document.createElement('canvas');
  vc.width = W; vc.height = H;
  const vx = vc.getContext('2d');
  const vig = vx.createRadialGradient(W/2,H/2,H*0.18,W/2,H/2,H*0.85);
  vig.addColorStop(0,    'rgba(0,0,0,0)');
  vig.addColorStop(0.65, 'rgba(0,0,10,0.25)');
  vig.addColorStop(1,    'rgba(0,0,14,0.78)');
  vx.fillStyle = vig;
  vx.fillRect(0,0,W,H);
  cachedVignette = vc;

  // Scanlines — baked once (alternating 1px black rows, stride 3)
  const sc = document.createElement('canvas');
  sc.width = W; sc.height = H;
  const sx = sc.getContext('2d');
  sx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let y=0; y<H; y+=3) sx.fillRect(0, y, W, 1);
  cachedScanlines = sc;
}

function legacyDrawBackground() {
  // Deep space black
  ctx.fillStyle = '#020408';
  ctx.fillRect(0, 0, W, H);

  // Cached nebula wash — breathes gently (skip in low FPS mode)
  if (cachedNebula && !lowFpsMode) {
    const nb = 0.55 + 0.12 * Math.sin(performance.now() * 0.00035);
    ctx.globalAlpha = nb;
    ctx.drawImage(cachedNebula, 0, 0);
    ctx.globalAlpha = 1;
  }

  // Cached grid (behind stars)
  if (cachedGrid) ctx.drawImage(cachedGrid, 0, 0);

  // Stars — skip entirely on very low FPS
  if (fps > 25) {
    const tw_time = performance.now() * 0.001;
    for (let i=0; i<bgStars.length; i++) {
      const s = bgStars[i];
      const tw = lowFpsMode ? 1 : (0.7 + 0.3*Math.sin(s.twinkle + tw_time * s.speed * 2));
      const a  = s.alpha * tw;
      ctx.globalAlpha = a;
      const sz = s.r * (0.8 + s.layer * 0.35) * 2;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x - sz*0.5, s.y - sz*0.5, sz, sz);
      if (!lowFpsMode && s.layer === 2 && s.r > 1.1) {
        ctx.globalAlpha = a * 0.45;
        ctx.fillRect(s.x - sz*1.6, s.y - 0.5, sz*3.2, 1);
        ctx.fillRect(s.x - 0.5, s.y - sz*1.6, 1, sz*3.2);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Cached vignette
  if (cachedVignette) ctx.drawImage(cachedVignette, 0, 0);
}

function legacyDrawCRTOverlay() {
  // Animated scanlines — skip in low FPS mode for speed
  if (lowFpsMode) return;
  if (cachedScanlines) {
    const off = Math.floor(scanlineY) % 3;
    ctx.drawImage(cachedScanlines, 0, off);
    if (off > 0) ctx.drawImage(cachedScanlines, 0, off - H);
  }
  // Subtle edge vignette (two thin rects, no alpha change needed)
  ctx.globalAlpha = 0.025;
  ctx.fillStyle = '#f00';
  ctx.fillRect(0,0,3,H);
  ctx.fillRect(W-3,0,3,H);
  ctx.globalAlpha = 1;
}

function legacyDrawDropOverlay() {
  if (!dropActive && dropArmTimer <= 0) return;

  // ARM phase (1 second warning before drop)
  if (dropArmTimer > 0) {
    const pulse = 0.3 + 0.4 * Math.sin(dropArmTimer * Math.PI * 2);
    ctx.globalAlpha = pulse * 0.4;
    ctx.fillStyle = '#a855f7';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    return;
  }

  // DROP active phase (12 seconds of purple pulse)
  const prog = dropProgress();
  const pulse = 0.5 + 0.25 * Math.sin(prog * Math.PI * 4);

  // Full-screen purple wash
  ctx.globalAlpha = pulse * 0.35;
  ctx.fillStyle = '#a855f7';
  ctx.fillRect(0, 0, W, H);

  // Sweeping scan line (top to bottom)
  ctx.globalAlpha = 0.6;
  const scanY = H * prog;
  const scanH = 8;
  const grad = ctx.createLinearGradient(0, scanY-scanH, 0, scanY+scanH);
  grad.addColorStop(0, 'rgba(168,85,247,0)');
  grad.addColorStop(0.5, 'rgba(168,85,247,0.8)');
  grad.addColorStop(1, 'rgba(168,85,247,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, scanY-scanH, W, scanH*2);

  // Corner brackets to frame the action
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 2;
  const bsz = 20;
  // Top-left
  ctx.beginPath(); ctx.moveTo(0, bsz); ctx.lineTo(0, 0); ctx.lineTo(bsz, 0); ctx.stroke();
  // Top-right
  ctx.beginPath(); ctx.moveTo(W-bsz, 0); ctx.lineTo(W, 0); ctx.lineTo(W, bsz); ctx.stroke();
  // Bottom-left
  ctx.beginPath(); ctx.moveTo(0, H-bsz); ctx.lineTo(0, H); ctx.lineTo(bsz, H); ctx.stroke();
  // Bottom-right
  ctx.beginPath(); ctx.moveTo(W-bsz, H); ctx.lineTo(W, H); ctx.lineTo(W, H-bsz); ctx.stroke();

  ctx.globalAlpha = 1;
}

function legacyDrawBrick(b) {
  if (!b.alive) return;

  const pulse = 0.85 + 0.15*Math.sin(b.pulseT);
  let color = b.type==='mover' ? BRICK_COLORS.mover
             : b.type==='boss' ? BRICK_COLORS.boss
             : b.type==='explosive' ? BRICK_COLORS.explosive
             : BRICK_COLORS[b.hp] || BRICK_COLORS[1];

  // Drop mechanic: turn bricks red during drop window
  if (dropActive) color = '#ef4444';

  let dx=0, dy=0;
  if (b.glitchTimer > 0) {
    dx = (Math.random()-0.5)*4;
    dy = (Math.random()-0.5)*2;
  }

  const bx=b.x+dx, by=b.y+dy;
  const hpRatio = b.hp/b.maxHp;

  // Only apply shadowBlur when brick was just hit
  if (b.glowTimer > 0) {
    ctx.shadowBlur = 22;
    ctx.shadowColor = color;
  } else {
    ctx.shadowBlur = 0;
  }

  // ── Body — two-stop glass gradient with a pulse kiss ──────────
  const bodyAlpha = b.glowTimer > 0 ? 'ff' : 'ee';
  const grad = ctx.createLinearGradient(bx, by, bx, by+b.h);
  grad.addColorStop(0,    color + bodyAlpha);
  grad.addColorStop(0.45, color + 'bb');
  grad.addColorStop(1,    color + '33');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(bx+1, by+1, b.w-2, b.h-2, 5);
  ctx.fill();

  ctx.shadowBlur = 0;

  // ── Top sheen — glassy highlight across the top third ─────────
  const sheenH = (b.h-2) * 0.40;
  const sheen = ctx.createLinearGradient(bx, by+1, bx, by+1+sheenH);
  sheen.addColorStop(0,   `rgba(255,255,255,${0.22*pulse})`);
  sheen.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.roundRect(bx+2, by+2, b.w-4, sheenH, [4,4,2,2]);
  ctx.fill();

  // ── Bevel strokes — crisper, 1px inset ────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx+3.5, by+b.h-4);
  ctx.lineTo(bx+3.5, by+3.5);
  ctx.lineTo(bx+b.w-4, by+3.5);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.moveTo(bx+b.w-3.5, by+4);
  ctx.lineTo(bx+b.w-3.5, by+b.h-3.5);
  ctx.lineTo(bx+4, by+b.h-3.5);
  ctx.stroke();

  // ── Damage cracks on multi-HP bricks (shown when partial HP) ──
  if (b.maxHp > 1 && hpRatio < 1) {
    ctx.strokeStyle = `rgba(0,0,0,${0.25 + (1-hpRatio)*0.35})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const seed = (b.x * 13 + b.y * 31) | 0;
    const r = (n) => { const x = Math.sin(seed + n) * 10000; return x - Math.floor(x); };
    const cracks = Math.floor((1-hpRatio) * 3) + 1;
    for (let i=0; i<cracks; i++) {
      const sxp = bx + 4 + r(i*7)*(b.w-8);
      const syp = by + 4 + r(i*7+1)*(b.h-8);
      const exp = sxp + (r(i*7+2)-0.5)*12;
      const eyp = syp + (r(i*7+3)-0.5)*8;
      ctx.moveTo(sxp, syp); ctx.lineTo(exp, eyp);
    }
    ctx.stroke();
  }

  // ── HP bar — thinner, with subtle glow when hit ───────────────
  if (b.maxHp > 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(bx+3, by+b.h-5, b.w-6, 3);
    ctx.fillStyle = color;
    if (b.glowTimer > 0) { ctx.shadowBlur = 6; ctx.shadowColor = color; }
    ctx.fillRect(bx+3, by+b.h-5, (b.w-6)*hpRatio, 3);
    ctx.shadowBlur = 0;
    // Tiny highlight on HP bar
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(bx+3, by+b.h-5, Math.max(0,(b.w-6)*hpRatio), 1);
  }

  // Orbiting shield dot
  if (b.hasShield) {
    ctx.shadowBlur=14; ctx.shadowColor='#34d399';
    ctx.fillStyle='#34d399';
    const sx=bx+b.w/2+Math.cos(b.shieldAngle)*24;
    const sy=by+b.h/2+Math.sin(b.shieldAngle)*15;
    ctx.beginPath(); ctx.arc(sx,sy,4.5,0,Math.PI*2); ctx.fill();
    // Trail
    ctx.globalAlpha=0.3;
    for(let t=1;t<=3;t++){
      const ta=b.shieldAngle-t*0.35;
      ctx.beginPath();
      ctx.arc(bx+b.w/2+Math.cos(ta)*24, by+b.h/2+Math.sin(ta)*15, 4.5-t, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha=1;
  }

  // Boss pulse ring
  if (b.type==='boss') {
    ctx.strokeStyle=`rgba(244,63,94,${0.3+0.2*Math.sin(b.pulseT*2)})`;
    ctx.lineWidth=1.5;
    ctx.shadowBlur=10; ctx.shadowColor='#f43f5e';
    ctx.beginPath();
    ctx.roundRect(bx-3, by-3, b.w+6, b.h+6, 7);
    ctx.stroke();
  }

  ctx.shadowBlur=0;
}

// ═══════════════════════════════════════════════════════════════
// BALL SPRITE CACHE — pre-bake halos/cores to offscreen canvas
// Key: 'cool|hot|exp' (speed state), blit once per ball per frame
// ═══════════════════════════════════════════════════════════════
const _ballSpriteCache = {};
function _makeBallSprite(state, r=8) {
  const glowMap = {
    cool: { hex: '#38bdf8', rgb: '56,189,248', core: '#e8f9ff' },
    hot:  { hex: '#f472b6', rgb: '244,114,182', core: '#e8f9ff' },
    exp:  { hex: '#fb923c', rgb: '251,146,60', core: '#ffe2bf' },
  };
  const g = glowMap[state];
  const key = `${state}_${r}`;
  if (_ballSpriteCache[key]) return _ballSpriteCache[key];

  const cv = new OffscreenCanvas(r*9, r*9);
  const cx = cv.getContext('2d');
  const cx_offset = r*4.5;
  const cy_offset = r*4.5;

  // Outer halo (2x radius, soft fade)
  const haloR = r * 3.2;
  const halo = cx.createRadialGradient(cx_offset, cy_offset, r*0.5, cx_offset, cy_offset, haloR);
  halo.addColorStop(0, `rgba(${g.rgb},0.55)`);
  halo.addColorStop(0.4, `rgba(${g.rgb},0.20)`);
  halo.addColorStop(1, `rgba(${g.rgb},0)`);
  cx.fillStyle = halo;
  cx.beginPath();
  cx.arc(cx_offset, cy_offset, haloR, 0, Math.PI*2);
  cx.fill();

  // Core with shadow glow
  cx.shadowBlur = 14;
  cx.shadowColor = g.hex;
  cx.fillStyle = g.core;
  cx.beginPath();
  cx.arc(cx_offset, cy_offset, r, 0, Math.PI*2);
  cx.fill();

  // Inner gradient (volume)
  const core = cx.createRadialGradient(
    cx_offset - r*0.35, cy_offset - r*0.35, r*0.05,
    cx_offset, cy_offset, r
  );
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  core.addColorStop(1, `rgba(${g.rgb},0.25)`);
  cx.shadowBlur = 0;
  cx.fillStyle = core;
  cx.beginPath();
  cx.arc(cx_offset, cy_offset, r, 0, Math.PI*2);
  cx.fill();

  // Specular
  cx.fillStyle = 'rgba(255,255,255,0.95)';
  cx.beginPath();
  cx.arc(cx_offset - r*0.38, cy_offset - r*0.38, r*0.28, 0, Math.PI*2);
  cx.fill();

  const sprite = { canvas: cv, offset: r*4.5, r };
  _ballSpriteCache[key] = sprite;
  return sprite;
}

function drawBall(ball) {
  const spd = Math.sqrt(ball.vx*ball.vx+ball.vy*ball.vy);
  const hot = spd > 7;
  const explosive = ball.explosiveHits > 0;
  const state = explosive ? 'exp' : hot ? 'hot' : 'cool';
  const glowRGB = explosive ? '251,146,60' : hot ? '244,114,182' : '56,189,248';

  // ── Ghost trail — soft tapered cometary tail ──────────────────
  const tn = ball.trail.length;
  for (let i = 0; i < tn; i++) {
    const t = ball.trail[i];
    const p = i / tn;
    ctx.globalAlpha = 0.08 + p * 0.22;
    ctx.fillStyle = `rgba(${glowRGB},1)`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, ball.r * (0.35 + p * 0.65), 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── Baked halo + core sprite ───────────────────────────────────
  const spr = _makeBallSprite(state, ball.r);
  ctx.drawImage(spr.canvas, ball.x - spr.offset, ball.y - spr.offset);
}

function legacyDrawPaddle() {
  const px=paddle.x-paddle.w/2, py=paddle.y-PADDLE_H/2;

  // ── Heat trail (afterimage) ───────────────────────────────────
  paddle.heatTrail.forEach((hx,i) => {
    const p = (i+1)/paddle.heatTrail.length;
    ctx.globalAlpha = p*0.12;
    ctx.fillStyle = paddle.magnet ? '#f472b6' : '#38bdf8';
    ctx.beginPath();
    ctx.roundRect(hx-paddle.w/2, py, paddle.w, PADDLE_H, 5);
    ctx.fill();
  });
  ctx.globalAlpha=1;

  // ── Color palette per mode ────────────────────────────────────
  const glowColor = laserActive ? '#f43f5e' : paddle.magnet ? '#f472b6' : paddle.expand ? '#fbbf24' : '#38bdf8';
  const bodyColor = laserActive ? '#be123c' : paddle.magnet ? '#9d174d' : paddle.expand ? '#b45309' : '#0c4a6e';
  const edgeColor = laserActive ? '#f43f5e' : paddle.magnet ? '#f472b6' : paddle.expand ? '#fbbf24' : '#38bdf8';

  // ── Thruster flames at the underside (flat gradient, no jitter) ──
  const now = performance.now();
  const flameFlicker = 0.75 + 0.25*Math.sin(now*0.045);
  const flameGrad = ctx.createLinearGradient(px, py+PADDLE_H, px, py+PADDLE_H + 18);
  flameGrad.addColorStop(0, edgeColor + 'cc');
  flameGrad.addColorStop(0.5, edgeColor + '66');
  flameGrad.addColorStop(1, edgeColor + '00');
  ctx.globalAlpha = 0.7 * flameFlicker;
  ctx.fillStyle = flameGrad;
  // Single flame cone at paddle center — predictable, smooth
  const fx = px + paddle.w*0.5;
  const fw = 10;
  ctx.beginPath();
  ctx.moveTo(fx - fw, py + PADDLE_H);
  ctx.lineTo(fx, py + PADDLE_H + 16);
  ctx.lineTo(fx + fw, py + PADDLE_H);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // ── Outer glow ────────────────────────────────────────────────
  ctx.shadowBlur = 24+(paddle.magnet?10:0)+(laserActive?14:0);
  ctx.shadowColor = glowColor;

  // ── Body — two-stop glass gradient ────────────────────────────
  const bodyGrad = ctx.createLinearGradient(px, py, px, py+PADDLE_H);
  bodyGrad.addColorStop(0,    bodyColor);
  bodyGrad.addColorStop(0.6,  'rgba(6,10,20,0.9)');
  bodyGrad.addColorStop(1,    'rgba(0,0,0,0.85)');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath(); ctx.roundRect(px, py, paddle.w, PADDLE_H, 4); ctx.fill();

  // ── Body sheen — short highlight at the top ───────────────────
  ctx.shadowBlur = 0;
  const sheen = ctx.createLinearGradient(px, py, px, py + PADDLE_H*0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,0.25)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.beginPath(); ctx.roundRect(px+2, py+1, paddle.w-4, PADDLE_H*0.45, [3,3,1,1]); ctx.fill();

  // ── Light ribbon along the top (Tron vibe) ────────────────────
  ctx.shadowBlur = 16; ctx.shadowColor = edgeColor;
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px+6, py+1); ctx.lineTo(px+paddle.w-6, py+1);
  ctx.stroke();
  // Bright sub-line on top of ribbon
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px+8, py+1); ctx.lineTo(px+paddle.w-8, py+1);
  ctx.stroke();

  // ── Wing fins at each end ─────────────────────────────────────
  ctx.shadowBlur = 10; ctx.shadowColor = edgeColor;
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px+5, py); ctx.lineTo(px-4, py+PADDLE_H/2); ctx.lineTo(px+5, py+PADDLE_H);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px+paddle.w-5, py); ctx.lineTo(px+paddle.w+4, py+PADDLE_H/2); ctx.lineTo(px+paddle.w-5, py+PADDLE_H);
  ctx.stroke();

  // ── Cockpit bump ──────────────────────────────────────────────
  const cockpitW = 22, cockpitH = 6;
  const cx2 = px + paddle.w/2 - cockpitW/2;
  const cockpitGrad = ctx.createLinearGradient(cx2, py-cockpitH, cx2, py+2);
  cockpitGrad.addColorStop(0, edgeColor);
  cockpitGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = cockpitGrad;
  ctx.shadowBlur = 12; ctx.shadowColor = edgeColor;
  ctx.beginPath(); ctx.roundRect(cx2, py-cockpitH+2, cockpitW, cockpitH, 3); ctx.fill();
  // Cockpit window slit
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(cx2 + 3, py - cockpitH + 3, cockpitW - 6, 1);

  // ── Bottom dim edge ───────────────────────────────────────────
  ctx.strokeStyle = `rgba(255,255,255,0.10)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px+4, py+PADDLE_H-1); ctx.lineTo(px+paddle.w-4, py+PADDLE_H-1);
  ctx.stroke();

  ctx.shadowBlur=0;

  // Charge indicator ring
  if (charging && chargeTime>0.3) {
    const intensity = Math.min(1, chargeTime/1.5);
    ctx.shadowBlur=12+chargeTime*6; ctx.shadowColor='#f472b6';
    ctx.strokeStyle=`rgba(244,114,182,${intensity})`;
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.roundRect(px-3,py-3,paddle.w+6,PADDLE_H+6,8); ctx.stroke();
    ctx.shadowBlur=0;
  }

  // Shield
  if (paddle.shield && paddle.shieldLife>0) {
    const a=Math.min(1,paddle.shieldLife/2);
    ctx.strokeStyle=`rgba(52,211,153,${a})`;
    ctx.shadowBlur=10; ctx.shadowColor='#34d399';
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.roundRect(px-8,py-8,paddle.w+16,PADDLE_H+16,11); ctx.stroke();
    ctx.shadowBlur=0;
  }

  // Laser gun barrels
  if (laserActive) {
    ctx.fillStyle='#f43f5e';
    ctx.shadowBlur=8; ctx.shadowColor='#f43f5e';
    ctx.fillRect(px+10, py-6, 4, 7);
    ctx.fillRect(px+paddle.w-14, py-6, 4, 7);
    ctx.shadowBlur=0;
  }
}

function drawEMP() {
  empWaves.forEach(w => {
    const a=w.life;
    ctx.beginPath(); ctx.arc(w.x,w.y,w.r,0,Math.PI*2);
    ctx.strokeStyle=`rgba(129,140,248,${a*0.85})`;
    ctx.lineWidth=3; ctx.shadowBlur=22; ctx.shadowColor='#818cf8';
    ctx.stroke();
    if(w.r>24) {
      ctx.beginPath(); ctx.arc(w.x,w.y,w.r*0.72,0,Math.PI*2);
      ctx.strokeStyle=`rgba(196,181,253,${a*0.35})`;
      ctx.lineWidth=1.5; ctx.stroke();
    }
    ctx.shadowBlur=0;
  });
  empHits.forEach(h => {
    ctx.fillStyle=`rgba(129,140,248,${h.life*0.55})`;
    ctx.shadowBlur=14; ctx.shadowColor='#818cf8';
    ctx.beginPath(); ctx.arc(h.x,h.y,9*h.life,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
  });
}

function drawSuperBeam() {
  if (!superBeam) return;
  const maxT = superBeam.full ? 0.55 : 0.35;
  const a = Math.min(1, superBeam.timer/maxT);
  if (superBeam.full) {
    ctx.shadowBlur=55; ctx.shadowColor='#fbbf24';
    ctx.fillStyle=`rgba(251,191,36,${a*0.4})`;
    ctx.fillRect(superBeam.x,0,superBeam.w,superBeam.h);
    ctx.fillStyle=`rgba(255,255,220,${a*0.9})`;
    ctx.fillRect(superBeam.x+superBeam.w/2-3,0,6,superBeam.h);
    ctx.fillStyle=`rgba(251,191,36,${a*0.65})`;
    ctx.fillRect(superBeam.x+4,0,superBeam.w-8,superBeam.h);
  } else {
    ctx.shadowBlur=32; ctx.shadowColor='#f472b6';
    ctx.fillStyle=`rgba(244,114,182,${a*0.55})`;
    ctx.fillRect(superBeam.x,0,superBeam.w,superBeam.h);
    ctx.fillStyle=`rgba(255,255,255,${a*0.88})`;
    ctx.fillRect(superBeam.x+2,0,4,superBeam.h);
  }
  ctx.shadowBlur=0;
}

function drawLasers() {
  lasers.forEach(l => {
    ctx.shadowBlur=12; ctx.shadowColor='#f43f5e';
    ctx.fillStyle='#fca5a5';
    ctx.fillRect(l.x, l.y, l.w, l.h);
    ctx.fillStyle='#fff';
    ctx.fillRect(l.x+0.5, l.y, l.w-1, l.h*0.4);
    ctx.shadowBlur=0;
  });
}

function drawParticle(p) {
  ctx.globalAlpha=Math.max(0,p.life);
  ctx.fillStyle=p.color;
  ctx.shadowBlur=5; ctx.shadowColor=p.color;
  ctx.fillRect(p.x-p.size/2, p.y-p.size/2, p.size, p.size);
}

function drawPowerup(p) {
  const def = POWERUP_DEFS[p.type];
  if (!def) return;
  const bob = Math.sin(p.t*3)*2;

  ctx.shadowBlur=16; ctx.shadowColor=def.glow;
  ctx.fillStyle=def.color+'28';
  ctx.strokeStyle=def.color;
  ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(p.x, p.y+bob, 13, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();

  // Inner hex shape
  ctx.fillStyle=def.color+'55';
  ctx.beginPath();
  for(let i=0;i<6;i++) {
    const a=i/6*Math.PI*2-Math.PI/6;
    const r=8;
    i===0 ? ctx.moveTo(p.x+Math.cos(a)*r, p.y+bob+Math.sin(a)*r)
           : ctx.lineTo(p.x+Math.cos(a)*r, p.y+bob+Math.sin(a)*r);
  }
  ctx.closePath(); ctx.fill();

  ctx.shadowBlur=0;
  ctx.fillStyle=def.color;
  ctx.font='bold 9px Orbitron, monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(def.icon, p.x, p.y+bob);
}

/* ═══════════════════════════════════════════════════════════════
   HUD
   ═══════════════════════════════════════════════════════════════ */

/* Grooveline bonus presentation and lifecycle follow. */
const teal='#00d4c8',coral='#ff5e6c',gold='#f0c040',paper='#e2e8f8';
const roundRect=(x,y,w,h,r,fill,stroke)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}};
function label(text,x,y,size=10,color=paper,font='Share Tech Mono'){
  ctx.font=`${size}px "${font}",monospace`;ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y);
}
function vinyl(x,y,r,color,angle){
  ctx.save();ctx.translate(x,y);ctx.rotate(reduced?0:angle);
  ctx.fillStyle='#071018';ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();
  for(let k=12;k<r;k+=7){ctx.beginPath();ctx.arc(0,0,k,0,Math.PI*2);ctx.strokeStyle='#749ca017';ctx.lineWidth=1;ctx.stroke();}
  ctx.beginPath();ctx.arc(0,0,18,0,Math.PI*2);ctx.fillStyle=color+'16';ctx.fill();
  ctx.fillStyle=color+'35';ctx.fillRect(-1,-r+7,2,11);ctx.restore();
}
function drawBackground(){
  ctx.fillStyle='#071018';ctx.fillRect(0,0,W,H);
  const glow=ctx.createRadialGradient(280,270,20,280,270,390);glow.addColorStop(0,'#0c242b');glow.addColorStop(1,'#060c14');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
  vinyl(111,371,106,teal,elapsed*.55);vinyl(449,371,106,coral,-elapsed*.55);
  ctx.strokeStyle='#81b8c109';ctx.lineWidth=1;
  for(let y=45;y<H;y+=28){ctx.beginPath();ctx.moveTo(12,y);ctx.lineTo(W-12,y);ctx.stroke();}
  for(let x=20;x<W;x+=58){ctx.beginPath();ctx.moveTo(x,44);ctx.lineTo(x,H-45);ctx.stroke();}
  label(encore?'ENCORE / SEQUENCE 02':'SIDE A / SEQUENCE 01',115,22,9,'#8aa4b3');
  label(dropActive?'THE DROP · ×5':'33⅓ / BONUS SESSION',443,22,9,dropActive?gold:teal);
  ctx.fillStyle='#00d4c825';ctx.fillRect(15,39,530,1);
  label('G R O O V E L I N E',280,378,18,'#7bb9c01e','Orbitron');
  label('KEEP THE RECORD SPINNING',280,402,8,'#8cb0bf28');
  ctx.strokeStyle='#00d4c830';ctx.beginPath();ctx.moveTo(14,H-24);ctx.lineTo(W-14,H-24);ctx.stroke();
  label('A',25,H-13,8,teal);label('C R O S S F A D E R',280,H-13,8,'#8097a8');label('B',535,H-13,8,coral);
}
function drawBrick(b){
  if(!b.alive)return;
  const color=dropActive?gold:b.hasShield?gold:b.type==='explosive'?coral:b.maxHp>1?coral:teal;
  const lit=b.glowTimer>0;
  ctx.save();ctx.shadowBlur=lit&&!reduced?14:0;ctx.shadowColor=color;
  const surface=ctx.createLinearGradient(0,b.y,0,b.y+b.h);surface.addColorStop(0,lit?'#e2e8f8':color+'6b');surface.addColorStop(.18,color+'36');surface.addColorStop(1,'#101c29');
  roundRect(b.x+1,b.y+1,b.w-2,b.h-2,3,surface,color+'a0');ctx.shadowBlur=0;
  ctx.fillStyle=lit?paper:color;ctx.fillRect(b.x+5,b.y+5,3,b.h-10);
  ctx.fillStyle='#d9eef224';ctx.fillRect(b.x+11,b.y+4,b.w-17,1);
  const bars=Math.min(4,b.hp+1);for(let i=0;i<bars;i++){ctx.fillStyle=color+(i===0?'aa':'55');ctx.fillRect(b.x+13+i*7,b.y+10,4,5);}
  if(b.hp<b.maxHp){ctx.strokeStyle=coral;ctx.beginPath();ctx.moveTo(b.x+30,b.y+2);ctx.lineTo(b.x+25,b.y+11);ctx.lineTo(b.x+32,b.y+b.h-2);ctx.stroke();}
  if(b.hasShield){ctx.strokeStyle=gold+'80';ctx.strokeRect(b.x-1,b.y-1,b.w+2,b.h+2);}
  ctx.restore();
}
function drawPaddle(){
  const x=paddle.x-paddle.w/2,y=paddle.y-PADDLE_H/2;
  ctx.save();ctx.shadowBlur=reduced?0:14;ctx.shadowColor=teal;
  const metal=ctx.createLinearGradient(0,y,0,y+PADDLE_H);metal.addColorStop(0,'#d1e1e6');metal.addColorStop(.28,'#688491');metal.addColorStop(.55,'#213747');metal.addColorStop(1,'#0b1724');
  roundRect(x,y,paddle.w,PADDLE_H,3,metal,'#b8d7de');ctx.shadowBlur=0;
  ctx.fillStyle=teal;ctx.fillRect(x+3,y+3,9,PADDLE_H-6);ctx.fillStyle=coral;ctx.fillRect(x+paddle.w-12,y+3,9,PADDLE_H-6);
  for(let i=-2;i<=2;i++){ctx.fillStyle=i===0?'#e2e8f8':'#8aa3ad';ctx.fillRect(paddle.x+i*4,y+3,1,7);}
  if(paddle.shield){ctx.strokeStyle=gold;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-8,y+21);ctx.lineTo(x+paddle.w+8,y+21);ctx.stroke();}
  ctx.restore();
}
function drawDropOverlay(){
  if(!dropActive)return;
  ctx.strokeStyle=gold+'60';ctx.lineWidth=2;ctx.strokeRect(4,4,W-8,H-8);
  label('T H E  D R O P',280,465,20,gold,'Orbitron');label('×5 DAMAGE / ×5 POINTS',280,490,10,'#dacb99');
}
function drawCRTOverlay(){} // Keep the ball clear; no scanline overlay in the DJ arena.
function maybeDropPowerup(x,y){
  if(Math.random()>.14)return;
  const types=['expand','multi','shield','laser','explosive'];
  powerups.push({x,y,vy:1.6,type:types[Math.floor(Math.random()*types.length)],r:11,alive:true,t:0});
}
function showComboFlash(text){$('combo-flash').textContent=text;noticeTime=1;}
function announceAbility(key){
  const copy={emp:'FILTER SWEEP',blast:'BASS BLAST',blastFull:'BASS BLAST / MAX',laser:'CUE LASER',empReady:'FILTER READY',laserReady:'LASER READY'};
  if(copy[key])showComboFlash(copy[key]);
}
function points(){return Math.min(100000,score*10+(ended&&bricks.every(b=>!b.alive)?5000:0));}
function result(){return {points:points(),reason:bricks.every(b=>!b.alive)?'cleared':elapsed>=60?'time':lives<=0?'lives':'returned',rawScore:score};}
function complete(){if(ended)return;ended=true;running=false;state='gameover';clearControls();updateHUD();apiHooks?.done(result());}
function gameOver(){complete();}
function levelUp(){complete();}
function updateHUD(){
  $('nb-score').textContent=String(points()).padStart(6,'0');$('nb-time').textContent=String(Math.max(0,Math.ceil(60-elapsed))).padStart(2,'0');
  $('nb-lives').textContent='● '.repeat(Math.max(0,lives)).trim()||'—';
  $('set-progress').style.width=elapsed/60*100+'%';
  $('drop-count').textContent=Math.ceil(Math.max(0,(dropActive?60:48)-elapsed))+'s';
  $('drop-label').textContent=dropActive?'THE DROP / ×5':'BUILD TO THE DROP';
  $('fader-cap').style.left=paddle.x/W*100+'%';
  document.body.classList.toggle('drop-active',dropActive);
}
function clearControls(){for(const k of Object.keys(keys))keys[k]=false;charging=false;chargeTime=0;pointerId=null;mouseX=paddle.x;}
function prepare(options){
  apiHooks=options;encore=!!options.encore;elapsed=0;ended=false;running=false;state='playing';score=0;lives=3;level=encore?3:1;
  balls=[];particles=[];powerups=[];lasers=[];laserParticles=[];empWaves=[];empHits=[];timers=[];spawning=false;
  paddle.x=mouseX=W/2;paddle.w=PADDLE_W_BASE;paddle.heatTrail=[];paddle.shield=false;paddle.magnet=false;paddle._ghost=false;paddle._warpActive=false;
  dropActive=false;dropArmTimer=0;empCooldown=0;blastCooldown=0;laserActive=false;laserTime=0;laserCooldown=0;
  const pattern=encore?['...222...','..21112..','.2111112.','211S1S112','11X111X11','111111111']:['....1....','..1.1.1..','.11.1.11.','111111111','111111111','111111111'];
  bricks=parsePattern(pattern);spawnBall();
  $('set-label').textContent=encore?'ENCORE SET / 02':'BONUS SET / 01';$('set-number').textContent=encore?'02':'01';
  updateHUD();resize();
}
function setRunning(value){running=!!value&&!ended;clearControls();accumulator=0;}
function key(code,down){
  // Track physical keys independently so releasing M cannot release ArrowRight.
  if(!down){keys[code]=false;return;}
  if(!running||keys[code])return;
  keys[code]=true;
  if(code==='Space')fireBlast();if(code==='KeyG')activateEMP();if(code==='KeyL'&&!laserActive&&laserCooldown<=0)activateLaser();
}
let pointerId=null;
function bindDrag(el){
  const move=e=>{const rect=el.getBoundingClientRect();mouseX=Math.max(0,Math.min(W,(e.clientX-rect.left)/rect.width*W));};
  el.addEventListener('pointerdown',e=>{if(!running||pointerId!==null)return;e.preventDefault();pointerId=e.pointerId;el.setPointerCapture(e.pointerId);move(e);});
  el.addEventListener('pointermove',e=>{if(running&&(e.pointerId===pointerId||el===canvas&&e.pointerType==='mouse'&&pointerId===null))move(e);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(name,e=>{if(e.pointerId===pointerId)pointerId=null;});
}
bindDrag(canvas);bindDrag($('crossfader'));
for(const [id,code] of [['btn-emp','KeyG'],['btn-blast','Space'],['btn-laser','KeyL']])$(id).addEventListener('click',()=>{key(code,true);key(code,false);});
document.addEventListener('keydown',e=>{
  if(['KeyP','Escape'].includes(e.code)){e.preventDefault();if(!e.repeat)apiHooks?.pause();return;}
  if(['Space','ArrowLeft','ArrowRight','KeyZ','KeyM','KeyA','KeyD','KeyG','KeyL'].includes(e.code)){
    if(e.code==='Space'&&e.target.tagName==='BUTTON')return;e.preventDefault();key(e.code,true);
  }
});
document.addEventListener('keyup',e=>key(e.code,false));
window.addEventListener('blur',()=>{clearControls();apiHooks?.blur?.();});
function resize(){
  clearControls();
  const landscape=innerHeight<=540&&innerWidth>=600;
  const main=document.querySelector('main'),arena=document.querySelector('.arena');
  const avail=main.clientHeight-parseFloat(getComputedStyle(main).paddingTop)*2;
  let maxWidth=innerWidth<=760?innerWidth-26:Math.min(720,(innerWidth-160)*.49);
  // Measure actual surrounding UI rather than assuming one desktop height.
  const chrome=landscape?0:arena.getBoundingClientRect().height-$('canvas-wrap').getBoundingClientRect().height;
  maxWidth=Math.max(110,Math.min(maxWidth,(avail-chrome-4)*W/H));
  arena.style.setProperty('--arena-width',maxWidth+'px');$('canvas-wrap').style.width=maxWidth+'px';
  const dpr=Math.min(devicePixelRatio||1,2.5);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener('resize',resize);
// Copy the existing embedded font declarations: CSS-owned FontFace objects
// cannot be moved between documents in Firefox.
try{
  const fonts=document.createElement('style');
  fonts.textContent=[...parent.document.styleSheets].flatMap(sheet=>{
    try{return [...sheet.cssRules].filter(rule=>rule.type===CSSRule.FONT_FACE_RULE).map(rule=>rule.cssText);}catch{return [];}
  }).join('\n');
  document.head.append(fonts);
}catch{}

document.fonts.ready.then(resize);
let animation;
function frame(now){
  const dt=Math.min(.05,(now-previous)/1000||0);previous=now;
  if(running){
    accumulator+=dt;
    while(accumulator>=1/60&&running){
      elapsed=Math.min(60,elapsed+1/60);
      const due=timers.filter(t=>t.at<=elapsed);timers=timers.filter(t=>t.at>elapsed);for(const t of due)t.fn();
      if(elapsed>=48&&!dropActive&&elapsed<60){triggerDrop();sound('drop');showComboFlash('THE DROP / ×5');}
      update(1/60);noticeTime=Math.max(0,noticeTime-1/60);accumulator-=1/60;
      if(elapsed>=60)complete();
    }
  }
  if(reduced){screenShake.x=screenShake.y=0;flashAlpha=0;}
  render();$('combo-flash').style.opacity=noticeTime>0?'1':'0';
  document.body.style.setProperty('--record-angle',(reduced?0:elapsed*33.33*6)+'deg');
  const sample=apiHooks?.sample?.(),energy=sample?.playing?sample.energy:.15;
  document.querySelectorAll('.meters i').forEach((el,i)=>el.style.setProperty('--bar-height',Math.max(9,Math.min(100,(sample?.playing?(sample.levels[i]||0)*85:20+Math.sin(elapsed*3+i)*13)+(dropActive?15:0)))+'%'));
  $('music-label').textContent=sample?.playing?'GROOVELINE RADIO / ON AIR':'KEEP THE RECORD SPINNING';
  animation=requestAnimationFrame(frame);
}
const api={prepare,setRunning,key,result,dispose(){running=false;timers=[];cancelAnimationFrame(animation);},snapshot:()=>({elapsed,running,ended,score,points:points(),lives,dropActive,balls:balls.map(b=>({...b})),bricks:bricks.filter(b=>b.alive).length,paddle:{...paddle}})};
// Deterministic simulation controls exist only in an explicitly requested local debug session.
try{if(new URLSearchParams(parent.location.search).has('debug'))window.nexbreakDebug={api,advance(seconds){const was=running;running=false;for(let i=0;i<Math.round(seconds*60)&&!ended;i++){elapsed=Math.min(60,elapsed+1/60);const due=timers.filter(t=>t.at<=elapsed);timers=timers.filter(t=>t.at>elapsed);for(const t of due)t.fn();if(elapsed>=48&&!dropActive&&elapsed<60)triggerDrop();update(1/60);if(elapsed>=60)complete();}running=was&&!ended;updateHUD();},setBall(x,y,vx,vy){balls=[{...balls[0],x,y,vx,vy,alive:true,r:BALL_R,trail:[],glowTimer:0,explosiveHits:0}];spawning=false;},clear(){bricks.forEach(b=>b.alive=false);levelUp();}};}catch{}
resize();animation=requestAnimationFrame(frame);
if(parent!==window&&parent.GroovelineNexbreak)parent.GroovelineNexbreak.ready(window,api);
})();
