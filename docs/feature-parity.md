# Spreadsheet feature parity

Based on the saved discovery blueprint for “Copy of Lunch management”, inspected 25 October 2026 in the previous chat. Business workflows are preserved without copying spreadsheet layout or secrets. Weekly meal planning was removed at user request.

| Spreadsheet capability               | Application behavior                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Two shared food-entry threads        | Independent per-organizer browser drafts                                                                   |
| Common/individual food, amount, note | Composer with explicit VND/kVND and review                                                                 |
| Actor from Google account            | Discord identity authenticated through Firebase custom tokens                                              |
| Bill participants owe the organizer  | Atomic bill snapshot and ledger entries; no new self debt                                                  |
| Manual repayment entry               | Manual repayment UI removed at user request; payments recorded through QR confirmation                     |
| Itemized shared email                | Discord DM bill notifications, personalized shares, per-recipient delivery results and failed-only retries |
| Per-person balance sheets            | One signed-in member's balance page                                                                        |
| Recent charge count                  | 1 / 3 / 5 / 10 / all selector                                                                              |
| VietQR dialog                        | Stateless local QR dialog; record the displayed payment amount only after confirmation                     |
| Cooldown before minimization         | Removed at user request; opening QR does not block settlement                                              |
| Debt matrix and stake                | Dedicated matrix and full-history net positions                                                            |
| Hub simplification                   | Admin preview, version check, compensating entries, conserved net positions                                |
| Ledger / reverse EZLedger            | Filtered newest-first bills and immutable ledger                                                           |
| Daily balance history                | Payment index screen removed at user request                                                               |
| Positive-position pie                | Payment index screen removed at user request                                                               |
| Paid/received figures                | Payment index screen removed at user request                                                               |
| Users and bank table                 | Editable profiles, bank name/BIN/account, active status and roles; account-holder field removed            |
| Missing former users                 | Sync from Discord first; inactive profiles retain historical balances                                      |
| Archive link                         | Saved links, JSON backup download and CSV ledger export                                                    |
| Changelog seen marker                | Release dialog retained; unused persisted seen marker removed                                              |
| App/user metadata                    | Firestore group version and audit events; visual preferences kept in browser storage                       |
| Zero/self/negative historical rows   | Preserved by normalized CSV/JSON import                                                                    |
| Unfinished split modes               | Equal split is an added convenience; weighted/percentage splits are not claimed as existing features       |

Bank transfers are never initiated or automatically verified. Discord notification delivery is simulated locally. XLSX normalization and complete-backup restoration are future work; ledger history import is implemented. Private drafts are per browser/account, not synchronized between devices.

The hidden QR test tab and deprecated personal-page links become profile settings and a local QR generator, not separate app pages. The old monthly-calendar implementation was not found during discovery, so this app does not claim to reproduce it.
