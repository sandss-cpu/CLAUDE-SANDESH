// Reads ZAP baseline JSON reports, posts the counts by risk as annotations on the run,
// and fails if any finding is High risk. Medium and lower are listed, for review.
import { readFileSync, existsSync } from 'node:fs';

const RISK = { 3: 'High', 2: 'Medium', 1: 'Low', 0: 'Informational' };
let high = 0;
for (const file of process.argv.slice(2)) {
  if (!existsSync(file)) { console.log(`::error title=ZAP::${file} was not written`); process.exitCode = 1; continue; }
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const alerts = (report.site ?? []).flatMap((s) => s.alerts ?? []);
  const counts = { 3: 0, 2: 0, 1: 0, 0: 0 };
  for (const a of alerts) counts[a.riskcode] = (counts[a.riskcode] ?? 0) + 1;
  high += counts[3];
  const line = `${file}: ${counts[3]} high, ${counts[2]} medium, ${counts[1]} low, ${counts[0]} informational`;
  console.log(`::notice title=ZAP ${file}::${line}`);
  for (const a of alerts.filter((x) => Number(x.riskcode) >= 2)) {
    console.log(`::${Number(a.riskcode) === 3 ? 'error' : 'warning'} title=ZAP ${RISK[a.riskcode]}::${file}: ${a.name} (${a.pluginid}), ${a.count ?? a.instances?.length ?? 0} instances`);
  }
}
if (high) { console.log(`::error title=ZAP::${high} high-risk findings`); process.exitCode = 1; }
