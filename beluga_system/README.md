# B.E.L.U.G.A
### (Bireysel Elektronik Uzaktan Gozetim ve Asistanlik / Personal Automation & Assistance System)

J.A.R.V.I.S / E.D.I.T.H tarzi calisan, kullanicinin kendi yetkilendirdigi
cihazlarini (Ev PC, Is PC vb.) uzaktan yonetmesini saglayan, uctan uca
sifreli (E2EE) kisisel otomasyon sistemi.

## Mimari

```
[ Web Dashboard ]  <== E2EE (AES-256-GCM) ==>  [ Render Gateway ]  <== E2EE ==>  [ Local Agent (PC) ]
   (tarayici)              WebSocket               (sadece relay,           (Python servisi,
                                                      veri SAKLAMAZ)          yetkili PC'de calisir)
```

- **render_server/**: Node.js + Express + Socket.io. Sadece opak (sifreli)
  paketleri, eslestirilmis cihazlar arasinda yonlendiren bir "Signal
  Gateway". Icerigi asla cozmez, kalici veritabani yoktur. Render'in
  ucretsiz plani uykuya gecmesin diye dahili heartbeat / keep-alive
  mekanizmasi icerir.
- **local_agent/**: Yetkilendirilmis PC'de arka planda calisan Python
  istemcisi. Sistem durumu okuma, ekran goruntusu alma (mss), ve
  onceden tanimlanmis (whitelist) otomasyon komutlarini (PyAutoGUI)
  calistirma yetkisine sahiptir.
- **web_dashboard/**: Sesli/yazili komut arayuzu, QR ile cihaz
  eslestirme ve cihaz listesi iceren kontrol paneli (saf HTML/JS/CSS).

## Guvenlik Modeli

1. Her cihaz, Seri Numarasi + tek kullanimlik Pairing Token ile
   Gateway'e kaydolur (token 5 dakika gecerlidir, bellekte tutulur).
2. Gercek sifreleme anahtari, kullanicinin QR kod icine gomdugu
   **pairing_secret** degerinden PBKDF2-HMAC-SHA256 (200.000 iterasyon)
   ile turetilir ve HICBIR ZAMAN sunucuya gonderilmez.
3. Tum komut ve yanitlar AES-256-GCM ile sifrelenir; Gateway yalnizca
   sifreli baytlari gorur.
4. Local Agent, yalnizca `config.json` icindeki `allowed_commands`
   listesindeki islemleri calistirir.

## Kurulum

### 1) Render Gateway
```
cd render_server
npm install
npm start
```
Render.com uzerinde `render.yaml` blueprint'i ile tek tikla deploy edilebilir.
Deploy sonrasi `.env` icindeki `SELF_URL` degerini gercek Render URL'iniz
ile guncelleyin (keep-alive icin gereklidir).

### 2) Local Agent (yetkili PC)
```
cd local_agent
pip install -r requirements.txt
cp config.example.json config.json
# config.json icini web panelinden uretilen QR/pairing bilgileriyle doldurun
python agent.py
```

### 3) Web Dashboard
`web_dashboard/index.html` dosyasini herhangi bir statik hosting
(GitHub Pages, Render Static Site, Netlify) uzerinden yayinlayin ya da
dogrudan tarayicida acin. Panel uzerinden "+ Yeni Cihaz Ekle" ile QR
kod uretip Local Agent'i eslestirin.

## Notlar
- Bu depoda **hicbir merkezi veritabani yoktur**; tum kimlik/anahtar
  bilgileri kullanicinin kendi tarayicisinda (localStorage) ve
  yetkili PC'sindeki `config.json` dosyasinda tutulur.
- `automation_controller.py` yalnizca beyaz listeye alinmis komutlari
  calistirir; yeni bir yetenek eklemek icin hem `allowed_commands`
  listesine hem de controller'a giris yapmalisiniz.
