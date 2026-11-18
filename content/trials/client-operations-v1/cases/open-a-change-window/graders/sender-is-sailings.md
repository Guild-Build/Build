---
type: regex
pattern: '(?:^|\n)[ \t]*\[[ \t]*(?:mail|"mail"|\x27mail\x27)[ \t]*\][ \t]*(?:#[^\n]*)?\r?(?:\n(?![ \t]*\[)[^\n]*)*?\n[ \t]*(?:booking_email_sender|"booking_email_sender"|\x27booking_email_sender\x27)[ \t]*=[ \t]*(?:"sailings@tidewater-ferries\.example"|\x27sailings@tidewater-ferries\.example\x27)[ \t]*(?:#[^\n]*)?\r?(?=\n|$)'
target:
  source: file
  path: settings/production.toml
weight: 1
---
