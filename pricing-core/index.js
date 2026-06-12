/**
 * pricing-core
 * -----------------------------------------------------------------------------
 * Núcleo de precificação — lógica pura, sem dependência de React, navegador ou
 * banco de dados. O MESMO módulo é usado:
 *   - no app (cálculo instantâneo enquanto o usuário digita);
 *   - no servidor/API (recalcula e valida antes de gravar).
 *
 * Regras de negócio (validadas em auditoria):
 *   - números no padrão BR: vírgula = decimal, ponto = separador de milhar;
 *   - markup = margem SOBRE O PREÇO DE VENDA (não sobre o custo);
 *   - margem limitada a [0; 99,9%] para nunca gerar markup negativo/infinito;
 *   - desconto de revenda limitado a [0; 100%];
 *   - arredondamento comercial nunca zera um preço positivo;
 *   - todas as divisões protegidas contra divisão por zero.
 *
 * Modelo de dados (resumo):
 *   ingrediente/embalagem: { id, name, packageValue, packageQty, unit }
 *   parâmetros: { desiredEarnings, hoursPerDay, daysPerWeek, marginPct,
 *                 rounding, fixedCosts:[{name,value}], fees:[{name,pct}],
 *                 employees:[{salary,hoursPerDay,daysPerWeek}] }
 *   produto: { id, name, items:[{ingredientId,qty}], packs:[{packagingId,qty}],
 *              yield, minutes, salePrice, discountPct, status }
 * -----------------------------------------------------------------------------
 */

/* Média de semanas por mês (52 / 12). Converte rotina semanal em mensal. */
export const WEEKS_PER_MONTH = 4.33;

/* Margem máxima aceita no cálculo (acima disso o markup seria absurdo). */
export const MARGIN_MAX = 99.9;

/* ------------------------------------------------------------------ */
/*  Conversão e formatação                                            */
/* ------------------------------------------------------------------ */

/**
 * Converte um valor digitado (string BR) ou número em número JS.
 * "3.000,00" -> 3000 | "1.500" -> 1500 | "12,90" -> 12.9 | "3,5" -> 3.5 | "" -> 0
 */
export function n(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  if (s.includes(",")) {
    // tem vírgula decimal: pontos são separadores de milhar
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // sem vírgula, mas no padrão de milhar BR (ex.: "1.500", "1.500.000"): pontos são milhar
    s = s.replace(/\./g, "");
  }
  const x = parseFloat(s);
  return isNaN(x) ? 0 : x;
}

/** Formata para moeda BR com 2 casas: "100" -> "100,00" ("" permanece vazio). */
export function money2(v) {
  const s = String(v ?? "").trim();
  if (s === "") return "";
  return n(s).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Máscara de telefone/WhatsApp BR: só dígitos, formato (98) 90000-0000. */
export function maskPhone(v) {
  const d = String(v ?? "").replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Remove tudo que não for dígito, vírgula ou ponto (filtro de campo numérico). */
export function onlyNumeric(s) {
  return String(s ?? "").replace(/[^\d.,]/g, "");
}

/* ------------------------------------------------------------------ */
/*  Arredondamento comercial                                          */
/* ------------------------------------------------------------------ */

export const ROUNDING_OPTIONS = [
  { v: "none", label: "Não arredondar" },
  { v: "0.10", label: "Múltiplo de R$ 0,10" },
  { v: "0.50", label: "Múltiplo de R$ 0,50" },
  { v: "1", label: "Múltiplo de R$ 1,00" },
  { v: "0.90", label: "Terminar em ,90" },
  { v: "0.99", label: "Terminar em ,99" },
];

/** Arredondamento comercial do preço sugerido. Nunca zera um preço positivo. */
export function roundPrice(v, mode) {
  if (!v || !isFinite(v)) return 0;
  const eps = 1e-9;
  if (mode === "0.10" || mode === "0.50" || mode === "1") {
    const step = parseFloat(mode);
    const r = Math.round(v / step) * step;
    return r > 0 ? r : step;
  }
  if (mode === "0.90" || mode === "0.99") {
    const end = mode === "0.90" ? 0.9 : 0.99;
    let cand = Math.floor(v) + end;
    if (cand < v - eps) cand += 1;
    return cand;
  }
  return v; // "none"
}

/* ------------------------------------------------------------------ */
/*  Custos                                                            */
/* ------------------------------------------------------------------ */

/** Custo por unidade de medida de um ingrediente/embalagem. */
export function unitCost(item) {
  return item && n(item.packageQty)
    ? n(item.packageValue) / n(item.packageQty)
    : 0;
}

/**
 * Custo por minuto de produção, derivado dos parâmetros do negócio:
 * mão de obra da dona + custos fixos + (opcional) funcionários, rateados
 * pelas horas trabalhadas no mês e divididos por 60.
 */
export function costPerMinute(par = {}) {
  const monthlyH = n(par.hoursPerDay) * n(par.daysPerWeek) * WEEKS_PER_MONTH;
  const ownerH = monthlyH ? n(par.desiredEarnings) / monthlyH : 0;
  const fixedTotal = (par.fixedCosts || []).reduce((s, f) => s + n(f.value), 0);
  const fixedH = monthlyH ? fixedTotal / monthlyH : 0;
  const empH = (par.employees || []).reduce((s, e) => {
    const mh = n(e.hoursPerDay) * n(e.daysPerWeek) * WEEKS_PER_MONTH;
    return s + (mh ? n(e.salary) / mh : 0);
  }, 0);
  return (ownerH + fixedH + empH) / 60;
}

/* ------------------------------------------------------------------ */
/*  Precificação (fonte única de cálculo)                             */
/* ------------------------------------------------------------------ */

/**
 * Calcula o preço de um produto.
 * @param {object} product  o produto (name, items, packs, yield, minutes, salePrice, discountPct)
 * @param {object} ctx      { ingredients, packaging, params, cpm? }
 *                          cpm (custo/min) é opcional; se ausente, é derivado de params.
 * @returns {object} detalhamento completo de custo, preço e margens.
 */
export function computeProduct(product, ctx = {}) {
  const p = product || {};
  const ingredients = ctx.ingredients || [];
  const packaging = ctx.packaging || [];
  const par = ctx.params || {};
  const cpm = ctx.cpm != null ? ctx.cpm : costPerMinute(par);

  const ingById = (id) => ingredients.find((x) => x.id === id);
  const embById = (id) => packaging.find((x) => x.id === id);

  const ingredientRows = (p.items || [])
    .map((it) => {
      const g = ingById(it.ingredientId);
      if (!g) return null;
      const u = unitCost(g);
      return { name: g.name, qty: n(it.qty), unit: g.unit, unitCost: u, total: u * n(it.qty) };
    })
    .filter(Boolean);

  const packRows = (p.packs || [])
    .map((pk) => {
      const g = embById(pk.packagingId);
      if (!g) return null;
      const u = unitCost(g);
      return { name: g.name, qty: n(pk.qty), unit: g.unit, unitCost: u, total: u * n(pk.qty) };
    })
    .filter(Boolean);

  const ingredientsCost = ingredientRows.reduce((s, r) => s + r.total, 0);
  const packPerUnit = packRows.reduce((s, r) => s + r.total, 0);
  const yld = n(p.yield);
  const totalInsumosEmb = ingredientsCost + packPerUnit * yld;
  const laborFixed = n(p.minutes) * cpm;
  const totalRecipe = laborFixed + totalInsumosEmb;
  const costPerUnit = yld ? totalRecipe / yld : 0;

  // markup = margem sobre o preço de venda; margem limitada a [0; 99,9%]
  const rawMargin = n(par.marginPct);
  const effMargin = Math.min(Math.max(rawMargin, 0), MARGIN_MAX);
  const markup = 100 / (100 - effMargin);
  const suggestedUnitRaw = yld ? (totalRecipe * markup) / yld : 0;
  const suggestedUnit = roundPrice(suggestedUnitRaw, par.rounding || "none");
  const suggestedRecipe = suggestedUnit * yld;

  const sale = n(p.salePrice);
  const realMargin = sale ? (sale - costPerUnit) / sale : 0;
  const profit = sale ? sale - costPerUnit : 0;

  const disc = Math.min(Math.max(n(p.discountPct) / 100, 0), 1); // [0;100%]
  const resalePrice = sale ? sale - sale * disc : 0;
  const resaleMargin = resalePrice ? (resalePrice - costPerUnit) / resalePrice : 0;
  const resaleProfit = resalePrice ? resalePrice - costPerUnit : 0;

  // margem real embutida no preço sugerido (já com arredondamento)
  const marginAtSuggested = suggestedUnit > 0 ? (suggestedUnit - costPerUnit) / suggestedUnit : 0;

  // cenários a sinalizar
  const orphanIng = (p.items || []).filter((it) => it.ingredientId && !ingById(it.ingredientId)).length;
  const orphanPack = (p.packs || []).filter((pk) => pk.packagingId && !embById(pk.packagingId)).length;

  return {
    ingredientRows, packRows, ingredientsCost, packPerUnit, yld, totalInsumosEmb,
    laborFixed, totalRecipe, costPerUnit, suggestedRecipe, suggestedUnit, suggestedUnitRaw,
    marginAtSuggested, sale, realMargin, profit, resalePrice, resaleMargin, resaleProfit,
    costPerMinute: cpm, minutes: n(p.minutes), marginPct: effMargin, rawMargin,
    marginInvalid: rawMargin >= 100 || rawMargin < 0,
    discountPct: n(p.discountPct), fees: par.fees || [], orphanIng, orphanPack,
  };
}

/**
 * Preço bruto para manter o líquido `sale` após uma taxa de plataforma (%).
 * Retorna null quando a taxa é inválida (>= 100%).
 */
export function platformGrossPrice(sale, feePct) {
  const factor = (100 - n(feePct)) / 100;
  return factor > 0 ? n(sale) / factor : null;
}

/* ------------------------------------------------------------------ */
/*  Validação (mesmas regras no cliente e no servidor)                */
/* ------------------------------------------------------------------ */

/** Valida um ingrediente/embalagem. Retorna { ok, errors:{name,packageValue,packageQty} }. */
export function validateItem(item = {}) {
  const errors = {
    name: !String(item.name || "").trim(),
    packageValue: n(item.packageValue) <= 0,
    packageQty: n(item.packageQty) <= 0,
  };
  return { ok: !errors.name && !errors.packageValue && !errors.packageQty, errors };
}

/** Valida um produto. Retorna { ok, errors:{name,items,yield,minutes} }. */
export function validateProduct(product = {}) {
  const hasIngredient = (product.items || []).some(
    (it) => it.ingredientId && n(it.qty) > 0
  );
  const errors = {
    name: !String(product.name || "").trim(),
    items: !hasIngredient,
    yield: n(product.yield) <= 0,
    minutes: n(product.minutes) <= 0,
  };
  return {
    ok: !errors.name && !errors.items && !errors.yield && !errors.minutes,
    errors,
  };
}
