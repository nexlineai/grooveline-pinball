/* Optional motion controls. No permission request until the player opts in. */
(() => {
  'use strict';
  const button=document.getElementById('motionBtn'),fallback=document.getElementById('nudgeFallback');
  let enabled=false,busy=false,previous=null,lastShake=-Infinity,pulses=0,lastPulse=-Infinity;
  function status(text){button.textContent=text;button.setAttribute('aria-pressed',String(enabled));}
  function reset(){previous=null;pulses=0;lastPulse=-Infinity;}
  button.addEventListener('click',async()=>{
    if(busy)return;
    if(enabled){enabled=false;reset();status('SHAKE');return;}
    busy=true;
    try{
      if(!window.isSecureContext||!window.DeviceMotionEvent)throw Error('unavailable');
      if(typeof DeviceMotionEvent.requestPermission==='function'){
        const permission=await DeviceMotionEvent.requestPermission();
        if(permission!=='granted')throw Error('denied');
      }
      enabled=true;reset();status('SHAKE ✓');
      button.title='Shake controls enabled. Gentle double shake to nudge; tap here to disable. Nudge button remains available.';
    }catch{
      enabled=false;status('NO SHAKE');button.title='Motion unavailable or permission denied. Use the ↕ nudge button.';
    }finally{busy=false;}
  });
  window.addEventListener('devicemotion',event=>{
    if(!enabled||document.hidden||!window.GroovelineGame?.isPlaying()){reset();return;}
    const a=event.acceleration,g=event.accelerationIncludingGravity;
    const valid=v=>v&&[v.x,v.y,v.z].every(n=>typeof n==='number'&&Number.isFinite(n));
    let magnitude=0;
    if(valid(a))magnitude=Math.hypot(a.x,a.y,a.z);
    else if(valid(g)){if(previous)magnitude=Math.hypot(g.x-previous.x,g.y-previous.y,g.z-previous.z);previous={x:g.x,y:g.y,z:g.z};}
    else return;
    const now=performance.now();
    if(now-lastShake<1000||magnitude<12)return;
    pulses=now-lastPulse<250?pulses+1:1;lastPulse=now;
    if(pulses>=2){pulses=0;lastShake=now;window.GroovelineGame.nudge();}
  });
  window.addEventListener('blur',reset);document.addEventListener('visibilitychange',reset);
  // Never remove the fallback: some iframe/browser combinations grant permission
  // but do not deliver motion events.
  fallback.title='Nudge table (N). Also available when shake is unsupported.';
})();
