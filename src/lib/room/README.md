# lib/room — identificadores de salas

**Fase 2:** `room-id.ts` cria IDs aleatórios e valida IDs e links locais.
A URL representa uma sala visual: nada é salvo em banco de dados nem há
uma sessão, presença de usuários ou conexão entre navegadores.

- `generateRoomId()` gera um ID imprevisível usando a API Web Crypto.
- `isValidRoomId()` aceita apenas letras minúsculas, números e hífens (3 a 64 caracteres).
- `readRoomId()` valida um ID ou um link da mesma origem do site, sem redirecionar a sites externos.

**Importante:** um ID difícil de adivinhar não substitui autenticação e permissões.
A proteção das salas, a geração de tokens LiveKit e o limite de participantes
serão implementados em fases futuras. Nenhum segredo do LiveKit pode ir para o navegador.
