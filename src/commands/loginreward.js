const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPlayerByDiscordId, updatePlayer, addPurpleCoins } = require('../database/models/player');
const { createCard } = require('../database/models/card');
const { query } = require('../database/connection');
const habilidades = require('../utils/habilidades');
const { generateUpgradeCard } = require('../utils/cardGenerator');
const { parseHabilidades } = require('../utils/habilidadeInventario');

const DAY_MS = 86400000;
const STREAK_RESET_MS = 172800000;
const CYCLE_DAYS = 7;

function normalizeRarityInput(raw) {
    if (!raw) return 'Bagre';
    const s = String(raw).toLowerCase();
    if (s === 'bagre' || s === 'normal' || s === 'common') return 'Bagre';
    if (s === 'medio' || s === 'médio' || s === 'raro' || s === 'rara' || s === 'purple') return 'Médio';
    if (s === 'goat') return 'GOAT';
    if (s === 'prime') return 'Prime';
    return 'Bagre';
}

async function incrementCardsObtained(discordId, amount = 1) {
    try {
        await query('UPDATE players SET cartas_obtidas = COALESCE(cartas_obtidas, 0) + ? WHERE discord_id = ?', [amount, discordId]);
    } catch (err) {
        console.error('[loginreward] falha ao atualizar cartas_obtidas:', err && err.message);
    }
}

async function insertRewardCard(discordId, rarity) {
    const requestedRarity = normalizeRarityInput(rarity);
    const cardData = await generateUpgradeCard(requestedRarity);
    if (!cardData || !cardData.template_id) {
        throw new Error('Nenhum template disponível para gerar a carta do login reward');
    }
    const safeCard = {
        discord_id: discordId,
        template_id: cardData.template_id,
        player_name: cardData.player_name || cardData.name || 'Sem nome',
        position: cardData.position || null,
        avatar: cardData.avatar || null,
        rarity: requestedRarity,
        overall_rating: cardData.overall,
        source: 'loginreward',
        rolarPrimeEspecial: true,
        stats: cardData.stats || {},
        colecao_id: cardData.colecao_id || null
    };
    const insertId = await createCard(safeCard);
    if (!insertId) throw new Error('Falha ao criar a carta do login reward');
    safeCard.id = insertId;
    safeCard.name = safeCard.player_name;
    return safeCard;
}

async function createUserCard(discordId, rarity) {
    const card = await insertRewardCard(discordId, rarity);
    await incrementCardsObtained(discordId, 1);
    return card;
}

const PACK_PROBABILITIES = {
    normal: { bagre: 0.70, medio: 0.25, goat: 0.045, prime: 0.005 },
    super: { bagre: 0.35, medio: 0.30, goat: 0.25, prime: 0.10 },
    purple: { bagre: 0.15, medio: 0.30, goat: 0.40, prime: 0.15 },
    superpurple: { medio: 0.30, goat: 0.35, prime: 0.35 },
    purplesupremo: { goat: 0.5, prime: 0.5 }
};

function mapPackKey(k) {
    if (!k) return 'normal';
    const s = String(k).toLowerCase();
    if (s.includes('normal')) return 'normal';
    if (s.includes('superpurple') || s.includes('super purple')) return 'superpurple';
    if (s.includes('purplesupremo') || s.includes('supremo')) return 'purplesupremo';
    if (s.includes('purple') || s.includes('rara') || s.includes('raro')) return 'purple';
    if (s.includes('super')) return 'super';
    return 'normal';
}

function pickRarityFromProb(probObj) {
    const entries = Object.entries(probObj);
    const total = entries.reduce((sum, [, chance]) => sum + chance, 0);
    let roll = Math.random() * total;
    for (const [key, chance] of entries) {
        roll -= chance;
        if (roll < 0) return normalizeRarityInput(key);
    }
    return normalizeRarityInput(entries[entries.length - 1][0]);
}

async function createUserPack(discordId, packType, qtd = 3) {
    const probObj = PACK_PROBABILITIES[mapPackKey(packType)] || PACK_PROBABILITIES.normal;
    const cards = [];
    for (let i = 0; i < qtd; i++) {
        cards.push(await insertRewardCard(discordId, pickRarityFromProb(probObj)));
    }
    await incrementCardsObtained(discordId, cards.length);
    return cards;
}

function formatCooldown(lastLogin, now) {
    const nextClaim = lastLogin + DAY_MS;
    const msLeft = Math.max(0, nextClaim - now);
    const hours = Math.floor(msLeft / 3600000);
    const minutes = Math.floor((msLeft % 3600000) / 60000);
    const seconds = Math.floor((msLeft % 60000) / 1000);
    const pad = n => n.toString().padStart(2, '0');
    return `⏳ Você já resgatou sua recompensa de login!\nPróxima disponível em: **${pad(hours)}:${pad(minutes)}:${pad(seconds)}**\nÚltimo login: <t:${Math.floor(lastLogin / 1000)}:F>\nPróximo: <t:${Math.floor(nextClaim / 1000)}:R>`;
}

async function announce(interaction, embed) {
    try {
        if (interaction.channel && interaction.channel.send) {
            await interaction.channel.send({ embeds: [embed] });
            return;
        }
        await interaction.followUp({ embeds: [embed], ephemeral: false });
    } catch (err) {
        console.warn('[loginreward] falha ao anunciar no canal, usando followUp:', err && err.message);
        try { await interaction.followUp({ embeds: [embed], ephemeral: false }); } catch (e) { console.warn('[loginreward] followUp também falhou:', e && e.message); }
    }
}

function packEmbed(title, color, cards) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(cards.map((c, idx) => {
            const rarityText = (c.rarity && c.rarity.rarity) || c.rarity || 'Desconhecida';
            return `Carta ${idx + 1}: **${c.player_name || c.name || 'Sem nome'}** | Raridade: ${rarityText} | Overall: ${c.overall_rating}`;
        }).join('\n'))
        .setColor(color);
}

function cardEmbed(title, color, card, rarityLabel) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(`Nome: **${card.player_name || card.name || 'Sem nome'}**\nRaridade: ${rarityLabel}\nOverall: ${card.overall_rating}`)
        .setColor(color);
}

async function grantReward(interaction, player, streak) {
    const discordId = interaction.user.id;
    if (streak === 1) {
        await addPurpleCoins(discordId, 200, { itemType: 'loginreward', itemName: 'Login reward dia 1' });
        return 'Você ganhou **200 Purple Coins**!';
    }
    if (streak === 2) {
        const cards = await createUserPack(discordId, 'Normal', 3);
        await announce(interaction, packEmbed('🎁 Pacote Normal Aberto!', '#FFD700', cards));
        return 'Você ganhou um **Pacote Normal** (aberto automaticamente)!';
    }
    if (streak === 3) {
        const traitList = Object.keys(habilidades.GK).concat(Object.keys(habilidades.VL), Object.keys(habilidades.PV));
        const trait = traitList[Math.floor(Math.random() * traitList.length)];
        const owned = parseHabilidades(player);
        await updatePlayer(discordId, { habilidades: JSON.stringify([...owned, trait]) });
        return `Você ganhou uma **Trait/Habilidade grátis**: ${trait}`;
    }
    if (streak === 4) {
        const card = await createUserCard(discordId, 'GOAT');
        await announce(interaction, cardEmbed('🃏 Carta GOAT Recebida!', '#9D4EDD', card, 'GOAT'));
        return 'Você ganhou uma **Carta GOAT**!';
    }
    if (streak === 5) {
        await addPurpleCoins(discordId, 800, { itemType: 'loginreward', itemName: 'Login reward dia 5' });
        return 'Você ganhou **800 Purple Coins**!';
    }
    if (streak === 6) {
        const cards = await createUserPack(discordId, 'Rara', 3);
        await announce(interaction, packEmbed('🎁 Pacote Purple Aberto!', '#9D4EDD', cards));
        return 'Você ganhou um **Pacote Purple** (aberto automaticamente)!';
    }
    const card = await createUserCard(discordId, 'Prime');
    await announce(interaction, cardEmbed('🃏 Carta PRIME Recebida!', '#FFD700', card, 'PRIME'));
    return 'Você ganhou uma **Carta PRIME**!';
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loginreward')
        .setDescription('Resgate sua recompensa diária de login (7 dias de prêmios).'),
    async execute(interaction) {
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
            }
        } catch (e) {
            console.warn('[loginreward] deferReply falhou (ignorado):', e && e.message);
        }

        const safeRespond = async (response) => {
            const payload = typeof response === 'string' ? { content: response } : response;
            try {
                if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
                else await interaction.reply({ ...payload, ephemeral: true });
            } catch (err) {
                try { await interaction.followUp({ ...payload, ephemeral: true }); } catch (err2) { console.warn('[loginreward] safeRespond falhou:', err2 && err2.message); }
            }
        };

        if (!global.__loginRewardLocks) global.__loginRewardLocks = new Set();
        const discordId = interaction.user.id;
        if (global.__loginRewardLocks.has(discordId)) {
            await safeRespond('Já estamos processando seu resgate, aguarde alguns segundos.');
            return;
        }
        global.__loginRewardLocks.add(discordId);

        try {
            const player = await getPlayerByDiscordId(discordId);
            if (!player) {
                await safeRespond('Você precisa registrar seu time antes!');
                return;
            }

            const now = Date.now();
            const lastLogin = player.last_login_reward ? new Date(player.last_login_reward).getTime() : null;
            if (lastLogin && now >= lastLogin && (now - lastLogin) < DAY_MS) {
                await safeRespond(formatCooldown(lastLogin, now));
                return;
            }

            const previousStreak = Number(player.login_streak) || 0;
            let streak = previousStreak;
            if (lastLogin && (now - lastLogin) > STREAK_RESET_MS) streak = 0;
            streak++;
            if (streak > CYCLE_DAYS) streak = 1;

            await updatePlayer(discordId, {
                login_streak: streak === CYCLE_DAYS ? 0 : streak,
                last_login_reward: new Date(now).toISOString(),
                login_reward_locked: true
            });

            let rewardText;
            try {
                rewardText = await grantReward(interaction, player, streak);
            } catch (err) {
                console.error('[loginreward] falha ao entregar a recompensa, revertendo:', err && err.message);
                try {
                    await updatePlayer(discordId, {
                        login_streak: previousStreak,
                        last_login_reward: lastLogin ? new Date(lastLogin).toISOString() : null,
                        login_reward_locked: false
                    });
                } catch (revertErr) {
                    console.error('[loginreward] falha ao reverter o resgate:', revertErr && revertErr.message);
                }
                await safeRespond('❌ Não foi possível entregar a recompensa agora. Seu resgate não foi consumido, tente novamente em instantes.');
                return;
            }

            const msg = `🎉 Parabéns <@${discordId}>, Dia ${streak} de login!\n${rewardText}\nVolte daqui a 24h para a próxima recompensa!`;
            await safeRespond('Recompensa resgatada!');
            try {
                await interaction.followUp({ content: msg, ephemeral: false });
            } catch (e) {
                console.warn('[loginreward] followUp final falhou:', e && e.message);
                await safeRespond(msg);
            }
        } finally {
            global.__loginRewardLocks.delete(discordId);
        }
    }
};

module.exports.createUserCard = createUserCard;
module.exports.createUserPack = createUserPack;
