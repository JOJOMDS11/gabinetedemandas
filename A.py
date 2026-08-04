import requests
from bs4 import BeautifulSoup
import json
import os
import smtplib
import sys
import re # <-- IMPORTANTE: Biblioteca para extrair padrões de texto
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

FUSO_BRASILIA = ZoneInfo("America/Sao_Paulo")

ARQUIVO_DADOS = '/home/ubuntu/robo/proposicoes_vistas.json'
ARQUIVO_LOG_ERROS = '/home/ubuntu/robo/logs_de_erros.json'
ARQUIVO_LOG_EXECUCAO = '/home/ubuntu/robo/log_executivo.txt'
MAX_LINHAS_LOG = 100

EMAIL_REMETENTE = 'joaopedro.holdefer@gmail.com'
SENHA_APP = 'oyxp uxzi lqof egsp'
EMAIL_DESTINO_BRUTO = 'gabinetedaudt22500@gmail.com, vereadordanieldaudt@camarasaoleopoldo.rs.gov.br'
LISTA_EMAILS_DESTINO = [e.strip() for e in EMAIL_DESTINO_BRUTO.split(',') if e.strip()]

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
}

def carregar_vistos():
    if os.path.exists(ARQUIVO_DADOS):
        with open(ARQUIVO_DADOS, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def salvar_vistos(vistos):
    with open(ARQUIVO_DADOS, 'w', encoding='utf-8') as f:
        json.dump(vistos, f, ensure_ascii=False, indent=4)

def enviar_email(assunto, corpo):
    mensagem = MIMEMultipart()
    mensagem['From'] = EMAIL_REMETENTE
    mensagem['To'] = ', '.join(LISTA_EMAILS_DESTINO)
    mensagem['Subject'] = assunto
    mensagem.attach(MIMEText(corpo, 'plain', 'utf-8'))

    servidor = smtplib.SMTP('smtp.gmail.com', 587)
    servidor.starttls()
    servidor.login(EMAIL_REMETENTE, SENHA_APP)
    servidor.sendmail(EMAIL_REMETENTE, LISTA_EMAILS_DESTINO, mensagem.as_string())
    servidor.quit()

def log_execucao(status):
    agora = datetime.now(FUSO_BRASILIA)
    proxima = agora + timedelta(minutes=15)
    linha = (
        f"[{agora.strftime('%Y-%m-%d %H:%M:%S')}] "
        f"Status: {status} | "
        f"Proxima execucao prevista: {proxima.strftime('%Y-%m-%d %H:%M:%S')}"
    )
    print(linha)

    linhas_existentes = []
    if os.path.exists(ARQUIVO_LOG_EXECUCAO):
        with open(ARQUIVO_LOG_EXECUCAO, 'r', encoding='utf-8') as f:
            linhas_existentes = f.readlines()

    if len(linhas_existentes) >= MAX_LINHAS_LOG:
        linhas_existentes = []

    linhas_existentes.append(linha + "\n")

    with open(ARQUIVO_LOG_EXECUCAO, 'w', encoding='utf-8') as f:
        f.writelines(linhas_existentes)

def logar_falha(motivo):
    print(f"FALHA: {motivo}")
    agora = datetime.now(FUSO_BRASILIA)
    hoje_str = agora.strftime('%Y-%m-%d')
    
    erros = []
    if os.path.exists(ARQUIVO_LOG_ERROS):
        try:
            with open(ARQUIVO_LOG_ERROS, 'r', encoding='utf-8') as f:
                erros = json.load(f)
        except Exception:
            pass

    erros = [e for e in erros if e.get('data_hora', '').startswith(hoje_str)]
    
    erros.append({
        'data_hora': agora.strftime('%Y-%m-%d %H:%M:%S'),
        'motivo': motivo
    })
    
    erros = erros[-1:]

    with open(ARQUIVO_LOG_ERROS, 'w', encoding='utf-8') as f:
        json.dump(erros, f, ensure_ascii=False, indent=4)

def extrair_identificador(texto):
    """
    Busca estritamente o padrão 'Exp. NUM - PL NUM/ANO' no texto[span_1](start_span)[span_1](end_span).
    Ignora modificações feitas pela Câmara no restante da frase.
    """
    match = re.search(r'(Exp\.\s*\d+\s*-\s*PL\s*\d+/\d+)', texto, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    
    # Fallback caso o padrão falhe: quebra pelo hífen e pega os dois primeiros blocos
    partes = texto.split('-', 2)
    if len(partes) >= 2:
        return f"{partes[0].strip()} - {partes[1].strip()}"
    return texto

def buscar_novas_proposicoes():
    url_base = "https://legis.camarasaoleopoldo.rs.gov.br/"
    ano_atual = datetime.now().year
    url_alvo = f"{url_base}?sec=nlistaproposicoes&expediente=&especie=&numero=&ano={ano_atual}&keyword=&id_proponente=150"

    resposta = requests.get(url_alvo, headers=HEADERS, timeout=60)
    print(f"Status da resposta: {resposta.status_code}")

    if resposta.status_code != 200:
        logar_falha(f"Codigo de erro {resposta.status_code} (site fora do ar ou bloqueio de IP)")
        sys.exit(1)

    sopa = BeautifulSoup(resposta.text, 'html.parser')
    titulos_html = sopa.find_all('span', class_='pe_tit')
    print(f"Proposicoes encontradas na tela: {len(titulos_html)}")

    vistos_brutos = carregar_vistos()
    
    # Cria uma lista apenas com os identificadores (Exp. e PL) já registrados
    vistos_ids = set()
    for item in vistos_brutos:
        if isinstance(item, dict):
            # Formato novo: extrai do dicionário
            vistos_ids.add(item.get('id', extrair_identificador(item.get('texto', ''))))
        else:
            # Compatibilidade com seu JSON antigo: extrai da string completa
            vistos_ids.add(extrair_identificador(item))

    novas_expedicoes = []
    novos_vistos = list(vistos_brutos) # Mantém o histórico existente intacto

    for titulo in titulos_html:
        texto_proposicao = titulo.text.strip()
        tag_link = titulo.find_parent('a')

        if tag_link and 'href' in tag_link.attrs:
            link_completo = url_base + tag_link['href']
        else:
            link_completo = "Link nao disponivel."

        # Extrai APENAS o número do Exp e PL para testar a duplicidade[span_2](start_span)[span_2](end_span)
        identificador = extrair_identificador(texto_proposicao)

        # A validação acontece somente pelo identificador[span_3](start_span)[span_3](end_span)
        if identificador not in vistos_ids:
            novas_expedicoes.append({
                'texto': texto_proposicao, # Manda o texto completão para o e-mail
                'link': link_completo
            })
            vistos_ids.add(identificador) 
            
            # Salva no JSON o ID e o Texto Completo
            novos_vistos.append({
                'id': identificador,
                'texto': texto_proposicao
            })

    if novas_expedicoes:
        salvar_vistos(novos_vistos)

    return novas_expedicoes

try:
    novas = buscar_novas_proposicoes()
except SystemExit:
    log_execucao("ERRO - falha ao acessar a pagina, veja logs_de_erros.json")
    raise
except Exception as e:
    logar_falha(f"Excecao inesperada: {e}")
    log_execucao(f"ERRO - excecao inesperada: {e}")
    sys.exit(1)

if novas:
    print(f"Encontramos {len(novas)} novas proposicoes do Executivo!")
    assunto = "Novas Proposicoes do Executivo"
    corpo = "As seguintes proposicoes foram enviadas pela Prefeitura recentemente:\n\n"
    for p in novas:
        corpo += f"- {p['texto']}\n  Link: {p['link']}\n\n"
    try:
        enviar_email(assunto, corpo)
        print("E-mail com links enviado com sucesso!")
        log_execucao("OK - novidade encontrada e e-mail enviado")
    except Exception as e:
        print(f"Erro ao enviar o e-mail: {e}")
        log_execucao(f"ERRO - novidade encontrada mas falhou ao enviar e-mail: {e}")
else:
    print("Nenhuma novidade do Executivo.")
    log_execucao("OK - sem novidades")
