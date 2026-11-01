# SecureSphere encrypted chat

## Message cryptography

The client creates a random 256-bit AES key and a fresh 96-bit IV for each
message, then encrypts UTF-8 text with AES-256-GCM. For every active device
owned by either participant, it derives a wrapping key from ECDH P-256 using
the sender device's private key and that device's public key. HKDF-SHA-256
uses `SecureSphere/chat/message-key/v1/<message UUID>` as salt and
`SecureSphere/chat/ECDH-P256/AES-256-GCM-wrap/v1` as info. A unique random
96-bit IV wraps the AES message key with AES-256-GCM. The server stores only
the ciphertext, content IV, per-device wrapped keys, wrapping IVs, public key
IDs, and delivery timestamps. Text and private keys stay on devices.

Each active sender or recipient device has a distinct wrapped key copy. The
receiving client selects the copy addressed to its registered device key,
derives the same ECDH/HKDF wrapping key, authenticates and unwraps the message
key, then authenticates and decrypts the message locally. GCM authentication
failure is shown as a decryption error.

## Database migration

`lib/db/sql/006_encrypted_chat.sql` is additive. It creates the conversation,
encrypted message, and per-device wrapped-key tables plus indexes, foreign
keys, RLS, and anon/authenticated revocations. It does not drop, reset, or
rewrite existing data. It has not been applied to the configured database.
Review existing `conversations`, `messages`, and `chat_keys` tables in the
target database before applying it; the checked-in Drizzle schema contained no
definitions for those tables, so their live compatibility cannot be confirmed
from this checkout alone.

## API / privacy

All chat endpoints require Clerk auth and verify conversation membership.
Conversation creation requires an accepted teammate relationship. Message
send derives `sender_id` from the verified Clerk subject and requires a wrapped
key for every active device belonging to both participants. Request logging
records only method, URL path, response status, and timing; it does not log
request bodies.

`GET /api/keys/me` performs a straightforward lookup in
`user_device_keys(user_id, revoked_at IS NULL)`. The checked-in migration
`002_client_key_sharing.sql` creates that table and index. The saved runtime
log does not retain the 500 response's database error, so it cannot establish
whether the historical cause was an unapplied migration, connection failure,
or another database issue. The route now logs the actual database exception
server-side while returning a generic response; check that log if the problem
recurs.
