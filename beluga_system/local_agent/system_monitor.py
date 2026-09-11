"""
Sistem Durum Izleme Modulu
----------------------------
CPU, RAM, disk, batarya ve aglar hakkinda anlik ozet bilgi uretir.
"""

import platform
import psutil


def get_system_status() -> dict:
    battery = psutil.sensors_battery()
    return {
        "hostname": platform.node(),
        "os": f"{platform.system()} {platform.release()}",
        "cpu_percent": psutil.cpu_percent(interval=0.3),
        "ram_percent": psutil.virtual_memory().percent,
        "disk_percent": psutil.disk_usage("/").percent,
        "battery_percent": battery.percent if battery else None,
        "battery_plugged": battery.power_plugged if battery else None,
        "uptime_seconds": int(psutil.boot_time()),
        "net_io": {
            "bytes_sent": psutil.net_io_counters().bytes_sent,
            "bytes_recv": psutil.net_io_counters().bytes_recv,
        },
    }
