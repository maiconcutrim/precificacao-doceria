import {
  n,
  computeProduct,
  validateItem,
  validateProduct,
} from "@doceria/pricing-core";

/* converte para número ou null (campos opcionais como preço de venda / desconto) */
const numOrNull = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : n(s);
};

export function registerDataRoutes(app, db, auth) {
  /* ---------------------------------------------------------------- */
  /*  Leitura do estado completo                                      */
  /* ---------------------------------------------------------------- */
  const q = {
    business: db.prepare("SELECT * FROM business WHERE id = 1"),
    parameters: db.prepare("SELECT * FROM parameters WHERE id = 1"),
    fixedCosts: db.prepare("SELECT id, name, value FROM fixed_costs ORDER BY sort_order, rowid"),
    fees: db.prepare("SELECT id, name, pct FROM fees ORDER BY sort_order, rowid"),
    employees: db.prepare("SELECT id, name, salary, hours_per_day, days_per_week FROM employees ORDER BY rowid"),
    ingredients: db.prepare("SELECT * FROM ingredients ORDER BY created_at, rowid"),
    packaging: db.prepare("SELECT * FROM packaging ORDER BY created_at, rowid"),
    products: db.prepare("SELECT * FROM products ORDER BY created_at, rowid"),
    pItems: db.prepare("SELECT id, ingredient_id, qty FROM product_ingredients WHERE product_id = ?"),
    pPacks: db.prepare("SELECT id, packaging_id, qty FROM product_packaging WHERE product_id = ?"),
  };

  const ingToApi = (r) => ({ id: r.id, name: r.name, packageValue: r.package_value, packageQty: r.package_qty, unit: r.unit, active: !!r.active });

  function readParameters() {
    const p = q.parameters.get();
    return {
      desiredEarnings: p.desired_earnings,
      hoursPerDay: p.hours_per_day,
      daysPerWeek: p.days_per_week,
      marginPct: p.margin_pct,
      rounding: p.rounding,
      fixedCosts: q.fixedCosts.all().map((r) => ({ id: r.id, name: r.name, value: r.value })),
      fees: q.fees.all().map((r) => ({ id: r.id, name: r.name, pct: r.pct })),
      employees: q.employees.all().map((r) => ({ id: r.id, name: r.name, salary: r.salary, hoursPerDay: r.hours_per_day, daysPerWeek: r.days_per_week })),
    };
  }

  function readProducts() {
    return q.products.all().map((r) => ({
      id: r.id,
      name: r.name,
      yield: r.yield_qty,
      minutes: r.minutes,
      salePrice: r.sale_price == null ? "" : r.sale_price,
      discountPct: r.discount_pct == null ? "" : r.discount_pct,
      status: r.status,
      items: q.pItems.all(r.id).map((it) => ({ id: it.id, ingredientId: it.ingredient_id, qty: it.qty })),
      packs: q.pPacks.all(r.id).map((pk) => ({ id: pk.id, packagingId: pk.packaging_id, qty: pk.qty })),
    }));
  }

  function readConfig() {
    const b = q.business.get();
    return { bizName: b.name, owner: b.owner, tagline: b.tagline, phone: b.phone, instagram: b.instagram, logo: b.logo_path || "" };
  }

  function readState() {
    return {
      ingredients: q.ingredients.all().map(ingToApi),
      packaging: q.packaging.all().map(ingToApi),
      parameters: readParameters(),
      products: readProducts(),
      config: readConfig(),
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Gravações (cada uma em transação)                               */
  /* ---------------------------------------------------------------- */
  const stmt = {
    upsertIng: db.prepare(`INSERT INTO ingredients (id,name,package_value,package_qty,unit,active,updated_at)
      VALUES (@id,@name,@value,@qty,@unit,@active,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name=@name,package_value=@value,package_qty=@qty,unit=@unit,active=@active,updated_at=datetime('now')`),
    upsertPack: db.prepare(`INSERT INTO packaging (id,name,package_value,package_qty,unit,active,updated_at)
      VALUES (@id,@name,@value,@qty,@unit,@active,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name=@name,package_value=@value,package_qty=@qty,unit=@unit,active=@active,updated_at=datetime('now')`),
    updateParams: db.prepare(`UPDATE parameters SET desired_earnings=@de,hours_per_day=@hd,days_per_week=@dw,margin_pct=@mp,rounding=@r,updated_at=datetime('now') WHERE id=1`),
    clearFixed: db.prepare("DELETE FROM fixed_costs"),
    insFixed: db.prepare("INSERT INTO fixed_costs (id,name,value,sort_order) VALUES (?,?,?,?)"),
    clearFees: db.prepare("DELETE FROM fees"),
    insFee: db.prepare("INSERT INTO fees (id,name,pct,sort_order) VALUES (?,?,?,?)"),
    clearEmp: db.prepare("DELETE FROM employees"),
    insEmp: db.prepare("INSERT INTO employees (id,name,salary,hours_per_day,days_per_week) VALUES (?,?,?,?,?)"),
    upsertProd: db.prepare(`INSERT INTO products (id,name,yield_qty,minutes,sale_price,discount_pct,status,updated_at)
      VALUES (@id,@name,@yield,@minutes,@sale,@disc,@status,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name=@name,yield_qty=@yield,minutes=@minutes,sale_price=@sale,discount_pct=@disc,status=@status,updated_at=datetime('now')`),
    clearPItems: db.prepare("DELETE FROM product_ingredients WHERE product_id=?"),
    insPItem: db.prepare("INSERT INTO product_ingredients (id,product_id,ingredient_id,qty) VALUES (?,?,?,?)"),
    clearPPacks: db.prepare("DELETE FROM product_packaging WHERE product_id=?"),
    insPPack: db.prepare("INSERT INTO product_packaging (id,product_id,packaging_id,qty) VALUES (?,?,?,?)"),
    updateBusiness: db.prepare(`UPDATE business SET name=@name,owner=@owner,tagline=@tagline,phone=@phone,instagram=@instagram,logo_path=@logo,updated_at=datetime('now') WHERE id=1`),
    lastHist: db.prepare("SELECT cost_per_unit, suggested_unit, margin_pct FROM price_history WHERE product_id=? ORDER BY id DESC LIMIT 1"),
    insHist: db.prepare(`INSERT INTO price_history (product_id,product_name,cost_per_unit,suggested_unit,margin_pct,sale_price,inputs_json,created_by)
      VALUES (?,?,?,?,?,?,?,?)`),
  };

  /* apaga ids que não estão mais na lista recebida (remoções feitas no app) */
  function deleteMissing(table, incomingIds) {
    const rows = db.prepare(`SELECT id FROM ${table}`).all();
    const keep = new Set(incomingIds);
    const toDelete = rows.map((r) => r.id).filter((id) => !keep.has(id));
    const del = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    for (const id of toDelete) del.run(id);
  }

  const writeIngredients = db.transaction((list) => {
    deleteMissing("ingredients", list.map((x) => x.id));
    for (const x of list) {
      stmt.upsertIng.run({ id: x.id, name: String(x.name || ""), value: n(x.packageValue), qty: n(x.packageQty), unit: x.unit || "g", active: x.active === false ? 0 : 1 });
    }
  });

  const writePackaging = db.transaction((list) => {
    deleteMissing("packaging", list.map((x) => x.id));
    for (const x of list) {
      stmt.upsertPack.run({ id: x.id, name: String(x.name || ""), value: n(x.packageValue), qty: n(x.packageQty), unit: x.unit || "un", active: x.active === false ? 0 : 1 });
    }
  });

  const writeParameters = db.transaction((par) => {
    stmt.updateParams.run({ de: n(par.desiredEarnings), hd: n(par.hoursPerDay), dw: n(par.daysPerWeek), mp: n(par.marginPct), r: par.rounding || "none" });
    stmt.clearFixed.run();
    (par.fixedCosts || []).forEach((f, i) => stmt.insFixed.run(f.id, String(f.name || ""), n(f.value), i));
    stmt.clearFees.run();
    (par.fees || []).forEach((f, i) => stmt.insFee.run(f.id, String(f.name || ""), n(f.pct), i));
    stmt.clearEmp.run();
    (par.employees || []).forEach((e) => stmt.insEmp.run(e.id, String(e.name || ""), n(e.salary), n(e.hoursPerDay), n(e.daysPerWeek)));
  });

  const writeConfig = db.transaction((cfg) => {
    stmt.updateBusiness.run({
      name: String(cfg.bizName || ""), owner: String(cfg.owner || ""), tagline: String(cfg.tagline || ""),
      phone: String(cfg.phone || ""), instagram: String(cfg.instagram || ""), logo: cfg.logo || null,
    });
  });

  /* grava produtos e registra histórico de preço (quando o preço muda) */
  const writeProducts = db.transaction((list, userId) => {
    deleteMissing("products", list.map((x) => x.id));
    const ctx = { ingredients: q.ingredients.all().map(ingToApi), packaging: q.packaging.all().map(ingToApi), params: readParameters() };

    for (const p of list) {
      stmt.upsertProd.run({
        id: p.id, name: String(p.name || ""), yield: n(p.yield), minutes: n(p.minutes),
        sale: numOrNull(p.salePrice), disc: numOrNull(p.discountPct), status: p.status === "inativo" ? "inativo" : "ativo",
      });
      stmt.clearPItems.run(p.id);
      for (const it of (p.items || []).filter((it) => it.ingredientId && n(it.qty) > 0)) {
        stmt.insPItem.run(it.id, p.id, it.ingredientId, n(it.qty));
      }
      stmt.clearPPacks.run(p.id);
      for (const pk of (p.packs || []).filter((pk) => pk.packagingId && n(pk.qty) > 0)) {
        stmt.insPPack.run(pk.id, p.id, pk.packagingId, n(pk.qty));
      }

      // instantâneo de preço — só grava se mudou desde o último
      const calc = computeProduct(p, ctx);
      const last = stmt.lastHist.get(p.id);
      const changed =
        !last ||
        Math.abs(last.cost_per_unit - calc.costPerUnit) > 1e-6 ||
        Math.abs(last.suggested_unit - calc.suggestedUnit) > 1e-6 ||
        Math.abs(last.margin_pct - calc.marginPct) > 1e-6;
      if (changed) {
        const snapshot = {
          yield: n(p.yield), minutes: n(p.minutes),
          items: (p.items || []).filter((it) => it.ingredientId).map((it) => ({ ingredientId: it.ingredientId, qty: n(it.qty) })),
          packs: (p.packs || []).filter((pk) => pk.packagingId).map((pk) => ({ packagingId: pk.packagingId, qty: n(pk.qty) })),
          marginPct: calc.marginPct, rounding: ctx.params.rounding, costPerMinute: calc.costPerMinute,
        };
        stmt.insHist.run(p.id, String(p.name || ""), calc.costPerUnit, calc.suggestedUnit, calc.marginPct, numOrNull(p.salePrice), JSON.stringify(snapshot), userId || null);
      }
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Tratamento de erro comum às gravações                           */
  /* ---------------------------------------------------------------- */
  function handleWriteError(err, res) {
    if (err && typeof err.code === "string" && err.code.startsWith("SQLITE_CONSTRAINT_FOREIGNKEY")) {
      return res.status(409).json({ error: "Operação bloqueada: um ingrediente/embalagem em uso não pode ser removido, ou uma receita referencia um item inexistente." });
    }
    console.error(err);
    return res.status(500).json({ error: "Erro ao gravar os dados." });
  }

  /* ---------------------------------------------------------------- */
  /*  Rotas                                                           */
  /* ---------------------------------------------------------------- */
  app.get("/api/state", auth.requireAuth, (_req, res) => {
    res.json(readState());
  });

  app.put("/api/ingredients", auth.requireAuth, auth.requireEditor, (req, res) => {
    const list = Array.isArray(req.body) ? req.body : [];
    const bad = list.find((x) => !validateItem(x).ok);
    if (bad) return res.status(400).json({ error: "Há ingrediente com nome, valor ou quantidade inválidos." });
    try { writeIngredients(list); res.json(readState().ingredients); }
    catch (err) { handleWriteError(err, res); }
  });

  app.put("/api/packaging", auth.requireAuth, auth.requireEditor, (req, res) => {
    const list = Array.isArray(req.body) ? req.body : [];
    const bad = list.find((x) => !validateItem(x).ok);
    if (bad) return res.status(400).json({ error: "Há embalagem com nome, valor ou quantidade inválidos." });
    try { writePackaging(list); res.json(readState().packaging); }
    catch (err) { handleWriteError(err, res); }
  });

  app.put("/api/parameters", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const par = req.body || {};
    const m = n(par.marginPct);
    if (m < 0 || m >= 100) return res.status(400).json({ error: "A margem deve ficar entre 0% e 99,9%." });
    try { writeParameters(par); res.json(readParameters()); }
    catch (err) { handleWriteError(err, res); }
  });

  app.put("/api/products", auth.requireAuth, auth.requireEditor, (req, res) => {
    const list = Array.isArray(req.body) ? req.body : [];
    const bad = list.find((p) => !validateProduct(p).ok);
    if (bad) return res.status(400).json({ error: "Há produto sem nome, rendimento, tempo ou ingrediente válido." });
    try { writeProducts(list, req.user.id); res.json(readProducts()); }
    catch (err) { handleWriteError(err, res); }
  });

  app.put("/api/config", auth.requireAuth, auth.requireAdmin, (req, res) => {
    try { writeConfig(req.body || {}); res.json(readConfig()); }
    catch (err) { handleWriteError(err, res); }
  });

  /* importação do backup JSON exportado pelo app (migração) */
  const importAll = db.transaction((d, userId) => {
    if (Array.isArray(d.ingredientes)) writeIngredients(d.ingredientes);
    if (Array.isArray(d.embalagens)) writePackaging(d.embalagens);
    if (d.parametros) writeParameters(d.parametros);
    if (Array.isArray(d.produtos)) writeProducts(d.produtos, userId);
    if (d.config) writeConfig(d.config);
  });

  app.post("/api/import", auth.requireAuth, auth.requireAdmin, (req, res) => {
    const payload = req.body || {};
    const d = payload.data || payload;
    if (!d || typeof d !== "object") return res.status(400).json({ error: "Estrutura de backup inválida." });
    try { importAll(d, req.user.id); res.json(readState()); }
    catch (err) { handleWriteError(err, res); }
  });
}
