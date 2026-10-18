# Pipeline nativo e pesquisa de desempenho

## Caminho implementado

```text
Windows.Graphics.Capture / D3D11
  → reserva de slot (máximo um frame pendente)
  → readback com pitch nativo
  → BGRA para I420 por libyuv SIMD
  → escala I420 se a fonte exceder o perfil (proporção preservada)
  → NativeVideoSource / LocalVideoTrack do SDK oficial LiveKit Rust
  → preferência de encoder Hardware / H.264
  → RTP / LiveKit

WASAPI render loopback ou process loopback
  → PCM estéreo 48 kHz / i16 / blocos de 10 ms
  → fila limitada a 5 blocos
  → NativeAudioSource / LocalAudioTrack de screenshare audio
```

Não é zero-copy. O readback GPU→CPU, a conversão, a escala e a cópia interna do SDK têm custo. A fila é reservada antes do readback; congestionamento descarta o frame antes de pagar esse custo. Frames com mais de 150 ms de idade são descartados. Áudio atrasado encerra a sessão, sem inventar silêncio ou trocar a origem. Nenhuma operação de mídia passa pelo JavaScript.

A cadência usa deadlines acumulados com tolerância de 1 ms para evitar reduzir pela metade o FPS ao receber callbacks pouco antes de 16,67/33,33 ms. Quando a versão do Windows suporta `MinUpdateInterval`, WGC também recebe o intervalo solicitado; em versões sem essa propriedade, a cadência Rust permanece. Uma área estática pode gerar menos callbacks: não se deve reportar o FPS configurado como se fosse FPS capturado.

`captured` conta callbacks reais; `submitted` conta chamadas de entrega concluídas à fonte SDK (essa versão retorna `()`, sem confirmação de aceite), não frames publicados; `encodedFps` deriva de `frames_encoded`; `publishedFps` deriva de `frames_sent` das estatísticas outbound RTP. Nenhum desses valores confirma decodificação no espectador. Estatísticas ausentes aparecem como indisponíveis. A amostra de `processingMs` cobre conversão/readback/escala do último frame, não latência ponta a ponta.

A preferência `VideoEncoderBackend::Hardware` admite fallback interno do SDK. A interface mostra `encoder_implementation` observado. Solicitar hardware não prova que um hardware encoder foi selecionado; não há selo fictício de NVENC/AMF/QSV.

## Próximo caminho para evitar readback

```text
WGC texture D3D11
  → pool persistente de surfaces no mesmo adaptador
  → video processor/compute: escala e BGRA→NV12 na GPU, quando necessário
  → encoder vendor ou Media Foundation MFT com D3D manager
  → access unit H.264 (Annex B, SPS/PPS e IDR)
  → NativeVideoSource::new_encoded / capture_encoded_frame
  → VideoEncoderBackend::PreEncoded
```

A API Rust consultada não oferece importação pública direta de uma textura Windows D3D11 como `NativeBuffer`. O caminho pré-codificado é a integração pública a investigar para preservar texturas na GPU sem manter um fork do WebRTC. A codificação deve honrar pedidos de keyframe (PLI/FIR), bitrate e backpressure do SDK; quando uma unidade é rejeitada, a próxima sequência não pode depender de um frame descartado. H.264 deve respeitar SDP/perfil negociado. Um encoder que só grava MP4 não basta para publicação RTC.

| Vendor           | Integração a implementar                                           | Pontos de validação                                                                    |
| ---------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| NVIDIA NVENC     | registrar/mapear `ID3D11Texture2D` na API NVENC; H.264 low latency | suporte da GPU/driver, formato da textura, IDR, bitrate, busy/async, adaptador correto |
| AMD AMF          | contexto D3D11, surface DX11 nativa e componente AVC               | runtime AMF, BGRA/NV12, latência, PTS, filas e reset da GPU                            |
| Intel Quick Sync | oneVPL com superfícies D3D11 e NV12                                | dispatcher/runtime Intel, iGPU/dGPU, video memory allocator, sync points               |
| Media Foundation | MFT H.264 hardware, `IMFDXGIDeviceManager` e samples DXGI          | enumerar hardware real, não presumir que MFT disponível significa aceleração ativa     |

AMF e Quick Sync próprios não foram implementados neste candidato. A preferência genérica do SDK não substitui essa tarefa. Também faltam HDR→SDR correto, reutilização de buffers/pool D3D11, timestamps de hardware WASAPI/QPC e ensaio prolongado de drift A/V. O vídeo usa relógio monotônico local; áudio usa a cadência PCM/WebRTC. Isso não é prova de sincronização de hardware.

## Medição verificável

`tests/conversion_benchmark.rs` mede somente conversão CPU com 128 frames sintéticos por perfil e pitch não contíguo. Produz p50, p95, média e throughput de conversão em `evidence/windows-synthetic-conversion.json`. Os três perfis são executados sem diminuir resolução ou FPS com base na máquina de desenvolvimento. O benchmark ainda depende de execução Windows para produzir números; não foi substituído por estimativas.

`tests/windows_capture.rs` exige desktop interativo e testa frame WGC real e stop sem depender de novos callbacks. `tests/real_session.rs` exige sala dedicada e espectador ativo, mede presença de captura/entrega à fonte/RTP e confirma liberação. Nenhum deles mede ainda decodificação, latência de áudio ou FPS sustentado de uma cena em movimento. Testes ausentes não viram sucesso por fallback.

Para comparar desempenho, usar a mesma cena animada e perfis no Python anterior e no Rust, coletando callbacks WGC, entregues à fonte, codificados, enviados, decodificados, descartes por motivo, CPU, GPU video encode, VRAM, p50/p95 de processamento e latência A/V. Registrar vendor, GPU, driver, Windows build e encoder observado. Uma placa antiga no Linux não determina metas de qualidade do Windows.

## Fontes primárias consultadas

- [SDK Rust oficial LiveKit, versão fixada 0.7.53](https://docs.rs/livekit/0.7.53/livekit/).
- [Publicação pré-codificada LiveKit](https://docs.livekit.io/transport/media/pre-encoded/).
- [windows-capture 1.5.0: captura WGC](https://docs.rs/windows-capture/1.5.0/windows_capture/).
- [wasapi 0.22.0: API de captura](https://docs.rs/wasapi/0.22.0/wasapi/). A implementação da crate foi conferida para confirmar que `include_tree=false` usa `PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE`.
- [Microsoft: Application Loopback, inclusão/exclusão e build mínimo 20348](https://github.com/microsoft/Windows-classic-samples/blob/main/Samples/ApplicationLoopback/README.md).
- [NVIDIA: NVENC API Programming Guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-video-encoder-api-prog-guide/index.html).
- [AMD: SDK AMF oficial](https://github.com/GPUOpen-LibrariesAndSDKs/AMF).
- [Intel: oneVPL e compartilhamento de buffers](https://www.intel.com/content/www/us/en/docs/oneapi/programming-guide/2023-2/intel-oneapi-video-processing-library-onevpl.html).

As recomendações de integração GPU acima são decisões de arquitetura baseadas nessas APIs, não resultados de benchmark nem garantia de suporte no binário atual.
