import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import config from './hybrid.config.mjs';

let failed = false;
for (const model of new Set(config.providers.map(provider => provider.config.model))) {
  const filename = `results-hybrid-${model.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  const result = spawnSync('npm', ['run', 'promptfoo', '--', 'eval', '--config', 'hybrid.config.mjs',
    '--no-cache', '--max-concurrency', '1', '--repeat', '3', '--output', filename], {
    cwd: fileURLToPath(new URL('.', import.meta.url)), env: { ...process.env, EVAL_MODELS: model }, stdio: 'inherit',
  });
  if (result.error || result.signal || ![0, 100].includes(result.status)) {
    console.error(result.error ?? `Evaluation stopped: ${result.signal ?? result.status}`);
    process.exit(result.status || 1);
  }
  failed ||= result.status === 100;
}
process.exitCode = failed ? 100 : 0;
