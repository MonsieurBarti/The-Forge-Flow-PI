// Strip GIT_* environment variables so integration tests that spawn git
// subprocesses never leak into the host repository. Without this, a
// GIT_DIR or GIT_WORK_TREE inherited from the test runner (e.g. when
// running inside a git worktree) could cause `git -C <tmpdir>` to
// silently operate on the wrong repo.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) {
    delete process.env[key];
  }
}
