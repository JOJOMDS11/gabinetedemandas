// Função auxiliar para montar cards
async function buildCards(team) {
	const gk = team.gk_card_id ? await getCardById(team.gk_card_id, team.owner_discord_id) : null;
	const vl = team.vl_card_id ? await getCardById(team.vl_card_id, team.owner_discord_id) : null;
	const pv = team.pv_card_id ? await getCardById(team.pv_card_id, team.owner_discord_id) : null;
	const normalize = (c, role) => {
		if (!c) return {
			id: null,
			player_name: `${role.toUpperCase()} Genérico`,
			avatar: role === 'gk' ? '🥅' : role === 'pv' ? '🎯' : '⚽',
			overall_rating: 50,
			role,
			tier: 'comum',
			def: 0, pos: 0, sai: 0,
			defesa: 0, posicionamento: 0, saidaDeBola: 0,
			drible: 0, passe: 0, finalizacao: 0, stats: {}
		};

		// O driver pode devolver o JSON de stats como objeto ou string.
		let rawStats = c.stats;
		if (typeof rawStats === 'string') {
			try { rawStats = JSON.parse(rawStats); } catch (_) { rawStats = {}; }
		}
		if (!rawStats || typeof rawStats !== 'object' || Array.isArray(rawStats)) rawStats = {};

		const readStat = (...values) => {
			for (const value of values) {
				if (value === undefined || value === null || value === '') continue;
				const number = Number(value);
				if (Number.isFinite(number)) return number;
			}
			return 0;
		};

		// A engine lê def/pos/sai; a progressão e outros módulos usam os nomes longos.
		const posicionamento = readStat(rawStats.posicionamento, c.posicionamento, rawStats.pos, c.pos);
		const saidaDeBola = readStat(rawStats.saidaDeBola, c.saidaDeBola, rawStats.sai, c.sai);
		const defesa = readStat(rawStats.defesa, c.defesa, rawStats.def, c.def);
		const drible = readStat(rawStats.drible, c.drible);
		const passe = readStat(rawStats.passe, c.passe);
		const finalizacao = readStat(rawStats.finalizacao, c.finalizacao);

		return {
			id: c.id,
			player_name: c.player_name || role.toUpperCase(),
			avatar: c.avatar || c.template_avatar || (role === 'gk' ? '🥅' : role === 'pv' ? '🎯' : '⚽'),
			overall_rating: c.overall_rating || 50,
			role,
			// 🎨 Borda, fundo e raridade.
			custom_border: c.custom_border || null,
			borda_cor1: c.borda_cor1 || null,
			borda_cor2: c.borda_cor2 || null,
			custom_background: c.custom_background || null,
			fundo_cor1: c.fundo_cor1 || null,
			fundo_cor2: c.fundo_cor2 || null,
			tier: c.tier || c.template_tier || 'comum',
			rarity: c.rarity || c.tier || c.template_tier || 'comum',
			template_tier: c.template_tier || c.tier || 'comum',
			// Nomes longos preservados para outras rotinas.
			posicionamento,
			saidaDeBola,
			defesa,
			drible,
			passe,
			finalizacao,
			// Aliases curtos exigidos por getGK/VL/PVStatInfluence.
			def: defesa,
			pos: posicionamento,
			sai: saidaDeBola,
			stats: { ...rawStats, posicionamento, saidaDeBola, defesa, drible, passe, finalizacao, pos: posicionamento, sai: saidaDeBola, def: defesa },
			habilidade_equipada: c.habilidade_equipada || null
		};
	};
	return {
		gk: normalize(gk, 'gk'),
		vl: normalize(vl, 'vl'),
		pv: normalize(pv, 'pv')
	};
}

const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { getPlayerByDiscordId, addPurpleCoins } = require('../database/models/player');
const { getTeamByOwner, updateTeam, getTeamById } = require('../database/models/team');
const { getCardById } = require('../database/models/card');
const { simulateMatchRealtime, updatePersistentTeamStats } = require('../utils/matchSimulator');
const { updateCardStatsBatch } = require('../database/utils/updateCardStatsBatch');
const { query } = require('../database/connection');
const { generateGoalCelebration, generateOwnGoalCelebration } = require('../utils/goalCelebrationGenerator');
const { generateMatchStartField } = require('../utils/matchStartFieldGenerator');
const Logger = require('../utils/logger');
const { applyTeamBonuses } = require('../utils/matchBonuses');
const { createCommentator, summarizeMatch, buildLiveParts, formatLiveTally, progressBar } = require('../utils/amistosoCommentary');

// Replay pacing defaults
const REPLAY_STEP_MS = 1200;
const REPLAY_INITIAL_DELAY = 600;
const DESAFIAR_INITIAL_PAUSE = 1000;
const DESAFIAR_DURATION_SECONDS = 360;
const SHOW_GOAL_CELEBRATION = true;

// Prime especial = carta Prime com borda e/ou fundo exclusivo (ou ambos)
function isPrimeEspecial(card) {
	if (!card) return false;
	const raridade = String(card.rarity || '').trim().toLowerCase();
	if (raridade !== 'prime') return false;
	const temBorda = Boolean(card.custom_border || card.borda_cor1);
	const temFundo = Boolean(card.custom_background || card.fundo_cor1);
	return temBorda || temFundo;
}

// Store for pending challenges
const challengeStore = new Map();

// Small helpers used by the interaction handler
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function fmtTime(seconds) { const s = Number(seconds) || 0; const m = Math.floor(s / 60); const sec = s % 60; return `${m}:${String(sec).padStart(2, '0')}`; }

function buildDesafiarLiveEmbed({ homeName, awayName, score, lines, stats, summary, finished = false, winnerName = null }) {
	const parts = buildLiveParts({ lines, stats, duration: DESAFIAR_DURATION_SECONDS, previousCount: 6 });
	const s1 = Number(score && score.team1) || 0;
	const s2 = Number(score && score.team2) || 0;
	const board = `🔴 **${homeName}**  **${s1} × ${s2}**  **${awayName}** 🔵`;

	let title = `⚽ Partida: ${homeName} vs ${awayName}`;
	let color = s1 > s2 ? 0xFF3333 : s2 > s1 ? 0x3333FF : 0xFFFF00;
	let timeLine = parts.timeLine;
	let narration = parts.narrationText;
	let previous = parts.previousText;

	if (finished) {
		title = '🏁 FIM DE JOGO';
		timeLine = `⏱️ **FIM DE JOGO** · ${progressBar(1, 1)}`;
		narration = winnerName
			? `🏁 **Apita o árbitro!** **${winnerName}** vence a partida!`
			: '🏁 **Apita o árbitro!** Fim de jogo!';
		previous = '';
	} else if (parts.ownGoalNow) {
		title = '🤡 GOL CONTRA!';
		color = 0xF1C40F;
	} else if (parts.goalNow) {
		title = '⚽ GOOOOOOOL!';
		color = 0xF1C40F;
	}

	const embed = new EmbedBuilder()
		.setTitle(title)
		.setDescription(`${board}\n${timeLine}${parts.statsLine ? `\n${parts.statsLine}` : ''}`)
		.setColor(color)
		.addFields({ name: '🎙️ Narração', value: narration.slice(0, 1024), inline: false });

	if (previous) {
		embed.addFields({ name: '📣 Lances anteriores', value: previous.slice(0, 1024), inline: false });
	}

	if (summary) {
		const tally =
			`${formatLiveTally(summary, 'team1', homeName, '🔴')}\n` +
			`${formatLiveTally(summary, 'team2', awayName, '🔵')}`;
		embed.addFields({ name: '🔝 Artilharia e Assistências', value: tally.slice(0, 1024), inline: false });
	}

	return embed.setTimestamp();
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('desafiar')
		.setDescription('⚔️ Desafiar outro jogador para uma partida!')
		.addUserOption(option => option.setName('jogador').setDescription('Jogador que você quer desafiar').setRequired(true)),

	async execute(interaction) {
		try {
			const challengedUser = interaction.options.getUser('jogador');
			if (!challengedUser) return await interaction.reply({ content: '❌ **USUÁRIO NÃO ENCONTRADO!**\n🔍 Verifique se o jogador existe.', ephemeral: true });
			const challengerId = interaction.user.id;
			const challengedId = challengedUser.id;
			if (challengerId === challengedId) return await interaction.reply({ content: '❌ **VOCÊ NÃO PODE DESAFIAR A SI MESMO!**', ephemeral: true });
			const challengerTeam = await getTeamByOwner(challengerId);
			const challengedTeam = await getTeamByOwner(challengedId);
			if (!challengerTeam || !challengerTeam.id) return await interaction.reply({ content: '❌ **VOCÊ PRECISA TER UM TIME!**\n🏆 Use `/registrartime` para criar seu time primeiro.', ephemeral: true });
			if (!challengedTeam || !challengedTeam.id) return await interaction.reply({ content: `❌ **${challengedUser.username} NÃO POSSUI UM TIME REGISTRADO!**\n🏆 O jogador precisa usar \`/registrartime\` primeiro.`, ephemeral: true });
			if (!challengerTeam.gk_card_id || !challengerTeam.vl_card_id || !challengerTeam.pv_card_id) return await interaction.reply({ content: '❌ **SEU TIME NÃO ESTÁ COMPLETO!**\n⚽ Use `/escalar` para completar sua escalação (GK, VL, PV).', ephemeral: true });
			{
				const { nomeRepetidoNoTime } = require('../utils/timeRegras');
				const repA = await nomeRepetidoNoTime(challengerTeam, challengerTeam.owner_discord_id, null, null);
				if (repA) return await interaction.reply({ content: `❌ **ESCALAÇÃO INVÁLIDA!**\n🚫 Seu time tem **${repA}** repetido. Só pode um jogador por nome. Ajuste com \`/escalar\`.`, ephemeral: true });
			}
			if (!challengedTeam.gk_card_id || !challengedTeam.vl_card_id || !challengedTeam.pv_card_id) return await interaction.reply({ content: `❌ **O TIME DE ${challengedUser.username} NÃO ESTÁ COMPLETO!**\n⚽ O jogador precisa completar sua escalação primeiro.`, ephemeral: true });
			{
				const repB = await require('../utils/timeRegras').nomeRepetidoNoTime(challengedTeam, challengedTeam.owner_discord_id, null, null);
				if (repB) return await interaction.reply({ content: `❌ **O TIME DE ${challengedUser.username} ESTÁ INVÁLIDO!**\n🚫 Tem **${repB}** repetido na escalação (só pode um jogador por nome).`, ephemeral: true });
			}
			const challengeId = `${challengerId}_${challengedId}_${Date.now()}`;
			challengeStore.set(challengeId, {
				challengerId,
				challengedId,
				challengerTeam: challengerTeam.id,
				challengedTeam: challengedTeam.id,
				timestamp: Date.now()
			});
			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder().setCustomId(`accept_${challengeId}`).setLabel('✅ Aceitar').setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId(`decline_${challengeId}`).setLabel('❌ Recusar').setStyle(ButtonStyle.Danger)
			);
			const embed = new EmbedBuilder()
				.setColor('#FF6B35')
				.setTitle('⚔️ DESAFIO DE PARTIDA!')
				.setDescription(`🏆 **${interaction.user.username}** desafiou **${challengedUser.username}**!\n\n🔥 **${challengerTeam.name}** vs **${challengedTeam.name}**\n\n⏰ **Desafio válido por 5 minutos**`)
				.addFields(
					{ name: '🎯 Desafiante', value: `<@${challengerId}>`, inline: true },
					{ name: '🎯 Desafiado', value: `<@${challengedId}>`, inline: true },
					{ name: '⚽ Modalidade', value: 'Partida Amistosa', inline: true }
				)
				.setTimestamp()
				.setFooter({ text: 'HaxBall DreamTeam' });
			await interaction.reply({ content: `<@${challengedId}> você foi desafiado! 🔔`, embeds: [embed], components: [row] });
			setTimeout(() => challengeStore.delete(challengeId), 5 * 60 * 1000);
		} catch (err) {
			console.error('Erro no bloco do comando desafiar:', err);
		}
	}
};

// Handler para processar interações de aceitar/recusar desafio (botões)
module.exports.handleChallengeInteraction = async (interaction) => {
	try {
		const customId = interaction.customId;
		const isAccept = customId && customId.startsWith('accept_');
		const isDecline = customId && customId.startsWith('decline_');
		if (!isAccept && !isDecline) return;

		const challengeId = customId.split('_').slice(1).join('_');
		const challenge = challengeStore.get(challengeId);

		if (!challenge) return await interaction.reply({ content: '⏰ Este desafio expirou ou já foi respondido.', ephemeral: true });

		if (interaction.user.id !== challenge.challengedId) return await interaction.reply({ content: '❌ Apenas o jogador desafiado pode aceitar ou recusar este desafio.', ephemeral: true });

		const resultEmbed = interaction.message && interaction.message.embeds && interaction.message.embeds[0] ? EmbedBuilder.from(interaction.message.embeds[0]) : new EmbedBuilder();

		if (isDecline) {
			challengeStore.delete(challengeId);
			resultEmbed.setColor('#999999').setTitle('❌ Desafio Recusado').setDescription(`<@${interaction.user.id}> recusou o desafio.`);
			try {
				await interaction.update({ content: `<@${challenge.challengerId}> seu desafio foi recusado.`, embeds: [resultEmbed], components: [] });
			} catch (err) {
				try { await interaction.reply({ content: '❌ Não foi possível atualizar a mensagem original, mas o desafio foi recusado.', ephemeral: true }); } catch (e) { }
			}
			return;
		}

		// Accept
		challengeStore.delete(challengeId);
		resultEmbed.setColor('#00AA00').setTitle('✅ Desafio Aceito').setDescription(`<@${interaction.user.id}> aceitou o desafio!`);
		try {
			await interaction.update({ content: `🎉 Desafio confirmado: <@${challenge.challengerId}> vs <@${challenge.challengedId}>`, embeds: [resultEmbed], components: [] });
		} catch (err) {
			try { await interaction.reply({ content: '✅ Você aceitou o desafio! (não foi possível atualizar a mensagem original)', ephemeral: true }); } catch (e) { }
		}

		// Run the match asynchronously
		(async () => {
			try {
				const challengerTeam = await getTeamById(challenge.challengerTeam);
				const challengedTeam = await getTeamById(challenge.challengedTeam);
				if (!challengerTeam || !challengedTeam) {
					try { await interaction.followUp({ content: '❌ Não foi possível recuperar os times para a partida.', ephemeral: true }); } catch (e) { }
					return;
				}

				// Prepare cards for both teams
				const team1Cards = await buildCards(challengerTeam);
				const team2Cards = await buildCards(challengedTeam);

				// 🎓🏢 Treinador (nas cartas) e patrocínio (pontos de time) — aplicados em silêncio,
				// só em memória. Veja utils/matchBonuses.js para ajustar a força.
				const bonuses1 = await applyTeamBonuses(team1Cards, challengerTeam);
				const bonuses2 = await applyTeamBonuses(team2Cards, challengedTeam);

				const HOME_EMOJI = '🔴';
				const AWAY_EMOJI = '🔵';

				// 🎨 GERAR IMAGEM ESTÁTICA DO CAMPO COM ESCALAÇÃO (6 CARTINHAS)
				Logger.info('🏟️ Gerando imagem do campo com as 6 cartinhas...');
				let fieldImage = null;
				try {
					fieldImage = await generateMatchStartField(team1Cards, team2Cards);
					Logger.info(`✅ Imagem do campo gerada: ${fieldImage ? fieldImage.length : 0} bytes`);
				} catch (err) {
					Logger.error('❌ Erro ao gerar imagem do campo:', err);
					fieldImage = null;
				}

				const startEmbed = new EmbedBuilder()
					.setTitle(`⚽ Partida: ${challengerTeam.name} vs ${challengedTeam.name}`)
					.setDescription(`${HOME_EMOJI} **${challengerTeam.name}** 0 x 0 ${AWAY_EMOJI} **${challengedTeam.name}**\n\n🏟️ **ESCALAÇÕES CONFIRMADAS**`)
					.addFields({ name: '🎙️ Narração', value: '🎙️ Apita o árbitro! A bola vai rolar em instantes...', inline: false })
					.setColor('#2ECC71')
					.setTimestamp();

				let matchMessage = null;
				const messagePayload = { embeds: [startEmbed], components: [] };
				
				// �️ Anexar imagem do campo se foi gerada
				if (fieldImage) {
					const attachment = new AttachmentBuilder(fieldImage, { name: 'field_lineup.png' });
					messagePayload.files = [attachment];
					startEmbed.setImage('attachment://field_lineup.png');
				}

				try {
					// Prefer editing the original interaction reply (keeps a single message in channel)
					try {
						await interaction.editReply(messagePayload);
						// fetch the message object so we can call .edit on it later
						try { matchMessage = await interaction.fetchReply(); } catch (e) { matchMessage = null; }
					} catch (e) {
						// fallback to channel send if editReply not allowed
						try {
							if (interaction.channel && interaction.channel.send) {
								matchMessage = await interaction.channel.send(messagePayload);
							} else {
								matchMessage = await interaction.followUp(messagePayload);
							}
						} catch (err2) {
							console.warn('Failed to post match start message (fallback):', err2);
							matchMessage = null;
						}
					}
				} catch (e) {
					console.warn('Failed to post match start message:', e);
					matchMessage = null;
				}

				await sleep(DESAFIAR_INITIAL_PAUSE);

				const commentator = createCommentator({
					userCards: team1Cards,
					botCards: team2Cards,
					duration: DESAFIAR_DURATION_SECONDS
				});
				let liveQueue = Promise.resolve();

				const result = await simulateMatchRealtime(
					team1Cards,
					team2Cards,
					challengerTeam.name,
					challengedTeam.name,
					(update) => {
						const currentEvent = update && update.event;
						if (!currentEvent) return;

						try {
							commentator.narrate(update);
						} catch (narrateErr) {
							console.warn('Falha ao narrar lance:', narrateErr && narrateErr.message ? narrateErr.message : narrateErr);
						}

						if (!matchMessage) return;

						// GIF só quando quem fez o gol tem carta Prime com borda e/ou fundo especial
						let celebrationType = null;
						let celebrationCard = null;
						if (SHOW_GOAL_CELEBRATION && ['goal', 'own_goal'].includes(currentEvent.type)) {
							const allCards = [...Object.values(team1Cards), ...Object.values(team2Cards)];
							const scorerCard = allCards.find(c => c && c.id != null && String(c.id) === String(currentEvent.scorerId));
							if (isPrimeEspecial(scorerCard)) {
								celebrationType = currentEvent.type;
								celebrationCard = scorerCard;
							}
						}

						const embed = buildDesafiarLiveEmbed({
							homeName: challengerTeam.name,
							awayName: challengedTeam.name,
							score: update.score,
							lines: commentator.getLines(),
							stats: commentator.getStats(),
							summary: summarizeMatch(commentator.getEvents(), team1Cards, team2Cards)
						});

						liveQueue = liveQueue
							.then(async () => {
								const payload = { embeds: [embed], attachments: [], files: [] };
								if (celebrationType && celebrationCard) {
									try {
										const buf = celebrationType === 'own_goal'
											? await generateOwnGoalCelebration(celebrationCard)
											: await generateGoalCelebration(celebrationCard, 'goal');
										payload.files = [new AttachmentBuilder(buf, { name: 'gol.gif' })];
										embed.setImage('attachment://gol.gif');
									} catch (gifErr) {
										console.warn('Falha ao gerar GIF de gol:', gifErr && gifErr.message ? gifErr.message : gifErr);
									}
								}
								return matchMessage.edit(payload);
							})
							.catch(e => {
								console.warn('Error editing match message:', e);
							});
					}, { stepMs: 2200, initialDelay: 1800, team1Bonus: bonuses1.bonus, team2Bonus: bonuses2.bonus });

				await liveQueue;

				if (matchMessage && result && result.score) {
					try {
						const finalHome = Number(result.score.team1) || 0;
						const finalAway = Number(result.score.team2) || 0;
						const finalWinnerName = finalHome > finalAway ? challengerTeam.name : finalAway > finalHome ? challengedTeam.name : null;
						const finalEmbed = buildDesafiarLiveEmbed({
							homeName: challengerTeam.name,
							awayName: challengedTeam.name,
							score: result.score,
							lines: commentator.getLines(),
							stats: commentator.getStats(),
							summary: summarizeMatch(result.events, team1Cards, team2Cards),
							finished: true,
							winnerName: finalWinnerName
						});
						await matchMessage.edit({ embeds: [finalEmbed] });
					} catch (e) {
						console.warn('Error editing final match message:', e);
					}
				}

				// Resultado final - atualizar stats e dar coins
				const score1 = (result && result.score) ? Number(result.score.team1) || 0 : 0;
				const score2 = (result && result.score) ? Number(result.score.team2) || 0 : 0;

				let winnerTeam = null;
				let loserTeam = null;
				if (score1 > score2) { winnerTeam = challengerTeam; loserTeam = challengedTeam; }
				else if (score2 > score1) { winnerTeam = challengedTeam; loserTeam = challengerTeam; }

				const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

				let winnerCoins = 0, loserCoins = 0;

				// Update persistent team stats using helper
				const incForTeam = async (teamObj, goalsFor, goalsAgainst, outcome) => {
					const winsInc = outcome === 'win' ? 1 : 0;
					const lossesInc = outcome === 'loss' ? 1 : 0;
					const drawsInc = outcome === 'draw' ? 1 : 0;
					try {
						const cols = await query("SHOW COLUMNS FROM teams");
						const colNames = (cols || []).map(c => c.Field);

						const updates = [];
						const params = [];

						updates.push('matches_played = COALESCE(matches_played,0)+1');
						updates.push('wins = COALESCE(wins,0)+?'); params.push(winsInc);
						updates.push('losses = COALESCE(losses,0)+?'); params.push(lossesInc);
						updates.push('draws = COALESCE(draws,0)+?'); params.push(drawsInc);

						if (colNames.includes('goals_scored') && colNames.includes('goals_conceded')) {
							updates.push('goals_scored = COALESCE(goals_scored,0)+?'); params.push(goalsFor);
							updates.push('goals_conceded = COALESCE(goals_conceded,0)+?'); params.push(goalsAgainst);
						} else if (colNames.includes('goals_for') && colNames.includes('goals_against')) {
							updates.push('goals_for = COALESCE(goals_for,0)+?'); params.push(goalsFor);
							updates.push('goals_against = COALESCE(goals_against,0)+?'); params.push(goalsAgainst);
						} else if (colNames.includes('goals') && colNames.includes('goals_against')) {
							updates.push('goals = COALESCE(goals,0)+?'); params.push(goalsFor);
							updates.push('goals_against = COALESCE(goals_against,0)+?'); params.push(goalsAgainst);
						}

						const sql = `UPDATE teams SET ${updates.join(', ')} WHERE id = ?`;
						params.push(teamObj.id);
						await query(sql, params);
					} catch (e) {
						console.warn('Failed to update team stats for team', teamObj && teamObj.id, e && e.message);
					}
				};

				// update player/card stats batch helper
				const updatePlayerStats = async (teamCards, events, teamName) => {
					// Map: cardId -> stats
					const statsMap = {};
					for (const pos of ['gk', 'vl', 'pv']) {
						if (teamCards && teamCards[pos] && teamCards[pos].id) {
							statsMap[teamCards[pos].id] = { games_played: 1, goals: 0, assists: 0, goals_conceded: 0, clean_sheets: 0, role: pos };
						}
					}
					for (const ev of (Array.isArray(events) ? events : [])) {
						if (!ev) continue;
						if ((ev.type === 'goal' || ev.type === 'own_goal') && ev.team) {
							const isThisTeam = (ev.team === 'team1' && teamName === challengerTeam.name) || (ev.team === 'team2' && teamName === challengedTeam.name);
							if (isThisTeam && ev.scorerId && statsMap[ev.scorerId]) statsMap[ev.scorerId].goals += 1;
							const concededForThisTeam = (ev.team === 'team1' && teamName === challengedTeam.name) || (ev.team === 'team2' && teamName === challengerTeam.name);
							if (concededForThisTeam) {
								for (const pos of ['gk']) {
									if (teamCards && teamCards[pos] && teamCards[pos].id && statsMap[teamCards[pos].id]) {
										statsMap[teamCards[pos].id].goals_conceded += 1;
									}
								}
							}
						}
						if (ev.type === 'goal' && ev.assisterId && statsMap[ev.assisterId]) statsMap[ev.assisterId].assists += 1;
					}
					const safe = v => (typeof v === 'number' && !isNaN(v) ? v : 0);
					const increments = Object.entries(statsMap).map(([cardId, stats]) => ({
						cardId: parseInt(cardId),
						games_played: safe(stats.games_played),
						goals: safe(stats.goals),
						assists: safe(stats.assists),
						goals_conceded: safe(stats.goals_conceded),
						clean_sheets: stats.role === 'gk' ? ((teamName === challengerTeam.name ? score2 : score1) === 0 ? 1 : 0) : 0
					}));
					if (increments.length > 0) {
						try { await updateCardStatsBatch(increments); } catch (e) { console.error('updatePlayerStats: failed', e); }
					}

					// Atualizar stats totais do jogador (para conquistas)
					const totalGoals = increments.reduce((sum, inc) => sum + safe(inc.goals), 0);
					const totalCleanSheets = increments.reduce((sum, inc) => sum + safe(inc.clean_sheets), 0);
					if (totalGoals > 0 || totalCleanSheets > 0) {
						try {
							const updates = [];
							const params = [];
							if (totalGoals > 0) {
								updates.push('gols = COALESCE(gols, 0) + ?');
								params.push(totalGoals);
							}
							if (totalCleanSheets > 0) {
								updates.push('clean_sheets = COALESCE(clean_sheets, 0) + ?');
								params.push(totalCleanSheets);
							}
							if (updates.length > 0) {
								const ownerDiscordId = teamName === challengerTeam.name ? challengerTeam.owner_discord_id : challengedTeam.owner_discord_id;
								params.push(ownerDiscordId);
								await query(`UPDATE players SET ${updates.join(', ')} WHERE discord_id = ?`, params);
							}
						} catch (e) { console.error('updatePlayerTotalStats: failed', e); }
					}
				};

				// atualizar stats persistentes por time (usando result.statsByTeam se disponível)
				const statsByTeam = result.statsByTeam || {};
				const challengerCS = (score2 === 0);
				const challengedCS = (score1 === 0);

				await updatePersistentTeamStats(
					challengerTeam.name,
					statsByTeam[challengerTeam.name],
					{
						win: score1 > score2,
						draw: score1 === score2,
						loss: score1 < score2,
						goalsFor: score1,
						goalsAgainst: score2,
						cleanSheet: challengerCS
					}
				);
				await updatePersistentTeamStats(
					challengedTeam.name,
					statsByTeam[challengedTeam.name],
					{
						win: score2 > score1,
						draw: score1 === score2,
						loss: score2 < score1,
						goalsFor: score2,
						goalsAgainst: score1,
						cleanSheet: challengedCS
					}
				);

				// O simulador v2 nunca devolve empate: o gol de ouro já é decidido lá dentro (pelos stats).
				const goldenGoal = (result.events || []).some(ev => Number(ev && ev.time) > DESAFIAR_DURATION_SECONDS);
				// Now there is a winner
				winnerTeam = score1 > score2 ? challengerTeam : challengedTeam;
				loserTeam = score1 > score2 ? challengedTeam : challengerTeam;
				winnerCoins = randInt(15, 20);
				loserCoins = randInt(7, 12);
				try { await addPurpleCoins(winnerTeam.owner_discord_id, winnerCoins); } catch (e) { console.warn('Failed to add coins to winner owner', e); }
				try { await addPurpleCoins(loserTeam.owner_discord_id, loserCoins); } catch (e) { console.warn('Failed to add coins to loser owner', e); }

				// Compute rankings BEFORE applying changes so we can show deltas
				const Team = require('../database/models/team');
				// Função de pontuação igual ao ranking.js/timestats.js
				function calcRankingScore(t, cleanSheets) {
					return (
						((t.wins || 0) * 3) +
						((t.losses || 0) * -2) +
						((t.goals_for || 0) * 0.5) +
						((t.assists || 0) * 0.5) +
						((t.goals_against || 0) * -0.3) +
						(cleanSheets * 1.5)
					);
				}

				async function getTeamRanking(team) {
					const allTeams = await Team.getAllTeams();
					const teamsWithScore = [];
					for (const t of allTeams) {
						const cs = (t.clean_sheets || 0) + (t.cleanSheets || 0);
						teamsWithScore.push({ id: t.id, score: calcRankingScore(t, cs) });
					}
					teamsWithScore.sort((a, b) => b.score - a.score);
					const pos = teamsWithScore.findIndex(t => t.id === team.id);
					const score = teamsWithScore[pos]?.score || 0;
					return { pos: pos + 1, score };
				}

				// ranking before
				const challengerRankingBefore = await getTeamRanking(challengerTeam);
				const challengedRankingBefore = await getTeamRanking(challengedTeam);

				// update DB team stats
				await incForTeam(challengerTeam, score1, score2, score1 > score2 ? 'win' : 'loss');
				await incForTeam(challengedTeam, score2, score1, score2 > score1 ? 'win' : 'loss');

				// Atualizar vitórias do jogador (para conquistas)
				if (winnerTeam) {
					try {
						await query(
							'UPDATE players SET vitorias = COALESCE(vitorias, 0) + 1 WHERE discord_id = ?',
							[winnerTeam.owner_discord_id]
						);
					} catch (e) { console.error('updatePlayerVitorias: failed', e); }
				}

				// Atualizar stats dos jogadores em campo
				await updatePlayerStats(team1Cards, result.events, challengerTeam.name);
				await updatePlayerStats(team2Cards, result.events, challengedTeam.name);

				// Atualizar progresso de missão 'jogar' para ambos (atomic increment)
				try {
					const { getPlayerActiveMission, incrementPlayerMission } = require('../database/models/mission');
					const cmdMissao = require('./missao');
					const MISSIONS = cmdMissao.MISSIONS || [];
					// Challenger
					const mission1 = await getPlayerActiveMission(challengerTeam.owner_discord_id);
					if (mission1 && mission1.missao_key && mission1.missao_key.startsWith('jogar') && !mission1.recompensa_resgatada) {
						const missionDef = (MISSIONS || []).find(m => m.key === mission1.missao_key);
						const goal = missionDef ? missionDef.goal : null;
						await incrementPlayerMission(challengerTeam.owner_discord_id, mission1.missao_key, 1, goal);
					}
					// Challenged
					const mission2 = await getPlayerActiveMission(challengedTeam.owner_discord_id);
					if (mission2 && mission2.missao_key && mission2.missao_key.startsWith('jogar') && !mission2.recompensa_resgatada) {
						const missionDef = (MISSIONS || []).find(m => m.key === mission2.missao_key);
						const goal = missionDef ? missionDef.goal : null;
						await incrementPlayerMission(challengedTeam.owner_discord_id, mission2.missao_key, 1, goal);
					}
				} catch (e) {
					console.error('Erro ao atualizar missão jogar:', e);
				}

				// Atualizar progresso de missão 'ganhar' para o vencedor (atomic increment)
				try {
					const { getPlayerActiveMission, incrementPlayerMission } = require('../database/models/mission');
					const cmdMissao = require('./missao');
					const MISSIONS = cmdMissao.MISSIONS || cmdMissao.MISSIONS;
					const winnerMission = await getPlayerActiveMission(winnerTeam.owner_discord_id);
					if (winnerMission && winnerMission.missao_key && winnerMission.missao_key.startsWith('ganhar') && !winnerMission.recompensa_resgatada) {
						const missionDef = (MISSIONS || []).find(m => m.key === winnerMission.missao_key);
						const goal = missionDef ? missionDef.goal : null;
						await incrementPlayerMission(winnerTeam.owner_discord_id, winnerMission.missao_key, 1, goal);
					}
				} catch (e) {
					console.error('Erro ao atualizar missão ganhar:', e);
				}

				// Atualizar progresso de missão 'gols' para cada dono que marcou (tiered keys: gols_epica/gols_rara/gols_normal)
				try {
					const { getPlayerActiveMission, incrementPlayerMission } = require('../database/models/mission');
					const cmdMissao = require('./missao');
					const MISSIONS = cmdMissao.MISSIONS || [];
					// Count goals per owner from result.events
					const goalsByOwner = {}; // discordId -> goalsCount
					for (const ev of result.events || []) {
						if (!ev) continue;
						if (ev.type === 'goal' || ev.type === 'own_goal') {
							// ev.scorerId is card id; we need to map card id -> owner discord id
							if (!ev.scorerId) continue;
							try {
								const rows = await query('SELECT discord_id FROM user_cards WHERE id = ?', [ev.scorerId]);
								const owner = rows && rows[0] ? rows[0].discord_id : null;
								if (owner) {
									goalsByOwner[owner] = (goalsByOwner[owner] || 0) + 1;
								}
							} catch (err) {
								console.warn('Failed to lookup card owner for mission gols increment:', err && err.message ? err.message : err);
							}
						}
					}
					// Apply increments
					for (const ownerId of Object.keys(goalsByOwner)) {
						try {
							const playerMission = await getPlayerActiveMission(ownerId);
							if (playerMission && playerMission.missao_key && playerMission.missao_key.startsWith('gols') && !playerMission.recompensa_resgatada) {
								const delta = goalsByOwner[ownerId] || 0;
								const missionDef = (MISSIONS || []).find(m => m.key === playerMission.missao_key);
								const goal = missionDef ? missionDef.goal : null;
								await incrementPlayerMission(ownerId, playerMission.missao_key, delta, goal);
							}
						} catch (err) {
							console.warn('Error updating gols mission for owner', ownerId, err && err.message ? err.message : err);
						}
					}
				} catch (e) {
					console.error('Erro ao atualizar missão gols:', e && e.message ? e.message : e);
				}

				const finalMsg = `🏆 **${winnerTeam.name} venceu a partida ${goldenGoal ? 'no Gol de Ouro' : 'no tempo normal'}!** +${winnerCoins} Purple Coins para o dono. +${loserCoins} Purple Coins para o outro dono como participação.`;

				// Buscar ranking dos dois times (após atualização)
				const challengerRanking = await getTeamRanking(challengerTeam);
				const challengedRanking = await getTeamRanking(challengedTeam);

				// compute deltas for display
				const challengerDelta = (challengerRanking.score - challengerRankingBefore.score) || 0;
				const challengedDelta = (challengedRanking.score - challengedRankingBefore.score) || 0;
				const challengerScoreBefore = Number(challengerRankingBefore.score || 0);
				const challengerScoreAfter = Number(challengerRanking.score || 0);
				const challengedScoreBefore = Number(challengedRankingBefore.score || 0);
				const challengedScoreAfter = Number(challengedRanking.score || 0);

				// Mensagem final para ambos
				const getMention = (id) => `<@${id}>`;
				// Build final scoreboard header like: CRICIUMA 1 X 0
				const header = `${challengerTeam.name} ${score1} X ${score2} ${challengedTeam.name}`;

				const finalSummary = summarizeMatch(result.events, team1Cards, team2Cards);
				const orDash = (value) => value || '—';
				const buildTeamResultBlock = (side, teamName, teamEmoji) =>
					`${teamEmoji} **TIME ${String(teamName).toUpperCase()}**\n` +
					`Gols: ${orDash(finalSummary.goals(side))}\n` +
					`Ass: ${orDash(finalSummary.assists(side))}\n` +
					`Gols contra: ${orDash(finalSummary.ownGoals(side))}`;

				const scorersText = `${buildTeamResultBlock('team1', challengerTeam.name, HOME_EMOJI)}\n\n${buildTeamResultBlock('team2', challengedTeam.name, AWAY_EMOJI)}`;

				const resultMsg =
					`🏆 **Partida Finalizada!**\n\n` +
					`🔴 ${challengerTeam.name} ${score1} X ${score2} ${challengedTeam.name}\n\n` +
					`${scorersText}\n\n` +
					`🔝 Rankings: \n` +
					`• ${getMention(challengerTeam.owner_discord_id)}: #${challengerRanking.pos} (${challengerScoreBefore.toFixed(2)} -> ${challengerScoreAfter.toFixed(2)} pts)\n` +
					`• ${getMention(challengedTeam.owner_discord_id)}: #${challengedRanking.pos} (${challengedScoreBefore.toFixed(2)} -> ${challengedScoreAfter.toFixed(2)} pts)\n\n` +
					`💰 Recompensas:\n` +
					`• ${getMention(challengerTeam.owner_discord_id)} (${challengerTeam.name}): +${challengerTeam.owner_discord_id === winnerTeam?.owner_discord_id ? winnerCoins : loserCoins} Purple Coins\n` +
					`• ${getMention(challengedTeam.owner_discord_id)} (${challengedTeam.name}): +${challengedTeam.owner_discord_id === winnerTeam?.owner_discord_id ? winnerCoins : loserCoins} Purple Coins`;

				// Enviar para ambos (ephemeral)
				try {
					await interaction.followUp({ content: resultMsg, ephemeral: true });
					// Se possível, enviar para o outro jogador também
					if (interaction.channel && interaction.channel.send) {
						await interaction.channel.send({ content: resultMsg });
					}
				} catch (e) {
					console.warn('Falha ao enviar resultado da partida via followUp:', e && e.message ? e.message : e);
				}

				// Atualizar conquistas para ambos os jogadores (gols, clean sheets, vitórias)
				try {
					const { checkAndMarkConquistas } = require('./conquistas');
					await checkAndMarkConquistas(challengerTeam.owner_discord_id);
					await checkAndMarkConquistas(challengedTeam.owner_discord_id);
				} catch (e) {
					console.error('Erro ao atualizar conquistas após partida:', e && e.message ? e.message : e);
				}
			} catch (err) {
				console.error('Erro no runner da partida:', err);
			}
		})();
	} catch (err) {
		console.error('Erro no handler de desafio:', err);
	}
};
