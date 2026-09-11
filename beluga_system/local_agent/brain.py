import re
from typing import Any

from planner import Planner, ExecutionPlan


class BelugaBrain:

    def __init__(self, allowed_commands=None):
        self.planner = Planner()

        self.allowed_commands = set(
            allowed_commands
            or [
                "mouse_move",
                "mouse_click",
                "type_text",
                "key_press",
                "open_app",
                "lock_screen",
            ]
        )

    def think(self, request: str) -> ExecutionPlan:

        if not isinstance(request, str) or not request.strip():
            raise ValueError("Beluga isteği boş olamaz.")

        actions = self._analyze(request)

        self._validate_actions(actions)

        return self.planner.create_plan(
            goal=request,
            actions=actions,
        )

    def _analyze(self, request: str) -> list[dict[str, Any]]:

        text = request.lower().strip()

        actions = []

        # -----------------------------------------
        # UYGULAMA AÇMA
        # -----------------------------------------

        app_map = {
            "chrome": "chrome.exe",
            "google chrome": "chrome.exe",
            "notepad": "notepad.exe",
            "hesap makinesi": "calc.exe",
            "calculator": "calc.exe",
        }

        selected_app = None

        for app_name in app_map:
            if app_name in text:
                selected_app = app_name
                break

        if selected_app and any(
            word in text
            for word in ["aç", "ac", "başlat", "baslat", "çalıştır", "calistir"]
        ):
            actions.append(
                {
                    "command": "open_app",
                    "params": {
                        "app_path": app_map[selected_app]
                    },
                }
            )

        # -----------------------------------------
        # WEB ADRESİ
        # -----------------------------------------

        url_match = re.search(
            r"(https?://[^\s]+|"
            r"(?:www\.)?[a-zA-Z0-9-]+\."
            r"(?:com|net|org|io|tr|dev)[^\s]*)",
            request,
            re.IGNORECASE,
        )

        if url_match:

            url = url_match.group(1)

            if not url.startswith(("http://", "https://")):
                url = "https://" + url

            actions.extend(
                [
                    {
                        "command": "key_press",
                        "params": {
                            "key": "ctrl+l"
                        },
                    },
                    {
                        "command": "type_text",
                        "params": {
                            "text": url
                        },
                    },
                    {
                        "command": "key_press",
                        "params": {
                            "key": "enter"
                        },
                    },
                ]
            )

        # -----------------------------------------
        # METİN YAZMA
        # -----------------------------------------

        write_patterns = [
            r'(?:şunu yaz|sunu yaz)\s*[:\-]?\s*["“](.+?)["”]',
            r'(?:bunu yaz)\s*[:\-]?\s*["“](.+?)["”]',
        ]

        for pattern in write_patterns:

            match = re.search(
                pattern,
                request,
                re.IGNORECASE,
            )

            if match:

                actions.append(
                    {
                        "command": "type_text",
                        "params": {
                            "text": match.group(1)
                        },
                    }
                )

                break

        # -----------------------------------------
        # SOL TIK
        # -----------------------------------------

        if "sol tıkla" in text or "sol tık" in text:

            actions.append(
                {
                    "command": "mouse_click",
                    "params": {
                        "button": "left"
                    },
                }
            )

        # -----------------------------------------
        # SAĞ TIK
        # -----------------------------------------

        if "sağ tıkla" in text or "sağ tık" in text:

            actions.append(
                {
                    "command": "mouse_click",
                    "params": {
                        "button": "right"
                    },
                }
            )

        # -----------------------------------------
        # EKRANI KİLİTLE
        # -----------------------------------------

        if any(
            phrase in text
            for phrase in [
                "ekranı kilitle",
                "ekrani kilitle",
                "bilgisayarı kilitle",
                "bilgisayari kilitle",
            ]
        ):

            actions.append(
                {
                    "command": "lock_screen",
                    "params": {},
                }
            )

        # -----------------------------------------
        # HİÇBİR ŞEY ANLAŞILMADI
        # -----------------------------------------

        if not actions:
            raise ValueError(
                "Beluga Brain bu isteği henüz anlayamadı."
            )

        return actions

    def _validate_actions(
        self,
        actions: list[dict[str, Any]],
    ) -> None:

        for action in actions:

            command = action.get("command")

            if command not in self.allowed_commands:
                raise ValueError(
                    f"İzin verilmeyen komut: {command}"
                )

    def explain(
        self,
        plan: ExecutionPlan,
    ) -> str:

        lines = [
            f"Beluga hedefi: {plan.goal}",
            "",
            "Oluşturulan plan:",
        ]

        for index, step in enumerate(
            plan.steps,
            start=1,
        ):

            lines.append(
                f"{index}. {step.command} "
                f"{step.params}"
            )

        return "\n".join(lines)
