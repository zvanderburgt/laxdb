
import urllib.request, json, itertools
TICKET = "fU_rm53D63lmNIltP4TEdIz6rU7v1LWJYiLe1RHHogxKVQYNfjhP4SPyLQ8J"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
URLS = [
 "https://web.api.digitalshift.ca/partials/stats/filters?type=league",
 "https://web.api.digitalshift.ca/partials/stats/players?league_id=188",
]
SHAPES = [
 ("Authorization", f"Bearer {TICKET}"),
 ("authorization", TICKET),
 ("X-Website-Ticket", TICKET),
 ("X-Api-Ticket", TICKET),
 ("ticket", TICKET),
 ("Cookie", f"website_api_ticket={TICKET}"),
 ("X-Ticket", TICKET),
]
def go(url, hdrs):
    h = {"User-Agent": UA, "Accept": "application/json, text/plain, */*",
         "Origin": "https://www.canadianlacrosseleague.com",
         "Referer": "https://www.canadianlacrosseleague.com/stats"}
    h.update(hdrs)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=20) as r:
            return r.getcode(), r.read()[:120]
    except Exception as e:
        return getattr(e, "code", 0), str(e)[:60].encode()
for url in URLS:
    for name, val in SHAPES:
        code, body = go(url, {name: val})
        if code == 200:
            print("OK  ", name, url[-52:], body[:100])
            break
    else:
        print("none", url[-52:])
