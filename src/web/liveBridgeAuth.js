'use strict';
// Dedicated v2 signature: method, path, user, timestamp, nonce and SHA-256 of raw body.
// Does not modify the v1 read-only bridge.
const crypto = require('node:crypto');
const PREFIX = '/api/dt-bridge/v2';
const ids = s => new Set(String(s || '').split(',').map(x => x.trim()).filter(x => /^\d{15,22}$/.test(x)));
const validPath = p => /^\/api\/dt-bridge\/v2\/(?:me|inventory|card-jojoscore\/[1-9]\d{0,9}|tower-shop-catalog|auctions|tournaments|feed|codes|chat|skills|skill|improvements|improvement|orb|auto-friendly|auto-config|relics|relic-repair|relic-position|sponsor-rescind|auction-cancel|social|dm|dm\/\d{15,22}|auction-alerts|my-bids|tactics|daily-reward|card-cooldowns|progress|claim-achievement|mission-next|players|jobs|jobs\/[a-f0-9-]{36}|challenges|cards\/[1-9][0-9]{0,9}\/(?:card|avatar)|command|choice|bid|challenge|sell|bolsa(?:\?slot=[1-3]\&page=\d{1,3})?|mitadas|tower-ranking|tower-purchase|club\/\d{15,22}|club-card\/\d{15,22}\/[1-9]\d{0,9}|match\/[1-9]\d{0,11}|auction-art\/\d{8,22})$/.test(p);
const digest = s => crypto.createHash('sha256').update(s).digest('hex');
function sign(secret, method, p, user, stamp, nonce, raw = '') {
  return crypto.createHmac('sha256', secret).update([method,p,user,stamp,nonce,digest(raw)].join('\n')).digest('hex');
}
function createVerifier({secret, allowedIds, now = Date.now, used = new Map()} = {}) {
  const allow = ids(allowedIds);
  const ready = typeof secret === 'string' && Buffer.byteLength(secret) >= 32 && allow.size > 0;
  return function verify(req) {
    if (!ready) return {ok:false,status:503,error:'Bridge sem configuração.'};
    const p = req.originalUrl;
    if (!validPath(p)) return {ok:false,status:404,error:'Rota não disponível.'};
    const uid = String(req.get('X-DT-User') || ''), ts = String(req.get('X-DT-Timestamp') || '');
    const nonce = String(req.get('X-DT-Nonce') || ''), signature = String(req.get('X-DT-Signature') || '');
    if (!allow.has(uid)) return {ok:false,status:403,error:'Usuário não autorizado.'};
    if (!/^\d{13}$/.test(ts) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return {ok:false,status:403,error:'Cabeçalhos de assinatura inválidos.'};
    if (Math.abs(now() - Number(ts)) > 45_000) return {ok:false,status:403,error:'Horário da assinatura expirado.'};
    const body = req.method === 'POST' ? JSON.stringify(req.body ?? {}) : '';
    const expected = sign(secret,req.method,p,uid,ts,nonce,body);
    if (!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(signature,'hex'))) return {ok:false,status:403,error:'Assinatura da bridge diferente.'};
    const key = uid+':'+nonce;
    if (used.has(key) && used.get(key)>now()) return {ok:false,status:409,error:'Requisição repetida.'};
    for (const [k,expires] of used) if (expires < now()) used.delete(k);
    // Bounded per process: restart invalidates nonce history but timestamp prevents old replay.
    if (used.size>=5000) return {ok:false,status:429,error:'Bridge ocupada.'};
    used.set(key,now()+90_000);
    return {ok:true,user:{id:uid,username:'Jogador',avatar:null}};
  };
}
module.exports = {PREFIX,sign,createVerifier,digest};
