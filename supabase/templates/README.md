# Auth email templates

Set in Supabase under Authentication > Emails (or the Management API `config/auth` fields
`mailer_templates_magic_link_content` and `mailer_templates_confirmation_content`).

Both show the code (`{{ .Token }}`), which the login form accepts, and a `token_hash` link to
`/auth/callback`. Neither depends on the browser that requested the email, so sign-in works when the
email opens in another browser, and the code works in the installed home-screen app, which keeps its
own cookies on iPhone.
