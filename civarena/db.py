"""SQLite storage: settings, games (full engine state), events, AI thoughts, stats."""
import json
import os
import sqlite3
import threading
import time

_lock = threading.RLock()
_conn = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, status TEXT, config TEXT, state TEXT,
  turn INTEGER DEFAULT 0, year INTEGER DEFAULT -4000, winner INTEGER, victory TEXT,
  created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER, turn INTEGER, civ INTEGER,
  kind TEXT, text TEXT, data TEXT, ts REAL);
CREATE INDEX IF NOT EXISTS ix_events ON events(game_id, id);
CREATE TABLE IF NOT EXISTS thoughts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER, turn INTEGER, civ INTEGER, model TEXT,
  thought TEXT, plan TEXT, reasoning TEXT, actions TEXT, errors TEXT, raw TEXT, prompt TEXT,
  ok INTEGER, fallback INTEGER, latency_ms INTEGER, tokens INTEGER, ts REAL);
CREATE INDEX IF NOT EXISTS ix_thoughts ON thoughts(game_id, id);
CREATE TABLE IF NOT EXISTS stats (
  game_id INTEGER, turn INTEGER, civ INTEGER, score INTEGER, pop INTEGER, cities INTEGER,
  military REAL, techs INTEGER, gold INTEGER);
CREATE INDEX IF NOT EXISTS ix_stats ON stats(game_id, turn);
CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER, civ INTEGER, role TEXT, content TEXT,
  model TEXT, turn INTEGER, ip TEXT, ms INTEGER, ts REAL);
CREATE INDEX IF NOT EXISTS ix_chats ON chats(game_id, civ, id);
"""

MIGRATIONS = [
    ("thoughts", "focus", "TEXT"),
    ("thoughts", "cats", "TEXT"),
]


def init(path):
    global _conn
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    _conn = sqlite3.connect(path, check_same_thread=False)
    _conn.row_factory = sqlite3.Row
    _conn.execute("PRAGMA journal_mode=WAL")
    _conn.executescript(SCHEMA)
    for table, col, typ in MIGRATIONS:
        cols = {r[1] for r in _conn.execute(f"PRAGMA table_info({table})")}
        if col not in cols:
            _conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
    _conn.commit()


def q(sql, args=(), one=False):
    with _lock:
        cur = _conn.execute(sql, args)
        rows = cur.fetchall()
    rows = [dict(r) for r in rows]
    return (rows[0] if rows else None) if one else rows


def x(sql, args=()):
    with _lock:
        cur = _conn.execute(sql, args)
        _conn.commit()
        return cur.lastrowid


def many(sql, rows):
    with _lock:
        _conn.executemany(sql, rows)
        _conn.commit()


# ---------------------------------------------------------------- settings
DEFAULTS = {
    "api_base": "https://lemura.ir/wp-json/lemuraai/v1",
    "api_key": "",
    "rpm": "25",
    "temperature": "0.8",
    "max_tokens": "2500",
    "timeout": "90",
    "json_mode": "0",
    "language": "fa",
    "extra_prompt": "",
    "models_cache": "[]",
    "default_think_every": "2",
    "default_turn_delay": "1.5",
    "chat_public": "0",
    "chat_rpm": "6",
    "chat_max_tokens": "1200",
}


def get_setting(key, default=None):
    r = q("SELECT value FROM settings WHERE key=?", (key,), one=True)
    if r is None:
        return DEFAULTS.get(key, default)
    return r["value"]


def set_setting(key, value):
    x("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      (key, str(value)))


def all_settings():
    out = dict(DEFAULTS)
    for r in q("SELECT key,value FROM settings"):
        out[r["key"]] = r["value"]
    return out


# ---------------------------------------------------------------- games
def create_game(name, config, state):
    now = time.time()
    return x("INSERT INTO games(name,status,config,state,turn,year,created,updated) VALUES(?,?,?,?,?,?,?,?)",
             (name, "paused", json.dumps(config, ensure_ascii=False), json.dumps(state, ensure_ascii=False),
              state["turn"], state["year"], now, now))


def save_game(gid, state, status=None):
    sets = "state=?, turn=?, year=?, winner=?, victory=?, updated=?"
    args = [json.dumps(state, ensure_ascii=False), state["turn"], state["year"], state["winner"],
            state["victory"], time.time()]
    if status:
        sets += ", status=?"
        args.append(status)
    x(f"UPDATE games SET {sets} WHERE id=?", args + [gid])


def set_status(gid, status):
    x("UPDATE games SET status=?, updated=? WHERE id=?", (status, time.time(), gid))


def get_game(gid, with_state=True):
    cols = "*" if with_state else "id,name,status,config,turn,year,winner,victory,created,updated"
    return q(f"SELECT {cols} FROM games WHERE id=?", (gid,), one=True)


def list_games():
    return q("SELECT id,name,status,config,turn,year,winner,victory,created,updated FROM games ORDER BY id DESC")


def delete_game(gid):
    for t in ("events", "thoughts", "stats", "chats"):
        x(f"DELETE FROM {t} WHERE game_id=?", (gid,))
    x("DELETE FROM games WHERE id=?", (gid,))


def add_events(gid, events):
    now = time.time()
    many("INSERT INTO events(game_id,turn,civ,kind,text,data,ts) VALUES(?,?,?,?,?,?,?)",
         [(gid, e["turn"], e.get("civ"), e["kind"], e["text"], json.dumps(e.get("data") or {}, ensure_ascii=False), now)
          for e in events])


def add_thought(gid, **t):
    t.setdefault("ts", time.time())
    cols = ",".join(t)
    return x(f"INSERT INTO thoughts(game_id,{cols}) VALUES(?{',?' * len(t)})", [gid] + list(t.values()))


def add_stats(gid, turn, rows):
    many("INSERT INTO stats(game_id,turn,civ,score,pop,cities,military,techs,gold) VALUES(?,?,?,?,?,?,?,?,?)",
         [(gid, turn, r["civ"], r["score"], r["pop"], r["cities"], r["military"], r["techs"], r["gold"]) for r in rows])


def add_chat(gid, civ, role, content, **kw):
    return x("INSERT INTO chats(game_id,civ,role,content,model,turn,ip,ms,ts) VALUES(?,?,?,?,?,?,?,?,?)",
             (gid, civ, role, content, kw.get("model"), kw.get("turn"), kw.get("ip"), kw.get("ms"), time.time()))


def get_chats(gid, civ, limit=60):
    return q("SELECT id,role,content,model,turn,ms,ts FROM chats WHERE game_id=? AND civ=? ORDER BY id DESC LIMIT ?",
             (gid, civ, limit))[::-1]
