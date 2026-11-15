---
type: regex
pattern: '^Hi \{\{name\}\},\n\nWe got a request to reset the password for your Juniper Books account\. You will receive a new link each time you ask,\nand each link works for 30 minutes\.\n\nReset your password: \{\{reset_link\}\}\n\nIf you did not ask for this, you can ignore this email: your password stays the same\.\n\nThe Juniper Books team\n$'
target:
  source: file
  path: templates/email/password-reset.txt
weight: 4
---
