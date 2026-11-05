'use strict';
// Read-only inventory projection. No browser-supplied Discord ID or SQL fields.
const MAX_CARDS = 2000;
const {getCardSellPrice} = require('../utils/cardPricing');
const {normalizeRarity} = require('../utils/rarity');
const validUser = id => /^\d{15,22}$/.test(String(id || ''));
function safeCard(row, team, activeAuctions = new Set()) {
  const rarity = String(row.rarity || '');
  const stats = row.stats && typeof row.stats === 'object' && !Array.isArray(row.stats)
    ? row.stats : (() => { try { return JSON.parse(row.stats || '{}'); } catch { return {}; } })();
  const read = key => Math.max(0, Math.min(99, Number(row[key] ?? stats[key]) || 0));
  const id = Number(row.id);
  const powerNames = {motivador:'📣 Motivador',aqui_nao:'🧤 Aqui não.',coringa:'🃏 Coringa!',to_aqui:'🙌 TO AQUI!',invisible_wall:'🧱 Invisible Wall',visao_aguia:'🦅 Visão de Águia',corte_seco:'✂️ Corte Seco',magic:'🪄 Magic',mira_roxa:'🎯 Mira Roxa',nao_desisto:'🔥 Não desisto',eu_resolvo:'👑 Eu resolvo!',uma_hora_vai:'⏳ Uma hora vai'};
  const powerName = powerNames[row.purple_power] || String(row.purple_power || '').slice(0,60);
  return {
    id, name:String(row.player_name || 'Carta').slice(0,100),
    position:['GK','VL','PV'].includes(String(row.position))?String(row.position):'—',
    rarity:rarity==='Prime Purple'?'Purple Prime':rarity,
    overall:Math.max(0,Math.min(99,Number(row.overall_rating)||0)),
    stats:{posicionamento:read('posicionamento'),saidaDeBola:read('saidaDeBola'),defesa:read('defesa'),drible:read('drible'),passe:read('passe'),finalizacao:read('finalizacao')},
    power:powerName,ability:String(row.habilidade_equipada||'').slice(0,100),
    hasCosmetic:!!(row.custom_background||row.fundo_cor1||row.fundo_cor2||row.borda_cor1||row.borda_cor2),
    sellPrice:getCardSellPrice({...row,rarity:normalizeRarity(row.rarity)}),
    inAuction:activeAuctions.has(id),
    sellable:!activeAuctions.has(id) && !(team && [team.gk_card_id,team.vl_card_id,team.pv_card_id].some(n=>Number(n)===id)),
    equipped:Boolean(team && (Number(team.gk_card_id)===id || Number(team.vl_card_id)===id || Number(team.pv_card_id)===id)),
    orbUses:{refino:!!row.orb_chance_used,wock:!!row.orb_corruption_used,purple:!!row.orb_exalted_used}
  };
}
async function loadInventory(user, deps={}) {
  if(!validUser(user?.id))throw Error('Jogador inválido.');
  const q=deps.query||require('../database/connection').query;
  const teamLoader=deps.getTeam||require('../database/models/team').getTeamByOwner;
  const uid=String(user.id);
  const [team,rows,registry] = await Promise.all([
    teamLoader(uid),
    q(`SELECT uc.id, uc.player_name, uc.position, uc.rarity, uc.overall_rating, uc.stats, uc.posicionamento, uc.saidaDeBola, uc.defesa, uc.drible, uc.passe, uc.finalizacao, uc.purple_power, uc.orb_chance_used, uc.orb_corruption_used, uc.orb_exalted_used, uc.habilidade_equipada, uc.stats_rerolled, uc.position_changed, uc.custom_background, uc.fundo_cor1, uc.fundo_cor2, bc.cor1 AS borda_cor1, bc.cor2 AS borda_cor2
       FROM user_cards uc LEFT JOIN borda_codes bc ON uc.borda_id=bc.id WHERE uc.discord_id=? ORDER BY uc.overall_rating DESC, uc.id DESC LIMIT ${MAX_CARDS+1}`, [uid]),
    q("SELECT to_regclass('public.orb_inventory') AS orb, to_regclass('public.tower_progress') AS tower")
  ]);
  const known = registry[0] || {};
  const [orbs,progress,auctions,history] = await Promise.all([
    known.orb ? q('SELECT orb_code,quantity FROM orb_inventory WHERE discord_id=? AND quantity>0 ORDER BY orb_code',[uid]) : [],
    known.tower ? q('SELECT relic_fragments FROM tower_progress WHERE discord_id=?',[uid]) : [],
    q("SELECT card_id FROM card_auctions WHERE seller_discord_id=? AND status='active' AND card_id IS NOT NULL",[uid]).catch(()=>[]),
    q(`SELECT card_id,orb_code,result,rarity_before,rarity_after,overall_before,overall_after,stats_before,stats_after,purple_power,created_at
       FROM orb_usage_history WHERE discord_id=? ORDER BY created_at DESC LIMIT 4000`,[uid]).catch(()=>[])
  ]);
  const activeAuctions=new Set(auctions.map(x=>Number(x.card_id)));
  const byCard=new Map(),powerMap=require('../utils/orbs').POWER;
  const statsObject=value=>{try{const x=typeof value==='string'?JSON.parse(value):value;return x&&typeof x==='object'&&!Array.isArray(x)?x:{};}catch{return {};}};
  for(const row of history){const id=Number(row.card_id),list=byCard.get(id)||[],p=powerMap[row.purple_power];list.push({code:String(row.orb_code),result:String(row.result),rarityBefore:row.rarity_before,rarityAfter:row.rarity_after,overallBefore:row.overall_before==null?null:Number(row.overall_before),overallAfter:row.overall_after==null?null:Number(row.overall_after),statsBefore:statsObject(row.stats_before),statsAfter:statsObject(row.stats_after),power:row.purple_power||null,powerName:p?.name||null,powerSummary:p?.short||p?.summary||null,at:row.created_at});byCard.set(id,list);}
  return {
    owner:uid, total:rows.length>MAX_CARDS?`Mais de ${MAX_CARDS}`:rows.length,
    truncated:rows.length>MAX_CARDS,
    cards:rows.slice(0,MAX_CARDS).map(x=>({...safeCard(x,team,activeAuctions),orbHistory:byCard.get(Number(x.id))||[]})),
    orbs:orbs.map(x=>({code:String(x.orb_code),quantity:Math.max(0,Number(x.quantity)||0)})),
    orbInventoryAvailable:!!known.orb,
    fragments:progress.length?Math.max(0,Number(progress[0].relic_fragments)||0):0,
    fragmentsAvailable:!!(known.tower&&progress.length)
  };
}
module.exports={loadInventory,safeCard,MAX_CARDS};
