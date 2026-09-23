"""
B.E.L.U.G.A - Local Agent (PC Istemcisi)
-------------------------------------------
Bu servis, kullanicinin yetkilendirdigi PC uzerinde arka planda calisir.
Render Gateway'e Socket.io ile baglanir, kendi 'device_serial' ve
'pairing_token' bilgisiyle kanala kaydolur, gelen SIFRELI komutlari
cozup (E2EE) yalnizca 'allowed_commands' beyaz listesindeki islemleri
gerceklestirir ve sonucu tekrar sifreleyip geri gonderir.

Sunucu (Render) bu veri akisinin ICERIGINI HICBIR ZAMAN GORMEZ.
"""

import json
import os
import sys
import time

import socketio

from crypto_utils import derive_key, encrypt_payload, decrypt_payload
from system_monitor import get_system_status
from screen_capture import capture_screenshot
from automation_controller import run_command

CONFIG_PATH = os.path.join(
    os.path.dirname(__file__),
    "config.json"
)


def load_config() -> dict:
    if not os.path.exists(CONFIG_PATH):
        print(
            "[HATA] config.json bulunamadi. "
            "config.example.json dosyasini kopyalayip doldurun."
        )
        sys.exit(1)

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


class BelugaAgent:
    def __init__(self, config: dict):
        self.config = config
        self.serial = config["device_serial"]

        self.key = derive_key(
            config["pairing_secret"]
        )

        self.sio = socketio.Client(
            reconnection=True,
            reconnection_delay=2
        )

        self._bind_events()

    def _bind_events(self):
        self.sio.on(
            "connect",
            self.on_connect
        )

        self.sio.on(
            "device:registered",
            self.on_registered
        )

        self.sio.on(
            "relay:message",
            self.on_message
        )

        self.sio.on(
            "disconnect",
            self.on_disconnect
        )

    def on_connect(self):
        print(
            f"[BELUGA-AGENT] Gateway'e baglanildi: "
            f"{self.config['gateway_url']}"
        )

        self.sio.emit(
            "device:register",
            {
                "serial": self.serial,
                "token": self.config.get(
                    "pairing_token",
                    ""
                ),
                "role": "agent",
            }
        )

    def on_registered(self, data):
        if data.get("ok"):
            print(
                f"[BELUGA-AGENT] Cihaz basariyla kayitli: "
                f"{self.serial}"
            )
        else:
            print(
                f"[BELUGA-AGENT] Kayit basarisiz: "
                f"{data.get('error')}"
            )

    def on_disconnect(self):
        print(
            "[BELUGA-AGENT] Baglanti kesildi, "
            "yeniden denenecek..."
        )

    def on_message(self, data):
        try:
            payload = decrypt_payload(
                self.key,
                data["payload"]
            )

        except Exception as exc:  # noqa: BLE001
            print(
                "[BELUGA-AGENT] Sifre cozme hatasi "
                f"(guvenilmeyen paket olabilir): {exc}"
            )
            return

        command = payload.get("command")
        params = payload.get(
            "params",
            {}
        )

        request_id = payload.get(
            "request_id"
        )

        result = self._handle_command(
            command,
            params
        )

        self._send_result(
            request_id,
            command,
            result
        )

    def _handle_command(
        self,
        command: str,
        params: dict
    ) -> dict:

        # Sistem durumu
        if command == "system_status":
            return {
                "ok": True,
                "data": get_system_status()
            }

        # Ekran görüntüsü
        if command == "screenshot":
            img_b64 = capture_screenshot(
                quality=params.get(
                    "quality",
                    55
                ),
                max_width=params.get(
                    "max_width",
                    1280
                ),
            )

            return {
                "ok": True,
                "data": {
                    "image_base64": img_b64
                }
            }

        # Private System
        if command in (
            "privatesystem",
            "onsystemlight"
        ):
            return run_command(
                command,
                params,
                [
                    "privatesystem",
                    "onsystemlight"
                ]
            )

        # Normal izinli komutlar
        return run_command(
            command,
            params,
            self.config.get(
                "allowed_commands",
                []
            )
        )

    def _send_result(
        self,
        request_id,
        command,
        result
    ):
        encrypted = encrypt_payload(
            self.key,
            {
                "request_id": request_id,
                "command": command,
                "result": result,
            }
        )

        self.sio.emit(
            "relay:message",
            {
                "serial": self.serial,
                "type": "command_result",
                "payload": encrypted,
            }
        )

    def run(self):
        while True:
            try:
                self.sio.connect(
                    self.config["gateway_url"],
                    transports=["websocket"]
                )

                self.sio.wait()

            except Exception as exc:  # noqa: BLE001
                print(
                    "[BELUGA-AGENT] Baglanti hatasi: "
                    f"{exc}. 5sn sonra tekrar denenecek."
                )

                time.sleep(5)


if __name__ == "__main__":
    cfg = load_config()
    agent = BelugaAgent(cfg)
    agent.run()