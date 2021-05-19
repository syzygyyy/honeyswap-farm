import json
from contextlib import redirect_stdout


def main():
    with open('./airdrop-snapshot.json', 'r') as f:
        data = json.load(f)

    listed_recipients = []
    total = 0
    for addr, airdrop in data.items():
        airdrop = int(airdrop, 16) / 10**18
        total += airdrop
        listed_recipients.append((addr, airdrop))
    listed_recipients.sort(key=lambda d: d[1], reverse=True)
    print('total:', total)

    with open('airdrop-ranking.txt', 'w') as f:
        with redirect_stdout(f):
            for addr, airdrop in listed_recipients:
                print(f'{addr}: {airdrop:09.4f} ({airdrop / total:.6%})')


if __name__ == '__main__':
    main()
