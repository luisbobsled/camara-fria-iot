// Configuração do painel — troque SEU_PROJECT_REF pelo ID do seu projeto Supabase.
// A URL da API é pública (só leitura); o token de escrita fica apenas no ESP32.
window.CONFIG = {
  API_BASE: "https://sbrkemuvnjngcpzmvykx.supabase.co/functions/v1/api",
  DEVICE_ID: "camara-01",
  ATUALIZAR_A_CADA_MS: 5000,   // painel consulta a API a cada 5 s
  INTERVALO_ENVIO_S: 10,       // ESP32 envia a cada 10 s
  DESATUALIZADO_APOS_S: 30,    // sem leitura nova por 30 s (3 envios perdidos) = desatualizado
  PONTOS_HISTORICO: 60,        // ~10 minutos de histórico
};
