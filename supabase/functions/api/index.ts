// =========================================================
// API REST — Supabase Edge Function "api"
//
// Rotas (base: https://<PROJECT_REF>.supabase.co/functions/v1/api)
//   POST /leituras            -> recebe leituras do ESP32 (header x-device-token)
//   GET  /leituras/ultima     -> leitura mais recente de cada grandeza
//   GET  /leituras            -> histórico (?grandeza=&limite=&device_id=)
//   GET  /status              -> teste rápido da API
//
// Variáveis de ambiente:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY -> já existem automaticamente
//   DEVICE_TOKEN                            -> criar em Edge Functions > Secrets
// =========================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

// Chave de servidor: a nova (SUPABASE_SECRET_KEYS) ou a legada (SERVICE_ROLE_KEY)
function chaveServidor(): string {
  try {
    const novas = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const primeira = novas.default ?? Object.values(novas)[0];
    if (typeof primeira === "string" && primeira) return primeira;
  } catch { /* usa a legada */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, chaveServidor());
const DEVICE_TOKEN = Deno.env.get("DEVICE_TOKEN") ?? "";

// Grandezas aceitas, unidade padrão, faixa válida do DHT22 e limite de alerta
const GRANDEZAS: Record<string, { unidade: string; min: number; max: number; limite: number }> = {
  temperatura: { unidade: "°C", min: -40, max: 80, limite: 8 },
  umidade: { unidade: "%", min: 0, max: 100, limite: 70 },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-device-token, authorization, apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

type LeituraIn = { grandeza?: unknown; valor?: unknown; unidade?: unknown };

async function receber(req: Request) {
  if (!DEVICE_TOKEN || req.headers.get("x-device-token") !== DEVICE_TOKEN) {
    return json({ erro: "token do dispositivo inválido" }, 401);
  }

  let body: { device_id?: unknown; leituras?: LeituraIn[]; alerta?: unknown } & LeituraIn;
  try {
    body = await req.json();
  } catch {
    return json({ erro: "JSON inválido" }, 400);
  }

  const device_id = typeof body.device_id === "string" ? body.device_id.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(device_id)) {
    return json({ erro: "device_id obrigatório (letras, números, - ou _)" }, 400);
  }

  // Aceita um lote {leituras:[...]} ou uma leitura única {grandeza, valor}
  const lista: LeituraIn[] = Array.isArray(body.leituras) ? body.leituras : [body];
  if (lista.length === 0 || lista.length > 10) {
    return json({ erro: "envie de 1 a 10 leituras" }, 400);
  }

  const linhas = [];
  let algumaAcimaDoLimite = false;
  for (const l of lista) {
    const g = typeof l.grandeza === "string" ? GRANDEZAS[l.grandeza] : undefined;
    const valor = Number(l.valor);
    if (!g) return json({ erro: `grandeza inválida: ${l.grandeza}` }, 400);
    if (!Number.isFinite(valor) || valor < g.min || valor > g.max) {
      return json({ erro: `valor fora da faixa para ${l.grandeza}: ${l.valor}` }, 422);
    }
    if (valor > g.limite) algumaAcimaDoLimite = true;
    linhas.push({ device_id, grandeza: l.grandeza as string, valor, unidade: g.unidade, alerta: false });
  }
  // Alerta do envio: o do ESP32 (que usa histerese) ou, se não vier, recalculado aqui
  const alerta = typeof body.alerta === "boolean" ? body.alerta : algumaAcimaDoLimite;
  linhas.forEach((l) => (l.alerta = alerta));

  const { data, error } = await supabase.from("leituras").insert(linhas).select();
  if (error) return json({ erro: error.message }, 500);

  console.log(`recebido ${device_id}:`, linhas.map((l) => `${l.grandeza}=${l.valor}`).join(" "));
  return json({ ok: true, gravadas: data?.length ?? 0, recebido_em: data?.[0]?.recebido_em }, 201);
}

async function ultima(url: URL) {
  const device_id = url.searchParams.get("device_id") ?? "camara-01";
  const resultado: Record<string, unknown> = {};
  for (const grandeza of Object.keys(GRANDEZAS)) {
    const { data, error } = await supabase
      .from("leituras")
      .select("*")
      .eq("device_id", device_id)
      .eq("grandeza", grandeza)
      .order("recebido_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return json({ erro: error.message }, 500);
    resultado[grandeza] = data;
  }
  return json({ device_id, agora: new Date().toISOString(), limites: limites(), leituras: resultado });
}

async function historico(url: URL) {
  const device_id = url.searchParams.get("device_id") ?? "camara-01";
  const grandeza = url.searchParams.get("grandeza");
  const limite = Math.min(Math.max(Number(url.searchParams.get("limite")) || 60, 1), 500);

  let q = supabase
    .from("leituras")
    .select("*")
    .eq("device_id", device_id)
    .order("recebido_em", { ascending: false })
    .limit(limite);
  if (grandeza) {
    if (!GRANDEZAS[grandeza]) return json({ erro: "grandeza inválida" }, 400);
    q = q.eq("grandeza", grandeza);
  }
  const { data, error } = await q;
  if (error) return json({ erro: error.message }, 500);
  return json({ device_id, agora: new Date().toISOString(), total: data.length, leituras: data });
}

function limites() {
  return Object.fromEntries(
    Object.entries(GRANDEZAS).map(([k, v]) => [k, { limite: v.limite, unidade: v.unidade }]),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // pathname chega como /api/leituras/ultima -> pega o que vem depois de "api"
  const url = new URL(req.url);
  const partes = url.pathname.split("/").filter(Boolean);
  const i = partes.indexOf("api");
  const rota = "/" + partes.slice(i + 1).join("/");

  try {
    if (rota === "/leituras" && req.method === "POST") return await receber(req);
    if (rota === "/leituras/ultima" && req.method === "GET") return await ultima(url);
    if (rota === "/leituras" && req.method === "GET") return await historico(url);
    if (rota === "/status" || rota === "/") return json({ ok: true, agora: new Date().toISOString() });
    return json({ erro: "rota não encontrada", rota }, 404);
  } catch (e) {
    return json({ erro: String(e) }, 500);
  }
});
