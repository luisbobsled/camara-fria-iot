-- =========================================================
-- Monitoramento IoT de Câmara Fria — estrutura do banco
-- Rodar no Supabase: SQL Editor > New query > colar > Run
-- =========================================================

create table if not exists public.leituras (
  id           bigint generated always as identity primary key,
  device_id    text             not null,                 -- identifica o dispositivo (ex.: camara-01)
  grandeza     text             not null                  -- grandeza medida
               check (grandeza in ('temperatura', 'umidade')),
  valor        double precision not null,
  unidade      text             not null,                 -- °C ou %
  alerta       boolean          not null default false,   -- condição de alerta no momento da leitura
  recebido_em  timestamptz      not null default now()    -- horário em que a API recebeu
);

-- Consultas sempre filtram por dispositivo + grandeza e ordenam por data
create index if not exists leituras_device_grandeza_data_idx
  on public.leituras (device_id, grandeza, recebido_em desc);

-- RLS ligado e SEM policies: ninguém acessa a tabela direto pela chave pública.
-- Só a Edge Function (que usa a service_role key no servidor) lê e grava.
alter table public.leituras enable row level security;
