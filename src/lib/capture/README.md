# Captura de tela e áudio

A captura por clique está em `LiveKitRoomConnection.tsx`, via
`localParticipant.createScreenTracks()`. `publish-screen-tracks.ts` coordena a
publicação e desfaz todas as trilhas em falha parcial ou perda da sessão.

Toda trilha capturada após a saída deve ser parada sem publicação. A captura
virtual Linux é independente e só é publicada após validação da fonte existente.
O áudio automático depende do suporte do navegador e da seleção feita no seletor.

Desktop é a prioridade para transmitir; celulares são espectadores. Não há gravação.

## Configuração e adaptação

O clique em Compartilhar tela abre `ShareDialog`. Apenas Selecionar tela chama
`createScreenTracks`, diretamente no gesto do usuário (sem aguardar rede antes
do seletor). Solicitar transmissão continua reservando a vez previamente.
Cancelar/Escape devolvem a reserva pelo mesmo endpoint autenticado de liberação;
se a rede falhar, o erro e Cancelar vez permitem repetir. Nenhuma reserva nova é
criada ao abrir o modal de configurações. O diálogo nativo contém o foco, impede
interação com o fundo e restaura o foco ao fechar.

Alta é o padrão e solicita 1920×1080/30 FPS, teto 5 Mbps (LiveKit h1080fps30).
Máxima solicita 1920×1080/60 FPS, com teto customizado de 8 Mbps para dar margem
à maior taxa de quadros. O mesmo preset alimenta frameRate da captura e
maxFramerate/maxBitrate da publicação. O teto não garante taxa entregue;
hardware, navegador e congestionamento podem reduzir FPS/resolução/bitrate.
Econômico e Equilibrado conservam as metas anteriores. VP8 mantém compatibilidade;
simulcast mantém as camadas padrão do SDK instalado: uma camada adicional com
metade da resolução e aproximadamente um quarto do bitrate, mantendo o FPS.
O teto da camada principal não é o teto da soma das camadas. Dynacast suspende camadas não consumidas;
adaptiveStream seleciona conforme tamanho/visibilidade do vídeo, e o SFU/WebRTC
adapta ao congestionamento. `balanced` permite reduzir FPS e resolução em vez
de impor manutenção de FPS sob sobrecarga. Nenhuma garantia de resolução/FPS.

Não foram encontrados buffers próprios, polling React por frame ou recodificação
na reprodução: vídeo é anexado diretamente; áudio tem seu elemento próprio;
volume não altera a publicação. Não se forçou jitterBufferTarget zero: isso pode
causar cortes e piorar sincronização. Reconexão automática e autoplay permanecem.
Não há benchmark que comprove melhora da latência fim a fim nesta revisão.

Para diagnóstico local: definir `localStorage.setItem('discord2-media-diagnostics', '1')`
no console e reentrar na sala. Console debug a cada cinco segundos: dimensões/FPS
entregues, kbps por intervalo, motivo de limitação, tempo médio de encode, jitter,
atraso médio do jitter buffer por intervalo, RTT, perdas e freezes quando presentes.
Não são enviados dados a servidor nem logados IPs, SDP, tokens ou identidades.
Desativar removendo a chave e reentrando. Não há atualização de estado React.

## Eco: capacidade e limites

`browserAudioOptions` solicita `audio.restrictOwnAudio=true` somente quando
`getSupportedConstraints()` anuncia suporte, e `suppressLocalAudioPlayback=false`.
O SDK instalado encaminha o objeto audio ao getDisplayMedia sem transformação.
A aba atual é excluída das opções sugeridas de captura (`selfBrowserSurface`).
Isto não silencia a chamada para o transmissor nem remove o restante do áudio do
sistema. Não adiciona getUserMedia ao modo automático.

A restrição tenta excluir o som do documento que iniciou a captura, não o som de
um Discord nativo/outra aba. Suporte declarado não comprova o resultado audível;
getSettings é incluído nos diagnósticos e o teste humano continua necessário.
Quando indisponível, as alternativas são compartilhar outra guia com seu áudio,
ou usar roteamento de fonte virtual contendo apenas o aplicativo desejado.
A chamada deve continuar na saída normal, fora do monitor virtual. A fonte Linux
agora exige um audioinput previamente identificado como Screen Share Audio e
abre apenas seu deviceId exato. Não abre a entrada padrão para depois roteá-la,
pois isso poderia capturar microfone antes da confirmação. Se o navegador oculta
os nomes por falta de autorização, o vídeo continua e há orientação para configurar
a fonte; não se pede uma entrada genérica para descobrir nomes. A confirmação
manual permanece se o navegador devolver nome genérico apesar do ID selecionado.

Web Audio pode mixar/rotear fontes separadas, mas não recupera de forma garantida
as fontes de um mix de áudio do sistema já capturado. Subtrair a chamada com ganho
negativo não é solução confiável: clocks, atrasos, resampling e processamento
impedem cancelamento estável. LiveKit transporta as trilhas; não separa um mix do SO.
O projeto atual não implementa chamada de microfones: permissões aceitam somente
tela e áudio da tela. Uma chamada externa não pode ser isolada por identidade.

Fontes consultadas em 14/10/2026:
- https://www.w3.org/TR/screen-capture/ (restrictOwnAudio e suppressLocalAudioPlayback)
- https://developer.chrome.com/blog/chrome-141-beta?hl=en (implementação anunciada)
- https://developer.chrome.com/docs/web-platform/screen-sharing-controls
- https://docs.livekit.io/transport/media/advanced/
- SDK instalado: track/options.ts, track/utils.ts, participant/publishUtils.ts.
