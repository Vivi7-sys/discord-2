# Salas e convites

- `server-invite.ts`: nonce aleatório de 128 bits e assinatura HMAC truncada a
  128 bits. Criação no servidor; verificação com comparação em tempo constante.
- `room-id.ts`: IDs hexadecimais de 64 caracteres e links da mesma origem.
- `participant-profile.ts`: validação de nome e avatar JPEG limitado.

A presença e as trilhas são mantidas no LiveKit. O Redis mantém limites e a
reserva de transmissão. Convites não têm expiração nem revogação individual;
posse do link permite solicitar token sem autenticação de pessoa.
