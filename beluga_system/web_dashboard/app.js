const GATEWAY_URL =
    window.BELUGA_GATEWAY_URL ||
    "https://belugasys.onrender.com";

let authToken =
    localStorage.getItem("beluga_auth_token");

let currentUser = null;
let devices = [];
let activeDevice = null;
let socket = null;

const $ = (id) => document.getElementById(id);


/* =========================================================
   AUTH
   ========================================================= */

function showAuthError(message) {
    const el = $("authError");

    if (el) {
        el.textContent = message;
    }
}


function saveAuth(token, user) {

    authToken = token;
    currentUser = user;

    localStorage.setItem(
        "beluga_auth_token",
        token
    );

    localStorage.setItem(
        "beluga_user",
        JSON.stringify(user)
    );
}


async function login() {

    const username =
        $("loginUsername")?.value.trim();

    const password =
        $("loginPassword")?.value;

    if (!username || !password) {

        showAuthError(
            "Kullanıcı adı ve parola gerekli."
        );

        return;
    }

    try {

        const response =
            await fetch(
                `${GATEWAY_URL}/api/auth/login`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        username,
                        password
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Giriş başarısız."
            );
        }

        saveAuth(
            data.token,
            data.user
        );

        openApplication();

    } catch (error) {

        showAuthError(
            error.message
        );
    }
}


async function register() {

    const username =
        $("registerUsername")?.value.trim();

    const password =
        $("registerPassword")?.value;

    const password2 =
        $("registerPassword2")?.value;

    if (!username || !password) {

        showAuthError(
            "Tüm alanları doldur."
        );

        return;
    }

    if (password !== password2) {

        showAuthError(
            "Parolalar aynı değil."
        );

        return;
    }

    try {

        const response =
            await fetch(
                `${GATEWAY_URL}/api/auth/register`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        username,
                        password
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {

            throw new Error(
                data.error ||
                "Kayıt başarısız."
            );
        }

        saveAuth(
            data.token,
            data.user
        );

        openApplication();

    } catch (error) {

        showAuthError(
            error.message
        );
    }
}


async function logout() {

    try {

        await apiFetch(
            "/api/auth/logout",
            {
                method: "POST"
            }
        );

    } catch (_) {}

    localStorage.removeItem(
        "beluga_auth_token"
    );

    localStorage.removeItem(
        "beluga_user"
    );

    authToken = null;
    currentUser = null;

    if (socket) {

        try {
            socket.disconnect();
        } catch (_) {}

        socket = null;
    }

    $("app")?.classList.add("hidden");
    $("authScreen")?.classList.remove("hidden");
}


/* =========================================================
   API
   ========================================================= */

async function apiFetch(
    path,
    options = {}
) {

    const headers = {
        ...(options.headers || {})
    };

    if (authToken) {

        headers.Authorization =
            `Bearer ${authToken}`;
    }

    const response =
        await fetch(
            `${GATEWAY_URL}${path}`,
            {
                ...options,
                headers
            }
        );

    let data = {};

    try {

        data =
            await response.json();

    } catch (_) {}

    if (response.status === 401) {

        await logout();

        throw new Error(
            "Oturum sona erdi."
        );
    }

    if (!response.ok) {

        throw new Error(
            data.error ||
            "İstek başarısız."
        );
    }

    return data;
}


/* =========================================================
   APPLICATION
   ========================================================= */

function openApplication() {

    $("authScreen")
        ?.classList
        .add("hidden");

    $("app")
        ?.classList
        .remove("hidden");

    if ($("usernameLabel")) {

        $("usernameLabel")
            .textContent =
            currentUser?.username || "";
    }

    if ($("settingsUsername")) {

        $("settingsUsername")
            .textContent =
            currentUser?.username || "";
    }

    loadDevices();
    connectSocket();
    checkGateway();
}


async function restoreSession() {

    if (!authToken) {
        return;
    }

    try {

        const data =
            await apiFetch(
                "/api/auth/me"
            );

        currentUser =
            data.user;

        openApplication();

    } catch (_) {}
}


/* =========================================================
   DEVICES
   ========================================================= */

async function loadDevices() {

    try {

        const data =
            await apiFetch(
                "/api/devices"
            );

        devices =
            data.devices || [];

        renderDevices();

        if ($("deviceCount")) {

            $("deviceCount")
                .textContent =
                devices.length;
        }

        if (
            !activeDevice &&
            devices.length
        ) {

            selectDevice(
                devices[0]
            );
        }

    } catch (error) {

        console.error(error);

        addLog(
            `Cihazlar yüklenemedi: ${error.message}`,
            "error"
        );
    }
}


function renderDevices() {

    const container =
        $("deviceList");

    if (!container) {
        return;
    }

    container.innerHTML = "";

    for (const device of devices) {

        const card =
            document.createElement("div");

        card.className =
            "device-card";

        card.innerHTML = `
            <div class="device-icon">
                PC
            </div>

            <div class="device-info">

                <strong>
                    ${escapeHtml(
                        device.name || "Cihaz"
                    )}
                </strong>

                <span>
                    ${escapeHtml(
                        device.serial || ""
                    )}
                </span>

                <small>
                    ● Hazır
                </small>

            </div>
        `;

        card.onclick = () =>
            selectDevice(device);

        container.appendChild(card);
    }
}


async function selectDevice(device) {

    activeDevice = device;

    if ($("activeDeviceLabel")) {

        $("activeDeviceLabel")
            .textContent =
            device.name;
    }

    if (
        socket &&
        socket.connected
    ) {

        socket.emit(
            "device:register",
            {
                serial:
                    device.serial,

                role:
                    "dashboard",

                token:
                    authToken
            }
        );
    }

    navigate("brain");
}


/* =========================================================
   SOCKET
   ========================================================= */

function connectSocket() {

    if (socket) {

        try {
            socket.disconnect();
        } catch (_) {}
    }

    socket =
        io(
            GATEWAY_URL,
            {
                transports: [
                    "polling",
                    "websocket"
                ]
            }
        );


    socket.on(
        "connect",
        () => {

            if ($("gatewayStatus")) {

                $("gatewayStatus")
                    .textContent =
                    "● Gateway Online";
            }

            if ($("gatewayCard")) {

                $("gatewayCard")
                    .textContent =
                    "ONLINE";
            }

            if (activeDevice) {

                socket.emit(
                    "device:register",
                    {
                        serial:
                            activeDevice.serial,

                        role:
                            "dashboard",

                        token:
                            authToken
                    }
                );
            }
        }
    );


    socket.on(
        "disconnect",
        () => {

            if ($("gatewayStatus")) {

                $("gatewayStatus")
                    .textContent =
                    "○ Gateway Offline";
            }

            if ($("gatewayCard")) {

                $("gatewayCard")
                    .textContent =
                    "OFFLINE";
            }
        }
    );


    socket.on(
        "device:registered",
        (data) => {

            if (!data?.ok) {

                addLog(
                    `Beluga: ${
                        data?.error ||
                        "Cihaz kaydı başarısız."
                    }`,
                    "error"
                );

                return;
            }

            addLog(
                "Beluga: cihaz bağlantısı hazır.",
                "system"
            );
        }
    );


    socket.on(
        "device:presence",
        (data) => {

            if (!data?.serial) {
                return;
            }

            addLog(
                data.agentOnline
                    ? "Beluga Agent online."
                    : "Beluga Agent offline.",
                "system"
            );
        }
    );


    socket.on(
        "relay:message",
        async (data) => {

            if (!data) {
                return;
            }

            if (
                activeDevice &&
                data.serial &&
                data.serial !==
                    activeDevice.serial
            ) {
                return;
            }

            try {

                const payload =
                    data.payload;

                if (
                    payload &&
                    payload.nonce &&
                    payload.ciphertext &&
                    activeDevice
                ) {

                    const secret =
                        getDeviceSecret(
                            activeDevice.serial
                        );

                    if (!secret) {

                        addLog(
                            "Cihaz yanıtı geldi ancak pairing secret bulunamadı.",
                            "error"
                        );

                        return;
                    }

                    const key =
                        await deriveKey(
                            secret
                        );

                    const decrypted =
                        await decryptPayload(
                            key,
                            payload
                        );

                    handleAgentResponse(
                        decrypted
                    );

                    return;
                }

                addLog(
                    "Cihazdan yanıt alındı.",
                    "agent"
                );

            } catch (error) {

                addLog(
                    `Cihaz yanıtı çözülemedi: ${error.message}`,
                    "error"
                );
            }
        }
    );
}


/* =========================================================
   AGENT RESPONSE
   ========================================================= */

function handleAgentResponse(data) {

    if (!data) {
        return;
    }


    if (typeof data === "string") {

        addLog(
            `Agent: ${data}`,
            "agent"
        );

        return;
    }


    if (data.ok === false) {

        addLog(
            `Agent: ${
                data.error ||
                "Komut başarısız."
            }`,
            "error"
        );

        return;
    }


    if (data.message) {

        addLog(
            `Beluga: ${data.message}`,
            "agent"
        );

        return;
    }


    if (!data.result) {

        addLog(
            `Agent: ${JSON.stringify(data)}`,
            "agent"
        );

        return;
    }


    const result =
        data.result;


    if (result.ok === false) {

        addLog(
            `Agent: ${
                result.error ||
                "Komut başarısız."
            }`,
            "error"
        );

        return;
    }


    /*
     * SCREENSHOT
     */

    if (
        result.data &&
        typeof result.data === "object" &&
        result.data.image_base64
    ) {

        showScreenshot(
            result.data.image_base64
        );

        return;
    }


    /*
     * SYSTEM STATUS
     */

    if (
        result.data &&
        typeof result.data === "object" &&
        (
            "cpu_percent" in result.data ||
            "ram_percent" in result.data ||
            "disk_percent" in result.data
        )
    ) {

        showSystemStatus(
            result.data
        );

        return;
    }


    /*
     * STRING
     */

    if (
        typeof result.data === "string"
    ) {

        addLog(
            `Agent: ${result.data}`,
            "agent"
        );

        return;
    }


    /*
     * OBJECT
     */

    addLog(
        `Agent: ${
            JSON.stringify(
                result.data ?? result
            )
        }`,
        "agent"
    );
}


/* =========================================================
   SCREENSHOT
   ========================================================= */

function showScreenshot(base64) {

    const consoleEl =
        $("consoleLog");

    if (!consoleEl) {
        return;
    }

    const wrapper =
        document.createElement("div");

    wrapper.className =
        "console-line agent screenshot-result";


    const title =
        document.createElement("div");

    title.textContent =
        "Beluga • Ekran Görüntüsü";

    title.style.fontWeight =
        "700";

    title.style.marginBottom =
        "10px";


    const image =
        document.createElement("img");

    image.src =
        `data:image/jpeg;base64,${base64}`;

    image.alt =
        "Beluga ekran görüntüsü";

    image.style.display =
        "block";

    image.style.maxWidth =
        "100%";

    image.style.width =
        "min(900px, 100%)";

    image.style.height =
        "auto";

    image.style.borderRadius =
        "14px";

    image.style.cursor =
        "pointer";

    image.title =
        "Büyütmek için tıkla";


    image.onclick = () => {

        const newWindow =
            window.open();

        if (!newWindow) {
            return;
        }

        newWindow.document.write(`
            <!DOCTYPE html>

            <html>

            <head>

                <meta charset="UTF-8">

                <title>
                    Beluga Screenshot
                </title>

                <style>

                    html,
                    body {
                        margin: 0;
                        width: 100%;
                        height: 100%;
                        background: #111;
                    }

                    body {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }

                    img {
                        max-width: 100%;
                        max-height: 100%;
                        object-fit: contain;
                    }

                </style>

            </head>

            <body>

                <img src="${image.src}">

            </body>

            </html>
        `);

        newWindow.document.close();
    };


    wrapper.appendChild(title);
    wrapper.appendChild(image);

    consoleEl.appendChild(wrapper);

    consoleEl.scrollTop =
        consoleEl.scrollHeight;
}


/* =========================================================
   SYSTEM STATUS
   ========================================================= */

function showSystemStatus(status) {

    const consoleEl =
        $("consoleLog");

    if (!consoleEl) {
        return;
    }


    const card =
        document.createElement("div");

    card.className =
        "system-status-result";

    card.style.padding =
        "16px";

    card.style.marginTop =
        "10px";

    card.style.borderRadius =
        "14px";

    card.style.background =
        "rgba(255,255,255,0.05)";


    const title =
        document.createElement("div");

    title.textContent =
        "Beluga • Sistem Durumu";

    title.style.fontSize =
        "18px";

    title.style.fontWeight =
        "700";

    title.style.marginBottom =
        "14px";


    const grid =
        document.createElement("div");

    grid.style.display =
        "grid";

    grid.style.gridTemplateColumns =
        "repeat(auto-fit, minmax(150px, 1fr))";

    grid.style.gap =
        "10px";


    addStatusItem(
        grid,
        "CPU",
        `${status.cpu_percent ?? 0}%`
    );


    addStatusItem(
        grid,
        "RAM",
        `${status.ram_percent ?? 0}%`
    );


    addStatusItem(
        grid,
        "Disk",
        `${status.disk_percent ?? 0}%`
    );


    addStatusItem(
        grid,
        "İşletim Sistemi",
        status.os || "Bilinmiyor"
    );


    addStatusItem(
        grid,
        "Bilgisayar",
        status.hostname || "Bilinmiyor"
    );


    if (
        status.battery_percent !== null &&
        status.battery_percent !== undefined
    ) {

        addStatusItem(
            grid,
            "Batarya",
            `${status.battery_percent}%`
        );

    } else {

        addStatusItem(
            grid,
            "Batarya",
            "Yok"
        );
    }


    if (
        status.battery_plugged !== null &&
        status.battery_plugged !== undefined
    ) {

        addStatusItem(
            grid,
            "Şarj",
            status.battery_plugged
                ? "Bağlı"
                : "Bağlı değil"
        );
    }


    if (
        status.uptime_seconds !==
        undefined
    ) {

        addStatusItem(
            grid,
            "Çalışma Süresi",
            formatUptime(
                status.uptime_seconds
            )
        );
    }


    card.appendChild(title);
    card.appendChild(grid);

    consoleEl.appendChild(card);

    consoleEl.scrollTop =
        consoleEl.scrollHeight;
}


function addStatusItem(
    parent,
    label,
    value
) {

    const item =
        document.createElement("div");

    item.style.padding =
        "12px";

    item.style.borderRadius =
        "10px";

    item.style.background =
        "rgba(255,255,255,0.05)";


    const labelEl =
        document.createElement("div");

    labelEl.textContent =
        label;

    labelEl.style.fontSize =
        "12px";

    labelEl.style.opacity =
        "0.65";


    const valueEl =
        document.createElement("div");

    valueEl.textContent =
        value;

    valueEl.style.fontSize =
        "15px";

    valueEl.style.fontWeight =
        "600";

    valueEl.style.marginTop =
        "4px";


    item.appendChild(labelEl);
    item.appendChild(valueEl);

    parent.appendChild(item);
}


function formatUptime(seconds) {

    const total =
        Number(seconds) || 0;

    const days =
        Math.floor(
            total / 86400
        );

    const hours =
        Math.floor(
            (total % 86400) / 3600
        );

    const minutes =
        Math.floor(
            (total % 3600) / 60
        );

    return `${days}g ${hours}s ${minutes}dk`;
}


/* =========================================================
   DEVICE SECRETS
   ========================================================= */

function getAllDeviceSecrets() {

    try {

        return JSON.parse(
            localStorage.getItem(
                "beluga_device_secrets"
            ) || "{}"
        );

    } catch (_) {

        return {};
    }
}


function getDeviceSecret(serial) {

    const secrets =
        getAllDeviceSecrets();

    return secrets[serial] || "";
}


function saveDeviceSecret(
    serial,
    secret
) {

    if (!serial || !secret) {
        return;
    }

    const secrets =
        getAllDeviceSecrets();

    secrets[serial] =
        secret;

    localStorage.setItem(
        "beluga_device_secrets",
        JSON.stringify(secrets)
    );
}


function rememberPairingSecret(
    responseData,
    serial,
    fallbackSecret = ""
) {

    const serverDevice =
        responseData?.device;

    const secret =
        serverDevice?.pairing_secret ||
        responseData?.pairing_secret ||
        fallbackSecret ||
        "";

    if (!secret) {
        return "";
    }

    saveDeviceSecret(
        serial,
        secret
    );

    return secret;
}


/* =========================================================
   COMMANDS
   ========================================================= */

async function sendCommand(
    command,
    params = {}
) {

    if (!activeDevice) {

        addLog(
            "Önce bir cihaz seç.",
            "error"
        );

        return false;
    }


    if (
        !socket ||
        !socket.connected
    ) {

        addLog(
            "Gateway bağlantısı yok.",
            "error"
        );

        return false;
    }


    const secret =
        getDeviceSecret(
            activeDevice.serial
        );

    if (!secret) {

        addLog(
            "Bu cihazın pairing secret'ı bulunamadı.",
            "error"
        );

        return false;
    }


    try {

        const key =
            await deriveKey(
                secret
            );

        const requestId =
            crypto.randomUUID();

        const encrypted =
            await encryptPayload(
                key,
                {
                    command,
                    params,
                    request_id:
                        requestId
                }
            );


        socket.emit(
            "relay:message",
            {
                serial:
                    activeDevice.serial,

                type:
                    "command",

                payload:
                    encrypted
            }
        );


        addLog(
            `Komut: ${command}`,
            "user"
        );

        return true;

    } catch (error) {

        addLog(
            `Komut gönderilemedi: ${error.message}`,
            "error"
        );

        return false;
    }
}


/* =========================================================
   BRAIN
   ========================================================= */

async function sendBrainCommand() {

    const input =
        $("commandInput");

    if (!input) {
        return;
    }


    const text =
        input.value.trim();

    if (!text) {
        return;
    }


    addLog(
        `Siz: ${text}`,
        "user"
    );

    input.value = "";


    const normalized =
        text
            .toLowerCase()
            .trim();


    /*
     * PRIVATE SYSTEM
     */

    if (
        normalized === "privatesystem" ||
        normalized === "private system" ||
        normalized === "özel sistem" ||
        normalized === "özel moda geç"
    ) {

        addLog(
            "Beluga: Private System etkinleştiriliyor...",
            "system"
        );

        await sendCommand(
            "privatesystem"
        );

        return;
    }


    /*
     * NORMAL SYSTEM
     */

    if (
        normalized === "onsystemlight" ||
        normalized === "on system light" ||
        normalized === "özel sistemden çık" ||
        normalized === "normal moda geç"
    ) {

        addLog(
            "Beluga: sistem normal moda döndürülüyor...",
            "system"
        );

        await sendCommand(
            "onsystemlight"
        );

        return;
    }


    addLog(
        "Beluga Brain isteği analiz ediyor...",
        "system"
    );


    const commandMap = [

        {
            keywords: [
                "private system",
                "privatesystem",
                "özel sistem",
                "özel moda geç"
            ],
            command:
                "privatesystem"
        },

        {
            keywords: [
                "onsystemlight",
                "on system light",
                "özel sistemden çık",
                "normal moda geç"
            ],
            command:
                "onsystemlight"
        },

        {
            keywords: [
                "screenshot",
                "screen shot",
                "ekran görüntüsü",
                "ekran görüntüsü al",
                "ekranı göster",
                "ekranı görüntüle",
                "ekranı çek",
                "ekran resmi"
            ],
            command:
                "screenshot"
        },

        {
            keywords: [
                "system_status",
                "system status",
                "sistem durumu",
                "sistem durumunu göster",
                "bilgisayar durumu",
                "pc durumu",
                "bilgisayarın durumunu göster",
                "sistemi kontrol et"
            ],
            command:
                "system_status"
        },

        {
            keywords: [
                "mouse_move",
                "mouse move",
                "fareyi hareket ettir",
                "fareyi götür"
            ],
            command:
                "mouse_move"
        },

        {
            keywords: [
                "mouse_click",
                "mouse click",
                "fareye tıkla",
                "fare ile tıkla",
                "tıkla"
            ],
            command:
                "mouse_click"
        },

        {
            keywords: [
                "type_text",
                "type text",
                "metin yaz",
                "yaz"
            ],
            command:
                "type_text"
        },

        {
            keywords: [
                "key_press",
                "key press",
                "tuşa bas"
            ],
            command:
                "key_press"
        },

        {
            keywords: [
                "open_app",
                "open app",
                "uygulama aç",
                "program aç",
                "uygulamayı aç"
            ],
            command:
                "open_app"
        },

        {
            keywords: [
                "lock_screen",
                "lock screen",
                "ekranı kilitle",
                "bilgisayarı kilitle",
                "pc'yi kilitle",
                "pc yi kilitle"
            ],
            command:
                "lock_screen"
        }
    ];


    for (
        const item of commandMap
    ) {

        const found =
            item.keywords.some(
                keyword =>
                    normalized.includes(
                        keyword
                    )
            );

        if (!found) {
            continue;
        }


        addLog(
            `Beluga Brain: ${item.command}`,
            "system"
        );


        await sendCommand(
            item.command
        );

        return;
    }


    addLog(
        "Beluga Brain: Bu komut için henüz bir işlem tanımlanmadı.",
        "system"
    );
}


/* =========================================================
   PRIVATE SYSTEM
   ========================================================= */

function updatePrivateSystemStatus(
    text,
    active = false
) {

    const status =
        $("privateSystemStatus");

    if (!status) {
        return;
    }

    status.textContent =
        text;

    status.classList.toggle(
        "active",
        active
    );
}


async function enablePrivateSystem() {

    if (!activeDevice) {

        addLog(
            "Önce bir cihaz seç.",
            "error"
        );

        return;
    }


    updatePrivateSystemStatus(
        "Etkinleştiriliyor...",
        false
    );


    const success =
        await sendCommand(
            "privatesystem"
        );


    if (success) {

        updatePrivateSystemStatus(
            "Private System aktif",
            true
        );
    }
}


async function disablePrivateSystem() {

    if (!activeDevice) {

        addLog(
            "Önce bir cihaz seç.",
            "error"
        );

        return;
    }


    updatePrivateSystemStatus(
        "Normal moda dönülüyor...",
        false
    );


    const success =
        await sendCommand(
            "onsystemlight"
        );


    if (success) {

        updatePrivateSystemStatus(
            "Normal sistem",
            false
        );
    }
}


/* =========================================================
   UI
   ========================================================= */

function navigate(page) {

    document
        .querySelectorAll(".page")
        .forEach(
            element => {

                element.classList.remove(
                    "active"
                );
            }
        );


    const target =
        $(`${page}Page`);


    if (target) {

        target.classList.add(
            "active"
        );
    }


    document
        .querySelectorAll(".nav-item")
        .forEach(
            button => {

                button.classList.toggle(
                    "active",
                    button.dataset.page === page
                );
            }
        );
}


function addLog(
    text,
    type = "system"
) {

    const consoleEl =
        $("consoleLog");

    if (!consoleEl) {
        return;
    }


    const line =
        document.createElement("div");

    line.className =
        `console-line ${type}`;

    line.textContent =
        text;


    consoleEl.appendChild(
        line
    );


    consoleEl.scrollTop =
        consoleEl.scrollHeight;
}


function escapeHtml(text) {

    return String(text)
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}


/* =========================================================
   GATEWAY
   ========================================================= */

async function checkGateway() {

    try {

        const response =
            await fetch(
                `${GATEWAY_URL}/health`
            );

        const data =
            await response.json();


        if ($("gatewayStatus")) {

            $("gatewayStatus")
                .textContent =
                data.database
                    ? "● Gateway + Database Online"
                    : "● Gateway Online";
        }


        if ($("gatewayCard")) {

            $("gatewayCard")
                .textContent =
                data.database
                    ? "ONLINE"
                    : "NO DATABASE";
        }

    } catch (_) {

        if ($("gatewayStatus")) {

            $("gatewayStatus")
                .textContent =
                "○ Gateway Offline";
        }

        if ($("gatewayCard")) {

            $("gatewayCard")
                .textContent =
                "OFFLINE";
        }
    }
}


/* =========================================================
   EVENTS
   ========================================================= */

if ($("loginBtn")) {

    $("loginBtn").onclick =
        login;
}


if ($("registerBtn")) {

    $("registerBtn").onclick =
        register;
}


if ($("logoutBtn")) {

    $("logoutBtn").onclick =
        logout;
}


if ($("showRegisterBtn")) {

    $("showRegisterBtn").onclick =
        () => {

            $("loginBox")
                ?.classList
                .add("hidden");

            $("registerBox")
                ?.classList
                .remove("hidden");

            showAuthError("");
        };
}


if ($("showLoginBtn")) {

    $("showLoginBtn").onclick =
        () => {

            $("registerBox")
                ?.classList
                .add("hidden");

            $("loginBox")
                ?.classList
                .remove("hidden");

            showAuthError("");
        };
}


if ($("sendBtn")) {

    $("sendBtn").onclick =
        sendBrainCommand;
}


if ($("commandInput")) {

    $("commandInput")
        .addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Enter" &&
                    !event.shiftKey
                ) {

                    event.preventDefault();

                    sendBrainCommand();
                }
            }
        );
}


if ($("openBrainBtn")) {

    $("openBrainBtn").onclick =
        () =>
            navigate("brain");
}


/* =========================================================
   NAVIGATION
   ========================================================= */

document
    .querySelectorAll(".nav-item")
    .forEach(
        button => {

            button.onclick =
                () =>
                    navigate(
                        button.dataset.page
                    );
        }
    );


/* =========================================================
   ADD DEVICE
   ========================================================= */

if ($("addDeviceBtn")) {

    $("addDeviceBtn").onclick =
        () => {

            $("deviceModal")
                ?.classList
                .remove("hidden");
        };
}


if ($("closeDeviceBtn")) {

    $("closeDeviceBtn").onclick =
        () => {

            $("deviceModal")
                ?.classList
                .add("hidden");
        };
}


/* =========================================================
   SAVE DEVICE
   ========================================================= */

if ($("saveDeviceBtn")) {

    $("saveDeviceBtn").onclick =
        async () => {

            const name =
                $("deviceName")
                    ?.value
                    .trim();

            const serial =
                $("deviceSerial")
                    ?.value
                    .trim();

            const secret =
                $("deviceSecret")
                    ?.value
                    .trim();


            if (!name || !serial) {

                addLog(
                    "Cihaz adı ve serial gerekli.",
                    "error"
                );

                return;
            }


            try {

                const response =
                    await apiFetch(
                        "/api/devices",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    name,
                                    serial,
                                    pairing_secret:
                                        secret ||
                                        undefined
                                })
                        }
                    );


                const savedSecret =
                    rememberPairingSecret(
                        response,
                        serial,
                        secret
                    );


                if (savedSecret) {

                    addLog(
                        "Cihaz pairing secret ile kaydedildi.",
                        "system"
                    );

                } else {

                    addLog(
                        "Cihaz oluşturuldu ancak pairing secret alınamadı.",
                        "error"
                    );
                }


                $("deviceModal")
                    ?.classList
                    .add("hidden");


                if ($("deviceName")) {
                    $("deviceName").value = "";
                }

                if ($("deviceSerial")) {
                    $("deviceSerial").value = "";
                }

                if ($("deviceSecret")) {
                    $("deviceSecret").value = "";
                }


                await loadDevices();

            } catch (error) {

                addLog(
                    `Cihaz eklenemedi: ${error.message}`,
                    "error"
                );
            }
        };
}


/* =========================================================
   PRIVATE SYSTEM BUTTONS
   ========================================================= */

if ($("privateSystemBtn")) {

    $("privateSystemBtn").onclick =
        enablePrivateSystem;
}


if ($("onSystemLightBtn")) {

    $("onSystemLightBtn").onclick =
        disablePrivateSystem;
}


if ($("enablePrivateSystemBtn")) {

    $("enablePrivateSystemBtn").onclick =
        enablePrivateSystem;
}


if ($("disablePrivateSystemBtn")) {

    $("disablePrivateSystemBtn").onclick =
        disablePrivateSystem;
}


/* =========================================================
   START
   ========================================================= */

restoreSession();
