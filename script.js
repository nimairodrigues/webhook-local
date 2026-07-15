const CHAVE_STORAGE_TEMA = 'webhook-tema';

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  localStorage.setItem(CHAVE_STORAGE_TEMA, tema);

  const botao = document.getElementById('btn-alternar-tema');
  if (tema === 'escuro') {
    botao.textContent = '☀️ Modo claro';
    botao.setAttribute('aria-label', 'Ativar modo claro');
  } else {
    botao.textContent = '🌙 Modo escuro';
    botao.setAttribute('aria-label', 'Ativar modo escuro');
  }
}

function alternarTema() {
  const temaAtual = document.documentElement.getAttribute('data-tema') === 'escuro' ? 'escuro' : 'claro';
  aplicarTema(temaAtual === 'escuro' ? 'claro' : 'escuro');
}

aplicarTema(document.documentElement.getAttribute('data-tema') === 'escuro' ? 'escuro' : 'claro');
document.getElementById('btn-alternar-tema').addEventListener('click', alternarTema);

function definirVisivel(elementoOuId, visivel) {
  const elemento = typeof elementoOuId === 'string' ? document.getElementById(elementoOuId) : elementoOuId;
  elemento.style.display = visivel ? 'block' : 'none';
}

function mostrar(elementoOuId) {
  definirVisivel(elementoOuId, true);

  const elemento = typeof elementoOuId === 'string' ? document.getElementById(elementoOuId) : elementoOuId;
  elemento.classList.remove('fade-in');
  void elemento.offsetWidth;
  elemento.classList.add('fade-in');
}

function esconder(elementoOuId) {
  definirVisivel(elementoOuId, false);
}

async function comCarregamento(botao, acao) {
  if (!botao) {
    await acao();
    return;
  }

  botao.disabled = true;
  botao.classList.add('carregando');
  try {
    await acao();
  } finally {
    botao.disabled = false;
    botao.classList.remove('carregando');
  }
}

async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch (e) {
    const textarea = document.createElement('textarea');
    textarea.value = texto;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

async function postJSON(url, body, method = 'POST') {
  try {
    const resposta = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const dados = await resposta.json();
    return { ok: resposta.ok, dados };
  } catch (e) {
    return { ok: false, dados: null, erroConexao: true };
  }
}

const formatadorData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

let webhookId = null;
let intervaloPolling = null;

const INTERVALO_POLLING_MS = 3000;

function pararPolling() {
  if (intervaloPolling) clearInterval(intervaloPolling);
  intervaloPolling = null;
}

function iniciarPolling() {
  pararPolling();
  atualizarTudo();
  intervaloPolling = setInterval(atualizarTudo, INTERVALO_POLLING_MS);
}

async function atualizarTudo() {
  await Promise.all([carregarRequisicoes(), renderizarListaLateral()]);
}

async function carregarRequisicoes() {
  if (!webhookId) return;

  try {
    const resposta = await fetch('/api/webhooks/' + encodeURIComponent(webhookId));
    if (!resposta.ok) return;

    const webhook = await resposta.json();
    renderizarRequisicoes(webhook.requisicoes);
  } catch (e) {
    // Polling em segundo plano; falha de rede nao deve travar a tela.
  }
}

// O corpo cru chega como string (o servidor aceita qualquer Content-Type).
// Quando for JSON valido, exibimos ja parseado para o JSON.stringify abaixo
// formatar com indentacao; caso contrario mantemos a string original.
function parsearCorpoSePossivel(corpo) {
  if (typeof corpo !== 'string' || corpo.trim() === '') return corpo;

  try {
    return JSON.parse(corpo);
  } catch (e) {
    return corpo;
  }
}

// Headers que o proprio curl recalcula/define sozinho a partir da URL e do
// --data-raw; reenvia-los como -H fixo so causaria conflito ou lixo.
const HEADERS_IGNORADOS_NO_CURL = new Set(['host', 'content-length', 'connection', 'accept-encoding']);

function escaparParaAspasSimples(valor) {
  return String(valor).replace(/'/g, `'\\''`);
}

function montarComandoCurl(requisicao) {
  const url = window.location.origin + requisicao.caminho;
  const linhas = [`curl -X ${requisicao.metodo} '${escaparParaAspasSimples(url)}'`];

  Object.entries(requisicao.headers || {}).forEach(([chave, valor]) => {
    if (HEADERS_IGNORADOS_NO_CURL.has(chave.toLowerCase())) return;
    linhas.push(`  -H '${escaparParaAspasSimples(chave)}: ${escaparParaAspasSimples(valor)}'`);
  });

  if (requisicao.corpo) {
    linhas.push(`  --data-raw '${escaparParaAspasSimples(requisicao.corpo)}'`);
  }

  return linhas.join(' \\\n');
}

// Assinatura da ultima lista renderizada, para pular a reconstrucao do DOM
// quando o polling nao trouxe nenhuma requisicao nova. Sem isso, recriar o
// <pre> a cada 3s — mesmo restaurando o scrollTop depois — interrompe o
// gesto nativo de rolagem (principalmente inercia de trackpad) bem no meio,
// dando a sensacao de "travar" enquanto o usuario le um JSON grande.
let ultimaAssinaturaRequisicoes = null;

function renderizarRequisicoes(requisicoes) {
  const assinatura = requisicoes.map((r) => r.id).join(',');
  if (assinatura === ultimaAssinaturaRequisicoes) return;
  ultimaAssinaturaRequisicoes = assinatura;

  const lista = document.getElementById('requisicoes-lista');
  const vazio = document.getElementById('requisicoes-vazio');
  definirVisivel(vazio, requisicoes.length === 0);

  // O polling redesenha a lista inteira quando ha requisicao nova; sem isso,
  // qualquer <details> que o usuario tivesse aberto para ler os dados
  // fecharia sozinho no proximo ciclo. Guardamos quais ids estavam abertos
  // antes de limpar o DOM e reabrimos os correspondentes depois de recriar
  // os itens. Tambem guardamos a posicao de rolagem da lista e de cada <pre>
  // aberto, senao o usuario que estivesse lendo um JSON grande via scroll
  // seria "empurrado" de volta ao topo.
  const abertosAntes = new Set();
  const scrollPreAntes = new Map();
  lista.querySelectorAll('details[open]').forEach((detalhes) => {
    const item = detalhes.closest('li');
    if (!item) return;
    const testId = item.getAttribute('data-testid');
    abertosAntes.add(testId);
    const pre = detalhes.querySelector('pre');
    if (pre) scrollPreAntes.set(testId, pre.scrollTop);
  });
  const scrollListaAntes = lista.scrollTop;

  lista.innerHTML = '';

  requisicoes.forEach((requisicao) => {
    const item = document.createElement('li');
    const testId = `requisicao-${requisicao.id}`;
    item.setAttribute('data-testid', testId);

    const detalhes = document.createElement('details');
    if (abertosAntes.has(testId)) detalhes.open = true;
    const resumo = document.createElement('summary');

    const metodo = document.createElement('span');
    metodo.className = 'metodo';
    metodo.textContent = requisicao.metodo;
    resumo.appendChild(metodo);

    if (requisicao.statusCode) {
      const statusCode = document.createElement('span');
      statusCode.className = `status-code status-code-${Math.floor(requisicao.statusCode / 100)}xx`;
      statusCode.textContent = requisicao.statusCode;
      resumo.appendChild(statusCode);
    }

    if (requisicao.delayMs) {
      const delay = document.createElement('span');
      delay.className = 'delay-ms';
      delay.textContent = `⏱ ${requisicao.delayMs}ms`;
      resumo.appendChild(delay);
    }

    resumo.appendChild(document.createTextNode(
      `${requisicao.caminho} — ${formatadorData.format(new Date(requisicao.recebidoEm))}`
    ));

    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(
      { query: requisicao.query, headers: requisicao.headers, corpo: parsearCorpoSePossivel(requisicao.corpo) },
      null,
      2
    );

    const acoes = document.createElement('div');
    acoes.className = 'requisicao-acoes';

    const btnCurl = document.createElement('button');
    btnCurl.type = 'button';
    btnCurl.className = 'btn-copiar-curl';
    const rotuloCurlPadrao = '📋 Copiar curl';
    btnCurl.textContent = rotuloCurlPadrao;
    btnCurl.addEventListener('click', async () => {
      await copiarTexto(montarComandoCurl(requisicao));
      btnCurl.textContent = '✅ Copiado!';
      setTimeout(() => { btnCurl.textContent = rotuloCurlPadrao; }, 1500);
    });

    acoes.appendChild(btnCurl);

    detalhes.appendChild(resumo);
    detalhes.appendChild(acoes);
    detalhes.appendChild(pre);
    item.appendChild(detalhes);
    lista.appendChild(item);
  });

  // So depois de anexado ao DOM o <pre> tem uma caixa de rolagem valida;
  // setar scrollTop antes disso e ignorado pelo navegador.
  scrollPreAntes.forEach((scrollTop, testId) => {
    const pre = lista.querySelector(`[data-testid="${testId}"] pre`);
    if (pre) pre.scrollTop = scrollTop;
  });

  lista.scrollTop = scrollListaAntes;
}

const CHAVE_STORAGE_WEBHOOK_ATUAL = 'webhook-atual-id';

function mostrarConteudoWebhook() {
  document.getElementById('estado-vazio-principal').style.display = 'none';
  document.getElementById('conteudo-webhook').style.display = 'flex';
}

// Estado sem nenhuma URL selecionada: ao excluir a URL ativa ou nao haver
// nenhuma salva no localStorage, o app nao gera uma nova automaticamente —
// o usuario decide se quer criar outra.
function mostrarEstadoVazio() {
  webhookId = null;
  pararPolling();
  document.getElementById('conteudo-webhook').style.display = 'none';
  document.getElementById('estado-vazio-principal').style.display = 'flex';
}

function aplicarWebhookNaTela(webhook) {
  webhookId = webhook.id;
  localStorage.setItem(CHAVE_STORAGE_WEBHOOK_ATUAL, webhook.id);
  mostrarConteudoWebhook();

  document.getElementById('webhook-url').value = webhook.url;
  document.getElementById('status-code').value = webhook.statusCode;
  document.getElementById('delay-ms').value = webhook.delayMs || 0;
  document.getElementById('response-body').value = JSON.stringify(webhook.corpoResposta, null, 2);
  document.getElementById('requisicoes-lista').innerHTML = '';
  definirVisivel('requisicoes-vazio', true);
  ultimaAssinaturaRequisicoes = null;

  iniciarPolling();
}

async function gerarWebhook() {
  const inputPersonalizado = document.getElementById('url-personalizada');
  const erro = document.getElementById('erro-nova-url');
  esconder(erro);

  const idPersonalizado = inputPersonalizado.value.trim();
  const { ok, dados } = await postJSON('/api/webhooks', idPersonalizado ? { id: idPersonalizado } : {});
  if (!ok) {
    erro.textContent = (dados && dados.erro) || 'Nao foi possivel gerar a URL.';
    mostrar(erro);
    return;
  }

  inputPersonalizado.value = '';
  aplicarWebhookNaTela({
    id: dados.id,
    url: dados.url,
    statusCode: 200,
    delayMs: 0,
    corpoResposta: { ok: true }
  });
}

// Troca para um webhook ja existente (selecionado na barra lateral ou
// restaurado do localStorage ao recarregar a pagina).
async function usarWebhookExistente(id) {
  try {
    const resposta = await fetch('/api/webhooks/' + encodeURIComponent(id));
    if (!resposta.ok) return false;

    const webhook = await resposta.json();
    aplicarWebhookNaTela(webhook);
    return true;
  } catch (e) {
    return false;
  }
}

async function iniciarWebhookInicial() {
  const idSalvo = localStorage.getItem(CHAVE_STORAGE_WEBHOOK_ATUAL);
  if (idSalvo && (await usarWebhookExistente(idSalvo))) return;

  localStorage.removeItem(CHAVE_STORAGE_WEBHOOK_ATUAL);
  mostrarEstadoVazio();
  await renderizarListaLateral();
}

// Preenche a barra lateral com todas as URLs geradas. Chamada ao trocar de
// webhook e a cada ciclo de polling, para manter as contagens de requisicoes
// atualizadas.
async function renderizarListaLateral() {
  const lista = document.getElementById('urls-lista');
  const vazio = document.getElementById('urls-vazio');

  try {
    const resposta = await fetch('/api/webhooks');
    if (!resposta.ok) return;

    const webhooks = await resposta.json();
    definirVisivel(vazio, webhooks.length === 0);
    lista.innerHTML = '';

    webhooks.forEach((webhook) => {
      const item = document.createElement('li');
      item.setAttribute('data-testid', `url-${webhook.id}`);
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      if (webhook.id === webhookId) item.classList.add('ativo');

      const info = document.createElement('div');
      info.className = 'urls-lista-info';

      const url = document.createElement('span');
      url.className = 'urls-lista-url';
      url.textContent = webhook.url.replace(/^https?:\/\//, '');

      const meta = document.createElement('span');
      meta.className = 'urls-lista-meta';
      meta.textContent = `${formatadorData.format(new Date(webhook.criadoEm))} — ${webhook.totalRequisicoes} requisição(ões)`;

      info.appendChild(url);
      info.appendChild(meta);

      const btnExcluir = document.createElement('button');
      btnExcluir.type = 'button';
      btnExcluir.className = 'btn-excluir-url';
      btnExcluir.setAttribute('aria-label', 'Excluir URL');
      btnExcluir.textContent = '✕';
      btnExcluir.addEventListener('click', function(evento) {
        evento.stopPropagation();
        excluirWebhook(webhook.id);
      });

      const selecionar = () => {
        if (webhook.id !== webhookId) usarWebhookExistente(webhook.id);
      };
      item.addEventListener('click', selecionar);
      item.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') {
          evento.preventDefault();
          selecionar();
        }
      });

      item.appendChild(info);
      item.appendChild(btnExcluir);
      lista.appendChild(item);
    });
  } catch (e) {
    // Lista best-effort; falha de rede nao deve travar a tela.
  }
}

async function excluirWebhook(id) {
  const resposta = await fetch('/api/webhooks/' + encodeURIComponent(id), { method: 'DELETE' });
  if (!resposta.ok && resposta.status !== 404) return;

  if (id === webhookId) {
    localStorage.removeItem(CHAVE_STORAGE_WEBHOOK_ATUAL);
    mostrarEstadoVazio();
  }

  await renderizarListaLateral();
}

// Recarrega os valores atuais do webhook do servidor antes de abrir o modal,
// senao um valor digitado e depois descartado (fechar sem salvar) ficaria
// preso nos campos na proxima vez que o modal fosse aberto.
async function abrirModalConfig() {
  esconder(document.getElementById('erro-config'));
  esconder(document.getElementById('sucesso-config'));

  const resposta = await fetch('/api/webhooks/' + encodeURIComponent(webhookId));
  if (resposta.ok) {
    const webhook = await resposta.json();
    document.getElementById('status-code').value = webhook.statusCode;
    document.getElementById('delay-ms').value = webhook.delayMs || 0;
    document.getElementById('response-body').value = JSON.stringify(webhook.corpoResposta, null, 2);
  }

  document.getElementById('modal-config-overlay').classList.add('aberto');
}

function fecharModalConfig() {
  document.getElementById('modal-config-overlay').classList.remove('aberto');
}

// Apenas reformata o texto no textarea para leitura; nao salva nada sozinho —
// o usuario ainda precisa clicar em "Salvar configuracoes" depois.
function formatarJsonDoTextarea() {
  const textarea = document.getElementById('response-body');
  const erro = document.getElementById('erro-config');

  try {
    const valor = JSON.parse(textarea.value);
    textarea.value = JSON.stringify(valor, null, 2);
    esconder(erro);
  } catch (e) {
    erro.textContent = 'Corpo de resposta: JSON invalido, nao foi possivel formatar.';
    mostrar(erro);
  }
}

async function salvarConfiguracoes() {
  const inputStatusCode = document.getElementById('status-code');
  const inputDelayMs = document.getElementById('delay-ms');
  const textareaCorpo = document.getElementById('response-body');
  const sucesso = document.getElementById('sucesso-config');
  const erro = document.getElementById('erro-config');

  esconder(sucesso);
  esconder(erro);

  const statusCode = Number(inputStatusCode.value);
  const delayMs = Number(inputDelayMs.value);

  let corpo;
  try {
    corpo = JSON.parse(textareaCorpo.value);
  } catch (e) {
    erro.textContent = 'Corpo de resposta: JSON invalido.';
    mostrar(erro);
    return;
  }

  const respostaStatusCode = await postJSON(
    '/api/webhooks/' + encodeURIComponent(webhookId) + '/status-code',
    { statusCode },
    'PUT'
  );
  if (!respostaStatusCode.ok) {
    erro.textContent = (respostaStatusCode.dados && respostaStatusCode.dados.erro) || 'Nao foi possivel atualizar o status code.';
    mostrar(erro);
    return;
  }

  const respostaDelay = await postJSON(
    '/api/webhooks/' + encodeURIComponent(webhookId) + '/delay',
    { delayMs },
    'PUT'
  );
  if (!respostaDelay.ok) {
    erro.textContent = (respostaDelay.dados && respostaDelay.dados.erro) || 'Nao foi possivel atualizar o delay.';
    mostrar(erro);
    return;
  }

  const respostaCorpo = await postJSON(
    '/api/webhooks/' + encodeURIComponent(webhookId) + '/response-body',
    { corpo },
    'PUT'
  );
  if (!respostaCorpo.ok) {
    erro.textContent = (respostaCorpo.dados && respostaCorpo.dados.erro) || 'Nao foi possivel atualizar o corpo de resposta.';
    mostrar(erro);
    return;
  }

  mostrar(sucesso);
  setTimeout(() => {
    esconder(sucesso);
    fecharModalConfig();
  }, 1200);
}

document.getElementById('btn-copiar-url').addEventListener('click', async function() {
  const input = document.getElementById('webhook-url');
  const sucesso = document.getElementById('sucesso-copia');

  await copiarTexto(input.value);

  mostrar(sucesso);
  setTimeout(() => esconder(sucesso), 2000);
});

document.getElementById('btn-nova-url').addEventListener('click', function() {
  comCarregamento(document.getElementById('btn-nova-url'), gerarWebhook);
});

document.getElementById('btn-abrir-config').addEventListener('click', function() {
  comCarregamento(document.getElementById('btn-abrir-config'), abrirModalConfig);
});
document.getElementById('btn-fechar-config').addEventListener('click', fecharModalConfig);
document.getElementById('btn-formatar-json').addEventListener('click', formatarJsonDoTextarea);

document.getElementById('modal-config-overlay').addEventListener('click', function(evento) {
  if (evento.target === evento.currentTarget) fecharModalConfig();
});

document.addEventListener('keydown', function(evento) {
  if (evento.key === 'Escape') fecharModalConfig();
});

document.getElementById('btn-salvar-config').addEventListener('click', function() {
  comCarregamento(document.getElementById('btn-salvar-config'), salvarConfiguracoes);
});

iniciarWebhookInicial();
