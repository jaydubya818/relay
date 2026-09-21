"""Independent Linux kernel audit of opens/reads of this platform's private file."""
import ctypes
import os
import struct

libc = ctypes.CDLL(None, use_errno=True)
fd = libc.inotify_init1(0)
if fd < 0:
    raise OSError(ctypes.get_errno(), "inotify_init1")
if libc.inotify_add_watch(fd, b"/state/canonical-private.json", 0x01 | 0x20) < 0:
    raise OSError(ctypes.get_errno(), "inotify_add_watch")
with open("/state/private-monitor-ready", "w", encoding="utf-8") as ready:
    ready.write(str(os.getpid()))
while True:
    events = os.read(fd, 4096)
    offset = 0
    with open("/state/private-access.log", "a", encoding="utf-8") as log:
        while offset < len(events):
            _, mask, _, length = struct.unpack_from("iIII", events, offset)
            log.write(f"{mask}\n")
            offset += 16 + length
