# lib/room — funções de sala (futuro)

**Estado atual (Fase 1):** vazio de propósito. Esta pasta só reserva o lugar.

## O que vai morar aqui

- Gerar e validar o identificador (ID) de uma sala.
- Montar o nome da sala e as regras de nome de participante.
- Gerar o token de acesso do LiveKit (Fase 2). Essa parte roda **só no servidor**,
  porque usa `LIVEKIT_API_SECRET`, que nunca pode ir para o navegador.
- Tipos compartilhados da sala (por exemplo `Participant`, `RoomRole`).

## Regras para o futuro

- Código que usa segredo fica em arquivos usados apenas por rotas em `src/app/api/`.
- Código que o navegador também usa não pode ler variáveis `LIVEKIT_API_*`.
- O limite de 6 participantes por sala será tratado na fase própria dele.
