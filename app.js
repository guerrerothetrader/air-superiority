(() => {
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let W, H;

// Elementos DOM
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('gameover-screen');
const hudLayer = document.getElementById('hud-layer');
const finalScoreTxt = document.getElementById('final-score-txt');
const scoresList = document.getElementById('scores-list');
const playerNameInput = document.getElementById('player-name');

function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

// --- ESTADO DEL JUEGO ---
let gameState = 'MENU'; // 'MENU', 'PLAYING', 'GAMEOVER'

// --- UTILIDADES MATEMÁTICAS ---
const vec = (x,y) => ({x,y});
const add = (a,b) => ({x:a.x+b.x, y:a.y+b.y});
const sub = (a,b) => ({x:a.x-b.x, y:a.y-b.y});
const mul = (a,s) => ({x:a.x*s, y:a.y*s});
const len = v => Math.hypot(v.x, v.y);
const norm = v => { const L=len(v)||1; return {x:v.x/L, y:v.y/L}; };
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const angle = v => Math.atan2(v.y, v.x);
const fromAngle = a => ({x: Math.cos(a), y: Math.sin(a)});
function rotateTowardsWithDelta(cur, tgt, max) {
  let diff = (tgt - cur + Math.PI*3) % (Math.PI*2) - Math.PI;
  let delta = clamp(diff, -max, max);
  return { angle: cur + delta, delta: delta };
}
const rand = (min,max) => Math.random()*(max-min)+min;


// --- EFECTOS Y ENTORNO ---
let screenShake = 0;
function addShake(amount) { screenShake = Math.min(screenShake + amount, 30); }
const particles = [];
function spawnParticle(pos, vel, life, color, type='smoke') {
  particles.push({pos:{...pos}, vel:{...vel}, life, maxLife:life, color, type});
}

// Nubes esponjosas
const clouds = [];
function initClouds() {
    clouds.length = 0;
    for(let i=0; i<12; i++) {
        spawnCloud(rand(0, W), rand(0, H));
    }
}
function spawnCloud(x, y) {
    const baseSize = rand(60, 150);
    const cloud = {
        pos: vec(x, y),
        vel: vec(rand(-15, -5), 0), // Se mueven lento a la izquierda
        opacity: rand(0.1, 0.25),
        puffs: []
    };
    // Crear cúmulos para que parezca esponjosa
    const numPuffs = Math.floor(rand(5, 9));
    for(let i=0; i<numPuffs; i++) {
        cloud.puffs.push({
            off: vec(rand(-baseSize/2, baseSize/2), rand(-baseSize/4, baseSize/4)),
            r: rand(baseSize*0.3, baseSize*0.6)
        });
    }
    clouds.push(cloud);
}


// --- NUEVO: FUNCIONES DE LEADERBOARD ---
function updateLeaderboardUI() {
    if(!scoresList) return;
    const scores = JSON.parse(localStorage.getItem('airSuperiorityScores') || '[]');
    scoresList.innerHTML = scores.map((s, i) => `
        <div style="display:flex; justify-content:space-between; padding:5px; border-bottom:1px solid #0ff2;">
            <span>#${i+1} ${s.name}</span>
            <span style="color:#fd0">${s.score}</span>
        </div>
    `).join('');
}

window.saveScore = () => {
    const name = playerNameInput.value.trim().toUpperCase() || 'PILOTO';
    const scores = JSON.parse(localStorage.getItem('airSuperiorityScores') || '[]');
    scores.push({ name, score });
    scores.sort((a,b) => b.score - a.score);
    localStorage.setItem('airSuperiorityScores', JSON.stringify(scores.slice(0, 5)));
    updateLeaderboardUI();
    playerNameInput.value = "";
    startGame(); // Reinicia el juego tras guardar
};


// --- NUEVO: SPAWN DE BENGALAS ---
function spawnPickup() {
    pickups.push({
        pos: vec(rand(100, W-100), rand(100, H-100)),
        id: Date.now()
    });
}


// --- JUGADOR ---
const plane = {
  pos: vec(0,0), vel: vec(0,0), speed: 950, angle: 0,
  health: 100, maxHealth: 100,
  evasive: false, evasiveTimer: 0, evasiveCooldown: 0,
  rollVisual: 0
};

// --- VARIABLES DE JUEGO ---
const missiles = [];
const flares = [];
const pickups = [];
let score = 0;
let wave = 1;
let waveTimer = 0;
const keys = {};
const FLARE_COOLDOWN = 2.0;
let flareStock = 3;
let lastFlareTime = -999;

// --- FUNCIONES DE DIBUJADO ---
function drawBackground(ctx) {
    // 1. Globo terráqueo (Gradiente gigante)
    const earthGrad = ctx.createRadialGradient(W/2, H*2.5, H*0.5, W/2, H*2.5, H*2.8);
    earthGrad.addColorStop(0, '#1a3a5a'); // Horizonte azul claro
    earthGrad.addColorStop(1, '#02050a'); // Espacio profundo
    ctx.fillStyle = earthGrad;
    ctx.fillRect(0,0,W,H);

    // 2. Nubes Esponjosas
    ctx.save();
    for(let c of clouds) {
        ctx.globalAlpha = c.opacity;
        ctx.fillStyle = '#fff';
        // Dibujar cada "puff" de la nube con sombra suave para volumen
        for(let p of c.puffs) {
            ctx.beginPath();
            // Usar un gradiente radial para bordes muy suaves
            const grad = ctx.createRadialGradient(c.pos.x+p.off.x, c.pos.y+p.off.y, p.r*0.1, c.pos.x+p.off.x, c.pos.y+p.off.y, p.r);
            grad.addColorStop(0, 'rgba(255,255,255,0.8)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.arc(c.pos.x + p.off.x, c.pos.y + p.off.y, p.r, 0, Math.PI*2);
            ctx.fill();
        }
    }
    ctx.restore();

    // 3. Cuadrícula de Radar (Encima de las nubes para efecto HUD)
    ctx.strokeStyle = 'rgba(100,220,255,0.05)'; ctx.lineWidth=1;
    ctx.beginPath();
    // Dibujar solo líneas cercanas al centro para un look más "esférico"
    const gridSpacing = 150;
    const offsetX = Math.floor(plane.pos.x / gridSpacing) * gridSpacing;
    const offsetY = Math.floor(plane.pos.y / gridSpacing) * gridSpacing;
    for(let x = offsetX - gridSpacing*5; x < offsetX + W + gridSpacing*5; x+=gridSpacing) { ctx.moveTo(x-plane.pos.x*0.1,0); ctx.lineTo(x-plane.pos.x*0.1,H); }
    for(let y = offsetY - gridSpacing*5; y < offsetY + H + gridSpacing*5; y+=gridSpacing) { ctx.moveTo(0,y-plane.pos.y*0.1); ctx.lineTo(W,y-plane.pos.y*0.1); }
    ctx.stroke();
}

function drawJet(ctx, p) {
  ctx.save();
  ctx.translate(p.pos.x, p.pos.y); ctx.rotate(p.angle);
  let scaleY = p.evasive ? Math.cos(p.rollVisual * Math.PI * 2) : 1;
  ctx.scale(1, scaleY);
  ctx.shadowBlur = 15; ctx.shadowColor = 'rgba(0,0,0,0.7)';

  ctx.fillStyle = '#5a667a'; ctx.beginPath(); ctx.moveTo(18,0); ctx.lineTo(-12,9); ctx.lineTo(-18,5); ctx.lineTo(-18,-5); ctx.lineTo(-12,-9); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#4a5260'; ctx.beginPath(); ctx.moveTo(4,0); ctx.lineTo(-10,20); ctx.lineTo(-15,20); ctx.lineTo(-6,0); ctx.lineTo(-15,-20); ctx.lineTo(-10,-20); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#adf'; ctx.beginPath(); ctx.ellipse(3, 0, 5, 2.5, 0, 0, Math.PI*2); ctx.fill();

  if(len(p.vel) > 150 && !p.evasive) {
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,120,50,${rand(0.6,1)})`;
    ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(-32-rand(0,15), 0); ctx.lineWidth=5; ctx.strokeStyle=ctx.fillStyle; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.scale(1, 1/Math.abs(scaleY || 0.1)); ctx.shadowBlur = 0;
  if(!p.evasive) {
    const healthPct = p.health/p.maxHealth;
    ctx.beginPath(); ctx.arc(0,0, 32, -Math.PI/2, -Math.PI/2 + (Math.PI*2 * healthPct), false);
    ctx.strokeStyle = healthPct > 0.3 ? `rgba(0,255,150,0.5)` : `rgba(255,50,50,0.7)`;
    ctx.lineWidth = 4; ctx.stroke();
    
    const now = performance.now()/1000;
    if(p.evasiveCooldown < now) {
      ctx.beginPath(); ctx.arc(0,0, 36, 0, Math.PI*2); ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth=1.5; ctx.stroke();
    }
  }
  ctx.restore();
}

function drawMissileObj(ctx, m) {
  ctx.save(); ctx.translate(m.pos.x, m.pos.y); ctx.rotate(m.angle);
  ctx.globalAlpha = m.opacity !== undefined ? m.opacity : 1;
  ctx.fillStyle = m.stalled ? '#777' : '#ccc'; ctx.fillRect(-7, -2.5, 14, 5);
  ctx.fillStyle = m.stalled ? '#999' : '#f22'; ctx.beginPath(); ctx.moveTo(7, -2.5); ctx.lineTo(12, 0); ctx.lineTo(7, 2.5); ctx.fill();
  ctx.fillStyle = '#666'; ctx.fillRect(-7, -5, 5, 10);
  if(!m.stalled) { ctx.fillStyle = '#fa0'; ctx.globalCompositeOperation = 'lighter'; ctx.beginPath(); ctx.arc(-8, 0, rand(2,4), 0, Math.PI*2); ctx.fill(); }
  ctx.restore();
}

// --- LOGICA DEL JUEGO ---
function startGame() {
    gameState = 'PLAYING';
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    hudLayer.classList.remove('hidden');
    reset();
}

function endGame() {
    gameState = 'GAMEOVER';
    hudLayer.classList.add('hidden');
    gameOverScreen.classList.remove('hidden');
    finalScoreTxt.innerText = score.toString().padStart(5,'0');
    updateLeaderboardUI()
}

function reset() {
  plane.pos = vec(W/2, H/2); plane.vel = vec(0,0); plane.health = 100;
  plane.evasive = false; plane.evasiveCooldown = 0;
  missiles.length=0; flares.length=0; particles.length=0;
  score=0; wave=1; waveTimer=0; flareStock = 3; screenShake = 0;
  initClouds(); // Reiniciar nubes
}

function spawnExplosion(pos, scale=1) {
  addShake(10 * scale);
  spawnParticle(pos, vec(0,0), 0.15, 'rgba(255,255,240,0.95)', 'flash');
  for(let i=0; i<25*scale; i++) {
    const a=rand(0,Math.PI*2), s=rand(60,300)*scale;
    spawnParticle(pos, vec(Math.cos(a)*s, Math.sin(a)*s), rand(0.5,1.0), `hsl(${rand(10,50)}, 100%, 60%)`, 'fire');
  }
}

function updateGame(dt) {
  const now = performance.now()/1000;
  screenShake *= 0.9; if(screenShake<0.5) screenShake=0;

  // Input Avión
  const acc = 1700; let input = vec(0,0);
  if(keys['w'] || keys['arrowup']) input.y -= 1;
  if(keys['s'] || keys['arrowdown']) input.y += 1;
  if(keys['a'] || keys['arrowleft']) input.x -= 1;
  if(keys['d'] || keys['arrowright']) input.x += 1;
  
  if(len(input)>0) plane.vel = add(plane.vel, mul(norm(input), acc*dt));
  plane.vel = mul(plane.vel, Math.pow(0.88, dt*60));
  if(len(plane.vel) > plane.speed) plane.vel = mul(norm(plane.vel), plane.speed);
  
  if(plane.evasive) {
    plane.rollVisual += dt * 1.8; plane.vel = mul(plane.vel, 1.03);
    if(plane.rollVisual >= 1) { plane.evasive = false; plane.rollVisual = 0; }
  }

  plane.pos = add(plane.pos, mul(plane.vel, dt));
  plane.pos.x = clamp(plane.pos.x, 30, W-30); plane.pos.y = clamp(plane.pos.y, 30, H-30);
  if(len(plane.vel)>20) plane.angle = rotateTowardsWithDelta(plane.angle, angle(plane.vel), 6*dt).angle;

  // Entidades
  if(len(plane.vel)>150) spawnParticle(sub(plane.pos, mul(fromAngle(plane.angle),20)), mul(fromAngle(plane.angle+Math.PI+rand(-0.1,0.1)),60), 0.25, 'rgba(150,220,255,0.3)','smoke');

  for(let i=flares.length-1; i>=0; i--) {
    let f=flares[i]; f.life-=dt; f.pos=add(f.pos,mul(f.vel,dt)); f.heat*=0.97;
    spawnParticle(f.pos, vec(0,0), 0.3, `rgba(255,220,100,${f.heat*0.5})`, 'fire');
    if(f.life<=0) flares.splice(i,1);
  }
  if(flareStock < 3 && now - lastFlareTime > 8) { flareStock++; lastFlareTime = now - FLARE_COOLDOWN - 1; }

  // Misiles (Lógica de pérdida incluida)
  for(let i=missiles.length-1; i>=0; i--) {
    let m = missiles[i];
    if(m.stalled) {
        m.params.speed *= 0.92; m.stallTimer += dt; m.opacity = Math.max(0, 1 - m.stallTimer);
        m.angle += rand(-0.15, 0.15); m.pos = add(m.pos, mul(fromAngle(m.angle), m.params.speed*dt));
        if(Math.random()>0.6) spawnParticle(m.pos, vec(0,0), 0.7, 'rgba(100,100,110,0.4)', 'smoke');
        if(m.stallTimer > 1.0 || m.params.speed < 20) { missiles.splice(i,1); score += 75; }
        continue;
    }
    if(Math.random()<0.6) spawnParticle(m.pos, vec(0,0), 0.6, 'rgba(220,220,235,0.2)', 'smoke');

    let target = plane; let bestScore = -1;
    for(let f of flares) {
       let dist = len(sub(f.pos, m.pos));
       if(dist < 450) { let s = (f.heat*2500)/(dist*dist+10); if(s>bestScore){bestScore=s; target=f;} }
    }

    let desiredAngle = angle(sub(target.pos, m.pos));
    let turnRate = m.params.turnRate;
    if(target === plane && plane.evasive) turnRate *= 0.1;

    let rotationResult = rotateTowardsWithDelta(m.angle, desiredAngle, turnRate * dt);
    m.angle = rotationResult.angle;
    
    // Detección de giros bruscos
    if(Math.abs(rotationResult.delta) > 0.02) {
        m.turnHistory.push({dir: Math.sign(rotationResult.delta), time: now});
        m.turnHistory = m.turnHistory.filter(t => now - t.time < 0.45);
        if(m.turnHistory.some(t=>t.dir<0) && m.turnHistory.some(t=>t.dir>0) && m.turnHistory.length > 4) {
            m.stalled = true; spawnParticle(m.pos, m.vel, 0.5, '#fff', 'flash'); addShake(3);
        }
    }

    m.pos = add(m.pos, mul(fromAngle(m.angle), m.params.speed * dt));

    if(len(sub(plane.pos, m.pos)) < 24) {
        if(plane.evasive) { score += 30; spawnParticle(m.pos, m.vel, 0.25, '#fff', 'flash'); }
        else {
            plane.health -= 34; spawnExplosion(m.pos); missiles.splice(i,1);
            if(plane.health <= 0) endGame();
            continue;
        }
    }
    if(target !== plane && len(sub(target.pos, m.pos)) < 20) { spawnExplosion(m.pos, 0.7); missiles.splice(i,1); score += 20; continue; }
    if(m.pos.x < -200 || m.pos.x > W+200 || m.pos.y < -200 || m.pos.y > H+200) { missiles.splice(i,1); score += 10; }
  }

  // Spawner
  waveTimer += dt;
  if(missiles.length === 0 && waveTimer > 3.0) {
      wave++; let count = Math.min(wave + 2, 16);
      for(let k=0; k<count; k++) {
          let side = Math.random() < 0.5 ? -80 : W+80;
          missiles.push({
              pos: vec(side, rand(H*0.1, H*0.9)), angle: side<0 ? 0.2 : Math.PI-0.2,
              turnHistory: [], stalled: false, stallTimer: 0, opacity: 1.0,
              params: { speed: rand(320, 420 + wave*12), turnRate: rand(1.6, 3.2) }
          });
      }
      waveTimer = 0;
  }

    // Lógica de recolección de bengalas
  for(let i = pickups.length - 1; i >= 0; i--) {
      if(len(sub(plane.pos, pickups[i].pos)) < 40) {
          flareStock++; // Aumenta inventario
          score += 150; // Bonus de puntos
          addShake(5);  // Feedback visual
          pickups.splice(i, 1); // Elimina la bengala recogida
      }
  }

  // Probabilidad aleatoria de que aparezca una bengala
  if(Math.random() < 0.002) spawnPickup();
}

function updateEnv(dt) {
    // Mover nubes
    for(let c of clouds) {
        c.pos = add(c.pos, mul(c.vel, dt));
        // Respawn nubes al salir por la izquierda
        if(c.pos.x < -200) {
            c.pos.x = W + 200;
            c.pos.y = rand(0, H);
        }
    }
    // Actualizar partículas (siempre se actualizan para que las explosiones terminen al morir)
    for(let i=particles.length-1; i>=0; i--) {
      let p=particles[i]; p.life-=dt; p.pos=add(p.pos,mul(p.vel,dt)); p.vel=mul(p.vel,0.96);
      if(p.life<=0) particles.splice(i,1);
    }
}


// --- BUCLE PRINCIPAL ---
function draw() {
  ctx.save();
  // Shake solo afecta al mundo del juego, no al fondo lejano
  let bgShakeX = rand(-screenShake*0.2, screenShake*0.2);
  let bgShakeY = rand(-screenShake*0.2, screenShake*0.2);
  ctx.translate(bgShakeX, bgShakeY);
  drawBackground(ctx); // Dibuja globo y nubes
  ctx.restore();

  ctx.save();
  if(screenShake > 0) ctx.translate(rand(-screenShake, screenShake), rand(-screenShake, screenShake));
  
  // Partículas
  ctx.globalCompositeOperation = 'lighter';
  for(let p of particles) {
      ctx.globalAlpha = p.life / p.maxLife; ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, (p.type==='flash'?rand(10,25):rand(3,9)), 0, Math.PI*2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

  // Objetos de juego (solo si se está jugando o acabas de morir)
  if (gameState !== 'MENU') {
      for(let m of missiles) drawMissileObj(ctx, m);
      drawJet(ctx, plane);
  }
  ctx.restore();

  // HUD Update
  if(gameState === 'PLAYING') {
      document.getElementById('scoreInfo').innerText = `SCORE: ${score.toString().padStart(5,'0')} | OLEADA: ${wave}`;
      document.getElementById('statusInfo').innerText = `MISILES: ${missiles.length} | BENGALAS: ${flareStock}`;
  }

  // Dibujar Pickups (Bengalas por el mapa)
  for(let p of pickups) {
      ctx.fillStyle = '#0ff';
      ctx.shadowBlur = 15; ctx.shadowColor = '#0ff';
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, 8 + Math.sin(Date.now()*0.01)*4, 0, Math.PI*2);
      ctx.fill();
      ctx.shadowBlur = 0;
  }
}

// --- INPUT & LOOP ---
window.addEventListener('keydown', e => {
    let k = e.key.toLowerCase();
    
    if(gameState === 'MENU') {
        if(k === ' ' || k === 'enter') startGame();
        return;
    }
    if(gameState === 'GAMEOVER') {
        if(k === 'r' || k === ' ') startGame();
        return;
    }

    if(gameState === 'PLAYING') {
        keys[k] = true;
        const now = performance.now()/1000;
        if(k === 'f' && flareStock > 0 && now - lastFlareTime > FLARE_COOLDOWN) {
            lastFlareTime = now; flareStock--;
            for(let i=0; i<5; i++) flares.push({ pos: {...plane.pos}, vel: add(plane.vel, vec(rand(-90,90), rand(-90,90))), life: 2.8, heat: 2.0 });
        }
        if(k === 'e' && now > plane.evasiveCooldown && !plane.evasive) {
            plane.evasive = true; plane.evasiveCooldown = now + 3.2;
        }
    }
});
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

let lastTime = performance.now();
function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min((now - lastTime)/1000, 0.1);
    lastTime = now;

    updateEnv(dt); // El entorno (nubes, partículas restantes) siempre se mueve
    if(gameState === 'PLAYING') {
        updateGame(dt); // La lógica del juego solo corre si estás jugando
    }
    draw();
}

initClouds();
updateLeaderboardUI();
loop();
})();
