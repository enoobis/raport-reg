#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "== raport-reg start =="

if ! command -v node >/dev/null 2>&1; then
  echo "нет node. поставь node 24+"
  exit 1
fi

# ip сервера
HOST_IP="${HOST_IP:-$(curl -4 -s ifconfig.me || true)}"
if [ -z "$HOST_IP" ]; then
  HOST_IP="185.112.101.132"
fi

# бесплатное имя -> этот ip (для нормального ssl)
DOMAIN="${DOMAIN:-$HOST_IP.sslip.io}"

npm install

mkdir -p data/ssl

# certbot для настоящего сертификата
if ! command -v certbot >/dev/null 2>&1; then
  echo "ставлю certbot..."
  apt-get update -y
  apt-get install -y certbot
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ставлю pm2..."
  npm install -g pm2
fi

echo "останавливаю процессы на 80/443..."
pkill -f "node server.js" 2>/dev/null || true
pm2 delete raport 2>/dev/null || true
fuser -k 80/tcp 2>/dev/null || true
fuser -k 443/tcp 2>/dev/null || true
sleep 1

LE_LIVE="/etc/letsencrypt/live/$DOMAIN"
NEED_CERT=0
if [ ! -f "$LE_LIVE/fullchain.pem" ] || [ ! -f "$LE_LIVE/privkey.pem" ]; then
  NEED_CERT=1
fi

if [ "$NEED_CERT" = "1" ]; then
  echo "получаю let's encrypt для $DOMAIN ..."
  certbot certonly --standalone \
    --non-interactive --agree-tos \
    --register-unsafely-without-email \
    -d "$DOMAIN" || true
fi

if [ -f "$LE_LIVE/fullchain.pem" ] && [ -f "$LE_LIVE/privkey.pem" ]; then
  echo "использую let's encrypt"
  export SSL_KEY="$LE_LIVE/privkey.pem"
  export SSL_CERT="$LE_LIVE/fullchain.pem"
else
  echo "let's encrypt не вышел — делаю self-signed"
  if [ ! -f data/ssl/cert.pem ] || [ ! -f data/ssl/key.pem ]; then
    openssl req -x509 -nodes -newkey rsa:2048 \
      -keyout data/ssl/key.pem \
      -out data/ssl/cert.pem \
      -days 825 \
      -subj "/CN=$DOMAIN" \
      -addext "subjectAltName=DNS:$DOMAIN,IP:$HOST_IP"
  fi
  export SSL_KEY="$(pwd)/data/ssl/key.pem"
  export SSL_CERT="$(pwd)/data/ssl/cert.pem"
fi

export PORT=80
export HTTPS_PORT=443

pm2 start server.js --name raport --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/tmp/pm2-startup.txt 2>&1 || true

echo ""
echo "ok"
echo "открывай: https://$DOMAIN"
echo "панель:   https://$DOMAIN/panel.html"
echo ""
echo "статус: pm2 status"
echo "логи:   pm2 logs raport"
