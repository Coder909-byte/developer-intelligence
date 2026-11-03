import { randomUUID } from 'node:crypto';
import type { ClassifierCategory, LayaClassificationResult } from '@udi/contracts';

export interface ClassifyInput {
  projectId: string;
  text: string;
  sourceType: 'user_message' | 'assistant_thought' | 'tool_output' | 'system_message';
  actor: string;
}

export interface ClassifierService {
  classify(input: ClassifyInput): Promise<LayaClassificationResult>;
}

// Stage 1: Fast deterministic scrub (<1ms)
export function deterministicScrub(raw: string): {
  scrubbed: string;
  isObviousNoise: boolean;
  truncated: boolean;
} {
  // Strip ANSI escape codes
  // eslint-disable-next-line no-control-regex
  let text = raw.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').trim();

  // Strip progress bar sequences e.g. [=========>   ] 45%
  text = text.replace(/\[[=>\s.-]{5,}\]\s*\d+%/g, '').trim();

  // Strip excessive repeated newlines and whitespace
  text = text.replace(/\n{3,}/g, '\n\n');

  // Check for obvious binary or base64 blobs (>80 characters without whitespace)
  const hasBase64 = /[A-Za-z0-9+/=]{80,}/.test(text);
  if (hasBase64) {
    text = text.replace(/[A-Za-z0-9+/=]{80,}/g, '[BINARY/BASE64_OMITTED]');
  }

  // Detect empty or near-empty noise
  if (!text || text.length === 0 || /^(ok|done|\{\s*\}|\[\s*\])$/i.test(text)) {
    return { scrubbed: text, isObviousNoise: true, truncated: false };
  }

  // Detect standard package manager / build scrollback noise patterns
  const isNpmLog =
    /^(npm warn|npm notice|pnpm install|added \d+ packages|up to date in \d+)/im.test(text);
  if (isNpmLog && !/(error|failed|fatal|exception)/i.test(text)) {
    return { scrubbed: text.slice(0, 300), isObviousNoise: true, truncated: true };
  }

  return { scrubbed: text, isObviousNoise: false, truncated: false };
}

// Stage 2: Semantic evaluation & classification
export function evaluateRuleClassifier(
  scrubbed: string,
  sourceType: ClassifyInput['sourceType'],
): {
  category: ClassifierCategory;
  signalScore: number;
  decision: 'preserve' | 'discard';
  distilledFact?: string;
} {
  // 1. Hardware Specification Checks (Highest Signal)
  const pinMatch = scrubbed.match(/(?:GPIO\d+|pin\s*["']?\d+["']?|MOTOR_[A-Z0-9_]+|I2C|SPI|UART)/i);
  const netlistMatch = scrubbed.match(/\.net|netlist|schematic|KiCad/i);
  if (
    pinMatch &&
    (netlistMatch ||
      /mismatch|pin_consistency|expected|observed|header|defines?|mapped|assigned|wiring|binding|pinout/i.test(
        scrubbed,
      ))
  ) {
    const specific = scrubbed.match(
      /(?:Signal\s+)?([A-Za-z0-9_]+)\s*(?:pin\s*mismatch:?\s*|->|=|specifies\s*)([A-Za-z0-9_]+)/i,
    );
    const fact = specific
      ? `${specific[1]} mapped to ${specific[2]}`
      : scrubbed.slice(0, 240).replace(/\n/g, ' ');

    return {
      category: 'HARDWARE_SPEC',
      signalScore: 0.98,
      decision: 'preserve',
      distilledFact: fact,
    };
  }

  // 2. User Directives & Goals (Essential Context for Zero-Discovery Continuation)
  if (sourceType === 'user_message') {
    const clean = scrubbed
      .replace(/^[-*•#\s]+/, '')
      .replace(/\n+/g, ' ')
      .slice(0, 280);
    return {
      category: 'ARCHITECTURAL_DECISION',
      signalScore: 0.92,
      decision: 'preserve',
      distilledFact: clean,
    };
  }

  // 3. Validated Outcomes, Test Results, Errors & Regressions
  const outcomeMatch = scrubbed.match(
    /(?:validation (?:passed|failed|completed)|finding\(s\)|revalidation|tests? passed|failed suites?|error:|failed|succeeded|exitCode:\s*[01]|regression|assertionerror)/i,
  );
  if (outcomeMatch) {
    let fact = '';
    const errorLine = scrubbed.match(/(?:error|failed|assertionerror)[^\n]{10,180}/i);
    const passLine = scrubbed.match(
      /(?:\d+ passed|\d+ test files? passed|all tests passed|validation succeeded)[^\n]*/i,
    );

    if (errorLine) {
      fact = `Observed Diagnostic: ${errorLine[0].trim()}`;
    } else if (passLine) {
      fact = `Verified State: ${passLine[0].trim()}`;
    } else {
      fact = scrubbed.slice(0, 200).replace(/\n/g, ' ');
    }

    return {
      category: 'VALIDATED_OUTCOME',
      signalScore: 0.9,
      decision: 'preserve',
      distilledFact: fact,
    };
  }

  // 4. Git, Environment & Branch Status (Stops Next Agent from Repeatedly Scouting)
  const envMatch = scrubbed.match(
    /(?:on branch [a-z0-9/_.-]+|merge pull request #\d+|switched to branch|working tree clean|changes not staged|fast-forward|commit [a-f0-9]{7,40})/i,
  );
  if (envMatch) {
    const summary = scrubbed.slice(0, 220).replace(/\n+/g, ' | ');
    return {
      category: 'ARCHITECTURAL_DECISION',
      signalScore: 0.86,
      decision: 'preserve',
      distilledFact: `Git/Environment state: ${summary}`,
    };
  }

  // 5. Assistant Reports & Action Summaries
  if (sourceType === 'assistant_thought') {
    const reportMatch = scrubbed.match(
      /(?:what changed|what's verified|status:|completed:|summary:|verified:)/i,
    );
    if (reportMatch) {
      return {
        category: 'ARCHITECTURAL_DECISION',
        signalScore: 0.85,
        decision: 'preserve',
        distilledFact: scrubbed.slice(0, 260).replace(/\n+/g, ' '),
      };
    }
  }

  // 6. Default: Ephemeral Noise
  return {
    category: 'EPHEMERAL_NOISE',
    signalScore: 0.15,
    decision: 'discard',
  };
}

export class LayaClassifierService implements ClassifierService {
  constructor(private readonly modelUrl?: string) {}

  async classify(input: ClassifyInput): Promise<LayaClassificationResult> {
    const now = new Date().toISOString();
    const { scrubbed, isObviousNoise } = deterministicScrub(input.text);

    // Fast-path obvious noise
    if (isObviousNoise) {
      return {
        id: randomUUID(),
        projectId: input.projectId,
        timestamp: now,
        rawLengthChars: input.text.length,
        signalScore: 0.05,
        category: 'EPHEMERAL_NOISE',
        decision: 'discard',
        sourceActor: input.actor,
        sourceType: input.sourceType,
      };
    }

    // Attempt Laya Model Endpoint if available
    if (this.modelUrl) {
      try {
        const response = await fetch(`${this.modelUrl}/classify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: scrubbed.slice(0, 2000),
            sourceType: input.sourceType,
            actor: input.actor,
          }),
          signal: AbortSignal.timeout(1200),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            category: ClassifierCategory;
            signalScore: number;
            distilledFact?: string;
          };

          return {
            id: randomUUID(),
            projectId: input.projectId,
            timestamp: now,
            rawLengthChars: input.text.length,
            signalScore: Math.min(Math.max(data.signalScore, 0), 1),
            category: data.category,
            decision: data.signalScore >= 0.7 ? 'preserve' : 'discard',
            distilledFact: data.distilledFact,
            sourceActor: input.actor,
            sourceType: input.sourceType,
          };
        }
      } catch {
        // Fall back gracefully to high-precision rule engine
      }
    }

    // High-precision offline rule classifier
    const evalResult = evaluateRuleClassifier(scrubbed, input.sourceType);

    return {
      id: randomUUID(),
      projectId: input.projectId,
      timestamp: now,
      rawLengthChars: input.text.length,
      signalScore: evalResult.signalScore,
      category: evalResult.category,
      decision: evalResult.decision,
      distilledFact: evalResult.distilledFact,
      sourceActor: input.actor,
      sourceType: input.sourceType,
    };
  }
}
