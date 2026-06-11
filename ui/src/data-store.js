/**
 * data-store
 * -----------------------------------------------------------------------------
 * Contrato da CAMADA DE DADOS do sistema. Os componentes da interface só
 * conhecem esta interface — nunca falam com armazenamento ou rede diretamente.
 * Trocar a origem dos dados (local ⇄ servidor) é trocar a implementação aqui.
 *
 * Interface DataStore:
 *   loadAll()                  -> Promise<{ ingredients, packaging, parameters, products, config }>
 *   saveIngredients(list)      -> Promise<void>
 *   savePackaging(list)        -> Promise<void>
 *   saveParameters(obj)        -> Promise<void>
 *   saveProducts(list)         -> Promise<void>
 *   saveConfig(obj)            -> Promise<void>
 *
 * No protótipo atual (artifact), uma implementação equivalente usa window.storage.
 * Abaixo está a implementação de PRODUÇÃO, que conversa com a API local
 * (servidor Node embutido no app de desktop) — a mesma instância acessível pelos
 * aparelhos da loja na rede.
 * -----------------------------------------------------------------------------
 */

/**
 * Cria um DataStore que fala com a API local.
 * @param {object} opts
 * @param {string} opts.baseUrl   ex.: "http://192.168.0.10:4317/api" (host na rede da loja)
 * @param {() => string|null} opts.getToken  retorna o token de sessão do login
 * @param {() => void} [opts.onUnauthorized]  chamado em respostas 401 (sessão expirada)
 */
export function createApiStore({ baseUrl, getToken, onUnauthorized } = {}) {
  const url = (path) => `${baseUrl.replace(/\/$/, "")}${path}`;

  async function req(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const token = getToken && getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401) {
      if (onUnauthorized) onUnauthorized();
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try { const e = await res.json(); if (e && e.error) msg = e.error; } catch {}
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  return {
    /* Carrega o estado completo do negócio numa única chamada. */
    loadAll: () => req("GET", "/state"),

    /* O servidor recebe a lista, valida e reconcilia com o banco
       (usa o pricing-core para validar antes de gravar). */
    saveIngredients: (list) => req("PUT", "/ingredients", list),
    savePackaging:   (list) => req("PUT", "/packaging", list),
    saveParameters:  (obj)  => req("PUT", "/parameters", obj),
    saveProducts:    (list) => req("PUT", "/products", list),
    saveConfig:      (obj)  => req("PUT", "/config", obj),

    /* migração: envia o backup JSON completo; o servidor reconcilia em transação */
    importAll:       (payload) => req("POST", "/import", payload),

    /* gestão de usuários (somente admin) */
    listUsers:   () => req("GET", "/users"),
    createUser:  (u) => req("POST", "/users", u),
    updateUser:  (id, patch) => req("PUT", `/users/${id}`, patch),
    deleteUser:  (id) => req("DELETE", `/users/${id}`),
  };
}

/*
 * Endpoints implicados por este contrato (a serem implementados no servidor):
 *
 *   GET  /api/state         -> { ingredients, packaging, parameters, products, config }
 *   PUT  /api/ingredients   -> grava a lista de ingredientes
 *   PUT  /api/packaging     -> grava a lista de embalagens
 *   PUT  /api/parameters    -> grava os parâmetros (linha única)
 *   PUT  /api/products      -> grava os produtos (e registra price_history ao salvar)
 *   PUT  /api/config        -> grava a identidade do negócio
 *
 * Autenticação (login próprio): toda chamada (exceto /auth/login) leva o token
 * de sessão no cabeçalho Authorization. 401 dispara onUnauthorized.
 *
 * Evolução prevista: além das gravações por lista (que mantêm a troca simples
 * agora), o servidor pode expor operações granulares
 * (POST/PATCH/DELETE por entidade) sem exigir mudança nos componentes —
 * basta acrescentar métodos a este contrato.
 */
