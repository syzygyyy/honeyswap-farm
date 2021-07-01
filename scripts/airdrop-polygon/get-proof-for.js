const { createProof } = require('./merkle.js')
const snapshot = require('./airdrop-snapshot.json')

async function main() {
  console.log('snapshot.root: ', snapshot.root)
  const [, , address] = process.argv
  const proof = createProof(snapshot, address)
  console.log('proof: ', proof)
}

main().then(() => process.exit(0))
