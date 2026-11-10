# Third-party components

The MIT license in this repository covers this project's installer, interface,
integration code, documentation and original logo. It does not relicense external
VPN engines, certificate data, Python, or packaging tools.

The repository and the installer executable do not bundle VPN-engine binaries or
vendor firmware. The installer retrieves the pinned official releases listed in
[`installer/runtimes.json`](installer/runtimes.json), verifies archive and binary
SHA-256 values, and installs the unmodified executables on the selected TV.

| Component | Version | Upstream terms and source |
| --- | --- | --- |
| sing-box | 1.14.4 | [Source](https://github.com/SagerNet/sing-box/tree/v1.14.4), [GPL-3.0-or-later and additional notice](https://github.com/SagerNet/sing-box/blob/v1.14.4/LICENSE) |
| mieru | 3.39.0 | [Source](https://github.com/enfein/mieru/tree/v3.39.0), [GPL-3.0](https://github.com/enfein/mieru/blob/v3.39.0/LICENSE) |
| Mozilla certificate data via certifi | Pinned by SHA-256 | [Source and MPL-2.0 notices](https://github.com/certifi/python-certifi), [Mozilla certificate data](https://www.mozilla.org/en-US/about/governance/policies/security-group/certs/) |
| Python | Installer build environment | [PSF license](https://docs.python.org/3/license.html) |
| PyInstaller | See requirements-build.txt | [License and bootloader exception](https://pyinstaller.org/en/stable/license.html) |
| resvg-js | Optional logo build tool; not a runtime dependency | [MIT license](https://github.com/thx/resvg-js/blob/main/LICENSE) |

Maintain upstream notices and provide the corresponding source as required if you
choose to redistribute VPN binaries in a fork or a release. Merely linking these
repositories is not a substitute for reviewing the applicable redistribution
obligations. Do not publish a binary-bundled fork under an MIT-only claim.

VIDAA and Hisense are trademarks of their respective owners. VIDAA VPN is an
independent project, is not an official VIDAA/Hisense product, and does not use
vendor logos, proprietary firmware, device certificates, or signing keys.
