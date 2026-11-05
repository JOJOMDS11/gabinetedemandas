'use strict';
// V2 bridge: authenticated allowlisted actions on the EXISTING Render Mainbot process.
// No new simulator, no direct economy edits from browser payloads.
const express = require('express');
const {createVerifier} = require('./liveBridgeAuth');
const web = require('./webRoutes');
const {loadInventory} = require('./inventoryBridge');
const RATE = new Map();
function createLiveBridge({client, service = web, verifier} = {}) {
 const router=express.Router();
 const verify=verifier||createVerifier({secret:process.env.DT_BRIDGE_KEY,allowedIds:process.env.DT_BRIDGE_ALLOWED_DISCORD_IDS});
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');next();});
 router.use((req,res,next)=>{
   const result=verify(req);
   if(!result.ok)return res.status(result.status).json({error:result.error});
   req.bridgeUser=result.user;
   const social=req.method==='POST'&&['/social','/dm','/chat'].includes(req.path);
   const key=req.bridgeUser.id+':'+(social?'social':req.method);
   const at=Date.now(),r=RATE.get(key);
   if(!r||r.until<at)RATE.set(key,{until:at+60_000,count:1});
   else if(++r.count>(req.method==='GET'?240:social?60:15))return res.status(429).json({error:'Limite de ações por minuto.'});
   next();
 });
 const live=()=>process.env.DT_WEB_V2_ACTIONS_ENABLED==='true';
 const auto=require('./friendlyAuto');
 auto.start(client,service);
 const autoCodes=require('./autoCodes');autoCodes.start();
 router.get('/me',async(req,res)=>{
   try{const s=await service.getSafeStatus(req.bridgeUser);res.json({...s,user:{id:req.bridgeUser.id},bridge:{official:true,readOnly:!live(),version:2,features:{sell:live() && process.env.DT_WEB_V22_SELL_ENABLED==='true',purchase:live() && process.env.DT_WEB_V2_ENABLE_PURCHASES==='true'}}});}
   catch(e){console.error('[web v2 me]',e.message);res.status(503).json({error:'Dados indisponíveis.'});}
 });
 router.get('/tournaments',async(req,res)=>{
  try{
   const rows=await require('../services/tournamentV2').list(30);
   res.json({tournaments:rows.map(t=>({id:Number(t.id),name:String(t.name).slice(0,100),status:String(t.status),format:String(t.format),maxTeams:Number(t.max_teams)||0,channelId:String(t.channel_id||''),guildId:String(t.guild_id||''),prizeFirst:Number(t.prize_1st)||0}))});
  }catch(e){console.error('[web tournaments]',e.message);res.status(503).json({error:'Torneios indisponíveis.'});}
 });
 router.get('/codes',async(req,res)=>{try{res.json(await autoCodes.status(req.bridgeUser.id));}catch(e){res.status(503).json({error:'Códigos indisponíveis.'});}});
 router.get('/daily-reward',async(req,res)=>{
  try {const {getPlayerByDiscordId}=require('../database/models/player');const player=await getPlayerByDiscordId(req.bridgeUser.id);
   const last=player?.last_login_reward?new Date(player.last_login_reward).getTime():0;
   const next=Number.isFinite(last)?last+86400000:0;
   res.json({available:!last||Date.now()>=next,nextAt:last?new Date(next).toISOString():null,streak:Number(player?.login_streak)||0});
  }catch(e){console.error('[web daily reward]',e.message);res.status(503).json({error:'Recompensa diária indisponível.'});}
 });
 router.get('/card-cooldowns',async(req,res)=>{
  try{
   const uid=req.bridgeUser.id;
   const {checkCooldown}=require('../utils/cooldowns');
   const purple='1187805077390495855',booster='1134615671112732823';
   const subIds=['1353816799463997560','1412879676640334018','1415815771270942770'];
   let hasPurple=false,boost=false;
   for(const guildId of ['1053695613335781446','1151125012879769740']){
    const guild=client?.guilds?.cache?.get(guildId);if(!guild)continue;
    const member=await guild.members.fetch(uid).catch(()=>null);
    if(member){hasPurple ||=member.roles.cache.has(purple);boost ||=member.roles.cache.has(booster)||subIds.some(role=>member.roles.cache.has(role));}
   }
   const obterMs=hasPurple?8*60000:boost?10*60000:15*60000;
   const packMs=hasPurple?Math.round(1.67*3600000):boost?2*3600000:2.5*3600000;
   const [obter,pack]=await Promise.all([checkCooldown(uid,'obter',obterMs),checkCooldown(uid,'pack',packMs)]);
   res.json({obter:{available:obter.canUse,remainingMs:obter.timeLeft},pacote:{available:pack.canUse,remainingMs:pack.timeLeft},checkedAt:new Date().toISOString()});
  }catch(e){console.warn('[web cooldown]',e.message);res.status(503).json({error:'Cooldown indisponível.'});}
 });
 router.get('/relics',async(req,res)=>{
  try {res.json(await require('./relicBridge').loadRelics(req.bridgeUser.id));}
  catch(e){console.error('[web relics]',e.message);res.status(503).json({error:'Inventário de relíquias indisponível.'});}
 });
 router.get('/card-jojoscore/:id',async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Carta inválida.'});
  try{
   const {query}=require('../database/connection');
   const owned=await query('SELECT id FROM user_cards WHERE id=? AND discord_id=? LIMIT 1',[id,req.bridgeUser.id]);
   if(!owned.length)return res.status(404).json({error:'Carta não encontrada no seu inventário.'});
   const official=await require('../utils/jojoscore').statsForCards([id]);
   res.json({cardId:id,official:official[id]||null,scope:'Partidas oficiais: Desafio e Torneio'});
  }catch(e){console.warn('[web card jojoscore]',e.message);res.status(503).json({error:'JOJOSCORE indisponível.'});}
 });
 router.get('/tower-shop-catalog',async(req,res)=>{
  try{
   const t=require('../commands/torre').__test,o=require('../utils/orbs').ORBS;
   const relics=Object.values(t.TOWER_RELICS).filter(r=>r.rarity!=='legado').map(r=>({code:r.code,name:r.name,rarity:r.rarity,description:r.description,craft:t.RELIC_CRAFT_COSTS[r.rarity]?{...t.RELIC_CRAFT_COSTS[r.rarity]}:null}));
   res.json({relics,orbs:Object.values(o).map(r=>({code:r.code,name:r.name,fragments:r.fragments,useOn:r.useOn,effect:r.effect})),prices:Object.fromEntries(Object.entries(t.RELIC_CRAFT_COSTS).filter(([key])=>['rara','epica','lendaria'].includes(key)))});
  }catch(e){console.warn('[web tower catalogue]',e.message);res.status(503).json({error:'Oficina indisponível.'});}
 });
 router.get('/my-bids',async(req,res)=>{
  try{const {query}=require('../database/connection');
   const rows=await query(`SELECT auction_id,card_id,item_type,orb_code,current_bid,ends_at,status,card_snapshot
     FROM card_auctions WHERE highest_bidder_id=? ORDER BY updated_at DESC LIMIT 25`,[req.bridgeUser.id]);
   res.json({bids:rows.map(x=>{let c={};try{c=typeof x.card_snapshot==='string'?JSON.parse(x.card_snapshot||'{}'):(x.card_snapshot||{});}catch{}return {id:String(x.auction_id),cardId:x.card_id||null,itemType:x.item_type,orbCode:x.orb_code,name:String(c.player_name||'Carta').slice(0,90),position:String(c.position||''),rarity:String(c.rarity||''),overall:Number(c.overall_rating)||0,bid:Number(x.current_bid||0),endsAt:x.ends_at,status:x.status};})});
  }catch(e){console.error('[web my bids]',e.message);res.status(503).json({error:'Lances indisponíveis.'});}
 });
 router.get('/tactics',async(req,res)=>{
  try{res.json(await require('./tacticsBridge').loadTactics(req.bridgeUser.id));}
  catch(e){console.error('[web tactics]',e.message);res.status(503).json({error:'Dados de treinador e patrocínio indisponíveis.'});}
 });
 router.get('/chat',async(req,res)=>{try{res.json(await require('./communityChat').list(client,req.bridgeUser.id));}catch(e){res.status(503).json({error:e.message||'Mural indisponível.'});}});
 router.get('/social',async(req,res)=>{try{res.json(await require('./chatSocial').inbox(client,req.bridgeUser.id));}catch(e){res.status(e.httpStatus||503).json({error:e.message});}});
 router.get('/dm/:target',async(req,res)=>{try{res.json(await require('./chatSocial').conversation(client,req.bridgeUser.id,req.params.target));}catch(e){res.status(e.httpStatus||400).json({error:e.message});}});
 router.get('/auction-alerts',async(req,res)=>{try{res.json(await require('./auctionAlerts').list(req.bridgeUser.id));}catch(e){res.status(503).json({error:e.message});}});
 router.get('/auto-friendly',async(req,res)=>{
   try { res.json(await auto.status(req.bridgeUser.id)); }
   catch(e){console.error('[web auto status]',e.message);res.status(503).json({error:'Farm automático indisponível.'});}
 });
 router.get('/auto-config',async(req,res)=>{
  try {res.json(await auto.status(req.bridgeUser.id));}
  catch(e){res.status(503).json({error:'Configuração de Auto Farm indisponível.'});}
 });

 router.get('/club/:id',async(req,res)=>{
  try{res.json(await require('./clubPreview').load(req.params.id));}
  catch(e){res.status(e.httpStatus||400).json({error:e.message||'Clube indisponível.'});}
 });
 router.get('/club-card/:owner/:card',async(req,res)=>{
  try{const pic=await require('./clubCardArtwork').renderPublicClubCard(req.params.owner,req.params.card);
   if(!pic)return res.status(404).json({error:'Carta não está mais escalada.'});
   res.set('Content-Type','image/png');res.set('Content-Length',String(pic.length));res.end(pic);
  }catch(e){console.warn('[web club art]',e.message);res.status(503).json({error:'Imagem indisponível.'});}
 });
 router.get('/tower-purchase',async(req,res)=>{try{res.json(await require('./towerPresentation').purchase(req.bridgeUser.id));}catch(e){res.status(503).json({error:'Estado de compra indisponível.'});}});
 router.get('/tower-ranking',async(req,res)=>{try{res.json(await require('./towerPresentation').ranking());}catch(e){res.status(503).json({error:'Ranking indisponível.'});}});
 router.get('/bolsa',async(req,res)=>{
  try{res.json(await require('./webBolsa').status(req.bridgeUser.id,req.query.slot,req.query.page));}
  catch(e){res.status(503).json({error:e.message||'Bolsa indisponível.'});}
 });
 router.get('/mitadas',async(req,res)=>{
  try{res.json(await require('./mitadasFeed').list(req.bridgeUser.id));}
  catch(e){res.status(503).json({error:e.message||'Destaques indisponíveis.'});}
 });
 router.get('/match/:id',async(req,res)=>{
  try{res.json(await require('./mitadasFeed').match(req.params.id));}
  catch(e){res.status(e.httpStatus||400).json({error:e.message||'Partida indisponível.'});}
 });
 router.get('/players',async(req,res)=>{
   try {
     // Presence only where Discord gateway already supplies it. Never assume unavailable=offline.
     const guild=client?.guilds?.cache?.get(process.env.DISCORD_GUILD_ID||'');
     const online=[...(guild?.members?.cache?.values?.()||[])].filter(m=>m?.presence && ['online','idle','dnd'].includes(m.presence.status) && !m.user?.bot && m.id!==req.bridgeUser.id).slice(0,100);
     if(!online.length)return res.json({presenceAvailable:false,players:[],note:'Presença do Discord indisponível na conexão atual. Convide pelo ID.'});
     const {query}=require('../database/connection');
     const found=await query(`SELECT discord_id FROM players WHERE discord_id IN (${online.map(()=>'?').join(',')})`,online.map(m=>m.id));
     const known=new Set(found.map(p=>String(p.discord_id)));
     res.json({presenceAvailable:true,players:online.filter(m=>known.has(m.id)).slice(0,40).map(m=>({id:m.id,name:String(m.displayName||m.user.username).slice(0,60),status:m.presence.status}))});
   }catch(e){console.warn('[web v2 players]',e.message);res.json({presenceAvailable:false,players:[],note:'Lista de jogadores indisponível.'});}
 });
 router.get('/auction-art/:id',async(req,res)=>{
  try{const pic=await require('./auctionArtwork').renderAuctionArt(req.params.id,client);
   if(!pic)return res.status(404).json({error:'Imagem indisponível.'});
   res.set('Content-Type','image/png');res.set('Content-Length',String(pic.length));res.end(pic);
  }catch(e){console.warn('[web auction art]',e.message);res.status(503).json({error:'Imagem indisponível.'});}
 });
 router.get('/cards/:id/:variant',async(req,res)=>{
   if(!/^[1-9][0-9]{0,9}$/.test(req.params.id)||!['card','avatar'].includes(req.params.variant))return res.status(404).json({error:'Imagem não encontrada.'});
   try {
     const {getOwnedArtwork}=require('./cardArtwork');
     const image=await getOwnedArtwork(req.bridgeUser.id,req.params.id,req.params.variant);
     if(!image)return res.status(404).json({error:'Carta não encontrada neste inventário.'});
     res.set('Content-Type','image/png');res.set('Content-Length',String(image.length));res.end(image);
   }catch(e){console.error('[web v2 card-art]',e.message);res.status(503).json({error:'Imagem temporariamente indisponível.'});}
 });
 router.get('/progress',async(req,res)=>{
   try {res.json(await require('./progressBridge').getProgress(req.bridgeUser.id));}
   catch(e){console.warn('[web progress]',e.message);res.status(503).json({error:'Progresso indisponível.'});}
 });
 router.get('/skills',async(req,res)=>{
   try{res.json(await require('./skillsBridge').list(req.bridgeUser.id));}
   catch(e){console.error('[web skills]',e.message);res.status(503).json({error:'Habilidades indisponíveis.'});}
 });
 router.get('/improvements',async(req,res)=>{
   try {
     const idle=require('../utils/idleProgression');
     const data=await idle.inventory(req.bridgeUser.id);
     const items=Object.fromEntries(Object.keys(idle.ITEMS).map(code=>{
       const item=idle.ITEMS[code];return [code,{name:item.name,description:item.description,quantity:Number(data.items[code]||0),level:code==='frasco'?null:idle.level(data.progress,code),max:code==='frasco'?10:item.max,stockMax:code==='frasco'?10:null,pc:item.pc||null,fragments:item.fragments||null}];
     }));
     res.json({items,capacity:idle.capacity(data.progress),friendLimit:idle.friendLimit(data.progress),flaskDailyCap:idle.flaskDailyCap(data.progress)});
   }catch(e){console.error('[web improvements]',e.message);res.status(503).json({error:'Melhorias indisponíveis.'});}
 });
 router.get('/feed',async(req,res)=>{
  try {const data=await require('./officialFeed').loadOfficialFeed(req.bridgeUser.id);
   try{data.events.push(...await require('./auctionAlerts').notifications(req.bridgeUser.id));}catch(e){data.warnings.push('alertas de leilão');console.warn('[web auction alerts]',e.message);}
   res.json(data);}
  catch(e){console.warn('[web feed]',e.message);res.status(503).json({error:'Atividade indisponível.'});}
 });
 router.get('/auctions',async(req,res)=>{
   try{
     const {query}=require('../database/connection');
      const guilds=require('./auctionTarget').visibleAuctionGuilds(client);
      if(!guilds.length)return res.status(503).json({error:'Bot não está em um servidor configurado para leilões.'});
     const rows=await query(`SELECT auction_id,card_id,starting_bid,current_bid,highest_bidder_id,
       seller_discord_id,ends_at,item_type,orb_code,card_snapshot
       FROM card_auctions WHERE status='active' AND ends_at>NOW()
       AND (guild_id=ANY(?::text[]) OR guild_id IS NULL) ORDER BY ends_at ASC LIMIT 100`,[guilds]);
     const auctions=rows.map(r=>{
       let card={};try{card=typeof r.card_snapshot==='string'?JSON.parse(r.card_snapshot):r.card_snapshot||{};}catch{}
       const end=new Date(r.ends_at).getTime();
       return {id:String(r.auction_id),cardId:r.card_id==null?null:Number(r.card_id),
         name:String(card.player_name||'Carta').slice(0,100),position:String(card.position||'').slice(0,3),
         overall:Number(card.overall_rating)||0,rarity:String(card.rarity||'').slice(0,30),
         itemType:r.item_type==='orb'?'orb':'card',orbCode:r.item_type==='orb'?String(r.orb_code||''):null,
         currentBid:Number(r.current_bid||r.starting_bid)||0,minimumBid:Math.max(500,Number(r.current_bid||r.starting_bid)+100),
         hasBid:!!r.highest_bidder_id,endsAt:Number.isFinite(end)?new Date(end).toISOString():null,
         own:String(r.seller_discord_id)===String(req.bridgeUser.id)};
     });
     res.json({auctions,count:auctions.length});
   }catch(e){console.warn('[web auctions]',e.message);res.status(503).json({error:'Leilões indisponíveis. Confira a configuração do servidor.'});}
 });
 router.get('/inventory',async(req,res)=>{
   try { return res.json(await loadInventory(req.bridgeUser)); }
   catch(e){console.error('[web v2 inventory]',e.message);return res.status(503).json({error:'Inventário indisponível.'});}
 });
 router.get('/jobs',async(req,res)=>{
   try{res.json(await service.bridgeGetJobs(req.bridgeUser));}
   catch(e){console.error('[web v2 jobs]',e.message);res.status(503).json({error:'Histórico indisponível.'});}
 });
 router.get('/jobs/:id',async(req,res)=>{
   try{const r=await service.bridgeGetJob(req.bridgeUser,req.params.id);if(!r)return res.status(404).json({error:'Ação não encontrada.'});res.json(r);}
   catch(e){console.error('[web v2 job]',e.message);res.status(503).json({error:'Ação indisponível.'});}
 });
 router.get('/challenges',async(req,res)=>{
   try{res.json(await service.bridgeGetChallenges(req.bridgeUser));}
   catch(e){console.error('[web v2 challenges]',e.message);res.status(503).json({error:'Convites indisponíveis.'});}
 });
 router.use((req,res,next)=>{
   if(!live())return res.status(403).json({error:'Ações Web v2 desativadas no Render. Configure DT_WEB_V2_ACTIONS_ENABLED=true somente após homologar.'});
   if(!client?.isReady?.())return res.status(503).json({error:'Mainbot desconectado.'});
   next();
 });

 router.post('/bolsa',async(req,res)=>{
  if(!live())return res.status(403).json({error:'Ações oficiais indisponíveis.'});
  try{res.json(await require('./webBolsa').action(req.bridgeUser.id,req.body||{}));}
  catch(e){res.status(400).json({error:e.message||'Ação recusada.'});}
 });
 router.post('/chat',async(req,res)=>{try{res.json(await require('./communityChat').send(client,req.bridgeUser.id,req.body?.text));}catch(e){res.status(400).json({error:e.message||'Mensagem recusada.'});}});
 router.post('/social',async(req,res)=>{try{res.json(await require('./chatSocial').update(client,req.bridgeUser.id,req.body||{}));}catch(e){res.status(e.httpStatus||400).json({error:e.message});}});
 router.post('/dm',async(req,res)=>{try{res.json(await require('./chatSocial').send(client,req.bridgeUser.id,req.body||{}));}catch(e){res.status(e.httpStatus||400).json({error:e.message});}});
 router.post('/auction-alerts',async(req,res)=>{try{res.json(await require('./auctionAlerts').update(req.bridgeUser.id,req.body||{}));}catch(e){res.status(400).json({error:e.message});}});
 router.post('/auto-config',async(req,res)=>{
  try{res.json(await auto.setSettings(req.bridgeUser.id,req.body?.settings));}
  catch(e){res.status(400).json({error:e.message||'Configuração recusada.'});}
 });
 router.post('/auto-friendly',async(req,res)=>{
   if(typeof req.body?.enabled!=='boolean')return res.status(400).json({error:'Escolha iniciar ou parar.'});
   try {res.json(await auto.setEnabled(req.bridgeUser.id,req.body.enabled));}
   catch(e){res.status(403).json({error:e.message});}
 });
 for(const [endpoint,kind] of [['/command','command'],['/choice','choice'],['/challenge','challenge'],['/bid','bid'],['/sell','sell'],['/improvement','improvement'],['/relics','relics'],['/relic-repair','relic-repair'],['/relic-position','relic-position'],['/sponsor-rescind','sponsor-rescind'],['/auction-cancel','auction-cancel'],['/orb','orb'],['/skill','skill'],['/claim-achievement','achievement'],['/mission-next','mission-next']]){
   router.post(endpoint,async(req,res)=>{
     const body=req.body||{};
     if(!body||typeof body!=='object'||Array.isArray(body)||!/^[-a-f0-9]{36}$/i.test(String(body.idemKey||'')))return res.status(400).json({error:'Corpo ou ID de ação inválido.'});
     try {
       const id=await service.bridgeExecute({kind,user:req.bridgeUser,client,body});
       res.status(202).json({id,official:true});
     } catch(e){
       if(e.isClientError)return res.status(e.httpStatus||400).json({error:e.message});
       console.error('[web v2 execute]',kind,e);
       res.status(503).json({error:'A operação não pôde ser iniciada. Confira o histórico antes de repetir.'});
     }
   });
 }
 router.all('*',(_req,res)=>res.status(405).json({error:'Operação não permitida.'}));
 return router;
}
module.exports={createLiveBridge};
