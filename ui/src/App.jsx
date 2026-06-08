import React, { useState, useEffect, useMemo, useContext, createContext } from "react";
import {
  Calculator, Package, Carrot, SlidersHorizontal, Plus, Trash2,
  Save, FolderOpen, ChefHat, TrendingUp, Tag, Percent, Clock,
  X, Check, Sparkles, Layers, FileText, Printer,
  Settings, Upload, Building2, Pencil, Search,
  Copy, Download, AlertTriangle, ArrowUpDown, Receipt, ChevronDown, Home,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  CAMADA DE DADOS (repositório)                                      */
/*  Todo o acesso a persistência passa por AQUI. A interface é de       */
/*  domínio (loadAll / saveIngredients / ...). Hoje a implementação usa  */
/*  window.storage; na versão de servidor, basta trocar `repo` por uma   */
/*  implementação que fala com a API — nenhum componente muda.           */
/* ------------------------------------------------------------------ */
function createLocalRepo() {
  const KEY = {
    ingredients: "palha:ingredientes",
    packaging: "palha:embalagens",
    parameters: "palha:parametros",
    products: "palha:produtos",
    config: "palha:config",
  };
  const get = async (key, def) => {
    try {
      if (!window.storage) return def;
      const r = await window.storage.get(key);
      return r ? JSON.parse(r.value) : def;
    } catch {
      return def;
    }
  };
  const set = async (key, val) => {
    try {
      if (window.storage) await window.storage.set(key, JSON.stringify(val));
    } catch (e) {
      console.error("storage", e);
    }
  };
  return {
    async loadAll() {
      return {
        ingredients: await get(KEY.ingredients, []),
        packaging: await get(KEY.packaging, []),
        parameters: await get(KEY.parameters, null),
        products: await get(KEY.products, []),
        config: await get(KEY.config, null),
      };
    },
    saveIngredients: (v) => set(KEY.ingredients, v),
    savePackaging: (v) => set(KEY.packaging, v),
    saveParameters: (v) => set(KEY.parameters, v),
    saveProducts: (v) => set(KEY.products, v),
    saveConfig: (v) => set(KEY.config, v),
  };
}

/* ponto único de troca: localmente usa window.storage; depois, a API */
const repo = createLocalRepo();


/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */
const uid = () =>
  (crypto?.randomUUID?.() || String(Date.now() + Math.random()));
const n = (v) => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[^\d.,-]/g, "");
  if (!s) return 0;
  // padrão BR: vírgula = decimal, ponto = separador de milhar
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const x = parseFloat(s);
  return isNaN(x) ? 0 : x;
};
const brl = (v) =>
  (isFinite(v) ? v : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
/* formata um valor digitado para o padrão BR com 2 casas: "100" -> "100,00" ("" permanece vazio) */
const money2 = (v) => {
  const s = String(v ?? "").trim();
  if (s === "") return "";
  return n(s).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
/* máscara de telefone/WhatsApp BR: somente dígitos, formato (98) 90000-0000 */
const maskPhone = (v) => {
  const d = String(v ?? "").replace(/\D/g, "").slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};
const pct = (v) =>
  (isFinite(v) ? v * 100 : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) + "%";
const unitCost = (item) =>
  item && n(item.packageQty) ? n(item.packageValue) / n(item.packageQty) : 0;

/* ------------------------------------------------------------------ */
/*  NOTIFICAÇÕES (toasts globais)                                      */
/* ------------------------------------------------------------------ */
const ToastContext = createContext(() => {});
const useNotify = () => useContext(ToastContext);

function ToastViewport({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + t.type} role="status">
          {t.type === "ok" ? <Check size={17} /> : t.type === "warn" ? <AlertTriangle size={17} /> : <AlertTriangle size={17} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/* arredondamento comercial do preço sugerido */
function roundPrice(v, mode) {
  if (!v || !isFinite(v)) return 0;
  const eps = 1e-9;
  if (mode === "0.10" || mode === "0.50" || mode === "1") {
    const step = parseFloat(mode);
    const r = Math.round(v / step) * step;
    return r > 0 ? r : step; // nunca zera um preço positivo
  }
  if (mode === "0.90" || mode === "0.99") {
    const end = mode === "0.90" ? 0.9 : 0.99;
    let base = Math.floor(v);
    let cand = base + end;
    if (cand < v - eps) cand += 1;
    return cand;
  }
  return v; // none
}
const ROUNDING_OPTIONS = [
  { v: "none", label: "Não arredondar" },
  { v: "0.10", label: "Múltiplo de R$ 0,10" },
  { v: "0.50", label: "Múltiplo de R$ 0,50" },
  { v: "1", label: "Múltiplo de R$ 1,00" },
  { v: "0.90", label: "Terminar em ,90" },
  { v: "0.99", label: "Terminar em ,99" },
];

/* cálculo de precificação reutilizável (tela de precificar + catálogo + ficha) */
function computeProduct(p, { ing, emb, par, costPerMinute }) {
  const ingById = (id) => ing.find((x) => x.id === id);
  const embById = (id) => emb.find((x) => x.id === id);
  const ingredientRows = (p.items || []).map((it) => {
    const g = ingById(it.ingredientId);
    if (!g) return null;
    const u = unitCost(g);
    return { name: g.name, qty: n(it.qty), unit: g.unit, unitCost: u, total: u * n(it.qty) };
  }).filter(Boolean);
  const packRows = (p.packs || []).map((pk) => {
    const g = embById(pk.packagingId);
    if (!g) return null;
    const u = unitCost(g);
    return { name: g.name, qty: n(pk.qty), unit: g.unit, unitCost: u, total: u * n(pk.qty) };
  }).filter(Boolean);

  const ingredientsCost = ingredientRows.reduce((s, r) => s + r.total, 0);
  const packPerUnit = packRows.reduce((s, r) => s + r.total, 0);
  const yld = n(p.yield);
  const totalInsumosEmb = ingredientsCost + packPerUnit * yld;
  const laborFixed = n(p.minutes) * costPerMinute;
  const totalRecipe = laborFixed + totalInsumosEmb;
  const costPerUnit = yld ? totalRecipe / yld : 0;
  /* markup = margem SOBRE O PREÇO de venda. Margem limitada a [0, 99,9%] para
     evitar markup negativo/infinito (margem >= 100% é matematicamente impossível). */
  const rawMargin = n(par.marginPct);
  const effMargin = Math.min(Math.max(rawMargin, 0), 99.9);
  const markup = 100 / (100 - effMargin);
  const suggestedUnitRaw = yld ? (totalRecipe * markup) / yld : 0;
  const suggestedUnit = roundPrice(suggestedUnitRaw, par.rounding || "none");
  const suggestedRecipe = suggestedUnit * yld;
  const sale = n(p.salePrice);
  const realMargin = sale ? (sale - costPerUnit) / sale : 0;
  const profit = sale ? sale - costPerUnit : 0;
  const disc = Math.min(Math.max(n(p.discountPct) / 100, 0), 1); // desconto entre 0% e 100%
  const resalePrice = sale ? sale - sale * disc : 0;
  const resaleMargin = resalePrice ? (resalePrice - costPerUnit) / resalePrice : 0;
  const resaleProfit = resalePrice ? resalePrice - costPerUnit : 0;

  /* cenários a sinalizar */
  const orphanIng = (p.items || []).filter((it) => it.ingredientId && !ingById(it.ingredientId)).length;
  const orphanPack = (p.packs || []).filter((pk) => pk.packagingId && !embById(pk.packagingId)).length;

  return {
    ingredientRows, packRows, ingredientsCost, packPerUnit, yld, totalInsumosEmb,
    laborFixed, totalRecipe, costPerUnit, suggestedRecipe, suggestedUnit, suggestedUnitRaw,
    sale, realMargin, profit, resalePrice, resaleMargin, resaleProfit,
    costPerMinute, minutes: n(p.minutes), marginPct: effMargin, rawMargin,
    marginInvalid: rawMargin >= 100 || rawMargin < 0,
    discountPct: n(p.discountPct), fees: par.fees, orphanIng, orphanPack,
  };
}

const CONFIG_DEFAULT = {
  bizName: "Sou Mais Um Doce",
  owner: "Leandra",
  tagline: "",
  logo: "",
  phone: "",
  instagram: "",
};

/* preenche campos vazios/ausentes da config com os padrões do sistema */
function withCfgDefaults(stored) {
  const s = stored || {};
  const out = { ...CONFIG_DEFAULT };
  for (const k of Object.keys(CONFIG_DEFAULT)) {
    const v = s[k];
    if (typeof v === "string") {
      if (v.trim() !== "") out[k] = v;
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out;
}

/* converte arquivo de imagem em logo redimensionada (PNG, máx. 360px) */
function fileToLogo(file, cb) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const max = 360;
      let { width, height } = img;
      if (width > max || height > max) {
        const r = Math.min(max / width, max / height);
        width = Math.round(width * r);
        height = Math.round(height * r);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      cb(canvas.toDataURL("image/png"));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

const PARAMS_DEFAULT = {
  desiredEarnings: "",
  hoursPerDay: "",
  daysPerWeek: "",
  employees: [],
  fixedCosts: [
    { id: uid(), name: "Água", value: "" },
    { id: uid(), name: "Luz", value: "" },
    { id: uid(), name: "Gás", value: "" },
    { id: uid(), name: "Internet", value: "" },
  ],
  marginPct: "40",
  rounding: "none",
  fees: [
    { id: uid(), name: "iFood (Básico)", pct: "16" },
    { id: uid(), name: "iFood (Entrega Plus)", pct: "27" },
    { id: uid(), name: "Cartão de Crédito", pct: "3,99" },
    { id: uid(), name: "Cartão de Crédito 2", pct: "4,99" },
  ],
};

const SEED = {
  ing: [
    { id: uid(), name: "Biscoito Maizena", packageValue: "6,50", packageQty: "400", unit: "g" },
    { id: uid(), name: "Leite Condensado", packageValue: "7,90", packageQty: "395", unit: "g" },
    { id: uid(), name: "Chocolate em Pó 50%", packageValue: "12,90", packageQty: "200", unit: "g" },
    { id: uid(), name: "Manteiga", packageValue: "9,50", packageQty: "200", unit: "g" },
    { id: uid(), name: "Creme de Leite", packageValue: "3,20", packageQty: "200", unit: "g" },
  ],
  emb: [
    { id: uid(), name: "Saquinho Celofane", packageValue: "8,00", packageQty: "100", unit: "un" },
    { id: uid(), name: "Fita de Cetim", packageValue: "5,00", packageQty: "1000", unit: "cm" },
    { id: uid(), name: "Etiqueta Adesiva", packageValue: "15,00", packageQty: "120", unit: "un" },
  ],
};

/* ================================================================== */
/*  APP                                                                */
/* ================================================================== */
export default function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("inicio");
  const [ing, setIng] = useState([]);
  const [emb, setEmb] = useState([]);
  const [par, setPar] = useState(PARAMS_DEFAULT);
  const [prod, setProd] = useState([]);
  const [cfg, setCfg] = useState(CONFIG_DEFAULT);
  const [editTarget, setEditTarget] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [unsaved, setUnsaved] = useState(false);   // rascunho pendente em Parâmetros/Configurações
  const [pendingView, setPendingView] = useState(null);

  const notify = (type, text) => {
    const id = uid();
    setToasts((list) => [...list, { id, type, text }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 2800);
  };

  /* navegação protegida: se houver alterações não salvas, pede confirmação */
  const requestView = (target) => {
    if (target === view) return;
    if (unsaved) { setPendingView(target); return; }
    setView(target);
  };
  const confirmLeave = () => { setUnsaved(false); setView(pendingView); setPendingView(null); };
  const cancelLeave = () => { setPendingView(null); };

  useEffect(() => {
    (async () => {
      const d = await repo.loadAll();
      setIng(d.ingredients || []);
      setEmb(d.packaging || []);
      setPar(d.parameters || PARAMS_DEFAULT);
      setProd(d.products || []);
      setCfg(withCfgDefaults(d.config));
      setReady(true);
    })();
  }, []);

  const saveIng = (v) => { setIng(v); repo.saveIngredients(v); };
  const saveEmb = (v) => { setEmb(v); repo.savePackaging(v); };
  const savePar = (v) => { setPar(v); repo.saveParameters(v); };
  const saveProd = (v) => { setProd(v); repo.saveProducts(v); };
  const saveCfg = (v) => { setCfg(v); repo.saveConfig(v); };

  /* custo total por minuto (mão de obra + custos fixos) */
  const costPerMinute = useMemo(() => {
    const monthlyH = n(par.hoursPerDay) * n(par.daysPerWeek) * 4.33;
    const ownerH = monthlyH ? n(par.desiredEarnings) / monthlyH : 0;
    const fixedTotal = (par.fixedCosts || []).reduce((s, f) => s + n(f.value), 0);
    const fixedH = monthlyH ? fixedTotal / monthlyH : 0;
    const empH = (par.employees || []).reduce((s, e) => {
      const mh = n(e.hoursPerDay) * n(e.daysPerWeek) * 4.33;
      return s + (mh ? n(e.salary) / mh : 0);
    }, 0);
    return (ownerH + fixedH + empH) / 60;
  }, [par]);

  const loadSeed = () => { saveIng(SEED.ing); saveEmb(SEED.emb); };

  const goToEdit = (product) => { setEditTarget(product); setView("precificar"); };

  /* uso de ingredientes/embalagens nos produtos (aviso ao remover) */
  const ingredientUsage = (id) => prod.filter((p) => (p.items || []).some((it) => it.ingredientId === id)).length;
  const packagingUsage = (id) => prod.filter((p) => (p.packs || []).some((pk) => pk.packagingId === id)).length;

  /* BACKUP — exportar tudo para um arquivo JSON */
  const exportData = () => {
    const payload = {
      app: "Sou Mais Um Doce — Precificação",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: { ingredientes: ing, embalagens: emb, parametros: par, produtos: prod, config: cfg },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `backup-precificacao-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("ok", "Backup exportado com sucesso.");
  };

  /* BACKUP — importar de um arquivo JSON (substitui os dados atuais) */
  const importData = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          const d = parsed.data || parsed;
          if (!d || typeof d !== "object") throw new Error("Estrutura inválida");
          if (d.ingredientes) saveIng(d.ingredientes);
          if (d.embalagens) saveEmb(d.embalagens);
          if (d.parametros) savePar(d.parametros);
          if (d.produtos) saveProd(d.produtos);
          if (d.config) saveCfg(withCfgDefaults(d.config));
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
      reader.readAsText(file);
    });

  if (!ready)
    return (
      <Shell>
        <div className="loading">Carregando seu ateliê de preços…</div>
      </Shell>
    );

  return (
    <ToastContext.Provider value={notify}>
    <Shell>
      <Header view={view} setView={requestView} cfg={cfg} />
      <main className="content">
        {view === "inicio" && (
          <Inicio
            ing={ing} emb={emb} par={par} prod={prod} cfg={cfg}
            costPerMinute={costPerMinute}
            goTo={requestView} onEditProduct={goToEdit}
          />
        )}
        {view === "precificar" && (
          <Precificar
            ing={ing} emb={emb} par={par} prod={prod} cfg={cfg}
            costPerMinute={costPerMinute} saveProd={saveProd}
            editTarget={editTarget} clearEditTarget={() => setEditTarget(null)}
            goCadastros={() => requestView("ingredientes")}
            onDirty={setUnsaved}
          />
        )}
        {view === "produtos" && (
          <Produtos
            prod={prod} ing={ing} emb={emb} par={par} cfg={cfg}
            costPerMinute={costPerMinute} saveProd={saveProd}
            onEdit={goToEdit} goPrecificar={() => { setEditTarget(null); setView("precificar"); }}
          />
        )}
        {view === "ingredientes" && (
          <Cadastro
            title="Ingredientes" icon={<Carrot size={20} />}
            data={ing} save={saveIng}
            unitOptions={["g", "ml", "un"]}
            qtyLabel="Quantidade na embalagem (g/ml/un)"
            nameLabel="Ingrediente"
            seed={ing.length === 0 ? loadSeed : null}
            usageOf={ingredientUsage}
          />
        )}
        {view === "embalagens" && (
          <Cadastro
            title="Embalagens" icon={<Package size={20} />}
            data={emb} save={saveEmb}
            unitOptions={["un", "cm"]}
            qtyLabel="Quantidade na embalagem (un/cm)"
            nameLabel="Embalagem"
            seed={emb.length === 0 ? loadSeed : null}
            usageOf={packagingUsage}
          />
        )}
        {view === "parametros" && (
          <Parametros par={par} save={savePar} costPerMinute={costPerMinute} onDirty={setUnsaved} />
        )}
        {view === "config" && (
          <Configuracoes cfg={cfg} save={saveCfg} onExport={exportData} onImport={importData}
            counts={{ ing: ing.length, emb: emb.length, prod: prod.length }} onDirty={setUnsaved} />
        )}
      </main>
      <ToastViewport toasts={toasts} />
      {pendingView && (
        <div className="modal-overlay" onClick={cancelLeave}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-ico"><AlertTriangle size={22} /></div>
            <h3>Alterações não salvas</h3>
            <p>Você editou esta seção mas ainda não salvou. Se sair agora, as alterações serão perdidas.</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={cancelLeave}>Continuar editando</button>
              <button className="btn primary" onClick={confirmLeave}>Sair sem salvar</button>
            </div>
          </div>
        </div>
      )}
      <Style />
    </Shell>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  SHELL + HEADER                                                     */
/* ------------------------------------------------------------------ */
function Shell({ children }) {
  return <div className="app">{children}</div>;
}

function Header({ view, setView, cfg }) {
  const tabs = [
    { id: "inicio", label: "Início", icon: <Home size={17} /> },
    { id: "precificar", label: "Precificar", icon: <Calculator size={17} /> },
    { id: "produtos", label: "Produtos", icon: <FolderOpen size={17} /> },
    { id: "ingredientes", label: "Ingredientes", icon: <Carrot size={17} /> },
    { id: "embalagens", label: "Embalagens", icon: <Package size={17} /> },
    { id: "parametros", label: "Parâmetros", icon: <SlidersHorizontal size={17} /> },
    { id: "config", label: "Configurações", icon: <Settings size={17} /> },
  ];
  const hasBrand = cfg && (cfg.bizName || cfg.logo);
  return (
    <header className="head">
      <div className="brand">
        <div className={"brand-mark" + (cfg?.logo ? " has-logo" : "")}>
          {cfg?.logo ? <img src={cfg.logo} alt="logo" /> : <ChefHat size={22} />}
        </div>
        <div>
          <h1>{hasBrand && cfg.bizName ? cfg.bizName : "Ateliê de Preços"}</h1>
          <p>{hasBrand && cfg.bizName ? "precificação de produtos" : "módulo de precificação de produtos"}</p>
        </div>
      </div>
      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={"tab" + (view === t.id ? " on" : "")}
            onClick={() => setView(t.id)}
          >
            {t.icon}<span>{t.label}</span>
          </button>
        ))}
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  INÍCIO / RESUMO (dashboard)                                        */
/* ------------------------------------------------------------------ */
function Inicio({ ing, emb, par, prod, cfg, costPerMinute, goTo, onEditProduct }) {
  const monthlyH = n(par.hoursPerDay) * n(par.daysPerWeek) * 4.33;
  const paramsOk = monthlyH > 0 && n(par.desiredEarnings) > 0;

  const steps = [
    { done: paramsOk, label: "Configure seus parâmetros", desc: "mão de obra e custos fixos mensais", view: "parametros" },
    { done: ing.length > 0, label: "Cadastre seus ingredientes", desc: ing.length > 0 ? `${ing.length} cadastrado(s)` : "nenhum ainda", view: "ingredientes" },
    { done: emb.length > 0, label: "Cadastre suas embalagens", desc: emb.length > 0 ? `${emb.length} cadastrada(s)` : "nenhuma ainda", view: "embalagens" },
    { done: prod.length > 0, label: "Precifique seu primeiro produto", desc: prod.length > 0 ? `${prod.length} produto(s)` : "nenhum ainda", view: "precificar" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  const ativos = prod.filter((p) => p.status !== "inativo").length;
  const inativos = prod.length - ativos;

  const flagged = prod
    .map((p) => ({ p, calc: computeProduct(p, { ing, emb, par, costPerMinute }) }))
    .map(({ p, calc }) => {
      let reason = null;
      if (calc.suggestedUnit <= 0) reason = "precificação incompleta";
      else if (calc.orphanIng + calc.orphanPack > 0) reason = "usa item removido do cadastro";
      else if (calc.sale > 0 && calc.sale < calc.costPerUnit) reason = "vendendo abaixo do custo";
      return reason ? { p, reason } : null;
    })
    .filter(Boolean);

  const greeting = cfg?.bizName ? cfg.bizName : "Bem-vinda ao seu ateliê de preços";

  return (
    <div className="page">
      <div className="dash-hero">
        <div className="dash-hero-l">
          {cfg?.logo && <div className="dash-logo"><img src={cfg.logo} alt="logo" /></div>}
          <div>
            <h2 className="dash-title">{greeting}</h2>
            <p className="dash-sub">Um panorama rápido da sua precificação.</p>
          </div>
        </div>
        <button className="btn primary" onClick={() => goTo("precificar")}><Plus size={16} /> Novo produto</button>
      </div>

      {/* GUIA DE PRIMEIRO USO */}
      {!allDone && (
        <div className="card onboard">
          <h3 className="card-h"><Sparkles size={16} /> Comece por aqui ({doneCount}/{steps.length})</h3>
          <p className="onboard-intro">Para os preços saírem corretos, configure o sistema nesta ordem. Sem os parâmetros, a mão de obra e os custos fixos não entram no cálculo.</p>
          <div className="onboard-steps">
            {steps.map((s, i) => (
              <button key={i} className={"onboard-step" + (s.done ? " done" : "")} onClick={() => goTo(s.view)}>
                <span className="ob-check">{s.done ? <Check size={15} /> : i + 1}</span>
                <span className="ob-text"><b>{s.label}</b><em>{s.desc}</em></span>
                <span className="ob-go">{s.done ? "revisar" : "configurar"}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* RESUMO EM NÚMEROS */}
      <div className="dash-stats">
        <button className="dash-stat" onClick={() => goTo("produtos")}>
          <span className="ds-label">Produtos</span>
          <span className="ds-value">{prod.length}</span>
          <span className="ds-foot">{ativos} ativos · {inativos} inativos</span>
        </button>
        <button className="dash-stat" onClick={() => goTo("ingredientes")}>
          <span className="ds-label">Ingredientes</span>
          <span className="ds-value">{ing.length}</span>
          <span className="ds-foot">no cadastro</span>
        </button>
        <button className="dash-stat" onClick={() => goTo("embalagens")}>
          <span className="ds-label">Embalagens</span>
          <span className="ds-value">{emb.length}</span>
          <span className="ds-foot">no cadastro</span>
        </button>
        <button className="dash-stat" onClick={() => goTo("parametros")}>
          <span className="ds-label">Custo por minuto</span>
          <span className="ds-value">{brl(costPerMinute)}</span>
          <span className="ds-foot">{paramsOk ? "mão de obra + fixos" : "parâmetros não definidos"}</span>
        </button>
      </div>

      {/* PRODUTOS QUE MERECEM ATENÇÃO */}
      {prod.length > 0 && (
        <div className="card">
          <h3 className="card-h"><AlertTriangle size={16} /> Produtos que merecem atenção</h3>
          {flagged.length === 0 ? (
            <div className="attn-ok"><Check size={16} /> Nenhum produto com alerta. Tudo certo por aqui!</div>
          ) : (
            <div className="attn-list">
              {flagged.map(({ p, reason }) => (
                <button key={p.id} className="attn-row" onClick={() => onEditProduct(p)}>
                  <span className="attn-name">{p.name || "(sem nome)"}</span>
                  <span className="attn-reason">{reason}</span>
                  <Pencil size={14} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CADASTRO genérico (ingredientes / embalagens)                      */
/* ------------------------------------------------------------------ */
function Cadastro({ title, icon, data, save, unitOptions, qtyLabel, nameLabel, seed, usageOf }) {
  const notify = useNotify();
  const isIng = title === "Ingredientes";
  const blank = { name: "", packageValue: "", packageQty: "", unit: unitOptions[0] };
  const [form, setForm] = useState(blank);
  const [confirmDel, setConfirmDel] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [rowDraft, setRowDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [rowErrors, setRowErrors] = useState({});

  /* formata um valor monetário para o padrão BR com 2 casas: "100" -> "100,00" */
  const moneyFmt = money2;

  const add = () => {
    const errs = {
      name: !form.name.trim(),
      packageValue: n(form.packageValue) <= 0,
      packageQty: n(form.packageQty) <= 0,
    };
    if (errs.name || errs.packageValue || errs.packageQty) {
      setErrors(errs);
      notify("warn", "Preencha nome, valor e quantidade da embalagem.");
      return;
    }
    setErrors({});
    save([...data, { id: uid(), ...form, packageValue: moneyFmt(form.packageValue) }]);
    setForm(blank);
    notify("ok", isIng ? "Ingrediente adicionado." : "Embalagem adicionada.");
  };
  const removeNow = (id) => {
    save(data.filter((x) => x.id !== id));
    setConfirmDel(null);
    notify("ok", isIng ? "Ingrediente removido." : "Embalagem removida.");
  };
  const tryDel = (id) => { setEditingId(null); setConfirmDel(id); };
  const startEdit = (row) => { setConfirmDel(null); setRowErrors({}); setEditingId(row.id); setRowDraft({ ...row }); };
  const cancelEdit = () => { setEditingId(null); setRowDraft(null); setRowErrors({}); };
  const editRow = (patch) => { setRowDraft((d) => ({ ...d, ...patch })); setRowErrors({}); };
  const saveEdit = () => {
    const errs = {
      name: !rowDraft.name.trim(),
      packageValue: n(rowDraft.packageValue) <= 0,
      packageQty: n(rowDraft.packageQty) <= 0,
    };
    if (errs.name || errs.packageValue || errs.packageQty) {
      setRowErrors(errs);
      notify("warn", "Preencha nome, valor e quantidade da embalagem.");
      return;
    }
    const clean = { ...rowDraft, packageValue: moneyFmt(rowDraft.packageValue) };
    save(data.map((x) => (x.id === clean.id ? clean : x)));
    setEditingId(null);
    setRowDraft(null);
    setRowErrors({});
    notify("ok", isIng ? "Ingrediente atualizado." : "Embalagem atualizada.");
  };
  const loadExamples = () => { if (seed) { seed(); notify("ok", "Dados de exemplo carregados."); } };

  const confirmItem = confirmDel ? data.find((x) => x.id === confirmDel) : null;
  const confirmUses = confirmDel && usageOf ? usageOf(confirmDel) : 0;

  return (
    <div className="page">
      <SectionTitle icon={icon} title={title} sub={`Custo unitário = valor ÷ quantidade da embalagem`} />

      <div className="card form-card">
        <div className="grid-form">
          <Field label={nameLabel} wide>
            <input className={errors.name ? "input-error" : ""} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors({}); }}
              placeholder={`Ex.: ${title === "Ingredientes" ? "Leite Condensado" : "Saquinho Celofane"}`} />
          </Field>
          <Field label="Valor da embalagem (R$)">
            <NumInput className={errors.packageValue ? "input-error" : ""} value={form.packageValue} onChange={(v) => { setForm({ ...form, packageValue: v }); setErrors({}); }} onBlur={() => setForm((f) => ({ ...f, packageValue: moneyFmt(f.packageValue) }))} placeholder="0,00" />
          </Field>
          <Field label={qtyLabel}>
            <NumInput className={errors.packageQty ? "input-error" : ""} value={form.packageQty} onChange={(v) => { setForm({ ...form, packageQty: v }); setErrors({}); }} placeholder="0" />
          </Field>
          <Field label="Unidade">
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {unitOptions.map((u) => <option key={u}>{u}</option>)}
            </select>
          </Field>
        </div>
        <button className="btn primary" onClick={add}><Plus size={16} /> Adicionar</button>
      </div>

      {confirmItem && confirmUses > 0 && (
        <div className="warn-banner">
          <AlertTriangle size={18} />
          <span>
            <b>{confirmItem.name || "Este item"}</b> está sendo usado em <b>{confirmUses} {confirmUses === 1 ? "produto" : "produtos"}</b>.
            Se confirmar a exclusão (botão ✓ na linha), esse(s) produto(s) ficará(ão) com o custo incompleto.
          </span>
        </div>
      )}

      {data.length === 0 ? (
        <Empty
          text={`Nenhum ${title.toLowerCase().slice(0, -1)} cadastrado ainda.`}
          action={seed ? { label: "Carregar dados de exemplo", fn: loadExamples } : null}
        />
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th>{nameLabel}</th>
                <th>Valor (R$)</th>
                <th>Qtd. emb.</th>
                <th>Un.</th>
                <th>Custo / un.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((x) => {
                const isEditing = editingId === x.id;
                const isConfirm = confirmDel === x.id;
                const rowData = isEditing ? rowDraft : x;
                return (
                  <tr key={x.id} className={isEditing ? "row-editing" : ""}>
                    <td>{isEditing
                      ? <input className={"cell" + (rowErrors.name ? " input-error" : "")} value={rowDraft.name} onChange={(e) => editRow({ name: e.target.value })} />
                      : <span className="cell-text">{x.name}</span>}</td>
                    <td className="r">{isEditing
                      ? <NumInput className={"cell num" + (rowErrors.packageValue ? " input-error" : "")} value={rowDraft.packageValue} onChange={(v) => editRow({ packageValue: v })} onBlur={() => setRowDraft((d) => ({ ...d, packageValue: moneyFmt(d.packageValue) }))} />
                      : <span className="cell-text">{moneyFmt(x.packageValue)}</span>}</td>
                    <td className="r">{isEditing
                      ? <NumInput className={"cell num" + (rowErrors.packageQty ? " input-error" : "")} value={rowDraft.packageQty} onChange={(v) => editRow({ packageQty: v })} />
                      : <span className="cell-text">{x.packageQty}</span>}</td>
                    <td>{isEditing
                      ? <select className="cell" value={rowDraft.unit} onChange={(e) => editRow({ unit: e.target.value })}>{unitOptions.map((u) => <option key={u}>{u}</option>)}</select>
                      : <span className="muted">{x.unit}</span>}</td>
                    <td className="r accent strong">{brl(unitCost(rowData))}<span className="per">/{rowData.unit}</span></td>
                    <td>
                      <div className="cat-actions">
                        {isEditing ? (
                          <>
                            <button className="icon-btn confirm-del" title="Salvar" onClick={saveEdit}><Check size={15} /></button>
                            <button className="icon-btn" title="Cancelar" onClick={cancelEdit}><X size={15} /></button>
                          </>
                        ) : isConfirm ? (
                          <>
                            <button className="icon-btn confirm-del" title="Confirmar exclusão" onClick={() => removeNow(x.id)}><Check size={15} /></button>
                            <button className="icon-btn" title="Cancelar" onClick={() => setConfirmDel(null)}><X size={15} /></button>
                          </>
                        ) : (
                          <>
                            <button className="icon-btn" title="Editar" onClick={() => startEdit(x)}><Pencil size={15} /></button>
                            <button className="icon-btn del-btn" title="Excluir" onClick={() => tryDel(x.id)}><Trash2 size={15} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PARÂMETROS                                                         */
/* ------------------------------------------------------------------ */
function Parametros({ par, save, costPerMinute, onDirty }) {
  const notify = useNotify();
  const [draft, setDraft] = useState(par);
  const [showCalc, setShowCalc] = useState(false);
  useEffect(() => { setDraft(par); }, [par]);

  const up = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(par);
  useEffect(() => { onDirty && onDirty(dirty); return () => onDirty && onDirty(false); }, [dirty]);
  const monthlyH = n(draft.hoursPerDay) * n(draft.daysPerWeek) * 4.33;

  /* prévia ao vivo do custo por minuto (reflete o rascunho, ainda não salvo) */
  const liveCPM = (() => {
    const ownerH = monthlyH ? n(draft.desiredEarnings) / monthlyH : 0;
    const fixedTotal = (draft.fixedCosts || []).reduce((s, f) => s + n(f.value), 0);
    const fixedH = monthlyH ? fixedTotal / monthlyH : 0;
    const empH = (draft.employees || []).reduce((s, e) => {
      const mh = n(e.hoursPerDay) * n(e.daysPerWeek) * 4.33;
      return s + (mh ? n(e.salary) / mh : 0);
    }, 0);
    return (ownerH + fixedH + empH) / 60;
  })();

  const editList = (list, id, field, val) =>
    draft[list].map((x) => (x.id === id ? { ...x, [field]: val } : x));

  const addFixed = () => { up({ fixedCosts: [...draft.fixedCosts, { id: uid(), name: "", value: "" }] }); notify("ok", "Custo fixo adicionado."); };
  const removeFixed = (id) => { up({ fixedCosts: draft.fixedCosts.filter((x) => x.id !== id) }); notify("ok", "Custo fixo removido."); };
  const addFee = () => { up({ fees: [...draft.fees, { id: uid(), name: "", pct: "" }] }); notify("ok", "Taxa adicionada."); };
  const removeFee = (id) => { up({ fees: draft.fees.filter((x) => x.id !== id) }); notify("ok", "Taxa removida."); };

  const onSave = () => { save(draft); notify("ok", "Parâmetros salvos com sucesso."); };
  const onDiscard = () => { setDraft(par); notify("warn", "Alterações descartadas."); };

  /* valores dinâmicos para o texto do markup */
  const margemNum = n(draft.marginPct);
  const effMargin = Math.min(Math.max(margemNum, 0), 99.9);
  const fator = 100 / (100 - effMargin);
  const margemTxt = margemNum.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const fatorTxt = fator.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

  return (
    <div className="page">
      <SectionTitle icon={<SlidersHorizontal size={20} />} title="Parâmetros do Negócio"
        sub="Mão de obra e custos fixos viram um custo por minuto de produção" />

      {/* ENTENDA O CÁLCULO (recolhível) */}
      <div className="card explain-card collapsible">
        <button className="explain-toggle" onClick={() => setShowCalc((s) => !s)} aria-expanded={showCalc}>
          <span className="et-left"><Calculator size={16} /> <span>Entenda o cálculo</span> <em>como os preços são formados</em></span>
          <ChevronDown size={18} className={"et-chev" + (showCalc ? " open" : "")} />
        </button>
        {showCalc && (
          <div className="explain-body">
            <p className="explain-p">
              A ideia central é transformar tudo o que custa para manter a doceria funcionando — o seu trabalho e as contas fixas — em um único número: o <b>custo por minuto de produção</b>. Assim, cada produto absorve uma fatia justa desses custos conforme o tempo que leva para ser feito.
            </p>

            <div className="explain-steps">
              <div className="explain-step">
                <span className="estep-n">1</span>
                <div>
                  <b>Horas trabalhadas no mês</b>
                  <p>horas por dia × dias por semana × <b>4,33</b>. O 4,33 é a média de semanas em um mês (52 semanas ÷ 12 meses), usada para converter uma rotina semanal em mensal.</p>
                </div>
              </div>
              <div className="explain-step">
                <span className="estep-n">2</span>
                <div>
                  <b>Custo da mão de obra por hora</b>
                  <p>quanto você quer ganhar no mês ÷ horas trabalhadas no mês. É o valor que a sua hora de trabalho precisa "render".</p>
                </div>
              </div>
              <div className="explain-step">
                <span className="estep-n">3</span>
                <div>
                  <b>Custo fixo por hora</b>
                  <p>soma de todos os custos fixos mensais (água, luz, aluguel…) ÷ as mesmas horas do mês. Distribui as contas fixas pelas horas em que você realmente produz.</p>
                </div>
              </div>
              <div className="explain-step">
                <span className="estep-n">4</span>
                <div>
                  <b>Custo por minuto</b>
                  <p>(custo de mão de obra por hora + custo fixo por hora) ÷ 60. É o número aplicado em cada receita.</p>
                </div>
              </div>
            </div>

            <p className="explain-p" style={{ marginTop: 4 }}>
              <b>Como isso forma o preço de cada produto:</b>
            </p>
            <div className="explain-chain">
              <span>Ingredientes da receita</span><i>+</i>
              <span>Embalagem × rendimento</span><i>+</i>
              <span>Minutos de produção × custo por minuto</span><i>=</i>
              <span className="chain-strong">Custo total da receita</span>
            </div>
            <div className="explain-chain">
              <span className="chain-strong">Custo total da receita</span><i>÷</i>
              <span>Rendimento (unidades)</span><i>=</i>
              <span className="chain-strong">Custo por unidade</span><i>×</i>
              <span>Markup da margem</span><i>=</i>
              <span className="chain-strong">Preço sugerido</span>
            </div>
            <p className="explain-note">
              O <b>markup</b> vem da margem desejada: 100 ÷ (100 − margem%). Com {margemTxt}%, o fator é aproximadamente {fatorTxt}. Ou seja, o preço é definido para que o lucro seja de {margemTxt}% <i>sobre o preço de venda</i> (e não sobre o custo).
            </p>
          </div>
        )}
      </div>

      <div className="param-grid">
        {/* MÃO DE OBRA */}
        <div className="card">
          <h3 className="card-h"><Clock size={16} /> Mão de obra (você)</h3>
          <Field label="Quanto deseja ganhar no mês? (R$)">
            <NumInput value={draft.desiredEarnings} onChange={(v) => up({ desiredEarnings: v })} onBlur={() => up({ desiredEarnings: money2(draft.desiredEarnings) })} />
          </Field>
          <div className="two">
            <Field label="Horas por dia">
              <NumInput value={draft.hoursPerDay} onChange={(v) => up({ hoursPerDay: v })} />
            </Field>
            <Field label="Dias por semana">
              <NumInput value={draft.daysPerWeek} onChange={(v) => up({ daysPerWeek: v })} />
            </Field>
          </div>
          <div className="mini-note">Horas trabalhadas no mês: <b>{monthlyH.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h</b> <span className="muted">(h/dia × dias/sem × 4,33)</span></div>
          <div className="calc-explain">
            <p><b>Como entra no preço:</b> o quanto você quer ganhar por mês é convertido em um valor por hora e por minuto do seu trabalho. Cada produto "paga" essa mão de obra conforme o tempo que leva para ser feito.</p>
            <div className="calc-steps">
              <div><span>Custo da sua hora</span><b>{brl(monthlyH ? n(draft.desiredEarnings) / monthlyH : 0)}</b></div>
              <div className="muted-step">ganho mensal ÷ horas no mês</div>
              <div><span>Custo do seu minuto</span><b>{brl(monthlyH ? n(draft.desiredEarnings) / monthlyH / 60 : 0)}</b></div>
              <div className="muted-step">custo da hora ÷ 60</div>
            </div>
          </div>
          {monthlyH === 0 && (n(draft.desiredEarnings) > 0 || draft.fixedCosts.some((f) => n(f.value) > 0)) && (
            <div className="param-warn"><AlertTriangle size={15} /><span>Defina horas por dia e dias por semana. Sem isso, sua mão de obra e os custos fixos <b>não entram no preço</b> dos produtos.</span></div>
          )}
        </div>
        <div className="card">
          <h3 className="card-h"><Layers size={16} /> Custos fixos mensais</h3>
          {draft.fixedCosts.map((f) => (
            <div className="row-line" key={f.id}>
              <input className="cell" value={f.name} onChange={(e) => up({ fixedCosts: editList("fixedCosts", f.id, "name", e.target.value) })} />
              <NumInput className="cell num" value={f.value} onChange={(v) => up({ fixedCosts: editList("fixedCosts", f.id, "value", v) })} onBlur={() => up({ fixedCosts: editList("fixedCosts", f.id, "value", money2(f.value)) })} placeholder="R$" />
              <button className="icon-btn" onClick={() => removeFixed(f.id)}><X size={14} /></button>
            </div>
          ))}
          <button className="btn ghost sm" onClick={addFixed}><Plus size={14} /> Adicionar custo</button>
          <div className="mini-note">Total: <b>{brl(draft.fixedCosts.reduce((s, f) => s + n(f.value), 0))}</b>/mês</div>
        </div>

        {/* MARGEM + TAXAS */}
        <div className="card">
          <h3 className="card-h"><TrendingUp size={16} /> Margem & Taxas</h3>
          <Field label="Margem de lucro desejada (%)">
            <NumInput value={draft.marginPct} onChange={(v) => up({ marginPct: v })} />
          </Field>
          {(n(draft.marginPct) >= 100 || n(draft.marginPct) < 0) ? (
            <div className="param-warn"><AlertTriangle size={15} /><span>A margem deve ficar entre 0% e 99,9%. Margem de 100% ou mais é impossível (o preço seria infinito).</span></div>
          ) : (
            <div className="mini-note">Markup aplicado: <b>{(100 / (100 - Math.min(Math.max(n(draft.marginPct), 0), 99.9))).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}×</b></div>
          )}
          <div style={{ height: 12 }} />
          <Field label="Arredondar preço sugerido">
            <select value={draft.rounding || "none"} onChange={(e) => up({ rounding: e.target.value })}>
              {ROUNDING_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </Field>
          <div className="sep" />
          <label className="lbl">Taxas de plataforma / pagamento (%)</label>
          {draft.fees.map((f) => (
            <div className="row-line" key={f.id}>
              <input className="cell" value={f.name} onChange={(e) => up({ fees: editList("fees", f.id, "name", e.target.value) })} />
              <NumInput className="cell num" value={f.pct} onChange={(v) => up({ fees: editList("fees", f.id, "pct", v) })} placeholder="%" />
              <button className="icon-btn" onClick={() => removeFee(f.id)}><X size={14} /></button>
            </div>
          ))}
          <button className="btn ghost sm" onClick={addFee}><Plus size={14} /> Adicionar taxa</button>
        </div>
      </div>

      <div className="highlight-bar">
        <Sparkles size={18} />
        <span>Custo por minuto de produção:</span>
        <strong>{brl(liveCPM)}</strong>
        <span className="muted">{dirty ? "— prévia; salve para aplicar nas receitas" : "— usado para ratear mão de obra e custos fixos em cada receita"}</span>
      </div>

      {/* BARRA DE SALVAMENTO */}
      <div className={"save-bar" + (dirty ? " on" : "")}>
        <span className="save-state">
          {dirty
            ? <><span className="dot" /> Você tem alterações não salvas</>
            : <><Check size={15} /> Todos os parâmetros estão salvos</>}
        </span>
        <div className="save-bar-actions">
          {dirty && <button className="btn ghost sm" onClick={onDiscard}>Descartar</button>}
          <button className="btn primary sm" onClick={onSave} disabled={!dirty}><Save size={15} /> Salvar alterações</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PRECIFICAR PRODUTO                                                 */
/* ------------------------------------------------------------------ */
function Precificar({ ing, emb, par, prod, cfg, costPerMinute, saveProd, editTarget, clearEditTarget, goCadastros, onDirty }) {
  const newProduct = () => ({
    id: uid(), name: "",
    items: [{ id: uid(), ingredientId: "", qty: "" }],
    yield: "",
    packs: [{ id: uid(), packagingId: "", qty: "" }],
    minutes: "",
    salePrice: "",
    discountPct: "",
  });
  const [p, setP] = useState(newProduct());
  const [showFicha, setShowFicha] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [perr, setPerr] = useState({});
  const notify = useNotify();

  /* recebe um produto vindo do catálogo para edição */
  useEffect(() => {
    if (editTarget) {
      setP({ ...newProduct(), ...editTarget });
      clearEditTarget && clearEditTarget();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [editTarget]);

  const up = (patch) => { setP({ ...p, ...patch }); if (Object.keys(perr).length) setPerr({}); };
  const novo = () => { setP(newProduct()); notify("ok", "Novo produto iniciado."); };

  /* detecção de alterações não salvas (produto em edição) */
  const sig = (x) => JSON.stringify({
    name: (x.name || "").trim(),
    items: (x.items || []).filter((it) => it.ingredientId).map((it) => [it.ingredientId, String(it.qty ?? "").trim()]),
    packs: (x.packs || []).filter((pk) => pk.packagingId).map((pk) => [pk.packagingId, String(pk.qty ?? "").trim()]),
    yield: String(x.yield ?? "").trim(),
    minutes: String(x.minutes ?? "").trim(),
    salePrice: String(x.salePrice ?? "").trim(),
    discountPct: String(x.discountPct ?? "").trim(),
    status: x.status || "ativo",
  });
  const savedVersion = prod.find((x) => x.id === p.id);
  const dirty = savedVersion ? sig(p) !== sig(savedVersion) : sig(p) !== sig({});
  useEffect(() => { onDirty && onDirty(dirty); return () => onDirty && onDirty(false); }, [dirty]);
  const askNovo = () => { if (dirty) setConfirmNew(true); else novo(); };
  const confirmNovo = () => { setConfirmNew(false); novo(); };

  if (ing.length === 0 && emb.length === 0)
    return (
      <div className="page">
        <Empty
          big
          text="Para precificar, cadastre primeiro seus ingredientes e embalagens."
          action={{ label: "Ir para cadastros", fn: goCadastros }}
        />
      </div>
    );

  /* ---------- cálculos ---------- */
  const ingById = (id) => ing.find((x) => x.id === id);
  const embById = (id) => emb.find((x) => x.id === id);

  const calc = computeProduct(p, { ing, emb, par, costPerMinute });
  const {
    ingredientsCost, packPerUnit, yld, laborFixed, totalRecipe, costPerUnit,
    suggestedRecipe, suggestedUnit, sale, realMargin, profit,
    resalePrice, resaleMargin, resaleProfit,
  } = calc;

  /* cenários que comprometem a precificação */
  const warnings = [];
  if (!yld) warnings.push("Defina o rendimento (quantas unidades a receita rende) — sem ele o custo por unidade e o preço ficam zerados.");
  if (calc.ingredientRows.length === 0) warnings.push("Nenhum ingrediente adicionado: o custo está incompleto.");
  if (calc.orphanIng > 0) warnings.push(`${calc.orphanIng} ingrediente(s) desta receita foi(ram) removido(s) do cadastro e não estão sendo contabilizados.`);
  if (calc.orphanPack > 0) warnings.push(`${calc.orphanPack} embalagem(ns) desta receita foi(ram) removida(s) do cadastro e não está(ão) sendo contabilizada(s).`);
  if (n(p.minutes) > 0 && costPerMinute === 0) warnings.push("O tempo de produção não está entrando no custo: configure horas de trabalho e custos fixos na aba Parâmetros.");
  if (calc.marginInvalid) warnings.push("A margem definida em Parâmetros é inválida (deve ser entre 0% e 99,9%); o cálculo usou o limite seguro mais próximo.");
  if (sale > 0 && sale < costPerUnit) warnings.push("O preço de venda informado está abaixo do custo por unidade — você teria prejuízo nessa venda.");

  const printFicha = () => {
    setShowFicha(true);
    setTimeout(() => window.print(), 120);
  };

  const save = () => {
    const hasIngredient = (p.items || []).some((it) => it.ingredientId && n(it.qty) > 0);
    const errs = {
      name: !p.name.trim(),
      items: !hasIngredient,
      yield: n(p.yield) <= 0,
      minutes: n(p.minutes) <= 0,
    };
    if (errs.name || errs.items || errs.yield || errs.minutes) {
      setPerr(errs);
      const missing = [];
      if (errs.name) missing.push("nome");
      if (errs.items) missing.push("ao menos um ingrediente com quantidade");
      if (errs.yield) missing.push("rendimento");
      if (errs.minutes) missing.push("tempo de produção");
      notify("warn", "Para salvar, preencha: " + missing.join(", ") + ".");
      return;
    }
    setPerr({});
    const exists = prod.some((x) => x.id === p.id);
    saveProd(exists ? prod.map((x) => (x.id === p.id ? p : x)) : [...prod, p]);
    notify("ok", exists ? "Alterações salvas com sucesso." : "Produto salvo com sucesso.");
  };

  return (
    <div className="page two-col">
      {/* ---------------- COLUNA: MONTAGEM ---------------- */}
      <div className="col-build">
        <SectionTitle icon={<Calculator size={20} />} title="Precificar produto"
          sub="Monte a receita e veja o custo e o preço sugerido em tempo real" />

        <div className="card">
          <Field label="Nome do produto" wide>
            <input className={perr.name ? "input-error" : ""} value={p.name} onChange={(e) => up({ name: e.target.value })} placeholder="Ex.: Brigadeiro Gourmet" />
          </Field>
        </div>

        {/* INGREDIENTES */}
        <div className="card">
          <h3 className="card-h"><Carrot size={16} /> Ingredientes da receita</h3>
          {p.items.map((it) => {
            const ic = unitCost(ingById(it.ingredientId)) * n(it.qty);
            return (
              <div className="line3" key={it.id}>
                <select value={it.ingredientId} onChange={(e) => up({ items: p.items.map((x) => x.id === it.id ? { ...x, ingredientId: e.target.value } : x) })}>
                  <option value="">— escolher —</option>
                  {ing.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <div className="qtybox">
                  <NumInput className="num" value={it.qty} onChange={(v) => up({ items: p.items.map((x) => x.id === it.id ? { ...x, qty: v } : x) })} placeholder={ingById(it.ingredientId)?.unit ? "" : "Qtd"} />
                  <span className="unit-tag">{ingById(it.ingredientId)?.unit || ""}</span>
                </div>
                <span className="line-cost">{brl(ic)}</span>
                <button className="icon-btn" onClick={() => up({ items: p.items.filter((x) => x.id !== it.id) })}><X size={14} /></button>
              </div>
            );
          })}
          <button className="btn ghost sm" onClick={() => up({ items: [...p.items, { id: uid(), ingredientId: "", qty: "" }] })}><Plus size={14} /> Ingrediente</button>
          {perr.items && <div className="field-error">Adicione ao menos um ingrediente com quantidade.</div>}
          <div className="sub-total">Total ingredientes (receita): <b>{brl(ingredientsCost)}</b></div>
        </div>

        {/* RENDIMENTO */}
        <div className="card">
          <Field label="Quantas unidades essa receita rende?">
            <NumInput className={perr.yield ? "input-error" : ""} value={p.yield} onChange={(v) => up({ yield: v })} placeholder="Ex.: 20" />
          </Field>
        </div>

        {/* EMBALAGEM */}
        <div className="card">
          <h3 className="card-h"><Package size={16} /> Embalagem (por unidade)</h3>
          {p.packs.map((pk) => {
            const pc = unitCost(embById(pk.packagingId)) * n(pk.qty);
            return (
              <div className="line3" key={pk.id}>
                <select value={pk.packagingId} onChange={(e) => up({ packs: p.packs.map((x) => x.id === pk.id ? { ...x, packagingId: e.target.value } : x) })}>
                  <option value="">— escolher —</option>
                  {emb.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <div className="qtybox">
                  <NumInput className="num" value={pk.qty} onChange={(v) => up({ packs: p.packs.map((x) => x.id === pk.id ? { ...x, qty: v } : x) })} placeholder={embById(pk.packagingId)?.unit ? "" : "Qtd"} />
                  <span className="unit-tag">{embById(pk.packagingId)?.unit || ""}</span>
                </div>
                <span className="line-cost">{brl(pc)}</span>
                <button className="icon-btn" onClick={() => up({ packs: p.packs.filter((x) => x.id !== pk.id) })}><X size={14} /></button>
              </div>
            );
          })}
          <button className="btn ghost sm" onClick={() => up({ packs: [...p.packs, { id: uid(), packagingId: "", qty: "" }] })}><Plus size={14} /> Embalagem</button>
          <div className="sub-total">Embalagem por unidade: <b>{brl(packPerUnit)}</b></div>
        </div>

        {/* TEMPO */}
        <div className="card">
          <Field label="Quantos minutos para produzir a receita inteira?">
            <NumInput className={perr.minutes ? "input-error" : ""} value={p.minutes} onChange={(v) => up({ minutes: v })} placeholder="Ex.: 45" />
          </Field>
          <div className="mini-note">Mão de obra + custos fixos rateados: <b>{brl(laborFixed)}</b> <span className="muted">({brl(costPerMinute)}/min)</span></div>
        </div>
      </div>

      {/* ---------------- COLUNA: RESULTADO ---------------- */}
      <div className="col-result">
        <div className="result-card">
          <div className="result-head">
            <span className="result-title">{p.name || "Seu produto"}</span>
            <div className="result-actions">
              <button className="btn ghost sm" onClick={askNovo} title="Começar um novo produto"><Plus size={15} /> Novo</button>
              <button className="btn ghost sm" onClick={printFicha} title="Gerar ficha técnica"><FileText size={15} /> Ficha</button>
              <button className="btn primary sm" onClick={save}><Save size={15} /> Salvar</button>
            </div>
          </div>

          <div className="hero-price">
            <span className="hero-label">Preço sugerido por unidade</span>
            <span className="hero-value">{brl(suggestedUnit)}</span>
            <span className="hero-sub">margem alvo de {calc.marginPct.toLocaleString("pt-BR")}% · receita inteira {brl(suggestedRecipe)}</span>
          </div>

          {warnings.length > 0 && (
            <div className="calc-warn">
              {warnings.map((w, i) => (
                <div className="calc-warn-row" key={i}><AlertTriangle size={15} /><span>{w}</span></div>
              ))}
            </div>
          )}

          <div className="break">
            <Line label="Ingredientes (receita)" val={ingredientsCost} />
            <Line label="Embalagem (× rendimento)" val={packPerUnit * yld} />
            <Line label="Mão de obra + fixos" val={laborFixed} />
            <Line label="Custo total da receita" val={totalRecipe} bold />
            <Line label="Custo por unidade" val={costPerUnit} accent />
          </div>

          {/* CALCULADORA DE LUCRO */}
          <div className="calc-block">
            <h4><Tag size={15} /> Calculadora de lucro</h4>
            <Field label="Por qual valor deseja vender a unidade?">
              <NumInput value={p.salePrice} onChange={(v) => up({ salePrice: v })} onBlur={() => up({ salePrice: money2(p.salePrice) })} placeholder={suggestedUnit ? suggestedUnit.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0,00"} />
            </Field>
            <div className="two-stat">
              <Stat label="Margem de lucro" value={pct(realMargin)} good={realMargin > 0} />
              <Stat label="Lucro por unidade" value={brl(profit)} good={profit > 0} />
            </div>
          </div>

          {/* PLATAFORMAS */}
          {sale > 0 && (
            <div className="calc-block">
              <h4><Percent size={15} /> Para manter o preço nas plataformas</h4>
              <div className="fees">
                {par.fees.map((f) => {
                  const factor = (100 - n(f.pct)) / 100;
                  return (
                    <div className="fee-row" key={f.id}>
                      <span>{f.name} <em>({n(f.pct).toLocaleString("pt-BR")}%)</em></span>
                      <b>{factor > 0 ? brl(sale / factor) : "—"}</b>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* REVENDA */}
          {sale > 0 && (
            <div className="calc-block">
              <h4><TrendingUp size={15} /> Cálculo para revenda</h4>
              <Field label="Desconto para revendedor (%)">
                <NumInput value={p.discountPct} onChange={(v) => up({ discountPct: v })} placeholder="Ex.: 15" />
              </Field>
              <div className="three-stat">
                <Stat label="Preço final" value={brl(resalePrice)} />
                <Stat label="Margem" value={pct(resaleMargin)} good={resaleMargin > 0} />
                <Stat label="Lucro/un." value={brl(resaleProfit)} good={resaleProfit > 0} />
              </div>
            </div>
          )}
        </div>
      </div>

      {showFicha && (
        <FichaTecnica
          name={p.name || "Produto sem nome"}
          calc={calc}
          cfg={cfg}
          onClose={() => setShowFicha(false)}
          onPrint={() => window.print()}
        />
      )}

      {confirmNew && (
        <div className="modal-overlay" onClick={() => setConfirmNew(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-ico"><AlertTriangle size={22} /></div>
            <h3>Produto não salvo</h3>
            <p>Você tem alterações não salvas neste produto. Começar um novo vai descartá-las.</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmNew(false)}>Continuar editando</button>
              <button className="btn primary" onClick={confirmNovo}>Descartar e começar novo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
/* ------------------------------------------------------------------ */
/*  PRODUTOS (catálogo / consulta de preços)                           */
/* ------------------------------------------------------------------ */
function Produtos({ prod, ing, emb, par, cfg, costPerMinute, saveProd, onEdit, goPrecificar }) {
  const notify = useNotify();
  const [q, setQ] = useState("");
  const [fichaFor, setFichaFor] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [filter, setFilter] = useState("todos");
  const [sort, setSort] = useState("nome");
  const [showLista, setShowLista] = useState(false);

  const isActive = (p) => p.status !== "inativo";
  const toggleStatus = (id) => {
    const p = prod.find((x) => x.id === id);
    const nowActive = !isActive(p);
    saveProd(prod.map((x) => (x.id === id ? { ...x, status: nowActive ? "ativo" : "inativo" } : x)));
    notify("ok", nowActive ? "Produto reativado." : "Produto inativado.");
  };

  const del = (id) => {
    saveProd(prod.filter((x) => x.id !== id));
    setConfirmId(null);
    notify("ok", "Produto excluído.");
  };

  const duplicate = (p) => {
    const copy = {
      ...JSON.parse(JSON.stringify(p)),
      id: uid(),
      name: (p.name || "Produto") + " (cópia)",
      status: "ativo",
    };
    if (Array.isArray(copy.items)) copy.items = copy.items.map((it) => ({ ...it, id: uid() }));
    if (Array.isArray(copy.packs)) copy.packs = copy.packs.map((pk) => ({ ...pk, id: uid() }));
    saveProd([...prod, copy]);
    notify("ok", "Produto duplicado.");
  };

  const ativos = prod.filter(isActive).length;
  const inativos = prod.length - ativos;

  const marginAtSuggested = (calc) => (calc.suggestedUnit > 0 ? (calc.suggestedUnit - calc.costPerUnit) / calc.suggestedUnit : 0);
  const marginVal = (p, calc) => (calc.sale > 0 ? calc.realMargin : marginAtSuggested(calc));
  const sortFns = {
    nome: (a, b) => (a.p.name || "").localeCompare(b.p.name || "", "pt-BR"),
    margem_desc: (a, b) => marginVal(b.p, b.calc) - marginVal(a.p, a.calc),
    margem_asc: (a, b) => marginVal(a.p, a.calc) - marginVal(b.p, b.calc),
    custo_desc: (a, b) => b.calc.costPerUnit - a.calc.costPerUnit,
    custo_asc: (a, b) => a.calc.costPerUnit - b.calc.costPerUnit,
  };

  const rows = prod
    .map((p) => ({ p, calc: computeProduct(p, { ing, emb, par, costPerMinute }) }))
    .filter(({ p }) => (p.name || "").toLowerCase().includes(q.trim().toLowerCase()))
    .filter(({ p }) =>
      filter === "todos" ? true : filter === "ativos" ? isActive(p) : !isActive(p)
    )
    .sort(sortFns[sort] || sortFns.nome);

  if (prod.length === 0)
    return (
      <div className="page">
        <SectionTitle icon={<FolderOpen size={20} />} title="Produtos precificados"
          sub="Consulte, edite e gere fichas dos produtos já cadastrados" />
        <Empty big
          text="Você ainda não salvou nenhum produto. Precifique um produto e clique em Salvar para ele aparecer aqui."
          action={{ label: "Precificar um produto", fn: goPrecificar }} />
      </div>
    );

  return (
    <div className="page">
      <div className="cat-top">
        <SectionTitle icon={<FolderOpen size={20} />} title="Produtos precificados"
          sub={`${prod.length} ${prod.length === 1 ? "produto cadastrado" : "produtos cadastrados"} · clique para editar a precificação`} />
        <div className="result-actions">
          <button className="btn ghost" onClick={() => setShowLista(true)}><Receipt size={16} /> Lista de preços</button>
          <button className="btn primary" onClick={goPrecificar}><Plus size={16} /> Novo produto</button>
        </div>
      </div>

      <div className="cat-controls">
        <div className="search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto pelo nome…" />
          {q && <button className="icon-btn" onClick={() => setQ("")}><X size={15} /></button>}
        </div>
        <div className="ctrl-right">
          <label className="sort-field">
            <ArrowUpDown size={15} />
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="nome">Nome (A–Z)</option>
              <option value="margem_desc">Maior margem</option>
              <option value="margem_asc">Menor margem</option>
              <option value="custo_desc">Maior custo</option>
              <option value="custo_asc">Menor custo</option>
            </select>
          </label>
          <div className="seg">
            <button className={"seg-btn" + (filter === "todos" ? " on" : "")} onClick={() => setFilter("todos")}>Todos <span>{prod.length}</span></button>
            <button className={"seg-btn" + (filter === "ativos" ? " on" : "")} onClick={() => setFilter("ativos")}>Ativos <span>{ativos}</span></button>
            <button className={"seg-btn" + (filter === "inativos" ? " on" : "")} onClick={() => setFilter("inativos")}>Inativos <span>{inativos}</span></button>
          </div>
        </div>
      </div>

      <div className="card cat-card">
        <table className="tbl cat-tbl">
          <thead>
            <tr>
              <th>Produto</th>
              <th>Custo / un.</th>
              <th>Sugerido / un.</th>
              <th>Venda / un.</th>
              <th>Margem</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="cat-empty">Nenhum produto {filter !== "todos" ? (filter === "ativos" ? "ativo " : "inativo ") : ""}encontrado{q ? ` para “${q}”` : ""}.</td></tr>
            )}
            {rows.map(({ p, calc }) => {
              const hasSale = calc.sale > 0;
              const active = isActive(p);
              return (
                <tr key={p.id} className={active ? "" : "row-off"}>
                  <td>
                    <div className="cat-name-row">
                      <button className="cat-name" onClick={() => onEdit(p)}>{p.name || "(sem nome)"}</button>
                      <button
                        className={"status-pill " + (active ? "on" : "off")}
                        onClick={() => toggleStatus(p.id)}
                        title={active ? "Clique para inativar" : "Clique para reativar"}
                      >
                        {active ? "Ativo" : "Inativo"}
                      </button>
                    </div>
                    <span className="cat-meta">{calc.yld ? `rende ${calc.yld.toLocaleString("pt-BR")} un.` : "rendimento não definido"}</span>
                  </td>
                  <td className="r">{brl(calc.costPerUnit)}</td>
                  <td className="r accent strong">{brl(calc.suggestedUnit)}</td>
                  <td className="r">{hasSale ? brl(calc.sale) : <span className="muted">—</span>}</td>
                  <td className="r">
                    {hasSale
                      ? <span className={calc.realMargin > 0 ? "pos" : "neg"}>{pct(calc.realMargin)}</span>
                      : <span className={marginAtSuggested(calc) > 0 ? "pos" : "neg"} title="margem no preço sugerido">{pct(marginAtSuggested(calc))}</span>}
                  </td>
                  <td>
                    <div className="cat-actions">
                      <button className="icon-btn" title="Editar precificação" onClick={() => onEdit(p)}><Pencil size={15} /></button>
                      <button className="icon-btn" title="Duplicar produto" onClick={() => duplicate(p)}><Copy size={15} /></button>
                      <button className="icon-btn" title="Ficha técnica" onClick={() => setFichaFor(p)}><FileText size={15} /></button>
                      {confirmId === p.id ? (
                        <>
                          <button className="icon-btn confirm-del" title="Confirmar exclusão" onClick={() => del(p.id)}><Check size={15} /></button>
                          <button className="icon-btn" title="Cancelar" onClick={() => setConfirmId(null)}><X size={15} /></button>
                        </>
                      ) : (
                        <button className="icon-btn del-btn" title="Excluir" onClick={() => setConfirmId(p.id)}><Trash2 size={15} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {fichaFor && (
        <FichaTecnica
          name={fichaFor.name || "Produto sem nome"}
          calc={computeProduct(fichaFor, { ing, emb, par, costPerMinute })}
          cfg={cfg}
          onClose={() => setFichaFor(null)}
          onPrint={() => window.print()}
        />
      )}

      {showLista && (
        <ListaPrecos
          products={prod.filter(isActive).map((p) => ({ p, calc: computeProduct(p, { ing, emb, par, costPerMinute }) }))}
          cfg={cfg}
          onClose={() => setShowLista(false)}
          onPrint={() => window.print()}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CONFIGURAÇÕES (identidade da doceria)                              */
/* ------------------------------------------------------------------ */
function Configuracoes({ cfg, save, onExport, onImport, counts, onDirty }) {
  const notify = useNotify();
  const [draft, setDraft] = useState(cfg);
  useEffect(() => { setDraft(cfg); }, [cfg]);
  const up = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg);
  useEffect(() => { onDirty && onDirty(dirty); return () => onDirty && onDirty(false); }, [dirty]);

  const [impMsg, setImpMsg] = useState(null);
  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    fileToLogo(file, (dataUrl) => { up({ logo: dataUrl }); notify("ok", "Logomarca carregada — salve para aplicar."); });
    e.target.value = "";
  };
  const removeLogo = () => { up({ logo: "" }); notify("ok", "Logomarca removida do rascunho."); };
  const onSaveIdentity = () => { save(draft); notify("ok", "Configurações salvas com sucesso."); };
  const onDiscard = () => { setDraft(cfg); notify("warn", "Alterações descartadas."); };
  const onBackupFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onImport(file)
      .then(() => { setImpMsg({ ok: true, text: "Backup importado com sucesso. Seus dados foram restaurados." }); notify("ok", "Backup importado com sucesso."); })
      .catch(() => { setImpMsg({ ok: false, text: "Não foi possível ler este arquivo. Verifique se é um backup válido (.json)." }); notify("err", "Falha ao importar o backup."); });
    e.target.value = "";
  };

  return (
    <div className="page">
      <SectionTitle icon={<Settings size={20} />} title="Configurações"
        sub="Personalize o sistema com a identidade da sua doceria — aplicada nas fichas técnicas" />

      <div className="cfg-grid">
        {/* IDENTIDADE */}
        <div className="card">
          <h3 className="card-h"><Building2 size={16} /> Identidade da doceria</h3>
          <Field label="Nome da doceria" wide>
            <input value={draft.bizName} onChange={(e) => up({ bizName: e.target.value })} placeholder="Ex.: Sou Mais Um Doce" />
          </Field>
          <div style={{ height: 12 }} />
          <Field label="Proprietária / responsável" wide>
            <input value={draft.owner || ""} onChange={(e) => up({ owner: e.target.value })} placeholder="Ex.: Leandra" />
          </Field>
          <div style={{ height: 12 }} />
          <Field label="Slogan / descrição (opcional)" wide>
            <input value={draft.tagline} onChange={(e) => up({ tagline: e.target.value })} placeholder="Ex.: Doces artesanais feitos com carinho" />
          </Field>
          <div className="two" style={{ marginTop: 12 }}>
            <Field label="Telefone / WhatsApp (opcional)">
              <input value={draft.phone} onChange={(e) => up({ phone: maskPhone(e.target.value) })} placeholder="(98) 90000-0000" inputMode="tel" />
            </Field>
            <Field label="Instagram (opcional)">
              <input value={draft.instagram} onChange={(e) => up({ instagram: e.target.value })} placeholder="@suadoceria" />
            </Field>
          </div>
        </div>

        {/* LOGO */}
        <div className="card">
          <h3 className="card-h"><Upload size={16} /> Logomarca</h3>
          <div className="logo-zone">
            <div className="logo-preview">
              {draft.logo
                ? <img src={draft.logo} alt="logomarca" />
                : <div className="logo-empty"><ChefHat size={28} /><span>sem logo</span></div>}
            </div>
            <div className="logo-actions">
              <label className="btn ghost sm logo-upload">
                <Upload size={14} /> {draft.logo ? "Trocar imagem" : "Enviar imagem"}
                <input type="file" accept="image/*" onChange={onFile} hidden />
              </label>
              {draft.logo && (
                <button className="btn ghost sm" onClick={removeLogo}><Trash2 size={14} /> Remover</button>
              )}
              <p className="logo-hint">PNG ou JPG. A imagem é reduzida automaticamente para caber no documento (recomendado fundo transparente).</p>
            </div>
          </div>
        </div>
      </div>

      {/* PRÉVIA DO CABEÇALHO */}
      <div className="card">
        <h3 className="card-h"><FileText size={16} /> Prévia do cabeçalho da ficha</h3>
        <div className="fk-head preview-head">
          <div className="fk-brand">
            <div className={"fk-mark" + (draft.logo ? " img" : "")}>
              {draft.logo ? <img src={draft.logo} alt="logo" /> : <ChefHat size={20} />}
            </div>
            <div>
              <div className="fk-biz">{draft.bizName || "Nome da sua doceria"}</div>
              <div className="fk-doc">Ficha Técnica de Produto</div>
            </div>
          </div>
          <div className="fk-date">{new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</div>
        </div>
        <p className="mini-note" style={{ marginTop: 14 }}>Essas informações aparecem automaticamente no topo e no rodapé de toda ficha técnica que você exportar.</p>
      </div>

      {/* BARRA DE SALVAMENTO (identidade) */}
      <div className={"save-bar" + (dirty ? " on" : "")}>
        <span className="save-state">
          {dirty
            ? <><span className="dot" /> Você tem alterações não salvas na identidade</>
            : <><Check size={15} /> Identidade da doceria salva</>}
        </span>
        <div className="save-bar-actions">
          {dirty && <button className="btn ghost sm" onClick={onDiscard}>Descartar</button>}
          <button className="btn primary sm" onClick={onSaveIdentity} disabled={!dirty}><Save size={15} /> Salvar alterações</button>
        </div>
      </div>

      {/* BACKUP */}
      <div className="card">
        <h3 className="card-h"><Download size={16} /> Backup dos dados</h3>
        <p className="logo-hint" style={{ marginTop: 0, marginBottom: 14 }}>
          Os dados ficam salvos neste navegador. Exporte um backup com frequência para não perder nada ao trocar de dispositivo ou limpar o navegador. Atualmente:{" "}
          <b>{counts?.ing || 0} ingredientes</b>, <b>{counts?.emb || 0} embalagens</b> e <b>{counts?.prod || 0} produtos</b>.
        </p>
        <div className="backup-actions">
          <button className="btn primary sm" onClick={onExport}><Download size={15} /> Exportar backup (.json)</button>
          <label className="btn ghost sm logo-upload">
            <Upload size={15} /> Importar backup
            <input type="file" accept="application/json,.json" onChange={onBackupFile} hidden />
          </label>
        </div>
        <p className="logo-hint" style={{ marginTop: 12 }}>
          Importar substitui os dados atuais pelos do arquivo. Convém exportar um backup antes de importar outro.
        </p>
        {impMsg && (
          <div className={"imp-msg " + (impMsg.ok ? "ok" : "err")}>
            {impMsg.ok ? <Check size={15} /> : <AlertTriangle size={15} />} {impMsg.text}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LISTA DE PREÇOS (clientes / revendedores — imprimível)             */
/* ------------------------------------------------------------------ */
function ListaPrecos({ products, cfg, onClose, onPrint }) {
  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const bizName = (cfg && cfg.bizName) || "Sou Mais Um Doce";
  const items = products
    .map(({ p, calc }) => ({
      name: p.name || "(sem nome)",
      varejo: calc.sale > 0 ? calc.sale : calc.suggestedUnit,
      revenda: calc.sale > 0 && calc.discountPct > 0 ? calc.resalePrice : null,
    }))
    .filter((i) => i.varejo > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const hasRevenda = items.some((i) => i.revenda != null);
  const contactBits = [];
  if (cfg?.phone) contactBits.push(cfg.phone);
  if (cfg?.instagram) contactBits.push(cfg.instagram.startsWith("@") ? cfg.instagram : "@" + cfg.instagram);

  return (
    <div className="ficha-overlay" onClick={onClose}>
      <div className="ficha-scroll" onClick={(e) => e.stopPropagation()}>
        <div className="ficha-toolbar no-print">
          <span>Lista de preços — apenas produtos ativos</span>
          <div className="result-actions">
            <button className="btn primary sm" onClick={onPrint}><Printer size={15} /> Imprimir / Salvar PDF</button>
            <button className="btn ghost sm" onClick={onClose}><X size={15} /> Fechar</button>
          </div>
        </div>

        <div className="ficha-print">
          <div className="ficha-sheet">
            <div className="fk-head">
              <div className="fk-brand">
                <div className={"fk-mark" + (cfg?.logo ? " img" : "")}>
                  {cfg?.logo ? <img src={cfg.logo} alt="logo" /> : <ChefHat size={20} />}
                </div>
                <div>
                  <div className="fk-biz">{bizName}</div>
                  <div className="fk-doc">Tabela de Preços</div>
                </div>
              </div>
              <div className="fk-date">{today}</div>
            </div>

            {cfg?.tagline && <p className="lp-tagline">{cfg.tagline}</p>}

            {items.length === 0 ? (
              <p className="fk-none" style={{ marginTop: 24 }}>Nenhum produto ativo com preço para listar.</p>
            ) : (
              <table className="fk-tbl lp-tbl">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Preço</th>
                    {hasRevenda && <th>Revenda</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((i, idx) => (
                    <tr key={idx}>
                      <td>{i.name}</td>
                      <td className="r">{brl(i.varejo)}</td>
                      {hasRevenda && <td className="r">{i.revenda != null ? brl(i.revenda) : "—"}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="fk-footer">
              {contactBits.length > 0 && <div className="fk-contact">{contactBits.join("  ·  ")}</div>}
              {bizName} · tabela válida a partir de {today}. Preços sujeitos a alteração sem aviso prévio.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  FICHA TÉCNICA (imprimível / PDF)                                   */
/* ------------------------------------------------------------------ */
function FichaTecnica({ name, calc, cfg, onClose, onPrint }) {
  const today = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit", month: "long", year: "numeric",
  });
  const c = calc;
  const bizName = (cfg && cfg.bizName) || "Ateliê de Preços";
  const tagline = (cfg && cfg.tagline) || "Ficha Técnica de Produto";
  const contactBits = [];
  if (cfg?.phone) contactBits.push(cfg.phone);
  if (cfg?.instagram) contactBits.push(cfg.instagram.startsWith("@") ? cfg.instagram : "@" + cfg.instagram);
  return (
    <div className="ficha-overlay" onClick={onClose}>
      <div className="ficha-scroll" onClick={(e) => e.stopPropagation()}>
        <div className="ficha-toolbar no-print">
          <span>Pré-visualização da ficha técnica</span>
          <div className="result-actions">
            <button className="btn primary sm" onClick={onPrint}><Printer size={15} /> Imprimir / Salvar PDF</button>
            <button className="btn ghost sm" onClick={onClose}><X size={15} /> Fechar</button>
          </div>
        </div>

        <div className="ficha-print">
          <div className="ficha-sheet">
            {/* CABEÇALHO */}
            <div className="fk-head">
              <div className="fk-brand">
                <div className={"fk-mark" + (cfg?.logo ? " img" : "")}>
                  {cfg?.logo ? <img src={cfg.logo} alt="logo" /> : <ChefHat size={20} />}
                </div>
                <div>
                  <div className="fk-biz">{bizName}</div>
                  <div className="fk-doc">{cfg?.bizName ? "Ficha Técnica de Produto" : tagline}</div>
                </div>
              </div>
              <div className="fk-date">{today}</div>
            </div>

            <h1 className="fk-title">{name}</h1>

            {/* RESUMO */}
            <div className="fk-summary">
              <div className="fk-kpi">
                <span>Custo por unidade</span>
                <strong>{brl(c.costPerUnit)}</strong>
              </div>
              <div className="fk-kpi hl">
                <span>Preço sugerido / un. ({c.marginPct.toLocaleString("pt-BR")}% margem)</span>
                <strong>{brl(c.suggestedUnit)}</strong>
              </div>
              <div className="fk-kpi">
                <span>Rendimento</span>
                <strong>{c.yld.toLocaleString("pt-BR")} un.</strong>
              </div>
            </div>

            {/* INGREDIENTES */}
            <h2 className="fk-h2">Ingredientes da receita</h2>
            <table className="fk-tbl">
              <thead><tr><th>Ingrediente</th><th>Qtd.</th><th>Custo unit.</th><th>Custo</th></tr></thead>
              <tbody>
                {c.ingredientRows.length === 0 && <tr><td colSpan={4} className="fk-none">— sem ingredientes —</td></tr>}
                {c.ingredientRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td className="r">{r.qty.toLocaleString("pt-BR")} {r.unit}</td>
                    <td className="r">{brl(r.unitCost)}</td>
                    <td className="r">{brl(r.total)}</td>
                  </tr>
                ))}
                <tr className="fk-sub"><td colSpan={3}>Total dos ingredientes (receita inteira)</td><td className="r">{brl(c.ingredientsCost)}</td></tr>
              </tbody>
            </table>

            {/* EMBALAGEM */}
            <h2 className="fk-h2">Embalagem (por unidade)</h2>
            <table className="fk-tbl">
              <thead><tr><th>Item</th><th>Qtd.</th><th>Custo unit.</th><th>Custo</th></tr></thead>
              <tbody>
                {c.packRows.length === 0 && <tr><td colSpan={4} className="fk-none">— sem embalagem —</td></tr>}
                {c.packRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td className="r">{r.qty.toLocaleString("pt-BR")} {r.unit}</td>
                    <td className="r">{brl(r.unitCost)}</td>
                    <td className="r">{brl(r.total)}</td>
                  </tr>
                ))}
                <tr className="fk-sub"><td colSpan={3}>Embalagem por unidade</td><td className="r">{brl(c.packPerUnit)}</td></tr>
              </tbody>
            </table>

            {/* COMPOSIÇÃO DE CUSTO */}
            <h2 className="fk-h2">Composição do custo</h2>
            <table className="fk-tbl">
              <tbody>
                <tr><td>Ingredientes (receita)</td><td className="r">{brl(c.ingredientsCost)}</td></tr>
                <tr><td>Embalagem (× {c.yld.toLocaleString("pt-BR")} un.)</td><td className="r">{brl(c.packPerUnit * c.yld)}</td></tr>
                <tr><td>Mão de obra + custos fixos ({c.minutes.toLocaleString("pt-BR")} min × {brl(c.costPerMinute)}/min)</td><td className="r">{brl(c.laborFixed)}</td></tr>
                <tr className="fk-sub"><td>Custo total da receita</td><td className="r">{brl(c.totalRecipe)}</td></tr>
                <tr className="fk-sub strong"><td>Custo por unidade</td><td className="r">{brl(c.costPerUnit)}</td></tr>
              </tbody>
            </table>

            {/* PREÇOS */}
            <h2 className="fk-h2">Preços sugeridos</h2>
            <table className="fk-tbl">
              <tbody>
                <tr><td>Receita inteira</td><td className="r">{brl(c.suggestedRecipe)}</td></tr>
                <tr className="fk-sub strong"><td>Por unidade</td><td className="r">{brl(c.suggestedUnit)}</td></tr>
              </tbody>
            </table>

            {/* VENDA DEFINIDA */}
            {c.sale > 0 && (
              <>
                <h2 className="fk-h2">Venda praticada</h2>
                <table className="fk-tbl">
                  <tbody>
                    <tr><td>Preço de venda por unidade</td><td className="r">{brl(c.sale)}</td></tr>
                    <tr><td>Margem de lucro</td><td className="r">{pct(c.realMargin)}</td></tr>
                    <tr className="fk-sub strong"><td>Lucro por unidade</td><td className="r">{brl(c.profit)}</td></tr>
                  </tbody>
                </table>

                <h2 className="fk-h2">Preço para manter o líquido nas plataformas</h2>
                <table className="fk-tbl">
                  <tbody>
                    {c.fees.map((f, i) => {
                      const factor = (100 - n(f.pct)) / 100;
                      return (
                        <tr key={i}>
                          <td>{f.name} ({n(f.pct).toLocaleString("pt-BR")}%)</td>
                          <td className="r">{factor > 0 ? brl(c.sale / factor) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {c.discountPct > 0 && (
                  <>
                    <h2 className="fk-h2">Revenda (desconto de {c.discountPct.toLocaleString("pt-BR")}%)</h2>
                    <table className="fk-tbl">
                      <tbody>
                        <tr><td>Preço final ao revendedor</td><td className="r">{brl(c.resalePrice)}</td></tr>
                        <tr><td>Margem na revenda</td><td className="r">{pct(c.resaleMargin)}</td></tr>
                        <tr className="fk-sub strong"><td>Lucro por unidade</td><td className="r">{brl(c.resaleProfit)}</td></tr>
                      </tbody>
                    </table>
                  </>
                )}
              </>
            )}

            <div className="fk-footer">
              {contactBits.length > 0 && <div className="fk-contact">{contactBits.join("  ·  ")}</div>}
              Documento gerado por {bizName}{cfg?.owner ? ` · responsável: ${cfg.owner}` : ""} em {today}. Valores baseados nos custos cadastrados no momento da emissão.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function SectionTitle({ icon, title, sub }) {
  return (
    <div className="sec-title">
      <span className="sec-ico">{icon}</span>
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
    </div>
  );
}
function Field({ label, children, wide }) {
  return (
    <label className={"field" + (wide ? " wide" : "")}>
      <span className="lbl">{label}</span>
      {children}
    </label>
  );
}
/* Campo numérico: aceita apenas dígitos, vírgula e ponto (bloqueia letras e símbolos).
   onChange recebe o texto já filtrado (string), não o evento. */
function NumInput({ value, onChange, onBlur, className, placeholder, inputMode = "decimal" }) {
  const handle = (e) => onChange(e.target.value.replace(/[^\d.,]/g, ""));
  return (
    <input
      className={className}
      value={value}
      onChange={handle}
      onBlur={onBlur}
      placeholder={placeholder}
      inputMode={inputMode}
    />
  );
}
function Line({ label, val, bold, accent }) {
  return (
    <div className={"bl" + (bold ? " bold" : "") + (accent ? " accent-line" : "")}>
      <span>{label}</span><span>{brl(val)}</span>
    </div>
  );
}
function Stat({ label, value, good }) {
  return (
    <div className="stat">
      <span className="stat-l">{label}</span>
      <span className={"stat-v" + (good === true ? " pos" : good === false ? " neg" : "")}>{value}</span>
    </div>
  );
}
function Empty({ text, action, big }) {
  return (
    <div className={"empty" + (big ? " big" : "")}>
      <ChefHat size={big ? 40 : 28} />
      <p>{text}</p>
      {action && <button className="btn primary" onClick={action.fn}>{action.label}</button>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ESTILO                                                             */
/* ------------------------------------------------------------------ */
function Style() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=DM+Sans:wght@400;500;600;700&display=swap');

.app{
  --bg:#F7F0E6; --bg2:#FBF6EE; --ink:#3A2A20; --ink2:#7A6557;
  --line:#E6D8C7; --card:#FFFDF9; --accent:#C0612B; --accent2:#A8431F;
  --gold:#C99A3F; --green:#5E7D52; --red:#B14A3A;
  --shadow:0 1px 2px rgba(58,42,32,.04),0 8px 24px -12px rgba(58,42,32,.18);
  font-family:'DM Sans',sans-serif; color:var(--ink);
  background:
    radial-gradient(1200px 600px at 100% -10%, #F3E4CF 0%, transparent 55%),
    radial-gradient(900px 500px at -10% 110%, #EFE0CC 0%, transparent 50%),
    var(--bg);
  min-height:100vh; padding:0 0 60px;
}
.app *{box-sizing:border-box;}
.loading{padding:80px 24px;text-align:center;color:var(--ink2);font-family:'Fraunces',serif;font-size:20px;}

/* HEADER */
.head{
  position:sticky;top:0;z-index:20;
  background:rgba(251,246,238,.86);backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line);
  padding:14px clamp(16px,4vw,40px);
  display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;
}
.brand{display:flex;align-items:center;gap:13px;}
.brand-mark{
  width:44px;height:44px;border-radius:13px;display:grid;place-items:center;color:#fff;
  background:linear-gradient(145deg,var(--accent),var(--accent2));
  box-shadow:0 6px 16px -6px var(--accent2);
}
.brand h1{font-family:'Fraunces',serif;font-weight:600;font-size:22px;margin:0;letter-spacing:-.01em;}
.brand p{margin:1px 0 0;font-size:12.5px;color:var(--ink2);}
.tabs{display:flex;gap:6px;flex-wrap:wrap;}
.tab{
  display:flex;align-items:center;gap:7px;border:1px solid transparent;background:transparent;
  color:var(--ink2);font-family:inherit;font-size:14px;font-weight:500;
  padding:9px 14px;border-radius:11px;cursor:pointer;transition:.16s;
}
.tab:hover{color:var(--ink);background:#fff6ea;}
.tab.on{background:var(--ink);color:#fbf3e7;box-shadow:var(--shadow);}

/* LAYOUT */
.content{padding:clamp(18px,3.5vw,36px) clamp(16px,4vw,40px);max-width:1240px;margin:0 auto;}
.page{display:flex;flex-direction:column;gap:18px;}
.two-col{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:24px;align-items:start;}
@media(max-width:920px){.two-col{grid-template-columns:1fr;}}

.sec-title{display:flex;gap:13px;align-items:center;margin-bottom:2px;}
.sec-ico{width:42px;height:42px;border-radius:12px;background:#fff6ea;border:1px solid var(--line);display:grid;place-items:center;color:var(--accent);}
.sec-title h2{font-family:'Fraunces',serif;font-weight:600;font-size:26px;margin:0;letter-spacing:-.02em;}
.sec-title p{margin:2px 0 0;color:var(--ink2);font-size:13.5px;}

/* CARDS */
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px 18px 20px;box-shadow:var(--shadow);}
.card-h{display:flex;align-items:center;gap:8px;font-family:'Fraunces',serif;font-weight:600;font-size:16px;margin:0 0 14px;color:var(--ink);}
.card-h svg{color:var(--accent);}
.col-build{display:flex;flex-direction:column;gap:16px;}

/* FIELDS */
.field{display:flex;flex-direction:column;gap:6px;}
.field.wide{grid-column:1/-1;}
.lbl{font-size:12.5px;font-weight:600;color:var(--ink2);}
input,select{
  font-family:inherit;font-size:14.5px;color:var(--ink);
  background:#fffdfa;border:1px solid var(--line);border-radius:10px;
  padding:10px 12px;width:100%;outline:none;transition:.15s;
}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(192,97,43,.12);}
.input-error,.input-error:focus{border-color:var(--red)!important;box-shadow:0 0 0 3px rgba(177,74,58,.14)!important;}
.field-error{font-size:12px;color:var(--red);margin-top:8px;font-weight:500;}
input::placeholder{color:#c3b3a3;}
.num{text-align:right;}

.grid-form{display:grid;grid-template-columns:repeat(4,1fr);gap:13px;margin-bottom:16px;}
@media(max-width:760px){.grid-form{grid-template-columns:1fr 1fr;}.field.wide{grid-column:1/-1;}}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px;}

/* BUTTONS */
.btn{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-weight:600;font-size:14px;
  border-radius:11px;padding:10px 16px;cursor:pointer;border:1px solid transparent;transition:.16s;}
.btn.primary{background:linear-gradient(145deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 6px 16px -8px var(--accent2);}
.btn.primary:hover{transform:translateY(-1px);}
.btn.ghost{background:#fff6ea;color:var(--accent2);border-color:var(--line);}
.btn.ghost:hover{background:#fdeddb;}
.btn.sm{padding:7px 12px;font-size:13px;border-radius:9px;}
.icon-btn{background:transparent;border:none;color:#b9a695;cursor:pointer;padding:6px;border-radius:8px;display:grid;place-items:center;transition:.15s;}
.icon-btn:hover{color:var(--red);background:#fbe9e4;}

/* TABLE */
.tbl{width:100%;border-collapse:collapse;font-size:14px;}
.tbl th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink2);font-weight:600;padding:0 10px 10px;border-bottom:1px solid var(--line);}
.tbl th:nth-child(2),.tbl th:nth-child(3),.tbl th:nth-child(5){text-align:right;}
.tbl td{padding:6px 10px;border-bottom:1px solid #f1e7d9;vertical-align:middle;}
.tbl tr:last-child td{border-bottom:none;}
.cell{border:1px solid transparent;background:transparent;padding:7px 8px;border-radius:8px;}
.cell:hover{background:#fff6ea;}
.cell:focus{background:#fff;border-color:var(--accent);}
td.muted,.muted{color:var(--ink2);}
.tbl td.r{text-align:right;}
.cell-text{font-size:14px;color:var(--ink);}
.row-editing{background:#fff9f1;}
.row-editing .cell{background:#fff;border-color:var(--line);}
td.accent,.accent{color:var(--accent2);}
.strong{font-weight:700;}
.per{font-size:11px;color:var(--ink2);font-weight:500;margin-left:1px;}

/* PARAM */
.param-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
@media(max-width:980px){.param-grid{grid-template-columns:1fr;}}
.row-line{display:grid;grid-template-columns:1fr 110px 30px;gap:8px;align-items:center;margin-bottom:8px;}
.mini-note{margin-top:12px;font-size:13px;color:var(--ink2);}
.mini-note b{color:var(--ink);}
.sep{height:1px;background:var(--line);margin:16px 0;}
.highlight-bar{
  display:flex;align-items:center;gap:11px;flex-wrap:wrap;
  background:linear-gradient(135deg,#2E2017,#43301F);color:#f5ead9;
  padding:16px 22px;border-radius:16px;box-shadow:var(--shadow);font-size:14.5px;
}
.highlight-bar svg{color:var(--gold);}
.highlight-bar strong{font-family:'Fraunces',serif;font-size:22px;color:#fff;}
.highlight-bar .muted{color:#bda88f;font-size:13px;}

/* PRECIFICAR lines */
.line3{display:grid;grid-template-columns:1fr 120px 84px 30px;gap:8px;align-items:center;margin-bottom:8px;}
@media(max-width:540px){.line3{grid-template-columns:1fr 90px 70px 26px;}}
.qtybox{position:relative;}
.qtybox .num{padding-right:30px;}
.unit-tag{position:absolute;right:9px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--ink2);pointer-events:none;}
.line-cost{font-size:13.5px;font-weight:600;text-align:right;color:var(--accent2);}
.sub-total{margin-top:10px;font-size:13.5px;color:var(--ink2);}
.sub-total b{color:var(--ink);font-size:15px;}

/* SAVED */
.saved{display:flex;flex-direction:column;gap:4px;}
.saved-row{display:flex;align-items:center;justify-content:space-between;border-radius:9px;padding:2px 2px 2px 0;}
.saved-row:hover{background:#fff6ea;}
.saved-name{flex:1;text-align:left;background:transparent;border:none;font-family:inherit;font-size:14.5px;color:var(--ink);padding:9px 10px;cursor:pointer;border-radius:9px;font-weight:500;}
.saved-name:hover{color:var(--accent2);}

/* RESULT */
.col-result{position:sticky;top:84px;}
@media(max-width:920px){.col-result{position:static;}}
.result-card{background:var(--card);border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:var(--shadow);}
.result-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line);}
.result-title{font-family:'Fraunces',serif;font-weight:600;font-size:17px;}
.hero-price{
  text-align:center;padding:26px 18px 24px;color:#f6ecdd;
  background:
    radial-gradient(400px 200px at 50% -40%, rgba(201,154,63,.35), transparent),
    linear-gradient(140deg,#34251A,#4A3522);
}
.hero-label{display:block;font-size:12.5px;letter-spacing:.05em;text-transform:uppercase;color:#c8b399;}
.hero-value{display:block;font-family:'Fraunces',serif;font-weight:700;font-size:46px;line-height:1.05;margin:6px 0 4px;color:#fff;letter-spacing:-.02em;}
.hero-sub{display:block;font-size:12.5px;color:#bda88f;}
.break{padding:14px 18px;display:flex;flex-direction:column;gap:2px;}
.bl{display:flex;justify-content:space-between;font-size:14px;padding:7px 0;border-bottom:1px dashed #efe3d3;color:var(--ink2);}
.bl span:last-child{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums;}
.bl.bold{color:var(--ink);font-weight:600;}
.bl.bold span:last-child{font-size:15px;}
.bl.accent-line{border-bottom:none;margin-top:2px;padding-top:10px;}
.bl.accent-line span{color:var(--accent2);font-weight:700;font-size:16px;}

.calc-block{padding:16px 18px;border-top:1px solid var(--line);}
.calc-block h4{display:flex;align-items:center;gap:7px;font-family:'Fraunces',serif;font-weight:600;font-size:15px;margin:0 0 12px;}
.calc-block h4 svg{color:var(--accent);}
.two-stat{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;}
.three-stat{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px;}
.stat{background:#fbf4e9;border:1px solid var(--line);border-radius:11px;padding:10px 12px;text-align:center;}
.stat-l{display:block;font-size:11.5px;color:var(--ink2);margin-bottom:3px;}
.stat-v{display:block;font-family:'Fraunces',serif;font-weight:600;font-size:18px;font-variant-numeric:tabular-nums;}
.stat-v.pos{color:var(--green);}
.stat-v.neg{color:var(--red);}
.fees{display:flex;flex-direction:column;gap:2px;}
.fee-row{display:flex;justify-content:space-between;align-items:center;font-size:14px;padding:7px 0;border-bottom:1px dashed #efe3d3;}
.fee-row:last-child{border-bottom:none;}
.fee-row em{color:var(--ink2);font-style:normal;font-size:12px;}
.fee-row b{font-variant-numeric:tabular-nums;color:var(--accent2);}

/* EMPTY */
.empty{display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--ink2);text-align:center;
  padding:40px 24px;background:var(--card);border:1px dashed var(--line);border-radius:18px;}
.empty.big{padding:64px 24px;}
.empty svg{color:#d8b890;}
.empty p{margin:0;font-size:15px;}

.result-actions{display:flex;gap:8px;align-items:center;}

/* CATÁLOGO DE PRODUTOS */
.cat-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.cat-controls{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;}
.search{display:flex;align-items:center;gap:9px;background:var(--card);border:1px solid var(--line);
  border-radius:12px;padding:0 12px;box-shadow:var(--shadow);flex:1;min-width:240px;max-width:420px;}
.search svg{color:var(--ink2);flex-shrink:0;}
.search input{border:none;background:transparent;padding:12px 0;box-shadow:none!important;}
.search input:focus{box-shadow:none;}
.seg{display:flex;gap:3px;background:#fff6ea;border:1px solid var(--line);border-radius:11px;padding:3px;}
.seg-btn{display:flex;align-items:center;gap:6px;border:none;background:transparent;font-family:inherit;
  font-size:13px;font-weight:600;color:var(--ink2);padding:7px 12px;border-radius:8px;cursor:pointer;transition:.14s;}
.seg-btn span{font-size:11px;background:#ece0cf;color:var(--ink2);border-radius:20px;padding:1px 7px;min-width:18px;text-align:center;}
.seg-btn:hover{color:var(--ink);}
.seg-btn.on{background:var(--card);color:var(--ink);box-shadow:var(--shadow);}
.seg-btn.on span{background:var(--accent);color:#fff;}
.cat-card{padding:6px 6px;}
.cat-tbl th{padding:12px 14px 12px;}
.cat-tbl td{padding:11px 14px;vertical-align:middle;}
.cat-tbl th:not(:first-child):not(:last-child),.cat-tbl td.r{text-align:right;}
.cat-name-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;}
.cat-name{background:transparent;border:none;font-family:inherit;font-size:15px;font-weight:600;
  color:var(--ink);cursor:pointer;padding:0;text-align:left;transition:.14s;}
.cat-name:hover{color:var(--accent2);}
.cat-meta{display:block;font-size:11.5px;color:var(--ink2);margin-top:2px;}
.status-pill{font-family:inherit;font-size:10.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;
  border:1px solid transparent;border-radius:20px;padding:2px 9px;cursor:pointer;transition:.14s;}
.status-pill.on{background:#e7f0e1;color:#42603a;border-color:#cfe0c4;}
.status-pill.on:hover{background:#dbe9d2;}
.status-pill.off{background:#efe7df;color:#9a8978;border-color:#e2d5c6;}
.status-pill.off:hover{background:#e7dccf;}
.row-off .cat-name{color:var(--ink2);}
.row-off td.r{opacity:.5;}
.cat-actions{display:flex;gap:2px;justify-content:flex-end;}
.cat-actions .icon-btn:hover{color:var(--accent2);background:#fff6ea;}
.cat-actions .del-btn:hover{color:var(--red);background:#fbe9e4;}
.cat-actions .confirm-del{color:var(--green);}
.cat-actions .confirm-del:hover{color:var(--green);background:#eaf2e6;}
.cat-empty{text-align:center;color:var(--ink2);padding:26px 14px!important;font-style:italic;}
.pos{color:var(--green);font-weight:600;}
.neg{color:var(--red);font-weight:600;}
@media(max-width:680px){.cat-card{overflow-x:auto;}.cat-tbl{min-width:560px;}}

/* LOGO no header */
.brand-mark.has-logo{background:#fff;padding:0;overflow:hidden;border:1px solid var(--line);box-shadow:var(--shadow);}
.brand-mark img{width:100%;height:100%;object-fit:contain;}

/* CONFIGURAÇÕES */
.cfg-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;}
@media(max-width:820px){.cfg-grid{grid-template-columns:1fr;}}
.logo-zone{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;}
.logo-preview{
  width:120px;height:120px;border-radius:14px;border:1px solid var(--line);background:#fffdfa;
  display:grid;place-items:center;overflow:hidden;flex-shrink:0;
  background-image:linear-gradient(45deg,#f3ece1 25%,transparent 25%),linear-gradient(-45deg,#f3ece1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f3ece1 75%),linear-gradient(-45deg,transparent 75%,#f3ece1 75%);
  background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;
}
.logo-preview img{width:100%;height:100%;object-fit:contain;}
.logo-empty{display:flex;flex-direction:column;align-items:center;gap:6px;color:#c3b3a3;font-size:12px;}
.logo-actions{display:flex;flex-direction:column;gap:9px;flex:1;min-width:180px;}
.logo-upload{cursor:pointer;align-self:flex-start;}
.logo-hint{margin:4px 0 0;font-size:12px;color:var(--ink2);line-height:1.5;}
.preview-head{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px;}

/* INÍCIO / DASHBOARD */
.dash-hero{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;
  background:linear-gradient(140deg,#34251A,#4A3522);color:#f5ead9;border-radius:18px;padding:22px 24px;box-shadow:var(--shadow);}
.dash-hero-l{display:flex;align-items:center;gap:14px;}
.dash-logo{width:48px;height:48px;border-radius:12px;background:#fff;overflow:hidden;flex-shrink:0;display:grid;place-items:center;}
.dash-logo img{width:100%;height:100%;object-fit:contain;}
.dash-title{font-family:'Fraunces',serif;font-weight:600;font-size:24px;margin:0;letter-spacing:-.01em;}
.dash-sub{margin:3px 0 0;font-size:13.5px;color:#c8b399;}
.onboard-intro{font-size:13px;color:var(--ink2);line-height:1.55;margin:0 0 14px;}
.onboard-steps{display:flex;flex-direction:column;gap:8px;}
.onboard-step{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;
  background:#fffdfa;border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-family:inherit;transition:.15s;}
.onboard-step:hover{background:#fff6ea;border-color:#e8d6c2;}
.onboard-step.done{background:#f4f8f1;border-color:#d8e6cf;}
.ob-check{width:26px;height:26px;border-radius:8px;flex-shrink:0;display:grid;place-items:center;font-weight:700;font-size:13px;
  background:#ece0cf;color:var(--ink2);}
.onboard-step.done .ob-check{background:var(--green);color:#fff;}
.ob-text{flex:1;display:flex;flex-direction:column;}
.ob-text b{font-size:14px;color:var(--ink);}
.ob-text em{font-style:normal;font-size:12px;color:var(--ink2);margin-top:1px;}
.ob-go{font-size:12px;font-weight:600;color:var(--accent2);}
.dash-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
@media(max-width:760px){.dash-stats{grid-template-columns:1fr 1fr;}}
.dash-stat{text-align:left;background:var(--card);border:1px solid var(--line);border-radius:15px;padding:16px 18px;
  cursor:pointer;font-family:inherit;box-shadow:var(--shadow);transition:.15s;display:flex;flex-direction:column;gap:3px;}
.dash-stat:hover{transform:translateY(-2px);border-color:#e8d6c2;}
.ds-label{font-size:12px;color:var(--ink2);font-weight:600;}
.ds-value{font-family:'Fraunces',serif;font-weight:700;font-size:26px;color:var(--ink);line-height:1.1;}
.ds-foot{font-size:11.5px;color:var(--ink2);}
.attn-ok{display:flex;align-items:center;gap:9px;font-size:14px;color:var(--green);font-weight:500;padding:4px 0;}
.attn-list{display:flex;flex-direction:column;gap:4px;}
.attn-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;background:transparent;
  border:none;border-radius:10px;padding:10px 12px;font-family:inherit;transition:.14s;}
.attn-row:hover{background:#fff6ea;}
.attn-name{flex:1;font-weight:600;font-size:14px;color:var(--ink);}
.attn-reason{font-size:12px;font-weight:600;color:var(--accent2);background:#fdf0e6;border:1px solid #f0cfae;border-radius:20px;padding:2px 10px;}
.attn-row svg{color:#b9a695;}

/* MODAL (confirmação de saída) */
.modal-overlay{position:fixed;inset:0;z-index:70;background:rgba(40,28,20,.55);backdrop-filter:blur(3px);
  display:flex;align-items:center;justify-content:center;padding:20px;}
.modal{background:var(--card);border-radius:18px;max-width:420px;width:100%;padding:26px 26px 22px;box-shadow:0 20px 50px -16px rgba(0,0,0,.45);text-align:center;}
.modal-ico{width:48px;height:48px;border-radius:13px;background:#fdf0e6;color:var(--accent);display:grid;place-items:center;margin:0 auto 14px;}
.modal h3{font-family:'Fraunces',serif;font-weight:600;font-size:19px;margin:0 0 8px;}
.modal p{font-size:13.5px;color:var(--ink2);line-height:1.55;margin:0 0 20px;}
.modal-actions{display:flex;gap:10px;justify-content:center;}

/* TOAST (notificações globais) */
.toast-wrap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;
  display:flex;flex-direction:column;align-items:center;gap:10px;max-width:90vw;pointer-events:none;}
.toast{display:flex;align-items:center;gap:10px;max-width:90vw;pointer-events:auto;
  padding:13px 20px;border-radius:13px;font-size:14px;font-weight:600;
  box-shadow:0 12px 32px -10px rgba(40,28,20,.45);
  animation:toast-in .26s cubic-bezier(.2,.8,.2,1);}
.toast svg{flex-shrink:0;}
.toast.ok{background:#33251a;color:#f4ecdf;}
.toast.ok svg{color:#9fd28a;}
.toast.warn{background:#fdf0e6;color:#7a4a25;border:1px solid #f0cfae;}
.toast.warn svg{color:var(--accent);}
.toast.err{background:#fbe9e4;color:#9a3a2a;border:1px solid #f0c8bd;}
.toast.err svg{color:var(--red);}
@keyframes toast-in{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
@media print{.toast-wrap{display:none!important;}}

/* AVISOS DE PRECIFICAÇÃO */
.calc-warn{margin:16px 18px 6px;padding:14px 16px;background:#fdf0e6;border:1px solid #f0cfae;border-radius:11px;
  display:flex;flex-direction:column;gap:11px;}
.calc-warn-row{display:flex;align-items:flex-start;gap:11px;font-size:12.5px;color:#7a4a25;line-height:1.55;}
.calc-warn-row svg{color:var(--accent);flex-shrink:0;margin-top:2px;}
.param-warn{display:flex;align-items:flex-start;gap:9px;margin-top:12px;padding:11px 13px;
  background:#fdf0e6;border:1px solid #f0cfae;border-radius:11px;font-size:12.5px;color:#7a4a25;line-height:1.45;}
.param-warn svg{color:var(--accent);flex-shrink:0;margin-top:1px;}
.param-warn b{color:#5e3517;}

/* EXPLICAÇÃO DO CÁLCULO */
.calc-explain{margin-top:14px;padding-top:14px;border-top:1px dashed var(--line);}
.calc-explain p{margin:0 0 10px;font-size:12.5px;color:var(--ink2);line-height:1.55;}
.calc-explain b{color:var(--ink);}
.calc-steps{display:flex;flex-direction:column;}
.calc-steps>div:not(.muted-step){display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:13px;}
.calc-steps>div:not(.muted-step) span{color:var(--ink2);}
.calc-steps>div:not(.muted-step) b{font-variant-numeric:tabular-nums;}
.calc-steps .muted-step{font-size:11px;color:#b09b88;margin:1px 0 7px;}
.explain-card.collapsible{padding:0;overflow:hidden;}
.explain-toggle{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;
  background:transparent;border:none;cursor:pointer;padding:14px 18px;font-family:inherit;text-align:left;transition:.15s;}
.explain-toggle:hover{background:#fff6ea;}
.et-left{display:flex;align-items:center;gap:9px;font-family:'Fraunces',serif;font-weight:600;font-size:15px;color:var(--ink);flex-wrap:wrap;}
.et-left svg{color:var(--accent);}
.et-left em{font-style:normal;font-weight:400;font-size:12.5px;color:var(--ink2);}
.et-chev{color:var(--ink2);transition:transform .2s;flex-shrink:0;}
.et-chev.open{transform:rotate(180deg);}
.explain-body{padding:16px 18px 18px;border-top:1px solid var(--line);animation:fade-in .2s ease;}
@keyframes fade-in{from{opacity:0;}to{opacity:1;}}
.explain-card .explain-p{font-size:13.5px;color:var(--ink2);line-height:1.6;margin:0 0 16px;}
.explain-card .explain-p b{color:var(--ink);}
.explain-steps{display:flex;flex-direction:column;gap:11px;margin-bottom:18px;}
.explain-step{display:flex;gap:12px;align-items:flex-start;}
.estep-n{flex-shrink:0;width:26px;height:26px;border-radius:8px;background:var(--accent);color:#fff;
  display:grid;place-items:center;font-weight:700;font-size:13px;font-family:'Fraunces',serif;}
.explain-step b{font-size:13.5px;}
.explain-step p{margin:3px 0 0;font-size:12.5px;color:var(--ink2);line-height:1.55;}
.explain-step p b{color:var(--ink);}
.explain-chain{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 10px;}
.explain-chain span{background:#fbf4e9;border:1px solid var(--line);border-radius:9px;padding:7px 11px;font-size:12.5px;color:var(--ink2);}
.explain-chain span.chain-strong{background:#33251a;color:#f4ecdf;border-color:#33251a;font-weight:600;}
.explain-chain i{font-style:normal;font-weight:700;color:var(--accent);font-size:15px;}
.explain-note{font-size:12.5px;color:var(--ink2);line-height:1.6;margin:14px 0 0;padding-top:12px;border-top:1px solid var(--line);}
.explain-note b{color:var(--ink);}
.explain-validate{margin-top:14px;}
.ev-title{display:block;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--accent2);margin-bottom:7px;}
.explain-validate ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:5px;}
.explain-validate li{font-size:12.5px;color:var(--ink2);line-height:1.5;}

/* BARRA DE SALVAMENTO (parâmetros) */
.save-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  background:var(--card);border:1px solid var(--line);border-radius:14px;padding:13px 18px;box-shadow:var(--shadow);}
.save-bar.on{border-color:#f0cfae;background:#fffaf3;}
.save-state{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;color:var(--ink2);}
.save-state svg{color:var(--green);}
.save-bar.on .save-state{color:#7a4a25;}
.save-bar .dot{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px rgba(192,97,43,.16);}
.save-bar-actions{display:flex;gap:8px;}
.btn.primary:disabled{opacity:.45;cursor:not-allowed;transform:none;}

/* CONTROLES EXTRA DO CATÁLOGO */
.ctrl-right{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
.sort-field{display:flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--line);
  border-radius:11px;padding:0 6px 0 11px;box-shadow:var(--shadow);color:var(--ink2);}
.sort-field select{border:none;background:transparent;box-shadow:none!important;padding:9px 6px;font-weight:600;font-size:13px;width:auto;}
.cat-actions .icon-btn[title="Duplicar produto"]:hover{color:var(--gold);background:#fdf3df;}

/* AVISO DE REMOÇÃO (cadastros) */
.warn-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  background:#fdf0e6;border:1px solid #f0cfae;border-left:4px solid var(--accent);
  border-radius:13px;padding:13px 16px;color:#7a4a25;font-size:13.5px;line-height:1.5;}
.warn-banner svg{color:var(--accent);flex-shrink:0;}
.warn-banner span{flex:1;min-width:220px;}
.warn-actions{display:flex;gap:8px;}
.del-armed{color:var(--red)!important;background:#fbe9e4!important;}

/* BACKUP */
.backup-actions{display:flex;gap:10px;flex-wrap:wrap;}
.imp-msg{display:flex;align-items:center;gap:8px;margin-top:14px;padding:11px 14px;border-radius:11px;font-size:13.5px;}
.imp-msg.ok{background:#e7f0e1;color:#42603a;border:1px solid #cfe0c4;}
.imp-msg.err{background:#fbe9e4;color:#9a3a2a;border:1px solid #f0c8bd;}

/* LISTA DE PREÇOS */
.lp-tagline{font-style:italic;color:#7a6557;margin:14px 0 4px;font-size:13px;}
.lp-tbl{margin-top:18px;}
.lp-tbl th{font-size:11px;padding-bottom:8px;}
.lp-tbl td{padding:9px 4px;font-size:13.5px;}
.lp-tbl td.r{font-weight:700;}

/* FICHA TÉCNICA */
.ficha-overlay{
  position:fixed;inset:0;z-index:50;display:flex;justify-content:center;
  background:rgba(40,28,20,.55);backdrop-filter:blur(3px);overflow:auto;padding:28px 16px;
}
.ficha-scroll{width:100%;max-width:760px;display:flex;flex-direction:column;gap:14px;}
.ficha-toolbar{
  display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
  background:var(--card);border:1px solid var(--line);border-radius:13px;
  padding:11px 14px;box-shadow:var(--shadow);font-size:14px;color:var(--ink2);font-weight:500;
}
.ficha-print{display:flex;justify-content:center;}
.ficha-sheet{
  background:#fff;width:100%;max-width:720px;border-radius:6px;
  padding:38px 40px 30px;box-shadow:0 12px 40px -16px rgba(0,0,0,.4);
  color:#1f1812;font-size:13px;
}
.fk-head{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #1f1812;padding-bottom:14px;}
.fk-brand{display:flex;align-items:center;gap:11px;}
.fk-mark{width:38px;height:38px;border-radius:9px;background:#1f1812;color:#fff;display:grid;place-items:center;}
.fk-mark.img{background:#fff;border:1px solid #e3d8c8;overflow:hidden;padding:2px;}
.fk-mark img{width:100%;height:100%;object-fit:contain;}
.fk-biz{font-family:'Fraunces',serif;font-weight:700;font-size:16px;}
.fk-doc{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a6557;margin-top:1px;}
.fk-date{font-size:12px;color:#7a6557;}
.fk-title{font-family:'Fraunces',serif;font-weight:700;font-size:26px;margin:18px 0 16px;letter-spacing:-.01em;}
.fk-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:22px;}
.fk-kpi{border:1px solid #e3d8c8;border-radius:8px;padding:11px 13px;}
.fk-kpi span{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:#7a6557;line-height:1.3;}
.fk-kpi strong{display:block;font-family:'Fraunces',serif;font-weight:700;font-size:19px;margin-top:5px;}
.fk-kpi.hl{background:#1f1812;border-color:#1f1812;color:#fff;}
.fk-kpi.hl span{color:#c8b399;}
.fk-h2{font-family:'Fraunces',serif;font-weight:600;font-size:14px;text-transform:uppercase;letter-spacing:.04em;
  margin:20px 0 7px;padding-bottom:5px;border-bottom:1px solid #e3d8c8;color:#3a2a20;}
.fk-tbl{width:100%;border-collapse:collapse;font-size:12.5px;}
.fk-tbl th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#7a6557;font-weight:700;padding:0 4px 6px;border-bottom:1px solid #e3d8c8;}
.fk-tbl th.r,.fk-tbl td.r{text-align:right;}
.fk-tbl th:not(:first-child){text-align:right;}
.fk-tbl td{padding:6px 4px;border-bottom:1px solid #f1ece2;font-variant-numeric:tabular-nums;}
.fk-tbl tr:last-child td{border-bottom:none;}
.fk-tbl .fk-sub td{border-top:1px solid #cabba6;border-bottom:none;font-weight:700;padding-top:7px;}
.fk-tbl .fk-sub.strong td{font-family:'Fraunces',serif;font-size:14px;}
.fk-none{color:#a89684;font-style:italic;text-align:center;}
.fk-footer{margin-top:26px;padding-top:12px;border-top:1px solid #e3d8c8;font-size:10.5px;color:#9a8978;line-height:1.5;}
.fk-contact{font-size:11.5px;color:#3a2a20;font-weight:600;margin-bottom:5px;}

/* IMPRESSÃO */
@media print{
  @page{margin:14mm;}
  body *{visibility:hidden!important;}
  .no-print{display:none!important;}
  .ficha-overlay{position:static!important;inset:auto!important;background:#fff!important;
    backdrop-filter:none!important;padding:0!important;display:block!important;}
  .ficha-print, .ficha-print *{visibility:visible!important;}
  .ficha-print{position:absolute;left:0;top:0;width:100%;}
  .ficha-sheet{box-shadow:none!important;max-width:none!important;padding:0!important;border-radius:0!important;}
  .fk-kpi.hl{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .fk-mark{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
}
`}</style>
  );
}
