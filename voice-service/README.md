# voice-service/ — owner: Allison

Python FastAPI service on port 8002. Serves `POST /api/voice/ask` per root `CLAUDE.md`.
Put `XAI_API_KEY` in `voice-service/.env` (never commit it). Optional: `XAI_MODEL` (default `grok-4-fast`).

## Run

```sh
cd voice-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then paste your key
uvicorn main:app --port 8002 --reload
```

Without a key the service still answers, using a canned summary built from the plane data
(so the demo never dies). `GET /api/voice/health` shows whether a key is loaded.

## Test with curl

Full plane object (what the web app sends):

```sh
curl -s localhost:8002/api/voice/ask -H 'content-type: application/json' -d '{
  "question": "what plane is that?",
  "plane": {"id":"a4f2c1","callsign":"DAL591","typeCode":"B752","typeName":"Boeing 757-200",
            "airline":"Delta Air Lines","origin":"LAS","destination":"ATL","lat":33.7,"lon":-84.4,
            "altitudeFt":5525,"groundSpeedKt":230,"trackDeg":90,"distanceKm":8.15,"bearingDeg":182.3,
            "offsetDeg":-22,"kind":"plane","onGround":false,"category":"A4",
            "emergency":null,"military":false,"medical":false}
}'
```

Shortcut: just an id or callsign, resolved from `shared/fixtures/demo-planes.json`
(try `GRDIAN1` for a medical helicopter, `DAL2948` for a plane on the ground):

```sh
curl -s localhost:8002/api/voice/ask -H 'content-type: application/json' \
  -d '{"question": "where is it going?", "planeId": "DAL591"}'
```

No plane in view:

```sh
curl -s localhost:8002/api/voice/ask -H 'content-type: application/json' \
  -d '{"question": "how many seats does an A321 have?", "plane": null}'
```
