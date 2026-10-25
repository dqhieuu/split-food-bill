# Spreadsheet feature parity

Based on the saved discovery blueprint for “Copy of Lunch management”, inspected 25 October 2026 in the previous chat. Business workflows are preserved without copying spreadsheet layout or secrets.

| Spreadsheet capability               | Application behavior                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Two shared food-entry threads        | Independent per-organizer browser drafts                                                             |
| Common/individual food, amount, note | Composer with explicit VND/kVND and review                                                           |
| Actor from Google account            | Actor from Firebase emulator authentication token                                                    |
| Bill participants owe the organizer  | Atomic bill snapshot and ledger entries; no new self debt                                            |
| Manual repayment entry               | Confirmed repayment workflow with multiple recipients committed together                             |
| Itemized shared email                | Durable outbox, escaped HTML, simulated success/failure/retry                                        |
| Per-person balance sheets            | One signed-in member's balance page                                                                  |
| Recent charge count                  | 1 / 3 / 5 / 10 / all selector                                                                        |
| VietQR dialog                        | Offline QR intent, bank details, two-minute expiry, self-confirmation                                |
| Cooldown before minimization         | Transactional check for active intents                                                               |
| Debt matrix and stake                | Dedicated matrix and full-history net positions                                                      |
| Hub simplification                   | Admin preview, version check, compensating entries, conserved net positions                          |
| Ledger / reverse EZLedger            | Filtered newest-first bills and immutable ledger                                                     |
| Daily balance history                | Member-keyed line chart, 7 / 15 / 30-day ranges                                                      |
| Positive-position pie                | Receivable distribution donut with member legend                                                     |
| Paid/received figures                | Cumulative/today repayments; synthetic/self entries excluded                                         |
| Users and bank table                 | Editable profiles, bank BIN/account/holder, active status and roles                                  |
| Missing former users                 | Inactive placeholders during import, balances retained                                               |
| Weekday AI suggestions               | Persisted editable plan, explicitly local suggestion fallback                                        |
| Archive link                         | Saved links, JSON backup download and CSV ledger export                                              |
| Changelog seen marker                | Release dialog, notification indicator, persisted member preference                                  |
| App/user metadata                    | Firestore group version, intents, preferences and audit events                                       |
| Zero/self/negative historical rows   | Preserved by normalized CSV/JSON import                                                              |
| Unfinished split modes               | Equal split is an added convenience; weighted/percentage splits are not claimed as existing features |

Bank transfers are never initiated or automatically verified. Email delivery and AI generation use the explicitly labeled local substitutes. XLSX normalization and complete-backup restoration are future work; ledger history import is implemented. Private drafts are per browser/account, not synchronized between devices.

The hidden QR test tab and deprecated personal-page links become profile settings and a local QR generator, not separate app pages. The old monthly-calendar implementation was not found during discovery, so this app does not claim to reproduce it. Daily history charts are implemented.
