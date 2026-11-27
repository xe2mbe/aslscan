#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  ASLSCAN — installer for AllStarLink (ASL3, ASL2, HamVOIP) and IRLP nodes
#
#  The Dashboard of HAMNA Web as its own program: connections, favorites,
#  node search, live audio, Telegram bot and node panel, with HAMNA's users.
#  It can live next to HAMNA Web on the same node (different port and path).
#
#  Usage:   sudo ./install.sh [options]
#
#    --type asl|irlp      force the node type (detected by default)
#    --node NUMBER        node number (ASL) or stationid (IRLP)
#    --port 8095          web page port
#    --password PASS      password for the "admin" user (asked if missing)
#    --no-packages        do not install anything with apt (alsa-utils on IRLP)
#    --no-apache          do not publish the page at http(s)://<node>/aslscan/
#    --listen-all         keep port 8095 reachable from the network (by default,
#                         when Apache publishes /aslscan/, it listens on 127.0.0.1)
#
#  No Python packages needed: only Python 3.5 or newer.
#  Running it again updates the program and keeps all data, users and settings.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

APP_DIR=/opt/aslscan
DATA_DIR=/var/lib/aslscan
BACKUP_DIR=/var/backups/aslscan
SERVICE=aslscan
PORT=8095
TYPE=""
NODE=""
PASSWORD=""
KEPT_USERS=0
APT=1
APACHE=1
LISTEN_ALL=0
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
export PYTHONIOENCODING=utf-8

c_ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
c_info() { printf '\033[1;34m[..]\033[0m %s\n' "$*"; }
c_warn() { printf '\033[1;33m[!!]\033[0m %s\n' "$*"; }
die()    { printf '\033[1;31m[XX] %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --type) TYPE="$2"; shift 2 ;;
    --node) NODE="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --no-packages) APT=0; shift ;;
    --no-apache) APACHE=0; shift ;;
    --listen-all) LISTEN_ALL=1; shift ;;
    --force) shift ;;          # accepted for compatibility with HAMNA's update.sh
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "Unknown option: $1  (see --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "Run it as root:  sudo $0"
[ -f "$SRC_DIR/aslscan/__main__.py" ] || die "Cannot find the program (aslscan/ folder) next to install.sh"
NEW_VERSION=$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$SRC_DIR/aslscan/__init__.py")

echo
echo "  ASLSCAN ${NEW_VERSION} - install"
echo "  ----------------------------"

OLD_VERSION=""
[ -f "$APP_DIR/aslscan/__init__.py" ] && OLD_VERSION=$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$APP_DIR/aslscan/__init__.py")
[ -n "$OLD_VERSION" ] && c_info "Updating from ${OLD_VERSION} to ${NEW_VERSION}"

# ── 1. Node type ────────────────────────────────────────────────────────────
AST=$(command -v asterisk 2>/dev/null || ls /usr/sbin/asterisk /usr/local/sbin/asterisk 2>/dev/null | head -1 || true)
if [ -z "$TYPE" ]; then
  if [ -d /home/irlp/scripts ] || [ -f /home/irlp/custom/environment ]; then
    TYPE=irlp
  elif [ -f /etc/asterisk/rpt.conf ] && [ -n "$AST" ]; then
    TYPE=asl
  else
    die "No AllStarLink or IRLP found. Use --type asl or --type irlp"
  fi
fi
case "$TYPE" in asl|irlp) ;; *) die "--type must be asl or irlp" ;; esac

FLAVOR=""
if [ "$TYPE" = asl ]; then
  if [ -f /usr/local/etc/allstar.env ] || [ -d /usr/local/hamvoip-sbin ]; then FLAVOR=HamVOIP
  elif dpkg -s asl3 >/dev/null 2>&1; then FLAVOR="AllStarLink 3"
  else FLAVOR=AllStarLink; fi
  # The service runs as the same user as Asterisk (asterisk on ASL3, root on HamVOIP)
  RUN_USER=$(ps -o user= -C asterisk 2>/dev/null | head -1 | tr -d ' ' || true)
  [ -n "$RUN_USER" ] || { id asterisk >/dev/null 2>&1 && RUN_USER=asterisk || RUN_USER=root; }
  if [ -z "$NODE" ]; then
    NODE=$(grep -m1 -E '^\[[0-9]{3,7}\]' /etc/asterisk/rpt.conf | sed 's/^\[\([0-9]*\)\].*/\1/' || true)
  fi
  c_ok "$FLAVOR, node ${NODE:-?} (service runs as $RUN_USER)"
  # Node search needs the AllStar directory (astdb.txt). A fresh ASL3 ships
  # its daily download timer disabled: turn it on and download it once.
  if systemctl list-unit-files asl3-update-astdb.timer >/dev/null 2>&1 \
     && ! systemctl is-enabled --quiet asl3-update-astdb.timer 2>/dev/null; then
    systemctl enable --now asl3-update-astdb.timer >/dev/null 2>&1 || true
    if [ ! -s /var/lib/asterisk/astdb.txt ]; then
      timeout 120 /usr/bin/asl3-update-astdb >/dev/null 2>&1 || true
    fi
    if [ -s /var/lib/asterisk/astdb.txt ]; then c_ok "AllStar directory downloaded (daily update turned on)"
    else c_warn "Could not download the AllStar directory yet; it retries daily (asl3-update-astdb.timer)"; fi
  fi
else
  FLAVOR=IRLP
  RUN_USER=repeater
  id repeater >/dev/null 2>&1 || die "The IRLP user 'repeater' does not exist"
  if [ -z "$NODE" ]; then
    NODE=$(bash -c '. /home/irlp/custom/environment 2>/dev/null; echo "${STATIONID:-}"' || true)
  fi
  c_ok "IRLP ${NODE:-?} (service runs as $RUN_USER)"
fi
RUN_GROUP=$(id -gn "$RUN_USER")
HAS_IRLP=0; [ -d /home/irlp/scripts ] && id repeater >/dev/null 2>&1 && HAS_IRLP=1
HAS_ASL=0; [ -f /etc/asterisk/rpt.conf ] && [ -n "$AST" ] && HAS_ASL=1
[ -d /opt/hamna-web/hamna ] && c_ok "HAMNA Web is also installed here: both keep working (HAMNA on its port, ASLSCAN on $PORT)"

# ── 2. Python ───────────────────────────────────────────────────────────────
PY=$(command -v python3 || true)
[ -n "$PY" ] || die "python3 is missing"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 5) else 1)' || die "Python 3.5 or newer is required"
c_ok "$("$PY" --version 2>&1)"
if [ "$APT" = 1 ] && [ "$TYPE" = irlp ] && command -v apt-get >/dev/null 2>&1 && ! command -v aplay >/dev/null 2>&1; then
  c_info "Installing alsa-utils (to listen to the node live)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -qq --no-install-recommends alsa-utils >/dev/null 2>&1 || c_warn "Could not install alsa-utils"
fi

# ── 3. Backup, program and data ─────────────────────────────────────────────
systemctl stop "$SERVICE" 2>/dev/null || true
if ls "$DATA_DIR"/aslscan.db >/dev/null 2>&1; then
  BK="$BACKUP_DIR/$(date +%Y%m%d_%H%M%S)${OLD_VERSION:+_v$OLD_VERSION}"
  mkdir -p "$BK"
  cp -a "$DATA_DIR"/aslscan.db* "$BK/" 2>/dev/null || true
  [ -f "$DATA_DIR/settings.json" ] && cp -a "$DATA_DIR/settings.json" "$BK/"
  [ -d "$APP_DIR/aslscan" ] && cp -a "$APP_DIR/aslscan" "$BK/program"
  chmod 700 "$BACKUP_DIR" "$BK"
  c_ok "Backup of data and previous program in $BK"
  ls -1dt "$BACKUP_DIR"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
fi
mkdir -p "$APP_DIR" "$DATA_DIR"
rm -rf "$APP_DIR/aslscan"
cp -r "$SRC_DIR/aslscan" "$APP_DIR/"
rm -rf "$APP_DIR/bin" && mkdir -p "$APP_DIR/bin"
cp "$SRC_DIR"/bin/aslscan-* "$APP_DIR/bin/"
sed -i "1s|.*|#!$PY -I|" "$APP_DIR/bin/aslscan-live"
sed -i "1s|.*|#!$PY -I|" "$APP_DIR/bin/aslscan-live-irlp"
for f in install.sh update.sh uninstall.sh README.md; do [ -f "$SRC_DIR/$f" ] && cp "$SRC_DIR/$f" "$APP_DIR/"; done
find "$APP_DIR" -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
chown -R root:root "$APP_DIR"
chmod -R a+rX "$APP_DIR"
chmod 755 "$APP_DIR"/*.sh "$APP_DIR"/bin/* 2>/dev/null || true
chmod 755 "$APP_DIR" "$APP_DIR/bin"
chown -R "$RUN_USER:$RUN_GROUP" "$DATA_DIR"
chmod 750 "$DATA_DIR"
[ "$TYPE" = irlp ] && { usermod -aG audio repeater 2>/dev/null || true; }
c_ok "Program in $APP_DIR, data in $DATA_DIR"

run_as() { if [ "$RUN_USER" = root ]; then "$@"; else runuser -u "$RUN_USER" -- "$@"; fi; }
aslscan() { (cd "$APP_DIR" && run_as env ASLSCAN_DATA="$DATA_DIR" PYTHONIOENCODING=utf-8 "$PY" -m aslscan "$@"); }
aslscan --init "backend=$TYPE" "node=$NODE"

# ── 4. Administrator user ───────────────────────────────────────────────────
if [ -n "$PASSWORD" ]; then
  aslscan --set-password "$PASSWORD" >/dev/null
  c_ok "User admin ready"
elif aslscan --has-password; then
  KEPT_USERS=1
  c_ok "Existing users kept"
elif [ -t 0 ]; then
  while :; do
    printf "  Password for the page's admin user: "; stty -echo; read -r P1; stty echo; echo
    printf "  Repeat it: "; stty -echo; read -r P2; stty echo; echo
    [ "$P1" = "$P2" ] && [ ${#P1} -ge 6 ] && break
    c_warn "They do not match or are shorter than 6 characters"
  done
  aslscan --set-password "$P1" >/dev/null
  c_ok "User admin ready"
else
  P1=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 10)
  aslscan --set-password "$P1" >/dev/null
  c_warn "User: admin   Generated password: $P1   (change it in My profile)"
fi

if [ "$RUN_USER" = root ]; then RUNPFX=""; else RUNPFX="runuser -u $RUN_USER --"; fi
cat > /usr/local/bin/aslscan-passwd <<EOF
#!/bin/sh
# Changes the password of an ASLSCAN user and signs out its sessions.
#   aslscan-passwd                 user admin; asks for the new password
#   aslscan-passwd USER            that user; asks for the new password
#   aslscan-passwd USER PASSWORD   without asking (it stays in the shell history!)
#   aslscan-passwd --create USER   create USER as administrator if missing
CREATE=""
if [ "\${1:-}" = "--create" ]; then CREATE="--create"; shift; fi
if [ "\${1:-}" = "--user" ]; then shift; fi
USER_NAME="\${1:-admin}"; [ \$# -gt 0 ] && shift
cd $APP_DIR || exit 1
if [ \$# -gt 0 ]; then
  exec $RUNPFX env ASLSCAN_DATA=$DATA_DIR PYTHONIOENCODING=utf-8 $PY -m aslscan --set-password "\$1" --user "\$USER_NAME" \$CREATE
fi
exec $RUNPFX env ASLSCAN_DATA=$DATA_DIR PYTHONIOENCODING=utf-8 $PY -m aslscan --set-password --user "\$USER_NAME" \$CREATE
EOF
chmod 755 /usr/local/bin/aslscan-passwd

# ── 4b. sudo rules for connections ──────────────────────────────────────────
# Limited to the fixed helper in /opt/aslscan/bin (owned by root, not
# writable by the service).
SUDOERS=/etc/sudoers.d/aslscan
rm -f "$SUDOERS"
if [ "$RUN_USER" != root ] && command -v sudo >/dev/null 2>&1 && [ -d /etc/sudoers.d ]; then
  TMP=$(mktemp)
  echo "# ASLSCAN (created by install.sh; removed by uninstall.sh)" > "$TMP"
  [ "$HAS_IRLP" = 1 ] && [ "$RUN_USER" != repeater ] && echo "$RUN_USER ALL=(repeater) NOPASSWD: $APP_DIR/bin/aslscan-irlp" >> "$TMP"
  # Settings → Tones writes rpt.conf; Asterisk only reads it when restarted
  # (systemctl restart asterisk; never "rpt restart", which corrupts app_rpt on ASL3)
  SYSTEMCTL=$(command -v systemctl || echo /usr/bin/systemctl)
  [ "$HAS_ASL" = 1 ] && [ "$TYPE" = asl ] && echo "$RUN_USER ALL=(root) NOPASSWD: $SYSTEMCTL restart asterisk" >> "$TMP"
  if [ "$HAS_ASL" = 1 ] && [ "$TYPE" = irlp ]; then
    AST_USER=$(ps -o user= -C asterisk 2>/dev/null | head -1 | tr -d ' ' || true)
    [ -n "$AST_USER" ] && [ "$AST_USER" != "$RUN_USER" ] && echo "$RUN_USER ALL=($AST_USER) NOPASSWD: $AST -rx *" >> "$TMP"
  fi
  if [ "$(wc -l < "$TMP")" -gt 1 ]; then
    if visudo -cf "$TMP" >/dev/null 2>&1; then
      install -m 440 -o root -g root "$TMP" "$SUDOERS"
      c_ok "sudo rules (connections, restart Asterisk) in $SUDOERS"
    else
      c_warn "Could not validate the sudo rule"
    fi
  fi
  rm -f "$TMP"
fi

# ── 5. Apache: same port as Allmon/Supermon, at /aslscan/ ───────────────────
WEB_URL=""
WEB_SCHEME="https"
apache_conf() {
  cat <<CONF
# ASLSCAN at http(s)://<node>/aslscan/ (same port as Allmon3/AllScan/Supermon).
# ASLSCAN keeps running internally on 127.0.0.1:$PORT. Created by install.sh.
RedirectMatch ^/aslscan\$ /aslscan/
<Location "/aslscan/">
    ProxyPass "http://127.0.0.1:$PORT/" timeout=300
    ProxyPassReverse "http://127.0.0.1:$PORT/"
    ProxyPassReverseCookiePath "/" "/aslscan/"
</Location>
CONF
}
if [ "$APACHE" = 1 ]; then
  if command -v a2enconf >/dev/null 2>&1 && [ -d /etc/apache2/conf-available ]; then
    apache_conf > /etc/apache2/conf-available/aslscan.conf
    a2enmod -q proxy proxy_http >/dev/null 2>&1 || true
    a2enconf -q aslscan >/dev/null 2>&1 || true
    if apache2ctl configtest >/dev/null 2>&1; then
      systemctl reload apache2 2>/dev/null || true
      WEB_URL="/aslscan/"; c_ok "Published by Apache at /aslscan/"
      [ -e /etc/apache2/mods-enabled/ssl.load ] || WEB_SCHEME="http"
    else
      a2disconf -q aslscan >/dev/null 2>&1 || true
      c_warn "Apache rejected the configuration; /aslscan/ was not published"
    fi
  elif [ -f /etc/httpd/conf/httpd.conf ] && [ -d /etc/httpd/conf/extra ]; then
    # HamVOIP / Arch: httpd.conf + conf/extra
    if grep -qE "^\s*LoadModule proxy_http_module" /etc/httpd/conf/httpd.conf; then
      apache_conf > /etc/httpd/conf/extra/aslscan.conf
      grep -q "conf/extra/aslscan.conf" /etc/httpd/conf/httpd.conf || \
        printf "\n# ASLSCAN\nInclude conf/extra/aslscan.conf\n" >> /etc/httpd/conf/httpd.conf
      if apachectl -t >/dev/null 2>&1; then
        systemctl reload httpd 2>/dev/null || true
        WEB_URL="/aslscan/"; WEB_SCHEME="http"; c_ok "Published by Apache (httpd) at /aslscan/"
      else
        sed -i '/conf\/extra\/aslscan.conf/d' /etc/httpd/conf/httpd.conf
        c_warn "httpd rejected the configuration; /aslscan/ was not published"
      fi
    else
      c_warn "httpd has no mod_proxy_http loaded; /aslscan/ was not published"
    fi
  fi
fi

# With Apache in front, the port is only needed inside the node.
HOST=0.0.0.0
[ -n "$WEB_URL" ] && [ "$LISTEN_ALL" = 0 ] && HOST=127.0.0.1

# ── 6. Service ──────────────────────────────────────────────────────────────
AFTER="network-online.target"
[ "$TYPE" = asl ] && systemctl cat asterisk >/dev/null 2>&1 && AFTER="$AFTER asterisk.service"
{
  echo "[Unit]"
  echo "Description=ASLSCAN - node dashboard ($FLAVOR)"
  echo "After=$AFTER"
  echo "Wants=network-online.target"
  echo
  echo "[Service]"
  echo "Type=simple"
  echo "User=$RUN_USER"
  [ "$TYPE" = irlp ] && echo "SupplementaryGroups=audio"
  echo "WorkingDirectory=$APP_DIR"
  echo "Environment=ASLSCAN_DATA=$DATA_DIR"
  echo "Environment=PYTHONIOENCODING=utf-8"
  echo "Environment=PYTHONUNBUFFERED=1"
  echo "ExecStart=$PY -m aslscan --host $HOST --port $PORT"
  echo "Restart=on-failure"
  echo "RestartSec=5"
  echo
  echo "[Install]"
  echo "WantedBy=multi-user.target"
} > /etc/systemd/system/$SERVICE.service
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
sleep 3
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 30 --no-pager; die "The service did not start"; }
if [ "$HOST" = 127.0.0.1 ]; then c_ok "Service $SERVICE running (port $PORT only inside the node)"
else c_ok "Service $SERVICE running (port $PORT open to the network)"; fi

# ── 7. Firewall ─────────────────────────────────────────────────────────────
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  ZONE=$(firewall-cmd --get-default-zone)
  if [ "$HOST" = 127.0.0.1 ]; then
    if firewall-cmd -q --zone="$ZONE" --query-port="$PORT"/tcp --permanent 2>/dev/null; then
      firewall-cmd -q --zone="$ZONE" --remove-port="$PORT"/tcp --permanent && firewall-cmd -q --reload
      c_ok "Port $PORT closed in firewalld (zone $ZONE): use /aslscan/"
    fi
  else
    # Only from the local network: the page goes over plain http on this port
    firewall-cmd -q --zone="$ZONE" --remove-port="$PORT"/tcp --permanent 2>/dev/null || true
    for NET in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
      firewall-cmd -q --zone="$ZONE" --permanent --add-rich-rule="rule family=ipv4 source address=$NET port port=$PORT protocol=tcp accept" 2>/dev/null || true
    done
    firewall-cmd -q --reload
    c_ok "Port $PORT opened in firewalld (zone $ZONE) for the local network only (10.x, 172.16-31.x, 192.168.x)"
  fi
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  if [ "$HOST" = 127.0.0.1 ]; then
    ufw status 2>/dev/null | grep -q "^$PORT/tcp" && ufw delete allow "$PORT"/tcp >/dev/null && c_ok "Port $PORT closed in ufw: use /aslscan/"
  else
    # Only from the local network: the page goes over plain http on this port
    ufw status 2>/dev/null | grep -qE "^$PORT/tcp +ALLOW +Anywhere" && ufw delete allow "$PORT"/tcp >/dev/null
    for NET in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
      ufw allow from "$NET" to any port "$PORT" proto tcp >/dev/null
    done
    c_ok "Port $PORT opened in ufw for the local network only (10.x, 172.16-31.x, 192.168.x)"
  fi
fi

# ── 8. Live audio (ASL): a hint, rpt.conf is never edited ───────────────────
LIVE_HINT=""
if [ "$TYPE" = asl ] && [ -f /etc/asterisk/rpt.conf ]; then
  if grep -qE '^\s*outstreamcmd\s*=.*aslscan-live' /etc/asterisk/rpt.conf; then
    c_ok "Live audio: rpt.conf already sends the node's audio to ASLSCAN"
  elif grep -qE '^\s*outstreamcmd\s*=.*hamna-live' /etc/asterisk/rpt.conf; then
    c_ok "Live audio: HAMNA Web's outstreamcmd (1.42 or newer) also feeds ASLSCAN"
  else
    LIVE_HINT="   Live audio (optional): add to your node's section in /etc/asterisk/rpt.conf
                          outstreamcmd = $APP_DIR/bin/aslscan-live
                          and restart Asterisk."
  fi
fi

# ── 9. Done ─────────────────────────────────────────────────────────────────
IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
[ -n "$IP" ] || IP=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)
echo
c_ok "ASLSCAN ${NEW_VERSION} installed"
echo
[ -n "$WEB_URL" ] && echo "   Open in the browser:   ${WEB_SCHEME}://${IP:-NODE-IP}${WEB_URL}"
[ "$HOST" != 127.0.0.1 ] && echo "   Direct address:        http://${IP:-NODE-IP}:$PORT"
echo
if [ "$KEPT_USERS" = 1 ]; then echo "   Sign in with:          your ASLSCAN users (unchanged)"
else echo "   Sign in with:          user admin"; fi
echo "   Change a password:     aslscan-passwd USER"
if [ "$(id -u)" = 0 ] && [ -n "${SUDO_USER:-}" ]; then echo "   Update:                sudo $APP_DIR/update.sh"
else echo "   Update:                $APP_DIR/update.sh"; fi
echo "   View the log:          journalctl -u $SERVICE -f"
echo "   Uninstall:             sudo $APP_DIR/uninstall.sh"
[ -n "$LIVE_HINT" ] && { echo; echo "$LIVE_HINT"; }
echo
