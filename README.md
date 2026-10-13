# Discord 2

Compartilhamento de tela e áudio com Next.js, React, TypeScript e LiveKit.
Até seis participantes por sala, com uma reserva de transmissão por vez.
O visual usa CSS próprio; esta revisão preserva a interface existente.

## Executar

Requer Node.js 20.9+ e npm.

```bash
npm ci
cp .env.example .env.local
# Preencha as variáveis no arquivo local; nunca publique seus valores.
npm run dev
```

Abra http://localhost:3000. Em outro dispositivo, captura exige contexto seguro
(HTTPS; localhost é a exceção). HTTP por IP na rede local pode permitir assistir,
mas não habilita as APIs de captura do navegador.

```bash
npm run lint
npm test
npm run build
npm run start
```

`npm test` compila os testes em `.test-build/` e verifica segurança e rollback de
captura sem credenciais reais ou chamadas a LiveKit/Redis/Cloudflare.

## Configuração

Veja `.env.example` para todos os nomes:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: servidor e credenciais.
- `ROOM_INVITE_SECRET`: segredo aleatório para assinar os convites; trocar a chave
  invalida convites existentes para novos tokens.
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: limites, trava e reserva de
  transmissão compartilhados entre instâncias.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`: verificação da criação
  de convites. Somente a site key é pública.
- `TURNSTILE_ALLOWED_HOSTNAME`: hostname exato esperado em produção.
- `ENABLE_SHARE_IN_PRODUCTION=true`: habilitação explícita de transmissão em produção;
  o padrão é bloqueado.

## Fluxo atual

1. A criação verifica Turnstile e gera um convite assinado de 64 caracteres hexadecimais.
2. Ao entrar, a pessoa escolhe nome e foto opcional. A foto é reduzida para JPEG.
3. A API verifica o convite, prepara a sala no LiveKit com `maxParticipants: 6` e
   emite token de espectador. O SDK conecta e recebe presença e trilhas existentes.
4. A API de transmissão autentica o token e concede apenas fontes de tela e áudio
   de tela, sob reserva e trava Redis. Câmera, microfone e dados não são concedidos.
5. A captura só começa por clique. O áudio automático depende de o navegador
   fornecer a trilha; no Linux existe opção avançada com confirmação de fonte.
6. Ao parar, a permissão é revogada antes de remover a reserva. Ao sair, as trilhas
   locais são paradas; capturas que terminem de abrir depois da saída são descartadas.

Os perfis são 480p/20 FPS, 720p/30 FPS e 1080p/60 FPS, sujeitos ao hardware,
à rede e ao navegador. Simulcast e adaptive stream já estão habilitados.
Não há login, senha, gravação, expiração individual ou revogação individual de convites.
Quem tem o link pode pedir entrada: convite assinado não identifica a pessoa.

## Estrutura

- `src/app/api/rooms/create`: Turnstile e assinatura de convites.
- `src/app/api/livekit/token`: validação do perfil e emissão de token.
- `src/app/api/livekit/share`: exclusividade e permissões de transmissão.
- `src/components/room`: conexão, captura, vídeo, áudio e controles existentes.
- `src/lib/capture`: rollback de publicação de trilhas.
- `src/lib/security`: Redis, limites e leitura limitada de JSON.
- `src/lib/room`: convites, IDs e perfis.
- `tests`: regressões de segurança e captura.

Veja [a análise técnica](docs/ANALISE-DISCORD-2.md) para alterações, riscos pendentes,
limites da verificação e cenários de validação com navegadores reais.

## Integração real e publicação

Veja [o relatório de integração real](docs/INTEGRACAO-REAL.md) para cenários
comprovados e isolamento dos serviços. A [revisão final](docs/REVISAO-FINAL.md)
distingue ambiente local/Render, validação manual anterior e smoke tests pós-deploy.
`npm run test:integration` acessa serviços reais explicitamente; `npm test` permanece local.

O modelo `.env.example` é para configuração local; copiá-lo não altera as variáveis
do Render. Preserve os valores já configurados no serviço publicado.
