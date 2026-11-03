import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  deterministicScrub,
  evaluateRuleClassifier,
} from '../apps/core-daemon/dist/classifier/laya-classifier.js';

const dbPath = join(homedir(), '.hermes', 'state.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

console.log('================================================================');
console.log(' BENCHMARKING LAYA CLASSIFIER ON REAL HERMES SESSION DATA');
console.log(` Database: ${dbPath}`);
console.log('================================================================\n');

// 1. Fetch real diverse messages across roles
const userRows = db
  .prepare(
    `SELECT id, role, content FROM messages 
     WHERE role = 'user' AND length(content) > 15 
     ORDER BY id DESC LIMIT 25`,
  )
  .all();

const toolRows = db
  .prepare(
    `SELECT id, role, content FROM messages 
     WHERE role = 'tool' AND length(content) > 15 
     ORDER BY id DESC LIMIT 35`,
  )
  .all();

const assistantRows = db
  .prepare(
    `SELECT id, role, content FROM messages 
     WHERE role = 'assistant' AND length(content) > 20 
     ORDER BY id DESC LIMIT 20`,
  )
  .all();

const allSamples = [
  ...userRows.map((r) => ({ ...r, sourceType: 'user_message' })),
  ...toolRows.map((r) => ({ ...r, sourceType: 'tool_output' })),
  ...assistantRows.map((r) => ({ ...r, sourceType: 'assistant_thought' })),
];

console.log(`Fetched ${allSamples.length} real session turns from Hermes:\n`);

let totalRawChars = 0;
let totalPreservedChars = 0;
let countPreserved = 0;
let countDiscarded = 0;
const categoryBreakdown = {
  HARDWARE_SPEC: 0,
  ARCHITECTURAL_DECISION: 0,
  VALIDATED_OUTCOME: 0,
  EPHEMERAL_NOISE: 0,
};

const preservedExamples = [];
const discardedExamples = [];

for (const sample of allSamples) {
  const text = sample.content || '';
  totalRawChars += text.length;

  const { scrubbed, isObviousNoise } = deterministicScrub(text);
  let evalResult;
  if (isObviousNoise) {
    evalResult = {
      category: 'EPHEMERAL_NOISE',
      signalScore: 0.05,
      decision: 'discard',
    };
  } else {
    evalResult = evaluateRuleClassifier(scrubbed, sample.sourceType);
  }

  categoryBreakdown[evalResult.category]++;

  if (evalResult.decision === 'preserve') {
    countPreserved++;
    const factText = evalResult.distilledFact || scrubbed.slice(0, 100);
    totalPreservedChars += factText.length;
    preservedExamples.push({
      role: sample.role,
      category: evalResult.category,
      score: evalResult.signalScore,
      rawSnippet: text.slice(0, 100).replace(/\n/g, ' '),
      distilledFact: factText,
    });
  } else {
    countDiscarded++;
    discardedExamples.push({
      role: sample.role,
      category: evalResult.category,
      score: evalResult.signalScore,
      rawSnippet: text.slice(0, 100).replace(/\n/g, ' '),
      rawLength: text.length,
    });
  }
}

// Token economy estimate (~4 chars per token)
const rawTokens = Math.round(totalRawChars / 4);
const preservedTokens = Math.round(totalPreservedChars / 4);
const tokensSaved = rawTokens - preservedTokens;
const savingsRatio = ((tokensSaved / Math.max(1, rawTokens)) * 100).toFixed(1);

console.log('--- CLASSIFICATION & TOKEN ECONOMY REPORT ---');
console.log(`Total Evaluated Turns : ${allSamples.length}`);
console.log(`Preserved (High Signal): ${countPreserved} turns`);
console.log(`Discarded (Noise/Pruned): ${countDiscarded} turns`);
console.log(
  `Raw Footprint          : ${totalRawChars.toLocaleString()} chars (~${rawTokens.toLocaleString()} tokens)`,
);
console.log(
  `Distilled Ground Truth : ${totalPreservedChars.toLocaleString()} chars (~${preservedTokens.toLocaleString()} tokens)`,
);
console.log(`Token Savings Rate     : ${savingsRatio}% REDUCTION\n`);

console.log('--- CATEGORY BREAKDOWN ---');
for (const [cat, count] of Object.entries(categoryBreakdown)) {
  console.log(` • ${cat.padEnd(24)}: ${count} turns`);
}
console.log('\n');

console.log('--- SAMPLE OF PRESERVED HIGH-SIGNAL INVARIANTS ---');
for (const ex of preservedExamples.slice(0, 8)) {
  console.log(`[${ex.category}] (Score: ${ex.score}) [${ex.role}]`);
  console.log(`  Raw Input : "${ex.rawSnippet}..."`);
  console.log(`  Distilled : -> "${ex.distilledFact}"\n`);
}

console.log('--- SAMPLE OF PRUNED EPHEMERAL NOISE ---');
for (const ex of discardedExamples.slice(0, 6)) {
  console.log(`[${ex.category}] (Score: ${ex.score}) [${ex.role}] (${ex.rawLength} chars pruned)`);
  console.log(`  Dropped   : "${ex.rawSnippet}..."\n`);
}

db.close();
