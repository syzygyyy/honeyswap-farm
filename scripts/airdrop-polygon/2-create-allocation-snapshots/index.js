const fs = require('fs')
const path = require('path')
const web3 = require('../web3.js')()
const mongoose = require('../mongoose.js')
const createSingleSnapshot = require('./create-single-snapshot.js')(web3, mongoose)
const { allocations, blacklistedAddresses } = require('../reward-map.js')

const PARTIAL_SNAPSHOTS_SRC = path.join(process.mainModule.path, '../partial-snapshots.json')
console.log('PARTIAL_SNAPSHOTS_SRC: ', PARTIAL_SNAPSHOTS_SRC)

const cleanToken = ({ address, ...token }) => ({
  address: web3.utils.toChecksumAddress(address),
  ...token
})

const cleanAllocation = ({ tokens, ...allocation }) => ({
  ...allocation,
  tokens: tokens.map(cleanToken)
})

const partialSnapshots = JSON.parse(fs.readFileSync(PARTIAL_SNAPSHOTS_SRC, 'utf8'))
const saveSnapshot = (id, partialAllocation) => {
  partialSnapshots[id] = partialAllocation
  fs.writeFileSync(PARTIAL_SNAPSHOTS_SRC, JSON.stringify(partialSnapshots, null, 2), 'utf8')
}

async function main() {
  console.log('starting')
  await mongoose.connectDB()
  console.log('connected')

  const cleanedAllocations = allocations.map(cleanAllocation)
  // const snapshot = await createSingleSnapshot(cleanedAllocations[0], blacklistedAddresses)
  // console.log('snapshot: ', snapshot)

  for (const allocation of cleanedAllocations) {
    const { id } = allocation
    if (partialSnapshots[id] === undefined) {
      const snapshot = await createSingleSnapshot(allocation, blacklistedAddresses)
      saveSnapshot(id, snapshot)
      console.log(`completed ${id} snapshot`)
    } else {
      console.log(`\n${id} snapshot already complete`)
    }
  }
}

main().then(() => process.exit(0))
