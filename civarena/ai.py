"""AI leaders: an OpenAI-compatible client (Lemura web service) + a local heuristic bot
used for the free 'local-bot' model and as a fallback when an API call fails."""
import json
import re
import threading
import time
import urllib.error
import urllib.request

from . import db
from .rules import TECHS, UNITS, BUILDINGS, PERSONALITIES, MODEL_LOCAL


# ---------------------------------------------------------------- HTTP client
class RateLimiter:
    def __init__(self):
        self.lock = threading.Lock()
        self.stamps = []

    def wait(self, rpm):
        rpm = max(1, rpm)
        while True:
            with self.lock:
                now = time.time()
                self.stamps = [t for t in self.stamps if now - t < 60]
                if len(self.stamps) < rpm:
                    self.stamps.append(now)
                    return
                delay = 60 - (now - self.stamps[0]) + 0.05
            time.sleep(min(delay, 2))


LIMITER = RateLimiter()


class ApiError(Exception):
    pass


def _request(method, path, body=None, timeout=None, base=None, key=None):
    st = db.all_settings()
    base = (base or st["api_base"]).rstrip("/")
    key = key if key is not None else st["api_key"]
    if not key:
        raise ApiError("کلید API تنظیم نشده است")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json",
        "User-Agent": "CivArena/1.0",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout or float(st["timeout"])) as r:
            raw = r.read().decode("utf-8", "replace")
            return json.loads(raw) if raw else {}, dict(r.headers)
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")[:500]
        try:
            msg = json.loads(txt).get("error", {}).get("message") or txt
        except Exception:  # noqa
            msg = txt
        raise ApiError(f"HTTP {e.code}: {msg}")
    except urllib.error.URLError as e:
        raise ApiError(f"خطای اتصال: {e.reason}")
    except TimeoutError:
        raise ApiError("پایان مهلت پاسخ (timeout)")


def list_models(base=None, key=None):
    data, _ = _request("GET", "/models", base=base, key=key, timeout=30)
    out = []
    for m in data.get("data", []):
        typ = (m.get("type") or "chat").lower()
        if typ not in ("chat", "text", "llm", "language", "completion", "reasoning"):
            continue
        out.append(dict(id=m["id"], owned_by=m.get("owned_by", ""), type=typ))
    return out


def check_key(base=None, key=None):
    me, _ = _request("GET", "/me", base=base, key=key, timeout=20)
    return me


def chat(model, messages, max_tokens=None, temperature=None):
    st = db.all_settings()
    LIMITER.wait(int(float(st["rpm"])))
    body = dict(model=model, messages=messages,
                max_tokens=int(max_tokens or float(st["max_tokens"])),
                temperature=float(temperature if temperature is not None else st["temperature"]))
    if st.get("json_mode") == "1":
        body["response_format"] = {"type": "json_object"}
    t0 = time.time()
    data, headers = _request("POST", "/chat/completions", body)
    ms = int((time.time() - t0) * 1000)
    ch = (data.get("choices") or [{}])[0]
    msg = ch.get("message") or {}
    content = msg.get("content") or ""
    if isinstance(content, list):
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    reasoning = msg.get("reasoning_content") or msg.get("reasoning") or ""
    if isinstance(reasoning, (list, dict)):
        reasoning = json.dumps(reasoning, ensure_ascii=False)
    tokens = (data.get("usage") or {}).get("total_tokens", 0)
    return dict(content=content, reasoning=reasoning, ms=ms, tokens=tokens,
                finish=ch.get("finish_reason"), lemura_finish=headers.get("X-Lemura-Finish"))


# ---------------------------------------------------------------- prompts
def system_prompt(civ, engine):
    st = db.all_settings()
    lang = "فارسی" if st.get("language", "fa") == "fa" else "English"
    pers = PERSONALITIES.get(civ["personality"], PERSONALITIES["free"])
    units = "\n".join(f"- {k}: {v['name']} | قدرت {v['str']}" + (f" برد {v['range']} قدرت‌تیر {v['rng']}" if v['rng'] else "")
                      + f" | حرکت {v['move']} | تولید {v['prod']} | هزینه {v['cost']} | فناوری {v['tech'] or '-'}"
                      for k, v in UNITS.items())
    blds = "\n".join(f"- {k}: {v['name']} | تولید {v['prod']} | هزینه {v['cost']} | فناوری {v['tech'] or '-'}"
                     + (f" | {', '.join(f'+{v[e]} {e}' for e in ('food','wood','stone','gold','science','culture') if v.get(e))}" if any(v.get(e) for e in ('food','wood','stone','gold','science','culture')) else "")
                     for k, v in BUILDINGS.items())
    techs = ", ".join(f"{k}({v['cost']}; نیاز:{'+'.join(v['req']) or '-'})" for k, v in TECHS.items())
    others = ", ".join(f"#{o['id']} {o['name']}" for o in engine.civs if o["id"] != civ["id"])
    extra = st.get("extra_prompt") or ""
    return f"""تو رهبر تمدن «{civ['name']}» (شناسه {civ['id']}) به نام {civ['leader']} هستی در یک بازی استراتژی نوبتی روی نقشه شبکه‌ای دوبعدی.
شخصیت تو: {pers['text']}
تمدن‌های دیگر جهان: {others}. هر تمدن را یک مدل هوش مصنوعی متفاوت اداره می‌کند. هدف: بقا، رشد و پیروزی (فتح جهان، پیروزی علمی با ساخت spaceport، یا بیشترین امتیاز در پایان زمان).

قوانین کلیدی:
- مختصات (x,y)؛ حرکت ۸ جهته؛ جنگل و تپه هزینه حرکت ۲ دارند؛ آب و کوه غیرقابل عبور.
- منابع خزانه: gold, wood, stone. هزینه ساخت هنگام تکمیل کسر می‌شود؛ اگر کافی نباشد تولید متوقف می‌ماند.
- غذای مازاد جمعیت را بالا می‌برد. جمعیت = تولید، علم و کاشی‌های کاری بیشتر. مهاجر ۱ جمعیت مصرف می‌کند (جمعیت شهر باید ≥۲ باشد).
- شهر جدید باید حداقل ۴ خانه از شهرهای دیگر فاصله داشته باشد (از settle_spots کمک بگیر).
- فقط با تمدنی که در جنگ (war) هستی می‌توانی بجنگی؛ ابتدا declare_war بده. متحدان هدف به کمکش می‌آیند.
- برای فتح شهر: جان شهر را با حمله به صفر برسان؛ فقط واحد نزدیک‌زن (غیر تیرانداز) می‌تواند شهر را تصرف کند. ادوات محاصره (siege) دو برابر به شهر آسیب می‌زنند.
- نگهداری ارتش بیش از (۲×شهرها+۱) واحد طلا مصرف می‌کند.
- واحدهای بی‌فرمان خودکار از خود دفاع می‌کنند. فرمان‌ها تا رسیدن به هدف ادامه می‌یابند؛ لازم نیست هر نوبت تکرار شوند.

واحدها:
{units}

ساختمان‌ها (هر کدام یک بار در هر شهر):
{blds}

درخت فناوری: {techs}

در هر نوبت از بین کارهای اصلی یکی را به عنوان تمرکز انتخاب کن: growth=رشد جمعیت و شهرها، expansion=توسعه سرزمین و شهر جدید، science=پیشرفت علمی، economy=اقتصاد و تولید، defense=دفاع و امنیت، attack=حمله و فتح، alliance=اتحاد و دیپلماسی، neutrality=بی‌طرفی و پرهیز از درگیری.

پاسخ تو فقط و فقط یک شیء JSON معتبر باشد (بدون متن اضافه) با این ساختار:
{{
  "thought": "استدلال درونی تو به زبان {lang}؛ ۳ تا ۶ جمله درباره وضعیت، تهدیدها و دلیل تصمیم‌ها",
  "plan": "راهبرد بلندمدت در یک جمله",
  "memory": "یادداشت کوتاه برای خودت در نوبت‌های بعد (حداکثر ۳۰۰ کاراکتر)",
  "focus": "تمرکز راهبردی اصلی این نوبت؛ دقیقاً یکی از: growth|expansion|science|economy|defense|attack|alliance|neutrality",
  "research": "شناسه فناوری از techs_available",
  "builds": [{{"city": <id شهر>, "items": ["<شناسه واحد یا ساختمان از can_build>", "..."]}}],
  "orders": [{{"unit": <id>, "action": "move|attack|settle|fortify|explore|disband", "x": <x>, "y": <y>, "target_city": <id>, "target_unit": <id>}}],
  "diplomacy": [{{"civ": <id>, "action": "declare_war|propose_peace|accept_peace|propose_alliance|accept_alliance|reject|break_alliance|message|gift_gold", "text": "متن پیام به {lang}", "amount": <طلا>}}]
}}
builds صف تولید شهر را جایگزین می‌کند (حداکثر ۴ آیتم). فقط فیلدهای لازم را بفرست؛ آرایه خالی مجاز است. شناسه‌ها را دقیقاً از وضعیت بردار.
{extra}"""


def user_prompt(view):
    return ("وضعیت فعلی تمدن تو (JSON):\n" + json.dumps(view, ensure_ascii=False, separators=(",", ":"))
            + "\n\nتصمیم این نوبت را فقط به صورت JSON بده.")


_THINK = re.compile(r"<think>(.*?)</think>", re.S | re.I)


def parse_reply(text):
    reasoning = "\n".join(m.strip() for m in _THINK.findall(text or ""))
    t = _THINK.sub("", text or "")
    t = re.sub(r"<think>.*", "", t, flags=re.S | re.I)    # unterminated think
    t = re.sub(r"```(?:json)?", "", t)
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b <= a:
        raise ValueError("پاسخ مدل شامل JSON نبود")
    chunk = t[a:b + 1]
    try:
        return json.loads(chunk), reasoning
    except json.JSONDecodeError:
        fixed = re.sub(r",\s*([}\]])", r"\1", chunk)
        fixed = re.sub(r"//[^\n]*", "", fixed)
        return json.loads(fixed), reasoning


def ai_decide(engine_view, sys_prompt, model):
    """Call the model. Returns dict(decision, thought fields...). Raises on failure."""
    msgs = [{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt(engine_view)}]
    r = chat(model, msgs)
    if not r["content"].strip():
        raise ApiError("پاسخ خالی از مدل" + (" (بودجه توکن تمام شد؛ max_tokens را بیشتر کنید)" if r.get("lemura_finish") else ""))
    dec, think = parse_reply(r["content"])
    r["decision"] = dec
    r["reasoning"] = (r["reasoning"] + "\n" + think).strip()
    return r


# ---------------------------------------------------------------- local heuristic bot
PRIORITY = {
    "aggressive":  ["bronze_working", "archery", "iron_working", "horseback_riding", "mathematics", "chivalry", "machinery", "gunpowder", "metallurgy", "military_science"],
    "scientific":  ["writing", "philosophy", "mathematics", "education", "banking", "gunpowder", "industrialization", "electricity", "rocketry", "space_flight"],
    "expansionist": ["agriculture", "mining", "bronze_working", "writing", "currency", "masonry"],
    "economic":    ["agriculture", "mining", "bronze_working", "writing", "currency", "banking", "industrialization"],
    "defensive":   ["masonry", "bronze_working", "archery", "mathematics", "chivalry", "machinery", "gunpowder"],
    "diplomatic":  ["writing", "currency", "philosophy", "education", "banking"],
    "cultural":    ["agriculture", "writing", "philosophy", "masonry", "education"],
}
BUILD_ORDER = {
    "default":    ["farm", "library", "quarry", "market", "walls", "temple", "lumber_mill", "granary", "workshop", "university", "barracks", "bank", "castle", "factory", "spaceport"],
    "aggressive": ["barracks", "farm", "quarry", "lumber_mill", "walls", "workshop", "market", "library", "castle", "factory"],
    "scientific": ["library", "farm", "university", "quarry", "market", "workshop", "bank", "factory", "spaceport"],
    "defensive":  ["walls", "farm", "quarry", "library", "barracks", "castle", "market", "workshop"],
    "cultural":   ["temple", "farm", "library", "granary", "market", "university"],
}
MIL_ORDER = ["tank", "artillery", "rifleman", "cavalry", "cannon", "musketman", "knight", "crossbowman",
             "catapult", "swordsman", "horseman", "spearman", "archer", "warrior"]


def local_decide(eng, cid):
    from .engine import cheb
    civ = eng.civs[cid]
    pers = civ["personality"] if civ["personality"] in PRIORITY else "free"
    rnd = eng.rnd
    dec = dict(builds=[], orders=[], diplomacy=[])
    notes = []

    av = eng.techs_available(civ)
    if av:
        pr = PRIORITY.get(pers, [])
        pick = next((t for t in pr if t in av), None) or min(av, key=lambda t: TECHS[t]["cost"] + rnd.random() * 15)
        dec["research"] = pick
        notes.append(f"پژوهش روی {TECHS[pick]['name']} متمرکز می‌شود")

    cities = eng.civ_cities(cid)
    units = eng.civ_units(cid)
    mil = [u for u in units if not UNITS[u["type"]].get("civil")]
    settlers = [u for u in units if u["type"] == "settler"]
    my_power = eng.military_power(cid)
    max_cities = {"expansionist": 10, "aggressive": 6, "cultural": 6}.get(pers, 7)
    spots = eng.settle_candidates(cid, 6) if len(cities) + len(settlers) < max_cities or settlers else []
    wars = [o for o in eng.civs if o["alive"] and eng.at_war(cid, o["id"])]
    threat_near = any(t["civ"] != cid and eng.at_war(cid, t["civ"]) and
                      min((cheb(t["x"], t["y"], c["x"], c["y"]) for c in cities), default=99) <= 5
                      for t in eng.units.values())

    best_mil = next((m for m in MIL_ORDER if UNITS[m]["tech"] is None or UNITS[m]["tech"] in civ["techs"]), "warrior")
    want_mil = len(cities) * (2 if pers in ("aggressive", "defensive") else 1) + 1 + (3 if wars else 0)
    order = BUILD_ORDER.get(pers, BUILD_ORDER["default"])
    for c in cities:
        if c["queue"]:
            continue
        items = []
        can = set(eng.buildable(civ, c))
        if threat_near or len(mil) < want_mil:
            items.append(best_mil)
            if UNITS.get("catapult") and wars and "catapult" in can and rnd.random() < 0.4:
                items.append(next((s for s in ("artillery", "cannon", "catapult") if s in can), best_mil))
        elif spots and len(cities) + len(settlers) < max_cities and c["pop"] >= 2 and not settlers:
            items.append("settler")
        else:
            b = next((b for b in order if b in can and b in BUILDINGS), None)
            items.append(b or best_mil)
        dec["builds"].append(dict(city=c["id"], items=items))
        notes.append(f"در {c['name']} {UNITS.get(items[0], BUILDINGS.get(items[0], {})).get('name', items[0])} ساخته می‌شود")

    used = set()
    for u in settlers:
        if u["order"]:
            continue
        sp = sorted(spots, key=lambda s: -s["score"] + cheb(u["x"], u["y"], s["x"], s["y"]) * 0.8)
        sp = [s for s in sp if (s["x"], s["y"]) not in used]
        if sp:
            used.add((sp[0]["x"], sp[0]["y"]))
            dec["orders"].append(dict(unit=u["id"], action="settle", x=sp[0]["x"], y=sp[0]["y"]))
            notes.append(f"مهاجران به ({sp[0]['x']},{sp[0]['y']}) فرستاده شدند")

    # diplomacy
    for p in civ["proposals"]:
        other = eng.civs[p["from"]]
        op = eng.military_power(other["id"])
        if p["type"] == "peace" and (my_power < op * 1.1 or pers in ("diplomatic", "economic", "scientific")):
            dec["diplomacy"].append(dict(civ=other["id"], action="accept_peace"))
            notes.append(f"صلح با {other['name']} را می‌پذیرم")
        elif p["type"] == "alliance" and pers != "aggressive":
            dec["diplomacy"].append(dict(civ=other["id"], action="accept_alliance"))
            notes.append(f"اتحاد با {other['name']} را می‌پذیرم")
    for o in wars:
        if my_power < eng.military_power(o["id"]) * 0.6 and rnd.random() < 0.5:
            dec["diplomacy"].append(dict(civ=o["id"], action="propose_peace", text="جنگ کافی است؛ بیایید صلح کنیم."))
            notes.append(f"ارتش {o['name']} قوی‌تر است؛ پیشنهاد صلح می‌دهم")
    aggro = {"aggressive": 0.35, "expansionist": 0.12, "free": 0.1, "defensive": 0.02, "diplomatic": 0.01}.get(pers, 0.05)
    if not wars and eng.s["turn"] > 25:
        for oid in civ["met"]:
            o = eng.civs[oid]
            if o["alive"] and eng.rel(cid, oid) == "peace" and my_power > eng.military_power(oid) * 1.4 \
                    and len(mil) >= 4 and rnd.random() < aggro:
                dec["diplomacy"].append(dict(civ=oid, action="declare_war", text="سرزمین شما از آنِ ما خواهد شد!"))
                wars.append(o)
                notes.append(f"برتری نظامی داریم؛ به {o['name']} اعلان جنگ می‌کنم")
                break
    if pers == "diplomatic" and rnd.random() < 0.15:
        for oid in civ["met"]:
            if eng.rel(cid, oid) == "peace" and eng.civs[oid]["alive"]:
                dec["diplomacy"].append(dict(civ=oid, action="propose_alliance", text="با هم قوی‌تریم."))
                notes.append(f"پیشنهاد اتحاد به {eng.civs[oid]['name']}")
                break

    # military orders
    targets = []
    for o in wars:
        for c in eng.civ_cities(o["id"]):
            d = min((cheb(c["x"], c["y"], m["x"], m["y"]) for m in cities), default=99)
            targets.append((d, c))
    targets.sort(key=lambda t: t[0])
    idle = [u for u in mil if not u["order"] or u["order"].get("type") in ("fortify", "move")]
    if targets and len(mil) >= 3:
        tgt = targets[0][1]
        keep = 1 if not threat_near else 2
        for u in idle[keep:]:
            dec["orders"].append(dict(unit=u["id"], action="attack", target_city=tgt["id"]))
        notes.append(f"ارتش به سوی {tgt['name']} گسیل شد")
    else:
        for u in idle:
            if u["order"]:
                continue
            here = eng.city_at.get((u["x"], u["y"]))
            if here and here["civ"] == cid:
                gar = [x for x in eng.units_at(u["x"], u["y"]) if x["civ"] == cid and not UNITS[x["type"]].get("civil")]
                if len(gar) <= 1:
                    dec["orders"].append(dict(unit=u["id"], action="fortify"))
                    continue
            empty = [c for c in cities if not any(x["civ"] == cid and not UNITS[x["type"]].get("civil")
                                                  for x in eng.units_at(c["x"], c["y"]))]
            if empty:
                c = min(empty, key=lambda c: cheb(c["x"], c["y"], u["x"], u["y"]))
                dec["orders"].append(dict(unit=u["id"], action="move", x=c["x"], y=c["y"]))
            elif rnd.random() < 0.3:
                dec["orders"].append(dict(unit=u["id"], action="explore"))
            else:
                dec["orders"].append(dict(unit=u["id"], action="fortify"))

    situation = f"نوبت {eng.s['turn']}: {len(cities)} شهر، {len(mil)} واحد نظامی، قدرت ارتش {my_power}."
    if wars:
        situation += " در جنگ با " + "، ".join(o["name"] for o in wars) + "."
    dec["thought"] = situation + " " + ("؛ ".join(notes[:6]) or "وضعیت پایدار است؛ به رشد ادامه می‌دهیم") + "."
    dec["plan"] = {"aggressive": "ساخت ارتش قدرتمند و فتح همسایه‌ها",
                   "scientific": "سرمایه‌گذاری روی علم تا رسیدن به پرواز فضایی",
                   "expansionist": "تصاحب هرچه بیشتر زمین با شهرهای جدید",
                   "economic": "ثروت‌اندوزی و رشد پایدار شهرها",
                   "defensive": "حفظ مرزها با حصار و ارتش دفاعی",
                   "diplomatic": "ایجاد اتحادها و پرهیز از جنگ‌های پرهزینه",
                   "cultural": "رشد فرهنگی و جمعیتی"}.get(pers, "رشد متوازن و پاسخ به تهدیدها")
    return dec


# ---------------------------------------------------------------- chat with a leader
def chat_system_prompt(civ, view, thoughts, lang="fa"):
    pers = PERSONALITIES.get(civ["personality"], PERSONALITIES["free"])
    th = "\n".join(f"- نوبت {t['turn']} (تمرکز: {t.get('focus') or '-'}): {t['thought']}" for t in thoughts)
    brief = dict(turn=view["turn"], year=view["year"], era=view["era"], treasury=view["treasury"], score=view["score"],
                 military=view["military"], research=view["research"], techs=len(view["techs_known"]),
                 cities=[dict(name=c["name"], pop=c["pop"], hp=c["hp"], buildings=c["buildings"], queue=c["queue"])
                         for c in view["cities"]],
                 units=len(view["units"]), other_civs=view["other_civs"], threats=len(view["threats"]),
                 proposals=view["proposals"], recent_events=view["recent_events"])
    return f"""تو {civ['leader']}، رهبر تمدن «{civ['name']}» در بازی استراتژی «نبرد تمدن‌های هوش مصنوعی» هستی.
شخصیت تو: {pers['text']}
یک تماشاگر انسانی با تو گفتگو می‌کند. در نقش رهبر بمان و صادقانه درباره دلایل تصمیم‌ها، راهبرد، احساست نسبت به تمدن‌های دیگر و برنامه‌های آینده‌ات حرف بزن.
پاسخ‌ها کوتاه، زنده و شخصیت‌دار باشند (حداکثر حدود ۸ جمله)، به زبان کاربر، متن ساده و بدون JSON.
اگر کاربر چیزی پیشنهاد داد، می‌توانی نظرت را بگویی، اما تصمیم‌های بازی را فقط در نوبت‌های بازی می‌گیری.

برنامه بلندمدت تو: {civ.get('plan') or '-'}
حافظه تو: {civ.get('memory') or '-'}
آخرین افکار و تصمیم‌های تو:
{th or '-'}

وضعیت فعلی تمدن تو (JSON):
{json.dumps(brief, ensure_ascii=False, separators=(",", ":"))}"""


def leader_reply(model, system, history, message, max_tokens):
    msgs = [{"role": "system", "content": system}]
    for h in history[-12:]:
        msgs.append({"role": "assistant" if h["role"] == "leader" else "user", "content": h["content"]})
    msgs.append({"role": "user", "content": message})
    r = chat(model, msgs, max_tokens=max_tokens, temperature=0.8)
    text = r["content"] or ""
    think = "\n".join(m.strip() for m in _THINK.findall(text))
    text = re.sub(r"<think>.*", "", _THINK.sub("", text), flags=re.S | re.I).strip()
    if not text:
        raise ApiError("پاسخ خالی از مدل")
    return dict(text=text, reasoning=(r.get("reasoning") or "") + think, ms=r["ms"], tokens=r.get("tokens"))


def local_chat_reply(civ, view, thoughts, message):
    last = thoughts[-1] if thoughts else None
    wars = [o["name"] for o in view["other_civs"] if o.get("relation") == "war"]
    allies = [o["name"] for o in view["other_civs"] if o.get("relation") == "alliance"]
    parts = [f"من {civ['leader']} هستم، رهبر {civ['name']}."]
    parts.append(f"ما اکنون {len(view['cities'])} شهر، {len(view['units'])} واحد و {view['treasury']['gold']} طلا داریم و در عصر {view['era']} هستیم.")
    if civ.get("plan"):
        parts.append(f"راهبرد من: {civ['plan']}.")
    if last:
        parts.append(f"آخرین تصمیمم در نوبت {last['turn']}: {last['thought']}")
    if wars:
        parts.append("در جنگ هستیم با " + "، ".join(wars) + ".")
    if allies:
        parts.append("متحدان ما: " + "، ".join(allies) + ".")
    parts.append("(من با «هوش محلی» اداره می‌شوم و گفتگوی آزاد ندارم؛ برای گفتگوی کامل یک مدل هوش مصنوعی به این تمدن بدهید.)")
    return " ".join(parts)
