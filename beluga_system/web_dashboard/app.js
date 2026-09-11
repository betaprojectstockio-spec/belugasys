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
    $("authError").textContent = message;
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

    $("app").classList.add("hidden");
    $("authScreen").classList.remove("hidden");
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

    const data =
        await response.json();

    if (
        response.status === 401
    ) {
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

    $("usernameLabel")
        .textContent =
        currentUser.username;

    $("settingsUsername")
        .textContent =
        currentUser.username;

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

        $("deviceCount")
            .textContent =
            devices.length;

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
    }
}


function renderDevices() {

    const container =
        $("deviceList");

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

    $("activeDeviceLabel")
        .textContent =
        device.name;

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

            $("gatewayStatus")
                .textContent =
                "● Gateway Online";

            $("gatewayCard")
                .textContent =
                "ONLINE";

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

            $("gatewayStatus")
                .textContent =
                "○ Gateway Offline";

            $("gatewayCard")
                .textContent =
                "OFFLINE";
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

    socket.on(
        "relay:message",
        async ({ payload }) => {

            addLog(
                "Cihazdan yanıt alındı.",
                "agent"
            );
        }
    );
}


/*
 * ---------------------------------------------------------
 * COMMANDS
 * ---------------------------------------------------------
 */

function sendCommand(
    command,
    params = {}
) {

    if (!activeDevice) {

        addLog(
            "Önce bir cihaz seç.",
            "error"
        );

        return;
    }

    if (
        !socket ||
        !socket.connected
    ) {

        addLog(
            "Gateway bağlantısı yok.",
            "error"
        );

        return;
    }

    /*
     * Burada mevcut E2EE sistemine
     * bağlanacağız.
     *
     * Şimdilik mevcut relay formatını
     * koruyoruz.
     */

    socket.emit(
        "relay:message",
        {
            serial:
                activeDevice.serial,

            type:
                "command",

            payload:
                JSON.stringify({
                    command,
                    params,
                    request_id:
                        crypto.randomUUID()
                })
        }
    );

    addLog(
        `Komut: ${command}`,
        "user"
    );
}


/*
 * ---------------------------------------------------------
 * BRAIN
 * ---------------------------------------------------------
 */

function sendBrainCommand() {

    const text =
        $("commandInput")
            .value
            .trim();

    if (!text) {
        return;
    }

    /*
     * Brain backend'e geçtiğimizde
     * burası doğrudan AI endpointine
     * gidecek.
     */

    addLog(
        `Siz: ${text}`,
        "user"
    );

    addLog(
        "Beluga Brain isteği analiz ediyor...",
        "system"
    );

    $("commandInput")
        .value = "";
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
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
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

        $("gatewayStatus")
            .textContent =
            data.database
                ? "● Gateway + Database Online"
                : "● Gateway Online";

        $("gatewayCard")
            .textContent =
            data.database
                ? "ONLINE"
                : "NO DATABASE";

    } catch (_) {

        $("gatewayStatus")
            .textContent =
            "○ Gateway Offline";

        $("gatewayCard")
            .textContent =
            "OFFLINE";
    }
}


/*
 * ---------------------------------------------------------
 * EVENTS
 * ---------------------------------------------------------
 */

$("loginBtn")
    .onclick =
    login;

$("registerBtn")
    .onclick =
    register;

$("logoutBtn")
    .onclick =
    logout;

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


$("sendBtn")
    .onclick =
    sendBrainCommand;

$("commandInput")
    .addEventListener(
        "keydown",
        (event) => {

            if (
                event.key === "Enter"
            ) {
                sendBrainCommand();
            }
        }
    );


$("openBrainBtn")
    .onclick =
    () => navigate("brain");


document
    .querySelectorAll(".nav-item")
    .forEach(
        (button) => {

            button.onclick =
                () => navigate(
                    button.dataset.page
                );

        }
    );


$("addDeviceBtn")
    .onclick =
    () => {

        $("deviceModal")
            .classList
            .remove("hidden");
    };


$("closeDeviceBtn")
    .onclick =
    () => {

        $("deviceModal")
            .classList
            .add("hidden");
    };


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
                .value;

        if (
            !name ||
            !serial ||
            !secret
        ) {
            alert(
                "Tüm alanları doldur."
            );
            return;
        }

        try {

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
                                secret
                        })
                }
            );

            $("deviceModal")
                .classList
                .add("hidden");

            await loadDevices();

        } catch (error) {

            alert(
                error.message
            );
        }
    };


/*
 * ---------------------------------------------------------
 * START
 * ---------------------------------------------------------
 */

restoreSession();
