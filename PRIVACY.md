# Privacy / Приватность

## Repository and releases

This repository ships source code, original artwork, public upstream download
metadata and synthetic demo/test data. It must not contain an operator's home IP,
serial number, MAC address, subscription, live endpoint credentials, control token,
OS user path, browser export or device report. Do not publish the parent workspace.

VPN executables and CA data are downloaded separately into a computer cache. The
installer does not ask for the user's subscription and does not transfer the TV's
generated control token to the computer. A LAN installer URL is generated per run,
shown locally and not sent to a project service. Request logging is disabled.

The project sends no analytics and uses no hosted fonts or remote UI libraries.
The TV firmware, manufacturer applications, VPN provider and destinations can have
their own network activity and privacy policies. Installing this app does not
change those policies or remove vendor telemetry.

## What leaves each device

| Component | Network activity |
| --- | --- |
| Computer wizard | Official pinned runtime / CA downloads; optional local SSDP discovery; a temporary server for the selected TV |
| TV UI | HTTPS requests to the TV's own loopback service |
| Subscription worker | HTTPS requests to the user-selected subscription service and HTTPS redirects |
| VPN engine | Connections required by the selected provider protocol; tunneled application traffic |
| Endpoint check | Bounded TCP connections to the selected subscription's server ports; address resolution |
| Connectivity check | HTTPS request to Cloudflare's public trace endpoint through an active tunnel |

The connectivity report retains the returned country and status, not the public IP
from the trace response. Bootstrap DNS for the VPN endpoint uses the system resolver;
application DNS is configured through the tunnel. TCP-ping figures are metadata,
not proof that the full tunnel is working or hidden from filtering.

## Stored on the TV

- `/APPS/vidaa-vpn/profiles.json`, `subscription-url.json`, and `config.json`:
  root-owned private data, mode 0600.
- `auth.json`: device-generated control token, root / Phoenix service group, 0640.
- Public status/probe reports: opaque profile IDs, timings, states and check flags;
  no endpoint passwords or subscription URL.
- Browser local storage: favourite profile IDs and recent translated action codes
  with times. No intended subscription/password storage.
- Private update backups: application files and an initial registry backup.

Removal deletes this application's files; it is not a forensic wipe of flash or
all shared browser storage. Clear action history in the UI if desired. Do not erase
an entire shared loopback origin without considering other local applications.

## Before posting an issue, screenshot or archive

1. Reproduce with the synthetic demo when possible.
2. Never attach real profile exports, auth files, subscriptions, runtime folders,
   raw logs, serials, MACs or home-network addresses.
3. Inspect images too: visible URLs and names can disclose provider/account details.
4. Run `python3 tools/privacy_check.py` before publishing repository changes.
5. A pattern scan cannot prove that no secret of any kind exists. Review every
   added file and the complete Git history. A `.gitignore` is not retroactive.
6. If a live secret is published, revoke/rotate it with the issuer. Deleting the
   visible file alone does not make a leaked credential safe.

## Русский

В проекте нет персональной подписки, адресов домашней сети, серийных номеров,
ключей конкретного ТВ и приватных отчётов. Примеры и скриншоты должны быть
синтетическими. Мастер не запрашивает подписку: она вводится на самом телевизоре.
Ключ управления создаётся на ТВ и не экспортируется в мастер.

Телеметрии проекта нет, но это не означает отсутствия сетевой активности у VIDAA,
производителя или провайдера VPN. Проверка интернета обращается к Cloudflare через
туннель; TCP-пинг обращается к портам серверов подписки. Исходный public IP ответа
проверки не сохраняется в её отчёте.

Подписки и ключи хранятся в приватных файлах приложения. В localStorage находятся
избранное и категории действий, а не пароли. Удаление приложения не является
криминалистическим стиранием flash и не очищает весь общий origin браузера.
Не публикуйте реальные конфиги, ссылки, адреса, серийные номера, MAC и логи.
Перед публикацией проверьте файлы и историю Git, а при утечке перевыпустите секрет.
