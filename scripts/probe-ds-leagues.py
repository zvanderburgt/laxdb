
import urllib.request, re
UA={"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"}
sites=["https://www.wcjll.com","https://www.rmll.ca","https://www.tojll.com","https://www.pnwjll.com","https://www.bcjall.com","https://www.canadianlacrosseleague.com"]
pat=re.compile(r"""https?://[^"'\s]*(?:digitalshift|league_id)[^"'\s]*""")
for s in sites:
    try:
        with urllib.request.urlopen(urllib.request.Request(s, headers=UA), timeout=25) as r:
            body=r.read().decode("utf-8","ignore"); code=r.getcode()
    except Exception as e:
        print(s, "ERR", str(e)[:60]); continue
    low=body.lower()
    print(f"{s:<38}{code} {len(body):>7}b digitalshift={low.count('digitalshift')} league_id={low.count('league_id')} gamesheet={low.count('gamesheet')}")
    for h in pat.findall(body)[:2]:
        print("     ", h[:120])
