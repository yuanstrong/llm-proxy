# CI macOS Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tag-controlled `release` job that packages the macOS installer and uploads it to the matching GitHub Release before the existing artifact upload job.

**Architecture:** Extend the push trigger to receive tag pushes, while keeping existing branch and pull-request CI behavior. The `release` job runs on `macos-latest`, depends on `build`, verifies that the tag commit is reachable from `main`, downloads the compiled `dist` artifact, runs `installer/macos/prepare-release.sh`, archives the generated release directory, and creates or updates the GitHub Release for the tag. The existing `upload-artifact` job waits for `release` when it runs and continues when `release` is skipped.

**Tech Stack:** GitHub Actions YAML, macOS GitHub-hosted runner, Node.js, npm, zsh, GitHub CLI, `GITHUB_TOKEN`.

---

### Task 1: Add a tag-aware macOS release job

**Files:**
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: Define the workflow trigger and job dependency contract**

Add tag pushes to the existing `push` trigger and add a `release` job after `build` with `needs: build`. Restrict the job to tag refs and grant only that job `contents: write` permission. Keep pull requests and ordinary `main` pushes on the existing lint, test, build, and artifact path.

- [x] **Step 2: Add the macOS packaging steps**

The job must check out the repository with full history, set up Node.js 22, download `ci-build-output` into `dist`, read the version from `package.json`, run `installer/macos/prepare-release.sh` with a temporary output directory, and create `llm-proxy-macos-<version>-<tag>.tar.gz`. The archive must contain `dist`, `package.json`, generated `package-lock.json`, and the installer scripts.

- [x] **Step 3: Enforce that the tag points to the main branch history**

Fetch `origin/main` and fail the release job unless `git merge-base --is-ancestor "$GITHUB_SHA" origin/main` succeeds. This prevents a tag pushed from a non-main commit from publishing a release.

- [x] **Step 4: Create or update the GitHub Release**

Use the job token through `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. If the tag has no GitHub Release, create one with generated notes; otherwise upload the new archive to the existing release with `--clobber` so rerunning the job is safe.

- [x] **Step 5: Make artifact upload wait for release without breaking non-tag CI**

Make `upload-artifact` depend on both `build` and `release`, and use an `always()` condition that allows the job when `build` succeeded and `release` either succeeded or was skipped. A failed release must prevent the final artifact-upload job from masking the release failure.

### Task 2: Document tag-based packaging and verify the workflow

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-10-03-ci-macos-release.md`

- [x] **Step 1: Document the release command**

Explain that only a tag whose commit is on `main` publishes a release, and show `git checkout main`, `git pull`, `git tag v1.0.1`, and `git push origin v1.0.1`. Document the resulting asset name and that the archive contains a generated npm lockfile; the target Mac needs Node.js with npm, not pnpm.

- [x] **Step 2: Validate YAML structure and shell syntax**

Run `zsh -n installer/macos/*.sh` and `git diff --check`. Parse the workflow with an available YAML parser or inspect it with Ruby/Python if no parser is installed. Confirm the `release` job has the intended `if`, `needs`, and permissions, and that `upload-artifact` accepts a skipped release.

- [x] **Step 3: Run the project verification suite**

Run `pnpm lint`, `pnpm test`, and `pnpm run build`. Expected: all commands pass. No real GitHub Release is created during local verification.

- [x] **Step 4: Mark this plan complete**

Mark all checkboxes complete after verification and report the commit/tag workflow and exact generated asset behavior.
