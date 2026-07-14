const express = require('express');
const crypto = require('crypto');
const db = require('./db');

const app = express();

const LIMITE_REQUISICOES_POR_WEBHOOK = 50;
const STATUS_CODE_PADRAO = 200;
const CORPO_RESPOSTA_PADRAO = { ok: true };

function gerarId() {
  return crypto.randomBytes(6).toString('hex');
}

function montarUrl(req, id) {
  return `${req.protocol}://${req.get('host')}/wh/${id}`;
}

function linhaParaRequisicao(linha) {
  return {
    id: linha.id,
    metodo: linha.metodo,
    caminho: linha.caminho,
    query: JSON.parse(linha.query),
    headers: JSON.parse(linha.headers),
    corpo: linha.corpo,
    recebidoEm: linha.recebido_em,
    statusCode: linha.status_code,
    delayMs: linha.delay_ms
  };
}

const inserirWebhook = db.prepare(
  'INSERT INTO webhooks (id, criado_em, status_code, corpo_resposta) VALUES (?, ?, ?, ?)'
);
const buscarWebhook = db.prepare('SELECT * FROM webhooks WHERE id = ?');
const listarWebhooksStmt = db.prepare(`
  SELECT w.id, w.criado_em,
    (SELECT COUNT(*) FROM requisicoes r WHERE r.webhook_id = w.id) AS total_requisicoes
  FROM webhooks w
  ORDER BY w.criado_em DESC
`);
const excluirWebhookStmt = db.prepare('DELETE FROM webhooks WHERE id = ?');
const atualizarStatusCodeStmt = db.prepare('UPDATE webhooks SET status_code = ? WHERE id = ?');
const atualizarCorpoRespostaStmt = db.prepare('UPDATE webhooks SET corpo_resposta = ? WHERE id = ?');
const atualizarDelayStmt = db.prepare('UPDATE webhooks SET delay_ms = ? WHERE id = ?');

const inserirRequisicao = db.prepare(`
  INSERT INTO requisicoes (id, webhook_id, metodo, caminho, query, headers, corpo, recebido_em, status_code, delay_ms)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const listarRequisicoesStmt = db.prepare(
  'SELECT * FROM requisicoes WHERE webhook_id = ? ORDER BY recebido_em DESC LIMIT ?'
);
const excluirRequisicoesAntigas = db.prepare(`
  DELETE FROM requisicoes
  WHERE webhook_id = ?
  AND id NOT IN (
    SELECT id FROM requisicoes WHERE webhook_id = ? ORDER BY recebido_em DESC LIMIT ?
  )
`);

const REGEX_SEGMENTO_ID = /^[a-zA-Z0-9_-]+$/;

// O ID personalizado pode ter varios segmentos separados por "/" (ex:
// "minha-empresa/pedidos"), formando um path proprio para o webhook.
function idPersonalizadoValido(id) {
  if (id.length < 3 || id.length > 100) return false;
  if (id.startsWith('/') || id.endsWith('/') || id.includes('//')) return false;
  return id.split('/').every((segmento) => REGEX_SEGMENTO_ID.test(segmento));
}

const listarIdsStmt = db.prepare('SELECT id FROM webhooks');

// Encontra o webhook cujo ID e o prefixo mais especifico do caminho
// requisitado, permitindo que um ID multi-segmento (ex: "loja/pedidos")
// conviva com um path extra livre depois dele (ex: "loja/pedidos/qualquer").
function encontrarWebhookPorCaminho(caminho) {
  const ids = listarIdsStmt.all()
    .map((linha) => linha.id)
    .sort((a, b) => b.length - a.length);

  for (const id of ids) {
    if (caminho === id || caminho.startsWith(id + '/')) {
      return buscarWebhook.get(id);
    }
  }
  return null;
}

app.post('/api/webhooks', express.json(), (req, res) => {
  const idPersonalizado = req.body && typeof req.body.id === 'string' ? req.body.id.trim() : '';

  let id;
  if (idPersonalizado) {
    if (!idPersonalizadoValido(idPersonalizado)) {
      return res.status(400).json({
        erro: 'ID invalido. Use de 3 a 100 caracteres entre letras, numeros, "-", "_" e "/" (sem barras duplicadas ou nas pontas).'
      });
    }
    if (buscarWebhook.get(idPersonalizado)) {
      return res.status(409).json({ erro: 'Ja existe uma URL com esse ID.' });
    }
    id = idPersonalizado;
  } else {
    do {
      id = gerarId();
    } while (buscarWebhook.get(id));
  }

  inserirWebhook.run(id, new Date().toISOString(), STATUS_CODE_PADRAO, JSON.stringify(CORPO_RESPOSTA_PADRAO));
  res.status(201).json({ id, url: montarUrl(req, id) });
});

// Lista todos os webhooks gerados (mais recentes primeiro), para a barra
// lateral. Nao ha autenticacao por usuario nesta ferramenta, entao a lista e
// global ao banco de dados.
app.get('/api/webhooks', (req, res) => {
  const lista = listarWebhooksStmt.all().map((webhook) => ({
    id: webhook.id,
    url: montarUrl(req, webhook.id),
    criadoEm: webhook.criado_em,
    totalRequisicoes: webhook.total_requisicoes
  }));

  res.json(lista);
});

app.get('/api/webhooks/:id', (req, res) => {
  const webhook = buscarWebhook.get(req.params.id);
  if (!webhook) {
    return res.status(404).json({ erro: 'Webhook nao encontrado.' });
  }

  const requisicoes = listarRequisicoesStmt
    .all(req.params.id, LIMITE_REQUISICOES_POR_WEBHOOK)
    .map(linhaParaRequisicao);

  res.json({
    id: webhook.id,
    url: montarUrl(req, webhook.id),
    criadoEm: webhook.criado_em,
    statusCode: webhook.status_code,
    corpoResposta: JSON.parse(webhook.corpo_resposta),
    delayMs: webhook.delay_ms,
    requisicoes
  });
});

app.delete('/api/webhooks/:id', (req, res) => {
  const resultado = excluirWebhookStmt.run(req.params.id);
  if (resultado.changes === 0) {
    return res.status(404).json({ erro: 'Webhook nao encontrado.' });
  }
  res.status(204).end();
});

app.put('/api/webhooks/:id/status-code', express.json(), (req, res) => {
  const webhook = buscarWebhook.get(req.params.id);
  if (!webhook) {
    return res.status(404).json({ erro: 'Webhook nao encontrado.' });
  }

  const statusCode = Number(req.body && req.body.statusCode);
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return res.status(400).json({ erro: 'statusCode invalido. Use um numero inteiro entre 100 e 599.' });
  }

  atualizarStatusCodeStmt.run(statusCode, req.params.id);
  res.json({ statusCode });
});

app.put('/api/webhooks/:id/response-body', express.json(), (req, res) => {
  const webhook = buscarWebhook.get(req.params.id);
  if (!webhook) {
    return res.status(404).json({ erro: 'Webhook nao encontrado.' });
  }

  if (!('corpo' in req.body)) {
    return res.status(400).json({ erro: 'Informe o campo "corpo" com o JSON desejado.' });
  }

  atualizarCorpoRespostaStmt.run(JSON.stringify(req.body.corpo), req.params.id);
  res.json({ corpo: req.body.corpo });
});

const DELAY_MAXIMO_MS = 30000;

app.put('/api/webhooks/:id/delay', express.json(), (req, res) => {
  const webhook = buscarWebhook.get(req.params.id);
  if (!webhook) {
    return res.status(404).json({ erro: 'Webhook nao encontrado.' });
  }

  const delayMs = Number(req.body && req.body.delayMs);
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > DELAY_MAXIMO_MS) {
    return res.status(400).json({
      erro: `delayMs invalido. Use um numero inteiro entre 0 e ${DELAY_MAXIMO_MS}.`
    });
  }

  atualizarDelayStmt.run(delayMs, req.params.id);
  res.json({ delayMs });
});

// Captura o corpo cru independente do Content-Type, ja que o webhook precisa
// aceitar qualquer tipo de requisicao (JSON, texto, form, binario, etc).
const capturarCorpo = express.text({ type: '*/*', limit: '2mb' });

function registrarRequisicao(req, res) {
  const webhook = encontrarWebhookPorCaminho(req.params[0]);
  if (!webhook) {
    return res.status(404).json({ erro: 'Webhook nao encontrado.' });
  }

  // Quando nao ha corpo na requisicao (ex: GET), o body-parser deixa
  // req.body como um objeto vazio {} em vez de string ou undefined. Como {}
  // e "truthy", isso escapava do fallback e chegava um objeto ate o SQLite.
  const corpo = typeof req.body === 'string' ? req.body : '';

  inserirRequisicao.run(
    crypto.randomUUID(),
    webhook.id,
    req.method,
    req.originalUrl,
    JSON.stringify(req.query),
    JSON.stringify(req.headers),
    corpo,
    new Date().toISOString(),
    webhook.status_code,
    webhook.delay_ms
  );

  excluirRequisicoesAntigas.run(webhook.id, webhook.id, LIMITE_REQUISICOES_POR_WEBHOOK);

  console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${req.method} ${req.originalUrl} recebida`);

  const responder = () => {
    res.status(webhook.status_code).json(JSON.parse(webhook.corpo_resposta));
    console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${req.method} ${req.originalUrl} → ${webhook.status_code} respondida`);
  };

  if (webhook.delay_ms > 0) {
    setTimeout(responder, webhook.delay_ms);
  } else {
    responder();
  }
}

app.all('/wh/*', capturarCorpo, registrarRequisicao);

app.use(express.static(__dirname));

// Erros de parsing do express.json() (JSON invalido no corpo) caem aqui.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON invalido no corpo da requisicao.' });
  }
  next(err);
});

app.listen(3002, () => console.log('Servidor rodando em http://localhost:3002'));
