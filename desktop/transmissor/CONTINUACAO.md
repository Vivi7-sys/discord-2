# Continuação: admissão de vídeo antes das cópias

16/10/2026. Estado e medições anteriores conferidos antes de editar. Os cinco
arquivos rastreados já modificados fora de `desktop/transmissor` foram comparados
por SHA-256 e preservados. Os perfis também permaneceram idênticos: **1080p30 a
5 Mbps**, **1080p60 a 8 Mbps**, e **720p30 a 3 Mbps**. São tetos configurados;
o WebRTC pode ajustar o bitrate às condições de transporte. O computador usado
nos testes não determina a qualidade máxima oferecida pelo aplicativo.

## Gargalo e correção

O callback anterior executava `buffer.map()` e `mapped.data` antes de descobrir
que os três slots de memória compartilhada estavam ocupados. No PyGObject isso
materializa um quadro completo em bytes, mesmo quando ele será descartado. A
investigação anterior registrou centenas desses descartes em alguns ensaios.

Agora a captura reserva um slot **antes** de mapear/extrair vídeo. Se não houver
capacidade, descarta sem essas cópias. Vídeo que já chegou com mais de 500 ms de
idade também é descartado antes da cópia, tanto no ring como no fallback por pipe.
O limite de idade já existia no publisher e continua sendo conferido após o IPC.
Não se aumentaram filas, não se repetiram quadros e não se alterou resolução/FPS.

A reserva só pode voltar a ser usada após ACK do SDK. Se mapear/copiar falhar antes
de qualquer notificação IPC, ela é devolvida. Se uma escrita IPC começar e falhar,
a propriedade do slot fica incerta: ele permanece reservado até ACK ou teardown,
evita-se reutilizá-lo enquanto o consumidor poderia estar lendo. O encerramento
existente espera o processo publisher antes de fechar o ring.

Os novos contadores `diagnostics.videoBeforeCopy` distinguem descarte por idade,
capacidade e bytes que deixaram de ser materializados. Não representam frames
recebidos nem tempo de GPU. A proteção da fonte de áudio e o PCM não foram alterados.

## Comparação controlada

[Relatório com hashes das duas versões](results/CONTINUACAO-ADMISSAO-20261016T170955357285Z.json).
Cada versão processou 90 buffers I420 sintéticos, com os três slots previamente
ocupados por um consumidor simulado. Ordem ABBA por resolução; dois processos
por versão. A tabela usa a média do tempo de CPU desses dois processos. Inclui a
geração C do GStreamer e os callbacks, não apenas a extração Python.

| Resolução | Mapas antes → depois | Bytes materializados antes → depois | CPU antes → depois |
|---|---:|---:|---:|
| 1280×720 | 90 → 0 | 124.416.000 → 0 | 0,1551 → 0,1080 s |
| 1920×1080 | 90 → 0 | 279.936.000 → 0 | 0,2746 → 0,1934 s |

A redução foi aproximadamente 30% nesse cenário de ring saturado. Não se conclui
que a CPU total do aplicativo ou o FPS recebido melhoraram 30%. Sem saturação,
os quadros aceitos continuam exigindo extração, cópia ao ring, cópia FFI e upload.
Um ensaio exploratório anterior também está preservado; a comparação acima usa
as versões correspondentes tanto de `capture.py` como de `frame_ring.py`.

Para repetir com uma cópia anterior dos dois arquivos no mesmo diretório:

```bash
/usr/bin/python3 desktop/transmissor/tests/admission-benchmark.py \
  --baseline /tmp/discord2-continuacao-baseline/capture.py
```

O diretório `/tmp/discord2-continuacao-baseline` foi criado nesta sessão antes das
edições; não é permanente. O script não usa dispositivos, credenciais ou rede e
grava relatórios novos com timestamp. Os hashes no relatório identificam as
versões usadas mesmo se o backup temporário deixar de existir.

## Publicação real, com conteúdo sintético

Foram publicados I420 1920×1080 gerado em GStreamer, H.264 VA-API e áudio estéreo
48 kHz por LiveKit, com um receptor SDK no mesmo computador. Não houve captura de
tela, microfone, áudio de outros aplicativos ou uso do site em produção. Estes
ensaios dispensam captura PipeWire e conversão RGBA; não equivalem a medir o
pipeline nativo completo. Cada um teve 30 segundos solicitados.

| Perfil solicitado | Saída da captura | Entrada SDK | FPS recebidos | p10 recebido | Caminho encoder |
|---|---:|---:|---:|---:|---:|
| 1080p30 | 29,76 | 29,74 | **27,03** | 21 | 26,50 ms/quadro |
| 1080p60 | 47,93 | 47,94 | **29,31** | 25 | 30,42 ms/quadro |

[Relatório 1080p30](results/RX550-early-drop-SDK-SINTETICA-h264-1080p30-ganho0-2026-10-16T17-10-34-608Z-92d80cd0.json),
[relatório 1080p60](results/RX550-early-drop-SDK-SINTETICA-h264-1080p60-ganho0-2026-10-16T17-12-10-648Z-b19fd93b.json).
A CPU do host ficou em 92,58% e 97,65%, respectivamente. A carga é diferente da
sessão anterior: a diferença de FPS entre sessões não é comparação A/B da correção.
Nenhum passou o critério de estabilidade para seu perfil (`targetMet=false`).
`passed=true` confirma transporte, dimensões, áudio e limpeza, não a taxa desejada.

O SDK indicou `VAAPI H264 Encoder` / `powerEfficientEncoder=true`; o contador
`drm-engine-enc` dos descritores do próprio publisher também avançou no dispositivo
AMD `0000:02:00.0`. Não se interpretou trabalho global de outra aplicação como
prova de aceleração. Também se conferiram novamente os arquivos oficiais pelos
hashes já registrados: em `InitEncode` e `SetRates`, o wrapper VA-API propaga a
taxa pedida ao encoder, sem clamp fixo a 30 nessas rotinas. Isso não exclui
adaptação ou limites em outras partes do SDK/driver.
[Rotinas da revisão instalada](https://github.com/livekit/rust-sdks/blob/63128d01d955d9d8967544f46cff64a361232bf6/webrtc-sys/src/vaapi/h264_encoder_impl.cpp). O tempo do caminho do encoder ainda inclui mais que execução
no motor da GPU; [a investigação anterior](RX550.md) documenta upload, intercalação
I420→NV12 e espera síncrona na revisão instalada do SDK.

No teste de 30 FPS foram evitadas sete extrações por capacidade (21.772.800 bytes);
no de 60 FPS, 86 (267.494.400 bytes). Nenhum descarte antes da cópia foi por idade
nesses dois ensaios. Continuam existentes os descartes após o IPC e no WebRTC.

O áudio recebido apresentou pico/RMS de −25,28/−29,05 dBFS em 30 FPS e
−25,11/−29,06 dBFS em 60 FPS, com zero amostras saturadas, tom de amplitude 0,05
e ganho unitário. Foram capturados 30,02 s de PCM em 29,97 s de span e 30,72 s em
30,69 s de span; a diferença de aproximadamente um bloco é compatível com a
contagem de duração incluir o primeiro bloco. Isso não mede sincronismo na
reprodução, latência acústica ou áudio real de jogo. Não se anunciou A/V perfeito.

Em ambos, a reserva foi liberada, a sala apagada e o publisher encerrou normalmente,
sem SIGKILL. Os novos nomes de relatório incluem timestamp e identificador aleatório,
com criação exclusiva (`wx`), para preservar medições anteriores.

## Regressões e limites

Passaram 20 testes Python, quatro testes Node, lint do protótipo e compilação
Python. As duas integrações reais passaram transporte/limpeza.

Os testes exercitam buffers reais GStreamer: ring cheio sem mapear e sem sobrescrever
slots, apenas três envios antes de ACK, devolução da reserva em falha de map,
preservação do slot em falha de IPC e descarte de vídeo velho em ring/pipe. Também
continuam verificando caps 1080p60, IPC 720p, buffers e regras de áudio.

A primeira execução da regressão real de fonte de áudio falhou em confirmar a
interrupção dentro do prazo fixo; o relatório foi mantido. Uma repetição diagnóstica
passou. O teste foi tornado menos dependente de temporização: mantém sinal nos dois
monitores próprios e só tenta a mudança após verificar sinal válido na captura.
O tom do segundo monitor tem amplitude maior e frequência diferente: o teste
também confere que seu sinal não entrou no PCM aceito. Isso testa a decisão sobre
buffers de uma fonte diferente, não só a movimentação
de um stream para uma saída sem sinal. A captura interrompeu nas repetições; não
foi necessário alterar a política de áudio de produção. Cada execução agora salva
seu próprio relatório e remove somente seus módulos/tons. Nenhum microfone é usado.

Não foram alterados GTK, SDK, encoder, backend, autenticação, controle exclusivo,
limite de seis participantes ou os perfis máximos. Não houve nova medição de captura
via portal nesta sessão; os números nativos anteriores continuam válidos como
histórico. Continuam pendentes medições com receptor em outra máquina, carga
controlada, tempos internos de funções VA-API e sincronismo A/V com marcador.
Sem commit, push ou deploy.
