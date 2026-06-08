# @doceria/pricing-core

Núcleo de precificação — **lógica pura**, sem React, navegador ou banco de dados.
O mesmo módulo roda no app (cálculo instantâneo) e no servidor (recalcula e valida
antes de gravar), garantindo preços idênticos nos dois lados.

## Funções principais

- `n(v)` — converte texto BR em número (`"3.000,00"` → `3000`).
- `money2(v)` — formata para moeda BR (`"100"` → `"100,00"`).
- `maskPhone(v)` — máscara de telefone `(98) 90000-0000`.
- `roundPrice(v, mode)` — arredondamento comercial (nunca zera preço positivo).
- `costPerMinute(par)` — custo por minuto a partir dos parâmetros do negócio.
- `computeProduct(produto, ctx)` — **fonte única de cálculo** do preço (custo, sugerido, margens).
- `validateItem(item)` / `validateProduct(produto)` — regras de campos obrigatórios.

## Regras embutidas (validadas)

- Markup = margem **sobre o preço de venda**; margem limitada a `[0; 99,9%]`.
- Desconto de revenda limitado a `[0; 100%]`.
- Todas as divisões protegidas contra divisão por zero.
- Números no padrão BR (vírgula decimal, ponto de milhar).
