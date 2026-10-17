# Discord 2 Transmissor para Windows — protótipo 0.1.0

Implementação separada da versão Linux 1.0.0. **Ainda não validada em Windows real e sem instalador gerado nesta sessão Linux. Não anunciar como versão Windows pronta.**

Alvo: Windows 10 **2004/build 19041 ou posterior** e Windows 11, x64. O SDK, captura e interface são nativos; não dependem de Brave, Electron ou servidor local. O site de espectadores permanece https://discord-2-kuau.onrender.com/.

## Arquitetura

- Interface Tk/ttk pequena, com convite, nome, Tela/Janela, alvo, qualidade, saída de áudio, Atualizar, Iniciar e Parar; ícone D2 no executável/instalador/menu. Python 3.12 fixado e incluído no executável empacotado.
- WGC (`windows-capture` 2.0.1): captura nativa via Direct3D, seleção explícita de monitor ou HWND. Mantém a borda padrão do sistema e não exige APIs opcionais de intervalo/borda das versões mais recentes do Windows. Admissão de frames por monotonic clock, fila de um frame, conversão CPU BGRA→I420 e letterbox para preservar proporção. Sem duplicação de quadros estáticos ou redução silenciosa do perfil.
- WASAPI Loopback (`PyAudioWPatch` 0.2.12.9): enumera somente loopbacks do host WASAPI, oferece a saída padrão, respeita seleção manual/Sem áudio e nunca consulta/abre o dispositivo de entrada padrão. PCM float nativo convertido em estéreo S16, sem ganho, com reamostragem **contínua** SoX do SDK para 48 kHz quando necessário. Mono duplicado, multicanal reduzido conservadoramente para mono estéreo; não é um downmix surround calibrado.
- LiveKit Python 1.1.21: backend Rust/WebRTC nativo, sem Agents/API administrativa no cliente. H.264, Opus e fontes SCREENSHARE/SCREENSHARE_AUDIO. Mesmo contrato do Linux: `/api/livekit/token` + bearer temporário em `/api/livekit/share`. Os perfis são lidos diretamente do JSON Linux e copiados explicitamente para o pacote. Nenhum arquivo Linux foi modificado.
- Cada sessão é um processo próprio. A UI pede encerramento e aguarda; após 30 segundos pode terminar somente seu processo para liberar handles. Captura encerra antes de release/disconnect; tentativas de release têm prazo, com aviso se a confirmação não vier. O backend existente continua decidindo vaga exclusiva e limite de seis participantes; uma próxima aquisição verifica a presença do transmissor após queda. Fechar a UI faz o mesmo pedido de parada. Sem reinício/captura automática após desconexão.

Electron foi avaliado e não adotado: adicionaria um runtime/browser e outro caminho de IPC sem resolver, por si, a escolha segura de WASAPI Loopback. Python permite uma primeira implementação menor e um empacotamento único com Tk, sem instalar GTK no Windows. O publicador foi adaptado para o SDK Python, pois os descritores POSIX/memfd do processo Node Linux não são portáveis ao Windows; autenticação, permissões, codecs, perfis e semântica de liberação são preservados e testados contra os endpoints existentes.

## Codificação por hardware: pendência explícita

A captura WGC é baseada em Direct3D, mas isso **não comprova encoding H.264 pela GPU**. O SDK fixado documenta hardware para alguns backends Linux/macOS; não documenta um backend Windows equivalente. O protótipo deixa o encoder na política automática do SDK, com fallback H.264 de software. **Codificação acelerada no Windows não foi implementada/comprovada como caminho confiável nesta etapa**, e é uma pendência para atender plenamente esse requisito. Não há flag fictícia “GPU ativada”. Avaliar Media Foundation/NVENC e suporte de frames pré-codificados caso o SDK Windows não ofereça um backend nativo adequado. Não alterar o pipeline Linux por isso. Perfis 720p30/1080p30/1080p60 continuam disponíveis para hardware capaz, sem garantia de FPS universal.

## Build em Windows x64

No checkout que contém estes arquivos e `desktop/transmissor/profiles.json`, usando Python 3.12 x64 e Inno Setup 6.7.1:

```powershell
py -3.12 -m venv desktop/transmissor-windows/.venv
$python = '.\desktop\transmissor-windows\.venv\Scripts\python.exe'
& $python -m pip install --require-hashes -r desktop/transmissor-windows/requirements-windows.lock
& $python -m unittest discover -s desktop/transmissor-windows/tests -v
& $python desktop/transmissor-windows/launch.py --self-test --report self-test.json
& $python desktop/transmissor-windows/packaging/build.py
```

Saída **esperada, ainda não produzida**: `desktop/transmissor-windows/dist/Discord2Transmissor-0.1.0-windows-x64-setup.exe` e `SHA256SUMS`. O script gera ícone, executável com dependências/avisos de terceiros, verifica o runtime empacotado e arquitetura PE, compila instalador por usuário com menu Iniciar e desinstalador. Não inclui `.env`, backend, harnesses, relatórios de testes ou caminhos do computador de desenvolvimento. Ainda não há assinatura Authenticode.

O workflow `.github/workflows/transmissor-windows.yml` executa em **push na branch privada `build/windows-transmissor-0.1.0`** e em PR dessa branch para `main`; não depende de instalação prévia na branch padrão. Não usa secrets de backend, não publica release e não faz deploy. Executa testes, imports nativos, build, instalação descartável, comparação SHA-256 de todos os arquivos instalados com o payload, self-test instalado e desinstalação. O artefato privado fica disponível por sete dias.

Depois de autorizar o push e concluir o workflow: GitHub → repositório privado → **Actions → Windows transmitter candidate → execução verde → Artifacts → discord2-windows-x64-candidate-unvalidated-capture**. Extraia o ZIP, confira `SHA256SUMS` com `Get-FileHash .\Discord2Transmissor-0.1.0-windows-x64-setup.exe -Algorithm SHA256` e execute o instalador. O acesso ao artefato exige acesso ao repositório privado. Não há instalador produzido antes da execução Windows; sucesso no CI não comprova WGC/WASAPI reais.

## Teste humano mínimo em Windows real

1. Instale o candidato, abra pelo menu Iniciar e verifique ícone D2. Cole convite de uma sala nova do site público e nome. Nada deve transmitir antes de Iniciar.
2. Escolha Tela, 720p30 ou 1080p30 e saída USB correta. Reproduza **fala/música real de um programa/jogo**, mantenha o som local e clique Iniciar. Entre pelo celular no mesmo convite. Confirme imagem legível, cores/proporção, áudio audível/sem distorção e sincronização. 1080p60 só em computador capaz.
3. Pare, reinicie e teste Janela. Cancele fechando antes de iniciar e feche a janela capturada durante a transmissão. Teste minimizar e redimensionar: janelas minimizadas/protegidas/HDR podem congelar ou não capturar. Não confundir quadro estático com FPS medido baixo.
4. Inicie um segundo transmissor: deve informar vaga ocupada sem derrubar o primeiro. Feche o primeiro durante transmissão e confirme que o segundo adquire a vaga.
5. Desconecte/reconecte a rede; a UI deve parar e permitir nova tentativa manual. Remova a saída USB durante captura; não pode cair em microfone nem trocar silenciosamente de dispositivo. Atualize a lista e selecione novamente. Dispositivos com nomes/índices instáveis precisam de validação específica.
6. Desinstale e confirme remoção de executável e atalho. Registre versão do Windows/GPU/driver e resultados; nenhuma gravação de mídia ou token é necessária.

## Áudio de chamadas e eco

O loopback captura **tudo que toca na saída escolhida**, incluindo chamadas; selecionar uma janela não restringe o áudio àquela janela. Não há exclusão perfeita de eco e o aplicativo não silencia amigos, volume nem reprodução local. Evite reproduzir o espectador na mesma saída capturada. Separar explicitamente a saída das chamadas da saída do jogo é uma alternativa manual.

A Microsoft oferece process loopback para incluir/excluir uma árvore de processos a partir de build 20348; isso não cobre o Windows 10 19045 comum e não equivale automaticamente a filtrar uma saída específica. Não está implementado nem validado neste protótipo. É uma evolução possível para Windows compatíveis, com seleção explícita e testes de processos filhos/navegadores.

## Evidências e limites desta rodada

- Testes automatizados executados em Linux: validação de convites/nomes, perfis intactos, rejeição de microfones/remaps, API/HTTP sem redirects/segredos, PCM, letterbox, filas, timestamps ausentes e resampler SoX contínuo, release/cleanup, falha de disconnect e cancelamento pendente. Três testes adicionais usam widgets simulados para conferir estado da UI; não são testes gráficos em Windows.
- Integração real usando **o novo Session/SDK Python em Linux**, API pública e SFU em sala exclusiva descartável: trilhas de tela/áudio, exclusividade, Parar, reiniciar, queda abrupta e recuperação, limpeza confirmada e sala removida. **Sem desktop Windows, sem WASAPI real, sem injeção de frames sintéticos; não valida mídia no Windows.** O SDK pode emitir placeholders iniciais; isso também não é evidência de captura.
- 23 wheels Windows fixadas com hashes; fechamento de dependências para marcadores Windows/Python 3.12 verificado; 26 binários PE das dependências de runtime são AMD64. Isso não é um build nem execução Windows.
- SDK testado encontrou incompatibilidade de `rtc.AudioEncoding` (corrigida usando opções protobuf públicas) e falha durante encerramento do interpretador (corrigida com descarte antecipado do runtime por processo). Os relatórios históricos ficam somente no checkout de desenvolvimento, fora da branch de build.
- Pendente: executar build/instalador e testes em runner Windows, testar vídeo/áudio reais no Windows 10 e 11, confirmar volume/sincronização/latência/FPS/encoder, validar hardware encoding, hotplug/HDR/múltiplos monitores e assinatura para distribuição. **Build Windows e captura real permanecem pendentes até execução e teste humano.**

Fontes primárias: [WGC](https://github.com/NiiightmareXD/windows-capture), [WASAPI Loopback](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording), [PyAudioWPatch](https://github.com/s0d3s/PyAudioWPatch), [SDK Python e hardware](https://github.com/livekit/python-sdks), [process loopback Microsoft](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/).
