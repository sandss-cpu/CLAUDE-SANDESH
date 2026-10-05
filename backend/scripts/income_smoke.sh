#!/bin/bash
# Daily income records (Phase 3, Feature 6), against a running API: off until an owner
# with an authenticator turns them on, the daily sheet, managers kept from totals unless
# the owner shares them, CSV and XLSX imports that never duplicate (and can be undone),
# profit from known fuel and maintenance costs, statement photos behind signed links,
# the 7-day lock, audit entries, and other companies getting 404.
#
# The company and the test owner's account are put back as they were: income records
# off, totals unshared, no authenticator, nothing left from the run.
#
#   bash scripts/income_smoke.sh ../../Bato_Docs/Bato_Test_Accounts_Phase3.md
DOC=${1:?"usage: income_smoke.sh path/to/Bato_Test_Accounts.md"}
. "$(cd "$(dirname "$0")" && pwd)/smoke_lib.sh"

id_of(){ sql "select id from $1 where $2 limit 1"; }
CID=$(id_of operators "slug like 'himalayan%'")
ROUTE=$(id_of routes "code='KTM-PKR'")
OWNER_ID=$(id_of users "email='owner.fleet@bato.test'")
START=$(date -u +"%Y-%m-%d %H:%M:%S")
TODAY=$(TZ=Asia/Kathmandu date +%Y-%m-%d)
YESTERDAY=$(TZ=Asia/Kathmandu date -v-1d +%Y-%m-%d)
TOMORROW=$(TZ=Asia/Kathmandu date -v+1d +%Y-%m-%d)
DMY=$(TZ=Asia/Kathmandu date +%d/%m/%Y)
TMP=$(mktemp -d)
HAD_SOURCES=$(sql "select count(*) from income_sources where \"operatorId\"='$CID'")
upload(){ # path token file [form fields...] -> HTTP status, body in $R
  local path=$1 token=$2 file=$3; shift 3
  local args=(-s -o "$R" -w "%{http_code}" -X POST "$API$path" -H "Authorization: Bearer $token" -F "file=@$file")
  for f in "$@"; do args+=(--form-string "$f"); done
  curl "${args[@]}"
}
put_sheet(){ call PUT "/fleet/buses/$BUS/income/${2:-$TODAY}" "$1" "$3"; }

# Whatever an interrupted run left behind.
sql "update operators set \"financeEnabled\"=false, \"managersSeeTotals\"=false where id='$CID';
     update users set \"totpSecret\"=null, \"totpConfirmedAt\"=null where id='$OWNER_ID';" >/dev/null

echo "== sign in"
OWNER=$(login owner.fleet@bato.test); MANAGER=$(login manager.fleet@bato.test)
CREW=$(login crew.fleet@bato.test); SINGLE=$(login owner.single@bato.test)
B="{\"registrationNo\":\"ba 9 kha 7272\",\"label\":\"Income Smoke Bus\",\"seatCount\":30,\"busType\":\"TOURIST_DELUXE\",\"odometerKm\":80000,\"routeId\":\"$ROUTE\"}"
ok "a throwaway bus with 30 seats" 201 "$(call POST /fleet/companies/$CID/buses "$OWNER" "$B")"
BUS=$(get "data['id']")

echo "== off until the owner turns it on"
ok "off to begin with" false "$(call GET /fleet/companies/$CID/finance "$MANAGER" >/dev/null; get "data['enabled']")"
ok "no daily sheet while off" FINANCE_OFF "$(call GET "/fleet/buses/$BUS/income" "$MANAGER" >/dev/null; get "d.get('code')")"
ok "no dashboard while off" 403 "$(call GET /fleet/companies/$CID/income/dashboard "$OWNER")"
ok "a manager cannot turn it on" 403 "$(call PATCH /fleet/companies/$CID/finance "$MANAGER" '{"enabled":true}')"
ok "a crew account cannot even see the setting" 403 "$(call GET /fleet/companies/$CID/finance "$CREW")"
ok "another company: not found" 404 "$(call GET /fleet/companies/$CID/finance "$SINGLE")"
ok "the owner needs an authenticator first" AUTHENTICATOR_REQUIRED "$(call PATCH /fleet/companies/$CID/finance "$OWNER" '{"enabled":true}' >/dev/null; get "d.get('code')")"
ok "the owner sets one up" 201 "$(call POST /auth/mfa/setup "$OWNER")"
SECRET=$(get "data['secret']")
ok "with a scannable code" true "$(get "data['qrSvg'].startswith('<svg') and data['otpauthUri'].startswith('otpauth://totp/Batoma')")"
B="{\"code\":\"$(totp "$SECRET")\"}"
ok "and confirms it" 201 "$(call POST /auth/mfa/setup/confirm "$OWNER" "$B")"
ok "turning on needs a fresh code" 400 "$(call PATCH /fleet/companies/$CID/finance "$OWNER" '{"enabled":true}')"
ok "a wrong code is refused" 400 "$(call PATCH /fleet/companies/$CID/finance "$OWNER" '{"enabled":true,"code":"000000"}')"
B="{\"enabled\":true,\"code\":\"$(totp "$SECRET")\"}"
ok "the owner turns income records on" true "$(call PATCH /fleet/companies/$CID/finance "$OWNER" "$B" >/dev/null; get "data['enabled']")"
ok "the eight usual sources are there" 8 "$(call GET /fleet/companies/$CID/income/sources "$MANAGER" >/dev/null; get "len([s for s in data if s['isActive']])")"
ok "turning it on is audited" 1 "$(sql "select count(*) from audit_events where action='finance.settings' and \"entityId\"='$CID' and \"createdAt\" >= '$START' and summary like '%turned income records on%'")"
B="{\"email\":\"owner.fleet@bato.test\",\"password\":\"$(pw owner.fleet@bato.test)\"}"
ok "from now on the owner's sign-in asks for the authenticator" "true false" "$(call POST /auth/email/login "" "$B" >/dev/null; get "f\"{str(data['mfaRequired']).lower()} {str('accessToken' in data).lower()}\"")"
OWNER=$(login owner.fleet@bato.test)
ok "and with it the owner is in" 200 "$(call GET /fleet/companies/$CID/finance "$OWNER")"
CASH=$(sql "select id from income_sources where \"operatorId\"='$CID' and name='Counter cash'")
BUSSEWA=$(sql "select id from income_sources where \"operatorId\"='$CID' and name='Bussewa'")
ESEWA=$(sql "select id from income_sources where \"operatorId\"='$CID' and name='eSewa'")

echo "== the daily sheet"
ok "the manager opens today's sheet" 8 "$(call GET "/fleet/buses/$BUS/income" "$MANAGER" >/dev/null; get "len(data['sources'])")"
ok "without totals" false "$(get "data['canSeeTotals']")"
ok "with the date in BS too" true "$(get "bool(data['dateBs'])")"
B="{\"rows\":[{\"sourceId\":\"$CASH\",\"ticketsSold\":30,\"grossPaisa\":4500000},{\"sourceId\":\"$BUSSEWA\",\"ticketsSold\":10,\"grossPaisa\":1500000,\"feesPaisa\":75000,\"reference\":\"SMK-BS-1\"},{\"sourceId\":\"$ESEWA\",\"ticketsSold\":0,\"grossPaisa\":0}]}"
ok "the manager saves cash and Bussewa (the blank eSewa row is skipped)" 2 "$(put_sheet "$MANAGER" "" "$B" >/dev/null; get "len(data['entries'])")"
ok "net is gross less fees" 1425000 "$(get "[e for e in data['entries'] if e['reference']=='SMK-BS-1'][0]['netPaisa']")"
CASH_ENTRY=$(get "[e for e in data['entries'] if e['sourceId']=='$CASH'][0]['id']")
BS_ENTRY=$(get "[e for e in data['entries'] if e['sourceId']=='$BUSSEWA'][0]['id']")
B="{\"rows\":[{\"sourceId\":\"$ESEWA\",\"ticketsSold\":1,\"grossPaisa\":1000,\"feesPaisa\":5000}]}"
ok "fees larger than the amount are refused" 400 "$(put_sheet "$MANAGER" "" "$B")"
ok "a day that has not happened is refused" 400 "$(put_sheet "$MANAGER" "$TOMORROW" '{"rows":[]}')"
B="{\"rows\":[{\"sourceId\":\"$BUSSEWA\",\"ticketsSold\":1,\"grossPaisa\":1000,\"reference\":\"SMK-BS-1\"}]}"
ok "the same settlement cannot be entered twice" 409 "$(put_sheet "$MANAGER" "" "$B")"
B="{\"rows\":[{\"id\":\"$CASH_ENTRY\",\"sourceId\":\"$CASH\",\"ticketsSold\":31,\"grossPaisa\":4500000}]}"
ok "a correction is saved" 31 "$(put_sheet "$MANAGER" "" "$B" >/dev/null; get "[e for e in data['entries'] if e['id']=='$CASH_ENTRY'][0]['ticketsSold']")"
ok "every change is audited" "2 1" "$(echo "$(sql "select count(*) from audit_events where action='income.create' and \"operatorId\"='$CID' and \"createdAt\" >= '$START'") $(sql "select count(*) from audit_events where action='income.update' and \"entityId\"='$CASH_ENTRY'")")"
ok "a crew account cannot open the sheet" 403 "$(call GET "/fleet/buses/$BUS/income" "$CREW")"
ok "another company cannot open it" 404 "$(call GET "/fleet/buses/$BUS/income" "$SINGLE")"
ok "another company cannot write to it" 404 "$(put_sheet "$SINGLE" "" '{"rows":[]}')"
ok "another company cannot delete an entry" 404 "$(call DELETE "/fleet/income/$CASH_ENTRY" "$SINGLE")"

echo "== totals are the owner's to share"
ok "a manager cannot read the dashboard" TOTALS_HIDDEN "$(call GET /fleet/companies/$CID/income/dashboard "$MANAGER" >/dev/null; get "d.get('code')")"
ok "or the report" 403 "$(call GET "/fleet/companies/$CID/income/report" "$MANAGER")"
ok "or reconciliation" 403 "$(call GET "/fleet/companies/$CID/income/reconciliation" "$MANAGER")"
ok "or the CSV" 403 "$(call GET "/fleet/companies/$CID/income/report.csv" "$MANAGER")"
ok "or the PDF" 403 "$(call GET "/fleet/companies/$CID/income/report.pdf" "$MANAGER")"
ok "a manager cannot share totals with themselves" 403 "$(call PATCH /fleet/companies/$CID/finance "$MANAGER" '{"managersSeeTotals":true}')"
ok "the owner shares them" true "$(call PATCH /fleet/companies/$CID/finance "$OWNER" '{"managersSeeTotals":true}' >/dev/null; get "data['managersSeeTotals']")"
ok "now the manager sees the dashboard" 200 "$(call GET /fleet/companies/$CID/income/dashboard "$MANAGER")"
ok "another company still cannot" 404 "$(call GET /fleet/companies/$CID/income/dashboard "$SINGLE")"

echo "== importing a portal export"
cat > "$TMP/bussewa.csv" <<CSV
Travel Date,Booking ID,Bus No,Tickets,Gross Amount,Commission
$DMY,SMK-BS-1,Ba 9 Kha 7272,10,"1,500",75
$DMY,SMK-BS-2,BA-9-KHA-7272,2,"1,000.00",50
$DMY,SMK-BS-3,ba9kha7272,4,2000,100
31/02/2026,SMK-BS-9,Ba 9 Kha 7272,1,500,0
CSV
ok "the preview reads the file" 200 "$(upload /fleet/companies/$CID/income/import/preview "$MANAGER" "$TMP/bussewa.csv" "sourceId=$BUSSEWA" | sed 's/201/200/')"
ok "and guesses the columns" "Booking ID|Bus No" "$(get "data['mapping']['columns']['reference'] + '|' + data['mapping']['columns']['plate']")"
ok "two new, one already entered, one with a bad date" "2 1 1" "$(get "f\"{data['counts']['ok']} {data['counts']['duplicates']} {data['counts']['invalid']}\"")"
ok "the plate is matched however it is written" true "$(get "all(r['vehicleId']=='$BUS' for r in data['rows'][:3])")"
ok "nothing is saved by a preview" 0 "$(sql "select count(*) from income_entries where reference in ('SMK-BS-2','SMK-BS-3')")"
ok "the import saves the two new rows" 2 "$(upload /fleet/companies/$CID/income/import "$MANAGER" "$TMP/bussewa.csv" "sourceId=$BUSSEWA" >/dev/null; get "data['created']")"
IMP=$(get "data['id']")
ok "importing the same file again adds nothing" 400 "$(upload /fleet/companies/$CID/income/import "$MANAGER" "$TMP/bussewa.csv" "sourceId=$BUSSEWA")"
ok "no duplicates in the records" 1 "$(sql "select count(*) from income_entries where reference='SMK-BS-2' and \"deletedAt\" is null")"
ok "the column choices are remembered for Bussewa" "Booking ID" "$(sql "select \"importMapping\"->'columns'->>'reference' from income_sources where id='$BUSSEWA'")"
ok "undone within the day" 2 "$(call POST "/fleet/income/imports/$IMP/undo" "$MANAGER" >/dev/null; get "data['removed']")"
ok "only once" 409 "$(call POST "/fleet/income/imports/$IMP/undo" "$MANAGER")"
ok "after an undo the same file imports again" 2 "$(upload /fleet/companies/$CID/income/import "$MANAGER" "$TMP/bussewa.csv" "sourceId=$BUSSEWA" >/dev/null; get "data['created']")"
ok "imports are audited" "1 1" "$(echo "$(sql "select count(*) from audit_events where action='income.import.undo' and \"entityId\"='$IMP'") $(sql "select count(*) from audit_events where action='income.import' and \"entityId\"='$IMP'")")"
python3 - "$TMP/esewa.xlsx" "$TODAY" <<'PY'
import sys, zipfile
day = sys.argv[2]
sheet = ('<worksheet><sheetData>'
  '<row r="1"><c r="A1" t="inlineStr"><is><t>Date</t></is></c><c r="B1" t="inlineStr"><is><t>Transaction ID</t></is></c>'
  '<c r="C1" t="inlineStr"><is><t>Amount</t></is></c><c r="D1" t="inlineStr"><is><t>Tickets</t></is></c></row>'
  f'<row r="2"><c r="A2" t="inlineStr"><is><t>{day}</t></is></c><c r="B2" t="inlineStr"><is><t>SMK-ES-1</t></is></c><c r="C2"><v>500</v></c><c r="D2"><v>1</v></c></row>'
  '</sheetData></worksheet>')
with zipfile.ZipFile(sys.argv[1], 'w') as z:
    z.writestr('xl/workbook.xml', '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>')
    z.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
    z.writestr('xl/worksheets/sheet1.xml', sheet)
PY
M="{\"columns\":{\"date\":\"Date\",\"reference\":\"Transaction ID\",\"gross\":\"Amount\",\"tickets\":\"Tickets\"},\"dateOrder\":\"DMY\",\"calendar\":\"AD\",\"vehicleId\":\"$BUS\"}"
ok "an eSewa .xlsx with no bus column, for one chosen bus" 1 "$(upload /fleet/companies/$CID/income/import "$OWNER" "$TMP/esewa.xlsx" "sourceId=$ESEWA" "mapping=$M" >/dev/null; get "data['created']")"
ok "another company cannot import into ours" 404 "$(upload /fleet/companies/$CID/income/import/preview "$SINGLE" "$TMP/bussewa.csv" "sourceId=$BUSSEWA")"
printf 'not a spreadsheet\0\0' > "$TMP/bad.csv"
ok "a file that is not a spreadsheet is refused" 400 "$(upload /fleet/companies/$CID/income/import/preview "$MANAGER" "$TMP/bad.csv" "sourceId=$BUSSEWA")"

echo "== profit from known costs"
B="{\"filledAt\":\"$(iso -7200)\",\"odometerKm\":80000,\"litres\":100,\"costNpr\":17800,\"fullTank\":true}"
ok "fuel: NPR 17,800" 201 "$(call POST /fleet/buses/$BUS/fuel "$OWNER" "$B")"
B="{\"kind\":\"ROUTINE_SERVICE\",\"servicedAt\":\"$(iso -7000)\",\"odometerKm\":80000,\"title\":\"Smoke service\",\"costNpr\":5000}"
ok "maintenance: NPR 5,000" 201 "$(call POST /fleet/buses/$BUS/maintenance "$OWNER" "$B")"
B="{\"direction\":\"FORWARD\",\"departAt\":\"$(iso -3000)\",\"startOdometerKm\":80000}"
call POST /fleet/buses/$BUS/trips "$OWNER" "$B" >/dev/null; T1=$(get "data['id']")
B="{\"arriveAt\":\"$(iso -2400)\",\"endOdometerKm\":80100}"; call POST "/fleet/trips/$T1/end" "$OWNER" "$B" >/dev/null
B="{\"direction\":\"REVERSE\",\"departAt\":\"$(iso -1800)\",\"startOdometerKm\":80100}"
call POST /fleet/buses/$BUS/trips "$OWNER" "$B" >/dev/null; T2=$(get "data['id']")
B="{\"arriveAt\":\"$(iso -1200)\",\"endOdometerKm\":80200}"
ok "two 100 km trips logged" 201 "$(call POST "/fleet/trips/$T2/end" "$OWNER" "$B")"
Q="from=$YESTERDAY&to=$TODAY&groupBy=bus&bucket=day"
ok "the owner's report" 200 "$(call GET "/fleet/companies/$CID/income/report?$Q" "$OWNER")"
# Net: 45,000 cash + (15,000 − 750) + (1,000 − 50) + (2,000 − 100) + 500 eSewa = NPR 62,600.
ok "net income NPR 62,600" 6260000 "$(get "[r for r in data['rows'] if r['key']=='$BUS'][0]['netPaisa']")"
# Tickets 31 + 10 + 2 + 4 + 1 = 48 over 30 seats × 2 trips = 0.8.
ok "48 tickets, 80% of the seats on two trips" "48 0.8" "$(get "(lambda r: f\"{r['tickets']} {r['occupancy']}\")([r for r in data['rows'] if r['key']=='$BUS'][0])")"
ok "NPR 313 per km over 200 km" 31300 "$(get "[r for r in data['rows'] if r['key']=='$BUS'][0]['revenuePerKmPaisa']")"
# Profit: 62,600 − 17,800 fuel − 5,000 maintenance = NPR 39,800.
ok "operating profit NPR 39,800" 3980000 "$(get "[r for r in data['rows'] if r['key']=='$BUS'][0]['profitPaisa']")"
ok "with a note saying what it leaves out" true "$(get "'wages' in data['note']")"
ok "by driver too" 200 "$(call GET "/fleet/companies/$CID/income/report?from=$TODAY&to=$TODAY&groupBy=driver" "$OWNER")"
ok "reconciliation: three Bussewa settlements referenced" 3 "$(call GET "/fleet/companies/$CID/income/reconciliation?from=$TODAY&to=$TODAY" "$OWNER" >/dev/null; get "[s for s in data['perSource'] if s['sourceId']=='$BUSSEWA'][0]['referenced']['count']")"
ok "and the cash unreferenced" 1 "$(get "[s for s in data['perSource'] if s['sourceId']=='$CASH'][0]['unreferenced']['count']")"
ok "the CSV export" "200 text/csv; charset=utf-8" "$(curl -s -o "$R" -w "%{http_code} %{content_type}" "$API/fleet/companies/$CID/income/report.csv?$Q" -H "Authorization: Bearer $OWNER")"
ok "carries the profit" true "$(python3 -c "import sys; t=open(sys.argv[1], encoding='utf-8-sig').read(); print(str('39800.00' in t and 'Operating profit' in t).lower())" "$R")"
ok "the PDF export" "200 application/pdf" "$(curl -s -o "$R" -w "%{http_code} %{content_type}" "$API/fleet/companies/$CID/income/report.pdf?$Q" -H "Authorization: Bearer $OWNER")"
ok "a real PDF" "%PDF-" "$(head -c 5 "$R")"
ok "today on the dashboard" true "$(call GET /fleet/companies/$CID/income/dashboard "$OWNER" >/dev/null; get "data['today']['netPaisa'] >= 6260000 and len(data['monthly'])==12 and len(data['daily'])==30")"

echo "== statement photos"
python3 -c "
import struct, zlib, sys
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00')) + chunk(b'IEND', b'')
open(sys.argv[1], 'wb').write(png)" "$TMP/statement.png"
printf '<html>not a photo</html>' > "$TMP/fake.png"
ok "a file that is not a photo is refused" 400 "$(upload "/fleet/income/$BS_ENTRY/attachment" "$MANAGER" "$TMP/fake.png")"
ok "a statement photo is attached" 201 "$(upload "/fleet/income/$BS_ENTRY/attachment" "$MANAGER" "$TMP/statement.png")"
ok "the owner gets a short-lived link" true "$(call GET "/fleet/income/$BS_ENTRY/attachment" "$OWNER" >/dev/null; get "data['expiresInSeconds']==300 and '/files/' in data['url']")"
LINK=$(get "data['url']")
ok "the link opens the photo" "200 image/png" "$(curl -s -o /dev/null -w "%{http_code} %{content_type}" "$LINK")"
ok "a tampered link does not" 404 "$(curl -s -o /dev/null -w "%{http_code}" "${LINK%?}x")"
ok "the photo is not public" 404 "$(curl -s -o /dev/null -w "%{http_code}" "${LINK%%\?*}")"
ok "another company gets no link" 404 "$(call GET "/fleet/income/$BS_ENTRY/attachment" "$SINGLE")"
KEY=$(sql "select \"attachmentKey\" from income_entries where id='$BS_ENTRY'")

echo "== deleting, and the 7-day lock"
ok "the manager deletes an entry" 200 "$(call DELETE "/fleet/income/$CASH_ENTRY" "$MANAGER")"
ok "it leaves the sheet" false "$(call GET "/fleet/buses/$BUS/income" "$OWNER" >/dev/null; get "any(e['id']=='$CASH_ENTRY' for e in data['entries'])")"
ok "but stays in the record, audited" "1 1" "$(echo "$(sql "select count(*) from income_entries where id='$CASH_ENTRY' and \"deletedAt\" is not null") $(sql "select count(*) from audit_events where action='income.delete' and \"entityId\"='$CASH_ENTRY'")")"
# The column holds UTC; the database's own clock is Kathmandu time (CLAUDE.md, landmines).
sql "update income_entries set \"lockedAt\" = (now() at time zone 'UTC') - interval '1 minute' where id='$BS_ENTRY'" >/dev/null
B="{\"rows\":[{\"id\":\"$BS_ENTRY\",\"sourceId\":\"$BUSSEWA\",\"ticketsSold\":11,\"grossPaisa\":1500000,\"feesPaisa\":75000,\"reference\":\"SMK-BS-1\"}]}"
ok "an entry older than 7 days cannot be changed" 409 "$(put_sheet "$OWNER" "" "$B")"
ok "or deleted" 409 "$(call DELETE "/fleet/income/$BS_ENTRY" "$OWNER")"
ok "the sheet shows it locked" true "$(call GET "/fleet/buses/$BUS/income" "$OWNER" >/dev/null; get "[e for e in data['entries'] if e['id']=='$BS_ENTRY'][0]['locked']")"

echo "== switching off"
ok "the owner stops sharing totals" false "$(call PATCH /fleet/companies/$CID/finance "$OWNER" '{"managersSeeTotals":false}' >/dev/null; get "data['managersSeeTotals']")"
ok "and switches income records off" false "$(call PATCH /fleet/companies/$CID/finance "$OWNER" '{"enabled":false}' >/dev/null; get "data['enabled']")"
ok "the sheet is closed again" 403 "$(call GET "/fleet/buses/$BUS/income" "$MANAGER")"
B="{\"email\":\"owner.fleet@bato.test\",\"password\":\"$(pw owner.fleet@bato.test)\"}"
ok "and the owner signs in without the authenticator once more" true "$(call POST /auth/email/login "" "$B" >/dev/null; get "'accessToken' in data")"

echo "== clean up"
[ -n "$KEY" ] && rm -f "$SMOKE_DIR/../private-uploads/$KEY"
call PATCH "/fleet/buses/$BUS/archive" "$OWNER" '{"archived":true}' >/dev/null
ok "throwaway bus deleted, with its income" 200 "$(call DELETE "/fleet/buses/$BUS" "$OWNER")"
sql "delete from income_imports where \"operatorId\"='$CID' and \"createdAt\" >= '$START';
     update users set \"totpSecret\"=null, \"totpConfirmedAt\"=null where id='$OWNER_ID';
     update operators set \"financeEnabled\"=false, \"financeEnabledAt\"=null, \"managersSeeTotals\"=false where id='$CID';" >/dev/null
# Sources the run created by switching income records on go too; ones the company already had keep their names.
if [ "$HAD_SOURCES" = "0" ]; then
  sql "delete from income_sources where \"operatorId\"='$CID'" >/dev/null
else
  sql "update income_sources set \"importMapping\"=null where \"operatorId\"='$CID' and \"importMapping\"->'columns'->>'reference' in ('Booking ID','Transaction ID')" >/dev/null
fi
rm -rf "$TMP"
ok "nothing of the run is left" "0 0 0" "$(echo "$(sql "select count(*) from income_entries where \"createdAt\" >= '$START'") $(sql "select count(*) from income_imports where \"createdAt\" >= '$START'") $(sql "select count(*) from vehicles where \"plateKey\"='BA9KHA7272'")")"

finish
