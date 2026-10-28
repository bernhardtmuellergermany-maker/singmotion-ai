# Recover an existing Payload super-admin (server console only)

This command updates one existing `staff` super-admin through Payload's supported Local API. It never creates/deletes an account, changes a role, calls a public recovery endpoint, sends mail, changes Railway variables, or invokes BytePlus/R2. It uses the already configured CMS PostgreSQL database. No schema migration is needed for this change.

## Railway staging procedure

1. Use the **staging application service**, not production or the PostgreSQL service. The application image must already contain this command following a separately approved release; this change does not deploy it. Its existing environment must have `CMS_ENABLED=true`, the correct `CMS_DATABASE_URL`, `PAYLOAD_SECRET` and exact HTTPS `CMS_ORIGIN`. Do not replace those secrets or point it at a different database.
2. Open an **interactive TTY shell** in that staging app container. A log viewer, scheduled task or non-interactive pre-deploy command is not suitable. If using Railway CLI from your workstation, select the correct project and use `railway ssh --environment staging --service YOUR_APPLICATION_SERVICE`, replacing the service name. Confirm in Railway that the shell belongs to staging before proceeding. Use the non-root application user where the console supports it.
3. Inside the container run exactly:

   ```sh
   cd /app
   CMS_RECOVERY_ENABLED=true npm run cms:recover-admin
   ```

   The inline flag affects only this command; it does **not** change stored Railway variables. Do not append a password or email argument. No password environment variable or file is supported. Node must be 24.22.1 or newer within 24.x, as required by the app. If the shell is not interactive, the command refuses to proceed rather than enabling echo.

4. At the hidden prompts, enter the existing super-admin email, then type **`RECOVER SUPER ADMIN`** to authorize the reset. Enter a unique new password of **20–1024 characters** twice. Nothing typed is echoed, including the confirmation. Use a password manager. Control characters/multiline input are rejected. Ctrl+C cancels and restores terminal mode.
5. Wait for **“Recovery committed”**. Close the shell, then open the staging HTTPS `/admin`, pass the unchanged Railway Basic Auth challenge and log in with the existing email/new password. Other staff accounts and all customer/media/provider records remain unchanged. No public registration or password-reset endpoint is enabled.

If it stops, check the gate, TTY, exact existing super-admin email, confirmation, matching password length and database availability. Exceptions/SQL details are deliberately not printed because they may contain submitted data. A missing account or Editor/Support account is rejected, never promoted or replaced. If the connection/shell is interrupted during commit, verify whether the new password works before retrying; an acknowledgement can be lost after a successful commit. Do not create a replacement administrator as a workaround.

## Security and session behavior

Payload 3.92.0's `payload.update({ collection: 'staff', id, data: { password } })` hashes the password and, with `auth.useSessions=true` and **no current user session**, clears every stored session for that account. Recovery verifies the resulting sessions are empty before committing. The command also clears outstanding reset tokens and calls Payload's `unlock` API to reset failed-login lockout. PostgreSQL row locking protects the role check/update from concurrent role changes. Password update, unlock and a metadata-only `password-recovery` audit event commit together; failures roll back. Other users' sessions are not revoked. Revocation is effective on subsequent authenticated requests; it cannot undo an already-running request.

The one-time local `overrideAccess` is restricted to this server-only operator command, not exposed via any route. It is necessary when the operator has lost the login; terminal/database access and typed confirmation form its authorization boundary. Public CMS access rules remain unchanged. Protect Railway project/SSH membership with MFA and least privilege. Recovery does not replace the application's remaining production MFA requirement.

The CLI suppresses Payload logging and prints only fixed messages. It never logs the plaintext, stores it in an environment variable/file, or accepts it on argv. Input remains briefly in process memory for hashing; JavaScript strings cannot guarantee zeroization. The terminal is restored on normal exit, cancellation, EOF and handled termination signals; an uncatchable process kill may require `stty sane` in a new shell. Avoid terminals with input/session recording: hidden echo cannot protect against a compromised host or keystroke recorder. Terminal/shell history contains only the command above, not the prompted password.

## Verification

`npm test` covers TTY refusal, hidden input, backspace, control-character/multiline rejection and terminal restoration. `npm run test:cms` with a disposable local `CMS_TEST_DATABASE_URL` additionally verifies an unchanged account ID/role/count, rejection of non-super-admin/missing accounts and bad confirmation/passwords, successful login with the new password, rejection of the old password, revocation of multiple prior tokens, lockout recovery and a plaintext-free audit record. No provider/network calls outside the disposable local PostgreSQL database are required.
