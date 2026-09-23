import os
import platform
import subprocess
import pyautogui

from private_system import enter_private_system, exit_private_system


pyautogui.FAILSAFE = True


def run_command(command, params=None, allowed_commands=None):
    """
    BelugaSys local command executor.

    Safe system commands:
      - privatesystem
      - onsystemlight

    Other commands are executed only when explicitly allowed.
    """

    params = params or {}
    allowed_commands = allowed_commands or []

    # ---------------------------------------------------------
    # BELUGA PRIVATE SYSTEM
    # ---------------------------------------------------------

    if command == "privatesystem":
        return enter_private_system()

    if command == "onsystemlight":
        return exit_private_system()

    # ---------------------------------------------------------
    # GENERAL COMMAND AUTHORIZATION
    # ---------------------------------------------------------

    if command not in allowed_commands:
        return {
            "ok": False,
            "error": "Command not allowed",
            "command": command
        }

    # ---------------------------------------------------------
    # MOUSE
    # ---------------------------------------------------------

    if command == "mouse_move":
        x = int(params.get("x", 0))
        y = int(params.get("y", 0))

        pyautogui.moveTo(x, y)

        return {
            "ok": True,
            "command": command,
            "x": x,
            "y": y
        }

    if command == "mouse_click":
        button = params.get("button", "left")

        if button not in ("left", "right", "middle"):
            return {
                "ok": False,
                "error": "Invalid mouse button"
            }

        pyautogui.click(button=button)

        return {
            "ok": True,
            "command": command,
            "button": button
        }

    # ---------------------------------------------------------
    # KEYBOARD
    # ---------------------------------------------------------

    if command == "type_text":
        text = str(params.get("text", ""))

        pyautogui.write(text, interval=0.01)

        return {
            "ok": True,
            "command": command
        }

    if command == "key_press":
        key = str(params.get("key", ""))

        if not key:
            return {
                "ok": False,
                "error": "No key specified"
            }

        pyautogui.press(key)

        return {
            "ok": True,
            "command": command,
            "key": key
        }

    # ---------------------------------------------------------
    # APPLICATION
    # ---------------------------------------------------------

    if command == "open_app":
        app = str(params.get("app", "")).strip()

        if not app:
            return {
                "ok": False,
                "error": "No application specified"
            }

        try:
            if platform.system() == "Windows":
                subprocess.Popen(app, shell=True)

            elif platform.system() == "Linux":
                subprocess.Popen(app.split())

            elif platform.system() == "Darwin":
                subprocess.Popen(["open", "-a", app])

            else:
                return {
                    "ok": False,
                    "error": "Unsupported operating system"
                }

            return {
                "ok": True,
                "command": command,
                "app": app
            }

        except Exception as exc:
            return {
                "ok": False,
                "error": str(exc)
            }

    # ---------------------------------------------------------
    # LOCK SCREEN
    # ---------------------------------------------------------

    if command == "lock_screen":

        system = platform.system()

        try:
            if system == "Windows":
                subprocess.run(
                    [
                        "rundll32.exe",
                        "user32.dll,LockWorkStation"
                    ],
                    check=False
                )

            elif system == "Linux":
                subprocess.run(
                    ["loginctl", "lock-session"],
                    check=False
                )

            elif system == "Darwin":
                subprocess.run(
                    [
                        "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession",
                        "-suspend"
                    ],
                    check=False
                )

            else:
                return {
                    "ok": False,
                    "error": "Unsupported operating system"
                }

            return {
                "ok": True,
                "command": command
            }

        except Exception as exc:
            return {
                "ok": False,
                "error": str(exc)
            }

    # ---------------------------------------------------------
    # UNKNOWN COMMAND
    # ---------------------------------------------------------

    return {
        "ok": False,
        "error": "Unknown command",
        "command": command
    }