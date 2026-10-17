# Discord 2 Transmissor — Linux 1.0.0

GTK nativo para Pop!_OS 24.04 / COSMIC Wayland. **1.0.0 estável**, com instalação pelo menu e imagem/áudio reais recebidos no celular pelo navegador do Discord 2 público, confirmados manualmente na candidata. Esta versão preserva o mesmo código de transmissão.

1. Na raiz do projeto, instale ou atualize: `sudo apt install ./desktop/transmissor/dist/discord2-transmissor_1.0.0_amd64.deb`.
2. Feche a versão anterior e abra **Discord 2 Transmissor** no menu Aplicativos (ícone D2).
3. Crie uma sala em https://discord-2-kuau.onrender.com/ e cole o convite completo no aplicativo. Informe seu nome.
4. Escolha Tela/Janela, 720p30/1080p30/1080p60 e o áudio: saída padrão validada, outra saída ou **Sem áudio**. Clique **Selecionar e iniciar** e autorize a captura no portal.
5. Os espectadores entram pelo convite no navegador, inclusive no celular. Clique **Parar** para encerrar e liberar a vaga; fechar a janela também solicita encerramento.

Nada é capturado antes de iniciar. Microfones não são oferecidos. O aplicativo preserva a reprodução local; **chamadas que tocam na mesma saída podem entrar na transmissão**, mesmo ao compartilhar só uma janela. Não há isolamento de eco garantido. Separe as saídas se precisar excluir chamadas; não silencie os participantes. Evite o próprio espectador na saída capturada.

Convite inválido: obtenha outro no site. Vaga ocupada: aguarde quem transmite parar. Falha de rede: a captura encerra; confira a conexão e inicie novamente. Se a liberação não for confirmada, o servidor verificará a presença do transmissor na próxima tentativa. Não há reconexão ou captura automática. **Atualizar saídas de áudio** atualiza dispositivos sem substituir uma escolha manual.

Desinstalação: `sudo apt remove discord2-transmissor`. Diagnósticos opcionais ficam em `~/.local/state/discord2-transmissor/diagnostics`, com permissões privadas. [Resultados de validação](VALIDACAO-1.0.md), [dependências e instalação](INSTALACAO.md), [validação manual isolada](VALIDACAO-MANUAL.md).
