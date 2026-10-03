/* Full-viewport bonus transition. Pinball owns score and the safely held ball. */
(() => {
  'use strict';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let session=null;
  function cancel(){
    if(!session)return;
    const s=session,restoreFocus=document.hasFocus();session=null;s.api?.dispose();s.shell.remove();
    for(const [el,inert] of s.inert)el.inert=inert;
    document.body.classList.remove('nexbreak-active');
    // Removing a focused child iframe can send keys to the outer website. Body
    // focus is a no-op; return to a concrete game target that also accepts Space.
    if(restoreFocus){
      const target=document.getElementById('game')||s.focus;
      if(target?.isConnected&&!target.closest('[inert]')){
        if(!target.hasAttribute('tabindex'))target.tabIndex=-1;
        window.focus();target.focus({preventScroll:true});
      }
    }
  }
  function message(title,copy){if(!session)return;session.title.textContent=title;session.copy.textContent=copy;}
  function phase(name){const s=session;if(!s)return;s.phase=name;s.time=0;s.shell.dataset.phase=name;}
  function open(options){
    cancel();
    const focus=document.activeElement;
    const shell=document.createElement('section');shell.className='nexbreak-stage';shell.tabIndex=-1;shell.setAttribute('role','dialog');shell.setAttribute('aria-modal','true');shell.setAttribute('aria-label','Grooveline presents Nexbreak');
    shell.innerHTML=`<iframe title="Nexbreak bonus playfield" tabindex="0"></iframe><div class="nb-transition"><span>GROOVELINE PRESENTS</span><h2>NEXBREAK</h2><p>Opening the secret DJ stage…</p><div class="nb-transition-grooves" aria-hidden="true"></div></div><div class="nb-stage-controls"><button type="button" class="nb-pause">PAUSE</button><button type="button" class="nb-return">RETURN TO PINBALL ↗</button></div>`;
    const inert=[...document.body.children].filter(el=>!['SCRIPT','STYLE','LINK'].includes(el.tagName)).map(el=>[el,el.inert]);
    for(const [el] of inert)el.inert=true;
    const s=session={shell,frame:shell.querySelector('iframe'),title:shell.querySelector('h2'),copy:shell.querySelector('p'),options,inert,focus,phase:'loading',time:0,paused:false,api:null,result:null};
    document.body.append(shell);document.body.classList.add('nexbreak-active');phase('loading');
    shell.focus({preventScroll:true});
    s.shell.querySelector('.nb-pause').onclick=()=>setPaused(!s.paused);
    s.shell.querySelector('.nb-return').onclick=()=>finish(s.api?.result?.()||{points:0,reason:'returned',failed:true});
    s.frame.src='assets/nexbreak-v53.html';
  }
  function ready(child,api){
    const s=session;if(s?.api===api)return;
    if(!s||s.phase!=='loading'||s.frame.contentWindow!==child||s.api){api.dispose();return;}
    s.api=api;
    api.prepare({encore:s.options.encore,fx:s.options.fx,sample:s.options.sample,done:result=>{if(session===s)finish(result);},pause:()=>{if(session===s)setPaused(!s.paused);},blur:pauseIfUnfocused});
    phase('entering');message('NEXBREAK',s.options.encore?'ENCORE SET · ALL FOUR DJ CHALLENGES CLEARED':'ACCESS EARNED · YOUR PINBALL IS SAFE');
    if(s.paused)message('INTERMISSION','Your set is paused. Press P or RESUME.');
    else s.frame.contentWindow.focus();
  }
  function setPaused(value){
    const s=session;if(!s)return;
    s.paused=!!value;s.shell.classList.toggle('nb-paused',s.paused);
    s.shell.querySelector('.nb-pause').textContent=s.paused?'RESUME':'PAUSE';
    s.api?.setRunning(!s.paused&&s.phase==='playing');
    if(s.paused)message('INTERMISSION','Your set is paused. Press P or RESUME.');
    else if(s.phase==='playing'){message('NEXBREAK','');s.frame.contentWindow.focus();}
    else if(s.phase==='result')showResult();
    else if(s.phase==='entering')message('NEXBREAK','GROOVELINE SECRET DJ STAGE');
    else if(s.phase==='loading')message('NEXBREAK','Opening the secret DJ stage…');
  }
  function showResult(){const s=session;message(s.result?.failed?'STAGE UNAVAILABLE':s.result?.reason==='cleared'?'SET CLEARED':'SET COMPLETE',s.result?.failed?'Your ball is safe. Try the next left-ramp lock.':'+'+(s.result?.points||0).toLocaleString()+' PINBALL POINTS · BALL SAFE');}
  function finish(result){
    const s=session;if(!s||['result','leaving','returning'].includes(s.phase))return;
    s.api?.setRunning(false);s.paused=false;s.shell.classList.remove('nb-paused');
    s.result=result;s.shell.querySelector('.nb-pause').textContent='PAUSE';phase('result');showResult();
  }
  function tick(dt){
    const s=session;if(!s||s.paused)return;
    s.time+=Math.min(dt,.1);
    if(s.phase==='loading'&&s.time>=10){finish({points:0,failed:true});return;}
    if(s.phase==='entering'&&s.time>=(reduced?.2:2.4)){phase('countdown');}
    if(s.phase==='countdown'){
      message(String(Math.max(1,3-Math.floor(s.time))),'MOVE: ← → / Z M / DRAG · SPACE: BASS BLAST');
      if(s.time>=3){phase('playing');s.api?.setRunning(true);s.frame.contentWindow.focus();}
    }else if(s.phase==='result'&&s.time>=2.4){phase('leaving');}
    else if(s.phase==='leaving'&&s.time>=(reduced?.2:2.2)){phase('returning');}
    else if(s.phase==='returning'){
      message('BACK IN '+Math.max(1,3-Math.floor(s.time)),'YOUR BALL IS LOCKED · LAUNCH WHEN READY');
      if(s.time>=3){const result=s.result,done=s.options.done;cancel();done(result);}
    }
  }
  window.addEventListener('keydown',e=>{
    const s=session;if(!s)return;
    // The active modal owns shortcuts, including R, which otherwise opens the
    // inert radio panel. Preserve native keyboard activation of its buttons.
    e.stopImmediatePropagation();
    if(e.code==='Tab')return;
    if(e.code==='Space'&&e.target.tagName==='BUTTON')return;
    if(e.code==='KeyP'||e.code==='Escape'){e.preventDefault();if(!e.repeat)setPaused(!s.paused);return;}
    s.api?.key(e.code,true);if(['Space','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  },true);
  window.addEventListener('keyup',e=>{if(session){e.stopImmediatePropagation();session.api?.key(e.code,false);}},true);
  function pauseIfUnfocused(){
    const s=session;
    // Let the browser finish moving focus. Moving between stage controls and
    // its iframe is valid; leaving the entire game must pause the running set.
    setTimeout(()=>{if(s&&session===s&&!document.hasFocus())setPaused(true);},0);
  }
  window.addEventListener('blur',pauseIfUnfocused);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)setPaused(true);});
  window.GroovelineNexbreak={open,ready,cancel,tick,setPaused,togglePause:()=>setPaused(!session?.paused),snapshot:()=>session?{phase:session.phase,paused:session.paused,time:session.time,result:session.result}:null};
})();
