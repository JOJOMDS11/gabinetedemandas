const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { query, pool } = require('../database/connection');
const { getCardById } = require('../database/models/card');
const { getConfig } = require('../utils/guildConfig');
const { createCardsAttachment } = require('../utils/cardImage');

const leiloes = new Map();
const timers = new Map();
const LEILAO_DURACAO_MIN_MINUTOS = 30;
const LEILAO_DURACAO_MAX_MINUTOS = 300;
const LEILAO_DURACAO_PADRAO_MINUTOS = 60;
const LEILAO_TAXA = 0.05;
const LEILAO_ANTI_SNIPE_MS = 2 * 60 * 1000;
const LEILAO_RETRY_MS = 60 * 1000;
let schemaReady = null;

function formatarDuracao(minutos) {
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    if (horas === 0) return `${resto}min`;
    return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, '0')}min`;
}

async function ensureAuctionSchema() {
    if (!schemaReady) {
        schemaReady = (async () => {
            await query(`
                CREATE TABLE IF NOT EXISTS card_auctions (
                    auction_id VARCHAR(64) PRIMARY KEY,
                    card_id BIGINT NOT NULL,
                    seller_discord_id VARCHAR(32) NOT NULL,
                    seller_tag VARCHAR(255),
                    starting_bid INTEGER NOT NULL CHECK (starting_bid >= 500),
                    current_bid INTEGER NOT NULL,
                    highest_bidder_id VARCHAR(32),
                    highest_bidder_tag VARCHAR(255),
                    ends_at TIMESTAMPTZ NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'active',
                    guild_id VARCHAR(32),
                    channel_id VARCHAR(32),
                    message_id VARCHAR(32),
                    card_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                    image_url TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);
            await query(`CREATE INDEX IF NOT EXISTS idx_card_auctions_active_ends ON card_auctions (status, ends_at)`);
            await query(`CREATE INDEX IF NOT EXISTS idx_card_auctions_card_status ON card_auctions (card_id, status)`);
            await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_card_auctions_one_active_card ON card_auctions (card_id) WHERE status = 'active'`);
            const auctionColumns = [
                `ALTER TABLE card_auctions ADD COLUMN IF NOT EXISTS seller_tag VARCHAR(255)`,
                `ALTER TABLE card_auctions ADD COLUMN IF NOT EXISTS highest_bidder_id VARCHAR(32)`,
                `ALTER TABLE card_auctions ADD COLUMN IF NOT EXISTS highest_bidder_tag VARCHAR(255)`,
                `ALTER TABLE card_auctions ADD COLUMN IF NOT EXISTS guild_id VARCHAR(32)`,
                `ALTER TABLE card_auctions ADD COLUMN IF NOT EXISTS channel_id VARCHAR(32)`,
                `ALTER TABLE card_auctions ADD COLUMN IF NOT EXISTS message_id VARCHAR(32)`,
                `ALTER TABLE card_auctions ADD COLUMN IF NOT EXISTS card_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb`,
                `ALTER TABLE card_auctions ADD COLUMN IF NOT EXISTS image_url TEXT`,
                `ALTER TABLE card_auctions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
                `ALTER TABLE card_auctions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
            ];
            for (const statement of auctionColumns) await query(statement);
        })().catch(error => { schemaReady = null; throw error; });
    }
    return schemaReady;
}

function parseJson(value, fallback = {}) {
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(value || '{}'); } catch (_) { return fallback; }
}

function mapRowToAuction(row, client) {
    const snapshot = parseJson(row.card_snapshot, {});
    const endsAt = new Date(row.ends_at).getTime();
    const highBid = row.highest_bidder_id ? {
        userId: String(row.highest_bidder_id),
        userTag: row.highest_bidder_tag || 'Jogador',
        valor: Number(row.current_bid) || 0
    } : null;
    return {
        id: String(row.auction_id),
        cardId: Number(row.card_id),
        carta: snapshot,
        vendedorId: String(row.seller_discord_id),
        vendedorTag: row.seller_tag || 'Vendedor',
        valorInicial: Number(row.starting_bid) || 500,
        valorAtual: Number(row.current_bid) || Number(row.starting_bid) || 500,
        lanceAtual: highBid,
        compradorId: highBid?.userId || null,
        compradorTag: highBid?.userTag || null,
        encerraEm: endsAt,
        channelId: row.channel_id,
        guildId: row.guild_id,
        messageId: row.message_id,
        imageUrl: row.image_url || null,
        client,
        status: row.status
    };
}

function montarEmbed(leilao, stateText = null) {
    const card = leilao.carta || {};
    const stats = card.stats || {};
    const pos = String(card.position || '').toUpperCase();
    const lines = [
        `**Jogador:** ${card.player_name || 'Carta'}`,
        `**Posição:** ${pos} | **Overall:** ⭐ ${card.overall_rating || 0}`,
        `**Raridade:** 💎 ${card.rarity || 'Bagre'}`,
        '',
        '📊 **Atributos:**',
        `DEF ${stats.defesa ?? card.defesa ?? 0} · DRI ${stats.drible ?? card.drible ?? 0} · PAS ${stats.passe ?? card.passe ?? 0} · FIN ${stats.finalizacao ?? card.finalizacao ?? 0}`,
        `POS ${stats.posicionamento ?? card.posicionamento ?? 0} · SAI ${stats.saidaDeBola ?? card.saidaDeBola ?? 0}`,
        ''
    ];
    if (card.habilidade_nome) lines.push(`⚡ **Habilidade:** ${card.habilidade_nome}${card.habilidade_descricao ? ` — ${card.habilidade_descricao}` : ''}`, '');
    if (card.colecao_nome) lines.push(`🎁 **Coleção:** ${card.colecao_nome}`, '');
    lines.push(
        `💰 **Lance atual:** ${leilao.valorAtual.toLocaleString('pt-BR')} PC`,
        `👤 **Vendedor:** <@${leilao.vendedorId}>`,
        `🏆 **Maior lance:** ${leilao.lanceAtual ? `<@${leilao.lanceAtual.userId}> (${leilao.lanceAtual.valor.toLocaleString('pt-BR')} PC)` : 'Nenhum lance ainda'}`,
        `⏱️ **Duração:** ${formatarDuracao(Math.max(0, Math.ceil((leilao.encerraEm - (Date.now() - 0)) / 60000)))}`,
        `⏰ **Encerra:** <t:${Math.floor(leilao.encerraEm / 1000)}:R>`,
        `🏛️ **Taxa do mercado:** ${Math.round(LEILAO_TAXA * 100)}% sobre o valor final da venda`,
        `🛡️ **Anti-snipe:** lance nos últimos 2 min estende o leilão para 2 min a partir do lance`
    );
    if (stateText) lines.push('', stateText);
    const embed = new EmbedBuilder()
        .setTitle('🔨 Leilão de Carta')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setColor(stateText ? 0x64748B : 0xFFD700)
        .setFooter({ text: `Carta #${leilao.cardId} | Leilão ${leilao.id} | Próximo lance: ${leilao.valorAtual + 100} PC` })
        .setTimestamp(new Date(leilao.encerraEm));
    if (leilao.imageUrl) embed.setImage(leilao.imageUrl);
    return embed;
}

function montarBotoes(leilao, active = true) {
    if (!active) return [];
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`leilao_lance_${leilao.id}`).setLabel('Fazer Lance').setStyle(ButtonStyle.Primary).setEmoji('💰'),
        new ButtonBuilder().setCustomId(`leilao_cancelar_${leilao.id}`).setLabel('Cancelar Leilão').setStyle(ButtonStyle.Danger).setEmoji('❌')
    )];
}

async function atualizarMensagem(leilao, stateText = null, active = true) {
    if (!leilao?.client || !leilao.channelId || !leilao.messageId) return false;
    try {
        const channel = await leilao.client.channels.fetch(leilao.channelId);
        if (!channel?.isTextBased()) return false;
        const message = await channel.messages.fetch(leilao.messageId);
        await message.edit({ embeds: [montarEmbed(leilao, stateText)], components: montarBotoes(leilao, active) });
        return true;
    } catch (error) {
        console.warn(`[leilao] Não foi possível atualizar a mensagem ${leilao.id}:`, error.message);
        return false;
    }
}

function clearAuctionTimer(auctionId) {
    const timer = timers.get(String(auctionId));
    if (timer) clearTimeout(timer);
    timers.delete(String(auctionId));
}

function scheduleAuctionClose(auction) {
    clearAuctionTimer(auction.id);
    const delay = Math.max(0, auction.encerraEm - Date.now());
    const run = () => {
        encerrarLeilao(auction.id).catch(error => {
            console.error(`[leilao] Falha ao encerrar ${auction.id}, nova tentativa em 60s:`, error.message);
            const retry = setTimeout(run, LEILAO_RETRY_MS);
            if (retry.unref) retry.unref();
            timers.set(String(auction.id), retry);
        });
    };
    const timer = setTimeout(run, Math.min(delay, 2147480000));
    if (timer.unref) timer.unref();
    timers.set(String(auction.id), timer);
}

async function inicializarLeiloes(client) {
    await ensureAuctionSchema();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    leiloes.clear();
    const rows = await query(`SELECT * FROM card_auctions WHERE status = 'active' ORDER BY ends_at ASC`);
    for (const row of rows) {
        const auction = mapRowToAuction(row, client);
        leiloes.set(auction.id, auction);
        if (!auction.messageId || !auction.channelId) {
            console.warn(`[leilao] Leilão ${auction.id} ativo sem mensagem; será encerrado sem lance se não tiver sido finalizado.`);
        }
        scheduleAuctionClose(auction);
    }
    console.log(`🔨 ${rows.length} leilão(ões) ativo(s) restaurado(s) do PostgreSQL.`);
    return rows.length;
}

async function salvarMensagem(auctionId, channelId, messageId, imageUrl = null) {
    await query(`
        UPDATE card_auctions SET channel_id = ?, message_id = ?, image_url = ?, updated_at = NOW()
        WHERE auction_id = ? AND status = 'active'
    `, [channelId, messageId, imageUrl, String(auctionId)]);
    const auction = leiloes.get(String(auctionId));
    if (auction) {
        auction.channelId = channelId;
        auction.messageId = messageId;
        auction.imageUrl = imageUrl;
    }
}

async function notificarLanceCoberto(auction, notice) {
    if (!auction?.client || !notice?.previousBidderId) return false;
    const nomeCarta = auction.carta?.player_name || `carta #${auction.cardId}`;
    const link = auction.guildId && auction.channelId && auction.messageId
        ? `\n🔗 https://discord.com/channels/${auction.guildId}/${auction.channelId}/${auction.messageId}`
        : '';
    const texto =
        `seu lance de **${notice.previousBid.toLocaleString('pt-BR')} PC** ` +
        `em **${nomeCarta}** (#${auction.cardId}) foi coberto por um novo lance de ` +
        `**${notice.newBid.toLocaleString('pt-BR')} PC**.\n` +
        `💜 Os **${notice.previousBid.toLocaleString('pt-BR')} PC** reservados foram devolvidos ao seu saldo.`;
    try {
        const user = await auction.client.users.fetch(String(notice.previousBidderId));
        await user.send({ content: `🔔 ${texto}${link}` });
        return true;
    } catch (error) {
        console.warn('[leilao] DM de lance coberto falhou, avisando no canal:', error.message);
    }
    if (!auction.channelId) return false;
    try {
        const channel = await auction.client.channels.fetch(auction.channelId);
        if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return false;
        await channel.send({
            content: `🔔 <@${notice.previousBidderId}>, ${texto}`,
            allowedMentions: { users: [String(notice.previousBidderId)] }
        });
        return true;
    } catch (error) {
        console.warn('[leilao] Não foi possível avisar o lance coberto:', error.message);
        return false;
    }
}

async function registrarLance(auctionId, bidderId, bidderTag, bidAmount, client = null) {
    await ensureAuctionSchema();
    const conn = await pool.getConnection();
    let updatedAuction = null;
    let outbidNotice = null;
    let newEndsAt = null;
    try {
        await conn.beginTransaction();
        const [auctionRows] = await conn.query(`SELECT * FROM card_auctions WHERE auction_id = ? FOR UPDATE`, [String(auctionId)]);
        const row = auctionRows?.[0];
        if (!row || row.status !== 'active') throw new Error('Este leilão não está mais ativo.');
        if (new Date(row.ends_at).getTime() <= Date.now()) throw new Error('Este leilão já encerrou.');
        if (String(row.seller_discord_id) === String(bidderId)) throw new Error('Você não pode dar lance na sua própria carta.');
        const currentBid = Number(row.current_bid) || Number(row.starting_bid) || 0;
        if (!Number.isInteger(Number(bidAmount)) || Number(bidAmount) < currentBid + 100) {
            throw new Error(`O lance mínimo agora é ${(currentBid + 100).toLocaleString('pt-BR')} PC.`);
        }

        const endsMs = new Date(row.ends_at).getTime();
        if (endsMs - Date.now() <= LEILAO_ANTI_SNIPE_MS) newEndsAt = new Date(Date.now() + LEILAO_ANTI_SNIPE_MS);

        const previousBidderId = row.highest_bidder_id ? String(row.highest_bidder_id) : null;
        const lockIds = [...new Set([String(bidderId), ...(previousBidderId ? [previousBidderId] : [])])].sort();
        const players = new Map();
        for (const id of lockIds) {
            const [playerRows] = await conn.query(`SELECT discord_id, purple_coins, username, name FROM players WHERE discord_id = ? FOR UPDATE`, [id]);
            if (!playerRows?.[0]) throw new Error(`Jogador ${id === String(bidderId) ? 'que está dando o lance' : 'do lance anterior'} não encontrado.`);
            players.set(id, playerRows[0]);
        }
        const newBidder = players.get(String(bidderId));
        const oldBidder = previousBidderId ? players.get(previousBidderId) : null;
        const newBalanceBefore = Number(newBidder.purple_coins) || 0;
        const sameBidder = previousBidderId === String(bidderId);
        const amountToHold = sameBidder ? Number(bidAmount) - currentBid : Number(bidAmount);
        if (newBalanceBefore < amountToHold) throw new Error(`Saldo insuficiente. Você tem ${newBalanceBefore.toLocaleString('pt-BR')} PC disponíveis; precisa de ${amountToHold.toLocaleString('pt-BR')} PC adicionais.`);

        const newBalanceAfter = newBalanceBefore - amountToHold;
        await conn.query(`UPDATE players SET purple_coins = ?, updated_at = NOW() WHERE discord_id = ?`, [newBalanceAfter, bidderId]);
        await conn.query(`
            INSERT INTO player_transactions (discord_user_id, discord_username, transaction_type, item_type, item_name, amount, balance_before, balance_after, metadata)
            VALUES (?, ?, 'LOSS', 'leilao_escrow', ?, ?, ?, ?, ?) RETURNING id
        `, [bidderId, bidderTag, `Reserva de lance no leilão ${auctionId}`, -amountToHold, newBalanceBefore, newBalanceAfter, JSON.stringify({ auctionId, cardId: Number(row.card_id), bid: Number(bidAmount), action: 'hold' })]);

        if (previousBidderId && !sameBidder) {
            const oldBalanceBefore = Number(oldBidder.purple_coins) || 0;
            const oldBalanceAfter = oldBalanceBefore + currentBid;
            await conn.query(`UPDATE players SET purple_coins = ?, updated_at = NOW() WHERE discord_id = ?`, [oldBalanceAfter, previousBidderId]);
            await conn.query(`
                INSERT INTO player_transactions (discord_user_id, discord_username, transaction_type, item_type, item_name, amount, balance_before, balance_after, metadata)
                VALUES (?, ?, 'GAIN', 'leilao_escrow_refund', ?, ?, ?, ?, ?) RETURNING id
            `, [previousBidderId, oldBidder.username || oldBidder.name || row.highest_bidder_tag, `Lance superado no leilão ${auctionId}`, currentBid, oldBalanceBefore, oldBalanceAfter, JSON.stringify({ auctionId, cardId: Number(row.card_id), action: 'refund_outbid' })]);
            outbidNotice = {
                previousBidderId,
                previousBid: currentBid,
                newBid: Number(bidAmount)
            };
        }

        await conn.query(`
            UPDATE card_auctions
            SET current_bid = ?, highest_bidder_id = ?, highest_bidder_tag = ?, ends_at = COALESCE(?::timestamptz, ends_at), updated_at = NOW()
            WHERE auction_id = ?
        `, [Number(bidAmount), bidderId, bidderTag, newEndsAt ? newEndsAt.toISOString() : null, String(auctionId)]);
        await conn.commit();

        updatedAuction = leiloes.get(String(auctionId));
        if (updatedAuction) {
            updatedAuction.valorAtual = Number(bidAmount);
            updatedAuction.lanceAtual = { userId: String(bidderId), userTag: bidderTag, valor: Number(bidAmount) };
            updatedAuction.compradorId = String(bidderId);
            updatedAuction.compradorTag = bidderTag;
        } else {
            const [freshRows] = await pool.query(`SELECT * FROM card_auctions WHERE auction_id = ?`, [String(auctionId)]);
            if (freshRows?.[0]) {
                updatedAuction = mapRowToAuction(freshRows[0], null);
                leiloes.set(updatedAuction.id, updatedAuction);
            }
        }
    } catch (error) {
        try { await conn.rollback(); } catch (_) { }
        throw error;
    } finally {
        conn.release();
    }

    if (updatedAuction && newEndsAt) {
        updatedAuction.encerraEm = newEndsAt.getTime();
        scheduleAuctionClose(updatedAuction);
    }
    if (updatedAuction) {
        if (client) updatedAuction.client = client;
        await atualizarMensagem(updatedAuction);
        if (outbidNotice) await notificarLanceCoberto(updatedAuction, outbidNotice);
    }
    return { success: true, auction: updatedAuction, message: `✅ Lance de **${Number(bidAmount).toLocaleString('pt-BR')} PC** registrado. Esse valor fica reservado até você ser superado ou o leilão terminar.${newEndsAt ? ' O leilão foi estendido por causa do lance no final.' : ''}` };
}

async function finalizarPersistido(auctionId, client) {
    await ensureAuctionSchema();
    const conn = await pool.getConnection();
    let outcome = null;
    try {
        await conn.beginTransaction();
        const [auctionRows] = await conn.query(`SELECT * FROM card_auctions WHERE auction_id = ? FOR UPDATE`, [String(auctionId)]);
        const row = auctionRows?.[0];
        if (!row || row.status !== 'active') {
            await conn.commit();
            return null;
        }
        const endMs = new Date(row.ends_at).getTime();
        if (endMs > Date.now()) {
            await conn.commit();
            const existing = leiloes.get(String(auctionId));
            if (existing) scheduleAuctionClose(existing);
            return null;
        }

        const sellerId = String(row.seller_discord_id);
        const winnerId = row.highest_bidder_id ? String(row.highest_bidder_id) : null;
        const bid = Number(row.current_bid) || Number(row.starting_bid) || 0;
        const participantIds = [...new Set([sellerId, ...(winnerId ? [winnerId] : [])])].sort();
        const participantRows = new Map();
        for (const participantId of participantIds) {
            const [lockedRows] = await conn.query(
                `SELECT discord_id, purple_coins, username, name FROM players WHERE discord_id = ? FOR UPDATE`,
                [participantId]
            );
            participantRows.set(participantId, lockedRows?.[0] || null);
        }
        const seller = participantRows.get(sellerId) || null;

        if (!winnerId) {
            await conn.query(`UPDATE card_auctions SET status = 'closed', updated_at = NOW() WHERE auction_id = ?`, [String(auctionId)]);
            outcome = { type: 'no_bids', row };
        } else {
            const winner = participantRows.get(winnerId) || null;
            const [cardRows] = await conn.query(`SELECT id, discord_id FROM user_cards WHERE id = ? FOR UPDATE`, [Number(row.card_id)]);
            const card = cardRows?.[0] || null;
            const [teamRows] = await conn.query(
                `SELECT id FROM teams WHERE gk_card_id = ? OR vl_card_id = ? OR pv_card_id = ? LIMIT 1`,
                [Number(row.card_id), Number(row.card_id), Number(row.card_id)]
            );
            if (!seller || !winner || !card || String(card.discord_id) !== sellerId || teamRows?.length) {
                if (winner) {
                    const before = Number(winner.purple_coins) || 0;
                    const after = before + bid;
                    await conn.query(`UPDATE players SET purple_coins = ?, updated_at = NOW() WHERE discord_id = ?`, [after, winnerId]);
                    await conn.query(`INSERT INTO player_transactions (discord_user_id, discord_username, transaction_type, item_type, item_name, amount, balance_before, balance_after, metadata) VALUES (?, ?, 'GAIN', 'leilao_escrow_refund', ?, ?, ?, ?, ?) RETURNING id`, [winnerId, winner.username || winner.name || row.highest_bidder_tag, `Reembolso do leilão ${auctionId}`, bid, before, after, JSON.stringify({ auctionId, cardId: Number(row.card_id), action: 'refund_cancelled' })]);
                }
                await conn.query(`UPDATE card_auctions SET status = 'cancelled', updated_at = NOW() WHERE auction_id = ?`, [String(auctionId)]);
                outcome = { type: 'cancelled_refunded', row, winnerId, bid };
            } else {
                // Libera a carta para transferência dentro desta transação; em caso de erro, o rollback restaura o leilão ativo.
                await conn.query(`UPDATE card_auctions SET status = 'closed', updated_at = NOW() WHERE auction_id = ? AND status = 'active'`, [String(auctionId)]);
                const transfer = await conn.query(`UPDATE user_cards SET discord_id = ?, updated_at = NOW() WHERE id = ? AND discord_id = ?`, [winnerId, Number(row.card_id), sellerId]);
                if (!transfer[0]?.affectedRows) throw new Error('Não foi possível transferir a carta para o vencedor.');
                const fee = Math.floor(bid * LEILAO_TAXA);
                const net = bid - fee;
                const sellerBefore = Number(seller.purple_coins) || 0;
                const sellerAfter = sellerBefore + net;
                await conn.query(`UPDATE players SET purple_coins = ?, updated_at = NOW() WHERE discord_id = ?`, [sellerAfter, sellerId]);
                await conn.query(`
                    INSERT INTO player_transactions (discord_user_id, discord_username, transaction_type, item_type, item_name, amount, balance_before, balance_after, metadata)
                    VALUES (?, ?, 'GAIN', 'leilao_venda', ?, ?, ?, ?, ?) RETURNING id
                `, [sellerId, seller.username || seller.name || row.seller_tag, `Venda da carta #${row.card_id} no leilão ${auctionId}`, net, sellerBefore, sellerAfter, JSON.stringify({ auctionId, cardId: Number(row.card_id), winnerId, bid, fee, net, action: 'seller_paid' })]);
                await conn.query(`UPDATE card_auctions SET status = 'closed', updated_at = NOW() WHERE auction_id = ?`, [String(auctionId)]);
                outcome = { type: 'sold', row, winnerId, bid, sellerId, fee, net };
            }
        }
        await conn.commit();
    } catch (error) {
        try { await conn.rollback(); } catch (_) { }
        console.error(`[leilao] Falha ao encerrar ${auctionId}:`, error.message);
        throw error;
    } finally {
        conn.release();
    }

    let auction = leiloes.get(String(auctionId));
    if (!auction && outcome?.row) auction = mapRowToAuction(outcome.row, client || null);
    if (auction) {
        auction.client = client || auction.client;
        leiloes.delete(String(auctionId));
        clearAuctionTimer(auctionId);
        if (outcome?.type === 'no_bids') await atualizarMensagem(auction, `❌ Encerrado sem lances. A carta permanece com <@${auction.vendedorId}>.`, false);
        else if (outcome?.type === 'sold') {
            try { await require('../utils/primeEspecial').acompanharTransferencia(auction.cardId, outcome.winnerId); } catch (error) { console.warn('[leilao] Não foi possível atualizar vínculo de carta Prime:', error.message); }
            await atualizarMensagem(auction, `✅ **Leilão concluído!**\nVencedor: <@${outcome.winnerId}>\nLance vencedor: **${outcome.bid.toLocaleString('pt-BR')} PC** · taxa do mercado: **${outcome.fee.toLocaleString('pt-BR')} PC** · pago ao vendedor: **${outcome.net.toLocaleString('pt-BR')} PC**.`, false);
        } else if (outcome?.type === 'cancelled_refunded') {
            await atualizarMensagem(auction, `⚠️ Leilão cancelado por inconsistência na posse da carta. O lance reservado foi devolvido a <@${outcome.winnerId}>.`, false);
        }
    }
    return outcome;
}

async function encerrarLeilao(auctionId) {
    return finalizarPersistido(auctionId, leiloes.get(String(auctionId))?.client || null);
}

async function cancelarLeilao(leilaoId, userId) {
    await ensureAuctionSchema();
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.query(`SELECT * FROM card_auctions WHERE auction_id = ? FOR UPDATE`, [String(leilaoId)]);
        const row = rows?.[0];
        if (!row || row.status !== 'active') throw new Error('Leilão não encontrado ou já encerrado.');
        if (String(row.seller_discord_id) !== String(userId)) throw new Error('Apenas o vendedor pode cancelar o leilão.');
        if (row.highest_bidder_id) throw new Error('Não é possível cancelar um leilão com lances.');
        await conn.query(`UPDATE card_auctions SET status = 'cancelled', updated_at = NOW() WHERE auction_id = ?`, [String(leilaoId)]);
        await conn.commit();
        const auction = leiloes.get(String(leilaoId));
        leiloes.delete(String(leilaoId));
        clearAuctionTimer(leilaoId);
        return { success: true, message: 'Leilão cancelado com sucesso.', auction };
    } catch (error) {
        try { await conn.rollback(); } catch (_) { }
        return { success: false, message: error.message };
    } finally {
        conn.release();
    }
}

function getLeilaoAtivo(leilaoId) {
    return leiloes.get(String(leilaoId)) || null;
}

function cartaEmLeilao(cardId) {
    return Array.from(leiloes.values()).some(item => Number(item.cardId) === Number(cardId) && item.status === 'active');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leilao')
        .setDescription('Criar leilão de carta com lances reservados no saldo.')
        .addIntegerOption(option => option.setName('carta').setDescription('ID da carta a leiloar').setRequired(true))
        .addIntegerOption(option => option.setName('valorinicial').setDescription('Valor inicial (mínimo 500 Purple Coins)').setRequired(true))
        .addIntegerOption(option => option.setName('duracao').setDescription('Duração em minutos (30 a 300). Padrão: 60 (1h)').setMinValue(LEILAO_DURACAO_MIN_MINUTOS).setMaxValue(LEILAO_DURACAO_MAX_MINUTOS).setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();
        let auctionId = String(interaction.id);
        try {
            await ensureAuctionSchema();
            const cardId = interaction.options.getInteger('carta');
            const startingBid = interaction.options.getInteger('valorinicial');
            const duration = interaction.options.getInteger('duracao') || LEILAO_DURACAO_PADRAO_MINUTOS;
            if (startingBid < 500) return interaction.editReply('❌ O valor inicial mínimo é 500 PC.');
            if (duration < LEILAO_DURACAO_MIN_MINUTOS || duration > LEILAO_DURACAO_MAX_MINUTOS) return interaction.editReply('❌ A duração deve ser de 30 a 300 minutos.');

            const card = await getCardById(cardId, interaction.user.id);
            if (!card) return interaction.editReply('❌ Carta não encontrada ou não pertence a você.');
            if (!card.negociavel) return interaction.editReply('❌ Esta carta não pode ser leiloada.');
            if (cartaEmLeilao(cardId)) return interaction.editReply('❌ Esta carta já está em um leilão ativo.');

            let targetChannel = interaction.channel;
            try {
                const channelId = await getConfig(interaction.guildId, 'canal_leilao');
                if (channelId) {
                    const configured = await interaction.client.channels.fetch(channelId).catch(() => null);
                    if (configured?.isTextBased()) targetChannel = configured;
                }
            } catch (error) { console.warn('[leilao] Não foi possível obter canal configurado:', error.message); }

            const endsAt = new Date(Date.now() + duration * 60 * 1000);
            let auctionCard = card;
            let snapshot = null;
            let auction = null;
            // Trava a carta e cria o anúncio na mesma transação. Isso serializa o anúncio
            // com rerolls, vendas e transferências concorrentes da mesma carta.
            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();
                const [lockedCards] = await conn.query(
                    `SELECT id, discord_id, negociavel FROM user_cards WHERE id = ? FOR UPDATE`,
                    [cardId]
                );
                const lockedCard = lockedCards?.[0];
                if (!lockedCard || String(lockedCard.discord_id) !== String(interaction.user.id)) {
                    throw new Error('A carta não pertence mais a você. Atualize sua coleção.');
                }
                if (!lockedCard.negociavel) throw new Error('Esta carta não pode ser leiloada.');
                // Releitura após obter o lock: o snapshot reflete o último reroll/atributos confirmados.
                auctionCard = await getCardById(cardId, interaction.user.id) || card;
                snapshot = {
                    id: auctionCard.id, player_name: auctionCard.player_name, position: auctionCard.position, overall_rating: auctionCard.overall_rating,
                    rarity: auctionCard.rarity, avatar: auctionCard.avatar, stats: auctionCard.stats || {}, habilidade_nome: auctionCard.habilidade_nome,
                    habilidade_descricao: auctionCard.habilidade_descricao, colecao_nome: auctionCard.colecao_nome
                };
                const [activeRows] = await conn.query(
                    `SELECT auction_id FROM card_auctions WHERE card_id = ? AND status = 'active' LIMIT 1`,
                    [cardId]
                );
                if (activeRows?.length) throw new Error('Esta carta já está em um leilão ativo.');
                const [teamRows] = await conn.query(
                    `SELECT id FROM teams WHERE gk_card_id = ? OR vl_card_id = ? OR pv_card_id = ? LIMIT 1`,
                    [cardId, cardId, cardId]
                );
                if (teamRows?.length) throw new Error('Retire a carta da escalação antes de leiloá-la.');
                await conn.query(`
                    INSERT INTO card_auctions (auction_id, card_id, seller_discord_id, seller_tag, starting_bid, current_bid, ends_at, status, guild_id, channel_id, card_snapshot)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?::jsonb)
                    RETURNING auction_id
                `, [auctionId, cardId, interaction.user.id, interaction.user.tag, startingBid, startingBid, endsAt.toISOString(), interaction.guildId, targetChannel.id, JSON.stringify(snapshot)]);
                auction = {
                    id: auctionId, cardId, carta: snapshot, vendedorId: interaction.user.id, vendedorTag: interaction.user.tag,
                    valorInicial: startingBid, valorAtual: startingBid, lanceAtual: null, compradorId: null, compradorTag: null,
                    encerraEm: endsAt.getTime(), channelId: targetChannel.id, guildId: interaction.guildId,
                    messageId: null, imageUrl: null, client: interaction.client, status: 'active'
                };
                await conn.commit();
            } catch (error) {
                try { await conn.rollback(); } catch (_) { }
                throw error;
            } finally {
                conn.release();
            }
            leiloes.set(auctionId, auction);

            const imageName = `leilao_${cardId}_${auctionId}.png`;
            const attachment = await createCardsAttachment(auctionCard, imageName).catch(() => null);
            const embed = montarEmbed(auction);
            if (attachment) embed.setImage(`attachment://${imageName}`);
            const components = montarBotoes(auction, true);
            let sentMessage;
            if (targetChannel.id === interaction.channelId) {
                await interaction.editReply({ embeds: [embed], components, files: attachment ? [attachment] : [] });
                sentMessage = await interaction.fetchReply();
            } else {
                sentMessage = await targetChannel.send({ embeds: [embed], components, files: attachment ? [attachment] : [] });
                await interaction.editReply(`✅ Leilão criado em ${targetChannel}!`);
            }
            const imageUrl = sentMessage?.attachments?.first()?.url || null;
            await salvarMensagem(auctionId, targetChannel.id, sentMessage.id, imageUrl);
            const updated = leiloes.get(auctionId);
            if (updated) updated.imageUrl = imageUrl;
            scheduleAuctionClose(updated);
            console.log(`🔨 Leilão persistido: ${auctionId} · carta #${cardId} · vendedor ${interaction.user.tag}`);
        } catch (error) {
            console.error('[leilao] Erro ao criar leilão:', error);
            try { await query(`UPDATE card_auctions SET status = 'cancelled', updated_at = NOW() WHERE auction_id = ? AND status = 'active'`, [auctionId]); } catch (_) { }
            leiloes.delete(auctionId);
            clearAuctionTimer(auctionId);
            try { await interaction.editReply(`❌ Não foi possível criar o leilão: ${error.message}`); } catch (_) { }
        }
    },

    // Restaura leilões e timers no clientReady.
    inicializarLeiloes,
    registrarLance,
    getLeilaoAtivo,
    cancelarLeilao,
    encerrarLeilao,
    cartaEmLeilao,
    ensureAuctionSchema,
    __test: { mapRowToAuction, formatarDuracao, notificarLanceCoberto }
};
