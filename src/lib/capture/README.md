# lib/capture — captura de tela e áudio (futuro)

**Estado atual (Fase 1):** vazio de propósito. Esta pasta só reserva o lugar.

## O que vai morar aqui

- Captura de tela com `getDisplayMedia()` (já validada na Fase 0).
- Captura do áudio do sistema (no Pop!_OS, via PipeWire e uma fonte virtual).
- Montagem do `MediaStream` com 1 trilha de vídeo + 1 trilha de áudio.
- Ajustes de qualidade (resolução e FPS) para a transmissão.

## Regras para o futuro

- Tudo aqui roda **só no navegador**. Quem usar estas funções deve estar em um
  componente com `"use client"`.
- Desktop é a prioridade para transmitir; no celular o foco é assistir.
- Gravação não faz parte do MVP.
