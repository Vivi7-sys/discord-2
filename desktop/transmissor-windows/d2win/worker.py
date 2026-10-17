"""One owned process per transmission; Windows releases handles even on forced exit."""
import asyncio
import logging
import os
from .session import Session
from .sdk import dispose_runtime


def run_worker(config, target, output, cancel, sender):
    os.environ['RUST_LOG'] = 'off'
    logging.disable(logging.CRITICAL)
    def status(message):
        try:
            sender.send({'state': 'status', 'message': message})
        except (BrokenPipeError, OSError):
            cancel.set()
    def telemetry(sample):
        try:
            sender.send({'state': 'metrics', 'sample': sample})
        except (BrokenPipeError, OSError):
            cancel.set()
    session = Session(config, target, output, status, telemetry=telemetry)
    session.cancel = cancel
    try:
        asyncio.run(session.run())
        sender.send({'state': 'done', 'report': session.report})
    except BaseException:
        # Do not serialize SDK exception text, token, room or window title.
        try:
            sender.send({'state': 'fatal', 'message': 'Falha no transmissor. Captura encerrada; tente novamente.'})
        except (OSError, BrokenPipeError):
            pass
    finally:
        try:
            dispose_runtime()
        finally:
            sender.close()
