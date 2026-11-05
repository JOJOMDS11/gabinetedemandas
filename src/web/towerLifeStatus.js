'use strict';
const {pool} = require('../database/connection');
const idle = require('../utils/idleProgression');
// Usa a mesma regeneração oficial de /torre sob lock transacional.
// Consultar a Web não concede vidas extras nem repete uma janela já processada.
async function current(uid){
 await idle.ensureSchema();
 const conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  const [rows]=await conn.query("SELECT *, TO_CHAR(lives_purchase_date, 'YYYY-MM-DD') AS purchase_date_key FROM tower_progress WHERE discord_id=? FOR UPDATE",[String(uid)]);
  let state=rows?.[0]||null;
  if(state)state=await require('../commands/torre').__test.applyPendingLifeRegenerations(conn,state);
  await conn.commit();
  return state;
 }catch(e){await conn.rollback().catch(()=>{});throw e;}finally{conn.release();}
}
async function next(uid){
 const rules=require('../commands/torre').__test;
 const at=rules.getNextLifeWindowAt();
 const conn=await pool.getConnection();
 try{const progress=await idle.readProgress(conn,uid);
  return {nextRegenAt:at.toISOString(),regenAmount:idle.regenForSlot(rules.getLifeWindowKey(at).split('T')[1],progress)};
 }finally{conn.release();}
}
module.exports={current,next};
