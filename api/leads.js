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
  // fallback: coincidencia parcial
  const found = Object.entries(CAMP_MAP).find(([k]) => norm.includes(k) || k.includes(norm));
  return found ? found[1].cuenta : null;
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

// ── NUEVO: Contactos del periodo con datos de lifecycle + fuente ──
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
        "lifecyclestage",
        "hs_lifecyclestage_marketingqualifiedlead_date",
        "hs_lifecyclestage_salesqualifiedlead_date",
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

// ── NUEVO: MQL → SQL a partir de los contactos ya obtenidos ──
function calcularMqlToSql(contactos, fi, ff) {
  const tsFi = new Date(`${fi}T00:00:00.000Z`).getTime();
  const tsFf = new Date(`${ff}T23:59:59.999Z`).getTime();
  const resultado = { averix: 0, emk: 0 };

  for (const c of contactos) {
    const p = c.properties || {};
    const mqlDate = p.hs_lifecyclestage_marketingqualifiedlead_date;
    const sqlDate = p.hs_lifecyclestage_salesqualifiedlead_date;
    if (!mqlDate || !sqlDate) continue;

    const sqlTs = new Date(sqlDate).getTime();
    // Solo contamos la conversión si el paso a SQL ocurrió dentro del periodo consultado
    if (sqlTs < tsFi || sqlTs > tsFf) continue;

    const cuenta = getCuentaFromCampaign(p.hs_latest_source_data_2);
    if (cuenta === "averix") resultado.averix++;
    else if (cuenta === "emk") resultado.emk++;
  }

  return resultado;
}

// ── NUEVO: asociaciones contacto → deals (API v4 batch) ──
async function getAsociacionesDeals(contactIds, token) {
  const mapa = {}; // contactId -> [dealId, dealId, ...]
  const chunkSize = 100;

  for (let i = 0; i < contactIds.length; i += chunkSize) {
    const chunk = contactIds.slice(i, i + chunkSize);
    const body = { inputs: chunk.map(id => ({ id: String(id) })) };
    const { status, body: data } = await hsRequest(
      "/crm/v4/associations/contacts/deals/batch/read",
      "POST",
      body,
      token
    );
    if (status !== 200) continue;

    for (const r of data.results ?? []) {
      const fromId = r.from?.id;
      const dealIds = (r.to ?? []).map(t => t.toObjectId || t.id).filter(Boolean);
      if (fromId) mapa[fromId] = dealIds;
    }
  }

  return mapa;
}

// ── NUEVO: leer deals en batch (dealstage, hs_is_closed_won) ──
async function getDealsBatch(dealIds, token) {
  const mapa = {}; // dealId -> { isClosedWon }
  const chunkSize = 100;
  const idsUnicos = [...new Set(dealIds)];

  for (let i = 0; i < idsUnicos.length; i += chunkSize) {
    const chunk = idsUnicos.slice(i, i + chunkSize);
    const body = {
      inputs: chunk.map(id => ({ id: String(id) })),
      properties: ["dealstage", "hs_is_closed_won", "closedate"],
    };
    const { status, body: data } = await hsRequest(
      "/crm/v3/objects/deals/batch/read",
      "POST",
      body,
      token
    );
    if (status !== 200) continue;

    for (const d of data.results ?? []) {
      mapa[d.id] = {
        isClosedWon: d.properties?.hs_is_closed_won === "true",
        dealstage: d.properties?.dealstage,
      };
    }
  }

  return mapa;
}

// ── NUEVO: Negocios y Cierres a partir de contactos + deals asociados ──
async function calcularNegociosYCierres(contactos, token) {
  const resultado = {
    averix: { negocios: 0, cierres: 0 },
    emk: { negocios: 0, cierres: 0 },
  };

  const contactIds = contactos.map(c => c.id);
  if (!contactIds.length) return resultado;

  const asociaciones = await getAsociacionesDeals(contactIds, token);
  const todosLosDealIds = Object.values(asociaciones).flat();
  if (!todosLosDealIds.length) return resultado;

  const dealsInfo = await getDealsBatch(todosLosDealIds, token);

  for (const c of contactos) {
    const cuenta = getCuentaFromCampaign(c.properties?.hs_latest_source_data_2);
    if (cuenta !== "averix" && cuenta !== "emk") continue;

    const dealIds = asociaciones[c.id] || [];
    if (!dealIds.length) continue;

    resultado[cuenta].negocios++;

    const tieneAlgunCierre = dealIds.some(id => dealsInfo[id]?.isClosedWon);
    if (tieneAlgunCierre) resultado[cuenta].cierres++;
  }

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

    if (HS_TOKEN) {
      resultado.averix.Google = await getGoogleLeads(fi, ff, HS_TOKEN);
      resultado.fuente.google = "HubSpot CRM ✅";

      // Un solo fetch de contactos del periodo, reutilizado para MQL→SQL, Negocios y Cierres
      const contactosPeriodo = await getContactsDelPeriodo(fi, ff, HS_TOKEN);

      const mqlSql = calcularMqlToSql(contactosPeriodo, fi, ff);
      resultado.averix.MQLtoSQL = mqlSql.averix;
      resultado.emk.MQLtoSQL = mqlSql.emk;
      resultado.fuente.mql_sql = "HubSpot lifecycle stages ✅";

      const negociosCierres = await calcularNegociosYCierres(contactosPeriodo, HS_TOKEN);
      resultado.averix.Negocios = negociosCierres.averix.negocios;
      resultado.averix.Cierres  = negociosCierres.averix.cierres;
      resultado.emk.Negocios    = negociosCierres.emk.negocios;
      resultado.emk.Cierres     = negociosCierres.emk.cierres;
      resultado.fuente.deals = "HubSpot Deals ✅";
    } else {
      resultado.fuente.hubspot = "HUBSPOT_TOKEN no configurado ⚠️";
    }

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
