"""
Ekran Yakalama Modulu
-----------------------
mss ile aninda ekran goruntusu alir, Pillow ile JPEG'e sikistirir
ve base64 metne cevirir (E2EE zarfina konmadan once).
"""

import io
import base64
import mss
from PIL import Image


def capture_screenshot(quality: int = 55, max_width: int = 1280) -> str:
    with mss.mss() as sct:
        monitor = sct.monitors[1]  # birincil ekran
        raw = sct.grab(monitor)
        img = Image.frombytes("RGB", raw.size, raw.rgb)

        if img.width > max_width:
            ratio = max_width / img.width
            img = img.resize((max_width, int(img.height * ratio)))

        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=quality)
        return base64.b64encode(buffer.getvalue()).decode("utf-8")
