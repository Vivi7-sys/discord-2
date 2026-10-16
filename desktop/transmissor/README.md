# Discord 2 Transmissor — protótipo nativo Linux

Aplicativo separado, em estágio de protótipo, para Pop!_OS 24.04 / COSMIC / Wayland.
Validação atual: [executar o GTK com captura real e espectador no site](VALIDACAO-MANUAL.md).
Comando na raiz: `npm run validate:desktop --prefix desktop/transmissor`.
Continuação: [admissão de vídeo antes das cópias e novas validações](CONTINUACAO.md).
1080p30 e 1080p60 permanecem disponíveis para computadores capazes; 720p30 é uma escolha explícita mais leve.
Investigação anterior da RX 550: [perfis, etapas e medições antes/depois](RX550.md).
O histórico anterior de **10,38 FPS recebidos em 1920×1080** está em [PERFORMANCE.md](PERFORMANCE.md).
30/60 FPS estáveis ainda não foram atingidos neste computador.
Nenhuma alteração no site, APIs, dependências da raiz ou configuração publicada.
As alterações preexistentes no workspace não fazem parte deste trabalho.

## Decisão de arquitetura

GTK 3 / PyGObject fornece uma janela pequena; GStreamer entrega I420 e PCM ao
SDK **@livekit/rtc-node 1.1.0**, que usa WebRTC nativo. Node não abre navegador,
Electron ou WebView. Python e Node comunicam por pipes privados separados e, para vídeo, por três
slots selados de memória compartilhada quando o adaptador N-API está compilado.
Rust + ashpd + pipewire + SDK Rust é uma alternativa para o produto final, mas
não há toolchain Rust neste ambiente; reaproveitar o SDK nativo já instalado
permite validar primeiro o caminho completo. Não usamos o SDK JS de navegador.

```text
GTK → CreateSession → SelectSources → Start → OpenPipeWireRemote
                                            ↓ FD autorizado
                                    GStreamer pipewiresrc
                                            ↓ I420 1280×720 ou 1920×1080 / memfd
monitor de saída → pulsesrc → PCM 48 kHz estéreo → SDK nativo → LiveKit → site
```

`pulsesrc` usa a compatibilidade PulseAudio do PipeWire já presente no Pop!_OS.
Vídeo usa diretamente o remoto PipeWire autorizado pelo portal. O FD permanece
aberto durante a sessão. Fechamento do portal, EOS/erro, botão Parar e saída da
janela encerram a sessão. Sem persistência de autorização e sem captura automática.
O portal nativo determina as telas/janelas disponíveis. O app não enumera janelas
por APIs de X11. O seletor usa parent_window vazio; ainda falta associá-lo à janela
GTK por identificador Wayland exportado.

Fontes primárias consultadas:

- [Contrato ScreenCast](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html): ciclo, FD, seleção e encerramento.
- [Backend do COSMIC](https://github.com/pop-os/xdg-desktop-portal-cosmic): implementação e suporte do compositor.
- [LiveKit SDK Node nativo](https://docs.livekit.io/reference/client-sdk-node/) e [publicação de mídia bruta](https://docs.livekit.io/transport/media/raw-tracks/).
- [Discussão oficial sobre áudio no portal](https://github.com/flatpak/xdg-desktop-portal/issues/957): não presumir que o seletor de janela entregue áudio.
- [PipeWire loopback](https://docs.pipewire.org/page_module_loopback.html): roteamento independente de captura e reprodução.

## Backend e segurança

O convite completo determina a origem do backend e o roomId. Só HTTPS, exceto
HTTP loopback para testes. Sem cookies, redirects, login adicional ou novos
endpoints. O modelo atual de autenticação é posse do convite assinado e JWT de
participante; não existe conta/senha no site atual.

1. POST `/api/livekit/token` com roomId e displayName; backend valida assinatura,
   aplica cotas e prepara `maxParticipants: 6`.
2. SDK conecta como espectador, com autoSubscribe=false (o transmissor não reproduz
   chamadas nem precisa receber outras trilhas).
3. POST `/api/livekit/share` acquire com Bearer JWT. A exclusividade continua
   centralizada em Redis/LiveKit; o aplicativo não decide quem pode transmitir.
4. Publica somente SCREENSHARE e SCREENSHARE_AUDIO. Sem trilha de câmera/mic.
5. Parada tenta release e desconecta; a revogação já remove as publicações no servidor. Se release falhar, a desconexão
   permite reconciliação pelo backend existente. Queda abrupta continua sujeita
   aos timeouts/reconciliação já documentados no projeto.

Não há API key, API secret, assinatura de convites ou acesso Redis no aplicativo.
JWT vive em memória/pipe, fora de argv, logs e arquivos. O filho Node recebe apenas
um conjunto reduzido de variáveis de ambiente. A ferramenta `integration.mjs`
é **administrativa, somente para desenvolvimento**: lê .env.local no processo
pai e no backend local, jamais transmite esses segredos ao cliente de captura.
Não distribuir essa ferramenta nem .env.local no pacote futuro.

## Instalação e execução

Dependências do sistema (administrador):

```bash
sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-gstreamer-1.0 \
  gstreamer1.0-pipewire gstreamer1.0-plugins-base gstreamer1.0-plugins-good pulseaudio-utils
cd desktop/transmissor
npm ci
npm run build:native # cc e libnode-dev; sem este passo há fallback I420 por pipe
npm start
```

Requer Node 20.9+, sessão Wayland com PipeWire/WirePlumber e portal COSMIC.
Cole o convite já criado pelo site, escolha nome, Tela/Janela, 30/60 FPS e áudio.
Clique **Selecionar e iniciar**; autorize no seletor COSMIC. O monitor validado da saída padrão é oferecido inicialmente; você pode escolher outra saída ou Sem áudio. Nenhuma captura começa automaticamente.
O app mostra o estado da conexão; não persiste o convite.

Neste ambiente, instalação com sudo exigiu senha indisponível. O pacote oficial
foi baixado e extraído em /tmp, sem instalar nem alterar configuração do sistema:

```bash
GST_PLUGIN_PATH=/tmp/discord2-pipewire-plugin/usr/lib/x86_64-linux-gnu/gstreamer-1.0 \
DISCORD2_RTC_MODULE=/tmp/discord2-integration/node_modules/@livekit/rtc-node/dist/index.cjs \
/usr/bin/python3 desktop/transmissor/app.py
```

Os caminhos /tmp são locais e não fazem parte da distribuição.

## Áudio e exclusão de chamadas

O menu aceita somente monitores de saída confirmados por `pactl`; não aceita
entrada padrão, microfone físico ou a fonte virtual antiga `screen_share_audio`,
pois uma fonte remapeada pode esconder microfone upstream. A origem é conferida
novamente ao iniciar. Não há opção de microfone neste protótipo. O usuário precisa
selecionar explicitamente um monitor para autorizar a captura de áudio. O dispositivo
ativo é conferido em cada buffer; uma mudança de fonte interrompe a captura. Há
ganho manual 0/+6/+12 dB limitado por folga de pico, sem mudar a reprodução local.

Um monitor físico contém toda a mistura: jogo, chamadas, notificações e outros
apps. Não se consegue remover com segurança uma chamada depois de misturada.
Selecionar uma janela no portal **não restringe seu áudio**. O aviso fica visível.

A solução recomendada é uma saída virtual dedicada de compartilhamento:

1. Criar um sink PipeWire virtual exclusivo para o conteúdo autorizado.
2. Direcionar **apenas** jogo/player para esse sink; chamadas ficam na saída física.
3. Fazer loopback desse sink para fones/caixas, preservando reprodução local.
4. Capturar apenas o monitor do sink virtual e oferecê-lo no menu do transmissor.
5. Ao encerrar, restaurar os fluxos movidos e remover apenas os nós criados pelo app.

WirePlumber/PipeWire permitem conexões por fluxo; a API de compatibilidade Pulse
permite mover sink-inputs e criar null-sink/loopback. Captura por inclusão é mais
segura que tentar reconhecer e excluir todas as chamadas por nomes de processo.
Duas abas do mesmo navegador podem compartilhar o mesmo fluxo de áudio: não se
pode prometer separar chamada e conteúdo nesse caso. Usar outro player/processo
ou uma saída explicitamente configurada por aplicação é necessário.

O protótipo **não muda roteamento global nem move apps automaticamente**. Um sink
virtual preparado externamente aparece como monitor no menu. Criação, restauração
transacional, hotplug, reconexão de fluxos e UX de seleção por aplicação ficam para
a próxima etapa. A exclusão de chamadas ainda requer ensaio com duas fontes reais
e comprovação de que a reprodução local continua audível.

## Testes reproduzíveis

```bash
/usr/bin/python3 -m unittest discover -s desktop/transmissor/tests
node --check desktop/transmissor/publisher.cjs
npm test  # regressões existentes do backend/site
```

Integração real (somente desenvolvimento; executar na raiz com credenciais locais):

```bash
DISCORD2_TEST_AUDIO_MONITOR=nome_da_saida.monitor \
  node desktop/transmissor/integration.mjs
```

Exige build local Next em `.next`, SDK nativo instalado e plugin PipeWire.
Abre backend somente em 127.0.0.1:3197, sala aleatória assinada com limite seis,
namespace isolado das cotas, espectador SDK e seletor do portal. Após seleção,
captura por 15 segundos e verifica frames decodificados de áudio/vídeo no espectador,
revogação e remoção da sala própria com metadata conferida. Não grava conteúdo,
JWTs, nomes de sala ou endpoints no relatório `RESULTADOS.json`. Não usa o site
publicado. O teste depende de seleção humana; cancelar/expirar é falha de validação,
não evidência de que a captura funciona.

## Limitações do protótipo

- 1080p30/60 são perfis solicitados, com teto de 5/8 Mbps; não garantia de FPS.
  Compositor, resolução original, CPU, encoder, uplink e assinatura influenciam.
- Conversão I420/PCM, mapeamento e cópias no SDK ainda têm custo. O caminho rápido
  evita enviar pixels pelo pipe; há H.264 com VAAPI confirmado. Sem DMA-BUF/zero-copy
  entre captura e encoder. FPS estáveis e sincronismo A/V ainda precisam de trabalho.
- Áudio ainda percorre compatibilidade Pulse do PipeWire; não há seleção nativa
  por nó de aplicação nem isolamento automático de chamadas.
- Não há empacotamento Flatpak/AppImage, atualização automática, assinatura de
  binário, ícone/launcher instalado ou testes de distribuição.
- Erros de captura encerram a sessão; sem retomada automática. Se houver reconexão
  do SDK, é preciso validar novamente a reserva antes de prometer continuidade.
- Indicador Transmitindo significa pipelines iniciados, não confirmação visual
  humana de conteúdo. Há telemetria de FPS de entrada/codificação; sem preview
  e sem confirmação contínua dos frames exibidos no dispositivo do espectador.
- Testar manualmente cancelamento do seletor, fechar a janela durante conexão,
  hotplug, suspensão, permissão revogada, backpressure, 60 FPS prolongados,
  espectador web/mobile e tentativa de sétimo participante.
- O app ocupa uma das seis vagas, como qualquer outro participante. Abrir também
  o site na mesma sala ocupa outra vaga; não há transferência de identidade.

Teste de transporte independente do portal (mídia **sintética**, sem captura pessoal):

```bash
DISCORD2_SYNTHETIC=1 node desktop/transmissor/integration.mjs
```

Esse modo troca apenas as fontes de teste por `videotestsrc`/`audiotestsrc`,
usando o mesmo publicador, backend e receptor real. O receptor verifica resolução
1920×1080, frames decodificados e pico de áudio não nulo. O relatório separado é
`RESULTADOS-SINTETICOS.json`; aprovação nele não valida ScreenCast/PipeWire.

## Evidência desta sessão — 15/10/2026 (Brasil)

- Portal COSMIC instalado: ScreenCast v5, AvailableSourceTypes=3 (tela e janela),
  AvailableCursorModes=3. Plugin PipeWire 1.6.8 carregado a partir de /tmp.
- `npm test` na raiz: 41 testes de segurança/captura + 11 regressões de API aprovados.
- Cinco testes novos de contrato do convite/nome, bloqueio de microfones e
  resposta D-Bus do portal aprovados;
  compilação Python e checagens sintáticas Node aprovadas.
- Integração sintética 1080p30: 16 frames 1920×1080 decodificados e 1.523 frames de
  áudio com pico não nulo. Permissão encerrada e sala removida.
- Integração sintética 1080p60: 33 frames 1920×1080 decodificados e 1.584 frames de
  áudio com pico não nulo. Permissão encerrada, reserva Redis confirmada ausente
  e sala removida. Esse ensaio usa porta local 3198.
- Ambos os ensaios duram aproximadamente 15 segundos. Esses totais **não atendem
  30/60 FPS sustentados**. É necessária otimização/medição antes de uso normal.
- Os relatórios contêm apenas contagens, estados e resolução; nenhum conteúdo
  capturado ou credencial é salvo. O frame preto pequeno emitido ao finalizar uma
  trilha é excluído da contagem específica de frames 1080p do receptor.
- O teste de portal tem resultado próprio; aprovação sintética não o substitui.

Para repetir o segundo perfil:

```bash
DISCORD2_SYNTHETIC=1 DISCORD2_TEST_FPS=60 DISCORD2_TEST_PORT=3198 \
  node desktop/transmissor/integration.mjs
```

Nenhum commit, push ou deploy foi feito. Não foi alterado roteamento de áudio do
sistema. A instalação via sudo não foi concluída; o plugin está apenas em /tmp.

### Captura nativa real confirmada

O relatório [RESULTADOS.json](RESULTADOS.json), de 16/10/2026 02:55 UTC
(15/10 à noite no Brasil), está aprovado. Após seleção no portal COSMIC, o
caminho **portal → PipeWire → GStreamer → SDK nativo → LiveKit → receptor**
produziu 43 buffers de vídeo e 213 de áudio. O receptor decodificou 36 frames
1920×1080 e 1.584 frames de áudio, com fontes SCREENSHARE / SCREENSHARE_AUDIO.
A permissão foi encerrada, a reserva Redis ficou ausente e a sala própria foi
removida. Nenhuma imagem ou amostra de áudio foi persistida.

O pico do áudio recebido foi apenas 59 em PCM int16: sinal muito baixo. Isso
confirma fluxo de áudio pelo caminho real, mas não substitui teste com música/jogo
claramente audível e escuta humana no site. Não houve captura de microfone.
O vídeo também ficou muito abaixo dos 30 FPS solicitados. A versão ainda é uma
prova de funcionamento, não um transmissor pronto para uso cotidiano.

O ensaio foi inicialmente bloqueado por uma leitura incorreta do argumento de
resposta D-Bus; a assinatura real do Gio foi verificada com um sinal local e a
correção ganhou teste de contrato. O resultado aprovado foi obtido depois dessa
correção. Captura nativa a 60 FPS, espectadores no navegador, longa duração e
exclusão de chamadas com reprodução local continuam sem validação completa.

Instalação e pacote para uso diário: [INSTALACAO.md](INSTALACAO.md).
