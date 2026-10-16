# Correção de enumeração de áudio — 16/10/2026, pacote 0.1.1

O usuário relatou que a janela instalada mostrava HDMI e Discord2-GTK-Test, mas não o monitor USB. A instalação existente tinha a mesma enumeração do projeto: consulta única na construção da janela, filtragem por sufixo `.monitor` e uso direto de `description`; erros eram ignorados. Isso deixava o menu desatualizado depois de mudanças de dispositivos, sem botão de atualização nem mensagem de falha.

Na consulta desta sessão, o Pulse apresentou o monitor USB e a saída correspondente, ambos com descrição `(null)`. O nome amigável `USB PnP Audio Device` estava nas propriedades `device.description`. A saída USB era o resultado de `pactl get-default-sink`. O estado observado foi SUSPENDED; estar RUNNING não é necessário para oferecer um monitor válido. A enumeração antiga não omitiu o USB nessa consulta; portanto, não foi comprovada uma rejeição específica do USB pelo filtro antigo. Os avisos `Invalid non-ASCII character` do pactl persistem mesmo com `LC_ALL=C.UTF-8`; o fallback de nomes não depende da descrição problemática.

## Comportamento corrigido

- Cruzamento entre fontes e saídas reais, por nome ou índice (inclusive índice zero e referências em texto). Aceita os campos `monitor_source` e `monitor_of_sink` da fonte; confere o vínculo inverso quando fornecido pela saída. Um nome terminado em `.monitor` sozinho não concede permissão de captura. Fontes de microfone, remaps sem vínculo de saída e vínculos contraditórios são rejeitados. Monitores de saída com nome não convencional também são aceitos quando o vínculo é válido.
- Mesma regra na listagem e na inspeção de segurança antes de capturar. A conferência `current-device`, o bloqueio de fallback/reconexão e a interrupção por mudança inesperada permanecem.
- Nomes amigáveis com fallback de descrição para propriedades e nome técnico; descarta descrições vazias, nulas e `(null)`. Desambigua nomes iguais. Mostra todos os monitores válidos, inclusive saídas virtuais e dispositivos suspensos, sem filtro por RUNNING.
- Atualização ao abrir o seletor, receber foco, clicar no novo botão e antes de iniciar. Consultas pactl têm timeout. Falha da consulta fica visível e desativa a seleção; dispositivos removidos também resultam em Sem áudio. Uma sessão ativa não consulta nem troca sua fonte.
- Na abertura normal, oferece o monitor validado da saída padrão, marcado `(padrão)`. Não há captura automática. Uma escolha manual, inclusive Sem áudio, não é substituída em atualizações ou mudanças da saída padrão. Se não houver saída padrão válida, usa Sem áudio; nunca usa a entrada padrão. O roteiro de validação isolado continua inicialmente em Sem áudio.

## Validação

- 30 testes Python e 4 testes Node passaram. Incluem USB com descrição nula, fontes remapeadas/falsas, índices zero/texto, falha ao consultar saída padrão, monitores suspensos e nomes repetidos.
- Teste gráfico `tests/gtk-audio-smoke.py`, com enumeração real: USB apareceu como **USB PnP Audio Device — áudio da saída (padrão)** e HDMI também apareceu. Microfone USB e `screen_share_audio` não apareceram. Sem captura ou transmissão.
- No mesmo teste GTK, hotplug e falha de consulta foram simulados: escolha manual preservada, desconexão e erro desativam áudio, sessão ativa impede consulta/troca. Isso não substitui um teste de desconectar fisicamente o USB durante uma captura.
- Teste real isolado `tests/audio-guard.py`: troca forçada da fonte de gravação detectada, captura interrompida e sinal da outra saída não aceito (pico permaneceu 1638); módulos próprios removidos. Não usa microfones.
- Uma repetição da suíte expôs falha intermitente no encerramento IPC: `stop()` podia enviar SIGTERM de novo durante o encerramento já em andamento. O envio agora é único, protegido por lock, com teste de regressão. A suíte foi repetida após essa correção.
- Pacote 0.1.1 gerado e extraído para teste, inclusive GTK usando os arquivos extraídos; SDK e addon nativo carregam no Node do sistema, entrada desktop validada e perfis 1080p/30 e 1080p/60 preservados. A instalação anterior não foi substituída automaticamente.

Atualize pela raiz do projeto:

```sh
sudo apt install ./desktop/transmissor/dist/discord2-transmissor_0.1.1_amd64.deb
```

Feche a janela antiga e reabra pelo menu Aplicativos. O USB deve aparecer com nome amigável e indicação de padrão; use Atualizar saídas de áudio se necessário. Nenhum dispositivo de reprodução, volume, chamada ou saída padrão foi reconfigurado pela correção. GTK, GStreamer, LiveKit e perfis de qualidade mantidos. Sem alterações no site, commit, push ou deploy.
