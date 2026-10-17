# Discord 2 Transmissor para Windows — BETA 0.1.2-beta1

Implementação separada da versão Linux 1.0.0. **Captura real desta BETA ainda não validada em computador Windows. Não anunciar isolamento de chamadas como comprovado.**

Alvo: Windows 10 **2004/build 19041 ou posterior** e Windows 11, x64. O SDK, captura e interface são nativos; não dependem de Brave, Electron ou servidor local. O site de espectadores permanece https://discord-2-kuau.onrender.com/.

## Arquitetura

- Interface Qt/PySide6 escura D2, com convite, nome, Tela/Janela, alvo, qualidade, saída de áudio, Atualizar, Iniciar e Parar; ícone D2 no executável/instalador/menu. Python 3.12 fixado e incluído no executável empacotado.
- WGC (`windows-capture` 2.0.1): captura nativa via Direct3D, seleção explícita de monitor ou HWND. Mantém a borda padrão do sistema e não exige APIs opcionais de intervalo/borda das versões mais recentes do Windows. Admissão de frames por monotonic clock, fila de um frame, conversão CPU BGRA→I420 e letterbox para preservar proporção. Sem duplicação de quadros estáticos ou redução silenciosa do perfil.
- WASAPI Loopback (`PyAudioWPatch` 0.2.12.9): enumera somente loopbacks do host WASAPI, oferece a saída padrão, respeita seleção manual/Sem áudio e nunca consulta/abre o dispositivo de entrada padrão. PCM float nativo convertido em estéreo S16, sem ganho, com reamostragem **contínua** SoX do SDK para 48 kHz quando necessário. Mono duplicado, multicanal reduzido conservadoramente para mono estéreo; não é um downmix surround calibrado.
- LiveKit Python 1.1.21: backend Rust/WebRTC nativo, sem Agents/API administrativa no cliente. H.264, Opus e fontes SCREENSHARE/SCREENSHARE_AUDIO. Mesmo contrato do Linux: `/api/livekit/token` + bearer temporário em `/api/livekit/share`. Os perfis são lidos diretamente do JSON Linux e copiados explicitamente para o pacote. Nenhum arquivo Linux foi modificado.
- Cada sessão é um processo próprio. A UI pede encerramento e aguarda; após 30 segundos pode terminar somente seu processo para liberar handles. Captura encerra antes de release/disconnect; tentativas de release têm prazo, com aviso se a confirmação não vier. O backend existente continua decidindo vaga exclusiva e limite de seis participantes; uma próxima aquisição verifica a presença do transmissor após queda. Fechar a UI faz o mesmo pedido de parada. Sem reinício/captura automática após desconexão.

Electron foi avaliado e não adotado: adicionaria um runtime/browser e outro caminho de IPC sem resolver, por si, a escolha segura de WASAPI Loopback. Python permite uma primeira implementação menor e um empacotamento único com Qt, sem instalar GTK no Windows. O publicador foi adaptado para o SDK Python, pois os descritores POSIX/memfd do processo Node Linux não são portáveis ao Windows; autenticação, permissões, codecs, perfis e semântica de liberação são preservados e testados contra os endpoints existentes.

## Pipeline 0.1.2-beta1

Captura WGC com cópia de propriedade e fila de um frame; conversão fora do callback; fast path BGRA→I420 sem resize/canvas redundantes; ritmo por deadlines tolerante a jitter. A chamada síncrona FFI do vídeo sai do loop de áudio/conexão. Os três perfis originais permanecem disponíveis sem limitação baseada no Linux.

PyAV/FFmpeg tenta NVENC, Quick Sync e AMF com uma codificação de teste real. Quando funciona, entrega H.264 pré-codificado à API nativa do LiveKit, com IDR/rate feedback. Caso nenhum encoder funcione, mantém H.264 cru do SDK e informa o caminho selecionado. Isso ainda exige readback CPU/conversão/upload e **não é zero-copy**. Drivers físicos ainda precisam de teste no Windows 11.

A interface mostra FPS reais capturados, submetidos ao SDK e codificados. Depois de Parar, **Salvar diagnóstico** exporta contadores sem convite, nome, token ou títulos de janela. FPS do espectador e latência ponta a ponta exigem medição no receptor. Consulte [investigação e limites](INVESTIGACAO-0.1.2.md) e [procedimento Windows 11](TESTE-WINDOWS.md).

## Build em Windows x64

No checkout que contém estes arquivos e `desktop/transmissor/profiles.json`, usando Python 3.12 x64, Visual Studio Build Tools C++ x64 com Windows SDK 20348+ e Inno Setup 6.7.1:

```powershell
py -3.12 -m venv desktop/transmissor-windows/.venv
$python = '.\desktop\transmissor-windows\.venv\Scripts\python.exe'
& $python -m pip install --require-hashes -r desktop/transmissor-windows/requirements-windows.lock
./desktop/transmissor-windows/native/build.ps1
& $python -m unittest discover -s desktop/transmissor-windows/tests -v
& $python desktop/transmissor-windows/launch.py --self-test --report self-test.json
& $python desktop/transmissor-windows/packaging/build.py
```

Saída do build: `desktop/transmissor-windows/dist/Discord2Transmissor-0.1.2-beta1-windows-x64-setup.exe` e `SHA256SUMS`. O script gera ícone, executável com dependências/avisos de terceiros, verifica o runtime empacotado e arquitetura PE, compila instalador por usuário com menu Iniciar e desinstalador. Não inclui `.env`, backend, harnesses, relatórios de testes ou caminhos do computador de desenvolvimento. Ainda não há assinatura Authenticode.

O workflow `.github/workflows/transmissor-windows.yml` executa em **push na branch privada `build/windows-transmissor-0.1.2-beta1`** e em PR dessa branch para `main`; não depende de instalação prévia na branch padrão. Não usa secrets de backend, não publica release e não faz deploy. Executa testes, imports nativos, build, instalação descartável, comparação SHA-256 de todos os arquivos instalados com o payload, self-test instalado e desinstalação. O artefato privado fica disponível por sete dias.

Após concluir o workflow: GitHub → repositório privado → **Actions → Windows transmitter candidate → execução verde → Artifacts → discord2-windows-x64-candidate-unvalidated-capture**. Extraia o ZIP, confira `SHA256SUMS` com `Get-FileHash .\Discord2Transmissor-0.1.2-beta1-windows-x64-setup.exe -Algorithm SHA256` e execute o instalador. O acesso ao artefato exige acesso ao repositório privado. Não há instalador produzido antes da execução Windows; sucesso no CI não comprova WGC/WASAPI reais.

## Teste humano mínimo em Windows real

1. Instale o candidato, abra pelo menu Iniciar e verifique ícone D2. Cole convite de uma sala nova do site público e nome. Nada deve transmitir antes de Iniciar.
2. Escolha Tela, 720p30 ou 1080p30 e saída USB correta. Reproduza **fala/música real de um programa/jogo**, mantenha o som local e clique Iniciar. Entre pelo celular no mesmo convite. Confirme imagem legível, cores/proporção, áudio audível/sem distorção e sincronização. 1080p60 só em computador capaz.
3. Pare, reinicie e teste Janela. Cancele fechando antes de iniciar e feche a janela capturada durante a transmissão. Teste minimizar e redimensionar: janelas minimizadas/protegidas/HDR podem congelar ou não capturar. Não confundir quadro estático com FPS medido baixo.
4. Inicie um segundo transmissor: deve informar vaga ocupada sem derrubar o primeiro. Feche o primeiro durante transmissão e confirme que o segundo adquire a vaga.
5. Desconecte/reconecte a rede; a UI deve parar e permitir nova tentativa manual. Remova a saída USB durante captura; não pode cair em microfone nem trocar silenciosamente de dispositivo. Atualize a lista e selecione novamente. Dispositivos com nomes/índices instáveis precisam de validação específica.
6. Desinstale e confirme remoção de executável e atalho. Registre versão do Windows/GPU/driver e resultados; nenhuma gravação de mídia ou token é necessária.

## Três modos de áudio e compatibilidade

- **Áudio do aplicativo:** ao escolher Janela, é o modo oferecido. DLL C++ x64 própria usa `ActivateAudioInterfaceAsync` com `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` e `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`. Inclui somente os streams de reprodução do PID da janela e descendentes. Sem captura de microfone, arquivos de áudio em disco ou alteração de volume/roteamento local. PCM S16 estéreo 48 kHz, conversão pelo motor WASAPI, sem ganho; timestamps QPC mapeados ao relógio monotônico e fila limitada. Nenhum fallback para áudio do sistema.
- **Áudio do sistema inteiro:** mantém PyAudioWPatch/WASAPI Loopback da saída manual/padrão; inclui chamadas e todos os aplicativos nessa saída. O seletor da saída só é usado neste modo.
- **Sem áudio:** publica somente vídeo.

Application Loopback exige **build 20348+** segundo a Microsoft. Windows 11 atende ao requisito de versão, sujeito à ativação real. O Windows 10 desktop comum (até 22H2, build 19045) **não atende**; o modo informa erro e não inicia. Vídeo e os outros dois modos mantêm o mínimo build 19041. Não usamos apenas o nome “Windows 10” para presumir suporte.

A janela é ligada a HWND + PID + horário de criação, com handle do processo mantido durante a captura. A DLL revalida identidade, vida do processo e HWND durante a sessão. Não infere processo por título, não sobe para processo pai/launcher e não pede elevação. Se a janela/processo mudar ou o acesso falhar, a sessão encerra e libera recursos/vaga. Ao trocar de Janela para Tela, o modo vai para **Sem áudio**, sem ampliar silenciosamente a captura.

**Limitações:** filtro por árvore de processos não é filtro por janela, aba ou jogo lógico. Áudio de várias janelas no mesmo processo e chamadas dentro da árvore incluída podem passar juntos. Helpers irmãos, processos externos/serviços, áudio delegado e alguns jogos/launchers podem não entrar. Navegadores/hosts compartilhados podem reunir conteúdo de várias janelas. Capturar uma janela de launcher pode incluir aplicações filhas inesperadas: prefira a janela do jogo. DRM, anticheat e processos protegidos/elevados podem impedir captura. Não há garantia universal de exclusão de eco.

A DLL tem COM MTA em thread própria, callback copiado antes de liberar buffer WASAPI, cancelamento por evento e espera de encerramento antes de soltar handles. Falha de ativação encerra a captura selecionada; nunca abre loopback global. A UI continua usando o processo isolado por sessão e LiveKit/controlador de exclusividade existentes. Veja [TESTE-WINDOWS.md](TESTE-WINDOWS.md) para validação com jogo e áudio independente simultâneos.

## Testes e limites

A BETA anterior (0.1.0) teve build/23 testes, instalação, runtime e desinstalação aprovados no runner Windows, sem validação de mídia real. Esta candidata acrescenta testes de suporte por build, identidade HWND/PID/criação, erro sem fallback, seleção dos modos, cancelamento, limpeza e liberação/reinício. O CI compila a DLL com MSVC x64 e runtime C estático, testa ABI e identidade de uma janela de processo filho, sem capturar áudio nem desktop. O self-test instalado carrega a DLL sem iniciar captura.

Os testes locais em Linux não executam APIs de captura Windows. O teste humano descrito em TESTE-WINDOWS.md é obrigatório para verificar jogo audível, chamadas externas excluídas, sincronização, Parar/reiniciar/fechar e comportamento no Windows 10 sem suporte. Nenhum teste simulado prova isolamento real. O modo de aplicativo não muda o encoder/qualidades nem o contrato LiveKit/backend. O caminho H.264 por hardware foi implementado, mas ainda precisa de validação em GPU Windows física.

O instalador é experimental, sem assinatura Authenticode; não desative SmartScreen. Não há release automática: apenas artefato privado do Actions até autorização de publicação.

Fontes primárias: [Application Loopback e build mínimo](https://learn.microsoft.com/en-us/windows/win32/api/audioclientactivationparams/ne-audioclientactivationparams-process_loopback_mode), [exemplo Microsoft](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/), [WGC](https://github.com/NiiightmareXD/windows-capture), [WASAPI Loopback](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording), [SDK Python](https://github.com/livekit/python-sdks).
