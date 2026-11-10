# Validation scope

## What can be checked locally

The repository includes automated tests for subscription parsing, rejection of
insecure/untrusted options, endpoint deduplication, loopback Mieru configuration,
subnet selection, language-key parity, asset traversal rejection, IP validation,
IPK structure, binary checksum/symlink handling, job cancellation, cleanup order,
duplicate replies and generated-helper JavaScript syntax.

The UI demo uses synthetic endpoints and results. A browser can check both
languages, layout, remote keys, filters, favourites, sorting, selection, forms,
loading states and translated errors without contacting a TV.

The source wizard can be tested with `--dry-run`; this validates resources without
downloading a VPN engine or contacting a device. A packaging build is distinct
from an installation test.

## Recorded local verification

- 12 Node.js tests and 8 Python tests passed.
- Source and locally packaged macOS ARM64 installer resource checks passed.
- RU/EN browser demos exercised navigation, server selection, favourites, TCP
  checks, connection state, configuration checks and invalid subscription input.
- The wizard displayed both languages and rejected an empty TV address.
- Screenshots contain synthetic demo data only.
- Public-tree scanning and a separate comparison against private source
  credentials/identifiers found no matches. This is not a security certification.
- The macOS package was built locally; Windows/Linux builds are configured in CI
  and have not been run in this local verification.

## What has not yet been established for this public fork

A complete hardware installation of this renamed distribution has not been run.
The separate prototype that informed the architecture is not a certification of
these new paths, public installer, desktop artifacts or other TV models. No claim
of universal VIDAA compatibility, complete security review, continuous leak
prevention or DPI/TSPU invisibility is made.

## Hardware acceptance before a release

On a device owned by the tester, with no unrelated active VPN:

1. Check firmware/service prerequisites and free application storage.
2. Run the packaged or source wizard; verify that it reports actual UID 0 and that
   all payload checksums pass before registration.
3. Confirm the TV token is generated on the TV and never returned to the computer.
4. Reboot fully; inspect the VIDAA VPN name and PNG launcher icon.
5. Open both interface languages. Test D-pad navigation, OK, Back and text editing.
6. Add a disposable provider test subscription privately; do not commit it.
7. Start/stop each supported protocol offered by that test subscription; exercise
   actual TV applications, not just a TCP connection.
8. Check TCP-ping progress, failures/UDP markers, sorting and favourites.
9. Refresh, change the subscription, test a failure, and verify old settings survive.
10. Inspect private file modes, loopback listeners, control-token rejection,
    DNS/IPv6 policy, runtime CSP and resource ownership.
11. Observe routing and firewall cleanup on stop; test failure and low-space paths.
12. Close/reopen the UI and fully reboot. Verify manual startup behaviour.
13. Test updating while preserving profiles, then removal without affecting other
    apps or network policy. Inspect temporary files and package cleanup.
14. Record the exact public build and the non-sensitive hardware family. Keep raw
    device details and runtime credentials private.

Do not convert a failed or unperformed hardware step into a green badge. A fresh
firmware revision can change the result.
