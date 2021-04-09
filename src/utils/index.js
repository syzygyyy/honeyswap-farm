module.exports = (web3) => {
  function packArgs(
    hsf,
    totalHsfToDistribute,
    startTime,
    endTime,
    endDistributionFraction,
    minTimeLock,
    maxTimeLock,
    timeLockMultiplier,
    timeLockConstant
  ) {
    const disitributionParams = web3.eth.abi.encodeParameters(
      ['address', 'uint256', 'uint256', 'uint256', 'uint256'],
      [hsf, totalHsfToDistribute, startTime, endTime, endDistributionFraction]
    )
    const depositParams = web3.eth.abi.encodeParameters(
      ['uint256', 'uint256', 'uint256', 'uint256'],
      [minTimeLock, maxTimeLock, timeLockMultiplier, timeLockConstant]
    )

    return [disitributionParams, depositParams]
  }

  return { packArgs }
}
