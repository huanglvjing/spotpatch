---
"@spotpatch/shared": patch
"@spotpatch/dev-server": patch
"@spotpatch/bridge": patch
---

Enable external-Agent discovery on native Windows with a per-user LocalAppData runtime directory and fail-closed owner/ACL validation. Keep POSIX UID and mode checks unchanged, and run the existing descriptor, browser API, service, and bridge integration suites on Windows.
