import { strToU8, zipSync } from 'fflate';
import { formatPaisa, parseRupees } from '../money';
import { csvField, parseCsv } from './csv';
import { genericAdapter, mapRows } from './mapping';
import { parseCount, parseDay } from './values';
import { readXlsx, XlsxError } from './xlsx';

describe('money', () => {
  it('reads rupees as people and portals write them, to paisa', () => {
    expect(parseRupees('1,234.50')).toBe(123450);
    expect(parseRupees('Rs. 1,234')).toBe(123400);
    expect(parseRupees('NPR 12,34,567')).toBe(123456700);
    expect(parseRupees('रु ५००')).toBe(50000);
    expect(parseRupees('(250)')).toBe(-25000);
    expect(parseRupees('99.5')).toBe(9950);
    expect(parseRupees(1500)).toBe(150000);
  });
  it('refuses anything ambiguous instead of guessing', () => {
    expect(parseRupees('1,23')).toBeNull(); // European decimal comma?
    expect(parseRupees('12.345')).toBeNull();
    expect(parseRupees('about 500')).toBeNull();
    expect(parseRupees('')).toBeNull();
  });
  it('prints in Nepali grouping', () => {
    expect(formatPaisa(123456750)).toBe('NPR 12,34,567.50');
    expect(formatPaisa(99900, { symbol: false })).toBe('999');
    expect(formatPaisa(-5000)).toBe('-NPR 50');
  });
});

describe('dates and counts', () => {
  it('reads day-first numeric dates, ISO and month names', () => {
    expect(parseDay('04/10/2026')).toBe('2026-10-04');
    expect(parseDay('4-10-2026')).toBe('2026-10-04');
    expect(parseDay('10/04/2026', 'MDY')).toBe('2026-10-04');
    expect(parseDay('2026-10-04')).toBe('2026-10-04');
    expect(parseDay('2026-10-04T18:30:00Z')).toBe('2026-10-04');
    expect(parseDay('4 Oct 2026')).toBe('2026-10-04');
    expect(parseDay('Oct 4, 2026')).toBe('2026-10-04');
    expect(parseDay('०४/१०/२०२६')).toBe('2026-10-04');
  });
  it('converts Bikram Sambat dates when the source uses them', () => {
    expect(parseDay('2083-06-18', 'DMY', 'BS')).toBe('2026-10-04');
    expect(parseDay('18/06/2083', 'DMY', 'BS')).toBe('2026-10-04');
  });
  it('refuses days that do not exist', () => {
    expect(parseDay('31/02/2026')).toBeNull();
    expect(parseDay('2083-13-01', 'DMY', 'BS')).toBeNull();
    expect(parseDay('04/10/26')).toBeNull();
    expect(parseDay('yesterday')).toBeNull();
  });
  it('counts tickets', () => {
    expect(parseCount('12')).toBe(12);
    expect(parseCount('१२')).toBe(12);
    expect(parseCount('1.5')).toBeNull();
    expect(parseCount('-3')).toBeNull();
  });
});

describe('CSV', () => {
  it('handles quotes, doubled quotes, line breaks in quotes, CRLF and a BOM', () => {
    const text = '﻿Date,Booking ID,Note\r\n04/10/2026,"B-1","said ""thanks"", twice"\r\n05/10/2026,B-2,"two\nlines"\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['Date', 'Booking ID', 'Note'],
      ['04/10/2026', 'B-1', 'said "thanks", twice'],
      ['05/10/2026', 'B-2', 'two\nlines'],
    ]);
  });
  it('sniffs semicolon and tab separators', () => {
    expect(parseCsv('a;b;c\n1;"2;3";4\n')).toEqual([['a', 'b', 'c'], ['1', '2;3', '4']]);
    expect(parseCsv('a\tb\n1\t2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('writes fields a spreadsheet will not run as formulas', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('-1500.00')).toBe('-1500.00');
    expect(csvField('a,b')).toBe('"a,b"');
  });
});

describe('XLSX', () => {
  /** A minimal workbook as Excel writes one: shared strings, a date-styled cell, a number. */
  function workbook(): Uint8Array {
    return zipSync({
      'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><t>Travel Date</t></si><si><t>Booking ID</t></si><si><t>Amount</t></si><si><r><t>BKG-</t></r><r><t>77 &amp; co</t></r></si></sst>'),
      'xl/styles.xml': strToU8('<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>'),
      'xl/worksheets/sheet1.xml': strToU8(
        '<worksheet><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
        // 46299 is 2026-10-04 in Excel's 1900 date system; D2 is skipped.
        '<row r="2"><c r="A2" s="1"><v>46299</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>1250.5</v></c><c r="E2" t="inlineStr"><is><t>inline</t></is></c></row>' +
        '<row r="3"/>' +
        '</sheetData></worksheet>'),
    });
  }

  it('reads the first sheet, with dates from the workbook’s own formats', () => {
    expect(readXlsx(workbook())).toEqual([
      ['Travel Date', 'Booking ID', 'Amount'],
      ['2026-10-04', 'BKG-77 & co', '1250.5', '', 'inline'],
    ]);
  });
  it('refuses a file that is not a spreadsheet', () => {
    expect(() => readXlsx(strToU8('not a zip at all'))).toThrow(XlsxError);
  });
});

describe('mapping a portal export', () => {
  const table = [
    ['Travel Date', 'Booking ID', 'Bus No', 'Tickets', 'Gross Amount', 'Commission', 'Remarks'],
    ['04/10/2026', 'BS-1001', 'Ba 1 Kha 2345', '3', '4,500', '225', ''],
    ['04/10/2026', 'BS-1002', 'Ba 1 Kha 2345', '2', '3,000.00', '', 'Pokhara'],
    ['04/10/2026', 'BS-1001', 'Ba 1 Kha 2345', '3', '4,500', '225', 'repeated row'],
    ['31/02/2026', 'BS-1003', '', 'x', 'lots', '', ''],
  ];

  it('guesses the columns from the headers', () => {
    expect(genericAdapter.suggest(table[0]).columns).toEqual({
      date: 'Travel Date', reference: 'Booking ID', gross: 'Gross Amount', fees: 'Commission',
      tickets: 'Tickets', plate: 'Bus No', note: 'Remarks',
    });
  });

  it('builds checked rows, catching duplicates inside the file', () => {
    const mapping = { ...genericAdapter.suggest(table[0]), dateOrder: 'DMY' as const, calendar: 'AD' as const };
    const { rows, missing } = mapRows(table, { columns: mapping.columns!, dateOrder: 'DMY', calendar: 'AD' });
    expect(missing).toEqual([]);
    expect(rows[0]).toMatchObject({ line: 2, date: '2026-10-04', reference: 'BS-1001', grossPaisa: 450000, feesPaisa: 22500, netPaisa: 427500, tickets: 3, errors: [], duplicateInFile: false });
    expect(rows[1]).toMatchObject({ grossPaisa: 300000, feesPaisa: 0, netPaisa: 300000, note: 'Pokhara' });
    expect(rows[2].duplicateInFile).toBe(true);
    expect(rows[3].errors).toEqual(['“31/02/2026” is not a date', '“lots” is not an amount', '“x” is not a number of tickets', 'No bus']);
  });

  it('works from net and fees when there is no gross column', () => {
    const { rows } = mapRows([['Date', 'Net', 'Fee'], ['2026-10-04', '950', '50']], {
      columns: { date: 'Date', net: 'Net', fees: 'Fee' }, dateOrder: 'DMY', calendar: 'AD', vehicleId: 'bus-1',
    });
    expect(rows[0]).toMatchObject({ grossPaisa: 100000, feesPaisa: 5000, netPaisa: 95000, errors: [] });
  });

  it('says which required columns are missing', () => {
    expect(mapRows([['Foo'], ['1']], { columns: {}, dateOrder: 'DMY', calendar: 'AD' }).missing).toEqual(['date', 'gross', 'plate']);
  });
});
