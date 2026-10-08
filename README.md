# Discord 2

Sistema **privado** de compartilhamento de tela (com áudio) para um grupo pequeno
de amigos: uma pessoa transmite, as outras assistem.

> **Estado atual: Fase 1 — estrutura inicial.**
> Só existe a base do projeto e telas visuais. Ainda não há LiveKit, WebRTC,
> compartilhamento de tela, login, limite de participantes nem gravação.

## Tecnologias

- Next.js (App Router) + React + TypeScript
- CSS comum (sem Tailwind)
- LiveKit Cloud (a partir da Fase 2)
- Sem banco de dados no MVP

## Requisitos

- Node.js **20.9 ou superior** (confira com `node -v`)
- npm (vem com o Node.js)
- Git

## Como executar

```bash
npm install     # baixa as dependências (só na primeira vez)
npm run dev     # inicia o servidor de desenvolvimento
```

Depois abra no navegador:

- Página inicial: <http://localhost:3000>
- Sala de exemplo (só visual): <http://localhost:3000/sala/exemplo>
- Teste do backend: <http://localhost:3000/api/health>

### Testar o backend (`/api/health`)

No navegador, abra a URL acima, ou no terminal:

```bash
curl http://localhost:3000/api/health
```

Resposta esperada (a hora muda a cada chamada):

```json
{ "status": "ok", "service": "screen-share", "timestamp": "2026-10-08T21:00:00.000Z" }
```

## Outros comandos

```bash
npm run lint    # verifica o código com o ESLint
npm run build   # gera a versão de produção
npm run start   # roda a versão de produção (depois do build)
```

## Estrutura de pastas

```
screen-share/
├── .env.example          nomes das variáveis do LiveKit (sem valores)
├── .gitignore            protege .env.local; libera .env.example
├── README.md
├── package.json, tsconfig.json, next.config.ts, eslint.config.mjs
└── src/
    ├── app/                          interface principal e backend
    │   ├── layout.tsx                molde comum das páginas
    │   ├── page.tsx                  página inicial (/)
    │   ├── globals.css               tema escuro
    │   ├── sala/[roomId]/page.tsx    página de sala (só visual)
    │   └── api/health/route.ts       rota de teste do backend
    ├── components/room/              peças visuais da sala
    │   ├── RoomScreen.tsx
    │   ├── StreamArea.tsx
    │   ├── ParticipantList.tsx
    │   └── RoomControls.tsx
    └── lib/
        ├── room/                     (futuro) funções de sala
        └── capture/                  (futuro) captura de tela e áudio
```

## Variáveis de ambiente

Copie o modelo e preencha **somente** no seu computador:

```bash
cp .env.example .env.local
```

O arquivo `.env.local` está no `.gitignore` e nunca deve ir para o Git.
Estas variáveis só passam a ser usadas na Fase 2.

## Ainda NÃO implementado

- LiveKit, WebRTC e conexão em tempo real
- Criação de sala e geração de ID (a sala de exemplo aceita qualquer texto na URL)
- Compartilhamento de tela e de áudio
- Limite de 6 participantes
- Login e senha
- Gravação
- Banco de dados
