const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const COR = '#9B59B6';

// ───────────────────────────────────────────────────────────────────────────
// Catálogo usado por `/ajuda comando`.
// Para documentar um comando novo, basta adicionar um objeto aqui.
// Campos: nome, cat, uso, resumo, detalhes[], relacionados[]
// ───────────────────────────────────────────────────────────────────────────
const CATEGORIAS = {
    inicio: '🚀 Primeiros passos',
    cartas: '🎴 Cartas e coleção',
    time: '⚽ Time e escalação',
    partidas: '⚔️ Partidas e Torre',
    economia: '💜 Purple Coins e recompensas',
    evolucao: '📈 Evolução de cartas',
    mercado: '🔨 Mercado',
    visual: '🎨 Personalização',
    torneios: '🏆 Torneios',
    adm: '🛠️ Somente ADM',
    ajuda: '❓ Ajuda'
};

const COMANDOS = [
    // ── Primeiros passos ──────────────────────────────────────────────────
    {
        nome: 'registrartime', cat: 'inicio', uso: '/registrartime nome:<nome do time>',
        resumo: 'Cria o seu time. É o primeiro passo obrigatório.',
        detalhes: [
            'Sem time registrado, `/obter`, `/pacote` e `/torre` não funcionam (e não gastam cooldown).',
            'Depois de registrar, escale GK, VL e PV com `/escalar`.'
        ],
        relacionados: ['escalar', 'mudarnometime', 'obter']
    },
    {
        nome: 'obter', cat: 'inicio', uso: '/obter',
        resumo: 'Recebe 1 carta grátis (+10 PC) a cada uso.',
        detalhes: [
            'Exige time registrado (`/registrartime`).',
            'Cooldown: **15 min** (padrão), **10 min** (Sub/Booster) ou **8 min** (Purple). O cargo é verificado nos servidores oficiais.',
            'Quando estiver em cooldown, a resposta mostra o tempo restante e um botão **🔔 Me avisar quando liberar**: ele te avisa por DM (ou no canal, se sua DM estiver fechada). O lembrete é temporário e pode ser perdido se o bot reiniciar antes do horário.',
            'Conta para as missões do tipo "obter".'
        ],
        relacionados: ['pacote', 'missao', 'torre']
    },
    {
        nome: 'pacote', cat: 'inicio', uso: '/pacote',
        resumo: 'Recebe 3 cartas grátis e +15 PC por pacote.',
        detalhes: [
            'Exige time registrado.',
            'Cooldown: **2h30** (padrão), **2h** (Sub/Booster) ou **1h40** (Purple).',
            'Em cooldown aparece o tempo restante e o botão **🔔 Me avisar quando liberar**. O lembrete é temporário e pode ser perdido se o bot reiniciar antes do horário.',
            'Pacotes de chefe da Torre são abertos automaticamente e **não** consomem esse cooldown.'
        ],
        relacionados: ['obter', 'comprarpacote', 'torre']
    },
    {
        nome: 'loginreward', cat: 'inicio', uso: '/loginreward',
        resumo: 'Recompensa diária de login (ciclo de 7 dias).',
        detalhes: [
            'Resgate uma vez por dia para manter a sequência.',
            'Os prêmios incluem pacotes e cartas especiais (GOAT/Prime) em alguns dias do ciclo; ao completar os 7 dias o ciclo recomeça.'
        ],
        relacionados: ['missao', 'conquistas']
    },
    {
        nome: 'missao', cat: 'economia', uso: '/missao',
        resumo: 'Missão diária com recompensa em Purple Coins.',
        detalhes: [
            'Tipos: **obter** cartas, **jogar** partidas (`/desafiar`), **ganhar** partidas, marcar **gols** e **vender** cartas.',
            'Existem 3 níveis (🟡 Normal, 🔴 Rara, 🟣 Épica) — quanto maior, mais PC.',
            'Quando completar, use `/missao` de novo para resgatar a recompensa. Depois que o tempo da missão acaba, ela é renovada.'
        ],
        relacionados: ['loginreward', 'conquistas', 'purplecoins']
    },
    {
        nome: 'conquistas', cat: 'economia', uso: '/conquistas',
        resumo: 'Mostra suas conquistas e o progresso de cada uma.',
        detalhes: [
            'São 33 conquistas (coleção, vitórias, gols, clean sheets, trocas e Purple Coins). As recompensas somam **20.871 PC por ciclo**: GOAT 1.736 · Prime 2.150 · Prime Purple 5.375 · vitórias 2.022 · gols 1.997 · clean sheets 1.748 · trocas 2.151 · cartas 2.192 · Magnata 1.500 PC.',
            'Resgate as prontas com `/resgatarconquista`; o comando mostra o valor de cada uma antes de confirmar.',
            'Quando todas as 33 forem resgatadas, um novo ciclo começa. O progresso de vitórias, gols, cartas, trocas e PC passa a contar a partir do novo marco, sem reaproveitar metas antigas.'
        ],
        relacionados: ['resgatarconquista', 'missao']
    },
    {
        nome: 'resgatarconquista', cat: 'economia', uso: '/resgatarconquista',
        resumo: 'Escolhe uma conquista concluída para resgatar a recompensa.',
        detalhes: [
            'Só aparecem as conquistas já concluídas e ainda não resgatadas; o seletor mostra a recompensa em PC de cada uma.',
            'As 33 conquistas somam **20.871 PC por ciclo**. Depois de resgatar todas, o ciclo reinicia e você pode conquistar tudo novamente.'
        ],
        relacionados: ['conquistas']
    },
    {
        nome: 'purplecoins', cat: 'economia', uso: '/purplecoins',
        resumo: 'Mostra o seu saldo de Purple Coins (PC).',
        detalhes: ['Veja `/dicas` para estratégias de como juntar mais PC.'],
        relacionados: ['dicas', 'loja', 'codigo']
    },
    {
        nome: 'loja', cat: 'economia', uso: '/loja',
        resumo: 'Abre o link da loja JojoVendas.',
        detalhes: [
            'Lá você compra Purple Coins, cartas Prime, bordas e fundos customizados.',
            'Depois use `/resgatarborda`, `/resgatarfundo`, `/equiparborda` e `/equiparfundo`.'
        ],
        relacionados: ['resgatarborda', 'resgatarfundo', 'codigo']
    },
    {
        nome: 'codigo', cat: 'economia', uso: '/codigo codigo:<código>',
        resumo: 'Resgata um código de Purple Coins.',
        detalhes: ['Cada código tem validade e limite de usos, e cada jogador só resgata o mesmo código uma vez.'],
        relacionados: ['codigocarta', 'purplecoins']
    },
    {
        nome: 'codigocarta', cat: 'cartas', uso: '/codigocarta codigo:<código>',
        resumo: 'Resgata uma carta PRIME usando um código.',
        detalhes: ['A carta é adicionada ao seu elenco; veja o ID dela com `/mostrarcarta` ou `/minhascartas`.'],
        relacionados: ['codigo', 'loja']
    },

    // ── Cartas ────────────────────────────────────────────────────────────
    {
        nome: 'elenco', cat: 'cartas', uso: '/elenco',
        resumo: 'Lista rápida do seu elenco de cartas.',
        detalhes: ['Use para descobrir o **ID** das cartas antes de usar `/escalar`, `/vender`, `/leilao` etc.'],
        relacionados: ['minhascartas', 'escalar']
    },
    {
        nome: 'vercartas', cat: 'cartas', uso: '/vercartas',
        resumo: 'Versão simples para ver suas cartas.',
        detalhes: ['Para filtros e paginação, prefira `/minhascartas`.'],
        relacionados: ['minhascartas', 'elenco']
    },
    {
        nome: 'minhascartas', cat: 'cartas', uso: '/minhascartas [raridade] [posicao] [jogador] [colecao] [stats]',
        resumo: 'Vê suas cartas com filtros e paginação.',
        detalhes: [
            'Filtre por raridade, posição, nome do jogador ou coleção.',
            'Ative a opção **stats** para ver os atributos detalhados.'
        ],
        relacionados: ['mostrarcartas', 'mostrarcarta']
    },
    {
        nome: 'mostrarcartas', cat: 'cartas', uso: '/mostrarcartas [raridade] [posicao] [jogador] [colecao] [stats]',
        resumo: 'Mesma consulta do /minhascartas, em versão pública.',
        detalhes: ['Boa para mostrar sua coleção para a galera do canal.'],
        relacionados: ['minhascartas']
    },
    {
        nome: 'mostrarcarta', cat: 'cartas', uso: '/mostrarcarta id:<ID da carta>',
        resumo: 'Mostra uma carta específica com imagem e detalhes.',
        detalhes: [
            'Exibe posição, overall, habilidade equipada, coleção e borda.',
            'Cartas Prime Especial mostram fundo/borda exclusivos.'
        ],
        relacionados: ['minhascartas', 'equiparhabilidade']
    },

    // ── Time ──────────────────────────────────────────────────────────────
    {
        nome: 'escalar', cat: 'time', uso: '/escalar posicao:<GK|VL|PV> id:<ID da carta>',
        resumo: 'Coloca uma carta em uma posição do seu time.',
        detalhes: [
            'O time é formado por **GK** (goleiro), **VL** (volante/lateral) e **PV** (pivô/atacante).',
            'Não é possível ter o mesmo jogador repetido em duas posições.',
            'Sem as 3 posições preenchidas você não joga `/desafiar`, `/amistoso` nem `/torre`.'
        ],
        relacionados: ['elenco', 'meutime', 'trocarposicao']
    },
    {
        nome: 'meutime', cat: 'time', uso: '/meutime',
        resumo: 'Mostra sua escalação atual com os detalhes dos jogadores.',
        detalhes: ['Também mostra se a escalação está completa, o treinador e o patrocínio.'],
        relacionados: ['escalar', 'mostrartime', 'timestats']
    },
    {
        nome: 'mostrartime', cat: 'time', uso: '/mostrartime',
        resumo: 'Mostra as informações do seu time (overall médio, treinador, patrocínio).',
        detalhes: ['Cartas com fundo/borda personalizados aparecem com o visual customizado.'],
        relacionados: ['meutime', 'timestats']
    },
    {
        nome: 'timestats', cat: 'time', uso: '/timestats',
        resumo: 'Mostra as estatísticas completas do seu time.',
        detalhes: ['Exige as 3 cartas escaladas (GK, VL e PV).'],
        relacionados: ['meutime', 'ranking']
    },
    {
        nome: 'mudarnometime', cat: 'time', uso: '/mudarnometime nome:<novo nome>',
        resumo: 'Altera o nome do seu time.',
        detalhes: ['De 3 a 30 caracteres; só letras, números e espaços.'],
        relacionados: ['registrartime']
    },
    {
        nome: 'ranking', cat: 'time', uso: '/ranking',
        resumo: 'Mostra o top 5 do ranking geral de times.',
        detalhes: [
            'Só entram times com **GK, VL e PV escalados**.',
            'Pontuação: vitória **+3**, derrota **−2**, gol **+0,5**, assistência **+0,5**, gol sofrido **−0,3** e clean sheet **+1,5**.',
            'A mesma fórmula aparece no `/timestats`.'
        ],
        relacionados: ['desafiar', 'campeoes']
    },
    {
        nome: 'treinador', cat: 'evolucao', uso: '/treinador <contratar|rescindir|ver|lista>',
        resumo: 'Contrata um treinador que melhora os atributos do elenco.',
        detalhes: [
            '`/treinador lista` — mostra os treinadores disponíveis.',
            '`/treinador contratar nome:<treinador>` — custa **2.000 PC**.',
            '`/treinador ver` — mostra o seu treinador atual.',
            '`/treinador rescindir` — encerra o contrato por **3.000 PC**.',
            'Treinadores: 🅿️ Jojo (marcação e passe), 🧠 Silbão (criação e finalização), 🧞 Esquece (mental forte e apoio ao GK), 🧤 Rivelindo (GK e saída de bola) e 🫃 Steca (jogadas e gols).',
            'Os bônus valem em partidas, amistosos e na Torre.'
        ],
        relacionados: ['dicasgameplay', 'patrocinio', 'meutime']
    },
    {
        nome: 'patrocinio', cat: 'evolucao', uso: '/patrocinio',
        resumo: 'Escolhe o patrocinador do seu time e ganha bônus de atributos.',
        detalhes: [
            'Mostra os patrocínios disponíveis com custo em PC e bônus.',
            'Um time só pode ter **1 patrocínio ativo**; o bônus é aplicado automaticamente nas partidas.'
        ],
        relacionados: ['treinador', 'dicasgameplay']
    },

    // ── Partidas ──────────────────────────────────────────────────────────
    {
        nome: 'desafiar', cat: 'partidas', uso: '/desafiar jogador:<@usuário>',
        resumo: 'Partida competitiva contra outro jogador.',
        detalhes: [
            'O desafiado tem **5 minutos** para aceitar ou recusar.',
            'Se empatar, a partida vai para o **Gol de Ouro**.',
            'Vencedor recebe de **15 a 20 PC**; o outro dono recebe de **7 a 12 PC** de participação.',
            'Conta para estatísticas, ranking e missões de jogar/ganhar.'
        ],
        relacionados: ['amistoso', 'ranking', 'missao']
    },
    {
        nome: 'amistoso', cat: 'partidas', uso: '/amistoso',
        resumo: 'Partida contra jogadores da comunidade controlados por IA.',
        detalhes: [
            'Não conta para estatísticas oficiais.',
            'Recompensa: vitória **3–5 PC**, empate **2 PC**, derrota **1–2 PC**.',
            'Até **10 partidas remuneradas** por janela móvel de 60 minutos; depois disso você ainda joga, mas sem PC.'
        ],
        relacionados: ['desafiar', 'torre']
    },
    {
        nome: 'torre', cat: 'partidas', uso: '/torre <entrar|status|ranking|recompensas|comprarvida|reliquias|fabricar|fragmentos|reativar>',
        resumo: 'Campanha de 50 andares contra a IA, com chefes, buffs, eventos, relíquias e ascensões.',
        detalhes: [
            '`/torre entrar` — enfrenta o próximo adversário. Vitória avança sem gastar vida; derrota consome **1 vida**.',
            '`/torre status` · `/torre ranking` · `/torre recompensas` — seu progresso, os melhores da temporada e a tabela de prêmios dos 50 andares.',
            '`/torre comprarvida` — vida extra: **1.000 PC** e depois **2.500 PC**, até 2 por dia.',
            '`/torre reliquias` — equipa relíquias · `/torre fabricar` — cria relíquias com PC e fragmentos · `/torre fragmentos` — saldo de fragmentos · `/torre reativar` — conserta relíquias desgastadas.',
            '**3 vidas por dia** (renovam à meia-noite de Brasília; máximo 5). Chefe derrotado dá +1 vida.',
            'Chefes a cada 5 andares: buff, contrato opcional e, depois da vitória, um evento. Ao concluir o andar 50 a próxima **ascensão** (PC ×1,5 até ×3) é liberada.',
            'O guia completo (buffs, eventos, **todas as relíquias**, fragmentos e ascensões) vem logo abaixo desta mensagem.'
        ],
        guia: [
            {
                titulo: '🏰 Torre · como funciona',
                campos: [
                    { nome: '🎯 Objetivo', valor: 'Suba **50 andares** contra times da IA. A cada **5 andares** há um **chefe**. Cada andar paga **uma vez por ascensão em cada temporada**, então a melhor estratégia é avançar sempre que tiver vidas.\nExige time registrado e as 3 posições (GK, VL e PV) escaladas. Treinador e patrocínio valem nas partidas da Torre.' },
                    { nome: '❤️ Vidas', valor: '**3 vidas por dia** (renovam à meia-noite de Brasília), máximo de **5**. Vitória não gasta vida; derrota gasta **1**.\nVocê ganha **+1 vida** ao derrotar um chefe (menos o 50) e tem **5% de chance** de ganhar uma ao vencer um andar comum.\nComprar vida: `/torre comprarvida` ou `/comprarvidatorre` — **1.000 PC** e depois **2.500 PC**, até 2 por dia.' },
                    { nome: '⚔️ Dificuldade', valor: 'A IA fica mais forte a cada andar, **+2 pontos percentuais** a cada chefe derrotado e **+8%** a cada ascensão. Alguns contratos, relíquias e eventos aumentam a pressão em troca de mais recompensa.' },
                    { nome: '💰 Recompensas', valor: 'Toda vitória paga PC (cresce conforme o andar). Chefes pagam mais:\n• Andares **5, 10 e 15** → Pacote Normal\n• Andar **20** → Pacote Super · Andar **30** → Pacote Purple\n• Andar **40** → jackpot: 2.500 PC garantidos e 10% de chance de ×2 a ×6\n• Andar **50** → Pacote Super Purple\nA tabela completa está em `/torre recompensas`.' },
                    { nome: '🎴 Carta extra', valor: 'Vitórias em andares comuns têm chance de **carta extra**: **45%** (andares 1–29), **60%** (31–44) e **80%** (46–49). A raridade melhora com os andares; Prime só aparece do andar 31 em diante.' }
                ]
            },
            {
                titulo: '🧪 Torre · buffs, contratos e eventos',
                campos: [
                    { nome: '🧪 Buff antes do chefe', valor: 'Antes de cada chefe escolha **1 entre 3 buffs** de **+7** em atributos: Muralha (DEF), Artilheiros (FIN), Tiki-Taka (PAS), Drible Letal (DRI), Olho de Falcão (POS) ou Saída Limpa (SAI e PAS).\nSó **1 buff fica ativo**: vale até antes do próximo chefe e tem **15% de chance de quebrar** após cada vitória em andar comum. A cada chefe derrotado o buff do bloco seguinte ganha +0,5 por atributo.' },
                    { nome: '📜 Contratos (opcionais)', valor: 'Antes do chefe você pode aceitar uma desvantagem por mais PC. Vale para **uma tentativa**; se perder, o contrato é consumido.\n• ☠️ **Sem Misericórdia** — IA +5% de pressão, PC +30%\n• 💥 **Canhão de Vidro** — GK −5 DEF, PV +8 FIN, PC +35%\n• ❤️ **Última Vida** — só com 1 vida; IA +3%, PC ×2' },
                    { nome: '🎲 Eventos após o chefe', valor: 'Ao derrotar um chefe (5 a 45) aparece um evento:\n• 🎁 **Baú Escolhido** (35%) — escolha 1 de 3 relíquias, sempre com ao menos uma Épica ou superior\n• 🧪 **Baú Surpresa** (20%) — relíquia aleatória; repetida vira 250 PC\n• 🧑‍⚕️ **Médico** (15%) — recupera 1 vida\n• 🔮 **Mercador** (15%) — melhorias temporárias pagas com PC\n• ☠️ **Arena Amaldiçoada** (15%) — próximo combate com IA +5% e PC +30%\nSe um chefe passar sem render relíquia, o próximo evento é um Baú Escolhido garantido.' },
                    { nome: '🔮 Mercador Misterioso', valor: 'Mostra 3 ofertas; as mesmas não acumulam:\n• Preparação Ofensiva 700 PC — +3% ataque até o próximo chefe\n• Blindagem 700 PC — +3% defesa até o próximo chefe\n• Sorte Grande 900 PC — +5 p.p. de carta extra por 3 andares\n• Investimento 800 PC — +15% PC nas próximas 3 vitórias comuns\n• Recuperação 1.000 PC — +1 vida\n• Leitura do Adversário 800 PC — IA −3% em 3 combates comuns' },
                    { nome: '🧩 Drops em andares comuns', valor: 'Cada vitória em andar comum tem **20%** de dar **+1 fragmento** e **5%** de dar uma **relíquia** (75% Rara, 22% Épica, 3% Lendária; a partir da Ascensão 2 há 1% de Suprema). Relíquia repetida vira **250 PC**.' }
                ]
            },
            {
                titulo: '🧿 Torre · relíquias',
                campos: [
                    { nome: '📘 Como funcionam', valor: 'Relíquias são efeitos permanentes que valem nas partidas da Torre. Equipe com `/torre reliquias`.\n• Até **2 relíquias normais** + **1 Suprema** (só a partir da Ascensão 2)\n• O **Trono do Ascendente** libera um 3º slot exclusivo para uma Lendária\n• Não dá para equipar duas cópias da mesma\n• **Desgaste:** cada relíquia equipada aguenta de **7 a 14 combates** concluídos; depois para de funcionar até você usar `/torre reativar` (Rara 50 PC · Épica 150 · Lendária 400 · Suprema 800)' },
                    { nome: '🟢 Raras', valor: '🧲 **Ímã de Cartas** — +5 p.p. de carta extra; a posição escolhida tem peso dobrado\n🩸 **Sangue de Campeão** — +2% de PC por vitória seguida, até +20%; derrota zera\n🔎 **Caçador de Tesouros** — 10% de achar um evento extra após vencer andar comum (máx. 1 entre dois chefes)\n🎁 **Kit Médico** — na derrota, 20% da recompensa-base em PC e 15% de recuperar 1 vida (1 tentativa por dia)\n🪙 **Investimento Inicial** — 10% de dobrar os PC de uma vitória (não vale nos andares 40 e 50)' },
                    { nome: '🔵 Épicas', valor: '🎯 **Caçador de Raridades** — cada carta extra tem 20% de subir uma raridade, até Prime\n⚔️ **Espólio de Guerra** — chefes dão uma carta garantida Médio ou melhor\n🧭 **Bússola do Explorador** — uma nova rolagem de evento por evento de chefe\n🎒 **Mochila de Emergência** — na derrota contra chefe, 35% de evitar a perda de vida; 1 carga (máx. 2), só gasta quando salva, +1 por chefe derrotado\n🎰 **Desafio do Ascendente** — após um chefe, aposte 300, 400 ou 500 PC; vença a revanche e a luta seguinte para receber a aposta de volta, 5/8/12 fragmentos e uma carta Médio+ (quanto maior a aposta, melhor a chance de GOAT/Prime)' },
                    { nome: '🟣 Lendárias', valor: '🔥 **Fênix** — evita uma perda de vida e recarrega ao derrotar um novo chefe\n💜 **Núcleo Purple** — cada vitória sem carta extra soma +8 p.p. à chance seguinte (máx. 95%); ao sair carta, 20% de vir uma segunda\n👑 **Coroa de Espinhos** — IA +4% mais forte; +25% de PC, +10 p.p. de carta extra e 20% de carta extra Médio+ por chefe\n⚽ **Maestro da Posição** — escolha GK, VL ou PV: +5% em todos os atributos dessa posição\n🪞 **Espelho do Destino** — cada chefe dá 1 carga (máx. 1); na próxima carta extra você escolhe manter, refletir pela mesma raridade ou replicar' },
                    { nome: '🔴 Supremas (Ascensão 2+)', valor: '👑 **Trono do Ascendente** — libera 1 slot extra exclusivo para uma Lendária\n🐉 **Coração do Titã** — cada chefe derrotado dá +5% de PC nas próximas vitórias (até +25%); a cada 5 combates comuns vencidos, +1 p.p. de carta extra\n🌀 **Ruptura da Raridade** — cada carta recebida tem 10% de subir uma raridade; +10 p.p. de carta extra e +2% em todos os atributos do time\nSó 1 Suprema equipada por vez e elas **não podem ser fabricadas**.' },
                    { nome: '⚪ Legado', valor: 'Relíquias antigas mantidas para quem já tinha: 🧤 Luvas do Titã (+3 DEF no goleiro), 👟 Chuteira Fantasma (+4 DRI no ponta), 🧠 Cérebro Tático (+2 nos atributos dos buffs) e ❤️ Segunda Chance (evita uma perda de vida por ciclo).' }
                ]
            },
            {
                titulo: '🔧 Torre · fragmentos, oficina e ascensões',
                campos: [
                    { nome: '🧩 Fragmentos', valor: 'Vêm dos andares comuns (20% por vitória) e do Desafio do Ascendente. Veja seu saldo em `/torre fragmentos`.' },
                    { nome: '🔧 Oficina (`/torre fabricar`)', valor: '**Direcionada** (você escolhe a relíquia): Rara 2.500 PC + 10 fragmentos · Épica 4.000 PC + 25 · Lendária 10.000 PC + 60.\n**Aleatória** (mais barata): Rara 2.000 PC + 7 · Épica 3.000 PC + 18 · Lendária 7.000 PC + 45.\nNão fabrica relíquia que você já tem nem Supremas.' },
                    { nome: '⚔️ Ascensões', valor: 'Ao vencer o andar 50 você sobe de ascensão e recomeça do andar 1:\n**Base** → **Ascensão 1** (PC ×1,5) → **2** (×2) → **3** (×2,5) → **4** (×3).\nCada ascensão deixa a IA +8% mais forte. Pacotes e quantidade de cartas continuam iguais; só os PC são multiplicados. A partir da **Ascensão 2** as relíquias Supremas passam a aparecer e podem ser equipadas.' },
                    { nome: '🏆 Ranking e temporada', valor: '`/torre ranking` mostra os melhores da temporada e `/torre status` mostra seu andar, vidas, ascensão e relíquias.' }
                ]
            }
        ],
        relacionados: ['comprarvidatorre', 'dicasgameplay', 'dicas']
    },
    {
        nome: 'comprarvidatorre', cat: 'partidas', uso: '/comprarvidatorre',
        resumo: 'Atalho para comprar uma vida extra da Torre.',
        detalhes: ['Mesmas regras do `/torre comprarvida`: até 2 por dia (1.000 PC e depois 2.500 PC), limite total de 5 vidas.'],
        relacionados: ['torre']
    },

    // ── Compras e evolução ───────────────────────────────────────────────
    {
        nome: 'comprarpacote', cat: 'economia', uso: '/comprarpacote tipo:<tipo>',
        resumo: 'Compra pacotes de cartas com Purple Coins.',
        detalhes: [
            '**Normal** 500 PC · **Super** 1.000 PC · **Purple** 2.500 PC.',
            '**Super Purple** 5.000 PC (sem Bagre) · **Purple Supremo** 10.000 PC (GOAT/Prime garantido na carta principal).',
            'Pacotes pagos não têm cooldown.'
        ],
        relacionados: ['pacote', 'dicas']
    },
    {
        nome: 'comprarhabilidade', cat: 'evolucao', uso: '/comprarhabilidade habilidade:<habilidade>',
        resumo: 'Compra uma habilidade especial por 800 PC.',
        detalhes: [
            '**GK:** 🧱 Muralha · 🦅 GK Libero · 🕹️ GK Skill.',
            '**VL:** 🎼 Maestro · 🐶 Pitbull · 📦 Box to Box.',
            '**PV:** 🎯 Matador · 🕵️ Falso 9 · 🏃 Ponta.',
            'Cada habilidade dá um bônus forte (+8 a +12) em um atributo e um menor (+3 a +7) em outro, com 15% de chance de um bônus extra.',
            'A compra só guarda a habilidade no seu inventário; para valer, use `/equiparhabilidade`.'
        ],
        relacionados: ['equiparhabilidade', 'dicasgameplay']
    },
    {
        nome: 'equiparhabilidade', cat: 'evolucao', uso: '/equiparhabilidade habilidade:<habilidade> id_carta:<ID>',
        resumo: 'Equipa uma habilidade comprada em uma carta.',
        detalhes: [
            'Só aparecem as habilidades que você comprou, com a quantidade.',
            'A lista de cartas mostra as de maior overall que aceitam aquela habilidade (pela posição).',
            'Equipar **não custa PC**: consome apenas 1 unidade da habilidade que já está no seu inventário. A compra de 800 PC acontece separadamente em `/comprarhabilidade`.',
            'É **permanente** e não pode ser trocada; o overall máximo da carta é 99.',
            'Há confirmação antes de aplicar.'
        ],
        relacionados: ['comprarhabilidade', 'mostrarcarta']
    },
    {
        nome: 'rolarstats', cat: 'evolucao', uso: '/rolarstats carta:<ID>',
        resumo: 'Re-sorteia os atributos de uma carta (uma única vez por carta).',
        detalhes: [
            'Mantém o overall e a raridade; só os atributos mudam.',
            'Custo por raridade: Bagre 250 · Médio 750 · GOAT 2.000 · Prime 4.000 · Prime Purple 6.500 PC.',
            'É irreversível e há confirmação antes. Trocar a posição também consome esse reroll único.'
        ],
        relacionados: ['trocarposicao', 'dicasgameplay']
    },
    {
        nome: 'trocarposicao', cat: 'evolucao', uso: '/trocarposicao carta:<ID> posicao:<nova posição>',
        resumo: 'Troca a posição de uma carta (os atributos mudam, o overall não).',
        detalhes: [
            'Os atributos são sorteados novos para a nova posição.',
            'Conta como o **reroll único** da carta — depois disso, `/rolarstats` não funciona nela.'
        ],
        relacionados: ['rolarstats', 'escalar']
    },
    {
        nome: 'trocarjogadores', cat: 'evolucao', uso: '/trocarjogadores raridade:<raridade> id1 id2 id3 [id4] [id5]',
        resumo: 'Funde cartas repetidas para subir de raridade.',
        detalhes: [
            '🐟 **3 Bagres** → 1 Médio.',
            '🥈 **4 Médios** → 1 GOAT.',
            '🐐 **5 GOATs** → 1 Prime.',
            'As cartas usadas são consumidas.'
        ],
        relacionados: ['vender', 'multisell']
    },

    // ── Mercado ──────────────────────────────────────────────────────────
    {
        nome: 'vender', cat: 'mercado', uso: '/vender id:<ID da carta>',
        resumo: 'Vende uma carta por Purple Coins.',
        detalhes: [
            'O valor depende da raridade, do overall e dos atributos; cartas com habilidade equipada valem mais.',
            'Há confirmação antes da venda e ela não pode ser desfeita.',
            'Conta para a missão de vender cartas.'
        ],
        relacionados: ['multisell', 'leilao', 'missao']
    },
    {
        nome: 'multisell', cat: 'mercado', uso: '/multisell ids:<id1, id2, id3...>',
        resumo: 'Vende várias cartas de uma vez.',
        detalhes: ['Informe os IDs separados por vírgula; é mostrada uma confirmação com a lista antes de vender.'],
        relacionados: ['vender']
    },
    {
        nome: 'leilao', cat: 'mercado', uso: '/leilao carta:<ID> valorinicial:<PC> [duracao:<min>]',
        resumo: 'Anuncia uma carta sua em leilão.',
        detalhes: [
            'Valor inicial mínimo: **500 PC**. Duração: **30 a 300 min** (padrão **60 min / 1h** se você não informar).',
            'O lance é debitado na hora e devolvido se alguém cobrir; quem foi coberto recebe o aviso por DM.',
            'Lance nos últimos 2 minutos estende o leilão.',
            'Ao final, o vendedor recebe o valor menos **5%** de taxa.'
        ],
        relacionados: ['leiloes', 'vender']
    },
    {
        nome: 'leiloes', cat: 'mercado', uso: '/leiloes',
        resumo: 'Lista as cartas em leilão com atributos, valor e tempo restante.',
        detalhes: ['Para dar lance, use o botão no anúncio do leilão.'],
        relacionados: ['leilao']
    },

    // ── Personalização ───────────────────────────────────────────────────
    {
        nome: 'resgatarborda', cat: 'visual', uso: '/resgatarborda codigo:<código>',
        resumo: 'Resgata uma borda personalizada comprada no site.',
        detalhes: ['Depois aplique em uma carta com `/equiparborda`.'],
        relacionados: ['equiparborda', 'loja']
    },
    {
        nome: 'equiparborda', cat: 'visual', uso: '/equiparborda id:<ID da carta>',
        resumo: 'Aplica uma borda que você já resgatou em UMA carta.',
        detalhes: ['Também permite voltar a carta ao visual padrão.'],
        relacionados: ['resgatarborda']
    },
    {
        nome: 'resgatarfundo', cat: 'visual', uso: '/resgatarfundo codigo:<código> carta_id:<ID>',
        resumo: 'Resgata um fundo personalizado e aplica na carta.',
        detalhes: ['O fundo fica vinculado à carta escolhida e aparece em `/mostrarcarta`, `/mostrartime` e nos GIFs de partida.'],
        relacionados: ['equiparfundo', 'loja']
    },
    {
        nome: 'equiparfundo', cat: 'visual', uso: '/equiparfundo codigo:<código> carta_id:<ID>',
        resumo: 'Equipa um fundo personalizado em uma carta.',
        detalhes: ['Se a carta já tiver fundo, pede confirmação antes de substituir.'],
        relacionados: ['resgatarfundo']
    },

    // ── Torneios / novidades / ajuda ─────────────────────────────────────
    {
        nome: 'campeoes', cat: 'torneios', uso: '/campeoes',
        resumo: 'Lista os torneios finalizados e seus campeões (1º, 2º e 3º).',
        detalhes: [],
        relacionados: ['torneio', 'ranking']
    },
    {
        nome: 'torneio', cat: 'torneios', uso: '/torneio <criar|mostrar|iniciar>',
        resumo: 'Sistema de torneios do Haxball DreamTeam.',
        detalhes: [
            '`criar` — cria um torneio (apenas ADM).',
            '`mostrar` — mostra os dados de um torneio.',
            '`iniciar` — inicia um torneio existente.',
            'As inscrições costumam abrir por um embed com botão postado pela staff.'
        ],
        relacionados: ['campeoes']
    },
    {
        nome: 'novaseason', cat: 'torneios', uso: '/novaseason',
        resumo: 'Mostra as novidades e atualizações do Haxball DreamTeam.',
        detalhes: [],
        relacionados: ['ajuda']
    },
    {
        nome: 'ajuda', cat: 'ajuda', uso: '/ajuda geral  ·  /ajuda comando nome:<comando>',
        resumo: 'Manual do bot.',
        detalhes: [
            '`/ajuda geral` — manual completo (cartas, pacotes, Torre, loja...).',
            '`/ajuda comando nome:<comando>` — explica um comando específico; comece a digitar o nome e escolha na lista.'
        ],
        relacionados: ['dicas', 'dicasgameplay']
    },
    {
        nome: 'dicas', cat: 'ajuda', uso: '/dicas',
        resumo: 'Estratégias para ganhar mais Purple Coins.',
        detalhes: ['Resume as melhores fontes de PC e como não desperdiçar o que você ganha.'],
        relacionados: ['dicasgameplay', 'purplecoins']
    },
    {
        nome: 'dicasgameplay', cat: 'ajuda', uso: '/dicasgameplay',
        resumo: 'Dicas de gameplay: habilidades, treinador, escalação e Torre.',
        detalhes: ['Ajuda a decidir onde investir seus PC para ficar mais forte.'],
        relacionados: ['dicas', 'comprarhabilidade', 'treinador']
    },

    // ── ADM ───────────────────────────────────────────────────────────────
    {
        nome: 'canaleilao', cat: 'adm', uso: '/canaleilao [canal] [remover]',
        resumo: '[ADM] Define o canal onde os leilões são postados.',
        detalhes: ['Sem opções, mostra o canal atual. Com **remover**, os leilões voltam a ser postados onde o comando foi usado.'],
        relacionados: ['leilao']
    },
    {
        nome: 'criarcodigofundo', cat: 'adm', uso: '/criarcodigofundo tipo cor1 cor2 padrao usos descricao',
        resumo: '[ADM] Cria um código de fundo personalizado para cartas.',
        detalhes: ['Define cores, padrão do gradiente e número máximo de usos (1 a 1000).'],
        relacionados: ['resgatarfundo']
    },
    {
        nome: 'iniciartorneio', cat: 'adm', uso: '/iniciartorneio nome:<torneio> velocidade:<velocidade>',
        resumo: '[ADM] Inicia um torneio existente.',
        detalhes: [],
        relacionados: ['torneio']
    },
    {
        nome: 'torneioembed', cat: 'adm', uso: '/torneioembed nome data horario formato max_times premio_1...',
        resumo: '[ADM] Cria o embed de inscrições de um torneio.',
        detalhes: [],
        relacionados: ['torneio']
    }
];

const COMANDOS_POR_NOME = new Map(COMANDOS.map(cmd => [cmd.nome, cmd]));

function normalizar(texto) {
    return String(texto || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/^\/+/, '')
        .trim();
}

function encontrarComando(entrada) {
    const alvo = normalizar(entrada).split(/\s+/)[0];
    if (!alvo) return { cmd: null, sugestoes: [] };
    if (COMANDOS_POR_NOME.has(alvo)) return { cmd: COMANDOS_POR_NOME.get(alvo), sugestoes: [] };
    const parecidos = COMANDOS.filter(cmd => cmd.nome.includes(alvo) || alvo.includes(cmd.nome));
    if (parecidos.length === 1) return { cmd: parecidos[0], sugestoes: [] };
    return { cmd: null, sugestoes: parecidos.slice(0, 5).map(cmd => cmd.nome) };
}

function buildCommandEmbed(cmd, client) {
    const embed = new EmbedBuilder()
        .setColor(COR)
        .setTitle(`📖 /${cmd.nome}`)
        .setDescription(`${cmd.resumo}\n\n**Como usar:** \`${cmd.uso}\``)
        .addFields({ name: 'Categoria', value: CATEGORIAS[cmd.cat] || '—', inline: true });

    if (cmd.detalhes && cmd.detalhes.length) {
        const texto = cmd.detalhes.map(linha => `• ${linha}`).join('\n');
        embed.addFields({ name: 'Detalhes', value: texto.slice(0, 1024), inline: false });
    }
    if (cmd.relacionados && cmd.relacionados.length) {
        embed.addFields({ name: 'Veja também', value: cmd.relacionados.map(nome => `\`/${nome}\``).join(' · '), inline: false });
    }
    embed.setFooter({
        text: 'Use /ajuda geral para o manual completo',
        iconURL: client?.user?.displayAvatarURL?.()
    });
    return embed;
}

// O Discord limita a soma dos embeds de uma mensagem a 6000 caracteres.
function buildGuiaEmbeds(cmd, client) {
    return (cmd.guia || []).map((pagina, idx, todas) => {
        const embed = new EmbedBuilder().setColor(COR).setTitle(pagina.titulo);
        embed.addFields(pagina.campos.map(campo => ({ name: campo.nome.slice(0, 256), value: campo.valor.slice(0, 1024), inline: false })));
        if (idx === todas.length - 1) {
            embed.setFooter({ text: 'Use /ajuda geral para o manual completo', iconURL: client?.user?.displayAvatarURL?.() });
        }
        return embed;
    });
}

function embedLength(embed) {
    const d = embed.data || {};
    let total = (d.title || '').length + (d.description || '').length + (d.footer?.text || '').length + (d.author?.name || '').length;
    for (const field of d.fields || []) total += (field.name || '').length + (field.value || '').length;
    return total;
}

function agruparEmbeds(embeds, limite = 5500) {
    const grupos = [];
    let atual = [];
    let tamanho = 0;
    for (const embed of embeds) {
        const len = embedLength(embed);
        if (atual.length && (tamanho + len > limite || atual.length >= 10)) {
            grupos.push(atual);
            atual = [];
            tamanho = 0;
        }
        atual.push(embed);
        tamanho += len;
    }
    if (atual.length) grupos.push(atual);
    return grupos;
}

function buildGeralEmbeds(client) {
    const embed1 = new EmbedBuilder()
        .setColor(COR)
        .setTitle('🎮 Bem-vindo ao Haxball DreamTeam!')
        .setDescription(
            '💡 **Primeiro passo obrigatório:** registre seu time com `/registrartime`. ' +
            'Os comandos `/obter`, `/pacote` e `/torre` exigem um time registrado.\n\n' +
            'Se for Sub na [Twitch do JOJOS](https://www.twitch.tv/jphmdx), Booster ou Purple, ' +
            'você pode ter cooldowns menores.\n\n' +
            '🌐 Discord oficial: https://discord.com/invite/aZdM3t86ZW\n' +
            '🛒 Loja: https://jojovendas.vercel.app/'
        )
        .setThumbnail('https://i.imgur.com/542tKoV.png')
        .addFields(
            {
                name: '📚 Mais ajuda',
                value: '• `/ajuda comando nome:<comando>` — explica qualquer comando em detalhes.\n' +
                    '• `/dicas` — estratégias para ganhar Purple Coins.\n' +
                    '• `/dicasgameplay` — dicas de habilidades, treinador, escalação e Torre.',
                inline: false
            },
            {
                name: '🏆 Conquistas (/conquistas)',
                value: 'Acompanhe metas de coleção, vitórias, gols, clean sheets, trocas e Purple Coins. As 33 conquistas pagam **20.871 PC por ciclo**. Resgate pelo `/resgatarconquista`; quando todas forem resgatadas, um novo ciclo começa.',
                inline: false
            },
            {
                name: '🎯 Missões (/missao) e login (/loginreward)',
                value: 'Complete objetivos e resgate Purple Coins. O login recompensa sua sequência diária.',
                inline: false
            },
            {
                name: '🛡️ Habilidades e treinadores',
                value: 'Compre/equipe habilidades com `/comprarhabilidade` e `/equiparhabilidade`. Use `/treinador` para contratar um treinador que melhora atributos do elenco.',
                inline: false
            },
            {
                name: '🎨 Personalização',
                value: 'Compre bordas e fundos na [JojoVendas](https://jojovendas.vercel.app/) e equipe em uma carta específica com `/equiparborda` ou `/equiparfundo`.',
                inline: false
            },
            {
                name: '👔 Patrocínio (/patrocinio)',
                value: 'Gerencie o patrocinador do seu time e aproveite os bônus de atributos.',
                inline: false
            }
        );

    const embed2 = new EmbedBuilder()
        .setColor(COR)
        .setTitle('🎴 Cartas, obtenção e pacotes')
        .addFields(
            {
                name: '⚽ Antes de obter cartas',
                value: 'Registre seu time com `/registrartime`. Sem um time cadastrado, `/obter` e `/pacote` não liberam cartas nem consomem cooldown.',
                inline: false
            },
            {
                name: '🎴 /obter',
                value: 'Receba **1 carta grátis** por uso. Cooldown padrão: **15 min**; Sub/Booster: **10 min**; Purple: **8 min**. O cargo é verificado nos servidores oficiais.',
                inline: false
            },
            {
                name: '📦 /pacote',
                value: 'Receba **3 cartas grátis** e **+15 PC** por pacote completo. Cooldown padrão: **2h30**; Sub/Booster: **2h**; Purple: **1h40**. A Torre também pode entregar pacotes de chefe sem consumir esse cooldown.',
                inline: false
            },
            {
                name: '🔔 Lembretes',
                value: 'Quando `/obter` ou `/pacote` estiverem em cooldown, toque em **Me avisar quando liberar** e eu te chamo por DM (ou no canal, se sua DM estiver fechada). A Torre também oferece o lembrete quando suas vidas acabam. Os lembretes são temporários e podem ser perdidos se o bot reiniciar antes do horário.',
                inline: false
            },
            {
                name: '🏰 /torre',
                value: '**50 andares, chefes a cada 5 andares e 3 vidas por dia.** Vitória avança sem gastar vida; derrota consome 1. Chefes liberam buff, contrato opcional e eventos (baús de relíquia, médico, mercador e arena). Equipe relíquias com `/torre reliquias`, fabrique com `/torre fabricar` e conclua os 50 andares para liberar ascensões com PC de ×1,5 até ×3. Use `/torre entrar`, `/torre status`, `/torre ranking` e `/torre recompensas`.\n**Guia completo com todas as relíquias:** `/ajuda comando nome:torre`.',
                inline: false
            },
            {
                name: '💎 Raridades',
                value: '🌟 Prime Purple < ⭐ Prime < 🐐 GOAT < 🥈 Médio < 🐟 Bagre. As chances de cartas extras da Torre aumentam conforme os andares.',
                inline: false
            }
        );

    const embed3 = new EmbedBuilder()
        .setColor(COR)
        .setTitle('⚽ Times, partidas e atributos')
        .addFields(
            {
                name: '⚙️ Comandos essenciais',
                value: '• `/registrartime` — registre seu time\n' +
                    '• `/escalar` — escolha GK, VL e PV\n' +
                    '• `/meutime` e `/mostrartime` — consulte escalações\n' +
                    '• `/desafiar` — partidas competitivas contra outros jogadores\n' +
                    '• `/amistoso` — partida contra IA, sem estatísticas oficiais\n' +
                    '• `/torre` — campanha de 50 andares contra IA',
                inline: false
            },
            {
                name: '🥅 GK (Goleiro)',
                value: '**POS:** posicionamento | **SAI:** saída de bola | **DEF:** defesa | **DRI:** drible.',
                inline: false
            },
            {
                name: '⚽ VL (Volante/Lateral)',
                value: '**DEF:** roubadas | **PAS:** precisão dos passes | **FIN:** finalização | **DRI:** escapar da marcação.',
                inline: false
            },
            {
                name: '🎯 PV (Pivô/Atacante)',
                value: '**FIN:** chance de gol | **POS:** presença na área | **DRI:** drible | **PAS:** assistências.',
                inline: false
            },
            {
                name: '🔁 Mercado e coleção',
                value: '• `/minhascartas` e `/mostrarcarta` — consultar cartas.\n' +
                    '• `/vender` — vender cartas por Purple Coins.\n' +
                    '• `/leilao` — anunciar cartas; o lance é reservado imediatamente e devolvido se for superado.\n' +
                    '• `/leiloes` — listar cartas em leilão com posição, atributos, valor e tempo restante.\n' +
                    '• `/trocarjogadores` — negociar e fundir cartas.\n' +
                    '• `/trocarposicao` — trocar a posição com stats novos aleatórios; conta como o reroll único da carta.\n' +
                    '• `/rolarstats carta:<id>` — rerolar os atributos uma única vez por carta, pagando conforme a raridade.',
                inline: false
            }
        );

    const embed4 = new EmbedBuilder()
        .setColor(COR)
        .setTitle('🛒 Loja, pacotes pagos e dicas')
        .addFields(
            {
                name: '💎 /comprarpacote — preços em Purple Coins',
                value: '• Normal: **500 PC**\n• Super: **1.000 PC**\n• Purple: **2.500 PC**\n• Super Purple: **5.000 PC** — sem Bagre\n• Purple Supremo: **10.000 PC** — GOAT/Prime garantido na carta principal.',
                inline: false
            },
            {
                name: '💰 Como conseguir Purple Coins',
                value: '• Recompensas de `/desafiar`, `/amistoso` e `/torre`\n• `/missao` e `/loginreward`\n• `/vender` cartas\n• Conquistas e eventos do servidor.\n• Mais estratégias em `/dicas`.',
                inline: false
            },
            {
                name: '🎲 /rolarstats — reroll único',
                value: 'Você pode sortear novos atributos **uma única vez por carta**, mantendo OVR e raridade. Trocar de posição também consome esse reroll único. Custos atuais: Bagre 250 PC · Médio 750 PC · GOAT 2.000 PC · Prime 4.000 PC · Prime Purple 6.500 PC. A ação é irreversível.',
                inline: false
            },
            {
                name: '🔨 /leilao — mercado de cartas',
                value: 'O lance é debitado e reservado imediatamente. Se outro jogador superar seu lance, você recebe o valor reservado de volta. No fim, o vencedor recebe a carta e o vendedor recebe o valor menos 5% de taxa do mercado. Lance nos últimos 2 minutos estende o leilão.',
                inline: false
            },
            {
                name: '✨ Prime Especial',
                value: 'Cartas Prime podem sair com fundo e/ou borda exclusivos. A personalização é vinculada àquela carta; veja com `/mostrarcarta` e gerencie com `/equiparborda`.',
                inline: false
            },
            {
                name: '❓ Dúvidas rápidas',
                value: '**Não consigo obter?** Confira se registrou seu time e se o cooldown terminou.\n**Perdi na Torre?** Você perde uma vida, mas mantém o andar atual.\n**Bug ou dúvida?** Procure a staff do servidor.',
                inline: false
            }
        )
        .setFooter({ text: 'JojosTeamLegends · Haxball DreamTeam', iconURL: client?.user?.displayAvatarURL?.() })
        .setTimestamp();

    return [embed1, embed2, embed3, embed4];
}

async function responderErro(interaction, msg) {
    try {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
        } else {
            await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
        }
    } catch (e) {
        console.error('Erro ao enviar fallback de ajuda:', e);
    }
}

async function mostrarGeral(interaction) {
    const grupos = agruparEmbeds(buildGeralEmbeds(interaction.client));
    await interaction.reply({ embeds: grupos[0], flags: MessageFlags.Ephemeral });
    for (const grupo of grupos.slice(1)) {
        await interaction.followUp({ embeds: grupo, flags: MessageFlags.Ephemeral });
    }
}

async function mostrarComando(interaction) {
    const entrada = interaction.options.getString('nome', true);
    const { cmd, sugestoes } = encontrarComando(entrada);

    if (!cmd) {
        const dica = sugestoes.length
            ? `\nTalvez você quis dizer: ${sugestoes.map(nome => `\`/${nome}\``).join(', ')}.`
            : '\nComece a digitar o nome no campo **nome** e escolha uma opção da lista.';
        return interaction.reply({
            content: `❌ Não encontrei ajuda para \`${String(entrada).slice(0, 40)}\`.${dica}`,
            flags: MessageFlags.Ephemeral
        });
    }
    const grupos = agruparEmbeds([buildCommandEmbed(cmd, interaction.client), ...buildGuiaEmbeds(cmd, interaction.client)]);
    await interaction.reply({ embeds: grupos[0], flags: MessageFlags.Ephemeral });
    for (const grupo of grupos.slice(1)) {
        await interaction.followUp({ embeds: grupo, flags: MessageFlags.Ephemeral });
    }
}

async function execute(interaction) {
    try {
        const sub = interaction.options.getSubcommand();
        if (sub === 'comando') return await mostrarComando(interaction);
        return await mostrarGeral(interaction);
    } catch (error) {
        console.error('Erro no comando ajuda:', error);
        await responderErro(interaction, '❌ Erro ao mostrar a ajuda. Tente novamente.');
    }
}

async function autocomplete(interaction) {
    const foco = normalizar(interaction.options.getFocused());
    const lista = COMANDOS.filter(cmd => cmd.cat !== 'adm' || foco.length > 0);
    const comeca = lista.filter(cmd => cmd.nome.startsWith(foco));
    const contem = lista.filter(cmd => !cmd.nome.startsWith(foco) && (cmd.nome.includes(foco) || normalizar(cmd.resumo).includes(foco)));
    const opcoes = [...comeca, ...contem].slice(0, 25).map(cmd => ({
        name: `/${cmd.nome} — ${cmd.resumo}`.slice(0, 100),
        value: cmd.nome
    }));
    try {
        await interaction.respond(opcoes);
    } catch (error) {
        console.warn('[ajuda] Falha ao responder autocomplete:', error?.message || error);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ajuda')
        .setDescription('Manual do Haxball DreamTeam: geral ou de um comando específico')
        .addSubcommand(sub => sub
            .setName('geral')
            .setDescription('Mostra o manual completo do Haxball DreamTeam'))
        .addSubcommand(sub => sub
            .setName('comando')
            .setDescription('Explica um comando específico (como usar, custos, cooldowns)')
            .addStringOption(option => option
                .setName('nome')
                .setDescription('Nome do comando (ex: torre, obter, leilao)')
                .setRequired(true)
                .setAutocomplete(true))),
    execute,
    autocomplete,
    __test: { COMANDOS, CATEGORIAS, encontrarComando, buildGeralEmbeds, buildCommandEmbed, buildGuiaEmbeds, agruparEmbeds, embedLength }
};
