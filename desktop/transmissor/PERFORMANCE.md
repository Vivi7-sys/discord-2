> Continuação: [investigação RX 550 e comparação 720p/1080p](RX550.md). Este documento preserva as medições anteriores.

# Investigação de desempenho — 16/10/2026

Continuação do protótipo GTK existente. Nenhum código do site, backend ou
configuração publicada foi alterado. Resultados anteriores foram preservados.

## Gargalos comprovados

1. **Bloqueio entre áudio e vídeo.** No protocolo inicial, ambos usavam o mesmo
   pipe e o leitor aguardava `AudioSource.captureFrame()` antes de ler outro frame.
   Ensaio local de 10 segundos, sem sala/rede/encoder: 7.966 ms aguardando áudio,
   apenas 21 frames de vídeo, aproximadamente 2 FPS. O consumidor que só drenava
   os mesmos dados chegou a 11,70 FPS. Evidência: `results/BASELINE-LOCAL.json`.
2. **Cópias e transporte RGBA.** Cada frame era 8.294.400 bytes: 248,8 MB/s a
   30 FPS. I420 reduz para 3.110.400 bytes, 93,3 MB/s, e evita conversão RGBA→I420
   dentro do WebRTC. `extract_dup()` levou 8,26 ms por buffer RGBA no microensaio;
   mapear o buffer levou 3,16 ms. O caminho atual continua fazendo cópias, mas
   evita enviar todos esses bytes pelo pipe quando o adaptador nativo está presente.
3. **Fixture de teste cara.** `videotestsrc pattern=ball` → I420 → fakesink levou
   7,97 s para 150 frames, sem Python, IPC ou LiveKit: cerca de 18,8 FPS. Ela não
   pode provar 30 FPS neste computador. A fixture atual usa barras SMPTE75 em
   movimento (`horizontal-speed=8`), explicitamente distinta de um jogo complexo.
4. **Codificação.** Estatísticas reais do SDK identificaram VP8/libvpx por software
   e H.264/VAAPI por hardware. Em ensaio exploratório, VP8 consumiu 19,78 s de tempo
   total de codificação para 120 frames (~165 ms/frame). FFmpeg com VAAPI codificou
   120 frames H.264 sintéticos em 3,20 s (~37,5 FPS), sem transmissão/decodificação.
   Isso prova capacidade do encoder isolado, não do aplicativo completo.
5. **Timestamps em bases diferentes.** Usar diretamente `base_time + PTS` de um
   pipeline que escolhia seu próprio relógio gerou uma idade fictícia de cerca de
   7,7 horas. Agora ambos os pipelines usam SystemClock, e o tempo do buffer é
   convertido explicitamente para a base monotônica usada no SDK. As métricas do
   receptor não subtraem relógios remotos para prometer latência de uma via.
6. **Encerramento.** Com `fs.createReadStream` em pipes, havia leituras bloqueantes
   no pool libuv esperando EOF, enquanto o pai esperava o filho terminar. Houve
   ensaios em que o SDK informou `stopped` e o pai ainda precisou matar o processo
   após 20 s. Leitores atuais usam pipes consultados pelo event loop (`net.Socket`),
   destruídos na parada. O relatório distingue `publisherStopped` de `publisherKilled`.
7. **Contenção do computador.** CPU AMD A6-7480, dois núcleos lógicos. Houve 89–94%
   de uso total e filas de processos acima do número de núcleos durante ensaios.
   Outros aplicativos não foram encerrados ou reconfigurados. Um receptor SDK no
   mesmo computador também consome CPU; não se deve extrapolar estes resultados
   para espectadores em outro dispositivo.

Ensaios exploratórios não são comparação A/B controlada: fixture, carga do host,
formato e transporte variaram. As medições isoladas acima identificam mecanismos;
os relatórios finais medem o conjunto efetivamente executado.

## Mudanças no aplicativo

- GTK preservado, com perfis 1080p30/60. O estado passa a mostrar FPS de entrada
  e FPS codificados informados pelo SDK, não apenas o perfil solicitado.
- I420 compactado em planos, pixel aspect ratio 1/1; áudio PCM estéreo 48 kHz.
- Pipes independentes para áudio e vídeo; áudio aguardando fila não bloqueia vídeo.
- Caminho rápido com três slots de memória compartilhada `memfd`, ~9,3 MB, sem
  arquivo persistente. Tamanho selado contra expansão/truncamento. O Node mapeia
  somente slots válidos; o pai reutiliza um slot após confirmação de cópia síncrona
  pelo SDK. Quando todos estão ocupados, descarta vídeo sem acumular uma fila longa.
- Adaptador N-API pequeno em `native/shm.c`; sem pacote npm adicional. Sem ele,
  há fallback por pipe I420, com capacidade ampliada até 1 MiB se o kernel permitir.
- Buffers/PTS/formato/níveis têm contadores agregados. Dados de mídia não são salvos.
- H.264 automático é o padrão, permitindo VAAPI quando disponível e fallback do
  SDK para software; VP8 continua selecionável. Não são anunciados codecs H.265/AV1
  que poderiam reduzir a compatibilidade dos espectadores atuais.
- O SDK Node 1.1.0 não expõe publicamente `isScreencast` nem `getStats`. Adaptadores
  pequenos e isolados usam a FFI dessa versão fixada. Isso exige revisão ao atualizar
  o SDK. A trilha continua usando a fonte de publicação SCREENSHARE.
- Frames já velhos em mais de 500 ms ao serem lidos são descartados; áudio velho
  também limpa a fila local do SDK. Isso evita tocar um backlog antigo, mas não
  garante latência fim a fim e pode produzir cortes se o computador não acompanha.
- A parada revoga pelo backend, confere `reservationHeld`, tenta uma segunda
  liberação limitada quando necessário e desconecta. Evita um RPC redundante de
  unpublish de trilhas já removidas pela revogação. O aplicativo não acessa Redis.

## Áudio: o que se comprovou e o que permanece

O pico anterior de 59/32768 correspondia a aproximadamente −54,9 dBFS; era um
sinal muito baixo. Não era prova de atenuação pelo LiveKit. O teste atual usa um
sinal conhecido de 997 Hz / amplitude 0,05, por uma saída temporária dedicada.
Espera-se aproximadamente −26,02 dBFS de pico / −29,03 dBFS RMS na entrada.

O harness cria somente seu null sink e loopback para a saída atual, envia o tom
baixo para esse sink e captura apenas seu monitor. Aplicativos/chamadas existentes
não são movidos. O loopback mantém a reprodução local; o harness compara mute e
volume da saída antes/depois e remove apenas os módulos que criou. O aplicativo
normal não cria esses módulos nem altera o roteamento do usuário. A origem ativa
de `pulsesrc` é conferida antes de publicar cada buffer; mudança de dispositivo
interrompe a captura. Propriedades PipeWire também desabilitam fallback automático.

A inspeção registra mute/volume da fonte de monitor e do sink monitorado, sem
nomes/identificadores no relatório. A captura usa volume de gravação unitário.
Microfones, entrada padrão e remaps não confirmados continuam bloqueados.
`pulsesrc` usa buffer de 200 ms e blocos de aproximadamente 20 ms para reduzir
pressão de callbacks; a fila é limitada. Perdas por falta de CPU continuam visíveis
como lacunas de PTS e duração de áudio capturado menor que o tempo decorrido.

Ganho manual 0/+6/+12 dB afeta só o PCM transmitido. O padrão é 0 dB. Para ganho
positivo, cada bloco recebe ganho linear limitado pela folga de 1 dBFS; não há
hard clipping nem AGC que amplifique silêncio. A redução de ganho entre blocos pode
ser audível em conteúdo muito dinâmico: não equivale a um limiter de mastering.
Não se deve usar ganho para corrigir fonte errada, silêncio ou perdas de buffers.
Os testes verificam PCM idêntico em 0 dB, ganho de sinal conhecido, silêncio e
preservação da forma de onda ao limitar. O receptor conta amostras saturadas.

Áudio de chamadas ainda pode estar presente se o usuário selecionar um monitor
físico que contenha essa mistura. Selecionar janela não restringe áudio. A inclusão
por saída dedicada continua sendo a estratégia para excluir chamadas preservando
sua reprodução local; o aplicativo não automatiza a movimentação de outros apps.

## Reproduzir

Na pasta `desktop/transmissor`:

```bash
npm ci
npm run build:native  # requer cc e /usr/include/node (libnode-dev no Pop!_OS)
npm test
npm start
```

Requer Python 3.12/PyGObject/GTK 3/GStreamer e os pacotes do README. O adaptador
N-API é compilado localmente e ignorado pelo Git. O SDK permanece fixado em 1.1.0.
Nenhuma dependência foi adicionada à raiz do projeto.

Na raiz, benchmark local sem rede/captura pessoal:

```bash
/usr/bin/python3 desktop/transmissor/benchmark.py ffi --seconds 15
/usr/bin/python3 desktop/transmissor/benchmark.py drain --format RGBA --seconds 15
```

Integrações reais criam convite/sala aleatórios, usam o backend local em loopback,
cotas isoladas e removem a sala própria. Segredos ficam apenas no harness/backend,
fora do aplicativo. Não executar testes de desempenho ao mesmo tempo:

```bash
DISCORD2_SYNTHETIC=1 DISCORD2_TEST_CODEC=h264 \
  node desktop/transmissor/integration.mjs

# Abre seletor COSMIC; escolher conteúdo em movimento e sem dados sensíveis.
# O tom baixo do teste é reproduzido localmente.
DISCORD2_TEST_AUDIO_TONE=1 DISCORD2_TEST_CODEC=h264 DISCORD2_TEST_GAIN_DB=6 \
  node desktop/transmissor/integration.mjs
```

Usar `DISCORD2_TEST_FPS=60` para o outro perfil; `DISCORD2_DISABLE_SHM=1` para
comparar o fallback. `DISCORD2_TEST_SECONDS` aceita 10 a 120 s (padrão 30).
Neste ambiente, o plugin PipeWire foi extraído anteriormente em /tmp; acrescentar
`GST_PLUGIN_PATH=/tmp/discord2-pipewire-plugin/usr/lib/x86_64-linux-gnu/gstreamer-1.0`
se o pacote não estiver instalado no sistema.

`passed` refere-se a transporte e limpeza, não a 30/60 FPS. `performance.targetMet`
é uma verificação separada: média ≥95% do alvo e percentil 10 das janelas completas
≥90%, com pelo menos oito janelas, excluindo três segundos iniciais e o último
intervalo parcial. O FPS usa frames 1920×1080 realmente decodificados e relógio
monotônico no receptor. Não conta o frame preto pequeno emitido na parada.


## Resultados finais

| Ensaio | Entrada nos callbacks | Entregues ao SDK | Recebidos/decodificados | Meta |
| --- | ---: | ---: | ---: | --- |
| Nativo, perfil 1080p30, tom via monitor, +6 dB | 22,32 FPS | 17,44 FPS | **10,38 FPS** | Não atingida |
| Sintético com movimento, perfil 1080p60, 0 dB | 21,19 FPS | 21,17 FPS | **13,71 FPS** | Não atingida |
| Local I420/memfd/FFI, sem rede nem encoder | 27,78 FPS | **28,77 FPS** | Não se aplica | Não prova fluxo completo |

O ensaio nativo usou 30 segundos, H.264/VAAPI e CPU total de **98,69%**.
As janelas completas do receptor tiveram mínimo 5, mediana 10 e percentil 10 de
7 FPS. O tempo acumulado de codificação foi 18,974 s para 344 frames, cerca de
**55,2 ms por frame**, incluindo espera no caminho do encoder. Isso permanece
acima do orçamento de 33,3 ms de 30 FPS. Não foi separado o tempo de CPU do tempo
de espera no driver/GPU nessa métrica. `qualityLimitationReason=0` e NACK=0 não
provam ausência de todo problema de rede, mas não indicaram limitação de banda
como causa desses números. Não foi reduzida silenciosamente a resolução para
produzir um número de FPS maior.

Os relatórios finais incluem os clocks corrigidos e tempos de recepção medidos
com relógio monotônico, incluindo períodos sem chegada de frames. O teste anterior
de 60 FPS com fixture atrasada foi preservado como exploratório; essa fixture
usava o contador nominal de frames como tempo de captura. A fixture atual marca o
instante real em que gera o buffer. O caminho nativo mantém o PTS real do portal.

Áudio nativo no último ensaio:

- Entrada: pico **−26,02 dBFS**, RMS **−29,21 dBFS**.
- Após +6 dB de ganho de captura: pico **−20,02 dBFS**, RMS **−23,21 dBFS**.
- Receptor: pico **−18,70 dBFS**, RMS **−23,59 dBFS**, **zero amostras saturadas**.
- Formato de entrada: S16LE, 48 kHz, estéreo; codec de transporte Opus com RED.
- 29,34 s de PCM capturado em um intervalo de 30,34 s. Ainda houve lacunas sob carga.
  Lacunas de PTS também podem refletir atrasos de geração, não apenas perda de amostras.
- Ganho de fonte/monitor unitário; volume/mute da saída local inalterados.
- O pico pode mudar após Opus; isso não é por si só hard clipping. Não medimos THD,
  nem houve confirmação auditiva humana. Não prometemos áudio sem cortes sob saturação.

A proteção de fonte teve um ensaio real separado: 25 buffers de um monitor próprio,
tom com pico 1638; o harness moveu apenas sua gravação para outro monitor temporário.
O aplicativo detectou a troca e interrompeu a captura. **Nenhum microfone foi usado**.
Ambos os módulos de teste foram removidos. Evidência: [AUDIO-GUARD.json](results/AUDIO-GUARD.json).

O site existente também foi testado pelo navegador em um contexto próprio e
backend local: vídeo **1920×1080**, tempo de vídeo avançando por 13,96 s, 98 frames
contabilizados pelo player (42 descartados na exibição) e áudio `readyState=4`,
`paused=false`, avançando por 14,09 s. A página e seus bundles não foram alterados.
Esse é um smoke test de compatibilidade, com outro consumidor na mesma CPU; não é
um ensaio de capacidade de 30 FPS nem prova auditiva humana. O contexto e o navegador
que o harness abriu foram encerrados. Não houve captura por navegador nem flag
experimental de captura.

Evidências:

- [Nativo 1080p30](results/FINAL-NATIVA-h264-30-ganho6.json)
- [Sintético 1080p60](results/FINAL-SINTETICA-h264-60-ganho0.json)
- [Site local recebendo H.264/áudio](results/WEB-SINTETICA-h264-30-ganho0.json)
- [Captura/FFI local por memfd](results/LOCAL-ffi-I420-30-ring.json)

Os dois ensaios finais confirmaram `publisherStopped=true`, `publisherKilled=false`,
revogação da permissão, reserva Redis ausente e sala removida. Os módulos de áudio
criados pelo teste nativo também foram removidos. Resultados intermediários com
falha foram preservados. Uma execução exploratória não confirmou a liberação da
reserva: sua sala foi removida, e a chave isolada fica sujeita ao TTL de seis horas
do backend. Os ensaios finais confirmaram reserva ausente. O harness atual tem
limpeza condicional da chave própria, após verificar a metadata da sala de teste.
Não há mudanças de configuração global ou limpeza de recursos de outros usuários.

Validação automatizada: **52 testes existentes**, **12 testes Python do protótipo**
e **3 testes Node de IPC/buffers** aprovados; compilação C com avisos tratados como
erros, sintaxe Python/Node e lint do protótipo aprovados. O ensaio de proteção de
monitor e as integrações acima usam serviços reais e não rodam no teste unitário.

### Limites restantes

**1080p30 estável não foi atingido.** 1080p60 é uma opção de solicitação para outro
hardware, não uma capacidade comprovada aqui. O ganho medido de transporte não
justifica prometer 30/60 FPS completos. A próxima medição útil é repetir com receptor
em outro computador e sem contenção do host, separando custo de conversão/cópia,
espera de GPU/driver e codificação. O protótipo ainda copia I420 para o SDK e faz
upload para a GPU. DMA-BUF e integração direta de captura/encoder permanecem fora
desta implementação.

Continuam pendentes: sincronismo A/V e latência fim a fim com marcador de teste,
longa duração, recuperação de suspensão/hotplug, ensaio com áudio real de jogo/música,
limiter com transição suave, captura por aplicação e exclusão automática de chamadas.
A seleção de tela/janela continua sob consentimento no portal. Nenhum commit,
push ou deploy foi feito.

Fontes primárias usadas na investigação:

- [GStreamer appsink](https://gstreamer.freedesktop.org/documentation/app/appsink.html)
- [GStreamer videorate](https://gstreamer.freedesktop.org/documentation/videorate/index.html)
- [LiveKit: encoders de hardware](https://docs.livekit.io/robotics/media/video/encoders/)
- [SDK Node nativo](https://docs.livekit.io/reference/client-sdk-node/)
- [Cópia I420 na FFI Rust](https://github.com/livekit/rust-sdks/blob/main/livekit-ffi/src/server/colorcvt/mod.rs)

Essas referências explicam os contratos; os números acima vêm dos ensaios locais,
não de promessas de desempenho da documentação.

Para o smoke test opcional do site, iniciar um navegador de teste com perfil próprio
em /tmp e depuração apenas em 127.0.0.1:9222, depois usar:

```bash
DISCORD2_SYNTHETIC=1 DISCORD2_TEST_CODEC=h264 DISCORD2_TEST_SECONDS=15 \
DISCORD2_BROWSER_VIEWER=1 node desktop/transmissor/integration.mjs
```

O helper abre e fecha somente seu contexto anônimo. Quem iniciou o processo do
navegador deve encerrá-lo ao final; o harness não fecha navegadores preexistentes.
Esse helper requer Node com `WebSocket` global (ensaiado com Node 24.21.0).

Regressão real da proteção de fonte, sem abrir o portal e sem microfones:

```bash
/usr/bin/python3 desktop/transmissor/tests/audio-guard.py
```
