require("dotenv").config();

const express = require("express");
const http = require("http");
const helmet = require("helmet");
const cors = require("cors");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const PORT = process.env.PORT || 10000;
const rawOrigins = process.env.ALLOWED_ORIGINS || "*";
const ALLOWED_ORIGINS =
  rawOrigins === "*" ? "*" : rawOrigins.split(",");

const app = express();

app.use(helmet());
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 5 * 1024 * 1024
});

/*
 * PostgreSQL
 *
 * Render tarafında DATABASE_URL environment variable
 * olarak verilecek.
 */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

/*
 * ---------------------------------------------------------
 * DATABASE
 * ---------------------------------------------------------
 */

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[BELUGA] DATABASE_URL bulunamadı."
    );
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      serial TEXT NOT NULL,
      name TEXT NOT NULL,
      pairing_secret TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen TIMESTAMPTZ,
      UNIQUE(user_id, serial)
    );

    CREATE INDEX IF NOT EXISTS sessions_user_idx
      ON sessions(user_id);

    CREATE INDEX IF NOT EXISTS devices_user_idx
      ON devices(user_id);
  `);

  console.log("[BELUGA] Database hazır.");
}

/*
 * ---------------------------------------------------------
 * PASSWORD
 * ---------------------------------------------------------
 *
 * Harici bcrypt dependency kullanmak yerine Node crypto
 * ile scrypt kullanıyoruz.
 */

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");

    crypto.scrypt(
      password,
      salt,
      64,
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(
          `${salt}:${derivedKey.toString("hex")}`
        );
      }
    );
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const parts = stored.split(":");

    if (parts.length !== 2) {
      resolve(false);
      return;
    }

    const salt = parts[0];
    const storedHash = Buffer.from(parts[1], "hex");

    crypto.scrypt(
      password,
      salt,
      64,
      (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }

        if (derivedKey.length !== storedHash.length) {
          resolve(false);
          return;
        }

        resolve(
          crypto.timingSafeEqual(
            derivedKey,
            storedHash
          )
        );
      }
    );
  });
}

/*
 * ---------------------------------------------------------
 * SESSION
 * ---------------------------------------------------------
 */

async function createSession(userId) {
  const token = crypto.randomBytes(48).toString("hex");

  await pool.query(
    `
      INSERT INTO sessions
      (token, user_id, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '30 days')
    `,
    [token, userId]
  );

  return token;
}

async function getUserFromRequest(req) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice(7).trim();

  if (!token) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT
        users.id,
        users.username
      FROM sessions
      JOIN users
        ON users.id = sessions.user_id
      WHERE sessions.token = $1
        AND sessions.expires_at > NOW()
    `,
    [token]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    ...result.rows[0],
    token
  };
}

/*
 * ---------------------------------------------------------
 * HEALTH
 * ---------------------------------------------------------
 */

app.get("/health", async (req, res) => {
  let database = false;

  try {
    await pool.query("SELECT 1");
    database = true;
  } catch (_) {}

  res.json({
    status: "alive",
    database,
    ts: Date.now()
  });
});

/*
 * ---------------------------------------------------------
 * REGISTER
 * ---------------------------------------------------------
 */

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(
      req.body?.username || ""
    ).trim();

    const password = String(
      req.body?.password || ""
    );

    if (username.length < 3) {
      return res.status(400).json({
        error: "Kullanıcı adı en az 3 karakter olmalı."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Parola en az 8 karakter olmalı."
      });
    }

    const existing = await pool.query(
      `
        SELECT id
        FROM users
        WHERE LOWER(username) = LOWER($1)
      `,
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: "Bu kullanıcı adı zaten kullanılıyor."
      });
    }

    const passwordHash =
      await hashPassword(password);

    const userId =
      crypto.randomUUID();

    await pool.query(
      `
        INSERT INTO users
        (id, username, password_hash)
        VALUES ($1, $2, $3)
      `,
      [
        userId,
        username,
        passwordHash
      ]
    );

    const token =
      await createSession(userId);

    res.json({
      ok: true,
      token,
      user: {
        id: userId,
        username
      }
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Hesap oluşturulamadı."
    });
  }
});

/*
 * ---------------------------------------------------------
 * LOGIN
 * ---------------------------------------------------------
 */

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(
      req.body?.username || ""
    ).trim();

    const password = String(
      req.body?.password || ""
    );

    const result = await pool.query(
      `
        SELECT
          id,
          username,
          password_hash
        FROM users
        WHERE LOWER(username) = LOWER($1)
      `,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Kullanıcı adı veya parola hatalı."
      });
    }

    const user = result.rows[0];

    const valid =
      await verifyPassword(
        password,
        user.password_hash
      );

    if (!valid) {
      return res.status(401).json({
        error: "Kullanıcı adı veya parola hatalı."
      });
    }

    const token =
      await createSession(user.id);

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        username: user.username
      }
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Giriş yapılamadı."
    });
  }
});

/*
 * ---------------------------------------------------------
 * CURRENT USER
 * ---------------------------------------------------------
 */

app.get("/api/auth/me", async (req, res) => {
  try {
    const user =
      await getUserFromRequest(req);

    if (!user) {
      return res.status(401).json({
        error: "Oturum geçersiz."
      });
    }

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username
      }
    });

  } catch (error) {
    res.status(500).json({
      error: "Kullanıcı alınamadı."
    });
  }
});

/*
 * ---------------------------------------------------------
 * LOGOUT
 * ---------------------------------------------------------
 */

app.post("/api/auth/logout", async (req, res) => {
  try {
    const user =
      await getUserFromRequest(req);

    if (user) {
      await pool.query(
        `
          DELETE FROM sessions
          WHERE token = $1
        `,
        [user.token]
      );
    }

    res.json({
      ok: true
    });

  } catch (error) {
    res.status(500).json({
      error: "Çıkış yapılamadı."
    });
  }
});

/*
 * ---------------------------------------------------------
 * DEVICES
 * ---------------------------------------------------------
 */

app.get("/api/devices", async (req, res) => {
  try {
    const user =
      await getUserFromRequest(req);

    if (!user) {
      return res.status(401).json({
        error: "Oturum gerekli."
      });
    }

    const result = await pool.query(
      `
        SELECT
          id,
          serial,
          name,
          created_at,
          last_seen
        FROM devices
        WHERE user_id = $1
        ORDER BY created_at DESC
      `,
      [user.id]
    );

    res.json({
      ok: true,
      devices: result.rows
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Cihazlar alınamadı."
    });
  }
});

/*
 * Yeni cihaz hesabın altına eklenir.
 */

app.post("/api/devices", async (req, res) => {
  try {
    const user =
      await getUserFromRequest(req);

    if (!user) {
      return res.status(401).json({
        error: "Oturum gerekli."
      });
    }

    const name = String(
      req.body?.name || ""
    ).trim();

    const serial = String(
      req.body?.serial || ""
    ).trim();

    const pairingSecret = String(
      req.body?.pairing_secret || ""
    );

    if (!name || !serial || !pairingSecret) {
      return res.status(400).json({
        error: "Eksik cihaz bilgisi."
      });
    }

    const deviceId =
      crypto.randomUUID();

    await pool.query(
      `
        INSERT INTO devices
        (id, user_id, serial, name, pairing_secret)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        deviceId,
        user.id,
        serial,
        name,
        pairingSecret
      ]
    );

    res.json({
      ok: true,
      device: {
        id: deviceId,
        name,
        serial
      }
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Bu cihaz zaten hesabınıza bağlı."
      });
    }

    console.error(error);

    res.status(500).json({
      error: "Cihaz eklenemedi."
    });
  }
});

/*
 * ---------------------------------------------------------
 * SOCKET.IO
 * ---------------------------------------------------------
 */

const registry = new Map();

io.on("connection", (socket) => {

  let boundSerial = null;

  socket.on(
    "device:register",
    async ({ serial, token, role }) => {

      if (!serial || !role) {
        return;
      }

      /*
       * Dashboard
       */

      if (role === "dashboard") {

        try {
          const user =
            await getUserFromSocketToken(token);

          if (!user) {
            socket.emit(
              "device:registered",
              {
                ok: false,
                error: "Oturum geçersiz."
              }
            );

            return;
          }

          const device =
            await pool.query(
              `
                SELECT id
                FROM devices
                WHERE user_id = $1
                  AND serial = $2
              `,
              [user.id, serial]
            );

          if (device.rows.length === 0) {
            socket.emit(
              "device:registered",
              {
                ok: false,
                error: "Cihaz hesabınıza ait değil."
              }
            );

            return;
          }

          boundSerial = serial;

          socket.join(
            `device:${serial}`
          );

          registry.set(
            `dashboard:${socket.id}`,
            {
              socketId: socket.id,
              role,
              userId: user.id
            }
          );

          socket.emit(
            "device:registered",
            {
              ok: true
            }
          );

        } catch (error) {
          console.error(error);
        }

        return;
      }

      /*
       * Agent
       *
       * Burada token ile değil cihazın
       * kalıcı pairing_secret bilgisiyle
       * doğrulama yapacağız.
       */

      if (role === "agent") {

        try {
          const result =
            await pool.query(
              `
                SELECT
                  id,
                  user_id
                FROM devices
                WHERE serial = $1
                  AND pairing_secret = $2
              `,
              [serial, token]
            );

          if (result.rows.length === 0) {

            socket.emit(
              "device:registered",
              {
                ok: false,
                error: "Cihaz doğrulanamadı."
              }
            );

            return;
          }

          boundSerial = serial;

          socket.join(
            `device:${serial}`
          );

          registry.set(
            serial,
            {
              socketId: socket.id,
              role,
              userId: result.rows[0].user_id
            }
          );

          await pool.query(
            `
              UPDATE devices
              SET last_seen = NOW()
              WHERE serial = $1
            `,
            [serial]
          );

          socket.emit(
            "device:registered",
            {
              ok: true
            }
          );

          io.to(
            `device:${serial}`
          ).emit(
            "device:presence",
            {
              serial,
              agentOnline: true
            }
          );

        } catch (error) {
          console.error(error);
        }
      }
    }
  );

  /*
   * Relay
   */

  socket.on(
    "relay:message",
    ({ serial, payload, type }) => {

      if (!serial || !payload) {
        return;
      }

      socket
        .to(`device:${serial}`)
        .emit(
          "relay:message",
          {
            type: type || "generic",
            payload,
            ts: Date.now()
          }
        );
    }
  );

  socket.on("disconnect", () => {

    if (!boundSerial) {
      return;
    }

    const current =
      registry.get(boundSerial);

    if (
      current &&
      current.socketId === socket.id
    ) {
      registry.delete(boundSerial);

      io.to(
        `device:${boundSerial}`
      ).emit(
        "device:presence",
        {
          serial: boundSerial,
          agentOnline: false
        }
      );
    }
  });
});

/*
 * Socket token helper
 */

async function getUserFromSocketToken(token) {

  if (!token) {
    return null;
  }

  const result =
    await pool.query(
      `
        SELECT
          users.id,
          users.username
        FROM sessions
        JOIN users
          ON users.id = sessions.user_id
        WHERE sessions.token = $1
          AND sessions.expires_at > NOW()
      `,
      [token]
    );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/*
 * ---------------------------------------------------------
 * START
 * ---------------------------------------------------------
 */

initDatabase()
  .then(() => {

    server.listen(
      PORT,
      () => {
        console.log(
          `[BELUGA] Gateway ${PORT} portunda çalışıyor.`
        );
      }
    );

  })
  .catch((error) => {

    console.error(
      "[BELUGA] Database başlatılamadı:",
      error
    );

    process.exit(1);
  });
