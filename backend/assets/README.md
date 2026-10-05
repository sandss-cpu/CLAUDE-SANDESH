# Bundled data

- `common-passwords.txt`: the 10,000 most common passwords, from SecLists
  (`Passwords/Common-Credentials/10k-most-common.txt`, https://github.com/danielmiessler/SecLists),
  MIT licence, Copyright (c) 2018 Daniel Miessler. New and changed passwords are checked
  against it (`src/modules/auth/password-policy.ts`).
