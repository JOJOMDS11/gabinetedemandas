// Bônus de TREINADOR e PATROCÍNIO aplicados nas partidas (usado pelo /desafiar).
//
// • Treinador: soma pontos nos atributos das 3 cartas (em memória, nunca no banco).
//   Corrige o bug antigo: os buffs usam nomes longos (defesa/posicionamento/saidaDeBola)
//   e o simulador lê os curtos (def/pos/sai) — aqui os dois são sincronizados.
// • Patrocínio: vira PONTOS DE TIME (ataque/defesa) lidos pelo simulador, sem depender
//   de qual atributo ele boosta, para sempre ter efeito forte e visível.
// Tudo ajustável em BONUS_CONFIG.
const { query } = require('../database/connection');

const BONUS_CONFIG = {
    coachScale: 1.25,            // treinador forte: buffs x1.25
    statCap: 115,                // teto interno em jogo (a carta continua até 99 no banco)
    sponsorPointsPerValue: 2.5,  // patrocínio: bonus_valor x 2.5 = pontos de time (ex.: +3 => 7.5)
    sponsorMaxPoints: 15
};

function num(value, fallback = 50) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

// Mantém nomes longos e curtos iguais (o simulador lê def/pos/sai)
function syncCardStats(card) {
    card.pos = num(card.posicionamento);
    card.sai = num(card.saidaDeBola);
    card.def = num(card.defesa);
    card.stats = {
        ...(card.stats && typeof card.stats === 'object' ? card.stats : {}),
        posicionamento: num(card.posicionamento),
        saidaDeBola: num(card.saidaDeBola),
        defesa: num(card.defesa),
        drible: num(card.drible),
        passe: num(card.passe),
        finalizacao: num(card.finalizacao),
        pos: card.pos, sai: card.sai, def: card.def
    };
}

const STAT_ALIASES = {
    defesa: 'defesa', def: 'defesa',
    posicionamento: 'posicionamento', pos: 'posicionamento',
    saidadebola: 'saidaDeBola', saida_de_bola: 'saidaDeBola', saida: 'saidaDeBola', sai: 'saidaDeBola',
    drible: 'drible', dri: 'drible', passe: 'passe', pas: 'passe', finalizacao: 'finalizacao', fin: 'finalizacao'
};
function normalizeStatName(name) {
    const key = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z_]/g, '');
    return STAT_ALIASES[key] || null;
}

function applyCoachBuffs(cards, coachOrId) {
    // require tardio evita dependência circular com commands/treinador
    const { TREINADORES } = require('../commands/treinador');
    const coach = typeof coachOrId === 'string' ? TREINADORES[coachOrId] : coachOrId;
    if (!coach || !coach.buffs) return null;
    for (const card of Object.values(cards)) {
        if (!card || !card.id) continue; // carta genérica (sem id) não recebe buff
        for (const [statName, bonus] of Object.entries(coach.buffs)) {
            const stat = normalizeStatName(statName);
            if (!stat) continue;
            card[stat] = Math.min(BONUS_CONFIG.statCap, num(card[stat]) + Number(bonus || 0) * BONUS_CONFIG.coachScale);
        }
        syncCardStats(card);
    }
    return coach;
}

async function getCoachId(discordId) {
    try {
        const rows = await query('SELECT treinador_id FROM players WHERE discord_id = ?', [discordId]);
        return rows && rows[0] ? rows[0].treinador_id || null : null;
    } catch (e) {
        console.warn('[matchBonuses] Erro ao buscar treinador:', e && e.message ? e.message : e);
        return null;
    }
}

async function getTeamSponsor(team) {
    if (!team || !team.patrocinio_id) return null;
    try {
        const rows = await query('SELECT id, nome, bonus_atributo, bonus_valor FROM patrocinios WHERE id = ?', [team.patrocinio_id]);
        return rows && rows[0] ? rows[0] : null;
    } catch (e) {
        console.warn('[matchBonuses] Erro ao buscar patrocínio:', e && e.message ? e.message : e);
        return null;
    }
}

// Quanto cada atributo vira em pontos de ataque / defesa do time
const SPONSOR_SPLIT = {
    finalizacao: { attack: 1, defense: 0 },
    drible: { attack: 1, defense: 0 },
    passe: { attack: 0.8, defense: 0.2 },
    posicionamento: { attack: 0.5, defense: 0.5 },
    saidaDeBola: { attack: 0.5, defense: 0.5 },
    defesa: { attack: 0, defense: 1 }
};

function sponsorToTeamBonus(sponsor) {
    if (!sponsor) return { attack: 0, defense: 0 };
    const stat = normalizeStatName(sponsor.bonus_atributo);
    const value = Number(sponsor.bonus_valor) || 0;
    if (!stat || value <= 0) return { attack: 0, defense: 0 };
    const points = Math.min(BONUS_CONFIG.sponsorMaxPoints, value * BONUS_CONFIG.sponsorPointsPerValue);
    const split = SPONSOR_SPLIT[stat] || { attack: 0.5, defense: 0.5 };
    return { attack: points * split.attack, defense: points * split.defense };
}

/**
 * Aplica treinador (nas cartas) e devolve o bônus de patrocínio (pontos de time).
 * @returns {{coach, sponsor, bonus: {attack:number, defense:number}}}
 */
async function applyTeamBonuses(cards, team) {
    const coachId = team && team.owner_discord_id ? await getCoachId(team.owner_discord_id) : null;
    const coach = coachId ? applyCoachBuffs(cards, coachId) : null;
    const sponsor = await getTeamSponsor(team);
    return { coach, sponsor, bonus: sponsorToTeamBonus(sponsor) };
}

module.exports = { BONUS_CONFIG, syncCardStats, applyCoachBuffs, getCoachId, getTeamSponsor, sponsorToTeamBonus, applyTeamBonuses };
