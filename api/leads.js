const https = require("https");

// ── Helpers ──
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    }).on("error", reject);
  });
}

function hsPost(body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: "api.hubapi.com",
      path: "/crm/v3/objects/contacts/search",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Mapeo campaña → cuenta y canal (para HubSpot fallback) ──
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

// Mapeo nombre campaña Meta → cuenta
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
  const fields = `name,insights.time_range({"since":"${fi}","until":"${ff}"}){actions,campaign_name}`;
  const url = `https://graph.facebook.com/v19.0/act_${adAccountId}/campaigns?fields=${encodeURIComponent(fields)}&access_token=${token}&limit=100`;

  const { status, body } = await httpsGet(url);
  if (status !== 200) throw new Error(`Meta API ${status}: ${JSON.stringify(body)}`);

  for (const camp of body.data || []) {
    const name = camp.name || "";
    // Extraer leads de actions
    const actions = camp.insights?.data?.[0]?.actions || [];
    const leadAction = actions.find(a =>
      a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
    );
    const leads = parseInt(leadAction?.value || 0);
    resultado.detalle[name] = leads;

    // Buscar cuenta por nombre de campaña
    const cuenta = Object.entries(META_CAMP_CUENTA).find(([k]) =>
      name.toLowerCase().includes(k.toLowerCase())
    )?.[1];

    if (cuenta === "averix") resultado.averix += leads;
    else if (cuenta === "emk") resultado.emk += leads;
  }

  // Paginar si hay más
  let next = body.paging?.next;
  while (next) {
    const { body: page } = await httpsGet(next);
    for (const camp of page.data || []) {
      const name = camp.name || "";
      const actions = camp.insights?.data?.[0]?.actions || [];
      const leadAction = actions.find(a =>
        a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
      );
      const leads = parseInt(leadAction?.value || 0);
      resultado.detalle[name] = leads;
      const cuenta = Object.entries(META_CAMP_CUENTA).find(([k]) =>
        name.toLowerCase().includes(k.toLowerCase())
      )?.[1];
      if (cuenta === "averix") resultado.averix += leads;
      else if (cuenta === "emk") resultado.emk += leads;
    }
    next = page.paging?.next;
  }

  return resultado;
}

// ── Consultar HubSpot (Google Ads) ──
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
          { propertyName: "hs_analytics_source", operator: "EQ", values: ["PAID_SEARCH"] },
        ],
      }],
      properties: ["hs_latest_source_data_2"],
      limit: 200,
      ...(after ? { after } : {}),
    };

    const { status, body: data } = await hsPost(body, token);
    if (status !== 200) break;

    for (const c of data.results ?? []) {
      const raw = c.properties?.hs_latest_source_data_2;
      if (!raw) continue;
      const camp = String(raw).toLowerCase().trim();
      const map = CAMP_MAP[camp];
      if (map?.canal === "Google" && map?.cuenta === "averix") averixGoogle++;
    }
    after = data.paging?.next?.after;
  } while (after);

  return averixGoogle;
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
    averix: { Meta: {}, Google: 0, LinkedIn: 0 },
    emk:    { Meta: {}, Google: 0, TikTok: 0 },
    fuente: {},
  };

  try {
    if (META_TOKEN) {
      // Averix
      const metaAv = await getMetaLeads(fi, ff, META_TOKEN, AD_AVERIX);
      resultado.averix.Meta = metaAv.detalle;
      resultado.fuente.meta_averix = `Meta Ads Averix ✅ (${metaAv.averix} leads)`;

      // e-Markeed
      const metaEm = await getMetaLeads(fi, ff, META_TOKEN, AD_EMK);
      resultado.emk.Meta = metaEm.detalle;
      resultado.fuente.meta_emk = `Meta Ads e-Markeed ✅ (${metaEm.emk} leads)`;
    } else {
      resultado.fuente.meta = "META_TOKEN no configurado ⚠️";
    }

    if (HS_TOKEN) {
      resultado.averix.Google = await getGoogleLeads(fi, ff, HS_TOKEN);
      resultado.fuente.google = "HubSpot CRM ✅";
    }

    // Totales
    const totalAvMeta = Object.values(resultado.averix.Meta).reduce((a,b)=>a+b,0);
    const totalEmMeta = Object.values(resultado.emk.Meta).reduce((a,b)=>a+b,0);
    resultado.totales = {
      averix: { Meta: totalAvMeta, Google: resultado.averix.Google },
      emk:    { Meta: totalEmMeta, Google: 0 },
    };

    return res.status(200).json(resultado);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
