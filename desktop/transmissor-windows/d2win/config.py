"""Public configuration only. No environment credential loaders."""
from dataclasses import dataclass
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


def resource(name):
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS) / 'd2-resources' / name
    if name == 'profiles.json':
        return Path(__file__).resolve().parents[2] / 'transmissor' / name
    return Path(__file__).resolve().parents[1] / 'packaging' / name


PROFILES = json.loads(resource('profiles.json').read_text())


@dataclass(frozen=True)
class Config:
    base: str
    room_id: str
    name: str
    profile: str
    encoder_mode: str = 'auto'

    @property
    def media(self):
        return PROFILES[self.profile]


def configuration(invite, name, profile, encoder_mode='auto'):
    try:
        url = urlsplit(invite.strip())
        port = url.port  # Validate malformed port as well.
        valid_scheme = url.scheme == 'https' or (url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1'))
        if (not valid_scheme or not url.hostname or url.username is not None or url.password is not None
                or url.query or url.fragment or not re.fullmatch('/sala/[a-f0-9]{64}', url.path)
                or any(ord(c) <= 32 or ord(c) == 127 for c in invite.strip())):
            raise ValueError()
        if port is not None and not 1 <= port <= 65535:
            raise ValueError()
    except ValueError:
        raise ValueError('Cole o convite completo HTTPS /sala/… do Discord 2.') from None
    name = re.sub(' +', ' ', name.strip())
    if (not 2 <= len(name.encode('utf-16-le')) // 2 <= 24
            or any(ord(c) < 32 or ord(c) == 127 for c in name) or profile not in PROFILES or encoder_mode not in ('auto', 'sdk')):
        raise ValueError('Confira o nome (2 a 24 caracteres) e o perfil de qualidade.')
    return Config(f'{url.scheme}://{url.netloc}', url.path.split('/')[2], name, profile, encoder_mode)


class SafeError(Exception):
    """Only fixed text can cross from transport/native code into the UI."""


def api_message(stage, status):
    if status == 429:
        return 'Muitas tentativas. Aguarde um minuto e tente novamente.'
    if stage == 'token' and status == 403:
        return 'Convite inválido. Obtenha outro no site Discord 2.'
    if stage == 'acquire' and status == 409:
        return 'Outra pessoa está transmitindo. Aguarde a liberação da vaga.'
    if status == 401:
        return 'Autorização recusada. Pare e entre novamente na sala.'
    return 'Não foi possível acessar a sala. Confira a rede e a disponibilidade do site.'
