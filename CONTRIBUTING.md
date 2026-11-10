# Contributing

Use synthetic data. Never copy a working TV's configuration, credentials,
subscriptions, certificates, serials, private addresses or diagnostics into a PR.
Use the reserved `.example` / `.invalid` names and documentation IP ranges in tests.

Run the JavaScript tests, Python tests, resource check and privacy scan from the
README. UI changes must be verified in **both** languages with arrow keys, OK and
Back, including disabled/loading states and scrolling. Screenshots must come from
`tools/demo.py`, not a personal subscription. Keep captions functional; do not add
promotional cards, hard-coded server-count banners or an always-visible version.

Preserve token checks, certificate verification, local-only control, bounded
operations and directory/rule ownership checks. Any new privileged operation needs
a narrow input schema, an explanation of why it is necessary and tests of failure
and cleanup paths. Never add general remote execution.

A reported device model is not certified compatibility. Before publishing an
installer release, run the hardware acceptance checklist in `docs/validation.md`.
The CI build alone does not establish that the package works on a TV.

Keep the upstream licenses and notices intact. If you bundle external binaries,
review redistribution obligations and corresponding-source requirements first.
Do not impersonate the TV vendor or claim GitHub, VIDAA or Hisense approval.

For a security issue, follow `SECURITY.md`, not a public full-disclosure PR with live
secrets. Treat other contributors respectfully and keep discussions technical.
