# D2 — ajustes finais da home

Branch: `redesign/d2-minimal-home`. Base deste ajuste: `fef1ac7`.

## Arquivos de código alterados

- `src/components/home/home.module.css`: CTAs vermelhos compartilhados, hover/active/
  focus-visible, bordas vermelhas discretas, altura 100dvh e bloqueio de overflow
  exclusivo da home visível. Espaçamentos responsivos, organização compacta da
  verificação e dos controles em telas pequenas e horizontais.
- `src/components/home/RoomEntry.tsx`: classe visual do card de criação e CTA de
  entrada usando o mesmo estilo principal; rótulo “Entrar na sala”. Nenhuma mudança
  de hooks, requisições, tokens, callbacks ou opções do Turnstile.
- `scripts/test-home-browser.cjs`: seletores atualizados para o rótulo do botão.
- `scripts/test-home-viewport.cjs`: regressão de geometria, scroll, teclado,
  acessibilidade e isolamento da sala em navegador real.

Os demais arquivos novos nesta pasta são evidências, capturas e logs.

## Resultados

- Lint e TypeScript: aprovados.
- Build de produção: aprovado. Mantém o aviso preexistente de vulnerabilidade do
  Next.js 16.4.0; dependências e lockfile não foram alterados. A primeira execução
  foi interrompida pelo lembrete do framework; a repetição concluiu com sucesso.
- Testes React/DOM da home: 4 aprovados.
- Chromium real: oito viewports aprovados (1440×900, 1280×720, 768×1024,
  390×844, 360×640, 320×568, 844×390 e 568×320).
- Nenhuma rolagem vertical/horizontal e nenhum controle ou área de verificação
  cortado nos tamanhos testados. HTML/body medidos com a altura do viewport.
- Estados de erro do convite e da criação também cabem em 320×568.
- Hover vermelho e foco visível de teclado conferidos; input com foco vermelho.
- Axe WCAG A/AA/2.1 AA: zero violações detectadas nos critérios executados.
- O Next mantém páginas inativas no DOM via React Activity. O seletor de lock ignora
  a cópia oculta da home. Navegar para a sala restaura overflow normal; voltar à
  home reaplica o lock. Ambos os trajetos foram verificados no navegador real.
- 41 arquivos protegidos conferidos byte a byte com a base: sala, CSS global,
  backend, mídia, aplicativos, configuração e lockfile permaneceram inalterados.
- Zero requisições LiveKit. Nenhum consumo da franquia de mídia.

As capturas são reais e mostram o Turnstile com a chave pública oficial de teste
usada somente no build local. O aviso do widget de teste é esperado. O widget
compacto original (150×140), suas permissões e validação não foram escondidos,
reduzidos ou substituídos. Nenhuma variável da Vercel foi alterada.

Capturas: `home-desktop.png`, `home-mobile.png`, `home-mobile-se.png` e
`home-landscape-se.png`. Resultado detalhado: `viewport-validation.json`.
