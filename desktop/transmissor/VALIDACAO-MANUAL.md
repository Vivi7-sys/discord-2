# Validação real do Discord 2 Transmissor

## Começar

Na raiz do projeto:

```bash
npm run validate:desktop --prefix desktop/transmissor
```

O comando abre o **GTK real**, já com convite/nome preenchidos, e uma janela de
referência visual. No terminal aparece a URL de uma sala temporária do **site
Discord 2 existente, servido localmente**. Abra essa URL no seu navegador normal,
entre como espectador e habilite o som. Não é preciso flag experimental de captura.
O navegador só recebe a mídia; quem captura é o aplicativo GTK pelo portal/PipeWire.

No GTK:

1. Escolha **Janela**, mantenha **1080p / 30 FPS** e **Sem áudio** no primeiro teste.
2. Clique **Selecionar e iniciar** e selecione **Discord 2 — referência visual**
   no diálogo do COSMIC. Nada é capturado antes da sua autorização.
3. Observe a transmissão no site. Ao terminar, clique **Parar** no GTK.
4. Aguarde no terminal **Vaga verificada livre** antes de iniciar novamente.
5. Para terminar tudo, feche a janela principal do GTK ou pressione Ctrl+C no
   terminal. O teste encerra seus processos, apaga sua sala e salva um relatório
   novo em `desktop/transmissor/results/GTK-MANUAL-….json`.

Os perfis 1080p30, 1080p60 e 720p30 permanecem disponíveis, com os tetos anteriores.
Comece com 1080p30; se quiser avaliar a opção leve neste PC, **selecione 720p30
explicitamente**. Não há troca automática de qualidade. Não é necessário ensaiar
1080p60 neste computador para aprovar o funcionamento básico.

## O que conferir

| Etapa | Ação | Resultado esperado / o que anotar |
|---|---|---|
| Imagem | Observe barras, texto pequeno, barras finas e bloco em movimento no site. | Cores corretas, texto legível, imagem inteira, proporção correta, ausência de quadro preto/verde ou congelamento. Anote defeitos e FPS mostrados no GTK. |
| Latência visual | Compare o relógio da referência com o relógio recebido no site. | Anote três diferenças **origem menos recebido**. Uma foto simultânea de ambos pode ajudar a ler. É estimativa visual, não medição precisa de milissegundos. |
| Áudio | Pare; escolha explicitamente o monitor **Discord2-GTK-Test**. Inicie novamente e clique no botão de bip da referência. | Bip audível localmente e no site. Ganho inicial 0 dB; não mudar volume do sistema para mascarar um defeito. Anote se só é ouvido localmente, se fica baixo, distorcido ou cortado no site. |
| Sincronismo A/V | Use um clipe local conhecido, com fala/claquete, que já esteja sincronizado localmente. Capture a janela do reprodutor e o monitor Discord2-GTK-Test; envie apenas esse reprodutor para a saída Discord2-GTK-Test no mixer do sistema. | Compare boca/gesto e som no site. Anote qual chega antes e aproximadamente quanto. O bip da referência **não** é um marcador A/V calibrado. |
| Janela | Compartilhe só a referência e mova uma janela diferente sobre ela. | Confira o conteúdo efetivamente exibido. Não presuma que o backend COSMIC oculte oclusões; registre o que acontecer. |
| Tela | Pare, selecione **Tela**, inicie e escolha a tela desejada no portal. Se houver várias, repita com outra. | O site deve mostrar exatamente a tela autorizada. Evite expor conteúdo pessoal. Não deve haver troca automática de tela. |
| Cancelamento | Clique iniciar e cancele no seletor do COSMIC. | Volta a Parado, sem publicar nem ocupar vaga; deve ser possível tentar novamente. |
| Parada | Com transmissão ativa, clique Parar. | Vídeo/áudio deixam de avançar no site; o indicador de captura do sistema desaparece; vaga livre é confirmada no terminal. |
| Fechar a janela capturada | Durante o compartilhamento de Janela, feche a referência. | Confira se a captura para e libera a vaga. Se o site congelar e o GTK continuar transmitindo, use Parar e registre a falha; esse comportamento ainda depende de verificação real do backend COSMIC. |
| Reinício | Faça três ciclos de iniciar/parar, aguardando a vaga livre. | Novas seleções funcionam, sem reaparecer mídia antiga ou acumular streams de captura. |
| Exclusividade | Com a primeira transmissão ativa, digite **segundo** no terminal. Tente iniciar no segundo GTK, usando a referência. | O segundo é recusado pelo backend; o primeiro continua. Feche o segundo GTK. Pare o primeiro e teste novamente se necessário. |
| Fechar ativo | Feche a janela principal do GTK durante a transmissão. | Captura interrompida, publisher encerrado, vaga conferida e sala temporária removida. |
| Fechar durante seleção/conexão | Em outra execução, feche o GTK enquanto o portal ou a conexão estiverem pendentes. | Seletor/captura encerrados; processo sai e o supervisor limpa a sala. Anote demora ou erro. |

O mesmo computador roda captura, encoder, backend local e navegador neste ensaio;
isso pesa na fluidez. Fonte menor que 1920×1080 pode ser redimensionada para a
saída escolhida: isso não cria detalhe 1080p na origem. Os caps reais de entrada
ficam no diagnóstico. O tamanho informado pelo portal usa coordenadas do
compositor e pode diferir do número de pixels capturados.

**Áudio:** o menu só oferece monitores de saída. O roteiro isolado inicia em Sem áudio. Na abertura normal, o aplicativo oferece o monitor validado da saída padrão, mantendo escolha manual. Selecionar
uma janela não restringe o áudio àquela janela: o monitor inclui tudo daquela
saída, inclusive chamadas. O supervisor cria uma saída temporária Discord2-GTK-Test e um loopback para a saída
local atual. Só o bip da referência é enviado automaticamente a ela; o navegador
permanece na saída normal e seu áudio não volta à captura desse monitor dedicado.
O teste não move outros aplicativos, não muda volume/mute/default do sistema e
não cria captura de microfone. Seus dois módulos são removidos ao encerrar.

Para o clipe de sincronismo, envie **apenas o seu reprodutor** para essa saída pelo
mixer de áudio; não mova chamadas nem navegador. Se isso não estiver disponível,
deixe sincronismo pendente. Capturar a saída física enquanto o espectador toca
nela causa realimentação digital, mesmo com fones; não use esse arranjo para julgar
volume ou A/V. O loopback de reprodução local também acrescenta alguma latência;
o roteiro é avaliação humana aproximada, sem precisão de instrumento.

## Relatórios e confirmação da vaga

O GTK tem **Salvar diagnóstico da última sessão** após Parar. Ele salva apenas
configuração de qualidade, contadores, caps de mídia, tempos de etapas, resultado
da liberação e estado de fechamento dos recursos. Não salva vídeo, PCM, convite,
nome, token, SDP ou segredo LiveKit. Os arquivos são novos e privados (0600).

O modo manual também recolhe diagnósticos de cada ciclo automaticamente. Depois
de cada parada ele consulta o backend/LiveKit para conferir publicadores e reserva.
Se o outro GTK ainda estiver transmitindo, a vaga naturalmente continuará ocupada;
esse estado é registrado, não forçado a livre. Aguarde a mensagem antes de reiniciar.

O relatório mantém `humanAssessment=pending` e `validationComplete=false`:
**a existência do arquivo ou quadros publicados não aprova nitidez, volume,
sincronismo ou latência**. Anote os resultados da tabela junto ao nome do relatório.
Se houver falha, informe: etapa, perfil escolhido, Tela/Janela, som local/no site,
comportamento observado e nome do arquivo JSON. Não é necessário enviar frames
ou gravações pessoais para investigar contadores.

Para usar o aplicativo normal com convite já existente, sem o supervisor de teste:

```bash
npm start --prefix desktop/transmissor
```

Nesse modo, Parar libera a transmissão e preserva a sala; só o supervisor de teste
apaga a sala temporária que ele criou. Para outro teste isolado, execute novamente
`validate:desktop`; ele gera uma nova sala. Uma sala vazia de teste pode expirar se
você aguardar muito tempo antes de entrar como espectador.

## Preparação e limitações conhecidas

`npm run check:desktop --prefix desktop/transmissor` faz uma pré-verificação sem
abrir captura: plugins, sessão Wayland, portal e tipos de fonte anunciados.
É necessário ter as dependências do README e o build **local** já existente do site.
O supervisor não faz build, commit, push, deploy ou alterações no site em produção.
Ele usa o backend atual com convites assinados, autenticação, limite de seis e
controle exclusivo. Credenciais ficam no supervisor/servidor local, nunca no GTK
ou no publisher. O servidor do site escuta apenas em `127.0.0.1`.

Nesta sessão o plugin oficial `gstreamer1.0-pipewire` foi extraído, sem instalação,
em `/tmp/discord2-gtk-plugin/extracted`. `launch.py` encontra esse diretório enquanto
existir. Após reiniciar/limpar `/tmp`, instale os pacotes do README ou forneça
`GST_PLUGIN_PATH`; o launcher falha antes de criar uma sala se faltar o plugin.
A aplicação não baixa nem instala dependências automaticamente.

O seletor ainda usa `parent_window` vazio e pode não ficar associado à janela GTK.
A escolha é sempre pelo portal; seu resultado é conferido antes de abrir o remoto
PipeWire. Um tipo diferente do solicitado ou quantidade inesperada de streams é
recusado. Quando o portal não informa o tipo, o diagnóstico registra ausência,
sem inventar confirmação. Fonte: [contrato oficial ScreenCast](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html).

## Executado nesta rodada

- Pré-verificação real: portal COSMIC v5, tipos Tela/Janela anunciados, plugins
  PipeWire/GStreamer e memória compartilhada disponíveis.
- GTK e referência visual abriram, desenharam e fecharam, com áudio desligado por
  padrão. **Não houve captura nesse smoke test.**
- Supervisor criou uma sala real, abriu o GTK e limpou tudo após interrupção;
  nenhum publicador/reserva restou, sem SIGKILL. A saída/loopback temporários
  também foram removidos e volume/mute da reprodução local ficaram iguais. **Não houve seleção, publicação
  de mídia nem espectador nesse ensaio de preparação.**
- Passaram 24 testes Python e quatro Node, lint e compilação Python.
- Testes automatizados cobrem IPC/fechamento, cancelamento antes de publicar,
  confidencialidade do diagnóstico e escolha incompatível de fonte, além das
  regressões de mídia existentes.

A captura real de desktop, qualidade vista no site, áudio audível, A/V e latência
ainda precisam da execução manual acima. Os ensaios sintéticos das sessões
anteriores ficam separados e não substituem essa validação.

Relatório da preparação com áudio dedicado: [GTK-MANUAL](results/GTK-MANUAL-2026-10-16T17-37-03-303Z-f727b4e0.json). Esse arquivo tem zero sessões de captura e não é evidência de reprodução de mídia.
