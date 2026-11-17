# Changelog

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
