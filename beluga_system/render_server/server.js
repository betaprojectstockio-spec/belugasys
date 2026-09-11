require("dotenv").config();

const express = require("express");
const http = require("http");
const helmet = require("helmet");
const cors = require("cors");
const crypto = require("crypto");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const PORT = process.env.PORT || 10000;

const allowedOrigins =
    process.env.ALLOWED_ORIGINS || "*";

const app = express();

app.use(helmet());

app.use(
    cors({
        origin:
            allowedOrigins === "*"
                ? "*"
                : allowedOrigins.split(","),
    })
);

app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin:
            allowedOrigins === "*"
                ? "*"
                : allowedOrigins.split(","),
        methods: ["GET", "POST"],
    },
});


/* =========================================================
   DATABASE
========================================================= */

if (!process.env.DATABASE_URL) {
    console.error(
        "[BELUGA] DATABASE_URL tanimli degil."
    );
    process.exit(1);
}

const pool = new Pool({
    connectionString:
        process.env.DATABASE_URL,

    ssl:
        process.env.NODE_ENV === "production"
            ? {
                  rejectUnauthorized: false,
              }
            : false,
});


async function initDatabase() {

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id UUID NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS devices (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL
                REFERENCES users(id)
                ON DELETE CASCADE,

            serial TEXT NOT NULL,

            name TEXT NOT NULL,

            pairing_secret_hash TEXT NOT NULL,

            created_at TIMESTAMPTZ DEFAULT NOW(),

            last_seen TIMESTAMPTZ,

            UNIQUE(user_id, serial)
        );

        CREATE INDEX IF NOT EXISTS
            sessions_user_idx
        ON sessions(user_id);

        CREATE INDEX IF NOT EXISTS
            devices_user_idx
        ON devices(user_id);
    `);

    console.log(
        "[BELUGA] PostgreSQL database hazir."
    );
}


/* =========================================================
   SECURITY
========================================================= */

function hashSecret(value) {

    return crypto
        .createHash("sha256")
        .update(String(value), "utf8")
        .digest("hex");
}


function hashPassword(password) {

    return new Promise(
        (resolve, reject) => {

            const salt =
                crypto.randomBytes(16);

            crypto.scrypt(
                password,
                salt,
                64,
                (error, key) => {

                    if (error) {
                        reject(error);
                        return;
                    }

                    resolve(
                        salt.toString("hex") +
                        ":" +
                        key.toString("hex")
                    );
                }
            );
        }
    );
}


function verifyPassword(
    password,
    stored
) {

    return new Promise(
        (resolve, reject) => {

            const parts =
                stored.split(":");

            if (parts.length !== 2) {
                resolve(false);
                return;
            }

            const salt =
                Buffer.from(
                    parts[0],
                    "hex"
                );

            const expected =
                Buffer.from(
                    parts[1],
                    "hex"
                );

            crypto.scrypt(
                password,
                salt,
                64,
                (error, key) => {

                    if (error) {
                        reject(error);
                        return;
                    }

                    if (
                        key.length !==
                        expected.length
                    ) {
                        resolve(false);
                        return;
                    }

                    resolve(
                        crypto.timingSafeEqual(
                            key,
                            expected
                        )
                    );
                }
            );
        }
    );
}


/* =========================================================
   SESSIONS
========================================================= */

async function createSession(
    userId
) {

    const token =
        crypto.randomBytes(48)
            .toString("hex");

    await pool.query(
        `
        INSERT INTO sessions
        (
            token,
            user_id,
            expires_at
        )
        VALUES
        (
            $1,
            $2,
            NOW() + INTERVAL '30 days'
        )
        `,
        [
            token,
            userId,
        ]
    );

    return token;
}


async function getUserFromRequest(
    req
) {

    const header =
        req.headers.authorization || "";

    if (
        !header.startsWith(
            "Bearer "
        )
    ) {
        return null;
    }

    const token =
        header.substring(7).trim();

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
                ON users.id =
                   sessions.user_id
            WHERE
                sessions.token = $1
                AND sessions.expires_at > NOW()
            `,
            [token]
        );

    if (
        result.rows.length === 0
    ) {
        return null;
    }

    return {
        id: result.rows[0].id,
        username:
            result.rows[0].username,
        token,
    };
}


/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/health",
    async (req, res) => {

        try {

            await pool.query(
                "SELECT 1"
            );

            res.json({
                status: "alive",
                database: true,
                timestamp: Date.now(),
            });

        } catch (error) {

            console.error(
                "[BELUGA] DB health error:",
                error
            );

            res.status(503).json({
                status: "alive",
                database: false,
            });
        }
    }
);


/* =========================================================
   REGISTER
========================================================= */

app.post(
    "/api/auth/register",
    async (req, res) => {

        try {

            const username =
                String(
                    req.body?.username || ""
                ).trim();

            const password =
                String(
                    req.body?.password || ""
                );

            if (
                username.length < 3
            ) {
                return res.status(400)
                    .json({
                        error:
                            "Kullanici adi en az 3 karakter olmali.",
                    });
            }

            if (
                password.length < 8
            ) {
                return res.status(400)
                    .json({
                        error:
                            "Parola en az 8 karakter olmali.",
                    });
            }

            const existing =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE LOWER(username)
                          = LOWER($1)
                    `,
                    [username]
                );

            if (
                existing.rows.length
                > 0
            ) {
                return res.status(409)
                    .json({
                        error:
                            "Bu kullanici adi zaten kullaniliyor.",
                    });
            }

            const passwordHash =
                await hashPassword(
                    password
                );

            const userId =
                crypto.randomUUID();

            await pool.query(
                `
                INSERT INTO users
                (
                    id,
                    username,
                    password_hash
                )
                VALUES
                (
                    $1,
                    $2,
                    $3
                )
                `,
                [
                    userId,
                    username,
                    passwordHash,
                ]
            );

            const token =
                await createSession(
                    userId
                );

            res.json({
                ok: true,

                token,

                user: {
                    id: userId,
                    username,
                },
            });

        } catch (error) {

            console.error(
                "[REGISTER ERROR]",
                error
            );

            res.status(500).json({
                error:
                    "Hesap olusturulamadi.",
            });
        }
    }
);


/* =========================================================
   LOGIN
========================================================= */

app.post(
    "/api/auth/login",
    async (req, res) => {

        try {

            const username =
                String(
                    req.body?.username || ""
                ).trim();

            const password =
                String(
                    req.body?.password || ""
                );

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        username,
                        password_hash
                    FROM users
                    WHERE LOWER(username)
                          = LOWER($1)
                    `,
                    [username]
                );

            if (
                result.rows.length === 0
            ) {
                return res.status(401)
                    .json({
                        error:
                            "Kullanici adi veya parola hatali.",
                    });
            }

            const user =
                result.rows[0];

            const valid =
                await verifyPassword(
                    password,
                    user.password_hash
                );

            if (!valid) {
                return res.status(401)
                    .json({
                        error:
                            "Kullanici adi veya parola hatali.",
                    });
            }

            const token =
                await createSession(
                    user.id
                );

            res.json({
                ok: true,

                token,

                user: {
                    id: user.id,
                    username:
                        user.username,
                },
            });

        } catch (error) {

            console.error(
                "[LOGIN ERROR]",
                error
            );

            res.status(500).json({
                error:
                    "Giris yapilamadi.",
            });
        }
    }
);


/* =========================================================
   ME
========================================================= */

app.get(
    "/api/auth/me",
    async (req, res) => {

        try {

            const user =
                await getUserFromRequest(
                    req
                );

            if (!user) {
                return res.status(401)
                    .json({
                        error:
                            "Oturum gecersiz.",
                    });
            }

            res.json({
                ok: true,

                user: {
                    id: user.id,
                    username:
                        user.username,
                },
            });

        } catch (error) {

            res.status(500)
                .json({
                    error:
                        "Kullanici alinamadi.",
                });
        }
    }
);


/* =========================================================
   LOGOUT
========================================================= */

app.post(
    "/api/auth/logout",
    async (req, res) => {

        try {

            const user =
                await getUserFromRequest(
                    req
                );

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
                ok: true,
            });

        } catch (error) {

            res.status(500)
                .json({
                    error:
                        "Cikis yapilamadi.",
                });
        }
    }
);


/* =========================================================
   DEVICES
========================================================= */

app.get(
    "/api/devices",
    async (req, res) => {

        try {

            const user =
                await getUserFromRequest(
                    req
                );

            if (!user) {
                return res.status(401)
                    .json({
                        error:
                            "Oturum gerekli.",
                    });
            }

            const result =
                await pool.query(
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
                devices:
                    result.rows,
            });

        } catch (error) {

            console.error(
                "[DEVICES ERROR]",
                error
            );

            res.status(500)
                .json({
                    error:
                        "Cihazlar alinamadi.",
                });
        }
    }
);


/* =========================================================
   ADD DEVICE
========================================================= */

app.post(
    "/api/devices",
    async (req, res) => {

        try {

            const user =
                await getUserFromRequest(
                    req
                );

            if (!user) {
                return res.status(401)
                    .json({
                        error:
                            "Oturum gerekli.",
                    });
            }

            const name =
                String(
                    req.body?.name || ""
                ).trim();

            const serial =
                String(
                    req.body?.serial || ""
                ).trim();

            const secret =
                String(
                    req.body?.pairing_secret
                    || ""
                );

            if (
                !name ||
                !serial ||
                !secret
            ) {
                return res.status(400)
                    .json({
                        error:
                            "Cihaz bilgileri eksik.",
                    });
            }

            const deviceId =
                crypto.randomUUID();

            const secretHash =
                hashSecret(secret);

            await pool.query(
                `
                INSERT INTO devices
                (
                    id,
                    user_id,
                    serial,
                    name,
                    pairing_secret_hash
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5
                )
                `,
                [
                    deviceId,
                    user.id,
                    serial,
                    name,
                    secretHash,
                ]
            );

            res.json({
                ok: true,

                device: {
                    id: deviceId,
                    serial,
                    name,
                },
            });

        } catch (error) {

            console.error(
                "[ADD DEVICE ERROR]",
                error
            );

            if (
                error.code ===
                "23505"
            ) {
                return res.status(409)
                    .json({
                        error:
                            "Bu cihaz zaten hesaba bagli.",
                    });
            }

            res.status(500)
                .json({
                    error:
                        "Cihaz eklenemedi.",
                });
        }
    }
);


/* =========================================================
   SOCKET.IO
========================================================= */

const connectedAgents =
    new Map();


async function authenticateDashboard(
    token,
    serial
) {

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
                ON users.id =
                   sessions.user_id
            JOIN devices
                ON devices.user_id =
                   users.id
            WHERE
                sessions.token = $1
                AND sessions.expires_at > NOW()
                AND devices.serial = $2
            `,
            [
                token,
                serial,
            ]
        );

    if (
        result.rows.length === 0
    ) {
        return null;
    }

    return result.rows[0];
}


async function authenticateAgent(
    serial,
    secret
) {

    if (!serial || !secret) {
        return null;
    }

    const secretHash =
        hashSecret(secret);

    const result =
        await pool.query(
            `
            SELECT
                id,
                user_id
            FROM devices
            WHERE
                serial = $1
                AND pairing_secret_hash = $2
            `,
            [
                serial,
                secretHash,
            ]
        );

    if (
        result.rows.length === 0
    ) {
        return null;
    }

    return result.rows[0];
}


io.on(
    "connection",
    (socket) => {

        let boundSerial = null;
        let socketRole = null;


        /* ---------------------------------------------
           DEVICE REGISTER
        --------------------------------------------- */

        socket.on(
            "device:register",
            async (data = {}) => {

                try {

                    const serial =
                        String(
                            data.serial || ""
                        ).trim();

                    const role =
                        String(
                            data.role || ""
                        ).trim();

                    const token =
                        String(
                            data.token || ""
                        );

                    if (
                        !serial ||
                        !role
                    ) {

                        socket.emit(
                            "device:registered",
                            {
                                ok: false,

                                error:
                                    "Eksik cihaz bilgisi.",
                            }
                        );

                        return;
                    }


                    /* DASHBOARD */

                    if (
                        role ===
                        "dashboard"
                    ) {

                        const user =
                            await authenticateDashboard(
                                token,
                                serial
                            );

                        if (!user) {

                            socket.emit(
                                "device:registered",
                                {
                                    ok: false,

                                    error:
                                        "Dashboard cihaz yetkisi gecersiz.",
                                }
                            );

                            return;
                        }

                        boundSerial =
                            serial;

                        socketRole =
                            "dashboard";

                        socket.join(
                            `device:${serial}`
                        );

                        socket.emit(
                            "device:registered",
                            {
                                ok: true,

                                serial,
                            }
                        );

                        return;
                    }


                    /* AGENT */

                    if (
                        role === "agent"
                    ) {

                        const device =
                            await authenticateAgent(
                                serial,
                                token
                            );

                        if (!device) {

                            socket.emit(
                                "device:registered",
                                {
                                    ok: false,

                                    error:
                                        "Cihaz dogrulanamadi.",
                                }
                            );

                            return;
                        }

                        boundSerial =
                            serial;

                        socketRole =
                            "agent";

                        connectedAgents.set(
                            serial,
                            socket.id
                        );

                        socket.join(
                            `device:${serial}`
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
                                ok: true,

                                serial,
                            }
                        );

                        io.to(
                            `device:${serial}`
                        ).emit(
                            "device:presence",
                            {
                                serial,

                                agentOnline:
                                    true,
                            }
                        );

                        return;
                    }

                } catch (error) {

                    console.error(
                        "[SOCKET REGISTER ERROR]",
                        error
                    );

                    socket.emit(
                        "device:registered",
                        {
                            ok: false,

                            error:
                                "Sunucu cihaz kaydini isleyemedi.",
                        }
                    );
                }
            }
        );


        /* ---------------------------------------------
           ENCRYPTED RELAY

           Gateway payload'a DOKUNMUYOR.
        --------------------------------------------- */

        socket.on(
            "relay:message",
            (data = {}) => {

                if (
                    !boundSerial ||
                    !data.payload
                ) {
                    return;
                }

                socket
                    .to(
                        `device:${boundSerial}`
                    )
                    .emit(
                        "relay:message",
                        {
                            serial:
                                boundSerial,

                            type:
                                data.type ||
                                "encrypted",

                            payload:
                                data.payload,

                            request_id:
                                data.request_id ||
                                null,

                            ts:
                                Date.now(),
                        }
                    );
            }
        );


        /* ---------------------------------------------
           DISCONNECT
        --------------------------------------------- */

        socket.on(
            "disconnect",
            () => {

                if (
                    socketRole ===
                        "agent" &&
                    boundSerial
                ) {

                    const current =
                        connectedAgents.get(
                            boundSerial
                        );

                    if (
                        current ===
                        socket.id
                    ) {

                        connectedAgents.delete(
                            boundSerial
                        );

                        io.to(
                            `device:${boundSerial}`
                        ).emit(
                            "device:presence",
                            {
                                serial:
                                    boundSerial,

                                agentOnline:
                                    false,
                            }
                        );
                    }
                }
            }
        );
    }
);


/* =========================================================
   START
========================================================= */

async function start() {

    try {

        await initDatabase();

        server.listen(
            PORT,
            () => {

                console.log(
                    `[BELUGA] Gateway ${PORT} portunda calisiyor.`
                );
            }
        );

    } catch (error) {

        console.error(
            "[BELUGA] Baslatma hatasi:",
            error
        );

        process.exit(1);
    }
}

start();
