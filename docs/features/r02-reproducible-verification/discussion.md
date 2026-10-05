# Discussion — R02 - Reproducible Verification

## Follow-up direction — 2026-10-05

The owner asked to close the remaining bugs and tasks, including this task, and
to remove an in-progress label once work is finished. R02's original acceptance
and DEC-003 remain historical records of its completed scope. The follow-up
authorizes a separate GG-0005 repair on the same delivery branch to unblock
the required browser gate. GG-0005 and GG-0007 still require their own deployed
acceptance evidence before their issue statuses can advance. R02 already uses
`status: implemented`; the follow-up does not restore an in-progress status.

### Answer to Q-001 · 2026-10-04

Что значит «обязательный CI-гейт» для браузерного набора: достаточно ли добавить его в агрегирующий job «All gates», или фича также включает

A. Добавить Playwright-job в ci.yml и в needs у «All gates», плюс сделать «All gates» required check в branch protection для master и задокументировать это с датой.

### Answer to Q-002 · 2026-10-04

Нативный UI-тест iOS «создание первого сада» должен стать обязательным гейтом в CI или достаточно, чтобы он был в репозитории и успешно запу

A. Обязательный гейт в существующем swift-job с тем же path-фильтром (apps/ios/**): запускается при изменениях iOS и входит в «All gates».

### Answer to Q-003 · 2026-10-04

В какой среде браузерная проверка GG-0003, GG-0005 и GG-0007 считается доказательством для закрытия?

A. Ручная проверка в браузере на deployed development с записью версии web и даты в таблице Observations каждого issue.

### AI updated the requirements · 2026-10-04

DEC-001, DEC-002, DEC-003 written into the overview.

## 2026-10-04 - Implementation evidence and Q-004

The first hosted native UI test passed. A red required All gates check blocked
non-draft PR #31. Dated manual observations closed GG-0003; GG-0005 and GG-0007
remain open. The complete local browser run reached 52 passed and one existing
GG-0005 tabpanel assertion failure. Q-004 asks for resolution of the conflict
between the passing-suite requirement and DEC-003's fix exclusion. No prior
answer was re-asked, and no new answer or exception has yet been inferred.

## 2026-10-04 - Q-004 withdrawn after direct requirement audit

No user answer was received. Q-004 incorrectly assumed that R02 must make every
existing browser assertion pass. REQ-001 acceptance criterion 2 and plan I-2
require passing specs for garden creation, map editing, plants, observations,
and tasks; criterion 1 and I-1 require all specs to run and failures to propagate.
REQ-001 and I-6 explicitly exclude fixing failed GG-issues. Thus no contradiction
exists. Q-004 is withdrawn; F-002 records the resolution. The existing GG-0005
assertion and red gate remain intact. No recorded answer has been changed or
new permission inferred. Hosted evidence for the named core journeys is pending.

## 2026-10-04 - Final implementation audit

All seven REQ-001 acceptance criteria and all six implementation items are
verified. CI 37247309803 passed all named web journeys, native first-garden
creation/relaunch and supporting gates. The full browser result was 52 passed
and one retained GG-0005 failure, with no skips or flaky tests; required All
gates correctly failed. Dated manual deployed evidence closed GG-0003 and kept
GG-0005/GG-0007 open. No user answer was received for withdrawn Q-004, no
exception to the original decisions was applied, and no GG fix, merge or
release approval was inferred. The ledger contains source hashes and run links.
