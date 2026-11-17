#!/usr/bin/env bash
# Testes da API sem precisar do Wokwi.
# Uso:  API=https://SEU_PROJECT_REF.supabase.co/functions/v1/api TOKEN=seu-token ./testes/testar_api.sh
set -u
API="${API:?defina API=https://SEU_PROJECT_REF.supabase.co/functions/v1/api}"
TOKEN="${TOKEN:?defina TOKEN=seu-device-token}"

echo "== 1. Status da API";               curl -s "$API/status"; echo
echo "== 2. Envio sem token (espera 401)";  curl -s -w " [HTTP %{http_code}]" -X POST "$API/leituras" -d '{}'; echo
echo "== 3. Leitura normal (espera 201)"
curl -s -w " [HTTP %{http_code}]" -X POST "$API/leituras" \
  -H "x-device-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"device_id":"camara-01","alerta":false,"leituras":[{"grandeza":"temperatura","valor":4.5},{"grandeza":"umidade","valor":55}]}'; echo
echo "== 4. Leitura de alerta (espera 201)"
curl -s -w " [HTTP %{http_code}]" -X POST "$API/leituras" \
  -H "x-device-token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"device_id":"camara-01","leituras":[{"grandeza":"temperatura","valor":9.5},{"grandeza":"umidade","valor":60}]}'; echo
echo "== 5. Valor inválido (espera 422)"
curl -s -w " [HTTP %{http_code}]" -X POST "$API/leituras" \
  -H "x-device-token: $TOKEN" -d '{"device_id":"camara-01","grandeza":"umidade","valor":140}'; echo
echo "== 6. Leitura mais recente";          curl -s "$API/leituras/ultima?device_id=camara-01"; echo
echo "== 7. Histórico (5 últimas)";         curl -s "$API/leituras?device_id=camara-01&limite=5"; echo
