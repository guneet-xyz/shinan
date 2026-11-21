# Changelog

## [0.4.0](https://github.com/guneet-xyz/shinan/compare/v0.3.0...v0.4.0) (2026-11-21)


### ⚠ BREAKING CHANGES

* **core:** build the agent index from main (GC-4) ([#186](https://github.com/guneet-xyz/shinan/issues/186))
* **web:** remove M2's catalog write screens and their API client (GC-5b) ([#182](https://github.com/guneet-xyz/shinan/issues/182))
* remove M2's catalog write path (GC-5a, core and server) ([#178](https://github.com/guneet-xyz/shinan/issues/178))

### Features

* **core:** build the agent index from main (GC-4) ([#186](https://github.com/guneet-xyz/shinan/issues/186)) ([eab2b52](https://github.com/guneet-xyz/shinan/commit/eab2b52d1adce05a7041710d7be97ce1c78b2afc))
* Git in the image and packages/git (GC-1a) ([#177](https://github.com/guneet-xyz/shinan/issues/177)) ([61e994a](https://github.com/guneet-xyz/shinan/commit/61e994a71c86bbaad9fda56b84059458d76aca79))
* migrate moves M2's catalog into Git, verified byte for byte, then drops M2's tables (GC-6) ([#198](https://github.com/guneet-xyz/shinan/issues/198)) ([b39754e](https://github.com/guneet-xyz/shinan/commit/b39754e3ee2afac399048169b12512005e7322c3))
* purge as a history rewrite (GC-8) ([#197](https://github.com/guneet-xyz/shinan/issues/197)) ([1639fff](https://github.com/guneet-xyz/shinan/commit/1639fff7649a54ef1d5b75a444a8958ee99597bd))
* push checks on every branch and the push log (GC-3a) ([#191](https://github.com/guneet-xyz/shinan/issues/191)) ([b4c1659](https://github.com/guneet-xyz/shinan/commit/b4c1659868fa7c9b53426404d3e2f395c3113dd1))
* serving Git over HTTPS through web (GC-2) ([#189](https://github.com/guneet-xyz/shinan/issues/189)) ([ac7c59f](https://github.com/guneet-xyz/shinan/commit/ac7c59fa38ab20dbe2996cbac2a37a85f37f2bef))
* **skill:** the skill and agent setup for the Git-based catalog ([#176](https://github.com/guneet-xyz/shinan/issues/176)) ([e4e0967](https://github.com/guneet-xyz/shinan/commit/e4e096764bb1581ef4a128614cdbafe8166a61a6))
* the checks of main and the by rule; main opens (GC-3b) ([#193](https://github.com/guneet-xyz/shinan/issues/193)) ([95e8fc8](https://github.com/guneet-xyz/shinan/commit/95e8fc8763a9030f4d9392ddfff4f65f9440d951))
* the Git container (GC-1b) ([#185](https://github.com/guneet-xyz/shinan/issues/185)) ([fdf18d9](https://github.com/guneet-xyz/shinan/commit/fdf18d944e9b6bb2d703a966691f0b848731ea72))
* **web:** one left sidebar for the whole app, and the catalog's folders (GC-7, part 1) ([#190](https://github.com/guneet-xyz/shinan/issues/190)) ([a4689af](https://github.com/guneet-xyz/shinan/commit/a4689afce633d424dcf532d70cc8aca7882d7a86)), closes [#169](https://github.com/guneet-xyz/shinan/issues/169)
* **web:** Recent changes, and Settings › Catalog (GC-7, part 3) ([#194](https://github.com/guneet-xyz/shinan/issues/194)) ([085edeb](https://github.com/guneet-xyz/shinan/commit/085edeb7fd60a29e316b24580ad4792cad83314d)), closes [#169](https://github.com/guneet-xyz/shinan/issues/169)
* **web:** the readable page, Start here, History and View source (GC-7, part 2) ([#192](https://github.com/guneet-xyz/shinan/issues/192)) ([2933e7f](https://github.com/guneet-xyz/shinan/commit/2933e7fa824532971ccb6aa8aa0fe793f1c03e14)), closes [#169](https://github.com/guneet-xyz/shinan/issues/169)
* **web:** who pushed each change, and the values that aren't secrets (GC-7 follow-up) ([#196](https://github.com/guneet-xyz/shinan/issues/196)) ([d0ed067](https://github.com/guneet-xyz/shinan/commit/d0ed06753c73ea7d012ce5ca3e7a19c44fb40a7f)), closes [#169](https://github.com/guneet-xyz/shinan/issues/169)


### Bug Fixes

* a catch-up no longer marks an index rebuilt meanwhile; tests that act on the whole installation get their own database ([#205](https://github.com/guneet-xyz/shinan/issues/205)) ([b42a05a](https://github.com/guneet-xyz/shinan/commit/b42a05a1ec2e6f41def1ba367603f6bf9b07b061))
* **core:** give agent index failures a reason, and keep the daily check going ([#188](https://github.com/guneet-xyz/shinan/issues/188)) ([3e6860a](https://github.com/guneet-xyz/shinan/commit/3e6860abe39095bf27387444714a6fc12fc205ce))
* **db:** the drop of M2's tables waits at most 15 seconds for their lock ([#199](https://github.com/guneet-xyz/shinan/issues/199)) ([490f5f9](https://github.com/guneet-xyz/shinan/commit/490f5f9aa8ad6d37d3243814cd93412baa9b292c))


### Code Refactoring

* remove M2's catalog write path (GC-5a, core and server) ([#178](https://github.com/guneet-xyz/shinan/issues/178)) ([8b3b95c](https://github.com/guneet-xyz/shinan/commit/8b3b95cb8ffc6ea53a23ae23c9919affc8cd63d5))
* **web:** remove M2's catalog write screens and their API client (GC-5b) ([#182](https://github.com/guneet-xyz/shinan/issues/182)) ([df7edc6](https://github.com/guneet-xyz/shinan/commit/df7edc6a0c0d0f6ceba1ee5ed2dc7a77e5ed1273))

## [0.3.0](https://github.com/guneet-xyz/shinan/compare/v0.2.1...v0.3.0) (2026-11-19)


### Features

* agent index, search and the catalog revision store ([#107](https://github.com/guneet-xyz/shinan/issues/107)) ([59459b9](https://github.com/guneet-xyz/shinan/commit/59459b936c060e57aefa9c336ada37129faed6dd))
* agents and hand-made agent tokens ([#96](https://github.com/guneet-xyz/shinan/issues/96)) ([6990282](https://github.com/guneet-xyz/shinan/commit/6990282dc5805350f08a924868dc314b9684f000))
* catalog proposals, applied in a worker with a time limit, and catalog approval ([#112](https://github.com/guneet-xyz/shinan/issues/112)) ([ca2e572](https://github.com/guneet-xyz/shinan/commit/ca2e5725c37d7d309cfd59f76e44a2529783bf9c))
* catalog purge for workspace owners ([#132](https://github.com/guneet-xyz/shinan/issues/132)) ([ba4e4bc](https://github.com/guneet-xyz/shinan/commit/ba4e4bc836532728be8eab4f11f0993ea7828358))
* changing the catalog from the wiki, and catalog review ([#123](https://github.com/guneet-xyz/shinan/issues/123)) ([71b32f5](https://github.com/guneet-xyz/shinan/commit/71b32f5fd7466cc7d983cb80bfe1717753846d7d))
* comments on catalog proposals, the strict setting, bulk approval, recent changes and revert ([#124](https://github.com/guneet-xyz/shinan/issues/124)) ([9759bbe](https://github.com/guneet-xyz/shinan/commit/9759bbe5e139cb91465862563e8eaa83197fed4c))
* **core:** catalog document model, parser and fact identity keys ([#95](https://github.com/guneet-xyz/shinan/issues/95)) ([eb855b8](https://github.com/guneet-xyz/shinan/commit/eb855b8b1b6129882cea8afdc8236c3aea4ed94c))
* **core:** catalog operations as text edits, with conflict checks ([#108](https://github.com/guneet-xyz/shinan/issues/108)) ([c698bef](https://github.com/guneet-xyz/shinan/commit/c698bef122b7ee99016e4b99d18e5b05d45111b0))
* **core:** export the agent-token prefix ([#94](https://github.com/guneet-xyz/shinan/issues/94)) ([4989daa](https://github.com/guneet-xyz/shinan/commit/4989daa0f2cef74d1c97428a7eb596ccba0f1675))
* **core:** read catalog bodies with markdown-it, shared with the wiki ([#105](https://github.com/guneet-xyz/shinan/issues/105)) ([6e240cf](https://github.com/guneet-xyz/shinan/commit/6e240cff4cfb56fff7430782dcc789913fc77cbd))
* **core:** stricter written_by provenance for trust labels ([#111](https://github.com/guneet-xyz/shinan/issues/111)) ([826d2d9](https://github.com/guneet-xyz/shinan/commit/826d2d912641e872b817740642eda0cd257e77fe))
* **core:** validate catalog documents and check for secrets ([#99](https://github.com/guneet-xyz/shinan/issues/99)) ([f7a1f8d](https://github.com/guneet-xyz/shinan/commit/f7a1f8dcca2b3e811e6f45038f87981de065e6d9))
* MCP endpoint with the catalog read tools and trust labels ([#115](https://github.com/guneet-xyz/shinan/issues/115)) ([28036a9](https://github.com/guneet-xyz/shinan/commit/28036a90be464d55ea51b1dbfda7c27b7857fe64))
* MCP write tools over catalog proposals ([#122](https://github.com/guneet-xyz/shinan/issues/122)) ([2464f84](https://github.com/guneet-xyz/shinan/commit/2464f84b5979f6ed7184d17f68c176e16cd9a146))
* proposals waiting on an entity page, who approved each revision, and links to type schemas and Start here ([#134](https://github.com/guneet-xyz/shinan/issues/134)) ([887dbb2](https://github.com/guneet-xyz/shinan/commit/887dbb2c7ff5775c6256d35b09657e3b837e780e))
* record invitations as expired when they expire ([#129](https://github.com/guneet-xyz/shinan/issues/129)) ([166c0f1](https://github.com/guneet-xyz/shinan/commit/166c0f1248fd2562093ab207f94babce5184d28c))
* self-service email change, confirmed by a link to the new address ([#137](https://github.com/guneet-xyz/shinan/issues/137)) ([85e210c](https://github.com/guneet-xyz/shinan/commit/85e210cdade1c772a3a741964466c0876cc64e5e))
* the agent skill at /skills/ and the OpenCode setup guide ([#119](https://github.com/guneet-xyz/shinan/issues/119)) ([19bc901](https://github.com/guneet-xyz/shinan/commit/19bc9015804de0769638c27a01c7b2b6d1a279de))
* the wiki for reading the catalog ([#118](https://github.com/guneet-xyz/shinan/issues/118)) ([4814127](https://github.com/guneet-xyz/shinan/commit/4814127427549b4e1dfbfc0e0db197b132bb7da6))
* **web:** comments, revert, the strict setting and bulk approval in the wiki ([#146](https://github.com/guneet-xyz/shinan/issues/146)) ([3d0bf3e](https://github.com/guneet-xyz/shinan/commit/3d0bf3eebab5c1ae5608077ed5d795f1f68d09ab))
* workspace owners repair a catalog document that reads with problems ([#141](https://github.com/guneet-xyz/shinan/issues/141)) ([56c0cc9](https://github.com/guneet-xyz/shinan/commit/56c0cc96b1e54b30b69130a01a06d6b848b6e3e9))


### Bug Fixes

* **core:** reserve fact-check field names as relation attributes; deflake pool.test.ts ([#130](https://github.com/guneet-xyz/shinan/issues/130)) ([6a6d854](https://github.com/guneet-xyz/shinan/commit/6a6d8544adeb879c22befb3a6916132ff0602cac))
* **core:** say which catalog limit a change passes, what counts, and how to make room ([#139](https://github.com/guneet-xyz/shinan/issues/139)) ([295a01a](https://github.com/guneet-xyz/shinan/commit/295a01a0a3bf3ccf2f41133bb6c82cdc012c0f6c))
* **core:** text-edit follow-ups: comments, one-section edits, object member keys ([#114](https://github.com/guneet-xyz/shinan/issues/114)) ([b217650](https://github.com/guneet-xyz/shinan/commit/b217650ac0ea93befe657b55e2fcac62a99c25ce))
* **deploy:** set the image's /app ownership and modes deterministically ([#104](https://github.com/guneet-xyz/shinan/issues/104)) ([0db0cf6](https://github.com/guneet-xyz/shinan/commit/0db0cf6ffac3ac8d1d7c69f85d7763174a23765c))
* **server:** cap /mcp requests in flight; M2 security checklist rerun and deployment preparation ([#136](https://github.com/guneet-xyz/shinan/issues/136)) ([a2d731d](https://github.com/guneet-xyz/shinan/commit/a2d731d8955ddf177cf463769fc2a7f4e8272bb5))
* **server:** give the repair route the proposal routes' request caps; complete the M2 security checklist and record the owner's answers ([#155](https://github.com/guneet-xyz/shinan/issues/155)) ([f1c086b](https://github.com/guneet-xyz/shinan/commit/f1c086bc812414cdf08528446c5d07ea36cda4c9))
* **web:** offer GitHub in the sign-in-again dialog only where it is configured ([#127](https://github.com/guneet-xyz/shinan/issues/127)) ([1ae22ec](https://github.com/guneet-xyz/shinan/commit/1ae22ec42c9fc18991d9fd289cabcca18a92bf54))


### Performance Improvements

* **core:** give the event loop back between values while a purge matches ([#150](https://github.com/guneet-xyz/shinan/issues/150)) ([7d123b9](https://github.com/guneet-xyz/shinan/commit/7d123b954ff232a92b9da98c0f744b87666d4e4b))
* **core:** give the event loop back during index rebuilds and checks ([#140](https://github.com/guneet-xyz/shinan/issues/140)) ([f1ec39c](https://github.com/guneet-xyz/shinan/commit/f1ec39cba3bd354aa4e6781c37ef11047d3b921c))
* **core:** keep each workspace's validation in its catalog worker, and raise the catalog limits ([#125](https://github.com/guneet-xyz/shinan/issues/125)) ([acecaf1](https://github.com/guneet-xyz/shinan/commit/acecaf19e959d04b8dfbe6b57efbfffd5db17990))
* **core:** validate a change from the base revision's validation, re-checking only what it can affect ([#120](https://github.com/guneet-xyz/shinan/issues/120)) ([a51bc59](https://github.com/guneet-xyz/shinan/commit/a51bc59ee7f366fcf32549fb407b4be87430d9b6))

## [0.2.1](https://github.com/guneet-xyz/shinan/compare/v0.2.0...v0.2.1) (2026-11-17)


### Bug Fixes

* **deps:** run on Node.js 26 LTS ([#72](https://github.com/guneet-xyz/shinan/issues/72)) ([d71ee62](https://github.com/guneet-xyz/shinan/commit/d71ee62553424f3e58dd25b45b6893dea577178c))

## [0.2.0](https://github.com/guneet-xyz/shinan/compare/v0.1.0...v0.2.0) (2026-11-17)


### Features

* **web:** adopt Tailwind CSS and shadcn/ui ([#76](https://github.com/guneet-xyz/shinan/issues/76)) ([a2496eb](https://github.com/guneet-xyz/shinan/commit/a2496eb633112a182c95fa07ef685088a5b5bb4b))

## 0.1.0 (2026-11-17)


### Features

* core and database foundations ([c9359dc](https://github.com/guneet-xyz/shinan/commit/c9359dc45807f9d27fd610438b48a4046253ae0f))
* **core:** add the permission check path, events and membership operations ([b9672af](https://github.com/guneet-xyz/shinan/commit/b9672afcd75c212f205292c40a7309e23ed1fcb8))
* **db:** add the foundation schema with append-only events and security log ([92579a7](https://github.com/guneet-xyz/shinan/commit/92579a781728e23c0bb7d6e75c43b0c000dec71e))
* email sending through SES with throttling, retries and records ([#63](https://github.com/guneet-xyz/shinan/issues/63)) ([315a11c](https://github.com/guneet-xyz/shinan/commit/315a11c5045efc3a34c78315bb7d968b1c75b301))
* production image, release publishing, reference Compose file and operator guide ([#70](https://github.com/guneet-xyz/shinan/issues/70)) ([a29f9e4](https://github.com/guneet-xyz/shinan/commit/a29f9e4809597eecea149952f60d877c48269085))
* security baseline: CSRF checks, security headers, shared rate limits and the security checklist ([#68](https://github.com/guneet-xyz/shinan/issues/68)) ([09f9901](https://github.com/guneet-xyz/shinan/commit/09f99019ae64258ea37cd7dc7754407ac71228e0))
* **server:** run pg-boss in the worker and prepare the database in migrate ([676055f](https://github.com/guneet-xyz/shinan/commit/676055f1c426511e6c51af1c461b540a8c2e5ec1))
* sign-in by email magic link and GitHub, the allowlist, first start and invitations ([#65](https://github.com/guneet-xyz/shinan/issues/65)) ([d0a9680](https://github.com/guneet-xyz/shinan/commit/d0a968029fbcf3246e04186e7d3c26aa65075164))
* web app shell, sign-in pages, account and workspace settings ([#62](https://github.com/guneet-xyz/shinan/issues/62)) ([cc1a6dc](https://github.com/guneet-xyz/shinan/commit/cc1a6dc7e0ff3c6048d6a47a44c9753179f690ac))


### Bug Fixes

* **core:** freeze the permission rules table ([bb8ba23](https://github.com/guneet-xyz/shinan/commit/bb8ba23bfab4efb115ae85f177f1be434cd6a2e8))
* **core:** protect network details in the security log and map duplicate accounts ([59e12bc](https://github.com/guneet-xyz/shinan/commit/59e12bc9f2e039efe1423b06d028c3e847d92c72))
* **core:** record agents refused outside their workspace and keep the check path internal ([06fb2d6](https://github.com/guneet-xyz/shinan/commit/06fb2d694422dc40c2846ad7570dbe7bd99a5950))
* **core:** remove IPv6 zone IDs from network addresses ([6b76760](https://github.com/guneet-xyz/shinan/commit/6b767602f2a19c068b871a138d8ad501823fd05e))
* return 404s for unknown API paths and missing files ([539abc7](https://github.com/guneet-xyz/shinan/commit/539abc765e70768d5f4ced09a8a1ff3bb76cc4e6)), closes [#53](https://github.com/guneet-xyz/shinan/issues/53)
* **server:** let overlapping migrate runs take turns ([f0a8635](https://github.com/guneet-xyz/shinan/commit/f0a86357988ff243ea2ded490d7414fcf95db64e))
