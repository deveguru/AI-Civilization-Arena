"""Procedural map generation: elevation + moisture value-noise, start spots spread
around the corners/edges, guaranteed land around every start."""
import math
import random

from .rules import (DEEP, OCEAN, BEACH, GRASS, PLAINS, FOREST, HILLS, MOUNTAIN,
                    DESERT, TUNDRA, TERRAIN, RESOURCES)

SIZES = {"small": (46, 32), "medium": (60, 40), "large": (78, 52), "huge": (96, 64)}


class Noise:
    def __init__(self, rnd, w, h, scale):
        self.scale = scale
        gw, gh = int(w / scale) + 3, int(h / scale) + 3
        self.g = [[rnd.random() for _ in range(gw)] for _ in range(gh)]

    def at(self, x, y):
        fx, fy = x / self.scale, y / self.scale
        x0, y0 = int(fx), int(fy)
        tx, ty = fx - x0, fy - y0
        sx, sy = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        g = self.g
        a = g[y0][x0] + (g[y0][x0 + 1] - g[y0][x0]) * sx
        b = g[y0 + 1][x0] + (g[y0 + 1][x0 + 1] - g[y0 + 1][x0]) * sx
        return a + (b - a) * sy


def fbm(rnd, w, h, scales):
    layers = [(Noise(rnd, w, h, s), amp) for s, amp in scales]
    tot = sum(a for _, a in layers)

    def f(x, y):
        return sum(n.at(x, y) * a for n, a in layers) / tot
    return f


def start_spots(n, w, h):
    """Spread starts around the map: corners first, then edge middles, then centre."""
    mx, my = max(5, w // 7), max(5, h // 6)
    corners = [(mx, my), (w - 1 - mx, h - 1 - my), (w - 1 - mx, my), (mx, h - 1 - my)]
    edges = [(w // 2, my), (w // 2, h - 1 - my), (mx, h // 2), (w - 1 - mx, h // 2)]
    order = corners + edges + [(w // 2, h // 2)]
    if n <= 4:
        return order[:n]
    if n <= 8:
        return order[:n]
    # many civs: put them on an ellipse
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n + math.pi / 4
        pts.append((int(w / 2 + math.cos(a) * (w / 2 - mx)), int(h / 2 + math.sin(a) * (h / 2 - my))))
    return pts


def generate(seed, size="medium", n_civs=4, land_ratio=0.5):
    rnd = random.Random(seed)
    w, h = SIZES.get(size, SIZES["medium"])
    elev_f = fbm(rnd, w, h, [(14, 1.0), (7, 0.5), (3.5, 0.25), (1.8, 0.12)])
    moist_f = fbm(rnd, w, h, [(12, 1.0), (5, 0.45), (2.5, 0.2)])
    starts = start_spots(n_civs, w, h)

    elev = [0.0] * (w * h)
    for y in range(h):
        for x in range(w):
            e = elev_f(x, y)
            # soft edge falloff so the map is a big continent with seas around
            dx = min(x, w - 1 - x) / (w * 0.5)
            dy = min(y, h - 1 - y) / (h * 0.5)
            edge = min(dx, dy)
            e = e * 0.85 + 0.3 * min(1.0, edge * 3.2) - 0.12
            # lift land around every start spot
            for sx, sy in starts:
                d2 = (x - sx) ** 2 + (y - sy) ** 2
                e += 0.32 * math.exp(-d2 / 28.0)
            elev[y * w + x] = e

    # threshold to target land ratio
    srt = sorted(elev)
    sea = srt[int(len(srt) * (1 - land_ratio))]
    tiles = [0] * (w * h)
    shade = [0] * (w * h)
    lo, hi = srt[0], srt[-1]
    mount_th = sea + (hi - sea) * 0.72
    hill_th = sea + (hi - sea) * 0.5
    for y in range(h):
        lat = abs(y - h / 2) / (h / 2)
        for x in range(w):
            i = y * w + x
            e = elev[i]
            m = moist_f(x, y)
            shade[i] = int(max(0, min(255, (e - lo) / (hi - lo + 1e-9) * 255)))
            if e < sea - 0.07:
                t = DEEP
            elif e < sea:
                t = OCEAN
            elif e < sea + 0.012:
                t = BEACH
            elif e > mount_th:
                t = MOUNTAIN
            elif e > hill_th:
                t = HILLS if m < 0.62 else FOREST
            else:
                if lat > 0.86:
                    t = TUNDRA
                elif m < 0.33:
                    t = DESERT
                elif m < 0.45:
                    t = PLAINS
                elif m < 0.6:
                    t = GRASS
                else:
                    t = FOREST
            tiles[i] = t

    # guarantee a fertile start area
    final_starts = []
    for sx, sy in starts:
        best, bs = None, -1e9
        for y in range(max(1, sy - 4), min(h - 1, sy + 5)):
            for x in range(max(1, sx - 4), min(w - 1, sx + 5)):
                if tiles[y * w + x] not in (GRASS, PLAINS):
                    continue
                s = 0
                for yy in range(y - 2, y + 3):
                    for xx in range(x - 2, x + 3):
                        if 0 <= xx < w and 0 <= yy < h:
                            tt = TERRAIN[tiles[yy * w + xx]]
                            s += tt["food"] * 2 + tt["wood"] + tt["stone"] + (1 if tt["land"] else -0.5)
                s -= ((x - sx) ** 2 + (y - sy) ** 2) * 0.3
                if s > bs:
                    best, bs = (x, y), s
        if best is None:
            best = (sx, sy)
            tiles[sy * w + sx] = GRASS
        bx, by = best
        for yy in range(by - 1, by + 2):
            for xx in range(bx - 1, bx + 2):
                if tiles[yy * w + xx] in (DEEP, OCEAN, MOUNTAIN, DESERT, TUNDRA):
                    tiles[yy * w + xx] = rnd.choice([GRASS, PLAINS, FOREST])
        final_starts.append(best)

    # resources
    res = {}
    for i, t in enumerate(tiles):
        if t == DEEP:
            continue
        if rnd.random() < 0.075:
            opts = [k for k, r in RESOURCES.items() if t in r["on"]]
            if opts:
                res[i] = rnd.choice(opts)
    # each start gets wheat + iron/horses nearby
    for bx, by in final_starts:
        for want in ("wheat", "horses", "iron"):
            for _ in range(40):
                xx, yy = bx + rnd.randint(-3, 3), by + rnd.randint(-3, 3)
                if (xx, yy) == (bx, by) or not (0 <= xx < w and 0 <= yy < h):
                    continue
                i = yy * w + xx
                if tiles[i] in RESOURCES[want]["on"] and i not in res:
                    res[i] = want
                    break
    return dict(w=w, h=h, tiles=tiles, shade=shade, res={str(k): v for k, v in res.items()},
                starts=final_starts)
