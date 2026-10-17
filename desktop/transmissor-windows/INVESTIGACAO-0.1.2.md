# Investigação e alterações — 0.1.2-beta1

## Evidência e limites

O relato do Windows 11 não veio acompanhado de estatísticas de captura, encoder ou receptor. Portanto a causa do “quase 0 FPS” **não está comprovada**. A versão anterior não tinha dados suficientes para separar WGC, conversão, encoder e recepção. Não atribuímos o problema ao computador.

Problemas encontrados por inspeção:

- Callback WGC fazia BGRA→BGR, resize mesmo na resolução original, canvas, cópia e BGR→I420, serializando captura com processamento.
- Filtro `agora - último < período` perde o próximo frame quando chega pouco antes do período e reinicia a fase no frame seguinte. O teste com jitter alternado de ±300 µs reproduz redução para aproximadamente metade da taxa.
- Construção de VideoFrame e chamada FFI síncrona estavam no mesmo loop de eventos que atende áudio e conexão.
- H.264 automático do SDK não é evidência de hardware Windows; a tabela oficial consultada não declara AMF/QSV Windows.

A medição em `results/CONVERSION-0.1.2-beta1.json` compara **somente conversão CPU em Linux**, com mesma entrada, aquecimento, 100 iterações e uma thread OpenCV para ambas as versões. Não é benchmark Windows, não mede WGC, encoding, rede nem FPS de transmissão. Não limita nenhum perfil.

## Implementação

O callback agora copia somente o buffer mapeado para memória própria: ele não pode sobreviver ao callback sem essa cópia. Uma thread converte o frame mais recente; ambas as filas de vídeo têm capacidade 1. Resize usa bilinear para manter custo previsível no caminho em tempo real, com possível aliasing de detalhes muito finos em redução. BGRA vai direto a I420, com fast path sem resize/canvas para dimensões iguais. Publicação mantém uma chamada pendente, fora do loop de áudio, e espera seu encerramento antes de destruir handles. Frames crus com mais de 150 ms são descartados. Áudio mantém seu pipeline e relógios existentes.

Aceleração: PyAV/FFmpeg testa `h264_nvenc`, `h264_qsv`, `h264_amf`, nesta ordem, **abrindo e codificando um frame preto no perfil escolhido**. Só depois usa `EncodedVideoSource` + `ENCODER_BACKEND_PRE_ENCODED` do SDK já fixado. H.264 Annex B, sem B frames, sem lookahead, GOP de 2 s, IDR solicitado por feedback LiveKit e reajuste de bitrate com histerese. Cada frame codificado é entregue imediatamente, sem fila que possa descartar referências P. Se o driver acumular frames ou recusar a publicação, a sessão para com erro; não continua uma cadeia corrompida. Se o probe inicial falhar, usa a fonte crua H.264 anterior e registra isso explicitamente.

Esta integração nativa preserva LiveKit, autenticação, exclusividade e áudio. Não substitui todo o transporte. Media Foundation foi considerado, mas a disponibilidade do encoder `h264_mf` não garante MFT de hardware; não é anunciado como aceleração. QSV/AMF/NVENC dependem dos codecs incluídos no wheel e do driver: falhas ficam no relatório, sem texto arbitrário do driver. Não há prova de funcionamento desses três drivers em GPU física neste ambiente. A conversão I420→NV12 e o upload ao encoder ainda existem; este caminho **não é zero-copy**. GPU não acessível e latência ponta a ponta ficam `null`.

O diagnóstico separa FPS capturados, submetidos ao SDK e codificados, descartes de cada fila, conversão total/máxima, duração de encode (contador RTC e chamada nativa hardware), idade captura→SDK e CPU do processo. CPU é média cumulativa em unidades de um núcleo (pode superar 100%). A duração da chamada ao encoder não equivale a um timer GPU. No caminho pré-codificado, os contadores internos RTC podem não medir encode externo; `hardwareEncodeMs` é a chamada externa. As amostras têm intervalo nominal de 2 s e usam o tempo efetivamente decorrido. `receivedFps` e latência ponta a ponta permanecem indisponíveis no publicador; medir no navegador. Nenhum desses valores é preenchido pelo FPS solicitado.

## Fontes primárias consultadas

- [Discord: arquitetura do Go Live](https://discord.com/blog/how-it-all-goes-live-an-overview-of-discords-streaming-technology): coordenação de processos e transporte WebRTC.
- [Discord: captura e encoding próprios para AMD](https://discord.com/blog/from-blocky-to-brilliant-improving-video-quality-on-discord-go-live-on-amd-gpus): integração com OS/drivers para qualidade e velocidade.
- [OBS: captura D3D11](https://github.com/obsproject/obs-studio/blob/master/plugins/win-capture/graphics-hook/d3d11-capture.cpp): caminhos de texturas compartilhadas e staging/readback. Referência arquitetural, sem copiar implementação.
- [LiveKit: hardware](https://docs.livekit.io/robotics/media/video/encoders/) e [SDK Python](https://github.com/livekit/python-sdks): fontes cruas/pré-codificadas, estatísticas, feedback e API nativa.
- [windows-capture](https://github.com/NiiightmareXD/windows-capture): buffer mapeado, row pitch e callback.
- [PyAV: codecs](https://pyav.basswood.io/docs/stable/api/codec.html): contexto nativo e encode.
- [rea](https://github.com/morluto/rea) foi examinado como ferramenta opcional. As APIs e fontes abertas bastaram para esta etapa; nenhuma engenharia reversa de binário Discord nem cópia de componentes proprietários foi necessária.

## Validação restante

CI Windows comprova build, ABI, instalação e testes controlados, não captura de desktop interativo nem hardware GPU. O aceite de fluidez/áudio/latência exige o procedimento Windows 11 em TESTE-WINDOWS.md, com vídeo em movimento, navegador visível, perfis separados e diagnóstico de cada sessão. Não há garantia universal de 1080p60 nem release publicada.
