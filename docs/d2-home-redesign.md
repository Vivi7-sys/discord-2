# D2 — home minimalista

Branch: `redesign/d2-minimal-home`, baseada na `main` (`0c84dcf`).
O checkout Linux original foi mantido intacto; implementação em clone isolado.

## Alterações

- Home com marca textual D2 (D branco/2 vermelho), subtítulo e painel único.
- Duas colunas no desktop; empilhamento até 640 px; sem imagens ou seções extras.
- CSS Module exclusivo da home. `globals.css` não foi editado.
- Identidade e metadados padrão atualizados para D2. Metadados específicos da sala
  não foram editados, respeitando a restrição sobre `/sala/[roomId]`.
- Turnstile visível e obrigatório, com botão indicando espera, criação e erros.
- Endpoint, corpo da requisição, token de uso único/reset e validação de convites
  preservados. Nenhuma alteração em Redis, rate limiting ou backend.
- Foco visível, rótulo acessível no convite, erros associados ao campo, anúncios de
  carregamento e prevenção de cliques repetidos.

## Verificação

- Lint e TypeScript sem erros.
- `npm test`: testes existentes de segurança/captura e 11 regressões de API passam
  com serviços externos simulados; não consomem LiveKit Cloud.
- `npm run test:home`: 4 testes React/DOM passam, cobrindo Turnstile, expiração,
  falha/timeout, carregamento, reset, erros e validação/navegação dos convites.
- `npm run test:ui`: diálogo de compartilhamento e 10 testes existentes da sala
  passam com JSDOM 26.1.0. JSDOM 30.1.3 falha no teste de foco tanto nesta branch
  quanto na `main` intacta; nenhum código da sala foi alterado para acomodá-lo.
- `npm run build`: concluído. O Next.js instalado (16.4.0) emitiu um aviso de
  vulnerabilidade preexistente e interrompeu a primeira execução após gerar as
  páginas; a repetição concluiu com aviso. Dependências/lock não foram atualizados.
  A atualização de segurança do framework continua pendente, fora deste redesign.
- Chromium real: capturas desktop 1440×1000, celular 390×844 e 320×740; sem
  overflow horizontal. Colunas lado a lado/empilhadas verificadas.
- Axe: zero violações detectadas nos critérios WCAG A/AA/2.1 AA executados.
- Navegação por teclado, foco visível, carregamento, erro 429 e convite de mesma
  origem verificados no navegador. A resposta de criação é interceptada apenas
  pelo teste; nenhuma configuração do aplicativo é substituída.
- 41 arquivos protegidos (sala, CSS global, backend, mídia, desktop, configuração
  e lock) conferidos byte a byte com a base: `protected-files.json`.
- A entrada real da sala foi capturada sem conectar ao LiveKit. A tentativa extra
  de comparar screenshots com o servidor webpack da base não concluiu; não é
  apresentada como comparação visual aprovada. A preservação é comprovada pelos
  arquivos idênticos e regressões existentes. Mídia ao vivo não foi retestada.

## Capturas e ambiente de teste

As capturas reais ficam em `evidence/d2-home/home-{desktop,mobile,small-mobile}.png`.
Foi usada somente no build local a chave pública de teste **visível** oficial do
Turnstile. O aviso de teste no widget é esperado. Essa chave não foi inserida no
código, na configuração de hospedagem ou em variáveis da Vercel.

Referência: https://developers.cloudflare.com/turnstile/troubleshooting/testing/

O navegador e JSDOM/axe são ferramentas locais externas, seguindo o padrão dos
scripts de regressão existentes. Exemplos para repetir:

```sh
DISCORD2_JSDOM_MODULE=/caminho/node_modules/jsdom npm run test:home
DISCORD2_JSDOM_MODULE=/caminho/node_modules/jsdom npm run test:ui
D2_PLAYWRIGHT_MODULE=/caminho/node_modules/playwright \
D2_AXE_MODULE=/caminho/node_modules/axe-core npm run test:home:browser
```

O último comando usa o servidor local na porta 3221 (ou `D2_HOME_BASE_URL`). Para
seu teste local, compile com a chave de teste pública indicada na documentação
Cloudflare. Ele não configura a chave secreta nem cria salas reais.

Nenhuma alteração foi enviada à produção, nem aplicada aos aplicativos Linux ou
Windows. O Preview deve usar a integração Vercel já conectada ao repositório,
sem mudanças na hospedagem.
