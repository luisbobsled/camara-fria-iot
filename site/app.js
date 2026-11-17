// Painel da câmara fria: consulta a API periodicamente e atualiza cards, gráfico e tabela.
(() => {
  const C = window.CONFIG;
  const $ = (id) => document.getElementById(id);
  const fmtHora = (d) => d.toLocaleTimeString("pt-BR");
  const fmtNum = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  $("device").textContent = C.DEVICE_ID;
  $("freq").textContent = C.ATUALIZAR_A_CADA_MS / 1000;

  // Diferença entre o relógio do navegador e o do servidor (evita falso "desatualizado")
  let deslocamentoRelogio = 0;
  let ultimoRecebimento = null;
  let ultimoIdVisto = null;

  const grafico = new Chart($("grafico"), {
    type: "line",
    data: {
      datasets: [
        { label: "Temperatura (°C)", data: [], borderColor: "#1f6feb", backgroundColor: "#1f6feb", yAxisID: "yT", tension: 0.25, pointRadius: 2 },
        { label: "Umidade (%)", data: [], borderColor: "#0f9d8a", backgroundColor: "#0f9d8a", yAxisID: "yU", tension: 0.25, pointRadius: 2 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { type: "time", time: { unit: "minute", displayFormats: { minute: "HH:mm" }, tooltipFormat: "HH:mm:ss" } },
        yT: { position: "left", title: { display: true, text: "°C" } },
        yU: { position: "right", title: { display: true, text: "%" }, grid: { drawOnChartArea: false }, min: 0, max: 100 },
      },
      plugins: { legend: { position: "bottom" } },
    },
  });

  async function api(caminho) {
    const r = await fetch(`${C.API_BASE}${caminho}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function definirStatus(tipo, texto) {
    $("status").className = `status status--${tipo}`;
    $("status-texto").textContent = texto;
    document.querySelector(".cards").classList.toggle("desatualizado", tipo !== "ok");
  }

  function atualizarCards(dados) {
    const { temperatura: t, umidade: u } = dados.leituras;
    const lim = dados.limites;
    $("temp-limite").textContent = lim.temperatura.limite;
    $("umid-limite").textContent = lim.umidade.limite;

    if (t) { $("temp-valor").textContent = fmtNum(t.valor); $("temp-unidade").textContent = t.unidade; }
    if (u) { $("umid-valor").textContent = fmtNum(u.valor); $("umid-unidade").textContent = u.unidade; }

    const tAlta = t && t.valor > lim.temperatura.limite;
    const uAlta = u && u.valor > lim.umidade.limite;
    $("card-temperatura").classList.toggle("em-alerta", !!tAlta);
    $("card-umidade").classList.toggle("em-alerta", !!uAlta);

    const emAlerta = (t && t.alerta) || (u && u.alerta) || tAlta || uAlta;
    const motivos = [];
    if (tAlta) motivos.push(`temperatura ${fmtNum(t.valor)} °C acima de ${lim.temperatura.limite} °C`);
    if (uAlta) motivos.push(`umidade ${fmtNum(u.valor)} % acima de ${lim.umidade.limite} %`);
    if (emAlerta && !motivos.length) motivos.push("voltando ao normal (histerese do dispositivo)");
    $("banner-alerta").hidden = !emAlerta;
    $("banner-texto").textContent = motivos.join(" · ");

    const maisRecente = [t, u].filter(Boolean).sort((a, b) => new Date(b.recebido_em) - new Date(a.recebido_em))[0];
    if (maisRecente) {
      ultimoRecebimento = new Date(maisRecente.recebido_em);
      $("ultima-hora").textContent = fmtHora(ultimoRecebimento);
    }
    return maisRecente;
  }

  function atualizarHistorico(lista) {
    // Agrupa temperatura e umidade do mesmo envio (mesmo segundo)
    const porSegundo = new Map();
    for (const l of lista) {
      const chave = l.recebido_em.slice(0, 19);
      const linha = porSegundo.get(chave) || { quando: new Date(l.recebido_em), alerta: false };
      linha[l.grandeza] = l.valor;
      linha.alerta = linha.alerta || l.alerta;
      porSegundo.set(chave, linha);
    }
    const linhas = [...porSegundo.values()].sort((a, b) => a.quando - b.quando);

    grafico.data.datasets[0].data = linhas.filter((l) => l.temperatura != null).map((l) => ({ x: l.quando, y: l.temperatura }));
    grafico.data.datasets[1].data = linhas.filter((l) => l.umidade != null).map((l) => ({ x: l.quando, y: l.umidade }));
    grafico.update();

    const recentes = linhas.slice(-15).reverse();
    $("tabela").innerHTML = recentes.length
      ? recentes.map((l) => `
        <tr>
          <td>${fmtHora(l.quando)}</td>
          <td>${l.temperatura != null ? fmtNum(l.temperatura) + " °C" : "—"}</td>
          <td>${l.umidade != null ? fmtNum(l.umidade) + " %" : "—"}</td>
          <td><span class="tag ${l.alerta ? "tag--alerta" : "tag--ok"}">${l.alerta ? "Alerta" : "Normal"}</span></td>
        </tr>`).join("")
      : `<tr><td colspan="4">Nenhuma leitura ainda.</td></tr>`;
  }

  function verificarAtraso() {
    if (!ultimoRecebimento) return;
    const agoraServidor = Date.now() + deslocamentoRelogio;
    const seg = Math.max(0, Math.round((agoraServidor - ultimoRecebimento) / 1000));
    $("ultima-ha").textContent = `há ${seg} s · envio esperado a cada ${C.INTERVALO_ENVIO_S} s`;
    if ($("status").classList.contains("status--erro")) return;
    if (seg > C.DESATUALIZADO_APOS_S) definirStatus("desatualizado", `Dados desatualizados (${seg} s sem leitura)`);
    else definirStatus("ok", "Recebendo dados");
  }

  async function ciclo() {
    try {
      const ultima = await api(`/leituras/ultima?device_id=${encodeURIComponent(C.DEVICE_ID)}`);
      deslocamentoRelogio = new Date(ultima.agora) - Date.now();
      const recente = atualizarCards(ultima);

      // Só baixa o histórico de novo quando chegou leitura nova
      if (recente && recente.id !== ultimoIdVisto) {
        ultimoIdVisto = recente.id;
        const hist = await api(`/leituras?device_id=${encodeURIComponent(C.DEVICE_ID)}&limite=${C.PONTOS_HISTORICO * 2}`);
        atualizarHistorico(hist.leituras);
      } else if (!recente) {
        $("tabela").innerHTML = `<tr><td colspan="4">Nenhuma leitura ainda. Inicie a simulação no Wokwi.</td></tr>`;
        definirStatus("desatualizado", "Sem leituras");
      }
      if ($("status").classList.contains("status--erro")) definirStatus("ok", "Recebendo dados");
      verificarAtraso();
    } catch (e) {
      console.error(e);
      definirStatus("erro", "API indisponível");
    }
  }

  ciclo();
  setInterval(ciclo, C.ATUALIZAR_A_CADA_MS);
  setInterval(verificarAtraso, 1000);
})();
