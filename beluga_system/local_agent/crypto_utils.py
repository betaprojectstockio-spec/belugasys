"""
E2EE Yardimci Modulu (Local Agent tarafi)
------------------------------------------
AES-256-GCM kullanir. Anahtar, kullanicinin eslestirme sirasinda
belirledigi 'pairing_secret' degerinden PBKDF2-HMAC-SHA256 ile turetilir.
Bu anahtar HICBIR ZAMAN Render sunucusuna gonderilmez; sadece
Web Dashboard (Web Crypto API, SubtleCrypto) ile Local Agent arasinda,
kullanicinin kendisinin bildigi parola uzerinden ayni sekilde turetilir.
"""

import os
import json
import base64
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PBKDF2_ITERATIONS = 200_000
SALT_STATIC = b"beluga-e2ee-salt-v1"  # panel tarafiyla birebir eslesmeli


def derive_key(pairing_secret: str) -> bytes:
    """Paylasilan parolayi 256-bit AES anahtarina cevirir."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=SALT_STATIC,
        iterations=PBKDF2_ITERATIONS,
        backend=default_backend(),
    )
    return kdf.derive(pairing_secret.encode("utf-8"))


def encrypt_payload(key: bytes, data: dict) -> dict:
    """Sozlugu JSON'a cevirip AES-256-GCM ile sifreler."""
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    plaintext = json.dumps(data).encode("utf-8")
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)
    return {
        "nonce": base64.b64encode(nonce).decode("utf-8"),
        "ciphertext": base64.b64encode(ciphertext).decode("utf-8"),
    }


def decrypt_payload(key: bytes, payload: dict) -> dict:
    """Sifreli paketi cozup orijinal sozlugu dondurur."""
    aesgcm = AESGCM(key)
    nonce = base64.b64decode(payload["nonce"])
    ciphertext = base64.b64decode(payload["ciphertext"])
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return json.loads(plaintext.decode("utf-8"))
