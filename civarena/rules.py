"""Static game rules: terrain, resources, techs, units, buildings, names."""

# ---------------------------------------------------------------- terrain
DEEP, OCEAN, BEACH, GRASS, PLAINS, FOREST, HILLS, MOUNTAIN, DESERT, TUNDRA = range(10)

TERRAIN = {
    DEEP:     dict(key="deep",     name="اقیانوس",  food=1, wood=0, stone=0, gold=0, cost=None, defense=0.0,  land=False),
    OCEAN:    dict(key="ocean",    name="دریا",     food=1, wood=0, stone=0, gold=1, cost=None, defense=0.0,  land=False),
    BEACH:    dict(key="beach",    name="ساحل",     food=1, wood=0, stone=0, gold=1, cost=1,    defense=0.0,  land=True),
    GRASS:    dict(key="grass",    name="علفزار",   food=2, wood=0, stone=0, gold=0, cost=1,    defense=0.0,  land=True),
    PLAINS:   dict(key="plains",   name="دشت",      food=1, wood=1, stone=0, gold=0, cost=1,    defense=0.0,  land=True),
    FOREST:   dict(key="forest",   name="جنگل",     food=1, wood=2, stone=0, gold=0, cost=2,    defense=0.25, land=True),
    HILLS:    dict(key="hills",    name="تپه",      food=0, wood=0, stone=2, gold=0, cost=2,    defense=0.5,  land=True),
    MOUNTAIN: dict(key="mountain", name="کوهستان",  food=0, wood=0, stone=1, gold=0, cost=None, defense=0.0,  land=True),
    DESERT:   dict(key="desert",   name="بیابان",   food=0, wood=0, stone=0, gold=1, cost=1,    defense=0.0,  land=True),
    TUNDRA:   dict(key="tundra",   name="توندرا",   food=1, wood=0, stone=0, gold=0, cost=1,    defense=0.0,  land=True),
}

RESOURCES = {
    "wheat":  dict(name="گندم",   on=(GRASS, PLAINS),          food=2),
    "fish":   dict(name="ماهی",   on=(OCEAN, BEACH),           food=2),
    "gold":   dict(name="طلا",    on=(HILLS, DESERT, MOUNTAIN), gold=3),
    "iron":   dict(name="آهن",    on=(HILLS, MOUNTAIN, PLAINS), stone=2),
    "horses": dict(name="اسب",    on=(PLAINS, GRASS),          food=1, gold=1),
    "gems":   dict(name="جواهر",  on=(FOREST, HILLS, DESERT),  gold=2),
    "timber": dict(name="الوار",  on=(FOREST,),                wood=2),
}

# ---------------------------------------------------------------- eras & techs
ERAS = ["ancient", "classical", "medieval", "renaissance", "industrial", "modern"]
ERA_NAMES = {"ancient": "باستان", "classical": "کلاسیک", "medieval": "قرون وسطی",
             "renaissance": "رنسانس", "industrial": "صنعتی", "modern": "مدرن"}

TECHS = {
    "agriculture":      dict(name="کشاورزی",        cost=20,  req=[], era="ancient"),
    "mining":           dict(name="معدن‌کاری",       cost=20,  req=[], era="ancient"),
    "archery":          dict(name="کمانداری",       cost=25,  req=[], era="ancient"),
    "masonry":          dict(name="سنگ‌تراشی",       cost=30,  req=["mining"], era="ancient"),
    "bronze_working":   dict(name="مفرغ‌کاری",       cost=30,  req=["mining"], era="ancient"),
    "horseback_riding": dict(name="سوارکاری",       cost=35,  req=["agriculture"], era="ancient"),
    "writing":          dict(name="نگارش",          cost=35,  req=["agriculture"], era="ancient"),
    "iron_working":     dict(name="آهنگری",         cost=60,  req=["bronze_working"], era="classical"),
    "mathematics":      dict(name="ریاضیات",        cost=60,  req=["writing"], era="classical"),
    "currency":         dict(name="ضرب سکه",        cost=60,  req=["bronze_working", "writing"], era="classical"),
    "philosophy":       dict(name="فلسفه",          cost=75,  req=["writing"], era="classical"),
    "chivalry":         dict(name="شوالیه‌گری",      cost=120, req=["horseback_riding", "iron_working"], era="medieval"),
    "education":        dict(name="آموزش",          cost=130, req=["philosophy", "mathematics"], era="medieval"),
    "machinery":        dict(name="ماشین‌آلات",      cost=120, req=["mathematics", "iron_working"], era="medieval"),
    "banking":          dict(name="بانکداری",       cost=150, req=["currency", "education"], era="medieval"),
    "gunpowder":        dict(name="باروت",          cost=200, req=["machinery", "education"], era="renaissance"),
    "metallurgy":       dict(name="متالورژی",       cost=240, req=["gunpowder"], era="renaissance"),
    "military_science": dict(name="علوم نظامی",     cost=300, req=["metallurgy", "banking"], era="industrial"),
    "rifling":          dict(name="تفنگ خان‌دار",    cost=320, req=["military_science"], era="industrial"),
    "industrialization": dict(name="صنعتی‌سازی",     cost=340, req=["banking", "metallurgy"], era="industrial"),
    "electricity":      dict(name="الکتریسیته",     cost=450, req=["industrialization"], era="modern"),
    "combustion":       dict(name="موتور احتراقی",  cost=480, req=["industrialization", "rifling"], era="modern"),
    "rocketry":         dict(name="موشک‌سازی",       cost=600, req=["combustion", "electricity"], era="modern"),
    "space_flight":     dict(name="پرواز فضایی",    cost=800, req=["rocketry"], era="modern"),
}

TECH_COST_SCALE = 3.6
for _t in TECHS.values():
    _t["cost"] = int(_t["cost"] * TECH_COST_SCALE)

# ---------------------------------------------------------------- units
# str = melee/defence strength, rng = ranged attack strength, range in tiles
UNITS = {
    "settler":     dict(name="مهاجر",       str=0,  rng=0,  range=0, move=2, prod=24, cost={"wood": 10, "gold": 10}, tech=None, civil=True),
    "warrior":     dict(name="جنگجو",       str=3,  rng=0,  range=0, move=1, prod=8,  cost={"wood": 5},  tech=None),
    "archer":      dict(name="کماندار",     str=2,  rng=4,  range=2, move=1, prod=12, cost={"wood": 10}, tech="archery"),
    "spearman":    dict(name="نیزه‌دار",     str=6,  rng=0,  range=0, move=1, prod=12, cost={"wood": 8, "stone": 4}, tech="bronze_working", anti_mounted=True),
    "horseman":    dict(name="سوار",        str=6,  rng=0,  range=0, move=3, prod=16, cost={"wood": 5, "gold": 10}, tech="horseback_riding", mounted=True),
    "swordsman":   dict(name="شمشیرزن",     str=9,  rng=0,  range=0, move=1, prod=18, cost={"stone": 10, "gold": 5}, tech="iron_working"),
    "catapult":    dict(name="منجنیق",      str=4,  rng=9,  range=2, move=1, prod=22, cost={"wood": 15, "stone": 10}, tech="mathematics", siege=True),
    "knight":      dict(name="شوالیه",      str=13, rng=0,  range=0, move=3, prod=28, cost={"stone": 10, "gold": 20}, tech="chivalry", mounted=True),
    "crossbowman": dict(name="کمان‌پولادی",  str=6,  rng=11, range=2, move=1, prod=22, cost={"wood": 12, "gold": 8}, tech="machinery"),
    "musketman":   dict(name="تفنگدار",     str=18, rng=0,  range=0, move=1, prod=32, cost={"stone": 10, "gold": 20}, tech="gunpowder"),
    "cannon":      dict(name="توپ",         str=8,  rng=20, range=2, move=1, prod=36, cost={"stone": 20, "gold": 20}, tech="metallurgy", siege=True),
    "cavalry":     dict(name="سواره‌نظام",   str=24, rng=0,  range=0, move=3, prod=38, cost={"gold": 30}, tech="military_science", mounted=True),
    "rifleman":    dict(name="تفنگ‌دار مدرن", str=30, rng=0,  range=0, move=1, prod=42, cost={"stone": 15, "gold": 30}, tech="rifling"),
    "artillery":   dict(name="توپخانه",     str=12, rng=34, range=3, move=1, prod=50, cost={"stone": 30, "gold": 30}, tech="industrialization", siege=True),
    "tank":        dict(name="تانک",        str=50, rng=0,  range=0, move=4, prod=70, cost={"stone": 40, "gold": 50}, tech="combustion"),
}

# ---------------------------------------------------------------- buildings
BUILDINGS = {
    "farm":        dict(name="مزرعه",        prod=15,  cost={"wood": 15}, tech="agriculture", food=2),
    "granary":     dict(name="انبار غله",    prod=20,  cost={"wood": 15, "stone": 5}, tech=None),
    "temple":      dict(name="معبد",         prod=25,  cost={"stone": 15}, tech=None, culture=3),
    "quarry":      dict(name="معدن سنگ",     prod=20,  cost={"wood": 15}, tech="mining", stone=3),
    "lumber_mill": dict(name="چوب‌بری",       prod=20,  cost={"wood": 10, "stone": 10}, tech="bronze_working", wood=3),
    "barracks":    dict(name="سربازخانه",    prod=25,  cost={"wood": 20, "stone": 10}, tech="bronze_working"),
    "walls":       dict(name="حصار شهر",     prod=30,  cost={"stone": 30}, tech="masonry"),
    "library":     dict(name="کتابخانه",     prod=30,  cost={"wood": 15, "stone": 15}, tech="writing", science=3),
    "market":      dict(name="بازار",        prod=30,  cost={"wood": 20, "stone": 10}, tech="currency", gold=3),
    "workshop":    dict(name="کارگاه",       prod=40,  cost={"wood": 30, "stone": 20}, tech="mathematics"),
    "university":  dict(name="دانشگاه",      prod=60,  cost={"stone": 30, "gold": 30}, tech="education", science=6),
    "castle":      dict(name="قلعه",         prod=60,  cost={"stone": 50}, tech="chivalry", needs="walls"),
    "bank":        dict(name="بانک",         prod=70,  cost={"stone": 20, "gold": 40}, tech="banking", gold=5),
    "factory":     dict(name="کارخانه",      prod=100, cost={"stone": 60, "gold": 60}, tech="industrialization"),
    "spaceport":   dict(name="پایگاه فضایی (پیروزی علمی)", prod=400, cost={"stone": 150, "gold": 200}, tech="space_flight"),
}

# ---------------------------------------------------------------- personalities
PERSONALITIES = {
    "free":        dict(name="آزاد (تصمیم با خود مدل)", text="شخصیت ثابتی نداری؛ خودت بهترین راهبرد را انتخاب کن."),
    "aggressive":  dict(name="جنگ‌طلب", text="جنگ‌طلب و فاتح هستی؛ قدرت نظامی و فتح شهرهای دیگران برایت اولویت دارد."),
    "scientific":  dict(name="علم‌محور", text="دانش‌دوست هستی؛ پیشرفت علمی و پیروزی فضایی هدف اصلی توست."),
    "expansionist": dict(name="توسعه‌طلب", text="توسعه‌طلب هستی؛ می‌خواهی سریع‌تر از همه زمین و شهر جدید بگیری."),
    "economic":    dict(name="تجاری", text="تاجر و اقتصاددان هستی؛ ثروت، بازار و رشد پایدار را ترجیح می‌دهی."),
    "defensive":   dict(name="محتاط و دفاعی", text="محتاط هستی؛ امنیت مرزها، حصار و ارتش دفاعی قوی برایت مهم است."),
    "diplomatic":  dict(name="دیپلمات", text="دیپلمات هستی؛ با اتحاد، صلح و پیام‌های هوشمندانه بازی را می‌بری."),
    "cultural":    dict(name="فرهنگی", text="فرهنگ‌محور هستی؛ معبد، رشد جمعیت و گسترش مرزهای فرهنگی را دوست داری."),
}

# ---------------------------------------------------------------- names / colors / flags
CIV_NAMES = [
    ("پارسیان", "کوروش"), ("آتلانتیس", "پوسئیدون"), ("سومریان", "گیلگمش"), ("مادها", "دیاکو"),
    ("عیلامیان", "اونتاش"), ("بابلیان", "حمورابی"), ("کارتاژ", "هانیبال"), ("روم", "سزار"),
    ("مصریان", "رامسس"), ("یونانیان", "پریکلس"), ("مغولان", "تموچین"), ("چینیان", "شی هوانگ"),
    ("وایکینگ‌ها", "راگنار"), ("مایاها", "پاکال"), ("اینکاها", "پاچاکوتی"), ("هیتی‌ها", "سوپیلولیوما"),
    ("آشوریان", "آشوربانیپال"), ("سکاها", "تومیریس"), ("اورارتو", "آرگیشتی"), ("ساسانیان", "انوشیروان"),
]

CIV_COLORS = ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa", "#fb8c00",
              "#00acc1", "#d81b60", "#6d4c41", "#eceff1"]

FLAG_PATTERNS = ["tricolor_v", "tricolor_h", "cross", "saltire", "canton", "diagonal", "plain", "chevron", "bicolor_h"]
FLAG_EMBLEMS = ["star", "sun", "crescent", "circle", "diamond", "lion", "tree", "crown", "none"]

CITY_NAMES = [
    "آریا", "تیسفون", "پاسارگاد", "شوش", "اکباتان", "انشان", "هگمتانه", "بیستون", "دارابگرد", "نسا",
    "مرو", "بلخ", "سمرقند", "توس", "ری", "گور", "استخر", "کاشان", "یزد", "سیستان", "اوروک", "نیپور",
    "لاگاش", "ممفیس", "تبس", "آتن", "اسپارت", "کورنت", "قرطاجنه", "صور", "صیدا", "نینوا", "آشور",
    "کالح", "تروا", "میلتوس", "ایلیون", "زاگرس", "البرز", "دماوند", "سهند", "سبلان", "آرارات", "کلات",
    "هیرکانی", "پارت", "باختر", "سغد", "خوارزم", "گرگان", "طبرستان", "دیلم", "آمل", "ساری", "تالش",
    "ماسال", "آستارا", "بندر", "هرمز", "کیش", "لار", "بم", "جیرفت", "کرمان", "ارگ", "سیراف", "مهران",
]

MODEL_LOCAL = "local-bot"


def era_of(techs):
    best = 0
    for t in techs:
        e = ERAS.index(TECHS[t]["era"])
        best = max(best, e)
    return ERAS[best]
