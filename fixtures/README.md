# Recorded responses

`recorded.json` holds the answers the mock client replays when there is no API key.

The file in the repository was written by hand to match `data/sample_leads.csv`, so the app runs
out of the box. To replace it with real model output, set `ANTHROPIC_API_KEY` in `.env` and run:

```
npm run record
```

Anything that is not in this file gets no answer in mock mode. The app then marks it for manual
review, which is the same path a real provider outage takes.
