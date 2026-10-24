/* RULES ENGINE (pure data, JSON-serialisable) =====================
   The board comes from a validated map (see maps.mjs): S.w x S.h tiles, S.home, S.vor, S.goal. */
import { DEFAULT_MAP } from './maps.mjs';
const SH=0,FI=1,NM=['Shark','Fish'];
const key=(x,y)=>x+','+y,eq=(a,b)=>a[0]==b[0]&&a[1]==b[1],inb=(S,x,y)=>x>=0&&y>=0&&x<S.w&&y<S.h;
/* HEX GRID (pointy-top, 'odd-r' offset: odd rows sit half a tile to the right). Every tile has 6 neighbours.
   Order is the same on every row: East, West, North-East, North-West, South-East, South-West. */
const nb=(x,y)=>(y&1)?[[x+1,y],[x-1,y],[x+1,y-1],[x,y-1],[x+1,y+1],[x,y+1]]:[[x+1,y],[x-1,y],[x,y-1],[x-1,y-1],[x,y+1],[x-1,y+1]];
const CARDS={move2:['+2 Move','move','Add 2 to your next roll'],move3:['+3 Move','move','Add 3 to your next roll'],
dash2:['Dash 2','dash','Move up to 2 tiles'],dash3:['Dash 3','dash','Move up to 3 tiles'],dash4:['Dash 4','dash','Move up to 4 tiles'],
freeze:['Freeze','freeze','Opponent cannot roll next turn'],lock:['Lock','lock','Opponent cannot play cards next turn'],teleport:['Teleport','tp','Jump to any empty tile'],
oil:['Oil Spill','ev','DISASTER: nobody draws'],algae:['Algae Bloom','ev','DISASTER: rolls -1'],micro:['Microplastics','ev','DISASTER: abilities off'],dead:['Dead Zone','ev','DISASTER: everyone moves 3'],
warm:['Warm Current','ev','BLESSING: +1 move. You: move 3'],kelp:['Kelp Forest','ev','BLESSING: dash 3, adrenaline cd 4. You: move 4'],nutri:['Nutrient Upwelling','ev','BLESSING: cooldowns -1. You: next ability free'],larval:['Larval Surge','ev','BLESSING: draw 2/turn. You: draw 3 now']};
const COUNT={move2:3,move3:2,dash2:3,dash3:3,dash4:2,freeze:4,lock:3,teleport:4,oil:1,algae:1,micro:1,dead:1,warm:1,kelp:1,nutri:1,larval:1};
const EV={oil:'d',algae:'d',micro:'d',dead:'d',warm:'b',kelp:'b',nutri:'b',larval:'b'};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
const ev=(S,i)=>S.ev.some(e=>e.id==i),anyD=S=>S.ev.some(e=>EV[e.id]=='d'),L=(S,m)=>{S.log.push(m);S.log=S.log.slice(-30)};
const can=(S,r,x,y)=>{if(!inb(S,x,y))return false;const t=S.t[y*S.w+x];return t==0||(t==2&&r==FI)};
const plAt=(S,x,y)=>S.pl.findIndex(p=>p&&p[0]==x&&p[1]==y);
const endOk=(S,r,x,y)=>!(r==SH&&plAt(S,x,y)>=0)&&!(r==FI&&eq([x,y],S.pos[SH]));
function reach(S,r,s,n){const d=new Map([[key(...s),0]]),q=[s];for(let i=0;i<q.length;i++){const c=q[i],k=d.get(key(...c));if(k>=n)continue;for(const[x,y]of nb(c[0],c[1])){if(d.has(key(x,y))||!can(S,r,x,y))continue;d.set(key(x,y),k+1);q.push([x,y])}}return q}
function pendOpts(S){const p=S.pend[0];if(!p)return[];const r=p.who,o=[];
 if(p.type=='tele'){for(let y=0;y<S.h;y++)for(let x=0;x<S.w;x++)if(can(S,r,x,y)&&!eq([x,y],S.pos[0])&&!eq([x,y],S.pos[1])&&endOk(S,r,x,y))o.push([x,y]);return o}
 return reach(S,r,S.pos[r],p.n).filter(c=>endOk(S,r,...c))}
const dashLen=S=>ev(S,'kelp')?3:2;
function dashOpts(S){const o=[];for(let d=0;d<6;d++){let[x,y]=S.pos[0];for(let i=0;i<dashLen(S);i++){[x,y]=nb(x,y)[d];if(!can(S,0,x,y))break;if(endOk(S,0,x,y))o.push([x,y])}}return o}
function sealOpts(S){const o=[],[sx,sy]=S.pos[0];for(const[x,y]of nb(sx,sy))if(inb(S,x,y)&&S.t[y*S.w+x]==2&&!eq([x,y],S.pos[1]))o.push([x,y]);return o}
const cdFor=(S,r)=>Math.max(0,(r?(ev(S,'kelp')?4:5):2)-(ev(S,'nutri')?1:0));
const useAb=(S,r)=>{if(S.free[r]){S.free[r]=0;S.cd[r]=0}else S.cd[r]=cdFor(S,r)+1};
const fin=(S,w,m)=>{S.win=w;S.pend=[];L(S,m)};
function settle(S,r,vort=true){
 if(vort&&!anyD(S)&&S.vor.some(v=>eq(v,S.pos[r]))){const o=S.vor.filter(v=>!eq(v,S.pos[r])&&!eq(v,S.pos[1-r]));if(o.length){S.pos[r]=o[Math.random()*o.length|0];L(S,NM[r]+' rides a vortex')}}
 if(r==FI){const i=plAt(S,...S.pos[1]);if(S.carry<0&&i>=0){S.carry=i;S.pl[i]=null;L(S,'Fish grabs plankton')}
  if(S.carry>=0&&S.home.some(h=>eq(h,S.pos[1]))){S.carry=-1;S.done++;L(S,'Delivered '+S.done+'/'+S.goal);if(S.done>=S.goal)return fin(S,1,'The Fish delivered all the plankton!')}}
 if(eq(S.pos[0],S.pos[1])){if(!ev(S,'micro')&&S.cd[1]<=0){useAb(S,1);L(S,'ADRENALINE RUSH! Fish escapes');S.pend.unshift({type:'path',who:1,n:5,src:'adr'})}else fin(S,0,'The Shark ate the Fish!')}}
function applyEv(S,id,p){const d=3+(Math.random()*6|0),e=S.ev.find(e=>e.id==id);e?e.left=d:S.ev.push({id,left:d});L(S,NM[p]+' draws '+CARDS[id][0]+' ('+d+' turns)');
 if(id=='warm')S.pend.push({type:'path',who:p,n:3,src:'ev'});if(id=='kelp')S.pend.push({type:'path',who:p,n:4,src:'ev'});if(id=='nutri')S.free[p]=1;if(id=='larval')draw(S,p,3)}
function draw(S,p,n){if(ev(S,'oil')){L(S,'Oil Spill: no drawing');return}
 for(let i=0;i<n;i++){if(!S.deck.length){S.deck=shuffle(S.disc);S.disc=[]}const c=S.deck.pop();if(!c)break;EV[c]?applyEv(S,c,p):S.hand[p].push(c)}}
function begin(S){const p=S.turn;if(S.cd[p]>0)S.cd[p]--;Object.assign(S,{played:[],rolled:0,moved:0,sealed:0,bonus:0,budget:0});draw(S,p,ev(S,'larval')?2:1)}
function endT(S){S.fz[S.turn]=0;S.lk[S.turn]=0;S.ev=S.ev.filter(e=>{if(--e.left>0)return true;S.disc.push(e.id);L(S,CARDS[e.id][0]+' ended');return false});S.turn^=1;if(!S.turn)S.round++;begin(S)}
function newGame(map=DEFAULT_MAP){
 const deck=[];for(const c in COUNT)for(let i=0;i<COUNT[c];i++)deck.push(c);shuffle(deck);
 const S={name:map.name,w:map.w,h:map.h,t:map.t.slice(),home:map.home.map(p=>p.slice()),vor:map.vortex.map(p=>p.slice()),goal:map.plankton.length,
  pos:[map.shark.slice(),map.fish.slice()],pl:map.plankton.map(p=>p.slice()),carry:-1,done:0,hand:[[],[]],deck,disc:[],ev:[],turn:0,round:1,win:-1,cd:[0,0],free:[0,0],fz:[0,0],lk:[0,0],played:[],rolled:0,moved:0,sealed:0,bonus:0,budget:0,roll:0,pend:[],log:['Game start: '+map.name],ver:0},aside=[];
 for(const p of[0,1])while(S.hand[p].length<3){const c=deck.pop();EV[c]?aside.push(c):S.hand[p].push(c)}
 deck.push(...aside);shuffle(deck);begin(S);return S}
/* returns '' on success or an error string. Mutates S. */
function act(S,r,a){
 if(S.win>=0)return 'Game over';const who=S.pend[0]?S.pend[0].who:S.turn;if(r!=who)return 'Not your turn';const free=!S.pend.length;
 switch(a.t){
 case 'pick':{if(free)return 'Nothing to pick';const p=S.pend[0];if(!pendOpts(S).some(c=>eq(c,a.p)))return 'Pick a glowing tile';S.pend.shift();S.pos[r]=a.p;if(p.src=='mv')S.moved=1;settle(S,r,p.type!='tele');break}
 case 'roll':{if(!free)return 'Finish your move first';if(S.rolled)return 'Already rolled';if(S.fz[r])return 'Frozen: you cannot roll this turn';S.rolled=1;
  const dead=ev(S,'dead'),d=dead?0:1+(Math.random()*6|0);S.roll=d;let b=d+S.bonus+(r==1&&S.carry<0?1:0)+(ev(S,'warm')?1:0)-(ev(S,'algae')?1:0);if(dead)b=3;S.budget=Math.max(0,b);
  L(S,NM[r]+(dead?' moves 3 (Dead Zone)':' rolls '+d+' = '+S.budget+' tiles'));S.pend.push({type:'path',who:r,n:S.budget,src:'mv'});break}
 case 'card':{const id=a.id,Ty=CARDS[id]&&CARDS[id][1],o=1-r;if(!free)return 'Finish your move first';if(S.lk[r])return 'Locked: no cards this turn';if(!S.hand[r].includes(id))return 'You do not hold that card';
  if(S.played.includes(Ty))return 'One '+Ty+' card per turn';if(Ty=='move'&&S.rolled)return 'Play before rolling';
  if(Ty=='freeze'||Ty=='lock'){if(S.fz[o]||S.lk[o]||S.played.includes('freeze')||S.played.includes('lock'))return 'Opponent already restricted'}
  S.hand[r].splice(S.hand[r].indexOf(id),1);S.disc.push(id);S.played.push(Ty);L(S,NM[r]+' plays '+CARDS[id][0]);
  if(Ty=='move')S.bonus+=+id[4];else if(Ty=='dash')S.pend.push({type:'path',who:r,n:+id[4],src:'card'});else if(id=='freeze')S.fz[o]=1;else if(id=='lock')S.lk[o]=1;else S.pend.push({type:'tele',who:r,src:'card'});break}
 case 'dash':{if(r)return 'Only the Shark dashes';if(!free)return 'Finish your move first';if(ev(S,'micro'))return 'Abilities disabled';if(S.cd[0]>0)return 'Dash cooldown: '+S.cd[0];
  if(!dashOpts(S).some(c=>eq(c,a.p)))return 'Straight line, up to '+dashLen(S);S.pos[0]=a.p;useAb(S,0);L(S,'Shark dashes');settle(S,0);break}
 case 'seal':{if(r||!free||S.sealed)return 'Cannot seal now';if(!sealOpts(S).some(c=>eq(c,a.p)))return 'Stand next to a crevice';S.t[a.p[1]*S.w+a.p[0]]=3;S.sealed=1;L(S,'Shark sealed a crevice');break}
 case 'end':{if(!free)return 'Finish your move first';if(!S.rolled&&!S.fz[r])return 'Roll first';endT(S);break}
 default:return 'Unknown action'}
 while(S.pend.length&&!pendOpts(S).length){if(S.pend.shift().src=='mv')S.moved=1}
 return ''}


export{newGame,act,NM,pendOpts,dashOpts,sealOpts};
