/**
 * B.E.L.U.G.A Web Dashboard
 * ----------------------------
 * - Gateway'e Socket.io ile baglanir (rolu: 'dashboard')
 * - Cihazlari (localStorage'da SADECE serial/isim/pairing_secret referansi
 *   olarak, sifreli olmayan sunucu tarafinda degil, TARAYICIDA tutar)
 * - Komutlari E2EE ile sifreleyip gateway uzerinden ilgili cihaza yollar
 * - Sesli komut icin Web Speech API kullanir
 */

const GATEWAY_URL = window.BELUGA_GATEWAY_URL || "https://beluga-gateway.onrender.com";

let socket = null;
let devices = JSON.parse(localStorage.getItem("beluga_devices") || "[]");
let activeDevice = null;
let activeKey = null;

const deviceListEl = document.getElementById("deviceList");
const consoleLogEl = document.getElementById("consoleLog");
const activeDeviceLabel = document.getElementById("activeDeviceLabel");
const commandInput = document.getElementById("commandInput");
const screenshotPreview = document.getElementById("screenshotPreview");

function logLine(text, cls) {
  const div = document.createElement("div");
  div.className = `line ${cls}`;
  div.textContent = text;
  consoleLogEl.appendChild(div);
  consoleLogEl.scrollTop = consoleLogEl.scrollHeight;
}

function saveDevices() {
  localStorage.setItem("beluga_devices", JSON.stringify(devices));
}

function renderDeviceList() {
  deviceListEl.innerHTML = "";
  devices.forEach((d) => {
    const li = document.createElement("li");
    li.className = d.serial === activeDevice?.serial ? "active" : "";
    li.innerHTML = `<span>${d.name}</span><span class="status-dot ${d.online ? 'online' : ''}"></span>`;
    li.onclick = () => selectDevice(d);
    deviceListEl.appendChild(li);
  });
}

async function selectDevice(d) {
  activeDevice = d;
  activeKey = await deriveKey(d.pairing_secret);
  activeDeviceLabel.textContent = `- ${d.name}`;
  renderDeviceList();
  socket.emit("device:register", { serial: d.serial, role: "dashboard" });
  logLine(`[Sistem] '${d.name}' cihazi ile baglanti kuruldu.`, "from-system");
}

function connectSocket() {
  socket = io(GATEWAY_URL, { transports: ["websocket"] });

  socket.on("connect", () => {
    logLine("[Sistem] Gateway baglantisi kuruldu.", "from-system");
    if (activeDevice) {
      socket.emit("device:register", { serial: activeDevice.serial, role: "dashboard" });
    }
  });

  socket.on("device:presence", ({ serial, agentOnline }) => {
    const d = devices.find((x) => x.serial === serial);
    if (d && typeof agentOnline === "boolean") {
      d.online = agentOnline;
      renderDeviceList();
    }
  });

  socket.on("relay:message", async ({ payload }) => {
    if (!activeKey) return;
    try {
      const data = await decryptPayload(activeKey, payload);
      handleAgentResult(data);
    } catch (e) {
      logLine("[Sistem] Sifre cozme hatasi: gelen paket dogrulanamadi.", "from-system");
    }
  });
}

function handleAgentResult(data) {
  const { command, result } = data;
  if (!result?.ok) {
    logLine(`[Ajan] Hata (${command}): ${result?.error || "bilinmiyor"}`, "from-agent");
    return;
  }

  if (command === "screenshot") {
    screenshotPreview.src = `data:image/jpeg;base64,${result.data.image_base64}`;
    screenshotPreview.classList.add("visible");
    logLine("[Ajan] Ekran goruntusu alindi.", "from-agent");
    return;
  }

  if (command === "system_status") {
    logLine(`[Ajan] Durum: CPU %${result.data.cpu_percent} | RAM %${result.data.ram_percent} | Disk %${result.data.disk_percent}`, "from-agent");
    return;
  }

  logLine(`[Ajan] '${command}' calistirildi.`, "from-agent");
}

async function sendCommand(command, params = {}) {
  if (!activeDevice || !activeKey) {
    logLine("[Sistem] Once bir cihaz secin.", "from-system");
    return;
  }
  const requestId = crypto.randomUUID();
  const encrypted = await encryptPayload(activeKey, { command, params, request_id: requestId });
  socket.emit("relay:message", { serial: activeDevice.serial, type: "command", payload: encrypted });
  logLine(`[Siz] ${command} ${JSON.stringify(params)}`, "from-user");
}

// -------------------- basit dogal dil -> komut esleme --------------------
function parseNaturalLanguageCommand(text) {
  const t = text.toLowerCase();
  if (t.includes("ekran") && t.includes("goster") || t.includes("screenshot")) return { command: "screenshot", params: {} };
  if (t.includes("durum")) return { command: "system_status", params: {} };
  if (t.includes("kilitle")) return { command: "lock_screen", params: {} };
  return null;
}

document.getElementById("sendBtn").onclick = () => {
  const text = commandInput.value.trim();
  if (!text) return;
  const parsed = parseNaturalLanguageCommand(text);
  if (parsed) sendCommand(parsed.command, parsed.params);
  else logLine("[Sistem] Komut anlasilamadi. Hizli eylem butonlarini deneyebilirsiniz.", "from-system");
  commandInput.value = "";
};

document.querySelectorAll(".quick-actions button").forEach((btn) => {
  btn.onclick = () => sendCommand(btn.dataset.cmd, {});
});

// -------------------- sesli komut (Web Speech API) --------------------
const micBtn = document.getElementById("micBtn");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognizer = new SpeechRecognition();
  recognizer.lang = "tr-TR";
  recognizer.onresult = (e) => {
    const text = e.results[0][0].transcript;
    commandInput.value = text;
    document.getElementById("sendBtn").click();
  };
  micBtn.onclick = () => recognizer.start();
} else {
  micBtn.disabled = true;
  micBtn.title = "Bu tarayici sesli komutu desteklemiyor";
}

// -------------------- cihaz eslestirme (QR) --------------------
const modal = document.getElementById("pairingModal");
document.getElementById("addDeviceBtn").onclick = () => modal.classList.remove("hidden");
document.getElementById("closePairingBtn").onclick = () => modal.classList.add("hidden");

document.getElementById("generatePairBtn").onclick = async () => {
  const name = document.getElementById("pairDeviceName").value.trim();
  const serial = document.getElementById("pairSerial").value.trim();
  const secret = document.getElementById("pairSecret").value;
  if (!name || !serial || !secret) {
    alert("Tum alanlari doldurun.");
    return;
  }

  const res = await fetch(`${GATEWAY_URL}/api/pairing/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serial }),
  });
  const { token } = await res.json();

  const qrPayload = JSON.stringify({ serial, pairing_token: token, pairing_secret: secret, gateway_url: GATEWAY_URL });
  const container = document.getElementById("qrCodeContainer");
  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  container.appendChild(canvas);
  QRCode.toCanvas(canvas, qrPayload, { width: 220 });

  devices.push({ serial, name, pairing_secret: secret, online: false });
  saveDevices();
  renderDeviceList();
};

// -------------------- baslangic --------------------
connectSocket();
renderDeviceList();
if (devices[0]) selectDevice(devices[0]);
