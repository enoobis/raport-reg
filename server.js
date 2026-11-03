const express = require("express");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, "data");
const DB_PATH = path.join(DATA, "raports.db");
const ADMIN_PASS = process.env.ADMIN_PASS || "admin";

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);

const db = new DatabaseSync(DB_PATH);
db.exec(`
  pragma journal_mode = wal;
  create table if not exists events (
    id text primary key,
    title text not null,
    ends_at text not null,
    archived integer not null default 0,
    created_at text not null
  );
  create table if not exists regs (
    id text primary key,
    event_id text not null,
    fio text not null,
    fio_norm text not null,
    grp text not null,
    phone text not null,
    project_title text not null default '',
    project_desc text not null default '',
    at text not null,
    foreign key (event_id) references events(id)
  );
  create index if not exists idx_regs_event on regs(event_id);
  create unique index if not exists idx_regs_unique_name
    on regs(event_id, fio_norm);
`);

function ensureColumn(table, column, def) {
  const cols = db.prepare(`pragma table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`alter table ${table} add column ${column} ${def}`);
  }
}
ensureColumn("regs", "project_title", "text not null default ''");
ensureColumn("regs", "project_desc", "text not null default ''");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    endsAt: row.ends_at,
    archived: !!row.archived,
    createdAt: row.created_at,
  };
}

function mapReg(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    fio: row.fio,
    group: row.grp,
    phone: row.phone,
    projectTitle: row.project_title || "",
    projectDesc: row.project_desc || "",
    at: row.at,
  };
}

function archiveExpired() {
  db.prepare(
    `update events set archived = 1
     where archived = 0 and ends_at < ?`
  ).run(new Date().toISOString());
}

function checkAdmin(req, res) {
  const pass = req.headers["x-admin"] || req.query.pass || req.body.pass;
  if (pass !== ADMIN_PASS) {
    res.status(401).json({ error: "нет доступа" });
    return false;
  }
  return true;
}

function normName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function requiredText(v) {
  const s = String(v || "").trim();
  return s ? s : null;
}

function parseEndsAt(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

app.get("/api/events", (req, res) => {
  archiveExpired();
  const rows = db
    .prepare(
      `select * from events
       where archived = 0
       order by ends_at asc`
    )
    .all();
  res.json(rows.map(mapEvent));
});

app.get("/api/events/:id", (req, res) => {
  archiveExpired();
  const e = mapEvent(
    db.prepare(`select * from events where id = ?`).get(req.params.id)
  );
  if (!e) return res.status(404).json({ error: "не найдено" });
  if (e.archived) return res.status(410).json({ error: "регистрация закрыта" });
  res.json(e);
});

app.post("/api/register", (req, res) => {
  archiveExpired();
  const fio = requiredText(req.body.fio);
  const group = requiredText(req.body.group);
  const phone = requiredText(req.body.phone);
  const projectTitle = requiredText(req.body.projectTitle);
  const projectDesc = requiredText(req.body.projectDesc);
  const eventId = requiredText(req.body.eventId);

  if (!eventId || !fio || !group || !phone || !projectTitle || !projectDesc) {
    return res.status(400).json({ error: "заполни все поля" });
  }

  const event = mapEvent(
    db.prepare(`select * from events where id = ?`).get(eventId)
  );
  if (!event) return res.status(404).json({ error: "мероприятие не найдено" });
  if (event.archived || new Date(event.endsAt).getTime() < Date.now()) {
    return res.status(410).json({ error: "регистрация закрыта" });
  }

  const name = normName(fio);
  const exists = db
    .prepare(`select id from regs where event_id = ? and fio_norm = ?`)
    .get(eventId, name);
  if (exists) {
    return res.status(409).json({ error: "это имя уже зарегистрировано" });
  }

  try {
    db.prepare(
      `insert into regs
        (id, event_id, fio, fio_norm, grp, phone, project_title, project_desc, at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      String(Date.now()) + Math.random().toString(36).slice(2, 7),
      eventId,
      fio,
      name,
      group,
      phone,
      projectTitle,
      projectDesc,
      new Date().toISOString()
    );
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "это имя уже зарегистрировано" });
    }
    throw err;
  }

  res.json({ ok: true });
});

app.post("/api/panel/login", (req, res) => {
  if (req.body.pass !== ADMIN_PASS) {
    return res.status(401).json({ error: "неверный пароль" });
  }
  res.json({ ok: true });
});

app.get("/api/panel/events", (req, res) => {
  if (!checkAdmin(req, res)) return;
  archiveExpired();
  const rows = db
    .prepare(`select * from events order by created_at desc`)
    .all();
  res.json(rows.map(mapEvent));
});

app.post("/api/panel/events", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const title = requiredText(req.body.title);
  const endsRaw = requiredText(req.body.endsAt);
  if (!title || !endsRaw) {
    return res.status(400).json({ error: "нужны название и дата" });
  }
  const endsAt = parseEndsAt(endsRaw);
  if (!endsAt) return res.status(400).json({ error: "некорректная дата" });

  const event = {
    id: String(Date.now()),
    title,
    endsAt,
    archived: false,
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    `insert into events (id, title, ends_at, archived, created_at)
     values (?, ?, ?, 0, ?)`
  ).run(event.id, event.title, event.endsAt, event.createdAt);

  res.json(event);
});

app.post("/api/panel/events/:id/update", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const e = mapEvent(
      db.prepare(`select * from events where id = ?`).get(req.params.id)
    );
    if (!e) return res.status(404).json({ error: "не найдено" });

    const title = requiredText(req.body.title);
    const endsRaw = requiredText(req.body.endsAt);
    if (!title || !endsRaw) {
      return res.status(400).json({ error: "нужны название и дата" });
    }

    const endsIso = parseEndsAt(endsRaw);
    if (!endsIso) return res.status(400).json({ error: "некорректная дата" });

    let archived = 0;
    if (req.body.archived === true || req.body.archived === 1) archived = 1;
    else if (req.body.archived === false || req.body.archived === 0) archived = 0;
    else archived = new Date(endsIso).getTime() < Date.now() ? 1 : 0;

    db.prepare(
      `update events set title = ?, ends_at = ?, archived = ? where id = ?`
    ).run(title, endsIso, archived, req.params.id);

    res.json(
      mapEvent(
        db.prepare(`select * from events where id = ?`).get(req.params.id)
      )
    );
  } catch (err) {
    res.status(500).json({ error: String(err.message || "ошибка сохранения") });
  }
});

app.post("/api/panel/events/:id/archive", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const e = mapEvent(
    db.prepare(`select * from events where id = ?`).get(req.params.id)
  );
  if (!e) return res.status(404).json({ error: "не найдено" });
  db.prepare(`update events set archived = 1 where id = ?`).run(req.params.id);
  e.archived = true;
  res.json(e);
});

app.post("/api/panel/events/:id/unarchive", (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const e = mapEvent(
      db.prepare(`select * from events where id = ?`).get(req.params.id)
    );
    if (!e) return res.status(404).json({ error: "не найдено" });

    let endsAt = e.endsAt;
    const fromBody = requiredText(req.body && req.body.endsAt);
    if (fromBody) {
      const parsed = parseEndsAt(fromBody);
      if (!parsed) return res.status(400).json({ error: "некорректная дата" });
      endsAt = parsed;
    }

    // если дата уже прошла — иначе archiveExpired сразу вернёт в архив
    if (new Date(endsAt).getTime() <= Date.now()) {
      endsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    db.prepare(
      `update events set archived = 0, ends_at = ? where id = ?`
    ).run(endsAt, req.params.id);

    res.json(
      mapEvent(
        db.prepare(`select * from events where id = ?`).get(req.params.id)
      )
    );
  } catch (err) {
    res.status(500).json({ error: String(err.message || "ошибка") });
  }
});

app.get("/api/panel/regs", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { eventId, q } = req.query;
  let sql = `select * from regs where 1=1`;
  const params = [];
  if (eventId) {
    sql += ` and event_id = ?`;
    params.push(eventId);
  }
  if (q) {
    sql += ` and (
      lower(fio) like ? or lower(grp) like ? or lower(phone) like ?
      or lower(project_title) like ? or lower(project_desc) like ?
    )`;
    const s = "%" + String(q).toLowerCase() + "%";
    params.push(s, s, s, s, s);
  }
  sql += ` order by at desc`;
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(mapReg));
});

app.get("/api/panel/export/:eventId", (req, res) => {
  if (!checkAdmin(req, res)) return;
  const event = mapEvent(
    db.prepare(`select * from events where id = ?`).get(req.params.eventId)
  );
  if (!event) return res.status(404).json({ error: "не найдено" });

  const regs = db
    .prepare(`select * from regs where event_id = ? order by at asc`)
    .all(event.id)
    .map(mapReg);

  const lines = regs.map(
    (r) =>
      `//${r.fio}//${r.group}//${r.phone}//${r.projectTitle}//${r.projectDesc}//`
  );
  const name =
    "raport_" +
    event.title.replace(/[^\wа-яё\-]+/gi, "_").slice(0, 40) +
    ".txt";
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
  );
  res.send(lines.join("\n") || "//пусто//");
});

app.listen(PORT, () => {
  console.log("raports: http://localhost:" + PORT);
});
