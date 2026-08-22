#!/usr/bin/env bash
#
# Installs the nightly backup on a systemd timer. Run once, with sudo:
#
#   sudo ~/otomate/scripts/install-backup-timer.sh
#
# The unit files are generated here rather than committed, because they contain
# the server's username and home directory and this repository is public.

set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run this with sudo." >&2; exit 1; }

RUN_USER="${SUDO_USER:-}"
[ -n "$RUN_USER" ] && [ "$RUN_USER" != "root" ] \
  || { echo "Run this via sudo from your normal login, not as root directly." >&2; exit 1; }

RUN_HOME="$(getent passwd "$RUN_USER" | cut -d: -f6)"
SCRIPT="$RUN_HOME/otomate/scripts/otomate-backup.sh"

[ -x "$SCRIPT" ] || { echo "Not found or not executable: $SCRIPT" >&2; exit 1; }

# The backup talks to the Docker socket as this user. Checking now beats a
# permission error at 02:30 that nobody reads.
id -nG "$RUN_USER" | tr ' ' '\n' | grep -qx docker \
  || { echo "User $RUN_USER is not in the docker group." >&2; exit 1; }

cat > /etc/systemd/system/otomate-backup.service <<UNIT
[Unit]
Description=Otomate nightly backup (database + product images)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$RUN_USER
Group=$RUN_USER
ExecStart=$SCRIPT
# The backup is worthless if a transient Docker hiccup skips it silently.
# systemd records the failure; check with: systemctl status otomate-backup
UNIT

cat > /etc/systemd/system/otomate-backup.timer <<'UNIT'
[Unit]
Description=Run the Otomate backup nightly

[Timer]
OnCalendar=*-*-* 02:30:00
# This server is a laptop that hibernates during blackouts. Persistent=true runs
# a missed backup at the next boot instead of skipping the night entirely.
Persistent=true
RandomizedDelaySec=5m

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now otomate-backup.timer

echo
echo "Installed. Next run:"
systemctl list-timers otomate-backup.timer --no-pager | sed -n '1,2p'
echo
echo "Run one now to confirm it works:  sudo systemctl start otomate-backup"
echo "Then check the result with:       systemctl status otomate-backup"
