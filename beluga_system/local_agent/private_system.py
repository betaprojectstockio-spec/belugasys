import json
import os
import platform
import subprocess
import time
import urllib.request
import urllib.error


STATE_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "private_system_state.json"
)

SIGNALRGB_URL = "http://127.0.0.1:16038/api/v1"


# ============================================================
# STATE
# ============================================================

def _load_state():
    if not os.path.exists(STATE_FILE):
        return {}

    try:
        with open(STATE_FILE, "r", encoding="utf-8") as file:
            return json.load(file)
    except Exception:
        return {}


def _save_state(state):
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as file:
            json.dump(
                state,
                file,
                indent=2,
                ensure_ascii=False
            )
    except Exception:
        pass


# ============================================================
# SIGNALRGB
# ============================================================

def _signalrgb_request(path, method="GET", body=None):
    url = SIGNALRGB_URL + path

    data = None

    if body is not None:
        data = json.dumps(body).encode("utf-8")

    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json"
        }
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=2
        ) as response:

            raw = response.read()

            if not raw:
                return {}

            try:
                return json.loads(
                    raw.decode("utf-8")
                )
            except Exception:
                return {
                    "raw": raw.decode(
                        "utf-8",
                        errors="replace"
                    )
                }

    except Exception:
        return None


def _disable_signalrgb(state):
    result = _signalrgb_request("/lighting")

    if result is None:
        return {
            "ok": False,
            "message": "SignalRGB bulunamadı."
        }

    state["signalrgb"] = result

    disabled = _signalrgb_request(
        "/lighting/enabled",
        method="PATCH",
        body={
            "enabled": False
        }
    )

    if disabled is None:
        return {
            "ok": False,
            "message": "SignalRGB ışıkları kapatılamadı."
        }

    return {
        "ok": True,
        "message": "SignalRGB ışıkları kapatıldı."
    }


def _restore_signalrgb(state):
    previous = state.get("signalrgb")

    if not previous:
        return {
            "ok": True,
            "message": "Kaydedilmiş SignalRGB durumu yok."
        }

    enabled = previous.get("enabled")

    if enabled is None:
        enabled = True

    result = _signalrgb_request(
        "/lighting/enabled",
        method="PATCH",
        body={
            "enabled": enabled
        }
    )

    if result is None:
        return {
            "ok": False,
            "message": "SignalRGB geri açılamadı."
        }

    return {
        "ok": True,
        "message": "SignalRGB geri açıldı."
    }


# ============================================================
# DISPLAY
# ============================================================

def _turn_display_off():

    system = platform.system()

    try:

        # Windows
        if system == "Windows":

            import ctypes

            HWND_BROADCAST = 0xFFFF
            WM_SYSCOMMAND = 0x0112
            SC_MONITORPOWER = 0xF170

            ctypes.windll.user32.SendMessageW(
                HWND_BROADCAST,
                WM_SYSCOMMAND,
                SC_MONITORPOWER,
                2
            )

            return {
                "ok": True,
                "message": "Monitör kapatıldı."
            }

        # Linux
        if system == "Linux":

            subprocess.run(
                [
                    "xset",
                    "dpms",
                    "force",
                    "off"
                ],
                check=False
            )

            return {
                "ok": True,
                "message": "Monitör kapatıldı."
            }

        # macOS
        if system == "Darwin":

            subprocess.run(
                [
                    "pmset",
                    "displaysleepnow"
                ],
                check=False
            )

            return {
                "ok": True,
                "message": "Monitör kapatıldı."
            }

        return {
            "ok": False,
            "message": "Bu işletim sisteminde monitör kontrolü desteklenmiyor."
        }

    except Exception as exc:

        return {
            "ok": False,
            "message": str(exc)
        }


def _turn_display_on():

    system = platform.system()

    try:

        if system == "Windows":

            import ctypes

            MOUSEEVENTF_MOVE = 0x0001

            ctypes.windll.user32.mouse_event(
                MOUSEEVENTF_MOVE,
                1,
                1,
                0,
                0
            )

            ctypes.windll.user32.mouse_event(
                MOUSEEVENTF_MOVE,
                1,
                1,
                0,
                0
            )

            return {
                "ok": True,
                "message": "Monitör uyandırıldı."
            }

        if system == "Linux":

            subprocess.run(
                [
                    "xset",
                    "dpms",
                    "force",
                    "on"
                ],
                check=False
            )

            return {
                "ok": True,
                "message": "Monitör açıldı."
            }

        if system == "Darwin":

            return {
                "ok": True,
                "message": "macOS ekranı uyandırma isteği gönderildi."
            }

        return {
            "ok": False,
            "message": "Desteklenmeyen işletim sistemi."
        }

    except Exception as exc:

        return {
            "ok": False,
            "message": str(exc)
        }


# ============================================================
# SAFE PERFORMANCE QUIET MODE
# ============================================================

def _set_windows_power_limit():

    if platform.system() != "Windows":
        return {
            "ok": False,
            "message": "Windows değil."
        }

    try:

        output = subprocess.check_output(
            [
                "powercfg",
                "/query",
                "SCHEME_CURRENT",
                "SUB_PROCESSOR",
                "PROCTHROTTLEMAX"
            ],
            text=True,
            errors="ignore"
        )

        state = {
            "powercfg_output": output
        }

        # Güvenli yaklaşım:
        # Fan RPM'ini zorla ayarlamak yerine CPU maksimum
        # işlemci durumunu düşürüyoruz.

        subprocess.run(
            [
                "powercfg",
                "/setacvalueindex",
                "SCHEME_CURRENT",
                "SUB_PROCESSOR",
                "PROCTHROTTLEMAX",
                "70"
            ],
            check=False
        )

        subprocess.run(
            [
                "powercfg",
                "/S",
                "SCHEME_CURRENT"
            ],
            check=False
        )

        return {
            "ok": True,
            "state": state,
            "message": "Güç/performance seviyesi düşürüldü."
        }

    except Exception as exc:

        return {
            "ok": False,
            "message": str(exc)
        }


def _restore_windows_power():

    if platform.system() != "Windows":
        return {
            "ok": False,
            "message": "Windows değil."
        }

    state = _load_state()

    previous = state.get(
        "powercfg_output"
    )

    # Eski değeri otomatik parse etmek yerine
    # Windows'un varsayılan maksimum değerini 100'e
    # geri getiriyoruz.

    try:

        subprocess.run(
            [
                "powercfg",
                "/setacvalueindex",
                "SCHEME_CURRENT",
                "SUB_PROCESSOR",
                "PROCTHROTTLEMAX",
                "100"
            ],
            check=False
        )

        subprocess.run(
            [
                "powercfg",
                "/S",
                "SCHEME_CURRENT"
            ],
            check=False
        )

        return {
            "ok": True,
            "message": "Güç/performance seviyesi geri getirildi."
        }

    except Exception as exc:

        return {
            "ok": False,
            "message": str(exc)
        }


# ============================================================
# PRIVATE SYSTEM
# ============================================================

def enter_private_system():

    state = _load_state()

    if state.get("active") is True:

        return {
            "ok": True,
            "active": True,
            "message": "Private System zaten aktif."
        }

    results = []

    # SignalRGB
    signalrgb = _disable_signalrgb(state)

    results.append({
        "component": "rgb",
        **signalrgb
    })

    # CPU / performance
    power = _set_windows_power_limit()

    results.append({
        "component": "performance",
        **power
    })

    state["active"] = True
    state["activated_at"] = time.time()

    _save_state(state)

    # Monitörü en son kapat
    display = _turn_display_off()

    results.append({
        "component": "display",
        **display
    })

    return {
        "ok": True,
        "command": "privatesystem",
        "active": True,
        "results": results
    }


def exit_private_system():

    state = _load_state()

    if not state.get("active"):

        return {
            "ok": True,
            "active": False,
            "message": "Private System zaten aktif değil."
        }

    results = []

    # Performance restore
    power = _restore_windows_power()

    results.append({
        "component": "performance",
        **power
    })

    # RGB restore
    signalrgb = _restore_signalrgb(state)

    results.append({
        "component": "rgb",
        **signalrgb
    })

    # Display
    display = _turn_display_on()

    results.append({
        "component": "display",
        **display
    })

    state["active"] = False
    state["deactivated_at"] = time.time()

    _save_state(state)

    return {
        "ok": True,
        "command": "onsystemlight",
        "active": False,
        "results": results
    }
