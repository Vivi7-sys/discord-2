# Revisão das correções — Discord 2

Data: 13/10/2026. Revisão adicional das mudanças da primeira análise, sem commit,
push, alterações visuais, atualização de Next.js ou mudança de dependências.

## Correções adicionais

### Redis e permissões

- Antes de conceder publicação, o script Lua verifica **atomicamente** dono e
  TTL da trava e dono e TTL da reserva. Ambos precisam ter pelo menos 20 segundos
  de margem; a atualização LiveKit tem timeout de 8 segundos e não usa failover.
- Mantida a liberação por comparação de dono (`GET`/`DEL` no mesmo script). Um
  participante não pode remover a reserva de outro. Todas as operações de grant
  continuam exigindo token válido da sala e presença da identidade no LiveKit.
- A flag de produção bloqueia apenas aquisição: desligá-la não bloqueia a rota
  autenticada de revogação. Ela não revoga automaticamente todas as transmissões
  já ativas; o participante ainda precisa parar/sair.
- As permissões estão centralizadas e testadas: transmissor pode publicar apenas
  tela e áudio de tela, sem câmera, microfone ou dados. Espectador só recebe.
- Conferidos timeout por chamada, sinal novo em cada requisição, ausência de
  retry automático e inicialização sob demanda do Redis. A tentativa de liberação
  via LiveKit durante falha Redis continua presente, sem alternativa para grant.

### Encerramento de áudio e vídeo

A primeira correção não encerrava explicitamente o áudio automático do navegador
junto com a trilha de vídeo. O SDK instalado despublica a trilha que termina, sem
assegurar que o código da aplicação encerre imediatamente a outra trilha.

- `releaseScreenCapture` para todas as trilhas de tela **antes** de esperar
  despublicação. Funciona no botão Parar, no fim pelo navegador, na revogação,
  na desconexão definitiva e no unmount.
- Um listener do evento nativo `ended` do vídeo encerra o áudio mesmo enquanto
  o SDK ainda aguarda uma publicação pendente. Esse listener é removido na limpeza.
- A captura fica vinculada à instância da sala; respostas antigas não limpam a
  captura de uma nova sala. A fonte virtual e a confirmação pendente são encerradas.
- Erro síncrono ou assíncrono de despublicação não impede a tentativa de remover
  as demais trilhas. O rollback conserva o erro original de publicação.
- A recepção remota zera o ganho, desanexa a trilha, pausa o elemento e limpa
  `srcObject`. A lógica anterior de volume por trilha foi preservada.
- A conexão não é reativada por resolução tardia após desconexão; falha na
  liberação explícita não dispara uma segunda tentativa automática redundante.

## Investigação dos cinco alertas altos

Cadeia instalada:

```text
eslint-config-next 16.4.0
└─ @next/eslint-plugin-next 16.4.0
   └─ fast-glob 3.3.1
      └─ micromatch 4.0.8
         └─ braces 3.0.3
```

É um problema raiz propagado a cinco pacotes no relatório npm. O advisory
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) / CVE-2026-93687
informa estouro de pilha com padrões de chaves profundamente aninhados e nenhuma
versão corrigida.

Consultas ao registro npm nesta revisão:

| Pacote | Versão mais recente consultada | Consequência |
| --- | --- | --- |
| braces | 3.0.3 | A versão mais recente ainda está no intervalo vulnerável. |
| micromatch | 4.0.8 | Ainda depende de braces `^3.0.3`. |
| fast-glob | 3.3.3 | Ainda depende de micromatch `^4.0.8`; atualizar só ele não corrige. |
| eslint-config-next | 16.4.0 | A versão instalada já é a mais recente consultada. |

**Não há atualização corrigida e compatível disponível na cadeia consultada.**
Não foram aplicados downgrade de eslint-config-next para 14.2.35, override de
major antiga, troca por pacote com outra API, patch manual em node_modules ou
remoção de regras do Next.js. Essas medidas não seriam uma correção upstream
verificada nem justificariam declarar a auditoria limpa.

No plugin Next instalado, `fast-glob` aparece no processamento de
`settings.next.rootDir`. O projeto não fornece esses padrões nem expõe glob
recebido de visitantes a essa configuração. Isso reduz a exposição no uso atual;
não elimina a vulnerabilidade da dependência de desenvolvimento. Não executar
lint com configuração/padrões não confiáveis e acompanhar a correção upstream.
O lockfile permanece inalterado. Auditar só produção não apaga os alertas completos.

## Validação

| Comando | Resultado |
| --- | --- |
| `npm test` | 24 testes aprovados, sem falhas ou skips. |
| `npm run lint` | Aprovado, sem avisos ou erros. |
| `npm run build` | Aprovado, com compilação e TypeScript habilitados. |
| `npm audit --json` | Executado; exit 1 por cinco alertas altos da cadeia de desenvolvimento. |
| `npm audit --omit=dev --json` | Exit 0; zero alertas nas dependências de produção. |
| `git diff --check` | Sem erros de whitespace. |

A consulta ao registro e o build foram feitos fora do sandbox, como autorizado,
por limitações de rede/subprocesso do ambiente. Nenhum serviço real de sala foi
alterado e nenhuma credencial real foi usada nos testes.

Os testes Redis usam o **SDK instalado**, sua serialização/autopipelining e fetch
simulado; validam comandos, chaves, argumentos, sinais e propagação de erros.
Eles **não executam Lua em um Redis real** nem simulam todas as corridas entre
instâncias. Os testes de captura usam doubles das operações de mídia; não são
uma chamada WebRTC real. A confirmação de layout compara JSX e CSS com o Git;
não substitui teste visual em navegadores.

## Riscos restantes e publicação

**Avaliação histórica dessa etapa**, anterior à integração real e à informação
do usuário sobre produção e validação manual. O status atual está na
[revisão final](REVISAO-FINAL.md). Os itens abaixo registram riscos/validações
levantados na ocasião, não bloqueios todos ainda não verificados:

1. Teste real em dois navegadores/dispositivos: vídeo+áudio, fim pelo navegador,
   fonte virtual Linux, Safari/iOS, troca de transmissor, autoplay/volume e saída
   com seletor ou publicação pendente. Confirmar indicadores de captura desligados.
2. Integração Redis/LiveKit: concorrência com duas instâncias, resposta perdida,
   revogação com Redis indisponível e expiração de trava/reserva. A verificação
   atômica reduz riscos, mas **Redis e LiveKit não têm transação conjunta**; uma
   pausa do processo depois da verificação ainda exige solução de fencing/coordenador
   se a exigência for exclusividade absoluta sob todas as falhas.
3. Política de acesso: possuir convite permite entrar; faltam autenticação de
   pessoa, expiração e revogação individual. Os limites globais também podem ser
   consumidos por um visitante e afetar todos.
4. Token original de seis horas: verificar renovação de autorização da API e
   recriação automática de sala com token ainda válido, inclusive limite de seis.
   Reservas ociosas de participante conectado com permissão também precisam de política.
5. Configuração de produção: HTTPS, hostname Turnstile, limites/tempo de upload na
   borda e tratamento de indisponibilidade. O build não valida essas credenciais.
6. Acompanhar correção de braces. Os alertas são de desenvolvimento, mas permanecem
   presentes nas instalações que incluem as ferramentas de build/lint.

Nenhum visual foi alterado, nenhuma publicação foi feita e não há commit ou push.
