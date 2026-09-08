import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ParsedRow = Record<string, unknown>;

export async function parseFile(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCsv(file);
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseXlsx(file);
  throw new Error("Unsupported file type. Upload CSV or XLSX.");
}

function parseCsv(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<ParsedRow>(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data.filter(Boolean)),
      error: (err) => reject(err),
    });
  });
}

async function parseXlsx(file: File): Promise<ParsedRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first];
  return XLSX.utils.sheet_to_json<ParsedRow>(sheet, { defval: null });
}
