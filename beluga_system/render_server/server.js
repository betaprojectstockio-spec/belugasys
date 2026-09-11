/**
 * B.E.L.U.G.A - Signal Gateway
 * -----------------------------------------------------------------------
 * Bu sunucu HICBIR KULLANICI VERISI DEPOLAMAZ. Gorevi, birbirine
 * eslestirilmis (paired) cihazlar arasinda E2EE ile sifrelenmis
 * paketleri WebSocket (Socket.io) uzerinden ODEME YAPMADAN, ic icerigi
 * hic gormeden relay etmektir. Sunucu sadece opak (sifreli) byte
 * dizilerini yonlendirir; AES-256 sifre cozme islemi sadece uc
 * noktalarda (web dashboard ve local agent) gerceklesir.
 *
 * Eslestirme (pairing): Seri Numarasi + tek kullanimlik Pairing Token
 * ya da bu ikilinin QR koduna gomulmesi ile yapilir. Token bellekte,
 * gecici olarak (TTL) tutulur; kalici bir veritabani YOKTUR.
 */

require("dotenv").config();
const express = require("express");
const http = require("http");
const helmet = require("helmet");
const cors = require("cors");
const { Server } = require("socket.io");
const crypto = require("crypto");

const PORT = process.env.PORT || 10000;
const rawOrigins = process.env.ALLOWED_ORIGINS || "*";
const ALLOWED_ORIGINS = rawOrigins === "*" ? "*" : rawOrigins.split(",");
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || "240000", 10);
const PAIRING_TTL_SECONDS = parseInt(process.env.PAIRING_TTL_SECONDS || "300", 10);
const SELF_URL = process.env.SELF_URL || "";

const app = express();
app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
  maxHttpBufferSize: 5 * 1024 * 1024 // ekran goruntusu paketleri icin
});

// --------------------------------------------------------------------------
// BELLEK-ICI (in-memory) durum -- kalici depolama YOK
// --------------------------------------------------------------------------

/** deviceSerial -> { socketId, role, lastSeen } */
const registry = new Map();

/** pairingToken -> { serial, expiresAt } */
const pendingPairings = new Map();

function now() {
  return Date.now();
}

function cleanupExpiredPairings() {
  for (const [token, info] of pendingPairings.entries()) {
    if (info.expiresAt < now()) pendingPairings.delete(token);
  }
}
setInterval(cleanupExpiredPairings, 30 * 1000);

// --------------------------------------------------------------------------
// HTTP UÇ NOKTALARI
// --------------------------------------------------------------------------

app.get("/health", (req, res) => {
  res.json({ status: "alive", connectedDevices: registry.size, ts: now() });
});

/**
 * Local Agent tarafinda yeni bir cihaz kaydi baslatilirken cagrilir.
 * Sunucu SADECE gecici bir eslestirme token'i uretir; hicbir kimlik
 * bilgisi kalici olarak saklanmaz.
 */
app.post("/api/pairing/init", (req, res) => {
  const { serial } = req.body || {};
  if (!serial || typeof serial !== "string") {
    return res.status(400).json({ error: "serial gerekli" });
  }
  const token = crypto.randomBytes(16).toString("hex");
  pendingPairings.set(token, {
    serial,
    expiresAt: now() + PAIRING_TTL_SECONDS * 1000
  });
  res.json({ token, ttl: PAIRING_TTL_SECONDS });
});

// --------------------------------------------------------------------------
// SOCKET.IO - E2EE RELAY
// --------------------------------------------------------------------------

io.on("connection", (socket) => {
  let boundSerial = null;

  /**
   * Cihaz (agent ya da dashboard), seri numarasi + eslestirme token'i ile
   * kanala katilir. Sunucu bu asamada sadece 'kim kiminle konusabilir'
   * eslemesini bellekte tutar; veri icerigine hic dokunmaz.
   */
  socket.on("device:register", ({ serial, token, role }) => {
    if (!serial || !role) return;

    if (role === "dashboard") {
      // Dashboard, zaten eslestirilmis bir cihazi izlemek icin baglanir.
      boundSerial = serial;
      socket.join(`device:${serial}`);
      registry.set(`dashboard:${socket.id}`, { socketId: socket.id, role, lastSeen: now() });
      socket.emit("device:registered", { ok: true });
      io.to(`device:${serial}`).emit("device:presence", { serial, dashboardOnline: true });
      return;
    }

    if (role === "agent") {
      const pairing = token ? pendingPairings.get(token) : null;
      if (!pairing || pairing.serial !== serial) {
        socket.emit("device:registered", { ok: false, error: "gecersiz veya suresi dolmus token" });
        return;
      }
      pendingPairings.delete(token); // tek kullanimlik
      boundSerial = serial;
      socket.join(`device:${serial}`);
      registry.set(serial, { socketId: socket.id, role, lastSeen: now() });
      socket.emit("device:registered", { ok: true });
      io.to(`device:${serial}`).emit("device:presence", { serial, agentOnline: true });
    }
  });

  /**
   * Opak (E2EE ile sifrelenmis) komut/veri paketlerini oda icindeki
   * digerlerine iletir. 'payload' alani sunucu tarafindan asla
   * cozulmez / loglanmaz.
   */
  socket.on("relay:message", ({ serial, payload, type }) => {
    if (!serial || !payload) return;
    socket.to(`device:${serial}`).emit("relay:message", {
      type: type || "generic",
      payload,
      ts: now()
    });
  });

  socket.on("disconnect", () => {
    if (boundSerial) {
      if (registry.get(boundSerial)?.socketId === socket.id) {
        registry.delete(boundSerial);
        io.to(`device:${boundSerial}`).emit("device:presence", { serial: boundSerial, agentOnline: false });
      }
      io.to(`device:${boundSerial}`).emit("device:presence", { serial: boundSerial, dashboardOnline: false });
    }
  });
});

// --------------------------------------------------------------------------
// KEEP-ALIVE / HEARTBEAT -- Render ucretsiz plani uyku moduna gecmesin
// --------------------------------------------------------------------------

function heartbeat() {
  if (!SELF_URL) return;
  fetch(`${SELF_URL}/health`).catch(() => {
    // sessizce yut, bir sonraki tikte tekrar denenecek
  });
}
setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`[BELUGA-GATEWAY] ${PORT} portunda calisiyor.`);
});
