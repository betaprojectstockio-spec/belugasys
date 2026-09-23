const GATEWAY_URL =
    window.BELUGA_GATEWAY_URL ||
    "https://belugasys.onrender.com";

let authToken =
    localStorage.getItem("beluga_auth_token");

let currentUser = null;
let devices = [];
let activeDevice = null;
let socket = null;

const $ = (id) =>
    document.getElementById(id);


/*
 * ---------------------------------------------------------
 * AUTH
 * ---------------------------------------------------------
 */

function showAuthError(message) {
    const element = $("authError");

    if (element) {
        element.textContent = message;
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
        $("loginUsername").value.trim();

    const password =
        $("loginPassword").value;

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
        $("registerUsername")
            .value
            .trim();

    const password =
        $("registerPassword")
            .value;

    const password2 =
        $("registerPassword2")
            .value;

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

        socket.disconnect();
        socket = null;
    }

    const app = $("app");
    const authScreen = $("authScreen");

    if (app) {
        app.classList.add("hidden");
    }

    if (authScreen) {
        authScreen.classList.remove("hidden");
    }
}


/*
 * ---------------------------------------------------------
 * API
 * ---------------------------------------------------------
 */

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


/*
 * ---------------------------------------------------------
 * APP
 * ---------------------------------------------------------
 */

function openApplication() {

    $("authScreen")
        .classList
        .add("hidden");

    $("app")
        .classList
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


/*
 * ---------------------------------------------------------
 * DEVICES
 * ---------------------------------------------------------
 */

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
            devices.length > 0
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
                    ${escapeHtml(device.name)}
                </strong>

                <span>
                    ${escapeHtml(device.serial)}
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


/*
 * ---------------------------------------------------------
 * SOCKET
 * ---------------------------------------------------------
 */

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
                transports:
                    ["websocket"]
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

            if (!data.ok) {

                addLog(
                    `Beluga: ${data.error}`,
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

            if (!data.serial) {
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


    /*
     * Agent'tan gelen E2EE cevap
     */

    socket.on(
        "relay:message",
        async (data) => {

            if (!data) {
                return;
            }

            /*
             * Gateway'den gelen mesajın
             * gerçekten aktif cihaza ait
             * olduğundan emin ol.
             */

            if (
                activeDevice &&
                data.serial &&
                data.serial !== activeDevice.serial
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


/*
 * ---------------------------------------------------------
 * AGENT RESPONSE
 * ---------------------------------------------------------
 */

function handleAgentResponse(data) {

    if (!data) {
        return;
    }

    if (
        typeof data === "string"
    ) {

        addLog(
            data,
            "agent"
        );

        return;
    }

    if (data.ok === false) {

        addLog(
            `Agent: ${data.error || "Komut başarısız."}`,
            "error"
        );

        return;
    }

    if (data.message) {

        addLog(
            `Agent: ${data.message}`,
            "agent"
        );

        return;
    }

    if (data.result) {

        if (
            typeof data.result === "string"
        ) {

            addLog(
                `Agent: ${data.result}`,
                "agent"
            );

        } else {

            addLog(
                `Agent: ${JSON.stringify(data.result)}`,
                "agent"
            );
        }

        return;
    }

    addLog(
        `Agent: ${JSON.stringify(data)}`,
        "agent"
    );
}


/*
 * ---------------------------------------------------------
 * DEVICE SECRETS
 * ---------------------------------------------------------
 */

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


/*
 * Server yeni cihaz oluştururken
 * pairing_secret döndürürse otomatik sakla.
 */

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

    if (secret) {

        saveDeviceSecret(
            serial,
            secret
        );

        return secret;
    }

    return "";
}


/*
 * ---------------------------------------------------------
 * COMMANDS
 * ---------------------------------------------------------
 */

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


/*
 * ---------------------------------------------------------
 * BRAIN
 * ---------------------------------------------------------
 */

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
     * PRIVATE SYSTEM'DEN ÇIKIŞ
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


    /*
     * BRAIN
     */

    addLog(
        "Beluga Brain isteği analiz ediyor...",
        "system"
    );


    /*
     * KOMUT HARİTASI
     *
     * Kullanıcının yazdığı doğal ifadeleri
     * gerçek Agent komutlarına çevirir.
     */

    const commandMap = [

        /*
         * PRIVATE SYSTEM
         */

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


        /*
         * PRIVATE SYSTEM'DEN ÇIKIŞ
         */

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


        /*
         * SCREENSHOT
         */

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


        /*
         * SYSTEM STATUS
         */

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


        /*
         * MOUSE MOVE
         */

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


        /*
         * MOUSE CLICK
         */

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


        /*
         * TYPE TEXT
         */

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


        /*
         * KEY PRESS
         */

        {
            keywords: [
                "key_press",
                "key press",
                "tuşa bas",
                "tuşa bas"
            ],

            command:
                "key_press"
        },


        /*
         * OPEN APP
         */

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


        /*
         * LOCK SCREEN
         */

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


    /*
     * Komut eşleştirme
     */

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

        if (found) {

            addLog(
                `Beluga Brain: ${item.command}`,
                "system"
            );

            await sendCommand(
                item.command
            );

            return;
        }
    }


    /*
     * Komut bulunamadı
     */

    addLog(
        "Beluga Brain: Bu komut için henüz bir işlem tanımlanmadı.",
        "system"
    );
}


/*
 * ---------------------------------------------------------
 * PRIVATE SYSTEM UI
 * ---------------------------------------------------------
 */

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


/*
 * ---------------------------------------------------------
 * UI
 * ---------------------------------------------------------
 */

function navigate(page) {

    document
        .querySelectorAll(".page")
        .forEach(
            (element) => {

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
            (button) => {

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


/*
 * ---------------------------------------------------------
 * GATEWAY
 * ---------------------------------------------------------
 */

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


/*
 * ---------------------------------------------------------
 * EVENTS
 * ---------------------------------------------------------
 */

if ($("loginBtn")) {

    $("loginBtn")
        .onclick =
        login;
}


if ($("registerBtn")) {

    $("registerBtn")
        .onclick =
        register;
}


if ($("logoutBtn")) {

    $("logoutBtn")
        .onclick =
        logout;
}


if ($("showRegisterBtn")) {

    $("showRegisterBtn")
        .onclick =
        () => {

            $("loginBox")
                .classList
                .add("hidden");

            $("registerBox")
                .classList
                .remove("hidden");

            showAuthError("");
        };
}


if ($("showLoginBtn")) {

    $("showLoginBtn")
        .onclick =
        () => {

            $("registerBox")
                .classList
                .add("hidden");

            $("loginBox")
                .classList
                .remove("hidden");

            showAuthError("");
        };
}


if ($("sendBtn")) {

    $("sendBtn")
        .onclick =
        sendBrainCommand;
}


if ($("commandInput")) {

    $("commandInput")
        .addEventListener(
            "keydown",
            (event) => {

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

    $("openBrainBtn")
        .onclick =
        () =>
            navigate("brain");
}


/*
 * Navigation
 */

document
    .querySelectorAll(".nav-item")
    .forEach(
        (button) => {

            button.onclick =
                () =>
                    navigate(
                        button.dataset.page
                    );
        }
    );


/*
 * Add device
 */

if ($("addDeviceBtn")) {

    $("addDeviceBtn")
        .onclick =
        () => {

            $("deviceModal")
                .classList
                .remove("hidden");
        };
}


if ($("closeDeviceBtn")) {

    $("closeDeviceBtn")
        .onclick =
        () => {

            $("deviceModal")
                .classList
                .add("hidden");
        };
}


/*
 * ---------------------------------------------------------
 * SAVE DEVICE
 * ---------------------------------------------------------
 */

if ($("saveDeviceBtn")) {

    $("saveDeviceBtn")
        .onclick =
        async () => {

            const name =
                $("deviceName")
                    .value
                    .trim();

            const serial =
                $("deviceSerial")
                    .value
                    .trim();

            const secret =
                $("deviceSecret")
                    .value
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

                                    /*
                                     * Boş bırakılırsa
                                     * server secret üretir.
                                     */

                                    pairing_secret:
                                        secret || undefined
                                })
                        }
                    );


                /*
                 * Server'ın döndürdüğü
                 * pairing secret'ı sakla.
                 */

                const savedSecret =
                    rememberPairingSecret(
                        response,
                        serial,
                        secret
                    );


                if (!savedSecret) {

                    addLog(
                        "Cihaz oluşturuldu ancak pairing secret alınamadı.",
                        "error"
                    );

                } else {

                    addLog(
                        "Cihaz pairing secret ile kaydedildi.",
                        "system"
                    );
                }


                $("deviceModal")
                    .classList
                    .add("hidden");


                $("deviceName")
                    .value = "";

                $("deviceSerial")
                    .value = "";

                $("deviceSecret")
                    .value = "";


                await loadDevices();

            } catch (error) {

                addLog(
                    `Cihaz eklenemedi: ${error.message}`,
                    "error"
                );
            }
        };
}


/*
 * ---------------------------------------------------------
 * PRIVATE SYSTEM BUTTONS
 * ---------------------------------------------------------
 */

if ($("privateSystemBtn")) {

    $("privateSystemBtn")
        .onclick =
        enablePrivateSystem;
}


if ($("onSystemLightBtn")) {

    $("onSystemLightBtn")
        .onclick =
        disablePrivateSystem;
}


/*
 * Bazı tasarımlarda ID farklı
 * kullanılırsa alternatifleri de
 * destekle.
 */

if ($("enablePrivateSystemBtn")) {

    $("enablePrivateSystemBtn")
        .onclick =
        enablePrivateSystem;
}


if ($("disablePrivateSystemBtn")) {

    $("disablePrivateSystemBtn")
        .onclick =
        disablePrivateSystem;
}


/*
 * ---------------------------------------------------------
 * START
 * ---------------------------------------------------------
 */

restoreSession();
