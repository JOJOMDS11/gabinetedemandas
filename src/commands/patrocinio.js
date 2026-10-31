const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { query } = require('../database/connection');
const { removePurpleCoins } = require('../database/models/player');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('patrocinio')
        .setDescription('🏢 Escolha um patrocínio para seu TIME e ganhe bônus na partida!'),

    async execute(interaction) {
        const userId = interaction.user.id;

        try {
            await interaction.deferReply({ ephemeral: true });

            // 1. Buscar time do usuário
            const teams = await query(
                `SELECT id, name, patrocinio_id FROM teams WHERE owner_discord_id = ?`,
                [userId]
            );

            if (teams.length === 0) {
                return await interaction.editReply({
                    content: `❌ Você não possui um time cadastrado.\n\nUse \`/meutime\` para verificar seu time.`,
                    ephemeral: true
                });
            }

            const team = teams[0];

            // 2. Buscar purple coins do jogador (dono do time)
            const [player] = await query(
                'SELECT purple_coins FROM players WHERE discord_id = ?',
                [userId]
            );

            if (!player) {
                return await interaction.editReply({
                    content: '❌ Jogador não encontrado. Use `/criarjogador` primeiro.',
                    ephemeral: true
                });
            }

            // 3. Verificar se já tem patrocínio ATIVO nesta temporada
            if (team.patrocinio_id) {
                const [currentPatrocinio] = await query(
                    'SELECT nome, descricao, bonus_atributo, bonus_valor FROM patrocinios WHERE id = ?',
                    [team.patrocinio_id]
                );

                return await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setColor('#FFA500')
                        .setTitle('⚠️ Patrocínio já Ativo nesta Temporada')
                        .setDescription(`Seu time **${team.name}** já possui um patrocínio ativo!`)
                        .addFields(
                            { name: '🏢 Patrocinador', value: currentPatrocinio.nome, inline: true },
                            { name: '📈 Bônus em Partida', value: `+${currentPatrocinio.bonus_valor} ${currentPatrocinio.bonus_atributo}`, inline: true },
                            { name: '💡 Importante', value: 'Você só pode escolher **UM patrocínio por temporada**. O bônus será aplicado no simulador de partidas.', inline: false }
                        )
                        .setFooter({ text: 'Patrocínio ativo para toda a temporada!' })
                        .setTimestamp()
                    ],
                    ephemeral: true
                });
            }

            // 3. Buscar patrocínios disponíveis
            const patrocinios = await query(
                'SELECT id, nome, descricao, bonus_atributo, bonus_valor, custo_purple_coins FROM patrocinios WHERE ativo = TRUE ORDER BY nome'
            );

            if (patrocinios.length === 0) {
                return await interaction.editReply({
                    content: '❌ Nenhum patrocínio disponível no momento.',
                    ephemeral: true
                });
            }

            // 4. Criar select menu
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`patrocinio_select_${team.id}`)
                .setPlaceholder('🏢 Escolha um patrocinador para seu time')
                .addOptions(
                    patrocinios.map(p => ({
                        label: `${p.nome} - ${p.custo_purple_coins} PC`,
                        description: `+${p.bonus_valor} ${p.bonus_atributo} | ${p.descricao.substring(0, 50)}`,
                        value: p.id.toString(),
                        emoji: p.nome === 'Sprite' ? '🥤' : p.nome === 'Fanta' ? '🍊' : '⚡'
                    }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const embed = new EmbedBuilder()
                .setColor('#00D9FF')
                .setTitle('🏢 Escolha o Patrocinador do seu Time')
                .setDescription(`Escolha **UM patrocínio** para o time **${team.name}** nesta temporada!\n\n**💰 Purple Coins disponíveis:** ${player.purple_coins} PC\n⚠️ **Importante:** O bônus será aplicado no simulador de partidas!`)
                .addFields(
                    patrocinios.map(p => ({
                        name: `${p.nome} - ${p.custo_purple_coins} PC`,
                        value: `📈 Bônus: **+${p.bonus_valor} ${p.bonus_atributo}** (aplicado em partidas)\n📝 ${p.descricao}`,
                        inline: false
                    }))
                )
                .setFooter({ text: 'Bônus ativo no simulador durante toda a temporada!' })
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                components: [row],
                ephemeral: true
            });

            // 5. Coletor de interações
            const collector = interaction.channel.createMessageComponentCollector({
                filter: i => i.customId.startsWith('patrocinio_select_') && i.user.id === userId,
                time: 60000,
                max: 1
            });

            collector.on('collect', async i => {
                try {
                    await i.deferUpdate();

                    const patrocinioId = parseInt(i.values[0]);

                    // Re-buscar purple coins atualizados do jogador
                    const [currentPlayer] = await query(
                        'SELECT purple_coins FROM players WHERE discord_id = ?',
                        [userId]
                    );

                    // Buscar dados do patrocínio
                    const [patrocinio] = await query(
                        'SELECT nome, descricao, bonus_atributo, bonus_valor, custo_purple_coins FROM patrocinios WHERE id = ?',
                        [patrocinioId]
                    );

                    if (!patrocinio) {
                        return await i.editReply({
                            content: '❌ Patrocínio não encontrado.',
                            components: [],
                            embeds: [],
                            ephemeral: true
                        });
                    }

                    // Verificar se tem Purple Coins suficientes
                    if (currentPlayer.purple_coins < patrocinio.custo_purple_coins) {
                        return await i.editReply({
                            content: `❌ Purple Coins insuficientes!\n\nVocê tem: **${currentPlayer.purple_coins} PC**\nNecessário: **${patrocinio.custo_purple_coins} PC**`,
                            components: [],
                            embeds: [],
                            ephemeral: true
                        });
                    }

                    // Aplicar patrocínio ao TIME e descontar do JOGADOR
                    await query(
                        `UPDATE teams 
                         SET patrocinio_id = ?, data_patrocinio = NOW()
                         WHERE id = ?`,
                        [patrocinioId, team.id]
                    );

                    await removePurpleCoins(userId, patrocinio.custo_purple_coins, {
                        transactionType: 'SPEND',
                        itemType: 'patrocinio',
                        itemName: patrocinio.nome,
                        metadata: {
                            source: 'patrocinio_compra',
                            teamId: team.id,
                            teamName: team.name
                        }
                    });

                    // Mensagem de sucesso
                    const successEmbed = new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('✅ Patrocínio Contratado com Sucesso!')
                        .setDescription(`Parabéns! O time **${team.name}** agora é patrocinado pela **${patrocinio.nome}**!`)
                        .addFields(
                            { name: '🏢 Patrocinador', value: patrocinio.nome, inline: true },
                            { name: '📈 Bônus em Partida', value: `+${patrocinio.bonus_valor} ${patrocinio.bonus_atributo}`, inline: true },
                            { name: '💰 Custo', value: `${patrocinio.custo_purple_coins} PC`, inline: true },
                            { name: '💳 Saldo Restante', value: `${currentPlayer.purple_coins - patrocinio.custo_purple_coins} PC`, inline: true },
                            { name: '📝 Descrição', value: patrocinio.descricao, inline: false },
                            { name: '⚡ Efeito', value: `O bônus de **+${patrocinio.bonus_valor} ${patrocinio.bonus_atributo}** será aplicado automaticamente no simulador de partidas!`, inline: false }
                        )
                        .setFooter({ text: 'Patrocínio ativo durante toda a temporada!' })
                        .setTimestamp();

                    await i.editReply({
                        embeds: [successEmbed],
                        components: [],
                        ephemeral: true
                    });

                    console.log(`✅ [PATROCINIO] Time ${team.name} (ID: ${team.id}) contratou ${patrocinio.nome} (+${patrocinio.bonus_valor} ${patrocinio.bonus_atributo})`);

                } catch (error) {
                    console.error('Erro ao processar patrocínio:', error);
                    await i.editReply({
                        content: '❌ Erro ao processar patrocínio. Tente novamente.',
                        components: [],
                        embeds: [],
                        ephemeral: true
                    });
                }
            });

            collector.on('end', async (collected) => {
                if (collected.size === 0) {
                    try {
                        await interaction.editReply({
                            content: '⏱️ Tempo esgotado! Use o comando novamente para escolher um patrocínio.',
                            components: [],
                            embeds: [],
                            ephemeral: true
                        });
                    } catch (error) {
                        // Ignorar erro se a interação já expirou
                    }
                }
            });

        } catch (error) {
            console.error('Erro no comando /patrocinio:', error);
            const errorMessage = '❌ Ocorreu um erro ao processar o comando. Tente novamente.';
            
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }
};
