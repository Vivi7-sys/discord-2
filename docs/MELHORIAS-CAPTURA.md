# Revisão de captura — 14/10/2026

Base: c5cb156. Sem push, deploy, alteração de variáveis de produção ou dependências
do projeto. SDK Node e jsdom de teste foram instalados somente em /tmp.

## Implementado

- `ShareDialog.tsx`, `RoomControls.tsx`, `LiveKitRoomConnection.tsx` e
  `globals.css`: seletores transferidos para diálogo nativo antes do seletor do
  navegador. Selecionar tela preserva gesto direto do usuário. Cancelar/Escape
  liberam a vez pelo endpoint existente. Cancelamento do seletor nativo mantém
  o rollback anterior. Falha na liberação continua visível com opção Cancelar vez.
  Volume, solicitação exclusiva e demais controles do player preservados.
- `screen-options.ts`: Alta solicita 1080p30/5 Mbps; demais perfis preservados.
  `balanced`, simulcast padrão do SDK, VP8 e dynacast permitem adaptação sem
  reduzir a resolução de todos. Não foi comprovado ganho de latência fim a fim.
- `media-diagnostics.ts`: estatísticas WebRTC opcionais, locais, sem interface
  técnica por padrão ou telemetria. Ativação e interpretação em
  `src/lib/capture/README.md`.
- `icon.svg`: favicon D2 com paths, independente de fontes. Metadata automática
  do Next gera um único link de ícone; não havia favicon anterior concorrente.
- Áudio automático solicita restrição de áudio da própria aba quando suportada
  e mantém reprodução local. Modal explica compatibilidade e alternativas.
- Fonte Linux exige entrada virtual previamente identificada e deviceId exato;
  não abre microfone/entrada padrão para descobrir dispositivos. Fonte ausente
  mantém vídeo funcionando com orientação. Confirmação manual existente permanece
  para nome genérico retornado após seleção do ID virtual.

- Sexta melhoria: removido o botão de engrenagem da barra. `RoomIcon.tsx`
  não contém mais o SVG/tipo settings, e `globals.css` não contém mais os estilos
  room-settings do painel antigo. Modal, três qualidades e três modos de áudio
  preservados. Compartilhar/parar, volume, teatro, tela cheia e autohide mantidos.

## Investigação de desempenho

Inspecionados capture options, conversão do SDK para getDisplayMedia, presets,
encoder/publicação, simulcast, Room/adaptiveStream, anexação de vídeo/áudio,
volume/Web Audio, eventos React e reconexão. O fluxo não recodifica vídeo no
receptor nem acumula frames em buffer próprio. Redução de 60 para 30 FPS no
perfil alto reduz a carga solicitada de captura/codificação; dynacast evita
codificar camadas não consumidas. Não se afirma que havia congestionamento ou
CPU saturada em uma sessão real, pois não houve perfil de uma chamada humana.
Jitter buffer continua sob controle do navegador. Forçar zero poderia aumentar
cortes, e Web Audio não resolve separação confiável de fontes já misturadas.

## Limitações de navegador

`restrictOwnAudio` tenta remover apenas áudio do documento capturador; o suporte
depende do navegador/SO e não garante isolamento audível. Não remove chamada em
outro aplicativo/aba. `suppressLocalAudioPlayback=false` preserva a audição local.
Quando necessário, compartilhar outra guia com seu áudio ou rotear somente
jogo/aplicativo para fonte virtual, deixando chamada na saída normal.

O projeto atual não implementa conversa por microfone: permissões continuam
restritas a tela e áudio da tela. Não foi adicionada captura de voz nem alterado
qualquer aplicativo externo. Fonte virtual sem nome visível por falta de permissão
não pode ser descoberta abrindo entrada genérica às cegas.

Referências: [Screen Capture/W3C](https://www.w3.org/TR/screen-capture/),
[Chrome 141](https://developer.chrome.com/blog/chrome-141-beta?hl=en),
[controles de captura](https://developer.chrome.com/docs/web-platform/screen-sharing-controls),
[LiveKit](https://docs.livekit.io/transport/media/advanced/).

## Verificação

- `npm test`: 30 testes de segurança, captura, perfis e seleção segura de fonte.
- `npm run lint`: aprovado.
- `npm run build`: aprovado; rota estática /icon.svg gerada, TypeScript habilitado.
- `node scripts/test-share-dialog.cjs`: aprovado em DOM simulado com React.
  Verifica abertura sem iniciar captura, seis opções, mudanças de perfil/áudio,
  cancelar/Escape, iniciar, bloqueio por permissão e restauração do foco.
  Requer jsdom@26.1.0 em /tmp/discord2-integration; não testa top layer nativo.
- `node scripts/integration-real.mjs`: dez cenários reais aprovados. HTTP local,
  Redis e LiveKit reais, WebRTC de vídeo/áudio sintético recebido, exclusividade,
  parada/troca, crash/recuperação e falhas induzidas nos clientes locais.
  Sala aleatória assinada, cotas isoladas e limpeza confirmada, sem salas públicas.
  Resultado sanitizado atualizado em `INTEGRACAO-REAL-RESULTADOS.json`.
- Regressão por diff: player/autohide, volume, Turnstile, limite de seis,
  APIs de autorização/exclusividade e regras Redis não alterados. Integração
  com dois participantes não é prova de limite de seis em carga.

## Ainda depende de pessoas

1. Chrome/Edge/Brave, Firefox e Safari: Tab/Shift+Tab presos no diálogo nativo,
   Escape/Cancelar, retorno ao botão de origem, tela cheia e autohide do player.
2. Cancelar modal e seletor nativo e confirmar que outra pessoa obtém a vez;
   repetir com queda de conexão, revogação e saída enquanto o seletor está aberto.
3. Captura de guia/janela/tela inteira com áudio: transmissor continua ouvindo a
   chamada, espectadores não recebem eco e som do jogo permanece. Testar suporte
   real a restrictOwnAudio e observar getSettings via diagnósticos opcionais.
4. Fonte virtual Linux: roteamento de jogo separado da chamada, dispositivo
   identificado, ausência de microfone no stream e caso de nomes ocultos.
5. Latência A/V, sincronização e freezes sob CPU/rede lenta, reconexão automática,
   longa duração, seis participantes e tentativa do sétimo. Medir antes/depois;
   nenhuma alegação de latência zero ou isolamento universal.

Revisão consolidada das seis melhorias: build, lint, 30 testes automatizados e
harness DOM do modal reexecutados antes do commit único. Sem repetição da
integração externa nesta revisão; os dez cenários acima são da execução já
registrada durante a implementação. Push e publicação pendentes de autorização.
