'use strict';
const {query,pool}=require('../database/connection');
const idle=require('../utils/idleProgression');
const rules=()=>require('../commands/torre').__test;
const numbers=[1000,1800,2500];
function saoClock(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const fields=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:`${fields.year}-${fields.month}-${fields.day}`,season:`${fields.year}-${fields.month}`};
}
async function purchase(uid){
 const t=await require('./towerLifeStatus').current(uid);
 if(!t)return {available:false,remaining:0,nextAt:rules().getNextLifeWindowAt().toISOString(),reason:'Torre não iniciada'};
 const conn=await pool.getConnection();let progress;
 try{progress=await idle.readProgress(conn,uid);}finally{conn.release();}
 const r=rules(),key=r.getLifeWindowKey(),clock=saoClock();
 const slot=Number(String(key).split('T')[1]);
 const limit=idle.purchaseLimitForSlot(slot,progress),used=String(t.lives_purchase_window||'')===key&&String(t.purchase_date_key||'')===clock.date?Number(t.lives_purchased_today||0):0;
 const remaining=Math.max(0,limit-used),max=idle.capacity(progress),full=Number(t.lives)>=max;
 return {available:remaining>0&&!full&&!t.match_active&&Number(t.current_floor)<=50,
  used,limit,remaining,nextAt:r.getNextLifeWindowAt().toISOString(),lives:Number(t.lives),maxLives:max,full,
  nextCost:remaining?numbers[Math.min(used,2)]:1000,
  reason:full?'Vidas completas':!remaining?'Compras desta janela esgotadas':t.match_active?'Partida em andamento':''};
}
async function ranking(){
 const season=saoClock().season;
 const rows=await query(`SELECT t.discord_id AS id,t.ascension_level AS ascension,t.best_floor AS floor,
  COALESCE(NULLIF(tm.name,''),'Time não cadastrado') AS team,
  COALESCE(NULLIF(p.username,''),'Jogador') AS player
  FROM tower_progress t LEFT JOIN players p ON p.discord_id=t.discord_id
  LEFT JOIN LATERAL (SELECT name FROM teams WHERE owner_discord_id=t.discord_id ORDER BY id LIMIT 1) tm ON TRUE
  WHERE t.season_key=? AND (t.best_floor>0 OR t.ascension_level>0)
  ORDER BY t.ascension_level DESC,t.best_floor DESC,t.completed_at ASC NULLS LAST,t.updated_at ASC LIMIT 10`,[season]);
 return {season,rows:rows.map((r,i)=>({rank:i+1,id:String(r.id),team:String(r.team),player:String(r.player),ascension:Number(r.ascension)||0,floor:Number(r.floor)||0}))};
}
module.exports={purchase,ranking,saoClock};
