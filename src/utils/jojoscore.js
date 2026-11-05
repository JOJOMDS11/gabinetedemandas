'use strict';
/** JOJOSCORE v1. Calculado somente ao fim do jogo; não influencia a engine/RNG.
 * Passes/dribles são ações concretas identificadas pelo motor, não posses inventadas.
 */
// Carregamento sob demanda: cálculo de notas funciona sem Postgres instalado.
const db = () => require('../database/connection');
const ROLES = ['gk','vl','pv'];
const val = n => Number.isFinite(Number(n)) ? Number(n) : 0;
const clamp = n => Math.max(0,Math.min(10,Math.round(n*10)/10));
function buildRatings(cards1,cards2,events=[],score={team1:0,team2:0},actions={},options={}) {
 // Normaliza a duração para que partidas de 6 min não dominem o ranking das de 3 min.
 const knownDuration=val(options.durationSeconds);
 const observed=Math.max(0,...(events||[]).map(e=>val(e?.time)));
 const minutesWeight=Math.pow(180/Math.max(180,knownDuration||observed||180),0.8);
 const entries=[];const sides={team1:cards1||{},team2:cards2||{}};
 for(const [side,cards] of Object.entries(sides)) for(const pos of ROLES) {
  const card=cards[pos];if(!card||!card.id)continue;
  entries.push({cardId:Number(card.id),name:String(card.player_name||pos.toUpperCase()),position:pos.toUpperCase(),side,
    goals:0,assists:0,passes:0,dribbles:0,saves:0,blocks:0,shots:0,onTarget:0,shotsSaved:0,misses:0,ownGoals:0,goalsConceded:0,cleanSheet:false});
 }
 const byKey=new Map(entries.map(e=>[`${e.side}:${e.cardId}`,e]));
 const forId=(side,id)=>byKey.get(`${side}:${id}`);
 const other=side=>side==='team1'?'team2':'team1';
 for(const e of entries){const a=actions[String(e.cardId)]||{};e.passes=val(a.passes);e.dribbles=val(a.dribbles);}
 for(const ev of events||[]){if(!ev||!ev.type)continue;
  const side=ev.team==='team2'?'team2':'team1';
  if(ev.type==='goal'){
   const scorer=forId(side,ev.scorerId);if(scorer){scorer.goals++;scorer.shots++;scorer.onTarget++;}
   const assister=forId(side,ev.assisterId);if(assister){assister.assists++;assister.passes++;}
   const gk=entries.find(e=>e.side===other(side)&&e.position==='GK');if(gk)gk.goalsConceded++;
  } else if(ev.type==='own_goal'){
   const owner=ev.scorerTeam==='team1'||ev.scorerTeam==='team2'?ev.scorerTeam:other(side);
   const scorer=forId(owner,ev.scorerId);if(scorer)scorer.ownGoals++;
   const gk=entries.find(e=>e.side===owner&&e.position==='GK');if(gk)gk.goalsConceded++;
  } else if(['shot','miss','blocked'].includes(ev.type)){
   const shooter=forId(side,ev.scorerId);
   if(shooter){shooter.shots++;if(ev.type==='miss')shooter.misses++;if(ev.type==='shot'){shooter.shotsSaved++;shooter.onTarget++;}}
   if(ev.type==='shot'){const gk=entries.find(e=>e.side===other(side)&&e.position==='GK');if(gk)gk.saves++;}
   if(ev.type==='blocked'){const vl=entries.find(e=>e.side===other(side)&&e.position==='VL');if(vl)vl.blocks++;}
  }
 }
 // Placar oficial é a fonte da verdade quando algum evento não chegou ao JOJOSCORE.
 for(const e of entries.filter(e=>e.position==='GK')) {
  const opponentScore = e.side==='team1'?val(score?.team2):val(score?.team1);
  e.goalsConceded=Math.max(e.goalsConceded,opponentScore);
 }
 for(const e of entries){
  e.cleanSheet=e.position==='GK'&&e.goalsConceded===0;
  // Pesos com retornos decrescentes para volume de chutes e construções.
  const positive=e.goals*0.85+e.assists*0.50+Math.min(8,e.passes)*0.055+Math.min(8,e.dribbles)*0.065
    +Math.min(10,e.saves)*0.22+Math.min(10,e.blocks)*0.12+Math.min(8,e.shots)*0.025;
  const negative=e.misses*0.065+e.ownGoals*0.9+(e.position==='GK'?e.goalsConceded*0.12:0);
  // Clean sheet raríssimo no HaxBall: bônus fixo, não diluído pela duração.
  e.rating=clamp(6+(positive-negative)*minutesWeight+(e.cleanSheet?1.0:0));
 }
 // Vitória: somente cartas do vencedor concorrem ao MVP.
 // Empate de grupo/liga: não há vencedor, então concorrem os dois times.
 const score1=val(score?.team1),score2=val(score?.team2);
 const winningSide=score1>score2?'team1':score2>score1?'team2':null;
 const eligible=winningSide?entries.filter(e=>e.side===winningSide):entries;
 const rated=[...eligible].sort((a,b)=>b.rating-a.rating || (b.goals+b.assists*0.6+b.saves*0.4+b.blocks*0.3)-(a.goals+a.assists*0.6+a.saves*0.4+a.blocks*0.3) || a.cardId-b.cardId);
 const mvp=rated[0]||null;
 for(const e of entries)e.isMvp=Boolean(mvp&&e.side===mvp.side&&e.cardId===mvp.cardId);
 return {entries,mvp};
}
function formatRatings(result,teams={}){if(!result||!result.entries.length)return 'Sem cartas identificadas.';
 const lines=[`🔴 **${String(teams.team1||'Time 1').slice(0,55)}**`,...result.entries.filter(e=>e.side==='team1').map(e=>`**${e.position}** ${e.name}: **${e.rating.toFixed(1)}**`),`🔵 **${String(teams.team2||'Time 2').slice(0,55)}**`,...result.entries.filter(e=>e.side==='team2').map(e=>`**${e.position}** ${e.name}: **${e.rating.toFixed(1)}**`)];
 if(result.mvp){
  const m=result.mvp;
  lines.push(`🏆 **MVP: ${m.name} (${m.position}) — ${m.rating.toFixed(1)}**`);
  const actions=[m.goals?`⚽ ${m.goals} gol(s)`:null,m.assists?`🎯 ${m.assists} ass.`:null,m.passes?`🅿️ ${m.passes} passes`:null,m.dribbles?`🌀 ${m.dribbles} conduções`:null,m.saves?`🧤 ${m.saves} defesas`:null,m.blocks?`🛡️ ${m.blocks} bloqueios`:null].filter(Boolean);
  if(actions.length)lines.push(`📊 ${actions.join(' · ')}`);
 }
 return lines.join('\n').slice(0,1024);
}
// Exige uma transação aberta. No torneio, stats oficiais + notas + resultado são atômicos.
async function recordOfficialInTransaction(conn,{matchKey,kind,cards1,cards2,events,score,actions,durationSeconds,teamIds,updateTournamentStats=false}){
 if(!['desafio','torneio'].includes(kind))throw Error('JOJOSCORE: modo oficial inválido');
 const rated=buildRatings(cards1,cards2,events,score,actions,{durationSeconds});
 const [added]=await conn.query(`INSERT INTO jojo_official_matches(match_key,kind,score1,score2)
 VALUES(?,?,?,?) ON CONFLICT(match_key) DO NOTHING RETURNING match_key`,[matchKey,kind,val(score?.team1),val(score?.team2)]);
 if(added.affectedRows!==1)return {recorded:false,...rated};
 for(const e of rated.entries){
  await conn.query(`INSERT INTO jojo_card_ratings(match_key,card_id,card_name,position,rating,goals,assists,passes,dribbles,saves,blocks,own_goals,shots,on_target,is_mvp)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING card_id`,[matchKey,e.cardId,e.name,e.position,e.rating,e.goals,e.assists,e.passes,e.dribbles,e.saves,e.blocks,e.ownGoals,e.shots,e.onTarget,e.isMvp]);
  if(updateTournamentStats){
   // Mesma contagem oficial já usada por /desafiar, mas uma vez por partida do torneio.
   await conn.query(`UPDATE user_cards SET games_played=COALESCE(games_played,0)+1, goals=COALESCE(goals,0)+?,
    assists=COALESCE(assists,0)+?,own_goals=COALESCE(own_goals,0)+?,
    goals_conceded=COALESCE(goals_conceded,0)+?,clean_sheets=COALESCE(clean_sheets,0)+?
    WHERE id=?`,[e.goals,e.assists,e.ownGoals,e.goalsConceded,e.cleanSheet?1:0,e.cardId]);
  }
 }
 if(updateTournamentStats&&teamIds){
  for(const [side,teamId] of Object.entries(teamIds)){
   const own=val(score[side]),op=val(score[side==='team1'?'team2':'team1']);
   await conn.query(`UPDATE teams SET matches_played=COALESCE(matches_played,0)+1, wins=COALESCE(wins,0)+?,losses=COALESCE(losses,0)+?,draws=COALESCE(draws,0)+?,
    goals_for=COALESCE(goals_for,0)+?,goals_against=COALESCE(goals_against,0)+? WHERE id=?`,[own>op?1:0,own<op?1:0,own===op?1:0,own,op,teamId]);
   const sums=rated.entries.filter(e=>e.side===side);
   const goals=sums.reduce((n,e)=>n+e.goals,0),sheets=sums.filter(e=>e.cleanSheet).length;
   if(goals||sheets){
    await conn.query(`UPDATE players SET gols=COALESCE(gols,0)+?,clean_sheets=COALESCE(clean_sheets,0)+?
      WHERE discord_id=(SELECT owner_discord_id FROM teams WHERE id=?)`,[goals,sheets,teamId]);
   }
  }
 }
 return {recorded:true,...rated};
}
async function recordOfficial(o){const conn=await db().getConnection();try{await conn.beginTransaction();const out=await recordOfficialInTransaction(conn,o);await conn.commit();return out;}catch(e){await conn.rollback();throw e;}finally{conn.release();}}
async function statsForCards(ids){const valid=(ids||[]).map(Number).filter(Number.isSafeInteger);if(!valid.length)return {};
 const slots=valid.map(()=>'?').join(',');const rows=await db().query(`SELECT card_id,COUNT(*)::int AS games,ROUND(AVG(rating)::numeric,2) AS average,
 MAX(rating) AS best,COUNT(*) FILTER (WHERE is_mvp)::int AS mvps,
 COALESCE(SUM(goals),0)::int AS goals,COALESCE(SUM(assists),0)::int AS assists,
 COALESCE(SUM(passes),0)::int AS passes,COALESCE(SUM(dribbles),0)::int AS dribbles,
 COALESCE(SUM(saves),0)::int AS saves,COALESCE(SUM(blocks),0)::int AS blocks,
 COALESCE(SUM(shots),0)::int AS shots,COALESCE(SUM(on_target),0)::int AS on_target,COALESCE(SUM(own_goals),0)::int AS own_goals
 FROM jojo_card_ratings WHERE card_id IN (${slots}) GROUP BY card_id`,valid);
 return Object.fromEntries(rows.map(r=>[r.card_id,r]));
}
// Notas extras de Amistoso/Torre: tabela isolada. Nunca entra em
// jojo_card_ratings nem nos rankings oficiais do Discord.
// So grava cartas do jogador (team1), jamais IDs artificiais da IA.
async function recordExhibition({matchKey,kind,userId,score,rated}) {
 if (!['amistoso','torre'].includes(kind) || !/^(?:amistoso|torre):[A-Za-z0-9_-]{1,100}$/.test(String(matchKey||''))) return false;
 const own=(rated?.entries||[]).filter(e=>e.side==='team1'&&Number.isSafeInteger(Number(e.cardId))&&Number(e.cardId)>0);
 if(!own.length)return false;
 const payload=own.map(e=>({card_id:Number(e.cardId),card_name:String(e.name||'Carta').slice(0,100),position:e.position,
   rating:e.rating,is_mvp:!!e.isMvp,goals:e.goals||0,assists:e.assists||0,passes:e.passes||0,
   dribbles:e.dribbles||0,saves:e.saves||0,blocks:e.blocks||0,own_goals:e.ownGoals||0,
   shots:e.shots||0,on_target:e.onTarget||0}));
 try {
   // Um unico statement atomico; o conflito na partida impede dupla contagem.
   await db().query(`WITH inserted AS (
     INSERT INTO jojo_exhibition_matches(match_key,kind,discord_id,score1,score2)
     VALUES(?,?,?,?,?) ON CONFLICT(match_key) DO NOTHING RETURNING match_key
   ) INSERT INTO jojo_exhibition_card_ratings
     (match_key,card_id,card_name,position,rating,is_mvp,goals,assists,passes,dribbles,saves,blocks,own_goals,shots,on_target)
     SELECT i.match_key,j.card_id,j.card_name,j.position,j.rating,j.is_mvp,
       j.goals,j.assists,j.passes,j.dribbles,j.saves,j.blocks,j.own_goals,j.shots,j.on_target
     FROM inserted i CROSS JOIN jsonb_to_recordset(?::jsonb) AS j(
       card_id bigint,card_name text,position text,rating numeric,is_mvp boolean,
       goals integer,assists integer,passes integer,dribbles integer,saves integer,blocks integer,own_goals integer,shots integer,on_target integer)
     ON CONFLICT(match_key,card_id) DO NOTHING RETURNING card_id`,
     [matchKey,kind,String(userId),val(score?.team1),val(score?.team2),JSON.stringify(payload)]);
   return true;
 } catch(error) {
   // A estatistica NUNCA pode invalidar uma partida/recompensa.
   console.warn('[JOJOSCORE extra] Sem registro de '+kind+': '+error.message);
   return false;
 }
}
module.exports={buildRatings,formatRatings,recordOfficial,recordOfficialInTransaction,statsForCards,recordExhibition};
