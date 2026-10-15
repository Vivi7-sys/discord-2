# Correções da auditoria — Discord 2

Escopo: parada durante áudio Linux pendente, teclado/autohide, isolamento de
cotas e reservas após falha de concessão. Preservadas as alterações pendentes
anteriores de 1080p60, o padrão 1080p30, os demais perfis, o modal e o favicon.
Entrega em um único commit local, sem push, deploy ou alteração de variáveis de produção.

## Captura e controles

A autorização Linux é uma tarefa independente: não mantém a transmissão
ocupada. A parada interrompe as trilhas antes de esperar despublicação/HTTP.
Identificadores de geração invalidam enumeração, captura e publicação antigas
após parada, revogação, saída ou nova transmissão na mesma sala. Resultados
tardios são parados sem publicação; operações antigas não liberam o estado de
ocupação de uma operação nova. Parar também permanece disponível enquanto uma
publicação de áudio já confirmada aguarda o SDK.

getUserMedia não fornece cancelamento portável do diálogo de permissão. O app
invalida a solicitação, mas o navegador pode manter o diálogo aberto; se o usuário
responder depois, qualquer trilha retornada é imediatamente parada e descartada.
A fonte continua limitada ao dispositivo virtual explicitamente identificado.

O CSS de ocultação foi consolidado. A área do player participa da navegação por
Tab, revela controles por foco/tecla e mantém a barra visível enquanto houver
foco de teclado nela ou na área do player. Foco de mouse não trava a ocultação. O temporizador de 3 s, mouse e toque continuam funcionando;
confirmação de fonte virtual impede ocultação. Outline só aparece com foco visível.

## Limitação distribuída sem confiar em IP fornecido pelo cliente

- Token: formato, foto e assinatura do convite são verificados antes de consumir
  cotas. Sala (20/min) é limitada antes do global de emissão (60/min).
- Share: JWT/sala são verificados antes de consumir cotas. Identidade (12/min)
  é limitada antes do global de aquisição (120/min). Liberação autenticada
  permanece disponível mesmo com cotas excedidas ou Redis indisponível.
- Criação: somente Turnstile confirmado consome os 10 convites/minuto.
  A verificação tem proteção Redis separada: uma tentativa por hash SHA-256
  do desafio a cada 5 min e orçamento global de capacidade de 600/min.
  Tokens brutos não são gravados nos identificadores do limitador. Uma operação
  Lua atômica verifica replay e capacidade antes de criar o registro do desafio;
  pedidos acima do orçamento não criam novas chaves temporárias.
- Removidos contadores locais globais que eram drenados por dados inválidos.
  As cotas continuam compartilhadas entre instâncias via Redis e falham fechadas.
  Nenhum cabeçalho X-Forwarded-For, CF-Connecting-IP ou similar é usado.

Essas cotas não garantem disponibilidade sob DDoS volumétrico. Muitos desafios
inválidos distintos ainda podem ocupar o orçamento separado de verificação;
isso limita chamadas ao Cloudflare, sem consumir a cota de emissão. Limites de
conexão/corpo e proteção de tráfego na borda continuam necessários. Não foi
configurada uma origem de IP confiável nem alterada infraestrutura nesta etapa.

## Reservas e resultados ambíguos

Antes do RPC, é gravado no Redis um marcador `:pending` do mesmo dono. O lease é
conferido antes e depois desse passo. A reconciliação antiga por idade não remove
reservas marcadas, mesmo que uma leitura atual indique viewer: o RPC anterior
pode continuar em voo. O marcador tem TTL de segurança; a comparação de dono
continua atômica em Lua.

- ACK de sucesso: conservar reserva e limpar marcador.
- Resposta perdida, mas canPublish confirmado por nova leitura: retornar sucesso
  e conservar reserva.
- Rejeição terminal explícita do SDK (4xx/código conhecido), sem tentativa anterior
  incerta, mais confirmação de ausência/viewer sem trilhas de tela e lease válido:
  liberar condicionalmente reserva e marcador.
- Timeout, 5xx, reconsulta indisponível, estado desconhecido ou tentativa anterior
  incerta: manter reserva. A resposta informa reservationHeld e o cliente oferece
  Cancelar vez sem fingir que há permissão para iniciar captura. Se a resposta
  HTTP inteira se perder, o cliente também mantém essa possibilidade de liberação.
- Liberação autenticada revoga no LiveKit antes de limpar Redis; se a limpeza
  falhar, informa reservationHeld e mantém Cancelar vez para repetir. Saída do dono
  permite a recuperação existente por presença. A limpeza do teste real inclui
  também a nova chave, sem scan nem remoção de recursos públicos.

Uma reserva incerta pode exigir nova tentativa do dono, Cancelar vez ou saída da
sala; não é liberada automaticamente só porque ficou antiga. Redis e LiveKit não
formam uma transação distribuída. Pausas arbitrárias de processo e RPCs tardios
entre serviços continuam sem uma garantia formal de fencing no LiveKit; esta
correção não promete consistência absoluta nessas condições.

## Testes e pendências

- `npm test`: testes unitários/de fronteira e regressões HTTP dos handlers reais,
  com doubles de Redis/LiveKit/Turnstile. Não acessa serviços externos.
- `npm run test:ui`: modal e regressões React/DOM (jsdom), incluindo captura
  tardia, reinício, parada durante enumeração/publicação, revogação/desconexão,
  estado de reserva incerta e CSS/teclado/mouse/toque. Requer jsdom@26.1.0 no
  caminho externo já usado pelo projeto; aceita DISCORD2_JSDOM_MODULE.
- `npm run lint` e `npm run build`: verificação estática e build de produção.
- Integração real é separada (`node scripts/integration-real.mjs`), usando apenas
  sala aleatória assinada, metadata própria e cotas isoladas. O relatório bruto
  sanitizado fica em INTEGRACAO-REAL-RESULTADOS.json.

Ainda dependem de validação humana: diálogo nativo de permissão Linux/PipeWire,
Tab/Shift+Tab em navegador real, leitor de tela, tela cheia, toque e reconexão.
Acesso HTTP em sessão acima de 6 h, leitor de corpo sem prazo, onboarding da
fonte Linux, aviso de áudio por regex, convite sem expiração e outros pontos
médios/baixos da auditoria continuam fora deste escopo.


Resultado da implementação: 38 testes unitários/de fronteira, 11 regressões das
APIs, dez regressões React/DOM e o harness do modal aprovados; lint e build
aprovados. Os onze cenários de integração real também passaram, incluindo recepção
de áudio/vídeo, orçamento de verificação concorrente com Redis real e limpeza
confirmada da sala e das chaves privadas de transmissão/verificação.
Execuções no sandbox apresentaram falha de leitura de --showConfig. A causa foi
isolada: processos Node filhos retornavam saída vazia até em um teste mínimo.
O build final fora do sandbox passou com TypeScript habilitado, sem alterar
configuração ou desabilitar verificações.

Revisão final em 15/10/2026: build com TypeScript, lint, 38 testes unitários/de
fronteira, 11 regressões HTTP, dez regressões React/DOM e harness do modal
novamente aprovados. Nesta revisão o build passou no sandbox. Dependências dos
harnesses instaladas somente em `/tmp/discord2-integration`, sem alterar o lockfile.
Integração real repetida: onze cenários aprovados, incluindo áudio/vídeo WebRTC,
recuperação após queda e limpeza confirmada dos recursos isolados. Relatório
sanitizado atualizado em `INTEGRACAO-REAL-RESULTADOS.json`.
Os 22 arquivos pendentes foram revisados quanto ao escopo, arquivos temporários,
padrões de credenciais e valores sensíveis do ambiente, sem ocorrências.
Validação humana adicional: conferir a aparência e o modal em navegador real,
FPS efetivamente entregue no perfil máximo e autoplay no Safari/iOS.
