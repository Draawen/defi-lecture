/** Pure shared domain logic (browser + API): calendar days, Paris midnight, streaks, validation. */
export const CONFIG = Object.freeze({startDate:'2026-09-27',endDate:'2026-12-25',timeZone:'Europe/Paris',collectiveGoal:3000,personalGoals:[100,300,500]});
const DAY=86400000;
export function parisParts(value=new Date()) {
  const out={};
  for(const p of new Intl.DateTimeFormat('en-GB',{timeZone:CONFIG.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value))) if(p.type!=='literal')out[p.type]=p.value;
  return out;
}
export function parisDate(value=new Date()){const p=parisParts(value);return `${p.year}-${p.month}-${p.day}`;}
export function dayDiff(a,b){return Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/DAY);}
export function shiftDay(s,n){return new Date(Date.parse(`${s}T00:00:00Z`)+n*DAY).toISOString().slice(0,10);}
export function parisMidnight(date){
  // Converge from UTC to the requested Paris midnight, including DST days.
  const target=Date.parse(date+'T00:00:00Z');let guess=target;
  for(let i=0;i<4;i++){const p=parisParts(guess),asUTC=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);const d=asUTC-target;if(!d)break;guess-=d;}
  return guess;
}
export function challengeState(now=new Date()){
  const today=parisDate(now),duration=dayDiff(CONFIG.startDate,CONFIG.endDate)+1;
  const status=today<CONFIG.startDate?'scheduled':today>CONFIG.endDate?'finished':'running';
  const target=status==='scheduled'?parisMidnight(CONFIG.startDate):parisMidnight(shiftDay(CONFIG.endDate,1));
  return {...CONFIG,today,status,duration,dayNumber:Math.min(duration,Math.max(0,dayDiff(CONFIG.startDate,today)+1)),daysLeft:status==='scheduled'?duration:Math.max(0,dayDiff(today,CONFIG.endDate)+1),daysUntilStart:Math.max(0,dayDiff(today,CONFIG.startDate)),deadline:target,serverTime:new Date(now).toISOString()};
}
// A streak lives while each reading comes at most 24 h after the previous one and the last one is under 24 h old;
// it counts the distinct Paris days of that chain. The hourglass shows in its last 8 hours.
export function streakFor(entries,now=new Date()){
  const c=challengeState(now),at=c.status==='finished'?c.deadline:new Date(now).getTime();
  const live=entries.filter(e=>!e.deletedAt&&e.pages>0&&e.readDate>=CONFIG.startDate&&e.readDate<=CONFIG.endDate);
  const dates=[...new Set(live.map(e=>e.readDate))].sort().reverse(),times=[...new Set(live.map(e=>e.createdAt))].sort().reverse();
  let streak=0,expiresAt=null;
  if(times.length&&Date.parse(times[0])+DAY>at){
    expiresAt=Date.parse(times[0])+DAY;const days=new Set([parisDate(times[0])]);
    for(let i=1;i<times.length&&Date.parse(times[i-1])-Date.parse(times[i])<=DAY;i++)days.add(parisDate(times[i]));
    streak=days.size;
  }
  const atRisk=c.status==='running'&&streak>=2&&expiresAt-at<8*3600000;
  return {streak,atRisk,expiresAt,activeDays:dates.length,dates,times};
}
export function snapshot(readers,entries,now=new Date()){
  const c=challengeState(now),valid=entries.filter(e=>!e.deletedAt&&e.readDate>=CONFIG.startDate&&e.readDate<=CONFIG.endDate&&e.readDate<=c.today);
  const byReader=new Map(readers.map(p=>[p.id,[]]));for(const e of valid)byReader.get(e.participantId)?.push(e);
  const participants=readers.map(p=>{const es=byReader.get(p.id)||[],s=streakFor(es,now);return {id:p.id,name:p.name,goal:Number(p.goal),pages:es.reduce((s,e)=>s+Number(e.pages),0),...s};}).sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'}));
  const names=new Map(readers.map(p=>[p.id,p.name]));
  return {challenge:c,participants,totalPages:participants.reduce((s,p)=>s+p.pages,0),readerCount:participants.length,completedCount:participants.filter(p=>p.pages>=p.goal).length,recentActivity:valid.filter(e=>names.has(e.participantId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,8).map(e=>({...e,name:names.get(e.participantId)}))};
}
export function ranked(participants,metric){
  const score=p=>metric==='pages'?p.pages:metric==='streak'?p.streak:p.pages/p.goal*100;
  const list=participants.filter(p=>metric==='streak'?p.streak>=2:p.pages>0).sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name,'fr'));
  let rank=0,previous=null;
  return list.slice(0,5).map((p,i)=>{const value=score(p);if(value!==previous)rank=i+1;previous=value;return {...p,rank,score:value};});
}
export function normalizedName(input){
  const name=typeof input==='string'?input.normalize('NFC').trim().replace(/\s+/g,' '):'';
  if(!name||name.length>32||!/^[\p{L}\p{M} .’'\-]+$/u.test(name)||!/[\p{L}]/u.test(name))throw new Error('Entre un prénom de 1 à 32 caractères. Une initiale est possible.');
  return {name,key:name.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').replace(/[’']/g,"'")};
}
export function validatePages(pages){if(!Number.isInteger(pages)||pages<1||pages>10000)throw new Error('Indique un nombre entier entre 1 et 10 000 pages.');return pages;}
