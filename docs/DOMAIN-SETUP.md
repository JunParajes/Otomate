# Domain, HTTPS and the dynamic IP

How Otomate is reached from outside the shop, and why it is built this way.

## The problem this solves

The server sits on a residential line with a **dynamic public IP**. It has already
changed at least three times in a week — a blackout reboots the router and the
address moves. That has broken things twice: bookmarks stopped working, and the
GitHub Actions deploy failed because `SERVER_HOST` held a stale address.

Two separate needs, solved two different ways:

| Need | Solution | Why |
|------|----------|-----|
| Reach the **app** over HTTPS | **Cloudflare Tunnel** | Outbound connection, so the IP is irrelevant |
| Reach the **server over SSH** for deploys | DNS record + updater | GitHub Actions needs a stable hostname |

---

## Part 1 — Cloudflare Tunnel (the app)

The server dials **out** to Cloudflare and holds the connection open. Traffic
arrives back down that tunnel.

```
browser → https://otomate.uk        →  Cloudflare edge (TLS terminates here)
                                          →  tunnel (outbound, already open)
                                          →  cloudflared container
                                          →  traefik:80  →  web / api
```

What this buys, specifically for this setup:

- **A changing IP stops mattering.** Nothing points at the address.
- **No router configuration.** No port forwarding at all.
- **No exposure to an ISP blocking inbound port 80**, common on residential lines.
- **Free TLS**, issued and renewed by Cloudflare.
- **Zero inbound ports.** Port 80 forwarding can be removed entirely afterwards,
  which takes the home network's only inbound web exposure to nothing.

The trade-off: if Cloudflare is down, the app is unreachable from outside. LAN
access is deliberately kept for exactly this reason (see Part 3).

### Steps

**1. Create the tunnel** — Cloudflare dashboard → *Zero Trust* → *Networks* →
*Tunnels* → **Create a tunnel** → type **Cloudflared** → name it `otomate`.

**2. Copy the token.** Cloudflare shows an install command containing a long
token. Copy only the token.

**3. Put it on the server** — as `jun`, on the server:

```bash
cd ~/otomate
printf 'TUNNEL_TOKEN=%s\n' 'PASTE_THE_TOKEN_HERE' >> .env
chmod 600 .env
```

> Quote it exactly as above. Values in this `.env` are **not** shell-quoted, and a
> `$` in an unquoted value gets expanded by anything that sources the file — the
> same trap documented in CONVENTIONS.md.

**4. Add the public hostname** — in the tunnel's *Public Hostname* tab:

| Field | Value |
|-------|-------|
| Subdomain | *(leave blank — the bare domain)* |
| Domain | `otomate.uk` |
| Service type | **HTTP** |
| URL | `traefik:80` |

`traefik:80` is a Docker network address — `cloudflared` runs on `otomate-net`
alongside Traefik, so it resolves. It is not reachable from anywhere else.

**5. Deploy.** Push to `main`, or on the server:

```bash
cd ~/otomate && docker compose -f docker-compose.prod.yml up -d
```

**6. Verify.**

```bash
docker compose -f docker-compose.prod.yml logs cloudflared --tail 20   # expect "Registered tunnel connection"
curl -sI https://otomate.uk | head -3                        # expect 200
```

**7. Then close the router's port 80 forward.** Nothing needs it any more, and
removing it is the security win.

### If the token is missing

`cloudflared` restart-loops and **nothing else is affected**. This is deliberate:
the compose file uses `${TUNNEL_TOKEN:-}` rather than a required variable, because
a hard failure would stop compose parsing and take the whole stack down over a
tunnel token. The encoder must keep working on the LAN regardless.

---

## Part 2 — SSH and deploys (the dynamic IP)

The tunnel does **not** fix this. GitHub Actions SSHes to the server, and
`SERVER_HOST` still holds a raw IP that goes stale.

The fix is a second DNS record, **DNS-only (grey cloud, not proxied)** — Cloudflare
cannot proxy SSH — pointing at the current IP, kept up to date by a small updater
container that calls the Cloudflare API when the address changes.

Then `SERVER_HOST` becomes `server.otomate.uk` and the deploy never breaks again.

**Built** — `scripts/cloudflare-ddns.sh`, run by the `ddns` container.

It checks the public IP every 5 minutes (via Cloudflare's own `/cdn-cgi/trace`, so
no extra third party) and only calls the API when the address has actually
changed. If `server.otomate.uk` does not exist yet it creates it, **unproxied** —
Cloudflare cannot proxy SSH, and a proxied record would resolve to Cloudflare's
edge rather than to this machine.

### Steps

**1. Create an API token** — Cloudflare dashboard → *My Profile* → *API Tokens* →
**Create Token** → *Edit zone DNS* template.

| Field | Value |
|-------|-------|
| Permissions | Zone · DNS · **Edit** |
| Zone Resources | Include · Specific zone · **otomate.uk** |

Use a scoped token, **not** the Global API Key — that key can do anything to every
zone on the account, and it would be sitting in a `.env` on a home server.

**2. Add it to the server `.env`:**

```bash
cd ~/otomate
printf 'CF_API_TOKEN=%s\n' 'PASTE_TOKEN_HERE' >> .env
chmod 600 .env
```

**3. Deploy.** The container creates `server.otomate.uk` on first run.

**4. Point the deploy at the hostname** — GitHub → *Settings* → *Secrets and
variables* → *Actions* → set `SERVER_HOST` to `server.otomate.uk`.

That is the last place a raw IP appears. After this, a blackout changes the
address, the container updates DNS within five minutes, and nothing breaks.

**5. Verify:**

```bash
docker compose -f docker-compose.prod.yml logs ddns --tail 10
dig +short server.otomate.uk        # should match the server's public IP
```

### Failure modes, all verified

| Situation | Behaviour |
|-----------|-----------|
| `CF_API_TOKEN` unset | exits immediately with a named error |
| Token wrong or wrong zone | logs `zone otomate.uk not found — check the token's zone scope`, retries |
| Public IP unreachable | logs and retries; never writes a wrong value |
| IP unchanged | no API call at all |

---

## Part 3 — LAN access stays

`http://<server-lan-ip>` keeps working. The encoder sits at HQ on the same network,
so a local path that survives an internet or Cloudflare outage is worth keeping.
It costs nothing: it is simply what happens if the port binding is left alone.

---

## Follow-ups once the domain is live

- **Set `WEB_URL`** in the server `.env` to `https://otomate.uk`. The API
  currently falls back to `cors({ origin: '*' })`. Low risk today — every endpoint
  requires a bearer token and the app is same-origin — but there is no reason to
  stay permissive once a real origin exists.
- **`app.set('trust proxy', 1)`** when rate limiting arrives, so Express sees the
  real client IP rather than the tunnel's.
- ~~Dead `traefik/traefik.yml`~~ — **deleted**. It was never mounted (Traefik is
  configured by CLI flags in the compose file), yet it declared an insecure
  dashboard, which read alarmingly to anyone auditing the repo despite being inert.
