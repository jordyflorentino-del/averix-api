const https = require("https");

// ── Helpers HTTP ──
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: {} }); }
      });
    }).on("error", reject);
  });
}

function hsRequest(path, method, payload, token) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : undefined;
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (data) headers["Content-Length"] = Buffer.byteLength(data);

    const req = https.request({
      hostname: "api.hubapi.com",
      path,
      method,
      headers,
    }, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw || "{}") }); }
        catch (e) { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const hsPost = (body, token) => hsRequest("/crm/v3/objects/contacts/search", "POST", body, token);

// ── Mapeo campaña → cuenta y canal (para atribución vía HubSpot) ──
const CAMP_MAP = {
  "comercio en whatsapp - vendia duplicado":   { cuenta: "averix", canal: "Meta" },
  "comercio en whatsapp":                      { cuenta: "averix", canal: "Meta" },
  "omia decidores b2b":                        { cuenta: "averix", canal: "Meta" },
  "omia decidores b2b - duplicado":            { cuenta: "averix", canal: "Meta" },
  "averix omnicanal":                          { cuenta: "averix", canal: "Meta" },
  "averix omnicanal - mayo junio":             { cuenta: "averix", canal: "Meta" },
  "averix omnicanal - mayo junio - duplicado": { cuenta: "averix", canal: "Meta" },
  "averix omnicanal mayo 11":                  { cuenta: "averix", canal: "Meta" },
  "averix_leadgen_omnicanal_may26":            { cuenta: "averix", canal: "Meta" },
  "broadcasterbot_junio_julio":                { cuenta: "averix", canal: "Meta" },
  "broadcasterbot junio julio":                { cuenta: "averix", canal: "Meta" },
  "broadcasterbot__op_junio_julio":            { cuenta: "averix", canal: "Meta" },
  "omnicanalidad":                             { cuenta: "averix", canal: "Google" },
  "omia_search_leadgen_highintent_mx_v01":     { cuenta: "averix", canal: "Google" },
  "vendia_search_leadgen_highintent_mx_v01":   { cuenta: "averix", canal: "Google" },
  "api para whatsapp":                         { cuenta: "averix", canal: "Google" },
  "asistente de voz con ia":                   { cuenta: "averix", canal: "Google" },
  "asistente virtual telefonico":              { cuenta: "averix", canal: "Google" },
  "automatizacion de marketing":               { cuenta: "averix", canal: "Google" },
  "catalogo digital de productos":             { cuenta: "averix", canal: "Google" },
  "chatbot omnicanal":                         { cuenta: "averix", canal: "Google" },
  "chatbot para atencion al cliente":          { cuenta: "averix", canal: "Google" },
  "chatbota":                                  { cuenta: "averix", canal: "Google" },
  "whatsapp empresarial":                      { cuenta: "averix", canal: "Google" },
  "e-markeed branding":                        { cuenta: "emk", canal: "Meta" },
  "e-markeed impulsa tu negocio 26":           { cuenta: "emk", canal: "Meta" },
  "e-markeed impulsa tu negocio 26 filtrado":  { cuenta: "emk", canal: "Meta" },
  "emarkeed-servicios":                        { cuenta: "emk", canal: "Meta" },
  "impulsa tu negocio 26 - copia":             { cuenta: "emk", canal: "Meta" },
  "video branding 26":                         { cuenta: "emk", canal: "Meta" },
};

function getCuentaFromCampaign(rawName) {
  if (!rawName) return null;
  const norm = String(rawName).toLowerCase().trim();
  if (CAMP_MAP[norm]) return CAMP_MAP[norm].cuenta;
  const found = Object.entries(CAMP_MAP).find(([k]) => norm.includes(k) || k.includes(norm));
  return found ? found[1].cuenta : null;
}

// Atribución directa y confiable vía el campo "Empresa Interna" (empresa_interna)
function getCuentaFromEmpresaInterna(valor) {
  if (!valor) return null;
  const norm = String(valor).toLowerCase().trim();
  if (norm === "averix") return "averix";
  if (norm === "e-markeed" || norm === "emk" || norm === "emarkeed") return "emk";
  return null;
}

// Mapeo nombre campaña Meta → cuenta (para atribución de leads de Meta Ads)
const META_CAMP_CUENTA = {
  "Comercio en WhatsApp - Vendia Duplicado":   "averix",
  "Comercio en WhatsApp":                      "averix",
  "Omia Decidores B2B":                        "averix",
  "Averix Omnicanal - Mayo Junio":             "averix",
  "Averix Omnicanal":                          "averix",
  "BroadCasterBot_Junio_julio":                "averix",
  "e-Markeed Branding - Copia":                "emk",
  "e-Markeed Branding":                        "emk",
  "e-Markeed Impulsa Tu negocio 26 filtrado":  "emk",
  "e-Markeed Impulsa Tu negocio 26":           "emk",
};

// ── Consultar Meta Ads API ──
async function getMetaLeads(fi, ff, token, adAccountId) {
  const resultado = { averix: 0, emk: 0, detalle: {} };
  const fields = `name,effective_status,insights.time_range({"since":"${fi}","until":"${ff}"}){actions,spend,campaign_name}`;
  const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns?fields=${encodeURIComponent(fields)}&access_token=${token}&limit=100`;

  const { status, body } = await httpsGet(url);
  if (status !== 200) throw new Error(`Meta API ${status}: ${JSON.stringify(body)}`);

  const processCampaigns = (list) => {
    for (const camp of list || []) {
      const name = camp.name || "";
      const campStatus = camp.effective_status || "UNKNOWN";
      const insight = camp.insights?.data?.[0] || {};
      const actions = insight.actions || [];
      const leadAction = actions.find(a =>
        a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
      );
      const leads = parseInt(leadAction?.value || 0);
      const spend = parseFloat(insight.spend || 0);
      resultado.detalle[name] = { leads, spend, status: campStatus };

      const cuenta = Object.entries(META_CAMP_CUENTA).find(([k]) =>
        name.toLowerCase().includes(k.toLowerCase())
      )?.[1];

      if (cuenta === "averix") resultado.averix += leads;
      else if (cuenta === "emk") resultado.emk += leads;
    }
  };

  processCampaigns(body.data);

  let next = body.paging?.next;
  while (next) {
    const { body: page } = await httpsGet(next);
    processCampaigns(page.data);
    next = page.paging?.next;
  }

  return resultado;
}

// ── Consultar HubSpot: leads de Google Ads (contactos) ──
async function getGoogleLeads(fi, ff, token) {
  const tsFi = new Date(`${fi}T00:00:00.000Z`).getTime();
  const tsFf = new Date(`${ff}T23:59:59.999Z`).getTime();
  let averixGoogle = 0;
  let after;

  do {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: "createdate", operator: "BETWEEN", value: String(tsFi), highValue: String(tsFf) },
          { propertyName: "hs_analytics_source", operator: "EQ", value: "PAID_SEARCH" },
        ],
      }],
      properties: ["hs_latest_source_data_2", "hs_analytics_source"],
      limit: 200,
      ...(after ? { after } : {}),
    };

    const { status, body: data } = await hsPost(body, token);
    if (status !== 200) break;

    for (const c of data.results ?? []) {
      averixGoogle++;
    }
    after = data.paging?.next?.after;
  } while (after);

  return averixGoogle;
}

// ── NUEVO: Contactos del periodo (creados en el rango) — usado solo para muestreo/diagnóstico ──
async function getContactsDelPeriodo(fi, ff, token) {
  const tsFi = new Date(`${fi}T00:00:00.000Z`).getTime();
  const tsFf = new Date(`${ff}T23:59:59.999Z`).getTime();
  const contactos = [];
  let after;

  do {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: "createdate", operator: "BETWEEN", value: String(tsFi), highValue: String(tsFf) },
        ],
      }],
      properties: [
        "hs_latest_source_data_2",
        "hs_analytics_source",
        "empresa_interna",
        "estatus_del_lead",
        "lifecyclestage",
        "hs_v2_date_entered_marketingqualifiedlead",
        "hs_v2_date_entered_salesqualifiedlead",
      ],
      limit: 200,
      ...(after ? { after } : {}),
    };

    const { status, body: data } = await hsPost(body, token);
    if (status !== 200) break;

    contactos.push(...(data.results ?? []));
    after = data.paging?.next?.after;
  } while (after);

  return contactos;
}

// ── NUEVO: MQL → SQL — busca directamente por fecha de ENTRADA a SQL, sin importar cuándo se creó el contacto ──
async function calcularMqlToSql(fi, ff, token, debug) {
  const tsFi = new Date(`${fi}T00:00:00.000Z`).getTime();
  const tsFf = new Date(`${ff}T23:59:59.999Z`).getTime();
  const resultado = { averix: 0, emk: 0 };
  const contactos = [];
  let after;
  const statusCodes = [];

  do {
    const body = {
      filterGroups: [{
        filters: [
          { propertyName: "hs_v2_date_entered_salesqualifiedlead", operator: "BETWEEN", value: String(tsFi), highValue: String(tsFf) },
        ],
      }],
      properties: ["empresa_interna", "hs_v2_date_entered_marketingqualifiedlead", "hs_v2_date_entered_salesqualifiedlead"],
      limit: 200,
      ...(after ? { after } : {}),
    };
    const { status, body: data } = await hsPost(body, token);
    statusCodes.push(status);
    if (status !== 200) break;

    contactos.push(...(data.results ?? []));
    after = data.paging?.next?.after;
  } while (after);

  if (debug) debug.mqlSqlSearchStatus = statusCodes;
  if (debug) debug.totalContactosEntraronASQLEnPeriodo = contactos.length;

  for (const c of contactos) {
    const p = c.properties || {};
    const cuenta = getCuentaFromEmpresaInterna(p.empresa_interna);
    if (cuenta === "averix") resultado.averix++;
    else if (cuenta === "emk") resultado.emk++;
  }

  return resultado;
}

// ── NUEVO: Deals creados o cerrados dentro del periodo ──
async function getDealsPorFecha(fi, ff, token, campoFecha, soloCerradosGanados, debug) {
  const tsFi = new Date(`${fi}T00:00:00.000Z`).getTime();
  const tsFf = new Date(`${ff}T23:59:59.999Z`).getTime();
  const deals = [];
  let after;
  const statusCodes = [];

  do {
    const filtros = [
      { propertyName: campoFecha, operator: "BETWEEN", value: String(tsFi), highValue: String(tsFf) },
    ];
    if (soloCerradosGanados) {
      filtros.push({ propertyName: "hs_is_closed_won", operator: "EQ", value: "true" });
    }
    const body = {
      filterGroups: [{ filters: filtros }],
      properties: ["dealstage", "hs_is_closed_won", "createdate", "closedate"],
      limit: 200,
      ...(after ? { after } : {}),
    };
    const { status, body: data } = await hsRequest("/crm/v3/objects/deals/search", "POST", body, token);
    statusCodes.push(status);
    if (status !== 200) break;

    deals.push(...(data.results ?? []));
    after = data.paging?.next?.after;
  } while (after);

  if (debug) {
    debug[`dealsSearchStatus_${campoFecha}${soloCerradosGanados ? "_ganados" : ""}`] = statusCodes;
  }

  return deals;
}

// ── NUEVO: asociaciones deal → contactos (API v4 batch, dirección inversa) ──
async function getContactosDeDeals(dealIds, token, debug) {
  const mapa = {}; // dealId -> [contactId, ...]
  const chunkSize = 100;
  const idsUnicos = [...new Set(dealIds)];
  const statusCodes = [];

  for (let i = 0; i < idsUnicos.length; i += chunkSize) {
    const chunk = idsUnicos.slice(i, i + chunkSize);
    const body = { inputs: chunk.map(id => ({ id: String(id) })) };
    const { status, body: data } = await hsRequest(
      "/crm/v4/associations/deals/contacts/batch/read",
      "POST",
      body,
      token
    );
    statusCodes.push(status);
    if (status !== 200) continue;

    for (const r of data.results ?? []) {
      const fromId = r.from?.id;
      const contactIds = (r.to ?? []).map(t => t.toObjectId || t.id).filter(Boolean);
      if (fromId) mapa[fromId] = contactIds;
    }
  }

  if (debug) debug.dealsContactosAssocStatus = statusCodes;
  return mapa;
}

// ── NUEVO: leer contactos en batch (empresa_interna, fuente, canal) ──
async function getContactsBatch(contactIds, token, debug) {
  const mapa = {}; // contactId -> properties
  const chunkSize = 100;
  const idsUnicos = [...new Set(contactIds)];
  const statusCodes = [];

  for (let i = 0; i < idsUnicos.length; i += chunkSize) {
    const chunk = idsUnicos.slice(i, i + chunkSize);
    const body = {
      inputs: chunk.map(id => ({ id: String(id) })),
      properties: ["empresa_interna", "hs_latest_source_data_2", "hs_analytics_source"],
    };
    const { status, body: data } = await hsRequest("/crm/v3/objects/contacts/batch/read", "POST", body, token);
    statusCodes.push(status);
    if (status !== 200) continue;

    for (const c of data.results ?? []) {
      mapa[c.id] = c.properties || {};
    }
  }

  if (debug) debug.contactsBatchStatus = statusCodes;
  return mapa;
}

// ── NUEVO: Negocios (deals creados en el periodo) y Cierres (deals cerrados-ganados en el periodo) ──
async function calcularNegociosYCierres(fi, ff, token, debug) {
  const resultado = {
    averix: { negocios: 0, cierres: 0 },
    emk: { negocios: 0, cierres: 0 },
    averixGoogle: { negocios: 0, cierres: 0 },
    porCampana: {}, // { "nombre campaña normalizado": { negocios, cierres } }
  };

  const dealsCreados = await getDealsPorFecha(fi, ff, token, "createdate", false, debug);
  const dealsCerrados = await getDealsPorFecha(fi, ff, token, "closedate", true, debug);
  debug.totalDealsCreadosEnPeriodo = dealsCreados.length;
  debug.totalDealsCerradosGanadosEnPeriodo = dealsCerrados.length;

  const todosLosDealIds = [...new Set([...dealsCreados.map(d => d.id), ...dealsCerrados.map(d => d.id)])];
  if (!todosLosDealIds.length) return resultado;

  const dealContactos = await getContactosDeDeals(todosLosDealIds, token, debug);
  const todosLosContactIds = Object.values(dealContactos).flat();
  debug.totalContactosAsociadosADeals = todosLosContactIds.length;

  const contactosInfo = await getContactsBatch(todosLosContactIds, token, debug);

  const primerContactoDe = (dealId) => {
    const ids = dealContactos[dealId] || [];
    return ids.length ? contactosInfo[ids[0]] : null;
  };

  const aplicar = (deals, tipo) => {
    for (const deal of deals) {
      const contacto = primerContactoDe(deal.id);
      if (!contacto) continue;

      const cuenta = getCuentaFromEmpresaInterna(contacto.empresa_interna);
      if (cuenta === "averix" || cuenta === "emk") {
        resultado[cuenta][tipo]++;

        if (cuenta === "averix" && contacto.hs_analytics_source === "PAID_SEARCH") {
          resultado.averixGoogle[tipo]++;
        }

        const campNorm = String(contacto.hs_latest_source_data_2 || "").toLowerCase().trim();
        if (campNorm) {
          if (!resultado.porCampana[campNorm]) resultado.porCampana[campNorm] = { negocios: 0, cierres: 0 };
          resultado.porCampana[campNorm][tipo]++;
        }
      }
    }
  };

  aplicar(dealsCreados, "negocios");
  aplicar(dealsCerrados, "cierres");

  return resultado;
}

// ── Handler principal ──
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const { fi, ff } = req.query;
  if (!fi || !ff) return res.status(400).json({ error: "Parámetros fi y ff requeridos" });

  const META_TOKEN = process.env.META_TOKEN;
  const HS_TOKEN   = process.env.HUBSPOT_TOKEN;
  const AD_AVERIX  = "1999778244105005";
  const AD_EMK     = "423996390009898";

  const resultado = {
    averix: { Meta: {}, Google: 0, LinkedIn: 0, MQLtoSQL: 0, Negocios: 0, Cierres: 0 },
    emk:    { Meta: {}, Google: 0, TikTok: 0, MQLtoSQL: 0, Negocios: 0, Cierres: 0 },
    fuente: {},
  };

  try {
    if (META_TOKEN) {
      const metaAv = await getMetaLeads(fi, ff, META_TOKEN, AD_AVERIX);
      resultado.averix.Meta = metaAv.detalle;
      resultado.fuente.meta_averix = `Meta Ads Averix ✅ (${metaAv.averix} leads)`;

      const metaEm = await getMetaLeads(fi, ff, META_TOKEN, AD_EMK);
      resultado.emk.Meta = metaEm.detalle;
      resultado.fuente.meta_emk = `Meta Ads e-Markeed ✅ (${metaEm.emk} leads)`;
    } else {
      resultado.fuente.meta = "META_TOKEN no configurado ⚠️";
    }

    const debug = {};

    if (HS_TOKEN) {
      resultado.averix.Google = await getGoogleLeads(fi, ff, HS_TOKEN);
      resultado.fuente.google = "HubSpot CRM ✅";

      // Muestra de diagnóstico (contactos creados en el periodo, no usado para Negocios/Cierres/MQL-SQL)
      const contactosPeriodo = await getContactsDelPeriodo(fi, ff, HS_TOKEN);
      debug.totalContactosPeriodo = contactosPeriodo.length;
      debug.contactosConEmpresaInterna = contactosPeriodo.filter(c => c.properties?.empresa_interna).length;
      debug.ejemploContacto = contactosPeriodo[0]?.properties || null;

      // MQL→SQL: busca por fecha real de conversión, sin importar cuándo se creó el contacto
      const mqlSql = await calcularMqlToSql(fi, ff, HS_TOKEN, debug);
      resultado.averix.MQLtoSQL = mqlSql.averix;
      resultado.emk.MQLtoSQL = mqlSql.emk;
      resultado.fuente.mql_sql = "HubSpot lifecycle stages ✅";

      // Negocios: deals creados en el periodo. Cierres: deals cerrados-ganados en el periodo. (Independiente de cuándo se creó el contacto)
      const negociosCierres = await calcularNegociosYCierres(fi, ff, HS_TOKEN, debug);
      resultado.averix.Negocios = negociosCierres.averix.negocios;
      resultado.averix.Cierres  = negociosCierres.averix.cierres;
      resultado.emk.Negocios    = negociosCierres.emk.negocios;
      resultado.emk.Cierres     = negociosCierres.emk.cierres;
      resultado.averix.NegociosGoogle = negociosCierres.averixGoogle.negocios;
      resultado.averix.CierresGoogle  = negociosCierres.averixGoogle.cierres;
      resultado.negociosPorCampana = negociosCierres.porCampana; // { "nombre campaña (lowercase)": {negocios, cierres} }
      resultado.fuente.deals = "HubSpot Deals ✅";
    } else {
      resultado.fuente.hubspot = "HUBSPOT_TOKEN no configurado ⚠️";
    }

    resultado.debug = debug;

    // Totales (corregido: sumar .leads de cada campaña, no el objeto completo)
    const totalAvMeta = Object.values(resultado.averix.Meta).reduce((a, b) => a + (b.leads || 0), 0);
    const totalEmMeta = Object.values(resultado.emk.Meta).reduce((a, b) => a + (b.leads || 0), 0);
    resultado.totales = {
      averix: {
        Meta: totalAvMeta,
        Google: resultado.averix.Google,
        MQLtoSQL: resultado.averix.MQLtoSQL,
        Negocios: resultado.averix.Negocios,
        Cierres: resultado.averix.Cierres,
      },
      emk: {
        Meta: totalEmMeta,
        Google: 0,
        MQLtoSQL: resultado.emk.MQLtoSQL,
        Negocios: resultado.emk.Negocios,
        Cierres: resultado.emk.Cierres,
      },
    };

    return res.status(200).json(resultado);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
