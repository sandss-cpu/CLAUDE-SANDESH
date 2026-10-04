/* Generated from backend/src/common/utils/bs-date.ts by scripts/sync-web-libs.mjs (source sha256 b9a7ab3318fbc527).
   Do not edit: change the source, run the script, and commit both. */
(function (root) {
  var module = { exports: {} };
  var exports = module.exports;
  "use strict";
  /**
   * Bikram Sambat (BS) dates beside AD ones, for owners' finance, trip and appraisal screens.
   *
   * BS month lengths are not a formula: they come from the published calendar, so they are
   * a table. The table below (BS 2000–2090, i.e. 14 April 1943 to 13 April 2034) is taken
   * from nepali-date-converter 3.4.0, MIT licence, (c) 2020 Subesh Bhandari:
   * https://github.com/subeshb1/Nepali-Date. Extend it, with a test, before 2090 BS.
   *
   * Everything here works on calendar days, not instants: an AD date is "YYYY-MM-DD", and an
   * instant is first read as the day it is in Asia/Kathmandu. That avoids the classic slip
   * where midnight in Kathmandu is still the previous day in UTC.
   *
   * Dependency-free on purpose: scripts/sync-web-libs.mjs turns this file into
   * web/js/lib/bs-date.js for the browser, and a test checks the two stay in step.
   */
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.BS_RANGE = exports.nepaliDigits = exports.BS_MONTHS_NE = exports.BS_MONTHS_EN = void 0;
  exports.kathmanduDay = kathmanduDay;
  exports.adToBs = adToBs;
  exports.bsToAd = bsToAd;
  exports.daysInBsMonth = daysInBsMonth;
  exports.formatBs = formatBs;
  const FIRST_YEAR = 2000;
  const LAST_YEAR = 2090;
  /** 1 Baisakh 2000 BS. */
  const EPOCH_AD = Date.UTC(1943, 3, 14);
  const DAY_MS = 86400000;
  const KATHMANDU_OFFSET_MS = (5 * 60 + 45) * 60000;
  /** Days in each month, Baisakh to Chaitra, for each BS year from 2000. */
  const MONTH_DAYS = [
      [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2000
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2001
      [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2002
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2003
      [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2004
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2005
      [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2006
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2007
      [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], // 2008
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2009
      [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2010
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2011
      [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2012
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2013
      [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2014
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2015
      [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2016
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2017
      [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2018
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2019
      [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2020
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2021
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2022
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2023
      [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2024
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2025
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2026
      [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2027
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2028
      [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30], // 2029
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2030
      [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2031
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2032
      [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2033
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2034
      [30, 32, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], // 2035
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2036
      [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2037
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2038
      [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2039
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2040
      [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2041
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2042
      [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2043
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2044
      [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2045
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2046
      [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2047
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2048
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2049
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2050
      [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2051
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2052
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2053
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2054
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2055
      [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30], // 2056
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2057
      [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2058
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2059
      [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2060
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2061
      [30, 32, 31, 32, 31, 31, 29, 30, 29, 30, 29, 31], // 2062
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2063
      [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2064
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2065
      [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], // 2066
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2067
      [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2068
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2069
      [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2070
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2071
      [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2072
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2073
      [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2074
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2075
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2076
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2077
      [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2078
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2079
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2080
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2081
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2082
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2083
      [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2084
      [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2085
      [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2086
      [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30], // 2087
      [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30], // 2088
      [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], // 2089
      [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], // 2090
  ];
  exports.BS_MONTHS_EN = [
      'Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj',
      'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
  ];
  exports.BS_MONTHS_NE = [
      'बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
      'कात्तिक', 'मंसिर', 'पुस', 'माघ', 'फागुन', 'चैत',
  ];
  const NE_DIGITS = '०१२३४५६७८९';
  const nepaliDigits = (value) => String(value).replace(/[0-9]/g, (d) => NE_DIGITS[Number(d)]);
  exports.nepaliDigits = nepaliDigits;
  const pad = (n) => String(n).padStart(2, '0');
  /** The calendar day an instant falls on in Kathmandu, as "YYYY-MM-DD". */
  function kathmanduDay(at) {
      return new Date(new Date(at).getTime() + KATHMANDU_OFFSET_MS).toISOString().slice(0, 10);
  }
  /** Days since 1 Baisakh 2000 for an AD calendar day. */
  function daysFromEpoch(adDay) {
      const [y, m, d] = adDay.split('-').map(Number);
      return Math.round((Date.UTC(y, m - 1, d) - EPOCH_AD) / DAY_MS);
  }
  /**
   * The BS date for an AD calendar day ("YYYY-MM-DD") or for an instant (read in
   * Kathmandu). Null outside the table's range rather than a wrong date.
   */
  function adToBs(ad) {
      const day = typeof ad === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ad) ? ad : kathmanduDay(ad);
      let left = daysFromEpoch(day);
      if (left < 0)
          return null;
      for (let y = 0; y < MONTH_DAYS.length; y++) {
          for (let m = 0; m < 12; m++) {
              if (left < MONTH_DAYS[y][m])
                  return { year: FIRST_YEAR + y, month: m + 1, day: left + 1 };
              left -= MONTH_DAYS[y][m];
          }
      }
      return null;
  }
  /** The AD calendar day ("YYYY-MM-DD") for a BS date, or null if it is not a real BS date. */
  function bsToAd(year, month, day) {
      if (year < FIRST_YEAR || year > LAST_YEAR || month < 1 || month > 12)
          return null;
      const row = MONTH_DAYS[year - FIRST_YEAR];
      if (day < 1 || day > row[month - 1])
          return null;
      let days = day - 1;
      for (let y = 0; y < year - FIRST_YEAR; y++)
          days += MONTH_DAYS[y].reduce((a, b) => a + b, 0);
      for (let m = 0; m < month - 1; m++)
          days += row[m];
      const ad = new Date(EPOCH_AD + days * DAY_MS);
      return `${ad.getUTCFullYear()}-${pad(ad.getUTCMonth() + 1)}-${pad(ad.getUTCDate())}`;
  }
  function daysInBsMonth(year, month) {
      if (year < FIRST_YEAR || year > LAST_YEAR || month < 1 || month > 12)
          return null;
      return MONTH_DAYS[year - FIRST_YEAR][month - 1];
  }
  /** "17 Asoj 2082", or in Nepali "२०८२ असोज १७". Empty outside the table's range. */
  function formatBs(ad, lang = 'en') {
      const bs = adToBs(ad);
      if (!bs)
          return '';
      return lang === 'ne'
          ? `${(0, exports.nepaliDigits)(bs.year)} ${exports.BS_MONTHS_NE[bs.month - 1]} ${(0, exports.nepaliDigits)(bs.day)}`
          : `${bs.day} ${exports.BS_MONTHS_EN[bs.month - 1]} ${bs.year}`;
  }
  exports.BS_RANGE = { first: FIRST_YEAR, last: LAST_YEAR };
  
  root.BsDate = module.exports;
})(typeof self !== 'undefined' ? self : this);
