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

function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    "T" +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
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
          projectTitle: qs("#projectTitle").value,
          projectDesc: qs("#projectDesc").value,
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
  let eventsCache = [];

  const loginBox = qs("#loginBox");
  const desk = qs("#desk");

  async function enter() {
    loginBox.style.display = "none";
    desk.style.display = "block";
    await refresh();
  }

  async function tryLogin(p) {
    await api("/api/panel/login", {
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

  function resetForm() {
    qs("#editId").value = "";
    qs("#title").value = "";
    qs("#ends").value = "";
    qs("#formHeading").textContent = "новое мероприятие";
    qs("#createBtn").textContent = "создать";
    qs("#cancelEdit").style.display = "none";
    show(qs("#createMsg"), "", "");
  }

  function startEdit(e) {
    qs("#editId").value = e.id;
    qs("#title").value = e.title;
    qs("#ends").value = toLocalInput(e.endsAt);
    qs("#formHeading").textContent = "изменить мероприятие";
    qs("#createBtn").textContent = "сохранить";
    qs("#cancelEdit").style.display = "inline-block";
    show(qs("#createMsg"), "", "");
    qs("#title").focus();
  }

  async function refresh() {
    eventsCache = await api("/api/panel/events", { headers: headers() });
    renderEvents(eventsCache);
    fillFilter(eventsCache);
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
          return (
            "<tr><td>" +
            esc(e.title) +
            "</td><td>" +
            esc(fmt(e.endsAt)) +
            '</td><td>' +
            st +
            '</td><td class="top">' +
            '<button class="btn" data-edit="' +
            esc(e.id) +
            '" type="button">изменить</button> ' +
            (e.archived
              ? '<button class="btn green" data-unarch="' +
                esc(e.id) +
                '" type="button">из архива</button>'
              : '<button class="btn red" data-arch="' +
                esc(e.id) +
                '" type="button">в архив</button>') +
            "</td></tr>"
          );
        })
        .join("") +
      "</table>";

    box.querySelectorAll("[data-edit]").forEach((b) => {
      b.onclick = () => {
        const e = eventsCache.find((x) => x.id === b.dataset.edit);
        if (e) startEdit(e);
      };
    });

    box.querySelectorAll("[data-arch]").forEach((b) => {
      b.onclick = async () => {
        await api("/api/panel/events/" + b.dataset.arch + "/archive", {
          method: "POST",
          headers: headers(),
        });
        await refresh();
      };
    });

    box.querySelectorAll("[data-unarch]").forEach((b) => {
      b.onclick = async () => {
        try {
          await api("/api/panel/events/" + b.dataset.unarch + "/unarchive", {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({}),
          });
          await refresh();
        } catch (err) {
          alert(err.message);
        }
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
    const regs = await api("/api/panel/regs?" + params.toString(), {
      headers: headers(),
    });
    const box = qs("#regs");
    if (!regs.length) {
      box.innerHTML = '<div class="empty">нет записей</div>';
      return;
    }
    box.innerHTML =
      "<table><tr><th>фио</th><th>группа</th><th>телефон</th><th>проект</th><th>описание</th><th>когда</th></tr>" +
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
            esc(r.projectTitle) +
            "</td><td>" +
            esc(r.projectDesc) +
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
    const editId = qs("#editId").value;
    if (!title || !ends) {
      show(qs("#createMsg"), "заполни название и дату", "err");
      return;
    }
    try {
      if (editId) {
        await api(
          "/api/panel/events/" + encodeURIComponent(editId) + "/update",
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ title, endsAt: ends, archived: false }),
          }
        );
        show(qs("#createMsg"), "сохранено", "ok");
        resetForm();
      } else {
        await api("/api/panel/events", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ title, endsAt: ends }),
        });
        show(qs("#createMsg"), "создано", "ok");
        qs("#title").value = "";
        qs("#ends").value = "";
      }
      await refresh();
    } catch (e) {
      show(qs("#createMsg"), e.message, "err");
    }
  };

  qs("#cancelEdit").onclick = () => resetForm();

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
      "/api/panel/export/" +
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
