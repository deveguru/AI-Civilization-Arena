"""Strategic decision analysis: every AI decision is classified into a few main
strategies so reports can show what each model actually prefers."""
from .rules import UNITS

CATEGORIES = {
    "growth":     dict(name="رشد",               en="Growth",     color="#66bb6a"),
    "expansion":  dict(name="توسعه",             en="Expansion",  color="#26c6da"),
    "science":    dict(name="علم",               en="Science",    color="#42a5f5"),
    "economy":    dict(name="اقتصاد",            en="Economy",    color="#ffca28"),
    "defense":    dict(name="دفاع",              en="Defense",    color="#8d6e63"),
    "attack":     dict(name="حمله",              en="Attack",     color="#ef5350"),
    "alliance":   dict(name="اتحاد و دیپلماسی",  en="Alliance",   color="#ab47bc"),
    "neutrality": dict(name="بی‌طرفی",           en="Neutrality", color="#90a4ae"),
}

BUILD_CAT = {
    "farm": "growth", "granary": "growth", "temple": "growth",
    "library": "science", "university": "science", "spaceport": "science",
    "market": "economy", "bank": "economy", "quarry": "economy", "lumber_mill": "economy",
    "workshop": "economy", "factory": "economy",
    "walls": "defense", "castle": "defense", "barracks": "defense",
}
DIPLO_CAT = {
    "declare_war": ("attack", 3), "propose_alliance": ("alliance", 2), "accept_alliance": ("alliance", 2),
    "propose_peace": ("alliance", 1.5), "accept_peace": ("alliance", 1.5), "message": ("alliance", 0.6),
    "gift_gold": ("alliance", 1), "break_alliance": ("neutrality", 1), "reject": ("neutrality", 0.6),
}


def classify(eng, cid, dec):
    """Return (normalized weights per category, focus). `dec` is the raw decision dict."""
    w = {k: 0.0 for k in CATEGORIES}
    if not isinstance(dec, dict):
        dec = {}
    at_war = any(eng.at_war(cid, o["id"]) for o in eng.civs if o["alive"] and o["id"] != cid)

    for b in dec.get("builds") or []:
        items = b.get("items") or ([b["item"]] if b.get("item") else [])
        for i, it in enumerate(items[:4]):
            wt = 1.0 if i == 0 else 0.4
            if it in BUILD_CAT:
                w[BUILD_CAT[it]] += wt
            elif it == "settler":
                w["expansion"] += wt * 1.3
            elif it in UNITS:
                w["attack" if at_war else "defense"] += wt * (1.0 if not UNITS[it].get("siege") else 1.3)
    for o in dec.get("orders") or []:
        a = o.get("action")
        if a in ("settle", "explore"):
            w["expansion"] += 0.8
        elif a == "attack":
            w["attack"] += 0.7
        elif a == "fortify":
            w["defense"] += 0.3
    for d in dec.get("diplomacy") or []:
        c = DIPLO_CAT.get(d.get("action"))
        if c:
            w[c[0]] += c[1]
    if w["attack"] == 0 and w["alliance"] == 0 and not at_war:
        w["neutrality"] += 1.0
    tot = sum(w.values()) or 1.0
    norm = {k: round(v / tot, 4) for k, v in w.items() if v > 0}

    focus = dec.get("focus")
    if focus not in CATEGORIES:
        focus = max(norm, key=norm.get) if norm else "neutrality"
    return norm, focus


def record(eng, cid, dec):
    norm, focus = classify(eng, cid, dec)
    civ = eng.civs[cid]
    cats = civ.setdefault("cats", {})
    for k, v in norm.items():
        cats[k] = round(cats.get(k, 0) + v, 4)
    fc = civ.setdefault("focus", {})
    fc[focus] = fc.get(focus, 0) + 1
    tl = civ.setdefault("timeline", [])
    tl.append([eng.s["turn"], focus])
    del tl[:-400]
    return norm, focus
