# Honey farming contracts

## `contracts/HoneyFarm.sol` - Maths

The HSF being distributed decreases linearly over time. The amount being
distributed at any time t can be denoted by a function f(t) = m * t + ds
where m is the slop of the line and ds is the starting distribution rate. If
te is the time at which distribution ends, the distribution rate at the end de
is f(te). Since we want the distribution rate to decrease over time we'll
denote de as a percentage r of ds, so de = r * ds. The total HSF to be
distributed s is the area under the graph between 0 and te. Since it's a
linear function the underlying area can be calculated as the sum of the
rectange and triangle under the graph:

s = ( area rectange ) + ( area triangle )

s = (te * de) + (1/2 * te * (ds - de))

s = te * (de + 1/2 * (ds - de))

s = te * (ds * r + 1/2 * (ds - ds * r))

s = te * ds * (r + 1/2 * (1 - r))

s = 1/2 * te * ds * (r + 1)

ds = (2 * s) / (te * (r + 1))

Now that the starting distribution rate is calculated one can easily
calculate the slope since it's simply the change in the distribution rate
divided by the time:

m = (de - ds) / te

m = (ds * r - ds) / te

m = ds * (r - 1) / te

-m = ds * (1 - r) / te

The above calculations are used in the constructor to calculate the slope
(distSlope) and the starting distribution rate (startDist). Note that since
solidity doesn't support fractional numbers the scaling constant SCALE is
used to scale fractional numbers up and down.

The final piece of math that is needed is how to calculate the amount to be
distributed between to arbitrary time points d(t1, t2), this can be done by integrating
our f(t) function over that period. All that means is calculating the area
under the graph during that period:

distribution rate d1 at t1: f(t1) = m * t1 + ds

distribution rate d2 at t2: f(t2) = m * t2 + ds

d(t1, t2) = ( area rectangle ) + ( area triangle )

d(t1, t2) = ((t2 - t1) * d2) + (1/2 * (d1 - d2) * (t2 - t1))

d(t1, t2) = (t2 - t1) * (d2 + 1/2 * (d1 - d2))

d(t1, t2) = (t2 - t1) * (1/2 * d2 + 1/2 * d1)

d(t1, t2) = (t2 - t1) * 1/2 * (m * t2 + ds + m * t1 + ds)

d(t1, t2) = (t2 - t1) * 1/2 * (2 * ds + m * (t2 + t1))

d(t1, t2) = (t2 - t1) * (2 * ds - (-m) * (t2 + t1)) / 2

## Deploy procedure

1. Deploy xComb token (contracts/HSFToken.sol)
2. Take the nonce from the xComb deploy tx add two, then enter the deploy
   address and nonce into the `get-deterministic-addr.js` script as follows:
   `node scripts/get-deterministic-addr.js <addr> <nonce>`. Then approve that
   address to spend the tokens that will be distributed
3. Deploy the Farm (contracts/HoneyFarm.sol)
4. Deploy referral rewarder (contracts/ReferralRewarder.sol)
5. Transfer necessary xComb tokens to the referral rewarder
6. Transfer ownership of the referral rewarder to the farm contract
7. Set the referral rewarder address on the farm contract
