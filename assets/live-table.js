/* Live booth artwork and a cosmetic shot challenge. No physics or audio control. */
(() => {
  'use strict';
  const palettes = [
    ['#00d4c8', '#ff5e6c'], ['#ff5e6c', '#f0c040'], ['#f0c040', '#00d4c8']
  ];
  const sessions = new Map();
  let current = null, active = false, radio = {}, gameMode = 'ready';
  let energy = [0, 0];
  const announcement = document.getElementById('liveChallengeStatus');
  function hash(value) {
    let result = 0;
    for (const ch of value) result = (Math.imul(result, 31) + ch.codePointAt(0)) >>> 0;
    return result;
  }
  function announce() {
    const message = !current ? '' : !active ? 'DJ challenge on hold.' :
      current.progress === 3 ? current.dj + ': BOOTH CREW badge earned.' :
      current.dj + ': DJ challenge ' + current.progress + '/3. Next shot: ' + current.shots[current.progress] + '.';
    if (announcement && announcement.textContent !== message) announcement.textContent = message;
  }
  function sync(frame, dt, mode) {
    radio = frame;
    gameMode = mode;
    active = frame.playing && frame.kind === 'live';
    if (active) {
      // Track metadata can change during a set without restarting its challenge.
      const key = frame.url + '\n' + frame.dj;
      if (!sessions.has(key)) {
        const seed = hash(frame.dj);
        sessions.set(key, { dj: frame.dj, colors: palettes[seed % palettes.length],
          shots: seed % 2 ? ['DECK B', 'DECK A', 'SPINNER'] : ['DECK A', 'DECK B', 'SPINNER'], progress: 0 });
      }
      current = sessions.get(key);
    }
    for (let side = 0; side < 2; side++) {
      // Low/high frequency energy from one broadcast, not the DJ's actual deck feeds.
      const values = frame.levels.slice(side * 6, side * 6 + 6);
      const target = active ? values.reduce((a, b) => a + b, 0) / 6 : 0;
      energy[side] += (target - energy[side]) * (1 - Math.exp(-dt * 7));
    }
    announce();
  }
  function hit(label) {
    if (!active || gameMode !== 'playing' || current.progress === 3 || label !== current.shots[current.progress]) return false;
    current.progress++;
    announce();
    return current.progress === 3;
  }
  function reset() { sessions.clear(); current = null; active = false; announce(); }
  function draw(g, reduced) {
    if (!active || !current) return;
    const [a, b] = current.colors;
    g.save();
    for (let side = 0; side < 2; side++) {
      const color = current.colors[side], x = side ? 314 : 176;
      const amount = reduced ? .35 : energy[side];
      g.strokeStyle = color; g.lineWidth = 3; g.globalAlpha = .3 + amount * .5;
      g.beginPath(); g.moveTo(side ? 446 : 35, 188); g.lineTo(side ? 446 : 35, 610); g.stroke();
      g.globalAlpha = 1;
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i < amount * 8 ? color : '#25303f';
        g.fillRect(x - 23 + i * 6, 301, 4, 3);
      }
    }
    const next = current.shots[current.progress];
    const shot = next === 'SPINNER' ? [245, 409, 33] : next === 'DECK A' ? [176, 233, 40] : [314, 233, 40];
    if (next) {
      g.strokeStyle = '#f0c040'; g.lineWidth = 1.5; g.setLineDash([4, 5]);
      g.beginPath(); g.arc(...shot, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
    // Keep the X target's lamp at (125,465) visible beside the display.
    g.fillStyle = '#0b111f'; g.fillRect(134, 463, 243, 18); g.fillRect(114, 481, 263, 96);
    g.fillStyle = a; g.fillRect(139, 465, 231, 1);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    function label(value, y, size, color, face = 'Share Tech Mono') {
      g.font = size + 'px "' + face + '"'; g.fillStyle = color;
      let str = String(value || '').replace(/\s+/g, ' ').trim();
      if (g.measureText(str).width > 240) {
        while (str && g.measureText(str + '…').width > 240) str = str.slice(0, -1);
        str += '…';
      }
      g.fillText(str, 245, y);
    }
    label('● ON AIR / LIVE BOOTH', 477, 9, a);
    label(radio.dj, 497, 14, '#e2e8f8', 'Orbitron');
    label(radio.track, 517, 11, '#a9b9cf');
    label(current.progress === 3 ? '★ BOOTH CREW / BADGE EARNED' : 'DJ CHALLENGE / ' + current.progress + ' OF 3', 539, 10, b);
    label(current.progress === 3 ? 'SET COMPLETE · KEEP IT SPINNING' : current.shots.map((s, i) => i < current.progress ? '✓ ' + s : s).join(' → '), 560, 10, current.progress === 3 ? '#f0c040' : '#e2e8f8');
    g.restore();
  }
  window.GroovelineLiveTable = { sync, hit, reset, draw };
  if (new URLSearchParams(location.search).has('debug')) window.GroovelineLiveTable.snapshot = () => ({
    active, energy: [...energy], current: current ? { ...current, colors: [...current.colors], shots: [...current.shots] } : null
  });
})();
