/* Session milestones and DJ skill games. No network, media or wall-clock timers. */
(() => {
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const names={beat:'BEAT MATCH',crate:'CRATE DIG',headliner:'HEADLINER MIX'};
  const actions={beat:'LOCK',crate:'CHECK',headliner:'MIX'};
  const instructions={beat:'FLIPPERS JOG DECK B · LOCK THREE MATCHES',crate:'WATCH A / B · REPEAT WITH FLIPPERS · CHECK',headliner:'FOLLOW THE FADER · HOLD ON TARGET · MIX'};
  const patterns=[[0,1,0],[1,0,1,1],[0,0,1,0,1]];
  function create({notify=()=>{},fx=()=>{}}={}){
    let data;
    function reset(){data={needleWins:0,ramps:0,highestMult:1,queue:[],levels:{beat:0,crate:0,headliner:0},wins:{beat:0,crate:0,headliner:0}};}
    reset();
    function arm(kind){
      if(data.queue.includes(kind))return;
      data.queue.push(kind);notify(names[kind]+' READY','SHOOT LEFT RAMP WHEN BACK TO ONE BALL');fx('studioReady');
    }
    function note(event,value=0){
      if(event==='needle'){data.needleWins++;if(data.needleWins%3===0)arm('headliner');}
      if(event==='ramp'){data.ramps++;if(data.ramps%4===0)arm('beat');}
      if(event==='mult'&&value>data.highestMult){
        const old=data.highestMult;data.highestMult=value;
        if(old<3&&value>=3||old<5&&value>=5)arm('crate');
      }
    }
    function take(kind=data.queue[0]){
      const index=data.queue.indexOf(kind);if(index<0)return null;
      data.queue.splice(index,1);
      const level=data.levels[kind];
      const f={kind,level,time:0,intro:2,limit:kind==='crate'?42:25,stage:0,health:3,shotAt:-10,result:null,resultTime:0,feedback:'',feedbackUntil:0,
        offset:.34,drift:.13+level*.025,matches:0,fader:50,target:25,hold:0,watchUntil:0,sequence:[],entered:[],lastCue:-1};
      if(kind==='crate')newRound(f);fx('studioReady');return f;
    }
    function newRound(f){
      f.sequence=patterns[f.stage].map((v,i)=>(v+(f.level>0&&i%2===0?1:0)+(f.level===2?1:0))%2);
      f.entered=[];f.watchUntil=f.time+.5+f.sequence.length*.65;f.lastCue=-1;
    }
    function finish(f,won){f.result=won?'won':'lost';f.resultTime=0;fx(won?'studioWin':'cueMiss');}
    function miss(f,message){f.health--;f.feedback=message;f.feedbackUntil=f.time+1;fx('cueMiss');if(f.health<=0)finish(f,false);}
    function step(f,dt,input){
      if(f.result){f.resultTime+=dt;return f.resultTime>=1.1;}
      if(f.intro>0){f.intro=Math.max(0,f.intro-dt);return false;}
      f.time+=dt;
      const dir=(input.right?1:0)-(input.left?1:0);
      if(f.kind==='beat'){
        f.offset+=dt*(f.drift+dir*.75);f.offset=((f.offset+.5)%1+1)%1-.5;
      }else if(f.kind==='headliner'){
        f.fader=clamp(f.fader+dir*55*dt,0,100);
        f.target=[25,75,50][f.stage]+Math.sin(f.time*(.7+f.level*.12))*9;
        f.hold=Math.abs(f.fader-f.target)<=11?Math.min(1.2,f.hold+dt):Math.max(0,f.hold-dt*2);
      }else if(f.time<f.watchUntil){
        const index=Math.floor((f.time-(f.watchUntil-f.sequence.length*.65))/.65);
        if(index>=0&&index<f.sequence.length&&index!==f.lastCue){f.lastCue=index;fx('cratePad',f.sequence[index]);}
      }
      if(f.time>=f.limit)finish(f,false);
      return false;
    }
    function press(f,which){
      if(f.result||f.intro>0)return;
      if(f.kind==='crate'&&which!=='launch'){
        if(f.time<f.watchUntil||f.entered.length>=f.sequence.length)return;
        const value=which==='left'?0:1;f.entered.push(value);fx('cratePad',value);return;
      }
      if(which!=='launch'||f.time-f.shotAt<.35)return;
      f.shotAt=f.time;
      if(f.kind==='beat'){
        if(Math.abs(f.offset)<=.075){
          f.matches++;f.stage++;fx('beatLock');f.feedback='LOCKED '+f.matches+' / 3';f.feedbackUntil=f.time+.8;
          if(f.matches===3)finish(f,true);else{f.offset=f.stage===1?-.32:.38;f.drift*=-1;}
        }else miss(f,'OFF BEAT · JOG DECK B');
      }else if(f.kind==='headliner'){
        if(f.hold>=1&&Math.abs(f.fader-f.target)<=11){
          f.stage++;f.hold=0;fx('mixCut');f.feedback='TRANSITION '+f.stage+' / 3';f.feedbackUntil=f.time+.8;
          if(f.stage===3)finish(f,true);else f.target=[25,75,50][f.stage];
        }else miss(f,'HOLD THE GOLD ZONE UNTIL FULL');
      }else{
        if(f.time<f.watchUntil)return;
        if(f.entered.length<f.sequence.length){f.feedback='FINISH THE PATTERN FIRST';f.feedbackUntil=f.time+.8;return;}
        if(f.entered.every((v,i)=>v===f.sequence[i])){
          f.stage++;fx('beatLock');if(f.stage===3)finish(f,true);else newRound(f);
        }else{miss(f,'WRONG ORDER · WATCH AGAIN');if(!f.result)newRound(f);}
      }
    }
    function complete(f){
      // Game owns payout and return-to-table; milestones own only progression.
      if(f.completed)return;f.completed=true;
      if(f.result==='won'){data.wins[f.kind]++;data.levels[f.kind]=Math.min(2,data.levels[f.kind]+1);}
    }
    const snapshot=()=>JSON.parse(JSON.stringify(data));
    return {reset,note,take,step,press,complete,snapshot,get data(){return data;}};
  }
  function draw(g,f,reduced){
    const teal='#00d4c8',gold='#f0c040',coral='#ff5e6c',white='#e2e8f8';
    const text=(s,x,y,size=12,color=white)=>{g.fillStyle=color;g.textAlign='center';g.textBaseline='middle';g.font=size+'px "Share Tech Mono"';g.fillText(s,x,y);};
    const box=(x,y,w,h,color,stroke)=>{g.beginPath();g.roundRect(x,y,w,h,8);g.fillStyle=color;g.fill();if(stroke){g.strokeStyle=stroke;g.lineWidth=1.5;g.stroke();}};
    const line=(x,y,x2,y2,color,w=2)=>{g.beginPath();g.moveTo(x,y);g.lineTo(x2,y2);g.strokeStyle=color;g.lineWidth=w;g.stroke();};
    const disc=(x,y,r,color,angle)=>{g.save();g.translate(x,y);g.rotate(reduced?0:angle);g.beginPath();g.arc(0,0,r,0,Math.PI*2);g.fillStyle='#03080d';g.fill();for(let q=18;q<=r;q+=7){g.beginPath();g.arc(0,0,q,0,Math.PI*2);g.strokeStyle='#30434c';g.lineWidth=1;g.stroke();}g.beginPath();g.arc(0,0,17,0,Math.PI*2);g.fillStyle=color;g.fill();line(0,-r+8,12,-r+15,'#b3d3dc',2);g.restore();};
    g.save();box(58,196,404,552,'#050d16',teal);
    text(names[f.kind],260,232,25);text('LEVEL '+(f.level+1)+' · '+Math.ceil(f.limit-f.time)+'s · '+f.health+' TRIES',260,266,12,teal);
    for(let i=0;i<3;i++)box(224+i*26,285,18,5,i<f.stage?gold:'#283648');
    if(f.kind==='beat'){
      disc(160,373,51,teal,f.time*2);disc(355,373,51,coral,f.time*2+f.offset*6);
      text('MASTER',160,439,12,teal);text('DECK B · JOG',355,439,12,coral);
      box(83,465,354,148,'#101c28','#314350');
      box(237,475,46,128,'#00d4c822');
      for(let deck=0;deck<2;deck++){
        const y=500+deck*70,offset=deck?f.offset:0;
        line(96,y,424,y,'#405063',1);
        for(let i=-3;i<=3;i++){const x=260+(i+offset)*280;if(x>96&&x<424)line(x,y-19,x,y+19,deck?coral:teal,5);}
      }
      line(260,473,260,605,gold,1);
      text(Math.abs(f.offset)<=.075?'IN SYNC · LOCK NOW':'LINE UP THE TWO BEAT MARKERS',260,642,12,Math.abs(f.offset)<=.075?gold:white);
    }else if(f.kind==='crate'){
      const watching=f.time<f.watchUntil;
      const cuePhase=(f.time-(f.watchUntil-f.sequence.length*.65))/.65,shown=Math.floor(cuePhase);
      const cueOn=cuePhase-shown<.7;
      text(watching?'WATCH '+clamp(shown+1,0,f.sequence.length)+' / '+f.sequence.length+' · REMEMBER A / B':'YOUR TURN · TAP LEFT / RIGHT',260,330,13,gold);
      for(let i=0;i<2;i++){
        const x=100+i*174,lit=watching&&cueOn&&shown>=0&&shown<f.sequence.length&&f.sequence[shown]===i;
        box(x,365,146,163,lit?'#19444b':'#111c29',lit?gold:teal);
        disc(x+73,433,52,i?coral:teal,0);text(i?'B / RIGHT':'A / LEFT',x+73,508,14,lit?gold:white);
      }
      for(let i=0;i<f.sequence.length;i++){
        const x=260+(i-(f.sequence.length-1)/2)*49;
        box(x-20,560,40,44,'#0b1724',i<f.entered.length?teal:'#344554');
        text(watching?'·':f.entered[i]===undefined?'—':f.entered[i]?'B':'A',x,583,20,teal);
      }
      text(watching?'NO NEED TO PRESS YET':f.entered.length===f.sequence.length?'PATTERN READY · CHECK':'ENTER '+f.sequence.length+' RECORDS',260,642,12,white);
    }else{
      disc(151,402,62,teal,f.time*2);disc(369,402,62,coral,-f.time*2);
      text('DECK A',151,484,13,teal);text('DECK B',369,484,13,coral);
      box(89,516,342,85,'#0e1d29','#3c5360');
      const target=110+f.target*3,x=110+f.fader*3;
      box(target-33,530,66,51,'#f0c04022',gold);line(110,556,410,556,'#74969f',3);
      box(x-9,529,18,54,'#c3dae1',teal);line(x-5,555,x+5,555,'#08141d',2);
      box(109,614,302,11,'#203042');if(f.hold>0)box(110,615,300*Math.min(1,f.hold),9,teal);
      text(f.hold>=1?'BLEND READY · MIX NOW':'FOLLOW THE GOLD ZONE · BUILD THE BLEND',260,651,11,f.hold>=1?gold:white);
    }
    text(instructions[f.kind],260,698,10,teal);text('SPACE / '+actions[f.kind]+' · '+(f.kind==='headliner'?'JACKPOT + MULTIBALL':'BUILD YOUR JACKPOT'),260,723,10,gold);
    if(f.feedbackUntil>f.time&&!f.result)text(f.feedback,260,674,11,coral);
    if(f.intro>0){box(79,460,362,110,'#071320f5',gold);text('GET READY',260,481,18,gold);text(f.kind==='beat'?'HOLD FLIPPERS TO ALIGN BEATS':f.kind==='crate'?'REMEMBER A / B · THEN TAP IT BACK':'HOLD FLIPPERS TO MOVE THE FADER',260,514,12);text('THEN PRESS '+actions[f.kind],260,546,13,teal);}
    if(f.result){box(79,449,362,128,'#071320f5',f.result==='won'?gold:coral);text(f.result==='won'?'SESSION COMPLETE':'BACK TO THE TABLE',260,487,20,f.result==='won'?gold:coral);text(f.result==='won'?'YOUR NEXT JACKPOT JUST GOT BIGGER':'BALL SAFE · NEW CHALLENGES AHEAD',260,538,11);}
    g.restore();
  }
  window.GroovelineSessions={create,draw,names,actions,instructions};
})();
