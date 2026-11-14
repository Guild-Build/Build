// The environment for a test's child process that may run git, so the suite passes whatever git setup its caller has
// (tests/git-env.test.mjs runs the suite under a caller whose git setup is broken). It is the caller's environment
// without any GIT_ variable, so no setting reaches git through GIT_CONFIG_COUNT, GIT_CONFIG_KEY_<n> and
// GIT_CONFIG_VALUE_<n> or GIT_CONFIG_PARAMETERS, and no GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE points git at another
// repository; and without XDG_CONFIG_HOME, with HOME set to the given folder, so no global ignore or attributes file
// applies. The global and system config files are off, and git never prompts.
export function cleanGitEnv(home, base = process.env) {
  const env = Object.fromEntries(Object.entries(base).filter(([name]) => !name.startsWith('GIT_') && name !== 'XDG_CONFIG_HOME'));
  return { ...env, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}
