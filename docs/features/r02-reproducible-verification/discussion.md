# Discussion — R02 - Reproducible Verification

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
