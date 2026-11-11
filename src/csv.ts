import { parseLocalDate } from './dates.ts';

export interface SprintRow {
  date: Date;
  name: string;
}

/**
 * RFC 4180 parser that never throws, so one bad hand edit can't blank the board.
 * Well-formed input parses exactly per RFC 4180. Malformed quoting is kept as
 * literal text: stray quotes in unquoted fields, text after a closing quote,
 * and opening quotes that are never properly closed.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  const literalQuotes = new Set<number>();
  let record: string[] = [];
  let field = '';
  let state: 'start' | 'plain' | 'quoted' = 'start';
  let quoteStart = 0;

  const endsField = (index: number) => index >= input.length
    || input[index] === ',' || input[index] === '\r' || input[index] === '\n';

  const finishField = () => {
    record.push(field);
    field = '';
    state = 'start';
  };

  for (let i = 0; i <= input.length; i++) {
    const char = input[i];
    if (state === 'quoted') {
      const closes = char === '"' && input[i + 1] !== '"';
      // A quote left open by mistake would otherwise pair with the next quote in
      // the file and swallow every row in between. Treat it as literal text and
      // reparse from there. Committed records never change while quoted.
      if (i === input.length || (closes && !endsField(i + 1) && /[\r\n]/.test(field))) {
        literalQuotes.add(quoteStart);
        field = '';
        state = 'start';
        i = quoteStart - 1;
      } else if (closes) {
        state = 'plain';
      } else if (char === '"') {
        field += '"';
        i++;
      } else {
        field += char;
      }
    } else if (i === input.length) {
      break;
    } else if (char === ',') {
      finishField();
    } else if (char === '\r' || char === '\n') {
      finishField();
      records.push(record);
      record = [];
      if (char === '\r' && input[i + 1] === '\n') i++;
    } else if (char === '"' && state === 'start' && !literalQuotes.has(i)) {
      state = 'quoted';
      quoteStart = i;
    } else {
      field += char;
      state = 'plain';
    }
  }

  if (field !== '' || record.length > 0 || state !== 'start') {
    finishField();
    records.push(record);
  }
  return records;
}

export function parseSprints(text: string): SprintRow[] {
  const byDate = new Map<string, SprintRow>();
  for (const fields of parseCsv(text)) {
    const dateText = fields[0] ?? '';
    const date = parseLocalDate(dateText);
    const name = fields[1]?.trim();
    if (date && name) byDate.set(dateText, { date, name });
  }
  return [...byDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}
