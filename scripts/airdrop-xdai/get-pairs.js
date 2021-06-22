const axios = require('axios')
const web3 = require('./web3')()
const { gql, saveJson, loadJson } = require('./utils')(web3)

async function main() {
  const blacklistedTokens = loadJson('./sus-tokens.json')
  const snapshotInput = loadJson('./snapshot-input.json')

  const { data: res } = await axios({
    url: 'https://api.thegraph.com/subgraphs/name/1hive/honeyswap-v2',
    method: 'POST',

    data: {
      query: gql`
        query {
          pairs(first: 100, orderBy: reserveUSD, orderDirection: desc) {
            id
            token0 {
              symbol
              name
            }
            token1 {
              symbol
              name
            }
            reserveUSD
            volumeUSD
          }
        }
      `
    }
  })
  const allPairs = res.data.pairs
  const finalPairs = {}
  let i = 0
  const formatNum = (num) =>
    Intl.NumberFormat('en-us', { maximumFractionDigits: 3 }).format(parseFloat(num))
  for (const { id: addr, reserveUSD: liquidity, volumeUSD: volume, token0, token1 } of allPairs) {
    if (
      parseFloat(liquidity) < snapshotInput.liquidityCutoff ||
      blacklistedTokens.includes(token0.symbol) ||
      blacklistedTokens.includes(token1.symbol)
    )
      continue
    console.log(`(${++i}) ${token0.symbol}-${token1.symbol} (vol: $${formatNum(volume)})`)
    finalPairs[addr] = parseFloat(liquidity)
  }
  snapshotInput.pairs = finalPairs
  saveJson('./snapshot-input.json', snapshotInput, [null, 2])
}

main().then(() => process.exit(0))
