const { allocations } = require('../reward-map.js')

async function main() {
  allocations.forEach(({ tokens, timeframe }) => {
    tokens.forEach(({ address: token, createdAt }) => {
      if (createdAt > timeframe.end) console.log('token: ', token)
    })
  })
}

main().then(() => process.exit(0))
