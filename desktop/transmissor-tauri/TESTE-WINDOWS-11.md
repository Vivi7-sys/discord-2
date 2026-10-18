# Ensaio autorizado em Windows 11 físico

O instalador desta branch é **experimental**. Compilar, instalar e abrir no runner não comprova captura, isolamento de áudio, publicação ou fluidez em um computador físico. Este ensaio não usa microfone e não exige compartilhar credenciais pelo chat.

## Preparação e instalação

1. Baixe o `.exe` e seu SHA-256 do mesmo artifact/commit do GitHub Actions. Confira com `Get-FileHash .\<instalador>.exe -Algorithm SHA256`.
2. Use Windows 11 x64 atualizado, driver de vídeo do fabricante, saída de áudio ativa e WebView2. Registre build do Windows, CPU, GPU, driver, resolução, escala e taxa de atualização dos monitores.
3. Instale o candidato em ambiente autorizado. Por não ser uma release assinada, o Windows pode solicitar confirmação de procedência. Confira o artifact e o hash antes de prosseguir.
4. Abra o Discord 2 Transmissor. Verifique D2, preto/vermelho, tipografia Segoe UI, textos legíveis, seleção por teclado e controles visíveis em 1120×820 e 740×600, inclusive com escala de 125% e 150%.
5. Abra uma sala de testes separada e mantenha um espectador em outro computador. Não use uma sala de terceiros. Guarde o convite apenas localmente; relatórios não devem conter convite ou token.

## Conexão e exclusividade

1. Cole o convite HTTPS completo, informe um nome e selecione uma fonte.
2. Selecione **Sem áudio** na primeira tentativa e **720p / 30 FPS**.
3. Clique em **Iniciar transmissão**. Confirme conexão, imagem correta no espectador e métricas de captura/codificação/publicação. Uma chamada à fonte não prova envio RTP; envio RTP não prova decodificação no espectador.
4. Tente iniciar um segundo transmissor na mesma sala. Ele deve receber conflito de exclusividade e não iniciar captura/publicação concorrente.
5. Pare o primeiro transmissor. Confirme a liberação em diagnósticos e que o segundo consegue iniciar depois.

## Vídeo e perfis

Teste **monitor e janela** separadamente nos três perfis: 720p30, 1080p30 e 1080p60. Use uma cena com movimento contínuo e um contador/relógio visível por dez minutos em cada combinação. Uma tela parada não prova nem reprova FPS sustentado: WGC pode emitir somente alterações.

Registre FPS capturados, codificados e enviados, frames entregues à fonte, descartes, processamento em ms, encoder observado, CPU e GPU Video Encode. No espectador, registre FPS decodificados, perdas, congelamentos e latência. Não atribua aceleração a NVENC/AMD/Intel apenas porque foi solicitada a preferência `Hardware`; confira o encoder observado e a atividade de hardware.

Redimensione e minimize a janela capturada, feche-a, troque de monitor e teste dimensões ímpares. O aplicativo deve manter proporção, encerrar em perda da fonte e apresentar erro útil. Teste HDR e máquinas com GPU híbrida separadamente. O caminho atual ainda usa readback e conversão CPU; zero-copy, AMF e Quick Sync próprios permanecem pendentes.

## Áudio sem capturar microfone

Use três sinais identificáveis: música no aplicativo A, som no aplicativo B e som reproduzido pelo Discord. Um espectador deve identificar exatamente quais sinais chegam. Não use a voz como único sinal de teste.

- **Sem áudio:** nenhum dos sinais deve chegar ao espectador.
- **Somente um aplicativo:** selecione o processo A. Somente A e seus filhos devem chegar; B e Discord devem permanecer ausentes. A reprodução local continua intacta.
- **Todo o áudio do sistema:** confirme todos os sinais da saída de reprodução selecionada, com reprodução local intacta.
- **Sistema excluindo o Discord:** A e B devem chegar, Discord deve permanecer ausente. Esse modo exige uma única árvore `Discord.exe`; PTB/Canary e Discord no navegador não estão cobertos.

Feche o aplicativo selecionado, reinicie o Discord, abra múltiplas instâncias e troque o dispositivo de reprodução. Uma falha de isolamento deve encerrar a sessão com erro, sem selecionar áudio global como alternativa. A checagem atual de processos é periódica: **o comportamento durante reinício e eventual janela de vazamento continuam sem validação**. Interrompa o ensaio caso chegue áudio excluído. Confirme também que nenhuma entrada/microfone foi ativada pelo transmissor.

Use um vídeo local com flashes e cliques sincronizados para avaliar atraso A/V no espectador no início, aos cinco e aos dez minutos. Registre drift, interrupções e latência aproximada; números de conversão sintética não substituem esta medição.

## Parada, reinício e falhas

1. Pressione **Parar** durante movimento e com desktop parado. A captura deve encerrar sem depender de um novo frame, liberar a reserva e permitir nova sessão.
2. Pressione **Reiniciar** cinco vezes, aguardando cada operação. Não deve haver transmissões duplicadas, áudio acumulado ou crescimento contínuo de memória.
3. Pare durante conexão e feche a janela do transmissor durante uma sessão. Confira a liberação da sala e ausência de processo remanescente.
4. Interrompa e restaure a rede. Confirme erro claro, encerramento e nova tentativa sem contornar a exclusividade.
5. Desinstale o candidato. Confirme remoção do executável e preserve o transmissor anterior até a aprovação deste ensaio.

## Registro de resultados

Para cada combinação, registre commit, artifact, Windows/GPU/driver, fonte, perfil, modo de áudio, duração, métricas, comportamento visto/ouvido no receptor, tempo de parada/reinício e resultado **aprovado / reprovado / não testado**. Capture a janela real no Windows e compare com `evidence/reference-render-site.png`.

O teste automatizado `real_session` exige convite de ambiente dedicado e receptor ativo. O segredo `D2_TEST_INVITE` pode ser configurado diretamente na interface segura do GitHub. Não coloque convite, tokens ou credenciais em issues, logs, comandos compartilhados ou chat. A compilação e o pacote experimental não dependem desse teste opcional.
