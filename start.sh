#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "== raport-reg start =="

if ! command -v node >/dev/null 2>&1; then
  echo "нет node. поставь node 24+"
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ставлю openssl..."
  apt-get update -y
  apt-get install -y openssl
fi

npm install

mkdir -p data/ssl

HOST_IP="${SSL_CN:-185.112.101.132}"

if [ ! -f data/ssl/cert.pem ] || [ ! -f data/ssl/key.pem ]; then
  echo "делаю ssl сертификат (self-signed) для $HOST_IP"
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout data/ssl/key.pem \
    -out data/ssl/cert.pem \
    -days 825 \
    -subj "/CN=$HOST_IP" \
    -addext "subjectAltName=IP:$HOST_IP,DNS:$HOST_IP"
  echo "сертификат готов: data/ssl/"
else
  echo "ssl уже есть: data/ssl/"
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ставлю pm2..."
  npm install -g pm2
fi

# освобождаем порты если что-то старое висит
pkill -f "node server.js" 2>/dev/null || true
fuser -k 80/tcp 2>/dev/null || true
fuser -k 443/tcp 2>/dev/null || true
pm2 delete raport 2>/dev/null || true

export PORT=80
export HTTPS_PORT=443
export SSL_KEY="$(pwd)/data/ssl/key.pem"
export SSL_CERT="$(pwd)/data/ssl/cert.pem"

pm2 start server.js --name raport --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/tmp/pm2-startup.txt 2>&1 || true

echo ""
echo "ok"
echo "http  -> http://$HOST_IP  (редирект на https)"
echo "https -> https://$HOST_IP"
echo "panel -> https://$HOST_IP/panel.html"
echo ""
echo "статус: pm2 status"
echo "логи:   pm2 logs raport"
