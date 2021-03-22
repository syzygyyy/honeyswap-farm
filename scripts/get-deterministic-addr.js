const { getDetAddr } = require('../test/utils')

function main() {
  const [, , addr, nonceRaw] = process.argv
  const nonce = parseInt(nonceRaw)

  console.log('deterministic address:', getDetAddr(addr, nonce))
}

main()
