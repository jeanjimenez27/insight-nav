// Merge / join logic for multi-file uploads.
// Three outcomes:
//  - stacked: same columns → vertical concat (sorted by date if a date col exists)
//  - joined: shared ID columns → greedy left-joins from largest base table
//  - unmergeable: no relationship found → caller asks user to pick subset

export type Row = Record<string, unknown>;

export type ParsedFile = {
  name: string;
  rows: Row[];
  columns: string[];
};

export type JoinStep = {
  left: string;          // accumulator label at this step
  right: string;         // file being joined in
  on: string;            // column name used
  addedRows: number;     // delta in row count after the join
  addedColumns: string[];
  note?: string;         // e.g. "right side had duplicate keys; took first match"
};

export type MergeResult =
  | { kind: "single"; rows: Row[]; columns: string[]; displayName: string }
  | {
      kind: "stacked";
      rows: Row[];
      columns: string[];
      displayName: string;
      sources: string[];
      sortedBy?: string;
    }
  | {
      kind: "joined";
      rows: Row[];
      columns: string[];
      displayName: string;
      joinPlan: JoinStep[];
      orphans: string[];
      sources: string[];
    }
  | {
      kind: "unmergeable";
      files: { name: string; columns: string[] }[];
    };

// ------------------------------- helpers -------------------------------

function columnsKey(rows: Row[]): string {
  if (!rows.length) return "";
  return Object.keys(rows[0]).slice().sort().join("|");
}

export function detectDateColumn(columns: string[], sampleRow: Row | undefined): string | null {
  if (!sampleRow) return null;
  const named = columns.find((c) => /date|time|timestamp|created|day/i.test(c));
  if (named) return named;
  for (const c of columns) {
    const v = sampleRow[c];
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return c;
    if (v instanceof Date) return c;
  }
  return null;
}

export function sortByDate(rows: Row[], col: string): Row[] {
  const indexed = rows.map((row, i) => {
    const raw = row[col];
    let t: number;
    if (raw instanceof Date) t = raw.getTime();
    else if (typeof raw === "string" || typeof raw === "number") t = Date.parse(String(raw));
    else t = NaN;
    return { row, i, t: Number.isNaN(t) ? Number.POSITIVE_INFINITY : t };
  });
  indexed.sort((a, b) => a.t - b.t || a.i - b.i);
  return indexed.map((x) => x.row);
}

// Detect plausible ID columns in a single file:
// - name pattern: ends in _id, is "id", or ends in _key / _code
// - cardinality: ≥80% unique non-null values
function detectIdColumns(file: ParsedFile): string[] {
  const ID_RE = /(^id$|_id$|_key$|_code$)/i;
  const nameMatches = file.columns.filter((c) => ID_RE.test(c));
  const out: string[] = [];
  for (const col of nameMatches) {
    const nonNull: unknown[] = [];
    for (const r of file.rows) {
      const v = r[col];
      if (v !== null && v !== undefined && v !== "") nonNull.push(v);
    }
    if (nonNull.length === 0) continue;
    const unique = new Set(nonNull.map((v) => String(v))).size;
    if (unique / nonNull.length >= 0.8) out.push(col);
  }
  return out;
}

function fileStem(name: string): string {
  return name.replace(/\.(csv|xlsx|xls)$/i, "").replace(/[^A-Za-z0-9]+/g, "_");
}

// Build lookup map (id value -> first matching row). Track if duplicates existed.
function buildLookup(rows: Row[], col: string): { map: Map<string, Row>; hadDuplicates: boolean } {
  const map = new Map<string, Row>();
  let dup = false;
  for (const r of rows) {
    const v = r[col];
    if (v === null || v === undefined || v === "") continue;
    const k = String(v);
    if (map.has(k)) {
      dup = true;
    } else {
      map.set(k, r);
    }
  }
  return { map, hadDuplicates: dup };
}

// Left-join `left` rows with `right` rows on `col`. Right's columns that collide
// with left's (other than the join col) get prefixed with `rightStem_`.
function leftJoin(
  left: Row[],
  leftColumns: string[],
  right: ParsedFile,
  on: string,
): { rows: Row[]; columns: string[]; addedColumns: string[]; hadDuplicates: boolean } {
  const { map, hadDuplicates } = buildLookup(right.rows, on);
  const stem = fileStem(right.name);
  const leftSet = new Set(leftColumns);

  // Plan right column names (skip the join col itself)
  const rename = new Map<string, string>();
  const addedColumns: string[] = [];
  for (const c of right.columns) {
    if (c === on) continue;
    const target = leftSet.has(c) ? `${stem}_${c}` : c;
    rename.set(c, target);
    addedColumns.push(target);
  }

  const merged: Row[] = left.map((lrow) => {
    const key = lrow[on];
    const rrow = key !== null && key !== undefined && key !== "" ? map.get(String(key)) : undefined;
    const out: Row = { ...lrow };
    for (const [src, dst] of rename) {
      out[dst] = rrow ? rrow[src] ?? null : null;
    }
    return out;
  });

  const columns = [...leftColumns, ...addedColumns];
  return { rows: merged, columns, addedColumns, hadDuplicates };
}

// ------------------------------- main API -------------------------------

export function mergeParsedFiles(files: ParsedFile[]): MergeResult {
  const nonEmpty = files.filter((f) => f.rows.length > 0);

  if (nonEmpty.length === 0) {
    return { kind: "unmergeable", files: files.map((f) => ({ name: f.name, columns: f.columns })) };
  }

  if (nonEmpty.length === 1) {
    const f = nonEmpty[0];
    return { kind: "single", rows: f.rows, columns: f.columns, displayName: f.name };
  }

  // 1) Identical column structure → stack
  const keys = nonEmpty.map((f) => columnsKey(f.rows));
  if (keys.every((k) => k === keys[0] && k.length > 0)) {
    const sharedColumns = nonEmpty[0].columns;
    let merged = nonEmpty.flatMap((f) => f.rows);
    const dateCol = detectDateColumn(sharedColumns, merged[0]);
    if (dateCol) merged = sortByDate(merged, dateCol);
    const firstName = nonEmpty[0].name;
    const extra = nonEmpty.length - 1;
    const displayName = `Combined: ${firstName}${extra > 0 ? ` + ${extra} more` : ""} (${merged.length} rows)`;
    return {
      kind: "stacked",
      rows: merged,
      columns: sharedColumns,
      displayName,
      sources: nonEmpty.map((f) => f.name),
      sortedBy: dateCol ?? undefined,
    };
  }

  // 2) Try a relational JOIN
  const idColsByFile = new Map<string, string[]>();
  for (const f of nonEmpty) idColsByFile.set(f.name, detectIdColumns(f));

  // Pick base = file with most rows
  const sortedBySize = [...nonEmpty].sort((a, b) => b.rows.length - a.rows.length);
  const base = sortedBySize[0];

  let accRows: Row[] = base.rows.map((r) => ({ ...r }));
  let accColumns: string[] = [...base.columns];
  const accIds = new Set(idColsByFile.get(base.name) ?? []);
  const accLabel = { current: base.name };
  const remaining = sortedBySize.slice(1);
  const used = new Set<string>([base.name]);
  const joinPlan: JoinStep[] = [];

  // Greedy: keep finding a remaining file that shares an ID column with the accumulator.
  // We re-scan because a join could expose new columns enabling further joins.
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const cand of remaining) {
      if (used.has(cand.name)) continue;
      const candIds = idColsByFile.get(cand.name) ?? [];
      // shared = ID columns present in both accumulator's column list and candidate
      const shared = candIds.filter((c) => accColumns.includes(c) && accIds.has(c));
      // Also accept any candidate ID column that simply exists by name in the accumulator
      const fallback = candIds.filter((c) => accColumns.includes(c));
      const onCol = shared[0] ?? fallback[0];
      if (!onCol) continue;

      const before = accRows.length;
      const { rows, columns, addedColumns, hadDuplicates } = leftJoin(
        accRows,
        accColumns,
        cand,
        onCol,
      );
      accRows = rows;
      accColumns = columns;
      // Newly added ID-shaped columns may enable future joins
      const ID_RE = /(^id$|_id$|_key$|_code$)/i;
      for (const c of addedColumns) if (ID_RE.test(c)) accIds.add(c);
      used.add(cand.name);
      joinPlan.push({
        left: accLabel.current,
        right: cand.name,
        on: onCol,
        addedRows: accRows.length - before,
        addedColumns,
        note: hadDuplicates
          ? `${cand.name} had duplicate keys on ${onCol}; first match was used.`
          : undefined,
      });
      accLabel.current = `${accLabel.current} ⨝ ${cand.name}`;
      progressed = true;
    }
  }

  if (joinPlan.length === 0) {
    // Nothing could be joined — leave it to the caller to ask the user
    return {
      kind: "unmergeable",
      files: nonEmpty.map((f) => ({ name: f.name, columns: f.columns })),
    };
  }

  const orphans = remaining.filter((f) => !used.has(f.name)).map((f) => f.name);
  const sources = [...used];
  const firstStep = joinPlan[0];
  const extraJoins = joinPlan.length - 1;
  const displayName = `Joined: ${firstStep.left} ⨝ ${firstStep.right} on ${firstStep.on}${
    extraJoins > 0 ? ` + ${extraJoins} more` : ""
  } (${accRows.length} rows)`;

  return {
    kind: "joined",
    rows: accRows,
    columns: accColumns,
    displayName,
    joinPlan,
    orphans,
    sources,
  };
}

// Build a one-line note describing the merge for the analyst (and the data_quality block).
export function describeMerge(result: MergeResult): string | null {
  if (result.kind === "stacked") {
    const sortNote = result.sortedBy ? `, sorted by ${result.sortedBy}` : "";
    return `Stacked ${result.sources.length} files with identical columns (${result.sources.join(", ")})${sortNote}.`;
  }
  if (result.kind === "joined") {
    const steps = result.joinPlan
      .map((s) => `${s.right} on ${s.on}${s.note ? ` (${s.note})` : ""}`)
      .join("; then ");
    const orphanNote = result.orphans.length
      ? ` Excluded (no shared ID): ${result.orphans.join(", ")}.`
      : "";
    return `Relational join starting from largest table: ${steps}.${orphanNote}`;
  }
  return null;
}
