import json, requests
API = json.load(open("site/api.json"))["api"]
r = requests.get(f"{API}/api/quotes?t=KO,MSFT,JPM", headers={"Origin": "https://jash-financebro.github.io"}, timeout=60)
d = r.json()
print(f"::notice::status {r.status_code} spy points {len(d.get('spy', []))}")
for q in d.get("quotes", []):
    print(f"::notice::{q['ticker']} price {q.get('price')} pe {q.get('pe')} yield {q.get('div_yield')} beta {q.get('beta')} mcap {q.get('market_cap')} closes {len(q.get('closes') or [])} sector {q.get('sector')}")
# rerun 1795557654
# rerun 1795557790
