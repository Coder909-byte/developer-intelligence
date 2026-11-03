import type { NetlistExtraction, ExtractedPin } from './types.js';
import { normalizePin } from './pin-normalizer.js';

interface SExprToken {
  type: 'open' | 'close' | 'atom';
  value: string;
  line: number;
}

function tokenizeSExpr(input: string): SExprToken[] {
  const tokens: SExprToken[] = [];
  let line = 1;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (!ch) break;

    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === ';') {
      // Comment to end of line
      while (i < input.length && input[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'open', value: '(', line });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'close', value: ')', line });
      i++;
      continue;
    }
    if (ch === '"') {
      // Quoted string
      i++;
      let str = '';
      const startLine = line;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          str += input[i + 1];
          i += 2;
        } else {
          if (input[i] === '\n') line++;
          str += input[i];
          i++;
        }
      }
      i++; // skip closing quote
      tokens.push({ type: 'atom', value: str, line: startLine });
      continue;
    }

    // Unquoted symbol / atom
    let atom = '';
    const startLine = line;
    while (i < input.length && !/[\s()]/.test(input[i]!)) {
      atom += input[i];
      i++;
    }
    tokens.push({ type: 'atom', value: atom, line: startLine });
  }

  return tokens;
}

type SExpr = string | SExprList;
interface SExprList {
  line: number;
  items: SExpr[];
}

function parseSExprTokens(tokens: SExprToken[]): SExprList {
  let idx = 0;

  function parseList(): SExprList {
    const openToken = tokens[idx];
    idx++; // skip open
    const items: SExpr[] = [];
    const line = openToken ? openToken.line : 1;

    while (idx < tokens.length) {
      const tok = tokens[idx];
      if (!tok) break;
      if (tok.type === 'close') {
        idx++;
        break;
      }
      if (tok.type === 'open') {
        items.push(parseList());
      } else {
        items.push(tok.value);
        idx++;
      }
    }
    return { line, items };
  }

  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (tok && tok.type === 'open') {
      return parseList();
    }
    idx++;
  }
  return { line: 1, items: [] };
}

function findSubList(list: SExprList, tag: string): SExprList | undefined {
  for (const item of list.items) {
    if (typeof item !== 'string' && item.items.length > 0 && item.items[0] === tag) {
      return item;
    }
  }
  return undefined;
}

function findAllSubLists(list: SExprList, tag: string): SExprList[] {
  const result: SExprList[] = [];
  for (const item of list.items) {
    if (typeof item !== 'string' && item.items.length > 0 && item.items[0] === tag) {
      result.push(item);
    }
  }
  return result;
}

function getSubString(list: SExprList, tag: string): string | undefined {
  const sub = findSubList(list, tag);
  if (sub && sub.items.length > 1 && typeof sub.items[1] === 'string') {
    return sub.items[1];
  }
  return undefined;
}

/**
 * Parses KiCad S-expression netlist or normalized JSON netlist.
 */
export function parseKiCadNetlist(content: string, filePath: string): NetlistExtraction {
  const trimmed = content.trim();

  // Handle JSON netlist
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        components?: Array<{ ref: string; value: string; footprint?: string }>;
        signals?: Array<{
          name: string;
          net?: string;
          gpio: string;
          component?: string;
          pin?: string;
          sourceFile?: string;
        }>;
      };

      const signals = new Map<string, ExtractedPin>();
      if (Array.isArray(parsed.signals)) {
        for (const sig of parsed.signals) {
          signals.set(sig.name, {
            signalName: sig.name,
            pin: normalizePin(sig.gpio),
            rawPin: sig.gpio,
            componentRef: sig.component,
            mcuPin: sig.pin,
            evidence: {
              filePath,
              line: 1,
              excerpt: JSON.stringify(sig),
            },
          });
        }
      }

      return {
        sourceFile: filePath,
        components: parsed.components ?? [],
        nets: [],
        signals,
      };
    } catch {
      // Fall through to S-expression parser
    }
  }

  // Parse S-expression
  const tokens = tokenizeSExpr(content);
  const root = parseSExprTokens(tokens);

  const components: NetlistExtraction['components'] = [];
  const nets: NetlistExtraction['nets'] = [];
  const signals = new Map<string, ExtractedPin>();

  const componentsList = findSubList(root, 'components');
  if (componentsList) {
    for (const comp of findAllSubLists(componentsList, 'comp')) {
      const ref = getSubString(comp, 'ref') ?? '';
      const value = getSubString(comp, 'value') ?? '';
      const footprint = getSubString(comp, 'footprint');
      components.push({ ref, value, footprint });
    }
  }

  const netsList = findSubList(root, 'nets');
  if (netsList) {
    for (const net of findAllSubLists(netsList, 'net')) {
      const code = getSubString(net, 'code');
      const name = getSubString(net, 'name') ?? '';
      const netLine = net.line;

      const nodes: NetlistExtraction['nets'][number]['nodes'] = [];
      for (const node of findAllSubLists(net, 'node')) {
        const nodeRef = getSubString(node, 'ref') ?? '';
        const nodePin = getSubString(node, 'pin') ?? '';
        const nodePinFunction = getSubString(node, 'pinfunction');
        nodes.push({ ref: nodeRef, pin: nodePin, pinfunction: nodePinFunction });
      }

      nets.push({ code, name, nodes });

      // Signal extraction heuristic:
      // Check net name for signal identifier (e.g. "Net-(U1-MOTOR_EN)", "MOTOR_EN", "IO14")
      const sigNameMatch = name.match(/(?:Net-\([A-Za-z0-9_]+-)?([A-Za-z0-9_]+)\)?$/);
      let candidateSignalName = sigNameMatch && sigNameMatch[1] ? sigNameMatch[1] : name;
      if (candidateSignalName.startsWith('Net-')) {
        candidateSignalName = candidateSignalName.replace(/^Net-/, '');
      }

      // Find MCU node or node with IO pinfunction
      for (const node of nodes) {
        const pinfunc = node.pinfunction ?? '';
        // If pinfunction is like "IO14" or "GPIO14"
        const isGpio = /^(?:GPIO|IO)[0-9]+$/i.test(pinfunc);
        if (isGpio) {
          signals.set(candidateSignalName, {
            signalName: candidateSignalName,
            pin: normalizePin(pinfunc),
            rawPin: pinfunc,
            componentRef: node.ref,
            mcuPin: node.pin,
            evidence: {
              filePath,
              line: netLine,
              excerpt: `(net (name "${name}") ... (node (ref "${node.ref}") (pin "${node.pin}") (pinfunction "${pinfunc}")))`,
            },
          });
        }
      }
    }
  }

  return {
    sourceFile: filePath,
    components,
    nets,
    signals,
  };
}
