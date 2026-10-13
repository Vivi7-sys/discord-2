# Análise do Discord 2

Revisão inicial de 13/10/2026. Status consolidado: [revisão final](REVISAO-FINAL.md). Foram lidos todos os arquivos versionados de aplicação,
configuração e documentação, além das implementações relevantes dos SDKs instalados.
O repositório estava sem mudanças locais no início. CSS e estrutura visual foram
preservados. Nenhum commit ou push foi realizado.

## Problemas corrigidos

| Prioridade | Problema e impacto | Correção |
| --- | --- | --- |
| Alta | O Upstash retorna `success: true` quando o limitador expira. As rotas só verificavam `success` e permitiam operar sem a proteção pretendida. | `strictRateLimit` rejeita `reason: timeout`; criação, token e aquisição seguem respondendo 503 quando a proteção falha. Liberação autenticada mantém alternativa via LiveKit. |
| Alta | JSON era lido por completo antes de validar tamanho; uma foto, token ou corpo arbitrariamente grande podia consumir memória. | Leitura limitada em bytes, inclusive chunked e sem Content-Length: token 24.000, share 1.024, criação 4.096. Retornos 413/415/400 conforme o erro. |
| Alta | Captura/seletor pendente podia terminar após saída ou nova conexão e publicar/abrir áudio na sessão antiga. | Guarda por instância de sala, captura explícita, parada das trilhas ao sair e descarte de resultados tardios. |
| Alta | Falha parcial ao publicar vídeo e áudio não tinha rollback explícito do conjunto no código da aplicação. | Todas as trilhas são paradas e despublicadas em falha ou desconexão durante a publicação. |
| Média | Redis era criado na importação dos módulos de trava e reserva; falha de configuração escapava do tratamento das rotas. | Inicialização sob demanda, timeout por chamada de 5 s e sem retries automáticos. |
| Média | Operações LiveKit com failover podiam prolongar a região crítica; não se confirmava propriedade da trava antes de conceder publicação. | Timeout de 8 s, failover desativado nessa operação e conferência atômica de dono/TTL da trava antes da concessão. Não equivale a fencing transacional entre Redis e LiveKit. |
| Média | Eventos de despublicação de áudio e parada explícita podiam enviar liberações duplicadas. | Reação automática apenas à trilha de vídeo, exclusão da parada explícita e deduplicação de liberações em andamento por sala. |
| Média | Respostas assíncronas antigas podiam mudar estado/ocupação da sessão nova. | Token vinculado à instância; respostas e finalização de operações conferem a sala ativa. Captura virtual é removida por sua própria referência. |
| Média | Volume era aplicado só no elemento HTML e não reaplicado na troca de trilha; SDK pode usar ganho Web Audio ou redefinir propriedades em `attach`. | Uso de `RemoteAudioTrack.setVolume`, incluindo mute e dependência da trilha. |
| Média | Áudio automático de tela herdava os defaults de publicação, sem os ajustes musicais do modo virtual. | Preset musical estéreo, `forceStereo` e DTX desativado também na captura automática. |
| Média | A URL contém o convite e podia ser enviada como referrer; faltavam cabeçalhos contra enquadramento e MIME sniffing. | `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `nosniff` e `no-store` nas APIs. |
| Baixa | README e exemplo de ambiente omitiam quase toda a configuração atual. | Documentação atualizada, variáveis necessárias descritas e testes reproduzíveis. |

Não foram alteradas versões de dependências nem configurações reais de serviços externos.

## Segurança e disponibilidade pendentes

1. **Alta antes de exposição pública — acesso por link:** não há autenticação de
   pessoa, senha ou revogação individual. Os convites assinados evitam fabricação,
   mas não impedem repasse ou acesso por quem obteve o link. Requer decisão de produto
   sobre controle de acesso; não foi criado um fluxo visual novo nesta revisão.
2. **Média — TTL de token e recriação da sala:** token dura seis horas; a autorização
   da API share usa o token original, que não é renovado pelo código da aplicação.
   Após expiração, é necessário entrar novamente para adquirir/liberar via API.
   Além disso, o limite de seis é configurado na emissão: se a sala deixar de existir
   e um token ainda válido voltar a entrar, verificar em integração o comportamento
   de criação automática do LiveKit e suas opções. Não afirmar que o limite permanece
   garantido em toda recriação sem testar/configurar o serviço.
3. **Média — bloqueio por limites globais:** um visitante pode consumir os limites
   compartilhados e afetar todos os amigos. Acrescentar limite por IP confiável na
   borda/identidade, conservando teto global. Não confiar em X-Forwarded-For arbitrário.
4. **Média — reserva ociosa:** dono conectado com `canPublish` pode reter a vez sem
   transmitir. É comportamento atual; falta política de prazo/heartbeat e recuperação.
5. **Média — consistência distribuída:** Redis e LiveKit não participam de uma
   transação; timeout de atualização pode ter resultado incerto. A reserva e a checagem
   de trava reduzem corridas, mas não provam exclusividade sob todas as pausas/falhas.
   Validar com duas instâncias, falhas de rede e operações concorrentes; considerar
   coordenador único por sala ou mecanismo de fencing efetivo no serviço de mídia.
6. **Média — identificação de fonte virtual:** nome do dispositivo e confirmação no
   pavucontrol não provam a origem física. Manter escolha explícita e documentação;
   testar PipeWire/PulseAudio. Não foi adicionada captura automática de microfone.
7. **Média — dependências de desenvolvimento:** auditoria npm encontrou cinco alertas
   altos na cadeia `eslint-config-next -> @next/eslint-plugin-next -> fast-glob ->
   micromatch -> braces`. Um único problema raiz, não cinco falhas independentes na
   transmissão. O advisory de `braces <=3.0.3` informa ausência de versão corrigida.
   O downgrade sugerido pelo npm para eslint-config-next 14.2.35 não foi aplicado,
   pois incompatibiliza a linha atual de Next.js. Evitar padrões glob não confiáveis
   em ferramentas de lint e acompanhar a correção upstream.
8. **Média — infraestrutura:** configurar HTTPS, limites de corpo/tempo de upload e
   abuso na borda. O leitor limita memória, mas não substitui proteção de transporte
   contra clientes lentos. CSP exige inventário/teste de Turnstile, LiveKit e workers;
   não foi aplicada uma política que pudesse quebrar conexão/captcha.

## Desempenho e experiência: próximas melhorias

- **Medir antes de mudar codecs:** coletar `getStats` (bitrate, FPS, perdas, RTT,
  frames descartados e qualidade de conexão) para comparar os três presets.
  1080p/60 com simulcast pode consumir CPU e upload consideráveis; os bitrates atuais
  são metas/tetos de codificação, não garantia da qualidade nem do upload agregado.
- **Adaptar ao transmissor:** rebaixamento automático por CPU/rede e opção de content
  hint para texto versus movimento. Hoje `motion` e `maintain-framerate` favorecem
  jogos, com possível perda de legibilidade. Simulcast/adaptive stream já existem
  e foram preservados, pois ajudam espectadores com conexões/tamanhos diferentes.
- **Carregamento:** avaliar importação dinâmica do módulo de sala/SDK após envio do
  perfil. Não mudar carregamento visível sem revisar a experiência existente.
- **Safari/iOS e tela cheia:** validar autoplay, volume com Web Audio, reprodução após
  mute/unmute e troca de transmissor. O botão existente de ativar som fica fora da
  área que entra em fullscreen; se bloqueado nesse estado, pode exigir sair de tela
  cheia. Reposicionamento depende de autorização visual.
- **Acessibilidade:** autohide dos controles pode esconder foco/configurações/confirmacão
  de áudio. Preservar enquanto houver interação e testar teclado/touch; alteração
  de comportamento/apresentação do player deve ser revisada antes de mudar o visual.
- **Fotos:** processamento assíncrono de avatar pode ser sobreposto por eventos de
  arquivo; imagens muito grandes em dimensões também consomem memória na decodificação.
  Acrescentar controle de sequência e limites de dimensões num próximo ajuste.
- **Manutenção:** separar o componente de conexão em módulos de ciclo de sessão,
  publicação e recepção; acrescentar observabilidade sem registrar tokens, convites,
  fotos ou segredos. Nenhum segredo foi lido ou incluído neste relatório.

## Verificação

Validação final: `npm run lint` e `npm run build` aprovados; `npm test` com
24 testes aprovados. `npm audit --omit=dev --json`: zero alertas de produção.
A auditoria completa permanece com cinco alertas altos na cadeia de desenvolvimento. Os testes cobrem limites reais de bytes, chunks,
JSON inválido, timeout e erro do limitador, assinatura de convite, captura tardia,
publicação parcial, desconexão durante publicação e erro de limpeza.

O build precisou executar fora do sandbox: dentro dele, o subprocesso TypeScript
retornava saída vazia ao Next.js, embora o CLI executado diretamente funcionasse.
Nenhuma checagem TypeScript foi desabilitada.

A revisão posterior também confirmou os donos e TTLs da trava e da reserva
antes do grant e corrigiu a limpeza de áudio do navegador junto com o vídeo.
Veja [a revisão das correções](REVISAO-CORRECOES.md) para resultados atualizados.

**Limite:** não foi feita transmissão real entre dois navegadores, teste de áudio
com hardware/PipeWire, medição de CPU/latência, nem teste concorrente em LiveKit/Redis.
A validação automatizada usa doubles das operações de mídia; não prova o comportamento
real do SDK/browser nem o serviço distribuído.

Para validar em dispositivos reais: entrada tardia, troca de transmissor com volume
reduzido/mute, parada pelo navegador e pelo botão, cancelamento do seletor, saída com
seletor ou permissão de áudio aberta, reconexão e duas aquisições simultâneas. Testar
Chrome/Firefox/Safari em HTTPS e conferir ausência de captura residual após sair.

## Referências

- [Timeout do limitador Upstash](https://upstash.com/docs/redis/sdks/ratelimit-ts/features)
- [Compartilhamento de tela e áudio no LiveKit](https://docs.livekit.io/transport/media/screenshare/)
- [Volume por fonte no SDK LiveKit](https://docs.livekit.io/reference/client-sdk-js/classes/RemoteParticipant.html)
- [Advisory de braces, sem versão corrigida informada](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
