const https = require("https");

const CAMP_MAP = {
  "comercio en whatsapp - vendia duplicado": { cuenta: "averix", canal: "Meta" },
  "comercio en whatsapp":                    { cuenta: "averix", canal: "Meta" },
  "omia decidores b2b":                      { cuenta: "averix", canal: "Meta" },
  "omia decidores b2b - duplicado":          { cuenta: "averix", canal: "Meta" },
  "averix omnicanal":                        { cuenta: "averix", canal: "Meta" },
  "averix omnicanal - mayo junio":           { cuenta: "averix", canal: "Meta" },
  "averix omnicanal - mayo junio - duplicado":{ cuenta: "averix", canal: "Meta" },
  "averix omnicanal mayo 11":                { cuenta: "averix", canal: "Meta" },
  "averix_leadgen_omnicanal_may26":          { cuenta: "averix", canal: "Meta" },
  "averix 20/3/26":                          { cuenta: "averix", canal: "Meta" },
  "averix 1/4/26":                           { cuenta: "averix", canal: "Meta" },
  "vendia formulario clientes potenciales":  { cuenta: "averix", canal: "Meta" },
  "broadcasterbot_junio_julio":              { cuenta: "averix", canal: "Meta" },
  "omnicanalidad":                           { cuenta: "averix", canal: "Google" },
  "omia_search_leadgen_highintent_mx_v01":   { cuenta: "averix", canal: "Google" },
  "vendia_search_leadgen_highintent_mx_v01": { cuenta: "averix", canal: "Google" },
  "api para whatsapp":                       { cuenta: "averix", canal: "Google" },
  "asistente de voz con ia":                 { cuenta: "averix", canal: "Google" },
  "asistente virtual telefonico":            { cuenta: "averix", canal: "Google" },
  "automatizacion de marketing":             { cuenta: "averix", canal: "Google" },
  "catalogo digital de productos":           { cuenta: "averix", canal: "Google" },
  "chatbot omnicanal":                       { cuenta: "averix", canal: "Google" },
  "chatbot para atencion al cliente":        { cuenta: "averix", canal: "Google" },
  "chatbota":                                { cuenta: "averix", canal: "Google" },
  "whatsapp empresarial":                    { cuenta: "averix", canal: "Google" },
  "e-markeed branding":                      { cuenta: "emk", canal: "Meta" },
  "e-markeed impulsa tu negocio 26":         { cuenta: "emk", canal: "Meta" },
  "e-markeed impulsa tu negocio 26 filtrado":{ cuenta: "emk", canal: "Meta" },
  "emarkeed-servicios":                      { cuenta: "emk", canal: "Meta" },
  "impulsa tu negocio 26 - copia":           { cuenta: "emk", canal: "Meta" },
  "video branding 26":                       { cuenta: "emk", canal: "Meta" },
};

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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const { fi, ff } = req.query;
  if (!fi || !ff) {
    return res.status(400).json({ error: "Parámetros fi y ff requeridos (YYYY-MM-DD)" });
  }

  const TOKEN = process.env.HUBSPOT_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: "HUBSPOT_TOKEN no configurado" });

  const tsFi = new Date(`${fi}T00:00:00.000Z`).getTime();
  const tsFf = new Date(`${ff}T23:59:59.999Z`).getTime();

  const resultado = {
    averix: { Meta: 0, Google: 0, LinkedIn: 0 },
    emk:    { Meta: 0, Google: 0, TikTok: 0 },
    detalle: {},
  };

  try {
    let after = undefined;
    do {
      const body = {
        filterGroups: [{
          filters: [
            { propertyName: "createdate", operator: "BETWEEN", value: String(tsFi), highValue: String(tsFf) },
            { propertyName: "hs_analytics_source", operator: "IN", values: ["PAID_SOCIAL", "PAID_SEARCH"] },
          ],
        }],
        properties: ["hs_latest_source_data_2", "hs_analytics_source"],
        limit: 200,
        ...(after ? { after } : {}),
      };

      const { status, body: data } = await hsPost(body, TOKEN);
      if (status !== 200) return res.status(status).json({ error: data });

      for (const c of data.results ?? []) {
        const raw = c.properties?.hs_latest_source_data_2;
        if (!raw) continue;
        const camp = String(raw).toLowerCase().trim();
        resultado.detalle[camp] = (resultado.detalle[camp] ?? 0) + 1;
        const map = CAMP_MAP[camp];
        if (map && resultado[map.cuenta]?.[map.canal] !== undefined) {
          resultado[map.cuenta][map.canal] += 1;
        }
      }
      after = data.paging?.next?.after;
    } while (after);

    return res.status(200).json(resultado);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
