# Windows headless operation

FLOP Agent includes `tools/run-headless.ps1` for unattended execution under the current Windows user.

The runner:
- starts the existing `flop-agent serve` process without a visible child window;
- lowers the Node child to `BelowNormal` priority;
- writes one stdout/stderr log pair per launch under `.flop/logs`;
- restarts short-lived failures up to three times;
- after the third consecutive short failure, waits six hours before retrying.

It does not install services, change security policy, or modify Task Scheduler automatically.

## DPAPI requirement

When Technocore signing is enabled, run the agent under the same Windows user that owns the DPAPI-protected signer credentials.

Switching to another logged-in desktop session does not change that identity while the original user session remains active. A full logoff terminates user-scoped processes unless Windows is separately configured to keep them running.

## Task Scheduler

If persistent startup is required, create a normal Task Scheduler entry under the same user and point it at:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\flop-tools\tools\run-headless.ps1" -ConfigPath "C:\path\flop-agent.json"
```

Do not run the Technocore signer or FLOP Agent as SYSTEM when using CurrentUser DPAPI custody.
