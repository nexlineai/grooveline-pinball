/* Original synthesized cabinet sounds. No samples, downloads or radio routing. */
(() => {
  'use strict';
  class CabinetBus {
    constructor(ctx, destination, volume) {
      this.ctx = ctx; this.voices = 0; this.last = new Map();
      this.input = ctx.createGain();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -12; compressor.knee.value = 8;
      compressor.ratio.value = 8; compressor.attack.value = .003; compressor.release.value = .12;
      this.master = ctx.createGain(); this.master.gain.value = volume * 2.4;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20;
      limiter.attack.value = .001; limiter.release.value = .08;
      // Soft output saturation catches peaks that outrun the compressor's attack.
      const safety = ctx.createWaveShaper();
      safety.curve = Float32Array.from({length:4097},(_,i)=>{
        const x=i/2048-1,a=Math.abs(x);
        return Math.sign(x)*(a<=.7?a:.7+.25*(1-Math.exp(-(a-.7)/.25)));
      });
      safety.oversample = '2x';
      this.input.connect(compressor); compressor.connect(this.master); this.master.connect(limiter); limiter.connect(safety); safety.connect(destination);
      const verb = ctx.createConvolver(), wet = ctx.createGain(); wet.gain.value = .13;
      const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * .48), ctx.sampleRate);
      let seed = 1337;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
      for (let c = 0; c < 2; c++) {
        const data = impulse.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] = random() * Math.pow(1 - i / data.length, 3);
      }
      verb.buffer = impulse; this.input.connect(verb); verb.connect(wet); wet.connect(compressor);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = random();
    }
    voice({freq=440, end=freq, duration=.12, gain=.2, type='sine', delay=0, pan=0, noise=false, cutoff=1800,cutoffEnd=cutoff,resonance=.7,filterType='lowpass'}) {
      if (this.voices >= 64) return;
      const ctx = this.ctx, t = ctx.currentTime + delay;
      const source = noise ? ctx.createBufferSource() : ctx.createOscillator();
      if (noise) source.buffer = this.noise;
      else { source.type = type; source.frequency.setValueAtTime(freq, t); source.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration); }
      const filter = ctx.createBiquadFilter(); filter.type = filterType; filter.Q.value = resonance;
      filter.frequency.setValueAtTime(cutoff,t); filter.frequency.exponentialRampToValueAtTime(Math.max(30,cutoffEnd),t+duration);
      const envelope = ctx.createGain(), stereo = ctx.createStereoPanner(); stereo.pan.value = Math.max(-.75, Math.min(.75, pan));
      envelope.gain.setValueAtTime(.0001, t); envelope.gain.exponentialRampToValueAtTime(Math.max(.0001,gain), t + .004);
      envelope.gain.exponentialRampToValueAtTime(.0001, t + duration);
      source.connect(filter); filter.connect(envelope); envelope.connect(stereo); stereo.connect(this.input);
      this.voices++; source.start(t); source.stop(t + duration + .02);
      source.onended = () => { this.voices--; source.disconnect(); filter.disconnect(); envelope.disconnect(); stereo.disconnect(); };
    }
    fx(kind, value=0, pan=0, delay=0) {
      const now = this.ctx.currentTime + delay, spacing = kind === 'rail' ? .05 : kind === 'bumper' ? .035 : 0;
      const key=kind==='bumper'?'bumper:'+value:kind;
      if (spacing > 0 && now - (this.last.get(key) ?? -100) < spacing) return;
      this.last.set(key, now);
      // Short 132 BPM drum-machine / acid motifs, not a competing music loop.
      const sixteenth=60/132/4;
      const voice=options=>this.voice({pan,...options,delay:delay+(options.delay||0)});
      const kick=(offset=0,gain=.65)=>{voice({freq:165,end:43,duration:.22,gain,delay:offset});voice({noise:true,filterType:'highpass',cutoff:4200,duration:.015,gain:.11,delay:offset});};
      const hat=(offset=0,open=false)=>voice({noise:true,filterType:'highpass',cutoff:6500,duration:open?.13:.035,gain:open?.13:.18,delay:offset});
      const clap=(offset=0)=>[0,.012,.025].forEach((t,i)=>voice({noise:true,filterType:'bandpass',cutoff:1450,resonance:1.2,duration:i===2?.14:.025,gain:.22,delay:offset+t}));
      const acid=(freq,offset=0,accent=false)=>voice({freq,end:freq,duration:accent?.23:.13,gain:accent?.24:.17,type:'sawtooth',cutoff:accent?3100:1400,cutoffEnd:160,resonance:7,delay:offset});
      const tone=(freq,duration=.15,type='sine',gain=.2,offset=0,end=freq)=>voice({freq,end,duration,type,gain,delay:offset,cutoff:7000});
      const bell=(root,offset=0)=>[1,2.76,5.4].forEach((ratio,i)=>tone(root*ratio,.36-i*.09,'sine',.22/(i+1),offset));
      // Separate timbres and rhythms per mechanism, not a shared melody.
      if(kind==='flip'){tone(95,.055,'triangle',.3,0,38);voice({noise:true,filterType:'highpass',cutoff:2800,duration:.018,gain:.1});}
      if(kind==='rail')voice({noise:true,filterType:'bandpass',cutoff:2200,duration:.025,gain:.08});
      if(kind==='sling'){voice({noise:true,filterType:'bandpass',cutoff:900,cutoffEnd:2800,duration:.065,gain:.28});tone(value>0?240:180,.08,'triangle',.23,0,70);}
      if(kind==='bumper'){
        if(value===0)kick(0,.65);
        else if(value===1){clap();tone(190,.09,'triangle',.22,0,95);}
        else bell(280);
      }
      if(kind==='target'){const f=[392,493.88,587.33][Math.abs(value|0)%3];tone(f,.12,'square',.12);tone(f*2,.08,'sine',.09,.045);}
      if(kind==='lane')bell([660,784,988][Math.abs(value|0)%3]);
      if(kind==='spinner'){[0,.045,.09].forEach((t,i)=>{hat(t);tone(1400-i*240,.035,'square',.055,t);});}
      if(kind==='vault')tone(880,.055,'sine',.1,0,660);
      if(kind==='launch'){voice({noise:true,filterType:'bandpass',cutoff:180,cutoffEnd:3800,duration:.3,gain:.2});tone(65,.32,'triangle',.25,0,520);}
      if(kind==='ramp'){[330,660,1320].forEach((f,i)=>bell(f,i*.09));}
      if(kind==='vaultRamp'){[110,146.83,220].forEach((f,i)=>acid(f,i*.09,i===2));}
      if(kind==='drain'){tone(220,.32,'triangle',.25,0,55);tone(146.83,.3,'sine',.2,.09,36.7);}
      if(kind==='lock'){tone(220,.08,'square',.16);tone(440,.15,'square',.12,.16);}
      if(kind==='capture'){bell(440);bell(660,.24);tone(55,.35,'sine',.22);}
      if(kind==='vaultstart'){tone(330,.1,'square',.15);tone(660,.18,'triangle',.25,.12);kick(.12,.4);}
      if(kind==='release'){[880,660,440,220].forEach((f,i)=>tone(f,.13,'triangle',.22,i*.085));clap(.28);}
      if(kind==='bonus'||kind==='skill'){[523,659,784,1047].forEach((f,i)=>bell(f,i*.09));}
      if(kind==='mix'){clap();clap(.17);tone(440,.22,'square',.12,.23);tone(660,.22,'square',.09,.23);}
      if(kind==='orbit'){tone(170,.35,'sine',.24,0,1250);tone(170,.25,'sine',.1,.12,900);}
      if(kind==='drop'){kick();kick(.23);acid(55,.34,true);clap(.45);}
      if(kind==='multiball'){[0,.12,.24,.48].forEach(t=>kick(t,.55));clap(.36);hat(.6,true);}
      if(kind==='jackpot'){[293.66,369.99,440].forEach(f=>tone(f,.5,'triangle',.15));bell(1175,.18);}
      if(kind==='super'){[196,293.66,392].forEach((f,i)=>{tone(f,.65,'sawtooth',.09,i*.08);bell(f*4,.35+i*.09);});kick(.55,.6);}
      // Needle Drop: cue-ready acid pickup, clean-groove hat, cartridge contact,
      // a short slip/scratch and a beat-matched mix payoff.
      if(kind==='studioReady'){tone(220,.1,'square',.1);tone(330,.1,'triangle',.14,.12);tone(660,.16,'sine',.16,.24);}
      if(kind==='beatLock'){kick(0,.4);hat(.1);tone(990,.09,'sine',.16,.12);}
      if(kind==='cratePad'){tone(value?440:261.63,.16,'triangle',.22);tone(value?880:523.26,.1,'sine',.1,.04);}
      if(kind==='mixCut'){clap();acid(146.83,.11,true);hat(.24,true);}
      if(kind==='studioWin'){kick();[110,165,220,330].forEach((f,i)=>acid(f,i*.11,i===3));clap(.44);bell(880,.55);}
      if(kind==='cueReady'){acid(110);acid(165,sixteenth,true);hat(sixteenth*2);}
      if(kind==='cueGate'){hat();tone(880,.07,'sine',.13,.035);}
      if(kind==='needle'){voice({noise:true,filterType:'bandpass',cutoff:2400,cutoffEnd:700,duration:.035,gain:.18});tone(95,.06,'triangle',.13,0,52);}
      if(kind==='cueMiss'){voice({noise:true,filterType:'bandpass',cutoff:550,cutoffEnd:2600,resonance:3,duration:.11,gain:.2});tone(170,.11,'sawtooth',.08,0,70);}
      if(kind==='cueSuccess'){kick();hat(sixteenth);acid(110,sixteenth*2,true);clap(sixteenth*3);acid(220,sixteenth*4);hat(sixteenth*5,true);}
      if(kind==='flight'){tone(55,.7,'sawtooth',.13,0,110);bell(880,.35);}
      if(kind==='laser'){tone(1800,.14,'sawtooth',.15,0,180);voice({noise:true,filterType:'highpass',cutoff:5000,duration:.04,gain:.08});}
    }
  }
  window.GroovelineSound = {
    create(initialVolume=.35) {
      let ctx, bus, enabled=false, volume=initialVolume;
      const update = () => {
        if(bus) bus.master.gain.setTargetAtTime(enabled?volume*2.4:0,ctx.currentTime,.025);
        const button=document.getElementById('soundBtn');
        button.setAttribute('aria-pressed',String(enabled)); button.setAttribute('aria-label',enabled?'Mute game effects':'Enable game effects'); button.style.color=enabled?'#00d4c8':'';
      };
      const init = () => { if(ctx)return;try{ctx=new(window.AudioContext||window.webkitAudioContext)();bus=new CabinetBus(ctx,ctx.destination,enabled?volume:0);}catch{ctx=null;bus=null;} };
      const resume = () => { if(enabled){init();ctx?.resume().catch(()=>{});} };
      const api={tick(){},toggle(){enabled=!enabled;resume();update();return enabled;},enable(){enabled=true;resume();update();},resume,pause(){ctx?.suspend().catch(()=>{});},fx(kind,value=0,pan=0){if(enabled&&bus)bus.fx(kind,value,pan);}};
      window.addEventListener('grooveline-fx-volume',e=>{volume=e.detail;enabled=volume>0;resume();update();});
      if(new URLSearchParams(location.search).has('debug'))api.snapshot=()=>({enabled,volume,context:ctx?.state||'uninitialized',voices:bus?.voices||0});
      return api;
    }
  };
  if(new URLSearchParams(location.search).has('debug')) window.GroovelineSound.preview = async (volume=.35,stress=false) => {
    const ctx=new OfflineAudioContext(2,48000*6,48000),bus=new CabinetBus(ctx,ctx.destination,volume);
    if(stress){bus.fx('super',0,0);bus.fx('multiball',0,0);bus.fx('ramp',0,0);}
    ['flip','bumper','target','ramp','lock','multiball','jackpot','super'].forEach((kind,i)=>bus.fx(kind,i%3,i%2?.5:-.5,i*.62));
    const buffer=await ctx.startRendering();let peak=0,sum=0;
    const pcm=new Int16Array(buffer.length*2);
    for(let i=0;i<buffer.length;i++)for(let c=0;c<2;c++){const v=buffer.getChannelData(c)[i];peak=Math.max(peak,Math.abs(v));sum+=v*v;pcm[i*2+c]=Math.round(Math.max(-1,Math.min(1,v))*32767);}
    let binary='';const bytes=new Uint8Array(pcm.buffer);for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return {peak,rms:Math.sqrt(sum/(buffer.length*2)),pcm:btoa(binary),rate:buffer.sampleRate};
  };
})();
