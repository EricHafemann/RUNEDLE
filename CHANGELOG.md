# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.2.0] - 2026-11-27

### Adicionado
- **X1 ao vivo**: salas com código e link de convite, os dois jogadores recebem o mesmo campeão
  ao mesmo tempo, progresso do adversário em tempo real, placar e revanche. Os palpites são
  conferidos numa função do servidor (Supabase Edge Function), então a resposta nunca chega ao navegador.
- **Nova interface no estilo do cliente do LoL**: botão JOGAR, abas Diário / Infinito / X1,
  carteira com sequência e vitórias, menu lateral com os modos do dia, coluna com perfil,
  sequência da semana, desafio de hoje e X1.
- Fundo do jogo com arte desfocada que nunca é a resposta de nenhum modo do dia.
- Transições: entrada em cascata ao trocar de tela, troca suave do fundo e grupos recolhíveis.

### Alterado
- O site abre direto no **Classic**, sem tela de menu.
- **Ícones de habilidade atualizados**: o modo Ability busca o ícone atual do cliente no
  CommunityDragon, com o ícone salvo no projeto como reserva.
- Aviso legal no rodapé com o texto da política de projetos de fãs da Riot.

## [1.1.0] - 2026-11-27

### Adicionado
- **Modo infinito**: rodadas aleatórias sem limite, em um modo escolhido ou sorteado,
  com sequência e recorde próprios. Pular uma rodada zera a sequência.
- **Calendário**: jogue o desafio de qualquer dia desde 01/01/2026. Esses jogos não contam
  para a sequência diária nem para as estatísticas e aparecem marcados como "vencido depois".
- **Skins no modo Splash**: com internet, a splash art vem de uma skin sorteada no Data Dragon,
  com bônus para acertar o nome da skin. Sem internet, usa a splash padrão.
- Modo Splash começa em preto e branco, com opção para desligar.
- Aba "Infinito" nas estatísticas e marcação de jogos atrasados no histórico.

### Alterado
- O desafio diário agora reinicia às **21h (horário de Brasília)**, em vez da meia-noite.
- Partidas passam a ser guardadas por dia, o que permite o calendário. Partidas antigas continuam valendo.

### Corrigido
- No modo Ability, a tecla da habilidade aparecia antes da pergunta bônus. Agora ela só é revelada depois da resposta.

## [1.0.0] - 2026-11-26

### Adicionado
- Cinco modos diários: **Classic**, **Quote**, **Ability**, **Emoji** e **Splash**.
- Modo Classic com comparação de gênero, posição, espécie, recurso, alcance, região e ano de lançamento
  (verde, amarelo e vermelho, com seta indicando ano maior ou menor).
- Campeão do dia determinístico por data (horário de Brasília): o mesmo para todos os jogadores,
  com reinício à meia-noite e contagem regressiva.
- Busca com autocompletar, ícones dos campeões, navegação por teclado e bloqueio de tentativas repetidas.
- Dicas liberadas a cada erro, bônus de tecla no modo Ability e opção de desistir.
- Sequência diária global (🔥) com recorde e visão dos últimos 7 dias.
- Estatísticas por modo: partidas, vitórias, taxa de vitória, sequência atual, maior sequência
  e distribuição de tentativas.
- Histórico de partidas e botão de compartilhar resultado em emojis.
- Imagens locais de 172 campeões (patch 16.23.1): ícones, habilidades e splash arts. O jogo funciona offline.
- Layout responsivo para celular e computador, com tema escuro dourado e azul e animações.

[1.2.0]: https://github.com/EricHafemann/RUNEDLE/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/EricHafemann/RUNEDLE/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/EricHafemann/RUNEDLE/releases/tag/v1.0.0
