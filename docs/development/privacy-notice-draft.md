# US privacy notice — DRAFT FOR REVIEW (P8-PRIV-01)

> Status: DRAFT. Not reviewed by a lawyer, not approved, not published.
> Last updated: July 25, 2026

This document contains a complete draft of the user-facing US privacy notice for Verdery, plus the
reviewer-facing evidence behind every factual claim in it.

**I am not a lawyer and this is not legal advice.** The notice text below is a factual description
of what this system verifiably does with data, written in plain language and organized the way a
consumer privacy notice is usually organized. Whether it satisfies any particular law, whether its
categories map onto any statutory vocabulary, and whether it may be published are decisions for the
repository owner and counsel. Section 15 lists those decisions explicitly.

The hard part of a privacy notice is not the prose — it is the factual accuracy. Every claim in
section 2 has a code or schema reference in the evidence sections that follow, so a reviewer can
check each statement rather than trust it.

## 0. How to read this document

| Part                                                                                | What it is                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [1. Scope and status](#1-scope-and-status)                                          | What is buildable here, what is blocked, and on what                      |
| [2. The notice](#2-the-notice-draft-text)                                           | **The deliverable.** Plain-language draft, US audience, English           |
| [3–11](#3-data-inventory)                                                           | Reviewer evidence: inventory, data flows, permissions, consent, retention |
| [12. App Store declarations](#12-app-store-privacy-declarations-reconciled)         | Reconciled with `ios-distribution.md`                                     |
| [13. Russian translation](#13-russian-translation)                                  | Whether one is needed, and who decides                                    |
| [14. Corrections](#14-corrections-made-while-verifying)                             | Factual errors found in existing documents while verifying                |
| [15. Owner and counsel decisions](#15-decisions-only-the-owner-or-counsel-can-make) | The gate list                                                             |

Placeholders written as `[OWNER DECISION: …]` are deliberate. No legal entity name, address, contact
address, or effective date has been invented anywhere in this document.

## 1. Scope and status

### 1.1 What this work package could and could not deliver

**Buildable, and delivered here:** a complete, accurate, ready-for-review notice grounded in what
this system verifiably does, plus the evidence trail for it.

**Not buildable, and why:**

- **Legal review and approval** are owner gates. Nothing in this document has been reviewed by
  counsel.
- **Provider disclosures are partly blocked.** `P0-PROV-01` — the vendor evaluation — is undecided,
  so no weather vendor, plant-content vendor, photo-identification vendor, malware-scanning vendor,
  or transactional-email vendor exists to disclose. Section 10 says what is missing and what shape
  the missing text will take, so the gap is bounded rather than open-ended.
- **The consent posture cannot be described as a choice** because there is no choice to describe:
  `P0-SEC-01` is undecided and no client analytics exist. Section 6 covers this.

### 1.2 The environment reality this notice describes

A privacy notice describes a live service, so the state of the deployment matters:

- **One environment exists, `verdery-dev`.** There is no production or staging project
  (`infrastructure/gcloud/config/prod.env` states in its own header that nothing in it has been
  applied). `docs/development/threat-model.md` §2 records the same.
- **`services/workers` has never been deployed.** Every background sweep — media validation,
  derivative generation, retention, deletion purge, export generation, notification delivery —
  exists as code and does not run in `verdery-dev`.
- **The iOS app is not published.** No App Store record exists yet (`ios-distribution.md` §1).

None of this changes what the notice must say, because the notice must be true on the day the
service is real. But it does mean that the mechanisms the notice describes most confidently — the
export package, the deletion purge, the retention sweeps — are **code-complete and never yet run in
a deployment**, because they all live in `services/workers`. That distinction is recorded here and
in the evidence sections rather than in the user-facing text, where it would confuse without
changing what a user should expect.

## 2. The notice (draft text)

> Everything between here and the end of section 2 is the user-facing draft. It is written for a US
> consumer audience at roughly an eighth-grade reading level, in English.

---

# Verdery Privacy Notice

- **Effective date:** `[OWNER DECISION: effective date — not set]`
- **Who this notice comes from:** `[OWNER DECISION: legal entity name and mailing address — not set]`
- **How to contact us:** `[OWNER DECISION: contact address — not set]`

Verdery is an app for mapping your own garden and keeping a record of it: what you planted, where
it is, what you noticed, and what you still need to do. This notice explains what information
Verdery collects, why, who else sees it, how long it is kept, and what you can do about it.

## 1. What this notice covers

This notice covers the Verdery app for iPhone and iPad, the Verdery website, and the servers behind
them.

It does not cover what Apple or Google do with your information when you choose to sign in with an
Apple or Google account. Those are their services, governed by their own privacy policies.

## 2. The short version

- **Verdery collects what you put into it**: your garden's map, your plants, your notes, your
  photos, and your tasks — plus the email address you sign in with.
- **We use it to run Verdery for you.** That is the whole purpose.
- **We do not sell your information**, do not share it for advertising, and do not use it to build a
  profile of you.
- **There is no advertising, no tracking, and no analytics software** in the app or on the website.
  No advertising identifier is read. No third-party analytics or crash-reporting service is used.
- **You can get a complete copy of your data**, and you can have your account and everything in it
  permanently deleted.

## 3. Information we collect

### 3.1 Information you give us

**To sign in.** Verdery uses Firebase Authentication, a Google service, to sign you in. You can
sign in with Apple, with Google, or with a one-time sign-in link sent to your email address.
Firebase Authentication holds your account credentials and your email address. On our own servers
we store an opaque account identifier and, next to the sign-in method you used, the email address
that method verified. We do not ask for or store your name, your phone number, or your postal
address.

**Your garden content.** Everything you create in Verdery:

- garden names;
- the shapes you draw — beds, paths, fences, gates, structures, water features, trees, zones, and
  areas you mark as containing underground utilities, a septic field, or a well — together with any
  labels and notes you attach to them, including soil notes;
- your plants: names, varieties, quantities, spacing, condition notes, care notes, and the dates you
  planted, sowed, or acquired them;
- your observations: free-text notes and condition summaries, with the date you observed them;
- your tasks: titles, notes, due dates, time windows, and repeat schedules.

**Photos and files.** Photos you attach to plants and observations, and any plan, drawing, or
scanned document you import as a map background. **These are uploaded exactly as they are, byte for
byte.** That means any information your camera, phone, or scanner embedded in the file travels with
it. For photos taken on a phone, that commonly includes the exact place the photo was taken.
**Verdery does not currently remove that information from the file you upload.** The smaller copies
Verdery generates for display do have all embedded information removed, including location, but the
original you uploaded keeps it.

**Your settings.** Your language, your time zone, which notifications you want, and your quiet
hours if you set them.

### 3.2 Information Verdery generates while you use it

- **A history of changes.** Verdery keeps a record of edits to your map, plants, and tasks so you
  can see what changed and when. Those records name the account that made the change.
- **Care suggestions and the reasons for them.** When Verdery suggests something, it stores the
  suggestion, the rule that produced it, the facts that rule looked at, and the explanation you were
  shown.
- **Device records.** Each installation of the app generates an identifier for itself. We store that
  identifier along with the platform (iPhone/iPad or web), the app version, and when it was last
  seen, so that changes can be synchronized to the right devices. This is not a hardware
  identifier and it is not shared with anyone.
- **Records of your requests.** When you ask for an export or a deletion, we record that you asked,
  when, and whether it finished.
- **Security records.** We keep an append-only record of security-relevant events — an account
  being created, a garden being created, renamed, archived, or deleted, a file being deleted, a
  sensitive file being opened, and a deletion being requested, withdrawn, or completed. These
  records identify the account and the action. **They do not contain your IP address, a device
  fingerprint, or anything about what you looked at.**
- **Server logs.** Our servers write technical logs to run and troubleshoot the service: a request
  identifier, the operation, the result, and how long it took. These logs are written so that they
  never contain your content — no garden names, no notes, no coordinates, no file names, no photos.
  Separately, the Google Cloud service that runs Verdery records the network (IP) address of each
  request in its own request log, as it does for anything running on it.

### 3.3 Information we do not collect

- No name, phone number, postal address, or date of birth.
- No payment or financial information. Verdery does not take payments.
- No contacts, no calendar, no health or fitness data, no browsing or search history.
- No advertising identifier, and no data used for advertising of any kind.
- **No location from your device's location sensor.** Neither the app nor the website ever asks for
  location permission, and neither contains any code that reads your device's location.
- No analytics, product-usage tracking, or crash-reporting software.

## 4. Location information — exactly what is and is not true

Location deserves its own section because the honest answer has four parts.

**Your map is drawn in local measurements.** When you draw your garden, the shapes are stored as
distances in metres relative to your own garden, not as positions on the Earth. On their own they
say how big your garden is and how it is laid out, not where it is.

**A garden can carry a real-world anchor point, but nothing can set one yet.** Verdery is designed
so that a garden can be tied to a real-world coordinate, which would place your map on the Earth —
in practice, the location of your property. No version of the app can currently create that anchor.
If and when it can, that is precise location information about your home, and this notice will say
so plainly and describe how to remove it.

**Photos are the one way a precise location can reach us today.** As described in section 3.1,
photos are uploaded unchanged, and phone photos usually carry the coordinates where they were
taken. If you photograph your own garden, that coordinate is your garden's location. We do not use
it for anything, and it is not read, indexed, or displayed — but it is in the file we store, and
you should know that.

**Map backgrounds.** If a garden ever has a real-world anchor, the website shows a map background
loaded from OpenFreeMap, an outside map service. That service would then see your network address
and the area of the map you are looking at. Because no garden can have an anchor today, this does
not happen today.

## 5. Why we use your information

| We use it to                             | Which means                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Provide the service you asked for        | Store your garden and show it back to you, on every device you use                   |
| Keep your account working                | Sign you in, keep you signed in, and keep your account separate from everyone else's |
| Give you care suggestions                | Apply Verdery's rules to your own plants and your own records                        |
| Send you the notifications you asked for | Only the kinds you turned on, only outside your quiet hours                          |
| Keep the service secure and working      | Detect and investigate abuse, faults, and outages                                    |
| Meet our own record-keeping obligations  | Prove that a deletion actually happened, and keep a security trail                   |

We do not use your information for advertising, for training AI models, for selling to anyone, or
for building a profile of you.

## 6. Who else sees your information

**We do not sell your personal information.** We do not share it for cross-context behavioral
advertising. We do not give it to data brokers.

Some outside companies handle your information because they run parts of the service. They act on
our instructions for that purpose only.

| Who                                          | What they handle                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Google (Firebase Authentication)             | Your sign-in credentials and email address; sends the one-time sign-in link email                |
| Google (Google Cloud Platform)               | Our servers, database, file storage, work queue, and logs — all in the United States             |
| Apple, Google (as sign-in providers)         | Only if you choose "Sign in with Apple" or "Sign in with Google"                                 |
| Google (reCAPTCHA Enterprise) — website only | Checks that requests come from a real browser rather than an automated one                       |
| OpenFreeMap                                  | Map background tiles — **only** if a garden has a real-world anchor, which is not possible today |

**Companies we do not use, and want to be specific about:** no weather service, no plant-information
service, no plant-identification service, no analytics company, no advertising network, no
crash-reporting service, no marketing-email company, and no payment processor. `[OWNER/COUNSEL
DECISION: this list changes when P0-PROV-01 selects vendors. See section 10 of the review
notes below.]`

**Artificial intelligence.** Verdery contains an optional feature that would send a short,
structured summary of a care suggestion to Google's Vertex AI service to reword it. **This feature
is turned off, and it is off everywhere.** When it is off, no connection to that service is made at
all. If it is ever turned on, we will say so here first, and what would be sent is: the name of the
rule, the language, the explanation Verdery already wrote itself, the suggested action, and the
specific facts the rule used. It would not send your photos, your notes, your garden's name, your
account, or your location. **Your content is never used to train anyone's AI model.**

**Legal requests.** `[OWNER/COUNSEL DECISION: standard disclosure-for-legal-process language, if
counsel wants it. Not drafted here — no such request has ever been received and no process exists
for handling one.]`

## 7. Permissions and what is stored on your device

### On iPhone and iPad

**Verdery asks for no system permissions at all.** There is no permission prompt for photos, the
camera, location, the microphone, contacts, or notifications, because the app does not use any of
those system services.

Attaching a photo uses Apple's own photo picker, which runs outside the app. The app receives only
the single picture you chose and never gets access to your photo library. That is why no photo
permission prompt appears — the app has nothing to ask for.

On your device the app stores your garden data so it works without a connection, files waiting to
upload, and your sign-in state. Deleting the app removes all of it.

### On the website

The website requests no browser permissions — no location, no notifications, no camera, no
microphone.

It sets two cookies, both strictly necessary to run the site:

| Cookie       | What it is for                   | How long |
| ------------ | -------------------------------- | -------- |
| `__session`  | Keeps you signed in              | 14 days  |
| `csrf_token` | Protects against forged requests | 14 days  |

There are no advertising cookies and no analytics cookies. In your browser's local storage the site
keeps the email address you are waiting for a sign-in link for, drafts of things you have typed but
not saved, and the state of any upload in progress, so a reload does not lose them.

## 8. How long we keep things

| What                                                      | How long                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Your gardens, plants, observations, tasks, and photos     | Until you delete them, or delete the garden, or delete your account      |
| Smaller display copies of your photos                     | Deleted with the original                                                |
| Your account                                              | Until you delete it                                                      |
| Data export packages                                      | 7 days, then automatically deleted                                       |
| Download links for exports and photos                     | 15 minutes per link                                                      |
| Uploads you started but never finished                    | 7 days                                                                   |
| A deleted account or garden                               | 30 days, during which you can undo the deletion; then permanently erased |
| Security records, and the record that a deletion happened | Kept after the data itself is gone — see section 9                       |
| Server technical logs                                     | 30 days                                                                  |
| Backup copies                                             | Up to 7 days after deletion — see section 10                             |

**Raw scan recordings.** Verdery is designed to include a "Garden Scan" feature that records video
and depth data of your property, and the policy for it is that the raw recording is deleted 30 days
after Verdery finishes extracting your map from it. **We want to be exact about this: that feature
does not exist yet, nothing in Verdery can create such a recording, and the automatic deletion is
not implemented.** It is a stated policy, not something the system currently does. If the feature
ships, this notice will be updated to say whether the deletion is enforced, and it will not claim
enforcement that does not exist.

**Records that outlive your data on purpose.** Some records survive because deleting them would
break something a user depends on or would destroy proof that we did what we said:

- A permanent record that a specific account or garden was deleted, with timestamps and counts of
  rows removed. It contains no names, no filenames, no locations, and no copy of anything deleted.
- Security records of the events in section 3.2, kept so a security question can be answered later.
  `[OWNER/COUNSEL DECISION: how long. No period has been chosen. See the decision list.]`
- Small markers telling your other devices that something was deleted, so they stop showing it.
- Any plant name you added yourself to the shared plant catalogue. It stays in the catalogue,
  attached to an identifier that no longer points to you.

## 9. Getting a copy of your data, and deleting it

**Getting a copy.** You can ask for a complete export of your data. It arrives as a ZIP file
containing your garden records, your map in a standard geographic format, tables of your plants,
observations, tasks and suggestions, and your original photos and files, with a plain-language
README describing the contents and their limits. One export at a time per person. The package is
private to you, expires after 7 days, and each download link is good for 15 minutes.

**Deleting your account.** You can ask for your account to be deleted. What happens:

1. Your account is immediately made unusable, and you have **30 days** to change your mind.
2. Any garden you are the only owner of enters deletion on the same 30-day clock. A garden with
   another owner survives; only your access to it is removed. Gardens you were only an editor or
   viewer of are untouched.
3. After 30 days the deletion is **permanent and cannot be undone.** Your files are erased from
   storage first, and only once the bytes are confirmed gone are the database records removed. Then
   your sign-in identity is deleted from Firebase Authentication.
4. What remains is listed in section 8 under "Records that outlive your data on purpose".

Asking to delete your account, or a garden, requires that you have signed in within the last 30
minutes. This is deliberate: it means someone who gets hold of an unattended device or a stolen
session cannot destroy your garden.

**Deleting a garden** works the same way: 30 days to change your mind, then permanent.

`[OWNER DECISION: where the user does this. The server side is built and reachable through the API.
Neither the iPhone app nor the website has a screen for it yet, and the App Store requires an
in-app path before Verdery can be published. See the decision list.]`

## 10. Backups

We keep backups so that a fault or a mistake does not lose your garden.

**Deleting something removes it from the live service immediately, but a copy may remain in a
backup for a bounded period after that.** Today that period is up to 7 days: daily database backups
are kept for 7 days, and 7 days of transaction history is retained so the database can be restored
to a point in time. Deleted files can likewise be recovered from storage for 7 days before they are
gone for good.

Backups are never used to bring deleted data back into the live service. If a backup ever has to be
restored, deletions recorded before the restore are re-applied.

## 11. Support

`[OWNER DECISION: support contact address — not set. See the decision list.]`

We want to be straightforward about something most privacy policies are vague on: **how a human at
Verdery would look at your data if you asked for help.**

Most support questions are answered from technical logs that contain no user content at all — a
request identifier, an operation, and an outcome. Some questions cannot be, such as "my garden lost
a bed" or "my export is missing photos".

Today Verdery has **no built-in support tool** — no admin screen, no scoped query tool, and no
time-limited support access. Answering a question of that kind would mean a direct database query by
the person who holds the credentials. Until a proper mechanism exists, we hold ourselves to a rule:
this happens only when you ask us in writing, only for your own account, read-only, reading as
little as possible, and written down before and after. **That is a promise about our behaviour, not
something the system enforces.** Building a time-limited, audited support-access mechanism — which
would also notify you when it is used — is planned.

## 12. Security

Verdery keeps your data private to your account. Access is checked on the server for every request.
The database is not reachable from the internet. Files are stored privately and are only ever served
through short-lived links, issued only after we have checked that the file is yours to see. Credentials, sign-in tokens, and download links are removed
from logs by the logging system itself rather than by anyone remembering to leave them out. Data is
encrypted in transit and at rest.

No system is perfectly secure, and Verdery is a young one.

## 13. Children

`[OWNER/COUNSEL DECISION: not drafted. Verdery has no age gate, asks for no date of birth, and has
no way to know a user's age. The App Store age rating is 4+, which is a content rating, not a
statement that the service is directed at children. What this notice should say — and whether the
product needs an age gate — is a decision for counsel. See the decision list.]`

## 14. Your privacy rights

`[OWNER/COUNSEL DECISION: not drafted. Which US state privacy laws apply, which rights must be
described, how a request is verified, and whether an appeal process is required are questions for
counsel. What the system can already do is described in section 9: a complete machine-readable
export and a permanent deletion, both self-service and both requiring a recent sign-in.]`

## 15. Changes to this notice

If we change this notice we will update the effective date at the top.

`[OWNER DECISION: how a material change is announced. No in-app announcement mechanism exists
today, so no promise to notify you inside the app has been written here. See the decision list.]`

## 16. Contact us

`[OWNER DECISION: contact address — not set.]`

---

_End of the user-facing draft. Everything below is for reviewers._

## 3. Data inventory

Every category the notice describes, with its evidence. **Retention is marked `ENFORCED` (code or
infrastructure actually deletes it) or `DECLARED` (a stated policy nothing executes)** — the
distinction `service-levels.md` §8 established, carried through deliberately.

The "basis framing" column is descriptive, not a legal conclusion. US law generally does not use the
"legal basis" vocabulary; the column exists so counsel can map each row onto whatever framework
applies.

### 3.1 Identity and account

| Data                                                                        | Purpose                                | Basis framing                | Where it lives                                                                         | Retention                                                                | Evidence                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Email address, credentials, sign-in state                                   | Sign-in                                | Necessary to provide service | **Firebase Authentication (Google)** — not our database                                | Until account deletion; identity deleted via `deleteUser` at purge       | `services/api/src/platform/authentication/firebase-token-verifier.ts`             |
| `firebase_uid`, `account_state`, `locale`, `time_zone`, deletion timestamps | Account identity, language, scheduling | Necessary to provide service | `identity_access.profile`                                                              | Until purge; then minimized to `purged:<profileId>` tombstone (ENFORCED) | `migrations/1784736116655_…sql:34`; `modules/deletion/application/run-purge.ts`   |
| `provider`, `provider_uid`, `verified_email`                                | Duplicate-profile prevention, support  | Necessary to provide service | `identity_access.identity_provider_link`                                               | Deleted at account purge (ENFORCED)                                      | `migrations/1784736116655_…sql:66`; `purge-plan.ts` step `identity_provider_link` |
| Consent records                                                             | —                                      | —                            | `identity_access.consent_record` — **table exists, nothing ever writes to it**         | n/a                                                                      | `migrations/1784736116655_…sql:84`; no `insertInto` anywhere in `services/`       |
| `intended_email` on invitations                                             | Inviting a collaborator                | Necessary to provide service | `collaboration.invitation` — **no invitation endpoint exists; table is never written** | `expires_at` column exists; no producer                                  | `migrations/1784736116655_…sql:151`; `threat-model.md` §2 fact 2                  |

**The profile row has no `email` column and no name column of any kind.** Email exists in Postgres
only as `identity_provider_link.verified_email` and the never-written `invitation.intended_email`.
The canonical address is Firebase's.

### 3.2 Garden content

| Data                                                                                                                | Purpose        | Basis framing                | Where it lives                                                                  | Retention                                             | Evidence                                   |
| ------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Garden `name`, lifecycle state, deletion/recovery deadlines                                                         | The product    | Necessary to provide service | `gardens_mapping.garden`                                                        | Until deletion; 30-day recovery then purge (ENFORCED) | `migrations/1784736116655_…sql:104`        |
| Map geometry (`garden_object.geometry`, `tree_details.canopy_geometry`), labels, categories, provenance, confidence | The product    | Necessary to provide service | `gardens_mapping.garden_object` + 9 detail tables                               | With the garden (ENFORCED, `purge-plan.ts`)           | `migrations/1784800000000_…sql:89`         |
| `structure_kind` (house/shed/greenhouse/garage), `utility_exclusion_kind` (septic field, well radius), `notes`      | The product    | Necessary to provide service | `gardens_mapping.structure_details`, `…utility_exclusion_details`               | With the garden (ENFORCED)                            | `migrations/1784800000000_…sql:150,234`    |
| `coordinate_space.origin_description`, `bed_details.soil_notes`, `annotation_details.original_entry`                | The product    | Necessary to provide service | `gardens_mapping.*`                                                             | With the garden (ENFORCED)                            | `migrations/1784800000000_…sql:29,189,247` |
| Full edit history including historical geometry and the acting account                                              | Change history | Necessary to provide service | `gardens_mapping.garden_object_revision`                                        | With the garden (ENFORCED)                            | `migrations/1784800000000_…sql:276`        |
| Plant names, varieties, quantities, condition and care notes, acquisition dates                                     | The product    | Necessary to provide service | `plants_inventory.plant`                                                        | With the garden (ENFORCED)                            | `migrations/1784900000000_…sql`            |
| Observation `note_text`, `condition_summary`, `observed_at`                                                         | The product    | Necessary to provide service | `observations_history.observation` — **insert-only, no UPDATE, no delete path** | With the garden (ENFORCED)                            | `migrations/1784900000000_…sql`            |
| Task `title`, `notes`, `due_date`, time windows, `recurrence_rule`                                                  | The product    | Necessary to provide service | `tasks_recommendations.task`                                                    | With the garden (ENFORCED)                            | `migrations/1784900000000_…sql`            |
| User-defined plant names added to the shared catalogue                                                              | The product    | Necessary to provide service | `plants_inventory.taxonomy_reference`                                           | **Survives account purge** (documented exception)     | `purge-plan.ts:39-41`                      |

### 3.3 Location

| Data                                                                     | Purpose                  | Basis framing                | Where it lives                                                                     | Retention                              | Evidence                                                                  |
| ------------------------------------------------------------------------ | ------------------------ | ---------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| WGS84 anchor of the property (`geographic_anchor geometry(Point, 4326)`) | Placing the map on Earth | Necessary to provide service | `gardens_mapping.georeference` — **history-preserving; no writer exists anywhere** | With the garden (ENFORCED, if present) | `migrations/1784800000000_…sql:57-62`; `georeference-repository.ts:18-27` |
| EXIF GPS inside uploaded photo originals                                 | Not used — incidental    | Necessary to provide service | Cloud Storage `…-user-media` bucket, inside the object bytes                       | With the photo (ENFORCED)              | `apps/ios/Sources/CoreMediaTransfer/MediaUploadCoordinator.swift:138-168` |
| EXIF GPS inside derivatives                                              | Removed                  | —                            | Not stored                                                                         | n/a                                    | `services/workers/src/derivatives/image-derivative-generator.ts:13-39`    |
| `latitude` / `longitude` of the garden, snapshotted per weather fetch    | Weather for the garden   | Necessary to provide service | `integrations.weather_record` — **zero rows; no weather provider is registered**   | No retention rule (DECLARED: none)     | `migrations/1785700000000_…sql:118,125`; `compose-integrations.ts:66`     |

**The single most important correction this review produced:** `gardens_mapping.georeference` has
**no writer**. `GeoreferenceRepository` exposes only `findCurrentForGarden`, and there is no
`upsertGeoreference` command in `packages/geometry-contracts`. So today the georeference path
cannot put a real-world coordinate into the database at all. See section 14 below.

### 3.4 Photos, plans, and scan media

| Data                                                                                         | Purpose              | Basis framing                | Where it lives                   | Retention                                                               | Evidence                                                         |
| -------------------------------------------------------------------------------------------- | -------------------- | ---------------------------- | -------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `garden_photo` originals (bytes, unmodified, EXIF intact)                                    | The product          | Necessary to provide service | `verdery-dev-user-media` bucket  | Until deleted (ENFORCED via deletion workflow); **no bucket lifecycle** | `media-retention.ts:66-72`; `09-media-storage.sh:183-197`        |
| `imported_plan` originals — property plans, surveys, drawings; classified `sensitive`        | Map background       | Necessary to provide service | `verdery-dev-user-media` bucket  | Until deleted (ENFORCED)                                                | `media-retention.ts:73-79`; sensitivity in `media-record.ts`     |
| `raw_capture` — Garden Scan video, depth data; classified `restricted`                       | Map extraction       | Necessary to provide service | `verdery-dev-raw-capture` bucket | **DECLARED 30 days after extraction; `enforced: false`; no producer**   | `media-retention.ts:80-87`; section 8 below                      |
| `derived_preview` / `processing_output` — thumbnails, previews, tiles, all metadata stripped | Display              | Necessary to provide service | `verdery-dev-derived` bucket     | Deleted with the original (ENFORCED); Nearline at 30 days               | `config/lifecycle/derived-lifecycle.json`                        |
| `export_package` — a ZIP concentrating everything above for one requester                    | Data portability     | Necessary to provide service | `verdery-dev-exports` bucket     | **7 days, ENFORCED twice** (deadline + bucket lifecycle)                | `media-retention.ts:102-108`; `exports-lifecycle.json`           |
| `display_filename` — the file name you chose                                                 | Showing you the file | Necessary to provide service | `media.media_record`             | With the media record (ENFORCED)                                        | `migrations/1785100000000_…sql:96`                               |
| Object keys                                                                                  | Storage addressing   | —                            | `media.media_record.object_key`  | With the record                                                         | `media-storage-target.ts:72-91` — opaque `<shard>/<uuid>/<uuid>` |

Object keys contain no personal data: they are a SHA-256-derived shard plus two UUIDs, never the
filename. That is a verified fact, not an aspiration.

### 3.5 Suggestions and AI

| Data                                                                                                                              | Purpose                   | Basis framing                | Where it lives                                                                     | Retention                  | Evidence                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------ |
| Candidate suggestions and the rendered explanation shown to you                                                                   | Care suggestions          | Necessary to provide service | `tasks_recommendations.recommendation_candidate`                                   | With the garden (ENFORCED) | `migrations/1785600000000_…sql`, `1785800000000` |
| Evidence facts (`fact_key`, `fact_value jsonb`) snapshotting your garden's state at generation time                               | Explaining suggestions    | Necessary to provide service | `tasks_recommendations.recommendation_evidence`                                    | With the garden (ENFORCED) | `migrations/1785600000000_…sql`                  |
| Your responses (completed / postponed / dismissed / irrelevant)                                                                   | Improving suggestions     | Necessary to provide service | `tasks_recommendations.recommendation_feedback`                                    | With the garden (ENFORCED) | `migrations/1785600000000_…sql`                  |
| AI verdicts: `model`, `provider_key`, `prompt_template_version`, `packet_fact_keys`, `generated_text` (including rejected drafts) | Evaluating the AI feature | Necessary to provide service | `tasks_recommendations.recommendation_ai_explanation` — **zero rows; feature off** | With the garden (ENFORCED) | `migrations/1786100000000_…sql:55`               |

The AI table stores model output and the _keys_ of the facts sent — never the assembled prompt text
and never the fact values.

### 3.6 Notifications and devices

| Data                                                                                                                         | Purpose             | Basis framing                  | Where it lives                                                                    | Retention                                                                    | Evidence                              |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| Notification intents: `template_parameters jsonb` (plant/garden names), `deep_link`, `read_at`, `dismissed_at`, `expires_at` | In-app inbox        | Necessary to provide service   | `notifications.notification_intent`                                               | Expired by state transition; rows deleted at account/garden purge (ENFORCED) | `migrations/1786000000000_…sql:101`   |
| Per-type, per-garden channel preferences                                                                                     | Your choices        | Necessary to provide service   | `notifications.notification_preference`                                           | Deleted at purge (ENFORCED)                                                  | `migrations/1786000000000_…sql:184`   |
| Quiet hours (`start_minute`, `end_minute`, IANA zone)                                                                        | Not disturbing you  | Necessary to provide service   | `notifications.notification_preference_document`                                  | Deleted at account purge (ENFORCED)                                          | `migrations/1786000000000_…sql:216`   |
| `fcm_token` (plaintext), `installation_id`, `platform`, `environment`, `last_seen_at`                                        | Push delivery       | Necessary to provide service   | `notifications.notification_device` — **zero rows; no client registers a device** | Deleted at account purge (ENFORCED)                                          | `migrations/1786200000000_…sql:53-79` |
| Delivery attempts: `device_id` (no FK), outcome, provider error code — never the response body                               | Diagnosing delivery | Security and service operation | `notifications.notification_delivery_attempt`                                     | Cascades with the intent (ENFORCED)                                          | `migrations/1786200000000_…sql`       |
| Sync installation: id, `platform`, `app_version`, `registered_at`, `last_seen_at`                                            | Offline sync        | Necessary to provide service   | `platform.sync_client_installation`                                               | Deleted at account purge (ENFORCED)                                          | `migrations/1785000000000_…sql:48`    |

`sync_client_installation.profile_id` is **reassignable** — the same installation id legitimately
moves to a different profile when a different person signs in on the same device. That is documented
device-to-account linkage across accounts, and counsel should know it exists.

### 3.7 Exports, deletion, audit, and operational records

| Data                                                                                                                                    | Purpose                   | Basis framing                  | Where it lives                                          | Retention                                                                 | Evidence                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Export requests: scope, `include_media`, `session_credential_kind`, `session_authenticated_at`, bucket/key, checksum, `expires_at`      | Data portability          | Necessary to provide service   | `exports.export_request`                                | Package expires at 7 days (ENFORCED); row deleted at purge                | `migrations/1786300000000_…sql:89`                            |
| Deletion evidence: ids, timestamps, `attempt_count`, `media_records_scheduled`, `identity_provider_deleted_at`, per-step `rows_deleted` | Proving deletion happened | Record-keeping                 | `deletion.deletion_record`, `deletion.purge_checkpoint` | **Permanent by design** (DECLARED: no period chosen)                      | `migrations/1786400000000_…sql:111,168`                       |
| Audit events: `event_type`, `subject_type`, `subject_id`, `actor_profile_id`, `actor_type`, `details jsonb`                             | Security trail            | Security and service operation | `platform.audit_event`                                  | **Nothing deletes them (DECLARED: none chosen)**; `PROPOSED` 7y/2y        | `migrations/1784736116655_…sql:264`; `service-levels.md` §8.1 |
| Sync change log (tombstones, `target_profile_id`)                                                                                       | Offline convergence       | Necessary to provide service   | `platform.sync_change`                                  | **DECLARED 30 days (client cursor window); NOT ENFORCED — grows forever** | `service-levels.md` §8                                        |
| Idempotency records — including `response_body jsonb`, i.e. complete API responses                                                      | Safe retries              | Necessary to provide service   | `platform.idempotency_record`                           | **DECLARED 24h/30d; NOT ENFORCED.** Deleted at account purge (ENFORCED)   | `migrations/1784736116655_…sql:192`; `purge-plan.ts`          |
| Outbox events (`payload jsonb`, `trace_id`)                                                                                             | Reliable async work       | Necessary to provide service   | `platform.outbox_event`                                 | No TTL; deleted at garden/account purge (ENFORCED)                        | `migrations/1784736116655_…sql:213`; `purge-plan.ts`          |

**`platform.audit_event` has no IP-address column, no user-agent column, no session id, and no
geolocation.** The only actor identification is `actor_profile_id` plus `actor_type`. `details
jsonb` is unconstrained, so nothing structurally prevents an IP from being written there — no
current producer does.

### 3.8 Logs and telemetry

| Data                                                                                                                                                                     | Purpose               | Basis framing                  | Where it lives                              | Retention                                                   | Evidence                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------ | ------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Application logs: `correlationId`, `traceId`, route, status, duration, typed outcome events                                                                              | Operating the service | Security and service operation | Google Cloud Logging                        | 30 days (Cloud Logging `_Default` bucket, never configured) | `logger.ts`; `service-levels.md` §8                      |
| Removed before writing: `authorization`, `cookie`, `x-firebase-appcheck`, `proxy-authorization`, `set-cookie`, `databaseUrl`, `password`, `token`, `secret`, `signedUrl` | Not collected         | —                              | —                                           | —                                                           | `services/api/src/platform/telemetry/logger.ts:26-39,55` |
| Cloud Run request logs, including `httpRequest.remoteIp` — **the client IP address**                                                                                     | Platform default      | Security and service operation | Google Cloud Logging                        | 30 days (platform default)                                  | `runbooks.md:1702` (RB-08 queries `remoteIp`)            |
| OpenTelemetry spans → Google Cloud Trace (HTTP, Fastify, `pg`)                                                                                                           | Latency diagnosis     | Security and service operation | Google Cloud Trace                          | Google default — **unverified**                             | `services/api/src/telemetry-bootstrap.ts:31`             |
| iOS diagnostics                                                                                                                                                          | On-device only        | —                              | Apple `OSLog` on the device; no remote sink | Device-managed                                              | `apps/ios/Sources/CoreObservability/DiagnosticLog.swift` |

**Unverified, and stated as unverified:** whether the `pg` OpenTelemetry instrumentation records SQL
parameter values into Cloud Trace. Nothing in this repository configures it either way. If it does,
user content would reach Cloud Trace. This is worth closing before publication and is on the
decision list.

**Load-balancer and Cloud Armor logs do not exist.** Scripts `11-load-balancer.sh` and
`12-cloud-armor.sh` are drafted and explicitly never executed; `threat-model.md` §2 fact 4 confirms
there is no load balancer and no Cloud Armor.

### 3.9 Client-side storage

| Surface | What is stored                                                                                                                     | Evidence                                                                           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| iOS     | Per-profile SQLite garden database (GRDB), files queued for upload, sign-in state, one `UserDefaults` key `verdery.emailForSignIn` | `apps/ios/Resources/PrivacyInfo.xcprivacy` (`CA92.1` reason); `CorePersistence`    |
| Web     | Cookies `__session` and `csrf_token`, both 14 days, `HttpOnly` (session cookie only), `Secure`, `SameSite=strict`                  | `services/api/src/platform/authentication/transport/session-routes.ts:23,30-49`    |
| Web     | `localStorage`: `verdery.emailForSignIn`; `verdery.draft.<type>.<scope>` (unsaved user content)                                    | `apps/web/core/auth/sign-in.ts:25`; `apps/web/core/drafts/local-draft-store.ts:42` |
| Web     | `IndexedDB`: `verdery.media.pendingUploads` (resumable upload state)                                                               | `apps/web/features/media/indexed-db-pending-upload-store.ts:28`                    |
| Web     | `sessionStorage`: nothing                                                                                                          | verified absent                                                                    |

**Unverified:** the cookies and storage the Firebase JS SDK and reCAPTCHA Enterprise write in the
browser. Those are vendor-controlled and not visible in this repository. A cookie disclosure that
must be complete has to be measured in a browser, not read from code.

**Also unverified:** that iOS sign-in state lands in the Keychain. `security-and-privacy.md` §10
says it does, and it is the Firebase Auth SDK's documented behaviour, but `apps/ios/Sources`
contains no Keychain call of its own — the storage is entirely inside the SDK. The notice therefore
says "your sign-in state" without naming the mechanism.

### 3.10 Every number the notice states, and where it comes from

The notice quotes seven figures. All seven are enforced constants or live infrastructure settings,
not prose from a design document.

| Figure in the notice                        | Constant / setting                                                              | Where                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Export package expires after **7 days**     | `EXPORT_PACKAGE_RETENTION_DAYS = 7` **and** the exports-bucket rule             | `media-retention.ts:56`; `config/lifecycle/exports-lifecycle.json`     |
| Download links good for **15 minutes**      | `MEDIA_SIGNED_DOWNLOAD_TTL_MS = 900_000`                                        | `configuration-schema.ts:130`                                          |
| Unfinished uploads cleared after **7 days** | `STALE_UPLOAD_RECONCILIATION_DAYS = 7`                                          | `media-retention.ts:60`                                                |
| **30 days** to undo a deletion              | `DELETION_RECOVERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000`                        | `services/api/src/shared/deletion/deletion-policy.ts:26`               |
| Signed in within the last **30 minutes**    | `DELETION_RECENT_AUTHENTICATION_MAX_AGE_MS`; `RECENT_AUTHENTICATION_MAX_AGE_MS` | `deletion-policy.ts:41`; `modules/exports/domain/export-request.ts:50` |
| Cookies last **14 days**                    | `SESSION_COOKIE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000`                          | `platform/authentication/transport/session-routes.ts:23`               |
| Backups keep data up to **7 days**          | 7 retained backups, 7 days PITR, 7-day bucket soft delete                       | `14-cloud-sql-hardening.sh:15-24`; `runbooks.md` §1.3                  |

**Raw capture's 30 days is deliberately absent from this table**, because it is the one figure with
no enforcing constant. See section 8 below.

## 4. What leaves the system, and what does not

### 4.1 What leaves — verified

| Destination                               | What goes there                                                                              | Evidence                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Firebase Authentication (Google)          | ID tokens / session cookies for verification; provider UID on deletion; the magic-link email | `firebase-token-verifier.ts`; `firebase-identity-provider-account-gateway.ts:38-50` |
| Apple / Google identity endpoints         | Only when the user chooses those sign-in buttons                                             | `apps/web/core/auth/sign-in.ts:27-45`; `FirebaseAuthenticationGateway.swift:78-90`  |
| Google Cloud Storage                      | **Photo and plan bytes, direct from browser/device** to `storage.googleapis.com`             | `apps/web/features/media/gcs-resumable-transport.ts:78`; `GCSResumableUpload.swift` |
| Google Cloud Tasks                        | Job manifests: ids, bucket/object keys, checksums, **and `validation.displayFilename`**      | `packages/api-contracts/src/media-processing.ts:165-205`                            |
| Google reCAPTCHA Enterprise (web only)    | App Check attestation signals; **exact contents vendor-defined and unverified**              | `apps/web/core/auth/app-check.ts:20,39-42`                                          |
| Google Cloud Logging / Trace / Monitoring | Logs and spans as described in §3.8                                                          | `logger.ts`; `telemetry-bootstrap.ts`                                               |
| Firebase Cloud Messaging                  | **Data-only** push payloads: ids and template keys, no rendered text                         | `services/api/src/modules/notifications/persistence/fcm-push-message-sender.ts`     |
| OpenFreeMap (`tiles.openfreemap.org`)     | Browser IP + the map area viewed — **only when a garden has a georeference**                 | `apps/web/features/map/basemap-provider.ts:69`; `map-basemap.tsx:44`                |

The OpenFreeMap path is not currently reachable, because no georeference can exist (§3.3). It is
disclosed anyway: the gate is a data condition, not a configuration flag, so a single future feature
turns it on.

### 4.2 What does not leave — verified absent

Exhaustively searched for and not found anywhere in `apps/web`, `apps/ios/Sources`, `services/`, or
`packages/`: Sentry, Crashlytics, Segment, Amplitude, Mixpanel, Google Analytics / gtag / GTM,
Plausible, PostHog, Datadog, Bugsnag, Rollbar, New Relic, Matomo, Hotjar, FullStory, LogRocket,
AppsFlyer, Firebase Analytics, Firebase Performance, Firebase Remote Config, IDFA /
`ASIdentifierManager` / `AppTrackingTransparency`.

Also absent: any transactional-email provider (SendGrid, SES, Mailgun, Postmark, Resend, nodemailer,
SMTP), any SMS provider, any payment processor, any third-party log sink, and any external font or
CDN reference in the web client.

### 4.3 Vertex AI — off, and structurally off

`RECOMMENDATION_AI_EXPLANATION_ENABLED` defaults to `'false'`
(`configuration-schema.ts:194-197`), is never set in any deploy script or CI workflow, and
`aiplatform.googleapis.com` is not among the APIs enabled by `01-enable-apis.sh`. When off, **no
GenAI client object is constructed at all** (`main.ts:100-125`) — it is not a runtime branch.

If enabled, the payload would be: `{ rule, language, baselineExplanation, suggestedAction,
evidenceFacts: [{factKey, factValue}] }` plus a constant system instruction
(`vertex-ai-explanation-adapter.ts:84-99,160-215`). No identifiers, no photos, no free-text notes.
`factValue` can encode garden state (a watering interval, a weather reading), which is why the
notice says "the specific facts the rule used" rather than claiming nothing about the garden goes.

**Unverified and moot while disabled:** Vertex AI project-level retention and abuse-monitoring
settings. That becomes a real disclosure question the day the flag flips, and belongs on the
enablement checklist rather than in this notice.

### 4.4 Providers that do not exist

| Provider class       | State                                                                                 | Evidence                           |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| Weather              | Port only. `new WeatherProviderRegistry([])`; `WEATHER_ACTIVE_PROVIDER_KEY` never set | `compose-integrations.ts:66`       |
| Plant content        | Port and use cases exist but are **not composed anywhere**                            | no reference in any `compose-*.ts` |
| Photo identification | Stub returning `{ null, 0 }` — no image ever leaves for analysis                      | `identify-plant-from-photo.ts`     |
| Malware scanning     | Honest always-`unavailable` placeholder                                               | `threat-model.md` `T-UPL-12`       |
| Transactional email  | None. Firebase Authentication sends the sign-in link itself                           | verified absent                    |

## 5. Permission copy — both clients

### 5.1 iOS: the usage strings that exist

**None.** `apps/ios/project.yml` and the generated `Info.plist` contain **zero** `NS*UsageDescription`
keys, and no `InfoPlist.strings` file exists in either language. The app requests no system
permission of any kind at runtime.

### 5.2 iOS: the usage strings deliberately omitted, and why

| Key                                   | Why it is absent                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NSPhotoLibraryUsageDescription`      | Photo selection uses SwiftUI `PhotosPicker` exclusively, which runs **out of process**. The app receives only the chosen item and gets no library access, so iOS asks nothing. |
| `NSCameraUsageDescription`            | No `AVFoundation` / `AVCapture` anywhere in `apps/ios/Sources`                                                                                                                 |
| `NSLocationWhenInUseUsageDescription` | No `CoreLocation` / `CLLocationManager` anywhere. The one MapKit view is non-interactive and `accessibilityHidden`, and never shows the user's position                        |
| `NSMicrophoneUsageDescription`        | No audio capture code                                                                                                                                                          |
| `NSContactsUsageDescription`          | No `Contacts` import                                                                                                                                                           |
| Push / `aps-environment`              | No `UserNotifications`, no `FirebaseMessaging`, no `registerForRemoteNotifications`. The entitlement file carries only `com.apple.developer.applesignin`                       |

**The photo-picker choice is a real and defensible privacy decision, and the notice says so.**
Out-of-process picking is strictly better than library access plus a good permission string: the app
cannot enumerate, cannot re-read, and cannot silently widen its access later. It is worth stating
in the notice precisely because the absence of a prompt otherwise looks like an omission.

Frameworks actually linked: `FirebaseAuth`, `FirebaseAppCheck`, `FirebaseCore`, `GRDB` — deliberately
no Analytics, no Crashlytics, no Messaging (`apps/ios/Package.swift`).

### 5.3 Web

No browser permission is ever requested: verified absent are `navigator.geolocation`,
`Notification.requestPermission`, and `getUserMedia`. MapLibre ships a `GeolocateControl`; the app
never instantiates it (`apps/web/features/map/map-basemap.tsx` imports only `AttributionControl` and
`Map`).

No cookie banner and no consent UI exist, and no `/privacy`, `/terms`, `/legal`, or `/support`
route exists. Both cookies are strictly necessary; whether that is enough to publish without a
banner in the target jurisdictions is a counsel decision.

### 5.4 Copy that would have to be written if a permission is ever added

Not needed today, recorded so the next author does not have to rediscover it: the moment Garden Scan
(camera + depth), push notifications, or a location-picker for the georeference lands, each needs a
usage string in **both** `en` and `ru` (`CFBundleLocalizations` declares both), a matching notice
paragraph, and — for camera capture of neighbouring property — the sensitivity handling
`garden-capture-and-scan.md` §17 already specifies.

## 6. Consent posture

**There is no consent mechanism, and the notice must describe today's reality rather than a design.**

- `identity_access.consent_record` exists as a table with `consent_type`, `consent_version`, and
  `granted_at`. **Nothing writes to it.** There is no `insertInto('identity_access.consent_record')`
  anywhere in `services/`. Its only consumers are the export reader and the purge plan.
- No consent-checking code exists on the server or in either client.
- No client analytics exist to gate. `P0-SEC-01` — which owns the consent model — is undecided, and
  `P4-OBS-01` and the consented half of `P7-ANALYTICS-01` are documented deferrals blocked on it.
- What the codebase calls "analytics" is server-side structured logging over data the server already
  holds operationally. The boundary is pinned by a test that catalogs every event's exact field set
  and rejects identity- and content-shaped field names
  (`services/api/tests/analytics/care-loop-analytics.test.ts`).

The consequence for the notice: it makes **no consent claim at all**, because there is nothing to
consent to and no mechanism to record consent with. If `P0-SEC-01` later introduces analytics, the
notice needs a consent section and the product needs the mechanism. The table is already there to
record it.

## 7. Support access

The notice's §11 is deliberately blunt, and it matches the finding in `threat-model.md` §14 and
`support-operations.md` §5.3 exactly: **no support-access mechanism exists.** No administrative role,
no impersonation, no support session, no time-limited elevation, no admin surface in `services/api`,
`apps/web`, or `apps/ios`. `platform.audit_event` already constrains `actor_type` to include
`'administrator'` — a value with no producer anywhere, because the actor it was written for was never
built.

`security-and-privacy.md` §18 commits to support access that is "time-limited and audited". Writing
that sentence into a user-facing notice would be a false statement. The notice instead says what is
true: most support questions are answered from content-free logs; the rest would require a direct
database query; the constraint on that is a written rule, not a control; and a real mechanism is
planned.

There is a second reason this section has to be honest. `support-operations.md` §8 lists "the
support-access disclosure in the privacy notice" as an owner gate owned by this work package — the
disclosure _is_ the deliverable, and a disclosure that overstates the control defeats its purpose.

One related gap worth surfacing to counsel: **requesting an export writes no audit event at all**
(`T-SUPPORT-05`). The highest-value data-egress operation in the product currently leaves no audit
row, while its sibling media and gardens modules both write one. `threat-model.md` §16.2 has an
apply-ready fix. It is not this document's to apply, but a notice that promises a security trail
should be published against a system that has one for exports.

## 8. Raw-capture retention — language that does not promise the unexecutable

This is the single most dangerous sentence in the whole notice, because the natural phrasing —
"raw recordings are deleted after 30 days" — would be false.

**What is true, verified:**

- `RAW_CAPTURE_RETENTION_DAYS = 30` exists, with `anchor: 'successful_extraction'` and
  **`enforced: false`** (`media-retention.ts:80-87`).
- `deriveDefaultRetentionDeadline` returns `null` for every media class except `export_package`
  (`media-retention.ts:119-125`), so **no raw-capture deadline is ever computed**.
- The anchoring event has no producer: Garden Scan is Phase 10 and there is no camera, ARKit,
  RealityKit, or capture code anywhere in `apps/ios/Sources`.
- The `verdery-dev-raw-capture` bucket has **no lifecycle rule** (`09-media-storage.sh:199-227`).

So a raw capture cannot currently be created, and if one existed nothing would delete it.

**The chosen notice language** (§8 of the notice) states three things separately: the policy, that
the feature does not exist, and that the deletion is not implemented. `service-levels.md` §8.1 asks
for exactly this — "state it in the privacy notice in exactly those words" — and the alternative it
offers is a bucket lifecycle rule as a backstop that does not depend on the missing anchoring event.
**That alternative is the better outcome and is on the decision list**: a lifecycle rule would let a
future version of the notice say "deleted after 30 days" truthfully.

## 9. Backups and deletion

`data-export-and-deletion.md` §14 is the internal statement: deletion from active systems does not
imply immediate physical removal from backups. The notice's §10 is that statement in plain language,
with the actual numbers.

**Verified against the live instance** (read from `verdery-dev-pg` and recorded in
`14-cloud-sql-hardening.sh:15-24`):

| Mechanism                        | Value                                   | Enforced                                                     |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| Cloud SQL automated backups      | Daily 09:00 UTC, **7 retained**         | Yes — live and succeeding                                    |
| Cloud SQL point-in-time recovery | Enabled, **7 days** of transaction logs | Yes                                                          |
| Cloud Storage soft delete        | **7 days, all four buckets**            | Yes — the untouched bucket default; object versioning is off |

So the honest maximum window in which deleted data survives somewhere is **7 days**, and the notice
says 7 days rather than a vaguer "for a limited period".

Two caveats for the reviewer, neither of which changes the user-facing number:

- `infrastructure/gcloud/config/prod.env` declares **30** retained backups. That file has never been
  applied and no production project exists. **If a production environment is created with those
  settings, the notice's number becomes wrong** — the notice must be re-checked at production
  provisioning, and that is on the decision list.
- **No restore has ever been performed** (`runbooks.md` RB-02). Backups are verified to exist and
  succeed; the restore path is unexercised. That is an operational risk, not a privacy statement,
  and it is not in the notice.

The notice's promise that "deletions recorded before a restore are re-applied" corresponds to
`data-export-and-deletion.md` §14 and §18's "backup restore reapplying prior deletions" test line. It
is a designed behaviour, not an exercised one. **Recommend counsel review this sentence
specifically** — it is the one place the notice describes a procedure rather than a mechanism.

## 10. Provider disclosures — what is blocked

`P0-PROV-01` is undecided, so five vendor slots are empty (§4.4). This has three consequences for the
notice:

1. **The "who else sees your information" table is complete and short today**, and it is accurate
   precisely because the slots are empty. It is not a placeholder.
2. **The notice must be revised before any vendor is enabled.** Each of the five would add a
   recipient, and three of them (weather, plant identification, malware scanning) would add a _new
   category of data leaving the system_: the garden's coordinates for weather, photo bytes for
   identification and scanning.
3. **The data-processing terms cannot be drafted here.** What a vendor may do with user content —
   sub-processors, retention, model training — is a contract term, and there is no contract.
   `security-and-privacy.md` §17 and `garden-capture-and-scan.md` §17 already state the requirements
   ("Review provider subprocessors, retention, and model-training terms"; "Provider contracts must
   prohibit unauthorized model training on user content"). Those are the acceptance criteria for the
   contracts, not text for a notice.

**The shape of the missing text**, so the next author writes the same thing:

| Vendor slot          | Sentence to add when selected                                                             | New data leaving       |
| -------------------- | ----------------------------------------------------------------------------------------- | ---------------------- |
| Weather              | "<Vendor> provides weather for your garden's area. We send it your garden's coordinates." | Precise location       |
| Plant content        | "<Vendor> provides growing information about plant species. We send it a species name."   | None (species only)    |
| Photo identification | "<Vendor> suggests what a plant is from a photo. We send it the photo."                   | **Photo bytes + EXIF** |
| Malware scanning     | "<Vendor> scans files you upload for malware. We send it the file."                       | **File bytes**         |
| Transactional email  | "<Vendor> sends you email from us. We send it your email address and the message."        | Email address          |

The photo-identification and malware-scanning rows are the two that should force an EXIF-stripping
decision before they ship: sending an unmodified photo to a third party sends its GPS tag too.

## 11. Reconciliation with `data-export-and-deletion.md` and `service-levels.md`

The notice does not restate the internal documents; it must not contradict them either. The
reconciliations that required a judgement:

| Internal statement                                                                              | What the notice says                                                                                |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `security-and-privacy.md` §19: "Export packages — short-lived automatic expiration"             | "7 days" — the enforced figure `media-retention.ts` and the bucket lifecycle rule agree on          |
| `security-and-privacy.md` §19: "Deleted account recovery — 30 days before purge by default"     | "30 days" — matches `DELETION_RECOVERY_WINDOW_MS` and the backfilled `recovery_deadline_at`         |
| `security-and-privacy.md` §19: "Operational logs — shortest useful diagnostic retention"        | "30 days" — the Cloud Logging default, chosen deliberately per `service-levels.md` §8.1             |
| `security-and-privacy.md` §18: "Support access is time-limited and audited"                     | **Contradicted deliberately.** No such mechanism exists; the notice says so (§7 above)              |
| `security-and-privacy.md` §18: "Analytics uses consent and data minimization"                   | **Not stated.** There is no analytics and no consent mechanism (§6 above)                           |
| `security-and-privacy.md` §19: "Security audit records — policy-defined limited retention"      | **Not stated as a period.** No period is defined; the notice says the records are kept and flags it |
| `data-export-and-deletion.md` §11: "Removes analytics identifiers where supported and required" | **Not stated.** There are no analytics identifiers to remove                                        |

## 12. App Store privacy declarations, reconciled

`ios-distribution.md` §8 derived these from the code, and this review reproduced the derivation
independently. **The five declared types are correct and this document does not change them.**

| Data type          | Collected | Linked | Tracking | Purpose           | Verified source                                                |
| ------------------ | --------- | ------ | -------- | ----------------- | -------------------------------------------------------------- |
| Email address      | Yes       | Yes    | No       | App Functionality | Firebase Auth sign-in; `identity_provider_link.verified_email` |
| User ID            | Yes       | Yes    | No       | App Functionality | `profile.firebase_uid`, stamped on every synchronized record   |
| Photos or Videos   | Yes       | Yes    | No       | App Functionality | `garden_photo` / `imported_plan` originals                     |
| Other User Content | Yes       | Yes    | No       | App Functionality | Garden/plant names, notes, labels, soil notes, map labels      |
| Precise Location   | Yes       | Yes    | No       | App Functionality | See below                                                      |

`NSPrivacyTracking` is `false` and `NSPrivacyTrackingDomains` is empty
(`apps/ios/Resources/PrivacyInfo.xcprivacy`); the only required-reason API declaration is
`UserDefaults` with reason `CA92.1`, for the pending magic-link email address. Linked products are
`FirebaseAuth`, `FirebaseAppCheck`, `FirebaseCore`, `GRDB` only.

**Precise Location — the reconciliation.** `ios-distribution.md` gives two reasons for declaring it.
Reason 2 (EXIF GPS in unmodified photo uploads) is verified and is the operative one today. **Reason
1 (the georeference anchor) is not currently reachable**: no writer exists for
`gardens_mapping.georeference` (sections 3.3 and 14 of this document). The declaration stays exactly as it is — reason 2 alone
requires it, and the declaration is honest — but a reviewer should know that removing the EXIF
problem would not by itself let the declaration be dropped, because reason 1 returns the moment a
georeference command ships.

**Two items the reviewer should carry to Apple's questionnaire, both owner/counsel decisions:**

- **Client IP address in Cloud Run request logs.** Apple's declaration covers data collected from the
  app including server-side. Apple provides an exemption path for data collected solely for fraud
  prevention or security. Whether that exemption applies to platform request logs retained 30 days
  is a judgement, not a code fact, and this document does not make it.
- **The App Review notes in `ios-distribution.md` §9 describe in-app account deletion that does not
  exist.** That document flags it itself. It is repeated here only because the privacy notice's §9
  makes the same promise, and the two must ship together or neither.

## 13. Russian translation

**Verdery ships bilingual on both clients**, verified:

- iOS: `CFBundleLocalizations` declares `en` and `ru`; both `Localizable.strings` catalogues are 537
  lines.
- Web: `apps/web/shared/localization/messages/{en,ru}*.ts`.
- `ios-distribution.md` §7 already contains a full Russian App Store listing.

**Whether a Russian translation of the notice is required is not a technical question.** The facts
that bear on it:

- The notice is drafted for a **US audience**, and the launch is a controlled US private beta
  (`implementation-plan.md`, G7).
- A user running the app in Russian will nonetheless be shown an English-only privacy notice, which
  is a product-quality problem regardless of whether it is a legal one.
- If a translation ships, it becomes a second document that must be kept in sync, and a divergence
  between two published notices is worse than one notice.

**Who decides: the repository owner, with counsel.** The recommendation from here, offered as a
recommendation only: publish English first; add a Russian translation only when it can be maintained
in lockstep, and make the English version authoritative in the text if a translation ships. That is
on the decision list.

## 14. Corrections made while verifying

Every claim in section 2 was checked against code or schema before it was written. These are the
places where the existing documents did not survive that check, or where the natural phrasing would
have been wrong. Recorded so the corrections are not lost; **this document changes nothing in the
files it names.**

| #   | Claim as it stood                                                                                                                         | What the code says                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `ios-distribution.md` §8: "A garden's georeference anchor is a real-world coordinate … entered as content and synchronised to the server" | **No writer exists.** `GeoreferenceRepository` is read-only and no `upsertGeoreference` command exists. Today the only path by which a precise location reaches the server is EXIF                           |
| 2   | `threat-model.md` §3 lists the media class as `user_photo`                                                                                | The class is **`garden_photo`** (`media-record.ts:39`; migration CHECK constraint). Cosmetic, but a reviewer grepping for `user_photo` finds nothing                                                         |
| 3   | "Analytics uses consent" (`security-and-privacy.md` §18)                                                                                  | No consent mechanism exists at all; `consent_record` has **no writer**. The notice makes no consent claim                                                                                                    |
| 4   | "Support access is time-limited and audited" (`security-and-privacy.md` §18)                                                              | No support mechanism of any kind exists. Publishing this sentence would be a false statement                                                                                                                 |
| 5   | Natural phrasing: "raw scan recordings are deleted after 30 days"                                                                         | `enforced: false`, no deadline is ever computed, no bucket lifecycle rule, and no feature can create one. Section 8                                                                                          |
| 6   | Natural phrasing: "photos are stripped of location data"                                                                                  | **Only derivatives are.** Originals are stored byte-identical with EXIF intact, on both clients                                                                                                              |
| 7   | Natural phrasing: "we do not collect IP addresses"                                                                                        | Application logs genuinely do not. **Cloud Run request logs record `httpRequest.remoteIp`** and RB-08 queries it                                                                                             |
| 8   | Assumption that Cloud Tasks payloads carry only identifiers                                                                               | They also carry `validation.displayFilename` — the user's own file name                                                                                                                                      |
| 9   | Assumption that idempotency records hold only keys                                                                                        | `platform.idempotency_record.response_body jsonb` stores **complete API response bodies**, i.e. whatever personal data the endpoint returned. Nothing prunes them on expiry; account purge does delete them  |
| 10  | Assumption that a purged account leaves nothing                                                                                           | The profile row survives as a `purged:<profileId>` tombstone (~20 NOT NULL foreign keys from shared-garden content make deletion impossible), and user-defined taxonomy rows survive in the shared catalogue |
| 11  | Assumption that the web client contacts no third party                                                                                    | It loads MapLibre tiles from **`tiles.openfreemap.org`** whenever a garden has a georeference — currently unreachable, but a data-condition gate, not a flag                                                 |
| 12  | Assumption that push notifications reach devices                                                                                          | The server adapter is real and wired, but **no client registers a device**, so `notification_device` is empty and nothing is sent                                                                            |

## 15. Decisions only the owner or counsel can make

Nothing below is engineering work, except where marked. Ordered so that the first block gates
publication and the second gates accuracy over time.

### 15.1 Blocking publication

| #   | Decision                                                                                                                                                                                                                           | Owner                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1   | **Legal entity name and mailing address** to publish the notice under                                                                                                                                                              | Owner                       |
| 2   | **Contact address** for privacy questions and requests                                                                                                                                                                             | Owner                       |
| 3   | **Effective date**                                                                                                                                                                                                                 | Owner                       |
| 4   | **Legal review of the entire notice.** Nothing here has been reviewed                                                                                                                                                              | Counsel                     |
| 5   | **Which US state privacy laws apply**, and therefore what §14 of the notice must say                                                                                                                                               | Counsel                     |
| 6   | **Children's privacy** — whether the product needs an age gate and what §13 of the notice must say                                                                                                                                 | Counsel                     |
| 7   | **Whether to include legal-process disclosure language**                                                                                                                                                                           | Counsel                     |
| 8   | **Where the notice is hosted.** A privacy policy URL is required for App Store submission and for TestFlight external testing (`ios-distribution.md` §5, §12). No `/privacy` route exists on the web client                        | Owner                       |
| 9   | **Support contact address**, which the notice's §11 and the App Store's Support URL both need                                                                                                                                      | Owner                       |
| 10  | **Whether the notice may say a user can delete their account in the app.** The server side is built; neither client has the screen. Apple requires it (Guideline 5.1.1(v)). The notice and the App Review notes must ship together | Owner (engineering follows) |
| 11  | **How a material change to the notice is announced.** No in-app announcement mechanism exists, so the notice makes no promise to notify inside the app                                                                             | Owner                       |

### 15.2 Accuracy over time

| #   | Decision                                                                                                                                                                                                                                                | Owner                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 12  | **Audit-event retention.** Nothing deletes `platform.audit_event`. `service-levels.md` §8.1 proposes 7 years for security-relevant types and 2 years for the rest, and names this work package as the legal input                                       | Counsel, then owner          |
| 13  | **Raw-capture enforcement.** Accept `enforced: false` and publish the notice's §8 wording as drafted, **or** add a bucket lifecycle rule as a backstop so a future notice can promise deletion truthfully                                               | Owner (engineering follows)  |
| 14  | **EXIF stripping on upload.** The notice currently discloses that photos keep their location tag. Stripping it, or asking the user, is what most users would expect and is a prerequisite for any photo-identification or malware-scanning vendor       | Owner (engineering follows)  |
| 15  | **`platform.sync_change` and `platform.idempotency_record` growth.** Both declare a 30-day window that nothing enforces. Idempotency records contain full API response bodies. Either prune them or accept unbounded retention and say so               | Owner (engineering follows)  |
| 16  | **Whether OpenTelemetry `pg` instrumentation records SQL parameter values** into Cloud Trace — unverified, and if it does, user content reaches Cloud Trace                                                                                             | Owner (engineering verifies) |
| 17  | **Browser cookie audit.** The cookies and storage written by the Firebase JS SDK and reCAPTCHA Enterprise are vendor-controlled and must be measured in a browser before a cookie disclosure can claim completeness                                     | Owner (engineering verifies) |
| 18  | **Cloud Logging retention.** 30 days is the untouched platform default. `service-levels.md` §8.1 proposes choosing it deliberately                                                                                                                      | Owner                        |
| 19  | **Production backup retention.** `prod.env` declares 30 retained backups; the notice says 7, matching the only live instance. If production is provisioned as declared, the notice's §10 becomes wrong and must be updated in the same change           | Owner                        |
| 20  | **Provider disclosures on `P0-PROV-01`.** Each vendor selected adds a recipient and, for three of the five, a new category of data leaving the system. §10 gives the sentence shape for each                                                            | Owner, then counsel          |
| 21  | **Vertex AI enablement.** If `RECOMMENDATION_AI_EXPLANATION_ENABLED` is ever set true, the notice's §6 must change first, and the vendor's retention and abuse-monitoring settings must be verified                                                     | Owner                        |
| 22  | **Consent, when `P0-SEC-01` decides.** Any client analytics requires a consent section in the notice and a mechanism to record it. `identity_access.consent_record` already exists to record it                                                         | Owner                        |
| 23  | **Russian translation** — whether to publish one, and whether English is authoritative if so. §13                                                                                                                                                       | Owner, with counsel          |
| 24  | **Audit the export request** (`T-SUPPORT-05`). Requesting an export writes no audit row today. A notice that describes a security trail should ship against a system whose highest-value egress operation is in it. `threat-model.md` §16.2 has the fix | Owner (engineering follows)  |
| 25  | **Support-access mechanism** (`support-operations.md` §6). Until it exists, the notice's §11 must keep saying that the constraint is a written rule rather than a control                                                                               | Owner                        |
