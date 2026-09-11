"""
Otomasyon Kontrolcusu
------------------------
PyAutoGUI ve isletim sistemi API'leri uzerinden calisan, KOMUT
BEYAZ LISTESI (allowlist) ile sinirlandirilmis eylemleri yurutur.
Yalnizca config.json icindeki 'allowed_commands' listesinde yer alan
komutlar calistirilir; tanimsiz/izinsiz komutlar reddedilir.
"""

import os
import platform
import subprocess
import pyautogui

pyautogui.FAILSAFE = True


def run_command(command: str, params: dict, allowed_commands: list) -> dict:
    if command not in allowed_commands:
        return {"ok": False, "error": f"'{command}' izin verilen komutlar listesinde degil"}

    try:
        if command == "mouse_move":
            pyautogui.moveTo(params.get("x", 0), params.get("y", 0), duration=params.get("duration", 0.2))
            return {"ok": True}

        if command == "mouse_click":
            pyautogui.click(params.get("x"), params.get("y"), button=params.get("button", "left"))
            return {"ok": True}

        if command == "type_text":
            pyautogui.write(params.get("text", ""), interval=0.02)
            return {"ok": True}

        if command == "key_press":
            keys = params.get("keys", [])
            if isinstance(keys, list) and len(keys) > 1:
                pyautogui.hotkey(*keys)
            elif keys:
                pyautogui.press(keys if isinstance(keys, str) else keys[0])
            return {"ok": True}

        if command == "open_app":
            app_path = params.get("path")
            if not app_path:
                return {"ok": False, "error": "path gerekli"}
            subprocess.Popen([app_path], shell=False)
            return {"ok": True}

        if command == "lock_screen":
            system = platform.system()
            if system == "Windows":
                os.system("rundll32.exe user32.dll,LockWorkStation")
            elif system == "Darwin":
                os.system("pmset displaysleepnow")
            else:
                os.system("loginctl lock-session")
            return {"ok": True}

        return {"ok": False, "error": "bilinmeyen komut"}

    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
