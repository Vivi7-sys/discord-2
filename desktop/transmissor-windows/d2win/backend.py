"""Same /token + authenticated /share contract as Linux; ephemeral bearer in RAM."""
import asyncio
import httpx
from .config import SafeError, api_message


class Backend:
    def __init__(self, config, client=None):
        self.config = config
        self.client = client or httpx.AsyncClient(timeout=15, follow_redirects=False)
        self.token = None

    async def post(self, stage, route, body, authenticated=False):
        headers = {'Authorization': 'Bearer ' + self.token} if authenticated else {}
        try:
            response = await self.client.post(self.config.base + route, json=body, headers=headers)
            if response.status_code != 200:
                raise SafeError(api_message(stage, response.status_code))
            value = response.json()
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except SafeError:
            raise
        except (httpx.HTTPError, ValueError, TypeError):
            raise SafeError('Falha de rede ou resposta inválida. Confira a conexão e tente novamente.') from None

    async def login(self):
        from urllib.parse import urlsplit
        session = await self.post('token', '/api/livekit/token',
                                  {'roomId': self.config.room_id, 'displayName': self.config.name})
        token, url = session.get('token'), session.get('serverUrl')
        if not isinstance(token, str) or not token or not isinstance(url, str):
            raise SafeError('O servidor não forneceu uma sessão válida.')
        endpoint = urlsplit(url)
        if endpoint.scheme != 'wss' or not endpoint.hostname or endpoint.username or endpoint.password:
            raise SafeError('O servidor forneceu um endereço LiveKit inseguro.')
        self.token = token
        return url, token

    async def share(self, action):
        return await self.post(action, '/api/livekit/share',
                               {'roomId': self.config.room_id, 'action': action}, True)

    async def release(self):
        for _ in range(2):
            try:
                async with asyncio.timeout(6):
                    result = await self.share('release')
                    if result.get('reservationHeld') is False:
                        return True
            except (SafeError, TimeoutError):
                pass
        return False

    async def close(self):
        self.token = None
        await self.client.aclose()
