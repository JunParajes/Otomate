# Remote access to the server

How the machine is reached from outside the shop today, and a plan — **not yet
adopted** — for tightening it later.

> The **web app** is unaffected by any of this. `https://otomate.uk` is served
> through the Cloudflare Tunnel and works from anywhere already. This is only
> about reaching the *server*: SSH, deploys, administration.

## How it works today

`server.otomate.uk` resolves to the home connection's public IP, and the router
forwards an SSH port to the machine. The `ddns` container keeps that record
current within five minutes of the address changing, which is what makes it
survive the blackouts that move it.

```
ssh <user>@server.otomate.uk -p <forwarded port>
```

This works from anywhere, and it is how GitHub Actions deploys. Nothing needs
setting up to use it.

**Status:** the Tailscale plan below was considered on 2026-08-26 and
**deferred** — the port-forward arrangement stays for now, with the security
work to be revisited later. The rest of this document is kept because the
measurements in it are real and worth not re-discovering.

## The problem it would solve

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

## The deferred plan

Not adopted. Kept so it does not have to be worked out again from scratch.

Each step is reversible, and **the port is closed last**, once the replacement
is proven. Do not close it while travelling: if Tailscale is the only way in and
something goes wrong, the machine is at home and you are not.

Step 1 below is worth noting separately: it has nothing to do with Tailscale,
changes nothing about how access works, and takes about thirty seconds.

### 1. Turn off password authentication — independent of everything else

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

The workflow would need a **Join Tailscale** step (`tailscale/github-action@v3`,
using an OAuth client tagged `tag:ci`). One was added and then removed when this
was deferred; add it back guarded on its secret being present, so deploys keep
working over the public address until the switch is finished.

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

## Surviving a blackout

Tailscale reconnecting is the easy half. The daemon is enabled at boot by the
installer, node state lives in `/var/lib/tailscale`, and it retries continuously
— so once the machine is up and the ISP is back, it rejoins on its own with no
credentials to re-enter.

Two things break that, and neither is Tailscale's fault.

### 1. The node key expires — the silent one

Tailscale node keys expire after 180 days by default. When that happens the
machine drops off the tailnet and needs an interactive login to come back, which
is impossible remotely and gives no warning beforehand.

**Tailscale admin console → Machines → the server → Disable key expiry.**

Do it the moment the machine appears. Six months is exactly long enough to have
forgotten this document exists.

### 2. The machine never comes back on

This is the real risk, and it predates Tailscale. Measured on 2026-08-26:

| | |
|---|---|
| Chassis | laptop — the battery is a built-in UPS |
| Battery | 103%, healthy |
| At 2% battery | `CriticalPowerAction=HybridSleep` |
| RAM vs swap | 7.1 GB against a 4 GB swap file |

So a blackout goes: the laptop keeps running on battery while **the router does
not**, meaning it is already unreachable; the battery drains; at 2% it suspends.
When power returns the router boots — and the laptop stays asleep, because
resuming needs a wake event and AC returning is not one.

Worse, hibernating 7.1 GB of RAM into 4 GB of swap is not guaranteed to succeed
under load, so even the suspend is unreliable.

**Two changes, and the first needs you physically at the machine:**

```bash
# BIOS/UEFI: enable "Restore on AC Power Loss" (sometimes "AC Recovery",
# "After Power Failure"). Requires a reboot into firmware — this is the one
# step that cannot be done remotely, so do it before travelling.
```

```bash
# End in a state AC-restore can actually boot from. Suspended machines ignore
# returning power; powered-off ones do not.
sudo mkdir -p /etc/UPower
sudo sed -i 's/^CriticalPowerAction=.*/CriticalPowerAction=PowerOff/' /etc/UPower/UPower.conf
sudo systemctl restart upower
grep CriticalPowerAction /etc/UPower/UPower.conf
```

Losing in-flight state on a hard stop is fine here: Postgres is crash-safe, all
six containers carry `restart: unless-stopped`, and Docker is enabled at boot.
The app comes back on its own. An unreachable machine does not.

### Prove it rather than assume it

Once Tailscale is installed, reboot the server and confirm it returns without
help:

```bash
sudo reboot
# wait, then from your laptop — over the tailnet, not the LAN:
ssh <user>@jserver 'tailscale status | head -2; docker ps --format "{{.Names}}: {{.Status}}"'
```

That proves the software path: daemon at boot, state persisted, containers back.
It does **not** prove the firmware path — only cutting mains power does, which is
worth doing once while you are still standing next to it.

### What none of this fixes

If the ISP itself is down, the server is unreachable no matter what. Tailscale
needs an outbound path like everything else. A blackout long enough to outlast
the battery means the app is offline until someone is home, and that is a
property of running it on a laptop in a house rather than something to configure
away.

## If Tailscale is ever the problem

Signs: `tailscale status` reports `Logged out` or the daemon is not running.

```bash
sudo systemctl status tailscaled
sudo tailscale up
```

If the machine is unreachable entirely and the port forward is already closed,
recovery needs someone at the keyboard. That is the trade being made for having
nothing open — worth knowing before you travel, not after.
