# Investigação de áudio da tela inteira

Ambiente relatado: Pop!_OS 24.04, COSMIC/Wayland, Brave 1.96.61 / Chromium 154 com PulseaudioLoopbackForScreenShare. A opção do seletor não comprova entrega de som.

## Resultado verificável

O LiveKit instalado chama getDisplayMedia, preserva as opções de áudio e atribui ScreenShareAudio ao áudio retornado. A publicação já era sequencial com rollback; agora a origem é também explícita ao publicar. Não há fallback automático para microfone. As quatro qualidades e os modos navegador, somente vídeo e fonte virtual permanecem.

restrictOwnAudio continua solicitado somente quando suportado. Seu objetivo é excluir o áudio da aba capturadora, não comprovar suporte a loopback. Removê-lo sem evidência poderia causar eco. suppressLocalAudioPlayback permanece false. Não foi comprovado que qualquer dessas opções causa o silêncio neste Brave.

Corrigidos: mensagem de publicação que afirmava transmissão de som sem medir sinal; volume zero agora ativa mute nativo em celulares que ignoram volume HTML. A segunda correção não explica o silêncio com volume positivo.

Consulta local em 2026-10-15: PulseAudio sobre PipeWire 1.5.85, saída padrão USB estéreo e entrada padrão física mono. Existe fonte virtual screen_share_audio, mas wpctl não mostrou streams ativos. Isso não permite atribuir o problema ao roteamento durante a captura. Nenhuma rota foi alterada e nenhum áudio foi capturado por esta investigação.

## Diagnóstico seguro e opt-in

No console do transmissor e do receptor, executar `localStorage.setItem("discord2-media-diagnostics", "1")` e entrar novamente na sala. Ativar logs Debug/Verbose. Desativar com `localStorage.removeItem("discord2-media-diagnostics")` e sair da sala. Não há envio de telemetria, gravação, PCM, análise Web Audio nem solicitação adicional de microfone. Só são usados metadados e estatísticas WebRTC das faixas existentes. Não compartilhar dumps completos de webrtc-internals ou PipeWire: podem conter identificadores.

Reproduzir som conhecido durante pelo menos 15 segundos em: (1) guia; (2) aplicativo externo na tela inteira; (3) outra guia do Brave na tela inteira. Usar volume positivo no receptor e, se exibido, Ativar som. Comparar os logs nos dois lados:

| Evidência | Interpretação |
| --- | --- |
| capture audioTracks = 0 | Navegador não retornou faixa; não é falha de reprodução. |
| capture audioTracks > 0 e publish success = false | Falha de publicação; rollback encerra a captura. |
| publish success = true | Publicação aceita; não comprova sinal. |
| media-source energy = silent em intervalos com som conhecido | Fonte chega silenciosa ao WebRTC; investigar navegador/roteamento. |
| energy = unknown | Estatística ausente, primeiro intervalo, contador reiniciado ou sem novas amostras; não concluir silêncio. |
| outbound-rtp kbps positivo | Pacotes enviados; Opus também transporta silêncio com DTX desativado. |
| receptor publications = 0 | Publicação ainda não anunciada ou removida. |
| subscribed = false / trackAvailable = false | Investigar assinatura/conexão, antes do player. |
| inbound-rtp kbps positivo e energy = signal | Sinal recebido; investigar reprodução, volume e saída do celular. |
| playback success = false | play/startAudio rejeitado; nome do erro sem mensagem sensível. Usar Ativar som. |
| playback success = true | API aceitou reprodução; não comprova saída audível física. |

As estatísticas de energia podem não ser disponibilizadas pelo navegador. muted/readyState/enabled ajudam a distinguir faixa pausada ou encerrada de faixa viva e silenciosa. Não se deve diagnosticar silêncio apenas por audioLevel instantâneo.

## PipeWire durante a reprodução do problema

Consultar somente `wpctl status -n`, `pactl list short sinks`, `pactl list short sources`, `pactl list short sink-inputs` e `pactl list short source-outputs`. No pavucontrol, verificar se a reprodução do aplicativo está na saída esperada e se a gravação/loopback do Brave usa o monitor dessa mesma saída. Comparar saída USB e HDMI; não mover nada automaticamente e não selecionar entrada física. Para o modo virtual, verificar as conexões da fonte screen_share_audio e manter a confirmação explícita já existente no aplicativo.

Uma fonte virtual existente não comprova roteamento correto; a captura nativa pode usar outro caminho. Se a fonte WebRTC continuar silenciosa com roteamento correto, comparar versão estável do navegador e aplicativos externos. Não há correção comprovada para a implementação experimental do Brave neste relatório. É necessário reproduzir com transmissor e celular para concluir a causa.

Referências primárias: https://www.w3.org/TR/screen-capture/ (áudio opcional e restrictOwnAudio); código instalado node_modules/livekit-client/src/room/participant/LocalParticipant.ts (createScreenTracks).

## Preparação do teste assistido — 2026-10-15

Projeto local iniciado em modo de desenvolvimento. Janela isolada do Brave 154.1.96.61 aberta com PulseaudioLoopbackForScreenShare e depuração restrita a localhost. Preflight de Redis e LiveKit passou e o participante transmissor conectou ao LiveKit.

Uma ponte temporária fora do repositório, na porta 3001, habilita o diagnóstico nos dois dispositivos e recolhe somente campos escalares de uma lista explícita dos logs D2. Não recolhe tokens, convites, identidades, SDP, IPs WebRTC ou conteúdo de áudio. Bloqueia microfone/câmera via Permissions-Policy. Observa também paused, muted, volume, readyState e currentTime do elemento de reprodução existente. A ponte preserva as opções de captura e publicação do aplicativo. Uma falha inicial da ponte em repassar o WebSocket de desenvolvimento foi corrigida; a hidratação React foi então verificada antes de entrar na sala. Isso era um problema da infraestrutura do teste, não do áudio do aplicativo.

Medição anterior ao início da transmissão: monitor USB com volume 8% / −66,33 dB, saída USB com volume 100%, sem reprodução ativa; a fonte virtual estava suspensa. Atenuação é uma hipótese a verificar somente se a captura ativa usar esse monitor. Não houve mudança de rotas ou volumes.

Até a última leitura desta preparação: 29 amostras do transmissor, zero eventos de captura, zero publicações de áudio e nenhum diagnóstico do receptor. Portanto, não há ainda evidência para concluir presença/ausência da faixa em uma captura real, energia, entrega ao receptor ou causa do silêncio. Aguardando início manual da transmissão e entrada do receptor. Lint, testes unitários/API e UI passaram nesta preparação. Nenhuma nova correção no produto foi feita com base nessas leituras iniciais.

## Medições da transmissão real — 2026-10-15, 21:06–21:14 UTC

Resultados estruturados e sem credenciais: [AUDIO-TELA-INTEIRA-RESULTADOS.json](./AUDIO-TELA-INTEIRA-RESULTADOS.json).

| Etapa | Evidência observada | Resultado |
| --- | --- | --- |
| Captura Brave de tela inteira | displaySurface=monitor, audioTracks=1 às 21:06:58 UTC | Faixa presente. |
| Estado da faixa | live, enabled=true, muted=false, publicação não muda | Não era faixa encerrada/desabilitada. |
| Energia na origem | 81 de 84 amostras com incremento de energia; 1 inicial desconhecida e 2 silenciosas | Sinal presente durante a execução; silêncio não era contínuo. |
| Publicação LiveKit | success=true para vídeo e áudio; servidor confirmou fontes 3 e 4 não mudas | Publicação aceita e visível no servidor. |
| Envio | Contador de pacotes crescente; aproximadamente 254–259 kb/s na primeira medição com som | Pacotes enviados, além da evidência independente de energia. |
| Receptor de controle no Brave desktop | ScreenShareAudio subscribed=true, live e não muda; 13 intervalos com energia positiva após a amostra inicial | Assinatura, transporte e decodificação funcionaram. |
| Recepção de controle | 207–328 kb/s nos intervalos medidos | Áudio chegou ao receptor de controle. |
| Reprodução de controle | play/startAudio aceitos, paused=false, readyState=4, currentTime avançou até 70,218 s, mediaError=0 | Player funcionou segundo a API. Isso não atesta saída física audível nem comportamento do celular. |
| Celular | Zero amostras de diagnóstico; servidor tinha 1 participante/0 espectadores antes do controle e 2/1 com o controle | Nenhum celular foi comprovado nesta sala durante a medição. |

O controle foi aberto em outra aba local com volume inicial zero para evitar realimentação. Leituras posteriores mostraram volume 0,65 e muted=false; a medição não determina quem alterou esse estado. A aba de controle foi encerrada após medir a recepção. O sinal na origem e a publicação já haviam sido comprovados vários minutos antes da entrada desse controle, portanto não dependem de eventual retorno do áudio do próprio controle. Não foi gravado áudio.

PipeWire durante a captura: reprodução Brave na saída USB índice 63; captura Brave input também no monitor dessa mesma saída, com captureSink=true, mute=false e corked=false. O microfone físico estava SUSPENDED e não era a fonte usada pela captura Brave observada. O monitor USB estava em 21% / −40,94 dB nessa leitura, diferente dos 8% iniciais. Nenhum desses volumes foi alterado pelo agente. A atenuação merece atenção, mas não explica uma ausência total de sinal nesta execução: houve energia positiva tanto na origem quanto no receptor de controle. A fonte virtual screen_share_audio estava IDLE, sem ser a fonte escolhida pela captura Brave.

A faixa local informou channelCount=1, restrictOwnAudio=false e suppressLocalAudioPlayback=false. Apesar de a solicitação do aplicativo condicionar restrictOwnAudio=true ao suporte anunciado, o valor efetivo retornado foi false nesta captura. Não há evidência nesta execução de que desativar ou remover a opção no aplicativo corrigiria o relato original.

**Conclusão inicial, antes da entrada do celular:** não foi reproduzida uma falha de captura/transmissão/recepção no caminho Brave → LiveKit → Brave de controle. A ausência de um receptor conectado explica por que não havia entrega ao celular nesta sala local antes do controle; não explica, por si só, o relato anterior do usuário. Naquele momento faltava o celular entrar pela ponte local para medir sua recepção e reprodução; a etapa seguinte abaixo registra sua entrada. Nenhuma nova falha de código foi comprovada e nenhuma correção adicional no produto foi feita. Não foram alteradas rotas PipeWire, opções de captura, permissões, qualidades ou o visual.

Validação após as medições: `npm test` passou (41 testes unitários/segurança/captura e 11 testes API); `npm run test:ui` passou (diálogo e 10 regressões de sala); `npm run lint` passou; `npm run build` passou. `git diff --check` sem erros. Nenhum commit, push ou deploy foi executado. A consulta das 21:15:18 UTC, após fechar o controle, voltou a mostrar 1 transmissor e 0 espectadores.


## Entrada do receptor e resultado final — 2026-10-15, 21:20–21:22 UTC

Após o usuário informar “agora foi”, chegaram os diagnósticos do receptor pela ponte local. O servidor confirmou 2 participantes, sendo 1 transmissor e 1 espectador, às 21:21:24 UTC. A aba de controle já estava fechada.

- A faixa ScreenShareAudio estava assinada, live, habilitada e não muda.
- Foram observadas 18 amostras de recepção de áudio: 1 inicial desconhecida e 17 intervalos consecutivos com incremento positivo de energia. Taxa de recepção medida: 152–249 kb/s. Isso distingue recepção de sinal de mera recepção de pacotes silenciosos.
- O início automático de reprodução foi aceito às 21:20:36 UTC, sem rejeição registrada. O player permaneceu paused=false, muted=false, volume=1 e readyState=4; currentTime avançou de 0,597 para 85,590 segundos, com mediaError=0. Nenhum acionamento de Ativar som foi registrado neste intervalo. A API não comprova, sozinha, audibilidade física; a confirmação específica do que o usuário ouve foi solicitada.
- A consulta PipeWire das 21:21:39 UTC manteve reprodução e captura Brave no mesmo monitor USB, sem mute ou pausa. O microfone físico continuava SUSPENDED; a fonte virtual permanecia IDLE. Nenhuma rota ou volume foi alterado pelo agente.

**Resultado final desta execução:** captura de áudio da tela inteira, publicação LiveKit, assinatura, entrega de sinal ao receptor e reprodução pelo elemento HTML passaram. Não foi reproduzida a falha original. A falta inicial de receptor na sala local foi corrigida ao entrar pelo endereço deste teste; isso explica a etapa anterior desta sessão, mas não permite atribuir uma causa ao relato histórico de silêncio. Não há evidência para culpar restrictOwnAudio, a implementação experimental do Brave, o roteamento PipeWire ou o código do Discord 2 nesta execução bem-sucedida. Nenhuma nova correção no produto foi justificada pelas medições.

Os resultados JSON foram atualizados com as amostras do receptor. Build, lint, testes unitários/API e UI já haviam passado após as últimas alterações de código; desde então foram atualizados apenas estes relatórios. Sem gravação, captura de microfone, exposição de credenciais, commit, push ou deploy.

## Falha posterior no Brave habitual e no site publicado

O usuário informou que a tentativa que falhou foi no domínio publicado `discord-2-kuau.onrender.com`, usando o Brave com seus dados salvos. Isso difere do teste anterior em duas dimensões: perfil/origem e versão do aplicativo. O sucesso local não resolve esse novo relato.

Verificações às 21:27–21:31 UTC:

- O processo principal do Brave habitual foi confirmado com PulseaudioLoopbackForScreenShare habilitado. Não havia porta de depuração no perfil habitual. A leitura filtrou somente as flags relevantes e não acessou cookies, histórico ou dados do perfil.
- O HTML e os scripts públicos confirmaram que o site publicado está na versão anterior aos novos eventos D2 audio e à medição de energia adicionada localmente. Sua solicitação de captura, porém, continua equivalente: restrictOwnAudio condicional ao suporte, suppressLocalAudioPlayback=false, selfBrowserSurface=exclude e systemAudio=include no modo navegador. A diferença de versão não comprova a causa da falha.
- A consulta LiveKit da sala publicada às 21:31:07 UTC mostrou 2 participantes, 1 publicador, 1 espectador e fontes ScreenShare e ScreenShareAudio não mudas. Logo, ausência de publicação não explica essa tentativa. O metadado do servidor não revela energia da fonte nem o estado do player no celular.
- A saída e a captura Brave permaneciam no mesmo monitor USB, mas o ganho do monitor estava novamente em 8% / −66,33 dB. Não houve alteração pelo agente; sem medir a energia dessa captura específica, a atenuação continua uma hipótese, não uma causa demonstrada.

Foi solicitado repetir o teste local no Brave habitual, preservando todos os dados salvos, para separar perfil de versão/origem. Até esta atualização não chegaram novos eventos de captura dessa comparação. A causa da falha publicada continua em investigação; nenhuma nova correção de código foi aplicada. Não houve commit, push ou deploy.

## Comparação com o Brave habitual no projeto local — 21:34–21:37 UTC

O usuário confirmou que o teste local também funcionou com seus dados salvos. Os diagnósticos registraram duas capturas de monitor com 1 faixa de áudio cada, ambas publicadas com sucesso. Na última captura, o recorte até 21:37:54 UTC contém 31 intervalos de origem com sinal após a amostra inicial; o receptor teve 22 intervalos com sinal, 4 silenciosos e 1 desconhecido. Ao final recebia aproximadamente 252 kb/s, com player paused=false, muted=false, volume=1 e sem erro; currentTime chegou a 117,270 s. O servidor confirmou 1 transmissor e 1 espectador.

Esse resultado afasta uma incapacidade geral do perfil salvo, mas não exclui configurações específicas do domínio publicado, comportamento por origem ou diferença entre versões. Não foi feita limpeza de dados nem alteração do perfil.

Para medir a falha publicada sem deploy ou reinicialização do perfil, foi preparado um script temporário de console em `/tmp/discord2-audio-assisted/production-probe.js`. Ele apenas lê o estado da sala existente, os metadados selecionados de ScreenShareAudio, estatísticas WebRTC em dois instantes separados por 5 segundos e o estado do player. Não acessa microfone/câmera, não grava, não altera reprodução/configurações e não envia relatório pela rede. A saída contém apenas escalares selecionados, sem tokens, identidades, convites, SDP ou identificadores de dispositivo. Uma verificação isolada em memória passou para sinal, silêncio, faixa ausente e estatísticas indisponíveis, incluindo a exclusão de metadados sensíveis.

Aguardando leitura da tentativa no domínio publicado. Ainda não há falha nova de código comprovada que justifique uma correção ou publicação.
