// Minimal RFC4180-style CSV/TSV parser with a configurable delimiter.
// Written by hand instead of adding a dependency because the only real
// complexity is quoted fields that span multiple lines (Tienda Nube's
// export embeds HTML descriptions with literal newlines) and doubled
// quotes as the escape for a literal quote — both handled by a small
// state machine, not a naive split on "\n" / delimiter.

/**
 * Parses delimited text into rows of string fields. Handles quoted fields
 * (double-quote delimited, "" as an escaped literal quote) that may
 * contain the delimiter or a raw newline. Trailing empty line is ignored.
 */
export function parseDelimitedText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normalize CRLF up front so the state machine only ever sees "\n".
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // Flush the last field/row if the file didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop a fully-empty trailing row (common after a final newline).
  while (rows.length > 0 && rows[rows.length - 1].every((f) => f === "")) {
    rows.pop();
  }

  return rows;
}

/** Parses delimited text into an array of objects keyed by the header row. */
export function parseDelimitedRecords(
  text: string,
  delimiter: string
): Record<string, string>[] {
  const rows = parseDelimitedText(text, delimiter);
  if (rows.length === 0) return [];
  const [header, ...dataRows] = rows;
  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, idx) => {
      record[key] = row[idx] ?? "";
    });
    return record;
  });
}
