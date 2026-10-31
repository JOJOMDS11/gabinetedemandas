const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const COR = '#3498DB';

function buildGameplayEmbeds(client) {
    const embed1 = new EmbedBuilder()
        .setColor(COR)
        .setTitle('⚽ Dicas de gameplay: montando um time forte')
        .setDescription('Onde investir seus PC e como escolher as cartas para ganhar mais partidas. Para dicas de economia, use `/dicas`.')
        .addFields(
            {
                name: '🧩 Escalação: olhe os atributos, não só o overall',
                value:
                    '• **GK:** POS (posicionamento), SAI (saída de bola), DEF (defesa) e DRI (drible).\n' +
                    '• **VL:** DEF (roubadas), PAS (passes), FIN (finalização) e DRI (escapar da marcação).\n' +
                    '• **PV:** FIN (chance de gol), POS (presença na área), DRI e PAS (assistências).\n' +
                    '• Use `/mostrarcarta` para ver os atributos antes de escalar com `/escalar`.\n' +
                    '• Cada jogador só pode ocupar uma posição; GK, VL e PV precisam estar preenchidos para jogar.',
                inline: false
            },
            {
                name: '✨ Habilidades (800 PC cada)',
                value:
                    '• **GK:** 🧱 Muralha (sofre menos gols) · 🦅 GK Libero (inicia jogadas) · 🕹️ GK Skill (dribles e saídas ousadas).\n' +
                    '• **VL:** 🎼 Maestro (passe e drible) · 🐶 Pitbull (marcação forte) · 📦 Box to Box (aparece em todos os setores).\n' +
                    '• **PV:** 🎯 Matador (finalização e posicionamento) · 🕵️ Falso 9 (posicionamento e drible) · 🏃 Ponta (drible e passe).\n' +
                    '• Compre com `/comprarhabilidade` e aplique com `/equiparhabilidade`: é **permanente** na carta e o overall máximo é 99.\n' +
                    '• Escolha a habilidade pelo que seu time precisa (defender melhor? criar mais? finalizar?) e coloque nas cartas que você vai **manter**.',
                inline: false
            },
            {
                name: '🎓 Treinador (2.000 PC)',
                value:
                    '• 🅿️ **Jojo** — arruma a marcação e melhora o passe.\n' +
                    '• 🧠 **Silbão** — mais criação de jogadas e finalização.\n' +
                    '• 🧞 **Esquece** — mental forte, apoio ao GK.\n' +
                    '• 🧤 **Rivelindo** — inspira o GK e melhora a saída de bola.\n' +
                    '• 🫃 **Steca** — jogadas e gols inacreditáveis.\n' +
                    '• Combine com o ponto fraco do time. Trocar custa **3.000 PC** de rescisão, então escolha com calma (`/treinador lista`).',
                inline: false
            },
            {
                name: '💼 Patrocínio e evolução de cartas',
                value:
                    '• `/patrocinio` dá bônus de atributos nas partidas (1 patrocínio por time).\n' +
                    '• `/rolarstats` re-sorteia atributos (uma vez por carta, custo por raridade) e `/trocarposicao` muda a posição: ambos usam o **mesmo reroll único**.\n' +
                    '• `/trocarjogadores` funde cartas repetidas: 3 Bagres → Médio, 4 Médios → GOAT, 5 GOATs → Prime.',
                inline: false
            }
        );

    const embed2 = new EmbedBuilder()
        .setColor(COR)
        .setTitle('🏰 Dicas de gameplay: partidas e Torre')
        .addFields(
            {
                name: '🤖 Treine antes de competir',
                value:
                    '• `/amistoso` não conta para estatísticas oficiais — ótimo para testar escalação, treinador e habilidades antes de um `/desafiar`.\n' +
                    '• No `/desafiar`, empate vai para o Gol de Ouro.',
                inline: false
            },
            {
                name: '🛡️ Torre: escolhendo buffs',
                value:
                    '• Antes de cada chefe você escolhe 1 entre 3 buffs de +7 em um atributo (defesa, finalização, passe, drible, posicionamento ou saída de bola). Só existe **1 buff ativo por vez**.\n' +
                    '• Ele vale para o chefe em que foi escolhido e os andares comuns até o próximo chefe; ao chegar no próximo chefe, é removido automaticamente.\n' +
                    '• Nos andares comuns, há **15% de chance de quebrar** o buff após a vitória. Cada chefe derrotado deixa a IA **2 pontos percentuais mais forte** no bloco seguinte.',
                inline: false
            },
            {
                name: '🧿 Relíquias, contratos e eventos',
                value:
                    '• Equipe até **2 relíquias** com `/torre reliquias`: Luvas do Titã (+3 DEF no GK), Chuteira Fantasma (+4 DRI no PV), Cérebro Tático (+2 nos atributos do único buff ativo), Núcleo Purple (+5 p.p. na chance de carta extra) e Segunda Chance (evita perder uma vida, uma vez por temporada).\n' +
                    '• Baús aparecem em **35% dos eventos de chefe**. Se um chefe terminar sem você receber uma relíquia, a vitória sobre o próximo chefe libera um baú garantido; abrir o baú é necessário para receber a relíquia.\n' +
                    '• Contratos de chefe dão mais PC em troca de risco: Sem Misericórdia (+30%), Canhão de Vidro (+35%) e Última Vida (PC dobrado, só com 1 vida). Valem para **uma tentativa**.\n' +
                    '• Eventos após chefes: o Médico pode devolver uma vida; a Arena Amaldiçoada aumenta a recompensa e a dificuldade.',
                inline: false
            },
            {
                name: '❤️ Gerenciando vidas',
                value:
                    '• Você tem 3 vidas por dia, que renovam à meia-noite de Brasília; derrota **não** faz você perder o andar.\n' +
                    '• Derrotar chefes dá +1 vida (máximo 5).\n' +
                    '• Sem vidas? Dá para comprar até 2 por dia (`/torre comprarvida`: 1.000 PC e depois 2.500 PC) ou esperar a renovação com o botão **🔔 lembrete**.\n' +
                    '• Se a run estiver perto de um chefe forte, vale mais esperar as vidas renovarem do que gastar PC no impulso.',
                inline: false
            }
        )
        .setFooter({ text: 'Haxball DreamTeam · /ajuda comando para detalhes de cada comando', iconURL: client?.user?.displayAvatarURL?.() })
        .setTimestamp();

    return [embed1, embed2];
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dicasgameplay')
        .setDescription('🎮 Dicas de gameplay: habilidades, treinador, escalação e Torre'),

    async execute(interaction) {
        try {
            await interaction.reply({ embeds: buildGameplayEmbeds(interaction.client), flags: MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Erro no comando dicasgameplay:', error);
            try {
                const msg = '❌ Erro ao mostrar as dicas de gameplay. Tente novamente.';
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
                }
            } catch (e) {
                console.error('Erro ao enviar fallback de dicasgameplay:', e);
            }
        }
    },

    __test: { buildGameplayEmbeds }
};
