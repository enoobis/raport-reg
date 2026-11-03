function qs(s, el) {
  return (el || document).querySelector(s);
}

function show(el, text, kind) {
  if (!el) return;
  if (!text) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = '<div class="msg ' + kind + '">' + esc(text) + "</div>";
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(iso) {
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch (e) {
    return iso;
  }
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "ошибка");
  return data;
}

async function loadHome() {
  const box = qs("#list");
  try {
    const events = await api("/api/events");
    if (!events.length) {
      box.innerHTML =
        '<div class="empty">пока нет открытых регистраций</div>';
      return;
    }
    box.innerHTML = events
      .map(
        (e) =>
          '<a class="btn" href="/register.html?id=' +
          encodeURIComponent(e.id) +
          '">' +
          esc(e.title) +
          "<br><small>до " +
          esc(fmt(e.endsAt)) +
          "</small></a>"
      )
      .join("");
  } catch (e) {
    box.innerHTML = '<div class="empty">' + esc(e.message) + "</div>";
  }
}

async function loadRegister() {
  const id = new URLSearchParams(location.search).get("id");
  const title = qs("#title");
  const until = qs("#until");
  const form = qs("#form");
  const msg = qs("#msg");

  if (!id) {
    title.textContent = "мероприятие не выбрано";
    form.style.display = "none";
    return;
  }

  try {
    const e = await api("/api/events/" + encodeURIComponent(id));
    title.textContent = e.title;
    until.textContent = "регистрация до: " + fmt(e.endsAt);
  } catch (err) {
    title.textContent = "регистрация недоступна";
    until.textContent = err.message;
    form.style.display = "none";
    return;
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    show(msg, "отправка...", "info");
    try {
      await api("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: id,
          fio: qs("#fio").value,
          group: qs("#group").value,
          phone: qs("#phone").value,
        }),
      });
      form.reset();
      show(msg, "готово. ты в списке", "ok");
    } catch (err) {
      show(msg, err.message, "err");
    }
  });
}

function loadAdmin() {
  const passKey = "raport_admin";
  let pass = sessionStorage.getItem(passKey) || "";

  const loginBox = qs("#loginBox");
  const desk = qs("#desk");

  async function enter() {
    loginBox.style.display = "none";
    desk.style.display = "block";
    await refresh();
  }

  async function tryLogin(p) {
    await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pass: p }),
    });
    pass = p;
    sessionStorage.setItem(passKey, p);
    await enter();
  }

  qs("#loginBtn").onclick = async () => {
    try {
      await tryLogin(qs("#pass").value);
    } catch (e) {
      show(qs("#loginMsg"), e.message, "err");
    }
  };

  qs("#pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") qs("#loginBtn").click();
  });

  qs("#logout").onclick = (e) => {
    e.preventDefault();
    sessionStorage.removeItem(passKey);
    location.reload();
  };

  function headers() {
    return { "Content-Type": "application/json", "x-admin": pass };
  }

  async function refresh() {
    const events = await api("/api/admin/events", { headers: headers() });
    renderEvents(events);
    fillFilter(events);
    await loadRegs();
  }

  function renderEvents(events) {
    const box = qs("#events");
    if (!events.length) {
      box.innerHTML = '<div class="empty">пусто</div>';
      return;
    }
    box.innerHTML =
      "<table><tr><th>название</th><th>до</th><th>статус</th><th></th></tr>" +
      events
        .map((e) => {
          const st = e.archived
            ? '<span class="tag arch">архив</span>'
            : '<span class="tag">открыто</span>';
          const btn = e.archived
            ? ""
            : '<button class="btn red" data-arch="' +
              esc(e.id) +
              '" type="button">в архив</button>';
          return (
            "<tr><td>" +
            esc(e.title) +
            "</td><td>" +
            esc(fmt(e.endsAt)) +
            "</td><td>" +
            st +
            "</td><td>" +
            btn +
            "</td></tr>"
          );
        })
        .join("") +
      "</table>";

    box.querySelectorAll("[data-arch]").forEach((b) => {
      b.onclick = async () => {
        await api("/api/admin/events/" + b.dataset.arch + "/archive", {
          method: "POST",
          headers: headers(),
        });
        await refresh();
      };
    });
  }

  function fillFilter(events) {
    const sel = qs("#eventFilter");
    const cur = sel.value;
    sel.innerHTML =
      '<option value="">все</option>' +
      events
        .map(
          (e) =>
            '<option value="' +
            esc(e.id) +
            '">' +
            esc(e.title) +
            (e.archived ? " [архив]" : "") +
            "</option>"
        )
        .join("");
    if (cur) sel.value = cur;
  }

  async function loadRegs() {
    const eventId = qs("#eventFilter").value;
    const q = qs("#search").value.trim();
    const params = new URLSearchParams();
    if (eventId) params.set("eventId", eventId);
    if (q) params.set("q", q);
    const regs = await api("/api/admin/regs?" + params.toString(), {
      headers: headers(),
    });
    const box = qs("#regs");
    if (!regs.length) {
      box.innerHTML = '<div class="empty">нет записей</div>';
      return;
    }
    box.innerHTML =
      "<table><tr><th>фио</th><th>группа</th><th>телефон</th><th>когда</th></tr>" +
      regs
        .map(
          (r) =>
            "<tr><td>" +
            esc(r.fio) +
            "</td><td>" +
            esc(r.group) +
            "</td><td>" +
            esc(r.phone) +
            "</td><td>" +
            esc(fmt(r.at)) +
            "</td></tr>"
        )
        .join("") +
      "</table>";
  }

  qs("#createBtn").onclick = async () => {
    const title = qs("#title").value.trim();
    const ends = qs("#ends").value;
    try {
      await api("/api/admin/events", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ title, endsAt: ends }),
      });
      qs("#title").value = "";
      qs("#ends").value = "";
      show(qs("#createMsg"), "создано", "ok");
      await refresh();
    } catch (e) {
      show(qs("#createMsg"), e.message, "err");
    }
  };

  qs("#searchBtn").onclick = () => loadRegs().catch((e) => alert(e.message));
  qs("#eventFilter").onchange = () => loadRegs().catch((e) => alert(e.message));
  qs("#search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") qs("#searchBtn").click();
  });

  qs("#exportBtn").onclick = () => {
    const eventId = qs("#eventFilter").value;
    if (!eventId) {
      alert("выбери мероприятие в фильтре");
      return;
    }
    location.href =
      "/api/admin/export/" +
      encodeURIComponent(eventId) +
      "?pass=" +
      encodeURIComponent(pass);
  };

  if (pass) {
    tryLogin(pass).catch(() => {
      sessionStorage.removeItem(passKey);
      pass = "";
    });
  }
}
