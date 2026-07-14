const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'webhook.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    criado_em TEXT NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 200,
    corpo_resposta TEXT NOT NULL DEFAULT '{"ok":true}',
    delay_ms INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS requisicoes (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    metodo TEXT NOT NULL,
    caminho TEXT NOT NULL,
    query TEXT NOT NULL,
    headers TEXT NOT NULL,
    corpo TEXT NOT NULL,
    recebido_em TEXT NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 200,
    delay_ms INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_requisicoes_webhook
    ON requisicoes (webhook_id, recebido_em DESC);
`);

// Migracao leve para bancos ja existentes criados antes de colunas novas
// existirem (CREATE TABLE IF NOT EXISTS nao altera tabelas ja criadas).
const colunasRequisicoes = db.prepare('PRAGMA table_info(requisicoes)').all().map((c) => c.name);
if (!colunasRequisicoes.includes('status_code')) {
  db.exec('ALTER TABLE requisicoes ADD COLUMN status_code INTEGER NOT NULL DEFAULT 200');
}
if (!colunasRequisicoes.includes('delay_ms')) {
  db.exec('ALTER TABLE requisicoes ADD COLUMN delay_ms INTEGER NOT NULL DEFAULT 0');
}

const colunasWebhooks = db.prepare('PRAGMA table_info(webhooks)').all().map((c) => c.name);
if (!colunasWebhooks.includes('delay_ms')) {
  db.exec('ALTER TABLE webhooks ADD COLUMN delay_ms INTEGER NOT NULL DEFAULT 0');
}

module.exports = db;
