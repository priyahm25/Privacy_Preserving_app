/**
 * Excel (.xlsx/.xlsm) feature extractor.
 * Extracts the 48 features expected by the trained Excel LightGBM model.
 *
 * XLSX is a ZIP archive. We parse XML parts inside it.
 * All extraction happens on-device.
 *
 * IMPORTANT: Never transmit file content or features to any server.
 */

import { unzipSync } from 'fflate';
import { ScanFormatError } from '../officeValidation';

export interface ExcelFeatures {
  file_size: number;
  sheet_count: number;
  max_rows: number;
  max_cols: number;
  total_cells: number;
  non_empty_cells: number;
  numeric_cell_count: number;
  string_cell_count: number;
  formula_count: number;
  hyperlink_count: number;
  avg_cell_length: number;
  entropy_of_text: number;
  base64_pattern_count: number;
  hex_pattern_count: number;
  has_macro: number;
  remote_template_present: number;
  ocr_extracted_text_length: number;
  preview_image_text_entropy: number;
  deceptive_keywords_count_ocr: number;
  macro_line_count: number;
  macro_procedure_count: number;
  macro_chr_count: number;
  macro_string_function_count: number;
  macro_arithmetic_operator_count: number;
  macro_concatenation_count: number;
  macro_callbyname_count: number;
  macro_comment_lines: number;
  macro_average_line_length: number;
  macro_token_count: number;
  macro_count: number;
  uses_file_api: number;
  uses_network_api: number;
  uses_process_api: number;
  merged_cells_count: number;
  hidden_sheets_count: number;
  protected_sheets_count: number;
  named_ranges_count: number;
  empty_sheet_count: number;
  rich_text_formatting_count: number;
  macro_count_parentheses: number;
  macro_count_assignments: number;
  macro_max_line_length: number;
  macro_max_string_literals: number;
  macro_max_arithmetic_ops: number;
  macro_max_concat_ops: number;
  macro_vocab_size: number;
  preview_image_width: number;
  preview_image_height: number;
}

const DECEPTIVE_KEYWORDS = [
  'invoice', 'payment', 'urgent', 'verify', 'account',
  'password', 'confirm', 'click here', 'update',
];

function calculateEntropy(text: string): number {
  if (!text || text.length === 0) return 0;
  const freq: Record<string, number> = {};
  for (const ch of text) freq[ch] = (freq[ch] || 0) + 1;
  const len = text.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function countOccurrences(text: string, pattern: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(pattern, pos)) !== -1) {
    count++;
    pos += pattern.length;
  }
  return count;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

export function extractExcelFeatures(
  fileBytes: Uint8Array,
  fileSize: number
): ExcelFeatures {
  const features: ExcelFeatures = {
    file_size: fileSize,
    sheet_count: 0,
    max_rows: 0,
    max_cols: 0,
    total_cells: 0,
    non_empty_cells: 0,
    numeric_cell_count: 0,
    string_cell_count: 0,
    formula_count: 0,
    hyperlink_count: 0,
    avg_cell_length: 0,
    entropy_of_text: 0,
    base64_pattern_count: 0,
    hex_pattern_count: 0,
    has_macro: 0,
    remote_template_present: 0,
    ocr_extracted_text_length: 0,
    preview_image_text_entropy: 0,
    deceptive_keywords_count_ocr: 0,
    macro_line_count: 0,
    macro_procedure_count: 0,
    macro_chr_count: 0,
    macro_string_function_count: 0,
    macro_arithmetic_operator_count: 0,
    macro_concatenation_count: 0,
    macro_callbyname_count: 0,
    macro_comment_lines: 0,
    macro_average_line_length: 0,
    macro_token_count: 0,
    macro_count: 0,
    uses_file_api: 0,
    uses_network_api: 0,
    uses_process_api: 0,
    merged_cells_count: 0,
    hidden_sheets_count: 0,
    protected_sheets_count: 0,
    named_ranges_count: 0,
    empty_sheet_count: 0,
    rich_text_formatting_count: 0,
    macro_count_parentheses: 0,
    macro_count_assignments: 0,
    macro_max_line_length: 0,
    macro_max_string_literals: 0,
    macro_max_arithmetic_ops: 0,
    macro_max_concat_ops: 0,
    macro_vocab_size: 0,
    preview_image_width: 0,
    preview_image_height: 0,
  };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(fileBytes);
  } catch {
    throw new ScanFormatError("CORRUPTED", "The spreadsheet is not a readable XLSX package.");
  }

  const fileNames = Object.keys(files);
  if (
    !files['[Content_Types].xml'] ||
    !files['xl/workbook.xml'] ||
    !fileNames.some((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
  ) {
    throw new ScanFormatError("CORRUPTED", "The XLSX package is missing required workbook parts.");
  }

  // has_macro
  features.has_macro = fileNames.some(
    (f) => f.includes('vbaProject.bin') || f.includes('xl/macros')
  ) ? 1 : 0;

  // Workbook XML
  const wbXml = files['xl/workbook.xml'];
  if (wbXml) {
    const wbText = decodeUtf8(wbXml);
    // sheet_count
    const sheetMatches = wbText.match(/<sheet /g) || [];
    features.sheet_count = sheetMatches.length;

    // hidden sheets: state="hidden" or state="veryHidden"
    features.hidden_sheets_count = (wbText.match(/state=["']hidden["']/g) || []).length
      + (wbText.match(/state=["']veryHidden["']/g) || []).length;

    // named ranges
    features.named_ranges_count = countOccurrences(wbText, '<definedName');

    // remote template
    features.remote_template_present = (wbText.includes('http://') || wbText.includes('https://')) ? 1 : 0;
  }

  // Process each sheet
  let allCellLengths: number[] = [];
  let allText = '';
  let maxRows = 0;
  let maxCols = 0;
  let emptySheetsCount = 0;

  const sheetFiles = fileNames.filter((f) => f.match(/xl\/worksheets\/sheet\d+\.xml$/));
  for (const sheetFile of sheetFiles) {
    const sheetBytes = files[sheetFile];
    if (!sheetBytes) continue;
    const sheetText = decodeUtf8(sheetBytes);
    allText += sheetText;

    // Count cells (non-empty)
    const cells = sheetText.match(/<c [^/]*\/?>(?:[^<]*<v>[^<]*<\/v>)?/g) || [];
    const nonEmpty = cells.filter((c) => c.includes('<v>'));
    features.non_empty_cells += nonEmpty.length;

    if (nonEmpty.length === 0) emptySheetsCount++;

    // Numeric vs string cells: t="s" means string
    features.string_cell_count += (sheetText.match(/t=["']s["']/g) || []).length;
    features.numeric_cell_count += nonEmpty.length - (sheetText.match(/t=["']s["']/g) || []).length;

    // Formula count
    features.formula_count += countOccurrences(sheetText, '<f>');

    // Hyperlinks
    features.hyperlink_count += countOccurrences(sheetText, '<hyperlink');

    // Merged cells
    features.merged_cells_count += countOccurrences(sheetText, '<mergeCell');

    // Protected sheets
    if (sheetText.includes('<sheetProtection')) features.protected_sheets_count++;

    // Rich text
    features.rich_text_formatting_count += countOccurrences(sheetText, '<is>');

    // Estimate rows/cols from dimension attribute
    const dimMatch = sheetText.match(/ref=["']([A-Z]+)(\d+):([A-Z]+)(\d+)["']/);
    if (dimMatch) {
      const rows = parseInt(dimMatch[4], 10);
      const cols = dimMatch[3].split('').reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0);
      maxRows = Math.max(maxRows, rows);
      maxCols = Math.max(maxCols, cols);
      features.total_cells = Math.max(features.total_cells, rows * cols);
    }

    // Cell text lengths
    const vMatches = sheetText.match(/<v>([^<]*)<\/v>/g) || [];
    for (const vm of vMatches) {
      const inner = vm.replace('<v>', '').replace('</v>', '');
      allCellLengths.push(inner.length);
    }
  }

  features.max_rows = maxRows;
  features.max_cols = maxCols;
  features.empty_sheet_count = emptySheetsCount;
  features.avg_cell_length = allCellLengths.length > 0
    ? allCellLengths.reduce((a, b) => a + b, 0) / allCellLengths.length
    : 0;
  features.entropy_of_text = calculateEntropy(allText);

  // base64/hex patterns in all text
  features.base64_pattern_count = (allText.match(/[A-Za-z0-9+/]{20,}={0,2}/g) || []).length;
  features.hex_pattern_count = (allText.match(/0x[0-9a-fA-F]{4,}/g) || []).length;

  // Deceptive keywords (from shared strings)
  const ssXml = files['xl/sharedStrings.xml'];
  if (ssXml) {
    const ssText = decodeUtf8(ssXml).toLowerCase();
    let dkCount = 0;
    for (const kw of DECEPTIVE_KEYWORDS) dkCount += countOccurrences(ssText, kw);
    features.deceptive_keywords_count_ocr = dkCount;
    features.ocr_extracted_text_length = ssText.length;
  }

  // VBA analysis from vbaProject.bin
  const vbaFile = files['xl/vbaProject.bin'];
  if (vbaFile) {
    features.has_macro = 1;
    const vbaText = String.fromCharCode(...vbaFile.subarray(0, Math.min(vbaFile.length, 100000)));
    const lines = vbaText.split('\n');
    features.macro_line_count = lines.length;
    features.macro_procedure_count = countOccurrences(vbaText, 'Sub ') + countOccurrences(vbaText, 'Function ');
    features.macro_chr_count = countOccurrences(vbaText, 'Chr(');
    features.macro_string_function_count = countOccurrences(vbaText, 'Mid(') + countOccurrences(vbaText, 'Left(') + countOccurrences(vbaText, 'Right(');
    features.macro_arithmetic_operator_count = (vbaText.match(/[+\-*\/]/g) || []).length;
    features.macro_concatenation_count = countOccurrences(vbaText, ' & ');
    features.macro_callbyname_count = countOccurrences(vbaText, 'CallByName');
    features.macro_comment_lines = lines.filter((l) => l.trim().startsWith("'")).length;
    const lineLengths = lines.map((l) => l.length);
    features.macro_average_line_length = lineLengths.length > 0
      ? lineLengths.reduce((a, b) => a + b, 0) / lineLengths.length
      : 0;
    features.macro_token_count = (vbaText.match(/\w+/g) || []).length;
    features.macro_count = features.macro_procedure_count;
    features.uses_file_api = (vbaText.includes('Open') && vbaText.includes('For Output')) ? 1 : 0;
    features.uses_network_api = (vbaText.includes('WinHttp') || vbaText.includes('XMLHTTP')) ? 1 : 0;
    features.uses_process_api = (vbaText.includes('Shell') || vbaText.includes('CreateObject')) ? 1 : 0;
    features.macro_count_parentheses = (vbaText.match(/[()]/g) || []).length;
    features.macro_count_assignments = countOccurrences(vbaText, ' = ');
    features.macro_max_line_length = lineLengths.length > 0 ? Math.max(...lineLengths) : 0;
    features.macro_max_string_literals = (vbaText.match(/"[^"]*"/g) || []).length;
    features.macro_max_arithmetic_ops = (vbaText.match(/[+\-*\/]/g) || []).length;
    features.macro_max_concat_ops = countOccurrences(vbaText, ' & ');
    const vocab = new Set((vbaText.match(/\w+/g) || []));
    features.macro_vocab_size = vocab.size;
  }

  return features;
}
