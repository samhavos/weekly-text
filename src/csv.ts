import { parseLocalDate } from './dates.ts';

export interface SprintRow {
  date: Date;
  name: string;
}

export class CsvError extends Error {
  constructor(line: number, detail: string) {
    super(`Invalid CSV near line ${line}: ${detail}`);
    this.name = 'CsvError';
  }
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let line = 1;

  const finishField = () => {
    record.push(field);
    field = '';
    state = 'start';
  };

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          state = 'closed';
        }
      } else {
        field += char;
        if (char === '\n') line++;
      }
    } else if (char === ',') {
      finishField();
    } else if (char === '\r' || char === '\n') {
      finishField();
      records.push(record);
      record = [];
      if (char === '\r' && input[i + 1] === '\n') i++;
      line++;
    } else if (char === '"' && state === 'start') {
      state = 'quoted';
    } else if (state === 'closed') {
      throw new CsvError(line, 'unexpected text after a closing quote.');
    } else if (char === '"') {
      throw new CsvError(line, 'a quote inside an unquoted field must be escaped.');
    } else {
      field += char;
      state = 'plain';
    }
  }

  if (state === 'quoted') throw new CsvError(line, 'a quoted field is not closed.');
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
