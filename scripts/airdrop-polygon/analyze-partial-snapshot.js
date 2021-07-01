const fs = require('fs')
const web3 = require('./web3.js')()
const BN = require('bn.js')
const BatchedIsContractGetterAbi = require('./artifacts/is-contract-getter-abi.json')
const { getChunkIndices, SCALE } = require('./utils.js')(web3)

const PARTIAL_SNAPSHOTS_SRC = './partial-snapshots.json'
const partialSnapshots = JSON.parse(fs.readFileSync(PARTIAL_SNAPSHOTS_SRC, 'utf8'))

const isContractGetter = new web3.eth.Contract(
  BatchedIsContractGetterAbi,
  '0x18F3317adc01125cBa5e0a83f4DCA479E10e058B'
)

const TAKE_TOP = 300
const SHOW_TOP = 300

async function main() {
  const [, , id] = process.argv
  console.log('id: ', id)
  const snapshot = partialSnapshots[id]
  if (snapshot === undefined) {
    const availableIds = Array.from(Object.keys(partialSnapshots))
    console.error(`snapshot not found, available IDs: ${availableIds}`)
    process.exit(1)
  }
  const { accountAllocations, totalAllocated: rawTotal } = snapshot
  const total = new BN(rawTotal, 16)

  const accounts = Object.entries(accountAllocations).map(([account, allocation]) => ({
    account,
    allocation: new BN(allocation, 16)
  }))
  accounts
    .sort(({ allocation: a }, { allocation: b }) => (a.eq(b) ? 0 : a.gt(b) ? 1 : -1))
    .reverse()

  const isContract = await isContractGetter.methods
    .isContract(accounts.slice(0, TAKE_TOP).map(({ account }) => account))
    .call()

  const contracts = []

  accounts.slice(0, SHOW_TOP).forEach(({ account, allocation }, i) => {
    const accountIsContract = isContract[i] ?? null
    const perc = allocation.mul(new BN('100000')).div(total).toNumber() / 1e3
    const accountSymbol = accountIsContract === null ? '?' : accountIsContract ? 'C' : 'E'
    console.log(`[${accountSymbol}] ${account} ${web3.utils.fromWei(allocation)} (${perc}%)`)
    if (accountIsContract) contracts.push(account)
  })

  contracts.forEach((contract, i) => {
    console.log(`(${i + 1}) ${contract}`)
  })
}

main().then(() => process.exit(0))
