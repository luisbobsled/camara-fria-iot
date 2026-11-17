/*
 * Monitoramento IoT de Câmara Fria — ESP32 + DHT22 (Wokwi)
 *
 * Fluxo: DHT22 --(1 fio, protocolo próprio)--> ESP32 --(Wi-Fi + HTTPS)--> API (Supabase Edge Function)
 *
 * Tratamento no dispositivo:
 *   1) validação  : descarta NaN e valores fora da faixa do DHT22
 *   2) média móvel: últimas 5 amostras válidas (amostra a cada 2 s)
 *   3) comparação : alerta se T > 8,0 °C ou UR > 70 %, com histerese
 *                   (só sai do alerta quando T < 7,5 °C e UR < 68 %)
 * Envio para a API a cada 10 s.
 *
 * Botão (GPIO 14): pausa/retoma a transmissão -> usado no teste de interrupção.
 * LED vermelho (GPIO 26): alerta | LED verde (GPIO 27): transmitindo
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "DHTesp.h"
#include "secrets.h"   // API_URL, DEVICE_TOKEN (não vai para o GitHub)

// ---------- Pinos ----------
const int PIN_DHT       = 15;
const int PIN_LED_ALERT = 26;
const int PIN_LED_TX    = 27;
const int PIN_BOTAO     = 14;

// ---------- Configuração ----------
const char* WIFI_SSID   = "Wokwi-GUEST";   // rede virtual do Wokwi (sem senha)
const char* WIFI_PASS   = "";
const char* DEVICE_ID   = "camara-01";

const unsigned long INTERVALO_AMOSTRA_MS = 2000;   // DHT22 aceita no mínimo ~2 s
const unsigned long INTERVALO_ENVIO_MS   = 10000;  // intervalo de coleta enviado à API
const int           TAM_MEDIA            = 5;

const float LIMITE_TEMP    = 8.0,  RETORNO_TEMP = 7.5;
const float LIMITE_UMID    = 70.0, RETORNO_UMID = 68.0;

// ---------- Estado ----------
DHTesp dht;
float bufTemp[TAM_MEDIA], bufUmid[TAM_MEDIA];
int   nAmostras = 0, posBuf = 0;
bool  alerta = false;
bool  transmitindo = true;
unsigned long ultimaAmostra = 0, ultimoEnvio = 0;
unsigned long envios = 0, falhas = 0;

// ---------- Wi-Fi ----------
void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("[WiFi] conectando");
  WiFi.begin(WIFI_SSID, WIFI_PASS, 6);   // canal 6 acelera a conexão no Wokwi
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " ok, IP " + WiFi.localIP().toString() : " falhou");
}

// ---------- Leitura + tratamento ----------
bool leituraValida(float t, float h) {
  return !isnan(t) && !isnan(h) && t >= -40 && t <= 80 && h >= 0 && h <= 100;
}

void amostrar() {
  TempAndHumidity d = dht.getTempAndHumidity();
  if (!leituraValida(d.temperature, d.humidity)) {
    Serial.println("[DHT22] leitura inválida descartada");
    return;
  }
  bufTemp[posBuf] = d.temperature;
  bufUmid[posBuf] = d.humidity;
  posBuf = (posBuf + 1) % TAM_MEDIA;
  if (nAmostras < TAM_MEDIA) nAmostras++;
}

float media(const float* buf) {
  float s = 0;
  for (int i = 0; i < nAmostras; i++) s += buf[i];
  return s / nAmostras;
}

void atualizarAlerta(float t, float h) {
  if (!alerta && (t > LIMITE_TEMP || h > LIMITE_UMID)) alerta = true;
  else if (alerta && t < RETORNO_TEMP && h < RETORNO_UMID) alerta = false;
  digitalWrite(PIN_LED_ALERT, alerta ? HIGH : LOW);
}

// ---------- Envio HTTPS ----------
void enviar(float t, float h) {
  conectarWiFi();
  if (WiFi.status() != WL_CONNECTED) { falhas++; return; }

  String corpo = String("{\"device_id\":\"") + DEVICE_ID + "\","
               + "\"alerta\":" + (alerta ? "true" : "false") + ","
               + "\"leituras\":["
               +   "{\"grandeza\":\"temperatura\",\"valor\":" + String(t, 1) + ",\"unidade\":\"°C\"},"
               +   "{\"grandeza\":\"umidade\",\"valor\":"     + String(h, 1) + ",\"unidade\":\"%\"}"
               + "]}";

  WiFiClientSecure cliente;
  cliente.setInsecure();   // simulação: não valida o certificado (ver limitações no relatório)
  HTTPClient http;
  http.setTimeout(8000);
  http.begin(cliente, API_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_TOKEN);

  unsigned long t0 = millis();
  int codigo = http.POST(corpo);
  String resposta = http.getString();
  http.end();

  envios++;
  if (codigo != 201) falhas++;
  Serial.printf("[API] #%lu HTTP %d em %lu ms | T=%.1f °C UR=%.1f %% alerta=%s | %s\n",
                envios, codigo, millis() - t0, t, h, alerta ? "SIM" : "nao", resposta.c_str());
}

// ---------- Botão de pausa ----------
void verificarBotao() {
  static bool anterior = HIGH;
  static unsigned long ultimaTroca = 0;
  bool atual = digitalRead(PIN_BOTAO);
  if (anterior == HIGH && atual == LOW && millis() - ultimaTroca > 300) {
    transmitindo = !transmitindo;
    ultimaTroca = millis();
    Serial.println(transmitindo ? "[TX] transmissão RETOMADA" : "[TX] transmissão INTERROMPIDA");
  }
  anterior = atual;
  digitalWrite(PIN_LED_TX, transmitindo ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_ALERT, OUTPUT);
  pinMode(PIN_LED_TX, OUTPUT);
  pinMode(PIN_BOTAO, INPUT_PULLUP);
  dht.setup(PIN_DHT, DHTesp::DHT22);
  conectarWiFi();
  Serial.println("Câmara fria pronta. Altere o DHT22 clicando nele durante a simulação.");
}

void loop() {
  verificarBotao();
  unsigned long agora = millis();

  if (agora - ultimaAmostra >= INTERVALO_AMOSTRA_MS) {
    ultimaAmostra = agora;
    amostrar();
  }

  if (nAmostras > 0 && agora - ultimoEnvio >= INTERVALO_ENVIO_MS) {
    ultimoEnvio = agora;
    float t = media(bufTemp), h = media(bufUmid);
    atualizarAlerta(t, h);
    if (transmitindo) enviar(t, h);
    else Serial.printf("[TX] pausado — T=%.1f UR=%.1f não enviado\n", t, h);
  }
  delay(10);
}
