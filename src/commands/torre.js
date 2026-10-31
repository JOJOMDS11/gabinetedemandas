const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const crypto = require('crypto');

const { query, pool } = require('../database/connection');
const { getTeamByOwner } = require('../database/models/team');
const { getCardById } = require('../database/models/card');
const { getAllTemplates } = require('../database/models/playerTemplate');
const { simulateMatchRealtime, calculateTeamOverall } = require('../utils/matchSimulator');
const { generateCard, generateUpgradeCard, generateCardFromRandomTemplateByPosition } = require('../utils/cardGenerator');
const { createCommentator, buildLiveParts, getAmistosoStepMs, progressBar } = require('../utils/amistosoCommentary');
const { TREINADORES } = require('./treinador');
const { PACOTES } = require('./comprarpacote');
const amistosoHelpers = require('./amistoso').__test || {};
const { rolarEAplicar } = require('../utils/primeEspecial');
const { buildReminderRow } = require('./lembrete');

const TOTAL_FLOORS = 50;
const DAILY_LIVES = 3;
const MAX_LIVES = 5;
const LIFE_DROP_CHANCE = 0.05;
const LIFE_PURCHASE_COSTS = [1000, 2500];
const ASCENSION_MAX = 4;
const ASCENSION_REWARD_MULTIPLIERS = [1, 1.5, 2, 2.5, 3];
const ASCENSION_DIFFICULTY_STEP = 0.08;
const ASCENSION_PRESSURE_STEP = 0.02;
const BOSS_DIFFICULTY_STEP = 0.02; // cada chefe derrotado aumenta em 2 p.p. a força da IA nos blocos seguintes.
const BUFF_BREAK_CHANCE = 0.15;
const TREASURE_HUNTER_EVENT_CHANCE = 0.10;
const BUFF_SCALING_PER_BOSS = 0.5; // +0,5 em cada atributo dos buffs temporários por chefe já derrotado.
const RELIC_EVENT_PITY_BOSSES = 1; // se um chefe passar sem relíquia recebida, o próximo garante um baú.
const TOWER_EVENT_WEIGHTS = [
    { type: 'tesouro_escolhido', weight: 35 },
    { type: 'tesouro_surpresa', weight: 20 },
    { type: 'medico', weight: 15 },
    { type: 'mercador', weight: 15 },
    { type: 'arena', weight: 15 }
];

const TOWER_BUFFS = [
    { code: 'muralha', name: '🛡️ Muralha Inquebrável', category: 'defesa', description: '+7 DEF para GK e VL.', effects: { gk: { defesa: 7 }, vl: { defesa: 7 } } },
    { code: 'artilheiros', name: '🎯 Artilheiros Implacáveis', category: 'ataque', description: '+7 FIN para VL e PV.', effects: { vl: { finalizacao: 7 }, pv: { finalizacao: 7 } } },
    { code: 'tiki_taka', name: '⚡ Tiki-Taka', category: 'passe', description: '+7 PAS para todos os jogadores.', effects: { all: { passe: 7 } } },
    { code: 'drible_letal', name: '🌀 Drible Letal', category: 'drible', description: '+7 DRI para VL e PV.', effects: { vl: { drible: 7 }, pv: { drible: 7 } } },
    { code: 'olho_falcao', name: '👁️ Olho de Falcão', category: 'posicionamento', description: '+7 POS para GK e PV.', effects: { gk: { posicionamento: 7 }, pv: { posicionamento: 7 } } },
    { code: 'saida_limpa', name: '🧠 Saída Limpa', category: 'construcao', description: '+7 SAI para GK e +5 PAS para VL.', effects: { gk: { saidaDeBola: 7 }, vl: { passe: 5 } } }
];

const TOWER_RELICS = {
    // Legado: mantidas para não invalidar inventários já existentes.
    luvas_tita: { code: 'luvas_tita', name: '🧤 Luvas do Titã', rarity: 'legado', description: '+3 DEF para o goleiro nas partidas da Torre.' },
    chuteira_fantasma: { code: 'chuteira_fantasma', name: '👟 Chuteira Fantasma', rarity: 'legado', description: '+4 DRIBLE para o ponta nas partidas da Torre.' },
    cerebro_tatico: { code: 'cerebro_tatico', name: '🧠 Cérebro Tático', rarity: 'legado', description: '+2 aos atributos concedidos pelos buffs da Torre.' },
    segunda_chance: { code: 'segunda_chance', name: '❤️ Segunda Chance', rarity: 'legado', description: 'Compatibilidade com inventários antigos: evita uma perda de vida por ciclo.' },
    ima_cartas: { code: 'ima_cartas', name: '🧲 Ímã de Cartas', rarity: 'rara', description: '+5 p.p. na chance de carta extra; posição escolhida recebe peso dobrado.' },
    sangue_campeao: { code: 'sangue_campeao', name: '🩸 Sangue de Campeão', rarity: 'rara', description: '+2% de PC por vitória consecutiva, até +20%; derrota zera a sequência.' },
    fita_isolante: { code: 'fita_isolante', name: '🔎 Caçador de Tesouros', rarity: 'rara', description: 'Após vencer um andar comum, tem 10% de chance de encontrar um evento extra. Pode encontrar no máximo um evento entre cada dois chefes.' },
    kit_medico: { code: 'kit_medico', name: '🎁 Kit Médico', rarity: 'rara', description: 'Na derrota, recebe 20% da recompensa-base do andar em PC e tem 15% de chance de recuperar 1 vida. A tentativa de cura pode acontecer uma vez por dia, mesmo se falhar; reinicia à meia-noite de Brasília.' },
    investimento_inicial: { code: 'investimento_inicial', name: '🪙 Investimento Inicial', rarity: 'rara', description: 'Cada vitória tem 10% de chance de dobrar todos os PC recebidos naquele andar. Funciona em andares comuns e chefes; não multiplica cartas, pacotes ou fragmentos e não afeta o jackpot do andar 40.' },
    cacador_raridades: { code: 'cacador_raridades', name: '🎯 Caçador de Raridades', rarity: 'epica', description: 'Cada carta extra tem 20% de chance de subir uma raridade, até Prime.' },
    espolio_guerra: { code: 'espolio_guerra', name: '⚔️ Espólio de Guerra', rarity: 'epica', description: 'Chefes concedem uma carta garantida de raridade Médio ou superior.' },
    bussola_explorador: { code: 'bussola_explorador', name: '🧭 Bússola do Explorador', rarity: 'epica', description: 'Permite uma nova rolagem de evento por evento de chefe.' },
    mochila_emergencia: { code: 'mochila_emergencia', name: '🎒 Mochila de Emergência', rarity: 'epica', description: 'Em derrota contra chefe, tem 35% de chance de evitar a perda de vida. Só consome carga quando salva; começa com 1, máximo 2, e recupera 1 ao derrotar um chefe.' },
    aposta_ascendente: { code: 'aposta_ascendente', name: '🎰 Desafio do Ascendente', rarity: 'epica', description: 'Após derrotar um chefe, aposte 300, 400 ou 500 PC. Vença a revanche e a próxima luta para receber a aposta de volta, 5/8/12 fragmentos e uma carta Médio+ com chance crescente de GOAT/Prime.' },
    fenix: { code: 'fenix', name: '🔥 Fênix', rarity: 'lendaria', description: 'Evita uma perda de vida e recarrega ao derrotar um novo chefe.' },
    nucleo_purple: { code: 'nucleo_purple', name: '💜 Núcleo Purple', rarity: 'lendaria', description: 'Cada vitória sem carta extra adiciona +8 p.p. à chance seguinte (máx. 95%); ao sair carta, 20% de chance de uma segunda.' },
    coroa_espinhos: { code: 'coroa_espinhos', name: '👑 Coroa de Espinhos', rarity: 'lendaria', description: 'IA +4% mais forte; +25% PC na vitória, +10 p.p. carta extra e 20% de carta extra Médio+ por chefe.' },
    maestro_posicao: { code: 'maestro_posicao', name: '⚽ Maestro da Posição', rarity: 'lendaria', description: 'Escolha GK, VL ou PV: todos os atributos da posição recebem +5% nas partidas da Torre.' },
    espelho_destino: { code: 'espelho_destino', name: '🪞 Espelho do Destino', rarity: 'lendaria', description: 'Cada chefe derrotado concede 1 carga (máximo 1). Na próxima carta extra, escolha manter, refletir pela mesma raridade ou replicar.' },
    trono_ascendente: { code: 'trono_ascendente', name: '👑 Trono do Ascendente', rarity: 'suprema', description: 'Libera 1 slot adicional exclusivo para uma relíquia Lendária. Os dois slots normais continuam aceitando qualquer raridade.' },
    coracao_tita: { code: 'coracao_tita', name: '🐉 Coração do Titã', rarity: 'suprema', description: 'Na Ascensão 2+: cada chefe derrotado aumenta em 5% o PC das próximas vitórias, até +25%; a cada 5 combates comuns vencidos, +1 p.p. na chance de carta extra. Os bônus acumulam durante a run.' },
    ruptura_regras: { code: 'ruptura_regras', name: '🌀 Ruptura da Raridade', rarity: 'suprema', description: 'Cada carta recebida tem 10% de chance de subir uma raridade; +10 p.p. na chance de carta extra e +2% em todos os atributos do time nas partidas da Torre.' }
};
const RELIC_RARITY_ORDER = ['bagre', 'medio', 'goat', 'prime'];
const RELIC_RARITY_LABELS = { bagre: 'Bagre', medio: 'Médio', goat: 'GOAT', prime: 'Prime' };
const LEGENDARY_RELICS = new Set(['fenix', 'nucleo_purple', 'coroa_espinhos', 'maestro_posicao', 'espelho_destino']);
const SUPREME_RELICS = new Set(['trono_ascendente', 'coracao_tita', 'ruptura_regras']);
const RELIC_CRAFT_COSTS = {
 rara:{fragments:10,coins:2500,randomFragments:7,randomCoins:2000,reactivate:50},
 epica:{fragments:25,coins:4000,randomFragments:18,randomCoins:3000,reactivate:150},
 lendaria:{fragments:60,coins:10000,randomFragments:45,randomCoins:7000,reactivate:400},
 legado:{reactivate:50},
 suprema:{reactivate:800}
};
const RELIC_WEAR_MIN_ATTEMPTS = 7;
const RELIC_WEAR_MAX_ATTEMPTS = 14;
const ASCENDANT_CHALLENGE_STAKES = [300, 400, 500];
// Recompensa progressiva: apostar mais aumenta fragmentos e melhora a rolagem da carta.
const ASCENDANT_CHALLENGE_REWARDS = {
    300: { fragments: 5, cardWeights: { medio: 80, goat: 18, prime: 2 } },
    400: { fragments: 8, cardWeights: { medio: 65, goat: 28, prime: 7 } },
    500: { fragments: 12, cardWeights: { medio: 50, goat: 38, prime: 12 } }
};
const MERCHANT_OFFERS = [
 {code:'prep_ofensiva',name:'⚔️ Preparação Ofensiva',description:'+3% ataque até derrotar o próximo chefe.',price:700,kind:'attack',value:.03,duration:'boss'},
 {code:'blindagem',name:'🛡️ Blindagem',description:'+3% defesa até derrotar o próximo chefe.',price:700,kind:'defense',value:.03,duration:'boss'},
 {code:'sorte_grande',name:'🍀 Sorte Grande',description:'+5 p.p. de chance de carta extra e raridade melhorada por 3 andares elegíveis.',price:900,kind:'luck',value:.05,duration:'floors',count:3},
 {code:'investimento',name:'💰 Investimento',description:'+15% PC nas próximas 3 vitórias comuns; chefes não contam.',price:800,kind:'coins',value:.15,duration:'wins',count:3},
 {code:'recuperacao',name:'🩹 Recuperação',description:'Recupera imediatamente 1 vida (máximo 5).',price:1000,kind:'heal',value:1,duration:'instant'},
 {code:'leitura_adversario',name:'👁️ Leitura do Adversário',description:'IA 3% mais fraca nos próximos 3 combates comuns; chefes não contam.',price:800,kind:'weaken',value:.03,duration:'fights',count:3}
];


const TOWER_CONTRACTS = {
    sem_misericordia: { code: 'sem_misericordia', name: '☠️ Sem Misericórdia', description: 'IA recebe +5% de pressão. Recompensa em PC +30%.', pressure: 0.05, rewardMultiplier: 1.30 },
    canhao_vidro: { code: 'canhao_vidro', name: '💥 Canhão de Vidro', description: 'GK perde 5 DEF e PV ganha 8 FIN. Recompensa em PC +35%.', pressure: 0, rewardMultiplier: 1.35, userEffects: { gk: { defesa: -5 }, pv: { finalizacao: 8 } } },
    ultima_vida: { code: 'ultima_vida', name: '❤️ Última Vida', description: 'Só pode ser aceito com 1 vida. IA recebe +3% de pressão e recompensa em PC dobra.', pressure: 0.03, rewardMultiplier: 2, requiresOneLife: true }
};

const TIME_ZONE = 'America/Sao_Paulo';
const COMMON_DURATION_SECONDS = 180; // andar comum = 3 min (chefe continua 6 min)
const BOSS_DURATION_SECONDS = 360;
const POSITIONS = ['gk', 'vl', 'pv'];
const FLOOR_REWARDS = {
    normalBands: [
        { min: 2, max: 6 },
        { min: 4, max: 8 },
        { min: 10, max: 13 },
        { min: 15, max: 18 },
        { min: 20, max: 23 },
        { min: 25, max: 28 },
        { min: 30, max: 33 },
        { min: 35, max: 38 },
        { min: 40, max: 43 },
        { min: 45, max: 48 }
    ],
    bosses: {
        5:  { min: 120, max: 150, pack: 'normal' },
        10: { min: 130, max: 180, pack: 'normal' },
        15: { min: 140, max: 180, pack: 'normal' },
        20: { min: 150, max: 200, pack: 'super' },
        25: { min: 160, max: 210, pack: null },
        30: { min: 170, max: 220, pack: 'purple' },
        35: { min: 180, max: 230, pack: null },
        45: { min: 200, max: 250, pack: null }
    }
};

// Chance independente de receber UMA carta extra ao vencer andares comuns.
// No bloco 11–14, as proporções enviadas somam 95%; pickRarity normaliza os
// pesos proporcionalmente para fechar 100% sem inventar uma raridade nova.
const FLOOR_CARD_DROPS = [
    { minFloor: 1, maxFloor: 4, chance: 0.45, probabilities: { bagre: 75, medio: 25 } },
    { minFloor: 6, maxFloor: 9, chance: 0.45, probabilities: { bagre: 45, medio: 50, goat: 5 } },
    { minFloor: 11, maxFloor: 14, chance: 0.45, probabilities: { bagre: 35, medio: 55, goat: 5 } },
    { minFloor: 16, maxFloor: 19, chance: 0.45, probabilities: { bagre: 30, medio: 55, goat: 15 } },
    { minFloor: 21, maxFloor: 24, chance: 0.45, probabilities: { bagre: 30, medio: 55, goat: 15 } },
    { minFloor: 26, maxFloor: 29, chance: 0.45, probabilities: { bagre: 30, medio: 55, goat: 15 } },
    { minFloor: 31, maxFloor: 34, chance: 0.60, probabilities: { bagre: 25, medio: 50, goat: 23, prime: 2 } },
    { minFloor: 36, maxFloor: 44, chance: 0.60, probabilities: { bagre: 25, medio: 50, goat: 20, prime: 5 } },
    { minFloor: 46, maxFloor: 49, chance: 0.80, probabilities: { medio: 50, goat: 30, prime: 20 } }
];

let tablesReady = null;
const localLocks = new Set();

function randomInt(min, max, rng = Math.random) {
    return Math.floor(rng() * (max - min + 1)) + min;
}

function getAscendantChallengeReward(stake) {
    const normalizedStake = ASCENDANT_CHALLENGE_STAKES.includes(Number(stake)) ? Number(stake) : 300;
    const reward = ASCENDANT_CHALLENGE_REWARDS[normalizedStake];
    return { stake: normalizedStake, fragments: reward.fragments, cardWeights: { ...reward.cardWeights } };
}

async function generateAscendantChallengeBonusCard(stake, cardGenerator = generateCard, rng = Math.random) {
    const reward = getAscendantChallengeReward(stake);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        const rarity = pickRarity(reward.cardWeights, rng);
        try {
            const card = await cardGenerator(rarity, 'free');
            if (card) return { card, source: 'tower_ascendant_challenge' };
        } catch (error) {
            lastError = error;
        }
    }
    const suffix = lastError?.message ? ` (${lastError.message})` : '';
    throw new Error(`Não foi possível gerar a carta Médio+ do Desafio do Ascendente${suffix}. A aposta e o desafio foram preservados; tente novamente em instantes.`);
}

function shouldDoubleInvestmentReward(floor, relicCodes = [], rng = Math.random) {
    const safeFloor = Number(floor);
    if (!relicCodes.includes('investimento_inicial') || safeFloor === 40 || safeFloor === 50) return false;
    return rng() < 0.10;
}

function applyInvestmentDoubleReward(plan = {}, shouldDouble = false, floor = null) {
    const active = Boolean(shouldDouble) && Number(floor) !== 40 && Number(floor) !== 50;
    const coinsBefore = Math.max(0, Number(plan.coins) || 0);
    const packBonusBefore = Math.max(0, Number(plan.normalPackBonus) || 0);
    const bonusCoins = active ? coinsBefore + packBonusBefore : 0;
    const multiplier = active ? 2 : 1;
    return {
        ...plan,
        coins: Math.floor(coinsBefore * multiplier),
        normalPackBonus: Math.floor(packBonusBefore * multiplier),
        investmentDoubleApplied: active,
        investmentDoubleBonusCoins: bonusCoins
    };
}

function attemptKitMedicalHeal(relicState = {}, livesAfterDefeat, rng = Math.random) {
    const nextState = { ...relicState };
    const lives = Math.max(0, Number(livesAfterDefeat) || 0);
    if (Boolean(nextState.kitMedHealUsed) || lives >= MAX_LIVES) {
        return { relicState: nextState, lives, attempted: false, recovered: false };
    }
    // A falha também consome a única tentativa diária. O booleano é zerado na renovação diária.
    nextState.kitMedHealUsed = true;
    const recovered = rng() < 0.15;
    return {
        relicState: nextState,
        lives: recovered ? Math.min(MAX_LIVES, lives + 1) : lives,
        attempted: true,
        recovered
    };
}

function isAscendantChallengeFailure({ challenge, won }) {
    // A luta perdida continua sendo derrota mesmo quando Fênix, Mochila ou Segunda Chance preservam a vida.
    return Boolean(challenge && ['rematch', 'next'].includes(challenge.stage) && !won);
}

function pickWeightedRarity(rng = Math.random, weights = { rara: 60, epica: 30, lendaria: 10 }) {
    const entries = Object.entries(weights).filter(([, weight]) => Number(weight) > 0);
    const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
    let roll = rng() * total;
    for (const [rarity, weight] of entries) {
        roll -= Number(weight);
        if (roll < 0) return rarity;
    }
    return entries[entries.length - 1]?.[0] || 'rara';
}

function createRelicDurabilityEntry(rng = Math.random) {
    return { attempts: 0, limit: randomInt(RELIC_WEAR_MIN_ATTEMPTS, RELIC_WEAR_MAX_ATTEMPTS, rng) };
}

function advanceRelicDurability(relicState = {}, activeRelics = [], rng = Math.random) {
    const nextState = { ...relicState };
    const durability = { ...(nextState.relicDurability || {}) };
    const worn = [];
    for (const code of activeRelics) {
        const current = durability[code] || createRelicDurabilityEntry(rng);
        const attempts = Number(current.attempts || 0) + 1;
        const limit = Number(current.limit) || randomInt(RELIC_WEAR_MIN_ATTEMPTS, RELIC_WEAR_MAX_ATTEMPTS, rng);
        durability[code] = { attempts, limit };
        if (attempts >= limit) worn.push(code);
    }
    nextState.relicDurability = durability;
    return { relicState: nextState, worn };
}

function resetRelicDurability(relicState = {}, relicCodes = [], rng = Math.random) {
    const nextState = { ...relicState };
    const durability = { ...(nextState.relicDurability || {}) };
    for (const code of relicCodes) durability[code] = createRelicDurabilityEntry(rng);
    nextState.relicDurability = durability;
    return nextState;
}

function consumeMochilaCharge(relicState = {}, rng = Math.random) {
    const nextState = { ...relicState };
    const current = Number.isFinite(Number(nextState.mochilaCharges)) ? Number(nextState.mochilaCharges) : 1;
    if (current <= 0) {
        nextState.mochilaCharges = 0;
        return { relicState: nextState, used: false, saved: false };
    }
    // A carga só é consumida quando efetivamente evita a perda de vida.
    const saved = rng() < 0.35;
    if (!saved) return { relicState: nextState, used: false, saved: false };
    nextState.mochilaCharges = Math.max(0, current - 1);
    return { relicState: nextState, used: true, saved: true };
}

function advanceMerchantBuffs(relicState = {}, floor, won) {
    const buffs = Array.isArray(relicState.merchantBuffs) ? relicState.merchantBuffs : [];
    relicState.merchantBuffs = buffs.filter(buff => {
        // Buffs de ataque/defesa duram até derrotar um chefe, não apenas chegar nele.
        if (won && isBossFloor(floor) && buff.duration === 'boss') return false;
        if (!isBossFloor(floor)) {
            if (buff.kind === 'weaken' || buff.kind === 'luck' || (buff.kind === 'coins' && won)) {
                buff.remaining = Math.max(0, Number(buff.remaining || 0) - 1);
            }
        }
        return Number(buff.remaining || 1) > 0;
    });
    return relicState;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getSaoPauloDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
        dateKey: `${values.year}-${values.month}-${values.day}`,
        seasonKey: `${values.year}-${values.month}`
    };
}

function normalizeName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function parseStats(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return { ...raw };
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function numberOr(value, fallback = 50) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizeCard(card, role) {
    if (!card) return null;
    const raw = parseStats(card.stats);
    const stats = {
        posicionamento: numberOr(raw.posicionamento ?? card.posicionamento ?? card.pos, 50),
        saidaDeBola: numberOr(raw.saidaDeBola ?? card.saidaDeBola ?? card.sai, 50),
        defesa: numberOr(raw.defesa ?? card.defesa ?? card.def, 50),
        drible: numberOr(raw.drible ?? card.drible, 50),
        passe: numberOr(raw.passe ?? card.passe, 50),
        finalizacao: numberOr(raw.finalizacao ?? card.finalizacao, 50)
    };

    return {
        id: Number(card.id),
        player_name: card.player_name || card.template_name || `Jogador ${role.toUpperCase()}`,
        avatar: card.avatar || card.template_avatar || (role === 'gk' ? '🥅' : role === 'pv' ? '🎯' : '⚽'),
        overall_rating: numberOr(card.overall_rating ?? card.overall, 50),
        rarity: card.rarity || card.tier || 'Médio',
        role,
        position: role.toUpperCase(),
        ...stats,
        pos: stats.posicionamento,
        sai: stats.saidaDeBola,
        def: stats.defesa,
        stats,
        habilidade_equipada: card.habilidade_equipada || null,
        custom_border: card.custom_border || null,
        custom_background: card.custom_background || null,
        borda_cor1: card.borda_cor1 || null,
        borda_cor2: card.borda_cor2 || null,
        fundo_cor1: card.fundo_cor1 || null,
        fundo_cor2: card.fundo_cor2 || null
    };
}

function syncCardStats(card) {
    card.pos = numberOr(card.posicionamento, 50);
    card.sai = numberOr(card.saidaDeBola, 50);
    card.def = numberOr(card.defesa, 50);
    card.stats = {
        posicionamento: numberOr(card.posicionamento, 50),
        saidaDeBola: numberOr(card.saidaDeBola, 50),
        defesa: numberOr(card.defesa, 50),
        drible: numberOr(card.drible, 50),
        passe: numberOr(card.passe, 50),
        finalizacao: numberOr(card.finalizacao, 50)
    };
}

async function ensureTowerTables() {
    if (!tablesReady) {
        tablesReady = (async () => {
            await query(`
                CREATE TABLE IF NOT EXISTS tower_progress (
                    discord_id VARCHAR(32) PRIMARY KEY,
                    season_key VARCHAR(7) NOT NULL,
                    current_floor INTEGER NOT NULL DEFAULT 1,
                    best_floor INTEGER NOT NULL DEFAULT 0,
                    all_time_best_floor INTEGER NOT NULL DEFAULT 0,
                    lives INTEGER NOT NULL DEFAULT 3,
                    lives_reset_date DATE NOT NULL,
                    match_active BOOLEAN NOT NULL DEFAULT FALSE,
                    match_token VARCHAR(64),
                    match_started_at TIMESTAMPTZ,
                    completed_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);
            await query(`
                CREATE TABLE IF NOT EXISTS tower_floor_history (
                    discord_id VARCHAR(32) NOT NULL,
                    season_key VARCHAR(7) NOT NULL,
                    floor INTEGER NOT NULL,
                    ascension_level SMALLINT NOT NULL DEFAULT 0,
                    reward_coins INTEGER NOT NULL DEFAULT 0,
                    pack_type VARCHAR(32),
                    reward_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (discord_id, season_key, ascension_level, floor)
                )
            `);
            await query(`ALTER TABLE tower_floor_history ADD COLUMN IF NOT EXISTS ascension_level SMALLINT NOT NULL DEFAULT 0`);
            // A chave antiga não separava os andares de runs de ascensões diferentes.
            // Recria a PK incluindo a ascensão, sem apagar o histórico já existente.
            await query(`ALTER TABLE tower_floor_history DROP CONSTRAINT IF EXISTS tower_floor_history_pkey`);
            await query(`ALTER TABLE tower_floor_history ADD CONSTRAINT tower_floor_history_pkey PRIMARY KEY (discord_id, season_key, ascension_level, floor)`);
            // Campos extras do modo roguelike, ascensão e compra de vidas (migração idempotente).
            const towerColumns = [
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS lives_purchased_today SMALLINT NOT NULL DEFAULT 0`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS lives_purchase_date DATE`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS active_buff JSONB NOT NULL DEFAULT '{}'::jsonb`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS active_buff_until_floor INTEGER NOT NULL DEFAULT 0`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS buff_history JSONB NOT NULL DEFAULT '[]'::jsonb`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS pending_buff_options JSONB NOT NULL DEFAULT '[]'::jsonb`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS pending_buff_floor INTEGER`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS equipped_relics JSONB NOT NULL DEFAULT '[]'::jsonb`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS pending_event JSONB`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS active_contract JSONB`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS second_chance_used BOOLEAN NOT NULL DEFAULT FALSE`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS ascension_level SMALLINT NOT NULL DEFAULT 0`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS bosses_since_relic_event SMALLINT NOT NULL DEFAULT 0`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS relic_state JSONB NOT NULL DEFAULT '{}'::jsonb`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS relic_position VARCHAR(2)`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS relic_bet INTEGER NOT NULL DEFAULT 0`,
                `ALTER TABLE tower_progress ADD COLUMN IF NOT EXISTS relic_fragments INTEGER NOT NULL DEFAULT 0`
            ];
            for (const statement of towerColumns) await query(statement);
            // Quem já havia concluído a Torre antes da atualização recebe a primeira ascensão.
            await query(`UPDATE tower_progress SET ascension_level = 1, current_floor = 1, best_floor = 0, completed_at = NULL WHERE current_floor > 50 AND ascension_level = 0`);
            await query(`
                CREATE TABLE IF NOT EXISTS tower_relic_inventory (
                    relic_id BIGSERIAL PRIMARY KEY,
                    discord_id VARCHAR(32) NOT NULL,
                    relic_code VARCHAR(50) NOT NULL,
                    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    source VARCHAR(50) NOT NULL DEFAULT 'tower_event',
                    is_damaged BOOLEAN NOT NULL DEFAULT FALSE,
                    UNIQUE (discord_id, relic_code)
                )
            `);
            await query(`ALTER TABLE tower_relic_inventory ADD COLUMN IF NOT EXISTS is_damaged BOOLEAN NOT NULL DEFAULT FALSE`);
            await query(`CREATE INDEX IF NOT EXISTS idx_tower_relic_inventory_user ON tower_relic_inventory (discord_id, acquired_at DESC)`);

            await query(`
                CREATE INDEX IF NOT EXISTS idx_tower_progress_season_rank
                ON tower_progress (season_key, best_floor DESC, updated_at ASC)
            `);
            await query(`
                CREATE INDEX IF NOT EXISTS idx_tower_history_user_season
                ON tower_floor_history (discord_id, season_key, floor)
            `);
            await query(`
                CREATE INDEX IF NOT EXISTS idx_tower_history_user_season_ascension
                ON tower_floor_history (discord_id, season_key, ascension_level, floor)
            `);
            // O mesmo ledger utilizado pelo restante da economia do bot.
            await query(`
                CREATE TABLE IF NOT EXISTS player_transactions (
                    id SERIAL PRIMARY KEY,
                    discord_user_id VARCHAR(64) NOT NULL,
                    discord_username VARCHAR(255),
                    transaction_type VARCHAR(50) NOT NULL,
                    item_type VARCHAR(50),
                    item_name VARCHAR(255),
                    amount INTEGER NOT NULL DEFAULT 0,
                    balance_before INTEGER,
                    balance_after INTEGER,
                    metadata JSONB DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);
        })();
    }

    try {
        await tablesReady;
    } catch (error) {
        tablesReady = null;
        throw error;
    }
}

async function ensureProgressRow(discordId) {
    await ensureTowerTables();
    const { dateKey, seasonKey } = getSaoPauloDateParts();
    await query(`
        INSERT INTO tower_progress (discord_id, season_key, current_floor, best_floor, lives, lives_reset_date, lives_purchased_today, lives_purchase_date)
        VALUES (?, ?, 1, 0, ?, ?, 0, ?)
        ON CONFLICT (discord_id) DO NOTHING
        RETURNING discord_id
    `, [discordId, seasonKey, DAILY_LIVES, dateKey, dateKey]);

    let rows = await query(`
        SELECT *, TO_CHAR(lives_reset_date, 'YYYY-MM-DD') AS lives_reset_key
        FROM tower_progress WHERE discord_id = ?
    `, [discordId]);
    if (!rows.length) throw new Error('Não foi possível carregar seu progresso da Torre.');
    let state = rows[0];

    if (state.season_key !== seasonKey) {
        await query(`
            UPDATE tower_progress
            SET season_key = ?, current_floor = 1, best_floor = 0, lives = ?,
                lives_reset_date = ?, match_active = FALSE, match_token = NULL,
                match_started_at = NULL, completed_at = NULL,
                lives_purchased_today = 0, lives_purchase_date = ?,
                active_buff = '{}'::jsonb, active_buff_until_floor = 0,
                buff_history = '[]'::jsonb, pending_buff_options = '[]'::jsonb,
                pending_buff_floor = NULL, pending_event = NULL, active_contract = NULL,
                second_chance_used = FALSE, bosses_since_relic_event = 0,
                relic_state = COALESCE(relic_state, '{}'::jsonb) ||
                    '{"kitMedHealUsed":false,"mochilaCharges":1,"mirrorCharge":0,"phoenixReady":false,"titanStacks":0,"titanNormalWins":0,"nucleusCharge":0,"winStreak":0,"ruptureUsed":false,"compassUsedFloor":0,"challengeBossesUsed":[],"ascendantChallenge":null}'::jsonb,
                updated_at = NOW()
            WHERE discord_id = ?
        `, [seasonKey, DAILY_LIVES, dateKey, dateKey, discordId]);
    } else if (state.lives_reset_key !== dateKey) {
        await query(`
            UPDATE tower_progress
            SET lives = GREATEST(lives, ?), lives_reset_date = ?,
                lives_purchased_today = 0, lives_purchase_date = ?,
                relic_state = COALESCE(relic_state, '{}'::jsonb) || '{"kitMedHealUsed":false}'::jsonb,
                updated_at = NOW()
            WHERE discord_id = ?
        `, [DAILY_LIVES, dateKey, dateKey, discordId]);
    }

    rows = await query(`
        SELECT *, TO_CHAR(lives_reset_date, 'YYYY-MM-DD') AS lives_reset_key
        FROM tower_progress WHERE discord_id = ?
    `, [discordId]);
    state = rows[0];
    return state;
}

async function reserveTowerMatch(discordId) {
    await ensureTowerTables();
    const { dateKey, seasonKey } = getSaoPauloDateParts();
    const conn = await pool.getConnection();
    const token = crypto.randomUUID();

    try {
        await conn.beginTransaction();
        await conn.query(`
            INSERT INTO tower_progress (discord_id, season_key, current_floor, best_floor, lives, lives_reset_date, lives_purchased_today, lives_purchase_date)
            VALUES (?, ?, 1, 0, ?, ?, 0, ?)
            ON CONFLICT (discord_id) DO NOTHING
            RETURNING discord_id
        `, [discordId, seasonKey, DAILY_LIVES, dateKey, dateKey]);

        let [rows] = await conn.query(`
            SELECT *, TO_CHAR(lives_reset_date, 'YYYY-MM-DD') AS lives_reset_key
            FROM tower_progress WHERE discord_id = ? FOR UPDATE
        `, [discordId]);
        let state = rows[0];
        if (!state) throw new Error('Não foi possível reservar sua tentativa na Torre.');

        if (state.season_key !== seasonKey) {
            await conn.query(`
                UPDATE tower_progress SET season_key = ?, current_floor = 1, best_floor = 0,
                    lives = ?, lives_reset_date = ?, match_active = FALSE, match_token = NULL,
                    match_started_at = NULL, completed_at = NULL,
                    lives_purchased_today = 0, lives_purchase_date = ?,
                    active_buff = '{}'::jsonb, active_buff_until_floor = 0,
                    buff_history = '[]'::jsonb, pending_buff_options = '[]'::jsonb,
                    pending_buff_floor = NULL, pending_event = NULL, active_contract = NULL,
                    second_chance_used = FALSE, bosses_since_relic_event = 0,
                    relic_state = COALESCE(relic_state, '{}'::jsonb) || '{"kitMedHealUsed":false}'::jsonb,
                    updated_at = NOW()
                WHERE discord_id = ?
            `, [seasonKey, DAILY_LIVES, dateKey, dateKey, discordId]);
            state = { ...state, season_key: seasonKey, current_floor: 1, best_floor: 0, lives: DAILY_LIVES, match_active: false, lives_purchased_today: 0, lives_purchase_date: dateKey };
        } else if (state.lives_reset_key !== dateKey) {
            await conn.query(`UPDATE tower_progress SET lives = GREATEST(lives, ?), lives_reset_date = ?, lives_purchased_today = 0, lives_purchase_date = ?, relic_state = COALESCE(relic_state, '{}'::jsonb) || '{"kitMedHealUsed":false}'::jsonb, updated_at = NOW() WHERE discord_id = ?`, [DAILY_LIVES, dateKey, dateKey, discordId]);
            state.lives = Math.max(Number(state.lives), DAILY_LIVES);
        }

        if (state.match_active) {
            const startedAt = state.match_started_at ? new Date(state.match_started_at).getTime() : Date.now();
            const stale = !Number.isFinite(startedAt) || Date.now() - startedAt > 20 * 60 * 1000;
            if (!stale) {
                await conn.commit();
                return { allowed: false, reason: 'active', state };
            }
            await conn.query(`UPDATE tower_progress SET match_active = FALSE, match_token = NULL, match_started_at = NULL WHERE discord_id = ?`, [discordId]);
            state.match_active = false;
        }

        if (Number(state.current_floor) > TOTAL_FLOORS) {
            await conn.commit();
            return { allowed: false, reason: 'completed', state };
        }
        if (Number(state.lives) <= 0) {
            await conn.commit();
            return { allowed: false, reason: 'no_lives', state };
        }

        const floor = Number(state.current_floor);
        await conn.query(`
            UPDATE tower_progress
            SET match_active = TRUE, match_token = ?, match_started_at = NOW(), updated_at = NOW()
            WHERE discord_id = ?
        `, [token, discordId]);

        await conn.commit();
        return {
            allowed: true,
            token,
            floor,
            lives: Number(state.lives),
            seasonKey,
            state
        };
    } catch (error) {
        try { await conn.rollback(); } catch (_) { }
        throw error;
    } finally {
        conn.release();
    }
}

function isBossFloor(floor) {
    return floor % 5 === 0;
}

function rollLifeBonus(floor, rng = Math.random) {
    if (floor >= TOTAL_FLOORS) return { won: false, source: null };
    if (isBossFloor(floor)) return { won: true, source: 'boss' };
    if (rng() < LIFE_DROP_CHANCE) return { won: true, source: 'sorte' };
    return { won: false, source: null };
}

function clampAscensionLevel(level) {
    return clamp(Math.floor(Number(level) || 0), 0, ASCENSION_MAX);
}

function getAscensionRewardMultiplier(level) {
    return ASCENSION_REWARD_MULTIPLIERS[clampAscensionLevel(level)];
}

function getAscensionLabel(level) {
    const safeLevel = clampAscensionLevel(level);
    return safeLevel === 0 ? 'Base' : `Ascensão ${safeLevel}/${ASCENSION_MAX}`;
}

function formatRewardMultiplier(value) {
    return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function getBossProgressionBonus(floor) {
    const safeFloor = clamp(Number(floor) || 1, 1, TOTAL_FLOORS);
    // O primeiro chefe mantém a dificuldade-base. Cada chefe já derrotado
    // acrescenta +2 pontos percentuais aos andares do bloco seguinte.
    const defeatedBosses = Math.floor((safeFloor - 1) / 5);
    return defeatedBosses * BOSS_DIFFICULTY_STEP;
}

function getMaxDifficultyMultiplier(ascensionLevel = 0) {
    const bossProgressionCap = Math.floor((TOTAL_FLOORS - 1) / 5) * BOSS_DIFFICULTY_STEP;
    return 1.25 + bossProgressionCap + clampAscensionLevel(ascensionLevel) * ASCENSION_DIFFICULTY_STEP;
}

function getDifficultyMultiplier(floor, ascensionLevel = 0) {
    const safeFloor = clamp(Number(floor) || 1, 1, TOTAL_FLOORS);
    const ascensionBonus = clampAscensionLevel(ascensionLevel) * ASCENSION_DIFFICULTY_STEP;
    const bossProgressionBonus = getBossProgressionBonus(safeFloor);
    const curveAt = value => {
        const t = (value - 1) / (TOTAL_FLOORS - 1);
        return 0.78 + 0.42 * Math.pow(t, 1.25);
    };

    const currentBase = curveAt(safeFloor);
    const currentDifficulty = currentBase + (isBossFloor(safeFloor) ? 0.05 : 0);

    // O bônus do chefe anterior mantém uma rampa mínima entre blocos.
    const previousBoss = Math.floor((safeFloor - 1) / 5) * 5;
    let baseDifficulty = currentDifficulty;
    if (previousBoss >= 5 && !isBossFloor(safeFloor)) {
        const previousBossDifficulty = curveAt(previousBoss) + 0.05;
        const afterBossRamp = previousBossDifficulty + (safeFloor - previousBoss) * 0.002;
        baseDifficulty = Math.max(currentDifficulty, afterBossRamp);
    }

    // Além da curva contínua, cada chefe derrotado fortalece a IA em 2 p.p.
    return clamp(baseDifficulty + bossProgressionBonus + ascensionBonus, 0.78, getMaxDifficultyMultiplier(ascensionLevel));
}

function getBuffScalingBonus(floor) {
    const safeFloor = clamp(Number(floor) || 1, 1, TOTAL_FLOORS);
    // O buff do chefe 5 é o valor-base; depois de cada chefe derrotado,
    // o próximo bloco recebe +0,5 em cada atributo positivo do buff temporário.
    const defeatedBosses = Math.floor((safeFloor - 1) / 5);
    return defeatedBosses * BUFF_SCALING_PER_BOSS;
}

function formatBuffAmount(value) {
    const amount = Number(value) || 0;
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(1).replace('.', ',');
}

function getBuffDisplayDescription(buff, floor) {
    if (!buff) return '';
    const bonus = getBuffScalingBonus(floor);
    if (!bonus) return buff.description;
    return buff.description.replace(/\+(\d+(?:[.,]\d+)?)/g, (_, raw) => {
        const base = Number(String(raw).replace(',', '.'));
        return `+${formatBuffAmount(base + bonus)}`;
    }) + ` (escala do bloco: +${formatBuffAmount(bonus)} por atributo)`;
}

function getBuffUntilFloor(startFloor) {
    const safeFloor = clamp(Number(startFloor) || 1, 1, TOTAL_FLOORS);
    const nextBossFloor = (Math.floor(safeFloor / 5) + 1) * 5;
    return Math.min(TOTAL_FLOORS, Math.max(safeFloor, nextBossFloor - 1));
}

function isBuffExpiredAtFloor(activeBuff, floor) {
    if (!activeBuff || !activeBuff.code) return false;
    const startFloor = Number(activeBuff.startFloor || 0);
    const untilFloor = Number(activeBuff.untilFloor || 0);
    return Number(floor) > untilFloor || (isBossFloor(floor) && Number(floor) > startFloor);
}

function getRelicPityAfterBoss(currentCount, bossDefeated, relicClaimed = false) {
    if (relicClaimed) return 0;
    const current = clamp(Number(currentCount) || 0, 0, RELIC_EVENT_PITY_BOSSES);
    return bossDefeated ? Math.min(RELIC_EVENT_PITY_BOSSES, current + 1) : current;
}

function shouldSaveLifeWithSecondChance(relicCodes, alreadyUsed) {
    return Array.isArray(relicCodes) && relicCodes.includes('segunda_chance') && !Boolean(alreadyUsed);
}

function shouldBuffBreak(activeBuff, floor, rng = Math.random) {
    if (!activeBuff || !activeBuff.code) return false;
    const startFloor = Number(activeBuff.startFloor || 0);
    const untilFloor = Number(activeBuff.untilFloor || 0);
    if (floor <= startFloor || floor > untilFloor || isBossFloor(floor)) return false;
    return rng() < BUFF_BREAK_CHANCE;
}

function getNormalFloorBaseRange(floor) {
    const bandIndex = clamp(Math.floor((floor - 1) / 5), 0, FLOOR_REWARDS.normalBands.length - 1);
    return FLOOR_REWARDS.normalBands[bandIndex];
}

function getFloorCardDropRule(floor) {
    return FLOOR_CARD_DROPS.find(rule => floor >= rule.minFloor && floor <= rule.maxFloor) || null;
}

function getFloorRewardRange(floor) {
    if (floor === 50) {
        return { minCoins: 0, maxCoins: 0, packType: 'superpurple', packName: PACOTES?.superpurple?.nome || 'Pacote Super Purple', multiplier: null, extraCardChance: 0 };
    }
    if (floor === 40) {
        const dropRule = getFloorCardDropRule(floor);
        return { minCoins: 2500, maxCoins: 15000, packType: null, packName: null, multiplier: null, jackpot: '10% de chance de multiplicar por ×2 a ×6', extraCardChance: dropRule ? dropRule.chance : 0, extraCardProbabilities: dropRule ? dropRule.probabilities : null };
    }

    const range = isBossFloor(floor) ? FLOOR_REWARDS.bosses[floor] : getNormalFloorBaseRange(floor);
    if (!range) throw new Error(`Faixa de recompensa do andar ${floor} não encontrada.`);
    const multiplier = floor / 2;
    const packType = isBossFloor(floor) ? (FLOOR_REWARDS.bosses[floor]?.pack || null) : null;
    const dropRule = getFloorCardDropRule(floor);
    return {
        minCoins: Math.floor(range.min * multiplier),
        maxCoins: Math.floor(range.max * multiplier),
        packType,
        packName: packType === 'normal' ? 'Pacote Normal (3 cartas)' : packType ? (PACOTES?.[packType]?.nome || packType) : null,
        multiplier,
        extraCardChance: dropRule ? dropRule.chance : 0,
        extraCardProbabilities: dropRule ? dropRule.probabilities : null
    };
}

function calculateFloorReward(floor, rng = Math.random) {
    if (floor === 50) {
        return { coins: 0, packType: 'superpurple', packName: PACOTES?.superpurple?.nome || 'Super Purple', multiplier: null, baseCoins: 0 };
    }

    if (floor === 40) {
        const multiplied = rng() < 0.10;
        const multiplier = multiplied ? Math.floor(rng() * 5) + 2 : 1;
        return {
            coins: 2500 * multiplier,
            packType: null,
            packName: null,
            multiplier: multiplied ? multiplier : null,
            baseCoins: 2500
        };
    }

    const range = isBossFloor(floor) ? FLOOR_REWARDS.bosses[floor] : getNormalFloorBaseRange(floor);
    if (!range) throw new Error(`Configuração de recompensa do andar ${floor} não encontrada.`);
    const baseCoins = randomInt(range.min, range.max, rng);
    const coins = Math.floor(baseCoins * (floor / 2));
    const packType = isBossFloor(floor) ? (FLOOR_REWARDS.bosses[floor]?.pack || null) : null;
    return {
        coins,
        baseCoins,
        multiplier: floor / 2,
        packType,
        packName: packType === 'normal' ? 'Pacote Normal (3 cartas)' : packType ? (PACOTES?.[packType]?.nome || packType) : null
    };
}

function calculateKitMedicalBaseReward(floor, rng = Math.random) {
    // O andar 40 tem jackpot próprio (×2 a ×6); o Kit Médico calcula 20% da base, antes desse sorteio.
    if (Number(floor) === 40) return 2500;
    return Number(calculateFloorReward(Number(floor), rng).coins) || 0;
}

function mapRarityKey(key) {
    const value = String(key || '').toLowerCase();
    if (value === 'purpleprime') return 'Prime Purple';
    if (value === 'prime') return 'Prime';
    if (value === 'goat') return 'GOAT';
    if (value === 'medio' || value === 'médio') return 'Médio';
    return 'Bagre';
}

function pickRarity(probabilities, rng = Math.random) {
    const entries = Object.entries(probabilities || {})
        .map(([key, value]) => [key, Math.max(0, Number(value) || 0)])
        .filter(([, weight]) => weight > 0);
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    if (!entries.length || total <= 0) return 'Bagre';
    const roll = rng() * total;
    let accumulated = 0;
    for (const [key, weight] of entries) {
        accumulated += weight;
        if (roll < accumulated) return mapRarityKey(key);
    }
    return mapRarityKey(entries[entries.length - 1][0]);
}

function getRelicExtraCardChance(floor, relicCodes = [], relicState = {}) {
    const rule = getFloorCardDropRule(floor);
    if (!rule) return 0;
    let chance = rule.chance;
    if (relicCodes.includes('ima_cartas')) chance += 0.05;
    if (relicCodes.includes('nucleo_purple')) chance += Math.min(0.95, Number(relicState.nucleusCharge || 0) * 0.08);
    if (relicCodes.includes('coroa_espinhos')) chance += 0.10;
    if (relicCodes.includes('ruptura_regras')) chance += 0.10;
    chance += getTitanNormalDropBonus(relicCodes, relicState);
    if ((relicState.merchantBuffs || []).some(b => b.kind === 'luck' && Number(b.remaining || 0) > 0)) chance += 0.05;
    return Math.min(0.95, chance);
}

function normalizeTowerRarityKey(rarity) {
    const key = String(rarity || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    if (key.includes('prime')) return 'prime';
    if (key.includes('goat')) return 'goat';
    if (key.includes('medio')) return 'medio';
    if (key.includes('bagre')) return 'bagre';
    return null;
}

function upgradeRarityBand(rarity) {
    const key = normalizeTowerRarityKey(rarity);
    const index = RELIC_RARITY_ORDER.indexOf(key);
    if (index < 0) return null;
    return RELIC_RARITY_LABELS[RELIC_RARITY_ORDER[Math.min(RELIC_RARITY_ORDER.length - 1, index + 1)]];
}

function getTitanBossPcBonus(relicCodes = [], ascensionLevel = 0, relicState = {}) {
    if (!relicCodes.includes('coracao_tita') || Number(ascensionLevel) < 2) return 0;
    const bossStacks = clamp(Number(relicState.titanStacks) || 0, 0, 5);
    return bossStacks * 0.05;
}

function applyTitanPcBonus(plan = {}) {
    const multiplier = Math.max(1, Number(plan.titanPcBonusMultiplier) || 1);
    return {
        ...plan,
        coins: Math.floor(Math.max(0, Number(plan.coins) || 0) * multiplier),
        normalPackBonus: Math.floor(Math.max(0, Number(plan.normalPackBonus) || 0) * multiplier)
    };
}

function getTitanNormalDropBonus(relicCodes = [], relicState = {}) {
    if (!relicCodes.includes('coracao_tita')) return 0;
    const normalWins = Math.max(0, Math.floor(Number(relicState.titanNormalWins) || 0));
    return Math.floor(normalWins / 5) * 0.01;
}

async function applyRupturaRarityUpgrades(rewardCards = [], relicCodes = [], rng = Math.random, cardGenerator = generateCard) {
    const cards = Array.isArray(rewardCards) ? [...rewardCards] : [];
    if (!relicCodes.includes('ruptura_regras')) return { cards, upgradedCount: 0 };
    let upgradedCount = 0;
    for (let index = 0; index < cards.length; index++) {
        const entry = cards[index];
        const originalCard = entry?.card;
        if (!originalCard || normalizeTowerRarityKey(originalCard.rarity) === 'prime') continue;
        const nextRarity = upgradeRarityBand(originalCard.rarity);
        if (!nextRarity || rng() >= 0.10) continue;
        try {
            const upgradedCard = await cardGenerator(nextRarity, 'free');
            if (upgradedCard) {
                cards[index] = { ...entry, card: upgradedCard, rarityUpgradedFrom: originalCard.rarity };
                upgradedCount++;
            }
        } catch (error) {
            // Um upgrade opcional que falha não pode invalidar a recompensa original.
            console.warn('[torre] Não foi possível melhorar a raridade pela Ruptura:', error.message);
        }
    }
    return { cards, upgradedCount };
}

function validateRelicLoadout(selected = [], ascensionLevel = 0) {
    if (!Array.isArray(selected)) throw new Error('Seleção de relíquias inválida.');
    if (new Set(selected).size !== selected.length) throw new Error('Você não pode equipar duas cópias da mesma relíquia.');
    if (selected.some(code => !TOWER_RELICS[code])) throw new Error('Uma das relíquias selecionadas é inválida.');
    const supremeCount = selected.filter(code => SUPREME_RELICS.has(code)).length;
    if (supremeCount > 1) throw new Error('Você só pode equipar uma relíquia Suprema por vez.');
    if (supremeCount > 0 && Number(ascensionLevel) < 2) throw new Error('Relíquias Supremas só podem ser equipadas a partir da Ascensão 2.');
    const hasThrone = selected.includes('trono_ascendente');
    const normalRelics = selected.filter(code => !SUPREME_RELICS.has(code));
    if (!hasThrone && normalRelics.length > 2) throw new Error('Você pode equipar até 2 relíquias normais. O slot Supremo é separado.');
    if (hasThrone && normalRelics.length > 3) throw new Error('Com o Trono, você pode equipar até 3 relíquias normais: 2 livres e 1 Lendária adicional.');
    if (hasThrone && normalRelics.length === 3 && !normalRelics.some(code => LEGENDARY_RELICS.has(code))) {
        throw new Error('O terceiro slot liberado pelo Trono aceita somente uma relíquia Lendária.');
    }
    return { hasThrone, normalCount: normalRelics.length, supremeCount };
}

function findLastLegendaryRelicIndex(codes = []) {
    for (let index = codes.length - 1; index >= 0; index--) {
        if (LEGENDARY_RELICS.has(codes[index])) return index;
    }
    return -1;
}

function normalizeRelicLoadout(selected = []) {
    const codes = Array.isArray(selected) ? selected : [];
    const supremes = codes.filter(code => SUPREME_RELICS.has(code)).slice(0, 1);
    const normals = codes.filter(code => !SUPREME_RELICS.has(code));

    // Com Trono e três relíquias não-Supremas, o slot adicional fica sempre
    // serializado por último e reservado a uma Lendária. Assim, se o Trono
    // desgastar, esse último slot pode ser desativado sem remover os dois normais.
    if (supremes.includes('trono_ascendente') && normals.length === 3) {
        const extraIndex = findLastLegendaryRelicIndex(normals);
        if (extraIndex >= 0) {
            const [extraLegendary] = normals.splice(extraIndex, 1);
            return [...normals.slice(0, 2), extraLegendary, ...supremes];
        }
    }
    return [...normals.slice(0, 3), ...supremes];
}

function applyOperationalRelicSlots(equippedCodes = []) {
    const codes = Array.isArray(equippedCodes) ? equippedCodes : [];
    const activeSupremes = codes.filter(code => SUPREME_RELICS.has(code)).slice(0, 1);
    const normalCodes = codes.filter(code => !SUPREME_RELICS.has(code));
    let activeNormals = normalCodes.slice(0, 2);

    if (activeSupremes.includes('trono_ascendente') && normalCodes.length > 2) {
        // O terceiro slot só pode ser Lendário. Reordena também seleções antigas.
        const extraIndex = findLastLegendaryRelicIndex(normalCodes);
        if (extraIndex >= 0) {
            const extraLegendary = normalCodes[extraIndex];
            const regularSlots = normalCodes.filter((_, index) => index !== extraIndex).slice(0, 2);
            activeNormals = [...regularSlots, extraLegendary];
        }
    } else if (!activeSupremes.includes('trono_ascendente') && normalCodes.length > 2) {
        // Sem Trono (inclusive quando ele está desgastado), desativa a Lendária
        // que ocupava a vaga adicional e mantém os dois slots normais.
        const extraIndex = findLastLegendaryRelicIndex(normalCodes);
        const regularSlots = extraIndex >= 0
            ? normalCodes.filter((_, index) => index !== extraIndex)
            : normalCodes;
        activeNormals = regularSlots.slice(0, 2);
    }

    const allowedNormals = new Set(activeNormals);
    return codes.filter(code => SUPREME_RELICS.has(code)
        ? activeSupremes.includes(code)
        : allowedNormals.has(code));
}

async function generateTowerExtraCard(floor, rng = Math.random, relicCodes = [], relicState = {}) {
    const rule = getFloorCardDropRule(floor);
    const effectiveChance = getRelicExtraCardChance(floor, relicCodes, relicState);
    if (!rule || rng() >= effectiveChance) return null;
    let rarity = pickRarity(rule.probabilities, rng);
    const luckActive = (relicState.merchantBuffs || []).some(b => b.kind === 'luck' && Number(b.remaining || 0) > 0);
    if ((relicCodes.includes('cacador_raridades') || luckActive) && rng() < (0.20 + (luckActive ? 0.05 : 0))) rarity = upgradeRarityBand(rarity);
    try {
        let card;
        const position = relicCodes.includes('ima_cartas') ? (relicState.imaPosition || 'gk') : null;
        if (position && POSITIONS.includes(position)) {
            // Distribuição 2:1:1: escolhida = 50%; cada uma das outras = 25%.
            const target = rng() < 0.5 ? position : POSITIONS.filter(role => role !== position)[Math.floor(rng() * 2)];
            card = await generateCardFromRandomTemplateByPosition(target.toUpperCase(), rarity, 'free');
        } else {
            card = await generateCard(rarity, 'free');
        }
        if (!card) return null;
        return { card, source: 'tower_extra_card' };
    } catch (error) {
        // Falha de uma carta bônus não deve apagar a recompensa principal do andar.
        console.warn(`[torre] Não foi possível gerar carta extra no andar ${floor}:`, error.message);
        return null;
    }
}

async function generateTowerPack(packType) {
    const cards = [];
    if (packType === 'normal') {
        for (let i = 0; i < 3; i++) {
            const card = await generateCard();
            if (!card) throw new Error('Não foi possível gerar uma das cartas do pacote normal.');
            cards.push({ card, source: 'tower_normal_pack' });
        }
        return { cards, label: 'Pacote Normal (3 cartas)', normalPackBonus: cards.length * 5 };
    }

    const pack = PACOTES && PACOTES[packType];
    if (!pack) throw new Error(`Tipo de pacote de recompensa desconhecido: ${packType}`);

    const packGeneratorType = packType === 'superpurple'
        ? 'super_purple'
        : packType === 'purplesupremo'
            ? 'supremo'
            : 'free';
    const mainRarity = pickRarity(pack.probabilidades);
    const mainCard = await generateCard(mainRarity, packGeneratorType);
    if (!mainCard) throw new Error(`Não foi possível gerar o pacote ${pack.nome}.`);
    cards.push({ card: mainCard, source: `tower_${packType}` });

    // Reproduz a chance de pacote extra usada por /comprarpacote, sem cobrar PC.
    if (Array.isArray(pack.extra) && pack.extra.length > 0) {
        const templates = await getAllTemplates();
        if (templates.length > 1) {
            const roll = Math.random();
            let acc = 0;
            let extraType = null;
            for (const option of pack.extra) {
                acc += Number(option.chance) || 0;
                if (roll < acc) {
                    extraType = option.tipo;
                    break;
                }
            }
            const extraPack = extraType && PACOTES[extraType];
            if (extraPack) {
                const extraRarity = pickRarity(extraPack.probabilidades || PACOTES.normal.probabilidades);
                const extraCard = await generateUpgradeCard(extraRarity);
                if (extraCard) cards.push({ card: extraCard, source: `tower_extra_${extraType}` });
            }
        }
    }

    return { cards, label: pack.nome, normalPackBonus: 0 };
}

async function insertTowerCard(conn, discordId, card, source) {
    const stats = card.stats || {};
    const rarity = String(card.rarity || 'Bagre');
    const values = [
        discordId,
        card.template_id || null,
        card.player_name || 'Jogador',
        String(card.position || 'VL').toUpperCase(),
        card.avatar || '⚽',
        rarity,
        Number(card.overall) || 50,
        source,
        JSON.stringify(stats),
        Number(stats.posicionamento) || 0,
        Number(stats.saidaDeBola) || 0,
        Number(stats.defesa) || 0,
        Number(stats.drible) || 0,
        Number(stats.passe) || 0,
        Number(stats.finalizacao) || 0,
        0,
        0,
        0,
        true,
        card.colecao_id || null
    ];
    const [insert] = await conn.query(`
        INSERT INTO user_cards (
            discord_id, template_id, player_name, position, avatar, rarity, overall_rating,
            source, stats, posicionamento, saidaDeBola, defesa, drible, passe, finalizacao,
            goals_conceded, clean_sheets, own_goals, negociavel, colecao_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
    `, values);
    if (!insert || !insert.insertId) throw new Error('Falha ao salvar carta de recompensa da Torre.');
    return Number(insert.insertId);
}

async function releaseTowerMatch(discordId, token) {
    try {
        await query(`
            UPDATE tower_progress
            SET match_active = FALSE, match_token = NULL, match_started_at = NULL, updated_at = NOW()
            WHERE discord_id = ? AND match_token = ? AND match_active = TRUE
        `, [discordId, token]);
    } catch (error) {
        console.warn('[torre] Não foi possível liberar a tentativa:', error.message);
    }
}

async function rollNormalRelicReward(conn, discordId, floor, ascensionLevel = 0) {
    if (isBossFloor(floor)) return null;
    const roll = Math.random();
    if (roll < 0.20) {
        await conn.query('UPDATE tower_progress SET relic_fragments = COALESCE(relic_fragments,0) + 1 WHERE discord_id = ?', [discordId]);
        return {text:'🧩 Recompensa extra: +1 Fragmento de Relíquia.'};
    }
    if (roll >= 0.25) return null;
    const [rows] = await conn.query('SELECT relic_code FROM tower_relic_inventory WHERE discord_id = ?', [discordId]);
    const owned = new Set((rows || []).map(r => r.relic_code));
    const rollTier = Math.random();
    const rarity = Number(ascensionLevel) >= 2 && rollTier < 0.01
        ? 'suprema'
        : rollTier < 0.75 ? 'rara' : rollTier < 0.97 ? 'epica' : 'lendaria';
    let pool = Object.values(TOWER_RELICS).filter(r => r.rarity === rarity && !owned.has(r.code));
    if (!pool.length) pool = Object.values(TOWER_RELICS).filter(r => ['rara','epica','lendaria'].includes(r.rarity) && !owned.has(r.code));
    if (pool.length) {
        const relic = pool[randomInt(0,pool.length-1)];
        await conn.query('INSERT INTO tower_relic_inventory (discord_id,relic_code,source,is_damaged) VALUES (?,?,?,FALSE) ON CONFLICT (discord_id,relic_code) DO NOTHING', [discordId,relic.code,'tower_normal_drop']);
        const details = getRelicChoiceDetails(relic.code);
        return {text:`🧿 **RELÍQUIA ENCONTRADA!**\n**${relic.name}**\n**Raridade:** ${details?.rarityBadge || '⚪ RARIDADE DESCONHECIDA'}\n**Efeito:** ${details?.description || 'Descrição indisponível.'}\n\nAdicionada à sua coleção. Use /torre reliquias para equipá-la.`};
    }
    const [pr] = await conn.query('SELECT purple_coins,purple_coins_earned,username,name FROM players WHERE discord_id = ? FOR UPDATE',[discordId]);
    if (!pr?.[0]) return null;
    const player=pr[0], before=Number(player.purple_coins)||0, after=before+250;
    await conn.query('UPDATE players SET purple_coins=?, purple_coins_earned=COALESCE(purple_coins_earned,0)+250, updated_at=NOW() WHERE discord_id=?',[after,discordId]);
    await conn.query(`INSERT INTO player_transactions (discord_user_id,discord_username,transaction_type,item_type,item_name,amount,balance_before,balance_after,metadata) VALUES (?,?,'GAIN','tower_relic_duplicate','Relíquia duplicada de combate normal',250,?,?,?) RETURNING id`,[discordId,player.username||player.name||null,before,after,JSON.stringify({source:'tower_normal_relic_drop',floor})]);
    return {text:'🎁 A relíquia duplicada foi convertida em +250 PC.'};
}

async function finalizeTowerMatch({ discordId, token, floor, won, rewardPlan, packCards, challengeMode = false }) {
    const conn = await pool.getConnection();
    const primeCardIds = [];
    let balance = null;
    let cardIds = [];
    let newLives = null;
    let nextFloor = floor;
    let lifeGained = false;
    let lifeSavedByRelic = false;
    let lifeSavedByMochila = false;
    let lifeRecoveredByKit = false;
    let kitMedicalHealAttempted = false;
    let kitMedicalCoins = 0;
    // Mantém a recompensa-base no escopo da transação para registrar corretamente o histórico do Kit Médico.
    let baseReward = 0;
    let buffBroken = false;
    let buffExpired = false;
    let pendingEvent = null;
    let resultAscensionLevel = 0;
    let resultAscensionUnlockedLevel = null;
    let resultTowerCompleted = false;
    let normalRelicReward = null;
    let newlyWornRelics = [];
    let ascendantChallengeWon = false;
    let ascendantChallengeFailed = false;
    let ascendantChallengeStake = 0;
    let relicStateForResult = {};
    let equippedRelicsForResult = [];

    try {
        await conn.beginTransaction();
        const [progressRows] = await conn.query(
            'SELECT * FROM tower_progress WHERE discord_id = ? FOR UPDATE',
            [discordId]
        );
        const state = progressRows && progressRows[0];
        const relicStateBefore = parseTowerJson(state?.relic_state, {});
        relicStateForResult = relicStateBefore;
        const challenge = relicStateBefore.ascendantChallenge || null;
        const expectedCurrentFloor = challengeMode && challenge?.stage === 'rematch'
            ? Number(challenge.bossFloor) + 1
            : floor;
        if (!state || !state.match_active || state.match_token !== token || Number(state.current_floor) !== expectedCurrentFloor) {
            throw new Error('Esta tentativa da Torre não está mais ativa. Nenhuma recompensa foi processada.');
        }

        const selectedRelics = parseTowerJson(state.equipped_relics, []);
        let relicInventoryRows = [];
        if (selectedRelics.length) {
            const marks = selectedRelics.map(() => '?').join(',');
            const [rows] = await conn.query(
                `SELECT relic_code, is_damaged FROM tower_relic_inventory WHERE discord_id = ? AND relic_code IN (${marks}) FOR UPDATE`,
                [discordId, ...selectedRelics]
            );
            relicInventoryRows = rows || [];
        }
        const inventoryByCode = new Map(relicInventoryRows.map(row => [row.relic_code, row]));
        const equippedRelics = applyOperationalRelicSlots(
            selectedRelics.filter(code => !inventoryByCode.get(code)?.is_damaged)
        );
        equippedRelicsForResult = equippedRelics;
        const wearResult = advanceRelicDurability(relicStateBefore, equippedRelics);
        const relicState = wearResult.relicState;
        newlyWornRelics = wearResult.worn;
        if (newlyWornRelics.length) {
            const marks = newlyWornRelics.map(() => '?').join(',');
            await conn.query(
                `UPDATE tower_relic_inventory SET is_damaged = TRUE WHERE discord_id = ? AND relic_code IN (${marks})`,
                [discordId, ...newlyWornRelics]
            );
        }

        if (challengeMode && won) {
            if (!challenge || challenge.stage !== 'rematch') throw new Error('A revanche do Desafio do Ascendente não está ativa.');
            relicState.ascendantChallenge = { ...challenge, stage: 'next', rematchWon: true, rematchWonAt: new Date().toISOString() };
            await conn.query(`
                UPDATE tower_progress
                SET relic_state = ?::jsonb, active_contract = NULL,
                    match_active = FALSE, match_token = NULL, match_started_at = NULL,
                    updated_at = NOW()
                WHERE discord_id = ? AND match_token = ? AND match_active = TRUE
            `, [JSON.stringify(relicState), discordId, token]);
            newLives = Number(state.lives);
            nextFloor = Number(state.current_floor);
            resultAscensionLevel = clampAscensionLevel(state.ascension_level);
            const [playerRows] = await conn.query('SELECT purple_coins FROM players WHERE discord_id = ?', [discordId]);
            balance = Number(playerRows?.[0]?.purple_coins || 0);
        } else if (won) {
            const ascensionLevel = clampAscensionLevel(state.ascension_level);
            const [duplicateRows] = await conn.query(
                'SELECT floor FROM tower_floor_history WHERE discord_id = ? AND season_key = ? AND ascension_level = ? AND floor = ?',
                [discordId, state.season_key, ascensionLevel, floor]
            );
            if (duplicateRows && duplicateRows.length) {
                throw new Error('Este andar já teve sua recompensa registrada nesta temporada.');
            }

            const totalCoinReward = Number(rewardPlan.coins || 0) + Number(rewardPlan.normalPackBonus || 0);
            let balanceBefore = 0;
            let username = null;
            if (totalCoinReward > 0) {
                const [playerRows] = await conn.query(
                    'SELECT purple_coins, username, name FROM players WHERE discord_id = ? FOR UPDATE',
                    [discordId]
                );
                const player = playerRows && playerRows[0];
                if (!player) throw new Error('Jogador não encontrado para receber a recompensa.');
                balanceBefore = Number(player.purple_coins) || 0;
                username = player.username || player.name || null;
                await conn.query(`
                    UPDATE players
                    SET purple_coins = COALESCE(purple_coins, 0) + ?,
                        purple_coins_earned = COALESCE(purple_coins_earned, 0) + ?,
                        updated_at = NOW()
                    WHERE discord_id = ?
                `, [totalCoinReward, totalCoinReward, discordId]);
                balance = balanceBefore + totalCoinReward;
                await conn.query(`
                    INSERT INTO player_transactions (
                        discord_user_id, discord_username, transaction_type, item_type, item_name,
                        amount, balance_before, balance_after, metadata
                    ) VALUES (?, ?, 'GAIN', 'torre', ?, ?, ?, ?, ?)
                    RETURNING id
                `, [
                    discordId, username, `Recompensa Torre - Andar ${floor}`,
                    totalCoinReward, balanceBefore, balance,
                    JSON.stringify({
                        source: 'tower_reward', floor, season: state.season_key,
                        ascensionLevel: Number(state.ascension_level || 0),
                        ascensionMultiplier: Number(rewardPlan.ascensionMultiplier || 1),
                        baseCoins: rewardPlan.baseCoinsBeforeAscension ?? rewardPlan.coins,
                        paidCoins: rewardPlan.coins,
                        normalPackBonus: rewardPlan.normalPackBonus || 0,
                        baseNormalPackBonus: rewardPlan.baseNormalPackBonus || 0,
                        investmentDoubleApplied: Boolean(rewardPlan.investmentDoubleApplied),
                        investmentDoubleBonusCoins: Number(rewardPlan.investmentDoubleBonusCoins || 0),
                        multiplier: rewardPlan.multiplier || null
                    })
                ]);
            } else {
                const [playerRows] = await conn.query('SELECT purple_coins FROM players WHERE discord_id = ?', [discordId]);
                balance = Number(playerRows && playerRows[0] ? playerRows[0].purple_coins : 0);
            }

            for (const item of packCards || []) {
                const id = await insertTowerCard(conn, discordId, item.card, item.source);
                cardIds.push({ id, name: item.card.player_name, rarity: item.card.rarity, position: item.card.position, overall: item.card.overall });
                if (String(item.card.rarity).toLowerCase() === 'prime') primeCardIds.push(id);
            }
            if (packCards && packCards.length) {
                await conn.query('UPDATE players SET cartas_obtidas = COALESCE(cartas_obtidas, 0) + ? WHERE discord_id = ?', [packCards.length, discordId]);
            }
            await conn.query(`
                INSERT INTO tower_floor_history (discord_id, season_key, floor, ascension_level, reward_coins, pack_type, reward_cards)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                RETURNING discord_id
            `, [discordId, state.season_key, floor, ascensionLevel, totalCoinReward, rewardPlan.packType, JSON.stringify(cardIds)]);

            normalRelicReward = await rollNormalRelicReward(conn, discordId, floor, state.ascension_level);
            const livesBefore = Number(state.lives);
            relicState.winStreak = equippedRelics.includes('sangue_campeao') ? Math.min(10, Number(relicState.winStreak || 0) + 1) : 0;
            if (isBossFloor(floor)) relicState.treasureHunterEventUsedSinceBoss = false;
            else if (rewardPlan.treasureHunterEventTriggered) relicState.treasureHunterEventUsedSinceBoss = true;
            advanceMerchantBuffs(relicState, floor, true);
            if (rewardPlan.extraCardWon) relicState.nucleusCharge = 0;
            else if (equippedRelics.includes('nucleo_purple')) relicState.nucleusCharge = Math.min(11, Number(relicState.nucleusCharge || 0) + 1);
            if (rewardPlan.mirrorChargeUsed) relicState.mirrorCharge = 0;
            if (isBossFloor(floor) && equippedRelics.includes('espelho_destino')) relicState.mirrorCharge = 1;
            if (isBossFloor(floor) && equippedRelics.includes('fenix')) relicState.phoenixReady = true;
            if (equippedRelics.includes('mochila_emergencia')) {
                const charges = Number.isFinite(Number(relicState.mochilaCharges)) ? Number(relicState.mochilaCharges) : 1;
                if (isBossFloor(floor)) relicState.mochilaCharges = Math.min(2, charges + 1);
                else relicState.mochilaCharges = Math.min(2, charges);
            }
            if (Number(state.ascension_level || 0) >= 2 && equippedRelics.includes('coracao_tita')) {
                if (isBossFloor(floor)) relicState.titanStacks = Math.min(5, Number(relicState.titanStacks || 0) + 1);
                else relicState.titanNormalWins = Math.max(0, Number(relicState.titanNormalWins || 0)) + 1;
            }

            // O Desafio do Ascendente termina somente após a revanche e esta próxima luta.
            if (relicState.ascendantChallenge?.stage === 'next') {
                ascendantChallengeStake = Number(relicState.ascendantChallenge.stake || 0);
                const challengePrize = getAscendantChallengeReward(ascendantChallengeStake);
                const [playerRows] = await conn.query('SELECT purple_coins, purple_coins_earned, username, name FROM players WHERE discord_id = ? FOR UPDATE', [discordId]);
                const player = playerRows?.[0];
                if (!player) throw new Error('Jogador não encontrado para devolver a aposta do Desafio do Ascendente.');
                const before = Number(player.purple_coins) || 0;
                const after = before + ascendantChallengeStake;
                await conn.query('UPDATE players SET purple_coins = ?, purple_coins_earned = COALESCE(purple_coins_earned,0) + ?, updated_at = NOW() WHERE discord_id = ?', [after, ascendantChallengeStake, discordId]);
                await conn.query(`INSERT INTO player_transactions (discord_user_id,discord_username,transaction_type,item_type,item_name,amount,balance_before,balance_after,metadata) VALUES (?,?,'GAIN','tower_ascendant_challenge','Desafio do Ascendente concluído',?,?,?,?) RETURNING id`, [discordId, player.username || player.name || null, ascendantChallengeStake, before, after, JSON.stringify({ bossFloor: relicState.ascendantChallenge.bossFloor, stake: ascendantChallengeStake, rewardFragments: challengePrize.fragments, rewardCardWeights: challengePrize.cardWeights })]);
                await conn.query('UPDATE tower_progress SET relic_fragments = COALESCE(relic_fragments,0) + ? WHERE discord_id = ?', [challengePrize.fragments, discordId]);
                balance = after;
                relicState.ascendantChallenge = null;
                ascendantChallengeWon = true;
            }

            if (floor === TOTAL_FLOORS) {
                relicState.titanStacks = 0;
                relicState.titanNormalWins = 0;
                relicState.nucleusCharge = 0;
                relicState.winStreak = 0;
                relicState.phoenixReady = false;
                relicState.mochilaCharges = 1;
                relicState.mirrorCharge = 0;
                relicState.ruptureUsed = false;
                relicState.compassUsedFloor = 0;
                relicState.challengeBossesUsed = [];
                relicState.ascendantChallenge = null;
            }
            lifeGained = Boolean(rewardPlan.lifeBonus) && livesBefore < MAX_LIVES;
            const ascensionUnlockedLevel = floor === TOTAL_FLOORS && ascensionLevel < ASCENSION_MAX ? ascensionLevel + 1 : null;
            const advancingAscension = ascensionUnlockedLevel !== null;
            const towerCompleted = floor === TOTAL_FLOORS && !advancingAscension;
            const nextAscensionLevel = advancingAscension ? ascensionUnlockedLevel : ascensionLevel;
            nextFloor = advancingAscension ? 1 : floor + 1;
            const activeBuff = parseTowerJson(state.active_buff, {});
            buffBroken = shouldBuffBreak(activeBuff, floor, Math.random, equippedRelics);
            buffExpired = !buffBroken && isBuffExpiredAtFloor(activeBuff, nextFloor);
            const clearBuffCycle = buffBroken || buffExpired || isBossFloor(nextFloor) || advancingAscension;
            const relicPityAfterBoss = getRelicPityAfterBoss(state.bosses_since_relic_event, isBossFloor(floor) && floor < TOTAL_FLOORS, false);
            const storedPendingEvent = rewardPlan.pendingEvent
                ? {
                    ...rewardPlan.pendingEvent,
                    // A relíquia pode desgastar nesta própria luta; nesse caso, não libera o botão do evento.
                }
                : null;

            await conn.query(`
                UPDATE tower_progress
                SET current_floor = ?,
                    ascension_level = ?,
                    lives = LEAST(lives + ?, ?),
                    best_floor = CASE WHEN ? THEN 0 ELSE GREATEST(best_floor, ?) END,
                    all_time_best_floor = GREATEST(all_time_best_floor, ?),
                    completed_at = CASE WHEN ? THEN NOW() WHEN ? THEN NULL ELSE completed_at END,
                    active_buff = CASE WHEN ? THEN '{}'::jsonb ELSE active_buff END,
                    active_buff_until_floor = CASE WHEN ? THEN 0 ELSE active_buff_until_floor END,
                    buff_history = CASE WHEN ? THEN '[]'::jsonb ELSE buff_history END,
                    pending_buff_options = CASE WHEN ? THEN '[]'::jsonb ELSE pending_buff_options END,
                    pending_buff_floor = CASE WHEN ? THEN NULL ELSE pending_buff_floor END,
                    bosses_since_relic_event = ?,
                    relic_state = ?::jsonb,
                    second_chance_used = CASE WHEN ? THEN FALSE ELSE second_chance_used END,
                    pending_event = ?::jsonb,
                    active_contract = NULL,
                    match_active = FALSE, match_token = NULL, match_started_at = NULL,
                    updated_at = NOW()
                WHERE discord_id = ? AND match_token = ? AND match_active = TRUE
            `, [
                nextFloor, nextAscensionLevel, lifeGained ? 1 : 0, MAX_LIVES,
                advancingAscension, floor, floor,
                towerCompleted, advancingAscension,
                clearBuffCycle, clearBuffCycle, clearBuffCycle, clearBuffCycle, clearBuffCycle,
                relicPityAfterBoss,
                JSON.stringify(relicState),
                isBossFloor(floor) && equippedRelics.includes('fenix'),
                storedPendingEvent ? JSON.stringify(storedPendingEvent) : null,
                discordId, token
            ]);
            newLives = Math.min(MAX_LIVES, livesBefore + (lifeGained ? 1 : 0));
            pendingEvent = storedPendingEvent;
            resultAscensionLevel = nextAscensionLevel;
            resultAscensionUnlockedLevel = ascensionUnlockedLevel;
            resultTowerCompleted = towerCompleted;
        } else {
            resultAscensionLevel = clampAscensionLevel(state.ascension_level);
            relicState.winStreak = 0;
            const phoenixSaved = equippedRelics.includes('fenix') && Boolean(relicState.phoenixReady);
            const secondChanceSaved = shouldSaveLifeWithSecondChance(equippedRelics, state.second_chance_used);
            lifeSavedByRelic = phoenixSaved || secondChanceSaved;
            if (phoenixSaved) relicState.phoenixReady = false;
            if (!lifeSavedByRelic && isBossFloor(floor) && equippedRelics.includes('mochila_emergencia')) {
                const mochilaAttempt = consumeMochilaCharge(relicState);
                Object.assign(relicState, mochilaAttempt.relicState);
                if (mochilaAttempt.saved) {
                    lifeSavedByRelic = true;
                    lifeSavedByMochila = true;
                }
            }
            newLives = lifeSavedByRelic ? Number(state.lives) : Math.max(0, Number(state.lives) - 1);

            if (equippedRelics.includes('kit_medico')) {
                baseReward = calculateKitMedicalBaseReward(floor);
                kitMedicalCoins = Math.floor(baseReward * 0.20);
                const kitHeal = attemptKitMedicalHeal(relicState, newLives, Math.random);
                Object.assign(relicState, kitHeal.relicState);
                newLives = kitHeal.lives;
                lifeRecoveredByKit = kitHeal.recovered;
                kitMedicalHealAttempted = kitHeal.attempted;
            }
            advanceMerchantBuffs(relicState, floor, false);

            if (kitMedicalCoins > 0) {
                const [playerRows] = await conn.query('SELECT purple_coins, purple_coins_earned, username, name FROM players WHERE discord_id = ? FOR UPDATE', [discordId]);
                const player = playerRows?.[0];
                if (player) {
                    const before = Number(player.purple_coins) || 0;
                    balance = before + kitMedicalCoins;
                    await conn.query('UPDATE players SET purple_coins = ?, purple_coins_earned = COALESCE(purple_coins_earned, 0) + ?, updated_at = NOW() WHERE discord_id = ?', [balance, kitMedicalCoins, discordId]);
                    await conn.query(`INSERT INTO player_transactions (discord_user_id, discord_username, transaction_type, item_type, item_name, amount, balance_before, balance_after, metadata) VALUES (?, ?, 'GAIN', 'torre_relic', 'Kit Médico - derrota', ?, ?, ?, ?) RETURNING id`, [discordId, player.username || player.name || null, kitMedicalCoins, before, balance, JSON.stringify({ source: 'tower_relic_kit_medico', floor, baseReward, percent: 0.20 })]);
                }
            }

            if (isAscendantChallengeFailure({ challenge, won, lifeSavedByRelic, lifeSavedByMochila })) {
                ascendantChallengeFailed = true;
                ascendantChallengeStake = Number(challenge.stake || 0);
                relicState.ascendantChallenge = null;
            }
            await conn.query(`
                UPDATE tower_progress
                SET lives = ?, second_chance_used = CASE WHEN ? AND ? THEN TRUE ELSE second_chance_used END,
                    relic_state = ?::jsonb, active_contract = NULL,
                    match_active = FALSE, match_token = NULL, match_started_at = NULL,
                    updated_at = NOW()
                WHERE discord_id = ? AND match_token = ? AND match_active = TRUE
            `, [newLives, lifeSavedByRelic, equippedRelics.includes('segunda_chance'), JSON.stringify(relicState), discordId, token]);
            if (balance === null) {
                const [playerRows] = await conn.query('SELECT purple_coins FROM players WHERE discord_id = ?', [discordId]);
                balance = Number(playerRows && playerRows[0] ? playerRows[0].purple_coins : 0);
            }
            nextFloor = Number(state.current_floor);
        }

        await conn.commit();
    } catch (error) {
        try { await conn.rollback(); } catch (_) { }
        throw error;
    } finally {
        conn.release();
    }

    for (const cardId of primeCardIds) {
        try { await rolarEAplicar(cardId, discordId); }
        catch (error) { console.warn('[torre] Falha ao aplicar cosmético Prime especial:', error.message); }
    }

    const usedChallengeBosses = Array.isArray(relicStateForResult.challengeBossesUsed)
        ? relicStateForResult.challengeBossesUsed.map(Number)
        : [];
    const challengeOfferAvailable = Boolean(
        won && !challengeMode && isBossFloor(floor) && floor < TOTAL_FLOORS &&
        equippedRelicsForResult.includes('aposta_ascendente') &&
        !newlyWornRelics.includes('aposta_ascendente') &&
        !usedChallengeBosses.includes(Number(floor)) &&
        !relicStateForResult.ascendantChallenge
    );

    return {
        balance, cardIds, lives: newLives, nextFloor, primeCardIds,
        lifeGained, lifeSavedByRelic, lifeSavedByMochila, lifeRecoveredByKit, kitMedicalCoins, kitMedicalHealAttempted,
        buffBroken, buffExpired, pendingEvent, normalRelicReward, newlyWornRelics,
        treasureHunterEventTriggered: Boolean(rewardPlan?.treasureHunterEventTriggered),
        ascendantChallengeWon, ascendantChallengeFailed, ascendantChallengeStake,
        challengeOfferAvailable,
        ascensionLevel: resultAscensionLevel,
        ascensionUnlockedLevel: resultAscensionUnlockedLevel,
        towerCompleted: resultTowerCompleted
    };
}

async function getUserTeamCards(team) {
    const cards = {};
    for (const role of POSITIONS) {
        const cardId = team[`${role}_card_id`];
        if (!cardId) return null;
        const dbCard = await getCardById(cardId, team.owner_discord_id);
        if (!dbCard) return null;
        cards[role] = normalizeCard(dbCard, role);
    }
    return cards;
}

async function getUserCoachId(discordId) {
    const rows = await query('SELECT treinador_id FROM players WHERE discord_id = ?', [discordId]);
    return rows && rows[0] ? rows[0].treinador_id || null : null;
}

async function getUserSponsor(team) {
    if (!team || !team.patrocinio_id) return null;
    const rows = await query(
        'SELECT id, nome, bonus_atributo, bonus_valor FROM patrocinios WHERE id = ? AND ativo = TRUE',
        [team.patrocinio_id]
    );
    return rows && rows[0] ? rows[0] : null;
}

async function getBotSponsor(excludeId) {
    const rows = await query('SELECT id, nome, bonus_atributo, bonus_valor FROM patrocinios WHERE ativo = TRUE ORDER BY id');
    if (!rows.length) return { id: null, nome: 'Patrocínio da Liga', bonus_atributo: 'defesa', bonus_valor: 3 };
    const available = rows.filter(row => String(row.id) !== String(excludeId));
    return (available.length ? available : rows)[randomInt(0, (available.length ? available : rows).length - 1)];
}

const SPONSOR_ALIASES = {
    defesa: 'defesa',
    posicionamento: 'posicionamento',
    drible: 'drible',
    passe: 'passe',
    finalizacao: 'finalizacao',
    saidadebola: 'saidaDeBola',
    saida_de_bola: 'saidaDeBola'
};

function applySponsorBuffs(cards, sponsor) {
    if (!sponsor) return;
    const key = String(sponsor.bonus_atributo || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z_]/g, '');
    const stat = SPONSOR_ALIASES[key];
    const bonus = Number(sponsor.bonus_valor) || 0;
    if (!stat || bonus <= 0) return;
    for (const card of Object.values(cards)) {
        card[stat] = Math.min(99, numberOr(card[stat], 50) + bonus);
        syncCardStats(card);
    }
}

function buildTowerBotTeam(userCards, floor, userCoachId, userSponsorId, templates, botSponsor = null, ascensionLevel = 0, relicCodes = [], relicState = {}) {
    const weaken = (relicState.merchantBuffs || []).some(b => b.kind === 'weaken' && Number(b.remaining || 0) > 0 && !isBossFloor(floor));
    const multiplier = getDifficultyMultiplier(floor, ascensionLevel) * (relicCodes.includes('coroa_espinhos') ? 1.04 : 1) * (weaken ? 0.97 : 1);
    const roster = typeof amistosoHelpers.selectBotRoster === 'function'
        ? amistosoHelpers.selectBotRoster(userCards)
        : {
            gk: { name: 'RIVELINDO' },
            vl: { name: 'ESQUECE' },
            pv: { name: 'ENZOESPANCAUTERO' }
        };
    const templateMap = new Map((templates || []).map(item => [normalizeName(item.name), item]));
    const botCards = {};
    const rawStatsByRole = {};

    POSITIONS.forEach((role, index) => {
        const userCard = userCards[role];
        const rawStats = {};
        const stats = {};
        for (const key of ['posicionamento', 'saidaDeBola', 'defesa', 'drible', 'passe', 'finalizacao']) {
            const base = numberOr(userCard[key], 50);
            const raw = 50 + (base - 50) * multiplier;
            rawStats[key] = raw;
            stats[key] = Math.round(clamp(raw, 1, 99));
        }
        rawStatsByRole[role] = rawStats;

        const template = templateMap.get(normalizeName(roster[role].name));
        const avatar = template && template.avatar
            ? template.avatar
            : (role === 'gk' ? '🥅' : role === 'pv' ? '🎯' : '⚽');
        const overallRaw = 50 + (numberOr(userCard.overall_rating, 50) - 50) * multiplier;
        const card = {
            id: -(Date.now() * 10 + index + 1),
            player_name: roster[role].name,
            avatar,
            overall_rating: Math.round(clamp(overallRaw, 1, 99)),
            rarity: overallRaw >= 90 ? 'Prime' : overallRaw >= 82 ? 'GOAT' : overallRaw >= 74 ? 'Médio' : 'Bagre',
            role,
            position: role.toUpperCase(),
            ...stats,
            pos: stats.posicionamento,
            sai: stats.saidaDeBola,
            def: stats.defesa,
            stats,
            habilidade_equipada: userCard.habilidade_equipada || null
        };
        syncCardStats(card);
        botCards[role] = card;
    });

    const botCoach = typeof amistosoHelpers.chooseBotCoach === 'function'
        ? amistosoHelpers.chooseBotCoach(userCoachId)
        : null;
    if (botCoach && typeof amistosoHelpers.applyCoachBuffs === 'function') {
        amistosoHelpers.applyCoachBuffs(botCards, botCoach);
    }
    applySponsorBuffs(botCards, botSponsor);

    const sponsorKey = String(botSponsor?.bonus_atributo || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z_]/g, '');
    const sponsorStat = SPONSOR_ALIASES[sponsorKey];
    const sponsorBonus = Number(botSponsor?.bonus_valor) || 0;
    const coachBuffs = botCoach?.buffs || {};
    let maxOverflow = 0;
    for (const role of POSITIONS) {
        for (const key of ['posicionamento', 'saidaDeBola', 'defesa', 'drible', 'passe', 'finalizacao']) {
            const rawWithBuffs = numberOr(rawStatsByRole[role][key], 50)
                + Number(coachBuffs[key] || 0)
                + (sponsorStat === key ? sponsorBonus : 0);
            maxOverflow = Math.max(maxOverflow, rawWithBuffs - 99);
        }
    }
    // Atributos acima de 99 não aparecem no card, mas também não devem deixar
    // os últimos andares fáceis. A pressão cresce ao longo da Torre e é aplicada
    // somente aos cálculos do time 2 nesta modalidade (ataque e defesas do GK).
    const overflowPressure = clamp(maxOverflow * 0.003, 0, 0.04);
    const progress = clamp((multiplier - 0.78) / (getMaxDifficultyMultiplier(ascensionLevel) - 0.78), 0, 1);
    const stagePressure = 0.07 * Math.pow(progress, 1.1);
    const ascensionPressure = clampAscensionLevel(ascensionLevel) * ASCENSION_PRESSURE_STEP;
    const pressure = clamp(stagePressure + overflowPressure * 0.75 + ascensionPressure, 0, 0.18);
    return { botCards, multiplier, pressure, botCoach, botSponsor };
}

function getDifficultyText(multiplier) {
    return `${(multiplier * 100).toFixed(1).replace('.', ',')}%`;
}

function formatLives(lives) {
    return '❤️'.repeat(Math.max(0, Math.min(MAX_LIVES, Number(lives) || 0))) + '🖤'.repeat(Math.max(0, MAX_LIVES - Math.min(MAX_LIVES, Number(lives) || 0)));
}

function formatLivesCount(lives) {
    const count = Number(lives) || 0;
    if (count <= DAILY_LIVES) return `**${count}/${DAILY_LIVES}**`;
    return `**${count}/${MAX_LIVES}** (${DAILY_LIVES} diárias + ${count - DAILY_LIVES} extras)`;
}

function buildLifeRewardLine(rewardPlan, result) {
    if (!rewardPlan || !rewardPlan.lifeBonus) return '';
    const origem = rewardPlan.lifeBonusSource === 'boss' ? 'Chefe derrotado' : 'Bônus de sorte';
    if (result && result.lifeGained) return `\n❤️ **+1 vida!** ${origem}`;
    return `\n❤️ ${origem}, mas você já está com o máximo de vidas (${MAX_LIVES}).`;
}

function buildTowerLiveEmbed({ floor, lives, teamName, botName, teamOverall, botOverall, botCards, userCoach, botCoach, userSponsor, botSponsor, buffs = [], contract = null, ascensionLevel = 0, difficultyMultiplier = 1, score, lines, stats, duration }) {
    const currentScore = score || { team1: 0, team2: 0 };
    const parts = buildLiveParts({ lines: lines || [], stats: stats || null, duration, previousCount: 4 });
    const boss = isBossFloor(floor);
    const embed = new EmbedBuilder()
        .setColor(parts.goalNow ? 0xF1C40F : boss ? 0xF59E0B : 0x8B5CF6)
        .setTitle(`${boss ? '👑 CHEFE' : '🏰 TORRE'} · ANDAR ${floor}/${TOTAL_FLOORS} · AO VIVO`)
        .setDescription(
            `🔴 **${teamName}**  **${Number(currentScore.team1) || 0} × ${Number(currentScore.team2) || 0}**  **${botName}** 🔵\n` +
            `${parts.timeLine}\n` +
            `❤️ **Vidas:** ${formatLives(lives)}  ·  **IA:** ${botOverall} OVR\n` +
            `⚔️ **${getAscensionLabel(ascensionLevel)}** · Dificuldade da IA: **${getDifficultyText(difficultyMultiplier)}**`
        )
        .addFields(
            { name: '🎙️ Lance atual', value: (parts.narrationText || 'A bola vai rolar...').slice(0, 1024), inline: false },
            { name: '📣 Lances anteriores', value: (parts.previousText || 'Nenhum lance ainda.').slice(0, 1024), inline: false },
            { name: '⚖️ Força dos times', value: `Seu time: **${teamOverall} OVR**\nIA: **${botOverall} OVR**`, inline: true },
            { name: '🎓 Treinadores', value: `🔴 ${userCoach ? `**${userCoach.nome}**` : 'Sem treinador'}\n🔵 ${botCoach ? `**${botCoach.nome}**` : 'Sem treinador'}`, inline: true },
            { name: '🏢 Patrocínios', value: `🔴 ${userSponsor ? `**${userSponsor.nome}**` : 'Sem patrocínio'}\n🔵 ${botSponsor ? `**${botSponsor.nome}**` : 'Sem patrocínio'}`, inline: true },
            ...(buffs.length ? [{ name: '🧪 Buff ativo / relíquias', value: buffs.join('\n').slice(0, 1024), inline: false }] : []),
            ...(contract ? [{ name: '📜 Contrato ativo', value: `${contract.name}\n${contract.description}`.slice(0, 1024), inline: false }] : []),
            { name: '🤖 Escalação da IA', value: POSITIONS.map(role => `**${role.toUpperCase()}** ${botCards[role].player_name} · ${botCards[role].overall_rating} OVR · ${botCards[role].habilidade_equipada || 'sem habilidade'}`).join('\n').slice(0, 1024), inline: false }
        )
        .setFooter({ text: 'Sem estatísticas de partidas oficiais; cartas dos pacotes entram normalmente na coleção.' })
        .setTimestamp();
    return embed;
}

function calculateRewardDisplay(plan) {
    const lines = [];
    if (plan.coins > 0) {
        lines.push(`💜 **+${plan.coins.toLocaleString('pt-BR')} PC**`);
        if (plan.multiplier) lines.push(`🎲 Multiplicador de sorte: **×${plan.multiplier}**`);
    }
    if (plan.ascensionMultiplier > 1 && (Number(plan.coins || 0) > 0 || Number(plan.normalPackBonus || 0) > 0)) {
        lines.push(`⚔️ Bônus da ${getAscensionLabel(plan.ascensionLevel)}: **×${formatRewardMultiplier(plan.ascensionMultiplier)} em todos os PC deste andar**`);
    }
    if (plan.investmentDoubleApplied) lines.push(`🪙 **Investimento Inicial ativado: recompensa em PC dobrada! (+${Number(plan.investmentDoubleBonusCoins || 0).toLocaleString('pt-BR')} PC adicionais)**`);
    if (Number(plan.titanPcBonusPercent || 0) > 0) lines.push(`🐉 **Coração do Titã: +${Number(plan.titanPcBonusPercent)}% PC** pelas vitórias de chefes anteriores.`);
    if (Number(plan.ruptureUpgradedCardsCount || 0) > 0) lines.push(`🌀 **Ruptura da Raridade:** ${Number(plan.ruptureUpgradedCardsCount)} carta(s) tiveram a raridade melhorada.`);
    if (plan.normalPackBonus > 0) lines.push(`📦 Bônus do pacote normal: **+${plan.normalPackBonus} PC**`);
    if (plan.packLabel) lines.push(`🎁 **${plan.packLabel}**`);
    if (plan.extraCardWon) lines.push(`✨ **Carta extra da Torre:** ${plan.extraCardRarity || 'Carta surpresa'}`);
    else if (plan.extraCardChance > 0) lines.push(`🎴 Chance de carta extra neste andar: **${Math.round(plan.extraCardChance * 100)}%** (não veio desta vez)`);
    return lines.join('\n') || 'Sem moedas adicionais.';
}

function applyAscensionRewardMultiplier(basePlan, normalPackBonus = 0) {
    const ascensionMultiplier = Number(basePlan?.ascensionMultiplier) || 1;
    return {
        ...basePlan,
        baseCoinsBeforeAscension: Number(basePlan?.coins || 0),
        coins: Math.floor(Number(basePlan?.coins || 0) * ascensionMultiplier),
        normalPackBonus: Math.floor(Number(normalPackBonus || 0) * ascensionMultiplier),
        baseNormalPackBonus: Number(normalPackBonus || 0)
    };
}

function buildRewardPlan(floor, contract = null, relicCodes = [], ascensionLevel = 0, bossesSinceRelicEvent = 0, relicState = {}, rng = Math.random) {
    const coins = calculateFloorReward(floor, rng);
    const dropRule = getFloorCardDropRule(floor);
    const extraCardChance = getRelicExtraCardChance(floor, relicCodes, relicState);
    if (relicCodes.includes('sangue_campeao')) coins.coins = Math.floor(Number(coins.coins || 0) * (1 + Math.min(10, Number(relicState.winStreak || 0)) * 0.02));
    if (relicCodes.includes('coroa_espinhos')) coins.coins = Math.floor(Number(coins.coins || 0) * 1.25);
    const titanPcBonus = getTitanBossPcBonus(relicCodes, ascensionLevel, relicState);
    if ((relicState.merchantBuffs || []).some(b => b.kind === 'coins' && Number(b.remaining || 0) > 0) && !isBossFloor(floor)) coins.coins = Math.floor(Number(coins.coins || 0) * 1.15);
    if (contract && Number(contract.rewardMultiplier) > 1) {
        coins.coins = Math.floor(Number(coins.coins || 0) * Number(contract.rewardMultiplier));
    }

    let pendingEvent = null;
    let treasureHunterEventTriggered = false;
    const activeMerchantCodes = (relicState.merchantBuffs || []).filter(buff => Number(buff.remaining || 0) > 0).map(buff => buff.code);
    if (isBossFloor(floor) && floor < TOTAL_FLOORS) {
        const compensationPending = Boolean(relicState.relicCompensationPending);
        pendingEvent = makeRandomTowerEvent(floor, rng, {
            forceTreasure: compensationPending || Number(bossesSinceRelicEvent || 0) >= RELIC_EVENT_PITY_BOSSES,
            ascensionLevel,
            activeMerchantCodes
        });
        if (compensationPending) {
            pendingEvent.compensationRelic = true;
            pendingEvent.title = '🎁 Baú de Compensação';
            pendingEvent.description = 'A Torre preparou uma relíquia nova como compensação pela atualização. Abra o baú para recebê-la.';
        }
    } else if (!isBossFloor(floor) && floor < TOTAL_FLOORS && relicCodes.includes('fita_isolante')) {
        const hunterResult = rollTreasureHunterEvent(floor, relicCodes, relicState, rng, {
            ascensionLevel,
            activeMerchantCodes
        });
        pendingEvent = hunterResult.event;
        treasureHunterEventTriggered = hunterResult.triggered;
    }

    return {
        ...coins,
        extraCardChance,
        titanPcBonusPercent: Math.round(titanPcBonus * 100),
        titanPcBonusMultiplier: 1 + titanPcBonus,
        extraCardWon: false,
        extraCardRarity: null,
        normalPackBonus: 0,
        packLabel: null,
        equippedRelics: relicCodes,
        relicState,
        contractCode: contract?.code || null,
        ascensionLevel: clampAscensionLevel(ascensionLevel),
        ascensionMultiplier: getAscensionRewardMultiplier(ascensionLevel),
        pendingEvent,
        treasureHunterEventTriggered,
        investmentDouble: shouldDoubleInvestmentReward(floor, relicCodes, rng)
    };
}

async function promptMirrorChoice(interaction, discordId, card) {
    const description = `Carta extra recebida: **${card.player_name || 'Jogador'}** · ${card.position || '—'} · ${card.rarity || '—'} · ${card.overall || '—'} OVR.\n\nVocê tem uma carga do Espelho do Destino. Escolha uma única vez:`;
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tower_mirror|${discordId}|keep`).setLabel('Manter').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`tower_mirror|${discordId}|reflect`).setLabel('Refletir').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`tower_mirror|${discordId}|replicate`).setLabel('Replicar').setStyle(ButtonStyle.Success)
    );
    const message = await interaction.followUp({ content: description, components: [row], ephemeral: true });
    try {
        const choice = await message.awaitMessageComponent({
            filter: component => component.user?.id === discordId && component.customId.startsWith(`tower_mirror|${discordId}|`),
            time: 60_000
        });
        const action = choice.customId.split('|')[2];
        if (action === 'reflect') {
            try {
                const reflected = await generateCard(card.rarity, 'free');
                if (reflected) {
                    await choice.update({ content: `🪞 O Espelho refletiu **${card.player_name || 'a carta original'}** em **${reflected.player_name || 'uma nova carta'}**, mantendo a raridade **${card.rarity}**.`, components: [] });
                    return { card: reflected, replica: null, chargeUsed: true, action };
                }
                await choice.update({ content: '🪞 Não foi possível gerar a reflexão. A carta original foi mantida e a carga não foi consumida.', components: [] });
                return { card, replica: null, chargeUsed: false, action: 'keep' };
            } catch (error) {
                console.warn('[torre] Falha ao refletir carta pelo Espelho:', error.message);
                await choice.update({ content: '🪞 A reflexão falhou. A carta original foi mantida e a carga não foi consumida.', components: [] });
                return { card, replica: null, chargeUsed: false, action: 'keep' };
            }
        }
        if (action === 'replicate') {
            const duplicate = { ...card };
            delete duplicate.id;
            delete duplicate.card_id;
            delete duplicate.owner_discord_id;
            await choice.update({ content: `🪞 **${card.player_name || 'A carta'}** foi replicada. Você receberá duas cópias idênticas.`, components: [] });
            return { card, replica: duplicate, chargeUsed: true, action };
        }
        await choice.update({ content: `✅ Você manteve **${card.player_name || 'a carta extra'}**. A carga do Espelho foi consumida.`, components: [] });
        return { card, replica: null, chargeUsed: true, action: 'keep' };
    } catch (_) {
        try { await message.edit({ content: `${description}\n\nTempo esgotado: a carta original foi mantida e a carga permanece disponível.`, components: [] }); } catch (_) {}
        return { card, replica: null, chargeUsed: false, action: 'timeout' };
    }
}

async function commitWinnerReward(discordId, token, floor, basePlan, interaction = null) {
    const pack = basePlan.packType ? await generateTowerPack(basePlan.packType) : { cards: [], label: null, normalPackBonus: 0 };
    let extraCard = await generateTowerExtraCard(floor, Math.random, basePlan.equippedRelics || [], basePlan.relicState || {});
    const rewardCards = [...pack.cards];
    const relicCodes = basePlan.equippedRelics || [];
    const relicState = basePlan.relicState || {};
    let mirrorChargeUsed = false;
    let mirrorReplica = null;

    if (extraCard && relicCodes.includes('espelho_destino') && Number(relicState.mirrorCharge || 0) > 0 && interaction) {
        const mirror = await promptMirrorChoice(interaction, discordId, extraCard.card);
        extraCard = { card: mirror.card, source: 'tower_extra_card' };
        mirrorReplica = mirror.replica ? { card: mirror.replica, source: 'tower_mirror_replica' } : null;
        mirrorChargeUsed = Boolean(mirror.chargeUsed);
    }
    if (extraCard) rewardCards.push(extraCard);
    if (mirrorReplica) rewardCards.push(mirrorReplica);

    // Prêmio do Desafio: carta extra garantida de Médio+; a raridade melhora conforme a aposta.
    let challengeBonusCardWon = false;
    let challengePrize = null;
    if (basePlan.ascendantChallengeReward) {
        challengePrize = getAscendantChallengeReward(basePlan.ascendantChallengeStake);
        const challengeCard = await generateAscendantChallengeBonusCard(challengePrize.stake);
        rewardCards.push(challengeCard);
        challengeBonusCardWon = true;
    }

    const bossBonusCard = isBossFloor(floor) && relicCodes.includes('espolio_guerra');
    const crownBossCard = isBossFloor(floor) && relicCodes.includes('coroa_espinhos') && Math.random() < 0.20;
    if (bossBonusCard || crownBossCard) {
        try { rewardCards.push({ card: await generateCard(pickRarity({ medio: 70, goat: 25, prime: 5 }), 'free'), source: 'tower_relic_boss_card' }); }
        catch (error) { console.warn('[torre] Falha ao gerar carta bônus de chefe:', error.message); }
    }
    if (extraCard && relicCodes.includes('nucleo_purple') && Math.random() < 0.20) {
        try { rewardCards.push({ card: await generateCard(pickRarity(getFloorCardDropRule(floor)?.probabilities || { medio: 70, goat: 25, prime: 5 }), 'free'), source: 'tower_nucleus_second_card' }); }
        catch (error) { console.warn('[torre] Falha ao gerar segunda carta do Núcleo Purple:', error.message); }
    }
    const ruptureUpgrade = await applyRupturaRarityUpgrades(rewardCards, relicCodes, Math.random, generateCard);
    const finalRewardCards = ruptureUpgrade.cards;
    const finalExtraCard = finalRewardCards.find(item => item.source === 'tower_extra_card') || extraCard;
    const ascensionAdjustedPlan = applyAscensionRewardMultiplier(basePlan, pack.normalPackBonus || 0);
    const titanAdjustedPlan = applyTitanPcBonus(ascensionAdjustedPlan);
    const investmentAdjustedPlan = applyInvestmentDoubleReward(titanAdjustedPlan, Boolean(basePlan.investmentDouble), floor);
    const rewardPlan = {
        ...investmentAdjustedPlan,
        packLabel: pack.label || null,
        extraCardWon: Boolean(extraCard),
        extraCardRarity: finalExtraCard?.card?.rarity || null,
        ruptureUpgradedCardsCount: ruptureUpgrade.upgradedCount,
        mirrorChargeUsed,
        challengeBonusCardWon,
        challengeBonusFragments: challengePrize?.fragments || 0,
        challengeBonusStake: challengePrize?.stake || 0,
        lifeBonus: rollLifeBonus(floor).won,
        pendingEvent: basePlan.pendingEvent || null
    };
    const result = await finalizeTowerMatch({ discordId, token, floor, won: true, rewardPlan, packCards: finalRewardCards });
    try {
        const { checkAndMarkConquistas } = require('./conquistas');
        await checkAndMarkConquistas(discordId);
    } catch (error) {
        console.warn('[torre] Não foi possível atualizar conquistas após recompensa:', error.message);
    }
    return { ...result, rewardPlan, packCards: finalRewardCards };
}

function buildDefeatRewardDisplay(result = {}) {
    const kitCoins = Math.max(0, Number(result.kitMedicalCoins) || 0);
    if (kitCoins > 0) return `💜 **+${kitCoins.toLocaleString('pt-BR')} PC** recebidos pelo Kit Médico (20% da recompensa-base).`;
    return 'Nenhuma recompensa por esta tentativa.';
}

function buildFinalEmbed({ floor, won, scoreUser, scoreBot, rewardPlan, result, lives, teamName, botName, seasonKey }) {
    const boss = isBossFloor(floor);
    const embed = new EmbedBuilder()
        .setColor(won ? 0x16A34A : 0xDC2626)
        .setTitle(won ? `${boss ? '👑 CHEFE DERROTADO!' : '✅ ANDAR CONCLUÍDO!'}` : '💔 VOCÊ PERDEU UMA VIDA!')
        .setDescription(
            `🏰 **Andar ${floor}/${TOTAL_FLOORS}**\n` +
            `🔴 **${teamName}** ${scoreUser} × ${scoreBot} **${botName}** 🔵\n` +
            (won ? (floor === TOTAL_FLOORS
                ? (result.ascensionUnlockedLevel !== null && result.ascensionUnlockedLevel !== undefined
                    ? `🏆 **Torre concluída!** Você desbloqueou **${getAscensionLabel(result.ascensionUnlockedLevel)}**. A próxima run começa no andar 1 com recompensas ×${formatRewardMultiplier(getAscensionRewardMultiplier(result.ascensionUnlockedLevel))}. Use /torre entrar para continuar.`
                    : `🏆 **Torre concluída na dificuldade máxima!** Você chegou à Ascensão ${ASCENSION_MAX}/4 e conquistou recompensas de PC ×3. A próxima tentativa começa na próxima temporada.`)
                : `➡️ Próximo andar: **${result.nextFloor || floor + 1}**`)
                : `O progresso permanece no andar **${floor}**.${boss ? '\n\n📜 O contrato valeu apenas para esta tentativa e foi consumido. Na próxima tentativa deste chefe, você poderá escolher outro contrato ou seguir sem.' : ''}`)
        )
        .addFields(
            { name: '💜 Recompensa', value: won ? `${calculateRewardDisplay(rewardPlan)}${buildLifeRewardLine(rewardPlan, result)}`.slice(0, 1024) : buildDefeatRewardDisplay(result), inline: false },
            { name: '🎴 Cartas recebidas', value: won && result.cardIds.length ? result.cardIds.map(card => `• **${card.name}** (${card.position}) · ${card.rarity} · ${card.overall} OVR · ID #${card.id}`).join('\n').slice(0, 1024) : 'Nenhuma carta nesta partida.', inline: false },
            { name: '❤️ Vidas restantes', value: `${formatLives(result.lives)}  ${formatLivesCount(result.lives)}`, inline: true },
            { name: '💼 Saldo', value: `**${Number(result.balance || 0).toLocaleString('pt-BR')} PC**`, inline: true },
            { name: '⚔️ Ascensão da run', value: `**${getAscensionLabel(rewardPlan?.ascensionLevel ?? result.ascensionLevel)}** · PC ×${formatRewardMultiplier(getAscensionRewardMultiplier(rewardPlan?.ascensionLevel ?? result.ascensionLevel))}`, inline: true },
            ...(result.buffBroken ? [{ name: '🧨 Buff quebrado', value: 'O buff ativo quebrou depois deste andar. Você perdeu os bônus dele.', inline: false }] : []),
            ...(result.buffExpired ? [{ name: '🧪 Buff encerrado', value: 'O buff anterior expirou automaticamente ao chegar no próximo chefe. Escolha uma nova melhoria para este bloco.', inline: false }] : []),
            ...(result.ascensionUnlockedLevel !== null && result.ascensionUnlockedLevel !== undefined ? [{ name: '⚔️ Nova ascensão desbloqueada', value: `**${getAscensionLabel(result.ascensionUnlockedLevel)}** · Recompensas em PC ×${formatRewardMultiplier(getAscensionRewardMultiplier(result.ascensionUnlockedLevel))} · IA mais forte.`, inline: false }] : [])
        )
        .setFooter({ text: `Temporada ${seasonKey} · Vidas renovam diariamente à meia-noite de Brasília · Sem estatísticas oficiais` })
        .setTimestamp();
    return embed;
}

function parseTowerJson(value, fallback) {
    if (value === null || typeof value === 'undefined') return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_) { return fallback; }
}

function sampleUnique(items, count = 3) {
    const copy = [...items];
    const selected = [];
    while (copy.length && selected.length < count) {
        const index = randomInt(0, copy.length - 1);
        selected.push(copy.splice(index, 1)[0]);
    }
    return selected;
}

function getNextSaoPauloMidnight(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const year = Number(values.year);
    const month = Number(values.month);
    const day = Number(values.day);
    const hour = Number(values.hour);
    const minute = Number(values.minute);
    const second = Number(values.second);
    const roundedNow = Math.floor(now.getTime() / 1000) * 1000;
    const localClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const localOffset = localClockAsUtc - roundedNow;
    const nextLocalMidnightAsUtc = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
    return new Date(nextLocalMidnightAsUtc - localOffset);
}

function getLifePurchaseResetMessage(now = new Date()) {
    const resetAt = getNextSaoPauloMidnight(now);
    const remainingMs = Math.max(0, resetAt.getTime() - now.getTime());
    const totalMinutes = Math.ceil(remainingMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const date = new Intl.DateTimeFormat('pt-BR', {
        timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(resetAt);
    return `${date} às 00:00 (Brasília) · faltam ${hours}h ${String(minutes).padStart(2, '0')}min`;
}

function getLifePurchaseStatus(state, now = new Date()) {
    const purchased = Number(state?.lives_purchased_today || 0);
    const lives = Number(state?.lives || 0);
    if (purchased >= 2) {
        return `Limite diário atingido. Próxima janela: **${getLifePurchaseResetMessage(now)}** (desde que você tenha menos de ${MAX_LIVES} vidas).`;
    }
    const nextCost = LIFE_PURCHASE_COSTS[purchased];
    const remaining = 2 - purchased;
    if (lives >= MAX_LIVES) {
        return `Você está no máximo de ${MAX_LIVES} vidas. Quando perder uma, poderá comprar outra por **${nextCost.toLocaleString('pt-BR')} PC**. Compras restantes hoje: **${remaining}/2**.`;
    }
    return `Próxima: **${nextCost.toLocaleString('pt-BR')} PC** · compras restantes hoje: **${remaining}/2**. O limite renova à meia-noite de Brasília.`;
}

// Aviso mostrado quando o jogador fica sem vidas: diz se dá para comprar uma vida
// (e quanto custa / se o saldo cobre) ou quando as vidas renovam, com botão de lembrete.
async function buildNoLivesNotice(discordId, state, now = new Date()) {
    const purchased = Number(state?.lives_purchased_today || 0);
    const floor = Number(state?.current_floor || 1);
    const resetAt = getNextSaoPauloMidnight(now);
    const resetUnix = Math.floor(resetAt.getTime() / 1000);

    let compra;
    if (purchased >= LIFE_PURCHASE_COSTS.length) {
        compra = '🛒 Você já usou as **2 compras de vida** de hoje. O limite renova à meia-noite de Brasília.';
    } else {
        const cost = LIFE_PURCHASE_COSTS[purchased];
        const restantes = `${LIFE_PURCHASE_COSTS.length - purchased}/${LIFE_PURCHASE_COSTS.length}`;
        let saldo = null;
        try {
            const rows = await query('SELECT purple_coins FROM players WHERE discord_id = ?', [discordId]);
            saldo = Number(rows && rows[0] ? rows[0].purple_coins : 0) || 0;
        } catch (error) {
            console.warn('[torre] Não foi possível consultar o saldo para o aviso de vidas:', error.message);
        }
        if (saldo !== null && saldo < cost) {
            compra = `🛒 Você pode comprar uma vida por **${cost.toLocaleString('pt-BR')} PC** com \`/torre comprarvida\` (compras restantes hoje: **${restantes}**), mas seu saldo é **${saldo.toLocaleString('pt-BR')} PC** (faltam **${(cost - saldo).toLocaleString('pt-BR')} PC**).`;
        } else {
            const saldoTexto = saldo !== null ? ` Seu saldo: **${saldo.toLocaleString('pt-BR')} PC**.` : '';
            compra = `🛒 **Dá para comprar uma vida agora!** Use \`/torre comprarvida\` por **${cost.toLocaleString('pt-BR')} PC** (compras restantes hoje: **${restantes}**).${saldoTexto}`;
        }
    }

    const content = `💔 **Você ficou sem vidas na Torre!**\n${compra}\n` +
        `⏳ Ou aguarde: suas vidas diárias renovam <t:${resetUnix}:R> (meia-noite de Brasília).\n` +
        `🏰 Seu progresso fica salvo no andar **${floor}/${TOTAL_FLOORS}**.`;
    return { content, components: [buildReminderRow('torre', discordId, resetAt.getTime())] };
}

async function comprarVidaTorre(discordId) {
    await ensureProgressRow(discordId);
    const { dateKey } = getSaoPauloDateParts();
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [progressRows] = await conn.query(`
            SELECT *, TO_CHAR(lives_purchase_date, 'YYYY-MM-DD') AS purchase_date_key
            FROM tower_progress WHERE discord_id = ? FOR UPDATE
        `, [discordId]);
        let state = progressRows && progressRows[0];
        if (!state) throw new Error('Progresso da Torre não encontrado.');
        if (state.match_active) throw new Error('Você não pode comprar vida durante uma partida.');
        if (Number(state.current_floor) > TOTAL_FLOORS) throw new Error('Você já concluiu a Torre desta temporada.');
        if (Number(state.lives) >= MAX_LIVES) throw new Error(`Você já está no limite de ${MAX_LIVES} vidas.`);

        let purchasesToday = state.purchase_date_key === dateKey ? Number(state.lives_purchased_today || 0) : 0;
        if (purchasesToday >= 2) throw new Error(`Você já comprou as duas vidas extras permitidas hoje. Poderá comprar novamente em ${getLifePurchaseResetMessage()} (se estiver abaixo de ${MAX_LIVES} vidas).`);
        const cost = LIFE_PURCHASE_COSTS[purchasesToday];
        const [playerRows] = await conn.query(
            'SELECT purple_coins, username, name FROM players WHERE discord_id = ? FOR UPDATE',
            [discordId]
        );
        const player = playerRows && playerRows[0];
        if (!player) throw new Error('Jogador não encontrado. Use `/obter` primeiro.');
        const balanceBefore = Number(player.purple_coins) || 0;
        if (balanceBefore < cost) throw new Error(`Você precisa de ${cost.toLocaleString('pt-BR')} PC. Seu saldo: ${balanceBefore.toLocaleString('pt-BR')} PC.`);

        const balanceAfter = balanceBefore - cost;
        await conn.query('UPDATE players SET purple_coins = ?, updated_at = NOW() WHERE discord_id = ?', [balanceAfter, discordId]);
        await conn.query(`
            UPDATE tower_progress
            SET lives = LEAST(lives + 1, ?), lives_purchased_today = ?, lives_purchase_date = ?, updated_at = NOW()
            WHERE discord_id = ?
        `, [MAX_LIVES, purchasesToday + 1, dateKey, discordId]);
        await conn.query(`
            INSERT INTO player_transactions (
                discord_user_id, discord_username, transaction_type, item_type, item_name,
                amount, balance_before, balance_after, metadata
            ) VALUES (?, ?, 'LOSS', 'torre_vida', ?, ?, ?, ?, ?)
            RETURNING id
        `, [discordId, player.username || player.name || null, `Vida extra da Torre #${purchasesToday + 1}`, -cost, balanceBefore, balanceAfter, JSON.stringify({ source: 'tower_life_purchase', purchaseNumber: purchasesToday + 1, date: dateKey })]);

        await conn.commit();
        return { lives: Math.min(Number(state.lives) + 1, MAX_LIVES), purchaseNumber: purchasesToday + 1, cost, balance: balanceAfter, remainingPurchases: 1 - purchasesToday };
    } catch (error) {
        try { await conn.rollback(); } catch (_) { }
        throw error;
    } finally {
        conn.release();
    }
}

function getBuffByCode(code) {
    return TOWER_BUFFS.find(buff => buff.code === code) || null;
}

async function showBuffDraft(interaction, state, floor) {
    let options = parseTowerJson(state.pending_buff_options, []);
    if (Number(state.pending_buff_floor) !== floor || !Array.isArray(options) || options.length !== 3) {
        options = sampleUnique(TOWER_BUFFS, 3).map(buff => buff.code);
        await query(`
            UPDATE tower_progress SET pending_buff_options = ?::jsonb, pending_buff_floor = ?, updated_at = NOW()
            WHERE discord_id = ?
        `, [JSON.stringify(options), floor, interaction.user.id]);
    }
    const buffs = options.map(getBuffByCode).filter(Boolean);
    const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle(`🧪 PREPARAÇÃO PARA O CHEFE · ANDAR ${floor}`)
        .setDescription(`Escolha **1 entre 3 melhorias**. Você terá **somente 1 buff ativo**: ele vale para este chefe e os andares comuns até o próximo chefe, com **15% de chance de quebrar após cada vitória em andar comum**. Ao chegar no próximo chefe, o buff anterior é removido automaticamente. A escolha fica salva mesmo que você saia do Discord.`)
        .addFields(buffs.map(buff => ({ name: buff.name, value: getBuffDisplayDescription(buff, floor), inline: false })))
        .setFooter({ text: 'Uma escolha por bloco de chefe · o buff pode quebrar antes do próximo chefe.' });
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`tower_buff|${interaction.user.id}|${floor}`)
        .setPlaceholder('Escolha seu único buff para este bloco de chefes')
        .addOptions(buffs.map(buff => ({ label: buff.name.replace(/^\S+\s/, '').slice(0, 100), value: buff.code, description: getBuffDisplayDescription(buff, floor).slice(0, 100) })));
    const payload = { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };

    // A escolha de buff é privada. O /torre entrar mantém partidas/resultados públicos,
    // mas remove a resposta pública temporária antes de enviar o menu ephemeral.
    try {
        await interaction.deleteReply();
    } catch (error) {
        console.warn('[torre] Não foi possível remover o placeholder público do draft:', error.message);
        try {
            await interaction.editReply({ content: '🔒 Uma escolha privada da Torre foi enviada para você.', embeds: [], components: [] });
        } catch (_) { }
    }
    return interaction.followUp({ ...payload, ephemeral: true });
}

async function handleBuffSelection(interaction) {
    const [, ownerId, floorRaw] = interaction.customId.split('|');
    if (ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Esta escolha não pertence a você.', ephemeral: true });
    const floor = Number(floorRaw);
    const code = interaction.values && interaction.values[0];
    const buff = getBuffByCode(code);
    if (!buff) return interaction.reply({ content: '❌ Buff inválido. Use `/torre entrar` novamente.', ephemeral: true });

    await interaction.deferUpdate();
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.query(
            'SELECT * FROM tower_progress WHERE discord_id = ? FOR UPDATE',
            [ownerId]
        );
        const state = rows?.[0];
        const options = parseTowerJson(state?.pending_buff_options, []);
        if (!state || Number(state.current_floor) !== floor || Number(state.pending_buff_floor) !== floor || !options.includes(code) || state.match_active) {
            throw new Error('Essa seleção expirou ou já foi utilizada. Use `/torre entrar` para continuar.');
        }

        const activeBuff = { ...buff, startFloor: floor, untilFloor: getBuffUntilFloor(floor) };
        const history = [{ code: buff.code, category: buff.category, floor, chosenAt: new Date().toISOString() }];
        await conn.query(`
            UPDATE tower_progress
            SET active_buff = ?::jsonb, active_buff_until_floor = ?, buff_history = ?::jsonb,
                pending_buff_options = '[]'::jsonb, pending_buff_floor = NULL, updated_at = NOW()
            WHERE discord_id = ?
        `, [JSON.stringify(activeBuff), activeBuff.untilFloor, JSON.stringify(history), ownerId]);
        await conn.commit();
        // Após escolher o buff, apresenta os contratos imediatamente no mesmo menu privado.
        // Assim o usuário não precisa de /torre contrato nem de outro /torre entrar só para abrir opções.
        await interaction.editReply(buildContractMenuPayload(ownerId, floor, state, {
            intro: `✅ Você escolheu **${buff.name}**! ${getBuffDisplayDescription(buff, floor)}\n\n⏳ Efeito ativo dos andares **${floor} a ${activeBuff.untilFloor}**.\n\nAgora escolha um contrato opcional para este chefe, ou siga sem contrato.`
        }));
    } catch (error) {
        try { await conn.rollback(); } catch (_) { }
        await interaction.editReply({ content: `❌ ${error.message}`, embeds: [], components: [] });
    } finally {
        conn.release();
    }
}

function addCardEffects(card, effects) {
    if (!card || !effects) return;
    for (const [stat, amount] of Object.entries(effects)) {
        card[stat] = clamp(numberOr(card[stat], 50) + Number(amount || 0), 1, 100);
    }
    syncCardStats(card);
}

function applyTowerRoguelikeEffects(cards, state, floor, contract) {
    const equipped = parseTowerJson(state.equipped_relics, []);
    const buff = parseTowerJson(state.active_buff, {});
    const applied = [];

    // Apenas o campo active_buff concede bônus. buff_history nunca é somado:
    // serve somente como trilha do último buff escolhido, sem sinergias acumuláveis.
    if (buff && buff.code && floor >= Number(buff.startFloor || 0)
        && floor <= Number(buff.untilFloor || state.active_buff_until_floor || 0)
        && !isBuffExpiredAtFloor(buff, floor)) {
        const brainBonus = equipped.includes('cerebro_tatico') ? 2 : 0;
        const scalingBonus = Number.isFinite(Number(buff.scalingBonus))
            ? Number(buff.scalingBonus)
            : getBuffScalingBonus(Number(buff.startFloor || floor));
        for (const role of POSITIONS) {
            const roleEffects = { ...(buff.effects?.all || {}), ...(buff.effects?.[role] || {}) };
            for (const key of Object.keys(roleEffects)) {
                roleEffects[key] = Number(roleEffects[key]) + scalingBonus + brainBonus;
            }
            addCardEffects(cards[role], roleEffects);
        }
        applied.push(buff.name || 'Buff da Torre');
    }

    if (equipped.includes('luvas_tita')) { addCardEffects(cards.gk, { defesa: 3 }); applied.push('Luvas do Titã (+3 DEF GK)'); }
    if (equipped.includes('chuteira_fantasma')) { addCardEffects(cards.pv, { drible: 4 }); applied.push('Chuteira Fantasma (+4 DRI PV)'); }
    const relicState = parseTowerJson(state.relic_state, {});
    if (equipped.includes('maestro_posicao')) {
        const role = POSITIONS.includes(relicState.maestroPosition) ? relicState.maestroPosition : 'gk';
        for (const stat of ['posicionamento', 'saidaDeBola', 'defesa', 'drible', 'passe', 'finalizacao']) {
            cards[role][stat] = clamp(numberOr(cards[role][stat], 50) * 1.05, 1, 99);
        }
        syncCardStats(cards[role]);
        applied.push(`Maestro da Posição (+5% em todos os atributos de ${role.toUpperCase()})`);
    }
    for (const mb of (relicState.merchantBuffs || [])) {
        if (mb.kind === 'attack') for (const role of ['vl','pv']) for (const stat of ['finalizacao','drible','passe']) cards[role][stat] = clamp(Math.round(numberOr(cards[role][stat],50)*(1+Number(mb.value||0))),1,100);
        if (mb.kind === 'defense') for (const role of ['gk','vl']) for (const stat of ['defesa','posicionamento','saidaDeBola']) cards[role][stat] = clamp(Math.round(numberOr(cards[role][stat],50)*(1+Number(mb.value||0))),1,100);
    }
    if (equipped.includes('coroa_espinhos')) applied.push('Coroa de Espinhos (IA +4%, PC +25%, carta extra +10 p.p.)');
    if (contract?.code === 'canhao_vidro') {
        addCardEffects(cards.gk, { defesa: -5 });
        addCardEffects(cards.pv, { finalizacao: 8 });
        applied.push('Contrato Canhão de Vidro');
    }
    if (equipped.includes('ruptura_regras')) {
        for (const role of POSITIONS) {
            for (const stat of ['posicionamento', 'saidaDeBola', 'defesa', 'drible', 'passe', 'finalizacao']) {
                cards[role][stat] = clamp(Math.round(numberOr(cards[role][stat], 50) * 1.02), 1, 100);
            }
            syncCardStats(cards[role]);
        }
        applied.push('Ruptura da Raridade (+2% em todos os atributos do time)');
    }
    return { applied, equipped };
}

async function carregarRelics(discordId) {
    await ensureTowerTables();
    return query(`
        SELECT relic_code, acquired_at, source, is_damaged
        FROM tower_relic_inventory WHERE discord_id = ? ORDER BY acquired_at ASC
    `, [discordId]);
}

async function getActiveEquippedRelicCodes(discordId, state) {
    const equipped = parseTowerJson(state?.equipped_relics, []);
    if (!equipped.length) return [];
    const marks = equipped.map(() => '?').join(',');
    const damagedRows = await query(`SELECT relic_code FROM tower_relic_inventory WHERE discord_id = ? AND is_damaged = TRUE AND relic_code IN (${marks})`, [discordId, ...equipped]);
    const damaged = new Set((damagedRows || []).map(row => row.relic_code));
    return applyOperationalRelicSlots(equipped.filter(code => !damaged.has(code)));
}

async function handleRelics(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const [state, inventory] = await Promise.all([ensureProgressRow(interaction.user.id), carregarRelics(interaction.user.id)]);
    if (!inventory.length) {
        const bossesWithoutRelic = Number(state.bosses_since_relic_event || 0);
        const progressText = bossesWithoutRelic >= RELIC_EVENT_PITY_BOSSES
            ? '🎁 Ao derrotar o próximo chefe, você receberá um baú de relíquia garantido.'
            : `🎁 Há 35% de chance de Baú Escolhido e 20% de Baú Surpresa nos eventos pós-chefe. Se um chefe passar sem você receber relíquia, o próximo garante um baú (${bossesWithoutRelic}/${RELIC_EVENT_PITY_BOSSES}).`;
        return interaction.editReply({ content: `🧿 Você ainda não possui relíquias. Você pode encontrá-las em eventos de chefe, em algumas vitórias comuns ou fabricá-las com PC e fragmentos.\n\n${progressText}` });
    }
    const equipped = parseTowerJson(state.equipped_relics, []);
    const options = inventory.map(item => {
        const relic = TOWER_RELICS[item.relic_code];
        if (!relic) return null;
        const spent = relic.code === 'segunda_chance' && state.second_chance_used;
        const details = getRelicChoiceDetails(relic.code);
        return {
            label: `${details?.rarityBadge || '⚪'} · ${relic.name.replace(/^\S+\s/, '')}`.slice(0, 100),
            value: relic.code,
            description: `${item.is_damaged ? '🔧 DESGASTADA · ' : ''}${relic.description}${spent ? ' Já foi consumida neste ciclo de proteção.' : ''}`.slice(0, 100),
            default: equipped.includes(relic.code)
        };
    }).filter(Boolean).slice(0, 25);
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`tower_relics|${interaction.user.id}`)
        .setPlaceholder('Escolha suas relíquias para a Torre')
        .setMinValues(0)
        .setMaxValues(Math.min(4, Math.max(1, options.length)))
        .addOptions(options);
    const embed = new EmbedBuilder()
        .setColor(0x7C3AED)
        .setTitle('🧿 RELÍQUIAS DA TORRE')
        .setDescription(`Você possui **${inventory.length}** relíquia(s). Pode equipar **2 relíquias normais** (qualquer raridade) e **1 Suprema** em um slot separado. O **Trono do Ascendente** libera ainda **1 slot adicional exclusivo para uma Lendária**. Só pode equipar uma Suprema e não pode repetir a mesma relíquia. Só as equipadas concedem efeito; o inventário é permanente.\n\n${options.map(option => `${option.default ? '✅' : '▫️'} **${option.label}** — ${option.description}`).join('\n')}\n\n🎁 Baú Escolhido aparece em 35% e Baú Surpresa em 20% dos eventos pós-chefe; se passar um chefe sem receber relíquia, o próximo chefe garante um Baú Escolhido.`)
        .setFooter({ text: 'As relíquias ficam com você entre temporadas.' });
    const components = [new ActionRowBuilder().addComponents(menu)];
    const relicState = parseTowerJson(state.relic_state, {});
    const addPositionMenu = (relicCode, label, stateKey) => {
        if (!equipped.includes(relicCode)) return;
        const selectedPosition = relicState[stateKey] || 'gk';
        const positionMenu = new StringSelectMenuBuilder()
            .setCustomId(`tower_relic_position|${interaction.user.id}|${relicCode}`)
            .setPlaceholder(`${label}: ${selectedPosition.toUpperCase()}`)
            .setMinValues(1).setMaxValues(1)
            .addOptions([
                { label: 'GK — Goleiro', value: 'gk', default: selectedPosition === 'gk' },
                { label: 'VL — Volante', value: 'vl', default: selectedPosition === 'vl' },
                { label: 'PV — Ponta', value: 'pv', default: selectedPosition === 'pv' }
            ]);
        components.push(new ActionRowBuilder().addComponents(positionMenu));
    };
    addPositionMenu('ima_cartas', 'Ímã favorece', 'imaPosition');
    addPositionMenu('maestro_posicao', 'Maestro potencializa', 'maestroPosition');
    return interaction.editReply({ embeds: [embed], components });
}

async function handleRelicPositionSelection(interaction) {
    const [, ownerId, rawRelicCode] = interaction.customId.split('|');
    const relicCode = rawRelicCode || 'ima_cartas';
    if (ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Esse menu não pertence a você.', ephemeral: true });
    if (!['ima_cartas', 'maestro_posicao'].includes(relicCode)) return interaction.reply({ content: '❌ Relíquia de posição inválida.', ephemeral: true });
    const position = interaction.values?.[0];
    if (!POSITIONS.includes(position)) return interaction.reply({ content: '❌ Posição inválida. Use GK, VL ou PV.', ephemeral: true });
    await interaction.deferUpdate();
    const rows = await query('SELECT equipped_relics, relic_state FROM tower_progress WHERE discord_id = ?', [ownerId]);
    if (!rows?.[0] || !parseTowerJson(rows[0].equipped_relics, []).includes(relicCode)) {
        const name = TOWER_RELICS[relicCode]?.name || relicCode;
        return interaction.followUp({ content: `❌ Equipe **${name}** antes de escolher uma posição.`, ephemeral: true });
    }
    const relicState = parseTowerJson(rows[0].relic_state, {});
    const stateKey = relicCode === 'ima_cartas' ? 'imaPosition' : 'maestroPosition';
    relicState[stateKey] = position;
    await query('UPDATE tower_progress SET relic_state = ?::jsonb, updated_at = NOW() WHERE discord_id = ?', [JSON.stringify(relicState), ownerId]);
    const feedback = relicCode === 'ima_cartas' ? '🧲 Ímã de Cartas' : '⚽ Maestro da Posição';
    return interaction.followUp({ content: `${feedback}: posição escolhida **${position.toUpperCase()}**.`, ephemeral: true });
}

async function handleRelicSelection(interaction) {
    const [, ownerId] = interaction.customId.split('|');
    if (ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Esse menu não pertence a você.', ephemeral: true });
    const selected = (interaction.values || []).filter(value => value !== 'none');

    await interaction.deferUpdate();
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [progressRows] = await conn.query(
            'SELECT * FROM tower_progress WHERE discord_id = ? FOR UPDATE',
            [ownerId]
        );
        if (!progressRows?.[0]) throw new Error('Progresso da Torre não encontrado.');
        const [inventory] = await conn.query(
            'SELECT relic_code FROM tower_relic_inventory WHERE discord_id = ? FOR UPDATE',
            [ownerId]
        );
        const owned = new Set(inventory.map(row => row.relic_code));
        if (selected.some(code => !owned.has(code) || !TOWER_RELICS[code])) {
            throw new Error('Uma das relíquias selecionadas não pertence a você.');
        }
        validateRelicLoadout(selected, Number(progressRows[0].ascension_level || 0));
        const normalizedSelection = normalizeRelicLoadout(selected);
        await conn.query(
            'UPDATE tower_progress SET equipped_relics = ?::jsonb, updated_at = NOW() WHERE discord_id = ?',
            [JSON.stringify(normalizedSelection), ownerId]
        );
        await conn.commit();
        const names = normalizedSelection.map(code => TOWER_RELICS[code]?.name).filter(Boolean);
        await interaction.editReply({ content: selected.length ? `✅ Relíquias equipadas:\n${names.join('\n')}` : '✅ Todas as relíquias foram desequipadas.', embeds: [], components: [] });
    } catch (error) {
        try { await conn.rollback(); } catch (_) { }
        await interaction.editReply({ content: `❌ ${error.message}`, embeds: [], components: [] });
    } finally {
        conn.release();
    }
}

function createChosenRelicOptions(rng = Math.random, options = {}) {
    const ascensionLevel = Number(options.ascensionLevel || 0);
    const chosen = [];
    const eligibleRarities = ascensionLevel >= 2
        ? ['rara', 'epica', 'lendaria', 'suprema']
        : ['rara', 'epica', 'lendaria'];
    const pickFromTier = rarity => {
        const pool = Object.values(TOWER_RELICS).filter(relic => relic.rarity === rarity && !chosen.includes(relic.code));
        return pool.length ? pool[Math.floor(rng() * pool.length)].code : null;
    };
    const pickWeightedAvailable = () => {
        const weights = { rara: 60, epica: 30, lendaria: 10 };
        const available = Object.keys(weights).filter(rarity => Object.values(TOWER_RELICS).some(relic => relic.rarity === rarity && !chosen.includes(relic.code)));
        if (!available.length) return null;
        // Se um tier já foi esgotado pelas opções, redistribui o peso entre os tiers restantes.
        const filteredWeights = Object.fromEntries(available.map(rarity => [rarity, weights[rarity]]));
        const rarity = pickWeightedRarity(rng, filteredWeights);
        return pickFromTier(rarity) || pickFromTier(available[0]);
    };

    // Ascensão 2+: chance baixa de aparecer uma Suprema como uma das opções.
    if (ascensionLevel >= 2 && rng() < 0.015) {
        const supreme = pickFromTier('suprema');
        if (supreme) chosen.push(supreme);
    }

    // Pelo menos uma das três opções é Épica ou superior (75% Épica / 25% Lendária).
    const epicPlus = pickWeightedRarity(rng, { epica: 75, lendaria: 25 });
    const guaranteed = pickFromTier(epicPlus) || pickFromTier(epicPlus === 'epica' ? 'lendaria' : 'epica');
    if (guaranteed) chosen.push(guaranteed);

    while (chosen.length < 3) {
        const code = pickWeightedAvailable();
        if (!code) {
            const fallback = Object.values(TOWER_RELICS).find(relic => eligibleRarities.includes(relic.rarity) && !chosen.includes(relic.code));
            if (!fallback) break;
            chosen.push(fallback.code);
        } else chosen.push(code);
    }
    return chosen;
}

function rerollChosenRelicOptionsKeepingRarities(currentOptions = [], rng = Math.random, ascensionLevel = 0) {
    const used = new Set();
    return currentOptions.map(code => {
        const original = TOWER_RELICS[code];
        const rarity = original?.rarity;
        if (!rarity || rarity === 'legado') return code;
        let pool = Object.values(TOWER_RELICS).filter(relic => relic.rarity === rarity && relic.code !== code && !used.has(relic.code));
        if (!pool.length) pool = Object.values(TOWER_RELICS).filter(relic => relic.rarity === rarity && !used.has(relic.code));
        if (!pool.length) return code;
        const nextCode = pool[Math.floor(rng() * pool.length)].code;
        used.add(nextCode);
        return nextCode;
    });
}

function makeRandomTowerEvent(floor, rng = Math.random, options = {}) {
    if (options.forceTreasure) {
        return {
            type: 'tesouro_escolhido',
            title: '🎁 Baú Escolhido Garantido',
            description: 'A Torre garantiu três opções de relíquia porque você venceu um chefe sem receber uma. Escolha uma.',
            options: createChosenRelicOptions(rng, { ascensionLevel: options.ascensionLevel }),
            floor,
            pityGuaranteed: true,
            createdAt: new Date().toISOString()
        };
    }
    const totalWeight = TOWER_EVENT_WEIGHTS.reduce((sum, item) => sum + item.weight, 0);
    let roll = rng() * totalWeight;
    let type = TOWER_EVENT_WEIGHTS[TOWER_EVENT_WEIGHTS.length - 1].type;
    for (const option of TOWER_EVENT_WEIGHTS) {
        roll -= option.weight;
        if (roll < 0) { type = option.type; break; }
    }
    if (type === 'medico') return { type, title: '🧑‍⚕️ Médico da Torre', description: 'Um médico apareceu entre os andares. Ele pode recuperar uma vida.', floor, createdAt: new Date().toISOString() };
    if (type === 'tesouro_escolhido') return { type, title: '🎁 Baú Escolhido', description: 'Escolha uma entre três relíquias. Há sempre ao menos uma opção Épica ou superior.', floor, options: createChosenRelicOptions(rng, { ascensionLevel: options.ascensionLevel }), createdAt: new Date().toISOString() };
    if (type === 'tesouro_surpresa') return { type, title: '🧪 Baú Surpresa', description: 'Receba uma relíquia aleatória. Duplicatas viram 250 PC.', floor, ascensionLevel: Number(options.ascensionLevel || 0), createdAt: new Date().toISOString() };
    if (type === 'laboratorio') return { type, title: '🧪 Laboratório', description: 'Escolha seu único buff ativo. Ele dura até antes do próximo chefe e pode quebrar após uma vitória em andar comum.', floor, options: sampleUnique(TOWER_BUFFS, 3).map(buff => buff.code), createdAt: new Date().toISOString() };
    if (type === 'mercador') {
        const activeCodes = new Set(options.activeMerchantCodes || []);
        const available = MERCHANT_OFFERS.filter(buff => !activeCodes.has(buff.code));
        const pool = available.length >= 3 ? available : MERCHANT_OFFERS;
        return { type, title: '🔮 Mercador Misterioso', description: 'Escolha uma das três melhorias temporárias. Buffs iguais não acumulam; uma oferta já ativa não pode ser comprada novamente.', floor, options: sampleUnique(pool, 3).map(buff => buff.code), createdAt: new Date().toISOString() };
    }
    return { type, title: '⚠️ Arena Amaldiçoada', description: 'Aceite uma luta mais perigosa no próximo andar em troca de uma recompensa maior.', floor, createdAt: new Date().toISOString() };
}

function rollTreasureHunterEvent(floor, relicCodes = [], relicState = {}, rng = Math.random, options = {}) {
    if (!relicCodes.includes('fita_isolante') || isBossFloor(floor) || Number(floor) >= TOTAL_FLOORS || Boolean(relicState.treasureHunterEventUsedSinceBoss)) {
        return { triggered: false, event: null };
    }
    if (rng() >= TREASURE_HUNTER_EVENT_CHANCE) return { triggered: false, event: null };
    const event = makeRandomTowerEvent(floor, rng, {
        ascensionLevel: options.ascensionLevel,
        activeMerchantCodes: options.activeMerchantCodes || []
    });
    event.foundByRelic = 'fita_isolante';
    return { triggered: true, event };
}

function buildAscendantChallengeRow(userId, bossFloor) {
    return new ActionRowBuilder().addComponents(
        ...ASCENDANT_CHALLENGE_STAKES.map(stake => new ButtonBuilder()
            .setCustomId(`tower_challenge|${userId}|${bossFloor}|${stake}`)
            .setLabel(`Apostar ${stake} PC`)
            .setStyle(stake === 500 ? ButtonStyle.Success : ButtonStyle.Primary))
    );
}

async function handleAscendantChallengeButton(interaction) {
    const [, ownerId, rawBossFloor, rawStake] = interaction.customId.split('|');
    if (ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Esse desafio não pertence a você.', ephemeral: true });
    const bossFloor = Number(rawBossFloor);
    const stake = Number(rawStake);
    if (!isBossFloor(bossFloor) || bossFloor >= TOTAL_FLOORS || !ASCENDANT_CHALLENGE_STAKES.includes(stake)) {
        return interaction.reply({ content: '❌ Aposta ou chefe inválido para o Desafio do Ascendente.', ephemeral: true });
    }
    await interaction.deferUpdate();
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [progressRows] = await conn.query('SELECT * FROM tower_progress WHERE discord_id = ? FOR UPDATE', [ownerId]);
        const state = progressRows?.[0];
        if (!state || Number(state.current_floor) !== bossFloor + 1) throw new Error('Esse desafio não corresponde mais ao seu progresso atual.');
        if (state.match_active) throw new Error('Termine a partida atual antes de aceitar um desafio.');
        const relicState = parseTowerJson(state.relic_state, {});
        if (!parseTowerJson(state.equipped_relics, []).includes('aposta_ascendente')) throw new Error('Equipe a relíquia Desafio do Ascendente para aceitar a aposta.');
        const [relicRows] = await conn.query('SELECT is_damaged FROM tower_relic_inventory WHERE discord_id = ? AND relic_code = ? FOR UPDATE', [ownerId, 'aposta_ascendente']);
        if (!relicRows?.[0] || relicRows[0].is_damaged) throw new Error('O Desafio do Ascendente está desgastado. Reative a relíquia antes de apostar.');
        const usedBosses = Array.isArray(relicState.challengeBossesUsed) ? relicState.challengeBossesUsed.map(Number) : [];
        if (usedBosses.includes(bossFloor)) throw new Error('Você já tentou o Desafio do Ascendente neste bloco. Não é possível repetir no mesmo chefe.');
        if (relicState.ascendantChallenge) throw new Error('Você já tem um Desafio do Ascendente em andamento.');
        const [playerRows] = await conn.query('SELECT purple_coins, purple_coins_earned, username, name FROM players WHERE discord_id = ? FOR UPDATE', [ownerId]);
        const player = playerRows?.[0];
        if (!player || Number(player.purple_coins || 0) < stake) throw new Error(`Você precisa de ${stake} PC para aceitar esse desafio.`);
        const before = Number(player.purple_coins) || 0;
        const after = before - stake;
        await conn.query('UPDATE players SET purple_coins = ?, updated_at = NOW() WHERE discord_id = ?', [after, ownerId]);
        await conn.query(`INSERT INTO player_transactions (discord_user_id,discord_username,transaction_type,item_type,item_name,amount,balance_before,balance_after,metadata) VALUES (?,?,'LOSS','tower_ascendant_challenge','Aposta do Desafio do Ascendente',?,?,?,?) RETURNING id`, [ownerId, player.username || player.name || null, -stake, before, after, JSON.stringify({ bossFloor, stake, source: 'tower_ascendant_challenge' })]);
        usedBosses.push(bossFloor);
        relicState.challengeBossesUsed = usedBosses.slice(-20);
        relicState.ascendantChallenge = { bossFloor, stake, stage: 'rematch', acceptedAt: new Date().toISOString() };
        await conn.query('UPDATE tower_progress SET relic_state = ?::jsonb, updated_at = NOW() WHERE discord_id = ?', [JSON.stringify(relicState), ownerId]);
        await conn.commit();
        const pendingEvent = Boolean(state.pending_event);
        const challengePrize = getAscendantChallengeReward(stake);
        await interaction.editReply({ content: `🎰 **Desafio do Ascendente aceito!** Você apostou **${stake} PC**.\n\n${pendingEvent ? 'Primeiro resolva o evento pendente da Torre. ' : ''}Depois use **/torre entrar** para enfrentar a revanche do chefe ${bossFloor}. Se vencer a revanche e a próxima luta, recebe a aposta de volta, **+${challengePrize.fragments} fragmentos** e **1 carta Médio+** (Médio ${challengePrize.cardWeights.medio}% / GOAT ${challengePrize.cardWeights.goat}% / Prime ${challengePrize.cardWeights.prime}%). Uma derrota encerra o desafio e a aposta é perdida.`, components: [] });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        await interaction.editReply({ content: `❌ ${error.message}`, components: [] });
    } finally {
        conn.release();
    }
}

const RELIC_RARITY_PRESENTATION = {
    rara: { label: 'Rara', badge: '🟢 RARA', color: 0x22C55E },
    epica: { label: 'Épica', badge: '🔵 ÉPICA', color: 0x3B82F6 },
    lendaria: { label: 'Lendária', badge: '🟣 LENDÁRIA', color: 0xA855F7 },
    suprema: { label: 'Suprema', badge: '🔴 SUPREMA', color: 0xEF4444 },
    legado: { label: 'Legado', badge: '⚪ LEGADO', color: 0x9CA3AF }
};

function getRelicChoiceDetails(code) {
    const relic = TOWER_RELICS[code];
    if (!relic) return null;
    const rarity = RELIC_RARITY_PRESENTATION[relic.rarity] || { label: relic.rarity || 'Desconhecida', badge: '⚪ RARIDADE DESCONHECIDA' };
    const description = relic.description || 'Esta relíquia não possui uma descrição cadastrada.';
    return {
        code: relic.code,
        name: relic.name,
        rarity: relic.rarity,
        rarityLabel: rarity.label,
        rarityBadge: rarity.badge,
        description,
        menuLabel: `${relic.name} · ${rarity.label}`.slice(0, 100),
        menuDescription: `${rarity.badge} · ${description}`.slice(0, 100)
    };
}

function buildRelicChoiceFieldData(codes = []) {
    return codes.map((code, index) => {
        const relic = getRelicChoiceDetails(code);
        if (!relic) return null;
        return {
            name: `${index + 1}. ${relic.rarityBadge} · ${relic.name}`.slice(0, 256),
            value: `**Efeito:** ${relic.description}`.slice(0, 1024),
            inline: false
        };
    }).filter(Boolean);
}

function buildRelicAcquisitionMessage(code, options = {}) {
    const relic = getRelicChoiceDetails(code);
    if (!relic) return 'A relíquia foi recebida, mas seus detalhes não estão cadastrados.';
    if (options.duplicate) {
        const amount = Number(options.duplicateCompensation) || 250;
        return `🎁 **Relíquia duplicada:** ${relic.name}\n**Raridade:** ${relic.rarityBadge}\n**Efeito:** ${relic.description}\n\nVocê já possuía esta relíquia e recebeu **+${amount} PC** pela duplicata.`;
    }
    if (options.compensation) {
        return `🎁 **Compensação recebida!**\n**${relic.name}**\n**Raridade:** ${relic.rarityBadge}\n**Efeito:** ${relic.description}\n\nA relíquia foi adicionada à sua coleção. Use /torre reliquias para equipá-la.`;
    }
    return `🎉 **RELÍQUIA RECEBIDA!**\n**${relic.name}**\n**Raridade:** ${relic.rarityBadge}\n**Efeito:** ${relic.description}\n\nAdicionada à sua coleção. Use /torre reliquias para equipá-la.`;
}

function buildTowerEventEmbed(event) {
    const embed = new EmbedBuilder()
        .setColor(event.type === 'tesouro_escolhido' ? 0x7C3AED : 0xF59E0B)
        .setTitle(event.title || '🎲 Evento da Torre')
        .setDescription(event.description || 'Escolha o que fazer neste evento.');

    if (event.type === 'tesouro_escolhido') {
        const fields = buildRelicChoiceFieldData(event.options || []);
        if (fields.length) {
            embed.addFields(fields);
            embed.setFooter({ text: 'Compare raridade e efeito. Depois escolha uma das três relíquias no menu abaixo.' });
        }
    } else if (event.type === 'tesouro_surpresa') {
        embed.setFooter({ text: 'A raridade e o efeito da relíquia aparecerão assim que o baú for aberto.' });
    }
    return embed;
}

function buildEventRow(userId, event) {
    let options = [];
    if (event.type === 'medico') options = [{ label: 'Recuperar 1 vida', value: 'heal', description: 'Recupere uma vida (máximo 5).', emoji: '❤️' }];
    else if (event.type === 'tesouro_escolhido') options = (event.options || []).map(code => {
        const relic = getRelicChoiceDetails(code);
        return relic ? { label: relic.menuLabel, value: `choose_relic:${code}`, description: relic.menuDescription } : null;
    }).filter(Boolean);
    else if (event.type === 'tesouro_surpresa') options = [{ label: 'Abrir o baú surpresa', value: 'relic', description: 'Você verá nome, raridade e efeito após abrir.', emoji: '🎁' }];
    else if (event.type === 'laboratorio' || event.type === 'mercador') {
        options = (event.options || []).map(code => {
            if (event.type === 'mercador') { const offer = MERCHANT_OFFERS.find(item => item.code === code); return offer ? {label:offer.name.slice(0,100),value:`merchant:${code}`,description:`${offer.price} PC · ${offer.description}`.slice(0,100)} : null; }
            const buff = getBuffByCode(code);
            return buff ? { label: buff.name.replace(/^\S+\s/, '').slice(0, 100), value: `buff:${code}`, description: getBuffDisplayDescription(buff, event.floor).slice(0, 100) } : null;
        }).filter(Boolean);
    } else if (event.type === 'arena') options = [{ label: 'Aceitar a Arena Amaldiçoada', value: 'accept', description: 'Próximo combate: IA +5% de pressão e recompensa +30%.', emoji: '☠️' }];
    if (!event.compensationRelic) {
        options.push({ label: '🔄 Rerrolar evento (se tiver a Bússola)', value: 'reroll', description: 'Bússola do Explorador: uma nova rolagem neste evento.' });
        options.push({ label: 'Ignorar evento', value: 'skip', description: 'Continuar sem pegar a oferta.', emoji: '➡️' });
    }
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`tower_event|${userId}`)
            .setPlaceholder('Escolha como interagir com o evento')
            .addOptions(options.slice(0, 25))
    );
}

async function handleEventSelection(interaction) {
    const [, ownerId] = interaction.customId.split('|');
    if (ownerId !== interaction.user.id) {
        return interaction.reply({ content: '❌ Este evento não pertence a você.', ephemeral: true });
    }

    await interaction.deferUpdate();
    const selected = interaction.values?.[0] || 'skip';
    const conn = await pool.getConnection();
    let message = 'Você ignorou o evento.';
    let eventTitle = 'Evento da Torre';

    try {
        await conn.beginTransaction();
        const [progressRows] = await conn.query(
            'SELECT * FROM tower_progress WHERE discord_id = ? FOR UPDATE',
            [ownerId]
        );
        const state = progressRows?.[0];
        const event = state ? parseTowerJson(state.pending_event, null) : null;
        if (!state || !event) throw new Error('Este evento já foi resolvido. Use `/torre entrar`.');
        eventTitle = event.title || eventTitle;

        if (selected === 'reroll') {
            if (event.compensationRelic) {
                throw new Error('Este baú é uma compensação garantida e não pode ser rerrolado. Abra-o para receber sua relíquia.');
            }
            const equipped = parseTowerJson(state.equipped_relics, []);
            const relicState = parseTowerJson(state.relic_state, {});
            const [rerollRelicRows] = await conn.query('SELECT relic_code, is_damaged FROM tower_relic_inventory WHERE discord_id = ? AND relic_code = ? FOR UPDATE', [ownerId, 'bussola_explorador']);
            const compassActive = equipped.includes('bussola_explorador') && rerollRelicRows?.[0] && !rerollRelicRows[0].is_damaged;
            const canCompass = compassActive && Number(relicState.compassUsedFloor || 0) !== Number(event.floor || state.current_floor);
            if (!canCompass) throw new Error('Você precisa da Bússola do Explorador ativa e ainda não utilizada neste evento.');
            relicState.compassUsedFloor = Number(event.floor || state.current_floor);
            const merchantCodes = (relicState.merchantBuffs || []).filter(buff => Number(buff.remaining || 0) > 0).map(buff => buff.code);
            const nextEvent = makeRandomTowerEvent(Number(event.floor || state.current_floor), Math.random, {
                ascensionLevel: Number(state.ascension_level || 0),
                        activeMerchantCodes: merchantCodes
            });
            await conn.query('UPDATE tower_progress SET pending_event = ?::jsonb, relic_state = ?::jsonb, updated_at = NOW() WHERE discord_id = ?', [JSON.stringify(nextEvent), JSON.stringify(relicState), ownerId]);
            await conn.commit();
            const rerolledEmbed = buildTowerEventEmbed({ ...nextEvent, description: `🔄 O resultado foi rerrolado.\n\n${nextEvent.description}` });
            return interaction.editReply({ embeds: [rerolledEmbed], components: [buildEventRow(ownerId, nextEvent)] });
        }

        if (selected === 'heal' && event.type === 'medico') {
            const before = Number(state.lives) || 0;
            const after = Math.min(MAX_LIVES, before + 1);
            await conn.query(
                'UPDATE tower_progress SET lives = ?, pending_event = NULL, updated_at = NOW() WHERE discord_id = ?',
                [after, ownerId]
            );
            message = after > before
                ? '❤️ O médico recuperou uma vida!'
                : `❤️ Você já estava no limite de ${MAX_LIVES} vidas. O médico não conseguiu recuperar outra.`;
        } else if ((selected === 'relic' && event.type === 'tesouro_surpresa') || (selected.startsWith('choose_relic:') && event.type === 'tesouro_escolhido')) {
            const [inventoryRows] = await conn.query(
                'SELECT relic_code FROM tower_relic_inventory WHERE discord_id = ?',
                [ownerId]
            );
            const ownedCodes = new Set((inventoryRows || []).map(row => row.relic_code));
            const eligibleRelics = Object.values(TOWER_RELICS).filter(r => r.rarity !== 'legado' && (r.rarity !== 'suprema' || Number(state.ascension_level || 0) >= 2) && (!event.compensationRelic || !ownedCodes.has(r.code)));
            const selectedCode = selected.startsWith('choose_relic:') ? selected.slice('choose_relic:'.length) : null;
            if (selectedCode && !(event.options || []).includes(selectedCode)) throw new Error('Essa relíquia não faz parte do baú escolhido.');
            if (!eligibleRelics.length) {
                const compensationAmount = event.compensationRelic ? 500 : 250;
                const [playerRows] = await conn.query('SELECT purple_coins, username, name FROM players WHERE discord_id = ? FOR UPDATE', [ownerId]);
                const player = playerRows?.[0];
                if (!player) throw new Error('Jogador não encontrado para a compensação.');
                const before = Number(player.purple_coins) || 0;
                const after = before + compensationAmount;
                await conn.query('UPDATE players SET purple_coins = ?, purple_coins_earned = COALESCE(purple_coins_earned,0) + ?, updated_at = NOW() WHERE discord_id = ?', [after, compensationAmount, ownerId]);
                await conn.query(`INSERT INTO player_transactions (discord_user_id,discord_username,transaction_type,item_type,item_name,amount,balance_before,balance_after,metadata) VALUES (?,?,'GAIN',?,?,?, ?,?,?) RETURNING id`, [ownerId, player.username || player.name || null, event.compensationRelic ? 'tower_relic_compensation' : 'tower_relic_duplicate', event.compensationRelic ? 'Coleção completa — compensação' : 'Coleção disponível esgotada — duplicata', compensationAmount, before, after, JSON.stringify({ source: event.compensationRelic ? 'tower_update_compensation' : 'tower_chest_full_collection' })]);
                const stateAfterComp = parseTowerJson(state.relic_state, {});
                if (event.compensationRelic) {
                    stateAfterComp.relicCompensationPending = false;
                    stateAfterComp.relicCompensationGranted = true;
                }
                await conn.query('UPDATE tower_progress SET pending_event = NULL, bosses_since_relic_event = 0, relic_state = ?::jsonb, updated_at = NOW() WHERE discord_id = ?', [JSON.stringify(stateAfterComp), ownerId]);
                message = event.compensationRelic
                    ? `🎁 Sua coleção elegível já está completa. A compensação foi convertida em **${compensationAmount} PC**.`
                    : `🎁 Você já possui todas as relíquias disponíveis nesta ascensão. Recebeu **${compensationAmount} PC**.`;
                await conn.commit();
                return interaction.editReply({ content: `🎲 **Evento resolvido — ${eventTitle}**\n${message}`, embeds: [], components: [] });
            }
            let code = selectedCode;
            if (event.compensationRelic && code && ownedCodes.has(code)) {
                const preferred = eligibleRelics.filter(relic => relic.rarity === TOWER_RELICS[code]?.rarity);
                code = (preferred.length ? preferred : eligibleRelics)[randomInt(0, (preferred.length ? preferred : eligibleRelics).length - 1)].code;
            }
            if (!code) {
                const tierRoll = Math.random();
                const rarity = Number(state.ascension_level || 0) >= 2 && tierRoll < 0.02
                    ? 'suprema'
                    : tierRoll < 0.60 ? 'rara' : tierRoll < 0.90 ? 'epica' : 'lendaria';
                let pool = eligibleRelics.filter(r => r.rarity === rarity);
                if (!pool.length) pool = eligibleRelics.filter(r => ['rara','epica','lendaria'].includes(r.rarity));
                if (!pool.length) pool = eligibleRelics;
                code = pool[randomInt(0, pool.length - 1)].code;
            }
            const relic = TOWER_RELICS[code];
            const source = event.compensationRelic ? 'tower_update_compensation' : event.type === 'tesouro_escolhido' ? 'tower_chosen_chest' : 'tower_surprise_chest';
            const [insert] = await conn.query(`
                INSERT INTO tower_relic_inventory (discord_id, relic_code, source)
                VALUES (?, ?, ?)
                ON CONFLICT (discord_id, relic_code) DO NOTHING
                RETURNING relic_id
            `, [ownerId, code, source]);
            if (Number(insert?.affectedRows || 0) === 0) {
                const [playerRows] = await conn.query(
                    'SELECT purple_coins, username, name FROM players WHERE discord_id = ? FOR UPDATE',
                    [ownerId]
                );
                const player = playerRows?.[0];
                if (!player) throw new Error('Jogador não encontrado para receber a compensação da relíquia duplicada.');
                const duplicateCompensation = Number(event.duplicateCompensation) || 250;
                const before = Number(player.purple_coins) || 0;
                const after = before + duplicateCompensation;
                await conn.query(`
                    UPDATE players SET purple_coins = ?, purple_coins_earned = COALESCE(purple_coins_earned, 0) + ?, updated_at = NOW()
                    WHERE discord_id = ?
                `, [after, duplicateCompensation, ownerId]);
                await conn.query(`
                    INSERT INTO player_transactions (
                        discord_user_id, discord_username, transaction_type, item_type, item_name,
                        amount, balance_before, balance_after, metadata
                    ) VALUES (?, ?, 'GAIN', 'torre_relic_duplicate', ?, ?, ?, ?, ?)
                    RETURNING id
                `, [ownerId, player.username || player.name || null, `${relic.name} duplicada`, duplicateCompensation, before, after, JSON.stringify({ source: event.type === 'tesouro_escolhido' ? 'tower_chosen_chest' : 'tower_surprise_chest', duplicateRelic: code })]);
                message = buildRelicAcquisitionMessage(code, { duplicate: true, duplicateCompensation });
            } else {
                message = buildRelicAcquisitionMessage(code, { compensation: Boolean(event.compensationRelic) });
            }
            const nextRelicState = parseTowerJson(state.relic_state, {});
            if (event.compensationRelic && Number(insert?.affectedRows || 0) > 0) {
                nextRelicState.relicCompensationPending = false;
                nextRelicState.relicCompensationGranted = true;
            }
            await conn.query('UPDATE tower_progress SET pending_event = NULL, bosses_since_relic_event = 0, relic_state = ?::jsonb, updated_at = NOW() WHERE discord_id = ?', [JSON.stringify(nextRelicState), ownerId]);
        } else if (selected.startsWith('merchant:') && event.type === 'mercador') {
            const offer = MERCHANT_OFFERS.find(item => item.code === selected.slice(8));
            if (!offer || !(event.options || []).includes(offer.code)) throw new Error('Oferta inválida para este mercador.');
            const currentBuffs = parseTowerJson(state.relic_state, {}).merchantBuffs || [];
            if (currentBuffs.some(buff => buff.code === offer.code && Number(buff.remaining || 0) > 0)) {
                throw new Error(`**${offer.name}** já está ativo. Buffs iguais não acumulam e nenhuma moeda foi cobrada.`);
            }
            if (offer.kind === 'heal' && Number(state.lives || 0) >= MAX_LIVES) throw new Error(`Você já está no limite de ${MAX_LIVES} vidas. Não vou cobrar por uma recuperação sem efeito.`);
            const [playerRows] = await conn.query('SELECT purple_coins,purple_coins_earned,username,name FROM players WHERE discord_id = ? FOR UPDATE',[ownerId]);
            const player=playerRows?.[0];
            if (!player || Number(player.purple_coins)<offer.price) throw new Error(`Você precisa de ${offer.price} PC. O evento continua aberto; use /torre entrar para reabrir ou ignore-o.`);
            const before=Number(player.purple_coins)||0, after=before-offer.price;
            await conn.query('UPDATE players SET purple_coins=?,updated_at=NOW() WHERE discord_id=?',[after,ownerId]);
            await conn.query(`INSERT INTO player_transactions (discord_user_id,discord_username,transaction_type,item_type,item_name,amount,balance_before,balance_after,metadata) VALUES (?,?,'LOSS','torre_mercador',?,?,?, ?,?) RETURNING id`,[ownerId,player.username||player.name||null,offer.name,-offer.price,before,after,JSON.stringify({source:'tower_merchant',offer:offer.code})]);
            const relicState=parseTowerJson(state.relic_state,{});
            if (offer.kind==='heal') {
                const lives=Math.min(MAX_LIVES,Number(state.lives||0)+1);
                await conn.query('UPDATE tower_progress SET lives=?,pending_event=NULL,updated_at=NOW() WHERE discord_id=?',[lives,ownerId]);
                message=lives>Number(state.lives||0)?`🩹 Recuperação comprada: +1 vida (${lives}/${MAX_LIVES}).`:`🩹 Você já está no limite de ${MAX_LIVES} vidas.`;
            } else {
                const buffs=Array.isArray(relicState.merchantBuffs)?relicState.merchantBuffs:[];
                const activeSameBuff = buffs.find(buff => buff.code === offer.code && Number(buff.remaining || 0) > 0);
                if (activeSameBuff) throw new Error('Esse buff já está ativo; ele não pode acumular nem ser cobrado novamente.');
                buffs.push({...offer,remaining:offer.count||1,acquiredFloor:Number(state.current_floor||event.floor||1)});
                relicState.merchantBuffs=buffs;
                await conn.query('UPDATE tower_progress SET relic_state=?::jsonb,pending_event=NULL,updated_at=NOW() WHERE discord_id=?',[JSON.stringify(relicState),ownerId]);
                message=`✅ Comprou **${offer.name}** por ${offer.price} PC. ${offer.description}`;
            }
        } else if (selected.startsWith('buff:') && event.type === 'laboratorio') {
            const buff = getBuffByCode(selected.slice(5));
            if (!buff || !(event.options || []).includes(buff.code)) {
                throw new Error('Melhoria inválida para este evento.');
            }
            if (event.type === 'mercador') {
                const [playerRows] = await conn.query(
                    'SELECT purple_coins, username, name FROM players WHERE discord_id = ? FOR UPDATE',
                    [ownerId]
                );
                const player = playerRows?.[0];
                if (!player || Number(player.purple_coins) < 300) {
                    throw new Error('Você precisa de 300 PC para comprar essa melhoria. O evento continua disponível; use /torre entrar para reabrir as opções ou ignore-o.');
                }
                const before = Number(player.purple_coins) || 0;
                const after = before - 300;
                await conn.query('UPDATE players SET purple_coins = ?, updated_at = NOW() WHERE discord_id = ?', [after, ownerId]);
                await conn.query(`
                    INSERT INTO player_transactions (
                        discord_user_id, discord_username, transaction_type, item_type, item_name,
                        amount, balance_before, balance_after, metadata
                    ) VALUES (?, ?, 'LOSS', 'torre_mercador', ?, -300, ?, ?, ?)
                    RETURNING id
                `, [ownerId, player.username || player.name || null, buff.name, before, after, JSON.stringify({ source: 'tower_merchant', buff: buff.code })]);
            }
            const nextFloor = Number(state.current_floor);
            const activeBuff = { ...buff, startFloor: nextFloor, untilFloor: getBuffUntilFloor(nextFloor) };
            const history = [{ code: buff.code, category: buff.category, floor: nextFloor, source: event.type, chosenAt: new Date().toISOString() }];
            await conn.query(`
                UPDATE tower_progress SET active_buff = ?::jsonb, active_buff_until_floor = ?,
                    buff_history = ?::jsonb, pending_event = NULL, updated_at = NOW()
                WHERE discord_id = ?
            `, [JSON.stringify(activeBuff), activeBuff.untilFloor, JSON.stringify(history), ownerId]);
            message = `✅ Você recebeu **${buff.name}**. ${getBuffDisplayDescription(buff, nextFloor)} É seu único buff ativo: vale até o andar ${activeBuff.untilFloor}, antes do próximo chefe, com 15% de chance de quebrar após cada vitória em andar comum.`;
        } else if (selected === 'accept' && event.type === 'arena') {
            const nextFloor = Number(state.current_floor);
            const contract = { ...TOWER_CONTRACTS.sem_misericordia, floor: nextFloor, source: 'tower_event' };
            await conn.query(
                'UPDATE tower_progress SET active_contract = ?::jsonb, pending_event = NULL, updated_at = NOW() WHERE discord_id = ?',
                [JSON.stringify(contract), ownerId]
            );
            message = '☠️ Você aceitou a Arena Amaldiçoada! Próximo combate: IA +5% de pressão e recompensas em PC +30%.';
        } else if (selected === 'skip') {
            if (event.compensationRelic) throw new Error('Este baú é uma compensação garantida. Abra-o para receber sua relíquia.');
            await conn.query('UPDATE tower_progress SET pending_event = NULL, updated_at = NOW() WHERE discord_id = ?', [ownerId]);
            message = 'Você ignorou o evento e seguiu em frente.';
        } else {
            throw new Error('Essa opção não pertence ao evento atual.');
        }

        await conn.commit();
        await interaction.editReply({ content: `🎲 **Evento resolvido — ${eventTitle}**\n${message}`, embeds: [], components: [] });
    } catch (error) {
        try { await conn.rollback(); } catch (_) { }
        await interaction.editReply({ content: `❌ ${error.message}`, embeds: [], components: [] });
    } finally {
        conn.release();
    }
}

function getRelicTier(code) { return TOWER_RELICS[code]?.rarity || 'suprema'; }
async function handleCraftMenu(interaction) {
 await interaction.deferReply({ephemeral:true}); const state=await ensureProgressRow(interaction.user.id); const inv=await carregarRelics(interaction.user.id); const owned=new Set((inv||[]).map(x=>x.relic_code));
 const opts=Object.values(TOWER_RELICS).filter(r=>['rara','epica','lendaria'].includes(r.rarity)&&!owned.has(r.code)).map(r=>({label:r.name.slice(0,100),value:`target:${r.code}`,description:`${RELIC_CRAFT_COSTS[r.rarity].coins.toLocaleString('pt-BR')} PC + ${RELIC_CRAFT_COSTS[r.rarity].fragments} fragmentos`.slice(0,100)}));
 for(const [tier,label] of [['rara','T1 aleatória'],['epica','T2 aleatória'],['lendaria','T3 aleatória']]){const c=RELIC_CRAFT_COSTS[tier];opts.push({label:`🎲 ${label}`,value:`random:${tier}`,description:`${c.randomCoins.toLocaleString('pt-BR')} PC + ${c.randomFragments} fragmentos`});}
 const menu=new StringSelectMenuBuilder().setCustomId(`tower_craft|${interaction.user.id}`).setPlaceholder('Escolha a relíquia para fabricar').setMinValues(1).setMaxValues(1).addOptions(opts.slice(0,25));
 return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x7C3AED).setTitle('🔧 Oficina de Relíquias').setDescription(`Fragmentos disponíveis: **${Number(state.relic_fragments||0)}**\n\nFabricação direcionada: T1 2.500 PC + 10 fragmentos · T2 4.000 PC + 25 · T3 10.000 PC + 60.\nFabricação aleatória: T1 2.000 PC + 7 · T2 3.000 PC + 18 · T3 7.000 PC + 45.\nT4 supremas são exclusivas da Ascensão.`)],components:[new ActionRowBuilder().addComponents(menu)]});
}
async function handleCraftSelection(interaction) {
 const [,ownerId]=interaction.customId.split('|'); if(ownerId!==interaction.user.id)return interaction.reply({content:'❌ Esse menu não pertence a você.',ephemeral:true}); await interaction.deferUpdate(); const sel=interaction.values?.[0]||''; const conn=await pool.getConnection();
 try { await conn.beginTransaction(); const [ps]=await conn.query('SELECT * FROM tower_progress WHERE discord_id=? FOR UPDATE',[ownerId]); const state=ps?.[0]; if(!state)throw new Error('Progresso da Torre não encontrado.'); const [players]=await conn.query('SELECT purple_coins,username,name FROM players WHERE discord_id=? FOR UPDATE',[ownerId]); const player=players?.[0]; if(!player)throw new Error('Jogador não encontrado.'); const [rows]=await conn.query('SELECT relic_code FROM tower_relic_inventory WHERE discord_id=? FOR UPDATE',[ownerId]); const owned=new Set((rows||[]).map(r=>r.relic_code)); let code,rarity,randomMode=false;
 if(sel.startsWith('target:')){code=sel.slice(7);const relic=TOWER_RELICS[code];if(!relic||!['rara','epica','lendaria'].includes(relic.rarity))throw new Error('Relíquia não fabricável.');if(owned.has(code))throw new Error('Você já possui essa relíquia.');rarity=relic.rarity;} else if(sel.startsWith('random:')){rarity=sel.slice(7);randomMode=true;} else throw new Error('Escolha inválida.');
 const c=RELIC_CRAFT_COSTS[rarity];if(!c)throw new Error('Tier não fabricável.');const coins=randomMode?c.randomCoins:c.coins,frags=randomMode?c.randomFragments:c.fragments;if(Number(state.relic_fragments||0)<frags)throw new Error(`Você precisa de ${frags} fragmentos; possui ${Number(state.relic_fragments||0)}.`);if(Number(player.purple_coins||0)<coins)throw new Error(`Você precisa de ${coins.toLocaleString('pt-BR')} PC.`);
 if(randomMode){const pool=Object.values(TOWER_RELICS).filter(r=>r.rarity===rarity&&!owned.has(r.code));if(!pool.length)throw new Error('Você já possui todas as relíquias dessa raridade.');code=pool[randomInt(0,pool.length-1)].code;} const relic=TOWER_RELICS[code],before=Number(player.purple_coins)||0,after=before-coins;
 await conn.query('UPDATE players SET purple_coins=?,updated_at=NOW() WHERE discord_id=?',[after,ownerId]);await conn.query('UPDATE tower_progress SET relic_fragments=relic_fragments-?,updated_at=NOW() WHERE discord_id=?',[frags,ownerId]);await conn.query('INSERT INTO tower_relic_inventory (discord_id,relic_code,source,is_damaged) VALUES (?,?,?,FALSE)',[ownerId,code,randomMode?'tower_craft_random':'tower_craft_targeted']);await conn.query(`INSERT INTO player_transactions (discord_user_id,discord_username,transaction_type,item_type,item_name,amount,balance_before,balance_after,metadata) VALUES (?,?,'LOSS','tower_relic_craft',?,?,?, ?,?) RETURNING id`,[ownerId,player.username||player.name||null,relic.name,-coins,before,after,JSON.stringify({relic:code,rarity,fragments:frags,randomMode})]);await conn.commit();return interaction.editReply({content:`✅ **${relic.name}** fabricada! Custo: ${coins.toLocaleString('pt-BR')} PC + ${frags} fragmentos. Use /torre reliquias para equipá-la.`,embeds:[],components:[]});
 } catch(e){try{await conn.rollback()}catch(_){}return interaction.editReply({content:`❌ ${e.message}`,embeds:[],components:[]});}finally{conn.release()}
}
async function handleFragments(interaction){await interaction.deferReply({ephemeral:true});const state=await ensureProgressRow(interaction.user.id);const inv=await carregarRelics(interaction.user.id);return interaction.editReply({content:`🧩 Fragmentos de Relíquia: **${Number(state.relic_fragments||0)}**\n🧿 Relíquias na coleção: **${inv.length}**\n\nVitórias em andares comuns têm 20% de chance de conceder +1 fragmento e 5% de chance de uma relíquia direta. Use /torre fabricar para trocar fragmentos + PC por uma relíquia.`,embeds:[]});}
async function handleReactivateRelics(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [progressRows] = await conn.query(
            'SELECT equipped_relics, relic_state, match_active FROM tower_progress WHERE discord_id = ? FOR UPDATE',
            [interaction.user.id]
        );
        const progress = progressRows?.[0];
        if (!progress) throw new Error('Progresso da Torre não encontrado.');
        if (progress.match_active) throw new Error('Não é possível reativar relíquias durante uma partida.');
        const equipped = parseTowerJson(progress.equipped_relics, []);
        if (!equipped.length) throw new Error('Você não tem relíquias equipadas.');
        const marks = equipped.map(() => '?').join(',');
        const [rows] = await conn.query(
            `SELECT relic_code FROM tower_relic_inventory WHERE discord_id = ? AND is_damaged = TRUE AND relic_code IN (${marks}) FOR UPDATE`,
            [interaction.user.id, ...equipped]
        );
        if (!rows.length) throw new Error('Nenhuma relíquia equipada precisa de reativação.');
        const codes = rows.map(row => row.relic_code);
        const total = rows.reduce((sum, row) => sum + (RELIC_CRAFT_COSTS[getRelicTier(row.relic_code)]?.reactivate || 3000), 0);
        const [playerRows] = await conn.query(
            'SELECT purple_coins, username, name FROM players WHERE discord_id = ? FOR UPDATE',
            [interaction.user.id]
        );
        const player = playerRows?.[0];
        if (!player || Number(player.purple_coins || 0) < total) {
            throw new Error(`Reativar ${rows.length} relíquia(s) custa ${total.toLocaleString('pt-BR')} PC. Saldo insuficiente.`);
        }
        const before = Number(player.purple_coins) || 0;
        const after = before - total;
        await conn.query('UPDATE players SET purple_coins = ?, updated_at = NOW() WHERE discord_id = ?', [after, interaction.user.id]);
        await conn.query(`UPDATE tower_relic_inventory SET is_damaged = FALSE WHERE discord_id = ? AND relic_code IN (${marks})`, [interaction.user.id, ...codes]);
        const relicState = resetRelicDurability(parseTowerJson(progress.relic_state, {}), codes);
        await conn.query('UPDATE tower_progress SET relic_state = ?::jsonb, updated_at = NOW() WHERE discord_id = ?', [JSON.stringify(relicState), interaction.user.id]);
        await conn.query(`
            INSERT INTO player_transactions (discord_user_id, discord_username, transaction_type, item_type, item_name, amount, balance_before, balance_after, metadata)
            VALUES (?, ?, 'LOSS', 'tower_relic_reactivation', 'Reativação de relíquias da Torre', ?, ?, ?, ?)
            RETURNING id
        `, [interaction.user.id, player.username || player.name || null, -total, before, after, JSON.stringify({ relics: codes, newDurability: relicState.relicDurability })]);
        await conn.commit();
        return interaction.editReply({ content: `🔧 Reativadas **${rows.length} relíquia(s)** por **${total.toLocaleString('pt-BR')} PC**. Valores por raridade: Rara 50 PC · Épica 150 PC · Lendária 400 PC. O desgaste foi reiniciado: cada uma terá uma nova duração aleatória de **7 a 14 combates concluídos**.` });
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        return interaction.editReply({ content: `❌ ${error.message}` });
    } finally {
        conn.release();
    }
}

async function handleBuyLife(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
        const result = await comprarVidaTorre(interaction.user.id);
        return interaction.editReply({
            embeds: [new EmbedBuilder().setColor(0xA855F7).setTitle('❤️ Vida extra comprada!')
                .setDescription(`Você comprou a **${result.purchaseNumber}ª vida extra de hoje**.\n\n❤️ Vidas disponíveis: **${result.lives}/${MAX_LIVES}**\n💸 Custo: **${result.cost.toLocaleString('pt-BR')} PC**\n💰 Saldo: **${result.balance.toLocaleString('pt-BR')} PC**\n🛒 Compras restantes hoje: **${result.remainingPurchases}**`)]
        });
    } catch (error) {
        return interaction.editReply({ content: `❌ ${error.message}` });
    }
}

function buildContractMenuPayload(userId, floor, state, options = {}) {
    const available = Object.values(TOWER_CONTRACTS)
        .filter(contract => !contract.requiresOneLife || Number(state.lives) === 1)
        .map(contract => ({
            label: contract.name.replace(/^\S+\s/, '').slice(0, 100),
            value: contract.code,
            description: contract.description.slice(0, 100)
        }));
    available.push({
        label: 'Seguir sem contrato',
        value: 'none',
        description: 'Enfrentar o chefe sem desvantagens ou bônus adicionais.'
    });
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`tower_contract|${userId}|${floor}`)
        .setPlaceholder('Escolha um contrato opcional')
        .addOptions(available);
    const intro = options.intro ? `${options.intro}\n\n` : '';
    return {
        embeds: [new EmbedBuilder()
            .setColor(0xDC2626)
            .setTitle(`📜 CONTRATOS · CHEFE DO ANDAR ${floor}`)
            .setDescription(`${intro}Aceite uma desvantagem para receber uma recompensa maior. Contratos são opcionais e valem para **uma única tentativa**. Se perder, o contrato é consumido; ao tentar o chefe novamente, você escolhe outro ou segue sem contrato. **Ao selecionar uma opção, a partida começa automaticamente.**`)],
        components: [new ActionRowBuilder().addComponents(menu)]
    };
}

async function showContractDraft(interaction, state, floor) {
    const payload = buildContractMenuPayload(interaction.user.id, floor, state);
    // /torre entrar é público por causa da partida; as opções do contrato são privadas.
    try {
        await interaction.deleteReply();
    } catch (error) {
        console.warn('[torre] Não foi possível remover o placeholder público do contrato:', error.message);
        try {
            await interaction.editReply({ content: '🔒 Uma escolha privada da Torre foi enviada para você.', embeds: [], components: [] });
        } catch (_) { }
    }
    return interaction.followUp({ ...payload, ephemeral: true });
}

async function handleContractSelection(interaction) {
    const [, ownerId, floorRaw] = interaction.customId.split('|');
    if (ownerId !== interaction.user.id) return interaction.reply({ content: '❌ Este contrato não pertence a você.', ephemeral: true });
    if (localLocks.has(ownerId)) return interaction.reply({ content: '⏳ Sua Torre já está iniciando uma partida. Aguarde.', ephemeral: true });

    // Trava a seleção antes de tocar no banco: evita dois cliques iniciarem duas partidas.
    localLocks.add(ownerId);
    let conn = null;
    let handedToMatch = false;
    try {
        // A escolha é privada, mas a partida ao vivo precisa ser pública. Esta nova
        // interação do menu cria a resposta pública que handleEnter atualizará.
        await interaction.deferReply({ ephemeral: false });
        const floor = Number(floorRaw);
        const code = interaction.values?.[0];
        conn = await pool.getConnection();
        await conn.beginTransaction();
        const [rows] = await conn.query(
            'SELECT * FROM tower_progress WHERE discord_id = ? FOR UPDATE',
            [ownerId]
        );
        const state = rows?.[0];
        if (!state || Number(state.current_floor) !== floor || !isBossFloor(floor) || state.match_active) {
            throw new Error('Este contrato expirou. Use `/torre entrar` para abrir as opções novamente.');
        }

        if (code === 'none') {
            await conn.query('UPDATE tower_progress SET active_contract = NULL, updated_at = NOW() WHERE discord_id = ?', [ownerId]);
        } else {
            const contract = TOWER_CONTRACTS[code];
            if (!contract || (contract.requiresOneLife && Number(state.lives) !== 1)) {
                throw new Error('Contrato indisponível para sua situação atual.');
            }
            await conn.query(
                'UPDATE tower_progress SET active_contract = ?::jsonb, updated_at = NOW() WHERE discord_id = ?',
                [JSON.stringify({ ...contract, floor }), ownerId]
            );
        }
        await conn.commit();
        conn.release();
        conn = null;

        // A escolha do contrato já dispara o combate; não há segundo /torre entrar.
        handedToMatch = true;
        return await handleEnter(interaction, { lockAlreadyHeld: true, skipBossDrafts: true });
    } catch (error) {
        if (conn) {
            try { await conn.rollback(); } catch (_) { }
        }
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: `❌ ${error.message}`, embeds: [], components: [] });
            } else {
                await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
            }
        } catch (_) { }
    } finally {
        if (conn) conn.release();
        if (!handedToMatch) localLocks.delete(ownerId);
    }
}

async function showPendingEvent(interaction, state, privateFollowUp = false) {
    const event = parseTowerJson(state.pending_event, null);
    if (!event) return false;
    const payload = {
        embeds: [buildTowerEventEmbed(event)],
        components: [buildEventRow(interaction.user.id, event)]
    };

    if (privateFollowUp) {
        // Chamado pelo /torre entrar, cuja resposta pública é usada para as partidas.
        // O menu do evento nunca deve ficar anexado a uma mensagem pública.
        try {
            await interaction.deleteReply();
        } catch (error) {
            console.warn('[torre] Não foi possível remover o placeholder público do evento:', error.message);
            try {
                await interaction.editReply({ content: '🔒 Você tem uma escolha privada da Torre. Confira o menu enviado somente para você.', embeds: [], components: [] });
            } catch (_) { }
        }
        await interaction.followUp({ ...payload, ephemeral: true });
        return true;
    }

    // A reapresentação privada do evento é disparada automaticamente por /torre entrar.
    await interaction.editReply(payload);
    return true;
}



async function handleEnter(interaction, options = {}) {
    const discordId = interaction.user.id;
    const lockAlreadyHeld = options.lockAlreadyHeld === true;
    if (!lockAlreadyHeld && localLocks.has(discordId)) {
        const message = '⏳ Você já está em uma partida da Torre.';
        return interaction.deferred || interaction.replied
            ? interaction.editReply({ content: message, embeds: [], components: [] })
            : interaction.reply({ content: message, ephemeral: true });
    }
    if (!lockAlreadyHeld) localLocks.add(discordId);
    let reservation = null;

    try {
        if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
        const team = await getTeamByOwner(discordId);
        if (!team || !team.id) {
            return await interaction.editReply('❌ Você precisa registrar um time primeiro com `/registrartime`.');
        }
        const userCards = await getUserTeamCards(team);
        if (!userCards) {
            return await interaction.editReply('❌ Seu time precisa estar completo com GK, VL e PV. Use `/escalar`.');
        }
        try {
            const duplicate = await require('../utils/timeRegras').nomeRepetidoNoTime(team, discordId, null, null);
            if (duplicate) return await interaction.editReply(`❌ Sua escalação tem **${duplicate}** repetido. Cada jogador só pode ocupar uma posição.`);
        } catch (error) {
            console.warn('[torre] Não foi possível validar nomes repetidos:', error.message);
        }

        const preState = await ensureProgressRow(discordId);
        const equippedForEntry = parseTowerJson(preState.equipped_relics, []);
        const activeForEntry = await getActiveEquippedRelicCodes(discordId, preState);
        const inactiveRelics = equippedForEntry.filter(code => !activeForEntry.includes(code));
        if (inactiveRelics.length) {
            await interaction.followUp({ content: `🔧 Relíquias sem efeito nesta partida: ${inactiveRelics.map(code => TOWER_RELICS[code]?.name || code).join(', ')}. Isso pode ocorrer por desgaste ou porque o Trono está desgastado e o slot Lendário adicional ficou indisponível. A Torre continua normalmente; use **/torre reativar** para restaurar as relíquias desgastadas.`, ephemeral: true }).catch(() => {});
        }
        if (preState.pending_event) {
            await showPendingEvent(interaction, preState, true);
            return;
        }
        const upcomingFloor = Number(preState.current_floor);
        const challengeBeforeMatch = parseTowerJson(preState.relic_state, {}).ascendantChallenge || null;
        const isChallengeRematch = Boolean(challengeBeforeMatch?.stage === 'rematch' && Number(challengeBeforeMatch.bossFloor) + 1 === upcomingFloor);
        let activeBuffBefore = parseTowerJson(preState.active_buff, {});
        // Limpa dados antigos que possam ter atravessado a atualização: chegar
        // a um novo chefe sempre encerra o buff do bloco anterior.
        if (isBossFloor(upcomingFloor) && Number(activeBuffBefore.startFloor || 0) !== upcomingFloor) {
            if (activeBuffBefore.code || parseTowerJson(preState.buff_history, []).length) {
                await query(`
                    UPDATE tower_progress
                    SET active_buff = '{}'::jsonb, active_buff_until_floor = 0,
                        buff_history = '[]'::jsonb, updated_at = NOW()
                    WHERE discord_id = ?
                `, [discordId]);
                preState.active_buff = {};
                preState.active_buff_until_floor = 0;
                preState.buff_history = [];
                activeBuffBefore = {};
            }
        }
        const buffAlreadyChosen = Number(activeBuffBefore.startFloor) === upcomingFloor;
        if (!isChallengeRematch && !options.skipBossDrafts && isBossFloor(upcomingFloor) && !buffAlreadyChosen) {
            await showBuffDraft(interaction, preState, upcomingFloor);
            return;
        }

        // Ao entrar em um chefe, contratos são oferecidos automaticamente.
        // O usuário não precisa executar /torre contrato.
        if (!isChallengeRematch && !options.skipBossDrafts && isBossFloor(upcomingFloor)) {
            const currentContract = parseTowerJson(preState.active_contract, null);
            if (!currentContract || Number(currentContract.floor) !== upcomingFloor) {
                await showContractDraft(interaction, preState, upcomingFloor);
                return;
            }
        }

        reservation = await reserveTowerMatch(discordId);
        if (!reservation.allowed) {
            if (reservation.reason === 'no_lives') {
                // Sem vidas: avisa se dá para comprar uma vida e oferece lembrete de renovação (privado).
                const freshState = await ensureProgressRow(discordId);
                const notice = await buildNoLivesNotice(discordId, freshState);
                try {
                    await interaction.deleteReply();
                } catch (error) {
                    console.warn('[torre] Não foi possível remover o placeholder público do aviso de vidas:', error.message);
                    try { await interaction.editReply({ content: '🔒 Uma mensagem privada da Torre foi enviada para você.', embeds: [], components: [] }); } catch (_) { }
                }
                return await interaction.followUp({ ...notice, ephemeral: true });
            }
            const message = reservation.reason === 'active'
                ? '⏳ Você já tem uma partida da Torre em andamento. Aguarde ela terminar.'
                : `🏆 Você já concluiu os 50 andares na Ascensão ${ASCENSION_MAX}/4 (PC ×3). A próxima run será liberada na próxima temporada.`;
            return await interaction.editReply(message);
        }

        const floor = isChallengeRematch ? Number(challengeBeforeMatch.bossFloor) : reservation.floor;
        const progressState = await ensureProgressRow(discordId);
        const activeEquippedRelics = await getActiveEquippedRelicCodes(discordId, progressState);
        progressState.equipped_relics = JSON.stringify(activeEquippedRelics);
        const storedContract = parseTowerJson(progressState.active_contract, null);
        const activeContract = !isChallengeRematch && storedContract && Number(storedContract.floor) === floor ? storedContract : null;
        const ascensionLevel = clampAscensionLevel(progressState.ascension_level);
        const userCoachId = await getUserCoachId(discordId);
        const [userSponsor, botSponsor, templates] = await Promise.all([
            getUserSponsor(team),
            getBotSponsor(team.patrocinio_id || null),
            getAllTemplates()
        ]);

        const userCoach = typeof amistosoHelpers.applyCoachBuffs === 'function'
            ? amistosoHelpers.applyCoachBuffs(userCards, userCoachId)
            : (userCoachId && TREINADORES[userCoachId] ? TREINADORES[userCoachId] : null);
        if (!userCoach && userCoachId && TREINADORES[userCoachId]) {
            const coach = TREINADORES[userCoachId];
            for (const card of Object.values(userCards)) {
                for (const [key, value] of Object.entries(coach.buffs || {})) card[key] = Math.min(99, numberOr(card[key], 50) + Number(value || 0));
                syncCardStats(card);
            }
        }
        applySponsorBuffs(userCards, userSponsor);
        const roguelikeEffects = applyTowerRoguelikeEffects(userCards, progressState, floor, activeContract);

        const botSponsorRows = await Promise.resolve(botSponsor);
        const builtBot = buildTowerBotTeam(userCards, floor, userCoachId, team.patrocinio_id || null, templates || [], botSponsorRows, ascensionLevel, activeEquippedRelics, parseTowerJson(progressState.relic_state, {}));
        builtBot.pressure = clamp(Number(builtBot.pressure || 0) + Number(activeContract?.pressure || 0), 0, 0.20);
        const botCards = builtBot.botCards;
        const userOverall = calculateTeamOverall(userCards);
        const botOverall = calculateTeamOverall(botCards);
        const userTeamName = team.name || interaction.user.username || 'Seu time';
        const botName = isBossFloor(floor) ? `Chefe da Torre · ${String(floor).padStart(2, '0')}` : `Desafiante da Torre · ${String(floor).padStart(2, '0')}`;
        const duration = isBossFloor(floor) ? BOSS_DURATION_SECONDS : COMMON_DURATION_SECONDS;
        const livesAtStart = reservation.lives;
        const initialStats = { team1: { shots: 0, saves: 0 }, team2: { shots: 0, saves: 0 } };

        await interaction.editReply({
            embeds: [buildTowerLiveEmbed({
                floor, lives: livesAtStart, teamName: userTeamName, botName,
                teamOverall: userOverall, botOverall, botCards, userCoach,
                botCoach: builtBot.botCoach, userSponsor, botSponsor: botSponsorRows, buffs: roguelikeEffects.applied, contract: activeContract,
                ascensionLevel, difficultyMultiplier: builtBot.multiplier,
                score: { team1: 0, team2: 0 }, lines: [], stats: initialStats, duration
            })]
        });

        const commentator = createCommentator({ userCards, botCards, duration });
        let liveQueue = Promise.resolve();
        let lastEditAt = 0;
        const onUpdate = update => {
            try { commentator.narrate(update); } catch (error) { console.warn('[torre] Narração falhou:', error.message); }
            const now = Date.now();
            const event = update && update.event;
            const urgent = event && (event.type === 'goal' || event.type === 'own_goal');
            if (!urgent && now - lastEditAt < 1200) return;
            lastEditAt = now;
            const snapshot = {
                score: { team1: Number(update.score && update.score.team1) || 0, team2: Number(update.score && update.score.team2) || 0 },
                lines: commentator.getLines(),
                stats: commentator.getStats()
            };
            liveQueue = liveQueue.then(() => interaction.editReply({
                embeds: [buildTowerLiveEmbed({
                    floor, lives: livesAtStart, teamName: userTeamName, botName,
                    teamOverall: userOverall, botOverall, botCards, userCoach,
                    botCoach: builtBot.botCoach, userSponsor, botSponsor: botSponsorRows, buffs: roguelikeEffects.applied, contract: activeContract,
                    ascensionLevel, difficultyMultiplier: builtBot.multiplier,
                    score: snapshot.score, lines: snapshot.lines, stats: snapshot.stats, duration
                })]
            })).catch(error => console.warn('[torre] Falha ao atualizar partida ao vivo:', error.message));
        };

        await new Promise(resolve => setTimeout(resolve, 700));
        const result = await simulateMatchRealtime(
            userCards,
            botCards,
            userTeamName,
            botName,
            onUpdate,
            {
                durationSeconds: duration,
                stepMs: isBossFloor(floor) ? 900 : 500,
                initialDelay: 500,
                getStepMs: isBossFloor(floor) ? getAmistosoStepMs : (() => 450),
                symmetricTeamSelection: true,
                team2GoalChanceBonus: builtBot.pressure,
                team2SaveChanceBonus: builtBot.pressure
            }
        );

        await liveQueue;
        const scoreUser = Number(result.score && result.score.team1) || 0;
        const scoreBot = Number(result.score && result.score.team2) || 0;
        const won = scoreUser > scoreBot;
        let rewardPlan = { coins: 0, multiplier: null, packType: null, packLabel: null, normalPackBonus: 0 };
        let finalResult;
        if (isChallengeRematch) {
            finalResult = await finalizeTowerMatch({
                discordId, token: reservation.token, floor, won, rewardPlan, packCards: [], challengeMode: true
            });
        } else if (won) {
            const coins = buildRewardPlan(
                floor, activeContract, roguelikeEffects.equipped, ascensionLevel,
                Number(progressState.bosses_since_relic_event || 0),
                parseTowerJson(progressState.relic_state, {})
            );
            rewardPlan = coins;
            const activeChallenge = parseTowerJson(progressState.relic_state, {}).ascendantChallenge;
            rewardPlan.ascendantChallengeReward = activeChallenge?.stage === 'next';
            rewardPlan.ascendantChallengeStake = rewardPlan.ascendantChallengeReward ? Number(activeChallenge.stake || 300) : 0;
            finalResult = await commitWinnerReward(discordId, reservation.token, floor, rewardPlan, interaction);
        } else {
            finalResult = await finalizeTowerMatch({ discordId, token: reservation.token, floor, won: false, rewardPlan, packCards: [] });
        }

        const finalEmbed = buildFinalEmbed({
            floor,
            won,
            scoreUser,
            scoreBot,
            rewardPlan: finalResult.rewardPlan || rewardPlan,
            result: finalResult,
            lives: finalResult.lives,
            teamName: userTeamName,
            botName,
            seasonKey: reservation.seasonKey
        });
        if (floor === TOTAL_FLOORS && won) {
            finalEmbed.setTitle('🏆 TORRE CONCLUÍDA!');
            finalEmbed.setDescription(`🔴 **${userTeamName}** ${scoreUser} × ${scoreBot} **${botName}** 🔵\n\n👑 **Você concluiu os 50 andares da Torre DreamTeam!**`);
        }
        if (finalResult.normalRelicReward) finalEmbed.addFields({name:'🧩 Recompensa de relíquia',value:finalResult.normalRelicReward.text,inline:false});
        if (finalResult.treasureHunterEventTriggered) finalEmbed.addFields({ name: '🔎 Caçador de Tesouros', value: 'Seu faro encontrou um evento extra! Confira a escolha privada enviada pelo bot.', inline: false });
        if (finalResult.lifeSavedByRelic) finalEmbed.addFields({ name: finalResult.lifeSavedByMochila ? '🎒 Mochila de Emergência' : '🔥 Relíquia de proteção', value: finalResult.lifeSavedByMochila ? 'A tentativa extra da Mochila evitou a perda desta vida. Uma carga foi consumida.' : 'Sua relíquia evitou a perda desta vida.', inline: false });
        if (finalResult.lifeRecoveredByKit) finalEmbed.addFields({ name: '🎁 Kit Médico', value: 'Você recuperou 1 vida! A tentativa diária de cura foi consumida.', inline: false });
        else if (finalResult.kitMedicalHealAttempted) finalEmbed.addFields({ name: '🎁 Kit Médico', value: 'A cura não aconteceu desta vez. A tentativa diária foi consumida mesmo assim e volta à meia-noite de Brasília.', inline: false });
        if (finalResult.kitMedicalCoins > 0) finalEmbed.addFields({ name: '🎁 Kit Médico', value: `Compensação por derrota: **+${finalResult.kitMedicalCoins.toLocaleString('pt-BR')} PC** (20% da recompensa-base). O valor já está incluído no saldo exibido acima.`, inline: false });
        if (finalResult.newlyWornRelics?.length) finalEmbed.addFields({ name: '🔧 Desgaste de relíquias', value: `Ficaram desgastadas após esta tentativa: ${finalResult.newlyWornRelics.map(code => TOWER_RELICS[code]?.name || code).join(', ')}. Elas deixam de funcionar até a reativação, mas não impedem sua entrada na Torre.`, inline: false });
        if (isChallengeRematch && won) finalEmbed.addFields({ name: '🎰 Desafio do Ascendente', value: `Você venceu a revanche! Agora vença a próxima luta sem perder. A aposta de **${challengeBeforeMatch?.stake || 0} PC** volta com **+${getAscendantChallengeReward(challengeBeforeMatch?.stake).fragments} fragmentos** e uma carta Médio+ (a chance de GOAT/Prime melhora com a aposta).`, inline: false });
        if (finalResult.ascendantChallengeWon) {
            const prize = getAscendantChallengeReward(finalResult.ascendantChallengeStake);
            finalEmbed.addFields({ name: '🏆 Desafio do Ascendente concluído!', value: `Aposta devolvida: **${finalResult.ascendantChallengeStake} PC** · **+${prize.fragments} fragmentos** · **1 carta Médio+** (Médio ${prize.cardWeights.medio}% / GOAT ${prize.cardWeights.goat}% / Prime ${prize.cardWeights.prime}%).`, inline: false });
        }
        if (finalResult.ascendantChallengeFailed) finalEmbed.addFields({ name: '💸 Desafio do Ascendente encerrado', value: `Você perdeu uma das lutas do desafio. ${finalResult.lifeSavedByRelic || finalResult.lifeSavedByMochila ? 'Mesmo que Fênix, Mochila ou Segunda Chance tenham preservado sua vida, a luta perdida conta como derrota para o desafio. ' : ''}A aposta de **${finalResult.ascendantChallengeStake} PC** foi perdida. Não é possível repetir neste mesmo bloco.`, inline: false });
        if (isChallengeRematch && !won) finalEmbed.setDescription(`🏰 **Revanche do chefe do andar ${floor}**\n🔴 **${userTeamName}** ${scoreUser} × ${scoreBot} **${botName}** 🔵\n\n❌ Você perdeu a revanche. Seu progresso regular permanece no andar **${finalResult.nextFloor}**; a aposta do desafio foi perdida.`);

        // Resultado da partida continua público; a escolha do evento vai em follow-up privado.
        await interaction.editReply({ embeds: [finalEmbed], components: [] });
        if (!won && Number(finalResult.lives) <= 0) {
            // Ficou sem vidas: aviso privado com opção de compra e lembrete de renovação.
            try {
                const freshState = await ensureProgressRow(discordId);
                const notice = await buildNoLivesNotice(discordId, freshState);
                await interaction.followUp({ ...notice, ephemeral: true });
            } catch (error) {
                console.warn('[torre] Não foi possível enviar o aviso de vidas:', error.message);
            }
        }
        if (won && finalResult.pendingEvent) {
            const eventEmbed = buildTowerEventEmbed(finalResult.pendingEvent);
            await interaction.followUp({ embeds: [eventEmbed], components: [buildEventRow(discordId, finalResult.pendingEvent)], ephemeral: true });
        }
        if (finalResult.challengeOfferAvailable) {
            await interaction.followUp({
                embeds: [new EmbedBuilder().setColor(0x7C3AED).setTitle('🎰 DESAFIO DO ASCENDENTE').setDescription('Aposte **300, 400 ou 500 PC**. Primeiro você enfrenta a revanche do chefe; depois, precisa vencer a próxima luta. Se vencer as duas, recebe a aposta de volta, fragmentos e uma carta Médio+. A recompensa cresce com a aposta: **300 PC = 5 fragmentos**, **400 PC = 8 fragmentos**, **500 PC = 12 fragmentos**, além de chances maiores de GOAT/Prime. Qualquer luta perdida encerra o desafio, mesmo que Fênix, Mochila ou Segunda Chance salvem sua vida. Uma tentativa por chefe.')],
                components: [buildAscendantChallengeRow(discordId, floor)],
                ephemeral: true
            });
        }
        return;
    } catch (error) {
        console.error('[torre] Erro:', error);
        if (reservation && reservation.token) await releaseTowerMatch(discordId, reservation.token);
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: `❌ Não foi possível concluir a Torre: ${error.message}`, embeds: [] });
            } else {
                await interaction.reply({ content: `❌ Não foi possível iniciar a Torre: ${error.message}`, ephemeral: true });
            }
        } catch (_) { }
    } finally {
        localLocks.delete(discordId);
    }
}

async function handleStatus(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const [state, relicInventory] = await Promise.all([
        ensureProgressRow(interaction.user.id),
        carregarRelics(interaction.user.id)
    ]);
    const completed = Number(state.current_floor) > TOTAL_FLOORS;
    const floor = completed ? TOTAL_FLOORS : Number(state.current_floor);
    const ascensionLevel = clampAscensionLevel(state.ascension_level);
    const ascensionMultiplier = getAscensionRewardMultiplier(ascensionLevel);
    const scaleRange = value => Math.floor(Number(value || 0) * ascensionMultiplier);
    const nextReward = completed ? null : getFloorRewardRange(floor);
    const equippedRelics = parseTowerJson(state.equipped_relics, []);
    const hasPurpleCore = equippedRelics.includes('nucleo_purple');
    const nextExtraCardChance = nextReward?.extraCardChance
        ? Math.min(0.95, nextReward.extraCardChance + (hasPurpleCore ? 0.05 : 0))
        : 0;
    const bossesWithoutRelic = Number(state.bosses_since_relic_event || 0);
    const relicPityText = bossesWithoutRelic >= RELIC_EVENT_PITY_BOSSES
        ? 'Baú garantido após derrotar o próximo chefe'
        : `35% Baú Escolhido + 20% Baú Surpresa · garantia de Baú Escolhido após chefe sem relíquia (${bossesWithoutRelic}/${RELIC_EVENT_PITY_BOSSES})`;
    const activeBuffForStatus = parseTowerJson(state.active_buff, {});
    const rewardText = !nextReward ? '' : floor === 40
        ? `${scaleRange(2500).toLocaleString('pt-BR')} PC garantidos + 10% de chance de ×2 a ×6 (até ${scaleRange(15000).toLocaleString('pt-BR')} PC)${nextExtraCardChance ? ` + ${Math.round(nextExtraCardChance * 100)}% de chance de carta extra${hasPurpleCore ? ' (com Núcleo Purple)' : ''}` : ''}`
        : floor === 50
            ? 'Pacote Super Purple (aberto automaticamente; pacote não é multiplicado)'
            : `${scaleRange(nextReward.minCoins).toLocaleString('pt-BR')}–${scaleRange(nextReward.maxCoins).toLocaleString('pt-BR')} PC${nextReward.packName ? ` + ${nextReward.packName}${nextReward.packType === 'normal' ? ` (+${scaleRange(15)} PC do pacote)` : ''}` : ''}${nextExtraCardChance ? ` + ${Math.round(nextExtraCardChance * 100)}% de chance de carta extra${hasPurpleCore ? ' (com Núcleo Purple)' : ''}` : ''}`;
    const description = completed
        ? `🏆 Você concluiu os 50 andares na **Ascensão ${ASCENSION_MAX}/${ASCENSION_MAX}**. Recompensas em PC: **×3**. A próxima run será liberada na próxima temporada.`
        : `🏰 **Andar atual:** ${floor}/${TOTAL_FLOORS}\n` +
          `⚔️ **Dificuldade:** ${getAscensionLabel(ascensionLevel)} · Recompensas em PC: **×${formatRewardMultiplier(ascensionMultiplier)}**\n` +
          `📈 **Progresso:** ${progressBar(Number(state.best_floor), TOTAL_FLOORS, 20)} ${state.best_floor}/${TOTAL_FLOORS}\n` +
          `🎯 **Próxima recompensa:** ${rewardText}`;
    const embed = new EmbedBuilder()
        .setColor(completed ? 0x16A34A : 0x8B5CF6)
        .setTitle('🏰 TORRE DREAMTEAM · SEU PROGRESSO')
        .setDescription(description)
        .addFields(
            { name: '❤️ Vidas de hoje', value: `${formatLives(Number(state.lives))}  ${formatLivesCount(state.lives)}`, inline: true },
            { name: '🏅 Melhor andar desta ascensão', value: `**${state.best_floor}/${TOTAL_FLOORS}**`, inline: true },
            { name: '🌎 Melhor andar histórico', value: `**${state.all_time_best_floor}/${TOTAL_FLOORS}**`, inline: true },
            { name: '🛒 Próxima compra de vida', value: getLifePurchaseStatus(state), inline: false },
            { name: '🧿 Relíquias', value: `${relicInventory.length} encontrada(s)\nEquipadas: ${(parseTowerJson(state.equipped_relics, []).map(code => TOWER_RELICS[code]?.name).filter(Boolean).join(', ') || 'Nenhuma')}`, inline: true },
            { name: '🎁 Próximo baú', value: relicPityText, inline: false },
            { name: '🧪 Buff ativo', value: activeBuffForStatus.code && !isBuffExpiredAtFloor(activeBuffForStatus, floor) ? `${activeBuffForStatus.name || activeBuffForStatus.code}\nEscala: +${formatBuffAmount(getBuffScalingBonus(Number(activeBuffForStatus.startFloor || floor)))} por atributo` : 'Nenhum — você escolhe um ao entrar no próximo chefe.', inline: true },
            { name: '⚔️ Ascensão atual', value: `**${getAscensionLabel(ascensionLevel)}**\nRecompensas em PC: **×${formatRewardMultiplier(ascensionMultiplier)}**`, inline: true }
        )
        .setFooter({ text: `Temporada ${state.season_key} · Vidas renovam à meia-noite de Brasília` })
        .setTimestamp();
    if (!completed && Number(state.lives) <= 0) {
        const notice = await buildNoLivesNotice(interaction.user.id, state);
        return interaction.editReply({ content: notice.content, embeds: [embed], components: notice.components });
    }
    return interaction.editReply({ embeds: [embed] });
}

async function handleRanking(interaction) {
    await interaction.deferReply({ ephemeral: false });
    await ensureTowerTables();
    const { seasonKey } = getSaoPauloDateParts();
    const rows = await query(`
        SELECT t.discord_id, t.best_floor, t.all_time_best_floor, t.completed_at, t.ascension_level,
               COALESCE(p.username, p.name, 'Jogador') AS display_name
        FROM tower_progress t
        LEFT JOIN players p ON p.discord_id = t.discord_id
        WHERE t.season_key = ? AND (t.best_floor > 0 OR t.ascension_level > 0)
        ORDER BY t.ascension_level DESC, t.best_floor DESC, t.completed_at ASC NULLS LAST, t.updated_at ASC
        LIMIT 10
    `, [seasonKey]);

    const description = rows.length
        ? rows.map((row, index) => {
            const medal = ['🥇', '🥈', '🥉'][index] || `**${index + 1}.**`;
            const level = clampAscensionLevel(row.ascension_level);
            const complete = level >= ASCENSION_MAX && Number(row.best_floor) >= 50 ? ' 🏆' : '';
            return `${medal} <@${row.discord_id}> — **${getAscensionLabel(level)} · Andar ${row.best_floor}/50**${complete}`;
        }).join('\n')
        : 'Ainda não há jogadores no ranking desta temporada. Seja o primeiro a subir!';

    const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle('🏆 RANKING DA TORRE')
        .setDescription(description)
        .setFooter({ text: `Temporada ${seasonKey} · Ranking por ascensão e andar alcançado` })
        .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
}

async function handleRewards(interaction) {
    const state = await ensureProgressRow(interaction.user.id);
    const { seasonKey } = getSaoPauloDateParts();
    const ascensionLevel = clampAscensionLevel(state.ascension_level);
    const ascensionMultiplier = getAscensionRewardMultiplier(ascensionLevel);
    const scaleRange = value => Math.floor(Number(value || 0) * ascensionMultiplier);
    const equippedRelics = parseTowerJson(state.equipped_relics, []);
    const relicState = parseTowerJson(state.relic_state, {});
    const lines = [];
    for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
        const range = getFloorRewardRange(floor);
        const effectiveExtraCardChance = getRelicExtraCardChance(floor, equippedRelics, relicState);
        const boss = isBossFloor(floor);
        const label = boss ? `👑 **${floor} — CHEFE**` : `**${floor}.**`;
        let coins;
        if (floor === 40) coins = `${scaleRange(2500).toLocaleString('pt-BR')} PC garantidos + 10% de chance de ×2 a ×6 (até ${scaleRange(15000).toLocaleString('pt-BR')} PC)`;
        else if (floor === 50) coins = 'Sem PC';
        else if (range.minCoins === range.maxCoins) coins = `${scaleRange(range.minCoins).toLocaleString('pt-BR')} PC`;
        else coins = `${scaleRange(range.minCoins).toLocaleString('pt-BR')}–${scaleRange(range.maxCoins).toLocaleString('pt-BR')} PC`;

        let pack = '';
        if (range.packType === 'normal') pack = ` + Pacote Normal (3 cartas + ${scaleRange(15)} PC de bônus)`;
        else if (range.packType) pack = ` + ${range.packName} (aberto automaticamente)`;
        let extraDrop = '';
        if (effectiveExtraCardChance) {
            const weights = Object.entries(range.extraCardProbabilities || {});
            const totalWeight = weights.reduce((sum, [, value]) => sum + Number(value || 0), 0) || 1;
            const rarityNames = { bagre: 'Bagre', medio: 'Médio', goat: 'GOAT', prime: 'Prime', purpleprime: 'Prime Purple' };
            const distribution = weights
                .filter(([, value]) => Number(value) > 0)
                .map(([key, value]) => `${rarityNames[key] || key}: ${(Number(value) / totalWeight * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`)
                .join(', ');
            extraDrop = ` + 🎴 ${Math.round(effectiveExtraCardChance * 100)}% carta extra${hasPurpleCore ? ' (Núcleo Purple)' : ''} (${distribution})`;
        }
        lines.push(`${label} ${coins}${pack}${extraDrop}`);
    }

    const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle('🎁 RECOMPENSAS DA TORRE')
        .setDescription(`Recompensas em PC da sua run: **×${formatRewardMultiplier(ascensionMultiplier)} (${getAscensionLabel(ascensionLevel)})**. Os pacotes e a quantidade de cartas permanecem iguais; o multiplicador aumenta os PC. Os pacotes de chefes são abertos automaticamente após a vitória.`);
    // Mantém cada campo abaixo do limite de 1.024 caracteres do Discord.
    for (let i = 0; i < lines.length; i += 5) {
        const start = i + 1;
        const end = Math.min(TOTAL_FLOORS, i + 5);
        embed.addFields({
            name: `Andares ${start}–${end}`,
            value: lines.slice(i, i + 5).join('\n'),
            inline: false
        });
    }
    embed.addFields(
        { name: 'Regras — progressão', value: `• Cada andar paga uma vez por ascensão nesta temporada.\n• Ao concluir os 50 andares, a próxima ascensão é desbloqueada automaticamente: Base → ×1,5 → ×2 → ×2,5 → ×3.\n• A IA fica mais forte a cada ascensão; o máximo é ×3 PC.\n• Vitória avança sem consumir vida; derrota consome 1 vida.\n• Só existe 1 buff ativo por jogador. Ele tem 15% de chance de quebrar após cada vitória em andar comum e expira automaticamente ao chegar no próximo chefe.\n• Os buffs temporários escalam +0,5 em cada atributo por chefe já derrotado (primeiro chefe usa o valor-base). As relíquias permanentes mantêm seus efeitos fixos.`, inline: false },
        { name: 'Regras — recompensas e vidas', value: `• Cada chefe derrotado fortalece a IA em +2 pontos percentuais para o próximo bloco.\n• Baú Escolhido aparece em 35% e Baú Surpresa em 20% dos eventos pós-chefe; se o jogador passar um chefe sem receber relíquia, o próximo garante um Baú Escolhido.\n• As vidas renovam à meia-noite de Brasília (até 3; vidas bônus não são perdidas na renovação).\n• Derrotar um chefe dá +1 vida. Em andares comuns há 5% de chance de ganhar +1 vida. O máximo é 5 vidas.\n• Pacotes são abertos automaticamente, sem consumir o cooldown do \`/pacote\`; quantidade de pacotes e cartas não é multiplicada pela ascensão.\n• Cartas extras têm chance e raridade próprias por faixa. A Torre não possui conquistas próprias nem altera estatísticas oficiais.`, inline: false },
        { name: 'Temporada', value: `${seasonKey} · 50 andares por ascensão · 3 vidas por dia (máx. 5 com bônus)`, inline: false }
    );
    return interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('torre')
        .setDescription('🏰 Suba os 50 andares da Torre DreamTeam.')
        .addSubcommand(option => option.setName('entrar').setDescription('Enfrentar o próximo adversário da Torre.'))
        .addSubcommand(option => option.setName('status').setDescription('Ver seu andar atual e as vidas disponíveis.'))
        .addSubcommand(option => option.setName('ranking').setDescription('Ver os melhores jogadores da temporada.'))
        .addSubcommand(option => option.setName('recompensas').setDescription('Consultar as recompensas dos 50 andares.'))
        .addSubcommand(option => option.setName('comprarvida').setDescription('Comprar uma vida extra (1.000 PC e depois 2.500 PC, até 2 por dia).'))
        .addSubcommand(option => option.setName('reliquias').setDescription('Ver e equipar relíquias da Torre.'))
        .addSubcommand(option => option.setName('fabricar').setDescription('Fabricar relíquias com PC e fragmentos.'))
        .addSubcommand(option => option.setName('fragmentos').setDescription('Consultar fragmentos de relíquia.'))
        .addSubcommand(option => option.setName('reativar').setDescription('Reativar relíquias desgastadas pagando PC.')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'entrar') return handleEnter(interaction);
        if (subcommand === 'status') return handleStatus(interaction);
        if (subcommand === 'ranking') return handleRanking(interaction);
        if (subcommand === 'recompensas') return handleRewards(interaction);
        if (subcommand === 'comprarvida') return handleBuyLife(interaction);
        if (subcommand === 'reliquias') return handleRelics(interaction);
        if (subcommand === 'fabricar') return handleCraftMenu(interaction);
        if (subcommand === 'fragmentos') return handleFragments(interaction);
        if (subcommand === 'reativar') return handleReactivateRelics(interaction);
        return interaction.reply({ content: 'Subcomando da Torre desconhecido.', ephemeral: true });
    },

    __test: {
        calculateFloorReward,
        getFloorRewardRange,
        getNormalFloorBaseRange,
        getFloorCardDropRule,
        generateTowerExtraCard,
        FLOOR_CARD_DROPS,
        isBossFloor,
        buildTowerBotTeam,
        getDifficultyMultiplier,
        getBossProgressionBonus,
        getMaxDifficultyMultiplier,
        getBuffUntilFloor,
        getBuffScalingBonus,
        getBuffDisplayDescription,
        BUFF_SCALING_PER_BOSS,
        isBuffExpiredAtFloor,
        getRelicPityAfterBoss,
        shouldSaveLifeWithSecondChance,
        clampAscensionLevel,
        getAscensionRewardMultiplier,
        getAscensionLabel,
        ASCENSION_MAX,
        ASCENSION_REWARD_MULTIPLIERS,
        ASCENSION_DIFFICULTY_STEP,
        ASCENSION_PRESSURE_STEP,
        BUFF_BREAK_CHANCE,
        TOWER_EVENT_WEIGHTS,
        RELIC_EVENT_PITY_BOSSES,
        makeRandomTowerEvent,
        createChosenRelicOptions,
        getRelicChoiceDetails,
        buildRelicChoiceFieldData,
        buildRelicAcquisitionMessage,
        buildTowerEventEmbed,
        pickWeightedRarity,
        advanceMerchantBuffs,
        rerollChosenRelicOptionsKeepingRarities,
        advanceRelicDurability,
        resetRelicDurability,
        consumeMochilaCharge,
        getAscendantChallengeReward,
        generateAscendantChallengeBonusCard,
        shouldDoubleInvestmentReward,
        applyInvestmentDoubleReward,
        attemptKitMedicalHeal,
        rollTreasureHunterEvent,
        buildDefeatRewardDisplay,
        calculateKitMedicalBaseReward,
        TREASURE_HUNTER_EVENT_CHANCE,
        isAscendantChallengeFailure,
        ASCENDANT_CHALLENGE_STAKES,
        ASCENDANT_CHALLENGE_REWARDS,
        RELIC_WEAR_MIN_ATTEMPTS,
        RELIC_WEAR_MAX_ATTEMPTS,
        shouldBuffBreak,
        getRelicExtraCardChance,
        upgradeRarityBand,
        normalizeTowerRarityKey,
        applyRupturaRarityUpgrades,
        getTitanBossPcBonus,
        getTitanNormalDropBonus,
        validateRelicLoadout,
        normalizeRelicLoadout,
        applyOperationalRelicSlots,
        DAILY_LIVES,
        MAX_LIVES,
        LIFE_DROP_CHANCE,
        rollLifeBonus,
        finalizeTowerMatch,
        buildRewardPlan,
        applyAscensionRewardMultiplier,
        applyTitanPcBonus,
        comprarVidaTorre,
        buildNoLivesNotice,
        getNextSaoPauloMidnight,
        getLifePurchaseResetMessage,
        getLifePurchaseStatus,
        applyTowerRoguelikeEffects,
        TOWER_BUFFS,
        TOWER_RELICS,
        RELIC_CRAFT_COSTS,
        MERCHANT_OFFERS,
        TOWER_CONTRACTS,
        buildContractMenuPayload,
        TOTAL_FLOORS
    },
    handleBuffSelection,
    handleRelicSelection,
    handleCraftSelection,
    handleRelicPositionSelection,
    handleEventSelection,
    handleContractSelection,
    handleAscendantChallengeButton
};
