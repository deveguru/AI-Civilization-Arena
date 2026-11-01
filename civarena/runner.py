"""Background game loops. Each running game has its own thread; AI calls for all
civs of a turn run in parallel (global rate limiter in ai.py)."""
import json
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, wait

from . import ai, analysis, db
from .engine import Engine
from .rules import MODEL_LOCAL


class GameHandle:
    def __init__(self, gid):
        self.gid = gid
        self.lock = threading.RLock()
        row = db.get_game(gid)
        self.config = json.loads(row["config"])
        self.engine = Engine(json.loads(row["state"]))
        self.status = row["status"]
        self.thread = None
        self.stop_flag = threading.Event()
        self.step_once = threading.Event()
        self.thinking = {}        # civ id -> True while waiting for the model
        self.snap = None
        self.snap_turn = -1
        self.static = None
        self.last_error = None

    # -------------------------------------------------- views (cached per turn)
    def snapshot(self):
        with self.lock:
            if self.snap is None or self.snap_turn != self.engine.s["turn"]:
                self.snap = self.engine.snapshot()
                self.snap_turn = self.engine.s["turn"]
            out = dict(self.snap)
        out["status"] = self.status
        out["thinking"] = [k for k, v in self.thinking.items() if v]
        out["error"] = self.last_error
        return out

    def static_view(self):
        with self.lock:
            if self.static is None:
                self.static = self.engine.static_view()
            return self.static

    # -------------------------------------------------- control
    def start(self):
        if self.thread and self.thread.is_alive():
            self.status = "running"
            db.set_status(self.gid, "running")
            return
        self.stop_flag.clear()
        self.status = "running"
        db.set_status(self.gid, "running")
        self.thread = threading.Thread(target=self._loop, daemon=True, name=f"game-{self.gid}")
        self.thread.start()

    def pause(self):
        self.status = "paused"
        db.set_status(self.gid, "paused")

    def step(self):
        if self.status == "finished":
            return
        self.step_once.set()
        if not (self.thread and self.thread.is_alive()):
            self.stop_flag.clear()
            self.thread = threading.Thread(target=self._loop, daemon=True, name=f"game-{self.gid}")
            self.thread.start()

    def stop(self):
        self.stop_flag.set()

    # -------------------------------------------------- loop
    def _loop(self):
        while not self.stop_flag.is_set():
            if self.status != "running" and not self.step_once.is_set():
                time.sleep(0.3)
                continue
            self.step_once.clear()
            t0 = time.time()
            try:
                self.play_turn()
                self.last_error = None
            except Exception as e:  # noqa
                traceback.print_exc()
                self.last_error = str(e)
                time.sleep(3)
            if self.engine.finished():
                self.status = "finished"
                with self.lock:
                    db.save_game(self.gid, self.engine.s, "finished")
                return
            delay = float(self.config.get("turn_delay", 1.5))
            rest = delay - (time.time() - t0)
            if rest > 0:
                time.sleep(rest)

    def play_turn(self):
        eng = self.engine
        every = max(1, int(self.config.get("think_every", 2)))
        turn = eng.s["turn"]
        if turn % every == 0 or turn < 2:
            self._decide_all()
        with self.lock:
            events = eng.step()
            db.add_events(self.gid, events)
            db.add_stats(self.gid, eng.s["turn"], eng.stats_rows())
            db.save_game(self.gid, eng.s)
            self.snap = None

    def _decide_all(self):
        eng = self.engine
        jobs = {}
        with self.lock:
            for civ in eng.civs:
                if not civ["alive"]:
                    continue
                view = eng.civ_view(civ["id"])
                sp = ai.system_prompt(civ, eng) if civ["model"] != MODEL_LOCAL else None
                jobs[civ["id"]] = (view, sp, civ["model"])
        timeout = float(db.get_setting("timeout") or 90) + 30
        results = {}
        with ThreadPoolExecutor(max_workers=max(1, len(jobs))) as ex:
            futs = {}
            for cid, (view, sp, model) in jobs.items():
                if model == MODEL_LOCAL:
                    continue
                self.thinking[cid] = True
                futs[ex.submit(ai.ai_decide, view, sp, model)] = cid
            done, _ = wait(futs, timeout=timeout)
            for f, cid in futs.items():
                self.thinking[cid] = False
                if f in done:
                    try:
                        results[cid] = ("ok", f.result())
                    except Exception as e:  # noqa
                        results[cid] = ("err", str(e))
                else:
                    results[cid] = ("err", "مهلت پاسخ مدل تمام شد")
        with self.lock:
            for cid, (view, sp, model) in jobs.items():
                civ = eng.civs[cid]
                if not civ["alive"]:
                    continue
                st = civ["ai"]
                if model == MODEL_LOCAL:
                    dec = ai.local_decide(eng, cid)
                    norm, focus = analysis.record(eng, cid, dec)
                    errs, done = eng.apply_decision(cid, dec)
                    db.add_thought(self.gid, turn=eng.s["turn"], civ=cid, model=model, thought=dec["thought"],
                                   plan=dec.get("plan", ""), reasoning="", actions=json.dumps(done, ensure_ascii=False),
                                   errors=json.dumps(errs, ensure_ascii=False), raw=json.dumps(dec, ensure_ascii=False),
                                   prompt="", ok=1, fallback=0, latency_ms=0, tokens=0,
                                   focus=focus, cats=json.dumps(norm))
                    st["calls"] += 1
                    st["ok"] += 1
                    continue
                kind, r = results.get(cid, ("err", "بدون پاسخ"))
                st["calls"] += 1
                prompt_txt = (sp or "") + "\n\n---\n\n" + ai.user_prompt(view)
                if kind == "ok":
                    dec = r["decision"]
                    norm, focus = analysis.record(eng, cid, dec)
                    errs, done = eng.apply_decision(cid, dec)
                    st["ok"] += 1
                    st["tokens"] += r.get("tokens") or 0
                    st["ms"] += r.get("ms") or 0
                    db.add_thought(self.gid, turn=eng.s["turn"], civ=cid, model=model,
                                   thought=str(dec.get("thought") or "")[:4000], plan=str(dec.get("plan") or "")[:600],
                                   reasoning=(r.get("reasoning") or "")[:12000],
                                   actions=json.dumps(done, ensure_ascii=False), errors=json.dumps(errs, ensure_ascii=False),
                                   raw=r["content"][:20000], prompt=prompt_txt[:30000], ok=1, fallback=0,
                                   latency_ms=r.get("ms", 0), tokens=r.get("tokens", 0),
                                   focus=focus, cats=json.dumps(norm))
                else:
                    st["fail"] += 1
                    st["fallback"] += 1
                    dec = ai.local_decide(eng, cid)
                    norm, focus = analysis.record(eng, cid, dec)
                    errs, done = eng.apply_decision(cid, dec)
                    db.add_thought(self.gid, turn=eng.s["turn"], civ=cid, model=model, focus=focus, cats=json.dumps(norm),
                                   thought="[خطا در ارتباط با مدل؛ تصمیم موقت توسط هوش محلی] " + dec["thought"],
                                   plan=dec.get("plan", ""), reasoning="", actions=json.dumps(done, ensure_ascii=False),
                                   errors=json.dumps([r] + errs, ensure_ascii=False), raw="", prompt=prompt_txt[:30000],
                                   ok=0, fallback=1, latency_ms=0, tokens=0)


class Manager:
    def __init__(self):
        self.games = {}
        self.lock = threading.Lock()

    def get(self, gid):
        with self.lock:
            h = self.games.get(gid)
            if h is None:
                if not db.get_game(gid, with_state=False):
                    return None
                h = GameHandle(gid)
                self.games[gid] = h
            return h

    def drop(self, gid):
        with self.lock:
            h = self.games.pop(gid, None)
        if h:
            h.stop()

    def resume_running(self):
        for g in db.list_games():
            if g["status"] == "running":
                h = self.get(g["id"])
                h.start()


MANAGER = Manager()
