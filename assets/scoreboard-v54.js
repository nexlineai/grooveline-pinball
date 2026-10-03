/* Grooveline Pinball — online scoreboard.
 *
 * Deliberately standalone: this file never edits game-v*.js. It observes the
 * existing SESSION COMPLETE overlay via MutationObserver and reads the score
 * from the text the game already renders. That means a new game version drops
 * in without touching this, and this can be removed without touching the game.
 *
 * Requires nothing from the game's public API beyond the overlay DOM, which has
 * been stable since v43.
 */
(function () {
  'use strict';

  // Set window.PINBALL_SCORE_API to a compatible endpoint to enable the online scoreboard.
  var API = window.PINBALL_SCORE_API || null;
  var NAME_KEY = 'grooveline-pinball-name';
  var TOP_N = 10;

  var submittedThisSession = null;   // score already sent, so replays don't double-post
  var sessionStart = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---- styles ------------------------------------------------------------ */
  var css = document.createElement('style');
  css.textContent = [
    '#sbWrap{margin-top:14px;text-align:left;font-family:"Share Tech Mono",monospace}',
    '#sbForm{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap}',
    '#sbName{flex:1;min-width:120px;background:rgba(0,0,0,.45);border:1px solid rgba(0,212,200,.35);',
    ' border-radius:3px;color:#00d4c8;font-family:inherit;font-size:12px;letter-spacing:2px;',
    ' padding:9px 11px;text-transform:uppercase;outline:none}',
    '#sbName:focus{border-color:#00d4c8}',
    '#sbSave{background:rgba(0,212,200,.12);border:1px solid rgba(0,212,200,.5);border-radius:3px;',
    ' color:#00d4c8;font-family:inherit;font-size:10px;letter-spacing:2px;padding:10px 16px;',
    ' text-transform:uppercase;cursor:pointer;white-space:nowrap}',
    '#sbSave:hover:not(:disabled){background:#00d4c8;color:#041014}',
    '#sbSave:disabled{opacity:.4;cursor:default}',
    '#sbMsg{font-size:10px;letter-spacing:1.5px;color:rgba(200,210,240,.55);margin-bottom:10px;min-height:13px}',
    '#sbMsg.ok{color:#00d4c8}#sbMsg.err{color:#ff5e6c}',
    '#sbHead{font-size:9px;letter-spacing:3px;color:rgba(200,210,240,.4);text-transform:uppercase;margin-bottom:7px}',
    '#sbList{list-style:none;margin:0;padding:0;font-size:11px;line-height:1.75}',
    '#sbList li{display:flex;gap:9px;align-items:baseline;color:rgba(200,210,240,.75)}',
    '#sbList li.me{color:#f0c040}',
    '#sbList .r{color:rgba(200,210,240,.3);min-width:19px}',
    '#sbList .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#sbList .s{color:#00d4c8;font-variant-numeric:tabular-nums}',
    '#sbList li.me .s{color:#f0c040}'
  ].join('');
  document.head.appendChild(css);

  /* ---- markup, injected under the overlay footer -------------------------- */
  var wrap = document.createElement('div');
  wrap.id = 'sbWrap';
  wrap.hidden = true;
  wrap.innerHTML =
    '<div id="sbForm">' +
      '<input id="sbName" maxlength="12" placeholder="YOUR NAME" autocomplete="off" ' +
        'spellcheck="false" aria-label="Your name for the scoreboard">' +
      '<button id="sbSave" type="button">Save score</button>' +
    '</div>' +
    '<div id="sbMsg" role="status" aria-live="polite"></div>' +
    '<div id="sbHead">Top sessions</div>' +
    '<ol id="sbList"></ol>';

  function mount() {
    if (wrap.parentNode) return;              // already placed
    var foot = $('overlayFoot');
    if (foot && foot.parentNode) foot.parentNode.insertBefore(wrap, foot.nextSibling);
  }

  /* ---- leaderboard -------------------------------------------------------- */
  function render(scores, highlightName) {
    var list = $('sbList');
    if (!list) return;
    if (!scores.length) { list.innerHTML = '<li><span class="n">No scores yet — be first.</span></li>'; return; }
    list.innerHTML = scores.map(function (s, i) {
      var me = highlightName && s.name === highlightName ? ' class="me"' : '';
      return '<li' + me + '><span class="r">' + (i + 1) + '</span>' +
             '<span class="n">' + esc(s.name) + '</span>' +
             '<span class="s">' + Number(s.score).toLocaleString('en-US') + '</span></li>';
    }).join('');
  }

  function loadBoard(highlight) {
    if (!API) { var l = $('sbList'); if (l) l.innerHTML = '<li><span class="n">Online scoreboard disabled.</span></li>'; return; }
    fetch(API + '?limit=' + TOP_N, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : { scores: [] }; })
      .then(function (d) { render(d.scores || [], highlight); })
      .catch(function () {
        var list = $('sbList');
        if (list) list.innerHTML = '<li><span class="n">Scoreboard offline.</span></li>';
      });
  }

  function msg(text, cls) {
    var m = $('sbMsg');
    if (m) { m.textContent = text; m.className = cls || ''; }
  }

  function submit(score, shots, maxCombo, duration) {
    var input = $('sbName'), btn = $('sbSave');
    var name = (input.value || '').trim();
    if (!API) { msg('Online scoreboard is disabled in this build.', 'err'); return; }
    if (name.length < 3) { msg('Name needs at least 3 characters.', 'err'); input.focus(); return; }

    btn.disabled = true;
    msg('Saving…');
    store(NAME_KEY, name);

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name, score: score, shots: shots, maxCombo: maxCombo,
        duration: duration, version: 'v54'
      })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) { msg(res.d.error || 'Could not save.', 'err'); btn.disabled = false; return; }
        submittedThisSession = score;
        msg('Saved — rank #' + res.d.rank + '.', 'ok');
        $('sbForm').hidden = true;
        loadBoard(res.d.name);
      })
      .catch(function () { msg('Network error — try again.', 'err'); btn.disabled = false; });
  }

  /* ---- watch the overlay -------------------------------------------------- */
  // The game renders "N points · M scoring shots" into #overlayText and
  // "BEST SESSION x · MAX COMBO y" into #overlayFoot. Parse rather than reach
  // into game internals, so this survives version bumps.
  function parseInt_(s) { var n = parseInt(String(s).replace(/[^0-9]/g, ''), 10); return isFinite(n) ? n : 0; }

  function onSessionComplete() {
    var text = ($('overlayText') || {}).textContent || '';
    var foot = ($('overlayFoot') || {}).textContent || '';
    var score = parseInt_((text.split('points')[0] || ''));
    if (!score) return;

    var shots = parseInt_((text.split('·')[1] || ''));
    var maxCombo = parseInt_((foot.split('MAX COMBO')[1] || ''));
    var duration = sessionStart ? Math.round((Date.now() - sessionStart) / 1000) : 0;

    mount();
    wrap.hidden = false;

    var form = $('sbForm'), btn = $('sbSave'), input = $('sbName');
    if (submittedThisSession === score) {
      form.hidden = true;                       // replayed the overlay, already sent
    } else {
      form.hidden = false;
      btn.disabled = false;
      msg('');
      input.value = store(NAME_KEY) || '';
      btn.onclick = function () { submit(score, shots, maxCombo, duration); };
      input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
    }
    loadBoard(store(NAME_KEY));
  }

  function start() {
    var overlay = $('overlay'), tag = $('overlayTag');
    if (!overlay || !tag) return;

    // We mutate the overlay from inside this callback (inserting our own panel),
    // which the observer would see as another mutation — so latch on the
    // transition rather than reacting to every change.
    var wasComplete = false;
    new MutationObserver(function () {
      var complete = !overlay.hidden && /SESSION COMPLETE/i.test(tag.textContent || '');
      if (complete === wasComplete) return;
      wasComplete = complete;
      if (complete) {
        onSessionComplete();
      } else {
        wrap.hidden = true;
        // Overlay dismissed with something other than game-over → a run is starting.
        if (overlay.hidden) { sessionStart = Date.now(); submittedThisSession = null; }
      }
    }).observe(overlay, { attributes: true, childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
