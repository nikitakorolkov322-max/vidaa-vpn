# Security policy / Безопасность

## Scope

This is an experimental, owner-administered TV integration. The installer invokes
a firmware-specific privileged package path; the root side operates a TUN device,
its own routing table/rule range, its own INPUT-chain jump and application files.
It must not write firmware, bootloader, recovery or signing material, enable a
remote shell, scan arbitrary networks, or persist an undocumented startup hook.

The temporary bootstrap server uses HTTP on a trusted LAN, restricted to the
selected private TV IPv4 and a random session URL. It does **not** defend against
an active LAN attacker. The computer wizard itself is loopback-only. Runtime
control uses the TV's HTTPS loopback service, a per-device token generated on the
TV, a restricted asset whitelist and a restrictive browser content policy.

Subscriptions and profiles are root-owned files with mode 0600. The control key is
readable by root and the existing Phoenix service group only (0640). Browser-local
storage contains favourite IDs and translated action categories, not credentials.
Firmware/vendor services and a compromised local privileged process are outside
this boundary. A root token is not a defence against an already compromised TV.

Only authenticated, fixed-purpose operations may cross from UI handlers into root
execution. Do not add arbitrary shell commands, caller-selected executable paths,
caller-selected filesystem reads, public proxy listeners or unauthenticated
maintenance endpoints. Subscriptions must not introduce local key/certificate
paths, insecure TLS, or arbitrary runtime configuration.

There is no always-on kill switch and no guaranteed leak-free transition during
failure, startup or firmware changes. Configuration checks are not a complete
packet-capture leak audit, server audit, cryptographic review or firmware audit.
No claim of guaranteed anonymity, DPI/TSPU invisibility or universal blocking
bypass is made. Runtime versions and CA hashes are pinned; maintainers must review
upstream security updates and certificate freshness.

## Reporting vulnerabilities and abuse

If GitHub **Security → Report a vulnerability** is available for this repository,
use that private channel. A maintainer should enable private vulnerability
reporting before a public release.

If no private channel exists, open a minimal issue requesting a private reporting
route. Do not include a weaponized exploit, credentials, subscription URLs,
serial/MAC numbers, private IPs, profiles, auth files, device dumps or raw logs.
For non-secret abuse inquiries, open an issue with the title **Abuse report**.
This repository does not require publishing a personal email address.

Please include the project version, the affected component, an explanation of the
trust boundary, and a minimal synthetic reproduction when safe. Device-specific
capabilities should be shared privately only when actually needed. Reports of
unauthorized installation, arbitrary code execution, secret disclosure, remote
control without a token, file traversal or unintended rule deletion are security
reports, not ordinary feature requests.

## Русский

Установка использует зависящий от прошивки привилегированный механизм. Работа
разрешена только на своём ТВ или с согласия владельца. Приложение не должно
прошивать разделы, открывать shell, отключать проверку TLS или скрытно создавать
автозапуск. Первичная передача HTTP требует доверенной LAN; от активного атакующего
внутри этой сети она не защищает.

Для уязвимости используйте приватный канал GitHub Security, если он включён.
Иначе создайте минимальное обращение с просьбой о приватном контакте, без
секретов и опасного воспроизведения. О злоупотреблениях без секретных деталей
можно сообщить в issue **Abuse report**. Личные адреса, серийные номера, подписки,
файлы авторизации и дампы публиковать нельзя. Защита от DPI/ТСПУ и полная
анонимность не гарантируются.
