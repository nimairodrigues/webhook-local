# Webhook

Ferramenta local para testar webhooks: gera URLs que capturam qualquer requisição HTTP recebida (método, headers, query string e body), permite configurar a resposta (status code, corpo JSON e delay) e guarda tudo em um banco SQLite local — as URLs e o histórico de requisições continuam disponíveis mesmo depois de reiniciar o servidor.

## Funcionalidades

- Gera URLs aleatórias (`/wh/<id>`) ou personalizadas, inclusive com path multi-segmento (ex: `/wh/loja/pedidos`).
- Captura qualquer requisição HTTP (qualquer método, `Content-Type` ou corpo) enviada para a URL gerada.
- Configuração por URL, editável a qualquer momento:
  - **Status code** de resposta.
  - **Corpo JSON** de resposta.
  - **Delay** (em milissegundos) antes de responder, para simular latência.
- Botão **"✨ Formatar JSON"** no modal de configurações, para reformatar o corpo de resposta com indentação antes de salvar.
- Cada requisição recebida fica salva com o status code, o body de resposta e o delay que estavam configurados naquele momento (histórico fiel, mesmo se a configuração mudar depois), exibidos como badges (método, status code e delay) na lista.
- Barra lateral com todas as URLs geradas, contagem de requisições recebidas por cada uma, e opção de excluir (excluir uma URL apaga também suas requisições salvas).
- É possível ficar sem nenhuma URL cadastrada — o app nunca gera uma nova automaticamente por conta própria (nem ao excluir a última, nem ao abrir sem nenhuma salva).
- Botão para copiar a URL e para copiar um comando `curl` equivalente a qualquer requisição recebida.
- Persistência em SQLite (`webhook.db`) — nada se perde ao reiniciar o servidor.
- Limite de 50 requisições guardadas por URL (as mais antigas são descartadas automaticamente).

## Stack

- Node.js + [Express](https://expressjs.com/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) para persistência
- Frontend em HTML/CSS/JS puro, sem framework

## Como rodar

Requer Node.js 18+.

```bash
npm install
npm start
```

O servidor sobe em `http://localhost:3002`. Na primeira execução, o arquivo `webhook.db` é criado automaticamente na raiz do projeto.

Para desenvolvimento com recarregamento automático:

```bash
npm run dev
```

## Uso

1. Abra `http://localhost:3002` no navegador.
2. Clique em **"+ Gerar nova URL"** na barra lateral (ou digite um ID/path personalizado antes de gerar).
3. Copie a URL gerada e envie requisições HTTP para ela (qualquer método).
4. As requisições recebidas aparecem na lista, em tempo real (polling a cada 3s).
5. Clique em **"⚙️ Configurações"** para definir o status code, o body e o delay de resposta daquela URL.
6. Clique em uma URL na barra lateral para trocar de contexto e ver suas requisições.

## Estrutura do projeto

```
server.js   → servidor Express e rotas da API
db.js       → conexão e schema do SQLite (com migrações leves automáticas)
index.html  → estrutura da página
script.js   → lógica do frontend (polling, modais, barra lateral)
style.css   → estilos
```

## API

| Método | Rota                              | Descrição                                  |
|--------|------------------------------------|---------------------------------------------|
| POST   | `/api/webhooks`                    | Cria uma URL (`{ "id": "opcional" }`)       |
| GET    | `/api/webhooks`                    | Lista todas as URLs geradas                 |
| GET    | `/api/webhooks/:id`                | Detalhe de uma URL + suas requisições       |
| DELETE | `/api/webhooks/:id`                | Exclui a URL e suas requisições             |
| PUT    | `/api/webhooks/:id/status-code`    | Define o status code de resposta            |
| PUT    | `/api/webhooks/:id/response-body`  | Define o corpo JSON de resposta             |
| PUT    | `/api/webhooks/:id/delay`          | Define o delay de resposta (0–30000 ms)     |
| *      | `/wh/*`                            | Endpoint que recebe as requisições de teste — resolve o webhook pelo prefixo mais específico registrado, permitindo IDs multi-segmento conviverem com path livre depois deles |

## Limitações conhecidas

- Não há autenticação — qualquer pessoa com acesso à instância pode ver e excluir qualquer URL gerada. Pensado para uso local/individual.
- Sem rate limiting.

Mais detalhes e ideias de melhoria em [`melhorias para webhook.txt`](./melhorias%20para%20webhook.txt).
