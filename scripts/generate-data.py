#!/usr/bin/env python3
"""Generate a deterministic synthetic lacrosse dataset for the LAXDB demo."""
import json, random, unicodedata
from datetime import date, timedelta

R = random.Random(20261111)

def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-").replace("--", "-")

LEAGUES = [
    {"id": "ncaa-d1", "name": "NCAA Division I", "short": "D1", "level": "College", "type": "field", "country": "USA", "tier": 1, "strength": 1.00},
    {"id": "ncaa-d2", "name": "NCAA Division II", "short": "D2", "level": "College", "type": "field", "country": "USA", "tier": 2, "strength": 0.86},
    {"id": "ncaa-d3", "name": "NCAA Division III", "short": "D3", "level": "College", "type": "field", "country": "USA", "tier": 3, "strength": 0.76},
    {"id": "pll", "name": "Premier Lacrosse League", "short": "PLL", "level": "Professional", "type": "field", "country": "USA", "tier": 1, "strength": 1.24},
    {"id": "nll", "name": "National Lacrosse League", "short": "NLL", "level": "Professional", "type": "box", "country": "USA/CAN", "tier": 1, "strength": 1.20},
    {"id": "prep", "name": "High School & Prep", "short": "HS", "level": "High School", "type": "field", "country": "USA", "tier": 4, "strength": 0.62},
    {"id": "mcla", "name": "MCLA", "short": "MCLA", "level": "College Club", "type": "field", "country": "USA", "tier": 3, "strength": 0.80},
    {"id": "jra", "name": "Junior A Box", "short": "Jr A", "level": "Junior", "type": "box", "country": "CAN", "tier": 2, "strength": 0.88},
    {"id": "world", "name": "World Lacrosse", "short": "WL", "level": "International", "type": "field", "country": "INT", "tier": 1, "strength": 1.14},
]

TEAMS = {
 "ncaa-d1": [
   ("Syracuse Orange","Syracuse","Syracuse, NY","ACC",("#F76900","#000E54")),
   ("Maryland Terrapins","Maryland","College Park, MD","Big Ten",("#E03A3E","#FFD520")),
   ("Duke Blue Devils","Duke","Durham, NC","ACC",("#003087","#FFFFFF")),
   ("Virginia Cavaliers","Virginia","Charlottesville, VA","ACC",("#232D4B","#E57200")),
   ("Notre Dame Fighting Irish","Notre Dame","Notre Dame, IN","ACC",("#0C2340","#C99700")),
   ("Johns Hopkins Blue Jays","Johns Hopkins","Baltimore, MD","Big Ten",("#68ACE5","#002D72")),
   ("Penn State Nittany Lions","Penn State","University Park, PA","Big Ten",("#041E42","#FFFFFF")),
   ("North Carolina Tar Heels","North Carolina","Chapel Hill, NC","ACC",("#4B9CD3","#13294B")),
   ("Yale Bulldogs","Yale","New Haven, CT","Ivy League",("#00356B","#FFFFFF")),
   ("Princeton Tigers","Princeton","Princeton, NJ","Ivy League",("#E77500","#000000")),
   ("Cornell Big Red","Cornell","Ithaca, NY","Ivy League",("#B31B1B","#FFFFFF")),
   ("Denver Pioneers","Denver","Denver, CO","Big East",("#8B2332","#C8A951")),
   ("Georgetown Hoyas","Georgetown","Washington, DC","Big East",("#041E42","#8D817B")),
   ("Rutgers Scarlet Knights","Rutgers","Piscataway, NJ","Big Ten",("#CC0033","#FFFFFF")),
   ("Ohio State Buckeyes","Ohio State","Columbus, OH","Big Ten",("#BB0000","#666666")),
   ("Michigan Wolverines","Michigan","Ann Arbor, MI","Big Ten",("#00274C","#FFCB05")),
   ("Army Black Knights","Army","West Point, NY","Patriot",("#D4BF91","#000000")),
   ("Navy Midshipmen","Navy","Annapolis, MD","Patriot",("#00205B","#C5B783")),
   ("Towson Tigers","Towson","Towson, MD","CAA",("#FFBB00","#000000")),
   ("Richmond Spiders","Richmond","Richmond, VA","Atlantic 10",("#990000","#004B8D")),
   ("Utah Utes","Utah","Salt Lake City, UT","ASUN",("#CC0000","#FFFFFF")),
   ("Loyola Greyhounds","Loyola","Baltimore, MD","Patriot",("#006B3F","#A0A0A0")),
   ("Villanova Wildcats","Villanova","Villanova, PA","Big East",("#00205B","#13B5EA")),
   ("Providence Friars","Providence","Providence, RI","Big East",("#000000","#B2B2B2")),
 ],
 "ncaa-d2": [
   ("Tampa Spartans","Tampa","Tampa, FL","SSC",("#D5A021","#000000")),
   ("Adelphi Panthers","Adelphi","Garden City, NY","NE10",("#F5B301","#000000")),
   ("Le Moyne Dolphins","Le Moyne","Syracuse, NY","NE10",("#004B23","#F2A900")),
   ("Lenoir-Rhyne Bears","Lenoir-Rhyne","Hickory, NC","SAC",("#B30B00","#000000")),
   ("Mercy Mavericks","Mercy","Dobbs Ferry, NY","ECC",("#00539B","#FFFFFF")),
   ("Pace Setters","Pace","Pleasantville, NY","NE10",("#003DA5","#FFC72C")),
   ("Seton Hill Griffins","Seton Hill","Greensburg, PA","PSAC",("#C8102E","#B1B3B3")),
   ("Frostburg State Bobcats","Frostburg State","Frostburg, MD","MEC",("#C8102E","#000000")),
   ("Bentley Falcons","Bentley","Waltham, MA","NE10",("#004B8D","#FFFFFF")),
   ("Saint Anselm Hawks","Saint Anselm","Manchester, NH","NE10",("#002F6C","#A2A2A0")),
 ],
 "ncaa-d3": [
   ("Salisbury Sea Gulls","Salisbury","Salisbury, MD","C2C",("#83001B","#FFC72C")),
   ("RIT Tigers","RIT","Rochester, NY","Liberty",("#F76900","#000000")),
   ("Tufts Jumbos","Tufts","Medford, MA","NESCAC",("#3E8EDE","#FFFFFF")),
   ("Amherst Mammoths","Amherst","Amherst, MA","NESCAC",("#3F1E6E","#FFFFFF")),
   ("Middlebury Panthers","Middlebury","Middlebury, VT","NESCAC",("#0D2C54","#FFFFFF")),
   ("Wesleyan Cardinals","Wesleyan","Middletown, CT","NESCAC",("#A6192E","#000000")),
   ("York Spartans","York","York, PA","MAC",("#00573F","#FFFFFF")),
   ("Stevenson Mustangs","Stevenson","Owings Mills, MD","MAC",("#00539B","#C8A951")),
   ("Christopher Newport Captains","Christopher Newport","Newport News, VA","C2C",("#003DA5","#A2A2A0")),
   ("Denison Big Red","Denison","Granville, OH","NCAC",("#C8102E","#FFFFFF")),
   ("Gettysburg Bullets","Gettysburg","Gettysburg, PA","Centennial",("#F26522","#000000")),
   ("Lynchburg Hornets","Lynchburg","Lynchburg, VA","ODAC",("#C8102E","#000000")),
 ],
 "pll": [
   ("Utah Archers","Archers","Salt Lake City, UT","PLL",("#00A3AD","#000000")),
   ("Maryland Whipsnakes","Whipsnakes","Baltimore, MD","PLL",("#1D2A57","#C8A951")),
   ("California Redwoods","Redwoods","San Jose, CA","PLL",("#1B5E20","#C8A951")),
   ("Philadelphia Waterdogs","Waterdogs","Philadelphia, PA","PLL",("#0A3D62","#F5C518")),
   ("New York Atlas","Atlas","New York, NY","PLL",("#00205B","#E63946")),
   ("Denver Outlaws","Outlaws","Denver, CO","PLL",("#111111","#F47B20")),
   ("Boston Cannons","Cannons","Boston, MA","PLL",("#012169","#C8102E")),
   ("Carolina Chaos","Chaos","Charlotte, NC","PLL",("#7A1FA2","#000000")),
 ],
 "nll": [
   ("Buffalo Bandits","Bandits","Buffalo, NY","NLL",("#F47B20","#000000")),
   ("Toronto Rock","Rock","Toronto, ON","NLL",("#00539B","#FFFFFF")),
   ("Halifax Thunderbirds","Thunderbirds","Halifax, NS","NLL",("#1B1B1B","#00A3AD")),
   ("Georgia Swarm","Swarm","Duluth, GA","NLL",("#0C2340","#FFC72C")),
   ("Albany FireWolves","FireWolves","Albany, NY","NLL",("#C8102E","#F47B20")),
   ("Colorado Mammoth","Mammoth","Denver, CO","NLL",("#6B2C91","#C8A951")),
   ("Saskatchewan Rush","Rush","Saskatoon, SK","NLL",("#0C2340","#8A8D8F")),
   ("Calgary Roughnecks","Roughnecks","Calgary, AB","NLL",("#C8102E","#111111")),
   ("Philadelphia Wings","Wings","Philadelphia, PA","NLL",("#00205B","#C8A951")),
   ("San Diego Seals","Seals","San Diego, CA","NLL",("#0C2340","#00A3AD")),
 ],
 "prep": [
   ("Boys' Latin Lakers","Boys' Latin","Baltimore, MD","MIAA A",("#1E3A8A","#C8A951")),
   ("McDonogh Eagles","McDonogh","Owings Mills, MD","MIAA A",("#0F2C5A","#F47B20")),
   ("Calvert Hall Cardinals","Calvert Hall","Towson, MD","MIAA A",("#7A0019","#C8A951")),
   ("St. Paul's Crusaders","St. Paul's","Brooklandville, MD","MIAA A",("#002B5C","#FFFFFF")),
   ("Haverford School Fords","Haverford","Haverford, PA","Inter-Ac",("#7A0019","#0F2C5A")),
   ("Malvern Prep Friars","Malvern Prep","Malvern, PA","Inter-Ac",("#0B2A50","#C8A951")),
   ("Brunswick Bruins","Brunswick","Greenwich, CT","NE West",("#0B3D2E","#C8A951")),
   ("Darien Blue Wave","Darien","Darien, CT","FCIAC",("#002B5C","#4B9CD3")),
   ("Chaminade Flyers","Chaminade","Mineola, NY","CHSAA",("#7A0019","#C8A951")),
   ("St. Anthony's Friars","St. Anthony's","Melville, NY","CHSAA",("#6B2C91","#C8A951")),
   ("Delbarton Green Wave","Delbarton","Morristown, NJ","NJISAA",("#00573F","#FFFFFF")),
   ("Seton Hall Prep Pirates","Seton Hall Prep","West Orange, NJ","NJISAA",("#00205B","#FFFFFF")),
   ("Culver Military Eagles","Culver Academy","Culver, IN","Independent",("#7A0019","#0F2A44")),
   ("Salisbury School Knights","Salisbury School","Salisbury, CT","NE West",("#8C1D18","#1A1A1A")),
   ("Deerfield Big Green","Deerfield","Deerfield, MA","NE West",("#00693E","#FFFFFF")),
   ("Taft Rhinos","Taft","Watertown, CT","NE West",("#00205B","#FFFFFF")),
   ("Massapequa Chiefs","Massapequa","Massapequa, NY","Nassau",("#C8102E","#000000")),
   ("Garden City Trojans","Garden City","Garden City, NY","Nassau",("#002B5C","#C8A951")),
   ("Ward Melville Patriots","Ward Melville","East Setauket, NY","Suffolk",("#00573F","#FFFFFF")),
   ("Manhasset Indians","Manhasset","Manhasset, NY","Nassau",("#7A0019","#000000")),
 ],
 "mcla": [
   ("Michigan State Spartans","Michigan State","East Lansing, MI","CCLA",("#18453B","#FFFFFF")),
   ("BYU Cougars","BYU","Provo, UT","RMLC",("#002E5D","#FFFFFF")),
   ("Chapman Panthers","Chapman","Orange, CA","SLC",("#A6192E","#000000")),
   ("Virginia Tech Hokies","Virginia Tech","Blacksburg, VA","ALC",("#630031","#CF4420")),
   ("Colorado Buffaloes","Colorado","Boulder, CO","RMLC",("#0C2340","#C8A951")),
   ("Boston College Eagles","Boston College","Chestnut Hill, MA","PCLL",("#8C2232","#C8A951")),
 ],
 "jra": [
   ("Orangeville Northmen","Orangeville","Orangeville, ON","OJLL",("#0B5D3B","#C8A951")),
   ("Six Nations Arrows","Six Nations","Ohsweken, ON","OJLL",("#7A0019","#000000")),
   ("Peterborough Lakers","Peterborough","Peterborough, ON","OJLL",("#00205B","#C8A951")),
   ("Whitby Warriors","Whitby","Whitby, ON","OJLL",("#1D2A57","#C8102E")),
   ("Coquitlam Adanacs","Coquitlam","Coquitlam, BC","BCJALL",("#00573F","#C8A951")),
   ("New Westminster Salmonbellies","New Westminster","New Westminster, BC","BCJALL",("#7A0019","#C8A951")),
   ("Victoria Shamrocks","Victoria","Victoria, BC","BCJALL",("#00573F","#FFFFFF")),
   ("St. Catharines Athletics","St. Catharines","St. Catharines, ON","OJLL",("#0C2340","#F47B20")),
 ],
 "world": [
   ("United States","USA","Baltimore, MD","World Lacrosse",("#00205B","#C8102E")),
   ("Canada","Canada","Toronto, ON","World Lacrosse",("#C8102E","#FFFFFF")),
   ("Iroquois Nationals","Iroquois","Six Nations, ON","World Lacrosse",("#6B2C91","#C8A951")),
   ("Australia","Australia","Melbourne, AU","World Lacrosse",("#00573F","#FFC72C")),
   ("England","England","Manchester, UK","World Lacrosse",("#C8102E","#FFFFFF")),
 ],
}

CONF = {"ACC":"Atlantic Coast","Big Ten":"Big Ten","Ivy League":"Ivy League","Big East":"Big East","Patriot":"Patriot League","CAA":"Coastal Athletic","Atlantic 10":"Atlantic 10","ASUN":"ASUN","SSC":"Sunshine State","NE10":"Northeast-10","SAC":"South Atlantic","ECC":"East Coast","PSAC":"PSAC","MEC":"Mountain East","C2C":"Coast-to-Coast","Liberty":"Liberty League","NESCAC":"NESCAC","MAC":"MAC Commonwealth","NCAC":"NCAC","Centennial":"Centennial","ODAC":"ODAC","MIAA A":"MIAA A","Inter-Ac":"Inter-Ac","NE West":"NE West","FCIAC":"FCIAC","CHSAA":"CHSAA","NJISAA":"NJISAA","Nassau":"Nassau County","Suffolk":"Suffolk County","Independent":"Independent","CCLA":"CCLA","RMLC":"RMLC","SLC":"SLC","ALC":"ALC","PCLL":"PCLL","OJLL":"OJLL","BCJALL":"BCJALL"}

FIRST = "Jack Ryan Connor Liam Owen Cole Brayden Griffin Finn Declan Chase Tyler Dylan Evan Luke Miles Nate Aidan Brady Cameron Grant Holden Jake Keegan Logan Mason Nolan Parker Quinn Reid Ryder Sean Tanner Trevor Will Zach Ben Sam Max Charlie Harry Teddy Nick Matt Chris Anthony Mike Joe Dan Pat Brendan Colin Shane Kyle Justin Eric Adam Josh Caleb Devin Gavin Landon Paxton Ronan Sullivan Wells Banks Brooks Duke Stone Tripp".split()
LAST = """McCambridge Kelly Sullivan O'Brien Murphy Brennan Gallagher Callahan Donnelly Fitzgerald Flanagan Hayes Keane Lynch Mahoney Nolan Quinn Reilly Shea Walsh Burke Byrne Casey Doyle Egan Farrell Grady Hogan Kavanagh Keating Loughlin Malone Moran O'Neill Rafferty Ryan Scanlon Tierney Boyle Cassidy Delaney Finnerty Hanley Joyce Kearney Kelleher Leahy McGuire McKenna Molloy Mulcahy O'Connell O'Donnell O'Rourke Powers Prendergast Quinlan Regan Rooney Shanahan Sheridan Sweeney Tobin Tully Vaughan Whelan Whitney Andersen Bergeron Bouchard Caron Desjardins Dubois Fortin Gagnon Gauthier Girard Lachance Lamoureux Lapointe Leblanc Lemieux Marchand Morin Ouellet Pelletier Poirier Ranger Roy Savard Thibault Tremblay Vachon Beaulieu Charbonneau Cloutier Dufresne Fontaine Fournier Grenier Hebert Joyal Laflamme Langlois Martel Nadeau Paquette Ricard Rousseau Simard Soucy Tessier Turcotte Vaillancourt""".split()

CITIES = [
 ("Baltimore","MD","USA"),("Towson","MD","USA"),("Bethesda","MD","USA"),("Annapolis","MD","USA"),
 ("Syracuse","NY","USA"),("Garden City","NY","USA"),("Manhasset","NY","USA"),("Smithtown","NY","USA"),
 ("Setauket","NY","USA"),("Rochester","NY","USA"),("Buffalo","NY","USA"),("Albany","NY","USA"),
 ("Princeton","NJ","USA"),("Summit","NJ","USA"),("Ridgewood","NJ","USA"),("Mountain Lakes","NJ","USA"),
 ("Philadelphia","PA","USA"),("Malvern","PA","USA"),("Radnor","PA","USA"),("Pittsburgh","PA","USA"),
 ("Boston","MA","USA"),("Medfield","MA","USA"),("Duxbury","MA","USA"),("Concord","MA","USA"),
 ("Greenwich","CT","USA"),("Darien","CT","USA"),("New Canaan","CT","USA"),("Wilton","CT","USA"),
 ("Denver","CO","USA"),("Littleton","CO","USA"),("Charlotte","NC","USA"),("Raleigh","NC","USA"),
 ("Atlanta","GA","USA"),("Dallas","TX","USA"),("Austin","TX","USA"),("San Diego","CA","USA"),
 ("Orange County","CA","USA"),("Portland","OR","USA"),("Seattle","WA","USA"),("Chicago","IL","USA"),
 ("Columbus","OH","USA"),("Cincinnati","OH","USA"),("Washington","DC","USA"),("Richmond","VA","USA"),
 ("Toronto","ON","CAN"),("Orangeville","ON","CAN"),("Peterborough","ON","CAN"),("Whitby","ON","CAN"),
 ("Six Nations","ON","CAN"),("Victoria","BC","CAN"),("Coquitlam","BC","CAN"),("Calgary","AB","CAN"),
]

POSITIONS = [
 ("A","Attack"),("M","Midfield"),("D","Defense"),("G","Goalie"),("FO","Faceoff"),("LSM","LSM"),
]

# per-position base profile: (g_base, a_base, gb_base, ct_base, sh_per_g)
PROFILE = {
 "A":  dict(g=30, a=17, gb=32, ct=4, to=22, sh=2.9, fo=0),
 "M":  dict(g=18, a=13, gb=42, ct=8, to=18, sh=3.1, fo=0),
 "D":  dict(g=4,  a=4,  gb=48, ct=26, to=13, sh=4.5, fo=0),
 "LSM":dict(g=3,  a=6,  gb=56, ct=22, to=12, sh=4.2, fo=0),
 "FO": dict(g=9,  a=7,  gb=38, ct=5, to=12, sh=3.6, fo=0.57),
 "G":  dict(g=0,  a=1,  gb=32, ct=2, to=6, sh=0, fo=0),
}

AWARDS = {
 "A": ["First Team All-American","Second Team All-American","Honorable Mention All-American","Conference Player of the Year","Tewaaraton Nominee","Rookie of the Year","First Team All-Conference"],
 "M": ["First Team All-American","Second Team All-American","Honorable Mention All-American","First Team All-Conference","Second Team All-Conference","Academic All-Conference"],
 "D": ["First Team All-American","Second Team All-American","Defensive Player of the Year","First Team All-Conference","Honorable Mention All-American"],
 "LSM":["First Team All-American","Specialist of the Year","First Team All-Conference","Honorable Mention All-American"],
 "FO": ["Faceoff Specialist of the Year","First Team All-American","Second Team All-American","First Team All-Conference"],
 "G":  ["Kelly Award Finalist","First Team All-American","Second Team All-American","Goalkeeper of the Year","First Team All-Conference"],
}

REPORTS = [
 "Elite off-ball mover who reads the slide before it happens. Release is compact and repeatable from any arm angle, and he finishes through contact at the crease.",
 "Two-way midfielder with a Division I frame. Wins his matchup in the middle of the field, pushes transition with a head up, and never forces the extra pass.",
 "Prototypical cover defender: low hips, active stick, and a first step that closes gaps before the dodge starts. Clears cleanly on the break.",
 "Pure shooter's touch. Sets his feet early, hides the release behind a screen, and has the range to punish a lazy approach from 12 yards out.",
 "Faceoff specialist with a quick clamp and a strong counter. Wins the ball forward, and the wing play is already organized before the whistle.",
 "Patient, positional goalkeeper. Sets the angle early, absorbs low shots, and triggers the break with an accurate outlet to the far hash.",
 "Grounded, high-motor attackman. Does the unglamorous work on the ride, and his two-man game with the lefty wing is the engine of the offense.",
 "Long, rangy defender who covers ground in the open field. Best in a matchup role, and his stick work in tight spaces has improved every season.",
 "Downhill dodger with a burst that turns a settled possession into a numbers advantage. Finishes high and draws the slide at a high rate.",
 "Elite lacrosse IQ. Plays a step ahead of the defense, finds cutters through traffic, and is the guy his teammates want the ball in the hands of late.",
]

BIO = [
 "Grew up in a lacrosse family and picked up a stick before he could read. Started on varsity as a freshman and never gave the spot back.",
 "Multi-sport athlete who also played quarterback in high school. Credits his football background for his vision and his ability to read pressure.",
 "A late bloomer who added four inches and twenty pounds between his junior and senior year. Recruited late, and has been proving people wrong since.",
 "Three-sport captain in high school. Known around the program as the first one in the weight room and the last one off the practice field.",
 "Played club ball for one of the top summer programs in the country, and has been a fixture on the recruiting circuit since eighth grade.",
 "Transferred in after two seasons, and immediately became a locker-room leader. Brings a physical edge that shows up in the ground-ball numbers.",
]

def poisson_clamp(lam, lo, hi):
    return max(lo, min(hi, int(R.gauss(lam, max(1.0, lam * 0.28)))))

def make_seasons(player, level, team_ids, start_year, end_year, strength):
    seasons = []
    pos = player["position"]
    prof = PROFILE[pos]
    peak = R.uniform(0.75, 1.05)
    for i, year in enumerate(range(start_year, end_year + 1)):
        team_id = team_ids[min(i, len(team_ids) - 1)]
        # development curve: rises toward the last seasons
        curve = 0.72 + 0.28 * (i / max(1, len(range(start_year, end_year + 1)) - 1)) * peak
        gp = poisson_clamp(16 if level in ("College","College Club") else 14, 8, 20)
        if pos == "G":
            gs = gp - R.randint(0, 2)
            mins = int(gp * R.uniform(52, 60))
            ga = int(mins / 60 * R.uniform(9.0, 12.5) / max(0.8, strength))
            sv = int(ga * R.uniform(1.05, 1.45))
            row = dict(gp=gp, gs=gs, g=0, a=poisson_clamp(0.4, 0, 3), pts=None,
                       sh=0, gb=poisson_clamp(prof["gb"] * curve * 0.6, 4, 60),
                       to=poisson_clamp(prof["to"] * 0.5, 1, 12), ct=poisson_clamp(2, 0, 5),
                       foW=0, foA=0, pen=R.randint(0, 6), min=mins, ga=ga, sv=sv,
                       w=R.randint(int(gp*0.3), int(gp*0.8)), l=0)
            row["l"] = max(0, gp - row["w"] - R.randint(0, 2))
        else:
            g = poisson_clamp(prof["g"] * curve * strength * R.uniform(0.8, 1.2), 0, 70)
            a = poisson_clamp(prof["a"] * curve * strength * R.uniform(0.8, 1.2), 0, 60)
            sh = int(g * prof["sh"] * R.uniform(0.85, 1.2)) if g else 0
            foW = foA = 0
            if pos == "FO":
                foA = int(gp * R.uniform(14, 22))
                foW = int(foA * R.uniform(0.47, 0.64))
            row = dict(gp=gp, gs=gp - R.randint(0, 3), g=g, a=a, pts=g + a, sh=sh,
                       gb=poisson_clamp(prof["gb"] * curve, 0, 110),
                       to=poisson_clamp(prof["to"] * curve, 0, 45),
                       ct=poisson_clamp(prof["ct"] * curve, 0, 55),
                       foW=foW, foA=foA, pen=R.randint(0, 18), min=0, ga=0, sv=0, w=0, l=0)
        seasons.append(dict(season=str(year), teamId=team_id, leagueId=None, type="regular", **row))
    return seasons

players = []
used = set()
pid = 0

def pick_identity():
    while True:
        fn = R.choice(FIRST); ln = R.choice(LAST)
        if (fn, ln) not in used:
            used.add((fn, ln)); return fn, ln

# build team id map
team_records = {}
team_ids_by_league = {}
for lid, rows in TEAMS.items():
    ids = []
    for name, short, city, conf, colors in rows:
        tid = "t-" + slugify(name)
        team_records[tid] = dict(id=tid, name=name, shortName=short, slug=slugify(name),
                                 leagueId=lid, city=city, conference=CONF.get(conf, conf),
                                 colors=list(colors), cityName=city.split(",")[0],
                                 region=city.split(",")[1].strip() if "," in city else "")
        ids.append(tid)
    team_ids_by_league[lid] = ids

# league rosters: number of players per league
COUNTS = {"ncaa-d1": 96, "ncaa-d2": 34, "ncaa-d3": 38, "pll": 26, "nll": 22,
          "prep": 40, "mcla": 16, "jra": 16, "world": 12}

for lid, count in COUNTS.items():
    league = next(l for l in LEAGUES if l["id"] == lid)
    tids = team_ids_by_league[lid]
    for _ in range(count):
        pid += 1
        fn, ln = pick_identity()
        name = f"{fn} {ln}"
        pos, posname = R.choices(POSITIONS, weights=[28, 26, 20, 10, 8, 8])[0]
        city, state, country = R.choice(CITIES)
        if country == "CAN" and lid not in ("nll", "jra", "pll", "world"):
            city, state, country = R.choice([c for c in CITIES if c[2] == "USA"])
        # age / class year by league
        if league["level"] in ("College", "College Club"):
            class_year = R.choice([2026, 2026, 2027, 2028, 2029])
            grad = class_year
            dob_year = class_year - 22
        elif league["level"] == "High School":
            class_year = R.choice([2027, 2027, 2028, 2029, 2030])
            grad = class_year
            dob_year = class_year - 18
        elif league["level"] in ("Professional",):
            class_year = None
            grad = R.randint(2016, 2023)
            dob_year = grad - 23
        elif league["level"] == "Junior":
            class_year = None
            grad = R.randint(2019, 2025)
            dob_year = grad - 18
        else:
            class_year = None; grad = R.randint(2015, 2022); dob_year = grad - 18
        dob = date(dob_year, R.randint(1, 12), R.randint(1, 28))
        height = R.choice([70, 71, 71, 72, 72, 73, 73, 74, 75, 76, 77])
        weight = max(150, min(245, int(round(height * R.uniform(2.35, 2.65)))))
        team_id = R.choice(tids)
        jersey = R.choice([x for x in range(1, 45) if x not in (13,)])

        # career span
        if league["level"] in ("College", "College Club"):
            start, end = 2026 - (class_year - 2026) - 3, 2026
            start = max(2022, start)
        elif league["level"] == "High School":
            start, end = 2026 - (class_year - 2026) - 3, 2026
            start = max(2022, start)
        elif league["level"] == "Professional":
            start, end = max(2021, dob_year + 22), 2026
        elif league["level"] == "Junior":
            start, end = max(2019, dob_year + 16), 2025
        else:
            start, end = 2022, 2026

        # some players switched teams (transfer / trade)
        n_teams = 1 if R.random() < 0.72 else 2
        pteams = [team_id]
        if n_teams == 2:
            alt = R.choice([t for t in tids if t != team_id])
            pteams = [alt, team_id]
        seasons = make_seasons({"position": pos}, league["level"], pteams, min(start, end), end, league["strength"])
        for s in seasons:
            s["leagueId"] = lid
        cur = seasons[-1]

        # awards
        awards = []
        for s in seasons[-3:]:
            if R.random() < 0.45:
                awards.append(dict(year=int(s["season"]), title=R.choice(AWARDS[pos]),
                                   team=team_records[s["teamId"]]["shortName"]))
        # rankings
        rankings = []
        if class_year and R.random() < 0.7:
            rankings.append(dict(source="Inside Lacrosse", label=f"IL Top 100 · Class of {class_year}",
                                 rank=R.randint(1, 100), year=class_year - 1))
        if league["level"] in ("Professional",) or (class_year and R.random() < 0.35):
            rk = R.randint(1, 60)
            rankings.append(dict(source="PLL Draft", label="PLL College Draft Board", rank=rk,
                                 year=min(2026, dob_year + 22)))
        # draft
        draft = None
        if league["level"] == "Professional" or (class_year and R.random() < 0.25):
            draft = dict(league=R.choice(["PLL", "NLL"]), year=min(2026, dob_year + 22),
                         round=max(1, min(8, (R.randint(1, 80) // 8) + 1)),
                         pick=R.randint(1, 8), team=R.choice([team_records[t]["shortName"] for t in team_ids_by_league[R.choice(["pll","nll"])]]))
        # commitment for HS
        commit = None
        if league["level"] == "High School" and R.random() < 0.75:
            d1 = [team_records[t]["name"] for t in team_ids_by_league["ncaa-d1"]]
            commit = dict(college=R.choice(d1), year=class_year)

        grades = {}
        for k, base in [("Shooting", 60), ("Feeding", 58), ("Dodging", 60), ("Defense", 55),
                        ("Ground Balls", 60), ("Lacrosse IQ", 64), ("Speed", 62), ("Strength", 58)]:
            adj = {"A": {"Shooting": 18, "Dodging": 14, "Defense": -12, "Feeding": 8},
                   "M": {"Shooting": 6, "Defense": 2, "Ground Balls": 8},
                   "D": {"Shooting": -22, "Defense": 22, "Ground Balls": 10, "Dodging": -10},
                   "LSM": {"Shooting": -20, "Defense": 18, "Ground Balls": 14, "Speed": 6},
                   "FO": {"Shooting": -14, "Ground Balls": 12, "Strength": 12, "Dodging": -8},
                   "G": {"Shooting": -30, "Defense": 6, "Feeding": -24, "Dodging": -26, "Lacrosse IQ": 8}}[pos].get(k, 0)
            grades[k] = max(40, min(99, int(R.gauss(base + adj + league["strength"] * 10, 7))))

        # game log (current season, last 8)
        games = []
        d = date(2026, 4, 25)
        opp_pool = [team_records[t]["shortName"] for t in tids if t != team_id]
        for i in range(8):
            gd = d - timedelta(days=7 * i)
            if pos == "G":
                games.append(dict(date=gd.isoformat(), opponent=R.choice(opp_pool),
                                  result=R.choice(["W", "W", "L"]), g=0, a=0, gb=R.randint(1, 5),
                                  ct=R.randint(0, 1), sv=R.randint(6, 19), ga=R.randint(5, 15),
                                  foW=0, foA=0))
            else:
                games.append(dict(date=gd.isoformat(), opponent=R.choice(opp_pool),
                                  result=R.choice(["W", "W", "W", "L"]),
                                  g=max(0, R.randint(0, max(1, cur["g"] // 6 * 2))),
                                  a=max(0, R.randint(0, max(1, cur["a"] // 6 * 2))),
                                  gb=R.randint(0, max(1, cur["gb"] // 5)),
                                  ct=R.randint(0, max(1, cur["ct"] // 5)),
                                  sv=None, ga=None, foW=cur["foW"] // 8 if cur["foA"] else 0,
                                  foA=cur["foA"] // 8 if cur["foA"] else 0))
        games.sort(key=lambda x: x["date"], reverse=True)

        players.append(dict(
            id=f"p-{pid:04d}", slug=slugify(name), firstName=fn, lastName=ln, name=name,
            position=pos, positionName=posname, hand=R.choice(["R", "R", "L"]),
            heightIn=height, weightLb=weight, dob=dob.isoformat(),
            birthplace=dict(city=city, state=state, country=country),
            classYear=class_year, gradYear=grad,
            highSchool=team_records[team_id]["name"] if league["level"] == "High School" else R.choice(TEAMS["prep"])[0],
            teamId=team_id, leagueId=lid, jersey=jersey,
            status=R.choice(["Active", "Active", "Active", "Injured Reserve"]),
            commit=commit, draft=draft, rankings=rankings, awards=awards,
            scouting=dict(report=R.choice(REPORTS), author=R.choice(["LAXDB Scouting", "LAXDB Scouting", "Eastern Scouting Desk"]),
                          date="2026-10-28", grades=grades),
            bio=R.choice(BIO), seasons=seasons, games=games,
            strengths=R.sample(["transition offense","two-man game","off-ball cutting","wing play","stick work in tight spaces","rides and clears","man-down defense","faceoff counter moves"], 3),
        ))

# clean nulls on pts
for p in players:
    for s in p["seasons"]:
        if s.get("pts") is None:
            s["pts"] = None

dataset = dict(
    meta=dict(generated="2026-11-11", dataset="LAXDB sample data (synthetic)", season="2026"),
    leagues=LEAGUES,
    teams=sorted(team_records.values(), key=lambda t: t["name"]),
    players=players,
)

out = "/opt/data/projects/laxdb/src/data/dataset.json"
with open(out, "w") as f:
    json.dump(dataset, f, separators=(",", ":"))
print("players", len(players), "teams", len(team_records), "bytes", len(open(out).read()))
