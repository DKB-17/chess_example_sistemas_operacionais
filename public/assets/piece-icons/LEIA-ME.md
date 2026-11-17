# Ícones das peças

Estes arquivos são os símbolos desenhados embaixo de cada peça (e por cima dela na **Visão 2D**).

```
piece-icons/
  white/  pawn.svg  rook.svg  knight.svg  bishop.svg  queen.svg  king.svg
  black/  pawn.svg  rook.svg  knight.svg  bishop.svg  queen.svg  king.svg
```

| Arquivo      | Peça   |
|--------------|--------|
| `pawn.svg`   | Peão   |
| `rook.svg`   | Torre  |
| `knight.svg` | Cavalo |
| `bishop.svg` | Bispo  |
| `queen.svg`  | Rainha |
| `king.svg`   | Rei    |

## Como trocar um ícone

1. Substitua o arquivo **mantendo exatamente o mesmo nome** (ex.: `white/knight.svg`).
2. Use uma imagem quadrada; ela é desenhada em 256×256 px. Áreas transparentes ficam transparentes no tabuleiro.
3. Se o SVG não tiver `width`/`height`, adicione `width="256" height="256"` na tag `<svg>`.
4. Reconstrua o container: `docker compose up -d --build web` (em `npm run dev` basta recarregar a página).

Quer usar PNG? Salve os 12 arquivos como `.png` com os mesmos nomes e mude
`PIECE_ICON_EXTENSION` para `'png'` em `src/pieceIcons.js`.
