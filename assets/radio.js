/* Radio stub for the open-source build.
   The original game tunes into the live Grooveline radio stream. This build makes
   no network requests: the radio controls are disabled and only the effects-volume
   slider stays active. Keeps the same window.GroovelineRadio surface the game uses. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const clamp = n => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : .35;
  let fxVolume = .35;
  try { fxVolume = clamp(Number(localStorage.getItem('grooveline-fx-volume') ?? .35)); } catch {}

  function setFx(n) {
    fxVolume = clamp(n);
    $('fxVolume').value = Math.round(fxVolume * 100);
    $('fxVolumeValue').textContent = Math.round(fxVolume * 100) + '%';
    try { localStorage.setItem('grooveline-fx-volume', String(fxVolume)); } catch {}
    window.dispatchEvent(new CustomEvent('grooveline-fx-volume', { detail: fxVolume }));
  }
  $('fxVolume').oninput = e => setFx(Number(e.target.value) / 100);

  for (const id of ['radioPlay', 'radioSource', 'radioVolume']) { const el = $(id); if (el) el.disabled = true; }
  $('radioStatus').textContent = 'Radio is not included in this build.';
  $('radioBadge').textContent = 'RADIO // OFFLINE';
  $('radioPanelBtn').hidden = true;
  setFx(fxVolume);

  const idle = { playing: false, levels: Array(12).fill(0), waveform: null, kind: 'standby',
    dj: 'GROOVELINE', track: '', url: '', energy: 0 };
  window.GroovelineRadio = {
    start() {},
    sample() { return idle; },
    get fxVolume() { return fxVolume; }
  };
})();
