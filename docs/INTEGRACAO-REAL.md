# Integração real e preparação de publicação — Discord 2

Executada em 13/10/2026 usando o Redis e o LiveKit já configurados no projeto.
Resultado bruto sanitizado: [INTEGRACAO-REAL-RESULTADOS.json](INTEGRACAO-REAL-RESULTADOS.json).

## O que efetivamente foi executado

Não houve mocks de fetch, Redis, LiveKit ou da API nesta suíte. Duas instâncias
locais do **build de produção do Next.js** receberam requisições HTTP reais.
Clientes separados do SDK Node LiveKit 1.1.0 abriram conexões WebRTC reais.
Vídeo 320×180 e áudio de teste foram **gerados sinteticamente**, enviados pelo SFU
configurado e **decodificados** no outro cliente. Isso comprova transporte e
assinatura de trilhas; não comprova captura de tela/som do computador pelo navegador.

| Cenário | Evidência/assertions reais | Resultado |
| --- | --- | --- |
| Travas Redis | Oito aquisições concorrentes: exatamente uma vence; dono incorreto não remove a trava. | Aprovado |
| Reservas e TTL | Duas reservas concorrentes: uma vence; conferência Lua dos donos/TTLs; expiração real e proteção contra remoção por dono antigo. | Aprovado |
| Conexão simultânea | Dois processos conectados; presença conferida no LiveKit e em ambos os clientes. | Aprovado |
| Exclusividade entre instâncias | Duas aquisições HTTP concorrentes em servidores separados: 200 + 409, apenas um canPublish, reserva correta e mutex liberado. | Aprovado |
| Vídeo e áudio | Espectador decodificou pelo menos cinco frames de cada tipo; servidor confirmou fontes screen share e screen share audio. | Aprovado |
| Parada e troca | Despublicação, revogação e remoção da reserva; contador de frames permanece estável após esvaziar buffers; outro participante transmite e é recebido. | Aprovado |
| Saída inesperada | SIGKILL no processo transmissor, sem disconnect/release; LiveKit removeu a presença; outro participante recuperou a reserva e permissão. | Aprovado |
| Nova entrada após queda | Novo cliente entrou e recebeu vídeo/áudio do transmissor recuperado. Não é teste de auto-resume do mesmo processo. | Aprovado |
| Falha de acesso Redis | Instância isolada apontada para porta local indisponível: aquisição responde 503 e revogação continua via LiveKit real. | Aprovado |
| Reconciliação de reserva | Após revogação durante falha Redis, TTL da reserva de teste foi reduzido para representar idade >60 s; API saudável reconciliou e concedeu ao outro cliente. | Aprovado com envelhecimento induzido |
| Falha de acesso LiveKit | Outra instância isolada apontada para porta indisponível: API responde 502, mutex real é liberado e próxima aquisição saudável funciona. | Aprovado |
| Limpeza | Processos próprios encerrados; sala removida; ausência da sala e das duas chaves verificada nos serviços. | Aprovado |

O resultado JSON tem dez entradas agrupadas; a tabela detalha suas verificações.
As falhas foram **induzidas nos processos locais de teste**. Redis e LiveKit
compartilhados não foram desligados nem tiveram configuração global alterada.
Não houve teste de outage global, de partição arbitrária ou de resposta perdida
após o servidor efetivar uma alteração.

## Isolamento e segurança

- Sala com convite aleatório assinado e metadata exclusiva. Nomes, tokens,
  endpoints privados e credenciais não são impressos nem gravados no relatório.
- Sem listagem geral, remoção ou alteração de salas existentes. A listagem de
  limpeza filtra somente o nome que o teste criou e verifica sua metadata.
- Travas/reservas usam o código e as chaves normais, mas apenas para o ID aleatório
  de teste. Nunca há flush, scan global, DEL genérico ou alteração de chave de usuário.
- Nova variável **somente no processo de teste**, `DISCORD2_INTEGRATION_RUN`, separa
  as cotas Redis de criação/token/share. O prefixo padrão permanece inalterado.
  Não definir essa variável no ambiente publicado. Os limitadores de teste têm TTL.
- O SDK Node foi instalado **somente em /tmp**. Dependências e lockfile do projeto
  não foram alterados. JWTs dos clientes são transmitidos por IPC, fora dos argumentos.
- .env.local não foi modificado. Não há commit, push ou deploy.

A única mudança funcional de aplicação nesta etapa é o namespace opcional dos
limitadores para permitir testes reais sem consumir cotas dos usuários. Foi
adicionado teste do prefixo normal, do isolado e da rejeição de namespace inválido.
Também foram adicionados os scripts reproduzíveis e este relatório. CSS/JSX mantidos.

## Verificação final

- `npm test`: **25 testes aprovados**. Essa suíte inclui doubles/mocks e continua
  identificada como unitária/de fronteira do SDK; não é a prova de integração real.
- `npm run lint`: aprovado.
- `npm run build`: aprovado, com checagem TypeScript habilitada.
- `node scripts/integration-real.mjs`: integração real aprovada e recursos limpos.
- `npm audit --omit=dev --json`: zero alertas de produção. Auditoria completa:
  cinco alertas altos da cadeia de desenvolvimento de braces continuam sendo
  acompanhados; nenhuma versão incompatível foi instalada para escondê-los.

## O que exige validação humana ou não foi executado

1. **Interface real e getDisplayMedia:** clicar em compartilhar, selecionar guia,
   janela/tela e habilitar áudio. Não havia navegador/automação instalado no ambiente;
   o SDK Node não executa a aplicação React e não testa o seletor do navegador.
2. **Parada da captura no navegador:** testar botão da aplicação, botão do navegador,
   navegação/fechamento, seletor ainda aberto e permissão revogada durante publicação.
   Confirmar que indicadores de captura do sistema/navegador desligam. Nesta etapa
   o encerramento real comprovado é o das trilhas WebRTC do cliente de teste.
3. **Linux/PipeWire/pavucontrol:** selecionar a fonte virtual e confirmar que ela
   não é microfone; depende da configuração e interação do usuário.
4. **Chrome/Firefox/Safari/iOS:** autoplay, volume/mute, tela cheia e troca de fonte
   com SDK JavaScript/browser. Não houve teste visual ou reprodução audível humana.
5. **Reconexão automática, longa duração e limite de seis:** perda temporária de
   sinal, token após seis horas, recriação de sala e tentativa de sétimo participante.
   Os testes atuais usaram duas conexões e presença após crash/reentrada.
6. **Consistência absoluta sob falhas:** pausas após conferir lease, timeout após
   efetivar grant e partição entre Redis/LiveKit. Não há transação conjunta nem fencing
   efetivo no LiveKit; as provas desta suíte não eliminam esses riscos.
7. **Turnstile completo:** criação de convite após desafio real e hostname correto;
   os testes usaram convites assinados internamente para a sala isolada.

## Produção Render e validação manual anterior

**Correção de escopo:** os valores ausentes/desativados observados eram de
`.env.local`, não uma leitura da produção. Não permitem concluir que o Render
bloqueia transmissão ou Turnstile.

O usuário informou que a aplicação já está publicada no Render e que configurou
`ENABLE_SHARE_IN_PRODUCTION=true` e
`TURNSTILE_ALLOWED_HOSTNAME=discord-2-kuau.onrender.com`. Não há CLI, credencial
ou conexão autenticada com Render nesta sessão: **essas variáveis privadas não
foram confirmadas independentemente nem alteradas**. O endpoint público
`https://discord-2-kuau.onrender.com/api/health` respondeu 200, status `ok`,
service `screen-share`. Saúde HTTP não comprova configuração de transmissão/captcha.

Também foi informado que vídeo e áudio já foram validados manualmente entre
navegadores na versão anterior, inclusive Pop!_OS com Brave. Essa evidência é
válida para a versão anterior. A integração real desta revisão comprova os cenários
listados acima; o novo ciclo de captura, limpeza e mute ainda exige um teste de
regressão curto após o próximo deploy, no mesmo ambiente já validado.

Com build/lint/testes aprovados e o diff revisado, a alteração pode ser preparada
para atualização controlada da aplicação existente. Os valores locais não são
bloqueios comprovados de produção. Veja [a revisão final](REVISAO-FINAL.md) para
aprovação do código, limites da confirmação Render e verificações pós-deploy.

## Como repetir de forma explícita

Requer credenciais válidas locais, autorização para usar os serviços e o SDK de
teste instalado fora das dependências do projeto:

```bash
npm install --prefix /tmp/discord2-integration --no-audit --no-fund @livekit/rtc-node@1.1.0
npm run test:integration
```

Esse comando executa unitários/build e depois acessa serviços reais; não roda por
padrão em `npm test`. O script gera namespace/sala novos por execução e faz limpeza.
O caminho do SDK pode ser informado em `DISCORD2_RTC_MODULE` se /tmp for removido.
Não redefinir outras variáveis para serviços de usuários. Para a inspeção inicial:
`node scripts/integration-preflight.mjs` faz ping Redis e criação/remoção de sala isolada.
