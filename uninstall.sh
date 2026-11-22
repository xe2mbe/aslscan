#!/usr/bin/env bash
# ASLSCAN — uninstaller.   Usage: sudo ./uninstall.sh [--delete-data]
# HAMNA Web, if installed, is not touched.
set -eu
[ "$(id -u)" -eq 0 ] || { echo "Run it as root"; exit 1; }

systemctl disable --now aslscan 2>/dev/null || true
rm -f /etc/systemd/system/aslscan.service /usr/local/bin/aslscan-passwd /etc/sudoers.d/aslscan
systemctl daemon-reload

# Apache /aslscan/
if [ -f /etc/apache2/conf-available/aslscan.conf ]; then
  a2disconf -q aslscan >/dev/null 2>&1 || true
  rm -f /etc/apache2/conf-available/aslscan.conf
  systemctl reload apache2 2>/dev/null || true
fi
if [ -f /etc/httpd/conf/extra/aslscan.conf ]; then
  sed -i '/^# ASLSCAN$/d; /conf\/extra\/aslscan.conf/d' /etc/httpd/conf/httpd.conf
  rm -f /etc/httpd/conf/extra/aslscan.conf
  systemctl reload httpd 2>/dev/null || true
fi

# IRLP: quitar el bloque de "escuchar en vivo" de /home/irlp/.asoundrc (solo el de ASLSCAN)
[ -x /opt/aslscan/bin/aslscan-irlp-envivo ] && /opt/aslscan/bin/aslscan-irlp-envivo off >/dev/null 2>&1 || true

if grep -qE '^\s*outstreamcmd\s*=.*aslscan-live' /etc/asterisk/rpt.conf 2>/dev/null; then
  echo "Note: /etc/asterisk/rpt.conf still has 'outstreamcmd = /opt/aslscan/bin/aslscan-live'."
  echo "      Remove that line (or point it to HAMNA's hamna-live) and restart Asterisk."
fi

rm -rf /opt/aslscan

case "${1:-}" in
  --delete-data)
    rm -rf /var/lib/aslscan /var/backups/aslscan
    echo "ASLSCAN uninstalled and its data deleted." ;;
  *)
    echo "ASLSCAN uninstalled. Its users and settings are still in /var/lib/aslscan"
    echo "(delete them with: rm -rf /var/lib/aslscan)" ;;
esac
