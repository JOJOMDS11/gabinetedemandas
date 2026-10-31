// Utilitários para influência dos stats por posição
function getGKStatInfluence(gk) {
    if (!gk) return 0;
    // GK: POS (interceptar/receber passes), SAI (passes), DEF (defesa), DRIBLE (sair jogando)
    // Peso: DEF 40%, POS 20%, SAI 20%, DRIBLE 20%
    return (
        (Number(gk.def) || 0) * 0.4 +
        (Number(gk.pos) || 0) * 0.2 +
        (Number(gk.sai) || 0) * 0.2 +
        (Number(gk.drible) || 0) * 0.2
    );
}

function getVLStatInfluence(vl) {
    if (!vl) return 0;
    // VL: DEF (bloquear/interceptar), DRIBLE (passes/finalizar), PASSE (assist), FINALIZACAO (gol)
    // Peso: DEF 30%, DRIBLE 25%, PASSE 25%, FINALIZACAO 20%
    return (
        (Number(vl.def) || 0) * 0.3 +
        (Number(vl.drible) || 0) * 0.25 +
        (Number(vl.passe) || 0) * 0.25 +
        (Number(vl.finalizacao) || 0) * 0.2
    );
}

function getPVStatInfluence(pv) {
    if (!pv) return 0;
    // PV: POS (receber bola), DRIBLE (criar jogada), PASSE (tabelar/assist), FINALIZACAO (gol)
    // Peso: FINALIZACAO 35%, DRIBLE 25%, POS 20%, PASSE 20%
    return (
        (Number(pv.finalizacao) || 0) * 0.35 +
        (Number(pv.drible) || 0) * 0.25 +
        (Number(pv.pos) || 0) * 0.2 +
        (Number(pv.passe) || 0) * 0.2
    );
}

// Minimal match simulator - single, clean implementation

function calculateTeamOverall(cards) {
    if (!cards || Object.keys(cards).length === 0) return 50;
    const arr = Object.values(cards || {});
    const total = arr.reduce((s, c) => s + (Number(c.overall_rating) || 0), 0);
    return Math.max(1, Math.floor(total / (arr.length || 1)));
}

// Simple ability multipliers (tunable). Values are multiplicative bonuses to relevant stat groups.
const HABILIDADE_EFFECTS = {
    'Muralha': { scope: 'def', multiplier: 0.15 },
    'GK Libero': { scope: 'saidaDeBola', multiplier: 0.18 },
    'GK Skill': { scope: 'drible', multiplier: 0.12, extraDefInDuels: 0.10 },
    'Maestro': { scope: 'passe', multiplier: 0.16 },
    'Pitbull': { scope: 'def', multiplier: 0.18 },
    'Box to Box': { scope: 'finalizacao', multiplier: 0.10 },
    'Matador': { scope: 'finalizacao', multiplier: 0.20 },
    'Falso 9': { scope: 'posicionamento', multiplier: 0.14 },
    'Ponta': { scope: 'drible', multiplier: 0.16 }
};

// Helper used by older/deployed versions: format seconds to M:SS
function displayTime(seconds) {
    const sec = Number(seconds) || 0;
    const minutes = Math.floor(sec / 60);
    const remaining = sec % 60;
    return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function getRandomPlayer(cards, preferPV = false) {
    const arr = Object.values(cards || {});
    if (!arr.length) return { player_name: 'Jogador Genérico', avatar: '⚽', id: null, role: null };
    let pick;
    if (preferPV && cards.pv) {
        // 60% de chance de ser o PV
        if (Math.random() < 0.6) pick = cards.pv;
        else pick = arr[Math.floor(Math.random() * arr.length)];
    } else {
        pick = arr[Math.floor(Math.random() * arr.length)];
    }
    // determine role by comparing reference to known positions (gk, vl, pv)
    let role = null;
    try {
        if (cards && cards.gk && pick && cards.gk.id === pick.id) role = 'gk';
        else if (cards && cards.vl && pick && cards.vl.id === pick.id) role = 'vl';
        else if (cards && cards.pv && pick && cards.pv.id === pick.id) role = 'pv';
    } catch (e) { /* ignore */ }
    return Object.assign({}, pick, { role });
}


// Sorteia uma carta de qualquer lado sem sobrescrever as chaves gk/vl/pv.
// `{ ...team1Cards, ...team2Cards }` descartava os jogadores da casa e fazia
// os gols contra serem atribuídos sempre a alguém da IA.
function getRandomPlayerFromBothTeams(team1Cards, team2Cards) {
    const candidates = [];
    for (const [ownerTeam, cards] of [['team1', team1Cards], ['team2', team2Cards]]) {
        for (const [position, card] of Object.entries(cards || {})) {
            if (!card) continue;
            candidates.push({ ...card, role: String(card.role || position).toLowerCase(), ownerTeam });
        }
    }
    if (!candidates.length) {
        return { player_name: 'Jogador Genérico', avatar: '⚽', id: null, role: null, ownerTeam: null };
    }
    return candidates[Math.floor(Math.random() * candidates.length)];
}

// Apply ability multipliers silently. options: { applyAbilities: true/false, logAbilities: true/false }
function applyAbilityMultipliers(player, opponentGK, baseContext = {}, options = {}) {
    try {
        if (!options.applyAbilities) return { playerMultiplier: 1, gkMultiplier: 1 };
        const abil = player && (player.habilidade_equipada || player.habilidade) ? (player.habilidade_equipada || player.habilidade) : null;
        let playerMultiplier = 1;
        let gkMultiplier = 1;
        if (abil && HABILIDADE_EFFECTS[abil]) {
            const ef = HABILIDADE_EFFECTS[abil];
            // apply multiplier to the stat used in context: baseContext.type = 'finalizacao'|'def'|'passe' etc.
            if (ef.scope && baseContext.type && ef.scope === baseContext.type) {
                playerMultiplier += ef.multiplier;
            }
            // special: Muralha and GK Skill affect GK save power
            if (abil === 'Muralha') gkMultiplier += (HABILIDADE_EFFECTS['Muralha'].multiplier || 0);
            if (abil === 'GK Skill' && baseContext.duel) gkMultiplier += (HABILIDADE_EFFECTS['GK Skill'].extraDefInDuels || 0);
            if (options.logAbilities) console.debug('Ability applied', abil, { playerMultiplier, gkMultiplier, playerId: player && player.id });
        }
        return { playerMultiplier, gkMultiplier };
    } catch (e) { return { playerMultiplier: 1, gkMultiplier: 1 }; }
}

function simulateMatch(team1Cards = {}, team2Cards = {}, team1Name = 'Time 1', team2Name = 'Time 2', bordas1 = {}, bordas2 = {}) {
    const events = [];
    let s1 = 0, s2 = 0;

    const baseProb = 0.04;
    const over1 = calculateTeamOverall(team1Cards);
    const over2 = calculateTeamOverall(team2Cards);
    const bias1 = (over1 - over2) / 100; // Calcula o bias baseado na diferença de overall
    const bias2 = (over2 - over1) / 100; // Calcula o bias para o time 2

    // 🎨 BÔNUS SECRETO P2W DAS BORDAS (5% por posição)
    // Aplicado apenas se a carta tiver borda equipada
    function aplicarBonusBorda(player, bordas) {
        if (!player || !player.id || !bordas || !bordas[player.id]) return 1;
        
        // 5% de bônus baseado na posição
        if (player.role === 'gk') {
            // GK: +5% defesa (reduz chances de gol adversário)
            return 1.05;
        } else if (player.role === 'vl') {
            // VL: +5% roubo de bola e bloqueio de assistências
            return 1.05;
        } else if (player.role === 'pv') {
            // PV: +5% finalização (aumenta chances de gol)
            return 1.05;
        }
        return 1;
    }


    // Emojis para cada ação
    const EMOJIS = {
        goal: '⚽',
        own_goal: '🤣',
        shot: '💥',
        miss: '❌',
        blocked: '🛡️',
        save: '🧤',
        assist: '🎯'
    };

    const GOAL_PHRASES = [
        'DE CORTADAAAAAAAAAAAA',
        'DE TABELAAAAAAAAAAA',
        'MIGUEEEEEEEL',
        'SEMANAAAAAAAL',
        'ESSA NEM O BLACK RUITO NO AUGE PEGAVA',
        'TOMOU GOL DO PAI DE VOCES',
        'QUE GOLAÇO, MEU AMIGO!'
    ];
    const MISS_PHRASES = [
        'PERDEU UMA INCRÍVEL!',
        'CHUTOU PRA FORA!',
        'QUE CHANCE DESPERDIÇADA!',
        'Bateu mal, foi longe!',
        'A bola saiu raspando!',
        'Tentou, mas não deu!'
    ];
    const SAVE_PHRASES = [
        'DEFESAÇA DO GOLEIRO!',
        'QUE DEFESA!',
        'GOLEIRO SALVOU!',
        'DEFENDEU NO REFLEXO!',
        'QUE PAREDÃO!',
        'GOLEIRO TÁ INSPIRADO!'
    ];
    const BLOCKED_PHRASES = [
        'BLOQUEADO NA HORA H!',
        'DEFESA FECHOU O ESPAÇO!',
        'A ZAGA TRAVOU!',
        'BLOQUEIO PERFEITO!'
    ];
    const ASSIST_PHRASES = [
        'com aquele velho passe da parede',
        'que passe foi esse?',
        'deu o passe na medida para',
        'deixou na cara do gol para',
        'assistência perfeita de'
    ];
    const OWN_GOAL_PHRASES = [
        'heterio é voce',
        'KIMIKAAAAAAAADA!',
        'ih, deu fake!',
        'PARECEU O BOOM EIN!',
        'NÃO É PRA ESSELADO!'
    ];


    // FRENÉTICO: Reduzir intervalo para 15s e aumentar tentativas (6~10 por time)
    for (let sec = 15; sec <= 360; sec += 15) {
        // 6-10 tentativas por time por slot de 15s
        const attemptsTeam1 = 6 + Math.floor(Math.random() * 5); // 6~10
        const attemptsTeam2 = 6 + Math.floor(Math.random() * 5); // 6~10

        // --- TIME 1 ---
        for (let a = 0; a < attemptsTeam1; a++) {
            // Para gol contra, qualquer jogador pode ser sorteado (inclusive adversário)
            const isOwnGoal = Math.random() < 0.03;
            const scorer = isOwnGoal ? getRandomPlayerFromBothTeams(team1Cards, team2Cards) : getRandomPlayer(team1Cards, true);
            let scorerStat = 50;
            if (scorer.role === 'pv') scorerStat = getPVStatInfluence(scorer);
            else if (scorer.role === 'vl') scorerStat = getVLStatInfluence(scorer);
            else if (scorer.role === 'gk') scorerStat = getGKStatInfluence(scorer);
            scorerStat = Math.max(1, Math.min(100, scorerStat));
            // apply ability multipliers silently
            const abilContext = { type: scorer.role === 'pv' ? 'finalizacao' : scorer.role === 'vl' ? 'passe' : scorer.role === 'gk' ? 'def' : null, duel: false };
            const abilMult = applyAbilityMultipliers(scorer, team2Cards && team2Cards.gk ? team2Cards.gk : null, abilContext, { applyAbilities: true, logAbilities: false });
            const effectiveScorerStat = Math.max(1, Math.min(100, scorerStat * abilMult.playerMultiplier));
            // Determine upset chance based on rating gap: if opposite team much stronger, increase upset chance for this underdog
            const gap = Math.abs(over1 - over2);
            // default upset chance per attempt
            let upsetChance = 0.02;
            // if difference >= 10 points, underdog attempts get a higher upset chance (30%)
            if (gap >= 10) {
                // decide which team is underdog for this attempt
                const isUnderdog = bias1 < 0; // bias1 < 0 means team1 is weaker
                if (isUnderdog) upsetChance = 0.30;
            }
            const upsetBoost = (Math.random() < upsetChance) ? 0.12 : 0;
            const prob = Math.min(0.95, Math.max(0.01, baseProb + (effectiveScorerStat - 50) * 0.01 + 0.02 + upsetBoost));
            if (Math.random() < prob) {
                // O jogador sorteado carrega o lado real; o gol é creditado ao adversário.
                const ownerTeam = isOwnGoal ? scorer.ownerTeam : null;
                let shotRoll = Math.random();
                if (scorer.role === 'pv') shotRoll += 0.12;
                if (scorer.role === 'pv' && scorer.finalizacao) shotRoll += (Number(scorer.finalizacao) - 50) * 0.002;
                if (scorer.role === 'vl' && scorer.finalizacao) shotRoll += (Number(scorer.finalizacao) - 50) * 0.0015;
                const opponentGK = team2Cards && team2Cards.gk ? team2Cards.gk : { player_name: 'Goleiro', id: null };
                let gkStat = getGKStatInfluence(opponentGK);
                gkStat = Math.max(1, Math.min(100, gkStat));
                // apply GK ability multipliers (opponentGK) and any attacker effect on GK
                const gkMultObj = applyAbilityMultipliers(opponentGK, scorer, { type: 'def', duel: false }, { applyAbilities: true, logAbilities: false });
                // also consider scorer's ability affecting GK
                const attackerAbl = applyAbilityMultipliers(scorer, opponentGK, { type: abilContext.type, duel: false }, { applyAbilities: true, logAbilities: false });
                const gkBordaBonus = aplicarBonusBorda(opponentGK, bordas2); // 🎨 BÔNUS SECRETO P2W DO GK
                const effectiveGkStat = Math.max(1, Math.min(100, gkStat * gkMultObj.playerMultiplier * attackerAbl.gkMultiplier * gkBordaBonus));
                const saveChance = Math.max(0.05, Math.min(0.95, 0.6 + (effectiveGkStat - 50) * 0.003));

                if (isOwnGoal && ownerTeam) {
                    const scoringTeam = ownerTeam === 'team1' ? 'team2' : 'team1';
                    if (scoringTeam === 'team1') s1++; else s2++;
                    const phrase = OWN_GOAL_PHRASES[Math.floor(Math.random() * OWN_GOAL_PHRASES.length)];
                    events.push({ time: sec, type: 'own_goal', text: `${EMOJIS.own_goal} ${scorer.player_name} (${scorer.role ? (scorer.role.toUpperCase()) : ''}) [CONTRA] ${phrase}`, team: scoringTeam, scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null, scorerTeam: ownerTeam, isOwnGoal: true });
                } else {
                    if (shotRoll < 0.30) {
                        const missPhrase = MISS_PHRASES[Math.floor(Math.random() * MISS_PHRASES.length)];
                        events.push({ time: sec, type: 'miss', text: `${EMOJIS.miss} ${missPhrase} ${scorer.player_name} (${team1Name})`, team: 'team1', scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null });
                    } else if (shotRoll < 0.75) {
                        if (Math.random() < saveChance) {
                            const savePhrase = SAVE_PHRASES[Math.floor(Math.random() * SAVE_PHRASES.length)];
                            events.push({ time: sec, type: 'shot', text: `${EMOJIS.save} ${savePhrase} ${opponentGK.player_name} em ${scorer.player_name} (${team1Name})`, team: 'team1', scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null });
                        } else {
                            // Assistência: influência do passe do VL/PV
                            let assistChance = 0.7;
                            let assister = null;
                            const candidates = Object.values(team1Cards || {}).filter(p => p && p.player_name && p.player_name !== scorer.player_name);
                            if (candidates.length) {
                                // PV tem mais chance de ser o assistente
                                let pvCandidates = candidates.filter(p => p.role === 'pv');
                                if (pvCandidates.length && Math.random() < 0.5) {
                                    assister = pvCandidates[Math.floor(Math.random() * pvCandidates.length)];
                                } else {
                                    assister = candidates[Math.floor(Math.random() * candidates.length)];
                                }
                                // Influência do stat de passe
                                if (assister && assister.passe) assistChance += (Number(assister.passe) - 50) * 0.002;
                            }
                            if (Math.random() < assistChance) {
                                s1++;
                                const phrase = GOAL_PHRASES[Math.floor(Math.random() * GOAL_PHRASES.length)];
                                const assisterName = assister ? (assister.player_name || assister.avatar || 'Jogador') : null;
                                const text = assister ? `${EMOJIS.goal} ${scorer.player_name} (${team1Name}) ${phrase} ${EMOJIS.assist} ${ASSIST_PHRASES[Math.floor(Math.random() * ASSIST_PHRASES.length)]} ${assisterName}` : `${EMOJIS.goal} ${scorer.player_name} (${team1Name}) ${phrase}`;
                                events.push({ time: sec, type: 'goal', text, team: 'team1', scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null, assisterId: assister ? (assister.id || null) : null, assisterAvatar: assister ? (assister.avatar || null) : null });
                            } else {
                                // Gol sem assistência
                                s1++;
                                const phrase = GOAL_PHRASES[Math.floor(Math.random() * GOAL_PHRASES.length)];
                                const text = `${EMOJIS.goal} ${scorer.player_name} (${team1Name}) ${phrase}`;
                                events.push({ time: sec, type: 'goal', text, team: 'team1', scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null });
                            }
                        }
                    } else if (shotRoll < 0.88) {
                        const blockPhrase = BLOCKED_PHRASES[Math.floor(Math.random() * BLOCKED_PHRASES.length)];
                        events.push({ time: sec, type: 'blocked', text: `${EMOJIS.blocked} ${blockPhrase} ${scorer.player_name} (${team1Name})`, team: 'team1', scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null });
                    }
                }
            }
        }

        // --- TIME 2 ---
        for (let a = 0; a < attemptsTeam2; a++) {
            const isOwnGoal = Math.random() < 0.03;
            const scorer = isOwnGoal ? getRandomPlayerFromBothTeams(team1Cards, team2Cards) : getRandomPlayer(team2Cards, true);
            let scorerStat = 50;
            if (scorer.role === 'pv') scorerStat = getPVStatInfluence(scorer);
            else if (scorer.role === 'vl') scorerStat = getVLStatInfluence(scorer);
            else if (scorer.role === 'gk') scorerStat = getGKStatInfluence(scorer);
            scorerStat = Math.max(1, Math.min(100, scorerStat));
            const abilContext = { type: scorer.role === 'pv' ? 'finalizacao' : scorer.role === 'vl' ? 'passe' : scorer.role === 'gk' ? 'def' : null, duel: false };
            const abilMult = applyAbilityMultipliers(scorer, team1Cards && team1Cards.gk ? team1Cards.gk : null, abilContext, { applyAbilities: true, logAbilities: false });
            const bordaBonus2 = aplicarBonusBorda(scorer, bordas2); // 🎨 P2W TIME 2
            const effectiveScorerStat = Math.max(1, Math.min(100, scorerStat * abilMult.playerMultiplier * bordaBonus2));
            const gap2 = Math.abs(over1 - over2);
            let upsetChance2 = 0.02;
            if (gap2 >= 10) {
                const isUnderdog2 = bias2 < 0; // bias2 < 0 means team2 is weaker
                if (isUnderdog2) upsetChance2 = 0.30;
            }
            const upsetBoost2 = (Math.random() < upsetChance2) ? 0.12 : 0;
            const prob = Math.min(0.95, Math.max(0.01, baseProb + (effectiveScorerStat - 50) * 0.01 + 0.02 + upsetBoost2));
            if (Math.random() < prob) {
                const ownerTeam = isOwnGoal ? scorer.ownerTeam : null;
                let shotRoll = Math.random();
                if (scorer.role === 'pv') shotRoll += 0.12;
                if (scorer.role === 'pv' && scorer.finalizacao) shotRoll += (Number(scorer.finalizacao) - 50) * 0.002;
                if (scorer.role === 'vl' && scorer.finalizacao) shotRoll += (Number(scorer.finalizacao) - 50) * 0.0015;
                const opponentGK = team1Cards && team1Cards.gk ? team1Cards.gk : { player_name: 'Goleiro', id: null };
                let gkStat = getGKStatInfluence(opponentGK);
                gkStat = Math.max(1, Math.min(100, gkStat));
                const gkMultObj = applyAbilityMultipliers(opponentGK, scorer, { type: 'def', duel: false }, { applyAbilities: true, logAbilities: false });
                const attackerAbl = applyAbilityMultipliers(scorer, opponentGK, { type: abilContext.type, duel: false }, { applyAbilities: true, logAbilities: false });
                const gkBordaBonus1 = aplicarBonusBorda(opponentGK, bordas1); // 🎨 BÔNUS SECRETO P2W GK TIME 1
                const effectiveGkStat = Math.max(1, Math.min(100, gkStat * gkMultObj.playerMultiplier * attackerAbl.gkMultiplier * gkBordaBonus1));
                const saveChance = Math.max(0.05, Math.min(0.95, 0.6 + (effectiveGkStat - 50) * 0.003));

                if (isOwnGoal && ownerTeam) {
                    const scoringTeam = ownerTeam === 'team1' ? 'team2' : 'team1';
                    if (scoringTeam === 'team1') s1++; else s2++;
                    const phrase = OWN_GOAL_PHRASES[Math.floor(Math.random() * OWN_GOAL_PHRASES.length)];
                    events.push({ time: sec, type: 'own_goal', text: `${EMOJIS.own_goal} ${scorer.player_name} (${scorer.role ? (scorer.role.toUpperCase()) : ''}) [CONTRA] ${phrase}`, team: scoringTeam, scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null, scorerTeam: ownerTeam, isOwnGoal: true });
                } else {
                    if (shotRoll < 0.30) {
                        const missPhrase = MISS_PHRASES[Math.floor(Math.random() * MISS_PHRASES.length)];
                        events.push({ time: sec, type: 'miss', text: `${EMOJIS.miss} ${missPhrase} ${scorer.player_name} (${team2Name})`, team: 'team2', scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null });
                    } else if (shotRoll < 0.75) {
                        if (Math.random() < saveChance) {
                            const savePhrase = SAVE_PHRASES[Math.floor(Math.random() * SAVE_PHRASES.length)];
                            events.push({ time: sec, type: 'shot', text: `${EMOJIS.save} ${savePhrase} ${opponentGK.player_name} em ${scorer.player_name} (${team2Name})`, team: 'team2', scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null });
                        } else {
                            let assistChance = 0.45;
                            let assister = null;
                            const candidates = Object.values(team2Cards || {}).filter(p => p && p.player_name && p.player_name !== scorer.player_name);
                            if (candidates.length) {
                                let pvCandidates = candidates.filter(p => p.role === 'pv');
                                if (pvCandidates.length && Math.random() < 0.5) {
                                    assister = pvCandidates[Math.floor(Math.random() * pvCandidates.length)];
                                } else {
                                    assister = candidates[Math.floor(Math.random() * candidates.length)];
                                }
                                if (assister && assister.passe) assistChance += (Number(assister.passe) - 50) * 0.002;
                            }
                            if (Math.random() < assistChance) {
                                s2++;
                                const phrase = GOAL_PHRASES[Math.floor(Math.random() * GOAL_PHRASES.length)];
                                const assisterName = assister ? (assister.player_name || assister.avatar || 'Jogador') : null;
                                const text = assister ? `${EMOJIS.goal} ${scorer.player_name} (${team2Name}) ${phrase} ${EMOJIS.assist} ${ASSIST_PHRASES[Math.floor(Math.random() * ASSIST_PHRASES.length)]} ${assisterName}` : `${EMOJIS.goal} ${scorer.player_name} (${team2Name}) ${phrase}`;
                                events.push({ time: sec, type: 'goal', text, team: 'team2', scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null, assisterId: assister ? (assister.id || null) : null, assisterAvatar: assister ? (assister.avatar || null) : null });
                            } else {
                                s2++;
                                const phrase = GOAL_PHRASES[Math.floor(Math.random() * GOAL_PHRASES.length)];
                                const text = `${EMOJIS.goal} ${scorer.player_name} (${team2Name}) ${phrase}`;
                                events.push({ time: sec, type: 'goal', text, team: 'team2', scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null });
                            }
                        }
                    } else if (shotRoll < 0.88) {
                        const blockPhrase = BLOCKED_PHRASES[Math.floor(Math.random() * BLOCKED_PHRASES.length)];
                        events.push({ time: sec, type: 'blocked', text: `${EMOJIS.blocked} ${blockPhrase} ${scorer.player_name} (${team2Name})`, team: 'team2', scorerId: scorer.id || null, scorerAvatar: scorer.avatar || null });
                    }
                }
            }
        }
    }


    // PRORROGAÇÃO: Gol de ouro infinito até sair gol (sem empate)
    let otSec = 360;
    while (s1 === s2) {
        otSec += 15;
        // Frenético também no OT: 6-10 tentativas por time
        const attempts1 = 6 + Math.floor(Math.random() * 5);
        const attempts2 = 6 + Math.floor(Math.random() * 5);
        let golNaRodada = false;
        for (let a = 0; a < attempts1; a++) {
            if (Math.random() < Math.min(0.95, baseProb + 0.15)) {
                const scorer = getRandomPlayer(team1Cards, true);
                const shotRoll = Math.random();
                const opponentGK = team2Cards && team2Cards.gk ? team2Cards.gk : { player_name: 'Goleiro', id: null };
                if (shotRoll < 0.30) events.push({ time: otSec, type: 'miss', text: `${EMOJIS.miss} ${MISS_PHRASES[Math.floor(Math.random() * MISS_PHRASES.length)]} ${scorer.player_name} (${team1Name})`, team: 'team1', scorerId: scorer.id || null });
                else if (shotRoll < 0.75) {
                    if (Math.random() < 0.55) events.push({ time: otSec, type: 'shot', text: `${EMOJIS.save} ${SAVE_PHRASES[Math.floor(Math.random() * SAVE_PHRASES.length)]} ${opponentGK.player_name} em ${scorer.player_name} (${team1Name})`, team: 'team1', scorerId: scorer.id || null });
                    else { s1++; golNaRodada = true; const phrase = GOAL_PHRASES[Math.floor(Math.random() * GOAL_PHRASES.length)]; events.push({ time: otSec, type: 'goal', text: `${EMOJIS.goal} ${scorer.player_name} (${team1Name}) ${phrase}`, team: 'team1', scorerId: scorer.id || null }); break; }
                } else if (shotRoll < 0.88) {
                    const blockPhrase = BLOCKED_PHRASES[Math.floor(Math.random() * BLOCKED_PHRASES.length)];
                    events.push({ time: otSec, type: 'blocked', text: `${EMOJIS.blocked} ${blockPhrase} ${scorer.player_name} (${team1Name})`, team: 'team1', scorerId: scorer.id || null });
                }
            }
        }
        if (s1 !== s2) break;
        for (let a = 0; a < attempts2; a++) {
            if (Math.random() < Math.min(0.95, baseProb + 0.15)) {
                const scorer = getRandomPlayer(team2Cards, true);
                const shotRoll = Math.random();
                const opponentGK = team1Cards && team1Cards.gk ? team1Cards.gk : { player_name: 'Goleiro', id: null };
                if (shotRoll < 0.30) events.push({ time: otSec, type: 'miss', text: `${EMOJIS.miss} ${MISS_PHRASES[Math.floor(Math.random() * MISS_PHRASES.length)]} ${scorer.player_name} (${team2Name})`, team: 'team2', scorerId: scorer.id || null });
                else if (shotRoll < 0.75) {
                    if (Math.random() < 0.55) events.push({ time: otSec, type: 'shot', text: `${EMOJIS.save} ${SAVE_PHRASES[Math.floor(Math.random() * SAVE_PHRASES.length)]} ${opponentGK.player_name} em ${scorer.player_name} (${team2Name})`, team: 'team2', scorerId: scorer.id || null });
                    else { s2++; golNaRodada = true; const phrase = GOAL_PHRASES[Math.floor(Math.random() * GOAL_PHRASES.length)]; events.push({ time: otSec, type: 'goal', text: `${EMOJIS.goal} ${scorer.player_name} (${team2Name}) ${phrase}`, team: 'team2', scorerId: scorer.id || null }); break; }
                } else if (shotRoll < 0.88) {
                    const blockPhrase = BLOCKED_PHRASES[Math.floor(Math.random() * BLOCKED_PHRASES.length)];
                    events.push({ time: otSec, type: 'blocked', text: `${EMOJIS.blocked} ${blockPhrase} ${scorer.player_name} (${team2Name})`, team: 'team2', scorerId: scorer.id || null });
                }
            }
        }
        // Continua até sair gol
    }

    const winner = s1 > s2 ? 'team1' : s2 > s1 ? 'team2' : 'draw';
    // attach a human-friendly M:SS formatted time to each event for callers
    events.forEach(ev => { ev.timeFormatted = displayTime(ev.time || 0); });

    // Calcular duração final da partida com base no último evento (fallback 360s)
    const durationSeconds = events.length ? Math.max(...events.map(ev => Number(ev.time) || 0)) : 360;
    const durationStr = displayTime(durationSeconds);

    // Artilharia e assistências detalhadas por time (sem duplicação de emojis)
    const statsByTeam = { [team1Name]: {}, [team2Name]: {} };
    for (const ev of events) {
        if (ev.type === 'goal' && ev.scorerId) {
            const team = ev.team === 'team1' ? team1Name : team2Name;
            const id = ev.scorerId;
            let playerName = null;

            // Buscar player name nas cartas do time correto
            const teamCards = ev.team === 'team1' ? team1Cards : team2Cards;
            if (teamCards) {
                // Procurar em todas as posições (gk, vl, pv)
                for (const pos of ['gk', 'vl', 'pv']) {
                    if (teamCards[pos] && teamCards[pos].id === id) {
                        playerName = teamCards[pos].player_name;
                        break;
                    }
                }
            }

            if (!playerName) {
                playerName = ev.scorerAvatar ? `${ev.scorerAvatar}` : 'Jogador';
            }
            if (!statsByTeam[team][id]) statsByTeam[team][id] = { playerName, goals: 0, assists: 0 };
            statsByTeam[team][id].goals++;
        }
        if (ev.type === 'goal' && ev.assisterId) {
            // Assistência só conta se for gol
            const assisterId = ev.assisterId;
            let team = null;
            let playerName = null;

            // Procurar em qual time está o assistente
            if (team1Cards) {
                for (const pos of ['gk', 'vl', 'pv']) {
                    if (team1Cards[pos] && team1Cards[pos].id === assisterId) {
                        team = team1Name;
                        playerName = team1Cards[pos].player_name;
                        break;
                    }
                }
            }
            if (!team && team2Cards) {
                for (const pos of ['gk', 'vl', 'pv']) {
                    if (team2Cards[pos] && team2Cards[pos].id === assisterId) {
                        team = team2Name;
                        playerName = team2Cards[pos].player_name;
                        break;
                    }
                }
            }

            if (team) {
                if (!playerName) {
                    playerName = ev.assisterAvatar ? `${ev.assisterAvatar}` : 'Jogador';
                }
                if (!statsByTeam[team][assisterId]) statsByTeam[team][assisterId] = { playerName, goals: 0, assists: 0 };
                statsByTeam[team][assisterId].assists++;
            }
        }
    }

    // Função utilitária para formatar artilharia e assistências por time
    function formatStatsByTeam(statsByTeam) {
        let out = '';
        for (const [team, players] of Object.entries(statsByTeam)) {
            out += `\n${team}:`;
            const arr = Object.values(players).filter(p => (p.goals > 0 || p.assists > 0 || p.ownGoals > 0));
            if (arr.length === 0) {
                out += ' nenhum';
            } else {
                out += ` ⚽ Gols:`;
                // Mostrar gols normais e contra
                const gols = arr.filter(x => x.goals > 0 || x.ownGoals > 0).map(p => {
                    let txt = '';
                    if (p.goals > 0) txt += `${p.playerName} (${p.goals})`;
                    if (p.ownGoals > 0) txt += `${p.playerName} (${p.ownGoals} contra)`;
                    return txt;
                }).filter(Boolean).join(', ');
                out += gols ? ` ${gols}` : ' nenhum';
                out += `\n   🅰️ Assistencia:`;
                const assists = arr.filter(x => x.assists > 0).map(p => `${p.playerName} (${p.assists})`).join(', ');
                out += assists ? ` ${assists}` : ' nenhum';
            }
        }
        return out.trim();
    }

    return { score: { team1: s1, team2: s2 }, winner, events, duration: durationStr, statsByTeam, formatStatsByTeam };
}

// ============================================================================
// ⚙️ MOTOR DE PARTIDA v2 — balanceado e RELATIVO (ataque x defesa)
//
// Por que existe: o motor antigo usava chance ABSOLUTA por stat e travava no
// teto de 100 (time tudo 99 = ~20 gols, PV 83 = ~5 gols/jogo). Agora:
//   • a chance depende da DIFERENÇA entre ataque do chutador e defesa do rival
//     (GK + VL), então 99x99 joga igual a 70x70 e quem tem bônus realmente ganha;
//   • treinador, patrocínio e habilidade somam PONTOS por cima do stat da carta
//     (teto interno 115, a carta continua limitada a 99);
//   • cada partida sorteia um "ritmo": quase sempre ~7-9 gols, às vezes goleada;
//   • GK e VL também chutam (Haxball), não existe zagueiro: o VL é quem defende;
//   • nunca empata: gol de ouro decidido pelos mesmos stats, ordem sorteada.
// Tudo ajustável em MATCH_TUNING.
// ============================================================================
const MATCH_TUNING = {
    attemptsPerSlot: 1.25,          // finalizações médias por time a cada 15s (antes do ritmo)
    tempoMin: 0.7, tempoSpread: 0.9, tempoCurve: 1.8, // ritmo da partida (0.7x a 1.6x; alto é raro → goleada)
    statCompression: 0.6,          // diferença de nível entre cartas vale 60% (bônus de treinador/patrocínio/habilidade valem 100%)
    statCap: 115,                  // teto interno dos stats em jogo (carta continua até 99)
    shooterWeights: { pv: 0.52, vl: 0.30, gk: 0.18 }, // quem chuta
    ownGoalChance: 0.004,          // gol contra por tentativa (raro)
    createBase: 0.62, createSlope: 0.0055, createMin: 0.25, createMax: 0.92, // chegar ao chute (ataque - defesa do VL)
    blockedShare: 0.45,            // quando o lance morre, parte vira "bloqueado"
    onTargetBase: 0.72, onTargetSlope: 0.004, onTargetRef: 70, onTargetMin: 0.45, onTargetMax: 0.92, // chute no alvo (finalização)
    saveBase: 0.72, saveSlope: 0.005, saveMin: 0.18, saveMax: 0.88,         // defesa do GK (GK - ataque)
    abilityPoints: 60,             // habilidade: multiplicador x 60 = pontos (Matador 0.20 → +12)
    teamBonusCap: 15,              // teto de pontos de patrocínio por lado
    otCreateBoostPerRound: 0.02,   // gol de ouro: acelera para terminar
    assistBase: 0.70, assistPasseSlope: 0.002
};

function simStat(value, fallback = 50) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
function simClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function capStat(v) { return simClamp(v, 1, MATCH_TUNING.statCap); }

const ROLE_STAT_KEYS = {
    gk: ['def', 'pos', 'sai', 'drible'],
    vl: ['def', 'drible', 'passe', 'finalizacao'],
    pv: ['finalizacao', 'drible', 'pos', 'passe']
};
const SCOPE_TO_KEY = { def: 'def', saidaDeBola: 'sai', drible: 'drible', passe: 'passe', finalizacao: 'finalizacao', posicionamento: 'pos' };

function equippedAbility(card) {
    return card && (card.habilidade_equipada || card.habilidade) ? (card.habilidade_equipada || card.habilidade) : null;
}
// Pontos de ataque que a habilidade dá a quem chuta (só se o atributo dela faz parte da função da posição)
function abilityAttackPoints(card, role) {
    const ef = HABILIDADE_EFFECTS[equippedAbility(card)];
    if (!ef) return 0;
    const key = SCOPE_TO_KEY[ef.scope];
    if (!key || !(ROLE_STAT_KEYS[role] || []).includes(key)) return 0;
    return ef.multiplier * MATCH_TUNING.abilityPoints;
}
// Pontos de defesa: Muralha/GK Skill no GK, Pitbull no VL
function abilityDefensePoints(card, role) {
    const name = equippedAbility(card);
    const ef = HABILIDADE_EFFECTS[name];
    if (!ef) return 0;
    if (role === 'gk' && name === 'Muralha') return ef.multiplier * MATCH_TUNING.abilityPoints;
    if (role === 'gk' && name === 'GK Skill') return (ef.extraDefInDuels || 0) * MATCH_TUNING.abilityPoints;
    if (role === 'vl' && name === 'Pitbull') return ef.multiplier * MATCH_TUNING.abilityPoints;
    return 0;
}
function shooterInfluence(card, role) {
    if (role === 'pv') return getPVStatInfluence(card);
    if (role === 'vl') return getVLStatInfluence(card);
    return getGKStatInfluence(card);
}

const SIM_EMOJIS = { goal: '⚽', own_goal: '🤣', shot: '💥', miss: '❌', blocked: '🛡️', save: '🧤', assist: '🎯' };
const SIM_PHRASES = {
    goal: ['DE CORTADAAAAAAAAAAAA', 'DE TABELAAAAAAAAAAA', 'MIGUEEEEEEEL', 'SEMANAAAAAAAL', 'ESSA NEM O BLACK RUITO NO AUGE PEGAVA', 'TOMOU GOL DO PAI DE VOCES', 'QUE GOLAÇO, MEU AMIGO!'],
    miss: ['PERDEU UMA INCRÍVEL!', 'CHUTOU PRA FORA!', 'QUE CHANCE DESPERDIÇADA!', 'Bateu mal, foi longe!', 'A bola saiu raspando!', 'Tentou, mas não deu!'],
    save: ['DEFESAÇA DO GOLEIRO!', 'QUE DEFESA!', 'GOLEIRO SALVOU!', 'DEFENDEU NO REFLEXO!', 'QUE PAREDÃO!', 'GOLEIRO TÁ INSPIRADO!'],
    blocked: ['BLOQUEADO NA HORA H!', 'O VL FECHOU O ESPAÇO!', 'O VL TRAVOU!', 'BLOQUEIO PERFEITO!'],
    assist: ['com aquele velho passe da parede', 'que passe foi esse?', 'deu o passe na medida para', 'deixou na cara do gol para', 'assistência perfeita de'],
    ownGoal: ['heterio é voce', 'KIMIKAAAAAAAADA!', 'ih, deu fake!', 'PARECEU O BOOM EIN!', 'NÃO É PRA ESSELADO!']
};
const simPick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Simula a partida inteira de forma síncrona e devolve os eventos (cada um com
 * o placar logo após o lance). O "replay" com delays é feito por simulateMatchRealtime.
 * options: durationSeconds, isFinal, team1Bonus/team2Bonus {attack, defense} (patrocínio),
 *          team2GoalChanceBonus / team2SaveChanceBonus (Torre), tempo (força o ritmo, p/ testes)
 */
function runMatchCore(team1Cards, team2Cards, team1Name, team2Name, options = {}) {
    const T = MATCH_TUNING;
    const regulationEnd = Math.max(15, Number(options.durationSeconds) || 360);
    const goalBonus2 = simClamp(Number(options.team2GoalChanceBonus) || 0, 0, 0.15);
    const saveBonus2 = simClamp(Number(options.team2SaveChanceBonus) || 0, 0, 0.15);
    const teamBonus = {
        team1: { attack: simClamp(simStat(options.team1Bonus && options.team1Bonus.attack, 0), 0, T.teamBonusCap), defense: simClamp(simStat(options.team1Bonus && options.team1Bonus.defense, 0), 0, T.teamBonusCap) },
        team2: { attack: simClamp(simStat(options.team2Bonus && options.team2Bonus.attack, 0), 0, T.teamBonusCap), defense: simClamp(simStat(options.team2Bonus && options.team2Bonus.defense, 0), 0, T.teamBonusCap) }
    };
    const sides = {
        team1: { key: 'team1', cards: team1Cards, name: team1Name },
        team2: { key: 'team2', cards: team2Cards, name: team2Name }
    };
    const events = [];
    const scoreAfter = [];
    let s1 = 0, s2 = 0;
    const tempo = Number.isFinite(Number(options.tempo))
        ? Number(options.tempo)
        : T.tempoMin + T.tempoSpread * Math.pow(Math.random(), T.tempoCurve);

    // Comprime só a diferença de nível das cartas (os bônus entram depois, sem compressão)
    const squash = (v) => 50 + (v - 50) * T.statCompression;

    function push(ev) {
        ev.timeFormatted = displayTime(ev.time || 0);
        events.push(ev);
        scoreAfter.push({ team1: s1, team2: s2 });
    }
    function addGoal(side) { if (side === 'team1') s1++; else s2++; }

    function pickShooter(cards) {
        const weights = T.shooterWeights;
        const roles = ['pv', 'vl', 'gk'].filter(r => cards && cards[r]);
        const total = roles.reduce((s, r) => s + weights[r], 0);
        let roll = Math.random() * total;
        for (const r of roles) { roll -= weights[r]; if (roll <= 0) return r; }
        return roles[0];
    }

    // Uma finalização completa: chegar → no alvo → defesa do GK. Retorna true se saiu gol.
    function resolveAttempt(attSide, time, extra = {}) {
        const defSide = attSide === 'team1' ? 'team2' : 'team1';
        const att = sides[attSide], dfn = sides[defSide];

        // Gol contra (raro): quem defende (VL ou GK) joga na própria meta
        if (!extra.ot && Math.random() < T.ownGoalChance) {
            const owner = (dfn.cards.vl && (!dfn.cards.gk || Math.random() < 0.7)) ? dfn.cards.vl : dfn.cards.gk;
            if (owner) {
                const ownRole = owner === dfn.cards.vl ? 'vl' : 'gk';
                addGoal(attSide);
                push({ time, type: 'own_goal', text: `${SIM_EMOJIS.own_goal} ${owner.player_name || 'Jogador'} (${ownRole.toUpperCase()}) [CONTRA] ${simPick(SIM_PHRASES.ownGoal)}`, team: attSide, scorerId: owner.id || null, scorerAvatar: owner.avatar || null, scorerTeam: defSide, isOwnGoal: true });
                return true;
            }
        }

        const role = pickShooter(att.cards);
        const shooter = att.cards[role];
        const attack = capStat(squash(shooterInfluence(shooter, role)) + abilityAttackPoints(shooter, role) + teamBonus[attSide].attack);
        const dvl = dfn.cards.vl, dgk = dfn.cards.gk;
        const vlDef = capStat(squash(dvl ? simStat(dvl.def) * 0.6 + simStat(dvl.pos) * 0.4 : 50) + (dvl ? abilityDefensePoints(dvl, 'vl') : 0) + teamBonus[defSide].defense);
        const gkRating = capStat(squash(dgk ? getGKStatInfluence(dgk) : 50) + (dgk ? abilityDefensePoints(dgk, 'gk') : 0) + teamBonus[defSide].defense);
        const base = { time, team: attSide, scorerId: shooter.id || null, scorerAvatar: shooter.avatar || null };
        const shooterName = shooter.player_name || 'Jogador';

        // 1) Chegou ao chute? (ataque x marcação do VL)
        const pCreate = simClamp(T.createBase + (attack - vlDef) * T.createSlope + (attSide === 'team2' ? goalBonus2 : 0) + (extra.createBoost || 0), T.createMin, T.createMax);
        if (Math.random() >= pCreate) {
            if (Math.random() < T.blockedShare) {
                push({ ...base, type: 'blocked', text: `${SIM_EMOJIS.blocked} ${simPick(SIM_PHRASES.blocked)} ${shooterName} (${att.name})` });
            }
            return false;
        }
        // 2) Foi no alvo? (finalização do chutador)
        const pOnTarget = simClamp(T.onTargetBase + (simStat(shooter.finalizacao) - T.onTargetRef) * T.onTargetSlope, T.onTargetMin, T.onTargetMax);
        if (Math.random() >= pOnTarget) {
            push({ ...base, type: 'miss', text: `${SIM_EMOJIS.miss} ${simPick(SIM_PHRASES.miss)} ${shooterName} (${att.name})` });
            return false;
        }
        // 3) O goleiro defendeu? (GK x ataque)
        const pSave = simClamp(T.saveBase + (gkRating - attack) * T.saveSlope + (attSide === 'team1' ? saveBonus2 : 0), T.saveMin, T.saveMax);
        if (Math.random() < pSave) {
            const gkName = dgk ? (dgk.player_name || 'Goleiro') : 'Goleiro';
            push({ ...base, type: 'shot', text: `${SIM_EMOJIS.save} ${simPick(SIM_PHRASES.save)} ${gkName} em ${shooterName} (${att.name})` });
            return false;
        }
        // GOL (com ou sem assistência)
        let assister = null;
        const mates = ['pv', 'vl', 'gk'].map(r => att.cards[r]).filter(c => c && c !== shooter && c.id !== shooter.id);
        if (mates.length) {
            const pvMate = mates.find(c => c === att.cards.pv);
            assister = (pvMate && Math.random() < 0.5) ? pvMate : simPick(mates);
            const chance = T.assistBase + (simStat(assister.passe) - 50) * T.assistPasseSlope;
            if (Math.random() >= chance) assister = null;
        }
        addGoal(attSide);
        const phrase = simPick(SIM_PHRASES.goal);
        let text = `${SIM_EMOJIS.goal} ${shooterName} (${att.name}) ${phrase}`;
        const ev = { ...base, type: 'goal' };
        if (assister) {
            text += ` ${SIM_EMOJIS.assist} ${simPick(SIM_PHRASES.assist)} ${assister.player_name || assister.avatar || 'Jogador'}`;
            ev.assisterId = assister.id || null;
            ev.assisterAvatar = assister.avatar || null;
        }
        ev.text = text;
        push(ev);
        return true;
    }

    // Tempo normal
    const lambda = T.attemptsPerSlot * tempo;
    for (let sec = 15; sec <= regulationEnd; sec += 15) {
        const order = Math.random() < 0.5 ? ['team1', 'team2'] : ['team2', 'team1'];
        for (const side of order) {
            const n = Math.max(0, Math.round(lambda + (Math.random() - 0.5) * 2));
            for (let a = 0; a < n; a++) resolveAttempt(side, sec);
        }
    }

    // Gol de ouro (nunca empata): mesmos stats, ordem sorteada a cada rodada
    let otSec = regulationEnd, round = 0;
    while (s1 === s2 && round < 80) {
        round++;
        otSec += 15;
        const boost = Math.min(0.35, round * T.otCreateBoostPerRound);
        const order = Math.random() < 0.5 ? ['team1', 'team2'] : ['team2', 'team1'];
        for (const side of order) {
            const n = 1 + (round > 3 ? 1 : 0);
            for (let a = 0; a < n; a++) {
                if (resolveAttempt(side, otSec, { ot: true, createBoost: boost })) break;
            }
            if (s1 !== s2) break;
        }
    }
    if (s1 === s2) { // salvaguarda extrema: sorteia o gol
        const side = Math.random() < 0.5 ? 'team1' : 'team2';
        const c = sides[side].cards.pv || sides[side].cards.vl || sides[side].cards.gk;
        addGoal(side);
        push({ time: otSec + 15, type: 'goal', text: `${SIM_EMOJIS.goal} ${c.player_name || 'Jogador'} (${sides[side].name}) ${simPick(SIM_PHRASES.goal)}`, team: side, scorerId: c.id || null, scorerAvatar: c.avatar || null });
    }

    return { events, scoreAfter, score: { team1: s1, team2: s2 }, regulationEnd, tempo };
}

async function simulateMatchRealtime(team1Cards, team2Cards, team1Name, team2Name, onUpdate, options = {}) {
    const stepMs = Number(options.stepMs || 600);
    const initialDelay = Number(options.initialDelay || 400);
    const stepFor = (ev) => {
        if (typeof options.getStepMs === 'function') {
            const custom = Number(options.getStepMs(ev));
            if (Number.isFinite(custom) && custom >= 0) return custom;
        }
        return stepMs;
    };
    const emptyResult = (winner) => ({ score: { team1: 0, team2: 0 }, winner, events: [], duration: '00:00', statsByTeam: {}, formatStatsByTeam: () => '' });

    if (!team1Cards || !team2Cards) {
        console.error('❌ Cards não fornecidos para simulação');
        return emptyResult('draw');
    }
    for (const pos of ['gk', 'vl', 'pv']) {
        if (!team1Cards[pos]) { console.error(`❌ Time 1 não tem ${pos.toUpperCase()} configurado`); return emptyResult('team2'); }
        if (!team2Cards[pos]) { console.error(`❌ Time 2 não tem ${pos.toUpperCase()} configurado`); return emptyResult('team1'); }
        if (!team1Cards[pos].player_name || !team1Cards[pos].id) { console.error(`❌ Time 1 ${pos.toUpperCase()} não tem player_name ou id válido`); return emptyResult('team2'); }
        if (!team2Cards[pos].player_name || !team2Cards[pos].id) { console.error(`❌ Time 2 ${pos.toUpperCase()} não tem player_name ou id válido`); return emptyResult('team1'); }
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    if (initialDelay > 0) await sleep(initialDelay);

    const core = runMatchCore(team1Cards, team2Cards, team1Name, team2Name, options);
    const { events, regulationEnd } = core;
    const s1 = core.score.team1, s2 = core.score.team2;

    try {
        console.log(`✅ Simulação v2: ${team1Name} ${s1} x ${s2} ${team2Name} | ritmo=${core.tempo.toFixed(2)} | overall ${calculateTeamOverall(team1Cards)} x ${calculateTeamOverall(team2Cards)}`);
    } catch (e) { /* ignore */ }

    // Replay ao vivo dos lances já sorteados
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (typeof onUpdate === 'function') {
            try {
                const score = { ...core.scoreAfter[i] };
                onUpdate({ index: i, event, score, total: { events: events.slice(0, i + 1), score: { ...score } } });
            } catch (err) { /* swallow */ }
        }
        await sleep(stepFor(event));
    }

    // Build final result
    const winner = s1 > s2 ? 'team1' : s2 > s1 ? 'team2' : 'draw';
    const durationSeconds = events.length ? Math.max(...events.map(ev => Number(ev.time) || 0)) : regulationEnd;
    const durationStr = displayTime(durationSeconds);

    // Calculate stats
    const statsByTeam = { [team1Name]: {}, [team2Name]: {} };
    for (const ev of events) {
        if (ev.type === 'goal' && ev.scorerId) {
            const team = ev.team === 'team1' ? team1Name : team2Name;
            const id = ev.scorerId;
            let playerName = null;

            const teamCards = ev.team === 'team1' ? team1Cards : team2Cards;
            if (teamCards) {
                for (const pos of ['gk', 'vl', 'pv']) {
                    if (teamCards[pos] && teamCards[pos].id === id) {
                        playerName = teamCards[pos].player_name;
                        break;
                    }
                }
            }

            if (!playerName) {
                playerName = ev.scorerAvatar ? `${ev.scorerAvatar}` : 'Jogador';
            }
            if (!statsByTeam[team][id]) statsByTeam[team][id] = { playerName, goals: 0, assists: 0 };
            statsByTeam[team][id].goals++;
        }
        if (ev.type === 'goal' && ev.assisterId) {
            const assisterId = ev.assisterId;
            let team = null;
            let playerName = null;

            if (team1Cards) {
                for (const pos of ['gk', 'vl', 'pv']) {
                    if (team1Cards[pos] && team1Cards[pos].id === assisterId) {
                        team = team1Name;
                        playerName = team1Cards[pos].player_name;
                        break;
                    }
                }
            }
            if (!team && team2Cards) {
                for (const pos of ['gk', 'vl', 'pv']) {
                    if (team2Cards[pos] && team2Cards[pos].id === assisterId) {
                        team = team2Name;
                        playerName = team2Cards[pos].player_name;
                        break;
                    }
                }
            }

            if (team) {
                if (!playerName) {
                    playerName = ev.assisterAvatar ? `${ev.assisterAvatar}` : 'Jogador';
                }
                if (!statsByTeam[team][assisterId]) statsByTeam[team][assisterId] = { playerName, goals: 0, assists: 0 };
                statsByTeam[team][assisterId].assists++;
            }
        }
    }

    function formatStatsByTeam(statsByTeam) {
        let out = '';
        for (const [team, players] of Object.entries(statsByTeam)) {
            out += `\n${team}:`;
            const arr = Object.values(players).filter(p => (p.goals > 0 || p.assists > 0 || p.ownGoals > 0));
            if (arr.length === 0) {
                out += ' nenhum';
            } else {
                out += ` ⚽ Gols:`;
                const gols = arr.filter(x => x.goals > 0 || x.ownGoals > 0).map(p => {
                    let txt = '';
                    if (p.goals > 0) txt += `${p.playerName} (${p.goals})`;
                    if (p.ownGoals > 0) txt += `${p.playerName} (${p.ownGoals} contra)`;
                    return txt;
                }).filter(Boolean).join(', ');
                out += gols ? ` ${gols}` : ' nenhum';
                out += `\n   🅰️ Assistencia:`;
                const assists = arr.filter(x => x.assists > 0).map(p => `${p.playerName} (${p.assists})`).join(', ');
                out += assists ? ` ${assists}` : ' nenhum';
            }
        }
        return out.trim();
    }

    return { score: { team1: s1, team2: s2 }, winner, events, duration: durationStr, statsByTeam, formatStatsByTeam };
}

// Função para atualizar stats persistentes do time após a partida
const { updateTeamStats, getTeamByName } = require('../database/models/team');

/**
 * Atualiza stats persistentes do time após a partida.
 * Chame após simular a partida, passando os nomes dos times e statsByTeam.
 * @param {string} teamName Nome do time
 * @param {object} statsByTeam statsByTeam[teamName] do resultado da simulação
 * @param {object} matchResult { win, draw, loss, goalsFor, goalsAgainst, cleanSheet }
 */
async function updatePersistentTeamStats(teamName, statsByTeam, matchResult) {
    // Somar gols e assistências de todos os jogadores do time
    let goals = 0, assists = 0;
    if (statsByTeam && typeof statsByTeam === 'object') {
        for (const playerId in statsByTeam) {
            if (Object.prototype.hasOwnProperty.call(statsByTeam, playerId)) {
                goals += Number(statsByTeam[playerId].goals) || 0;
                assists += Number(statsByTeam[playerId].assists) || 0;
            }
        }
    }
    // Buscar o time pelo nome para obter o ID
    const team = await getTeamByName(teamName);
    if (!team || !team.id) {
        console.error('updatePersistentTeamStats: Time não encontrado para nome', teamName);
        return;
    }

    // Garantir que todos os campos são números (não undefined/null na lista de bindings)
    const safe = v => (typeof v === 'number' && !isNaN(v) ? v : 0);
    const goalsVal = safe(goals);
    const assistsVal = safe(assists);
    const cleanSheetInc = matchResult && matchResult.cleanSheet ? 1 : 0;
    const winsInc = matchResult && matchResult.win ? 1 : 0;
    const drawsInc = matchResult && matchResult.draw ? 1 : 0;
    const lossesInc = matchResult && matchResult.loss ? 1 : 0;
    const goalsForVal = safe(matchResult && matchResult.goalsFor);
    const goalsAgainstVal = safe(matchResult && matchResult.goalsAgainst);

    try {
        // detectar colunas existentes na tabela teams e montar update dinâmico
        const cols = await (async () => {
            const { query } = require('../database/connection');
            const rows = await query('SHOW COLUMNS FROM teams');
            return (rows || []).map(r => r.Field);
        })();

        const updates = [];
        const params = [];

        // sempre incrementar partidas/jogos via campos existentes
        if (cols.includes('matches_played')) {
            updates.push('matches_played = COALESCE(matches_played,0)+1');
        }
        if (cols.includes('wins')) { updates.push('wins = COALESCE(wins,0)+?'); params.push(winsInc); }
        if (cols.includes('losses')) { updates.push('losses = COALESCE(losses,0)+?'); params.push(lossesInc); }
        if (cols.includes('draws')) { updates.push('draws = COALESCE(draws,0)+?'); params.push(drawsInc); }

        // goals columns variations
        if (cols.includes('goals_scored') && cols.includes('goals_conceded')) {
            updates.push('goals_scored = COALESCE(goals_scored,0)+?'); params.push(goalsForVal);
            updates.push('goals_conceded = COALESCE(goals_conceded,0)+?'); params.push(goalsAgainstVal);
        } else if (cols.includes('goals_for') && cols.includes('goals_against')) {
            updates.push('goals_for = COALESCE(goals_for,0)+?'); params.push(goalsForVal);
            updates.push('goals_against = COALESCE(goals_against,0)+?'); params.push(goalsAgainstVal);
        } else if (cols.includes('goals') && cols.includes('goals_against')) {
            updates.push('goals = COALESCE(goals,0)+?'); params.push(goalsForVal);
            updates.push('goals_against = COALESCE(goals_against,0)+?'); params.push(goalsAgainstVal);
        }

        // assists
        if (cols.includes('assists')) { updates.push('assists = COALESCE(assists,0)+?'); params.push(assistsVal); }

        // clean sheets: garantir que ambos sejam incrementados se existirem
        if (cols.includes('clean_sheets')) {
            updates.push('clean_sheets = COALESCE(clean_sheets,0)+?'); params.push(cleanSheetInc);
        }
        if (cols.includes('cleanSheets')) {
            updates.push('cleanSheets = COALESCE(cleanSheets,0)+?'); params.push(cleanSheetInc);
        }

        if (updates.length === 0) {
            // nothing to update on teams table
            return;
        }

        const sql = `UPDATE teams SET ${updates.join(', ')} WHERE id = ?`;
        params.push(team.id);
        const { query } = require('../database/connection');
        await query(sql, params);
    } catch (e) {
        console.error('updatePersistentTeamStats - Erro ao atualizar estatísticas:', e);
    }
}

module.exports = { simulateMatch, simulateMatchRealtime, runMatchCore, MATCH_TUNING, calculateTeamOverall, updatePersistentTeamStats };
