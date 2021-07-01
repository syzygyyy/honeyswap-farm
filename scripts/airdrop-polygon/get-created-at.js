const web3 = require('../web3.js')()
const { allocations } = require('../reward-map.js')

async function main() {
  await Promise.all(
    allocations.map(async (tokenSet) => {
      if (tokenSet.getCreatedAt === undefined) return
      const createdAtBlocks = await Promise.all(
        tokenSet.tokens.map(({ address: token }) => tokenSet.getCreatedAt(web3, token))
      )
      console.log(tokenSet.tokens.map((token, i) => ({ ...token, createdAt: createdAtBlocks[i] })))
    })
  )
}

main().then(() => process.exit(0))
