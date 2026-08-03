import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from mplot3d import Axes3D

# --- 1. CARREGAMENTO E TRATAMENTO DOS DADOS REAIS DO PDF ---
# Dados extraídos diretamente das colunas 'Secretaria' e 'Tip de Solicitação' do PDF
dados_pdf = {
    'Secretaria': [
        'SAÚDE', 'SEMOB', 'SEMOB', 'SAÚDE', 'SEMOB', 'FAZENDA', 'CÂMARA DE VEREADORES SÃO LEOPOLDO',
        'Secretaria Municipal de Desenvolvimento Econômico e Tecnológico - SEDETEC', 'SEMOB', 'SEMOB',
        'SEMOB', 'CÂMARA DE VEREADORES SÃO LEOPOLDO', 'SAÚDE', 'SEMOB', 'SEMOB', 'SEMOB', 'SEMOB',
        'SEMOB', 'SEMOB', 'SAÚDE', 'CÂMARA DE VEREADORES SÃO LEOPOLDO', 'SEMOB',
        'CÂMARA DE VEREADORES SÃO LEOPOLDO', 'SEMOB', 'SEMOB', 'SEMOB', 'SEMOB', 'SEMOB', 'SEMOB',
        'SEMOB', 'CÂMARA DE VEREADORES SÃO LEOPOLDO', 'CÂMARA DE VEREADORES SÃO LEOPOLDO', 'SEMOB',
        'SEMOB', 'SEMOB', 'SEMOB', 'Demanda Externa', 'SEMOB', 'SEMOB', 'SEMOB', 'SEMOB',
        'CÂMARA DE VEREADORES SÃO LEOPOLDO', 'SAÚDE', 'SEMOB', 'SAÚDE'
    ],
    'Tipo_Solicitacao': [
        'DEMANDA (GERAL)', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'DEMANDA (GERAL)',
        'PEDIDO DE PROVIDÊNCIAS', 'GABINETE', 'DEMANDA (GERAL)', 'GABINETE', 'PEDIDO DE PROVIDÊNCIAS',
        'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'SESSÃO SOLENE', 'AGENDA VISITA AO GABINETE',
        'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS',
        'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'INDICAÇÃO', 'REQUERIMENTO', 'PEDIDO DE PROVIDÊNCIAS',
        'REQUERIMENTO', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS',
        'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS',
        'EMENDA ADITIVA', 'EMENDA ADITIVA', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS',
        'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS',
        'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'PEDIDO DE PROVIDÊNCIAS', 'EMENDA ADITIVA',
        'DEMANDA (GERAL)', 'PEDIDO DE PROVIDÊNCIAS', 'GABINETE'
    ]
}

df = pd.DataFrame(dados_pdf)

# Contagem real para as secretarias e tipos de solicitação
contagem_secretarias = df['Secretaria'].value_counts()
contagem_tipos = df['Tipo_Solicitacao'].value_counts()

# --- 2. CONFIGURAÇÃO ESTÉTICA DO DASHBOARD (DARK MODE) ---
plt.style.use('dark_background')
cor_fundo = '#111827'  # Azul escuro acinzentado conforme imagem do painel
cor_barras = '#3B82F6'  # Azul brilhante para destacar

# --- 3. GRÁFICO 1: DE BARRAS DE SECRETARIAS EM 3D ---
fig1 = plt.figure(figsize=(10, 6), facecolor=cor_fundo)
ax1 = fig1.add_subplot(111, projection='3d')
ax1.set_facecolor(cor_fundo)

y_pos = np.arange(len(contagem_secretarias))
valores = contagem_secretarias.values

# Definição das dimensões 3D dos blocos de barras
x_pos = np.zeros(len(contagem_secretarias))
z_pos = np.zeros(len(contagem_secretarias))
dx = 0.5  # Largura da barra no eixo X
dy = 0.5  # Espessura da barra no eixo Y
dz = valores  # Altura projetada no eixo Z

ax1.bar3d(x_pos, y_pos, z_pos, dx, dy, dz, color=cor_barras, alpha=0.85, edgecolor='#1E40AF')

# Ajustes de eixos e rótulos das Secretarias
ax1.set_yticks(y_pos)
# Encurta nomes muito longos de secretarias para melhor legibilidade
labels_secretarias = [s[:15] + '...' if len(s) > 15 else s for s in contagem_secretarias.index]
ax1.set_yticklabels(labels_secretarias, fontsize=9, color='#9CA3AF')
ax1.set_xticklabels([])
ax1.set_zlabel('Nº de Demandas', color='#9CA3AF')
ax1.set_title('Demandas por Secretaria (Visão 3D)', fontsize=14, pad=20, color='#F3F4F6', weight='bold')
ax1.view_init(elev=25, azim=-45)  # Angulação para valorizar o efeito 3D

plt.tight_layout()
plt.show()

# --- 4. GRÁFICO 2: TIPOS DE SOLICITAÇÃO EM "PIZZA 3D" (CILINDRO PROJETADO) ---
fig2 = plt.figure(figsize=(8, 6), facecolor=cor_fundo)
ax2 = fig2.add_subplot(111, projection='3d')
ax2.set_facecolor(cor_fundo)

labels_tipos = contagem_tipos.index
valores_tipos = contagem_tipos.values
proporcoes = valores_tipos / sum(valores_tipos)

# Criação do efeito de pizza tridimensional mapeando setores circulares em fatias volumétricas
angulo_atual = 0
cores_pizza = ['#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#EF4444']

for i, prop in enumerate(proporcoes):
    angulo_setor = prop * 2 * np.pi
    # Resolução geométrica da fatia
    theta = np.linspace(angulo_atual, angulo_atual + angulo_setor, 50)
    angulo_atual += angulo_setor
    
    # Coordenadas internas e da borda da fatia de pizza
    r = np.linspace(0, 1, 10)
    T, R = np.meshgrid(theta, r)
    X = R * np.cos(T)
    Y = R * np.sin(T)
    
    # Altura Z (profundidade/espessura da pizza 3D)
    Z_baixo = np.zeros_like(X)
    Z_alto = np.ones_like(X) * 0.25  # Espessura do relevo
    
    # Renderiza a superfície volumétrica tridimensional da fatia
    ax2.plot_surface(X, Y, Z_alto, color=cores_pizza[i % len(cores_pizza)], alpha=0.9, edgecolor='none')
    ax2.plot_surface(X, Y, Z_baixo, color=cores_pizza[i % len(cores_pizza)], alpha=0.7, edgecolor='none')

# Ajustes de visualização do gráfico de pizza
ax2.set_title('Tipos de Solicitação (Visão 3D)', fontsize=14, color='#F3F4F6', weight='bold', pad=20)
ax2.axis('off')  # Oculta linhas de grade para destacar o objeto 3D
ax2.view_init(elev=40, azim=-60)  # Inclinação superior para melhor leitura do círculo

# Legenda customizada ao lado com valores reais extraídos
legend_labels = [f"{label}: {val}" for label, val in zip(labels_tipos, valores_tipos)]
ax2.legend(legend_labels, loc="center left", bbox_to_anchor=(0.85, 0.5), facecolor='#1F2937', edgecolor='none')

plt.tight_layout()
plt.show()
