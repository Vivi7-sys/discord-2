"""Pinned livekit==1.1.21 compatibility shim, no backend credentials."""

def close_track(track):
    # Python Track has no public close in this pin. Dispose only its owned FFI handle
    # after disconnect; do not dispose the global singleton used by later sessions.
    track._ffi_handle.dispose()


def dispose_runtime():
    # One SDK runtime per owned worker process. Shut it down before Python teardown,
    # not only in atexit, to avoid callbacks into a finalizing interpreter.
    from livekit.rtc._ffi_client import FfiClient
    if FfiClient._instance is not None:
        FfiClient._instance._dispose()
