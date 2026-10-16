# Discord 2 Transmissor 1.0.0~rc1 — validação e entrega

Candidata Linux amd64 para Pop!_OS 24.04 / COSMIC Wayland. Não é uma declaração de distribuição estável 1.0. Nenhuma alteração de design/site/backend, push ou deploy foi realizada nesta finalização.

## Integração pública comprovada

Em 16/10/2026, a API de https://discord-2-kuau.onrender.com/ respondeu saúde 200, convite inválido 403 e release sem autenticação 401 (`results/PUBLIC-PREFLIGHT-*.json`).

`tests/lifecycle-real.mjs --public-owned` passou com a **API pública real e o SDK LiveKit nativo**: token 200, conexão, publicação de trilha de tela, segundo transmissor rejeitado com acquire 409 sem interromper o primeiro, Parar com release explícito, reinício, queda abrupta por SIGKILL do processo próprio, recuperação da vaga por outro transmissor e liberação final. Ao sair: zero participantes, reserva ausente, sala própria removida. Sem servidor local nesse teste público. O teste usa resolução 720p30 configurada mas não envia quadros ou áudio; não mede FPS nem valida reprodução. A mesma sequência passou separadamente com API local e SFU real, em outra sala própria.

Somente o processo pai de teste tem acesso às credenciais administrativas existentes, para criar/remover a sala própria e preparar seu convite assinado. O aplicativo filho recebe apenas convite/identificação e obtém token temporário pela mesma API existente. Nenhuma chave privada é incluída no aplicativo, pacote, parâmetros de processo filho, relatório ou commit. O modo `--public` do teste também aceita um convite normal de sala vazia por stdin, sem carregar as credenciais administrativas. Nenhum endpoint novo foi necessário: `/api/livekit/token` e `/api/livekit/share` já atendem o cliente nativo. Autenticação por convite assinado e bearer temporário, limite de seis participantes e reserva exclusiva permanecem sob controle do backend existente. Criar convites no site continua usando a proteção existente; não foi adicionado gerador de convites ao cliente.

## Mídia comprovada e limites

O usuário confirmou manualmente na versão instalada **0.1.1**: imagem e áudio real do fone USB chegaram ao celular pelo navegador e Parar liberou a vaga. A URL usada nessa sessão não foi registrada; isso não deve ser apresentado como teste automatizado da candidata no site público. Teste anterior separado com voz gravada reproduzida pelo paplay: monitor PCM estéreo 48 kHz, pico −6,06 dBFS, ganho 0 dB, sem saturação e sem alterar volume/mudo local.

A candidata preserva o pipeline validado GTK, portal/PipeWire, GStreamer e LiveKit. Perfis 720p30/1080p30/1080p60, sem redução silenciosa. Nenhuma nova otimização ou medição sintética de desempenho. O hardware atual não limita as opções disponíveis. Não há nova medição de FPS, latência fim a fim ou sincronização nesta rodada. Consultar RX550.md para medições históricas, sem extrapolá-las para outros computadores.

O monitor da saída padrão validada é oferecido ao abrir; escolhas manuais e Sem áudio são preservadas nas atualizações. Não se escolhe microfone. Reconfiguração inesperada de fonte interrompe a captura. O aplicativo não muda o volume, mudo, saída padrão nem roteia chamadas. Áudio das chamadas na mesma saída pode ser capturado, mesmo compartilhando só uma janela. Não há isolamento de eco por aplicativo garantido. Não silenciar os amigos; separar as saídas é uma opção explícita do usuário.

## Estabilidade e testes

- Build Next de produção passou, sem publicar. Suíte do site: 41 testes de segurança/captura e 11 regressões API passaram. Lint do projeto e do transmissor passaram.
- Transmissor: 32 testes Python, 4 de mídia/IPC Node e 1 de encerramento Node passaram. Regressões cobrem monitores reais, microfones/remaps, nomes nulos, seleção, IPC, memória compartilhada, timestamps, ganho e encerramento com liberação explícita.
- Erros têm mensagens fixas e úteis para convite inválido, vaga ocupada, autorização, indisponibilidade e queda de conexão, sem revelar mensagens cruas do SDK ou tokens. Liberação não confirmada é informada; a próxima aquisição verifica a ausência do transmissor no servidor. Não há captura/reconexão automática após queda.
- O novo teste de falha reproduz rejeição de `room.disconnect()`: trilhas, fontes e SDK ainda são fechados e o evento stopped é emitido. A suíte usa mocks nessa injeção; o teste de queda por SIGKILL usa SFU real. O teste GTK de fechar durante sessão usa sessão simulada, sem portal/mídia, e verifica aguardar o encerramento antes de sair.
- Pacote: extração sem instalar, imports Python, módulo nativo e SDK no Node do sistema, entrada desktop, perfis, GTK usando runtime extraído (dispositivos reais, hotplug simulado e fechamento durante sessão simulada). Instalação da 0.1.1, atualização para candidata e remoção verificadas em raiz dpkg descartável, sem modificar instalação do usuário. A raiz vazia usa fakeroot e ignora dependências apenas nesse teste. Separadamente, `apt-get --simulate install` no sistema real aprovou atualizar 0.1.1 para 1.0.0~rc1, com zero pacotes adicionais e zero remoções. A instalação real da candidata ainda exige validação humana. A 0.1.1 já foi instalada e usada pelo usuário.

Os resultados JSON são individuais em `results/`, sem mídia, tokens ou convites. Tentativas que falharam foram preservadas: uma falha de rede no sandbox e duas tentativas locais rejeitadas com token 503 devido ao identificador de namespace do novo teste ter tamanho incorreto. O teste foi corrigido para os 32 hexadecimais exigidos pelo backend, sem alterar a segurança de produção, e passou. A ausência de permissões IPC no sandbox também exigiu executar o teste Node de encerramento fora dessa restrição.

## Pacote e critérios obrigatórios antes de chamar de estável

Artefato: `desktop/transmissor/dist/discord2-transmissor_1.0.0~rc1_amd64.deb`.

Menu Aplicativos e ícone D2; dependências declaradas; sem NVM, servidor de testes, arquivos temporários de desenvolvimento, credenciais ou compilação em tempo de execução. SDK 1.1.0 fixado e bibliotecas de terceiros incluídas com suas licenças. A resolução apt usa dependências do sistema, incluindo o plugin PipeWire e o portal COSMIC compatível.

1. Instale a candidata conforme README, feche a janela antiga e abra pelo menu.
2. Crie uma sala no site público, cole o convite, nome e escolha monitor USB. No celular, entre no mesmo convite e confirme imagem legível, áudio real audível e sincronizado. Use 720p30 ou 1080p30 conforme a máquina; 1080p60 é opcional para hardware capaz.
3. Pare e reinicie. Feche durante transmissão. Confirme que outro transmissor consegue adquirir a vaga. Se possível, teste desconectar/reconectar a rede e cancelar o portal, sem assumir retomada automática.
4. Registre o resultado humano e problemas. Só então promova a versão candidata para 1.0.0, regenere/verifique o pacote e, com autorização, publique o artefato e o commit. Push e deploy são ações separadas e não foram executados.

Desinstalar com `sudo apt remove discord2-transmissor`; diagnósticos privados na pasta do usuário são preservados deliberadamente. O teste de desinstalação não apaga arquivos pessoais.
