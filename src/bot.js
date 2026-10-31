const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { connectDB, query } = require('./database/connection');
const { handleTournamentEmbedInteraction } = require('./utils/tournamentEmbedHandler');
const { REST, Routes } = require('discord.js');
const express = require('express');
const path = require('path');
const cors = require('cors');
const adminRoutes = require('./routes/adminRoutes');
const apiRouter = require('./api/routes');
const fs = require('fs');
require('dotenv').config();

// Carregar comandos dinamicamente
const commands = new Map();
const commandsPath = path.join(__dirname, 'commands');
const HIDDEN_COMMANDS = new Set(['criarjogador.js']);
fs.readdirSync(commandsPath)
    .filter(file => file.endsWith('.js'))
    .filter(file => !HIDDEN_COMMANDS.has(file))
    .forEach(file => {
        const command = require(path.join(commandsPath, file));
        if (command.data && command.execute) {
            commands.set(command.data.name, command);
        }
    });

// Função para registrar comandos slash (mock simples)

async function registerSlashCommandsAuto(clientId, token) {
    const commandsArray = Array.from(commands.values()).map(cmd => cmd.data.toJSON());
    const rest = new REST({ version: '10' }).setToken(token);
    const guildId = process.env.DISCORD_GUILD_ID;

    try {
        console.log('🚀 Registrando comandos slash no Discord...');

        if (guildId) {
            await rest.put(
                Routes.applicationGuildCommands(clientId, guildId),
                { body: commandsArray }
            );
            console.log(`✅ Comandos slash registrados na guild ${guildId}!`);
        } else {
            await rest.put(
                Routes.applicationCommands(clientId),
                { body: commandsArray }
            );
            console.log('✅ Comandos slash registrados globalmente!');
        }

        const currentCommands = guildId
            ? await rest.get(Routes.applicationGuildCommands(clientId, guildId))
            : await rest.get(Routes.applicationCommands(clientId));

        const expectedNames = new Set(commandsArray.map(cmd => cmd.name));
        const stale = currentCommands.filter(cmd => !expectedNames.has(cmd.name));
        for (const cmd of stale) {
            try {
                if (guildId) {
                    await rest.delete(Routes.applicationGuildCommand(clientId, guildId, cmd.id));
                } else {
                    await rest.delete(Routes.applicationCommand(clientId, cmd.id));
                }
                console.log(`🧹 Comando obsoleto removido: ${cmd.name}`);
            } catch (err) {
                console.warn(`⚠️ Não foi possível remover ${cmd.name}:`, err?.message || err);
            }
        }
    } catch (error) {
        console.error('❌ Erro ao registrar comandos slash:', error);
    }
}

// Manipulador de comandos slash
async function handleSlashCommand(interaction) {
    const startTime = Date.now();
    const command = commands.get(interaction.commandName);
    if (!command) return;
    
    try {
        await command.execute(interaction);
        const duration = Date.now() - startTime;
        if (duration > 2000) {
            console.warn(`⚠️ Comando /${interaction.commandName} demorou ${duration}ms (risco de timeout)`);
        }
    } catch (error) {
        console.error(`❌ Erro ao executar comando /${interaction.commandName}:`, error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Erro ao executar o comando.', ephemeral: true });
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply('❌ Erro ao executar o comando.');
            } else {
                await interaction.followUp({ content: '❌ Erro ao executar o comando.', ephemeral: true });
            }
        } catch (err) {
            console.error('Falha ao notificar usuário sobre erro:', err);
        }
    }
}

// Helper para defer seguro (evita "Unknown interaction")
async function safeDeferReply(interaction, options = {}) {
    try {
        await interaction.deferReply(options);
        return { success: true, deferred: true };
    } catch (deferErr) {
        console.error(`Erro ao fazer defer (interação expirou?): ${deferErr?.message || deferErr}`);
        try {
            await interaction.reply({ content: '❌ Interação expirou. Tente novamente.', ephemeral: true });
        } catch (replyErr) {
            console.error('Falha ao notificar sobre defer:', replyErr?.message || replyErr);
        }
        return { success: false, deferred: false };
    }
}

// Funções mock para handlers antigos
let handleChallengeInteraction = async () => { };
const handleTournamentInteraction = async () => { };

// Dispatcher genérico para handlers de upgrade/venda (procura no comando `trocarjogadores`)
const handleUpgradeInteraction = async (interaction) => {
    try {
        const cmd = commands.get('trocarjogadores');
        if (cmd && typeof cmd.handleUpgradeInteraction === 'function') {
            return await cmd.handleUpgradeInteraction(interaction);
        }
        console.warn('⚠️ Handler de upgrade não encontrado em comandos');
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Handler de upgrade indisponível no momento.', ephemeral: true });
        } else {
            try { await interaction.followUp({ content: '❌ Handler de upgrade indisponível no momento.', ephemeral: true }); } catch (e) { }
        }
    } catch (err) {
        console.error('Erro ao despachar handleUpgradeInteraction:', err);
        try { await interaction.reply({ content: '❌ Erro interno ao processar interação de upgrade.', ephemeral: true }); } catch (e) { }
    }
};

// Criar servidor HTTP para o Render
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Montar router da API
app.use('/api', apiRouter);
app.use('/admin', adminRoutes);

// Rota básica para health check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot: client.user?.tag || 'Desconectado',
        timestamp: new Date().toISOString(),
        api_endpoints: [
            '/api/players',
            '/api/teams',
            '/api/tournaments',
            '/api/stats'
        ]
    });
});

// Rota para ping frequente (keep-alive do bot no Render)
app.get('/pingbot', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// Health check robusto para Uptime Robot - MELHORADO
app.get('/health', (req, res) => {
    try {
        const isHealthy = client?.ws?.status === 0 && client?.user; // 0 = READY
        const healthStatus = {
            status: isHealthy ? 'healthy' : 'degraded',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            memoryUsage: process.memoryUsage(),
            botStatus: client?.user ? 'online' : 'offline',
            wsStatus: client?.ws?.status ?? 'unknown',
            ping: client?.ws?.ping ?? -1
        };
        
        // Retornar 200 sempre para evitar alerta no Uptime Robot
        // Mesmo se estiver degraded, o processo está vivo
        res.status(200).json(healthStatus);
    } catch (error) {
        console.error('Erro no health check:', error);
        res.status(200).json({ 
            status: 'error', 
            uptime: process.uptime(),
            error: error.message 
        });
    }
});

// Endpoint alternativo para keep-alive (HEAD request)
app.head('/health', (req, res) => {
    res.status(200).end();
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🌐 Servidor rodando em http://localhost:${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Handler para fazer lance em leilão
async function handleLeilaoLance(interaction, leilaoId, leilaoCmd) {
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
    const leilao = leilaoCmd.getLeilaoAtivo(leilaoId);
    if (!leilao) return interaction.reply({ content: '❌ Este leilão não está mais ativo.', ephemeral: true });
    if (String(leilao.vendedorId) === String(interaction.user.id)) {
        return interaction.reply({ content: '❌ Você não pode dar lance na sua própria carta!', ephemeral: true });
    }
    if (Date.now() > leilao.encerraEm) {
        return interaction.reply({ content: '❌ Este leilão já encerrou.', ephemeral: true });
    }

    const modal = new ModalBuilder()
        .setCustomId(`modal_lance_${leilaoId}`)
        .setTitle('Fazer Lance no Leilão');
    const lanceInput = new TextInputBuilder()
        .setCustomId('valor_lance')
        .setLabel('Valor do Lance (Purple Coins)')
        .setPlaceholder(`Valor mínimo: ${(Number(leilao.valorAtual) + 100).toLocaleString('pt-BR')}`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(lanceInput));
    await interaction.showModal(modal);

    let submittedInteraction = null;
    try {
        const submitted = await interaction.awaitModalSubmit({
            filter: i => i.customId === `modal_lance_${leilaoId}` && i.user.id === interaction.user.id,
            time: 120000
        });
        submittedInteraction = submitted;
        const raw = submitted.fields.getTextInputValue('valor_lance').trim();
        const bid = Number(raw.replace(/[.\s]/g, '').replace(',', '.'));
        if (!Number.isSafeInteger(bid) || bid <= 0) {
            return submitted.reply({ content: '❌ Informe um valor inteiro válido de Purple Coins.', ephemeral: true });
        }
        const result = await leilaoCmd.registrarLance(leilaoId, interaction.user.id, interaction.user.tag, bid, interaction.client);
        return submitted.reply({ content: result.message, ephemeral: true });
    } catch (error) {
        const message = error.message || 'Não foi possível registrar seu lance.';
        if (message.includes('Collector received no interactions')) return;
        console.warn('[leilao] Lance recusado/falhou:', message);
        try {
            if (submittedInteraction && !submittedInteraction.replied) {
                await submittedInteraction.reply({ content: `❌ ${message}`, ephemeral: true });
            }
        } catch (_) { }
    }
}

// Handler para cancelar leilão
async function handleLeilaoCancelar(interaction, leilaoId, leilaoCmd) {
    const { EmbedBuilder } = require('discord.js');
    
    const leilaoAtivo = leilaoCmd.getLeilaoAtivo(leilaoId);
    const result = await leilaoCmd.cancelarLeilao(leilaoId, interaction.user.id);
    
    if (!result.success) {
        return interaction.reply({ content: `❌ ${result.message}`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
        .setTitle('🔨 Leilão Cancelado')
        .setDescription('O leilão foi cancelado pelo vendedor.')
        .setColor('#FF0000');

    if (leilaoAtivo && leilaoAtivo.imageName) embed.setImage(`attachment://${leilaoAtivo.imageName}`);

    await interaction.update({ embeds: [embed], components: [] });
}

// O fluxo atual de patrocínio é tratado pelo comando /patrocinio.
client.once('clientReady', async () => {
    console.log(`🎮 ${client.user.tag} está online!`);
    console.log(`📊 Conectado a ${client.guilds.cache.size} servidor(es)`);

    // Carregar emojis personalizados do servidor
    try {
        const { autoPopulateEmojis } = require('./utils/customEmojiHandler');
        const emojis = autoPopulateEmojis(client);
        global.CUSTOM_EMOJIS = emojis; // Tornar acessível globalmente
        console.log(`🎨 ${Object.keys(emojis).length} emojis personalizados carregados`);
    } catch (error) {
        console.warn('⚠️ Erro ao carregar emojis personalizados:', error.message);
    }

    // Registrar comandos slash automaticamente ao iniciar
    const token = process.env.DISCORD_TOKEN || 'SEU_TOKEN_AQUI';
    const clientId = client.user.id;
    if (token && token !== 'SEU_TOKEN_AQUI') {
        await registerSlashCommandsAuto(clientId, token);
    } else {
        console.warn('⚠️  Token do Discord não encontrado. Comandos slash não foram registrados.');
    }

    // Conectar ao banco de dados (opcional)
    try {
        await connectDB();
        console.log('✅ Banco de dados conectado e tabelas criadas');
        try {
            await require('./commands/leilao').inicializarLeiloes(client);
        } catch (auctionError) {
            console.error('❌ Não foi possível restaurar leilões ativos:', auctionError.message);
        }
    } catch (error) {
        console.error('❌ Erro ao conectar ao banco:', error);
        console.log('⚠️  Bot continuará funcionando sem banco de dados');
    }

    // Definir status do bot
    client.user.setActivity('🥅 Haxball DreamTeam', { type: ActivityType.Playing });
});

// Manipular interações (comandos slash, botões, etc.)
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
    } else if (interaction.isAutocomplete()) {
        const autoCommand = commands.get(interaction.commandName);
        if (autoCommand && typeof autoCommand.autocomplete === 'function') {
            try {
                await autoCommand.autocomplete(interaction);
            } catch (err) {
                console.error(`Erro no autocomplete de /${interaction.commandName}:`, err && err.message ? err.message : err);
            }
        }
    } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('tower_buff|')) {
            try { await require('./commands/torre').handleBuffSelection(interaction); }
            catch (err) { console.error('[torre] Erro ao processar escolha de buff:', err); try { await interaction.reply({ content: '❌ Não foi possível salvar seu buff.', ephemeral: true }); } catch (_) {} }
        } else if (interaction.customId.startsWith('tower_craft|')) {
            try { await require('./commands/torre').handleCraftSelection(interaction); }
            catch (err) { console.error('[torre] Erro ao fabricar relíquia:', err); try { await interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }); } catch (_) {} }
        } else if (interaction.customId.startsWith('tower_relics|')) {
            try { await require('./commands/torre').handleRelicSelection(interaction); }
            catch (err) { console.error('[torre] Erro ao equipar relíquias:', err); try { await interaction.reply({ content: '❌ Não foi possível equipar as relíquias.', ephemeral: true }); } catch (_) {} }
        } else if (interaction.customId.startsWith('tower_relic_position|')) {
            try { await require('./commands/torre').handleRelicPositionSelection(interaction); }
            catch (err) { console.error('[torre] Erro ao definir posição do Ímã:', err); try { await interaction.followUp({ content: '❌ Não foi possível salvar a posição favorecida.', ephemeral: true }); } catch (_) {} }
        } else if (interaction.customId.startsWith('tower_event|')) {
            try { await require('./commands/torre').handleEventSelection(interaction); }
            catch (err) { console.error('[torre] Erro ao resolver evento:', err); try { await interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }); } catch (_) {} }
        } else if (interaction.customId.startsWith('tower_contract|')) {
            try { await require('./commands/torre').handleContractSelection(interaction); }
            catch (err) { console.error('[torre] Erro ao aceitar contrato:', err); try { await interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }); } catch (_) {} }
        } else if (interaction.customId.startsWith('equip_pick_')) {
            try {
                const equipCmd = require('./commands/equiparhabilidade');
                await equipCmd.handleEquipPick(interaction);
            } catch (err) {
                console.error('Erro ao despachar equip_pick:', err);
            }
        }
    } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('tower_challenge|')) {
            try { await require('./commands/torre').handleAscendantChallengeButton(interaction); }
            catch (err) {
                console.error('[torre] Erro ao aceitar o Desafio do Ascendente:', err);
                try { await interaction.reply({ content: `❌ ${err.message || 'Não foi possível aceitar o desafio.'}`, ephemeral: true }); } catch (_) {}
            }
        }
        // Botão de lembrete (/obter, /pacote e vidas da /torre)
        else if (interaction.customId.startsWith('lembrete|')) {
            try {
                await require('./commands/lembrete').handleReminderButton(interaction);
            } catch (err) {
                console.error('Erro ao processar botão de lembrete:', err);
                try { await interaction.reply({ content: '❌ Não foi possível ativar o lembrete.', ephemeral: true }); } catch (e) { }
            }
        }
        // Verificar se é uma interação de desafio
        else if (interaction.customId.startsWith('accept_') || interaction.customId.startsWith('decline_')) {
            // Try to load the desafiar command and use its handler if available
            try {
                const desafiarCmd = require('./commands/desafiar');
                if (desafiarCmd && typeof desafiarCmd.handleChallengeInteraction === 'function') {
                    handleChallengeInteraction = desafiarCmd.handleChallengeInteraction;
                }
            } catch (err) {
                console.warn('⚠️ Não foi possível carregar o handler de desafiar:', err);
            }

            try {
                await handleChallengeInteraction(interaction);
            } catch (err) {
                console.error('Erro ao despachar handleChallengeInteraction:', err);
                try { await interaction.reply({ content: '❌ Erro ao processar este botão.', ephemeral: true }); } catch (e) { }
            }
        }
        // Verificar se é uma interação de paginação de cartas
        else if (interaction.customId.startsWith('cards_')) {
            // Importar as funções de paginação dinamicamente
            try {
                const mostrarcartas = require('./commands/mostrarcartas');
                const minhascartas = require('./commands/minhascartas');

                // Tentar ambas as funções de paginação
                if (mostrarcartas.handleInteraction) {
                    await mostrarcartas.handleInteraction(interaction);
                } else if (minhascartas.handleInteraction) {
                    await minhascartas.handleInteraction(interaction);
                } else {
                    console.warn('⚠️ Função de paginação não encontrada');
                }
            } catch (error) {
                console.error('❌ Erro na paginação de cartas:', error);
                await interaction.reply({
                    content: '❌ Erro ao navegar nas páginas. Tente usar o comando novamente.',
                    ephemeral: true
                });
            }
        }
        // Verificar se é uma interação de torneio
        else if (interaction.customId.startsWith('tournament_') || interaction.customId.startsWith('join_tournament_')) {
            await handleTournamentInteraction(interaction);
        }
        else if (interaction.customId.startsWith('confirmar_compra_')) {
            try {
                const comprarCmd = require('./commands/comprarhabilidade');
                if (comprarCmd && typeof comprarCmd.handleConfirmPurchase === 'function') {
                    await comprarCmd.handleConfirmPurchase(interaction);
                } else {
                    await interaction.reply({ content: 'Handler de confirmação indisponível.', ephemeral: true });
                }
            } catch (err) {
                console.error('Erro ao despachar confirmar_compra:', err);
                try { await interaction.reply({ content: 'Erro ao processar confirmação de compra.', ephemeral: true }); } catch (e) { }
            }
        }
        else if (interaction.customId.startsWith('equip_later_')) {
            try {
                const equipCmd = require('./commands/equiparhabilidade');
                await equipCmd.handleEquipLater(interaction);
            } catch (err) {
                console.error('Erro ao despachar equip_later:', err);
            }
        }
        // Equipar habilidade confirmation/cancel
        else if (interaction.customId.startsWith('confirm_equip_') || interaction.customId.startsWith('cancel_equip_')) {
            try {
                const equipCmd = require('./commands/equiparhabilidade');
                if (equipCmd && typeof equipCmd.handleConfirmEquip === 'function') {
                    await equipCmd.handleConfirmEquip(interaction);
                } else {
                    await interaction.reply({ content: 'Handler de confirmação indisponível.', ephemeral: true });
                }
            } catch (err) {
                console.error('Erro ao despachar confirm_equip/cancel_equip:', err);
                try { await interaction.reply({ content: 'Erro ao processar confirmação de equipar habilidade.', ephemeral: true }); } catch (e) { }
            }
        }
        // Verificar se é uma interação de upgrade/venda
        else if (interaction.customId.startsWith('upgrade_')) {
            await handleUpgradeInteraction(interaction);
        }
        // Verificar se é uma interação do torneioembed
        else if (interaction.customId.includes('_torneio_')) {
            await handleTournamentEmbedInteraction(interaction);
        }
        // Verificar se é uma interação de torneio
        else if (interaction.customId.startsWith('startMatch|')) {
            try {
                const { handleStartMatch } = require('./commands/iniciartorneio');
                await handleStartMatch(interaction);
            } catch (err) {
                console.error('Erro ao processar partida do torneio:', err);
                try { await interaction.reply({ content: '❌ Erro ao processar partida.', ephemeral: true }); } catch (e) { }
            }
        }
        // Confirmação/cancelamento do reroll único de atributos.
        else if (interaction.customId.startsWith('reroll_confirm|') || interaction.customId.startsWith('reroll_cancel|')) {
            try {
                await require('./commands/rolarstats').handleRerollButton(interaction);
            } catch (err) {
                console.error('[rolarstats] Erro ao processar confirmação:', err);
                try {
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ Não foi possível processar o reroll.', ephemeral: true });
                    } else {
                        await interaction.editReply({ content: '❌ Não foi possível processar o reroll.', embeds: [], components: [] });
                    }
                } catch (_) { }
            }
        }
        // Verificar se é uma interação de leilão
        else if (interaction.customId.startsWith('leilao_lance_') || interaction.customId.startsWith('leilao_cancelar_')) {
            try {
                const leilaoCmd = require('./commands/leilao');
                const leilaoId = interaction.customId.split('_')[2];
                
                if (interaction.customId.startsWith('leilao_lance_')) {
                    await handleLeilaoLance(interaction, leilaoId, leilaoCmd);
                } else if (interaction.customId.startsWith('leilao_cancelar_')) {
                    await handleLeilaoCancelar(interaction, leilaoId, leilaoCmd);
                }
            } catch (err) {
                console.error('Erro ao processar leilão:', err);
                try { 
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '❌ Erro ao processar leilão.', ephemeral: true }); 
                    }
                } catch (e) { }
            }
        }
        else if (interaction.customId.startsWith('trocapos_')) {
            try {
                await require('./commands/trocarposicao').handleTrocaPosicaoButton(interaction);
            } catch (err) {
                console.error('Erro ao despachar botão de troca de posição:', err);
            }
        }
        else if (interaction.customId.startsWith('conq_')) {
            try {
                await require('./commands/conquistas').handleConquistaButton(interaction);
            } catch (err) {
                console.error('Erro ao despachar botão de conquistas:', err);
            }
        }
    }
});

// Manipular mensagens (para futuros recursos)
client.on('messageCreate', message => {
    if (message.author.bot) return;

    // Aqui pode adicionar comandos por texto no futuro
    // Por enquanto, só comandos slash
});

process.on('unhandledRejection', error => {
    console.error('❌ Promise rejeitada não tratada:', error);
});

process.on('uncaughtException', error => {
    console.error('❌ Exceção não tratada:', error);
});

// Manipular erros
client.on('error', error => {
    console.error('❌ Erro do Discord.js:', error);
});

// Login do bot
const token = process.env.DISCORD_TOKEN;

if (!token || token === 'SEU_TOKEN_AQUI' || token.trim() === '') {
    console.error('❌ DISCORD_TOKEN não configurado ou inválido!');
    console.error('📝 Configure a variável de ambiente DISCORD_TOKEN no Render com seu token do Discord.');
    console.error('🔗 Obtenha seu token em: https://discord.com/developers/applications');
    process.exit(1);
}

console.log('🔑 Token sendo usado:', token.substring(0, 20) + '...');

client.login(token).catch(error => {
    console.error('❌ Erro ao fazer login no Discord:', error);
    console.error('');
    console.error('💡 Possíveis causas:');
    console.error('   1. Token inválido ou expirado');
    console.error('   2. Token não configurado corretamente no Render');
    console.error('   3. Bot foi deletado no Discord Developer Portal');
    console.error('');
    console.error('🔧 Soluções:');
    console.error('   1. Verifique se o token está correto no Discord Developer Portal');
    console.error('   2. Atualize a variável DISCORD_TOKEN no Render');
    console.error('   3. Certifique-se de que não há espaços antes/depois do token');
    process.exit(1);
});
