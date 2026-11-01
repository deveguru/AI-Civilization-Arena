"""Turn-based civilization simulation. The whole game is a plain JSON-able dict
(self.s) so it can be stored in SQLite after every turn and resumed later."""
import heapq
import math
import random

from . import mapgen
from .rules import (TERRAIN, RESOURCES, TECHS, UNITS, BUILDINGS, ERAS, ERA_NAMES, CITY_NAMES,
                    PERSONALITIES, era_of)

DIRS = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]
MIN_CITY_DIST = 4
MAX_EVENTS_RECENT = 14


def cheb(ax, ay, bx, by):
    return max(abs(ax - bx), abs(ay - by))


def year_label(y):
    return f"{-y} پ.م" if y < 0 else f"{y} م"


class Engine:
    # ------------------------------------------------------------ creation
    @classmethod
    def new(cls, config):
        seed = config.get("seed") or random.randint(1, 10 ** 9)
        civ_cfgs = config["civs"]
        m = mapgen.generate(seed, config.get("map_size", "medium"), len(civ_cfgs),
                            float(config.get("land_ratio", 0.52)))
        s = dict(
            w=m["w"], h=m["h"], tiles=m["tiles"], shade=m["shade"], res=m["res"],
            owner=[-1] * (m["w"] * m["h"]), turn=0, year=-4000, seed=seed,
            max_turns=int(config.get("max_turns", 250)),
            victories=config.get("victories", ["domination", "science", "score"]),
            civs=[], cities=[], units=[], next_id=1, fx=[], winner=None, victory=None,
            used_city_names=[],
        )
        eng = cls(s)
        eng.rnd = random.Random(seed + 7)
        for i, (cc, (sx, sy)) in enumerate(zip(civ_cfgs, m["starts"])):
            civ = dict(
                id=i, name=cc["name"], leader=cc.get("leader", ""), color=cc["color"],
                flag=cc["flag"], model=cc["model"], personality=cc.get("personality", "free"),
                alive=True, gold=30.0, wood=30.0, stone=20.0, sci=0.0, research=None,
                techs=[], relations={}, peace_turn={}, proposals=[], inbox=[], memory="", plan="",
                met=[], last_errors=[], recent=[], income={}, eliminated_turn=None, score=0,
                capital=None, ai=dict(calls=0, ok=0, fail=0, fallback=0, tokens=0, ms=0),
                city_names=[], founded=0,
            )
            s["civs"].append(civ)
        for c in s["civs"]:
            for o in s["civs"]:
                if o["id"] != c["id"]:
                    c["relations"][str(o["id"])] = "peace"
        for civ, (sx, sy) in zip(s["civs"], m["starts"]):
            city = eng.found_city(civ["id"], sx, sy, silent=True)
            city["pop"] = 2
            eng.spawn_unit(civ["id"], "warrior", sx, sy)
            eng.spawn_unit(civ["id"], "settler", sx, sy)
        eng.recompute_territory()
        eng.ev("start", f"جهان با {len(s['civs'])} تمدن آغاز شد. سال {year_label(s['year'])}")
        return eng

    def __init__(self, state):
        self.s = state
        self.rnd = random.Random(state.get("seed", 1) + state.get("turn", 0) * 31)
        self.events = []
        self._index()

    def _index(self):
        self.cities = {c["id"]: c for c in self.s["cities"]}
        self.units = {u["id"]: u for u in self.s["units"]}
        self.city_at = {(c["x"], c["y"]): c for c in self.s["cities"]}
        self.city_tiles = {}

    def _sync_lists(self):
        self.s["cities"] = list(self.cities.values())
        self.s["units"] = list(self.units.values())
        self.city_at = {(c["x"], c["y"]): c for c in self.s["cities"]}

    @property
    def civs(self):
        return self.s["civs"]

    def nid(self):
        self.s["next_id"] += 1
        return self.s["next_id"]

    # ------------------------------------------------------------ helpers
    def inb(self, x, y):
        return 0 <= x < self.s["w"] and 0 <= y < self.s["h"]

    def ti(self, x, y):
        return self.s["tiles"][y * self.s["w"] + x]

    def terr(self, x, y):
        return TERRAIN[self.ti(x, y)]

    def res_at(self, x, y):
        return self.s["res"].get(str(y * self.s["w"] + x))

    def owner_at(self, x, y):
        return self.s["owner"][y * self.s["w"] + x]

    def rel(self, a, b):
        if a == b:
            return "self"
        return self.civs[a]["relations"].get(str(b), "peace")

    def set_rel(self, a, b, r):
        self.civs[a]["relations"][str(b)] = r
        self.civs[b]["relations"][str(a)] = r

    def at_war(self, a, b):
        return a != b and self.rel(a, b) == "war"

    def ev(self, kind, text, civ=None, civs=None, **data):
        e = dict(turn=self.s["turn"], kind=kind, text=text, civ=civ, data=data)
        self.events.append(e)
        for cid in set(([civ] if civ is not None else []) + (civs or [])):
            r = self.civs[cid]["recent"]
            r.append(f"[نوبت {self.s['turn']}] {text}")
            del r[:-MAX_EVENTS_RECENT]

    def fx(self, kind, **kw):
        kw["k"] = kind
        self.s["fx"].append(kw)

    def units_at(self, x, y):
        return [u for u in self.units.values() if u["x"] == x and u["y"] == y]

    def civ_units(self, cid):
        return [u for u in self.units.values() if u["civ"] == cid]

    def civ_cities(self, cid):
        return [c for c in self.cities.values() if c["civ"] == cid]

    def military_power(self, cid):
        p = 0.0
        for u in self.civ_units(cid):
            ut = UNITS[u["type"]]
            if ut.get("civil"):
                continue
            p += max(ut["str"], ut["rng"]) * u["hp"] / 10
        return round(p, 1)

    # ------------------------------------------------------------ cities & units
    def city_name(self, cid):
        used = set(self.s["used_city_names"])
        free = [n for n in CITY_NAMES if n not in used]
        civ = self.civs[cid]
        if free:
            n = self.rnd.choice(free)
        else:
            n = f"{civ['name']} {len(self.civ_cities(cid)) + 1}"
        self.s["used_city_names"].append(n)
        return n

    def can_found(self, cid, x, y):
        if not self.inb(x, y):
            return "خارج از نقشه"
        t = self.terr(x, y)
        if not t["land"] or t["cost"] is None:
            return "این خانه قابل سکونت نیست (آب یا کوه)"
        o = self.owner_at(x, y)
        if o not in (-1, cid):
            return "این زمین متعلق به تمدن دیگری است"
        for c in self.cities.values():
            if cheb(c["x"], c["y"], x, y) < MIN_CITY_DIST:
                return f"فاصله تا شهر {c['name']} کمتر از {MIN_CITY_DIST} خانه است"
        return None

    def found_city(self, cid, x, y, silent=False):
        civ = self.civs[cid]
        first = not self.civ_cities(cid)
        c = dict(id=self.nid(), civ=cid, orig=cid, name=self.city_name(cid), x=x, y=y, pop=1, food=0.0,
                 culture=0.0, hp=20.0, queue=[], progress=0.0, buildings=[], founded=self.s["turn"],
                 capital=first, blocked=None, attacked=False)
        self.cities[c["id"]] = c
        self._sync_lists()
        civ["founded"] += 1
        if first:
            civ["capital"] = c["id"]
        c["hp"] = self.city_max_hp(c)
        if not silent:
            self.ev("city", f"{civ['name']} شهر «{c['name']}» را بنا کرد.", civ=cid, x=x, y=y)
            self.fx("found", x=x, y=y, civ=cid)
        return c

    def spawn_unit(self, cid, typ, x, y):
        u = dict(id=self.nid(), civ=cid, type=typ, x=x, y=y, hp=10.0, order=None, vet=0,
                 fort=False, acted=False, px=x, py=y)
        if typ != "settler" and any(c["civ"] == cid and "barracks" in c["buildings"]
                                    for c in [self.city_at.get((x, y))] if c):
            u["vet"] = 1
        self.units[u["id"]] = u
        self._sync_lists()
        return u

    def kill_unit(self, u):
        self.units.pop(u["id"], None)
        self._sync_lists()

    def city_max_hp(self, c):
        return 20 + c["pop"] * 1.5 + (15 if "walls" in c["buildings"] else 0) + (20 if "castle" in c["buildings"] else 0)

    def city_radius(self, c):
        cu = c["culture"]
        return 2 + (cu >= 40) + (cu >= 150) + (cu >= 400)

    def city_power(self, c):
        civ = self.civs[c["civ"]]
        p = 3 + c["pop"] * 0.8 + len(civ["techs"]) * 0.45
        if "walls" in c["buildings"]:
            p += 5
        if "castle" in c["buildings"]:
            p += 8
        gar = [u for u in self.units_at(c["x"], c["y"]) if u["civ"] == c["civ"] and not UNITS[u["type"]].get("civil")]
        if gar:
            p += max(UNITS[g["type"]]["str"] * g["hp"] / 10 for g in gar) * 0.6
        return p * (0.6 + 0.4 * c["hp"] / self.city_max_hp(c))

    # ------------------------------------------------------------ territory & yields
    def recompute_territory(self):
        w, h = self.s["w"], self.s["h"]
        old = self.s["owner"]
        claims = {}
        for c in self.cities.values():
            r = self.city_radius(c)
            for y in range(c["y"] - r, c["y"] + r + 1):
                for x in range(c["x"] - r, c["x"] + r + 1):
                    if not self.inb(x, y):
                        continue
                    d = math.hypot(x - c["x"], y - c["y"])
                    if d > r + 0.45:
                        continue
                    claims.setdefault(y * w + x, []).append((d, c))
        new = [-1] * (w * h)
        self.city_tiles = {c["id"]: [] for c in self.cities.values()}
        for i, lst in claims.items():
            lst.sort(key=lambda t: t[0])
            civs_here = {c["civ"] for _, c in lst}
            if old[i] in civs_here and lst[0][0] > 0:
                own = old[i]
            else:
                own = lst[0][1]["civ"]
            new[i] = own
            for d, c in lst:
                if c["civ"] == own:
                    if d > 0:
                        self.city_tiles[c["id"]].append(i)
                    break
        for c in self.cities.values():
            new[c["y"] * w + c["x"]] = c["civ"]
        self.s["owner"] = new

    def tile_yield(self, i):
        t = TERRAIN[self.s["tiles"][i]]
        y = dict(food=t["food"], wood=t["wood"], stone=t["stone"], gold=t["gold"])
        r = self.s["res"].get(str(i))
        if r:
            for k in ("food", "wood", "stone", "gold"):
                y[k] += RESOURCES[r].get(k, 0)
        return y

    def city_yield(self, c):
        w = self.s["w"]
        ci = c["y"] * w + c["x"]
        cy = self.tile_yield(ci)
        tot = dict(food=max(cy["food"], 2), wood=max(cy["wood"], 1), stone=cy["stone"], gold=cy["gold"] + 1)
        tiles = self.city_tiles.get(c["id"], [])
        scored = sorted(tiles, key=lambda i: -(lambda y: y["food"] * 3 + y["wood"] * 2 + y["stone"] * 2 + y["gold"] * 2)(self.tile_yield(i)))
        for i in scored[:c["pop"]]:
            y = self.tile_yield(i)
            for k in tot:
                tot[k] += y[k]
        b = c["buildings"]
        for name in b:
            bd = BUILDINGS[name]
            for k in ("food", "wood", "stone", "gold"):
                tot[k] += bd.get(k, 0)
        if "market" in b:
            tot["gold"] *= 1.25
        if "bank" in b:
            tot["gold"] *= 1.25
        sci = 1 + c["pop"] * 0.7 + sum(BUILDINGS[n].get("science", 0) for n in b)
        if "university" in b:
            sci *= 1.25
        cul = 1 + c["pop"] * 0.25 + sum(BUILDINGS[n].get("culture", 0) for n in b)
        prod = 2 + c["pop"] + tot["wood"] * 0.4
        if "workshop" in b:
            prod *= 1.3
        if "factory" in b:
            prod *= 1.5
        food_net = tot["food"] - c["pop"] * 2
        return dict(food=tot["food"], food_net=food_net, wood=tot["wood"], stone=tot["stone"],
                    gold=tot["gold"], science=sci, culture=cul, prod=prod)

    def growth_need(self, c):
        return 8 + c["pop"] * 5

    # ------------------------------------------------------------ build rules
    def techs_available(self, civ):
        known = set(civ["techs"])
        return [t for t, d in TECHS.items() if t not in known and all(r in known for r in d["req"])]

    def can_queue(self, civ, city, item):
        if item in UNITS:
            tech = UNITS[item]["tech"]
            if tech and tech not in civ["techs"]:
                return f"برای ساخت {UNITS[item]['name']} فناوری {TECHS[tech]['name']} لازم است"
            return None
        if item in BUILDINGS:
            bd = BUILDINGS[item]
            if bd["tech"] and bd["tech"] not in civ["techs"]:
                return f"برای ساخت {bd['name']} فناوری {TECHS[bd['tech']]['name']} لازم است"
            if item in city["buildings"]:
                return f"{bd['name']} قبلاً در {city['name']} ساخته شده"
            if bd.get("needs") and bd["needs"] not in city["buildings"]:
                return f"{bd['name']} نیاز به {BUILDINGS[bd['needs']]['name']} دارد"
            return None
        return f"آیتم ناشناخته: {item}"

    def buildable(self, civ, city):
        return [k for k in list(UNITS) + list(BUILDINGS) if self.can_queue(civ, city, k) is None]

    def item_def(self, item):
        return UNITS.get(item) or BUILDINGS.get(item)

    def can_afford(self, civ, cost):
        return all(civ.get(k, 0) >= v for k, v in cost.items())

    # ------------------------------------------------------------ pathfinding
    def passable_for(self, cid, x, y, allow_enemy_target=None):
        if not self.inb(x, y):
            return False
        t = self.terr(x, y)
        if t["cost"] is None:
            return False
        if allow_enemy_target and (x, y) == allow_enemy_target:
            return True
        c = self.city_at.get((x, y))
        if c and c["civ"] != cid:
            return False
        for u in self.units.values():
            if u["x"] == x and u["y"] == y and u["civ"] != cid:
                return False
        return True

    def _prep_paths(self):
        if getattr(self, "_cost", None) is not None:
            return
        w, h = self.s["w"], self.s["h"]
        self._cost = [TERRAIN[t]["cost"] for t in self.s["tiles"]]
        comp = [-1] * (w * h)
        k = 0
        for i in range(w * h):
            if comp[i] >= 0 or self._cost[i] is None:
                continue
            stack = [i]
            comp[i] = k
            while stack:
                j = stack.pop()
                jx, jy = j % w, j // w
                for dx, dy in DIRS:
                    nx, ny = jx + dx, jy + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        n = ny * w + nx
                        if comp[n] < 0 and self._cost[n] is not None:
                            comp[n] = k
                            stack.append(n)
            k += 1
        self._comp = comp

    def astar(self, cid, sx, sy, tx, ty, goal_range=0, limit=2500):
        if cheb(sx, sy, tx, ty) <= goal_range:
            return []
        self._prep_paths()
        w, h = self.s["w"], self.s["h"]
        cost_arr, comp = self._cost, self._comp
        # target on another landmass -> unreachable, skip the search
        sc = comp[sy * w + sx]
        ok = False
        for yy in range(ty - goal_range, ty + goal_range + 1):
            for xx in range(tx - goal_range, tx + goal_range + 1):
                if 0 <= xx < w and 0 <= yy < h and comp[yy * w + xx] == sc:
                    ok = True
        if not ok:
            return None
        blocked = {y * w + x for x, y in self._blocked_for(cid)}
        start = sy * w + sx
        openh = [(0, 0, start)]
        came = {start: -1}
        g = {start: 0}
        n = cnt = 0
        while openh and n < limit:
            _, _, cur = heapq.heappop(openh)
            n += 1
            cx, cy = cur % w, cur // w
            if max(abs(cx - tx), abs(cy - ty)) <= goal_range:
                path = []
                while cur != start:
                    path.append((cur % w, cur // w))
                    cur = came[cur]
                return path[::-1]
            gc = g[cur]
            for dx, dy in DIRS:
                nx, ny = cx + dx, cy + dy
                if nx < 0 or ny < 0 or nx >= w or ny >= h:
                    continue
                ni = ny * w + nx
                c = cost_arr[ni]
                if c is None or ni in blocked:
                    continue
                ng = gc + c
                if ng < g.get(ni, 1e9):
                    g[ni] = ng
                    came[ni] = cur
                    cnt += 1
                    heapq.heappush(openh, (ng + 1.3 * max(abs(nx - tx), abs(ny - ty)), cnt, ni))
        return None

    def _blocked_for(self, cid):
        """Tiles occupied by other civs. Cached for one civ's unit phase (foreign units
        do not move during it; stale entries only make paths slightly conservative)."""
        cache = getattr(self, "_blk", None)
        if cache and cache[0] == cid:
            return cache[1]
        blocked = {(u["x"], u["y"]) for u in self.units.values() if u["civ"] != cid}
        blocked |= {(c["x"], c["y"]) for c in self.cities.values() if c["civ"] != cid}
        self._blk = (cid, blocked)
        return blocked

    def walk(self, u, tx, ty, goal_range=0):
        """Move a unit toward target this turn. Returns True if it moved."""
        mv = UNITS[u["type"]]["move"]
        path = self.astar(u["civ"], u["x"], u["y"], tx, ty, goal_range)
        if path is None:
            return None
        mp = mv
        moved = False
        for (nx, ny) in path:
            cost = self.terr(nx, ny)["cost"]
            if cost > mp and mp < mv:
                break
            if not self.passable_for(u["civ"], nx, ny):
                break
            u["x"], u["y"] = nx, ny
            mp -= cost
            moved = True
            if mp <= 0:
                break
        if moved:
            u["fort"] = False
            u["acted"] = True
        return moved

    # ------------------------------------------------------------ combat
    def unit_power(self, u, attacking, ranged=False, vs=None):
        ut = UNITS[u["type"]]
        if ut.get("civil"):
            return 0.4
        base = ut["rng"] if ranged else ut["str"]
        if not attacking and ut["rng"] and not ranged:
            base = max(ut["str"], ut["rng"] * 0.5)
        m = (1 + 0.2 * u.get("vet", 0)) * (0.5 + 0.5 * u["hp"] / 10)
        if not attacking:
            m *= 1 + self.terr(u["x"], u["y"])["defense"]
            if u.get("fort"):
                m *= 1.25
        if vs is not None and ut.get("anti_mounted") and UNITS[vs["type"]].get("mounted"):
            m *= 1.5
        return max(0.3, base * m)

    def dmg(self, a, d):
        r = a / max(d, 0.1)
        v = 3.2 * (r ** 0.85) * self.rnd.uniform(0.8, 1.25)
        return max(1, min(10, round(v)))

    def attack_unit(self, att, df):
        aciv, dciv = self.civs[att["civ"]], self.civs[df["civ"]]
        ut = UNITS[att["type"]]
        ranged = ut["rng"] > 0
        if UNITS[df["type"]].get("civil"):
            self.kill_unit(df)
            self.ev("battle", f"{UNITS[att['type']]['name']} {aciv['name']} یک {UNITS[df['type']]['name']} از {dciv['name']} را نابود کرد.",
                    civs=[att["civ"], df["civ"]])
            self.fx("kill", x=df["x"], y=df["y"], fx_=att["x"], fy=att["y"], civ=att["civ"])
            if not ranged:
                att["x"], att["y"] = df["x"], df["y"]
            att["acted"] = True
            return
        A = self.unit_power(att, True, ranged, vs=df)
        D = self.unit_power(df, False, False, vs=att)
        d_def = self.dmg(A, D)
        d_att = 0 if ranged else self.dmg(D, A)
        df["hp"] -= d_def
        att["hp"] -= d_att
        att["acted"] = True
        att["fort"] = False
        self.fx("ranged" if ranged else "melee", x=df["x"], y=df["y"], fx_=att["x"], fy=att["y"],
                civ=att["civ"], d=d_def, da=d_att)
        txt = f"نبرد: {UNITS[att['type']]['name']} {aciv['name']} به {UNITS[df['type']]['name']} {dciv['name']} حمله کرد ({d_def}- / {d_att}-)."
        if df["hp"] <= 0:
            self.kill_unit(df)
            txt += " مدافع نابود شد."
            att["vet"] = min(3, att.get("vet", 0) + 1)
            if not ranged and self.passable_for(att["civ"], df["x"], df["y"]):
                att["x"], att["y"] = df["x"], df["y"]
        if att["hp"] <= 0:
            self.kill_unit(att)
            txt += " مهاجم کشته شد."
        self.ev("battle", txt, civs=[att["civ"], df["civ"]], x=df["x"], y=df["y"])

    def attack_city(self, att, city):
        ut = UNITS[att["type"]]
        ranged = ut["rng"] > 0
        A = self.unit_power(att, True, ranged)
        if ut.get("siege"):
            A *= 2.0
        D = self.city_power(city)
        d_city = self.dmg(A, D) * 1.4
        d_att = 0 if ranged else self.dmg(D, A)
        city["hp"] -= d_city
        city["attacked"] = True
        att["hp"] -= d_att
        att["acted"] = True
        att["fort"] = False
        aciv, dciv = self.civs[att["civ"]], self.civs[city["civ"]]
        self.fx("siege" if ranged else "melee", x=city["x"], y=city["y"], fx_=att["x"], fy=att["y"],
                civ=att["civ"], d=round(d_city), da=d_att)
        if ranged and city["hp"] < 1:
            city["hp"] = 1
        self.ev("siege", f"{UNITS[att['type']]['name']} {aciv['name']} به شهر {city['name']} ({dciv['name']}) حمله کرد. جان شهر: {max(0, round(city['hp']))}",
                civs=[att["civ"], city["civ"]], x=city["x"], y=city["y"])
        if att["hp"] <= 0:
            self.kill_unit(att)
            return
        if city["hp"] <= 0 and not ranged:
            self.capture(city, att)

    def capture(self, city, att):
        old = city["civ"]
        new = att["civ"]
        for u in self.units_at(city["x"], city["y"]):
            if u["civ"] == old:
                self.kill_unit(u)
        city["civ"] = new
        city["pop"] = max(1, city["pop"] - max(1, city["pop"] // 3))
        lost = [b for b in city["buildings"] if b in ("walls", "castle") or self.rnd.random() < 0.3]
        city["buildings"] = [b for b in city["buildings"] if b not in lost]
        city["queue"], city["progress"], city["blocked"] = [], 0.0, None
        was_cap = city["capital"]
        city["capital"] = False
        city["hp"] = self.city_max_hp(city) * 0.4
        city["culture"] *= 0.5
        att["x"], att["y"] = city["x"], city["y"]
        self._sync_lists()
        oc, nc = self.civs[old], self.civs[new]
        msg = f"{nc['name']} شهر «{city['name']}» را از {oc['name']} فتح کرد!"
        if was_cap:
            msg += " (پایتخت سقوط کرد)"
        self.ev("capture", msg, civs=[old, new], x=city["x"], y=city["y"])
        self.fx("capture", x=city["x"], y=city["y"], civ=new)
        if was_cap:
            rest = self.civ_cities(old)
            if rest:
                nc2 = max(rest, key=lambda c: c["pop"])
                nc2["capital"] = True
                oc["capital"] = nc2["id"]
            else:
                oc["capital"] = None
        self.check_elimination(old, by=new)

    def check_elimination(self, cid, by=None):
        civ = self.civs[cid]
        if not civ["alive"]:
            return
        if self.civ_cities(cid):
            return
        if any(u["type"] == "settler" for u in self.civ_units(cid)) and self.s["turn"] < 15:
            return
        civ["alive"] = False
        civ["eliminated_turn"] = self.s["turn"]
        for u in self.civ_units(cid):
            self.kill_unit(u)
        who = f" به دست {self.civs[by]['name']}" if by is not None else ""
        self.ev("eliminated", f"تمدن {civ['name']}{who} از صحنه تاریخ محو شد.", civ=cid)

    # ------------------------------------------------------------ decisions
    def apply_decision(self, cid, d):
        civ = self.civs[cid]
        errs, done = [], []
        if not civ["alive"] or not isinstance(d, dict):
            return errs, done
        for k in ("plan", "memory"):
            if isinstance(d.get(k), str):
                civ[k] = d[k][:600]

        for a in d.get("diplomacy") or []:
            try:
                self._diplo(cid, a, errs, done)
            except Exception as e:  # noqa
                errs.append(f"دیپلماسی نامعتبر: {e}")

        r = d.get("research")
        if r:
            if r in self.techs_available(civ):
                if civ["research"] != r:
                    civ["research"] = r
                    done.append(f"پژوهش: {TECHS[r]['name']}")
            elif r not in civ["techs"]:
                errs.append(f"فناوری {r} الان قابل پژوهش نیست")

        for b in d.get("builds") or []:
            try:
                city = self.cities.get(int(b.get("city")))
            except (TypeError, ValueError):
                city = None
            if not city or city["civ"] != cid:
                errs.append(f"شهر {b.get('city')} متعلق به شما نیست")
                continue
            items = b.get("items") or ([b["item"]] if b.get("item") else [])
            q = []
            for it in items[:4]:
                why = self.can_queue(civ, city, it)
                if why:
                    errs.append(why)
                elif not (it in BUILDINGS and it in q):
                    q.append(it)
            if q:
                if not city["queue"] or city["queue"][0] != q[0]:
                    city["progress"] = 0.0
                city["queue"] = q
                city["blocked"] = None
                done.append(f"{city['name']}: " + "، ".join(self.item_def(i)["name"] for i in q))

        for o in d.get("orders") or []:
            try:
                self._order(cid, o, errs, done)
            except Exception as e:  # noqa
                errs.append(f"فرمان نامعتبر: {e}")
        civ["last_errors"] = errs[:10]
        return errs, done

    def _diplo(self, cid, a, errs, done):
        civ = self.civs[cid]
        act = a.get("action")
        try:
            tid = int(a.get("civ"))
        except (TypeError, ValueError):
            errs.append("شناسه تمدن مقصد نامعتبر است")
            return
        if tid == cid or not (0 <= tid < len(self.civs)) or not self.civs[tid]["alive"]:
            errs.append(f"تمدن {tid} وجود ندارد یا نابود شده")
            return
        tgt = self.civs[tid]
        if tid not in civ["met"]:
            errs.append(f"هنوز با {tgt['name']} ملاقات نکرده‌اید")
            return
        cur = self.rel(cid, tid)
        text = str(a.get("text") or "")[:300]
        if act == "declare_war":
            if cur == "war":
                return
            pt = civ["peace_turn"].get(str(tid))
            if pt is not None and self.s["turn"] - pt < 5:
                errs.append("پیمان صلح تازه بسته شده؛ تا ۵ نوبت نمی‌توان اعلان جنگ کرد")
                return
            betrayal = cur == "alliance"
            self.set_rel(cid, tid, "war")
            self.ev("war", f"{civ['name']} به {tgt['name']} اعلان جنگ کرد!" + (" (خیانت به متحد)" if betrayal else "")
                    + (f" «{text}»" if text else ""), civs=[cid, tid])
            done.append(f"اعلان جنگ به {tgt['name']}")
            for ally in self.civs:
                if ally["alive"] and ally["id"] not in (cid, tid) and self.rel(ally["id"], tid) == "alliance" \
                        and self.rel(ally["id"], cid) != "war":
                    self.set_rel(ally["id"], cid, "war")
                    self.ev("war", f"{ally['name']} برای دفاع از متحدش {tgt['name']} وارد جنگ با {civ['name']} شد.",
                            civs=[ally["id"], cid])
        elif act in ("propose_peace", "propose_alliance"):
            kind = "peace" if act == "propose_peace" else "alliance"
            if kind == "peace" and cur != "war":
                errs.append(f"با {tgt['name']} در جنگ نیستید")
                return
            if kind == "alliance" and cur != "peace":
                errs.append("اتحاد فقط در حالت صلح ممکن است")
                return
            tgt["proposals"] = [p for p in tgt["proposals"] if not (p["from"] == cid and p["type"] == kind)]
            tgt["proposals"].append(dict(type=kind, turn=self.s["turn"], text=text, **{"from": cid}))
            self.ev("diplomacy", f"{civ['name']} به {tgt['name']} پیشنهاد {'صلح' if kind == 'peace' else 'اتحاد'} داد."
                    + (f" «{text}»" if text else ""), civs=[cid, tid], frm=cid, to=tid, msg=text)
            done.append(f"پیشنهاد {'صلح' if kind == 'peace' else 'اتحاد'} به {tgt['name']}")
        elif act in ("accept_peace", "accept_alliance"):
            kind = "peace" if act == "accept_peace" else "alliance"
            p = next((p for p in civ["proposals"] if p["from"] == tid and p["type"] == kind), None)
            if not p:
                errs.append(f"پیشنهاد {kind} از {tgt['name']} وجود ندارد")
                return
            civ["proposals"].remove(p)
            self.set_rel(cid, tid, kind)
            civ["peace_turn"][str(tid)] = self.s["turn"]
            tgt["peace_turn"][str(cid)] = self.s["turn"]
            if kind == "peace":
                self.ev("peace", f"صلح میان {civ['name']} و {tgt['name']} برقرار شد.", civs=[cid, tid])
                for u in self.units.values():   # stop running attacks
                    if u["civ"] in (cid, tid) and u["order"] and u["order"].get("type") == "attack":
                        u["order"] = None
            else:
                self.ev("alliance", f"{civ['name']} و {tgt['name']} پیمان اتحاد بستند.", civs=[cid, tid])
            done.append(f"پذیرش {kind} با {tgt['name']}")
        elif act == "reject":
            civ["proposals"] = [p for p in civ["proposals"] if p["from"] != tid]
            self.ev("diplomacy", f"{civ['name']} پیشنهاد {tgt['name']} را رد کرد." + (f" «{text}»" if text else ""),
                    civs=[cid, tid], frm=cid, to=tid, msg=text)
        elif act == "break_alliance":
            if cur == "alliance":
                self.set_rel(cid, tid, "peace")
                self.ev("diplomacy", f"{civ['name']} اتحاد با {tgt['name']} را لغو کرد.", civs=[cid, tid])
        elif act == "message":
            if text:
                tgt["inbox"].append(dict(turn=self.s["turn"], text=text, **{"from": cid}))
                del tgt["inbox"][:-8]
                self.ev("message", f"پیام {civ['name']} به {tgt['name']}: «{text}»", civs=[cid, tid],
                        frm=cid, to=tid, msg=text)
                done.append(f"پیام به {tgt['name']}")
        elif act == "gift_gold":
            amt = max(0, min(float(a.get("amount") or 0), civ["gold"]))
            if amt >= 1:
                civ["gold"] -= amt
                tgt["gold"] += amt
                self.ev("diplomacy", f"{civ['name']} {int(amt)} طلا به {tgt['name']} هدیه داد.", civs=[cid, tid])
                done.append(f"هدیه {int(amt)} طلا")
        else:
            errs.append(f"اقدام دیپلماتیک ناشناخته: {act}")

    def _order(self, cid, o, errs, done):
        try:
            u = self.units.get(int(o.get("unit")))
        except (TypeError, ValueError):
            u = None
        if not u or u["civ"] != cid:
            errs.append(f"واحد {o.get('unit')} متعلق به شما نیست")
            return
        act = o.get("action")
        ut = UNITS[u["type"]]

        def xy():
            x, y = int(o.get("x")), int(o.get("y"))
            if not self.inb(x, y):
                raise ValueError(f"مختصات ({x},{y}) خارج از نقشه")
            return x, y

        if act == "move":
            x, y = xy()
            u["order"] = dict(type="move", x=x, y=y)
        elif act == "settle":
            if u["type"] != "settler":
                errs.append(f"واحد {u['id']} مهاجر نیست")
                return
            if o.get("x") is not None:
                x, y = xy()
            else:
                x, y = u["x"], u["y"]
            why = self.can_found(cid, x, y)
            if why:
                errs.append(f"اسکان در ({x},{y}) ممکن نیست: {why}")
                return
            u["order"] = dict(type="settle", x=x, y=y)
        elif act == "attack":
            if ut.get("civil"):
                errs.append("مهاجر نمی‌تواند حمله کند")
                return
            if o.get("target_city") is not None:
                c = self.cities.get(int(o["target_city"]))
                if not c:
                    errs.append(f"شهر {o['target_city']} وجود ندارد")
                    return
                if not self.at_war(cid, c["civ"]):
                    errs.append(f"برای حمله به {c['name']} ابتدا باید اعلان جنگ کنید")
                    return
                u["order"] = dict(type="attack", city=c["id"])
            elif o.get("target_unit") is not None:
                t = self.units.get(int(o["target_unit"]))
                if not t:
                    errs.append(f"واحد هدف {o['target_unit']} وجود ندارد")
                    return
                if not self.at_war(cid, t["civ"]):
                    errs.append("با صاحب این واحد در جنگ نیستید")
                    return
                u["order"] = dict(type="attack", unit=t["id"])
            else:
                x, y = xy()
                u["order"] = dict(type="attack", x=x, y=y)
        elif act == "fortify":
            u["order"] = dict(type="fortify")
        elif act == "explore":
            u["order"] = dict(type="explore")
        elif act == "disband":
            self.kill_unit(u)
            done.append(f"انحلال واحد {u['id']}")
            return
        else:
            errs.append(f"فرمان ناشناخته: {act}")
            return
        u["fort"] = False if act != "fortify" else u["fort"]
        done.append(f"{ut['name']}#{u['id']}: {act}")

    # ------------------------------------------------------------ turn
    def step(self):
        s = self.s
        s["fx"] = []
        self.events = []
        for u in self.units.values():
            u["px"], u["py"] = u["x"], u["y"]
            u["acted"] = False
        for c in self.cities.values():
            c["attacked"] = False
        alive = [c for c in self.civs if c["alive"]]

        # 1. cities: production + economy
        self.recompute_territory()
        for civ in alive:
            inc = dict(gold=2.0, wood=0.0, stone=0.0, science=1.0, food=0.0, prod=0.0, culture=0.0)
            for c in self.civ_cities(civ["id"]):
                y = self.city_yield(c)
                for k in ("gold", "wood", "stone", "science", "culture", "prod"):
                    inc[k] += y[k]
                inc["food"] += y["food_net"]
                self._city_turn(civ, c, y)
            ncity = len(self.civ_cities(civ["id"]))
            mil = [u for u in self.civ_units(civ["id"]) if not UNITS[u["type"]].get("civil")]
            upkeep = max(0, len(mil) - (ncity * 2 + 1)) * (1 + ERAS.index(era_of(civ["techs"])) * 0.4)
            inc["upkeep"] = round(upkeep, 1)
            civ["gold"] += inc["gold"] - upkeep
            civ["wood"] += inc["wood"]
            civ["stone"] += inc["stone"]
            civ["sci"] += inc["science"]
            if civ["gold"] < 0:
                civ["gold"] = 0
                if mil:
                    victim = self.rnd.choice(mil)
                    self.kill_unit(victim)
                    self.ev("economy", f"خزانه {civ['name']} خالی شد؛ یک {UNITS[victim['type']]['name']} منحل شد.", civ=civ["id"])
            civ["income"] = {k: round(v, 1) for k, v in inc.items()}
            self._research(civ)

        # 2. units (shuffled civ order for fairness)
        order = [c["id"] for c in alive]
        self.rnd.shuffle(order)
        for cid in order:
            self._blk = None
            for u in sorted(self.civ_units(cid), key=lambda u: u["id"]):
                if u["id"] in self.units and self.civs[cid]["alive"]:
                    self._unit_turn(u)

        self._blk = None
        # 3. city bombardment + healing
        for c in list(self.cities.values()):
            self._city_defend(c)
            if not c["attacked"]:
                c["hp"] = min(self.city_max_hp(c), c["hp"] + 3)
        for u in self.units.values():
            if not u["acted"]:
                own = self.owner_at(u["x"], u["y"]) == u["civ"]
                incity = self.city_at.get((u["x"], u["y"]))
                heal = 3 if (incity and incity["civ"] == u["civ"]) else (2 if own else 1)
                u["hp"] = min(10, u["hp"] + heal)

        # 4. proposals expire, contacts, elimination, score
        for civ in self.civs:
            civ["proposals"] = [p for p in civ["proposals"] if s["turn"] - p["turn"] <= 6]
        self._contacts()
        for civ in self.civs:
            if civ["alive"]:
                self.check_elimination(civ["id"])
        for civ in self.civs:
            civ["score"] = self.score(civ["id"]) if civ["alive"] else civ.get("score", 0)
        self.recompute_territory()

        s["turn"] += 1
        old_year = s["year"]
        s["year"] += self._year_step(old_year)
        if old_year < 0 <= s["year"]:
            s["year"] = max(1, s["year"])
        self._victory()
        self._sync_lists()
        return self.events

    def _year_step(self, y):
        if y < -1000:
            return 40
        if y < 500:
            return 25
        if y < 1500:
            return 20
        if y < 1800:
            return 10
        if y < 1900:
            return 5
        return 2

    def _city_turn(self, civ, c, y):
        # growth
        c["food"] += y["food_net"]
        need = self.growth_need(c)
        if c["food"] >= need:
            c["pop"] += 1
            c["food"] = need * 0.4 if "granary" in c["buildings"] else 0
            if c["pop"] in (5, 10, 15, 20):
                self.ev("growth", f"شهر {c['name']} ({civ['name']}) به جمعیت {c['pop']} رسید.", civ=civ["id"])
        elif c["food"] < 0:
            if c["pop"] > 1:
                c["pop"] -= 1
                self.ev("famine", f"قحطی در {c['name']}؛ جمعیت کاهش یافت.", civ=civ["id"])
            c["food"] = 0
        old_r = self.city_radius(c)
        c["culture"] += y["culture"]
        if self.city_radius(c) > old_r:
            self.ev("culture", f"مرزهای فرهنگی {c['name']} گسترش یافت.", civ=civ["id"])
        # production
        if not c["queue"]:
            return
        item = c["queue"][0]
        if self.can_queue(civ, c, item):
            c["queue"].pop(0)
            c["progress"] = 0
            return
        d = self.item_def(item)
        c["progress"] = min(d["prod"], c["progress"] + y["prod"])
        if c["progress"] < d["prod"]:
            c["blocked"] = None
            return
        if not self.can_afford(civ, d["cost"]):
            miss = "، ".join(f"{k} {int(v - civ.get(k, 0))}" for k, v in d["cost"].items() if civ.get(k, 0) < v)
            c["blocked"] = f"کمبود منابع: {miss}"
            return
        if item == "settler" and c["pop"] < 2:
            c["blocked"] = "جمعیت شهر برای مهاجر کافی نیست (حداقل ۲)"
            return
        for k, v in d["cost"].items():
            civ[k] -= v
        c["queue"].pop(0)
        c["progress"] = 0.0
        c["blocked"] = None
        if item in UNITS:
            if item == "settler":
                c["pop"] -= 1
            self.spawn_unit(civ["id"], item, c["x"], c["y"])
            if not UNITS[item].get("civil"):
                pass
        else:
            c["buildings"].append(item)
            c["hp"] = min(self.city_max_hp(c), c["hp"] + (15 if item in ("walls", "castle") else 0))
            self.ev("build", f"{civ['name']} در {c['name']} {d['name']} ساخت.", civ=civ["id"])
            if item == "spaceport":
                self.ev("victory", f"{civ['name']} پایگاه فضایی را تکمیل کرد و به ستارگان رسید!", civ=civ["id"])
                if "science" in self.s["victories"]:
                    self.s["winner"] = civ["id"]
                    self.s["victory"] = "science"

    def _research(self, civ):
        if not civ["research"] or civ["research"] in civ["techs"]:
            av = self.techs_available(civ)
            civ["research"] = min(av, key=lambda t: TECHS[t]["cost"]) if av else None
        r = civ["research"]
        if not r:
            return
        cost = TECHS[r]["cost"]
        if civ["sci"] >= cost:
            civ["sci"] -= cost
            old_era = era_of(civ["techs"]) if civ["techs"] else "ancient"
            civ["techs"].append(r)
            civ["research"] = None
            self.ev("tech", f"{civ['name']} فناوری «{TECHS[r]['name']}» را کشف کرد.", civ=civ["id"])
            ne = era_of(civ["techs"])
            if ERAS.index(ne) > ERAS.index(old_era):
                self.ev("era", f"{civ['name']} وارد عصر {ERA_NAMES[ne]} شد!", civ=civ["id"])

    def _unit_turn(self, u):
        o = u.get("order")
        cid = u["civ"]
        ut = UNITS[u["type"]]
        rng = ut["range"] if ut["rng"] else 1
        # auto-defence: idle military attacks adjacent enemies
        if not o or o.get("type") in ("fortify",):
            if not ut.get("civil"):
                t = self._enemy_near(u, rng)
                if t:
                    self._strike(u, t)
                    return
            if o and o["type"] == "fortify":
                u["fort"] = True
            return
        typ = o["type"]
        if typ == "move":
            if (u["x"], u["y"]) == (o["x"], o["y"]):
                u["order"] = None
                return
            r = self.walk(u, o["x"], o["y"])
            if r is None:
                r = self.walk(u, o["x"], o["y"], goal_range=1)
                if r is None:
                    self.civs[cid]["last_errors"].append(f"واحد {u['id']} مسیری به ({o['x']},{o['y']}) پیدا نکرد")
                    u["order"] = None
                    return
            if cheb(u["x"], u["y"], o["x"], o["y"]) == 0 or (r is False and cheb(u["x"], u["y"], o["x"], o["y"]) <= 1):
                u["order"] = None
        elif typ == "settle":
            if (u["x"], u["y"]) == (o["x"], o["y"]):
                why = self.can_found(cid, u["x"], u["y"])
                if why:
                    self.civs[cid]["last_errors"].append(f"اسکان در ({u['x']},{u['y']}) شکست خورد: {why}")
                    u["order"] = None
                else:
                    self.kill_unit(u)
                    self.found_city(cid, u["x"], u["y"])
                    self.recompute_territory()
                return
            r = self.walk(u, o["x"], o["y"])
            if r is None:
                self.civs[cid]["last_errors"].append(f"مهاجر {u['id']} راهی به ({o['x']},{o['y']}) ندارد")
                u["order"] = None
            elif (u["x"], u["y"]) == (o["x"], o["y"]) and not self.can_found(cid, u["x"], u["y"]):
                self.kill_unit(u)
                self.found_city(cid, u["x"], u["y"])
                self.recompute_territory()
        elif typ == "explore":
            if not o.get("x") or cheb(u["x"], u["y"], o["x"], o["y"]) <= 1:
                for _ in range(30):
                    x = u["x"] + self.rnd.randint(-12, 12)
                    y = u["y"] + self.rnd.randint(-12, 12)
                    if self.inb(x, y) and self.terr(x, y)["cost"] is not None and self.owner_at(x, y) != cid:
                        o["x"], o["y"] = x, y
                        break
                else:
                    u["order"] = None
                    return
            if self.walk(u, o["x"], o["y"]) is None:
                o["x"] = None
        elif typ == "attack":
            tgt = self._resolve_target(u, o)
            if tgt is None:
                u["order"] = None
                t = self._enemy_near(u, rng)
                if t:
                    self._strike(u, t)
                return
            kind, obj, tx, ty = tgt
            if cheb(u["x"], u["y"], tx, ty) <= rng:
                self._strike(u, (kind, obj))
                return
            # en route: hit anything hostile in range first? only if blocked
            r = self.walk(u, tx, ty, goal_range=rng)
            if r is None or r is False:
                t = self._enemy_near(u, rng)
                if t:
                    self._strike(u, t)
            if u["id"] in self.units and not u["acted"] and cheb(u["x"], u["y"], tx, ty) <= rng and ut["move"] > 1:
                self._strike(u, (kind, obj))

    def _resolve_target(self, u, o):
        cid = u["civ"]
        if o.get("city") is not None:
            c = self.cities.get(o["city"])
            if not c or c["civ"] == cid or not self.at_war(cid, c["civ"]):
                return None
            return ("city", c, c["x"], c["y"])
        if o.get("unit") is not None:
            t = self.units.get(o["unit"])
            if not t or not self.at_war(cid, t["civ"]):
                return None
            return ("unit", t, t["x"], t["y"])
        x, y = o.get("x"), o.get("y")
        c = self.city_at.get((x, y))
        if c and self.at_war(cid, c["civ"]):
            return ("city", c, x, y)
        for t in self.units_at(x, y):
            if self.at_war(cid, t["civ"]):
                return ("unit", t, x, y)
        # nothing there: just move
        if (u["x"], u["y"]) != (x, y):
            self.walk(u, x, y)
        return None

    def _enemy_near(self, u, rng):
        best = None
        for c in self.cities.values():
            if self.at_war(u["civ"], c["civ"]) and cheb(u["x"], u["y"], c["x"], c["y"]) <= rng:
                return ("city", c)
        for t in self.units.values():
            if self.at_war(u["civ"], t["civ"]) and cheb(u["x"], u["y"], t["x"], t["y"]) <= rng:
                if best is None or t["hp"] < best[1]["hp"]:
                    best = ("unit", t)
        return best

    def _strike(self, u, tgt):
        kind, obj = tgt
        if kind == "city":
            self.attack_city(u, obj)
        else:
            # a unit standing in a city is attacked via the city
            c = self.city_at.get((obj["x"], obj["y"]))
            if c and c["civ"] == obj["civ"]:
                self.attack_city(u, c)
            else:
                self.attack_unit(u, obj)

    def _city_defend(self, c):
        if c["id"] not in self.cities:
            return
        targets = [t for t in self.units.values() if self.at_war(c["civ"], t["civ"])
                   and cheb(c["x"], c["y"], t["x"], t["y"]) <= 2]
        if not targets:
            return
        t = min(targets, key=lambda t: t["hp"])
        A = self.city_power(c) * 0.7
        D = self.unit_power(t, False)
        d = self.dmg(A, D)
        t["hp"] -= d
        self.fx("ranged", x=t["x"], y=t["y"], fx_=c["x"], fy=c["y"], civ=c["civ"], d=d, da=0)
        if t["hp"] <= 0:
            self.kill_unit(t)
            self.ev("battle", f"تیراندازان شهر {c['name']} یک {UNITS[t['type']]['name']} از {self.civs[t['civ']]['name']} را از پا درآوردند.",
                    civs=[c["civ"], t["civ"]])

    def _contacts(self):
        pts = {}
        for c in self.cities.values():
            pts.setdefault(c["civ"], []).append((c["x"], c["y"]))
        for u in self.units.values():
            pts.setdefault(u["civ"], []).append((u["x"], u["y"]))
        ids = [c["id"] for c in self.civs if c["alive"]]
        for i in ids:
            for j in ids:
                if j <= i or j in self.civs[i]["met"]:
                    continue
                hit = any(cheb(a[0], a[1], b[0], b[1]) <= 9 for a in pts.get(i, []) for b in pts.get(j, []))
                if hit:
                    self.civs[i]["met"].append(j)
                    self.civs[j]["met"].append(i)
                    self.ev("contact", f"{self.civs[i]['name']} و {self.civs[j]['name']} برای نخستین بار با هم روبه‌رو شدند.",
                            civs=[i, j])

    def score(self, cid):
        cs = self.civ_cities(cid)
        civ = self.civs[cid]
        return int(sum(c["pop"] for c in cs) * 4 + len(cs) * 15 + len(civ["techs"]) * 8
                   + sum(len(c["buildings"]) for c in cs) * 2 + self.military_power(cid) * 0.3)

    def _victory(self):
        s = self.s
        if s["winner"] is not None:
            return
        alive = [c for c in self.civs if c["alive"]]
        if "domination" in s["victories"] and len(alive) == 1 and len(self.civs) > 1:
            s["winner"], s["victory"] = alive[0]["id"], "domination"
            self.ev("victory", f"{alive[0]['name']} با فتح جهان پیروز شد!", civ=alive[0]["id"])
        elif s["turn"] >= s["max_turns"]:
            best = max(alive, key=lambda c: c["score"]) if alive else None
            if best:
                s["winner"], s["victory"] = best["id"], "score"
                self.ev("victory", f"پایان زمان! {best['name']} با امتیاز {best['score']} پیروز شد.", civ=best["id"])

    def finished(self):
        return self.s["winner"] is not None or not any(c["alive"] for c in self.civs)

    # ------------------------------------------------------------ AI view
    def settle_candidates(self, cid, n=5):
        own = self.civ_cities(cid)
        if not own:
            us = [u for u in self.civ_units(cid) if u["type"] == "settler"]
            centers = [(u["x"], u["y"]) for u in us]
        else:
            centers = [(c["x"], c["y"]) for c in own]
        seen, cands = set(), []
        w = self.s["w"]
        for cx, cy in centers:
            for y in range(cy - 10, cy + 11):
                for x in range(cx - 10, cx + 11):
                    if (x, y) in seen or not self.inb(x, y):
                        continue
                    seen.add((x, y))
                    if self.can_found(cid, x, y):
                        continue
                    d = min(cheb(x, y, a, b) for a, b in centers)
                    if d < 4:
                        continue
                    sc = 0.0
                    for yy in range(y - 2, y + 3):
                        for xx in range(x - 2, x + 3):
                            if self.inb(xx, yy):
                                ty = self.tile_yield(yy * w + xx)
                                sc += ty["food"] * 1.5 + ty["wood"] + ty["stone"] + ty["gold"]
                                if self.owner_at(xx, yy) not in (-1, cid):
                                    sc -= 3
                    sc -= d * 1.2
                    cands.append((sc, x, y))
        cands.sort(reverse=True)
        out = []
        for sc, x, y in cands:
            if all(cheb(x, y, a, b) >= 4 for _, a, b in out):
                out.append((round(sc, 1), x, y))
            if len(out) >= n:
                break
        return [dict(x=x, y=y, score=sc) for sc, x, y in out]

    def civ_view(self, cid):
        """Compact state for the AI prompt."""
        civ = self.civs[cid]
        cities = []
        for c in self.civ_cities(cid):
            y = self.city_yield(c)
            q = c["queue"]
            cities.append(dict(
                id=c["id"], name=c["name"], x=c["x"], y=c["y"], pop=c["pop"], capital=c["capital"],
                hp=f"{round(c['hp'])}/{round(self.city_max_hp(c))}",
                food=f"{round(c['food'])}/{self.growth_need(c)} ({y['food_net']:+.0f})",
                prod=round(y["prod"], 1), buildings=c["buildings"],
                queue=[f"{q[0]} {round(c['progress'])}/{self.item_def(q[0])['prod']}"] + q[1:] if q else [],
                blocked=c["blocked"],
                can_build=self.buildable(civ, c),
            ))
        units = []
        for u in self.civ_units(cid)[:40]:
            o = u["order"]
            os_ = None
            if o:
                os_ = o["type"] + (f"->({o.get('x')},{o.get('y')})" if o.get("x") is not None else "") \
                    + (f" city#{o['city']}" if o.get("city") else "") + (f" unit#{o['unit']}" if o.get("unit") else "")
            units.append(dict(id=u["id"], type=u["type"], x=u["x"], y=u["y"], hp=round(u["hp"]), order=os_))
        others = []
        mycities = self.civ_cities(cid)
        for o in self.civs:
            if o["id"] == cid:
                continue
            if o["id"] not in civ["met"]:
                others.append(dict(id=o["id"], name=o["name"], met=False, alive=o["alive"]))
                continue
            ocs = self.civ_cities(o["id"])
            near = []
            for c in ocs:
                d = min((cheb(c["x"], c["y"], m["x"], m["y"]) for m in mycities), default=99)
                near.append(dict(id=c["id"], name=c["name"], x=c["x"], y=c["y"], pop=c["pop"],
                                 hp=round(c["hp"]), walls="walls" in c["buildings"], dist=d))
            near.sort(key=lambda c: c["dist"])
            others.append(dict(id=o["id"], name=o["name"], leader=o["leader"], alive=o["alive"],
                               relation=self.rel(cid, o["id"]), score=o["score"], cities=len(ocs),
                               military=self.military_power(o["id"]), techs=len(o["techs"]),
                               era=ERA_NAMES[era_of(o["techs"])] if o["techs"] else ERA_NAMES["ancient"],
                               nearest_cities=near[:4]))
        threats = []
        for t in self.units.values():
            if t["civ"] == cid or UNITS[t["type"]].get("civil"):
                continue
            d = min((cheb(t["x"], t["y"], m["x"], m["y"]) for m in mycities), default=99)
            if d <= 6:
                threats.append(dict(unit=t["id"], civ=t["civ"], type=t["type"], x=t["x"], y=t["y"], hp=round(t["hp"]),
                                    dist=d, at_war=self.at_war(cid, t["civ"])))
        threats.sort(key=lambda t: t["dist"])
        return dict(
            turn=self.s["turn"], year=year_label(self.s["year"]),
            era=ERA_NAMES[era_of(civ["techs"])] if civ["techs"] else ERA_NAMES["ancient"],
            map=f"{self.s['w']}x{self.s['h']}",
            treasury=dict(gold=round(civ["gold"]), wood=round(civ["wood"]), stone=round(civ["stone"])),
            income=civ["income"], score=civ["score"], military=self.military_power(cid),
            research=dict(current=civ["research"], progress=round(civ["sci"]),
                          cost=TECHS[civ["research"]]["cost"] if civ["research"] else None),
            techs_known=civ["techs"],
            techs_available={t: TECHS[t]["cost"] for t in self.techs_available(civ)},
            cities=cities, units=units, settle_spots=self.settle_candidates(cid),
            other_civs=others, threats=threats[:12],
            proposals=[dict(frm=p["from"], type=p["type"], text=p.get("text", "")) for p in civ["proposals"]],
            inbox=[dict(frm=m["from"], turn=m["turn"], text=m["text"]) for m in civ["inbox"][-5:]],
            recent_events=civ["recent"][-10:], errors_last_turn=civ["last_errors"][-8:],
            memory=civ["memory"], plan=civ["plan"],
        )

    # ------------------------------------------------------------ client snapshots
    def static_view(self):
        s = self.s
        return dict(w=s["w"], h=s["h"], tiles="".join(str(t) for t in s["tiles"]), shade=s["shade"],
                    res=s["res"], civs=[dict(id=c["id"], name=c["name"], leader=c["leader"], color=c["color"],
                                             flag=c["flag"], model=c["model"], personality=c["personality"],
                                             pname=PERSONALITIES.get(c["personality"], {}).get("name", ""))
                                        for c in s["civs"]])

    def snapshot(self):
        s = self.s
        own = "".join("." if o < 0 else chr(97 + o) for o in s["owner"])
        civs = []
        for c in s["civs"]:
            cs = self.civ_cities(c["id"])
            civs.append(dict(
                id=c["id"], alive=c["alive"], score=c["score"], gold=round(c["gold"]), wood=round(c["wood"]),
                stone=round(c["stone"]), pop=sum(x["pop"] for x in cs), cities=len(cs),
                units=len(self.civ_units(c["id"])), military=self.military_power(c["id"]),
                techs=len(c["techs"]), tech_list=c["techs"], research=c["research"],
                research_name=TECHS[c["research"]]["name"] if c["research"] else None,
                sci=round(c["sci"]), sci_cost=TECHS[c["research"]]["cost"] if c["research"] else 0,
                era=ERA_NAMES[era_of(c["techs"])] if c["techs"] else ERA_NAMES["ancient"],
                relations=c["relations"], plan=c["plan"], income=c["income"], met=c["met"],
                eliminated_turn=c["eliminated_turn"], ai=c["ai"], capital=c["capital"],
            ))
        return dict(
            turn=s["turn"], year=s["year"], year_label=year_label(s["year"]), max_turns=s["max_turns"],
            winner=s["winner"], victory=s["victory"], owner=own, civs=civs,
            cities=[dict(id=c["id"], civ=c["civ"], name=c["name"], x=c["x"], y=c["y"], pop=c["pop"],
                         hp=round(c["hp"], 1), maxhp=round(self.city_max_hp(c)), capital=c["capital"],
                         buildings=c["buildings"], queue=c["queue"], walls="walls" in c["buildings"] or "castle" in c["buildings"],
                         blocked=c["blocked"]) for c in s["cities"]],
            units=[dict(id=u["id"], civ=u["civ"], type=u["type"], x=u["x"], y=u["y"], px=u.get("px", u["x"]),
                        py=u.get("py", u["y"]), hp=round(u["hp"], 1), vet=u.get("vet", 0), fort=u.get("fort", False),
                        order=(u["order"] or {}).get("type")) for u in s["units"]],
            fx=s["fx"],
        )

    def stats_rows(self):
        rows = []
        for c in self.civs:
            cs = self.civ_cities(c["id"])
            rows.append(dict(civ=c["id"], score=c["score"], pop=sum(x["pop"] for x in cs), cities=len(cs),
                             military=self.military_power(c["id"]), techs=len(c["techs"]), gold=round(c["gold"])))
        return rows
