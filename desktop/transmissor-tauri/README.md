# Discord 2 Transmissor · Rust + Tauri 2

Candidato **0.2.0-alpha.1**, em `migration/windows-rust-tauri2`, derivado do estado Windows local `4690f05` (`build/windows-transmissor-0.1.2-beta1`). A etapa inicial foi registrada em `076f1b6`. A etapa atual usa GitHub CLI autenticado e envia exclusivamente a branch de migração para compilar em Windows x64.

**Migração ainda incompleta e sem validação de transmissão real em Windows.** Existe implementação Rust de captura/publicação e interface empacotada localmente, mas isso não equivale a binário Windows testado. O aplicativo Python anterior permanece em `../transmissor-windows`; não é chamado nem incluído pelo novo aplicativo. Linux, código do site, workflow Python, Render e releases não foram alterados.

## Executar e verificar

Windows 11 x64, Rust estável (dependências atuais exigem pelo menos 1.90), MSVC Build Tools com C++, Windows SDK, WebView2 e Node 24:

```powershell
cd desktop/transmissor-tauri
npm ci
$env:CARGO_BUILD_TARGET = 'x86_64-pc-windows-msvc'
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml --features desktop
npm run tauri -- dev
```

No Linux, `npm run dev` abre uma **prévia visual** com transmissão desativada. O núcleo de configuração e HTTP pode ser testado com `cargo test --locked --manifest-path src-tauri/Cargo.toml`; os módulos Windows não são executados nessa plataforma. Não há limitação de qualidade derivada do hardware Linux.

## Interface e comparação

- [Renderização desktop local no Chromium/Linux](evidence/linux-browser-desktop.png).
- [Referência publicada no Render, capturada em leitura](evidence/reference-render-site.png).
- [Site Next.js local, mesma árvore de código](evidence/linux-local-site.png).
- [Comparação dos tokens publicados com os tokens locais](evidence/published-css-comparison.json): oito correspondências exatas.
- [Tokens computados do site local](evidence/site-comparison.json).
- `src/site.css` é cópia integral de `../../src/app/globals.css`; `src/RoomIcon.tsx` é cópia integral do componente real do site. O teste de identidade compara os arquivos byte a byte.
- Fonte real: `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Nenhuma fonte remota ou família inventada foi adicionada. A renderização final de Segoe UI depende do Windows.
- Logotipo da barra usa o D2 e os estilos do site, com alinhamento flex para desktop. Os ícones do executável são derivados do SVG real `../../src/app/icon.svg` usando o CLI Tauri.
- Cartões, botões, foco, bordas, fundo e estados reutilizam as classes reais. `src/desktop.css` adapta a hierarquia para configuração de sessão, painel de estado, rolagem e controles persistentes.
- Animações limitam-se às transições do site; `prefers-reduced-motion` desativa movimento.
- Nenhuma imagem da documentação representa uma captura Windows. O endereço obrigatório `https://discord-2-kuau.onrender.com/` respondeu após nova tentativa. O HTML, CSS e a renderização publicada foram conferidos; a captura do site foi feita em Chromium/Linux, sem alterar o Render.

| Elemento                       | Site                  | Aplicativo                 |
| ------------------------------ | --------------------- | -------------------------- |
| Fundo                          | `#08090b`             | mesmo token                |
| Cartão / superfície secundária | `#121417` / `#1b1e23` | mesmos tokens              |
| Borda / raio                   | `#2b2e33` / `12px`    | mesmos tokens              |
| Texto / secundário             | `#f4f4f5` / `#a1a4ac` | mesmos tokens              |
| Acento / botão primário        | `#ef343d` / `#d92632` | mesmas regras reais        |
| Ícones                         | SVG `RoomIcon`        | mesmo arquivo              |
| Navegação                      | site e salas          | transmissão e diagnósticos |

## Implementação por etapa

| Etapa                                            | Código existente                                                   | Evidência disponível                                     |
| ------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Interface React/TypeScript e empacotamento local | `src/`, configuração Tauri 2 e CSP                                 | build local e testes Playwright                          |
| Configuração, autenticação e exclusividade       | `config.rs`, `backend.rs`                                          | testes Rust e servidor HTTP local de integração          |
| Captura WGC de monitor/janela                    | `native.rs`, enumeração de handles atuais                          | requer execução Windows                                  |
| Conversão de frames                              | BGRA com pitch → libyuv SIMD → I420; escala preserva proporção     | benchmark Windows implementado, não medido localmente    |
| Publicação LiveKit Rust                          | `session.rs`, H.264, `NativeVideoSource`, tracks de tela           | teste real preparado; ainda não executado                |
| Áudio WASAPI                                     | render loopback; incluir árvore por PID; excluir árvore do Discord | implementado, sem evidência de áudio real                |
| Iniciar/parar/reiniciar e fechamento             | comandos IPC e encerramento com liberação de sala                  | revisão local; testes de sessão reais pendentes          |
| GPU → encoder sem readback                       | não implementado                                                   | investigação em [NATIVE-PIPELINE.md](NATIVE-PIPELINE.md) |
| NVENC / AMD AMF / Intel Quick Sync               | preferência hardware do SDK; AMF/QSV próprios pendentes            | nenhum vendor validado neste ambiente                    |

O WebView não recebe pixels, PCM ou tokens. IPC transporta configuração, fontes e snapshots numéricos uma vez por segundo. Captura, conversão, filas, áudio, conexão e publicação ficam em Rust/SDKs nativos. Python, Qt, Tkinter e FFmpeg externo não são dependências do novo executável; o SDK LiveKit ainda depende de seu núcleo nativo C++/WebRTC.

## Áudio e falhas

`none` não cria captura nem track de áudio. `system` abre exclusivamente o dispositivo de **renderização**, em loopback compartilhado, preservando reprodução local. `application` usa `new_application_loopback_client(pid, true)` para incluir uma árvore de processos. `exclude` usa `false`, que na implementação WASAPI significa **excluir** a árvore, e não apenas excluir filhos. Não existe ativação de fonte de microfone ou fallback automático para áudio global.

A exclusão exige um único processo raiz chamado `Discord.exe`. Ausência, múltiplas raízes, erro de ativação ou mudança de árvore interrompem a sessão. Discord PTB/Canary, Discord no navegador e filhos que se desvinculam da árvore não estão cobertos. A checagem de alteração de processo é periódica: ainda precisa ser endurecida/validada antes de garantir exclusão durante reinícios, sem janela de vazamento. Não considerar esse modo pronto para produção até o ensaio de isolamento.

O token fica na memória Rust e não aparece na interface ou nos relatórios. HTTP usa HTTPS, rejeita redirecionamentos e valida o endpoint LiveKit WSS. A reserva `/api/livekit/share` é adquirida antes de capturar. Na falha, interrompe-se a captura, tenta-se liberar a reserva inclusive quando a resposta de aquisição é perdida e fecha-se a sala. Falha no encerramento nativo bloqueia outra sessão até fechar o aplicativo.

## Verificações locais

- Build TypeScript/Vite e contratos de identidade visual: aprovados.
- Sete testes Rust: quatro de configuração e três de integração HTTP com servidor local controlado; aprovados. Não conectam ao LiveKit real.
- Seis testes Playwright: interface, layout, áudio selecionado, assets locais, movimento reduzido e sequência de comandos/conflito com fixture IPC; aprovados. A fixture não produz frames nem prova execução Rust.
- `cargo check --lib --tests --target x86_64-pc-windows-gnu`: aprovado com cross compiler Zig e `DOCS_RS=1`, que omite a compilação da ponte C++ do WebRTC. Verifica tipos de WGC/WASAPI/LiveKit e dos testes Windows, mas não cria executável, não executa os testes e não verifica o binário Tauri/MSVC.
- Clippy do núcleo portátil e dos módulos/testes Windows em checagem cruzada: aprovados com `-D warnings`. A pilha RTC está fixada nas versões do lockfile oficial de LiveKit 0.7.53 para evitar incompatibilidades transitivas de tipos/protobuf.
- Sem resultados locais de benchmark de conversão Windows, captura, codificação ou publicação reais. Os testes e relatórios previstos não são apresentados como medições já realizadas.

## CI, instalador e evidências

Procedimento de validação física: [TESTE-WINDOWS-11.md](TESTE-WINDOWS-11.md). O pacote experimental é acompanhado de [EXPERIMENTAL.txt](EXPERIMENTAL.txt).

Workflow: [transmissor-rust-windows.yml](../../.github/workflows/transmissor-rust-windows.yml). Ele só roda na branch de migração e não contém publicação de release ou deploy.

O job Windows compila frontend, roda testes visuais e Rust, integração HTTP e benchmark sintético, compila a ponte C++/WebRTC e o Tauri com MSVC, tenta capturar a janela nativa, gera o NSIS experimental e verifica instalação/inicialização/desinstalação. O instalador não depende de validação física; seu nome e os relatórios deixam essa limitação explícita.

A execução opcional com `real_session=true` (dispatch, quando disponível) ou com a variável de repositório `D2_RUN_REAL_SESSION=true` em um push desta branch exige `D2_TEST_INVITE` de um ambiente de testes dedicado e um espectador ativo. A variável permite habilitar o ensaio por push sem adicionar o workflow ao `main`. Esse ensaio verifica captura WGC, entrega de frames/RTP e liberação da sala; não comprova áudio ou decodificação no receptor.

Comandos de captura real, sempre no diretório do aplicativo:

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml --test windows_capture -- --ignored
$env:D2_TEST_INVITE = '<convite de ambiente separado de testes>'
cargo test --locked --manifest-path src-tauri/Cargo.toml --test real_session -- --ignored
npm run tauri -- build --bundles nsis
```

O teste RTP não prova decodificação no receptor, áudio nem FPS sustentado. O desktop hospedado de `windows-2022` pode não disponibilizar WGC/GPU/áudio; esse resultado deve ser registrado como falha/indisponibilidade, nunca substituído por frames sintéticos e apresentado como captura real.

Quando gerado, o `.exe` ficará em `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/` e no artifact `discord2-rust-windows-evidence-<run_number>`, com checksum e relatórios. Execuções Windows em andamento: os primeiros builds identificaram MAX_PATH nos headers Abseil e incompatibilidade /MT versus /MD na ponte WebRTC; corrigidos com target curto e CRT estático consistente. Ainda não há instalador aprovado até o workflow completar. Nenhuma release foi criada.

## Aceitação em Windows 11 físico

Antes de substituir o aplicativo anterior: validar conexão com receptor independente, exclusividade entre dois transmissores, monitores e janelas incluindo fontes com dimensão ímpar, redimensionamento, minimização e fechamento; perfis 720p30/1080p30/1080p60 por 10 minutos; FPS real, quedas, latência e sincronização A/V; silêncio e isolamento por processo com sinais sonoros distintos; áudio local intacto; sem microfone; reconexão, stop em desktop parado, rede interrompida, troca de dispositivo e instalação/desinstalação.

Ensaiar NVIDIA, AMD e Intel separadamente, incluindo híbridos/iGPU+dGPU e HDR. Comparar contra o estado Windows anterior com a mesma fonte, cena, bitrate, receptor e drivers. Não há evidência ainda para afirmar ausência de regressão de desempenho, aceleração por hardware em todos os vendors ou migração final concluída.
