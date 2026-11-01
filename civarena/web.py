import json
import random
import secrets
import time
from functools import wraps

from flask import Flask, jsonify, redirect, render_template, request, session, abort
from werkzeug.security import check_password_hash, generate_password_hash

from . import ai, db
from .engine import Engine
from .mapgen import SIZES
from .rules import (CIV_COLORS, CIV_NAMES, FLAG_EMBLEMS, FLAG_PATTERNS, MODEL_LOCAL, PERSONALITIES,
                    TECHS, UNITS, BUILDINGS, TERRAIN, RESOURCES)
from .runner import MANAGER


def create_app(db_path):
    db.init(db_path)
    app = Flask(__name__)
    sk = db.get_setting("secret_key")
    if not sk:
        sk = secrets.token_hex(32)
        db.set_setting("secret_key", sk)
    app.secret_key = sk
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      JSON_AS_ASCII=False, PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 7)
    app.json.ensure_ascii = False

    def is_admin():
        return bool(session.get("admin"))

    def admin_required(f):
        @wraps(f)
        def w(*a, **k):
            if not is_admin():
                return jsonify(error="ابتدا وارد پنل مدیریت شوید"), 401
            if request.method == "POST" and request.headers.get("X-Requested-With") != "civarena":
                return jsonify(error="درخواست نامعتبر"), 400
            return f(*a, **k)
        return w

    def rules_payload():
        return dict(
            terrain={k: dict(key=v["key"], name=v["name"]) for k, v in TERRAIN.items()},
            resources={k: v["name"] for k, v in RESOURCES.items()},
            techs={k: dict(name=v["name"], cost=v["cost"], era=v["era"], req=v["req"]) for k, v in TECHS.items()},
            units={k: dict(name=v["name"], str=v["str"], rng=v["rng"], move=v["move"]) for k, v in UNITS.items()},
            buildings={k: v["name"] for k, v in BUILDINGS.items()},
            personalities={k: v["name"] for k, v in PERSONALITIES.items()},
        )

    # ---------------------------------------------------------------- pages
    @app.get("/")
    def index():
        return render_template("view.html", rules=json.dumps(rules_payload(), ensure_ascii=False))

    @app.get("/admin")
    def admin_page():
        if not is_admin():
            return render_template("login.html", first=not db.get_setting("admin_hash"))
        return render_template("admin.html", rules=json.dumps(rules_payload(), ensure_ascii=False),
                               colors=json.dumps(CIV_COLORS), names=json.dumps(CIV_NAMES, ensure_ascii=False),
                               patterns=json.dumps(FLAG_PATTERNS), emblems=json.dumps(FLAG_EMBLEMS),
                               sizes=json.dumps(SIZES))

    @app.post("/admin/login")
    def admin_login():
        pw = request.form.get("password", "")
        h = db.get_setting("admin_hash")
        if not h:
            if len(pw) < 6 or pw != request.form.get("password2", ""):
                return render_template("login.html", first=True, error="رمز باید حداقل ۶ کاراکتر و تکرار آن یکسان باشد")
            db.set_setting("admin_hash", generate_password_hash(pw))
            session["admin"] = True
            session.permanent = True
            return redirect("/admin")
        time.sleep(0.4)
        if check_password_hash(h, pw):
            session["admin"] = True
            session.permanent = True
            return redirect("/admin")
        return render_template("login.html", first=False, error="رمز عبور اشتباه است")

    @app.get("/admin/logout")
    def admin_logout():
        session.clear()
        return redirect("/")

    # ---------------------------------------------------------------- public API
    @app.get("/api/games")
    def api_games():
        out = []
        for g in db.list_games():
            cfg = json.loads(g["config"])
            h = MANAGER.games.get(g["id"])
            out.append(dict(id=g["id"], name=g["name"], status=h.status if h else g["status"], turn=g["turn"],
                            year=g["year"], winner=g["winner"], victory=g["victory"], created=g["created"],
                            civs=[dict(name=c["name"], color=c["color"], flag=c["flag"], model=c["model"]) for c in cfg["civs"]]))
        return jsonify(out)

    @app.get("/api/game/<int:gid>/static")
    def api_static(gid):
        h = MANAGER.get(gid) or abort(404)
        return jsonify(h.static_view())

    @app.get("/api/game/<int:gid>/state")
    def api_state(gid):
        h = MANAGER.get(gid) or abort(404)
        snap = h.snapshot()
        if request.args.get("t") == str(snap["turn"]):     # client already has this turn
            for k in ("owner", "cities", "units", "fx", "civs"):
                snap.pop(k, None)
        ev = int(request.args.get("ev", 0))
        th = int(request.args.get("th", 0))
        if ev == 0:
            events = db.q("SELECT id,turn,civ,kind,text,data FROM events WHERE game_id=? ORDER BY id DESC LIMIT 80", (gid,))[::-1]
        else:
            events = db.q("SELECT id,turn,civ,kind,text,data FROM events WHERE game_id=? AND id>? ORDER BY id LIMIT 200", (gid, ev))
        if th == 0:
            thoughts = db.q("SELECT id,turn,civ,model,thought,plan,reasoning,actions,errors,ok,fallback,latency_ms,tokens FROM thoughts "
                            "WHERE game_id=? ORDER BY id DESC LIMIT 40", (gid,))[::-1]
        else:
            thoughts = db.q("SELECT id,turn,civ,model,thought,plan,reasoning,actions,errors,ok,fallback,latency_ms,tokens FROM thoughts "
                            "WHERE game_id=? AND id>? ORDER BY id LIMIT 60", (gid, th))
        for e in events:
            e["data"] = json.loads(e["data"] or "{}")
        for t in thoughts:
            t["actions"] = json.loads(t["actions"] or "[]")
            t["errors"] = json.loads(t["errors"] or "[]")
        snap["events"] = events
        snap["thoughts"] = thoughts
        return jsonify(snap)

    # ---------------------------------------------------------------- admin API
    @app.get("/api/admin/settings")
    @admin_required
    def get_settings():
        st = db.all_settings()
        key = st.get("api_key", "")
        st["api_key"] = ""
        st["api_key_set"] = bool(key)
        st["api_key_hint"] = (key[:4] + "…" + key[-4:]) if len(key) > 10 else ("••••" if key else "")
        for k in ("secret_key", "admin_hash"):
            st.pop(k, None)
        st["models_cache"] = json.loads(st.get("models_cache") or "[]")
        return jsonify(st)

    @app.post("/api/admin/settings")
    @admin_required
    def save_settings():
        d = request.get_json(force=True) or {}
        allowed = ("api_base", "rpm", "temperature", "max_tokens", "timeout", "json_mode", "language",
                   "extra_prompt", "default_think_every", "default_turn_delay")
        for k in allowed:
            if k in d:
                db.set_setting(k, str(d[k]).strip())
        if d.get("api_key"):
            db.set_setting("api_key", d["api_key"].strip())
        if d.get("clear_key"):
            db.set_setting("api_key", "")
        if d.get("new_password"):
            if len(d["new_password"]) < 6:
                return jsonify(error="رمز جدید باید حداقل ۶ کاراکتر باشد"), 400
            db.set_setting("admin_hash", generate_password_hash(d["new_password"]))
        return jsonify(ok=True)

    @app.post("/api/admin/test")
    @admin_required
    def test_api():
        d = request.get_json(force=True) or {}
        base = d.get("api_base") or None
        key = d.get("api_key") or None
        out = {}
        try:
            out["me"] = ai.check_key(base, key)
        except Exception as e:  # noqa
            out["me_error"] = str(e)
        try:
            models = ai.list_models(base, key)
            out["models"] = len(models)
            db.set_setting("models_cache", json.dumps(models, ensure_ascii=False))
        except Exception as e:  # noqa
            out["models_error"] = str(e)
        if d.get("model"):
            try:
                r = ai.chat(d["model"], [{"role": "user", "content": "فقط بنویس: سلام، آماده فرماندهی هستم."}], max_tokens=200)
                out["chat"] = r["content"][:300]
                out["chat_ms"] = r["ms"]
            except Exception as e:  # noqa
                out["chat_error"] = str(e)
        return jsonify(out)

    @app.post("/api/admin/models/refresh")
    @admin_required
    def refresh_models():
        try:
            models = ai.list_models()
        except Exception as e:  # noqa
            return jsonify(error=str(e)), 400
        db.set_setting("models_cache", json.dumps(models, ensure_ascii=False))
        return jsonify(models=models)

    @app.post("/api/admin/random_setup")
    @admin_required
    def random_setup():
        d = request.get_json(force=True) or {}
        n = max(2, min(10, int(d.get("count") or random.randint(3, 6))))
        models = [m["id"] for m in json.loads(db.get_setting("models_cache") or "[]")]
        pool = d.get("models") or models or [MODEL_LOCAL]
        return jsonify(random_civs(n, pool))

    @app.post("/api/admin/games")
    @admin_required
    def create_game():
        d = request.get_json(force=True) or {}
        civs = d.get("civs") or []
        if len(civs) < 2:
            return jsonify(error="حداقل دو تمدن لازم است"), 400
        if len(civs) > 10:
            return jsonify(error="حداکثر ده تمدن"), 400
        for c in civs:
            c["name"] = (c.get("name") or "تمدن").strip()[:40]
            c["leader"] = (c.get("leader") or "").strip()[:40]
            c["model"] = (c.get("model") or MODEL_LOCAL).strip()
            if c.get("personality") not in PERSONALITIES:
                c["personality"] = "free"
            if not c.get("flag"):
                c["flag"] = random_flag(c.get("color") or "#888888")
        cfg = dict(
            name=(d.get("name") or f"نبرد تمدن‌ها {time.strftime('%Y-%m-%d %H:%M')}")[:80],
            seed=int(d.get("seed") or random.randint(1, 10 ** 9)),
            map_size=d.get("map_size") if d.get("map_size") in SIZES else "medium",
            land_ratio=max(0.3, min(0.75, float(d.get("land_ratio") or 0.52))),
            max_turns=max(20, min(1000, int(d.get("max_turns") or 250))),
            think_every=max(1, min(20, int(d.get("think_every") or db.get_setting("default_think_every") or 2))),
            turn_delay=max(0.0, min(60.0, float(d.get("turn_delay") or db.get_setting("default_turn_delay") or 1.5))),
            victories=[v for v in (d.get("victories") or ["domination", "science", "score"])
                       if v in ("domination", "science", "score")] or ["score"],
            civs=civs,
        )
        eng = Engine.new(cfg)
        gid = db.create_game(cfg["name"], cfg, eng.s)
        db.add_events(gid, eng.events)
        db.add_stats(gid, 0, eng.stats_rows())
        if d.get("autostart", True):
            MANAGER.get(gid).start()
        return jsonify(id=gid)

    @app.post("/api/admin/game/<int:gid>/<action>")
    @admin_required
    def game_action(gid, action):
        h = MANAGER.get(gid) or abort(404)
        if action == "start":
            if h.status == "finished":
                return jsonify(error="این بازی تمام شده است"), 400
            h.start()
        elif action == "pause":
            h.pause()
        elif action == "step":
            h.pause()
            h.step()
        elif action == "speed":
            d = request.get_json(force=True) or {}
            with h.lock:
                if "turn_delay" in d:
                    h.config["turn_delay"] = max(0.0, min(60.0, float(d["turn_delay"])))
                if "think_every" in d:
                    h.config["think_every"] = max(1, min(20, int(d["think_every"])))
                db.x("UPDATE games SET config=? WHERE id=?", (json.dumps(h.config, ensure_ascii=False), gid))
        elif action == "model":
            d = request.get_json(force=True) or {}
            cid = int(d.get("civ"))
            with h.lock:
                h.engine.civs[cid]["model"] = d.get("model") or MODEL_LOCAL
                h.config["civs"][cid]["model"] = h.engine.civs[cid]["model"]
                h.static = None
                db.x("UPDATE games SET config=? WHERE id=?", (json.dumps(h.config, ensure_ascii=False), gid))
                db.save_game(gid, h.engine.s)
        elif action == "delete":
            MANAGER.drop(gid)
            db.delete_game(gid)
            return jsonify(ok=True)
        else:
            abort(404)
        return jsonify(ok=True, status=h.status)

    @app.get("/api/admin/game/<int:gid>/report")
    @admin_required
    def report(gid):
        g = db.get_game(gid, with_state=False) or abort(404)
        h = MANAGER.get(gid)
        stats = db.q("SELECT turn,civ,score,pop,cities,military,techs,gold FROM stats WHERE game_id=? ORDER BY turn", (gid,))
        ai_stats = db.q("SELECT civ,model,COUNT(*) n,SUM(ok) ok,SUM(fallback) fb,AVG(NULLIF(latency_ms,0)) ms,SUM(tokens) tokens "
                        "FROM thoughts WHERE game_id=? GROUP BY civ,model", (gid,))
        kinds = db.q("SELECT civ,kind,COUNT(*) n FROM events WHERE game_id=? GROUP BY civ,kind", (gid,))
        return jsonify(game=dict(g, config=json.loads(g["config"])), snapshot=h.snapshot(), static=h.static_view(),
                       stats=stats, ai=ai_stats, kinds=kinds)

    @app.get("/api/admin/game/<int:gid>/thoughts")
    @admin_required
    def thoughts(gid):
        civ = request.args.get("civ")
        qtxt = request.args.get("q", "").strip()
        before = int(request.args.get("before") or 10 ** 12)
        sql = "SELECT * FROM thoughts WHERE game_id=? AND id<?"
        args = [gid, before]
        if civ not in (None, "", "all"):
            sql += " AND civ=?"
            args.append(int(civ))
        if qtxt:
            sql += " AND (thought LIKE ? OR reasoning LIKE ? OR raw LIKE ?)"
            args += [f"%{qtxt}%"] * 3
        sql += " ORDER BY id DESC LIMIT 30"
        rows = db.q(sql, args)
        for t in rows:
            t["actions"] = json.loads(t["actions"] or "[]")
            t["errors"] = json.loads(t["errors"] or "[]")
        return jsonify(rows)

    @app.get("/api/admin/game/<int:gid>/events")
    @admin_required
    def events(gid):
        kind = request.args.get("kind")
        sql, args = "SELECT id,turn,civ,kind,text FROM events WHERE game_id=?", [gid]
        if kind:
            sql += " AND kind=?"
            args.append(kind)
        return jsonify(db.q(sql + " ORDER BY id DESC LIMIT 500", args))

    @app.get("/api/admin/game/<int:gid>/export")
    @admin_required
    def export(gid):
        g = db.get_game(gid) or abort(404)
        data = dict(game=dict(g, config=json.loads(g["config"]), state=json.loads(g["state"])),
                    events=db.q("SELECT * FROM events WHERE game_id=? ORDER BY id", (gid,)),
                    thoughts=db.q("SELECT * FROM thoughts WHERE game_id=? ORDER BY id", (gid,)),
                    stats=db.q("SELECT * FROM stats WHERE game_id=? ORDER BY turn", (gid,)))
        resp = app.response_class(json.dumps(data, ensure_ascii=False, indent=1), mimetype="application/json")
        resp.headers["Content-Disposition"] = f"attachment; filename=civarena-game-{gid}.json"
        return resp

    MANAGER.resume_running()
    return app


def random_flag(color, rnd=random):
    pal = ["#ffffff", "#111111", "#ffd54f", "#c62828", "#1565c0", "#2e7d32", "#6a1b9a", "#ef6c00"]
    others = [p for p in pal if p.lower() != color.lower()]
    c2, c3 = rnd.sample(others, 2)
    return dict(pattern=rnd.choice(FLAG_PATTERNS), colors=[color, c2, c3], emblem=rnd.choice(FLAG_EMBLEMS))


def random_civs(n, model_pool):
    names = random.sample(CIV_NAMES, n)
    colors = random.sample(CIV_COLORS, min(n, len(CIV_COLORS)))
    pers = list(PERSONALITIES)
    out = []
    for i in range(n):
        color = colors[i % len(colors)]
        out.append(dict(name=names[i][0], leader=names[i][1], color=color, flag=random_flag(color),
                        model=random.choice(model_pool), personality=random.choice(pers)))
    return out
