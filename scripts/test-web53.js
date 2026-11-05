'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sign,createVerifier}=require('../src/web/liveBridgeAuth');
// Evaluate this pure inventory projection with mocked local dependencies; no DB is opened.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const loaded={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/web/inventoryBridge.js'),'utf8'),{
 module:loaded,console,Number,Math,String,JSON,Set,Map,Array,Boolean,Object,Error,Promise,
 require:id=>id.includes('cardPricing')?{getCardSellPrice:()=>423}:id.includes('rarity')?{normalizeRarity:x=>x}:id.includes('/orbs')?{POWER:{coringa:{name:'🃏 Coringa!',summary:'Ajuda a criar ataques quando participa das jogadas.'}}}:{}
});
const {loadInventory}=loaded.exports;
const uid='366001292251889696';
test('Web 5.3 permite as duas rotas GET assinadas somente para o usuário liberado',()=>{
 const secret='z'.repeat(40),verify=createVerifier({secret,allowedIds:uid});let idx=0;
 for(const suffix of ['/card-jojoscore/1038','/tower-shop-catalog']){
  const path='/api/dt-bridge/v2'+suffix,stamp=String(Date.now()),nonce=String(++idx).padStart(32,'0');
  const signature=sign(secret,'GET',path,uid,stamp,nonce);
  const request={method:'GET',originalUrl:path,get:name=>({'X-DT-User':uid,'X-DT-Timestamp':stamp,'X-DT-Nonce':nonce,'X-DT-Signature':signature})[name]};
  assert.equal(verify(request).ok,true,suffix);
 }
 assert.equal(verify({method:'GET',originalUrl:'/api/dt-bridge/v2/card-jojoscore/abc',get:()=>null}).ok,false);
});
test('Web 5.3 projeta atributos reais antes/depois e resumo do poder das Orbs',async()=>{
 const q=async(sql)=>{
  if(sql.includes('to_regclass'))return [{orb:'orb_inventory',tower:'tower_progress'}];
  if(sql.includes('FROM user_cards uc'))return [{id:1038,player_name:'black ruito',position:'GK',rarity:'Prime Purple',overall_rating:96,stats:{posicionamento:99,saidaDeBola:94,defesa:91,drible:94},purple_power:'coringa'}];
  if(sql.includes('FROM orb_usage_history'))return [{card_id:1038,orb_code:'wock',result:'penalty',rarity_before:'Prime',rarity_after:'Prime',overall_before:97,overall_after:96,stats_before:{defesa:94},stats_after:{defesa:91},purple_power:null,created_at:new Date()},{card_id:1038,orb_code:'purple',result:'awakened',rarity_before:'Prime Purple',rarity_after:'Prime Purple',overall_before:96,overall_after:96,stats_before:{defesa:91},stats_after:{defesa:91},purple_power:'coringa',created_at:new Date()}];
  return [];
 };
 const data=await loadInventory({id:uid},{query:q,getTeam:async()=>null});
 assert.equal(data.cards[0].orbHistory[0].statsBefore.defesa,94);
 assert.equal(data.cards[0].orbHistory[0].statsAfter.defesa,91);
 assert.match(data.cards[0].orbHistory[1].powerSummary,/ataques|jogadas/);
});
test('Web 5.3: compras de vidas esgotadas não aparecem como 3/3 disponíveis',async()=>{
 const script=fs.readFileSync(path.join(__dirname,'../src/web/towerPresentation.js'),'utf8');
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
 const date=Object.fromEntries(formatter.formatToParts(new Date()).map(p=>[p.type,p.value]));
 const today=`${date.year}-${date.month}-${date.day}`,windowKey=today+'T15';
 const exports={exports:{}};
 const requireMock=id=>{
  if(id==='../database/connection')return {query:async()=>[],pool:{getConnection:async()=>({release(){}})}};
  if(id==='../utils/idleProgression')return {readProgress:async()=>({}),purchaseLimitForSlot:()=>3,capacity:()=>7};
  if(id==='../commands/torre')return {__test:{getLifeWindowKey:()=>windowKey,getNextLifeWindowAt:()=>new Date(Date.now()+60000)}};
  if(id==='./towerLifeStatus')return {current:async()=>({lives_purchase_window:windowKey,purchase_date_key:today,lives_purchased_today:3,lives:0,match_active:false,current_floor:10})};
  throw Error('Dependência inesperada: '+id);
 };
 vm.runInNewContext(script,{module:exports,require:requireMock,Date,Number,String,Intl,Array,Object,Math,Promise});
 const status=await exports.exports.purchase(uid);
 assert.equal(status.available,false);assert.equal(status.remaining,0);assert.equal(status.used,3);
});
