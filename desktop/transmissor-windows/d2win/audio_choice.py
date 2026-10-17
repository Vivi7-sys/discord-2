"""Explicit audio consent across the UI/worker boundary."""
from dataclasses import dataclass
from .config import SafeError


@dataclass(frozen=True)
class AudioChoice:
    mode: str
    output: object = None


def normalize(choice):
    if isinstance(choice, AudioChoice):
        if choice.mode not in ('application', 'system', 'none'):
            raise SafeError('Modo de áudio inválido.')
        if choice.mode == 'system' and choice.output is None:
            raise SafeError('Selecione uma saída para áudio do sistema inteiro ou escolha sem áudio.')
        return choice
    # Legacy test/integration callers keep their explicit output/None semantics.
    return AudioChoice('none' if choice is None else 'system', choice)


def selection(mode_index, target, output=None):
    if mode_index == 0:
        from .application_audio import validate_target
        validate_target(target)
        return AudioChoice('application')
    if mode_index == 1:
        return normalize(AudioChoice('system', output))
    if mode_index == 2:
        return None
    raise SafeError('Selecione um modo de áudio válido.')
