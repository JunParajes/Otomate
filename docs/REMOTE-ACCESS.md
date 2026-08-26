# Remote access to the server

How to reach the machine from outside the shop, and why it is set up this way.

> The **web app** is not affected by any of this. `https://otomate.uk` is served
> through the Cloudflare Tunnel and works from anywhere already. This document is
> only about reaching the *server* — SSH, deploys, administration.

## The problem being solved

SSH already worked from anywhere: `server.otomate.uk` tracks the public IP and
the router forwarded a port to it. That is also the problem. Measured on
2026-08-26:

```
876   failed logins in the auth log
266   distinct source IPs
      tried: admin, support, user, operator, supervisor, ubnt, default …
```

and the server was answering:

```
Authentications that can continue: publickey,password
```

Password authentication, on a port the whole internet can reach. `fail2ban` was
running and absorbing most of it, and the usernames tried were generic rather
than targeted — so this was untargeted scanning finding an open port, not
somebody after this business. That is luck, not a defence.

Tailscale replaces the open port with a private network between our own devices.
Nothing inbound stays open, so there is nothing left to scan.

---

## Order matters

Each step is reversible, and **the port is closed last**, once the replacement
is proven. Do not close it while travelling: if Tailscale is the only way in and
something goes wrong, the machine is at home and you are not.

### 1. Turn off password authentication (do this first, regardless)

The single biggest win, and independent of everything below. Keys already work —
this only stops passwords being *accepted*, which is what those 876 attempts
were hoping for.

```bash
echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/99-no-passwords.conf
sudo sshd -t && sudo systemctl reload ssh
```

Verify from your laptop — it should now say `publickey` only:

```bash
ssh -o PubkeyAuthentication=no -v <user>@192.168.1.82 exit 2>&1 | grep "can continue"
```

> Keep your existing SSH session open until you have confirmed you can open a
> *new* one. A bad sshd config with no fallback session is how people lock
> themselves out of a machine in another building.

### 2. Tailscale on the server

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

It prints a URL — open it and sign in. The machine then appears in your tailnet
with a name like `jserver` and an address in `100.x.y.z`.

```bash
tailscale ip -4        # the address to use from now on
tailscale status
```

`tailscaled` is enabled at boot by the installer, so this survives the reboots a
blackout causes.

### 3. Tailscale on your laptop (and iPad)

Install the app, sign in with the same account. Then confirm SSH works over the
private network rather than the public one:

```bash
ssh <user>@jserver          # or the 100.x address
```

Do this from a network that is **not** your home wifi — tether to your phone.
Succeeding on home wifi proves nothing, because the LAN route still works there.

### 4. Point deploys at it

`.github/workflows/deploy.yml` already has a **Join Tailscale** step. It is
skipped while `TS_OAUTH_CLIENT_ID` is unset, so deploys keep working over the
public address until you finish this — setting it up cannot strand you halfway.

1. Tailscale admin console → *Settings* → *OAuth clients* → generate one with
   the **Devices: write** scope and the tag `tag:ci`.
2. Tailscale admin console → *Access controls* → make sure `tag:ci` exists and is
   allowed to reach the server.
3. GitHub → *Settings* → *Secrets and variables* → *Actions*:
   - `TS_OAUTH_CLIENT_ID`
   - `TS_OAUTH_SECRET`
4. Change `SERVER_HOST` to the tailnet name (`jserver`) and `SERVER_SSH_PORT`
   to `22` — inside the tailnet there is no port translation.
5. Push anything and watch the deploy succeed **before** moving on.

### 5. Close the router's SSH forward

Only once steps 3 and 4 both work, and preferably while you are somewhere you
could reach the machine physically.

Router admin → port forwarding → remove the rule sending external SSH to
192.168.1.82. Then confirm from off-network:

```bash
nc -vz -w 5 server.otomate.uk 2323      # expect: refused / timed out
ssh <user>@jserver                       # expect: still works
```

At that point the home network has **no inbound ports open at all** — the web
app leaves via the outbound Cloudflare Tunnel, and admin access leaves via
Tailscale.

---

## What each piece is for, afterwards

| Path | Used by | Inbound port? |
|------|---------|---------------|
| `https://otomate.uk` | everyone using the app | no — outbound tunnel |
| Tailscale (`jserver`) | you, your iPad, CI deploys | no — outbound mesh |
| `server.otomate.uk` | nothing, once step 5 is done | no |

`server.otomate.uk` and the `ddns` container become redundant after step 5. They
are harmless to leave running, and leaving them means the DNS record is still
current if you ever need to reopen the port to recover. Remove them only if you
want the tidiness.

## If Tailscale is ever the problem

Signs: `tailscale status` reports `Logged out` or the daemon is not running.

```bash
sudo systemctl status tailscaled
sudo tailscale up
```

If the machine is unreachable entirely and the port forward is already closed,
recovery needs someone at the keyboard. That is the trade being made for having
nothing open — worth knowing before you travel, not after.
