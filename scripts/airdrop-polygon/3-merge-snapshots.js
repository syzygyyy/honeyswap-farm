const fs = require('fs')
const BN = require('bn.js')

const PARTIAL_SNAPSHOT_SRC = './partial-snapshots.json'
const FULL_SNAPSHOT_OUTPUT = './raw-snapshot.json'
const ZERO = new BN('0')

function getBN(bnObj, key) {
  return bnObj[key] ?? ZERO
}

async function main() {
  const partialSnapshots = JSON.parse(fs.readFileSync(PARTIAL_SNAPSHOT_SRC))
  console.log('Object.keys(partialSnapshots): ', Object.keys(partialSnapshots))
  const fullSnapshot = {}
  let total = ZERO
  let expectedTotal = ZERO
  for (const partialSnapshot of Object.values(partialSnapshots)) {
    expectedTotal = expectedTotal.add(new BN(partialSnapshot.totalAllocated, 16))
    for (const [account, rawAlloc] of Object.entries(partialSnapshot.accountAllocations)) {
      const allocation = new BN(rawAlloc, 16)
      fullSnapshot[account] = getBN(fullSnapshot, account).add(allocation)
      total = total.add(allocation)
    }
  }
  fs.writeFileSync(FULL_SNAPSHOT_OUTPUT, JSON.stringify(fullSnapshot, null, 2), 'utf8')
  const matchStr = total.eq(expectedTotal) ? 'match' : 'no match'
  console.log(`total: ${total.toString()} (${matchStr})`)
  console.log('unique addreses:', Array.from(Object.keys(fullSnapshot)).length)
}

main().then(() => process.exit(0))
