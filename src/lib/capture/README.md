# Captura de tela e áudio

A captura por clique está em `LiveKitRoomConnection.tsx`, via
`localParticipant.createScreenTracks()`. `publish-screen-tracks.ts` coordena a
publicação e desfaz todas as trilhas em falha parcial ou perda da sessão.

Toda trilha capturada após a saída deve ser parada sem publicação. A captura
virtual Linux é independente e só é publicada após validação da fonte existente.
O áudio automático depende do suporte do navegador e da seleção feita no seletor.

Desktop é a prioridade para transmitir; celulares são espectadores. Não há gravação.
