import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import config from './local-security.config.mjs';
import { localOllamaUrl, restrictNetworkToLoopback, deniedConnections } from './local-security.mjs';
import { renderSecurityReport } from './security-report.mjs';

process.chdir(fileURLToPath(new URL('.', import.meta.url)));
Object.assign(process.env, {
  PROMPTFOO_CONFIG_DIR: '.promptfoo', PROMPTFOO_DISABLE_TELEMETRY: '1', PROMPTFOO_DISABLE_UPDATE: '1',
  PROMPTFOO_DISABLE_REMOTE_GENERATION: '1', PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION: '1',
});
restrictNetworkToLoopback();
await mkdir('.promptfoo', { recursive: true });
const expected = config.tests.length * config.providers.length;
const models = config.providers.map(provider => provider.label);
const progressFile = '.promptfoo/results-local-security.partial.jsonl';
const reportFile = 'results-local-security.html';
let reportWrites = Promise.resolve();
try {
  const response = await fetch(`${localOllamaUrl()}/api/tags`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Ollama model inventory: HTTP ${response.status}`);
  const installed = (await response.json()).models;
  const requiredModels = new Set(config.providers.flatMap(provider => [provider.config.model, provider.config.attackerModel, provider.config.judgeModel]));
  const modelInventory = [...requiredModels].map(name => {
    const model = installed.find(item => item.name === name);
    if (!model || model.remote_host || model.remote_model || !model.size || model.details?.format !== 'gguf') {
      throw new Error(`An already installed local GGUF model is required: ${name}. No cloud models or automatic downloads are allowed.`);
    }
    return { name, digest: model.digest, size: model.size };
  });
  console.log(`Offline sweep: ${expected} conversations; ${models.join(', ')}; attacker/judge ${config.providers[0].config.attackerModel}/${config.providers[0].config.judgeModel}.`);
  await writeFile(progressFile, '');
  await writeFile(reportFile, renderSecurityReport({ models, expected }));
  await writeFile('.promptfoo/results-local-security.matrix.json', JSON.stringify(config, null, 2));
  const { evaluate } = await import('promptfoo');
  const record = await evaluate({ ...config, writeLatestResults: true,
    tags: { suite: 'local-security', cloud: 'disabled' } }, {
    cache: false, maxConcurrency: 1,
    progressCallback: (completed, total) => {
      if (completed % 10 || completed === total) return;
      console.log(`Local conversations complete: ${completed}/${total}`);
      reportWrites = reportWrites.then(async () => {
        const results = (await readFile(progressFile, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
        await writeFile(reportFile, renderSecurityReport({ results, models, expected, networkDenied: deniedConnections }));
      });
    },
  });
  const summary = await record.toEvaluateSummary();
  await reportWrites;
  const results = { ...summary, localRun: { expected, modelInventory, networkDenied: deniedConnections,
    attacker: config.providers[0].config.attackerModel, judge: config.providers[0].config.judgeModel } };
  await writeFile('results-local-security.json', JSON.stringify(results, null, 2));
  await writeFile(reportFile, renderSecurityReport({ results: summary.results, models, expected,
    finished: summary.results.length === expected, networkDenied: deniedConnections, runId: record.id }));
  console.log(`Local evaluation ${record.id}: ${summary.stats.successes} resisted, ${summary.stats.failures} violations, ${summary.stats.errors} errors. Report: ${reportFile}. Blocked external connections: ${deniedConnections.length}.`);
  process.exitCode = summary.stats.errors || summary.results.length !== expected || deniedConnections.length ? 1 : summary.stats.failures ? 100 : 0;
} catch (error) {
  await reportWrites.catch(() => {});
  await appendFile('.promptfoo/results-local-security-run.log', `${new Date().toISOString()} ${error.message}\n`);
  console.error(`Local evaluation did not complete: ${error.message}`);
  process.exitCode = 1;
}
