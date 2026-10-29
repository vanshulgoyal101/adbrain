# Channels

Part of [Architecture](../README.md). One page per ad channel: the current facts its
adapter depends on (API version, access, permissions, limits, recorded provider
behaviour, fixtures), each with its source. Keep them current, not history; git keeps
the old values. The adapter design is ADR-001 (#1805).

## Pages

| Page | Channel | Status |
| --- | --- | --- |
| [Meta](meta.md) | Facebook and Instagram ads, WhatsApp chats | Live |
| [Meta Connection](meta-connect.md) | Meta: consent, capabilities, token security, publishing, leads, managed accounts, recovery | Live |
| [Meta App Review](meta-app-review.md) | Meta: the App Review packet and dashboard URLs | Live |

A new channel (Google, #1826) copies the Meta page's headings.
