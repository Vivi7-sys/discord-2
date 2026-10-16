# Instalação no Pop!_OS 24.04 / COSMIC Wayland

Pacote de desenvolvimento amd64: `dist/discord2-transmissor_1.0.0~rc1_amd64.deb`.
Preparado e extraído para verificação; **a instalação no sistema e o lançamento pelo menu ainda precisam ser testados**.

Na raiz do projeto:

```sh
sudo apt install ./desktop/transmissor/dist/discord2-transmissor_1.0.0~rc1_amd64.deb
```

Depois abra **Discord 2 Transmissor** no menu Aplicativos (ícone D2). Cole seu convite, informe o nome, escolha Tela ou Janela e o perfil. Clique em **Selecionar e iniciar** e autorize a seleção no portal. **Parar** encerra a captura e libera a transmissão; fechar a janela também aguarda o encerramento. Não há início automático de captura.

1080p/30, 1080p/60 e 720p/30 permanecem disponíveis, sem redução automática da qualidade escolhida. A taxa efetiva depende do computador. Codificação e ganho ficam em **Opções avançadas**; o ganho inicial é 0 dB.

Ao abrir normalmente, o aplicativo oferece o monitor **validado** da saída retornada por `pactl get-default-sink`, quando disponível; caso contrário, **Sem áudio**. Nada é capturado antes de iniciar. A escolha manual, inclusive **Sem áudio**, permanece durante as atualizações. A lista se atualiza ao abrir o seletor, voltar à janela, clicar em **Atualizar saídas de áudio** e antes de iniciar. A remoção da saída selecionada ou falha de consulta desativa a seleção, sem substituí-la por outra. Uma transmissão ativa nunca troca de dispositivo por causa de atualização. Escolha somente a saída onde o programa toca. A lista contém monitores de saída, não entradas de microfone; uma mudança inesperada da fonte interrompe a captura. Compartilhar uma janela **não restringe o áudio àquela janela**. O monitor inclui tudo que tocar naquela saída, inclusive chamadas. Para excluir chamadas sem interromper sua reprodução, use saídas separadas para o programa e as chamadas; a seleção automática de áudio por aplicativo ainda não está implementada. O aplicativo não muda o volume, o mudo nem a saída padrão do sistema. Não selecione a saída que contém o próprio navegador espectador: isso causa realimentação digital.

Para validar um programa/jogo, reproduza um trecho com fala, música e efeitos nesse programa, selecione seu monitor de saída, e confira no espectador voz compreensível, ausência de distorção e sincronização com eventos visuais. Comece com ganho 0 dB. Pare e reinicie, depois feche durante uma transmissão e confirme que outro transmissor consegue obter a vaga. Esse teste de jogo ainda está pendente; o bip não o substitui. Para um teste isolado com backend local e instruções de roteamento, consulte `VALIDACAO-MANUAL.md` no projeto.

Diagnósticos opcionais: botão **Salvar diagnóstico da última sessão**, em `$XDG_STATE_HOME/discord2-transmissor/diagnostics` (normalmente `~/.local/state/discord2-transmissor/diagnostics`). Arquivos privados, sem convite, tokens ou mídia. Falha de dependências/sessão abre mensagem gráfica; detalhes: `discord2-transmissor --check`.

Dependências declaradas no .deb: Python/GI/GTK 3, GStreamer base/good/PipeWire, ferramentas Pulse, Node >=18.19, bibliotecas C/C++ e XDG Desktop Portal. O COSMIC precisa fornecer um backend ScreenCast funcional. Mesa VA-API é recomendado; o pacote não instala um driver particular nem garante codificação por GPU. Não exige Brave, Electron, NVM ou compilador em execução. Não contém backend, chaves LiveKit, `.env`, resultados de testes ou plugins extraídos em `/tmp`. Nenhum script de instalação baixa código ou abre captura. O SDK e suas dependências/licenças ficam junto ao runtime em `/usr/lib/discord2-transmissor/node_modules`.

Compilação local, com dependências npm já instaladas conforme lock e `cc`/headers Node disponíveis:

```sh
npm run build:deb --prefix desktop/transmissor
npm run check:deb --prefix desktop/transmissor
```

O construtor verifica versões com o lock, usa uma lista explícita de arquivos runtime, inclui o SDK nativo amd64 e não acessa a rede. As verificações do pacote não substituem um teste após instalação. A instalação exige acesso aos repositórios apt para dependências ausentes, especialmente `gstreamer1.0-pipewire`, que não estava instalado neste ambiente de desenvolvimento.

## Resultados comprovados em 16/10/2026

- Relato do usuário: GTK abriu, vídeo apareceu no navegador, bip ouvido, Parar liberou a vaga. Isso não mede FPS, latência ou sincronização.
- 24 testes Python e 4 testes Node passaram; lint passou. Smoke gráfico: abre/fecha, áudio inicialmente desligado, perfil inicial 1080p/30, sem iniciar captura.
- Pacote extraído: entrada `.desktop` válida, imports Python, SDK e addon nativo carregados com `/usr/bin/node` 18.19.1. Aproximadamente 12 MB. Não instalado no sistema nesta sessão.
- Áudio de **programa real, isolado do SFU**: `tests/program-audio.py` executou `paplay` com a gravação de voz `audio-channel-front-left.oga` do sistema. Captura de produção: PCM S16LE, estéreo, 48 kHz, 264 blocos / 5,28 s, pico −6,06 dBFS, RMS −26,85 dBFS (inclui silêncio), ganho 0 dB, zero blocos saturados, zero erros, zero regressões/gaps de PTS. Máxima idade observada 79,408 ms na captura; **não é latência fim a fim**. Reprodução local encaminhada pela saída temporária própria; volume/mudo local iguais antes/depois; módulos removidos. Audibilidade humana não avaliada. Evidência: `results/PROGRAM-AUDIO-5daff4ede71a437f9b19e668384786fe.json` no projeto.
- Ainda pendentes: áudio real de jogo recebido no site, sincronização audiovisual/latência percebida, lançamento após instalação pelo menu e longa sessão diária. Não houve novo teste de FPS de desktop nesta etapa; as medições históricas continuam em RX550.md. Não extrapolar este teste de áudio para desempenho de vídeo.

Sem alterações no site, commit, push ou deploy nesta etapa.

Atualização 0.1.1: detalhes da correção do monitor USB, atualização da lista e testes em `ENUMERACAO-AUDIO.md`. A preferência inicial por saída padrão nesta versão substitui o comportamento inicial descrito nos resultados históricos acima.
